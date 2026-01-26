/**
 * Express API Server
 * REST API for FSM management and monitoring
 */

import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { FSMRuntime } from './fsm-runtime';
import { ComponentRegistry } from './component-registry';
import { WebSocketManager } from './websockets';
import { monitoringService } from './monitoring';
import { SupervisorAgent } from './agents';
import { Component, FSMEvent } from './types';
import * as yaml from 'yaml';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

/**
 * API Server
 */
export class APIServer {
  private app: express.Application;
  private httpServer: any;
  private wsManager: WebSocketManager;
  private registry: ComponentRegistry;
  private supervisor: SupervisorAgent;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.registry = new ComponentRegistry();
    this.wsManager = new WebSocketManager(this.httpServer);
    this.wsManager.setRegistry(this.registry);
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
        runtime.setRegistry(this.registry);
        this.registry.registerComponent(component, runtime);
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

        const runtime = this.registry.getRuntime(component);
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

        const runtime = this.registry.getRuntime(component);
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

        const runtime = this.registry.getRuntime(component);
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

        const runtime = this.registry.getRuntime(component);
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

    // Get component definition (for FSM diagram generation)
    this.app.get('/api/:component/definition', (req: Request, res: Response) => {
      try {
        const componentName = req.params.component as string;
        const runtime = this.registry.getRuntime(componentName);
        if (!runtime) {
          return res.status(404).json({ success: false, error: 'Component not found' });
        }

        const component = runtime.getComponent();
        return res.json({ success: true, data: { component } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get available transitions for instance
    this.app.get('/api/:component/instance/:instanceId/transitions', (req: Request, res: Response) => {
      try {
        const componentName = req.params.component as string;
        const instanceId = req.params.instanceId as string;

        const runtime = this.registry.getRuntime(componentName);
        if (!runtime) {
          return res.status(404).json({ success: false, error: 'Component not found' });
        }

        const instance = runtime.getInstance(instanceId);
        if (!instance) {
          return res.status(404).json({ success: false, error: 'Instance not found' });
        }

        const availableTransitions = runtime.getAvailableTransitions(instanceId);
        return res.json({ success: true, data: { transitions: availableTransitions } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get instance history (requires persistence)
    this.app.get('/api/:component/instance/:instanceId/history', async (req: Request, res: Response) => {
      try {
        const componentName = req.params.component as string;
        const instanceId = req.params.instanceId as string;

        const runtime = this.registry.getRuntime(componentName);
        if (!runtime) {
          return res.status(404).json({ success: false, error: 'Component not found' });
        }

        const history = await runtime.getInstanceHistory(instanceId);
        return res.json({ success: true, data: { history } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Trace event causality (single component)
    this.app.get('/api/:component/causality/:eventId', async (req: Request, res: Response) => {
      try {
        const componentName = req.params.component as string;
        const eventId = req.params.eventId as string;

        const runtime = this.registry.getRuntime(componentName);
        if (!runtime) {
          return res.status(404).json({ success: false, error: 'Component not found' });
        }

        const causality = await runtime.traceEventCausality(eventId);
        return res.json({ success: true, data: { causality } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Cross-component traceability: trace event across all components
    this.app.get('/api/cross-component/causality/:eventId', async (req: Request, res: Response) => {
      try {
        const eventId = req.params.eventId as string;

        const causality = await this.registry.traceEventAcrossComponents(eventId);
        return res.json({ success: true, data: { causality, count: causality.length } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Cross-component traceability: get all events across all components
    this.app.get('/api/cross-component/events', async (_req: Request, res: Response) => {
      try {
        const events = await this.registry.getAllPersistedEvents();
        return res.json({ success: true, data: { events, count: events.length } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Cross-component traceability: get instance history across components
    this.app.get('/api/cross-component/instance/:instanceId/history', async (req: Request, res: Response) => {
      try {
        const instanceId = req.params.instanceId as string;

        const history = await this.registry.getInstanceHistory(instanceId);
        return res.json({ success: true, data: { history, count: history.length } });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get all components
    this.app.get('/api/components', (_req: Request, res: Response) => {
      try {
        const componentNames = this.registry.getComponentNames();
        const components = componentNames.map(name => this.registry.getComponent(name)).filter(c => c !== undefined);
        return res.json({ success: true, components });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get all instances across all components
    this.app.get('/api/instances', (_req: Request, res: Response) => {
      try {
        const instances: any[] = [];
        const componentNames = this.registry.getComponentNames();

        componentNames.forEach(componentName => {
          const runtime = this.registry.getRuntime(componentName);
          if (runtime) {
            const componentInstances = runtime.getAllInstances();
            console.log(`[API] Loading ${componentInstances.length} instances for ${componentName}`);
            // Add timeout info to each instance
            componentInstances.forEach(inst => {
              console.log(`[API] Instance ${inst.id} in state ${inst.currentState}`);
              const pendingTimeouts = runtime.getPendingTimeouts(inst.id);
              console.log(`[API] pendingTimeouts for ${inst.id}:`, pendingTimeouts);
              // Debug: add transition info to response for debugging
              let debugTransitions: any[] = [];
              const machine = (runtime as any).machines?.get(inst.machineName);
              if (machine) {
                const relevantTransitions = machine.transitions?.filter(
                  (t: any) => t.from === inst.currentState
                );
                debugTransitions = relevantTransitions?.map((t: any) => ({
                  event: t.event,
                  type: t.type,
                  typeofType: typeof t.type,
                  timeoutMs: t.timeoutMs
                })) || [];
              }
              instances.push({
                ...inst,
                pendingTimeouts,
                _debug: { transitions: debugTransitions }
              });
            });
          }
        });

        return res.json({ success: true, instances });
      } catch (error: any) {
        return res.status(500).json({ success: false, error: error.message });
      }
    });

    // Get Mermaid diagram for a specific machine
    this.app.get('/api/machines/:machineName/diagram', (req: Request, res: Response) => {
      try {
        const machineName = req.params.machineName as string;
        const instanceId = req.query.instanceId as string | undefined;

        // Find the machine in any component
        const componentNames = this.registry.getComponentNames();
        let foundMachine = null;
        let foundComponentName = null;

        for (const componentName of componentNames) {
          const component = this.registry.getComponent(componentName);
          if (component) {
            const machine = component.stateMachines.find(m => m.name === machineName);
            if (machine) {
              foundMachine = machine;
              foundComponentName = componentName;
              break;
            }
          }
        }

        if (!foundMachine || !foundComponentName) {
          return res.status(404).json({ success: false, error: 'Machine not found' });
        }

        // Get current state if instanceId is provided
        let currentState: string | undefined;
        if (instanceId) {
          const runtime = this.registry.getRuntime(foundComponentName);
          if (runtime) {
            const instance = runtime.getInstance(instanceId);
            if (instance && instance.machineName === machineName) {
              currentState = instance.currentState;
            }
          }
        }

        // Generate Mermaid diagram
        const { generateStyledMermaidDiagram } = require('./mermaid-generator');
        const diagram = generateStyledMermaidDiagram(foundMachine, currentState);

        return res.json({ success: true, diagram, currentState });
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
    // Serve the enhanced dashboard from public/dashboard.html
    const dashboardPath = path.join(__dirname, '../public/dashboard.html');
    try {
      return fsSync.readFileSync(dashboardPath, 'utf-8');
    } catch (error) {
      // Fallback to basic dashboard if file not found
      return `
<!DOCTYPE html>
<html>
<head>
  <title>xcomponent-ai Dashboard</title>
  <style>
    body { font-family: sans-serif; padding: 2rem; background: #f5f5f5; }
    .error { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  </style>
</head>
<body>
  <div class="error">
    <h1>Dashboard Error</h1>
    <p>Could not load dashboard. Please ensure the public/dashboard.html file exists.</p>
    <p>Error: ${error instanceof Error ? error.message : String(error)}</p>
  </div>
</body>
</html>`;
    }
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
