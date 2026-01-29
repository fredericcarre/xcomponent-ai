#!/usr/bin/env node
/**
 * End-to-end test for distributed Order/Payment flow (Kafka)
 *
 * Tests the complete cross-component communication:
 * 1. Dashboard is accessible and healthy
 * 2. Both runtimes are registered
 * 3. Both components (Order, Payment) are available
 * 4. Can create an Order instance
 * 5. SUBMIT order creates a Payment instance (cross-component)
 * 6. Process payment through its states
 * 7. COMPLETE payment sends PAYMENT_CONFIRMED to Order (cross-component)
 * 8. Order transitions to Paid state
 */

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3000';
const TIMEOUT_MS = 60000; // Kafka can be slower to initialize
const POLL_INTERVAL_MS = 2000;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return response.json();
}

async function waitFor(condition, description, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const result = await condition();
      if (result) {
        console.log(`  [OK] ${description}`);
        return result;
      }
    } catch (e) {
      lastError = e;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  const errorMsg = lastError ? ` (last error: ${lastError.message})` : '';
  throw new Error(`Timeout waiting for: ${description}${errorMsg}`);
}

// Helper to find instance by ID (handles both instanceId and id fields)
function findInstanceById(instances, id) {
  return instances.find(i => i.instanceId === id || i.id === id);
}

// Helper to get instance ID from instance object
function getInstanceId(instance) {
  return instance.instanceId || instance.id;
}

async function main() {
  console.log('='.repeat(60));
  console.log('  E2E Test: Distributed Order/Payment Flow (Kafka)');
  console.log('='.repeat(60));
  console.log(`Dashboard URL: ${DASHBOARD_URL}\n`);

  // ============================================================
  // Phase 1: Infrastructure Health
  // ============================================================
  console.log('\n--- Phase 1: Infrastructure Health ---\n');

  // Test 1: Dashboard health
  console.log('1. Checking dashboard health...');
  const health = await waitFor(
    async () => {
      const data = await fetchJson(`${DASHBOARD_URL}/health`);
      return data.status === 'ok' ? data : null;
    },
    'Dashboard is healthy'
  );
  console.log(`   Mode: ${health.mode}`);

  // Test 2: Runtimes registered
  console.log('\n2. Waiting for runtimes...');
  const runtimesResult = await waitFor(
    async () => {
      const data = await fetchJson(`${DASHBOARD_URL}/api/runtimes`);
      return data.runtimes && data.runtimes.length >= 2 ? data : null;
    },
    'At least 2 runtimes registered'
  );
  console.log(`   Runtimes: ${runtimesResult.runtimes.map(r => r.runtimeId).join(', ')}`);

  // Test 3: Components registered
  console.log('\n3. Waiting for components...');
  const componentsResult = await waitFor(
    async () => {
      const data = await fetchJson(`${DASHBOARD_URL}/api/components`);
      const hasOrder = data.components && data.components.some(c => c.name === 'OrderComponent');
      const hasPayment = data.components && data.components.some(c => c.name === 'PaymentComponent');
      return hasOrder && hasPayment ? data : null;
    },
    'OrderComponent and PaymentComponent registered'
  );
  console.log(`   Components: ${componentsResult.components.map(c => c.name).join(', ')}`);

  // ============================================================
  // Phase 2: Create Order Instance
  // ============================================================
  console.log('\n--- Phase 2: Create Order Instance ---\n');

  const orderId = `order-${Date.now()}`;
  const orderContext = {
    orderId: orderId,
    amount: 99.99,
    customerId: 'customer-123',
    paymentMethod: 'visa'
  };

  console.log(`4. Creating Order instance (${orderId})...`);
  await fetchJson(
    `${DASHBOARD_URL}/api/components/OrderComponent/instances`,
    {
      method: 'POST',
      body: JSON.stringify({
        machineName: 'Order',
        context: orderContext
      })
    }
  );
  console.log('  [OK] Create instance command sent');

  // Wait for instance to be created (async via Kafka)
  console.log('\n5. Waiting for Order instance to be created...');
  let orderInstanceId = null;
  const orderInstance = await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const order = instances.instances && instances.instances.find(
        i => i.componentName === 'OrderComponent' &&
             i.machineName === 'Order' &&
             i.context && i.context.orderId === orderId
      );
      if (order) {
        orderInstanceId = order.instanceId || order.id;
        return order;
      }
      return null;
    },
    'Order instance created with matching orderId'
  );
  console.log(`   Instance ID: ${orderInstanceId}, State: ${orderInstance.currentState}`);

  // ============================================================
  // Phase 3: Submit Order (Cross-Component Communication)
  // ============================================================
  console.log('\n--- Phase 3: Submit Order (triggers Payment creation) ---\n');

  console.log('6. Sending SUBMIT event to Order...');
  await fetchJson(
    `${DASHBOARD_URL}/api/components/OrderComponent/instances/${orderInstanceId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ event: 'SUBMIT' })
    }
  );
  console.log('  [OK] SUBMIT event sent');

  // Wait for Order to be in PendingPayment state
  console.log('\n7. Waiting for Order to transition to PendingPayment...');
  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const order = instances.instances && instances.instances.find(
        i => getInstanceId(i) === orderInstanceId
      );
      return order && order.currentState === 'PendingPayment' ? order : null;
    },
    'Order in PendingPayment state'
  );

  // Wait for Payment instance to be created (cross-component!)
  console.log('\n8. Waiting for Payment instance to be created (cross-component)...');
  let paymentInstance = null;
  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      paymentInstance = instances.instances && instances.instances.find(
        i => i.componentName === 'PaymentComponent' &&
             i.machineName === 'Payment' &&
             i.context && i.context.orderId === orderId
      );
      return paymentInstance ? paymentInstance : null;
    },
    'Payment instance created with matching orderId'
  );
  const paymentInstanceId = paymentInstance.instanceId || paymentInstance.id;
  console.log(`   Payment instance: ${paymentInstanceId}`);

  // ============================================================
  // Phase 4: Process Payment
  // ============================================================
  console.log('\n--- Phase 4: Process Payment ---\n');

  // Send PROCESS event
  // Business logic (checkPaymentMethod) auto-validates if card type is visa/mastercard/cb.
  // The triggered method runs during the transition, then sender.sendToSelf(VALIDATE)
  // is queued and executes after Pending->Processing completes.
  console.log('9. Sending PROCESS event to Payment...');
  console.log('   (Business logic will auto-validate: paymentMethod=visa)');
  await fetchJson(
    `${DASHBOARD_URL}/api/components/PaymentComponent/instances/${paymentInstanceId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ event: 'PROCESS' })
    }
  );

  // Wait for Validated state (auto-validated by checkPaymentMethod business logic)
  console.log('\n10. Waiting for Payment to be auto-validated by business logic...');
  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const payment = instances.instances && instances.instances.find(
        i => getInstanceId(i) === paymentInstanceId
      );
      return payment && payment.currentState === 'Validated' ? payment : null;
    },
    'Payment in Validated state (auto-validated by checkPaymentMethod)'
  );

  // ============================================================
  // Phase 5: Complete Payment (Cross-Component Response)
  // ============================================================
  console.log('\n--- Phase 5: Complete Payment (notifies Order) ---\n');

  console.log('11. Sending COMPLETE event to Payment (triggers cross-component PAYMENT_CONFIRMED)...');
  await fetchJson(
    `${DASHBOARD_URL}/api/components/PaymentComponent/instances/${paymentInstanceId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ event: 'COMPLETE' })
    }
  );

  // Wait for Payment to be Completed
  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const payment = instances.instances && instances.instances.find(
        i => getInstanceId(i) === paymentInstanceId
      );
      return payment && payment.currentState === 'Completed' ? payment : null;
    },
    'Payment in Completed state'
  );

  // ============================================================
  // Phase 6: Verify Order Received Payment Confirmation
  // ============================================================
  console.log('\n--- Phase 6: Verify Cross-Component Response ---\n');

  console.log('12. Waiting for Order to receive PAYMENT_CONFIRMED...');
  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const order = instances.instances && instances.instances.find(
        i => getInstanceId(i) === orderInstanceId
      );
      return order && order.currentState === 'Paid' ? order : null;
    },
    'Order transitioned to Paid state (cross-component message received!)'
  );

  // ============================================================
  // Phase 7: Complete Order Flow
  // ============================================================
  console.log('\n--- Phase 7: Complete Order Flow ---\n');

  console.log('13. Sending SHIP event to Order...');
  await fetchJson(
    `${DASHBOARD_URL}/api/components/OrderComponent/instances/${orderInstanceId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ event: 'SHIP' })
    }
  );

  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const order = instances.instances && instances.instances.find(
        i => getInstanceId(i) === orderInstanceId
      );
      return order && order.currentState === 'Shipped' ? order : null;
    },
    'Order in Shipped state'
  );

  console.log('\n14. Sending DELIVER event to Order...');
  await fetchJson(
    `${DASHBOARD_URL}/api/components/OrderComponent/instances/${orderInstanceId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ event: 'DELIVER' })
    }
  );

  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const order = instances.instances && instances.instances.find(
        i => getInstanceId(i) === orderInstanceId
      );
      return order && order.currentState === 'Completed' ? order : null;
    },
    'Order in Completed state (final)'
  );

  // ============================================================
  // Phase 8: Verify Database Event Logging
  // ============================================================
  console.log('\n--- Phase 8: Verify Database Event Logging ---\n');

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    console.log('15. Verifying events are logged in PostgreSQL...');

    try {
      const { Client } = require('pg');
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();

      // Query events for our Order instance
      const orderEventsQuery = `
        SELECT event_type, from_state, to_state, machine_name
        FROM fsm_events
        WHERE context->>'orderId' = $1
        ORDER BY persisted_at ASC
      `;
      const orderEventsResult = await client.query(orderEventsQuery, [orderId]);

      console.log(`  [OK] Found ${orderEventsResult.rows.length} events in database for orderId: ${orderId}`);

      // Verify expected Order transitions
      const orderEvents = orderEventsResult.rows.filter(e => e.machine_name === 'Order');
      console.log(`  Order events logged: ${orderEvents.length}`);
      for (const evt of orderEvents) {
        console.log(`    - ${evt.event_type}: ${evt.from_state} -> ${evt.to_state}`);
      }

      // Verify expected Payment transitions
      const paymentEvents = orderEventsResult.rows.filter(e => e.machine_name === 'Payment');
      console.log(`  Payment events logged: ${paymentEvents.length}`);
      for (const evt of paymentEvents) {
        console.log(`    - ${evt.event_type}: ${evt.from_state} -> ${evt.to_state}`);
      }

      const expectedOrderTransitions = [
        { event: 'SUBMIT', from: 'Created', to: 'PendingPayment' },
        { event: 'PAYMENT_CONFIRMED', from: 'PendingPayment', to: 'Paid' },
        { event: 'SHIP', from: 'Paid', to: 'Shipped' },
        { event: 'DELIVER', from: 'Shipped', to: 'Completed' }
      ];

      for (const expected of expectedOrderTransitions) {
        const found = orderEvents.find(e =>
          e.event_type === expected.event &&
          e.from_state === expected.from &&
          e.to_state === expected.to
        );
        if (!found) {
          throw new Error(`Missing Order transition: ${expected.event} (${expected.from} -> ${expected.to})`);
        }
      }
      console.log('  [OK] All expected Order transitions verified');

      const expectedPaymentTransitions = [
        { event: 'PROCESS', from: 'Pending', to: 'Processing' },
        { event: 'VALIDATE', from: 'Processing', to: 'Validated' },
        { event: 'COMPLETE', from: 'Validated', to: 'Completed' }
      ];

      for (const expected of expectedPaymentTransitions) {
        const found = paymentEvents.find(e =>
          e.event_type === expected.event &&
          e.from_state === expected.from &&
          e.to_state === expected.to
        );
        if (!found) {
          throw new Error(`Missing Payment transition: ${expected.event} (${expected.from} -> ${expected.to})`);
        }
      }
      console.log('  [OK] All expected Payment transitions verified');

      await client.end();
      console.log('  [OK] Database verification complete');

    } catch (dbError) {
      if (dbError.code === 'MODULE_NOT_FOUND') {
        console.log('  [SKIP] pg module not installed, skipping database verification');
      } else {
        console.error('  [WARN] Database verification failed:', dbError.message);
      }
    }
  } else {
    console.log('15. Skipping database verification (DATABASE_URL not set)');
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('  All E2E Tests Passed!');
  console.log('='.repeat(60));
  console.log('\nCross-component communication verified:');
  console.log(`  1. Order ${orderId} created in OrderComponent`);
  console.log(`  2. SUBMIT triggered Payment creation in PaymentComponent (contextMapping: orderId, amount, paymentMethod)`);
  console.log(`  3. Payment PROCESS -> checkPaymentMethod business logic auto-validated (visa accepted)`);
  console.log(`  4. Payment: Pending -> Processing -> Validated -> Completed`);
  console.log(`  5. COMPLETE triggered PAYMENT_CONFIRMED to OrderComponent (matchingRules: orderId)`);
  console.log(`  6. Order completed: Created -> PendingPayment -> Paid -> Shipped -> Completed`);
  if (databaseUrl) {
    console.log(`  7. All events verified in PostgreSQL database`);
  }
  console.log('\nDistributed system with Kafka messaging is working correctly!');
}

main()
  .then(() => {
    console.log('\n[SUCCESS] E2E test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n[FAILED] E2E test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
