/**
 * WebSocket Infrastructure for Real-time FSM Monitoring
 * Socket.io-based live state change broadcasting
 */

import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { FSMRuntime } from './fsm-runtime';
import { StateChangeMessage } from './types';

/**
 * WebSocket Manager
 */
export class WebSocketManager {
  private io: SocketIOServer;
  private runtimes: Map<string, FSMRuntime>;
  private registry: any; // ComponentRegistry

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST'],
      },
    });
    this.runtimes = new Map();
    this.registry = null;

    this.setupHandlers();
  }

  /**
   * Set component registry for broadcasting component list
   */
  setRegistry(registry: any): void {
    this.registry = registry;
  }

  /**
   * Register FSM runtime for WebSocket broadcasting
   */
  registerRuntime(componentName: string, runtime: FSMRuntime): void {
    this.runtimes.set(componentName, runtime);

    // Subscribe to state changes
    runtime.on('state_change', (data: StateChangeMessage) => {
      this.broadcastStateChange(componentName, data);
    });

    runtime.on('instance_created', (instance: any) => {
      this.io.to(`component:${componentName}`).emit('instance_created', instance);
    });

    runtime.on('instance_disposed', (instance: any) => {
      this.io.to(`component:${componentName}`).emit('instance_disposed', instance);
    });

    runtime.on('instance_error', (data: any) => {
      this.io.to(`component:${componentName}`).emit('instance_error', data);
    });

    runtime.on('guard_failed', (data: any) => {
      this.io.to(`component:${componentName}`).emit('guard_failed', data);
    });
  }

  /**
   * Setup WebSocket handlers
   */
  private setupHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);

      // Send components list immediately upon connection
      if (this.registry) {
        const components = this.registry.getAllComponents();
        socket.emit('components_list', { components });
      }

      // Subscribe to component events
      socket.on('subscribe_component', (componentName: string) => {
        socket.join(`component:${componentName}`);
        console.log(`Client ${socket.id} subscribed to component: ${componentName}`);
        socket.emit('subscribed', { componentName });
      });

      // Subscribe to specific instance
      socket.on('subscribe_instance', (data: { componentName: string; instanceId: string }) => {
        socket.join(`instance:${data.instanceId}`);
        console.log(`Client ${socket.id} subscribed to instance: ${data.instanceId}`);
        socket.emit('subscribed', { instanceId: data.instanceId });
      });

      // Unsubscribe
      socket.on('unsubscribe_component', (componentName: string) => {
        socket.leave(`component:${componentName}`);
        console.log(`Client ${socket.id} unsubscribed from component: ${componentName}`);
      });

      socket.on('unsubscribe_instance', (instanceId: string) => {
        socket.leave(`instance:${instanceId}`);
        console.log(`Client ${socket.id} unsubscribed from instance: ${instanceId}`);
      });

      // Get runtime info
      socket.on('get_runtime_info', (componentName: string, callback: Function) => {
        const runtime = this.runtimes.get(componentName);
        if (runtime) {
          const instances = runtime.getAllInstances();
          callback({
            success: true,
            data: {
              componentName,
              instanceCount: instances.length,
              instances,
            },
          });
        } else {
          callback({
            success: false,
            error: `Component ${componentName} not found`,
          });
        }
      });

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Broadcast state change to subscribers
   */
  private broadcastStateChange(componentName: string, data: StateChangeMessage): void {
    // Broadcast to component subscribers
    this.io.to(`component:${componentName}`).emit('state_change', data);

    // Broadcast to instance subscribers
    this.io.to(`instance:${data.instanceId}`).emit('state_change', data);
  }

  /**
   * Broadcast updated component list to all connected clients
   */
  broadcastComponentsList(): void {
    if (this.registry) {
      const components = this.registry.getAllComponents();
      this.io.emit('components_list', { components });
    }
  }

  /**
   * Get Socket.IO server instance
   */
  getIO(): SocketIOServer {
    return this.io;
  }
}
