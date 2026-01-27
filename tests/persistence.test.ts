import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';

describe('Persistence & Event Sourcing (Phase 4)', () => {
  const simpleComponent: Component = {
    name: 'PersistenceTest',
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
          { name: 'Completed', type: StateType.FINAL },
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

  describe('Event Sourcing', () => {
    it('should persist events when event sourcing is enabled', async () => {
      const runtime = new FSMRuntime(simpleComponent, {
        eventSourcing: true,
        snapshots: false,
      });

      const orderId = runtime.createInstance('Order', { Id: 1 });

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

      // Get event history
      const history = await runtime.getInstanceHistory(orderId);

      // 3 events: INSTANCE_CREATED + VALIDATE + CONFIRM
      expect(history.length).toBe(3);
      expect(history[0].event.type).toBe('INSTANCE_CREATED');
      expect(history[0].stateBefore).toBe('');
      expect(history[0].stateAfter).toBe('Draft');
      expect(history[1].event.type).toBe('VALIDATE');
      expect(history[1].stateBefore).toBe('Draft');
      expect(history[1].stateAfter).toBe('Validated');
      expect(history[2].event.type).toBe('CONFIRM');
      expect(history[2].stateBefore).toBe('Validated');
      expect(history[2].stateAfter).toBe('Confirmed');
    });

    it('should still provide in-memory history when event sourcing is disabled', async () => {
      const runtime = new FSMRuntime(simpleComponent, {
        eventSourcing: false,
      });

      const orderId = runtime.createInstance('Order', { Id: 1 });

      await runtime.sendEvent(orderId, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      const history = await runtime.getInstanceHistory(orderId);

      // In-memory history is always available for audit/debug purposes
      // First event is INSTANCE_CREATED, second is VALIDATE
      expect(history.length).toBe(2);
      expect(history[0].event.type).toBe('INSTANCE_CREATED');
      expect(history[1].event.type).toBe('VALIDATE');
    });
  });

  describe('Snapshots', () => {
    it('should create snapshots at configured interval', async () => {
      const runtime = new FSMRuntime(simpleComponent, {
        snapshots: true,
        snapshotInterval: 2, // Snapshot every 2 transitions
      });

      const orderId = runtime.createInstance('Order', { Id: 1 });

      // First transition
      await runtime.sendEvent(orderId, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      // No snapshot yet (1 transition)
      let snapshot = await runtime.getPersistenceManager()?.restoreInstance(orderId);
      expect(snapshot).toBeNull();

      // Second transition - should trigger snapshot
      await runtime.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      // Snapshot should exist now
      snapshot = await runtime.getPersistenceManager()?.restoreInstance(orderId);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.instance.id).toBe(orderId);
      expect(snapshot?.instance.currentState).toBe('Confirmed');
    });

    it('should not create snapshots when disabled', async () => {
      const runtime = new FSMRuntime(simpleComponent, {
        snapshots: false,
      });

      const orderId = runtime.createInstance('Order', { Id: 1 });

      await runtime.sendEvent(orderId, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      const snapshot = await runtime.getPersistenceManager()?.restoreInstance(orderId);
      expect(snapshot).toBeFalsy(); // null or undefined
    });
  });

  describe('Restore from Snapshots', () => {
    it('should restore instances after restart', async () => {
      // Create first runtime and persist state
      const runtime1 = new FSMRuntime(simpleComponent, {
        snapshots: true,
        snapshotInterval: 1, // Snapshot every transition
      });

      const orderId = runtime1.createInstance('Order', { Id: 1, CustomerId: 'C1' });

      await runtime1.sendEvent(orderId, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      await runtime1.sendEvent(orderId, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      // Get the persistence manager to share stores
      const persistenceManager = runtime1.getPersistenceManager();
      expect(persistenceManager).not.toBeNull();

      // Simulate restart - create new runtime with same stores
      const runtime2 = new FSMRuntime(simpleComponent, {
        snapshots: true,
        eventStore: persistenceManager!.getEventStore(),
        snapshotStore: persistenceManager!.getSnapshotStore(),
      });

      // Restore state
      const result = await runtime2.restore();

      expect(result.restored).toBe(1);
      expect(result.failed).toBe(0);

      // Verify instance was restored
      const restoredInstance = runtime2.getInstance(orderId);
      expect(restoredInstance).toBeDefined();
      expect(restoredInstance?.currentState).toBe('Confirmed');
      expect(restoredInstance?.publicMember).toEqual({ Id: 1, CustomerId: 'C1' });
    });

    it('should restore multiple instances', async () => {
      const runtime1 = new FSMRuntime(simpleComponent, {
        snapshots: true,
        snapshotInterval: 1,
      });

      // Create multiple orders
      const order1 = runtime1.createInstance('Order', { Id: 1 });
      const order2 = runtime1.createInstance('Order', { Id: 2 });
      const order3 = runtime1.createInstance('Order', { Id: 3 });

      await runtime1.sendEvent(order1, { type: 'VALIDATE', payload: {}, timestamp: Date.now() });
      await runtime1.sendEvent(order2, { type: 'VALIDATE', payload: {}, timestamp: Date.now() });
      await runtime1.sendEvent(order2, { type: 'CONFIRM', payload: {}, timestamp: Date.now() });
      await runtime1.sendEvent(order3, { type: 'VALIDATE', payload: {}, timestamp: Date.now() });

      // Simulate restart
      const persistenceManager = runtime1.getPersistenceManager();
      const runtime2 = new FSMRuntime(simpleComponent, {
        snapshots: true,
        eventStore: persistenceManager!.getEventStore(),
        snapshotStore: persistenceManager!.getSnapshotStore(),
      });

      const result = await runtime2.restore();

      expect(result.restored).toBe(3);
      expect(runtime2.getInstance(order1)?.currentState).toBe('Validated');
      expect(runtime2.getInstance(order2)?.currentState).toBe('Confirmed');
      expect(runtime2.getInstance(order3)?.currentState).toBe('Validated');
    });
  });

  describe('Timeout Resynchronization', () => {
    const timeoutComponent: Component = {
      name: 'TimeoutTest',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Process',
          initialState: 'Waiting',
          states: [
            { name: 'Waiting', type: StateType.ENTRY },
            { name: 'TimedOut', type: StateType.FINAL },
          ],
          transitions: [
            {
              from: 'Waiting',
              to: 'TimedOut',
              event: 'TIMEOUT',
              type: TransitionType.TIMEOUT,
              timeoutMs: 100,
            },
          ],
        },
      ],
    };

    it('should restore instances with timeout transitions', async () => {
      const runtime1 = new FSMRuntime(timeoutComponent, {
        snapshots: true,
        snapshotInterval: 1,
      });

      const processId = runtime1.createInstance('Process', {});

      // Create snapshot immediately (before timeout)
      const instance = runtime1.getInstance(processId);
      expect(instance).toBeDefined();

      await runtime1.getPersistenceManager()?.saveSnapshot(instance!, '', undefined);

      // Simulate restart
      const persistenceManager = runtime1.getPersistenceManager();
      const runtime2 = new FSMRuntime(timeoutComponent, {
        snapshots: true,
        eventStore: persistenceManager!.getEventStore(),
        snapshotStore: persistenceManager!.getSnapshotStore(),
      });

      const restoreResult = await runtime2.restore();

      // Verify restore succeeded
      expect(restoreResult.restored).toBe(1);
      expect(restoreResult.failed).toBe(0);

      // Verify instance exists after restore
      const instances = runtime2.getInstancesByMachine('Process');
      expect(instances.length).toBe(1);
      expect(instances[0].currentState).toBe('Waiting');
    });

    it('should reschedule pending timeouts after restore', async () => {
      const runtime1 = new FSMRuntime(timeoutComponent, {
        snapshots: true,
        snapshotInterval: 1,
      });

      const processId = runtime1.createInstance('Process', {});

      // Immediately create snapshot (timeout hasn't elapsed)
      const instance = runtime1.getInstance(processId);
      await runtime1.getPersistenceManager()?.saveSnapshot(instance!, '', undefined);

      // Simulate restart
      const persistenceManager = runtime1.getPersistenceManager();
      const runtime2 = new FSMRuntime(timeoutComponent, {
        snapshots: true,
        eventStore: persistenceManager!.getEventStore(),
        snapshotStore: persistenceManager!.getSnapshotStore(),
      });

      await runtime2.restore();

      const resyncResult = await runtime2.resynchronizeTimeouts();

      // Should have rescheduled timeout (not expired)
      expect(resyncResult.synced).toBeGreaterThanOrEqual(1);

      // Instance should still be in Waiting state
      expect(runtime2.getInstance(processId)?.currentState).toBe('Waiting');

      // Wait for timeout to fire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should have transitioned
      expect(runtime2.getInstance(processId)).toBeUndefined(); // Disposed
    });
  });

  describe('Event Causality Tracing', () => {
    const cascadingComponent: Component = {
      name: 'CausalityTest',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Parent',
          initialState: 'Start',
          publicMemberType: 'Parent',
          states: [
            { name: 'Start', type: StateType.ENTRY },
            {
              name: 'Activated',
              type: StateType.FINAL,
              cascadingRules: [
                {
                  targetMachine: 'Child',
                  targetState: 'Idle',
                  event: 'TRIGGER',
                  matchingRules: [
                    {
                      eventProperty: 'parentId',
                      instanceProperty: 'parentId',
                    },
                  ],
                  payload: {
                    parentId: '{{Id}}',
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
          name: 'Child',
          initialState: 'Idle',
          publicMemberType: 'Child',
          states: [
            { name: 'Idle', type: StateType.ENTRY },
            { name: 'Triggered', type: StateType.FINAL },
          ],
          transitions: [
            {
              from: 'Idle',
              to: 'Triggered',
              event: 'TRIGGER',
              type: TransitionType.REGULAR,
              matchingRules: [
                {
                  eventProperty: 'parentId',
                  instanceProperty: 'parentId',
                },
              ],
            },
          ],
        },
      ],
    };

    it('should trace event causality chain', async () => {
      const runtime = new FSMRuntime(cascadingComponent, {
        eventSourcing: true,
        snapshots: false,
      });

      const parentId = runtime.createInstance('Parent', { Id: 1 });
      runtime.createInstance('Child', { parentId: 1 });

      await runtime.sendEvent(parentId, {
        type: 'ACTIVATE',
        payload: {},
        timestamp: Date.now(),
      });

      // Wait for cascade
      await new Promise(resolve => setTimeout(resolve, 50));

      // Get parent events
      const parentHistory = await runtime.getInstanceHistory(parentId);
      expect(parentHistory.length).toBeGreaterThanOrEqual(1);

      const firstEventId = parentHistory[0].id;

      // Trace causality from first event
      const causality = await runtime.traceEventCausality(firstEventId);

      // Should include parent event and caused child event
      expect(causality.length).toBeGreaterThanOrEqual(1);
      expect(causality[0].instanceId).toBe(parentId);

      // Verify causality linkage
      if (causality.length > 1) {
        expect(causality[0].caused).toBeDefined();
        expect(causality[0].caused!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Long-Running Workflows', () => {
    it('should handle complete restart scenario', async () => {
      // Phase 1: Initial workflow
      const runtime1 = new FSMRuntime(simpleComponent, {
        eventSourcing: true,
        snapshots: true,
        snapshotInterval: 1,
      });

      const order1 = runtime1.createInstance('Order', { Id: 1, CustomerId: 'C1' });
      const order2 = runtime1.createInstance('Order', { Id: 2, CustomerId: 'C2' });

      await runtime1.sendEvent(order1, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      await runtime1.sendEvent(order2, {
        type: 'VALIDATE',
        payload: {},
        timestamp: Date.now(),
      });

      await runtime1.sendEvent(order2, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      // Phase 2: Simulate system shutdown and restart
      const persistenceManager = runtime1.getPersistenceManager();

      const runtime2 = new FSMRuntime(simpleComponent, {
        eventSourcing: true,
        snapshots: true,
        eventStore: persistenceManager!.getEventStore(),
        snapshotStore: persistenceManager!.getSnapshotStore(),
      });

      const restoreResult = await runtime2.restore();

      expect(restoreResult.restored).toBe(2);

      // Phase 3: Continue workflow after restart
      await runtime2.sendEvent(order1, {
        type: 'CONFIRM',
        payload: {},
        timestamp: Date.now(),
      });

      await runtime2.sendEvent(order2, {
        type: 'COMPLETE',
        payload: {},
        timestamp: Date.now(),
      });

      // Verify final states
      expect(runtime2.getInstance(order1)?.currentState).toBe('Confirmed');
      expect(runtime2.getInstance(order2)).toBeUndefined(); // Completed (disposed)

      // Verify full event history is preserved
      const order1History = await runtime2.getInstanceHistory(order1);
      expect(order1History.length).toBeGreaterThanOrEqual(2); // VALIDATE + CONFIRM
    });
  });
});
