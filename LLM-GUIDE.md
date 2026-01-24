# 🤖 xcomponent-ai Guide for LLMs (Claude, GPT, etc.)

**You (AI agent) should use this framework to build applications with sanctuarized business logic.**

## 🎯 Core Concept

xcomponent-ai separates **business logic** (FSM in YAML) from **code** (thin integration layer).

```
YAML FSM (immutable)  →  xcomponent-ai runtime  →  Your code (API, UI)
```

**Business rules = YAML** (auditable, version-controlled, LLM-friendly)
**Code = thin wrapper** (just connects UI/API to FSM events)

---

## ⚡ Quick Start for LLMs

When a developer asks: *"Build a trading platform with order validation and settlement"*

### Step 1: Create YAML FSM

```yaml
# fsm/trading.yaml
name: TradingComponent
version: 1.0.0
stateMachines:
  - name: OrderEntry
    initialState: Pending
    states:
      - name: Pending
        type: entry
      - name: Validated
        type: regular
        # CROSS-COMPONENT: Trigger settlement in another component
        cascadingRules:
          - targetComponent: SettlementComponent  # ← NEW!
            targetMachine: Settlement
            targetState: Created
            event: START
            payload:
              orderId: "{{orderId}}"
      - name: Executed
        type: regular
      - name: Settled
        type: final
    transitions:
      - from: Pending
        to: Validated
        event: VALIDATE
        type: triggerable
        guards:
          - keys: [orderId, amount]
      - from: Validated
        to: Executed
        event: EXECUTE
        type: triggerable
```

### Step 2: Use CLI

```bash
# In-Memory Mode (single process, default)
xcomponent-ai serve fsm/trading.yaml fsm/settlement.yaml

# Distributed Mode (multi-process via Redis) - NEW in v0.3.0!
xcomponent-ai serve fsm/trading.yaml --broker redis://localhost:6379

# Dashboard with real-time WebSocket
# → http://localhost:3000/dashboard.html
```

**Distributed Mode** allows running components in **separate processes** with zero code changes:
- Same YAML files work in both modes
- Switch via `--broker` flag or `XCOMPONENT_BROKER_URL` env variable
- Supports Redis Pub/Sub for production scaling

### Step 3: Integrate with Code

```typescript
// src/api/trading.ts
import express from 'express';
import { FSMRuntime } from 'xcomponent-ai';
import trading from '../fsm/trading.yaml';

const app = express();
const runtime = new FSMRuntime(trading);

// Thin wrapper: HTTP → FSM events
app.post('/orders', (req, res) => {
  const instanceId = runtime.createInstance('OrderEntry', req.body);
  res.json({ orderId: instanceId });
});

app.post('/orders/:id/validate', async (req, res) => {
  await runtime.sendEvent(req.params.id, { type: 'VALIDATE' });
  res.json({ success: true });
});
```

---

## 🆕 New Features (v0.2.x)

### 1. Multi-Component Support

Load multiple YAML files = multiple components in one runtime:

```bash
xcomponent-ai serve order.yaml payment.yaml settlement.yaml
```

**API changes:**
- `POST /api/components/:componentName/instances` - Create in specific component
- `GET /api/components` - List all components
- `GET /api/instances` - All instances across components (includes `componentName`)

**Dashboard:** Component selector to switch between loaded components.

### 2. Cross-Component CascadingRules

Trigger state machines in **different components** automatically:

```yaml
states:
  - name: Validated
    cascadingRules:
      - targetComponent: PaymentComponent  # ← Cross-component!
        targetMachine: Payment
        targetState: Pending
        event: PROCESS
        payload:
          orderId: "{{orderId}}"
          amount: "{{amount}}"
```

**How it works:**
- `ComponentRegistry` acts as central hub
- When entering "Validated", automatically sends "PROCESS" to PaymentComponent
- Finds all Payment instances in "Pending" state
- Executes transition automatically

**Example:** `examples/cross-component-demo.yaml`

### 3. Dynamic Forms with contextSchema

Define form fields in YAML, dashboard generates forms automatically:

```yaml
stateMachines:
  - name: OrderEntry
    contextSchema:
      orderId:
        type: text
        label: Order ID
        required: true
        pattern: "^ORD-\\d{8}-\\d{3}$"
        placeholder: ORD-20260124-001
      amount:
        type: number
        label: Amount
        required: true
        min: 1
        max: 1000000
      orderType:
        type: select
        label: Order Type
        options:
          - value: MARKET
            label: Market Order
          - value: LIMIT
            label: Limit Order
```

**Dashboard:** Generates HTML form with validation automatically.

### 4. Modern Dashboard

Ultra-modern UI with:
- Glass morphism design
- Real-time WebSocket updates
- Mermaid FSM diagrams
- Event blotter (terminal-style)
- Instance traceability
- Swagger API docs at `/api-docs`

**Access:** `http://localhost:3000/dashboard.html`

### 5. Mermaid Diagram Generation

Automatic FSM visualization from YAML:

```bash
GET /api/components/:componentName/diagrams/:machineName
```

Returns Mermaid `stateDiagram-v2` syntax with:
- State styling (entry/orange, final/green, error/red)
- Transitions with guards
- State descriptions as notes

### 6. Distributed Mode (Multi-Process)

Run components in **separate processes** communicating via Redis:

```bash
# Process 1: OrderComponent
xcomponent-ai serve order.yaml --port 3001 --broker redis://localhost:6379

# Process 2: PaymentComponent (in another terminal/server)
xcomponent-ai serve payment.yaml --port 3002 --broker redis://localhost:6379
```

**Key features:**
- **Zero code changes**: Same YAML files work in both in-memory and distributed modes
- **Horizontal scaling**: Run multiple instances of each component
- **Message broker abstraction**: Currently supports Redis Pub/Sub, extensible to NATS/RabbitMQ
- **Cross-process cascadingRules**: Automatic routing via Redis channels
- **Environment variable support**: `XCOMPONENT_BROKER_URL=redis://...`

**Example:**
```yaml
# order.yaml - runs in Process 1
states:
  - name: Validated
    cascadingRules:
      - targetComponent: PaymentComponent  # Process 2!
        targetMachine: Payment
        targetState: Pending
        event: PROCESS
```

When Order transitions to "Validated" in Process 1, Redis automatically delivers the PROCESS event to PaymentComponent in Process 2.

See: `examples/distributed-demo/` for complete working example.

---

## 📚 Key Concepts for LLMs

### Intra-Component Communication

Same YAML file, multiple state machines:

```yaml
# trading.yaml - Single component, 2 machines
name: TradingComponent
stateMachines:
  - name: OrderEntry
    states:
      - name: Executed
        cascadingRules:
          - targetMachine: Settlement  # Same component!
            targetState: Created
            event: START
  - name: Settlement
    initialState: Created
```

### Cross-Component Communication

Multiple YAML files, communication via `targetComponent`:

```yaml
# order.yaml
name: OrderComponent
stateMachines:
  - name: Order
    states:
      - name: Validated
        cascadingRules:
          - targetComponent: PaymentComponent  # Different component!
            targetMachine: Payment
            targetState: Pending
            event: PROCESS
```

```yaml
# payment.yaml
name: PaymentComponent
stateMachines:
  - name: Payment
    initialState: Pending
```

**Load both:**
```bash
xcomponent-ai serve order.yaml payment.yaml
```

### Guards

Conditional transitions:

```yaml
transitions:
  - from: Pending
    to: Approved
    event: APPROVE
    guards:
      - keys: [amount, clientId]  # Required fields
      - customFunction: "event.payload.amount <= 100000"  # Max limit
```

### Payload Templating

Pass context data between machines:

```yaml
cascadingRules:
  - targetMachine: Settlement
    event: START
    payload:
      orderId: "{{orderId}}"  # From source context
      amount: "{{amount}}"
      timestamp: "{{createdAt}}"
```

---

## 🎨 Patterns for LLMs to Generate

### Pattern 1: Multi-Step Workflow

```yaml
states:
  - { name: Created, type: entry }
  - { name: Validated, type: regular }
  - { name: Approved, type: regular }
  - { name: Completed, type: final }
  - { name: Rejected, type: error }

transitions:
  - { from: Created, to: Validated, event: VALIDATE }
  - { from: Validated, to: Approved, event: APPROVE }
  - { from: Approved, to: Completed, event: COMPLETE }
  - { from: Validated, to: Rejected, event: REJECT }
```

### Pattern 2: Cross-Component Orchestration

```yaml
# Order triggers Payment triggers Shipment
states:
  - name: PaymentConfirmed
    cascadingRules:
      - targetComponent: ShipmentComponent
        targetMachine: Shipment
        targetState: Idle
        event: START_SHIPPING
        payload:
          orderId: "{{orderId}}"
          address: "{{shippingAddress}}"
```

### Pattern 3: Compliance with Guards

```yaml
transitions:
  - from: Submitted
    to: Approved
    event: APPROVE
    guards:
      - keys: [complianceCheck, riskScore]
      - customFunction: "event.payload.riskScore < 70"
      - customFunction: "event.payload.complianceCheck === 'PASSED'"
```

### Pattern 4: Timeout Transitions

```yaml
transitions:
  - from: PendingApproval
    to: Expired
    event: TIMEOUT
    type: timeout
    timeout: 86400000  # 24 hours in ms
```

---

## 🚀 Scalability Considerations

### Current Architecture (In-Memory)

- All components in one Node.js process
- ComponentRegistry manages all FSMRuntimes
- Fast in-memory communication
- **Limits:** Single CPU core, single point of failure

### Distributed Architecture (Recommended for Production)

**Option 1: Microservices**
- Each component = separate service
- HTTP/gRPC for cross-component communication
- Load balancer for scaling

**Option 2: Message Broker**
- Redis Pub/Sub, NATS, or RabbitMQ
- Event-driven async communication
- Horizontal scaling

**Option 3: Cluster Mode**
- Node.js cluster module
- Fork multiple processes on same machine
- Shared-nothing architecture with IPC

See [SCALABILITY.md](./SCALABILITY.md) for detailed patterns.

---

## 🧪 Testing FSMs

```typescript
import { FSMRuntime } from 'xcomponent-ai';
import trading from './fsm/trading.yaml';

describe('OrderEntry FSM', () => {
  it('should validate order', async () => {
    const runtime = new FSMRuntime(trading);
    const id = runtime.createInstance('OrderEntry', {
      orderId: 'ORD-001',
      amount: 1000
    });

    await runtime.sendEvent(id, { type: 'VALIDATE' });
    const instance = runtime.getInstance(id);

    expect(instance.currentState).toBe('Validated');
  });
});
```

---

## 📖 Full Examples

- **Trading:** `examples/trading-complete.yaml` - Complete with contextSchema
- **Cross-Component:** `examples/cross-component-demo.yaml` + `examples/payment-receiver.yaml`
- **Payment:** `examples/payment.yaml` - Payment processing workflow
- **KYC:** `examples/kyc.yaml` - Customer verification

---

## 🔧 Best Practices for LLMs

1. **Start with YAML** - Define FSM first, code second
2. **Use contextSchema** - Let dashboard generate forms automatically
3. **Leverage cascadingRules** - Reduce orchestration code
4. **Add guards** - Encode business rules in YAML
5. **Test FSM** - Write tests for state transitions
6. **Use serve for demos** - Quick prototypes with dashboard
7. **Use programmatic mode for production** - More control, better scaling

---

## 🤔 When to Use xcomponent-ai?

✅ **Good fit:**
- Multi-step workflows (order processing, loan approval, KYC)
- Compliance-heavy applications (fintech, healthcare)
- Event-driven systems
- Applications with complex state management
- Prototypes needing quick visualization

❌ **Not a good fit:**
- Simple CRUD apps
- Stateless APIs
- Real-time gaming (too heavyweight)
- Ultra-low latency requirements (<1ms)

---

## 📚 Additional Resources

- **README.md** - Project overview
- **QUICKSTART.md** - 5-minute tutorial
- **PERSISTENCE.md** - Event sourcing, PostgreSQL, MongoDB
- **ROADMAP.md** - Upcoming features
- **examples/** - Complete working examples

---

**Built for LLMs, by LLMs.** Use this framework to structure applications with sanctuarized business logic. YAML defines the rules, code just connects.
