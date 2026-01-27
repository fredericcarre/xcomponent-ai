/**
 * Distributed Dashboard Integration Test
 *
 * Tests the full distributed flow:
 * - Dashboard receives instance data from runtimes via message broker
 * - REST API returns instances correctly
 * - WebSocket pushes updates to clients
 *
 * This test uses in-memory broker to test the integration without Docker.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { DashboardServer } from '../src/dashboard-server';
import { FSMRuntime } from '../src/fsm-runtime';
import { RuntimeBroadcaster } from '../src/runtime-broadcaster';
import { InMemoryMessageBroker } from '../src/message-broker';
import { Component } from '../src/types';

// Helper to wait for a condition
async function waitFor(
  condition: () => Promise<boolean>,
  description: string,
  timeoutMs: number = 5000,
  pollMs: number = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timeout waiting for: ${description}`);
}

describe('Distributed Dashboard Integration', () => {
  let dashboard: DashboardServer;
  let orderRuntime: FSMRuntime;
  let orderBroadcaster: RuntimeBroadcaster;
  let orderComponent: Component;
  const dashboardPort = 3098;
  const dashboardUrl = `http://localhost:${dashboardPort}`;

  beforeAll(async () => {
    // Reset the singleton broker to ensure clean state
    InMemoryMessageBroker.resetInstance();

    // Load Order component from YAML
    const orderYaml = fs.readFileSync(
      path.join(__dirname, '../examples/distributed/order-component.yaml'),
      'utf-8'
    );
    orderComponent = yaml.parse(orderYaml) as Component;

    // Start dashboard with in-memory broker
    dashboard = new DashboardServer('memory');
    await dashboard.start(dashboardPort);

    // Create runtime and broadcaster
    orderRuntime = new FSMRuntime(orderComponent);
    orderBroadcaster = new RuntimeBroadcaster(orderRuntime, orderComponent, {
      brokerUrl: 'memory'
    });
    await orderBroadcaster.connect();

    // Wait for runtime to announce itself
    await new Promise(resolve => setTimeout(resolve, 200));
  });

  afterAll(async () => {
    await orderBroadcaster.disconnect();
    await dashboard.stop();
    InMemoryMessageBroker.resetInstance();
  });

  describe('Runtime Registration', () => {
    it('should register runtime with dashboard', async () => {
      const response = await fetch(`${dashboardUrl}/api/runtimes`);
      const data = await response.json() as any;

      expect(response.ok).toBe(true);
      expect(data.runtimes).toBeDefined();
      expect(data.runtimes.length).toBeGreaterThanOrEqual(1);
    });

    it('should register component with dashboard', async () => {
      const response = await fetch(`${dashboardUrl}/api/components`);
      const data = await response.json() as any;

      expect(response.ok).toBe(true);
      expect(data.components).toBeDefined();

      const orderComp = data.components.find((c: any) => c.name === 'OrderComponent');
      expect(orderComp).toBeDefined();
      expect(orderComp.stateMachines).toBeDefined();
    });
  });

  describe('Instance Creation and Retrieval', () => {
    let instanceId: string;
    const orderId = `test-order-${Date.now()}`;

    it('should create instance via runtime and retrieve via dashboard API', async () => {
      // Create instance directly on runtime
      instanceId = orderRuntime.createInstance('Order', {
        orderId,
        amount: 50,
        customerId: 'test-customer'
      });

      expect(instanceId).toBeDefined();

      // Wait for instance to propagate to dashboard
      await waitFor(
        async () => {
          const response = await fetch(`${dashboardUrl}/api/instances`);
          const data = await response.json() as any;
          const instance = data.instances?.find(
            (i: any) => (i.id === instanceId || i.instanceId === instanceId)
          );
          return instance !== undefined;
        },
        'Instance appears in dashboard API',
        3000
      );

      // Verify instance data
      const response = await fetch(`${dashboardUrl}/api/instances`);
      const data = await response.json() as any;
      const instance = data.instances.find(
        (i: any) => (i.id === instanceId || i.instanceId === instanceId)
      );

      expect(instance).toBeDefined();
      expect(instance.componentName).toBe('OrderComponent');
      expect(instance.machineName).toBe('Order');
      expect(instance.currentState).toBe('Created');
      expect(instance.context?.orderId).toBe(orderId);
    });

    it('should update instance state when event is sent', async () => {
      // Send event directly to runtime
      await orderRuntime.sendEvent(instanceId, {
        type: 'SUBMIT',
        payload: {},
        timestamp: Date.now()
      });

      // Wait for state change to propagate
      await waitFor(
        async () => {
          const response = await fetch(`${dashboardUrl}/api/instances`);
          const data = await response.json() as any;
          const instance = data.instances?.find(
            (i: any) => (i.id === instanceId || i.instanceId === instanceId)
          );
          return instance?.currentState === 'PendingPayment';
        },
        'Instance state updates to PendingPayment',
        3000
      );

      const response = await fetch(`${dashboardUrl}/api/instances`);
      const data = await response.json() as any;
      const instance = data.instances.find(
        (i: any) => (i.id === instanceId || i.instanceId === instanceId)
      );

      expect(instance.currentState).toBe('PendingPayment');
    });

    it('should create instance via dashboard API command', async () => {
      const newOrderId = `api-order-${Date.now()}`;

      // Create instance via dashboard REST API
      const createResponse = await fetch(
        `${dashboardUrl}/api/components/OrderComponent/instances`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            machineName: 'Order',
            context: {
              orderId: newOrderId,
              amount: 75,
              customerId: 'api-customer'
            }
          })
        }
      );

      expect(createResponse.ok).toBe(true);

      // Wait for instance to be created via message broker
      await waitFor(
        async () => {
          const response = await fetch(`${dashboardUrl}/api/instances`);
          const data = await response.json() as any;
          const instance = data.instances?.find(
            (i: any) => i.context?.orderId === newOrderId
          );
          return instance !== undefined;
        },
        'Instance created via API appears in dashboard',
        3000
      );

      const response = await fetch(`${dashboardUrl}/api/instances`);
      const data = await response.json() as any;
      const instance = data.instances.find(
        (i: any) => i.context?.orderId === newOrderId
      );

      expect(instance).toBeDefined();
      expect(instance.machineName).toBe('Order');
      expect(instance.currentState).toBe('Created');
    });

    it('should trigger event via dashboard API', async () => {
      // Find the instance we created in previous test
      let response = await fetch(`${dashboardUrl}/api/instances`);
      let data = await response.json() as any;
      const apiInstance = data.instances.find(
        (i: any) => i.context?.customerId === 'api-customer'
      );

      expect(apiInstance).toBeDefined();
      const apiInstanceId = apiInstance.id || apiInstance.instanceId;

      // Trigger event via dashboard API
      const triggerResponse = await fetch(
        `${dashboardUrl}/api/components/OrderComponent/instances/${apiInstanceId}/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'SUBMIT' })
        }
      );

      expect(triggerResponse.ok).toBe(true);

      // Wait for state change
      await waitFor(
        async () => {
          const resp = await fetch(`${dashboardUrl}/api/instances`);
          const d = await resp.json() as any;
          const inst = d.instances?.find(
            (i: any) => (i.id === apiInstanceId || i.instanceId === apiInstanceId)
          );
          return inst?.currentState === 'PendingPayment';
        },
        'Instance triggered via API transitions to PendingPayment',
        3000
      );
    });
  });

  describe('Multiple Instances', () => {
    it('should track multiple instances correctly', async () => {
      // Create multiple instances
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const id = orderRuntime.createInstance('Order', {
          orderId: `multi-${Date.now()}-${i}`,
          amount: 100 + i,
          customerId: `multi-customer-${i}`
        });
        ids.push(id);
      }

      // Wait for all instances to appear
      await waitFor(
        async () => {
          const response = await fetch(`${dashboardUrl}/api/instances`);
          const data = await response.json() as any;
          const found = ids.filter(id =>
            data.instances?.some((i: any) => i.id === id || i.instanceId === id)
          );
          return found.length === ids.length;
        },
        'All 3 instances appear in dashboard',
        3000
      );

      const response = await fetch(`${dashboardUrl}/api/instances`);
      const data = await response.json() as any;

      for (const id of ids) {
        const instance = data.instances.find(
          (i: any) => i.id === id || i.instanceId === id
        );
        expect(instance).toBeDefined();
        expect(instance.componentName).toBe('OrderComponent');
      }
    });
  });
});

/**
 * Test scenario where runtimes start before dashboard
 * This simulates the real-world case where runtimes are already running
 * when the dashboard connects
 */
describe('Distributed Dashboard - Late Dashboard Start', () => {
  let dashboard: DashboardServer;
  let orderRuntime: FSMRuntime;
  let orderBroadcaster: RuntimeBroadcaster;
  let orderComponent: Component;
  const dashboardPort = 3097;
  const dashboardUrl = `http://localhost:${dashboardPort}`;
  let preExistingInstanceId: string;
  const preExistingOrderId = `pre-existing-${Date.now()}`;

  beforeAll(async () => {
    // Reset the singleton broker
    InMemoryMessageBroker.resetInstance();

    // Load component
    const orderYaml = fs.readFileSync(
      path.join(__dirname, '../examples/distributed/order-component.yaml'),
      'utf-8'
    );
    orderComponent = yaml.parse(orderYaml) as Component;

    // Start runtime FIRST (before dashboard)
    orderRuntime = new FSMRuntime(orderComponent);
    orderBroadcaster = new RuntimeBroadcaster(orderRuntime, orderComponent, {
      brokerUrl: 'memory'
    });
    await orderBroadcaster.connect();

    // Create an instance BEFORE dashboard starts
    preExistingInstanceId = orderRuntime.createInstance('Order', {
      orderId: preExistingOrderId,
      amount: 999,
      customerId: 'pre-existing-customer'
    });

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));

    // NOW start the dashboard (late start scenario)
    dashboard = new DashboardServer('memory');
    await dashboard.start(dashboardPort);

    // Wait for dashboard to connect and query instances
    await new Promise(resolve => setTimeout(resolve, 300));
  });

  afterAll(async () => {
    await orderBroadcaster.disconnect();
    await dashboard.stop();
    InMemoryMessageBroker.resetInstance();
  });

  it('should retrieve pre-existing instances when dashboard starts late', async () => {
    // The dashboard should have queried instances when it started
    // and received the pre-existing instance from the runtime

    const response = await fetch(`${dashboardUrl}/api/instances`);
    const data = await response.json() as any;

    // Find the pre-existing instance by ID or orderId
    const instance = data.instances?.find(
      (i: any) => (i.id === preExistingInstanceId || i.instanceId === preExistingInstanceId) ||
                  i.context?.orderId === preExistingOrderId
    );

    expect(instance).toBeDefined();
    expect(instance.currentState).toBe('Created');
    expect(instance.machineName).toBe('Order');
  });

  it('should have runtime registered even with late dashboard start', async () => {
    const response = await fetch(`${dashboardUrl}/api/runtimes`);
    const data = await response.json() as any;

    expect(data.runtimes.length).toBeGreaterThanOrEqual(1);
  });
});
