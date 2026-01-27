# 📡 Sender Broadcast Guide

This guide explains how to broadcast events from triggered methods using the `sender` parameter.

## 🎯 New Simplified API

**Before (v0.2.2):**
```javascript
// Had to specify currentState even when using filters
await sender.broadcast('Order', 'Pending', event, filters);
                              ^^^^^^^^ Why force this?
```

**After (v0.2.3+):**
```javascript
// currentState is now optional!
await sender.broadcast('Order', event, filters);
// Broadcasts to ALL Orders (any state) matching filters
```

---

## 📋 Sender Methods

### 1. `sendTo()` - Send to Specific Instance

```javascript
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
    // Send to specific payment instance
    await sender.sendTo(context.paymentInstanceId, {
      type: 'ORDER_CONFIRMED',
      payload: { orderId: context.orderId },
      timestamp: Date.now()
    });
  }
});
```

---

### 2. `broadcast()` - Broadcast to Multiple Instances

**New signature:**
```typescript
sender.broadcast(
  machineName: string,
  event: FSMEvent,
  filters?: PropertyFilter[],    // Optional
  currentState?: string           // Optional
): Promise<number>
```

#### Broadcast to All Instances (Any State)

```javascript
// No filters, no state = ALL instances of this machine
await sender.broadcast('Order', {
  type: 'SYSTEM_ALERT',
  payload: { message: 'Maintenance in 5 minutes' },
  timestamp: Date.now()
});
```

#### Broadcast with Property Filters (Any State)

```javascript
// Filters only (no state restriction)
await sender.broadcast(
  'Order',
  {
    type: 'CUSTOMER_UPDATE',
    payload: { newTier: 'premium' },
    timestamp: Date.now()
  },
  [
    // Only orders for this customer
    { property: 'customerId', value: 'CUST-001' }
  ]
);
```

**Broadcasts to:**
- All `Order` instances
- With `customerId === 'CUST-001'`
- **In any state** (Pending, Processing, Completed, etc.)

#### Broadcast to Specific State

```javascript
// With currentState (backward compatible)
await sender.broadcast(
  'Order',
  {
    type: 'TIMEOUT',
    payload: {},
    timestamp: Date.now()
  },
  [],  // No filters
  'Pending'  // Only Pending orders
);
```

#### Broadcast with Filters AND State

```javascript
// Combine filters and state
await sender.broadcast(
  'Order',
  {
    type: 'URGENT_REVIEW',
    payload: {},
    timestamp: Date.now()
  },
  [
    { property: 'customerId', value: 'CUST-001' },
    { property: 'amount', operator: '>', value: 10000 }
  ],
  'Pending'  // Only in Pending state
);
```

**Broadcasts to:**
- `Order` instances in `Pending` state
- With `customerId === 'CUST-001'`
- AND `amount > 10000`

---

### 3. `broadcastToComponent()` - Cross-Component Broadcast

**New signature:**
```typescript
sender.broadcastToComponent(
  componentName: string,
  machineName: string,
  event: FSMEvent,
  filters?: PropertyFilter[],
  currentState?: string
): Promise<number>
```

#### Broadcast to All Instances (Other Component)

```javascript
await sender.broadcastToComponent(
  'PaymentComponent',
  'Payment',
  {
    type: 'SYSTEM_SHUTDOWN',
    payload: { gracePeriod: 300 },
    timestamp: Date.now()
  }
);
```

#### With Filters (Other Component)

```javascript
await sender.broadcastToComponent(
  'PaymentComponent',
  'Payment',
  {
    type: 'REFUND_REQUESTED',
    payload: { orderId: context.orderId },
    timestamp: Date.now()
  },
  [
    { property: 'orderId', value: context.orderId }
  ]
);
```

---

## 🔍 Property Filters

Filters use **AND logic** (all must match).

### Filter Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `===` | Equal (default) | `{property: 'status', value: 'active'}` |
| `!==` | Not equal | `{property: 'status', operator: '!==', value: 'cancelled'}` |
| `>` | Greater than | `{property: 'amount', operator: '>', value: 1000}` |
| `<` | Less than | `{property: 'quantity', operator: '<', value: 10}` |
| `>=` | Greater or equal | `{property: 'priority', operator: '>=', value: 5}` |
| `<=` | Less or equal | `{property: 'age', operator: '<=', value: 30}` |
| `contains` | String contains | `{property: 'description', operator: 'contains', value: 'urgent'}` |
| `in` | Value in array | `{property: 'status', operator: 'in', value: ['pending', 'active']}` |

### Nested Properties

Use dot notation for nested properties:

```javascript
[
  { property: 'customer.tier', value: 'premium' },
  { property: 'customer.region', value: 'EMEA' }
]
```

### Multiple Filters (AND Logic)

```javascript
[
  { property: 'customerId', value: 'CUST-001' },
  { property: 'amount', operator: '>', value: 1000 },
  { property: 'status', operator: 'in', value: ['pending', 'active'] }
]
```

All three filters must match!

---

## 💡 Common Patterns

### Pattern 1: Notify Related Instances (Any State)

**YAML** -- declare the method name on the transition:
```yaml
transitions:
  - from: Active
    to: Active
    event: ORDER_UPDATED
    type: triggerable
    triggeredMethod: onOrderUpdate
```

**TypeScript** -- implement the handler:
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'onOrderUpdate') {
    // Notify ALL risk monitors for this customer
    // (regardless of their current state)
    await sender.broadcast(
      'RiskMonitor',
      {
        type: 'ORDER_EVENT',
        payload: {
          orderId: context.orderId,
          eventType: event.type,
          amount: context.amount
        },
        timestamp: Date.now()
      },
      [
        { property: 'customerId', value: context.customerId }
      ]
      // No currentState = any state
    );
  }
});
```

### Pattern 2: Targeted Notification (Specific State)

**YAML** -- declare the method name on the transition:
```yaml
transitions:
  - from: Processing
    to: Failed
    event: PAYMENT_FAIL
    type: triggerable
    triggeredMethod: onPaymentFailed
```

**TypeScript** -- implement the handler:
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'onPaymentFailed') {
    // Notify only ACTIVE orders for this customer
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
      [
        { property: 'customerId', value: context.customerId }
      ],
      'Active'  // Only Active orders
    );
  }
});
```

### Pattern 3: System-Wide Alert (No Filters)

**YAML** -- declare the method name on the transition:
```yaml
transitions:
  - from: Monitoring
    to: Alerting
    event: SYSTEM_ALERT
    type: triggerable
    triggeredMethod: onSystemAlert
```

**TypeScript** -- implement the handler:
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'onSystemAlert') {
    // Alert ALL orders (any state, no filters)
    await sender.broadcast(
      'Order',
      {
        type: 'SYSTEM_MAINTENANCE',
        payload: {
          scheduledAt: event.payload.maintenanceTime
        },
        timestamp: Date.now()
      }
      // No filters, no state = broadcast to ALL
    );
  }
});
```

### Pattern 4: Cascade to Multiple Machines

**YAML** -- declare the method name on the transition:
```yaml
transitions:
  - from: Standard
    to: Premium
    event: UPGRADE
    type: triggerable
    triggeredMethod: onCustomerUpgrade
```

**TypeScript** -- implement the handler:
```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'onCustomerUpgrade') {
    const customerId = context.customerId;

    // Update all orders
    await sender.broadcast(
      'Order',
      {
        type: 'CUSTOMER_TIER_CHANGED',
        payload: { newTier: 'premium' },
        timestamp: Date.now()
      },
      [{ property: 'customerId', value: customerId }]
    );

    // Update all payments
    await sender.broadcast(
      'Payment',
      {
        type: 'CUSTOMER_TIER_CHANGED',
        payload: { newTier: 'premium' },
        timestamp: Date.now()
      },
      [{ property: 'customerId', value: customerId }]
    );

    // Update all risk monitors
    await sender.broadcast(
      'RiskMonitor',
      {
        type: 'CUSTOMER_TIER_CHANGED',
        payload: { newTier: 'premium' },
        timestamp: Date.now()
      },
      [{ property: 'customerId', value: customerId }]
    );
  }
});
```

---

## ⚙️ Return Value

All broadcast methods return `Promise<number>` - the count of instances that received the event.

```javascript
const count = await sender.broadcast('Order', event, filters);
console.log(`Notified ${count} order(s)`);
```

**Note:** In distributed mode (Redis broker), the count may be 0 (not available across processes).

---

## 🔀 Migration from v0.2.2

### Before (v0.2.2)

```javascript
// Old signature: currentState was required
await sender.broadcast(machineName, currentState, event, filters);
```

### After (v0.2.3+)

```javascript
// New signature: currentState is optional and moved to end
await sender.broadcast(machineName, event, filters, currentState);
```

**Migration examples:**

```javascript
// Before: Broadcast to all Pending orders
await sender.broadcast('Order', 'Pending', event, filters);

// After: Same behavior
await sender.broadcast('Order', event, filters, 'Pending');

// New: Broadcast to all orders (any state)
await sender.broadcast('Order', event, filters);
```

**⚠️ Breaking Change:** If you're using sender.broadcast() in v0.2.2, you need to reorder parameters.

---

## 🧪 Testing

```bash
# Start server
xcomponent-ai serve examples/advanced-patterns-demo.yaml

# Create risk monitor
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{
    "machineName": "RiskMonitor",
    "context": {
      "customerId": "CUST-001",
      "exposureLimit": 100000
    }
  }'

# Create order (will broadcast to risk monitor)
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{
    "machineName": "TradingOrder",
    "context": {
      "orderId": "ORD-001",
      "customerId": "CUST-001",
      "symbol": "AAPL",
      "totalQuantity": 1000,
      "side": "BUY"
    }
  }'

# Send execution (triggers broadcast)
curl -X POST http://localhost:3000/api/instances/{orderId}/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {
      "customerId": "CUST-001",
      "quantity": 300,
      "price": 150.50
    }
  }'

# Check risk monitor received update
curl http://localhost:3000/api/instances/{riskMonitorId}
# Should show orderUpdates array with the execution
```

---

## 💡 Best Practices

1. **Use filters over state when possible**: More flexible
   ```javascript
   // ✅ Good - works across all states
   await sender.broadcast('Order', event, [
     { property: 'customerId', value: 'CUST-001' }
   ]);

   // ❌ Less flexible - only one state
   await sender.broadcast('Order', event, [], 'Pending');
   ```

2. **Be specific with filters**: Avoid broadcasting to too many instances
   ```javascript
   // ✅ Good - targeted
   [
     { property: 'customerId', value: 'CUST-001' },
     { property: 'priority', operator: '>=', value: 5 }
   ]

   // ❌ Too broad
   []  // Broadcasts to ALL instances
   ```

3. **Log broadcast results**: Helps debugging
   ```javascript
   const count = await sender.broadcast('Order', event, filters);
   console.log(`[${context.orderId}] Notified ${count} order(s)`);
   ```

4. **Handle errors gracefully**: Broadcasts can fail
   ```javascript
   try {
     await sender.broadcast('Order', event, filters);
   } catch (error) {
     console.error('Broadcast failed:', error);
     // Don't let broadcast failure block your workflow
   }
   ```

---

## 📚 Related Guides

- [ADVANCED-PATTERNS-GUIDE.md](./ADVANCED-PATTERNS-GUIDE.md) - Complete examples
- [EVENT-ACCUMULATION-GUIDE.md](./EVENT-ACCUMULATION-GUIDE.md) - Guards and filters
- [examples/advanced-patterns-demo.yaml](./examples/advanced-patterns-demo.yaml) - Working example

**Built for flexible event routing.** 📡
