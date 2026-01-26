/**
 * Cross-Component E2E Test (In-Memory)
 *
 * Tests the complete Order/Payment cross-component communication flow
 * using in-memory message broker. This test runs without Docker and
 * can be included in the regular test suite.
 *
 * Flow tested:
 * 1. Create Order instance
 * 2. SUBMIT Order → creates Payment instance (cross-component)
 * 3. Process Payment: PROCESS → VALIDATE → COMPLETE
 * 4. COMPLETE Payment → sends PAYMENT_CONFIRMED to Order (cross-component)
 * 5. Order transitions to Paid
 * 6. Complete Order: SHIP → DELIVER → Completed
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { FSMRuntime } from '../src/fsm-runtime';
import { RuntimeBroadcaster } from '../src/runtime-broadcaster';
import { InMemoryMessageBroker } from '../src/message-broker';
import { Component } from '../src/types';

// Helper to wait for a condition
async function waitFor(
  condition: () => Promise<boolean>,
  description: string,
  timeoutMs: number = 5000,
  pollMs: number = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`Timeout waiting for: ${description}`);
}

describe('Cross-Component E2E (In-Memory)', () => {
  let orderComponent: Component;
  let paymentComponent: Component;
  let orderRuntime: FSMRuntime;
  let paymentRuntime: FSMRuntime;
  let orderBroadcaster: RuntimeBroadcaster;
  let paymentBroadcaster: RuntimeBroadcaster;

  beforeAll(async () => {
    // Reset the singleton broker to ensure clean state
    InMemoryMessageBroker.resetInstance();

    // Load components from YAML
    const orderYaml = fs.readFileSync(
      path.join(__dirname, '../examples/distributed/order-component.yaml'),
      'utf-8'
    );
    const paymentYaml = fs.readFileSync(
      path.join(__dirname, '../examples/distributed/payment-component.yaml'),
      'utf-8'
    );

    orderComponent = yaml.parse(orderYaml) as Component;
    paymentComponent = yaml.parse(paymentYaml) as Component;

    // Create runtimes
    orderRuntime = new FSMRuntime(orderComponent);
    paymentRuntime = new FSMRuntime(paymentComponent);

    // Create broadcasters - they will share the singleton InMemoryMessageBroker
    orderBroadcaster = new RuntimeBroadcaster(orderRuntime, orderComponent, {
      brokerUrl: 'memory'
    });
    paymentBroadcaster = new RuntimeBroadcaster(paymentRuntime, paymentComponent, {
      brokerUrl: 'memory'
    });

    // Connect broadcasters
    await orderBroadcaster.connect();
    await paymentBroadcaster.connect();
  });

  afterAll(async () => {
    await orderBroadcaster.disconnect();
    await paymentBroadcaster.disconnect();
    // Reset the singleton for other test suites
    InMemoryMessageBroker.resetInstance();
  });

  it('should complete full Order/Payment cross-component flow', async () => {
    const orderId = `order-${Date.now()}`;
    const orderContext = {
      orderId,
      amount: 99.99,
      customerId: 'customer-123'
    };

    // Phase 1: Create Order instance
    const orderInstanceId = orderRuntime.createInstance('Order', orderContext);
    expect(orderInstanceId).toBeDefined();

    const orderInstance = orderRuntime.getInstance(orderInstanceId);
    expect(orderInstance?.currentState).toBe('Created');

    // Phase 2: SUBMIT Order (should trigger Payment creation)
    await orderRuntime.sendEvent(orderInstanceId, {
      type: 'SUBMIT',
      payload: {},
      timestamp: Date.now()
    });

    // Verify Order is in PendingPayment
    const orderAfterSubmit = orderRuntime.getInstance(orderInstanceId);
    expect(orderAfterSubmit?.currentState).toBe('PendingPayment');

    // Wait for Payment instance to be created (cross-component)
    let paymentInstanceId: string | undefined;
    await waitFor(
      async () => {
        const paymentInstances = paymentRuntime.getAllInstances();
        const payment = paymentInstances.find(
          i => i.context?.orderId === orderId
        );
        if (payment) {
          paymentInstanceId = payment.id;
          return true;
        }
        return false;
      },
      'Payment instance created',
      3000
    );

    expect(paymentInstanceId).toBeDefined();
    const paymentInstance = paymentRuntime.getInstance(paymentInstanceId!);
    expect(paymentInstance?.currentState).toBe('Pending');
    expect(paymentInstance?.context?.orderId).toBe(orderId);

    // Phase 3: Process Payment
    await paymentRuntime.sendEvent(paymentInstanceId!, {
      type: 'PROCESS',
      payload: {},
      timestamp: Date.now()
    });

    const paymentAfterProcess = paymentRuntime.getInstance(paymentInstanceId!);
    expect(paymentAfterProcess?.currentState).toBe('Processing');

    // Phase 4: Validate Payment
    await paymentRuntime.sendEvent(paymentInstanceId!, {
      type: 'VALIDATE',
      payload: {},
      timestamp: Date.now()
    });

    const paymentAfterValidate = paymentRuntime.getInstance(paymentInstanceId!);
    expect(paymentAfterValidate?.currentState).toBe('Validated');

    // Phase 5: Complete Payment (should trigger PAYMENT_CONFIRMED to Order)
    await paymentRuntime.sendEvent(paymentInstanceId!, {
      type: 'COMPLETE',
      payload: {},
      timestamp: Date.now()
    });

    // Payment should be in Completed (final) state - may be disposed
    // Wait a bit for the cross-component message to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Phase 6: Verify Order received PAYMENT_CONFIRMED
    await waitFor(
      async () => {
        const order = orderRuntime.getInstance(orderInstanceId);
        return order?.currentState === 'Paid';
      },
      'Order transitioned to Paid',
      3000
    );

    const orderAfterPayment = orderRuntime.getInstance(orderInstanceId);
    expect(orderAfterPayment?.currentState).toBe('Paid');

    // Phase 7: Complete Order flow
    await orderRuntime.sendEvent(orderInstanceId, {
      type: 'SHIP',
      payload: {},
      timestamp: Date.now()
    });

    const orderAfterShip = orderRuntime.getInstance(orderInstanceId);
    expect(orderAfterShip?.currentState).toBe('Shipped');

    await orderRuntime.sendEvent(orderInstanceId, {
      type: 'DELIVER',
      payload: {},
      timestamp: Date.now()
    });

    // Note: After DELIVER, Order reaches 'Completed' (FINAL state) and is disposed
    // We can't check the state directly, but if sendEvent succeeded without error,
    // the transition happened. We can verify the instance no longer exists.
    await new Promise(resolve => setTimeout(resolve, 50)); // Allow async disposal
    const orderAfterDeliver = orderRuntime.getInstance(orderInstanceId);
    expect(orderAfterDeliver).toBeUndefined(); // Instance disposed after FINAL state
  });

  it('should handle PAYMENT_FAILED cross-component event', async () => {
    const orderId = `order-fail-${Date.now()}`;
    const orderContext = {
      orderId,
      amount: 100,
      customerId: 'customer-456'
    };

    // Create and submit Order
    const orderInstanceId = orderRuntime.createInstance('Order', orderContext);
    await orderRuntime.sendEvent(orderInstanceId, {
      type: 'SUBMIT',
      payload: {},
      timestamp: Date.now()
    });

    // Wait for Payment instance
    let paymentInstanceId: string | undefined;
    await waitFor(
      async () => {
        const paymentInstances = paymentRuntime.getAllInstances();
        const payment = paymentInstances.find(
          i => i.context?.orderId === orderId
        );
        if (payment) {
          paymentInstanceId = payment.id;
          return true;
        }
        return false;
      },
      'Payment instance created for failure test',
      3000
    );

    // Process and then REJECT Payment
    await paymentRuntime.sendEvent(paymentInstanceId!, {
      type: 'PROCESS',
      payload: {},
      timestamp: Date.now()
    });

    await paymentRuntime.sendEvent(paymentInstanceId!, {
      type: 'REJECT',
      payload: { reason: 'Insufficient funds' },
      timestamp: Date.now()
    });

    // Wait for Order to receive PAYMENT_FAILED
    // Note: Cancelled is a FINAL state, so instance will be disposed
    await waitFor(
      async () => {
        // Check if instance was disposed (reached FINAL state)
        const order = orderRuntime.getInstance(orderInstanceId);
        return order === undefined || order.currentState === 'Cancelled';
      },
      'Order transitioned to Cancelled after payment failure',
      3000
    );

    // Instance should be disposed (Cancelled is FINAL)
    const orderAfterFail = orderRuntime.getInstance(orderInstanceId);
    expect(orderAfterFail).toBeUndefined();
  });

  it('should create multiple independent order/payment flows', async () => {
    const orders = [
      { orderId: `multi-order-1-${Date.now()}`, amount: 50 },
      { orderId: `multi-order-2-${Date.now()}`, amount: 75 },
      { orderId: `multi-order-3-${Date.now()}`, amount: 100 }
    ];

    // Create all orders
    const orderInstanceIds = orders.map(o =>
      orderRuntime.createInstance('Order', {
        orderId: o.orderId,
        amount: o.amount,
        customerId: 'multi-customer'
      })
    );

    // Submit all orders (creates payments)
    for (const instanceId of orderInstanceIds) {
      await orderRuntime.sendEvent(instanceId, {
        type: 'SUBMIT',
        payload: {},
        timestamp: Date.now()
      });
    }

    // Wait for all payments to be created
    await waitFor(
      async () => {
        const paymentInstances = paymentRuntime.getAllInstances();
        const matchingPayments = paymentInstances.filter(p =>
          orders.some(o => p.context?.orderId === o.orderId)
        );
        return matchingPayments.length >= orders.length;
      },
      'All Payment instances created',
      5000
    );

    // Verify each payment has correct orderId
    for (const order of orders) {
      const paymentInstances = paymentRuntime.getAllInstances();
      const payment = paymentInstances.find(
        p => p.context?.orderId === order.orderId
      );
      expect(payment).toBeDefined();
      expect(payment?.context?.amount).toBe(order.amount);
    }
  });
});
