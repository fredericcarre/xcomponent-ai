# Sender Broadcast Guide

This guide explains how to broadcast events from triggered methods using the `sender` parameter.

---

## Sender API

The `sender` object is available in all triggered method, onEntry, and onExit handlers.

### Full API

```typescript
interface Sender {
  // Send event to current instance
  sendToSelf(event: FSMEvent): Promise<void>;

  // Send to specific instance (same component)
  sendTo(instanceId: string, event: FSMEvent): Promise<void>;

  // Send to specific instance (other component)
  sendToComponent(componentName: string, instanceId: string, event: FSMEvent): Promise<void>;

  // Broadcast to instances (same or cross-component)
  broadcast(
    machineName: string,
    event: FSMEvent,
    currentState?: string,      // Optional: target only instances in this state
    componentName?: string       // Optional: target another component
  ): Promise<number>;

  // Create new instance (same component)
  createInstance(machineName: string, initialContext: Record<string, any>): string;

  // Create new instance (other component)
  createInstanceInComponent(
    componentName: string,
    machineName: string,
    initialContext: Record<string, any>
  ): string;
}
```

---

## `sendTo()` - Send to Specific Instance

```typescript
await sender.sendTo(instanceId, event);
```

**Example YAML** -- declare the method name on the transition:
```yaml
transitions:
  - from: Validated
    to: Confirmed
    event: CONFIRM
    type: triggerable
    triggeredMethod: notifyPayment
```

**Example TypeScript** -- implement the handler:
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'notifyPayment') {
    await sender.sendTo(context.paymentInstanceId, {
      type: 'ORDER_CONFIRMED',
      payload: { orderId: context.orderId },
      timestamp: Date.now()
    });
  }
});
```

---

## `broadcast()` - Broadcast to Multiple Instances

### Signature

```typescript
sender.broadcast(
  machineName: string,          // Target state machine
  event: FSMEvent,              // Event to send
  currentState?: string,        // Optional: only instances in this state
  componentName?: string        // Optional: target another component
): Promise<number>              // Returns number of instances that received the event
```

### Broadcast to All Instances (Any State)

```typescript
await sender.broadcast('Order', {
  type: 'SYSTEM_ALERT',
  payload: { message: 'Maintenance in 5 minutes' },
  timestamp: Date.now()
});
```

### Broadcast to Specific State

```typescript
await sender.broadcast(
  'Order',
  {
    type: 'TIMEOUT_CHECK',
    payload: {},
    timestamp: Date.now()
  },
  'Pending'  // Only instances in Pending state
);
```

### Cross-Component Broadcast

```typescript
await sender.broadcast(
  'Payment',
  {
    type: 'ORDER_COMPLETED',
    payload: { orderId: context.orderId },
    timestamp: Date.now()
  },
  undefined,            // Any state
  'PaymentComponent'    // Target component
);
```

### Cross-Component Broadcast to Specific State

```typescript
await sender.broadcast(
  'Payment',
  {
    type: 'REFUND_REQUESTED',
    payload: { orderId: context.orderId },
    timestamp: Date.now()
  },
  'Authorized',         // Only payments in Authorized state
  'PaymentComponent'    // Target component
);
```

---

## Instance Filtering with matchingRules

The `sender.broadcast()` method does **not** accept filters. Instance filtering is done declaratively via `matchingRules` on the **target** transition in YAML.

### How it Works

1. A triggered method broadcasts an event (with data in the payload)
2. The target machine has a transition with `matchingRules`
3. The runtime routes the event only to instances where matching rules pass

### Example

**Source** -- triggered method broadcasts to all RiskMonitors:

```yaml
# Order machine
transitions:
  - from: PartiallyExecuted
    to: PartiallyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: notifyRiskMonitors
```

```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'notifyRiskMonitors') {
    // Broadcast to RiskMonitor — matching rules on the target filter the instances
    await sender.broadcast('RiskMonitor', {
      type: 'ORDER_EXECUTION_UPDATE',
      payload: {
        customerId: context.customerId,   // This value is matched by the target
        orderId: context.orderId,
        executedQuantity: context.executedQuantity
      },
      timestamp: Date.now()
    });
  }
});
```

**Target** -- matchingRules filter which instances receive the event:

```yaml
# RiskMonitor machine
transitions:
  - from: Monitoring
    to: Monitoring
    event: ORDER_EXECUTION_UPDATE
    type: regular
    matchingRules:
      - eventProperty: customerId        # From event.payload.customerId
        instanceProperty: customerId     # Match against instance context.customerId
    triggeredMethod: updateRiskMetrics
```

Only RiskMonitor instances whose `context.customerId` matches `event.payload.customerId` will receive the event.

---

## Common Patterns

### Pattern 1: Notify Related Instances

**YAML:**
```yaml
transitions:
  - from: Active
    to: Active
    event: ORDER_UPDATED
    type: triggerable
    triggeredMethod: onOrderUpdate
```

**TypeScript:**
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'onOrderUpdate') {
    // Broadcast to all RiskMonitors
    // matchingRules on the RiskMonitor transition will filter by customerId
    await sender.broadcast('RiskMonitor', {
      type: 'ORDER_EVENT',
      payload: {
        customerId: context.customerId,
        orderId: context.orderId,
        amount: context.amount
      },
      timestamp: Date.now()
    });
  }
});
```

### Pattern 2: Targeted Notification (Specific State)

**YAML:**
```yaml
transitions:
  - from: Processing
    to: Failed
    event: PAYMENT_FAIL
    type: triggerable
    triggeredMethod: onPaymentFailed
```

**TypeScript:**
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'onPaymentFailed') {
    // Only notify Orders in Active state
    await sender.broadcast(
      'Order',
      {
        type: 'PAYMENT_FAILED',
        payload: {
          paymentId: context.paymentId,
          reason: event.payload.reason
        },
        timestamp: Date.now()
      },
      'Active'  // Only Active orders
    );
  }
});
```

### Pattern 3: System-Wide Alert (No Filters)

**YAML:**
```yaml
transitions:
  - from: Monitoring
    to: Alerting
    event: SYSTEM_ALERT
    type: triggerable
    triggeredMethod: onSystemAlert
```

**TypeScript:**
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'onSystemAlert') {
    // Alert ALL orders (any state)
    await sender.broadcast('Order', {
      type: 'SYSTEM_MAINTENANCE',
      payload: { scheduledAt: event.payload.maintenanceTime },
      timestamp: Date.now()
    });
  }
});
```

### Pattern 4: Cascade to Multiple Machines

**YAML:**
```yaml
transitions:
  - from: Standard
    to: Premium
    event: UPGRADE
    type: triggerable
    triggeredMethod: onCustomerUpgrade
```

**TypeScript:**
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'onCustomerUpgrade') {
    const tierEvent = {
      type: 'CUSTOMER_TIER_CHANGED',
      payload: { customerId: context.customerId, newTier: 'premium' },
      timestamp: Date.now()
    };

    // Broadcast to multiple machines — matchingRules on each target filter by customerId
    await sender.broadcast('Order', tierEvent);
    await sender.broadcast('Payment', tierEvent);
    await sender.broadcast('RiskMonitor', tierEvent);
  }
});
```

### Pattern 5: Cross-Component Communication

**TypeScript:**
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'notifyPaymentComponent') {
    // Broadcast to Payment machine in PaymentComponent
    await sender.broadcast(
      'Payment',
      {
        type: 'ORDER_CONFIRMED',
        payload: { orderId: context.orderId, amount: context.amount },
        timestamp: Date.now()
      },
      undefined,            // Any state
      'PaymentComponent'    // Cross-component
    );
  }
});
```

---

## Return Value

All broadcast methods return `Promise<number>` - the count of instances that received the event.

```typescript
const count = await sender.broadcast('Order', event);
console.log(`Notified ${count} order(s)`);
```

**Note:** In distributed mode (Redis broker), the count may be 0 (not available across processes).

---

## Best Practices

1. **Use matchingRules on the target for filtering** — don't try to filter in the sender
   ```yaml
   # Target transition filters automatically
   matchingRules:
     - eventProperty: customerId
       instanceProperty: customerId
   ```

2. **Include matching data in the payload** — the target's matchingRules need it
   ```typescript
   await sender.broadcast('RiskMonitor', {
     type: 'UPDATE',
     payload: { customerId: context.customerId },  // Required for matchingRules
     timestamp: Date.now()
   });
   ```

3. **Use currentState to narrow scope** — reduces unnecessary processing
   ```typescript
   // Only broadcast to Pending orders, not all orders
   await sender.broadcast('Order', event, 'Pending');
   ```

4. **Log broadcast results** — helps debugging
   ```typescript
   const count = await sender.broadcast('Order', event);
   console.log(`[${context.orderId}] Notified ${count} order(s)`);
   ```

---

## Related Guides

- [ADVANCED-PATTERNS-GUIDE.md](./ADVANCED-PATTERNS-GUIDE.md) - Complete examples
- [EVENT-ACCUMULATION-GUIDE.md](./EVENT-ACCUMULATION-GUIDE.md) - Event accumulation patterns
- [examples/advanced-patterns-demo.yaml](./examples/advanced-patterns-demo.yaml) - Working example
