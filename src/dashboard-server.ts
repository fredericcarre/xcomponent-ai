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
  RUNTIME_DISCOVER: 'fsm:registry:discover',

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
  private databaseUrl?: string;
  private pgPool: any = null; // pg.Pool - optional, for history queries

  // Registry of connected runtimes
  private runtimes: Map<string, RuntimeRegistration> = new Map();
  private runtimeHeartbeats: Map<string, number> = new Map();

  // Cached component data from runtimes
  private components: Map<string, Component> = new Map();
  private instanceCache: Map<string, any[]> = new Map(); // componentName -> instances

  private heartbeatCheckInterval: NodeJS.Timeout | null = null;

  constructor(brokerUrl: string, databaseUrl?: string) {
    this.brokerUrl = brokerUrl;
    this.databaseUrl = databaseUrl;
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
        database: !!this.pgPool,
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
      console.log(`[Dashboard] GET /api/instances - Cache has ${this.instanceCache.size} components`);
      this.instanceCache.forEach((instances, componentName) => {
        console.log(`[Dashboard]   ${componentName}: ${instances.length} instances`);
        instances.forEach(inst => {
          allInstances.push({ ...inst, componentName });
        });
      });
      console.log(`[Dashboard] Returning ${allInstances.length} total instances`);
      res.json({ instances: allInstances });
    });

    // Get event history for a specific instance
    this.app.get('/api/instances/:instanceId/history', async (req, res) => {
      if (!this.pgPool) {
        res.json({ history: [], message: 'No database configured (set DATABASE_URL)' });
        return;
      }
      try {
        const { instanceId } = req.params;
        const result = await this.pgPool.query(
          `SELECT id, instance_id, machine_name, component_name, event_type, event_payload,
                  from_state, to_state, context, public_member_snapshot,
                  source_component_name,
                  correlation_id, causation_id, caused, persisted_at, created_at
           FROM fsm_events WHERE instance_id = $1
           ORDER BY persisted_at ASC`,
          [instanceId]
        );
        // Map PostgreSQL rows to PersistedEvent format expected by the UI
        const history = result.rows.map((row: any) => ({
          id: row.id,
          instanceId: row.instance_id,
          machineName: row.machine_name,
          componentName: row.component_name || '',
          event: {
            type: row.event_type,
            payload: row.event_payload || {},
            timestamp: parseInt(row.persisted_at, 10)
          },
          stateBefore: row.from_state,
          stateAfter: row.to_state,
          publicMemberSnapshot: row.public_member_snapshot,
          causedBy: row.correlation_id ? [row.correlation_id] : undefined,
          caused: row.caused || [],
          persistedAt: parseInt(row.persisted_at, 10),
          sourceComponentName: row.source_component_name,
        }));
        res.json({ history });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Search all instances (including terminated) from database
    this.app.get('/api/history/instances', async (req, res) => {
      if (!this.pgPool) {
        res.json({ instances: [], message: 'No database configured (set DATABASE_URL)' });
        return;
      }
      try {
        const { machine, state, q, limit: limitStr } = req.query;
        const limit = Math.min(parseInt(limitStr as string) || 100, 500);

        // Try snapshots first, fall back to events if no snapshots exist
        let query = `
          SELECT s.instance_id, s.machine_name, s.current_state, s.context,
                 s.event_count, s.created_at, s.updated_at
          FROM fsm_snapshots s
        `;
        const conditions: string[] = [];
        const params: any[] = [];

        if (machine) {
          params.push(machine);
          conditions.push(`s.machine_name = $${params.length}`);
        }
        if (state) {
          params.push(state);
          conditions.push(`s.current_state = $${params.length}`);
        }
        if (q) {
          params.push(`%${q}%`);
          conditions.push(`(s.context::text ILIKE $${params.length} OR s.instance_id::text ILIKE $${params.length})`);
        }

        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ` ORDER BY s.updated_at DESC LIMIT $${params.length + 1}`;
        params.push(limit);

        const result = await this.pgPool.query(query, params);

        // If snapshots found, return them
        if (result.rows.length > 0) {
          res.json({ instances: result.rows });
          return;
        }

        // Fallback: build instance list from fsm_events (snapshots may not exist
        // if snapshotInterval is higher than the number of transitions)
        let eventsQuery = `
          SELECT e.instance_id, e.machine_name,
                 (array_agg(e.to_state ORDER BY e.persisted_at DESC))[1] as current_state,
                 (array_agg(e.event_payload ORDER BY e.persisted_at ASC))[1] as context,
                 COUNT(*) as event_count,
                 MIN(e.created_at) as created_at,
                 MAX(e.created_at) as updated_at
          FROM fsm_events e
        `;
        const evtConditions: string[] = [];
        const evtParams: any[] = [];

        if (machine) {
          evtParams.push(machine);
          evtConditions.push(`e.machine_name = $${evtParams.length}`);
        }
        if (q) {
          evtParams.push(`%${q}%`);
          evtConditions.push(`(e.event_payload::text ILIKE $${evtParams.length} OR e.instance_id::text ILIKE $${evtParams.length})`);
        }

        if (evtConditions.length > 0) {
          eventsQuery += ' WHERE ' + evtConditions.join(' AND ');
        }

        eventsQuery += ` GROUP BY e.instance_id, e.machine_name`;

        if (state) {
          eventsQuery = `SELECT * FROM (${eventsQuery}) sub WHERE sub.current_state = $${evtParams.length + 1}`;
          evtParams.push(state);
        }

        eventsQuery += ` ORDER BY updated_at DESC LIMIT $${evtParams.length + 1}`;
        evtParams.push(limit);

        const eventsResult = await this.pgPool.query(eventsQuery, evtParams);
        res.json({ instances: eventsResult.rows });
      } catch (error: any) {
        console.error('[Dashboard] History search error:', error.message);
        res.status(500).json({ error: error.message });
      }
    });

    // Get full event history for a specific instance (by instance ID from snapshots)
    this.app.get('/api/history/instances/:instanceId/events', async (req, res) => {
      if (!this.pgPool) {
        res.json({ events: [], message: 'No database configured (set DATABASE_URL)' });
        return;
      }
      try {
        const { instanceId } = req.params;

        // Get snapshot (current/final state)
        const snapshotResult = await this.pgPool.query(
          `SELECT instance_id, machine_name, current_state, context, event_count,
                  created_at, updated_at
           FROM fsm_snapshots WHERE instance_id = $1`,
          [instanceId]
        );

        // Get all events
        const eventsResult = await this.pgPool.query(
          `SELECT id, instance_id, machine_name, component_name, event_type, event_payload,
                  from_state, to_state, context, public_member_snapshot,
                  source_component_name,
                  correlation_id, causation_id, caused, persisted_at, created_at
           FROM fsm_events WHERE instance_id = $1
           ORDER BY persisted_at ASC`,
          [instanceId]
        );

        // Map to PersistedEvent format
        const events = eventsResult.rows.map((row: any) => ({
          id: row.id,
          instanceId: row.instance_id,
          machineName: row.machine_name,
          componentName: row.component_name || '',
          event: {
            type: row.event_type,
            payload: row.event_payload || {},
            timestamp: parseInt(row.persisted_at, 10)
          },
          stateBefore: row.from_state,
          stateAfter: row.to_state,
          publicMemberSnapshot: row.public_member_snapshot,
          sourceComponentName: row.source_component_name || undefined,
          causedBy: row.correlation_id ? [row.correlation_id] : undefined,
          caused: row.caused || [],
          persistedAt: parseInt(row.persisted_at, 10),
        }));

        res.json({
          snapshot: snapshotResult.rows[0] || null,
          events
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get correlated events across all instances sharing the same context value
    // Used for cross-component sequence diagram (e.g., all events for orderId=X)
    this.app.get('/api/history/correlated/:instanceId', async (req, res) => {
      if (!this.pgPool) {
        res.json({ events: [], correlationKey: null });
        return;
      }
      try {
        const { instanceId } = req.params;

        // Step 1: Get context of the target instance from fsm_events
        const instanceEventsResult = await this.pgPool.query(
          `SELECT event_payload, machine_name FROM fsm_events
           WHERE instance_id = $1 ORDER BY persisted_at ASC LIMIT 1`,
          [instanceId]
        );
        if (instanceEventsResult.rows.length === 0) {
          res.json({ events: [], correlationKey: null });
          return;
        }

        // Step 2: Also check snapshots for context
        const snapshotResult = await this.pgPool.query(
          `SELECT context FROM fsm_snapshots WHERE instance_id = $1 LIMIT 1`,
          [instanceId]
        );

        // Determine correlation key: look for orderId or similar shared context field
        const firstPayload = instanceEventsResult.rows[0].event_payload || {};
        const snapshotContext = snapshotResult.rows[0]?.context || {};
        const context = { ...firstPayload, ...snapshotContext };

        // Try common correlation fields
        const correlationFields = ['orderId', 'requestId', 'id', 'transactionId', 'correlationId'];
        let correlationKey: string | null = null;
        let correlationValue: any = null;

        for (const field of correlationFields) {
          if (context[field] !== undefined && context[field] !== null) {
            correlationKey = field;
            correlationValue = context[field];
            break;
          }
        }

        if (!correlationKey) {
          // No correlation found, return just this instance's events
          const result = await this.pgPool.query(
            `SELECT id, instance_id, machine_name, event_type, event_payload,
                    from_state, to_state, context, public_member_snapshot,
                    persisted_at, created_at
             FROM fsm_events WHERE instance_id = $1
             ORDER BY persisted_at ASC`,
            [instanceId]
          );
          res.json({
            events: result.rows.map((row: any) => ({
              id: row.id,
              instanceId: row.instance_id,
              machineName: row.machine_name,
              eventType: row.event_type,
              eventPayload: row.event_payload || {},
              fromState: row.from_state,
              toState: row.to_state,
              context: row.context,
              publicMemberSnapshot: row.public_member_snapshot,
              persistedAt: parseInt(row.persisted_at, 10),
            })),
            correlationKey: null,
          });
          return;
        }

        // Step 3: Find ALL events across ALL instances that share this correlation value
        // Search in event_payload (JSON) for the correlation key
        const correlatedResult = await this.pgPool.query(
          `SELECT id, instance_id, machine_name, component_name, event_type, event_payload,
                  from_state, to_state, context, public_member_snapshot,
                  source_component_name, persisted_at, created_at
           FROM fsm_events
           WHERE event_payload->>$1 = $2
              OR context->>$1 = $2
           ORDER BY persisted_at ASC`,
          [correlationKey, String(correlationValue)]
        );

        res.json({
          events: correlatedResult.rows.map((row: any) => ({
            id: row.id,
            instanceId: row.instance_id,
            machineName: row.machine_name,
            componentName: row.component_name || '',
            eventType: row.event_type,
            eventPayload: row.event_payload || {},
            fromState: row.from_state,
            toState: row.to_state,
            context: row.context,
            publicMemberSnapshot: row.public_member_snapshot,
            sourceComponentName: row.source_component_name || undefined,
            persistedAt: parseInt(row.persisted_at, 10),
          })),
          correlationKey,
          correlationValue,
        });
      } catch (error: any) {
        console.error('[Dashboard] Correlated events error:', error.message);
        res.status(500).json({ error: error.message });
      }
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
      const isNewRuntime = !this.runtimes.has(msg.runtimeId);
      console.log(`[Dashboard] Runtime announced: ${msg.runtimeId} (${msg.componentName}) - ${isNewRuntime ? 'NEW' : 'existing'}`);
      this.runtimes.set(msg.runtimeId, msg);
      this.runtimeHeartbeats.set(msg.runtimeId, Date.now());
      this.components.set(msg.componentName, msg.component);

      // Notify browser clients
      this.io.emit('runtime_connected', msg);
      this.io.emit('components_list', { components: Array.from(this.components.values()) });

      // Query instances only for NEW runtimes to avoid infinite loop
      // The infinite loop was: dashboard queries -> runtime re-announces -> dashboard queries -> ...
      // By only querying for NEW runtimes, we break the loop
      if (isNewRuntime) {
        console.log(`[Dashboard] Querying instances for new runtime ${msg.runtimeId}`);
        await this.broker.publish(DashboardChannels.QUERY_INSTANCES, {
          type: 'query_all_instances',
          timestamp: Date.now()
        } as any);
      }
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
      console.log(`[Dashboard] Received QUERY_RESPONSE: type=${msg.type}, component=${msg.componentName}, instances=${msg.instances?.length || 0}`);
      if (msg.type === 'instances' && msg.componentName) {
        console.log(`[Dashboard] Caching ${msg.instances?.length || 0} instances for ${msg.componentName}`);
        this.instanceCache.set(msg.componentName, msg.instances || []);
        this.io.emit('instances_update', { componentName: msg.componentName, instances: msg.instances });
      }
    });
  }

  private updateInstanceCache(componentName: string, data: any): void {
    const instances = this.instanceCache.get(componentName) || [];
    const idx = instances.findIndex((i: any) => i.instanceId === data.instanceId || i.id === data.instanceId);
    if (idx >= 0) {
      console.log(`[Dashboard] Updating instance ${data.instanceId} to state ${data.newState}`);
      instances[idx] = { ...instances[idx], currentState: data.newState, context: data.context };
    } else {
      console.log(`[Dashboard] WARNING: Instance ${data.instanceId} not found in cache for ${componentName}`);
      console.log(`[Dashboard] Cached instances: ${instances.map((i: any) => i.instanceId || i.id).join(', ') || 'none'}`);
    }
    this.instanceCache.set(componentName, instances);
  }

  private addToInstanceCache(componentName: string, data: any): void {
    console.log(`[Dashboard] addToInstanceCache: Adding instance ${data.instanceId} to ${componentName}`);
    const instances = this.instanceCache.get(componentName) || [];
    instances.push({
      instanceId: data.instanceId,
      id: data.instanceId, // Alias for compatibility
      machineName: data.machineName,
      currentState: data.currentState,
      context: data.context || {}
    });
    this.instanceCache.set(componentName, instances);
    console.log(`[Dashboard] ${componentName} now has ${instances.length} instances in cache`);
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
      // Add matching rules indicator
      if (t.matchingRules && t.matchingRules.length > 0) {
        const rulesText = t.matchingRules.map((r: any) => `${r.eventProperty}=${r.instanceProperty}`).join(',');
        label += ` 🔑${rulesText}`;
      }
      // Add visual prefix for cross-component and inter-machine transitions
      if (t.type === 'cross_component' || t.targetComponent) {
        const target = t.targetComponent || '';
        label = `📡 ${label} → ${target}`;
      } else if (t.type === 'inter_machine' && t.targetMachine) {
        label = `🔗 ${label} → ${t.targetMachine}`;
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
    console.log(`[Dashboard] Version: 2024-01-27-v3 - Starting...`);

    // Connect to PostgreSQL if DATABASE_URL provided (for history queries)
    if (this.databaseUrl) {
      try {
        const pgModule = await import('pg' as any);
        const Pool = pgModule.Pool || pgModule.default?.Pool;
        this.pgPool = new Pool({ connectionString: this.databaseUrl });
        // Test connection
        await this.pgPool.query('SELECT 1');
        console.log(`[Dashboard] PostgreSQL connected (history queries enabled)`);
      } catch (error: any) {
        console.warn(`[Dashboard] PostgreSQL connection failed: ${error.message}`);
        console.warn(`[Dashboard] History queries will be unavailable`);
        this.pgPool = null;
      }
    } else {
      console.log(`[Dashboard] No DATABASE_URL - history queries disabled`);
    }

    // Connect to message broker
    console.log(`[Dashboard] Connecting to message broker: ${this.brokerUrl.replace(/:[^:@]+@/, ':***@')}`);
    await this.broker.connect();

    // Setup broker subscriptions
    await this.setupBrokerSubscriptions();

    // Start heartbeat check
    this.startHeartbeatCheck();

    // Ask already-running runtimes to re-announce themselves
    // (handles case where runtimes started before dashboard)
    await this.broker.publish(DashboardChannels.RUNTIME_DISCOVER, {
      type: 'discover',
      timestamp: Date.now()
    } as any);

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
    if (this.pgPool) {
      await this.pgPool.end();
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
  const databaseUrl = process.env.DATABASE_URL || undefined;
  const port = parseInt(process.env.PORT || process.argv[3] || '3000', 10);

  const dashboard = new DashboardServer(brokerUrl, databaseUrl);

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
