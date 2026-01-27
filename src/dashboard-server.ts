/**
 * Standalone Dashboard Server for Distributed Mode
 *
 * Connects to a message broker (RabbitMQ/Redis) to receive events from
 * multiple FSM runtimes and provides a unified dashboard view.
 */

import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as path from 'path';
import { createMessageBroker, MessageBroker } from './message-broker';
import { Component } from './types';

/**
 * Runtime registration message
 */
export interface RuntimeRegistration {
  runtimeId: string;
  componentName: string;
  component: Component;
  host: string;
  port: number;
  timestamp: number;
}

/**
 * FSM Event broadcast from runtime
 */
export interface FSMEventBroadcast {
  runtimeId: string;
  componentName: string;
  eventType: 'state_change' | 'instance_created' | 'instance_completed' | 'timeout_triggered';
  data: any;
  timestamp: number;
}

/**
 * Channels used for dashboard communication
 */
export const DashboardChannels = {
  // Runtime discovery
  RUNTIME_ANNOUNCE: 'fsm:registry:announce',
  RUNTIME_HEARTBEAT: 'fsm:registry:heartbeat',
  RUNTIME_SHUTDOWN: 'fsm:registry:shutdown',

  // FSM events from runtimes
  STATE_CHANGE: 'fsm:events:state_change',
  INSTANCE_CREATED: 'fsm:events:instance_created',
  INSTANCE_COMPLETED: 'fsm:events:instance_completed',
  TIMEOUT_TRIGGERED: 'fsm:events:timeout_triggered',

  // Commands to runtimes
  TRIGGER_EVENT: 'fsm:commands:trigger_event',
  CREATE_INSTANCE: 'fsm:commands:create_instance',
  CROSS_COMPONENT_EVENT: 'fsm:commands:cross_component_event',
  QUERY_INSTANCES: 'fsm:commands:query_instances',

  // Query responses from runtimes
  QUERY_RESPONSE: 'fsm:responses:query',
};

/**
 * Standalone Dashboard Server
 */
export class DashboardServer {
  private app: express.Application;
  private httpServer: any;
  private io: SocketIOServer;
  private broker: MessageBroker;
  private brokerUrl: string;

  // Registry of connected runtimes
  private runtimes: Map<string, RuntimeRegistration> = new Map();
  private runtimeHeartbeats: Map<string, number> = new Map();

  // Cached component data from runtimes
  private components: Map<string, Component> = new Map();
  private instanceCache: Map<string, any[]> = new Map(); // componentName -> instances

  private heartbeatCheckInterval: NodeJS.Timeout | null = null;

  constructor(brokerUrl: string) {
    this.brokerUrl = brokerUrl;
    this.broker = createMessageBroker(brokerUrl);

    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());

    // CORS
    this.app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });

    // Serve static files
    const publicPath = path.join(__dirname, '..', 'public');
    this.app.use(express.static(publicPath));

    // Serve dashboard.html as index
    this.app.get('/', (_req, res) => {
      res.sendFile(path.join(publicPath, 'dashboard.html'));
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        mode: 'distributed',
        broker: this.brokerUrl.replace(/:[^:@]+@/, ':***@'),
        connectedRuntimes: this.runtimes.size,
        components: Array.from(this.components.keys())
      });
    });

    // List all components from all runtimes
    this.app.get('/api/components', (_req, res) => {
      const components = Array.from(this.components.values()).map(c => ({
        name: c.name,
        version: c.version,
        entryMachine: c.entryMachine,
        stateMachines: c.stateMachines.map(m => ({
          name: m.name,
          states: m.states,
          initialState: m.initialState,
          transitions: m.transitions,
          contextSchema: m.contextSchema
        }))
      }));
      res.json({ components });
    });

    // Get component details
    this.app.get('/api/components/:name', (req, res) => {
      const component = this.components.get(req.params.name);
      if (!component) {
        res.status(404).json({ error: 'Component not found' });
        return;
      }
      res.json(component);
    });

    // Get instances for a component
    this.app.get('/api/components/:name/instances', async (req, res) => {
      const componentName = req.params.name;
      const instances = this.instanceCache.get(componentName) || [];
      res.json({ instances });
    });

    // Get machines for a component
    this.app.get('/api/components/:name/machines', (req, res) => {
      const component = this.components.get(req.params.name);
      if (!component) {
        res.status(404).json({ error: 'Component not found' });
        return;
      }
      res.json({
        machines: component.stateMachines.map(m => ({
          name: m.name,
          states: m.states,
          initialState: m.initialState,
          transitions: m.transitions,
          contextSchema: m.contextSchema
        }))
      });
    });

    // Get diagram for a machine
    this.app.get('/api/machines/:name/diagram', (req, res) => {
      const machineName = req.params.name;
      const currentState = req.query.currentState as string | undefined;

      // Find machine in any component
      let machine = null;
      for (const component of this.components.values()) {
        machine = component.stateMachines.find(m => m.name === machineName);
        if (machine) break;
      }

      if (!machine) {
        res.status(404).json({ error: 'Machine not found' });
        return;
      }

      // Generate Mermaid diagram
      const diagram = this.generateMermaidDiagram(machine, currentState);
      res.json({ diagram, machineName, currentState });
    });

    // Trigger event on a runtime (via message broker)
    this.app.post('/api/instances/:instanceId/trigger', async (req, res) => {
      const { instanceId } = req.params;
      const { event, payload } = req.body;

      try {
        await this.broker.publish(DashboardChannels.TRIGGER_EVENT, {
          instanceId,
          event: { type: event, payload: payload || {} },
          timestamp: Date.now()
        });

        res.json({ success: true, message: 'Event sent to runtimes' });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Create instance on a runtime
    this.app.post('/api/components/:name/instances', async (req, res) => {
      const componentName = req.params.name;
      const { machineName, context, event } = req.body;

      try {
        await this.broker.publish(DashboardChannels.CREATE_INSTANCE, {
          componentName,
          machineName, // Forward machine name to runtime
          context: context || {},
          event: event || { type: 'START', payload: {} },
          timestamp: Date.now()
        });

        res.json({ success: true, message: 'Create instance command sent' });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Connected runtimes info
    this.app.get('/api/runtimes', (_req, res) => {
      const runtimes = Array.from(this.runtimes.values()).map(r => ({
        runtimeId: r.runtimeId,
        componentName: r.componentName,
        host: r.host,
        port: r.port,
        lastSeen: this.runtimeHeartbeats.get(r.runtimeId)
      }));
      res.json({ runtimes });
    });

    // Get all instances across all components
    this.app.get('/api/instances', (_req, res) => {
      const allInstances: any[] = [];
      this.instanceCache.forEach((instances, componentName) => {
        instances.forEach(inst => {
          allInstances.push({ ...inst, componentName });
        });
      });
      res.json({ instances: allInstances });
    });

    // Get instance history (placeholder - would need event store access)
    this.app.get('/api/instances/:instanceId/history', (_req, res) => {
      // In distributed mode, history is stored in PostgreSQL on runtimes
      // This is a placeholder that returns empty for now
      res.json({ history: [], message: 'History is stored on runtime event stores' });
    });

    // Trigger event on specific component instance
    // Accepts both { event: 'NAME' } and { type: 'NAME', payload: {} } formats
    this.app.post('/api/components/:componentName/instances/:instanceId/events', async (req, res) => {
      const { componentName, instanceId } = req.params;
      const { type, event, payload } = req.body;
      const eventType = type || event; // Support both formats

      if (!eventType) {
        res.status(400).json({ error: 'Missing event type. Send { event: "NAME" } or { type: "NAME" }' });
        return;
      }

      try {
        console.log(`[Dashboard] Publishing TRIGGER_EVENT: ${componentName}/${instanceId} -> ${eventType}`);
        const message = {
          componentName,
          instanceId,
          event: { type: eventType, payload: payload || {}, timestamp: Date.now() }
        };
        console.log(`[Dashboard] TRIGGER_EVENT message:`, JSON.stringify(message));
        await this.broker.publish(DashboardChannels.TRIGGER_EVENT, message);
        console.log(`[Dashboard] TRIGGER_EVENT published successfully`);

        res.json({ success: true, message: 'Event sent to runtime' });
      } catch (error: any) {
        console.error(`[Dashboard] Failed to publish TRIGGER_EVENT:`, error);
        res.status(500).json({ error: error.message });
      }
    });
  }

  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      console.log(`[Dashboard] Browser client connected: ${socket.id}`);

      // Send current components list
      const components = Array.from(this.components.values());
      socket.emit('components_list', { components });

      // Send cached instances
      this.instanceCache.forEach((instances, componentName) => {
        socket.emit('instances_update', { componentName, instances });
      });

      socket.on('disconnect', () => {
        console.log(`[Dashboard] Browser client disconnected: ${socket.id}`);
      });
    });
  }

  private async setupBrokerSubscriptions(): Promise<void> {
    // Subscribe to runtime announcements
    await this.broker.subscribe(DashboardChannels.RUNTIME_ANNOUNCE, async (msg: RuntimeRegistration) => {
      console.log(`[Dashboard] Runtime announced: ${msg.runtimeId} (${msg.componentName})`);
      this.runtimes.set(msg.runtimeId, msg);
      this.runtimeHeartbeats.set(msg.runtimeId, Date.now());
      this.components.set(msg.componentName, msg.component);

      // Notify browser clients
      this.io.emit('runtime_connected', msg);
      this.io.emit('components_list', { components: Array.from(this.components.values()) });

      // Query instances from this newly announced runtime
      // This ensures we get instances even if we missed the initial QUERY_INSTANCES
      await this.broker.publish(DashboardChannels.QUERY_INSTANCES, {
        type: 'query_all_instances',
        timestamp: Date.now()
      } as any);
    });

    // Subscribe to heartbeats
    await this.broker.subscribe(DashboardChannels.RUNTIME_HEARTBEAT, (msg: any) => {
      this.runtimeHeartbeats.set(msg.runtimeId, Date.now());
    });

    // Subscribe to shutdown notifications
    await this.broker.subscribe(DashboardChannels.RUNTIME_SHUTDOWN, (msg: any) => {
      console.log(`[Dashboard] Runtime shutdown: ${msg.runtimeId}`);
      const runtime = this.runtimes.get(msg.runtimeId);
      if (runtime) {
        this.runtimes.delete(msg.runtimeId);
        this.runtimeHeartbeats.delete(msg.runtimeId);
        // Don't remove component - other runtimes might have it
        this.io.emit('runtime_disconnected', { runtimeId: msg.runtimeId });
      }
    });

    // Subscribe to state changes
    await this.broker.subscribe(DashboardChannels.STATE_CHANGE, (msg: FSMEventBroadcast) => {
      console.log(`[Dashboard] State change: ${msg.data.instanceId} -> ${msg.data.newState}`);
      this.io.emit('state_change', { ...msg.data, componentName: msg.componentName });

      // Update instance cache
      this.updateInstanceCache(msg.componentName, msg.data);
    });

    // Subscribe to instance created
    await this.broker.subscribe(DashboardChannels.INSTANCE_CREATED, (msg: FSMEventBroadcast) => {
      console.log(`[Dashboard] Instance created: ${msg.data.instanceId}`);
      this.io.emit('instance_created', { ...msg.data, componentName: msg.componentName });

      // Add to instance cache
      this.addToInstanceCache(msg.componentName, msg.data);
    });

    // Subscribe to instance completed
    await this.broker.subscribe(DashboardChannels.INSTANCE_COMPLETED, (msg: FSMEventBroadcast) => {
      console.log(`[Dashboard] Instance completed: ${msg.data.instanceId}`);
      this.io.emit('instance_completed', { ...msg.data, componentName: msg.componentName });
    });

    // Subscribe to timeout triggered
    await this.broker.subscribe(DashboardChannels.TIMEOUT_TRIGGERED, (msg: FSMEventBroadcast) => {
      console.log(`[Dashboard] Timeout triggered: ${msg.data.instanceId}`);
      this.io.emit('timeout_triggered', { ...msg.data, componentName: msg.componentName });
    });

    // Subscribe to query responses (for instance data)
    await this.broker.subscribe(DashboardChannels.QUERY_RESPONSE, (msg: any) => {
      if (msg.type === 'instances' && msg.componentName) {
        this.instanceCache.set(msg.componentName, msg.instances || []);
        this.io.emit('instances_update', { componentName: msg.componentName, instances: msg.instances });
      }
    });
  }

  private updateInstanceCache(componentName: string, data: any): void {
    const instances = this.instanceCache.get(componentName) || [];
    const idx = instances.findIndex((i: any) => i.instanceId === data.instanceId || i.id === data.instanceId);
    if (idx >= 0) {
      instances[idx] = { ...instances[idx], currentState: data.newState, context: data.context };
    }
    this.instanceCache.set(componentName, instances);
  }

  private addToInstanceCache(componentName: string, data: any): void {
    const instances = this.instanceCache.get(componentName) || [];
    instances.push({
      instanceId: data.instanceId,
      id: data.instanceId, // Alias for compatibility
      machineName: data.machineName,
      currentState: data.currentState,
      context: data.context || {}
    });
    this.instanceCache.set(componentName, instances);
  }

  private generateMermaidDiagram(machine: any, currentState?: string): string {
    const lines: string[] = ['stateDiagram-v2'];

    // Add initial state arrow
    lines.push(`  [*] --> ${machine.initialState}`);

    // Add transitions
    (machine.transitions || []).forEach((t: any) => {
      let label = t.event;
      if (t.guard?.expression) {
        const shortExpr = t.guard.expression.replace(/context\./g, '');
        label += ` [${shortExpr}]`;
      }
      lines.push(`  ${t.from} --> ${t.to}: ${label}`);
    });

    // Add terminal state arrows
    const terminalStates = (machine.states || []).filter((s: any) => s.terminal);
    terminalStates.forEach((s: any) => {
      lines.push(`  ${s.name} --> [*]`);
    });

    // Style current state
    if (currentState) {
      lines.push(`  classDef currentState fill:#4c1d95,stroke:#a855f7,stroke-width:3px,color:#e9d5ff`);
      lines.push(`  class ${currentState} currentState`);
    }

    return lines.join('\n');
  }

  private startHeartbeatCheck(): void {
    // Check for stale runtimes every 30 seconds
    this.heartbeatCheckInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = 60000; // 60 seconds

      this.runtimeHeartbeats.forEach((lastSeen, runtimeId) => {
        if (now - lastSeen > staleThreshold) {
          console.log(`[Dashboard] Runtime stale (no heartbeat): ${runtimeId}`);
          this.runtimes.delete(runtimeId);
          this.runtimeHeartbeats.delete(runtimeId);
          this.io.emit('runtime_disconnected', { runtimeId, reason: 'heartbeat_timeout' });
        }
      });
    }, 30000);
  }

  async start(port: number = 3000): Promise<void> {
    // Connect to message broker
    console.log(`[Dashboard] Connecting to message broker: ${this.brokerUrl.replace(/:[^:@]+@/, ':***@')}`);
    await this.broker.connect();

    // Setup broker subscriptions
    await this.setupBrokerSubscriptions();

    // Start heartbeat check
    this.startHeartbeatCheck();

    // Request instances from all runtimes
    await this.broker.publish(DashboardChannels.QUERY_INSTANCES, {
      type: 'query_all_instances',
      timestamp: Date.now()
    } as any);

    // Start HTTP server
    return new Promise((resolve) => {
      this.httpServer.listen(port, () => {
        console.log('\n' + '═'.repeat(50));
        console.log('    XCOMPONENT DASHBOARD (Distributed Mode)');
        console.log('═'.repeat(50));
        console.log(`📊 Dashboard:     http://localhost:${port}`);
        console.log(`📡 WebSocket:     ws://localhost:${port}`);
        console.log(`🔗 Broker:        ${this.brokerUrl.replace(/:[^:@]+@/, ':***@')}`);
        console.log('═'.repeat(50));
        console.log('Waiting for runtimes to connect...\n');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatCheckInterval) {
      clearInterval(this.heartbeatCheckInterval);
    }
    await this.broker.disconnect();
    this.httpServer.close();
  }
}

/**
 * CLI entry point
 */
if (require.main === module) {
  const brokerUrl = process.env.BROKER_URL || process.argv[2] || 'amqp://guest:guest@localhost:5672';
  const port = parseInt(process.env.PORT || process.argv[3] || '3000', 10);

  const dashboard = new DashboardServer(brokerUrl);

  dashboard.start(port).catch((error) => {
    console.error('Failed to start dashboard:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down dashboard...');
    await dashboard.stop();
    process.exit(0);
  });
}
