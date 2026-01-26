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
    const event: PersistedEvent = {
      id: `test-${Date.now()}`,
      instanceId: 'instance-1',
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

    const events = await eventStore.getEventsForInstance('instance-1');
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].instanceId).toBe('instance-1');
  });

  test('should store and retrieve snapshots', async () => {
    const snapshot: InstanceSnapshot = {
      instance: {
        id: 'snapshot-instance-1',
        machineName: 'TestMachine',
        currentState: 'Processing',
        context: { value: 42 },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'active',
      },
      snapshotAt: Date.now(),
      lastEventId: 'event-1',
    };

    await snapshotStore.saveSnapshot(snapshot);

    const retrieved = await snapshotStore.getSnapshot('snapshot-instance-1');
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
  let eventStore: any;
  let snapshotStore: any;
  let runtime: FSMRuntime;
  let broadcaster: any;

  beforeAll(async () => {
    const { PostgresEventStore, PostgresSnapshotStore } = await import('../../src/postgres-persistence');
    const { RuntimeBroadcaster } = await import('../../src/runtime-broadcaster');

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

    runtime = new FSMRuntime(testComponent, {
      eventSourcing: true,
      snapshots: true,
      eventStore,
      snapshotStore,
    });

    broadcaster = new RuntimeBroadcaster(runtime, testComponent, {
      brokerUrl: 'amqp://test:test@localhost:5673',
    });

    await broadcaster.connect();
  });

  afterAll(async () => {
    await broadcaster?.disconnect();
    runtime?.dispose();
    await eventStore?.close();
    await snapshotStore?.close();
  });

  test('should complete full workflow with persistence and broadcasting', async () => {
    // Create instance
    const instanceId = runtime.createInstance('TestMachine', {
      orderId: 'order-' + Date.now(),
      amount: 100,
    });

    expect(instanceId).toBeDefined();

    // Trigger transitions
    await runtime.sendEvent(instanceId, {
      type: 'START',
      payload: { startedBy: 'integration-test' },
      timestamp: Date.now(),
    });

    let instance = runtime.getInstance(instanceId);
    expect(instance?.currentState).toBe('Processing');

    await runtime.sendEvent(instanceId, {
      type: 'COMPLETE',
      payload: { completedAt: Date.now() },
      timestamp: Date.now(),
    });

    // Instance should be disposed after reaching FINAL state
    instance = runtime.getInstance(instanceId);
    expect(instance).toBeUndefined();

    // Wait for persistence and broadcasting
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

    broker.subscribe(DashboardChannels.STATE_CHANGE, (msg: any) => {
      if (msg.componentName === 'OrderComponent') {
        expect(msg.data.newState).toBe('Confirmed');
        expect(msg.data.machineName).toBe('Order');
        done();
      }
    });

    // Create and transition an order
    const orderId = runtime1.createInstance('Order', { orderId: 'ORD-001' });
    runtime1.sendEvent(orderId, {
      type: 'CONFIRM',
      payload: { confirmedBy: 'test' },
      timestamp: Date.now(),
    });
  }, 10000);

  test('should receive state change events from Payment runtime', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');

    broker.subscribe(DashboardChannels.STATE_CHANGE, (msg: any) => {
      if (msg.componentName === 'PaymentComponent' && msg.data.newState === 'Processing') {
        expect(msg.data.machineName).toBe('Payment');
        done();
      }
    });

    // Create and transition a payment
    const paymentId = runtime2.createInstance('Payment', { amount: 100 });
    runtime2.sendEvent(paymentId, {
      type: 'PROCESS',
      payload: {},
      timestamp: Date.now(),
    });
  }, 10000);

  test('should receive instance created events', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');

    broker.subscribe(DashboardChannels.INSTANCE_CREATED, (msg: any) => {
      if (msg.componentName === 'OrderComponent') {
        expect(msg.data.machineName).toBe('Order');
        expect(msg.data.currentState).toBe('Created');
        done();
      }
    });

    // Create a new order
    runtime1.createInstance('Order', { orderId: 'ORD-NEW' });
  }, 10000);

  test('should receive instance completed events', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');

    broker.subscribe(DashboardChannels.INSTANCE_COMPLETED, (msg: any) => {
      if (msg.componentName === 'PaymentComponent') {
        expect(msg.data.finalState).toBe('Completed');
        done();
      }
    });

    // Create and complete a payment
    const paymentId = runtime2.createInstance('Payment', { amount: 50 });
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
  }, 10000);

  test('should handle query instances command', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');

    // Create some instances first
    runtime1.createInstance('Order', { orderId: 'ORD-Q1' });
    runtime1.createInstance('Order', { orderId: 'ORD-Q2' });

    // Subscribe to query response
    broker.subscribe(DashboardChannels.QUERY_RESPONSE, (msg: any) => {
      if (msg.componentName === 'OrderComponent' && msg.type === 'instances') {
        expect(Array.isArray(msg.instances)).toBe(true);
        expect(msg.instances.length).toBeGreaterThanOrEqual(2);
        done();
      }
    });

    // Send query
    setTimeout(() => {
      broker.publish(DashboardChannels.QUERY_INSTANCES, {
        type: 'query_all_instances',
        timestamp: Date.now(),
      });
    }, 100);
  }, 10000);

  test('should handle trigger event command', (done) => {
    const { DashboardChannels } = require('../../src/dashboard-server');

    // Create an order
    const orderId = runtime1.createInstance('Order', { orderId: 'ORD-TRIGGER' });

    // Listen for state change after trigger
    broker.subscribe(DashboardChannels.STATE_CHANGE, (msg: any) => {
      if (msg.componentName === 'OrderComponent' &&
          msg.data.instanceId === orderId &&
          msg.data.newState === 'Confirmed') {
        done();
      }
    });

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
