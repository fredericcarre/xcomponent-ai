import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';

describe('User Code Hooks (onEntry, onExit, triggeredMethod, contextMapping)', () => {
  describe('onEntry and onExit', () => {
    const component: Component = {
      name: 'TestComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Workflow',
          initialState: 'Idle',
          states: [
            { name: 'Idle', type: StateType.ENTRY, onExit: 'cleanupIdle' },
            { name: 'Processing', type: StateType.REGULAR, onEntry: 'startProcessing', onExit: 'stopProcessing' },
            { name: 'Done', type: StateType.FINAL, onEntry: 'notifyComplete' },
          ],
          transitions: [
            { from: 'Idle', to: 'Processing', event: 'START', type: TransitionType.REGULAR },
            { from: 'Processing', to: 'Done', event: 'FINISH', type: TransitionType.REGULAR, triggeredMethod: 'handleFinish' },
          ],
        },
      ],
    };

    it('should emit entry_method when entering a state with onEntry', async () => {
      const runtime = new FSMRuntime(component);
      const entryMethods: any[] = [];

      runtime.on('entry_method', (data: any) => {
        entryMethods.push(data);
      });

      const id = runtime.createInstance('Workflow', {});
      await runtime.sendEvent(id, { type: 'START', payload: {}, timestamp: Date.now() });

      expect(entryMethods.length).toBe(1);
      expect(entryMethods[0].method).toBe('startProcessing');
      expect(entryMethods[0].state).toBe('Processing');
      expect(entryMethods[0].instanceId).toBe(id);
      expect(entryMethods[0].sender).toBeDefined();
    });

    it('should emit exit_method when leaving a state with onExit', async () => {
      const runtime = new FSMRuntime(component);
      const exitMethods: any[] = [];

      runtime.on('exit_method', (data: any) => {
        exitMethods.push(data);
      });

      const id = runtime.createInstance('Workflow', {});
      await runtime.sendEvent(id, { type: 'START', payload: {}, timestamp: Date.now() });

      expect(exitMethods.length).toBe(1);
      expect(exitMethods[0].method).toBe('cleanupIdle');
      expect(exitMethods[0].state).toBe('Idle');
      expect(exitMethods[0].instanceId).toBe(id);
    });

    it('should emit onExit, triggeredMethod, then onEntry in correct order', async () => {
      const runtime = new FSMRuntime(component);
      const calls: string[] = [];

      runtime.on('exit_method', (data: any) => {
        calls.push(`exit:${data.method}`);
      });
      runtime.on('triggered_method', (data: any) => {
        calls.push(`triggered:${data.method}`);
      });
      runtime.on('entry_method', (data: any) => {
        calls.push(`entry:${data.method}`);
      });

      const id = runtime.createInstance('Workflow', {});
      // First transition: Idle→Processing (has onExit on Idle, onEntry on Processing)
      await runtime.sendEvent(id, { type: 'START', payload: {}, timestamp: Date.now() });

      expect(calls).toEqual([
        'exit:cleanupIdle',
        'entry:startProcessing',
      ]);

      calls.length = 0; // Reset

      // Second transition: Processing→Done (has onExit on Processing, triggeredMethod, onEntry on Done)
      await runtime.sendEvent(id, { type: 'FINISH', payload: {}, timestamp: Date.now() });

      expect(calls).toEqual([
        'exit:stopProcessing',
        'triggered:handleFinish',
        'entry:notifyComplete',
      ]);
    });

    it('should provide sender in entry_method and exit_method', async () => {
      const runtime = new FSMRuntime(component);
      let entrySender: any = null;
      let exitSender: any = null;

      runtime.on('entry_method', (data: any) => {
        entrySender = data.sender;
      });
      runtime.on('exit_method', (data: any) => {
        exitSender = data.sender;
      });

      const id = runtime.createInstance('Workflow', {});
      await runtime.sendEvent(id, { type: 'START', payload: {}, timestamp: Date.now() });

      expect(entrySender).toBeDefined();
      expect(typeof entrySender.sendToSelf).toBe('function');
      expect(typeof entrySender.sendTo).toBe('function');
      expect(typeof entrySender.broadcast).toBe('function');

      expect(exitSender).toBeDefined();
      expect(typeof exitSender.sendToSelf).toBe('function');
    });

    it('should support legacy entryMethod/exitMethod names', async () => {
      // Component using old naming convention
      const legacyComponent: Component = {
        name: 'LegacyComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Machine',
            initialState: 'A',
            states: [
              { name: 'A', type: StateType.ENTRY, exitMethod: 'legacyExit' },
              { name: 'B', type: StateType.REGULAR, entryMethod: 'legacyEntry' },
            ],
            transitions: [
              { from: 'A', to: 'B', event: 'GO', type: TransitionType.REGULAR },
            ],
          },
        ],
      };

      const runtime = new FSMRuntime(legacyComponent);
      const calls: string[] = [];

      runtime.on('exit_method', (data: any) => calls.push(`exit:${data.method}`));
      runtime.on('entry_method', (data: any) => calls.push(`entry:${data.method}`));

      const id = runtime.createInstance('Machine', {});
      await runtime.sendEvent(id, { type: 'GO', payload: {}, timestamp: Date.now() });

      expect(calls).toEqual(['exit:legacyExit', 'entry:legacyEntry']);
    });
  });

  describe('contextMapping', () => {
    const component: Component = {
      name: 'OrderComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Order',
          initialState: 'Created',
          states: [
            { name: 'Created', type: StateType.ENTRY },
            { name: 'PendingPayment', type: StateType.REGULAR },
          ],
          transitions: [
            {
              from: 'Created',
              to: 'PendingPayment',
              event: 'SUBMIT',
              type: TransitionType.INTER_MACHINE,
              targetMachine: 'Payment',
              contextMapping: {
                orderId: 'orderId',
                paymentAmount: 'amount',
              },
            },
          ],
        },
        {
          name: 'Payment',
          initialState: 'Pending',
          states: [
            { name: 'Pending', type: StateType.ENTRY },
          ],
          transitions: [],
        },
      ],
    };

    it('should apply contextMapping to inter_machine transitions', async () => {
      const runtime = new FSMRuntime(component);
      let createdContext: any = null;

      runtime.on('inter_machine_transition', (data: any) => {
        const paymentInstance = runtime.getInstance(data.targetInstanceId);
        createdContext = paymentInstance?.context;
      });

      const id = runtime.createInstance('Order', {
        orderId: 'ORD-123',
        amount: 500,
        customerId: 'CUST-456',
        secretField: 'should-not-be-sent',
      });

      await runtime.sendEvent(id, { type: 'SUBMIT', payload: {}, timestamp: Date.now() });

      // Only mapped properties should be present
      expect(createdContext).toBeDefined();
      expect(createdContext.orderId).toBe('ORD-123');
      expect(createdContext.paymentAmount).toBe(500); // renamed from "amount"
      expect(createdContext.customerId).toBeUndefined(); // not mapped
      expect(createdContext.secretField).toBeUndefined(); // not mapped
    });

    it('should send full context when no contextMapping is defined', async () => {
      const noMappingComponent: Component = {
        name: 'TestComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Source',
            initialState: 'A',
            states: [
              { name: 'A', type: StateType.ENTRY },
              { name: 'B', type: StateType.REGULAR },
            ],
            transitions: [
              {
                from: 'A',
                to: 'B',
                event: 'GO',
                type: TransitionType.INTER_MACHINE,
                targetMachine: 'Target',
                // No contextMapping
              },
            ],
          },
          {
            name: 'Target',
            initialState: 'X',
            states: [
              { name: 'X', type: StateType.ENTRY },
            ],
            transitions: [],
          },
        ],
      };

      const runtime = new FSMRuntime(noMappingComponent);
      let createdContext: any = null;

      runtime.on('inter_machine_transition', (data: any) => {
        const targetInstance = runtime.getInstance(data.targetInstanceId);
        createdContext = targetInstance?.context;
      });

      const id = runtime.createInstance('Source', {
        field1: 'value1',
        field2: 'value2',
      });

      await runtime.sendEvent(id, { type: 'GO', payload: {}, timestamp: Date.now() });

      // All context properties should be present (no filtering)
      expect(createdContext.field1).toBe('value1');
      expect(createdContext.field2).toBe('value2');
    });
  });

  describe('Event queue (deferred execution during transitions)', () => {
    const component: Component = {
      name: 'PaymentComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Payment',
          initialState: 'Pending',
          states: [
            { name: 'Pending', type: StateType.ENTRY },
            { name: 'Processing', type: StateType.REGULAR },
            { name: 'Validated', type: StateType.REGULAR },
            { name: 'Failed', type: StateType.FINAL },
          ],
          transitions: [
            {
              from: 'Pending',
              to: 'Processing',
              event: 'PROCESS',
              type: TransitionType.REGULAR,
              triggeredMethod: 'checkPayment',
            },
            {
              from: 'Processing',
              to: 'Validated',
              event: 'VALIDATE',
              type: TransitionType.REGULAR,
            },
            {
              from: 'Processing',
              to: 'Failed',
              event: 'REJECT',
              type: TransitionType.REGULAR,
            },
          ],
        },
      ],
    };

    it('should defer sender.sendToSelf until after current transition completes', async () => {
      const runtime = new FSMRuntime(component);
      const stateChanges: string[] = [];

      // Track state changes
      runtime.on('state_change', (data: any) => {
        stateChanges.push(`${data.previousState}->${data.newState}`);
      });

      // In triggeredMethod, use sender to send VALIDATE event
      runtime.on('triggered_method', (data: any) => {
        if (data.method === 'checkPayment') {
          // This should be queued, NOT executed immediately
          data.sender.sendToSelf({ type: 'VALIDATE', payload: {}, timestamp: Date.now() });
        }
      });

      const id = runtime.createInstance('Payment', { amount: 100 });

      // Send PROCESS — should trigger checkPayment which queues VALIDATE
      await runtime.sendEvent(id, { type: 'PROCESS', payload: {}, timestamp: Date.now() });

      // Wait for queued event to be processed
      await new Promise(resolve => setTimeout(resolve, 50));

      // Both transitions should have happened in order
      expect(stateChanges).toEqual([
        'Pending->Processing',    // First: the PROCESS transition completes fully
        'Processing->Validated',  // Then: the queued VALIDATE runs after
      ]);

      // Final state should be Validated
      const instance = runtime.getInstance(id);
      expect(instance?.currentState).toBe('Validated');
    });

    it('should process queued events in FIFO order', async () => {
      // Component with multiple possible transitions from Processing
      const multiComponent: Component = {
        name: 'TestComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Machine',
            initialState: 'A',
            states: [
              { name: 'A', type: StateType.ENTRY },
              { name: 'B', type: StateType.REGULAR },
              { name: 'C', type: StateType.REGULAR },
              { name: 'D', type: StateType.REGULAR },
            ],
            transitions: [
              { from: 'A', to: 'B', event: 'GO', type: TransitionType.REGULAR, triggeredMethod: 'queueMultiple' },
              { from: 'B', to: 'C', event: 'STEP1', type: TransitionType.REGULAR },
              { from: 'C', to: 'D', event: 'STEP2', type: TransitionType.REGULAR },
            ],
          },
        ],
      };

      const runtime = new FSMRuntime(multiComponent);
      const stateChanges: string[] = [];

      runtime.on('state_change', (data: any) => {
        stateChanges.push(`${data.previousState}->${data.newState}`);
      });

      runtime.on('triggered_method', (data: any) => {
        if (data.method === 'queueMultiple') {
          // Queue two events — they should execute in order AFTER A->B completes
          data.sender.sendToSelf({ type: 'STEP1', payload: {}, timestamp: Date.now() });
          data.sender.sendToSelf({ type: 'STEP2', payload: {}, timestamp: Date.now() });
        }
      });

      const id = runtime.createInstance('Machine', {});
      await runtime.sendEvent(id, { type: 'GO', payload: {}, timestamp: Date.now() });

      // Wait for queue drain
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(stateChanges).toEqual([
        'A->B',   // First: GO transition
        'B->C',   // Then: queued STEP1
        'C->D',   // Then: queued STEP2
      ]);
    });

    it('should not queue events sent outside a transition', async () => {
      const runtime = new FSMRuntime(component);

      const id = runtime.createInstance('Payment', { amount: 100 });

      // Direct sendEvent (not from triggered method) should execute immediately
      await runtime.sendEvent(id, { type: 'PROCESS', payload: {}, timestamp: Date.now() });

      const instance = runtime.getInstance(id);
      expect(instance?.currentState).toBe('Processing');
    });
  });
});
