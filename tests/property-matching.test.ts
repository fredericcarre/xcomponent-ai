/**
 * Property Matching Tests
 * Tests XComponent-style property-based instance routing
 */

import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';

describe('Property Matching (XComponent-style)', () => {
  describe('Basic Property Matching', () => {
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
            { name: 'Executed', type: StateType.REGULAR },
            { name: 'Completed', type: StateType.FINAL },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'Executed',
              event: 'ExecutionInput',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'OrderId',
                  instanceProperty: 'Id',
                },
              ],
            },
            {
              from: 'Executed',
              to: 'Completed',
              event: 'COMPLETE',
              type: TransitionType.REGULAR,
            },
          ],
        },
      ],
    };

    it('should route event to instance with matching property', async () => {
      const runtime = new FSMRuntime(orderComponent);

      // Create 3 order instances
      const order1 = runtime.createInstance('Order', { Id: 1, Quantity: 100 });
      const order2 = runtime.createInstance('Order', { Id: 2, Quantity: 200 });
      const order3 = runtime.createInstance('Order', { Id: 3, Quantity: 300 });

      // Broadcast execution event for order 2
      const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
        type: 'ExecutionInput',
        payload: { OrderId: 2, ExecutionQuantity: 200 },
        timestamp: Date.now(),
      });

      expect(processedCount).toBe(1);

      // Only order 2 should have transitioned
      expect(runtime.getInstance(order1)?.currentState).toBe('Pending');
      expect(runtime.getInstance(order2)?.currentState).toBe('Executed');
      expect(runtime.getInstance(order3)?.currentState).toBe('Pending');
    });

    it('should route to multiple instances if multiple match', async () => {
      const runtime = new FSMRuntime(orderComponent);

      // Create instances with same Id (edge case)
      runtime.createInstance('Order', { Id: 42, Quantity: 100 });
      runtime.createInstance('Order', { Id: 42, Quantity: 200 });
      runtime.createInstance('Order', { Id: 99, Quantity: 300 });

      const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
        type: 'ExecutionInput',
        payload: { OrderId: 42, ExecutionQuantity: 150 },
        timestamp: Date.now(),
      });

      expect(processedCount).toBe(2); // Both Id=42 instances
    });

    it('should not route if no instance matches', async () => {
      const runtime = new FSMRuntime(orderComponent);

      runtime.createInstance('Order', { Id: 1, Quantity: 100 });
      runtime.createInstance('Order', { Id: 2, Quantity: 200 });

      const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
        type: 'ExecutionInput',
        payload: { OrderId: 999, ExecutionQuantity: 50 }, // No match
        timestamp: Date.now(),
      });

      expect(processedCount).toBe(0);
    });

    it('should only route to instances in specified state', async () => {
      const runtime = new FSMRuntime(orderComponent);

      const order1 = runtime.createInstance('Order', { Id: 1, Quantity: 100 });
      runtime.createInstance('Order', { Id: 2, Quantity: 200 });

      // Move order1 to Executed state first
      await runtime.sendEvent(order1, {
        type: 'ExecutionInput',
        payload: { OrderId: 1, ExecutionQuantity: 100 },
        timestamp: Date.now(),
      });

      expect(runtime.getInstance(order1)?.currentState).toBe('Executed');

      // Broadcast to Pending state only
      const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
        type: 'ExecutionInput',
        payload: { OrderId: 1, ExecutionQuantity: 50 },
        timestamp: Date.now(),
      });

      expect(processedCount).toBe(0); // order1 is in Executed, not Pending
    });
  });

  describe('Nested Property Matching', () => {
    const componentWithNested: Component = {
      name: 'CustomerComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Customer',
          initialState: 'Active',
          publicMemberType: 'Customer',
          states: [
            { name: 'Active', type: StateType.ENTRY },
            { name: 'Updated', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Active',
              to: 'Updated',
              event: 'UpdateAddress',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'customer.id',
                  instanceProperty: 'id',
                },
              ],
            },
          ],
        },
      ],
    };

    it('should match nested event properties', async () => {
      const runtime = new FSMRuntime(componentWithNested);

      const customer1 = runtime.createInstance('Customer', { id: 'C001', name: 'Alice' });
      const customer2 = runtime.createInstance('Customer', { id: 'C002', name: 'Bob' });

      const processedCount = await runtime.broadcastEvent('Customer', 'Active', {
        type: 'UpdateAddress',
        payload: {
          customer: { id: 'C001' },
          newAddress: '123 Main St',
        },
        timestamp: Date.now(),
      });

      expect(processedCount).toBe(1);
      expect(runtime.getInstance(customer1)?.currentState).toBe('Updated');
      expect(runtime.getInstance(customer2)?.currentState).toBe('Active');
    });
  });

  describe('Comparison Operators', () => {
    const componentWithOperators: Component = {
      name: 'ThresholdComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Account',
          initialState: 'Active',
          publicMemberType: 'Account',
          states: [
            { name: 'Active', type: StateType.ENTRY },
            { name: 'HighValue', type: StateType.REGULAR },
            { name: 'LowValue', type: StateType.REGULAR },
            { name: 'Exact', type: StateType.FINAL },
          ],
          transitions: [
            {
              from: 'Active',
              to: 'HighValue',
              event: 'CheckThreshold',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'accountId',
                  instanceProperty: 'id',
                },
                {
                  eventProperty: 'threshold',
                  instanceProperty: 'balance',
                  operator: '>',
                },
              ],
            },
            {
              from: 'Active',
              to: 'LowValue',
              event: 'CheckThreshold',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'accountId',
                  instanceProperty: 'id',
                },
                {
                  eventProperty: 'threshold',
                  instanceProperty: 'balance',
                  operator: '<',
                },
              ],
            },
          ],
        },
      ],
    };

    it('should support > operator', async () => {
      const runtime = new FSMRuntime(componentWithOperators);

      const account1 = runtime.createInstance('Account', { id: 'A1', balance: 1000 });
      runtime.createInstance('Account', { id: 'A2', balance: 500 });

      // Balance 1000 > threshold 800
      await runtime.broadcastEvent('Account', 'Active', {
        type: 'CheckThreshold',
        payload: { accountId: 'A1', threshold: 800 },
        timestamp: Date.now(),
      });

      expect(runtime.getInstance(account1)?.currentState).toBe('HighValue');
    });

    it('should support < operator', async () => {
      const runtime = new FSMRuntime(componentWithOperators);

      const account1 = runtime.createInstance('Account', { id: 'A1', balance: 500 });

      // Balance 500 < threshold 800
      await runtime.broadcastEvent('Account', 'Active', {
        type: 'CheckThreshold',
        payload: { accountId: 'A1', threshold: 800 },
        timestamp: Date.now(),
      });

      expect(runtime.getInstance(account1)?.currentState).toBe('LowValue');
    });
  });

  describe('Specific Triggering Rules', () => {
    const componentWithSpecificRules: Component = {
      name: 'ExecutionComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Order',
          initialState: 'Pending',
          publicMemberType: 'Order',
          states: [
            { name: 'Pending', type: StateType.ENTRY },
            { name: 'FullyExecuted', type: StateType.REGULAR },
            { name: 'PartiallyExecuted', type: StateType.REGULAR },
            { name: 'Completed', type: StateType.FINAL },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'FullyExecuted',
              event: 'Execute',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'OrderId',
                  instanceProperty: 'Id',
                },
              ],
              specificTriggeringRule: 'event.payload.Quantity === context.RemainingQuantity',
            },
            {
              from: 'Pending',
              to: 'PartiallyExecuted',
              event: 'Execute',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'OrderId',
                  instanceProperty: 'Id',
                },
              ],
              specificTriggeringRule: 'event.payload.Quantity < context.RemainingQuantity',
            },
          ],
        },
      ],
    };

    it('should differentiate full vs partial execution', async () => {
      const runtime = new FSMRuntime(componentWithSpecificRules);

      // Order with 1000 remaining
      const order1 = runtime.createInstance('Order', { Id: 1, RemainingQuantity: 1000 });

      // Full execution (1000 === 1000)
      await runtime.broadcastEvent('Order', 'Pending', {
        type: 'Execute',
        payload: { OrderId: 1, Quantity: 1000 },
        timestamp: Date.now(),
      });

      expect(runtime.getInstance(order1)?.currentState).toBe('FullyExecuted');
    });

    it('should handle partial execution', async () => {
      const runtime = new FSMRuntime(componentWithSpecificRules);

      // Order with 1000 remaining
      const order1 = runtime.createInstance('Order', { Id: 1, RemainingQuantity: 1000 });

      // Partial execution (500 < 1000)
      await runtime.broadcastEvent('Order', 'Pending', {
        type: 'Execute',
        payload: { OrderId: 1, Quantity: 500 },
        timestamp: Date.now(),
      });

      expect(runtime.getInstance(order1)?.currentState).toBe('PartiallyExecuted');
    });
  });

  describe('Public Member vs Context', () => {
    const componentWithPublicMember: Component = {
      name: 'TestComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'WithPublicMember',
          initialState: 'Start',
          publicMemberType: 'BusinessObject',
          states: [
            { name: 'Start', type: StateType.ENTRY },
            { name: 'End', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Start',
              to: 'End',
              event: 'UPDATE',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'id',
                  instanceProperty: 'businessId',
                },
              ],
            },
          ],
        },
      ],
    };

    it('should use publicMember for matching when publicMemberType is set', async () => {
      const runtime = new FSMRuntime(componentWithPublicMember);

      const instance1 = runtime.createInstance('WithPublicMember', { businessId: 42 });

      // Should match against publicMember, not context
      const processedCount = await runtime.broadcastEvent('WithPublicMember', 'Start', {
        type: 'UPDATE',
        payload: { id: 42 },
        timestamp: Date.now(),
      });

      expect(processedCount).toBe(1);

      const instance = runtime.getInstance(instance1);
      expect(instance?.currentState).toBe('End');
      expect(instance?.publicMember).toEqual({ businessId: 42 });
      expect(instance?.context).toEqual({}); // Context is empty for XComponent pattern
    });
  });

  describe('Event Broadcasting with Guards', () => {
    const componentWithGuards: Component = {
      name: 'GuardComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Order',
          initialState: 'Pending',
          publicMemberType: 'Order',
          states: [
            { name: 'Pending', type: StateType.ENTRY },
            { name: 'Validated', type: StateType.REGULAR },
            { name: 'Rejected', type: StateType.ERROR },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'Validated',
              event: 'Validate',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'OrderId',
                  instanceProperty: 'Id',
                },
              ],
              guards: [
                {
                  customFunction: 'event.payload.Amount <= 10000',
                },
              ],
            },
          ],
        },
      ],
    };

    it('should apply guards after property matching', async () => {
      const runtime = new FSMRuntime(componentWithGuards);

      const order1 = runtime.createInstance('Order', { Id: 1, Quantity: 100 });

      // Property matches, but guard fails (Amount > 10000)
      const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
        type: 'Validate',
        payload: { OrderId: 1, Amount: 15000 },
        timestamp: Date.now(),
      });

      expect(processedCount).toBe(0); // Guard failed
      expect(runtime.getInstance(order1)?.currentState).toBe('Pending');
    });

    it('should transition when both matching and guards pass', async () => {
      const runtime = new FSMRuntime(componentWithGuards);

      const order1 = runtime.createInstance('Order', { Id: 1, Quantity: 100 });

      // Property matches AND guard passes (Amount <= 10000)
      const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
        type: 'Validate',
        payload: { OrderId: 1, Amount: 5000 },
        timestamp: Date.now(),
      });

      expect(processedCount).toBe(1);
      expect(runtime.getInstance(order1)?.currentState).toBe('Validated');
    });
  });

  describe('Error Handling', () => {
    const basicComponent: Component = {
      name: 'BasicComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Machine',
          initialState: 'Start',
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

    it('should throw error for non-existent machine', async () => {
      const runtime = new FSMRuntime(basicComponent);

      await expect(
        runtime.broadcastEvent('NonExistent', 'Start', {
          type: 'GO',
          payload: {},
          timestamp: Date.now(),
        })
      ).rejects.toThrow('Machine NonExistent not found');
    });

    it('should throw error when transition has no matching rules', async () => {
      const runtime = new FSMRuntime(basicComponent);

      await expect(
        runtime.broadcastEvent('Machine', 'Start', {
          type: 'GO',
          payload: {},
          timestamp: Date.now(),
        })
      ).rejects.toThrow('No transition with matching rules found');
    });
  });
});
