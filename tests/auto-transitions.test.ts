import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';

describe('Auto-Transitions (XComponent-style)', () => {
  describe('Basic Auto-Transitions', () => {
    const componentWithAuto: Component = {
      name: 'AutoTransitionComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Workflow',
          initialState: 'Start',
          states: [
            { name: 'Start', type: StateType.ENTRY },
            { name: 'Validated', type: StateType.REGULAR },
            { name: 'Processing', type: StateType.REGULAR },
            { name: 'Done', type: StateType.FINAL },
          ],
          transitions: [
            {
              from: 'Start',
              to: 'Validated',
              event: 'VALIDATE',
              type: TransitionType.REGULAR,
            },
            {
              from: 'Validated',
              to: 'Processing',
              event: 'AUTO_PROCESS',
              type: TransitionType.AUTO,
              timeoutMs: 0, // Immediate
            },
            {
              from: 'Processing',
              to: 'Done',
              event: 'COMPLETE',
              type: TransitionType.REGULAR,
            },
          ],
        },
      ],
    };

    it('should auto-transition immediately (timeoutMs: 0)', async () => {
      const runtime = new FSMRuntime(componentWithAuto);
      const instanceId = runtime.createInstance('Workflow', {});

      // Trigger transition to Validated
      await runtime.sendEvent(instanceId, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      // Should be in Validated state
      expect(runtime.getInstance(instanceId)?.currentState).toBe('Validated');

      // Wait a bit for auto-transition
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have auto-transitioned to Processing
      expect(runtime.getInstance(instanceId)?.currentState).toBe('Processing');
    });

    it('should auto-transition with delay', async () => {
      const componentWithDelay: Component = {
        name: 'DelayedAutoComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Workflow',
            initialState: 'Start',
            states: [
              { name: 'Start', type: StateType.ENTRY },
              { name: 'Processing', type: StateType.REGULAR },
              { name: 'Done', type: StateType.FINAL },
            ],
            transitions: [
              {
                from: 'Start',
                to: 'Processing',
                event: 'AUTO_START',
                type: TransitionType.AUTO,
                timeoutMs: 100, // 100ms delay
              },
            ],
          },
        ],
      };

      const runtime = new FSMRuntime(componentWithDelay);
      const instanceId = runtime.createInstance('Workflow', {});

      // Should be in Start state initially
      expect(runtime.getInstance(instanceId)?.currentState).toBe('Start');

      // Wait less than delay
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(runtime.getInstance(instanceId)?.currentState).toBe('Start'); // Still in Start

      // Wait for auto-transition to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(runtime.getInstance(instanceId)?.currentState).toBe('Processing');
    });
  });

  describe('Multiple Auto-Transitions', () => {
    it('should handle multiple auto-transitions in sequence', async () => {
      const component: Component = {
        name: 'ChainedAutoComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Workflow',
            initialState: 'Start',
            states: [
              { name: 'Start', type: StateType.ENTRY },
              { name: 'Step1', type: StateType.REGULAR },
              { name: 'Step2', type: StateType.REGULAR },
              { name: 'Done', type: StateType.FINAL },
            ],
            transitions: [
              {
                from: 'Start',
                to: 'Step1',
                event: 'MANUAL_START',
                type: TransitionType.REGULAR,
              },
              {
                from: 'Step1',
                to: 'Step2',
                event: 'AUTO_STEP2',
                type: TransitionType.AUTO,
                timeoutMs: 20,
              },
              {
                from: 'Step2',
                to: 'Done',
                event: 'AUTO_DONE',
                type: TransitionType.AUTO,
                timeoutMs: 20,
              },
            ],
          },
        ],
      };

      const runtime = new FSMRuntime(component);
      const instanceId = runtime.createInstance('Workflow', {});

      await runtime.sendEvent(instanceId, {
        type: 'MANUAL_START',
        payload: {},
        timestamp: Date.now(),
      });

      expect(runtime.getInstance(instanceId)?.currentState).toBe('Step1');

      // Wait for first auto-transition (20ms + buffer for timer wheel granularity)
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(runtime.getInstance(instanceId)?.currentState).toBe('Step2');

      // Wait for second auto-transition (20ms + buffer for timer wheel granularity)
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(runtime.getInstance(instanceId)).toBeUndefined(); // Disposed (final state)
    });
  });

  describe('Event Emissions', () => {
    it('should emit state_change events for auto-transitions', async () => {
      const component: Component = {
        name: 'EventComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Workflow',
            initialState: 'Start',
            states: [
              { name: 'Start', type: StateType.ENTRY },
              { name: 'Auto', type: StateType.REGULAR },
            ],
            transitions: [
              {
                from: 'Start',
                to: 'Auto',
                event: 'AUTO_TRANSITION',
                type: TransitionType.AUTO,
                timeoutMs: 0,
              },
            ],
          },
        ],
      };

      const runtime = new FSMRuntime(component);
      const stateChanges: any[] = [];

      runtime.on('state_change', (data: any) => {
        stateChanges.push(data);
      });

      runtime.createInstance('Workflow', {});

      // Wait for auto-transition
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0].previousState).toBe('Start');
      expect(stateChanges[0].newState).toBe('Auto');
      expect(stateChanges[0].event.type).toBe('AUTO_TRANSITION');
    });
  });
});
