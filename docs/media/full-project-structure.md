# Complete Project Example: E-Commerce Platform

This example shows how to structure a complete e-commerce application using xcomponent-ai as a framework to sanctuarize business logic.

## Project Structure

```
ecommerce-platform/
├── fsm/                              # 🔒 BUSINESS LOGIC (Sanctuarized)
│   ├── order-management.yaml
│   ├── payment-processing.yaml
│   ├── inventory-control.yaml
│   └── shipping-workflow.yaml
├── src/
│   ├── runtime/                      # FSM Runtime Layer
│   │   ├── index.ts                  # Runtime initialization
│   │   ├── order-runtime.ts
│   │   ├── payment-runtime.ts
│   │   └── monitoring.ts
│   ├── api/                          # Technical Layer (REST API)
│   │   ├── server.ts
│   │   ├── routes/
│   │   │   ├── order-routes.ts       # Translates HTTP → FSM events
│   │   │   ├── payment-routes.ts
│   │   │   └── webhook-routes.ts
│   │   └── middleware/
│   │       ├── auth.ts
│   │       └── validation.ts
│   ├── ui/                           # Frontend (React)
│   │   ├── components/
│   │   │   ├── OrderFlow.tsx
│   │   │   ├── PaymentWidget.tsx
│   │   │   └── OrderTracking.tsx
│   │   └── hooks/
│   │       └── useFSMState.ts
│   ├── services/                     # External Integrations
│   │   ├── stripe-service.ts
│   │   ├── shipping-provider.ts
│   │   └── inventory-sync.ts
│   └── database/
│       ├── models/                   # Data persistence (NOT business logic)
│       └── migrations/
├── tests/
│   ├── fsm/                          # FSM Simulation Tests
│   │   ├── order-flow.test.ts
│   │   └── payment-scenarios.test.ts
│   ├── integration/                  # API Integration Tests
│   └── e2e/                          # End-to-End Tests
├── docker-compose.yml
└── README.md
```

## FSM Definitions (Business Logic)

### 1. Order Management (`fsm/order-management.yaml`)

```yaml
name: OrderComponent
version: 2.1.0
metadata:
  domain: ecommerce
  owner: business-team
  compliance:
    - GDPR (customer data handling)
    - PCI DSS (payment data)
  changelog:
    - "2.1.0: Added fraud check state"
    - "2.0.0: Inter-machine payment integration"

stateMachines:
  - name: OrderLifecycle
    initialState: CartPending
    metadata:
      description: Order from cart to delivery
      sla: 7 days max
    states:
      - name: CartPending
        type: entry
        entryMethod: createCart
        metadata:
          description: Customer adding items to cart
      - name: OrderSubmitted
        type: regular
        entryMethod: validateOrder
      - name: FraudCheck
        type: regular
        entryMethod: runFraudDetection
      - name: PaymentPending
        type: regular
      - name: PaymentConfirmed
        type: regular
        entryMethod: reserveInventory
      - name: Shipped
        type: regular
        entryMethod: generateTrackingNumber
      - name: Delivered
        type: final
        metadata:
          description: Order successfully completed
      - name: Cancelled
        type: error
      - name: FraudRejected
        type: error
    transitions:
      # Cart to Order
      - from: CartPending
        to: OrderSubmitted
        event: CHECKOUT
        type: triggerable
        guards:
          - keys: [customerId, items, shippingAddress]
          - customFunction: "event.payload.items.length > 0"
          - customFunction: "event.payload.totalAmount >= 1"
        triggeredMethod: sendOrderConfirmationEmail

      # Fraud check
      - from: OrderSubmitted
        to: FraudCheck
        event: START_FRAUD_CHECK
        type: triggerable

      - from: FraudCheck
        to: PaymentPending
        event: FRAUD_CHECK_PASSED
        guards:
          - customFunction: "event.payload.riskScore < 0.3"

      - from: FraudCheck
        to: FraudRejected
        event: FRAUD_CHECK_FAILED
        guards:
          - customFunction: "event.payload.riskScore >= 0.8"

      # Payment flow (inter-machine)
      - from: PaymentPending
        to: PaymentConfirmed
        event: PAYMENT_SUCCESS
        type: inter_machine
        targetMachine: Payment
        triggeredMethod: notifyWarehouse

      - from: PaymentPending
        to: Cancelled
        event: PAYMENT_FAILED

      - from: PaymentPending
        to: Cancelled
        event: TIMEOUT
        type: timeout
        timeoutMs: 900000  # 15 minutes

      # Shipping
      - from: PaymentConfirmed
        to: Shipped
        event: SHIPPED
        guards:
          - keys: [trackingNumber, carrier]

      - from: Shipped
        to: Delivered
        event: DELIVERY_CONFIRMED
        guards:
          - keys: [deliveryTimestamp, signature]

      # Cancellation (from multiple states)
      - from: CartPending
        to: Cancelled
        event: CANCEL_ORDER

      - from: OrderSubmitted
        to: Cancelled
        event: CANCEL_ORDER

      - from: PaymentPending
        to: Cancelled
        event: CANCEL_ORDER
```

### 2. Payment Processing (`fsm/payment-processing.yaml`)

```yaml
name: PaymentComponent
version: 1.3.0

stateMachines:
  - name: Payment
    initialState: Authorizing
    states:
      - name: Authorizing
        type: entry
        entryMethod: requestPaymentAuthorization
      - name: Authorized
        type: regular
      - name: Capturing
        type: regular
        entryMethod: capturePayment
      - name: Captured
        type: final
      - name: Failed
        type: error
    transitions:
      - from: Authorizing
        to: Authorized
        event: AUTHORIZATION_SUCCESS
        guards:
          - keys: [authorizationCode, cardLast4]

      - from: Authorizing
        to: Failed
        event: AUTHORIZATION_FAILED

      - from: Authorized
        to: Capturing
        event: CAPTURE
        type: triggerable

      - from: Capturing
        to: Captured
        event: CAPTURE_SUCCESS

      - from: Capturing
        to: Failed
        event: CAPTURE_FAILED
```

## Runtime Layer

### Initialize Runtimes (`src/runtime/index.ts`)

```typescript
import { FSMRuntime } from 'xcomponent-ai';
import { monitoringService } from 'xcomponent-ai';
import * as yaml from 'yaml';
import * as fs from 'fs';

// Load FSM definitions from sanctuarized directory
const orderFSM = yaml.parse(
  fs.readFileSync('./fsm/order-management.yaml', 'utf-8')
);
const paymentFSM = yaml.parse(
  fs.readFileSync('./fsm/payment-processing.yaml', 'utf-8')
);

// Create runtimes
export const orderRuntime = new FSMRuntime(orderFSM);
export const paymentRuntime = new FSMRuntime(paymentFSM);

// Setup monitoring
orderRuntime.on('state_change', (data) => {
  monitoringService.logTransition({
    instanceId: data.instanceId,
    from: data.previousState,
    to: data.newState,
    event: data.event.type,
    time: data.timestamp,
  });

  console.log(`[ORDER ${data.instanceId}] ${data.previousState} → ${data.newState}`);
});

orderRuntime.on('instance_error', (data) => {
  console.error(`[ORDER ERROR] ${data.instanceId}: ${data.error}`);
  // Trigger alert to ops team
});

// Listen for triggered methods
orderRuntime.on('triggered_method', async (data) => {
  switch (data.method) {
    case 'sendOrderConfirmationEmail':
      // External service call
      await emailService.sendOrderConfirmation(data.event.payload);
      break;
    case 'notifyWarehouse':
      await warehouseAPI.createPickingTask(data.event.payload);
      break;
    case 'generateTrackingNumber':
      const trackingNumber = await shippingProvider.createShipment(data.event.payload);
      // Update instance context
      break;
  }
});

// Inter-machine coordination
paymentRuntime.on('instance_disposed', async (instance) => {
  if (instance.status === 'completed') {
    // Payment successful, trigger order confirmation
    const orderId = instance.context.orderId;
    await orderRuntime.sendEvent(orderId, {
      type: 'PAYMENT_SUCCESS',
      payload: { paymentId: instance.id, ...instance.context },
      timestamp: Date.now(),
    });
  }
});
```

## API Layer (Technical Code)

### Order Routes (`src/api/routes/order-routes.ts`)

```typescript
import express from 'express';
import { orderRuntime } from '../../runtime';
import { authenticate } from '../middleware/auth';
import { validateOrderPayload } from '../middleware/validation';

const router = express.Router();

/**
 * Create order (checkout from cart)
 * Translates HTTP POST → FSM CHECKOUT event
 */
router.post('/orders', authenticate, validateOrderPayload, async (req, res) => {
  try {
    const { items, shippingAddress, totalAmount } = req.body;
    const customerId = req.user.id;

    // Create FSM instance (business logic starts here)
    const orderId = orderRuntime.createInstance('OrderLifecycle', {
      customerId,
      items,
      shippingAddress,
      totalAmount,
      createdAt: Date.now(),
    });

    // Trigger checkout event
    await orderRuntime.sendEvent(orderId, {
      type: 'CHECKOUT',
      payload: { customerId, items, shippingAddress, totalAmount },
      timestamp: Date.now(),
    });

    // Start fraud check
    await orderRuntime.sendEvent(orderId, {
      type: 'START_FRAUD_CHECK',
      payload: { customerId, totalAmount, items },
      timestamp: Date.now(),
    });

    res.status(201).json({
      orderId,
      status: 'submitted',
      message: 'Order submitted, running fraud check',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get order status
 * Reads from FSM runtime
 */
router.get('/orders/:orderId', authenticate, async (req, res) => {
  const { orderId } = req.params;

  const instance = orderRuntime.getInstance(orderId);

  if (!instance) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json({
    orderId: instance.id,
    currentState: instance.currentState,
    status: instance.status,
    context: instance.context,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
  });
});

/**
 * Cancel order
 * Translates DELETE → FSM CANCEL_ORDER event
 */
router.delete('/orders/:orderId', authenticate, async (req, res) => {
  const { orderId } = req.params;

  try {
    await orderRuntime.sendEvent(orderId, {
      type: 'CANCEL_ORDER',
      payload: { reason: req.body.reason || 'Customer requested' },
      timestamp: Date.now(),
    });

    res.json({ message: 'Order cancelled' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * Webhook from fraud detection service
 * External event triggers FSM transition
 */
router.post('/webhooks/fraud-check', async (req, res) => {
  const { orderId, riskScore, passed } = req.body;

  await orderRuntime.sendEvent(orderId, {
    type: passed ? 'FRAUD_CHECK_PASSED' : 'FRAUD_CHECK_FAILED',
    payload: { riskScore },
    timestamp: Date.now(),
  });

  res.json({ received: true });
});

/**
 * Webhook from shipping provider
 * Delivery confirmation
 */
router.post('/webhooks/delivery', async (req, res) => {
  const { orderId, trackingNumber, deliveryTimestamp, signature } = req.body;

  await orderRuntime.sendEvent(orderId, {
    type: 'DELIVERY_CONFIRMED',
    payload: { trackingNumber, deliveryTimestamp, signature },
    timestamp: Date.now(),
  });

  res.json({ received: true });
});

export default router;
```

## UI Components

### Order Flow Component (`src/ui/components/OrderFlow.tsx`)

```typescript
import React, { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';

interface OrderState {
  orderId: string;
  currentState: string;
  status: string;
  context: any;
}

export const OrderFlow: React.FC<{ orderId: string }> = ({ orderId }) => {
  const [orderState, setOrderState] = useState<OrderState | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    // Fetch initial state
    axios.get(`/api/orders/${orderId}`).then((res) => {
      setOrderState(res.data);
    });

    // Subscribe to real-time updates via WebSocket
    const ws = io('http://localhost:3000');
    ws.emit('subscribe_instance', {
      componentName: 'OrderComponent',
      instanceId: orderId,
    });

    ws.on('state_change', (data) => {
      if (data.instanceId === orderId) {
        setOrderState((prev) => ({
          ...prev!,
          currentState: data.newState,
        }));
      }
    });

    setSocket(ws);

    return () => {
      ws.close();
    };
  }, [orderId]);

  if (!orderState) return <div>Loading...</div>;

  return (
    <div className="order-flow">
      <h2>Order {orderId}</h2>

      <div className="status-indicator">
        <Status state={orderState.currentState} />
      </div>

      <ProgressBar state={orderState.currentState} />

      {orderState.currentState === 'PaymentPending' && (
        <PaymentWidget orderId={orderId} amount={orderState.context.totalAmount} />
      )}

      {orderState.currentState === 'Shipped' && (
        <TrackingInfo trackingNumber={orderState.context.trackingNumber} />
      )}

      {['CartPending', 'OrderSubmitted', 'PaymentPending'].includes(orderState.currentState) && (
        <button onClick={() => handleCancel(orderId)}>Cancel Order</button>
      )}
    </div>
  );
};

const Status: React.FC<{ state: string }> = ({ state }) => {
  const stateLabels: Record<string, string> = {
    CartPending: '🛒 Cart',
    OrderSubmitted: '📋 Submitted',
    FraudCheck: '🔍 Fraud Check',
    PaymentPending: '💳 Payment',
    PaymentConfirmed: '✅ Confirmed',
    Shipped: '📦 Shipped',
    Delivered: '🎉 Delivered',
    Cancelled: '❌ Cancelled',
    FraudRejected: '⛔ Rejected',
  };

  return <span className={`status-${state}`}>{stateLabels[state]}</span>;
};

const ProgressBar: React.FC<{ state: string }> = ({ state }) => {
  const states = ['CartPending', 'OrderSubmitted', 'PaymentConfirmed', 'Shipped', 'Delivered'];
  const currentIndex = states.indexOf(state);

  return (
    <div className="progress-bar">
      {states.map((s, i) => (
        <div key={s} className={i <= currentIndex ? 'active' : 'inactive'}>
          {s}
        </div>
      ))}
    </div>
  );
};

const handleCancel = async (orderId: string) => {
  if (confirm('Cancel this order?')) {
    await axios.delete(`/api/orders/${orderId}`, {
      data: { reason: 'Customer requested' },
    });
  }
};
```

## External Service Integration

### Fraud Detection Service (`src/services/fraud-detection.ts`)

```typescript
import axios from 'axios';
import { orderRuntime } from '../runtime';

export class FraudDetectionService {
  private apiKey = process.env.FRAUD_API_KEY;

  async analyzeFraud(orderId: string, payload: any): Promise<void> {
    // Call external fraud API
    const response = await axios.post(
      'https://fraud-api.example.com/analyze',
      {
        customerId: payload.customerId,
        amount: payload.totalAmount,
        items: payload.items,
        callbackUrl: `${process.env.BASE_URL}/webhooks/fraud-check`,
      },
      { headers: { 'X-API-Key': this.apiKey } }
    );

    console.log(`Fraud check initiated: ${response.data.checkId}`);
    // Webhook will trigger FSM event when analysis is complete
  }
}

// Hook into FSM triggered methods
orderRuntime.on('triggered_method', async (data) => {
  if (data.method === 'runFraudDetection') {
    const fraudService = new FraudDetectionService();
    await fraudService.analyzeFraud(data.instanceId, data.event.payload);
  }
});
```

## Testing

### FSM Simulation Tests (`tests/fsm/order-flow.test.ts`)

```typescript
import { orderRuntime } from '../../src/runtime';

describe('Order Lifecycle FSM', () => {
  it('should complete full order flow', () => {
    const result = orderRuntime.simulatePath('OrderLifecycle', [
      { type: 'CHECKOUT', payload: { items: [1, 2], totalAmount: 100 }, timestamp: Date.now() },
      { type: 'START_FRAUD_CHECK', payload: {}, timestamp: Date.now() },
      { type: 'FRAUD_CHECK_PASSED', payload: { riskScore: 0.1 }, timestamp: Date.now() },
      { type: 'PAYMENT_SUCCESS', payload: {}, timestamp: Date.now() },
      { type: 'SHIPPED', payload: { trackingNumber: 'TRACK123', carrier: 'UPS' }, timestamp: Date.now() },
      { type: 'DELIVERY_CONFIRMED', payload: { deliveryTimestamp: Date.now(), signature: 'John' }, timestamp: Date.now() },
    ]);

    expect(result.success).toBe(true);
    expect(result.path).toEqual([
      'CartPending',
      'OrderSubmitted',
      'FraudCheck',
      'PaymentPending',
      'PaymentConfirmed',
      'Shipped',
      'Delivered',
    ]);
  });

  it('should reject high-risk orders', () => {
    const result = orderRuntime.simulatePath('OrderLifecycle', [
      { type: 'CHECKOUT', payload: { items: [1], totalAmount: 10000 }, timestamp: Date.now() },
      { type: 'START_FRAUD_CHECK', payload: {}, timestamp: Date.now() },
      { type: 'FRAUD_CHECK_FAILED', payload: { riskScore: 0.9 }, timestamp: Date.now() },
    ]);

    expect(result.success).toBe(true);
    expect(result.path).toEqual(['CartPending', 'OrderSubmitted', 'FraudCheck', 'FraudRejected']);
  });

  it('should timeout unpaid orders', () => {
    // Timeout test would require real-time execution or mocking
  });
});
```

## Key Takeaways

1. **Business logic is in YAML** (`fsm/` directory) - sanctuarized and versioned
2. **API routes are thin wrappers** - translate HTTP → FSM events
3. **UI components react to FSM state** - via WebSocket or polling
4. **External services hook into FSM events** - via triggered methods
5. **Tests focus on FSM paths first** - business logic validation
6. **Compliance is explicit** - metadata in FSM definitions

This structure ensures **business logic separation**, **auditability**, and **maintainability** at scale.
