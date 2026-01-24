import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';

describe('Cascading Rules (XComponent-style)', () => {
  describe('Basic Cascading', () => {
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
            {
              name: 'Confirmed',
              type: StateType.REGULAR,
              cascadingRules: [
                {
                  targetMachine: 'Shipment',
                  targetState: 'Idle',
                  event: 'START_SHIPMENT',
                  matchingRules: [
                    {
                      eventProperty: 'orderId',
                      instanceProperty: 'orderId',
                    },
                  ],
                  payload: {
                    orderId: '{{Id}}',
                    address: '{{ShippingAddress}}',
                  },
                },
              ],
            },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'Confirmed',
              event: 'CONFIRM',
              type: TransitionType.REGULAR,
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
              event: 'START_SHIPMENT',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'orderId',
                  instanceProperty: 'orderId',
                },
              ],
            },
          ],
        },
      ],
    };

    it('should automatically cascade when Order reaches Confirmed', async () => {
      const runtime = new FSMRuntime(component);

      // Create shipment instance
      const shipmentId = runtime.createInstance('Shipment', { orderId: 1 });

      // Create order instance
      const orderId = runtime.createInstance('Order', {
        Id: 1,
        ShippingAddress: '123 Main St',
      });

      expect(runtime.getInstance(shipmentId)?.currentState).toBe('Idle');

      // Confirm order → should cascade to shipment
      await runtime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for cascade
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify shipment transitioned
      expect(runtime.getInstance(shipmentId)?.currentState).toBe('Preparing');
    });

    it('should emit cascade_completed event', async () => {
      const runtime = new FSMRuntime(component);
      const cascadeEvents: any[] = [];

      runtime.on('cascade_completed', (data: any) => {
        cascadeEvents.push(data);
      });

      runtime.createInstance('Shipment', { orderId: 1 });
      const orderId = runtime.createInstance('Order', {
        Id: 1,
        ShippingAddress: '123 Main St',
      });

      await runtime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(cascadeEvents.length).toBe(1);
      expect(cascadeEvents[0].targetMachine).toBe('Shipment');
      expect(cascadeEvents[0].event).toBe('START_SHIPMENT');
      expect(cascadeEvents[0].processedCount).toBe(1);
    });
  });

  describe('Payload Templating', () => {
    const component: Component = {
      name: 'TemplateComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Source',
          initialState: 'Start',
          publicMemberType: 'Source',
          states: [
            { name: 'Start', type: StateType.ENTRY },
            {
              name: 'Activated',
              type: StateType.REGULAR,
              cascadingRules: [
                {
                  targetMachine: 'Target',
                  targetState: 'Waiting',
                  event: 'PROCESS',
                  payload: {
                    sourceId: '{{Id}}',
                    name: '{{Name}}',
                    amount: '{{Amount}}',
                    nested: {
                      city: '{{Address.City}}',
                      zip: '{{Address.Zip}}',
                    },
                  },
                },
              ],
            },
          ],
          transitions: [
            {
              from: 'Start',
              to: 'Activated',
              event: 'ACTIVATE',
              type: TransitionType.REGULAR,
            },
          ],
        },
        {
          name: 'Target',
          initialState: 'Waiting',
          states: [
            { name: 'Waiting', type: StateType.ENTRY },
            { name: 'Processing', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Waiting',
              to: 'Processing',
              event: 'PROCESS',
              type: TransitionType.REGULAR,
            },
          ],
        },
      ],
    };

    it('should template simple properties', async () => {
      const runtime = new FSMRuntime(component);
      let capturedPayload: any = null;

      runtime.on('state_change', (data: any) => {
        if (data.newState === 'Processing') {
          capturedPayload = data.event.payload;
        }
      });

      runtime.createInstance('Target', {});
      const sourceId = runtime.createInstance('Source', {
        Id: 42,
        Name: 'TestSource',
        Amount: 99.99,
        Address: {
          City: 'Paris',
          Zip: '75001',
        },
      });

      await runtime.sendEvent(sourceId, {
        type: 'ACTIVATE',
        payload: {},
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(capturedPayload).toEqual({
        sourceId: 42,
        name: 'TestSource',
        amount: 99.99,
        nested: {
          city: 'Paris',
          zip: '75001',
        },
      });
    });

    it('should handle missing properties gracefully', async () => {
      const runtime = new FSMRuntime(component);
      let capturedPayload: any = null;

      runtime.on('state_change', (data: any) => {
        if (data.newState === 'Processing') {
          capturedPayload = data.event.payload;
        }
      });

      runtime.createInstance('Target', {});
      const sourceId = runtime.createInstance('Source', {
        Id: 42,
        // Missing Name, Amount, Address
      });

      await runtime.sendEvent(sourceId, {
        type: 'ACTIVATE',
        payload: {},
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(capturedPayload).toEqual({
        sourceId: 42,
        name: undefined,
        amount: undefined,
        nested: {
          city: undefined,
          zip: undefined,
        },
      });
    });
  });

  describe('Multiple Cascades', () => {
    const component: Component = {
      name: 'MultiCascadeComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Order',
          initialState: 'Draft',
          publicMemberType: 'Order',
          states: [
            { name: 'Draft', type: StateType.ENTRY },
            {
              name: 'Confirmed',
              type: StateType.REGULAR,
              cascadingRules: [
                {
                  targetMachine: 'Inventory',
                  targetState: 'Available',
                  event: 'RESERVE',
                  matchingRules: [
                    {
                      eventProperty: 'productId',
                      instanceProperty: 'ProductId',
                    },
                  ],
                  payload: {
                    productId: '{{ProductId}}',
                    quantity: '{{Quantity}}',
                  },
                },
                {
                  targetMachine: 'Payment',
                  targetState: 'Pending',
                  event: 'CHARGE',
                  matchingRules: [
                    {
                      eventProperty: 'orderId',
                      instanceProperty: 'orderId',
                    },
                  ],
                  payload: {
                    orderId: '{{Id}}',
                    amount: '{{Total}}',
                  },
                },
              ],
            },
          ],
          transitions: [
            {
              from: 'Draft',
              to: 'Confirmed',
              event: 'CONFIRM',
              type: TransitionType.REGULAR,
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
                  eventProperty: 'productId',
                  instanceProperty: 'ProductId',
                },
              ],
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
              event: 'CHARGE',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'orderId',
                  instanceProperty: 'orderId',
                },
              ],
            },
          ],
        },
      ],
    };

    it('should trigger multiple cascades from single state', async () => {
      const runtime = new FSMRuntime(component);

      // Create inventory and payment instances
      const inventoryId = runtime.createInstance('Inventory', { ProductId: 'P1' });
      const paymentId = runtime.createInstance('Payment', { orderId: 1 });

      // Create order
      const orderId = runtime.createInstance('Order', {
        Id: 1,
        ProductId: 'P1',
        Quantity: 2,
        Total: 49.98,
      });

      // Confirm order → should cascade to both Inventory and Payment
      await runtime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Both should have transitioned
      expect(runtime.getInstance(inventoryId)?.currentState).toBe('Reserved');
      expect(runtime.getInstance(paymentId)?.currentState).toBe('Processing');
    });
  });

  describe('Error Handling', () => {
    const component: Component = {
      name: 'ErrorComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Source',
          initialState: 'Start',
          states: [
            { name: 'Start', type: StateType.ENTRY },
            {
              name: 'Active',
              type: StateType.REGULAR,
              cascadingRules: [
                {
                  targetMachine: 'NonExistent',
                  targetState: 'Idle',
                  event: 'TEST',
                },
              ],
            },
          ],
          transitions: [
            {
              from: 'Start',
              to: 'Active',
              event: 'ACTIVATE',
              type: TransitionType.REGULAR,
            },
          ],
        },
      ],
    };

    it('should handle cascade to non-existent machine gracefully', async () => {
      const runtime = new FSMRuntime(component);

      const sourceId = runtime.createInstance('Source', {});

      // Should not throw - errors are emitted as events
      await expect(runtime.sendEvent(sourceId, {
        type: 'ACTIVATE',
        payload: {},
        timestamp: Date.now(),
      })).resolves.not.toThrow();

      // Source instance should have transitioned despite cascade error
      expect(runtime.getInstance(sourceId)?.currentState).toBe('Active');

      // Give time for async cascade processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Error may or may not be emitted depending on timing
      // The important thing is that the source transition succeeded
    });
  });
});
