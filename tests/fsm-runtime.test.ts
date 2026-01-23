/**
 * FSM Runtime Tests
 */

import { FSMRuntime } from '../src/fsm-runtime';
import { Component, FSMEvent, StateType, TransitionType } from '../src/types';

describe('FSMRuntime', () => {
  const testComponent: Component = {
    name: 'TestComponent',
    version: '1.0.0',
    stateMachines: [
      {
        name: 'SimpleFlow',
        initialState: 'Start',
        states: [
          { name: 'Start', type: StateType.ENTRY },
          { name: 'Processing', type: StateType.REGULAR },
          { name: 'Success', type: StateType.FINAL },
          { name: 'Failed', type: StateType.ERROR },
        ],
        transitions: [
          {
            from: 'Start',
            to: 'Processing',
            event: 'BEGIN',
            type: TransitionType.REGULAR,
          },
          {
            from: 'Processing',
            to: 'Success',
            event: 'COMPLETE',
            type: TransitionType.REGULAR,
            guards: [{ keys: ['result'] }],
          },
          {
            from: 'Processing',
            to: 'Failed',
            event: 'ERROR',
            type: TransitionType.REGULAR,
          },
          {
            from: 'Processing',
            to: 'Failed',
            event: 'TIMEOUT',
            type: TransitionType.TIMEOUT,
            timeoutMs: 1000,
          },
        ],
      },
    ],
  };

  describe('Instance Management', () => {
    it('should create an instance', () => {
      const runtime = new FSMRuntime(testComponent);
      const instanceId = runtime.createInstance('SimpleFlow');

      expect(instanceId).toBeDefined();
      const instance = runtime.getInstance(instanceId);
      expect(instance).toBeDefined();
      expect(instance?.currentState).toBe('Start');
      expect(instance?.status).toBe('active');
    });

    it('should create instance with initial context', () => {
      const runtime = new FSMRuntime(testComponent);
      const context = { userId: '123', amount: 100 };
      const instanceId = runtime.createInstance('SimpleFlow', context);

      const instance = runtime.getInstance(instanceId);
      expect(instance?.context).toEqual(context);
    });

    it('should throw error for non-existent machine', () => {
      const runtime = new FSMRuntime(testComponent);
      expect(() => runtime.createInstance('NonExistent')).toThrow();
    });
  });

  describe('State Transitions', () => {
    it('should transition to next state on event', async () => {
      const runtime = new FSMRuntime(testComponent);
      const instanceId = runtime.createInstance('SimpleFlow');

      const event: FSMEvent = {
        type: 'BEGIN',
        payload: {},
        timestamp: Date.now(),
      };

      await runtime.sendEvent(instanceId, event);

      const instance = runtime.getInstance(instanceId);
      expect(instance?.currentState).toBe('Processing');
    });

    it('should emit state_change event', async () => {
      const runtime = new FSMRuntime(testComponent);
      const instanceId = runtime.createInstance('SimpleFlow');

      let stateChangeEmitted = false;
      runtime.on('state_change', (data) => {
        expect(data.instanceId).toBe(instanceId);
        expect(data.previousState).toBe('Start');
        expect(data.newState).toBe('Processing');
        stateChangeEmitted = true;
      });

      await runtime.sendEvent(instanceId, {
        type: 'BEGIN',
        payload: {},
        timestamp: Date.now(),
      });

      expect(stateChangeEmitted).toBe(true);
    });

    it('should dispose instance on final state', async () => {
      const runtime = new FSMRuntime(testComponent);
      const instanceId = runtime.createInstance('SimpleFlow');

      await runtime.sendEvent(instanceId, {
        type: 'BEGIN',
        payload: {},
        timestamp: Date.now(),
      });

      await runtime.sendEvent(instanceId, {
        type: 'COMPLETE',
        payload: { result: 'success' },
        timestamp: Date.now(),
      });

      const instance = runtime.getInstance(instanceId);
      expect(instance).toBeUndefined();
    });

    it('should dispose instance on error state', async () => {
      const runtime = new FSMRuntime(testComponent);
      const instanceId = runtime.createInstance('SimpleFlow');

      await runtime.sendEvent(instanceId, {
        type: 'BEGIN',
        payload: {},
        timestamp: Date.now(),
      });

      await runtime.sendEvent(instanceId, {
        type: 'ERROR',
        payload: {},
        timestamp: Date.now(),
      });

      const instance = runtime.getInstance(instanceId);
      expect(instance).toBeUndefined();
    });
  });

  describe('Guards', () => {
    it('should evaluate guards correctly', async () => {
      const runtime = new FSMRuntime(testComponent);
      const instanceId = runtime.createInstance('SimpleFlow');

      await runtime.sendEvent(instanceId, {
        type: 'BEGIN',
        payload: {},
        timestamp: Date.now(),
      });

      // Event with guard key should succeed
      await runtime.sendEvent(instanceId, {
        type: 'COMPLETE',
        payload: { result: 'success' },
        timestamp: Date.now(),
      });

      const instance = runtime.getInstance(instanceId);
      expect(instance).toBeUndefined(); // Disposed after final state
    });

    it('should fail on missing guard keys', async () => {
      const runtime = new FSMRuntime(testComponent);
      const instanceId = runtime.createInstance('SimpleFlow');

      let guardFailed = false;
      runtime.on('guard_failed', () => {
        guardFailed = true;
      });

      await runtime.sendEvent(instanceId, {
        type: 'BEGIN',
        payload: {},
        timestamp: Date.now(),
      });

      // Event without guard key should fail
      await runtime.sendEvent(instanceId, {
        type: 'COMPLETE',
        payload: {},
        timestamp: Date.now(),
      });

      expect(guardFailed).toBe(true);

      const instance = runtime.getInstance(instanceId);
      expect(instance?.currentState).toBe('Processing');
    });
  });

  describe('Timeouts', () => {
    it('should trigger timeout transition', async () => {
      const runtime = new FSMRuntime(testComponent);
      const instanceId = runtime.createInstance('SimpleFlow');

      await runtime.sendEvent(instanceId, {
        type: 'BEGIN',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const instance = runtime.getInstance(instanceId);
      expect(instance).toBeUndefined(); // Disposed after error state
    }, 2000);
  });

  describe('Simulation', () => {
    it('should simulate successful path', () => {
      const runtime = new FSMRuntime(testComponent);

      const events: FSMEvent[] = [
        { type: 'BEGIN', payload: {}, timestamp: Date.now() },
        { type: 'COMPLETE', payload: { result: 'success' }, timestamp: Date.now() },
      ];

      const result = runtime.simulatePath('SimpleFlow', events);

      expect(result.success).toBe(true);
      expect(result.path).toEqual(['Start', 'Processing', 'Success']);
    });

    it('should simulate failed path', () => {
      const runtime = new FSMRuntime(testComponent);

      const events: FSMEvent[] = [
        { type: 'BEGIN', payload: {}, timestamp: Date.now() },
        { type: 'ERROR', payload: {}, timestamp: Date.now() },
      ];

      const result = runtime.simulatePath('SimpleFlow', events);

      expect(result.success).toBe(true);
      expect(result.path).toEqual(['Start', 'Processing', 'Failed']);
    });

    it('should fail simulation on invalid event', () => {
      const runtime = new FSMRuntime(testComponent);

      const events: FSMEvent[] = [
        { type: 'INVALID_EVENT', payload: {}, timestamp: Date.now() },
      ];

      const result = runtime.simulatePath('SimpleFlow', events);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Multiple Instances', () => {
    it('should manage multiple instances independently', async () => {
      const runtime = new FSMRuntime(testComponent);

      const instance1 = runtime.createInstance('SimpleFlow');
      const instance2 = runtime.createInstance('SimpleFlow');

      await runtime.sendEvent(instance1, {
        type: 'BEGIN',
        payload: {},
        timestamp: Date.now(),
      });

      const inst1 = runtime.getInstance(instance1);
      const inst2 = runtime.getInstance(instance2);

      expect(inst1?.currentState).toBe('Processing');
      expect(inst2?.currentState).toBe('Start');
    });

    it('should get instances by machine', () => {
      const runtime = new FSMRuntime(testComponent);

      runtime.createInstance('SimpleFlow');
      runtime.createInstance('SimpleFlow');

      const instances = runtime.getInstancesByMachine('SimpleFlow');
      expect(instances.length).toBe(2);
    });
  });
});
