/**
 * Integration tests for message broker and cross-component communication
 */

import { ComponentRegistry } from '../../src/component-registry';
import { FSMRuntime } from '../../src/fsm-runtime';
import { InMemoryMessageBroker } from '../../src/message-broker';
import { ExternalBrokerAPI } from '../../src/external-broker-api';
import { Component, FSMEvent } from '../../src/types';

// Test components
const orderComponent: Component = {
  name: 'OrderComponent',
  version: '1.0.0',
  stateMachines: [
    {
      name: 'Order',
      initialState: 'Created',
      states: [
        { name: 'Created', type: 'entry' },
        {
          name: 'Validated',
          type: 'regular',
          cascadingRules: [
            {
              targetComponent: 'PaymentComponent',
              targetMachine: 'Payment',
              targetState: 'Pending',
              event: 'PROCESS',
              payload: {
                orderId: '{{orderId}}',
                amount: '{{amount}}',
              },
            },
          ],
        },
        { name: 'Completed', type: 'final' },
      ],
      transitions: [
        {
          from: 'Created',
          to: 'Validated',
          event: 'VALIDATE',
          type: 'triggerable',
        },
        {
          from: 'Validated',
          to: 'Completed',
          event: 'COMPLETE',
          type: 'triggerable',
        },
      ],
    },
  ],
};

const paymentComponent: Component = {
  name: 'PaymentComponent',
  version: '1.0.0',
  stateMachines: [
    {
      name: 'Payment',
      initialState: 'Pending',
      states: [
        { name: 'Pending', type: 'entry' },
        { name: 'Processing', type: 'regular' },
        { name: 'Completed', type: 'final' },
        { name: 'Failed', type: 'error' },
      ],
      transitions: [
        {
          from: 'Pending',
          to: 'Processing',
          event: 'PROCESS',
          type: 'triggerable',
        },
        {
          from: 'Processing',
          to: 'Completed',
          event: 'CONFIRM',
          type: 'triggerable',
        },
        {
          from: 'Processing',
          to: 'Failed',
          event: 'FAIL',
          type: 'triggerable',
        },
      ],
    },
  ],
};

describe('Message Broker Integration', () => {
  describe('In-Memory Broker', () => {
    it('should handle cross-component cascading', async () => {
      // Create broker and registry
      const broker = new InMemoryMessageBroker();
      const registry = new ComponentRegistry(broker);
      await registry.initialize();

      // Create runtimes
      const orderRuntime = new FSMRuntime(orderComponent);
      const paymentRuntime = new FSMRuntime(paymentComponent);

      // Register components
      registry.registerComponent(orderComponent, orderRuntime);
      registry.registerComponent(paymentComponent, paymentRuntime);

      // Create Payment instance in Pending state
      const paymentId = paymentRuntime.createInstance('Payment', {
        orderId: 'ORD-001',
        amount: 1000,
      });

      const paymentInstanceBefore = paymentRuntime.getInstance(paymentId);
      expect(paymentInstanceBefore?.currentState).toBe('Pending');

      // Create Order instance
      const orderId = orderRuntime.createInstance('Order', {
        orderId: 'ORD-001',
        amount: 1000,
      });

      // Send VALIDATE to Order
      await orderRuntime.sendEvent(orderId, { type: 'VALIDATE', timestamp: Date.now() });

      // Wait for async cascade
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check Order transitioned to Validated
      const orderInstance = orderRuntime.getInstance(orderId);
      expect(orderInstance?.currentState).toBe('Validated');

      // Check Payment transitioned to Processing (via cascading rule)
      const paymentInstance = paymentRuntime.getInstance(paymentId);
      expect(paymentInstance?.currentState).toBe('Processing');

      // Cleanup
      await registry.dispose();
    });

    it('should broadcast to multiple instances', async () => {
      const broker = new InMemoryMessageBroker();
      const registry = new ComponentRegistry(broker);
      await registry.initialize();

      const runtime = new FSMRuntime(paymentComponent);
      registry.registerComponent(paymentComponent, runtime);

      // Create 3 Payment instances in Pending state
      const id1 = runtime.createInstance('Payment', { orderId: 'ORD-001', amount: 100 });
      const id2 = runtime.createInstance('Payment', { orderId: 'ORD-002', amount: 200 });
      const id3 = runtime.createInstance('Payment', { orderId: 'ORD-003', amount: 300 });

      // Broadcast PROCESS to all Pending instances
      const count = await registry.broadcastToComponent(
        'PaymentComponent',
        'Payment',
        'Pending',
        { type: 'PROCESS', timestamp: Date.now() }
      );

      expect(count).toBe(3);

      // Check all transitioned to Processing
      expect(runtime.getInstance(id1)?.currentState).toBe('Processing');
      expect(runtime.getInstance(id2)?.currentState).toBe('Processing');
      expect(runtime.getInstance(id3)?.currentState).toBe('Processing');

      await registry.dispose();
    });
  });

  describe('External Broker API', () => {
    it('should handle external commands', async () => {
      const broker = new InMemoryMessageBroker();
      const registry = new ComponentRegistry(broker);
      await registry.initialize();

      const runtime = new FSMRuntime(orderComponent);
      registry.registerComponent(orderComponent, runtime);

      // Setup external API
      const externalAPI = new ExternalBrokerAPI({
        broker,
        registry,
        handleCommands: true,
      });
      await externalAPI.initialize();

      // Create Order instance
      const orderId = runtime.createInstance('Order', {
        orderId: 'ORD-004',
        amount: 4000,
      });

      // Simulate external command via broker
      await broker.publish('xcomponent:external:commands', {
        sourceComponent: 'external',
        targetComponent: 'external:commands',
        targetMachine: '',
        targetState: '',
        event: { type: 'VALIDATE', timestamp: Date.now() },
        componentName: 'OrderComponent',
        instanceId: orderId,
      } as any);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check instance transitioned
      const instance = runtime.getInstance(orderId);
      expect(instance?.currentState).toBe('Validated');

      await externalAPI.dispose();
      await registry.dispose();
    });

    it('should publish FSM events to broker', async () => {
      const broker = new InMemoryMessageBroker();
      const registry = new ComponentRegistry(broker);
      await registry.initialize();

      const runtime = new FSMRuntime(orderComponent);
      registry.registerComponent(orderComponent, runtime);

      // Setup external API with event publishing
      const externalAPI = new ExternalBrokerAPI({
        broker,
        registry,
        publishEvents: true,
      });
      await externalAPI.initialize();

      // Subscribe to state_change events
      const receivedEvents: any[] = [];
      broker.subscribe('events:state_change', (message: any) => {
        receivedEvents.push(message);
      });

      // Create and transition instance
      const orderId = runtime.createInstance('Order', {
        orderId: 'ORD-005',
        amount: 5000,
      });

      await runtime.sendEvent(orderId, { type: 'VALIDATE', timestamp: Date.now() });

      // Wait for event publication
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check event was published
      expect(receivedEvents.length).toBeGreaterThan(0);
      const stateChangeEvent = receivedEvents.find((e: any) => e.type === 'state_change');
      expect(stateChangeEvent).toBeDefined();
      expect(stateChangeEvent.componentName).toBe('OrderComponent');

      await externalAPI.dispose();
      await registry.dispose();
    });
  });

  describe('Component Registry', () => {
    it('should manage multiple components', () => {
      const registry = new ComponentRegistry();

      const runtime1 = new FSMRuntime(orderComponent);
      const runtime2 = new FSMRuntime(paymentComponent);

      registry.registerComponent(orderComponent, runtime1);
      registry.registerComponent(paymentComponent, runtime2);

      expect(registry.hasComponent('OrderComponent')).toBe(true);
      expect(registry.hasComponent('PaymentComponent')).toBe(true);
      expect(registry.getComponentNames()).toEqual(['OrderComponent', 'PaymentComponent']);

      const stats = registry.getStats();
      expect(stats.componentCount).toBe(2);
      expect(stats.totalMachines).toBe(2);
    });

    it('should find instances across components', () => {
      const registry = new ComponentRegistry();

      const orderRuntime = new FSMRuntime(orderComponent);
      const paymentRuntime = new FSMRuntime(paymentComponent);

      registry.registerComponent(orderComponent, orderRuntime);
      registry.registerComponent(paymentComponent, paymentRuntime);

      const orderId = orderRuntime.createInstance('Order', { orderId: 'ORD-006' });
      const paymentId = paymentRuntime.createInstance('Payment', { orderId: 'ORD-006' });

      const foundOrder = registry.findInstance(orderId);
      expect(foundOrder).toBeDefined();
      expect(foundOrder?.componentName).toBe('OrderComponent');

      const foundPayment = registry.findInstance(paymentId);
      expect(foundPayment).toBeDefined();
      expect(foundPayment?.componentName).toBe('PaymentComponent');

      const allInstances = registry.getAllInstances();
      expect(allInstances.length).toBe(2);
    });
  });
});
