/**
 * xcomponent-ai Runtime - Distributed Mode
 *
 * This script starts an FSM runtime that connects to RabbitMQ and PostgreSQL,
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
  const brokerUrl = process.env.BROKER_URL || 'amqp://guest:guest@localhost:5672';
  const databaseUrl = process.env.DATABASE_URL;
  const componentFile = process.env.COMPONENT_FILE || './examples/approval-workflow.yaml';
  const runtimeName = process.env.RUNTIME_NAME || `runtime-${Date.now()}`;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`    XCOMPONENT RUNTIME: ${runtimeName}`);
  console.log('='.repeat(50));
  console.log(`Component: ${componentFile}`);
  console.log(`Broker:    ${brokerUrl.replace(/:[^:@]+@/, ':***@')}`);
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

  // Connect to message broker and start broadcasting
  console.log('[Runtime] Connecting to message broker...');
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
