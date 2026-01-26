#!/usr/bin/env node
/**
 * End-to-end test for distributed Order/Payment flow
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
const TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 1000;

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

async function main() {
  console.log('='.repeat(60));
  console.log('  E2E Test: Distributed Order/Payment Cross-Component Flow');
  console.log('='.repeat(60));
  console.log(`Dashboard URL: ${DASHBOARD_URL}\n`);

  // ============================================================
  // Phase 1: Infrastructure Health
  // ============================================================
  console.log('\n--- Phase 1: Infrastructure Health ---\n');

  // Test 1: Dashboard health
  console.log('1. Checking dashboard health...');
  const health = await fetchJson(`${DASHBOARD_URL}/health`);
  if (health.status !== 'ok') {
    throw new Error(`Dashboard not healthy: ${JSON.stringify(health)}`);
  }
  console.log(`  [OK] Dashboard healthy (mode: ${health.mode})`);

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
    customerId: 'customer-123'
  };

  console.log(`4. Creating Order instance (${orderId})...`);
  const createOrderResult = await fetchJson(
    `${DASHBOARD_URL}/api/components/OrderComponent/instances`,
    {
      method: 'POST',
      body: JSON.stringify({
        machineName: 'Order',
        context: orderContext
      })
    }
  );

  const orderInstanceId = createOrderResult.instanceId || createOrderResult.instance?.instanceId;
  if (!orderInstanceId) {
    throw new Error(`Failed to create order instance: ${JSON.stringify(createOrderResult)}`);
  }
  console.log(`  [OK] Order instance created: ${orderInstanceId}`);

  // Verify order is in Created state
  console.log('\n5. Verifying Order is in Created state...');
  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const order = instances.instances && instances.instances.find(
        i => i.instanceId === orderInstanceId
      );
      return order && order.currentState === 'Created' ? order : null;
    },
    'Order instance in Created state'
  );

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
        i => i.instanceId === orderInstanceId
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
      // Find a Payment instance that was created after our order
      paymentInstance = instances.instances && instances.instances.find(
        i => i.componentName === 'PaymentComponent' &&
             i.machineName === 'Payment' &&
             i.context && i.context.orderId === orderId
      );
      return paymentInstance ? paymentInstance : null;
    },
    'Payment instance created with matching orderId'
  );
  console.log(`   Payment instance: ${paymentInstance.instanceId}`);

  // ============================================================
  // Phase 4: Process Payment
  // ============================================================
  console.log('\n--- Phase 4: Process Payment ---\n');

  const paymentInstanceId = paymentInstance.instanceId;

  // Send PROCESS event
  console.log('9. Sending PROCESS event to Payment...');
  await fetchJson(
    `${DASHBOARD_URL}/api/components/PaymentComponent/instances/${paymentInstanceId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ event: 'PROCESS' })
    }
  );

  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const payment = instances.instances && instances.instances.find(
        i => i.instanceId === paymentInstanceId
      );
      return payment && payment.currentState === 'Processing' ? payment : null;
    },
    'Payment in Processing state'
  );

  // Send VALIDATE event
  console.log('\n10. Sending VALIDATE event to Payment...');
  await fetchJson(
    `${DASHBOARD_URL}/api/components/PaymentComponent/instances/${paymentInstanceId}/events`,
    {
      method: 'POST',
      body: JSON.stringify({ event: 'VALIDATE' })
    }
  );

  await waitFor(
    async () => {
      const instances = await fetchJson(`${DASHBOARD_URL}/api/instances`);
      const payment = instances.instances && instances.instances.find(
        i => i.instanceId === paymentInstanceId
      );
      return payment && payment.currentState === 'Validated' ? payment : null;
    },
    'Payment in Validated state'
  );

  // ============================================================
  // Phase 5: Complete Payment (Cross-Component Response)
  // ============================================================
  console.log('\n--- Phase 5: Complete Payment (notifies Order) ---\n');

  console.log('11. Sending COMPLETE event to Payment...');
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
        i => i.instanceId === paymentInstanceId
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
        i => i.instanceId === orderInstanceId
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
        i => i.instanceId === orderInstanceId
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
        i => i.instanceId === orderInstanceId
      );
      return order && order.currentState === 'Completed' ? order : null;
    },
    'Order in Completed state (final)'
  );

  // ============================================================
  // Summary
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('  All E2E Tests Passed!');
  console.log('='.repeat(60));
  console.log('\nCross-component communication verified:');
  console.log(`  1. Order ${orderId} created in OrderComponent`);
  console.log(`  2. SUBMIT triggered Payment creation in PaymentComponent`);
  console.log(`  3. Payment processed: Pending -> Processing -> Validated -> Completed`);
  console.log(`  4. COMPLETE triggered PAYMENT_CONFIRMED to OrderComponent`);
  console.log(`  5. Order completed: Created -> PendingPayment -> Paid -> Shipped -> Completed`);
  console.log('\nDistributed system with RabbitMQ messaging is working correctly!');
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
