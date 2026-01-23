/**
 * Phase 4: Persistence & Event Sourcing Demo
 *
 * This example demonstrates:
 * - Event sourcing with full traceability
 * - Long-running workflows that survive restarts
 * - Timeout resynchronization after downtime
 * - Causality tracking (which events caused other events)
 * - Snapshot-based state restoration
 *
 * Scenario: E-commerce order processing system that can be stopped and restarted
 * without losing any state or in-flight transactions.
 */

import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';
import { InMemoryEventStore, InMemorySnapshotStore } from '../src/persistence';

// ============================================================
// Component Definition
// ============================================================

const ecommerceComponent: Component = {
  name: 'EcommercePersistenceDemo',
  version: '1.0.0',
  stateMachines: [
    {
      name: 'Order',
      initialState: 'Draft',
      publicMemberType: 'Order',
      states: [
        { name: 'Draft', type: StateType.ENTRY },
        { name: 'Validated', type: StateType.REGULAR },
        { name: 'PaymentPending', type: StateType.REGULAR },
        { name: 'Confirmed', type: StateType.REGULAR },
        { name: 'Completed', type: StateType.FINAL },
        { name: 'Expired', type: StateType.ERROR },
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
          to: 'PaymentPending',
          event: 'REQUEST_PAYMENT',
          type: TransitionType.AUTO,
          timeoutMs: 0, // Immediate auto-transition
        },
        {
          from: 'PaymentPending',
          to: 'Confirmed',
          event: 'PAYMENT_CONFIRMED',
          type: TransitionType.REGULAR,
        },
        {
          from: 'PaymentPending',
          to: 'Expired',
          event: 'TIMEOUT',
          type: TransitionType.TIMEOUT,
          timeoutMs: 5000, // 5 second timeout
        },
        {
          from: 'Confirmed',
          to: 'Completed',
          event: 'COMPLETE',
          type: TransitionType.REGULAR,
        },
      ],
    },
    {
      name: 'Payment',
      initialState: 'Idle',
      publicMemberType: 'Payment',
      states: [
        { name: 'Idle', type: StateType.ENTRY },
        { name: 'Processing', type: StateType.REGULAR },
        { name: 'Completed', type: StateType.FINAL },
      ],
      transitions: [
        {
          from: 'Idle',
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
        {
          from: 'Processing',
          to: 'Completed',
          event: 'SUCCESS',
          type: TransitionType.AUTO,
          timeoutMs: 1000, // Simulate 1 second payment processing
        },
      ],
    },
  ],
};

// ============================================================
// Demo Functions
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(`  ${title}`);
  console.log('='.repeat(70) + '\n');
}

async function runDemo() {
  // ============================================================
  // PHASE 1: Initial System Startup
  // ============================================================

  logSection('PHASE 1: Initial System Startup');

  // Create persistent stores (shared between runtime instances)
  const eventStore = new InMemoryEventStore();
  const snapshotStore = new InMemorySnapshotStore();

  // Create first runtime with persistence enabled
  const runtime1 = new FSMRuntime(ecommerceComponent, {
    eventSourcing: true,      // Track all events for causality
    snapshots: true,          // Take periodic snapshots
    snapshotInterval: 2,      // Snapshot every 2 transitions
    eventStore,
    snapshotStore,
  });

  console.log('✓ Runtime started with persistence enabled');
  console.log('✓ Event sourcing: ON');
  console.log('✓ Snapshots: Every 2 transitions');

  // Create orders
  const order1 = runtime1.createInstance('Order', {
    Id: 1,
    CustomerId: 'C1',
    Total: 99.99,
  });

  const order2 = runtime1.createInstance('Order', {
    Id: 2,
    CustomerId: 'C2',
    Total: 149.50,
  });

  const order3 = runtime1.createInstance('Order', {
    Id: 3,
    CustomerId: 'C3',
    Total: 75.00,
  });

  console.log(`✓ Created 3 orders: ${order1}, ${order2}, ${order3}`);

  // Create payment processors
  runtime1.createInstance('Payment', { orderId: 1 });
  runtime1.createInstance('Payment', { orderId: 2 });
  runtime1.createInstance('Payment', { orderId: 3 });

  console.log('✓ Created 3 payment processors');

  // ============================================================
  // PHASE 2: Process Some Orders
  // ============================================================

  logSection('PHASE 2: Processing Orders');

  // Validate order 1
  console.log('Processing order 1...');
  await runtime1.sendEvent(order1, {
    type: 'VALIDATE',
    payload: {},
    timestamp: Date.now(),
  });

  // Wait for auto-transition to PaymentPending
  await sleep(100);

  console.log(`✓ Order 1 state: ${runtime1.getInstance(order1)?.currentState}`);

  // Validate order 2
  console.log('Processing order 2...');
  await runtime1.sendEvent(order2, {
    type: 'VALIDATE',
    payload: {},
    timestamp: Date.now(),
  });

  await sleep(100);
  console.log(`✓ Order 2 state: ${runtime1.getInstance(order2)?.currentState}`);

  // Order 3 stays in Draft (simulating incomplete order)
  console.log('✓ Order 3 remains in Draft state (incomplete)');

  // Check snapshots
  const order1History = await runtime1.getInstanceHistory(order1);
  console.log(`\n✓ Order 1 event history: ${order1History.length} events persisted`);
  order1History.forEach((event, idx) => {
    console.log(`  ${idx + 1}. ${event.stateBefore} → ${event.stateAfter} (${event.event.type})`);
  });

  // ============================================================
  // PHASE 3: System Shutdown (Simulated)
  // ============================================================

  logSection('PHASE 3: System Shutdown (Simulated)');

  console.log('System state before shutdown:');
  console.log(`  Order 1: ${runtime1.getInstance(order1)?.currentState}`);
  console.log(`  Order 2: ${runtime1.getInstance(order2)?.currentState}`);
  console.log(`  Order 3: ${runtime1.getInstance(order3)?.currentState}`);

  const allSnapshots = await snapshotStore.getAllSnapshots();
  console.log(`\n✓ ${allSnapshots.length} snapshots saved to persistent storage`);

  const allEvents = await eventStore.getAllEvents();
  console.log(`✓ ${allEvents.length} events persisted for causality tracking`);

  console.log('\n🔴 System shutting down...');
  console.log('   (In production: server stopped, container terminated, etc.)');

  // ============================================================
  // PHASE 4: System Restart
  // ============================================================

  logSection('PHASE 4: System Restart & State Restoration');

  console.log('🟢 System restarting...');

  // Create new runtime with same persistent stores
  const runtime2 = new FSMRuntime(ecommerceComponent, {
    eventSourcing: true,
    snapshots: true,
    eventStore,      // Same store = same data
    snapshotStore,   // Same store = same data
  });

  console.log('✓ New runtime instance created');

  // Restore all instances from snapshots
  const restoreResult = await runtime2.restore();

  console.log(`\n✓ Restoration complete:`);
  console.log(`  - Restored: ${restoreResult.restored} instances`);
  console.log(`  - Failed: ${restoreResult.failed} instances`);

  // Verify restored state
  console.log('\nRestored system state:');
  const orders = runtime2.getInstancesByMachine('Order');
  orders.forEach(order => {
    console.log(`  Order ${order.publicMember?.Id}: ${order.currentState}`);
  });

  // ============================================================
  // PHASE 5: Timeout Resynchronization
  // ============================================================

  logSection('PHASE 5: Timeout Resynchronization');

  console.log('Checking for expired timeouts during downtime...');

  const resyncResult = await runtime2.resynchronizeTimeouts();

  console.log(`\n✓ Resynchronization complete:`);
  console.log(`  - Synced: ${resyncResult.synced} timeouts rescheduled`);
  console.log(`  - Expired: ${resyncResult.expired} timeouts fired immediately`);

  if (resyncResult.expired > 0) {
    console.log('\nNote: Orders in PaymentPending state may have expired if');
    console.log('downtime exceeded the 5-second timeout window.');
  }

  // ============================================================
  // PHASE 6: Continue Workflow After Restart
  // ============================================================

  logSection('PHASE 6: Continuing Workflow After Restart');

  // Find orders in PaymentPending state (if any survived timeout)
  const pendingOrders = orders.filter(o => o.currentState === 'PaymentPending');

  if (pendingOrders.length > 0) {
    console.log(`Found ${pendingOrders.length} orders awaiting payment confirmation`);

    for (const order of pendingOrders) {
      console.log(`\nConfirming payment for Order ${order.publicMember?.Id}...`);

      await runtime2.sendEvent(order.id, {
        type: 'PAYMENT_CONFIRMED',
        payload: { transactionId: `TXN-${order.publicMember?.Id}` },
        timestamp: Date.now(),
      });

      console.log(`✓ Order ${order.publicMember?.Id} moved to Confirmed state`);
    }
  } else {
    console.log('No orders in PaymentPending state (may have expired during downtime)');
  }

  // Complete order 1 if still active
  const order1After = runtime2.getInstance(order1);
  if (order1After && order1After.currentState === 'Confirmed') {
    console.log('\nCompleting Order 1...');
    await runtime2.sendEvent(order1, {
      type: 'COMPLETE',
      payload: {},
      timestamp: Date.now(),
    });
    console.log('✓ Order 1 completed and disposed');
  }

  // Process order 3 (was incomplete before restart)
  const order3After = runtime2.getInstance(order3);
  if (order3After && order3After.currentState === 'Draft') {
    console.log('\nCompleting Order 3 (left incomplete before shutdown)...');
    await runtime2.sendEvent(order3, {
      type: 'VALIDATE',
      payload: {},
      timestamp: Date.now(),
    });

    await sleep(100);
    console.log(`✓ Order 3 state: ${runtime2.getInstance(order3)?.currentState}`);
  }

  // ============================================================
  // PHASE 7: Event Causality Tracing
  // ============================================================

  logSection('PHASE 7: Event Causality Tracing');

  console.log('Tracing event causality for Order 1...\n');

  const order1HistoryAfter = await runtime2.getInstanceHistory(order1);

  if (order1HistoryAfter.length > 0) {
    const firstEvent = order1HistoryAfter[0];
    console.log(`Starting from event: ${firstEvent.event.type}`);
    console.log(`  State transition: ${firstEvent.stateBefore} → ${firstEvent.stateAfter}`);

    if (firstEvent.caused && firstEvent.caused.length > 0) {
      console.log(`\n✓ This event caused ${firstEvent.caused.length} downstream event(s):`);

      // Trace full causality chain
      const causalityChain = await runtime2.traceEventCausality(firstEvent.id);
      causalityChain.forEach((event, idx) => {
        if (idx > 0) { // Skip the root event
          console.log(`  ${idx}. Instance ${event.instanceId}: ${event.event.type}`);
          console.log(`     ${event.stateBefore} → ${event.stateAfter}`);
        }
      });
    } else {
      console.log('  (No downstream events caused by this event)');
    }
  }

  // ============================================================
  // PHASE 8: Final System State
  // ============================================================

  logSection('PHASE 8: Final System State');

  const finalOrders = runtime2.getInstancesByMachine('Order');
  const finalPayments = runtime2.getInstancesByMachine('Payment');

  console.log('Active Orders:');
  if (finalOrders.length > 0) {
    finalOrders.forEach(order => {
      console.log(`  Order ${order.publicMember?.Id}: ${order.currentState}`);
    });
  } else {
    console.log('  (All orders completed and disposed)');
  }

  console.log('\nActive Payments:');
  if (finalPayments.length > 0) {
    finalPayments.forEach(payment => {
      console.log(`  Payment for Order ${payment.publicMember?.orderId}: ${payment.currentState}`);
    });
  } else {
    console.log('  (All payments completed and disposed)');
  }

  // Show persistence stats
  const finalEvents = await eventStore.getAllEvents();
  const finalSnapshots = await snapshotStore.getAllSnapshots();

  console.log('\nPersistence Statistics:');
  console.log(`  Total events persisted: ${finalEvents.length}`);
  console.log(`  Total snapshots saved: ${finalSnapshots.length}`);
  console.log(`  Event storage overhead: ~${JSON.stringify(finalEvents).length} bytes`);

  // ============================================================
  // Summary
  // ============================================================

  logSection('DEMO SUMMARY');

  console.log('✓ Event Sourcing: All state transitions persisted with timestamps');
  console.log('✓ Causality Tracking: Parent-child event relationships maintained');
  console.log('✓ Snapshots: Periodic state snapshots for fast restoration');
  console.log('✓ System Restart: Full state restored after simulated shutdown');
  console.log('✓ Timeout Resync: Expired timeouts handled correctly');
  console.log('✓ Workflow Continuity: Orders processed before/after restart seamlessly');

  console.log('\nKey Features Demonstrated:');
  console.log('  1. Long-running workflows survive system restarts');
  console.log('  2. No data loss during unexpected shutdowns');
  console.log('  3. Full audit trail via event sourcing');
  console.log('  4. Timeout handling after downtime');
  console.log('  5. Causality tracing for debugging cascading events');

  console.log('\n' + '='.repeat(70) + '\n');
}

// ============================================================
// Run Demo
// ============================================================

console.log('\n');
console.log('╔════════════════════════════════════════════════════════════════════╗');
console.log('║  XComponent AI - Phase 4: Persistence & Event Sourcing Demo       ║');
console.log('║  Demonstrating long-running workflows with restart capability     ║');
console.log('╚════════════════════════════════════════════════════════════════════╝');

runDemo()
  .then(() => {
    console.log('Demo completed successfully! ✓');
    process.exit(0);
  })
  .catch(error => {
    console.error('Demo failed:', error);
    process.exit(1);
  });
