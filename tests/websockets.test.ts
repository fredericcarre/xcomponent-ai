/**
 * WebSocket Infrastructure Tests
 */

import { createServer } from 'http';
import { WebSocketManager } from '../src/websockets';
import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';

describe('WebSocketManager', () => {
  let httpServer: any;
  let wsManager: WebSocketManager;
  let clientSocket: ClientSocket;
  let runtime: FSMRuntime;

  const testComponent: Component = {
    name: 'TestComponent',
    version: '1.0.0',
    stateMachines: [
      {
        name: 'Test',
        initialState: 'Start',
        states: [
          { name: 'Start', type: StateType.ENTRY },
          { name: 'End', type: StateType.FINAL },
        ],
        transitions: [
          {
            from: 'Start',
            to: 'End',
            event: 'COMPLETE',
            type: TransitionType.REGULAR,
          },
        ],
      },
    ],
  };

  beforeEach((done) => {
    httpServer = createServer();
    wsManager = new WebSocketManager(httpServer);
    runtime = new FSMRuntime(testComponent);

    httpServer.listen(() => {
      const port = httpServer.address().port;
      clientSocket = ioClient(`http://localhost:${port}`);
      clientSocket.on('connect', done);
    });
  });

  afterEach(() => {
    clientSocket.close();
    httpServer.close();
  });

  describe('Connection', () => {
    it('should accept client connections', (done) => {
      expect(clientSocket.connected).toBe(true);
      done();
    });
  });

  describe('Component Subscription', () => {
    it('should subscribe to component events', (done) => {
      clientSocket.emit('subscribe_component', 'TestComponent');

      clientSocket.on('subscribed', (data) => {
        expect(data.componentName).toBe('TestComponent');
        done();
      });
    });

    it('should receive state change events', (done) => {
      wsManager.registerRuntime('TestComponent', runtime);

      clientSocket.emit('subscribe_component', 'TestComponent');

      clientSocket.on('state_change', (data) => {
        expect(data.instanceId).toBeDefined();
        expect(data.newState).toBe('End');
        done();
      });

      // Trigger state change after subscription
      setTimeout(async () => {
        const instanceId = runtime.createInstance('Test');
        await runtime.sendEvent(instanceId, {
          type: 'COMPLETE',
          payload: {},
          timestamp: Date.now(),
        });
      }, 100);
    }, 10000);
  });

  describe('Instance Subscription', () => {
    it('should subscribe to specific instance', (done) => {
      const instanceId = runtime.createInstance('Test');

      clientSocket.emit('subscribe_instance', {
        componentName: 'TestComponent',
        instanceId,
      });

      clientSocket.on('subscribed', (data) => {
        if (data.instanceId === instanceId) {
          expect(data.instanceId).toBe(instanceId);
          done();
        }
      });
    });
  });

  describe('Runtime Info', () => {
    it('should get runtime info', (done) => {
      wsManager.registerRuntime('TestComponent', runtime);
      runtime.createInstance('Test');

      clientSocket.emit('get_runtime_info', 'TestComponent', (response: any) => {
        expect(response.success).toBe(true);
        expect(response.data.componentName).toBe('TestComponent');
        expect(response.data.instanceCount).toBe(1);
        done();
      });
    });

    it('should handle non-existent component', (done) => {
      clientSocket.emit('get_runtime_info', 'NonExistent', (response: any) => {
        expect(response.success).toBe(false);
        expect(response.error).toBeDefined();
        done();
      });
    });
  });

  describe('Event Broadcasting', () => {
    it('should broadcast instance_created event', (done) => {
      wsManager.registerRuntime('TestComponent', runtime);

      clientSocket.emit('subscribe_component', 'TestComponent');

      clientSocket.on('instance_created', (data) => {
        expect(data.machineName).toBe('Test');
        expect(data.currentState).toBe('Start');
        done();
      });

      setTimeout(() => {
        runtime.createInstance('Test');
      }, 100);
    }, 10000);

    it('should broadcast instance_disposed event', (done) => {
      wsManager.registerRuntime('TestComponent', runtime);

      clientSocket.emit('subscribe_component', 'TestComponent');

      clientSocket.on('instance_disposed', (data) => {
        expect(data.machineName).toBe('Test');
        done();
      });

      setTimeout(async () => {
        const instanceId = runtime.createInstance('Test');
        await runtime.sendEvent(instanceId, {
          type: 'COMPLETE',
          payload: {},
          timestamp: Date.now(),
        });
      }, 100);
    }, 10000);
  });

  describe('Unsubscribe', () => {
    it('should unsubscribe from component', (done) => {
      clientSocket.emit('subscribe_component', 'TestComponent');

      setTimeout(() => {
        clientSocket.emit('unsubscribe_component', 'TestComponent');
        done();
      }, 100);
    });

    it('should unsubscribe from instance', (done) => {
      const instanceId = 'test-instance-1';

      clientSocket.emit('subscribe_instance', {
        componentName: 'TestComponent',
        instanceId,
      });

      setTimeout(() => {
        clientSocket.emit('unsubscribe_instance', instanceId);
        done();
      }, 100);
    });
  });
});
