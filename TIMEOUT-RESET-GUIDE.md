# ⏰ Timeout Reset Behavior Guide

This guide explains the two timeout reset behaviors available in xcomponent-ai.

## 🎯 The Problem

When you have a self-looping transition (state → same state) with a timeout, should the timeout timer:
1. **Keep running** (total time in state)?
2. **Reset** on each transition (inactivity timeout)?

Both behaviors are useful depending on your use case!

---

## 🔧 Configuration

Use the `resetOnTransition` field on timeout transitions:

```yaml
transitions:
  - from: SomeState
    to: AnotherState
    event: TIMEOUT
    type: timeout
    timeoutMs: 30000  # 30 seconds
    resetOnTransition: false  # or true
```

### Option 1: `resetOnTransition: false` (Total Time in State)

**Timer does NOT reset** on self-loop transitions.

```yaml
- from: Processing
  to: Processing
  event: UPDATE
  type: triggerable
  # Self-loop transition

- from: Processing
  to: Failed
  event: TIMEOUT
  type: timeout
  timeoutMs: 60000  # 60 seconds TOTAL
  resetOnTransition: false  # Don't reset on self-loop
```

**Timeline:**
- T=0s: Enter `Processing` → timer starts (60s)
- T=10s: `UPDATE` event → self-loop to `Processing` → **timer continues** (50s left)
- T=30s: `UPDATE` event → self-loop to `Processing` → **timer continues** (30s left)
- T=60s: **TIMEOUT fires** → transition to `Failed`

**Total time in state:** 60 seconds (regardless of updates)

---

### Option 2: `resetOnTransition: true` (Inactivity Timeout, Default)

**Timer RESETS** on every transition (including self-loops).

```yaml
- from: Processing
  to: Processing
  event: UPDATE
  type: triggerable
  # Self-loop transition

- from: Processing
  to: Stale
  event: TIMEOUT
  type: timeout
  timeoutMs: 30000  # 30 seconds since last update
  resetOnTransition: true  # Reset on each transition (default)
```

**Timeline:**
- T=0s: Enter `Processing` → timer starts (30s)
- T=10s: `UPDATE` event → self-loop → **timer RESETS to 30s**
- T=35s: `UPDATE` event → self-loop → **timer RESETS to 30s again**
- T=65s: **TIMEOUT fires** (30s since last update) → transition to `Stale`

**Total time in state:** 65 seconds (30s after last update)

---

## 📋 Use Cases

### Total Time in State (`resetOnTransition: false`)

| Use Case | Description |
|----------|-------------|
| **SLA enforcement** | "Order must complete within 2 hours total" |
| **Maximum processing time** | "Video encoding has max 10 minutes total" |
| **Hard deadlines** | "Form submission expires 24 hours after creation" |
| **Session expiration** | "Login session expires 8 hours after creation" |

**Example: Trading Order**
```yaml
# Order expires 30 seconds after entering PartiallyExecuted
# Even if partial fills arrive, timer doesn't reset
- from: PartiallyExecuted
  to: Expired
  event: TIMEOUT
  type: timeout
  timeoutMs: 30000
  resetOnTransition: false
```

---

### Inactivity Timeout (`resetOnTransition: true`)

| Use Case | Description |
|----------|-------------|
| **Heartbeat/keep-alive** | "Mark as offline if no heartbeat for 60s" |
| **Inactivity detection** | "Auto-logout after 15 minutes of inactivity" |
| **Stale data detection** | "Mark as stale if no updates for 5 minutes" |
| **Idle timeouts** | "Close connection if idle for 2 minutes" |

**Example: Health Monitor**
```yaml
# Mark service as unhealthy if no heartbeat for 30 seconds
# Each heartbeat resets the timer
- from: Healthy
  to: Healthy
  event: HEARTBEAT
  type: triggerable

- from: Healthy
  to: Unhealthy
  event: TIMEOUT
  type: timeout
  timeoutMs: 30000
  resetOnTransition: true  # Reset on each HEARTBEAT
```

---

## 🔄 How It Works Internally

### Self-Loop Detection

When a transition fires:
1. Runtime checks if it's a self-loop (`previousState === newState`)
2. If **NOT** a self-loop:
   - Clear **ALL** old timeouts
   - Setup new timeouts for new state
3. If **self-loop**:
   - For each timeout with `resetOnTransition === false`: **keep running**
   - For each timeout with `resetOnTransition === true`: **clear and restart**

### Example with Multiple Timeouts

```yaml
states:
  - name: Active

transitions:
  # Self-loop
  - from: Active
    to: Active
    event: KEEPALIVE
    type: triggerable

  # Timeout 1: Total time limit (don't reset)
  - from: Active
    to: ExpiredHard
    event: HARD_TIMEOUT
    type: timeout
    timeoutMs: 3600000  # 1 hour total
    resetOnTransition: false

  # Timeout 2: Inactivity (reset on each keepalive)
  - from: Active
    to: ExpiredIdle
    event: IDLE_TIMEOUT
    type: timeout
    timeoutMs: 300000  # 5 minutes idle
    resetOnTransition: true
```

**Behavior:**
- On `KEEPALIVE` event (self-loop):
  - `HARD_TIMEOUT` timer **continues running** (tracks total time)
  - `IDLE_TIMEOUT` timer **resets** (tracks inactivity)
- Whichever timeout fires first wins!

---

## ⚠️ Important Notes

1. **Default behavior**: If `resetOnTransition` is omitted, defaults to `true` (backward compatible)

2. **Only affects self-loops**: For regular state changes (A → B), ALL timeouts are always cleared/reset

3. **Multiple timeouts**: You can have multiple timeout transitions from the same state with different `resetOnTransition` values

4. **First timeout wins**: If multiple timeouts fire, only the first one executes

5. **Timer precision**: Timeouts use a timer wheel for efficiency (±100ms precision)

---

## 💡 Best Practices

1. **Be explicit**: Always set `resetOnTransition` to make intent clear
   ```yaml
   # ✅ Good - intent is clear
   resetOnTransition: false  # Total time in state

   # ❌ Avoid - ambiguous
   # (omitting defaults to true)
   ```

2. **Document your choice**: Add comments explaining why
   ```yaml
   - from: Processing
     to: Expired
     event: TIMEOUT
     type: timeout
     timeoutMs: 300000
     resetOnTransition: false  # SLA: 5 minutes total processing time
   ```

3. **Test edge cases**:
   - What happens with rapid self-loops?
   - What if timeout fires during a self-loop?
   - What if instance transitions to different state before timeout?

4. **Combine with guards**: Use guards to handle complex timeout logic
   ```yaml
   - from: Processing
     to: Expired
     event: TIMEOUT
     type: timeout
     timeoutMs: 60000
     resetOnTransition: false
     guards:
       - type: context
         property: retryCount
         operator: ">="
         value: 3
   ```

---

## 🧪 Testing Example

```bash
# Start server
xcomponent-ai serve examples/advanced-patterns-demo.yaml

# Create instance
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

# Submit (enters PartiallyExecuted)
curl -X POST http://localhost:3000/api/instances/{instanceId}/events \
  -H "Content-Type: application/json" \
  -d '{"type": "SUBMIT"}'

# Send partial execution (self-loop)
curl -X POST http://localhost:3000/api/instances/{instanceId}/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "EXECUTION_NOTIFICATION",
    "payload": {"quantity": 300, "price": 150.50}
  }'

# With resetOnTransition: false
# → Timeout still counting from initial entry to PartiallyExecuted
# → Will fire 30s after FIRST entering PartiallyExecuted

# With resetOnTransition: true
# → Timeout reset to 30s from this partial execution
# → Will fire 30s after LAST update
```

---

## 📚 Related Guides

- [ADVANCED-PATTERNS-GUIDE.md](./ADVANCED-PATTERNS-GUIDE.md) - Complete pattern examples
- [examples/advanced-patterns-demo.yaml](./examples/advanced-patterns-demo.yaml) - Working example

**Built for precise timeout control.** ⏰
