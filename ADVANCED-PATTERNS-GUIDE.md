# 🚀 Advanced Patterns Guide

This guide demonstrates advanced xcomponent-ai patterns for complex workflows.

## 📋 Patterns Covered

1. **Self-looping transitions** - Transition that stays in the same state
2. **Triggered methods** - Update context/publicMember on transitions
3. **Broadcast with filters from triggered methods** - Send targeted events to other instances
4. **Parallel timeout transitions** - Race condition between events and timeouts

---

## 🎯 Complete Example: Trading Order with Risk Monitoring

### Use Case

**Trading Order:**
- Receives multiple execution notifications
- Accumulates executed quantity
- Transitions to FullyExecuted when quantity reaches total
- Can expire if execution takes too long (timeout)
- Notifies risk monitors on each execution

**Risk Monitor:**
- Monitors orders for a specific customer
- Receives execution updates via targeted broadcasts
- Tracks customer exposure

### Pattern 1: Self-Looping Transition

A transition can return to the same state, allowing state updates without changing state.

```yaml
transitions:
  # Loop on itself while quantity is incomplete
  - from: PartiallyExecuted
    to: PartiallyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: accumulateExecution
```

**How it works:**
1. Instance receives `EXECUTION_NOTIFICATION` event
2. `accumulateExecution` triggered method executes -- updates `context.executedQuantity`
3. Transition fires but stays in `PartiallyExecuted` state
4. Instance can receive more `EXECUTION_NOTIFICATION` events

---

### Pattern 2: Triggered Methods Update Context

Triggered methods can modify the instance's context/publicMember.

**YAML** — declares only the method **name** on the transition:

```yaml
transitions:
  - from: PartiallyExecuted
    to: PartiallyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: accumulateExecution
```

**TypeScript** — implements the business logic in a handler:

```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'accumulateExecution') {
    // Initialize if first execution
    if (!context.executedQuantity) {
      context.executedQuantity = 0;
    }

    // ACCUMULATE data from event
    const qty = event.payload.quantity || 0;
    context.executedQuantity += qty;

    // Track execution history
    context.executions.push({
      quantity: qty,
      price: event.payload.price,
      executionId: event.payload.executionId,
      timestamp: event.timestamp
    });

    console.log(`Executed: ${context.executedQuantity}/${context.totalQuantity}`);
  }
});
```

**Key points:**
- YAML contains only the method name (string), not code
- The handler is registered in TypeScript via `runtime.on('triggered_method', ...)`
- Context changes persist after the transition completes
- This enables accumulation patterns

---

### Pattern 3: Broadcast with Filters from Triggered Methods

Triggered methods can send events to **specific instances** using the sender API.

**YAML** — declares the method name:

```yaml
transitions:
  - from: PartiallyExecuted
    to: PartiallyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: accumulateAndNotify
```

**TypeScript** — implements broadcast logic in the handler:

```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'accumulateAndNotify') {
    // Update context
    context.executedQuantity += event.payload.quantity || 0;

    // BROADCAST: Notify ONLY risk monitors for this customer
    const count = await sender.broadcast(
      'RiskMonitor',              // Target machine
      {                           // Event to send
        type: 'ORDER_EXECUTION_UPDATE',
        payload: {
          orderId: context.orderId,
          executedQuantity: context.executedQuantity,
          totalQuantity: context.totalQuantity
        },
        timestamp: Date.now()
      },
      'Monitoring'                // Target state (optional)
    );

    console.log(`Notified ${count} risk monitor(s)`);
  }
});
```

**Available sender methods:**

```typescript
// Send event to current instance
await sender.sendToSelf(event);

// Send to specific instance (same component)
await sender.sendTo(instanceId, event);

// Send to specific instance (other component)
await sender.sendToComponent(componentName, instanceId, event);

// Broadcast to instances (same or cross-component)
await sender.broadcast(machineName, event, currentState?, componentName?);

// Create new instance (same component)
sender.createInstance(machineName, initialContext);

// Create new instance (other component)
sender.createInstanceInComponent(componentName, machineName, initialContext);
```

**Instance filtering** is done via `matchingRules` on the target transition in YAML, not in the sender call:

```yaml
# The target machine filters incoming broadcasts by matching rules
transitions:
  - from: Monitoring
    to: Monitoring
    event: ORDER_EXECUTION_UPDATE
    matchingRules:
      - eventProperty: customerId
        instanceProperty: customerId
```

This way, only RiskMonitor instances whose `customerId` matches the event's `customerId` will receive the broadcast.

---

### Pattern 4: Parallel Timeout Transitions

A timeout transition can **race** with regular event transitions.

```yaml
transitions:
  # Regular event transition
  - from: PartiallyExecuted
    to: FullyExecuted
    event: EXECUTION_NOTIFICATION
    type: triggerable
    triggeredMethod: accumulateExecution

  # Timeout transition (parallel)
  - from: PartiallyExecuted
    to: Expired
    event: TIMEOUT
    type: timeout
    timeoutMs: 30000  # 30 seconds
    triggeredMethod: handleExpiration
```

**How it works:**

- When instance enters `PartiallyExecuted`, a 30-second timer starts
- Two possible outcomes:
  1. **Order completes before timeout**: `EXECUTION_NOTIFICATION` fires → moves to `FullyExecuted`
  2. **Timeout fires first**: Automatic `TIMEOUT` event → moves to `Expired`

**The first transition to fire wins!**

---

## 🧪 Testing the Example

### 1. Start the server

```bash
xcomponent-ai serve examples/advanced-patterns-demo.yaml
```

### 2. Create a risk monitor for customer CUST-001

```bash
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{
    "machineName": "RiskMonitor",
    "context": {
      "customerId": "CUST-001",
      "exposureLimit": 100000
    }
  }'
# Returns: {"instanceId": "risk-123"}
```

```bash
# Start monitoring
curl -X POST http://localhost:3000/api/instances/risk-123/events \
  -H "Content-Type: application/json" \
  -d '{"type": "START_MONITORING"}'
```

### 3. Create an order for CUST-001

```bash
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{
    "machineName": "TradingOrder",
    "context": {
      "orderId": "ORD-001",
      "customerId": "CUST-001",
      "symbol": "AAPL",
      "totalQuantity": 1000,
      "side": "BUY",
      "createdAt": '$(date +%s000)'
    }
  }'
# Returns: {"instanceId": "order-456"}
```

### 4. Submit order

```bash
curl -X POST http://localhost:3000/api/instances/order-456/events \
  -H "Content-Type: application/json" \
  -d '{"type": "SUBMIT"}'
# State: Submitted
```

### 5. Send partial execution #1 (300 shares)

```bash
curl -X POST http://localhost:3000/api/instances/order-456/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {
      "customerId": "CUST-001",
      "quantity": 300,
      "price": 150.50,
      "executionId": "EXEC-001"
    }
  }'
# State: PartiallyExecuted (300/1000)
# Risk monitor receives ORDER_EXECUTION_UPDATE
```

### 6. Send partial execution #2 (400 shares)

```bash
curl -X POST http://localhost:3000/api/instances/order-456/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {
      "customerId": "CUST-001",
      "quantity": 400,
      "price": 150.45,
      "executionId": "EXEC-002"
    }
  }'
# State: PartiallyExecuted (700/1000) - STAYS in same state
# Risk monitor receives ORDER_EXECUTION_UPDATE
```

### 7. Send final execution #3 (300 shares)

```bash
curl -X POST http://localhost:3000/api/instances/order-456/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {
      "customerId": "CUST-001",
      "quantity": 300,
      "price": 150.40,
      "executionId": "EXEC-003"
    }
  }'
# State: FullyExecuted (1000/1000) ✅
# Risk monitor receives ORDER_EXECUTION_UPDATE
```

### 8. Check risk monitor received all updates

```bash
curl http://localhost:3000/api/instances/risk-123
# Should show 3 orderUpdates in context
```

### 9. Test timeout (create another order and don't execute it)

```bash
# Create order
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{
    "machineName": "TradingOrder",
    "context": {
      "orderId": "ORD-002",
      "customerId": "CUST-001",
      "symbol": "AAPL",
      "totalQuantity": 500,
      "side": "BUY",
      "createdAt": '$(date +%s000)'
    }
  }'

# Submit (starts timeout timer)
curl -X POST http://localhost:3000/api/instances/{instanceId}/events \
  -H "Content-Type: application/json" \
  -d '{"type": "SUBMIT"}'

# Send partial execution (300/500)
curl -X POST http://localhost:3000/api/instances/{instanceId}/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {
      "customerId": "CUST-001",
      "quantity": 300,
      "price": 150.50,
      "executionId": "EXEC-004"
    }
  }'

# Wait 30+ seconds... timeout fires automatically
# State: Expired ⏰
# Risk monitor receives ORDER_EXPIRED
```

---

## 🎯 Key Takeaways

| Pattern | Use Case | Key Feature |
|---------|----------|-------------|
| **Self-looping** | State updates without state change | `to: same as from` |
| **Triggered methods** | Accumulate data, compute values | Runs during transition |
| **Broadcast + matchingRules** | Targeted notifications | YAML matching rules on target |
| **Timeout transitions** | Expiration, SLAs, deadlines | Parallel with regular events |

---

## 📚 Related Guides

- [EVENT-ACCUMULATION-GUIDE.md](./EVENT-ACCUMULATION-GUIDE.md) - Event accumulation patterns
- [EXTERNAL-API.md](./EXTERNAL-API.md) - External broker API for cross-language integration
- [LLM-GUIDE.md](./LLM-GUIDE.md) - Complete YAML reference

---

## 💡 Best Practices

1. **Order matters** for multiple transitions - define them in evaluation order
2. **Triggered methods should be idempotent** when possible
3. **Use matchingRules for targeted broadcasts** - declare routing rules in YAML on the target transition
4. **Log in triggered methods** - helps debugging accumulation logic
5. **Test timeout scenarios** - ensure cleanup logic handles partial states

---

**Built for complex workflows.** 🚀
