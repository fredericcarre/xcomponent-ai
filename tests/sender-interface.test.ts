import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType, Sender } from '../src/types';

describe('Sender Interface (XComponent-style)', () => {
  describe('SendTo - Direct Instance Communication', () => {
    const component: Component = {
      name: 'OrderShipmentComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Order',
          initialState: 'Pending',
          publicMemberType: 'Order',
          states: [
            { name: 'Pending', type: StateType.ENTRY },
            { name: 'Confirmed', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'Confirmed',
              event: 'CONFIRM',
              type: TransitionType.REGULAR,
              triggeredMethod: 'onOrderConfirmed',
            },
          ],
        },
        {
          name: 'Shipment',
          initialState: 'Idle',
          publicMemberType: 'Shipment',
          states: [
            { name: 'Idle', type: StateType.ENTRY },
            { name: 'Preparing', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Idle',
              to: 'Preparing',
              event: 'START_PREPARATION',
              type: TransitionType.REGULAR,
            },
          ],
        },
      ],
    };

    it('should provide sender in triggered_method event', async () => {
      const runtime = new FSMRuntime(component);
      let capturedSender: Sender | null = null;

      runtime.on('triggered_method', (data: any) => {
        capturedSender = data.sender;
      });

      const orderId = runtime.createInstance('Order', { Id: 1 });

      await runtime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      expect(capturedSender).toBeDefined();
      expect(capturedSender).toHaveProperty('sendTo');
      expect(capturedSender).toHaveProperty('broadcast');
      expect(capturedSender).toHaveProperty('createInstance');
    });

    it('should allow sending event to specific instance via sender', async () => {
      const runtime = new FSMRuntime(component);
      let senderReceived: Sender | null = null;

      runtime.on('triggered_method', async (data: any) => {
        senderReceived = data.sender;

        // Use sender to trigger shipment
        if (data.method === 'onOrderConfirmed' && senderReceived) {
          // In real code, we'd get the shipmentId from somewhere
          // For this test, we'll create it first
          const shipmentId = runtime.createInstance('Shipment', { orderId: data.context.Id });

          await senderReceived.sendTo(shipmentId, {
            type: 'START_PREPARATION',
            payload: { orderId: data.context.Id },
            timestamp: Date.now(),
          });
        }
      });

      const orderId = runtime.createInstance('Order', { Id: 1 });

      await runtime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify shipment was created and transitioned
      const shipments = runtime.getInstancesByMachine('Shipment');
      expect(shipments.length).toBe(1);
      expect(shipments[0].currentState).toBe('Preparing');
    });
  });

  describe('Broadcast - Property-Based Routing', () => {
    const component: Component = {
      name: 'MultiOrderComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Order',
          initialState: 'Pending',
          publicMemberType: 'Order',
          states: [
            { name: 'Pending', type: StateType.ENTRY },
            { name: 'Executed', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'Executed',
              event: 'EXECUTION',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'OrderId',
                  instanceProperty: 'Id',
                },
              ],
            },
          ],
        },
        {
          name: 'Coordinator',
          initialState: 'Active',
          states: [
            { name: 'Active', type: StateType.ENTRY },
          ],
          transitions: [
            {
              from: 'Active',
              to: 'Active',
              event: 'TRIGGER_EXECUTION',
              type: TransitionType.INTERNAL,
              triggeredMethod: 'triggerOrderExecution',
            },
          ],
        },
      ],
    };

    it('should allow broadcasting via sender', async () => {
      const runtime = new FSMRuntime(component);

      // Create multiple orders
      runtime.createInstance('Order', { Id: 1, Quantity: 100 });
      runtime.createInstance('Order', { Id: 2, Quantity: 200 });
      runtime.createInstance('Order', { Id: 3, Quantity: 300 });

      let broadcastCount = 0;

      runtime.on('triggered_method', async (data: any) => {
        if (data.method === 'triggerOrderExecution' && data.sender) {
          // Broadcast execution to Order #2
          broadcastCount = await data.sender.broadcast('Order', 'Pending', {
            type: 'EXECUTION',
            payload: { OrderId: 2, Quantity: 150 },
            timestamp: Date.now(),
          });
        }
      });

      const coordinatorId = runtime.createInstance('Coordinator', {});

      await runtime.sendEvent(coordinatorId, {
        type: 'TRIGGER_EXECUTION',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(broadcastCount).toBe(1); // Only Order #2 matched

      const orders = runtime.getInstancesByMachine('Order');
      const order1 = orders.find(o => o.publicMember?.Id === 1);
      const order2 = orders.find(o => o.publicMember?.Id === 2);
      const order3 = orders.find(o => o.publicMember?.Id === 3);

      expect(order1?.currentState).toBe('Pending'); // Not affected
      expect(order2?.currentState).toBe('Executed'); // Transitioned
      expect(order3?.currentState).toBe('Pending'); // Not affected
    });
  });

  describe('CreateInstance - Inter-Machine Communication', () => {
    const component: Component = {
      name: 'OrderPaymentComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Order',
          initialState: 'Pending',
          publicMemberType: 'Order',
          states: [
            { name: 'Pending', type: StateType.ENTRY },
            { name: 'Confirmed', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'Confirmed',
              event: 'CONFIRM',
              type: TransitionType.REGULAR,
              triggeredMethod: 'onOrderConfirmed',
            },
          ],
        },
        {
          name: 'Payment',
          initialState: 'Pending',
          publicMemberType: 'Payment',
          states: [
            { name: 'Pending', type: StateType.ENTRY },
            { name: 'Processing', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'Processing',
              event: 'START_PAYMENT',
              type: TransitionType.REGULAR,
            },
          ],
        },
      ],
    };

    it('should allow creating instances via sender', async () => {
      const runtime = new FSMRuntime(component);
      let createdPaymentId: string | null = null;

      runtime.on('triggered_method', async (data: any) => {
        if (data.method === 'onOrderConfirmed' && data.sender) {
          // Create payment instance
          createdPaymentId = data.sender.createInstance('Payment', {
            orderId: data.context.Id,
            amount: data.context.Total,
          });

          // Immediately start payment processing
          await data.sender.sendTo(createdPaymentId, {
            type: 'START_PAYMENT',
            payload: { amount: data.context.Total },
            timestamp: Date.now(),
          });
        }
      });

      const orderId = runtime.createInstance('Order', { Id: 1, Total: 99.99 });

      await runtime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(createdPaymentId).toBeDefined();

      const payment = runtime.getInstance(createdPaymentId!);
      expect(payment).toBeDefined();
      expect(payment?.currentState).toBe('Processing');
      expect(payment?.publicMember).toEqual({ orderId: 1, amount: 99.99 });
    });
  });

  describe('Complex Workflows', () => {
    const component: Component = {
      name: 'ComplexWorkflowComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Order',
          initialState: 'Draft',
          publicMemberType: 'Order',
          states: [
            { name: 'Draft', type: StateType.ENTRY },
            { name: 'Validated', type: StateType.REGULAR },
            { name: 'Confirmed', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Draft',
              to: 'Validated',
              event: 'VALIDATE',
              type: TransitionType.REGULAR,
            },
            {
              from: 'Validated',
              to: 'Confirmed',
              event: 'CONFIRM',
              type: TransitionType.REGULAR,
              triggeredMethod: 'onOrderConfirmed',
            },
          ],
        },
        {
          name: 'Inventory',
          initialState: 'Available',
          publicMemberType: 'Inventory',
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
                  eventProperty: 'ProductId',
                  instanceProperty: 'ProductId',
                },
              ],
            },
          ],
        },
        {
          name: 'Shipment',
          initialState: 'Idle',
          publicMemberType: 'Shipment',
          states: [
            { name: 'Idle', type: StateType.ENTRY },
          ],
          transitions: [],
        },
      ],
    };

    it('should handle complex multi-instance workflow', async () => {
      const runtime = new FSMRuntime(component);

      // Create inventory items
      runtime.createInstance('Inventory', { ProductId: 'P1', Quantity: 100 });
      runtime.createInstance('Inventory', { ProductId: 'P2', Quantity: 200 });

      runtime.on('triggered_method', async (data: any) => {
        if (data.method === 'onOrderConfirmed' && data.sender) {
          // Reserve inventory
          await data.sender.broadcast('Inventory', 'Available', {
            type: 'RESERVE',
            payload: { ProductId: data.context.ProductId, Quantity: data.context.Quantity },
            timestamp: Date.now(),
          });

          // Create shipment
          data.sender.createInstance('Shipment', {
            orderId: data.context.Id,
            productId: data.context.ProductId,
          });
        }
      });

      const orderId = runtime.createInstance('Order', { Id: 1, ProductId: 'P1', Quantity: 10 });

      await runtime.sendEvent(orderId, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      await runtime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify inventory was reserved
      const inventories = runtime.getInstancesByMachine('Inventory');
      const inventoryP1 = inventories.find(i => i.publicMember?.ProductId === 'P1');
      const inventoryP2 = inventories.find(i => i.publicMember?.ProductId === 'P2');

      expect(inventoryP1?.currentState).toBe('Reserved');
      expect(inventoryP2?.currentState).toBe('Available'); // Not affected

      // Verify shipment was created
      const shipments = runtime.getInstancesByMachine('Shipment');
      expect(shipments.length).toBe(1);
      expect(shipments[0].publicMember).toEqual({ orderId: 1, productId: 'P1' });
    });
  });
});
