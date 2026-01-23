/**
 * Express API Server
 * REST API for FSM management and monitoring
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { FSMRuntime } from './fsm-runtime';
import { WebSocketManager } from './websockets';
import { monitoringService } from './monitoring';
import { SupervisorAgent } from './agents';
import { Component, FSMEvent } from './types';
import * as yaml from 'yaml';
import * as fs from 'fs/promises';

/**
 * API Server
 */
export class APIServer {
  private app: express.Application;
  private httpServer: any;
  private wsManager: WebSocketManager;
  private runtimes: Map<string, FSMRuntime>;
  private supervisor: SupervisorAgent;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.wsManager = new WebSocketManager(this.httpServer);
    this.runtimes = new Map();
    this.supervisor = new SupervisorAgent();

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup Express middleware
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.static('public'));

    // CORS
    this.app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });

    // Request logging
    this.app.use((req, _res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * Setup API routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Load component from YAML file
    this.app.post('/api/component/load', async (req: Request, res: Response) => {
      try {
        const { filePath } = req.body;
        const content = await fs.readFile(filePath, 'utf-8');
        const component = yaml.parse(content) as Component;

        const runtime = new FSMRuntime(component);
        this.runtimes.set(component.name, runtime);
        this.wsManager.registerRuntime(component.name, runtime);

        // Setup monitoring
        this.setupMonitoring(runtime, component.name);

        res.json({
          success: true,
          data: {
            componentName: component.name,
            machineCount: component.stateMachines.length,
          },
        });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // Create instance
    this.app.post('/api/:component/:machine/instance', (req: Request, res: Response) => {
      try {
        const component = req.params.component as string;
        const machine = req.params.machine as string;
        const { context } = req.body;

        const runtime = this.runtimes.get(component);
        if (!runtime) {
          return res.status(404).json({ success: false, error: 'Component not found' });
        }

        const instanceId = runtime.createInstance(machine, context || {});
        return res.json({ success: true, data: { instanceId } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Send event to instance
    this.app.post('/api/:component/instance/:instanceId/event', async (req: Request, res: Response) => {
      try {
        const component = req.params.component as string;
        const instanceId = req.params.instanceId as string;
        const event: FSMEvent = req.body;

        const runtime = this.runtimes.get(component);
        if (!runtime) {
          return res.status(404).json({ success: false, error: 'Component not found' });
        }

        await runtime.sendEvent(instanceId, event);
        const instance = runtime.getInstance(instanceId);

        return res.json({ success: true, data: { instance } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get instance state
    this.app.get('/api/:component/instance/:instanceId', (req: Request, res: Response) => {
      try {
        const component = req.params.component as string;
        const instanceId = req.params.instanceId as string;

        const runtime = this.runtimes.get(component);
        if (!runtime) {
          return res.status(404).json({ success: false, error: 'Component not found' });
        }

        const instance = runtime.getInstance(instanceId);
        if (!instance) {
          return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        return res.json({ success: true, data: { instance } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get all instances for component
    this.app.get('/api/:component/instances', (req: Request, res: Response) => {
      try {
        const component = req.params.component as string;

        const runtime = this.runtimes.get(component);
        if (!runtime) {
          return res.status(404).json({ success: false, error: 'Component not found' });
        }

        const instances = runtime.getAllInstances();
        return res.json({ success: true, data: { instances, count: instances.length } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Monitoring endpoint
    this.app.get('/api/monitor/:component', (req: Request, res: Response) => {
      try {
        const component = req.params.component as string;
        const summary = monitoringService.generateSummary(component);
        const insights = monitoringService.analyzeLogs(component);

        return res.json({
          success: true,
          data: {
            summary,
            insights,
            logs: monitoringService.getAllLogs(),
          },
        });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // AI Agent endpoints
    this.app.post('/api/ai/create-fsm', async (req: Request, res: Response) => {
      try {
        const { description } = req.body;
        const result = await this.supervisor.getFSMAgent().createFSM(description);
        return res.json(result);
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.post('/api/ai/analyze', async (req: Request, res: Response) => {
      try {
        const { componentName } = req.body;
        const result = await this.supervisor.getMonitoringAgent().analyzeLogs(componentName);
        return res.json(result);
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Dashboard
    this.app.get('/dashboard', (_req: Request, res: Response) => {
      return res.send(this.getDashboardHTML());
    });
  }

  /**
   * Setup monitoring for runtime
   */
  private setupMonitoring(runtime: FSMRuntime, _componentName: string): void {
    runtime.on('state_change', (data) => {
      monitoringService.logTransition({
        instanceId: data.instanceId,
        from: data.previousState,
        to: data.newState,
        event: data.event.type,
        time: data.timestamp,
      });
    });

    runtime.on('instance_error', (data) => {
      monitoringService.logError(data.instanceId, data.error);
    });
  }

  /**
   * Get dashboard HTML
   */
  private getDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>xcomponent-ai Dashboard</title>
  <script src="/socket.io/socket.io.js"></script>
  <style>
    body { font-family: 'Segoe UI', sans-serif; margin: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .container { max-width: 1200px; margin: 0 auto; }
    table { width: 100%; border-collapse: collapse; background: white; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #4CAF50; color: white; }
    .status { padding: 4px 8px; border-radius: 3px; font-size: 12px; }
    .status.active { background: #4CAF50; color: white; }
    .status.completed { background: #2196F3; color: white; }
    .status.error { background: #f44336; color: white; }
    #events { max-height: 400px; overflow-y: auto; background: white; padding: 15px; margin: 20px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .event { padding: 8px; margin: 5px 0; border-left: 3px solid #4CAF50; background: #f9f9f9; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 xcomponent-ai Dashboard</h1>
    <h2>Active Instances</h2>
    <table id="instances">
      <thead>
        <tr>
          <th>Instance ID</th>
          <th>Machine</th>
          <th>Current State</th>
          <th>Status</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <h2>Real-time Events</h2>
    <div id="events"></div>
  </div>
  <script>
    const socket = io();
    socket.on('connect', () => console.log('Connected to WebSocket'));
    socket.on('state_change', (data) => {
      const div = document.createElement('div');
      div.className = 'event';
      div.innerHTML = \`<strong>\${data.instanceId}</strong>: \${data.previousState} → \${data.newState} (event: \${data.event.type})\`;
      document.getElementById('events').prepend(div);
    });
  </script>
</body>
</html>`;
  }

  /**
   * Start server
   */
  start(port: number = 3000): void {
    this.httpServer.listen(port, () => {
      console.log(`✓ xcomponent-ai API server running on http://localhost:${port}`);
      console.log(`✓ Dashboard: http://localhost:${port}/dashboard`);
      console.log(`✓ WebSocket endpoint: ws://localhost:${port}`);
    });
  }
}

/**
 * Main entry point
 */
if (require.main === module) {
  const server = new APIServer();
  server.start(3000);
}
