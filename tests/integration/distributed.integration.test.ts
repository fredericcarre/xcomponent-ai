/**
 * Integration tests for distributed infrastructure
 *
 * Run with:
 *   docker-compose -f tests/integration/docker-compose.yml up -d
 *   npm run test:integration
 *
 * Or using make:
 *   make test-integration
 */

import { randomUUID } from 'crypto';
import { FSMRuntime } from '../../src/fsm-runtime';
import { Component, StateType, TransitionType, PersistedEvent, InstanceSnapshot } from '../../src/types';

// Skip these tests if not in integration mode
const INTEGRATION_MODE = process.env.INTEGRATION_TEST === 'true';
const describeIntegration = INTEGRATION_MODE ? describe : describe.skip;

const testComponent: Component = {
  name: 'IntegrationTestComponent',
  version: '1.0.0',
  entryMachine: 'TestMachine',
  stateMachines: [
    {
      name: 'TestMachine',
      initialState: 'Initial',
      states: [
        { name: 'Initial', type: StateType.ENTRY },
        { name: 'Processing', type: StateType.REGULAR },
        { name: 'Completed', type: StateType.FINAL },
      ],
      transitions: [
        { from: 'Initial', to: 'Processing', event: 'START', type: TransitionType.REGULAR },
        { from: 'Processing', to: 'Completed', event: 'COMPLETE', type: TransitionType.REGULAR },
      ],
    },
  ],
};

describeIntegration('PostgreSQL Integration', () => {
  let eventStore: any;
  let snapshotStore: any;

  beforeAll(async () => {
    const { PostgresEventStore, PostgresSnapshotStore } = await import('../../src/postgres-persistence');

    eventStore = new PostgresEventStore({
      host: 'localhost',
      port: 5433,
      database: 'xcomponent_test',
      user: 'test',
      password: 'test',
    });

    snapshotStore = new PostgresSnapshotStore({
      host: 'localhost',
      port: 5433,
      database: 'xcomponent_test',
      user: 'test',
      password: 'test',
    });

    await eventStore.initialize();
    await snapshotStore.initialize();
  });

  afterAll(async () => {
    await eventStore?.close();
    await snapshotStore?.close();
  });

  test('should store and retrieve events', async () => {
    const instanceId = randomUUID();
    const event: PersistedEvent = {
      id: randomUUID(),
      instanceId,
      machineName: 'TestMachine',
      componentName: 'TestComponent',
      event: {
        type: 'TEST_EVENT',
        payload: { data: 'test' },
        timestamp: Date.now(),
      },
      stateBefore: 'Initial',
      stateAfter: 'Processing',
      persistedAt: Date.now(),
    };

    await eventStore.append(event);

    const events = await eventStore.getEventsForInstance(instanceId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].instanceId).toBe(instanceId);
  });

  test('should store and retrieve snapshots', async () => {
    const instanceId = randomUUID();
    const snapshot: InstanceSnapshot = {
      instance: {
        id: instanceId,
        machineName: 'TestMachine',
        currentState: 'Processing',
        context: { value: 42 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      },
      snapshotAt: Date.now(),
      lastEventId: randomUUID(),
    };

    await snapshotStore.saveSnapshot(snapshot);

    const retrieved = await snapshotStore.getSnapshot(instanceId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.instance.currentState).toBe('Processing');
  });
});

describeIntegration('RabbitMQ Integration', () => {
  let broker: any;

  beforeAll(async () => {
    const { RabbitMQMessageBroker } = await import('../../src/message-broker');
    broker = new RabbitMQMessageBroker('amqp://test:test@localhost:5673');
    await broker.connect();
  });

  afterAll(async () => {
    await broker?.disconnect();
  });

  test('should connect to RabbitMQ', () => {
    expect(broker.isConnected()).toBe(true);
  });

  test('should publish and subscribe to messages', (done) => {
    const testMessage = {
      type: 'test',
      data: { value: Math.random() },
    };

    broker.subscribe('test:integration:channel', (received: any) => {
      expect(received.type).toBe('test');
      expect(received.data.value).toBe(testMessage.data.value);
      done();
    });

    // Small delay to ensure subscription is ready
    setTimeout(() => {
      broker.publish('test:integration:channel', testMessage);
    }, 100);
  }, 10000);
});

describeIntegration('Redis Integration', () => {
  let broker: any;

  beforeAll(async () => {
    const { RedisMessageBroker } = await import('../../src/message-broker');
    broker = new RedisMessageBroker('redis://localhost:6380');
    await broker.connect();
  });

  afterAll(async () => {
    await broker?.disconnect();
  });

  test('should connect to Redis', () => {
    expect(broker.isConnected()).toBe(true);
  });

  test('should publish messages', async () => {
    await expect(
      broker.publish('xcomponent:test', {
        sourceComponent: 'A',
        targetComponent: 'B',
        targetMachine: 'M',
        targetState: 'S',
        event: { type: 'E', payload: {}, timestamp: Date.now() },
      })
    ).resolves.not.toThrow();
  });
});

describeIntegration('RuntimeBroadcaster with RabbitMQ', () => {
  let runtime: FSMRuntime;
  let broadcaster: any;

  beforeAll(async () => {
    const { RuntimeBroadcaster } = await import('../../src/runtime-broadcaster');

    runtime = new FSMRuntime(testComponent);
    broadcaster = new RuntimeBroadcaster(runtime, testComponent, {
      brokerUrl: 'amqp://test:test@localhost:5673',
      host: 'localhost',
      port: 3001,
    });

    await broadcaster.connect();
  });

  afterAll(async () => {
    await broadcaster?.disconnect();
    runtime?.dispose();
  });

  test('should broadcast instance creation', async () => {
    const instanceId = runtime.createInstance('TestMachine', { testValue: 123 });
    expect(instanceId).toBeDefined();

    // Wait for async broadcast
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  test('should broadcast state changes', async () => {
    const instanceId = runtime.createInstance('TestMachine', {});

    await runtime.sendEvent(instanceId, {
      type: 'START',
      payload: {},
      timestamp: Date.now(),
    });

    const instance = runtime.getInstance(instanceId);
    expect(instance?.currentState).toBe('Processing');

    // Wait for async broadcast
    await new Promise(resolve => setTimeout(resolve, 100));
  });
});

describeIntegration('Full Distributed Workflow', () => {
  let runtime: FSMRuntime;
  let broadcaster: any;

  beforeAll(async () => {
    const { RuntimeBroadcaster } = await import('../../src/runtime-broadcaster');

    // Use runtime without event sourcing for simpler workflow test
    runtime = new FSMRuntime(testComponent);

    broadcaster = new RuntimeBroadcaster(runtime, testComponent, {
      brokerUrl: 'amqp://test:test@localhost:5673',
    });

    await broadcaster.connect();
  });

  afterAll(async () => {
    await broadcaster?.disconnect();
    runtime?.dispose();
  });

  test('should complete full workflow with broadcasting', async () => {
    // Create instance
    const instanceId = runtime.createInstance('TestMachine', {
      orderId: 'order-' + Date.now(),
      amount: 100,
    });

    expect(instanceId).toBeDefined();

    // Check initial state
    let instance = runtime.getInstance(instanceId);
    expect(instance?.currentState).toBe('Initial');

    // Trigger transitions
    await runtime.sendEvent(instanceId, {
      type: 'START',
      payload: { startedBy: 'integration-test' },
      timestamp: Date.now(),
    });

    instance = runtime.getInstance(instanceId);
    expect(instance?.currentState).toBe('Processing');

    await runtime.sendEvent(instanceId, {
      type: 'COMPLETE',
      payload: { completedAt: Date.now() },
      timestamp: Date.now(),
    });

    // Instance should be disposed after reaching FINAL state
    instance = runtime.getInstance(instanceId);
    expect(instance).toBeUndefined();

    // Wait for broadcasting
    await new Promise(resolve => setTimeout(resolve, 200));
  });
});

describeIntegration('Multi-Runtime Communication', () => {
  let broker: any;
  let runtime1: FSMRuntime;
  let runtime2: FSMRuntime;
  let broadcaster1: any;
  let broadcaster2: any;

  const orderComponent: Component = {
    name: 'OrderComponent',
    version: '1.0.0',
    entryMachine: 'Order',
    stateMachines: [
      {
        name: 'Order',
        initialState: 'Created',
        states: [
          { name: 'Created', type: StateType.ENTRY },
          { name: 'Confirmed', type: StateType.REGULAR },
          { name: 'Shipped', type: StateType.FINAL },
        ],
        transitions: [
          { from: 'Created', to: 'Confirmed', event: 'CONFIRM', type: TransitionType.REGULAR },
          { from: 'Confirmed', to: 'Shipped', event: 'SHIP', type: TransitionType.REGULAR },
        ],
      },
    ],
  };

  const paymentComponent: Component = {
    name: 'PaymentComponent',
    version: '1.0.0',
    entryMachine: 'Payment',
    stateMachines: [
      {
        name: 'Payment',
        initialState: 'Pending',
        states: [
          { name: 'Pending', type: StateType.ENTRY },
          { name: 'Processing', type: StateType.REGULAR },
          { name: 'Completed', type: StateType.FINAL },
        ],
        transitions: [
          { from: 'Pending', to: 'Processing', event: 'PROCESS', type: TransitionType.REGULAR },
          { from: 'Processing', to: 'Completed', event: 'COMPLETE', type: TransitionType.REGULAR },
        ],
      },
    ],
  };

  beforeAll(async () => {
    const { RabbitMQMessageBroker } = await import('../../src/message-broker');
    const { RuntimeBroadcaster } = await import('../../src/runtime-broadcaster');

    // Create shared broker for dashboard
    broker = new RabbitMQMessageBroker('amqp://test:test@localhost:5673');
    await broker.connect();

    // Create two separate runtimes with their broadcasters
    runtime1 = new FSMRuntime(orderComponent);
    runtime2 = new FSMRuntime(paymentComponent);

    broadcaster1 = new RuntimeBroadcaster(runtime1, orderComponent, {
      brokerUrl: 'amqp://test:test@localhost:5673',
      host: 'localhost',
      port: 3001,
    });

    broadcaster2 = new RuntimeBroadcaster(runtime2, paymentComponent, {
      brokerUrl: 'amqp://test:test@localhost:5673',
      host: 'localhost',
      port: 3002,
    });

    await broadcaster1.connect();
    await broadcaster2.connect();
  });

  afterAll(async () => {
    await broadcaster1?.disconnect();
    await broadcaster2?.disconnect();
    runtime1?.dispose();
    runtime2?.dispose();
    await broker?.disconnect();
  });

  test('should receive runtime announcements', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');

    // Subscribe to announcements
    broker.subscribe(DashboardChannels.RUNTIME_ANNOUNCE, (msg: any) => {
      expect(msg.componentName).toBeDefined();
      expect(msg.runtimeId).toBeDefined();
      done();
    });

    // Re-announce runtime1
    broadcaster1.disconnect().then(() => broadcaster1.connect());
  }, 15000);

  test('should receive state change events from Order runtime', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');
    let completed = false;
    const testOrderId = `ORD-${Date.now()}`;

    broker.subscribe(DashboardChannels.STATE_CHANGE, (msg: any) => {
      if (!completed && msg.componentName === 'OrderComponent' &&
          msg.data.context?.orderId === testOrderId) {
        completed = true;
        expect(msg.data.newState).toBe('Confirmed');
        expect(msg.data.machineName).toBe('Order');
        done();
      }
    }).then(() => {
      // Create and transition an order after subscription is ready
      const orderId = runtime1.createInstance('Order', { orderId: testOrderId });
      runtime1.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: { confirmedBy: 'test' },
        timestamp: Date.now(),
      });
    });
  }, 10000);

  test('should receive state change events from Payment runtime', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');
    let completed = false;
    const testAmount = Date.now();

    broker.subscribe(DashboardChannels.STATE_CHANGE, (msg: any) => {
      if (!completed && msg.componentName === 'PaymentComponent' &&
          msg.data.newState === 'Processing' &&
          msg.data.context?.amount === testAmount) {
        completed = true;
        expect(msg.data.machineName).toBe('Payment');
        done();
      }
    }).then(() => {
      // Create and transition a payment after subscription is ready
      const paymentId = runtime2.createInstance('Payment', { amount: testAmount });
      runtime2.sendEvent(paymentId, {
        type: 'PROCESS',
        payload: {},
        timestamp: Date.now(),
      });
    });
  }, 10000);

  test('should receive instance created events', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');
    let completed = false;
    const testOrderId = `ORD-NEW-${Date.now()}`;

    broker.subscribe(DashboardChannels.INSTANCE_CREATED, (msg: any) => {
      if (!completed && msg.componentName === 'OrderComponent' &&
          msg.data.context?.orderId === testOrderId) {
        completed = true;
        expect(msg.data.machineName).toBe('Order');
        expect(msg.data.currentState).toBe('Created');
        done();
      }
    }).then(() => {
      // Create a new order after subscription is ready
      runtime1.createInstance('Order', { orderId: testOrderId });
    });
  }, 10000);

  test('should receive instance completed events', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');
    let completed = false;
    const testAmount = Date.now();

    broker.subscribe(DashboardChannels.INSTANCE_COMPLETED, (msg: any) => {
      if (!completed && msg.componentName === 'PaymentComponent' &&
          msg.data.context?.amount === testAmount) {
        completed = true;
        expect(msg.data.finalState).toBe('Completed');
        done();
      }
    }).then(() => {
      // Create and complete a payment after subscription is ready
      const paymentId = runtime2.createInstance('Payment', { amount: testAmount });
      runtime2.sendEvent(paymentId, {
        type: 'PROCESS',
        payload: {},
        timestamp: Date.now(),
      }).then(() => {
        return runtime2.sendEvent(paymentId, {
          type: 'COMPLETE',
          payload: {},
          timestamp: Date.now(),
        });
      });
    });
  }, 10000);

  test('should handle query instances command', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');
    let completed = false;

    // Create some instances first
    runtime1.createInstance('Order', { orderId: 'ORD-Q1' });
    runtime1.createInstance('Order', { orderId: 'ORD-Q2' });

    // Subscribe to query response
    broker.subscribe(DashboardChannels.QUERY_RESPONSE, (msg: any) => {
      if (!completed && msg.componentName === 'OrderComponent' && msg.type === 'instances') {
        completed = true;
        expect(Array.isArray(msg.instances)).toBe(true);
        expect(msg.instances.length).toBeGreaterThanOrEqual(2);
        done();
      }
    }).then(() => {
      // Send query after subscription is ready
      broker.publish(DashboardChannels.QUERY_INSTANCES, {
        type: 'query_all_instances',
        timestamp: Date.now(),
      });
    });
  }, 10000);

  test('should handle trigger event command', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');
    let completed = false;
    const testOrderId = `ORD-TRIGGER-${Date.now()}`;
    let orderId: string;

    broker.subscribe(DashboardChannels.STATE_CHANGE, (msg: any) => {
      if (!completed && msg.componentName === 'OrderComponent' &&
          msg.data.instanceId === orderId &&
          msg.data.newState === 'Confirmed') {
        completed = true;
        done();
      }
    }).then(() => {
      // Create an order after subscription is ready
      orderId = runtime1.createInstance('Order', { orderId: testOrderId });

      // Send trigger command via broker
      setTimeout(() => {
        broker.publish(DashboardChannels.TRIGGER_EVENT, {
          instanceId: orderId,
          event: {
            type: 'CONFIRM',
            payload: { triggeredVia: 'broker' },
            timestamp: Date.now(),
          },
        });
      }, 100);
    });
  }, 10000);
});

// Non-integration tests that always run
describe('Integration Test Configuration', () => {
  test('INTEGRATION_TEST env var controls test execution', () => {
    if (INTEGRATION_MODE) {
      console.log('Running in integration mode');
    } else {
      console.log('Skipping integration tests (set INTEGRATION_TEST=true to enable)');
    }
    expect(true).toBe(true);
  });
});
