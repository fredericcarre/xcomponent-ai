/**
 * xcomponent-ai Runtime - Distributed Mode (Kafka)
 *
 * This script starts an FSM runtime that connects to Kafka and PostgreSQL,
 * and broadcasts events to the distributed dashboard.
 */

const fs = require('fs');
const yaml = require('yaml');

// Import from built dist
const {
  FSMRuntime,
  createRuntimeBroadcaster,
  PostgresEventStore,
  PostgresSnapshotStore
} = require('./dist');

async function main() {
  const brokerUrl = process.env.BROKER_URL || 'kafka://localhost:9092';
  const databaseUrl = process.env.DATABASE_URL;
  const componentFile = process.env.COMPONENT_FILE || './examples/approval-workflow.yaml';
  const runtimeName = process.env.RUNTIME_NAME || `runtime-${Date.now()}`;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`    XCOMPONENT RUNTIME: ${runtimeName}`);
  console.log('='.repeat(50));
  console.log(`Component: ${componentFile}`);
  console.log(`Broker:    ${brokerUrl}`);
  console.log(`Database:  ${databaseUrl ? databaseUrl.replace(/:[^:@]+@/, ':***@') : 'none (in-memory)'}`);
  console.log('='.repeat(50) + '\n');

  // Load component
  console.log('[Runtime] Loading component...');
  const componentYaml = fs.readFileSync(componentFile, 'utf-8');
  const component = yaml.parse(componentYaml);
  console.log(`[Runtime] Loaded component: ${component.name}`);

  // Create FSM runtime with optional PostgreSQL persistence
  console.log('[Runtime] Creating FSM runtime...');
  let runtime;

  if (databaseUrl) {
    console.log('[Runtime] Connecting to PostgreSQL...');

    // Parse DATABASE_URL
    const url = new URL(databaseUrl);
    const pgConfig = {
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password
    };

    const eventStore = new PostgresEventStore(pgConfig);
    const snapshotStore = new PostgresSnapshotStore(pgConfig);

    await eventStore.initialize();
    await snapshotStore.initialize();

    console.log('[Runtime] PostgreSQL persistence ready');

    // Create FSM runtime with PostgreSQL persistence
    runtime = new FSMRuntime(component, {
      eventSourcing: true,
      snapshots: true,
      snapshotInterval: 10,
      eventStore: eventStore,
      snapshotStore: snapshotStore
    });
  } else {
    // Create FSM runtime without persistence (in-memory)
    runtime = new FSMRuntime(component);
  }

  // ============================================================
  // USER BUSINESS LOGIC
  // Register handlers for triggeredMethod, onEntry, and onExit
  // ============================================================

  // Triggered method: runs during a specific transition
  // Example: check card type when processing payment
  runtime.on('triggered_method', async ({ method, event, context, sender }) => {
    console.log(`[BusinessLogic] triggeredMethod: ${method}`);

    if (method === 'checkPaymentMethod') {
      const cardType = (context.paymentMethod || '').toLowerCase();
      const accepted = ['visa', 'mastercard', 'cb'];

      if (accepted.includes(cardType)) {
        console.log(`[BusinessLogic] Payment method "${cardType}" accepted for order ${context.orderId}`);
        // Card accepted: auto-validate after a short delay (simulating API call)
        setTimeout(() => {
          sender.sendToSelf({ type: 'VALIDATE', payload: {} });
        }, 500);
      } else {
        console.log(`[BusinessLogic] Payment method "${cardType || 'unknown'}" REJECTED for order ${context.orderId}`);
        // Card not accepted: reject immediately
        setTimeout(() => {
          sender.sendToSelf({ type: 'REJECT', payload: { reason: `Unsupported payment method: ${cardType || 'none'}` } });
        }, 500);
      }
    }
  });

  // Entry method: runs when entering a state (regardless of which event led there)
  runtime.on('entry_method', async ({ method, state, context, sender }) => {
    console.log(`[BusinessLogic] onEntry: ${method} (state: ${state})`);

    if (method === 'logProcessingStarted') {
      console.log(`[BusinessLogic] Processing payment for order ${context.orderId}, amount: ${context.amount}`);
    }
    if (method === 'notifyPaymentSuccess') {
      console.log(`[BusinessLogic] Payment SUCCEEDED for order ${context.orderId}`);
    }
    if (method === 'notifyPaymentFailure') {
      console.log(`[BusinessLogic] Payment FAILED for order ${context.orderId}`);
    }
    if (method === 'notifyPaymentPending') {
      console.log(`[BusinessLogic] Order ${context.orderId} is waiting for payment...`);
    }
    if (method === 'notifyPaymentReceived') {
      console.log(`[BusinessLogic] Order ${context.orderId} payment received! Ready to ship.`);
    }
    if (method === 'notifyShipped') {
      console.log(`[BusinessLogic] Order ${context.orderId} has been shipped!`);
    }
    if (method === 'notifyDelivered') {
      console.log(`[BusinessLogic] Order ${context.orderId} delivered successfully!`);
    }
    if (method === 'notifyCancelled') {
      console.log(`[BusinessLogic] Order ${context.orderId} has been cancelled.`);
    }
  });

  // Exit method: runs when leaving a state (regardless of which event causes it)
  runtime.on('exit_method', async ({ method, state, context, sender }) => {
    console.log(`[BusinessLogic] onExit: ${method} (leaving state: ${state})`);
  });

  // Connect to message broker and start broadcasting
  console.log('[Runtime] Connecting to Kafka message broker...');
  const broadcaster = await createRuntimeBroadcaster(runtime, component, brokerUrl, {
    host: runtimeName,
    port: 0
  });

  console.log(`[Runtime] Broadcasting as ${broadcaster.getRuntimeId()}`);
  console.log('[Runtime] Ready and waiting for events...\n');

  // Create an initial instance for demo
  if (process.env.CREATE_DEMO_INSTANCE === 'true') {
    console.log('[Runtime] Creating demo instance...');
    const instanceId = runtime.createInstance(component.entryMachine, {
      requestId: `REQ-${Date.now()}`,
      amount: 5000,
      requestedBy: 'demo-user'
    });
    console.log(`[Runtime] Created demo instance: ${instanceId}`);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Runtime] Shutting down...');
    await broadcaster.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive
  setInterval(() => {
    // Heartbeat - the broadcaster handles this automatically
  }, 30000);
}

main().catch((error) => {
  console.error('[Runtime] Fatal error:', error);
  process.exit(1);
});
