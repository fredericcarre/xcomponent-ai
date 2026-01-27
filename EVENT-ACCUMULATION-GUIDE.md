# 📊 Event Accumulation & Explicit Control Guide

This guide shows how to handle **multiple events** that accumulate data and **explicitly control transitions** based on business logic.

## 🎯 Use Case

**Trading Order Example:**
- Order for 1000 shares receives multiple execution notifications
- Each notification has a partial quantity (e.g., 100, 250, 150...)
- Order should transition to "Fully Executed" **only when** `executedQuantity >= totalQuantity`

**Key Challenge:** How to accumulate data from multiple events and explicitly decide when to transition?

---

## 💡 Solution: Explicit Control with sender.sendToSelf()

xcomponent-ai provides **explicit control** through triggered methods:

1. **Context** - Stores accumulated state
2. **Triggered Methods** - Accumulate data from events and decide when to transition
3. **sender.sendToSelf()** - Explicitly trigger state transitions from code

**Philosophy:** Business logic should be in code (triggered methods), not in YAML configuration.

---

## 🔧 Implementation

### Step 1: Define Context Schema

```yaml
stateMachines:
  - name: TradingOrder
    initialState: Created

    contextSchema:
      orderId:
        type: text
        required: true
      totalQuantity:
        type: number
        required: true
        min: 1
      # These will be populated by triggered methods
      executedQuantity:
        type: number
        default: 0
      executions:
        type: array
        default: []
```

### Step 2: Create Accumulation Method with Explicit Control

**YAML** -- declare the method name on the transition:

```yaml
transitions:
  - from: PartiallyExecuted
    to: PartiallyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: accumulateExecution
```

**TypeScript** -- implement the handler:

```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'accumulateExecution') {
    // Initialize counters
    if (!context.executedQuantity) {
      context.executedQuantity = 0;
    }
    if (!context.executions) {
      context.executions = [];
    }

    // Accumulate quantity from event
    const qty = event.payload.quantity || 0;
    context.executedQuantity += qty;

    // Track individual executions
    context.executions.push({
      quantity: qty,
      price: event.payload.price,
      executionId: event.payload.executionId,
      timestamp: event.timestamp
    });

    console.log(`Executed: ${context.executedQuantity}/${context.totalQuantity}`);

    // EXPLICIT CONTROL: Decide when to transition
    if (context.executedQuantity >= context.totalQuantity) {
      // Send event to self to trigger completion
      await sender.sendToSelf({
        type: 'FULLY_EXECUTED',
        payload: {
          totalExecuted: context.executedQuantity,
          executionCount: context.executions.length,
          averagePrice: context.executions.reduce((sum, e) => sum + e.price, 0) / context.executions.length
        },
        timestamp: Date.now()
      });
    }
  }
});
```

**Key Points:**
- Method accumulates data from the event
- Method **decides** when to transition based on business logic
- Uses `sender.sendToSelf()` to **explicitly** trigger the transition
- Event is queued asynchronously to avoid race conditions

### Step 3: Define Transitions (No Guards!)

```yaml
transitions:
  # SELF-LOOP: Stay in PartiallyExecuted
  # Triggered method decides when to send FULLY_EXECUTED event
  - from: PartiallyExecuted
    to: PartiallyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: accumulateExecution

  # EXPLICIT TRANSITION: Triggered by sender.sendToSelf()
  # No guards - logic is in the triggered method
  - from: PartiallyExecuted
    to: FullyExecuted
    event: FULLY_EXECUTED
    type: triggerable
    triggeredMethod: handleCompletion

  # Also handle direct full execution from Submitted
  - from: Submitted
    to: FullyExecuted
    event: FULLY_EXECUTED
    type: triggerable
    triggeredMethod: handleCompletion
```

**How it works:**
1. Event `EXECUTION_NOTIFICATION` arrives
2. `accumulateExecution` method executes, updates context
3. Method checks if `executedQuantity >= totalQuantity`
4. If true, method calls `sender.sendToSelf()` with `FULLY_EXECUTED` event
5. `FULLY_EXECUTED` event triggers transition to `FullyExecuted` state

**Benefits:**
- ✅ All business logic in one place (triggered method)
- ✅ Easy to test and debug
- ✅ Can set event payload properties dynamically
- ✅ Full control over transition timing

---

## 📝 Complete Example

**YAML** (`trading.yaml`):

```yaml
name: TradingComponent
version: 1.0.0

stateMachines:
  - name: TradingOrder
    initialState: Created

    states:
      - name: Created
        type: entry
      - name: Submitted
        type: regular
      - name: PartiallyExecuted
        type: regular
      - name: FullyExecuted
        type: regular
      - name: Completed
        type: final

    transitions:
      - from: Created
        to: Submitted
        event: SUBMIT
        type: triggerable

      - from: Submitted
        to: PartiallyExecuted
        event: EXECUTION_NOTIFICATION
        type: triggerable
        triggeredMethod: accumulateExecution

      # SELF-LOOP
      - from: PartiallyExecuted
        to: PartiallyExecuted
        event: EXECUTION_NOTIFICATION
        type: triggerable
        triggeredMethod: accumulateExecution

      # EXPLICIT TRANSITION
      - from: PartiallyExecuted
        to: FullyExecuted
        event: FULLY_EXECUTED
        type: triggerable
        triggeredMethod: handleCompletion

      - from: Submitted
        to: FullyExecuted
        event: FULLY_EXECUTED
        type: triggerable
        triggeredMethod: handleCompletion

      - from: FullyExecuted
        to: Completed
        event: SETTLE
        type: triggerable
```

**TypeScript** -- implement the handlers:

```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'accumulateExecution') {
    if (!context.executedQuantity) context.executedQuantity = 0;
    if (!context.executions) context.executions = [];

    const qty = event.payload.quantity || 0;
    context.executedQuantity += qty;
    context.executions.push({
      quantity: qty,
      price: event.payload.price,
      executionId: event.payload.executionId,
      timestamp: event.timestamp
    });

    console.log(`Executed: ${context.executedQuantity}/${context.totalQuantity}`);

    // EXPLICIT CONTROL
    if (context.executedQuantity >= context.totalQuantity) {
      await sender.sendToSelf({
        type: 'FULLY_EXECUTED',
        payload: {
          totalExecuted: context.executedQuantity,
          executionCount: context.executions.length
        },
        timestamp: Date.now()
      });
    }
  }

  if (method === 'handleCompletion') {
    console.log(`Order completed!`);
    console.log(`  Total: ${event.payload.totalExecuted}`);
    console.log(`  Executions: ${event.payload.executionCount}`);
    context.stats = event.payload;
  }
});
```

---

## 🧪 Testing

```bash
# Start the server
xcomponent-ai serve examples/event-accumulation-demo.yaml

# Create order for 1000 shares
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{
    "machineName": "TradingOrder",
    "context": {
      "orderId": "ORD-001",
      "symbol": "AAPL",
      "totalQuantity": 1000,
      "side": "BUY"
    }
  }'

# Submit order
curl -X POST http://localhost:3000/api/instances/{instanceId}/events \
  -H "Content-Type: application/json" \
  -d '{"type": "SUBMIT"}'

# Send execution notification #1: 300 shares
curl -X POST http://localhost:3000/api/instances/{instanceId}/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {
      "quantity": 300,
      "price": 150.50,
      "executionId": "EXEC-001"
    }
  }'
# → State: PartiallyExecuted

# Send execution notification #2: 400 shares
curl -X POST http://localhost:3000/api/instances/{instanceId}/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {
      "quantity": 400,
      "price": 150.45,
      "executionId": "EXEC-002"
    }
  }'
# → State: PartiallyExecuted (700/1000)

# Send execution notification #3: 300 shares
curl -X POST http://localhost:3000/api/instances/{instanceId}/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {
      "quantity": 300,
      "price": 150.40,
      "executionId": "EXEC-003"
    }
  }'
# → State: FullyExecuted (1000/1000) ✅

# Check final state
curl http://localhost:3000/api/instances/{instanceId}
```

**Expected context:**
```json
{
  "orderId": "ORD-001",
  "symbol": "AAPL",
  "totalQuantity": 1000,
  "side": "BUY",
  "executedQuantity": 1000,
  "executions": [
    {"quantity": 300, "price": 150.50, "executionId": "EXEC-001"},
    {"quantity": 400, "price": 150.45, "executionId": "EXEC-002"},
    {"quantity": 300, "price": 150.40, "executionId": "EXEC-003"}
  ],
  "stats": {
    "totalExecuted": 1000,
    "executionCount": 3
  }
}
```

---

## 📤 Sender Methods Reference

Triggered methods receive a `sender` parameter with methods for cross-instance communication.

### sendToSelf(event)

Send event to current instance (explicit control):

```javascript
await sender.sendToSelf({
  type: 'FULLY_EXECUTED',
  payload: { totalExecuted: context.executedQuantity },
  timestamp: Date.now()
});
```

### sendTo(instanceId, event)

Send event to specific instance:

```javascript
await sender.sendTo(context.paymentInstanceId, {
  type: 'ORDER_CONFIRMED',
  payload: { orderId: context.orderId },
  timestamp: Date.now()
});
```

### broadcast(machineName, event, currentState?, componentName?)

Broadcast to all matching instances. Filtering is done via **matchingRules in YAML**, not in code:

```javascript
// Broadcast to all Orders (any state)
await sender.broadcast('Order', {
  type: 'SYSTEM_ALERT',
  payload: {},
  timestamp: Date.now()
});

// Broadcast to Orders in Pending state only
await sender.broadcast('Order', {
  type: 'TIMEOUT',
  payload: {},
  timestamp: Date.now()
}, 'Pending');

// Cross-component broadcast
await sender.broadcast('Payment', {
  type: 'ORDER_COMPLETED',
  payload: { orderId: context.orderId },
  timestamp: Date.now()
}, undefined, 'PaymentComponent');
```

**Filtering via matchingRules in YAML:**

```yaml
# In the receiving machine's transition
transitions:
  - from: Monitoring
    to: Monitoring
    event: ORDER_UPDATE
    type: triggerable
    matchingRules:
      # Only instances with matching customerId receive event
      - eventProperty: payload.customerId
        instanceProperty: customerId
```

### createInstance(machineName, initialContext)

Create new instance:

```javascript
const newInstanceId = sender.createInstance('Order', {
  orderId: 'ORD-001',
  totalQuantity: 1000
});
```

### createInstanceInComponent(componentName, machineName, initialContext)

Create instance in another component:

```javascript
sender.createInstanceInComponent('PaymentComponent', 'Payment', {
  orderId: context.orderId,
  amount: context.totalAmount
});
```

---

## 🎯 Other Use Cases

### 1. Payment Installments

```javascript
async function(event, context, sender) {
  if (!context.paidInstallments) context.paidInstallments = 0;
  context.paidInstallments += 1;

  if (context.paidInstallments >= context.totalInstallments) {
    await sender.sendToSelf({
      type: 'FULLY_PAID',
      payload: { installments: context.paidInstallments },
      timestamp: Date.now()
    });
  }
}
```

### 2. Multi-Step Approval

```javascript
async function(event, context, sender) {
  if (!context.approvals) context.approvals = [];
  context.approvals.push({
    approver: event.payload.approver,
    timestamp: event.timestamp
  });

  if (context.approvals.length >= 3) {
    await sender.sendToSelf({
      type: 'APPROVED',
      payload: { approvers: context.approvals.map(a => a.approver) },
      timestamp: Date.now()
    });
  }
}
```

### 3. Time-based Accumulation

```javascript
async function(event, context, sender) {
  const elapsed = Date.now() - context.createdAt;

  if (elapsed > 86400000) {  // 24 hours
    await sender.sendToSelf({
      type: 'EXPIRED',
      payload: { duration: elapsed },
      timestamp: Date.now()
    });
  }
}
```

---

## ⚠️ Best Practices

1. **Initialize accumulators** in triggered methods (handle first event)
2. **Use sender.sendToSelf()** for explicit control instead of guards
3. **Log state changes** for debugging (`console.log` in triggered methods)
4. **Test edge cases** (exact match, overfill, underfill)
5. **Keep business logic in code** (triggered methods), not YAML
6. **Document transitions** with clear comments in YAML

---

## 🔗 See Also

- [LLM-GUIDE.md](./LLM-GUIDE.md) - Complete YAML patterns
- [examples/event-accumulation-demo.yaml](./examples/event-accumulation-demo.yaml) - Full example
- [examples/explicit-transitions-demo.yaml](./examples/explicit-transitions-demo.yaml) - Explicit control demo
- [QUICKSTART.md](./QUICKSTART.md) - Getting started

**Built for explicit control.** 🚀
