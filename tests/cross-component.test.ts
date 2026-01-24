/**
 * Cross-Component Communication Tests
 *
 * Tests communication between different components (XComponent pattern)
 */

import { ComponentRegistry } from '../src/component-registry';
import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';

describe('Cross-Component Communication', () => {
  let registry: ComponentRegistry;
  let orderRuntime: FSMRuntime;
  let shippingRuntime: FSMRuntime;

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
          { name: 'Completed', type: StateType.FINAL },
        ],
        transitions: [
          {
            from: 'Pending',
            to: 'Confirmed',
            event: 'CONFIRM',
            type: TransitionType.REGULAR,
          },
          {
            from: 'Confirmed',
            to: 'Completed',
            event: 'COMPLETE',
            type: TransitionType.REGULAR,
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
          { name: 'InTransit', type: StateType.REGULAR },
          { name: 'Delivered', type: StateType.FINAL },
        ],
        transitions: [
          {
            from: 'Created',
            to: 'InTransit',
            event: 'SHIP',
            type: TransitionType.REGULAR,
            matchingRules: [
              {
                eventProperty: 'shipmentId',
                instanceProperty: 'Id',
              },
            ],
          },
          {
            from: 'InTransit',
            to: 'Delivered',
            event: 'DELIVER',
            type: TransitionType.REGULAR,
            matchingRules: [
              {
                eventProperty: 'trackingId',
                instanceProperty: 'Id',
              },
            ],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    registry = new ComponentRegistry();
    orderRuntime = new FSMRuntime(orderComponent);
    shippingRuntime = new FSMRuntime(shippingComponent);

    // Register runtimes with registry
    orderRuntime.setRegistry(registry);
    shippingRuntime.setRegistry(registry);
    registry.registerComponent(orderComponent, orderRuntime);
    registry.registerComponent(shippingComponent, shippingRuntime);
  });

  afterEach(() => {
    registry.dispose();
  });

  describe('Component Registry', () => {
    it('should register components', () => {
      expect(registry.hasComponent('OrderComponent')).toBe(true);
      expect(registry.hasComponent('ShippingComponent')).toBe(true);
    });

    it('should get component names', () => {
      const names = registry.getComponentNames();
      expect(names).toContain('OrderComponent');
      expect(names).toContain('ShippingComponent');
      expect(names).toHaveLength(2);
    });

    it('should get component info', () => {
      const info = registry.getComponentInfo('OrderComponent');
      expect(info).toBeDefined();
      expect(info?.name).toBe('OrderComponent');
      expect(info?.version).toBe('1.0.0');
      expect(info?.machineCount).toBe(1);
    });

    it('should get all component info', () => {
      const allInfo = registry.getAllComponentInfo();
      expect(allInfo).toHaveLength(2);
    });

    it('should get registry stats', () => {
      orderRuntime.createInstance('Order', { Id: 'ORD-001' });
      shippingRuntime.createInstance('Shipment', { Id: 'SHIP-001' });

      const stats = registry.getStats();
      expect(stats.componentCount).toBe(2);
      expect(stats.totalInstances).toBe(2);
      expect(stats.totalMachines).toBe(2);
    });

    it('should unregister components', () => {
      registry.unregisterComponent('OrderComponent');
      expect(registry.hasComponent('OrderComponent')).toBe(false);
      expect(registry.hasComponent('ShippingComponent')).toBe(true);
    });
  });

  describe('Cross-Component sendToComponent', () => {
    it('should send event from one component to another', async () => {
      // Create order instance
      const orderId = orderRuntime.createInstance('Order', {
        Id: 'ORD-001',
        CustomerId: 'CUST-001',
      });

      // Send event from shipping component to order component
      await registry.sendEventToComponent('OrderComponent', orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      const order = orderRuntime.getInstance(orderId);
      expect(order?.currentState).toBe('Confirmed');
    });

    it('should throw error for non-existent component', async () => {
      const orderId = orderRuntime.createInstance('Order', { Id: 'ORD-001' });

      await expect(
        registry.sendEventToComponent('NonExistentComponent', orderId, {
          type: 'CONFIRM',
          payload: {},
          timestamp: Date.now(),
        })
      ).rejects.toThrow('Component NonExistentComponent not found');
    });
  });

  describe('Cross-Component broadcastToComponent', () => {
    it('should broadcast to specific component', async () => {
      // Create shipments
      const shipIds = ['SHIP-001', 'SHIP-002', 'SHIP-003'];
      shipIds.forEach(id => {
        shippingRuntime.createInstance('Shipment', { Id: id });
      });

      // Broadcast SHIP event to each shipment
      let count = 0;
      for (const id of shipIds) {
        const result = await registry.broadcastToComponent(
          'ShippingComponent',
          'Shipment',
          {
            type: 'SHIP',
            payload: { shipmentId: id },
            timestamp: Date.now(),
          },
          'OrderComponent',
          undefined,
          'Created'
        );
        count += result;
      }

      expect(count).toBe(3);

      const shipments = shippingRuntime.getAllInstances();
      shipments.forEach(shipment => {
        expect(shipment.currentState).toBe('InTransit');
      });
    });

    it('should throw error for non-existent component', async () => {
      await expect(
        registry.broadcastToComponent(
          'NonExistentComponent',
          'Order',
          {
            type: 'CONFIRM',
            payload: {},
            timestamp: Date.now(),
          },
          'OrderComponent',
          undefined,
          'Pending'
        )
      ).rejects.toThrow('Component NonExistentComponent not found');
    });
  });

  describe('Cross-Component broadcastToAll', () => {
    it('should broadcast to all components', async () => {
      // Create inventory component
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
                matchingRules: [
                  {
                    eventProperty: 'stockId',
                    instanceProperty: 'Id',
                  },
                ],
              },
            ],
          },
        ],
      };

      const inventoryRuntime = new FSMRuntime(inventoryComponent);
      inventoryRuntime.setRegistry(registry);
      registry.registerComponent(inventoryComponent, inventoryRuntime);

      // Create instances
      const stockIds = ['STOCK-001', 'STOCK-002'];
      stockIds.forEach(id => {
        inventoryRuntime.createInstance('Stock', { Id: id });
      });

      // Broadcast to all components for each stock
      let count = 0;
      for (const id of stockIds) {
        const result = await registry.broadcastToAll('Stock', 'Available', {
          type: 'RESERVE',
          payload: { stockId: id },
          timestamp: Date.now(),
        });
        count += result;
      }

      expect(count).toBe(2);

      const stocks = inventoryRuntime.getAllInstances();
      stocks.forEach(stock => {
        expect(stock.currentState).toBe('Reserved');
      });
    });

    it('should handle errors in some components gracefully', async () => {
      // Create instance
      orderRuntime.createInstance('Order', { Id: 'ORD-001' });

      // Track broadcast errors
      let errorCount = 0;
      registry.on('broadcast_error', () => {
        errorCount++;
      });

      // Broadcast with event that doesn't exist in OrderComponent
      const count = await registry.broadcastToAll('NonExistentMachine', 'SomeState', {
        type: 'SOME_EVENT',
        payload: {},
        timestamp: Date.now(),
      });

      expect(count).toBe(0);
      expect(errorCount).toBeGreaterThan(0);
    });
  });

  describe('Cross-Component createInstanceInComponent', () => {
    it('should create instance in specific component', () => {
      const shipmentId = registry.createInstanceInComponent('ShippingComponent', 'Shipment', {
        Id: 'SHIP-001',
        OrderId: 'ORD-001',
      });

      expect(shipmentId).toBeDefined();

      const shipment = shippingRuntime.getInstance(shipmentId);
      expect(shipment).toBeDefined();
      expect(shipment?.machineName).toBe('Shipment');
      expect(shipment?.currentState).toBe('Created');
    });

    it('should throw error for non-existent component', () => {
      expect(() =>
        registry.createInstanceInComponent('NonExistentComponent', 'Order', { Id: 'ORD-001' })
      ).toThrow('Component NonExistentComponent not found');
    });
  });

  describe('Cross-Component Instance Lookup', () => {
    it('should find instance across components', () => {
      const orderId = orderRuntime.createInstance('Order', { Id: 'ORD-001' });

      const result = registry.findInstance(orderId);
      expect(result).toBeDefined();
      expect(result?.instance.id).toBe(orderId);
      expect(result?.componentName).toBe('OrderComponent');
    });

    it('should return undefined for non-existent instance', () => {
      const result = registry.findInstance('non-existent-id');
      expect(result).toBeUndefined();
    });

    it('should get all instances across components', () => {
      orderRuntime.createInstance('Order', { Id: 'ORD-001' });
      orderRuntime.createInstance('Order', { Id: 'ORD-002' });
      shippingRuntime.createInstance('Shipment', { Id: 'SHIP-001' });

      const allInstances = registry.getAllInstances();
      expect(allInstances).toHaveLength(3);

      const orderInstances = allInstances.filter(i => i.componentName === 'OrderComponent');
      const shipmentInstances = allInstances.filter(i => i.componentName === 'ShippingComponent');

      expect(orderInstances).toHaveLength(2);
      expect(shipmentInstances).toHaveLength(1);
    });
  });

  describe('Cross-Component Events', () => {
    it('should forward runtime events with component context', (done) => {
      let called = false;
      const handler = (data: any) => {
        if (!called && data.previousState === 'Pending' && data.newState === 'Confirmed') {
          called = true;
          expect(data.componentName).toBe('OrderComponent');
          registry.off('state_change', handler);
          done();
        }
      };
      registry.on('state_change', handler);

      const orderId = orderRuntime.createInstance('Order', { Id: 'ORD-001' });
      orderRuntime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });
    });

    it('should emit component_registered event', (done) => {
      const newRegistry = new ComponentRegistry();

      newRegistry.on('component_registered', (data) => {
        expect(data.componentName).toBe('OrderComponent');
        expect(data.version).toBe('1.0.0');
        expect(data.machineCount).toBe(1);
        done();
      });

      const runtime = new FSMRuntime(orderComponent);
      newRegistry.registerComponent(orderComponent, runtime);
    });

    it('should emit component_unregistered event', (done) => {
      registry.on('component_unregistered', (data) => {
        expect(data.componentName).toBe('OrderComponent');
        done();
      });

      registry.unregisterComponent('OrderComponent');
    });
  });

  describe('Sender Interface Cross-Component Methods', () => {
    it('should throw error when using cross-component methods without registry', async () => {
      // Component with triggered method
      const componentWithTriggered: Component = {
        name: 'TestComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Test',
            initialState: 'Start',
            publicMemberType: 'Test',
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
                triggeredMethod: 'onGo',
              },
            ],
          },
        ],
      };

      // Create runtime without registry
      const testRuntime = new FSMRuntime(componentWithTriggered);

      // Mock triggered method that tries to use cross-component communication
      let senderError: Error | null = null;

      testRuntime.on('triggered_method', async (data) => {
        try {
          await data.sender.sendToComponent('ShippingComponent', 'SHIP-001', {
            type: 'SHIP',
            payload: {},
            timestamp: Date.now(),
          });
        } catch (error) {
          senderError = error as Error;
        }
      });

      const testId = testRuntime.createInstance('Test', { Id: 'TEST-001' });

      await testRuntime.sendEvent(testId, {
        type: 'GO',
        payload: {},
        timestamp: Date.now(),
      });

      expect(senderError).toBeDefined();
      expect((senderError as unknown as Error).message).toContain('Cross-component communication requires ComponentRegistry');
    });
  });
});
