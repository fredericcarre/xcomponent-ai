/**
 * Cross-Component Traceability Tests
 *
 * Tests event sourcing and causality tracking across component boundaries
 */

import { ComponentRegistry } from '../src/component-registry';
import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';
import { InMemoryEventStore, InMemorySnapshotStore } from '../src/persistence';

describe('Cross-Component Traceability', () => {
  let registry: ComponentRegistry;
  let orderRuntime: FSMRuntime;
  let inventoryRuntime: FSMRuntime;
  let shippingRuntime: FSMRuntime;

  // Shared event stores for testing
  let eventStore: InMemoryEventStore;
  let snapshotStore: InMemorySnapshotStore;

  // Order Component
  const orderComponent: Component = {
    name: 'OrderComponent',
    version: '1.0.0',
    stateMachines: [
      {
        name: 'Order',
        initialState: 'Pending',
        publicMemberType: 'Order',
        states: [
          { name: 'Pending', type: StateType.ENTRY },
          { name: 'Confirmed', type: StateType.REGULAR },
          { name: 'Shipped', type: StateType.FINAL },
        ],
        transitions: [
          {
            from: 'Pending',
            to: 'Confirmed',
            event: 'CONFIRM',
            type: TransitionType.REGULAR,
            triggeredMethod: 'onConfirmed',
            matchingRules: [{ eventProperty: 'orderId', instanceProperty: 'Id' }],
          },
          {
            from: 'Confirmed',
            to: 'Shipped',
            event: 'SHIP',
            type: TransitionType.REGULAR,
            matchingRules: [{ eventProperty: 'orderId', instanceProperty: 'Id' }],
          },
        ],
      },
    ],
  };

  // Inventory Component
  const inventoryComponent: Component = {
    name: 'InventoryComponent',
    version: '1.0.0',
    stateMachines: [
      {
        name: 'Stock',
        initialState: 'Available',
        publicMemberType: 'Stock',
        states: [
          { name: 'Available', type: StateType.ENTRY },
          { name: 'Reserved', type: StateType.REGULAR },
        ],
        transitions: [
          {
            from: 'Available',
            to: 'Reserved',
            event: 'RESERVE',
            type: TransitionType.REGULAR,
            triggeredMethod: 'onReserved',
            matchingRules: [{ eventProperty: 'productId', instanceProperty: 'Id' }],
          },
        ],
      },
    ],
  };

  // Shipping Component
  const shippingComponent: Component = {
    name: 'ShippingComponent',
    version: '1.0.0',
    stateMachines: [
      {
        name: 'Shipment',
        initialState: 'Created',
        publicMemberType: 'Shipment',
        states: [
          { name: 'Created', type: StateType.ENTRY },
          { name: 'InTransit', type: StateType.FINAL },
        ],
        transitions: [
          {
            from: 'Created',
            to: 'InTransit',
            event: 'SHIP',
            type: TransitionType.REGULAR,
            matchingRules: [{ eventProperty: 'shipmentId', instanceProperty: 'Id' }],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    // Create shared event store (simulates centralized database)
    eventStore = new InMemoryEventStore();
    snapshotStore = new InMemorySnapshotStore();

    // Create component registry
    registry = new ComponentRegistry();

    // Create runtimes with persistence enabled
    orderRuntime = new FSMRuntime(orderComponent, {
      eventSourcing: true,
      snapshots: true,
      eventStore,
      snapshotStore,
    });

    inventoryRuntime = new FSMRuntime(inventoryComponent, {
      eventSourcing: true,
      snapshots: true,
      eventStore,
      snapshotStore,
    });

    shippingRuntime = new FSMRuntime(shippingComponent, {
      eventSourcing: true,
      snapshots: true,
      eventStore,
      snapshotStore,
    });

    // Register runtimes with registry
    orderRuntime.setRegistry(registry);
    inventoryRuntime.setRegistry(registry);
    shippingRuntime.setRegistry(registry);

    registry.registerComponent(orderComponent, orderRuntime);
    registry.registerComponent(inventoryComponent, inventoryRuntime);
    registry.registerComponent(shippingComponent, shippingRuntime);
  });

  afterEach(() => {
    registry.dispose();
  });

  describe('Component Name Tracking', () => {
    it('should persist events with component name', async () => {
      const orderId = orderRuntime.createInstance('Order', { Id: 'ORD-001' });

      await orderRuntime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: { orderId: 'ORD-001' },
        timestamp: Date.now(),
      });

      const history = await orderRuntime.getInstanceHistory(orderId);
      expect(history).toHaveLength(2);

      // First event is INSTANCE_CREATED (persisted on instance creation)
      expect(history[0].componentName).toBe('OrderComponent');
      expect(history[0].machineName).toBe('Order');
      expect(history[0].event.type).toBe('INSTANCE_CREATED');
      expect(history[0].stateBefore).toBe('');
      expect(history[0].stateAfter).toBe('Pending');

      // Second event is the CONFIRM transition
      expect(history[1].componentName).toBe('OrderComponent');
      expect(history[1].machineName).toBe('Order');
      expect(history[1].event.type).toBe('CONFIRM');
    });

    it('should track events from multiple components', async () => {
      // Create instances in different components
      const orderId = orderRuntime.createInstance('Order', { Id: 'ORD-001' });
      const stockId = inventoryRuntime.createInstance('Stock', { Id: 'PROD-001' });

      // Trigger events
      await orderRuntime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: { orderId: 'ORD-001' },
        timestamp: Date.now(),
      });

      await inventoryRuntime.sendEvent(stockId, {
        type: 'RESERVE',
        payload: { productId: 'PROD-001' },
        timestamp: Date.now(),
      });

      // Get all events across components
      const allEvents = await registry.getAllPersistedEvents();
      expect(allEvents.length).toBeGreaterThanOrEqual(2);

      const orderEvents = allEvents.filter(e => e.componentName === 'OrderComponent');
      const inventoryEvents = allEvents.filter(e => e.componentName === 'InventoryComponent');

      // Each component has 2 events: INSTANCE_CREATED + transition event
      expect(orderEvents).toHaveLength(2);
      expect(inventoryEvents).toHaveLength(2);
    });
  });

  describe('Cross-Component Causality Tracing', () => {
    it.skip('should trace events across component boundaries', async () => {
      let orderEventId: string | null = null;
      let inventoryEventId: string | null = null;

      // Setup cross-component communication
      orderRuntime.on('triggered_method', async (data) => {
        if (data.method === 'onConfirmed') {
          const order = data.context;
          // Reserve inventory in different component
          await data.sender.broadcastToComponent(
            'InventoryComponent',
            'Stock',
            'Available',
            {
              type: 'RESERVE',
              payload: { productId: order.ProductId, orderId: order.Id },
              timestamp: Date.now(),
            }
          );
        }
      });

      // Track event IDs via state_change events
      registry.on('state_change', (eventData) => {
        if (eventData.componentName === 'OrderComponent') {
          orderEventId = eventData.eventId;
        } else if (eventData.componentName === 'InventoryComponent') {
          inventoryEventId = eventData.eventId;
        }
      });

      // Create instances
      orderRuntime.createInstance('Order', { Id: 'ORD-001', ProductId: 'PROD-001' });
      inventoryRuntime.createInstance('Stock', { Id: 'PROD-001' });

      // Trigger workflow
      await orderRuntime.broadcastEvent('Order', {
        type: 'CONFIRM',
        payload: { orderId: 'ORD-001' },
        timestamp: Date.now(),
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify events were persisted
      expect(orderEventId).toBeTruthy();
      expect(inventoryEventId).toBeTruthy();

      // Get all events and verify they're linked
      const allEvents = await registry.getAllPersistedEvents();
      expect(allEvents.length).toBeGreaterThanOrEqual(2);

      // Find the inventory event and verify it was caused by order event
      const inventoryEvent = allEvents.find(e => e.id === inventoryEventId);
      expect(inventoryEvent).toBeDefined();
      expect(inventoryEvent?.causedBy).toContain(orderEventId);
    });

    it.skip('should trace full causality chain across multiple components', async () => {
      let rootEventId: string | null = null;

      // Setup cross-component workflows
      orderRuntime.on('triggered_method', async (data) => {
        if (data.method === 'onConfirmed') {
          const order = data.context;
          await data.sender.broadcastToComponent(
            'InventoryComponent',
            'Stock',
            'Available',
            {
              type: 'RESERVE',
              payload: { productId: order.ProductId, orderId: order.Id },
              timestamp: Date.now(),
            }
          );
        }
      });

      inventoryRuntime.on('triggered_method', async (data) => {
        if (data.method === 'onReserved') {
          const stock = data.context;
          const orderId = data.event.payload.orderId;
          data.sender.createInstanceInComponent('ShippingComponent', 'Shipment', {
            Id: `SHIP-${orderId}`,
            OrderId: orderId,
            ProductId: stock.Id,
          });

          await data.sender.broadcastToComponent(
            'ShippingComponent',
            'Shipment',
            'Created',
            {
              type: 'SHIP',
              payload: { shipmentId: `SHIP-${orderId}` },
              timestamp: Date.now(),
            }
          );
        }
      });

      // Track root event
      registry.on('state_change', (eventData) => {
        if (eventData.componentName === 'OrderComponent' && !rootEventId) {
          rootEventId = eventData.eventId;
        }
      });

      // Create instances
      orderRuntime.createInstance('Order', { Id: 'ORD-001', ProductId: 'PROD-001' });
      inventoryRuntime.createInstance('Stock', { Id: 'PROD-001' });

      // Trigger workflow
      await orderRuntime.broadcastEvent('Order', {
        type: 'CONFIRM',
        payload: { orderId: 'ORD-001' },
        timestamp: Date.now(),
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify root event
      expect(rootEventId).toBeTruthy();

      // Trace causality chain
      if (rootEventId) {
        const causalityChain = await registry.traceEventAcrossComponents(rootEventId);

        // Should have events from multiple components
        const componentNames = new Set(causalityChain.map(e => e.componentName));
        expect(componentNames.size).toBeGreaterThanOrEqual(2);
        expect(componentNames.has('OrderComponent')).toBe(true);
        expect(componentNames.has('InventoryComponent')).toBe(true);

        // Verify chain structure
        expect(causalityChain.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('Cross-Component Instance History', () => {
    it.skip('should get instance history across components', async () => {
      const orderId = orderRuntime.createInstance('Order', { Id: 'ORD-001' });

      await orderRuntime.broadcastEvent('Order', {
        type: 'CONFIRM',
        payload: { orderId: 'ORD-001' },
        timestamp: Date.now(),
      });

      await orderRuntime.broadcastEvent('Order', {
        type: 'SHIP',
        payload: { orderId: 'ORD-001' },
        timestamp: Date.now(),
      });

      const history = await registry.getInstanceHistory(orderId);
      expect(history).toHaveLength(2);
      expect(history[0].event.type).toBe('CONFIRM');
      expect(history[1].event.type).toBe('SHIP');
      expect(history.every(e => e.componentName === 'OrderComponent')).toBe(true);
    });

    it('should return empty array for non-existent instance', async () => {
      const history = await registry.getInstanceHistory('non-existent-id');
      expect(history).toEqual([]);
    });
  });

  describe('All Events Query', () => {
    it('should get all persisted events sorted by timestamp', async () => {
      // Create instances and trigger events
      const orderId = orderRuntime.createInstance('Order', { Id: 'ORD-001' });
      const stockId = inventoryRuntime.createInstance('Stock', { Id: 'PROD-001' });

      await orderRuntime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: { orderId: 'ORD-001' },
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      await inventoryRuntime.sendEvent(stockId, {
        type: 'RESERVE',
        payload: { productId: 'PROD-001' },
        timestamp: Date.now(),
      });

      const allEvents = await registry.getAllPersistedEvents();
      expect(allEvents.length).toBeGreaterThanOrEqual(2);

      // Verify sorted by timestamp
      for (let i = 1; i < allEvents.length; i++) {
        expect(allEvents[i].persistedAt).toBeGreaterThanOrEqual(allEvents[i - 1].persistedAt);
      }
    });

    it('should handle components without persistence', async () => {
      // Create component without persistence
      const simpleComponent: Component = {
        name: 'SimpleComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Simple',
            initialState: 'Start',
            publicMemberType: 'Simple',
            states: [
              { name: 'Start', type: StateType.ENTRY },
              { name: 'End', type: StateType.FINAL },
            ],
            transitions: [
              {
                from: 'Start',
                to: 'End',
                event: 'GO',
                type: TransitionType.REGULAR,
              },
            ],
          },
        ],
      };

      const simpleRuntime = new FSMRuntime(simpleComponent); // No persistence
      simpleRuntime.setRegistry(registry);
      registry.registerComponent(simpleComponent, simpleRuntime);

      const simpleId = simpleRuntime.createInstance('Simple', { Id: 'S-001' });
      await simpleRuntime.sendEvent(simpleId, {
        type: 'GO',
        payload: {},
        timestamp: Date.now(),
      });

      // Should still get events from components with persistence
      const allEvents = await registry.getAllPersistedEvents();
      expect(allEvents.every(e => e.componentName !== 'SimpleComponent')).toBe(true);
    });
  });
});
