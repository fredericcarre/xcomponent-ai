/**
 * xcomponent-ai Monolith Runtime
 *
 * Single-process mode: dashboard + all runtimes + in-memory broker
 * PostgreSQL is optional — if DATABASE_URL is set, persistence and
 * history/audit trail are enabled; otherwise everything stays in memory.
 */

const fs = require('fs');
const yaml = require('yaml');
const path = require('path');

// Import from built dist (resolve from project root)
const distPath = path.join(__dirname, '..', '..', 'dist');
const {
  FSMRuntime,
  createRuntimeBroadcaster,
  PostgresEventStore,
  PostgresSnapshotStore
} = require(distPath);

// Import DashboardServer (used to serve the UI + APIs)
const { DashboardServer } = require(path.join(distPath, 'dashboard-server'));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const port = parseInt(process.env.PORT || '3000', 10);

  // Component YAML files — reuse the distributed example definitions
  const componentFiles = [
    process.env.ORDER_COMPONENT || path.join(__dirname, '..', 'distributed', 'order-component.yaml'),
    process.env.PAYMENT_COMPONENT || path.join(__dirname, '..', 'distributed', 'payment-component.yaml'),
  ];

  console.log(`\n${'='.repeat(50)}`);
  console.log('    XCOMPONENT MONOLITH');
  console.log('='.repeat(50));
  console.log(`Database:  ${databaseUrl ? databaseUrl.replace(/:[^:@]+@/, ':***@') : 'none (in-memory)'}`);
  console.log(`Broker:    in-memory (single process)`);
  console.log(`Port:      ${port}`);
  console.log('='.repeat(50) + '\n');

  // ============================================================
  // 1. Start Dashboard Server with in-memory broker
  //    DashboardServer creates an InMemoryMessageBroker singleton
  // ============================================================
  console.log('[Monolith] Starting dashboard server...');
  const dashboard = new DashboardServer('memory', databaseUrl);
  await dashboard.start(port);

  // ============================================================
  // 2. Create persistence stores (optional)
  // ============================================================
  let persistenceConfig = undefined;

  if (databaseUrl) {
    console.log('[Monolith] Connecting to PostgreSQL...');
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

    console.log('[Monolith] PostgreSQL persistence ready');

    persistenceConfig = {
      eventSourcing: true,
      snapshots: true,
      snapshotInterval: 10,
      eventStore,
      snapshotStore
    };
  } else {
    console.log('[Monolith] No DATABASE_URL — running fully in-memory (no persistence, no audit trail)');
  }

  // ============================================================
  // 3. Create runtimes for each component
  //    Using 'memory' broker → same InMemoryMessageBroker singleton
  //    as the DashboardServer, so they communicate in-process
  // ============================================================
  for (const file of componentFiles) {
    console.log(`\n[Monolith] Loading component: ${file}`);
    const componentYaml = fs.readFileSync(file, 'utf-8');
    const component = yaml.parse(componentYaml);

    const runtime = persistenceConfig
      ? new FSMRuntime(component, persistenceConfig)
      : new FSMRuntime(component);

    // Register business logic handlers
    registerBusinessLogic(runtime, component.name);

    // Connect to broker (same in-memory singleton as dashboard)
    const runtimeName = `${component.name}-runtime`;
    const broadcaster = await createRuntimeBroadcaster(runtime, component, 'memory', {
      host: runtimeName,
      port: 0
    });

    console.log(`[Monolith] ${component.name} ready (runtime: ${broadcaster.getRuntimeId()})`);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`    MONOLITH READY — http://localhost:${port}`);
  console.log('='.repeat(50));
  console.log(`  Dashboard:  http://localhost:${port}`);
  console.log(`  Database:   ${databaseUrl ? 'PostgreSQL (audit trail enabled)' : 'In-memory (no audit trail)'}`);
  console.log('='.repeat(50) + '\n');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Monolith] Shutting down...');
    await dashboard.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive
  setInterval(() => {}, 30000);
}

// ============================================================
// USER BUSINESS LOGIC
// Same handlers as distributed examples
// ============================================================
function registerBusinessLogic(runtime, componentName) {
  // Triggered method: runs during a specific transition
  runtime.on('triggered_method', async ({ method, event, context, sender }) => {
    console.log(`[${componentName}] triggeredMethod: ${method}`);

    if (method === 'checkPaymentMethod') {
      const cardType = (context.paymentMethod || '').toLowerCase();
      const accepted = ['visa', 'mastercard', 'cb'];

      if (accepted.includes(cardType)) {
        console.log(`[${componentName}] Payment method "${cardType}" accepted for order ${context.orderId}`);
        setTimeout(() => {
          sender.sendToSelf({ type: 'VALIDATE', payload: {} });
        }, 500);
      } else {
        console.log(`[${componentName}] Payment method "${cardType || 'unknown'}" REJECTED for order ${context.orderId}`);
        setTimeout(() => {
          sender.sendToSelf({ type: 'REJECT', payload: { reason: `Unsupported payment method: ${cardType || 'none'}` } });
        }, 500);
      }
    }
  });

  // Entry method: runs when entering a state
  runtime.on('entry_method', async ({ method, state, context, sender }) => {
    console.log(`[${componentName}] onEntry: ${method} (state: ${state})`);

    if (method === 'logProcessingStarted') {
      console.log(`[${componentName}] Processing payment for order ${context.orderId}, amount: ${context.amount}`);
    }
    if (method === 'notifyPaymentSuccess') {
      console.log(`[${componentName}] Payment SUCCEEDED for order ${context.orderId}`);
    }
    if (method === 'notifyPaymentFailure') {
      console.log(`[${componentName}] Payment FAILED for order ${context.orderId}`);
    }
    if (method === 'notifyPaymentPending') {
      console.log(`[${componentName}] Order ${context.orderId} is waiting for payment...`);
    }
    if (method === 'notifyPaymentReceived') {
      console.log(`[${componentName}] Order ${context.orderId} payment received! Ready to ship.`);
    }
    if (method === 'notifyShipped') {
      console.log(`[${componentName}] Order ${context.orderId} has been shipped!`);
    }
    if (method === 'notifyDelivered') {
      console.log(`[${componentName}] Order ${context.orderId} delivered successfully!`);
    }
    if (method === 'notifyCancelled') {
      console.log(`[${componentName}] Order ${context.orderId} has been cancelled.`);
    }
  });

  // Exit method: runs when leaving a state
  runtime.on('exit_method', async ({ method, state, context, sender }) => {
    console.log(`[${componentName}] onExit: ${method} (leaving state: ${state})`);
  });
}

main().catch((error) => {
  console.error('[Monolith] Fatal error:', error);
  process.exit(1);
});
