/**
 * Dashboard Server API Tests
 *
 * Tests for the dashboard server REST API endpoints to prevent regressions
 * in the component and instance data formats.
 */

import { DashboardServer } from '../src/dashboard-server';
import { Component, StateType, TransitionType } from '../src/types';
import { InMemoryMessageBroker } from '../src/message-broker';

describe('DashboardServer API', () => {
  let server: DashboardServer;
  let broker: InMemoryMessageBroker;
  const testPort = 3099;

  // Sample component with contextSchema for testing
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
          { name: 'Completed', type: StateType.FINAL }
        ],
        transitions: [
          { from: 'Initial', to: 'Processing', event: 'START', type: TransitionType.TRIGGERABLE },
          { from: 'Processing', to: 'Completed', event: 'COMPLETE', type: TransitionType.TRIGGERABLE }
        ],
        contextSchema: {
          orderId: { type: 'text', label: 'Order ID', required: true },
          amount: { type: 'number', label: 'Amount', required: false }
        }
      }
    ]
  };

  beforeAll(async () => {
    broker = new InMemoryMessageBroker();
    await broker.connect();

    server = new DashboardServer('memory');

    await server.start(testPort);

    // Simulate runtime registration by directly adding component
    // @ts-ignore - accessing private member for testing
    server.components.set(testComponent.name, testComponent);
  });

  afterAll(async () => {
    await server.stop();
    await broker.disconnect();
  });

  describe('GET /api/components', () => {
    it('should return components with stateMachines', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/components`);
      const data = await response.json() as any;

      expect(response.ok).toBe(true);
      expect(data.components).toBeDefined();
      expect(data.components.length).toBeGreaterThan(0);

      const comp = data.components.find((c: any) => c.name === 'TestComponent');
      expect(comp).toBeDefined();
      expect(comp.stateMachines).toBeDefined();
      expect(comp.stateMachines.length).toBe(1);
    });

    it('should include contextSchema in stateMachines (regression test)', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/components`);
      const data = await response.json() as any;

      const comp = data.components.find((c: any) => c.name === 'TestComponent');
      const machine = comp.stateMachines[0];

      // This is the critical regression test - contextSchema must be present
      // Without it, the UI cannot display entry points or instance creation forms
      expect(machine.contextSchema).toBeDefined();
      expect(machine.contextSchema.orderId).toBeDefined();
      expect(machine.contextSchema.orderId.type).toBe('text');
      expect(machine.contextSchema.amount).toBeDefined();
      expect(machine.contextSchema.amount.type).toBe('number');
    });

    it('should include entryMachine in component', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/components`);
      const data = await response.json() as any;

      const comp = data.components.find((c: any) => c.name === 'TestComponent');
      expect(comp.entryMachine).toBe('TestMachine');
    });
  });

  describe('GET /api/instances', () => {
    beforeAll(() => {
      // Add test instances to cache
      // @ts-ignore - accessing private member for testing
      server.instanceCache.set('TestComponent', [
        {
          id: 'test-instance-1',
          instanceId: 'test-instance-1',
          machineName: 'TestMachine',
          currentState: 'Initial',
          context: { orderId: 'order-123', amount: 99.99 }
        },
        {
          id: 'test-instance-2',
          instanceId: 'test-instance-2',
          machineName: 'TestMachine',
          currentState: 'Processing',
          context: { orderId: 'order-456', amount: 50.00 }
        }
      ]);
    });

    it('should return all instances', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/instances`);
      const data = await response.json() as any;

      expect(response.ok).toBe(true);
      expect(data.instances).toBeDefined();
      expect(data.instances.length).toBe(2);
    });

    it('should include id field for UI compatibility (regression test)', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/instances`);
      const data = await response.json() as any;

      // The UI uses instance.id for lookups and display
      // This must be present for instances to appear in the UI
      data.instances.forEach((inst: any) => {
        expect(inst.id).toBeDefined();
        expect(inst.id).not.toBe('');
      });
    });

    it('should include componentName in instances', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/instances`);
      const data = await response.json() as any;

      data.instances.forEach((inst: any) => {
        expect(inst.componentName).toBe('TestComponent');
      });
    });

    it('should include machineName and currentState', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/instances`);
      const data = await response.json() as any;

      const inst = data.instances[0];
      expect(inst.machineName).toBe('TestMachine');
      expect(['Initial', 'Processing', 'Completed']).toContain(inst.currentState);
    });

    it('should include context data', async () => {
      const response = await fetch(`http://localhost:${testPort}/api/instances`);
      const data = await response.json() as any;

      const inst = data.instances.find((i: any) => i.id === 'test-instance-1');
      expect(inst.context).toBeDefined();
      expect(inst.context.orderId).toBe('order-123');
      expect(inst.context.amount).toBe(99.99);
    });
  });

  describe('POST /api/components/:name/instances/:id/events', () => {
    it('should accept { event: "NAME" } format', async () => {
      const response = await fetch(
        `http://localhost:${testPort}/api/components/TestComponent/instances/test-instance-1/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'START' })
        }
      );

      // Should not return 400 for missing event type
      expect(response.status).not.toBe(400);
    });

    it('should accept { type: "NAME" } format', async () => {
      const response = await fetch(
        `http://localhost:${testPort}/api/components/TestComponent/instances/test-instance-2/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'COMPLETE', payload: {} })
        }
      );

      // Should not return 400 for missing event type
      expect(response.status).not.toBe(400);
    });

    it('should return 400 if no event type provided', async () => {
      const response = await fetch(
        `http://localhost:${testPort}/api/components/TestComponent/instances/test-instance-1/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: { foo: 'bar' } })
        }
      );

      expect(response.status).toBe(400);
      const data = await response.json() as any;
      expect(data.error).toContain('Missing event type');
    });
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`);
      const data = await response.json() as any;

      expect(response.ok).toBe(true);
      expect(data.status).toBe('ok');
    });
  });
});
