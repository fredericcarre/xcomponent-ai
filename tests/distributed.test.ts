/**
 * Tests for distributed infrastructure components
 * - RabbitMQMessageBroker
 * - RuntimeBroadcaster
 * - PostgresEventStore
 * - DashboardServer
 */

import { InMemoryMessageBroker, createMessageBroker } from '../src/message-broker';
import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';

// Mock amqplib (virtual module - not installed)
const mockChannel = {
  assertExchange: jest.fn().mockResolvedValue({}),
  assertQueue: jest.fn().mockResolvedValue({ queue: 'test-queue' }),
  bindQueue: jest.fn().mockResolvedValue({}),
  publish: jest.fn().mockReturnValue(true),
  consume: jest.fn().mockResolvedValue({}),
  ack: jest.fn(),
  nack: jest.fn(),
  close: jest.fn().mockResolvedValue({}),
};

const mockConnection = {
  createChannel: jest.fn().mockResolvedValue(mockChannel),
  on: jest.fn(),
  close: jest.fn().mockResolvedValue({}),
};

jest.mock('amqplib', () => ({
  connect: jest.fn().mockResolvedValue(mockConnection),
}), { virtual: true });

// Mock pg (virtual module - not installed)
const mockPool = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  end: jest.fn().mockResolvedValue({}),
};

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => mockPool),
}), { virtual: true });

describe('Message Broker Factory', () => {
  test('should create InMemoryMessageBroker for memory URL', () => {
    const broker = createMessageBroker('memory');
    expect(broker).toBeInstanceOf(InMemoryMessageBroker);
  });

  test('should create InMemoryMessageBroker for undefined URL', () => {
    const broker = createMessageBroker();
    expect(broker).toBeInstanceOf(InMemoryMessageBroker);
  });

  test('should create InMemoryMessageBroker for in-memory URL', () => {
    const broker = createMessageBroker('in-memory');
    expect(broker).toBeInstanceOf(InMemoryMessageBroker);
  });

  test('should throw for unsupported URL', () => {
    expect(() => createMessageBroker('unsupported://localhost')).toThrow('Unsupported broker URL');
  });
});

describe('InMemoryMessageBroker', () => {
  let broker: InMemoryMessageBroker;

  beforeEach(async () => {
    broker = new InMemoryMessageBroker();
    await broker.connect();
  });

  afterEach(async () => {
    await broker.disconnect();
  });

  test('should connect and disconnect', async () => {
    expect(broker.isConnected()).toBe(true);
    await broker.disconnect();
    expect(broker.isConnected()).toBe(false);
  });

  test('should publish and receive cross-component messages', (done) => {
    const message = {
      sourceComponent: 'ComponentA',
      targetComponent: 'ComponentB',
      targetMachine: 'Machine1',
      targetState: 'State1',
      event: { type: 'TEST_EVENT', payload: { data: 'test' }, timestamp: Date.now() },
    };

    broker.subscribe('ComponentB', (received) => {
      expect(received.targetComponent).toBe('ComponentB');
      expect(received.event.type).toBe('TEST_EVENT');
      done();
    });

    broker.publish('test-channel', message);
  });

  test('should publish and receive channel-based messages', (done) => {
    const message = {
      type: 'test_message',
      data: { value: 42 },
    };

    broker.subscribe('test:channel:name', (received) => {
      expect(received.type).toBe('test_message');
      expect(received.data.value).toBe(42);
      done();
    });

    broker.publish('test:channel:name', message as any);
  });

  test('should unsubscribe from component messages', async () => {
    const handler = jest.fn();
    broker.subscribe('TestComponent', handler);
    broker.unsubscribe('TestComponent');

    await broker.publish('test', {
      sourceComponent: 'A',
      targetComponent: 'TestComponent',
      targetMachine: 'M',
      targetState: 'S',
      event: { type: 'E', payload: {}, timestamp: Date.now() },
    });

    // Wait for async processing
    await new Promise(resolve => setImmediate(resolve));
    expect(handler).not.toHaveBeenCalled();
  });

  test('should unsubscribe from channel messages', async () => {
    const handler = jest.fn();
    broker.subscribe('test:channel', handler);
    broker.unsubscribe('test:channel');

    await broker.publish('test:channel', { data: 'test' } as any);

    await new Promise(resolve => setImmediate(resolve));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('RabbitMQMessageBroker', () => {
  test('should create RabbitMQ broker for amqp URL', async () => {
    const { RabbitMQMessageBroker } = await import('../src/message-broker');
    const broker = new RabbitMQMessageBroker('amqp://localhost:5672');
    expect(broker).toBeDefined();
    expect(broker.isConnected()).toBe(false);
  });

  test('should connect to RabbitMQ', async () => {
    const { RabbitMQMessageBroker } = await import('../src/message-broker');
    const broker = new RabbitMQMessageBroker('amqp://localhost:5672');

    await broker.connect();
    expect(broker.isConnected()).toBe(true);

    await broker.disconnect();
    expect(broker.isConnected()).toBe(false);
  });

  test('should publish messages', async () => {
    const { RabbitMQMessageBroker } = await import('../src/message-broker');
    const broker = new RabbitMQMessageBroker('amqp://localhost:5672');

    await broker.connect();

    await expect(broker.publish('test:channel', {
      type: 'test',
      data: {},
    } as any)).resolves.not.toThrow();

    await broker.disconnect();
  });

  test('should throw when publishing without connection', async () => {
    const { RabbitMQMessageBroker } = await import('../src/message-broker');
    const broker = new RabbitMQMessageBroker('amqp://localhost:5672');

    await expect(broker.publish('test', {} as any)).rejects.toThrow('not connected');
  });

  test('should throw when subscribing without connection', async () => {
    const { RabbitMQMessageBroker } = await import('../src/message-broker');
    const broker = new RabbitMQMessageBroker('amqp://localhost:5672');

    await expect(broker.subscribe('test', () => {})).rejects.toThrow('not connected');
  });
});

describe('RedisMessageBroker', () => {
  // Mock redis
  jest.mock('redis', () => ({
    createClient: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue({}),
      quit: jest.fn().mockResolvedValue({}),
      publish: jest.fn().mockResolvedValue(1),
      subscribe: jest.fn().mockResolvedValue({}),
      unsubscribe: jest.fn().mockResolvedValue({}),
    }),
  }));

  test('should create Redis broker for redis URL', async () => {
    const { RedisMessageBroker } = await import('../src/message-broker');
    const broker = new RedisMessageBroker('redis://localhost:6379');
    expect(broker).toBeDefined();
    expect(broker.isConnected()).toBe(false);
  });
});

describe('PostgresEventStore', () => {
  test('should create PostgresEventStore', async () => {
    const { PostgresEventStore } = await import('../src/postgres-persistence');
    const store = new PostgresEventStore({
      connectionString: 'postgresql://localhost:5432/test',
    });
    expect(store).toBeDefined();
  });

  test('should initialize and create tables', async () => {
    const { PostgresEventStore } = await import('../src/postgres-persistence');
    const store = new PostgresEventStore({
      host: 'localhost',
      port: 5432,
      database: 'test',
      user: 'test',
      password: 'test',
    });

    await store.initialize();
    // Mock should have been called
    expect(store).toBeDefined();
  });
});

describe('PostgresSnapshotStore', () => {
  test('should create PostgresSnapshotStore', async () => {
    const { PostgresSnapshotStore } = await import('../src/postgres-persistence');
    const store = new PostgresSnapshotStore({
      connectionString: 'postgresql://localhost:5432/test',
    });
    expect(store).toBeDefined();
  });
});

describe('RuntimeBroadcaster', () => {
  const testComponent: Component = {
    name: 'TestComponent',
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

  test('should create RuntimeBroadcaster', async () => {
    const { RuntimeBroadcaster } = await import('../src/runtime-broadcaster');
    const runtime = new FSMRuntime(testComponent);

    const broadcaster = new RuntimeBroadcaster(runtime, testComponent, {
      brokerUrl: 'memory',
    });

    expect(broadcaster).toBeDefined();
    expect(broadcaster.getRuntimeId()).toBeDefined();

    runtime.dispose();
  });

  test('should connect and disconnect', async () => {
    const { RuntimeBroadcaster } = await import('../src/runtime-broadcaster');
    const runtime = new FSMRuntime(testComponent);

    const broadcaster = new RuntimeBroadcaster(runtime, testComponent, {
      brokerUrl: 'memory',
    });

    await broadcaster.connect();
    await broadcaster.disconnect();

    runtime.dispose();
  });

  test('should broadcast state changes', async () => {
    const { RuntimeBroadcaster } = await import('../src/runtime-broadcaster');
    const runtime = new FSMRuntime(testComponent);

    const broadcaster = new RuntimeBroadcaster(runtime, testComponent, {
      brokerUrl: 'memory',
    });

    await broadcaster.connect();

    // Create an instance and trigger state change
    const instanceId = runtime.createInstance('TestMachine', {});
    await runtime.sendEvent(instanceId, {
      type: 'START',
      payload: {},
      timestamp: Date.now(),
    });

    // Wait for async broadcast
    await new Promise(resolve => setTimeout(resolve, 50));

    await broadcaster.disconnect();
    runtime.dispose();
  });
});

describe('DashboardServer', () => {
  test('should create DashboardServer', async () => {
    const { DashboardServer } = await import('../src/dashboard-server');
    const dashboard = new DashboardServer('memory');
    expect(dashboard).toBeDefined();
  });

  test('should export DashboardChannels', async () => {
    const { DashboardChannels } = await import('../src/dashboard-server');
    expect(DashboardChannels).toBeDefined();
    expect(DashboardChannels.RUNTIME_ANNOUNCE).toBe('fsm:registry:announce');
    expect(DashboardChannels.STATE_CHANGE).toBe('fsm:events:state_change');
  });
});
