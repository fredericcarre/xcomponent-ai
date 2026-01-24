# 📊 Event Accumulation & Conditional Transitions Guide

This guide shows how to handle **multiple events** that accumulate data and transition based on **aggregated state**.

## 🎯 Use Case

**Trading Order Example:**
- Order for 1000 shares receives multiple execution notifications
- Each notification has a partial quantity (e.g., 100, 250, 150...)
- Order should transition to "Fully Executed" **only when** `executedQuantity >= totalQuantity`

**Key Challenge:** How to accumulate data from multiple events and conditionally transition?

---

## 💡 Solution: Guards + Triggered Methods

xcomponent-ai provides three mechanisms to solve this:

1. **Context** - Stores accumulated state
2. **Triggered Methods** - Accumulate data from events
3. **Guards** - Conditional transitions based on context

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

### Step 2: Create Accumulation Method

```yaml
triggeredMethods:
  accumulateExecution: |
    async function(event, context, sender) {
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
    }
```

### Step 3: Define Conditional Transitions with Guards

```yaml
transitions:
  # Stay in PartiallyExecuted if NOT fully executed yet
  - from: PartiallyExecuted
    to: PartiallyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: accumulateExecution
    guards:
      # Guard: Only stay if quantity is still incomplete
      - type: custom
        condition: "context.executedQuantity < context.totalQuantity"

  # Transition to FullyExecuted when quantity is complete
  - from: PartiallyExecuted
    to: FullyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: accumulateExecution
    guards:
      # Guard: Only transition when fully executed
      - type: context
        property: executedQuantity
        operator: ">="
        value: "{{totalQuantity}}"  # Reference context property
```

**How it works:**
1. Event arrives → `accumulateExecution` method executes → context.executedQuantity updated
2. Guards are evaluated **after** triggered method
3. **Multiple transitions are tried in order** - first matching guard wins
4. Transition occurs based on which guard passes first

**Important:** When multiple transitions from the same state use the same event:
- Triggered method runs **once** (before evaluating any guards)
- Guards are evaluated in the order transitions are defined
- The **first transition with passing guards** is used
- Define transitions in your desired evaluation order

---

## 🛡️ Guard Types Reference

### 1. Context Guards

Check properties in the instance **context**.

```yaml
guards:
  # Simple comparison
  - type: context
    property: executedQuantity
    operator: ">="
    value: 1000

  # Reference another context property
  - type: context
    property: executedQuantity
    operator: ">="
    value: "{{totalQuantity}}"

  # Nested property
  - type: context
    property: customer.tier
    operator: "==="
    value: "premium"

  # Array length
  - type: context
    property: executions.length
    operator: ">"
    value: 0
```

### 2. Event Guards

Check properties in the **event payload**.

```yaml
guards:
  # Check event payload
  - type: event
    property: quantity
    operator: ">"
    value: 100

  # Check execution price
  - type: event
    property: price
    operator: "<="
    value: "{{limitPrice}}"  # Compare with context property
```

### 3. Custom Guards

JavaScript conditions with full access to `context`, `event`, and `publicMember`.

```yaml
guards:
  # Complex condition
  - type: custom
    condition: "context.executedQuantity >= context.totalQuantity && event.payload.status === 'confirmed'"

  # Multiple checks
  - type: custom
    condition: "context.executions.length > 0 && context.executions.every(e => e.quantity > 0)"

  # Date/time logic
  - type: custom
    condition: "Date.now() - context.createdAt < 3600000"  # Within 1 hour
```

### Supported Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `===` | Equal (default) | `property: amount, value: 1000` |
| `!==` | Not equal | `property: status, operator: "!==", value: "cancelled"` |
| `>` | Greater than | `property: amount, operator: ">", value: 100` |
| `<` | Less than | `property: quantity, operator: "<", value: "{{maxQuantity}}"` |
| `>=` | Greater or equal | `property: executedQuantity, operator: ">=", value: "{{totalQuantity}}"` |
| `<=` | Less or equal | `property: price, operator: "<=", value: "{{limitPrice}}"` |
| `contains` | String contains | `property: description, operator: "contains", value: "urgent"` |
| `in` | Value in array | `property: status, operator: "in", value: ["pending", "active"]` |

### Template References

Use `{{propertyName}}` to reference other context properties:

```yaml
guards:
  - type: context
    property: executedQuantity
    operator: ">="
    value: "{{totalQuantity}}"  # References context.totalQuantity
```

---

## 📝 Complete Example

```yaml
name: TradingComponent
version: 1.0.0

triggeredMethods:
  accumulateExecution: |
    async function(event, context, sender) {
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
    }

stateMachines:
  - name: TradingOrder
    initialState: Created

    states:
      - name: Created
      - name: Submitted
      - name: PartiallyExecuted
      - name: FullyExecuted
      - name: Completed

    transitions:
      - from: Created
        to: Submitted
        event: SUBMIT
        type: triggerable

      # Partial → Partial (stay if not complete)
      - from: PartiallyExecuted
        to: PartiallyExecuted
        event: EXECUTION_NOTIFICATION
        type: triggerable
        triggeredMethod: accumulateExecution
        guards:
          - type: custom
            condition: "context.executedQuantity < context.totalQuantity"

      # Partial → Fully (transition when complete)
      - from: PartiallyExecuted
        to: FullyExecuted
        event: EXECUTION_NOTIFICATION
        type: triggerable
        triggeredMethod: accumulateExecution
        guards:
          - type: context
            property: executedQuantity
            operator: ">="
            value: "{{totalQuantity}}"

      - from: FullyExecuted
        to: Completed
        event: SETTLE
        type: triggerable
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
  ]
}
```

---

## 📤 Sending Events from Triggered Methods

Triggered methods can send events to other instances using the `sender` parameter.

### Send to Specific Instance

```yaml
triggeredMethods:
  notifyPayment: |
    async function(event, context, sender) {
      // Send event to specific payment instance
      await sender.sendTo(context.paymentInstanceId, {
        type: 'ORDER_CONFIRMED',
        payload: { orderId: context.orderId },
        timestamp: Date.now()
      });
    }
```

### Broadcast with Property Filters

Send events to **multiple instances** matching specific criteria:

```yaml
triggeredMethods:
  accumulateExecution: |
    async function(event, context, sender) {
      // Update context...
      context.executedQuantity += event.payload.quantity;

      // BROADCAST to risk monitors for this customer
      const count = await sender.broadcast(
        'RiskMonitor',           // Target machine
        'Monitoring',            // Target state
        {
          type: 'ORDER_UPDATE',
          payload: {
            orderId: context.orderId,
            executedQuantity: context.executedQuantity
          },
          timestamp: Date.now()
        },
        [
          // FILTERS: Only instances for this customer
          { property: 'customerId', value: context.customerId },
          { property: 'assetClass', value: 'EQUITY' }
        ]
      );

      console.log(`Notified ${count} risk monitor(s)`);
    }
```

**Filter operators:** `===`, `!==`, `>`, `<`, `>=`, `<=`, `contains`, `in`

**Multiple filters use AND logic** (all must match).

### Cross-Component Broadcasts

```yaml
triggeredMethods:
  cascadeToOtherComponent: |
    async function(event, context, sender) {
      // Broadcast to instances in another component
      await sender.broadcastToComponent(
        'PaymentComponent',      // Target component
        'Payment',               // Target machine
        'Pending',               // Target state
        {
          type: 'ORDER_COMPLETED',
          payload: { orderId: context.orderId },
          timestamp: Date.now()
        },
        [{ property: 'orderId', value: context.orderId }]
      );
    }
```

---

## 🎯 Other Use Cases

### 1. Payment Installments

```yaml
# Loan with multiple payment installments
guards:
  - type: context
    property: paidInstallments
    operator: ">="
    value: "{{totalInstallments}}"
```

### 2. Multi-Step Approval

```yaml
# Require 3 approvals
guards:
  - type: context
    property: approvals.length
    operator: ">="
    value: 3
```

### 3. Time-based Accumulation

```yaml
# Only transition after 24 hours
guards:
  - type: custom
    condition: "Date.now() - context.createdAt > 86400000"
```

### 4. Conditional on External Data

```yaml
# Check market conditions
guards:
  - type: event
    property: marketPrice
    operator: "<="
    value: "{{limitPrice}}"
```

---

## ⚠️ Best Practices

1. **Initialize accumulators** in triggered methods (handle first event)
2. **Use guards on BOTH transitions** (stay vs. transition)
3. **Log accumulation** for debugging (`console.log` in triggered methods)
4. **Test edge cases** (exact match, overfill, underfill)
5. **Use context guards for clarity** instead of always using custom
6. **Document business logic** in YAML comments

---

## 🔗 See Also

- [LLM-GUIDE.md](./LLM-GUIDE.md) - Complete YAML patterns
- [examples/event-accumulation-demo.yaml](./examples/event-accumulation-demo.yaml) - Full example
- [QUICKSTART.md](./QUICKSTART.md) - Getting started

**Built for complex workflows.** 🚀
