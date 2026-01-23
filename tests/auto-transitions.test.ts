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

  describe('Auto-Transitions with Guards', () => {
    const componentWithGuards: Component = {
      name: 'GuardedAutoComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'ConditionalWorkflow',
          initialState: 'Start',
          publicMemberType: 'Workflow',
          states: [
            { name: 'Start', type: StateType.ENTRY },
            { name: 'Validated', type: StateType.REGULAR },
            { name: 'Approved', type: StateType.REGULAR },
            { name: 'Rejected', type: StateType.FINAL },
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
              to: 'Approved',
              event: 'AUTO_APPROVE',
              type: TransitionType.AUTO,
              timeoutMs: 0,
              guards: [
                {
                  customFunction: 'context.score >= 80',
                },
              ],
            },
            {
              from: 'Validated',
              to: 'Rejected',
              event: 'AUTO_REJECT',
              type: TransitionType.AUTO,
              timeoutMs: 0,
              guards: [
                {
                  customFunction: 'context.score < 80',
                },
              ],
            },
          ],
        },
      ],
    };

    it('should auto-transition when guard passes', async () => {
      const runtime = new FSMRuntime(componentWithGuards);
      const instanceId = runtime.createInstance('ConditionalWorkflow', { score: 90 });

      await runtime.sendEvent(instanceId, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for auto-transition
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have auto-approved (score >= 80)
      expect(runtime.getInstance(instanceId)?.currentState).toBe('Approved');
    });

    it('should auto-transition to different state when other guard passes', async () => {
      const runtime = new FSMRuntime(componentWithGuards);
      const instanceId = runtime.createInstance('ConditionalWorkflow', { score: 50 });

      await runtime.sendEvent(instanceId, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for auto-transition
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should have auto-rejected (score < 80)
      expect(runtime.getInstance(instanceId)).toBeUndefined(); // Disposed (final state)
    });

    it('should not auto-transition if guard fails', async () => {
      const componentNoMatch: Component = {
        name: 'NoMatchComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Workflow',
            initialState: 'Start',
            publicMemberType: 'Workflow',
            states: [
              { name: 'Start', type: StateType.ENTRY },
              { name: 'Processing', type: StateType.REGULAR },
            ],
            transitions: [
              {
                from: 'Start',
                to: 'Processing',
                event: 'AUTO_START',
                type: TransitionType.AUTO,
                timeoutMs: 0,
                guards: [
                  {
                    customFunction: 'context.enabled === true',
                  },
                ],
              },
            ],
          },
        ],
      };

      const runtime = new FSMRuntime(componentNoMatch);
      const instanceId = runtime.createInstance('Workflow', { enabled: false });

      // Wait for potential auto-transition
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should still be in Start (guard failed)
      expect(runtime.getInstance(instanceId)?.currentState).toBe('Start');
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
