# 🚀 Quick Start Guide

This guide shows you how to use xcomponent-ai in 5 minutes.

## 📦 Installation

```bash
npm install -g xcomponent-ai
```

## 🎯 Workflow in 4 Steps

### 1. Create or Use an FSM

Use a provided example:
```bash
# List available examples
ls $(npm root -g)/xcomponent-ai/examples/

# Load an example to see its structure
xcomponent-ai load examples/trading.yaml
```

Or create your own project:
```bash
xcomponent-ai init my-project
cd my-project
```

### 2. Start Runtime + Dashboard

**This is THE main command** - it starts:
- ✅ FSM runtime (to create and manage instances)
- ✅ REST API (to send events)
- ✅ Web dashboard (for real-time visualization)

```bash
xcomponent-ai serve examples/trading.yaml
```

**Expected output:**
```
🚀 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Component: TradingComponent
   Machines:
   - OrderEntry (5 states, 7 transitions)
   - Settlement (3 states, 3 transitions)

🌐 API Server:    http://localhost:3000
📊 Dashboard:     http://localhost:3000/dashboard
📡 WebSocket:     ws://localhost:3000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Press Ctrl+C to stop
```

### 3. Visualize in the Dashboard

Open your browser to **http://localhost:3000/dashboard**

You'll see:
- 📊 **All active instances** (real-time table)
- 🔄 **State transitions** in real-time
- 📈 **Statistics** (instance count per state)
- 🎨 **Visual FSM graph**

### 4. Interact with the Runtime

**Option A: Via REST API (curl)**

```bash
# Create a new instance
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{
    "machineName": "OrderEntry",
    "context": {
      "orderId": "ORD-001",
      "amount": 1000,
      "symbol": "AAPL"
    }
  }'

# Response: {"instanceId": "abc-123"}

# Send an event
curl -X POST http://localhost:3000/api/instances/abc-123/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "VALIDATE",
    "payload": {}
  }'

# Check instance state
curl http://localhost:3000/api/instances/abc-123

# List all instances
curl http://localhost:3000/api/instances
```

**Option B: Via CLI (interactive mode)**

```bash
# Start REPL mode
xcomponent-ai repl examples/trading.yaml

# Then type commands:
> create OrderEntry { orderId: "ORD-001", amount: 1000 }
Instance created: abc-123

> send abc-123 VALIDATE
Transition: Pending → Validated

> list
Instances:
- abc-123 (OrderEntry) : Validated

> inspect abc-123
Instance: abc-123
Machine: OrderEntry
State: Validated
Context: { orderId: "ORD-001", amount: 1000, symbol: "AAPL" }
```

**Option C: Via Web Dashboard**

1. Open http://localhost:3000/dashboard
2. Click **"Create Instance"** button
3. Select machine: `OrderEntry`
4. Enter context: `{ "orderId": "ORD-001", "amount": 1000 }`
5. Click **"Create"**
6. Watch the instance appear in the table
7. Click on instance to send events

## 🔍 Monitor FSM

### View real-time logs

In the terminal where `xcomponent-ai serve` is running:
```
[14:32:15] Instance abc-123 created (OrderEntry)
[14:32:18] abc-123: Pending → Validated (event: VALIDATE)
[14:32:20] abc-123: Validated → Executed (event: EXECUTE)
```

### Analyze logs

```bash
# In another terminal
xcomponent-ai logs --component TradingComponent

# Filter by instance
xcomponent-ai logs --instance abc-123

# View statistics
xcomponent-ai stats
```

## 🧪 Test Complete Scenario

```bash
# 1. Start runtime
xcomponent-ai serve examples/trading.yaml &

# 2. Create instance
INSTANCE=$(curl -s -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{"machineName": "OrderEntry", "context": {"orderId": "ORD-001"}}' \
  | jq -r '.instanceId')

# 3. Send events in sequence
curl -X POST http://localhost:3000/api/instances/$INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "VALIDATE"}'

sleep 1

curl -X POST http://localhost:3000/api/instances/$INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "EXECUTE"}'

# 4. Check final state
curl http://localhost:3000/api/instances/$INSTANCE
```

## 📝 Create Your Own FSM

```bash
# Create new project
xcomponent-ai init loan-approval

cd loan-approval

# Edit fsm/LoanApprovalComponent.yaml
# (Add your states, transitions, guards)

# Test your FSM
xcomponent-ai serve fsm/LoanApprovalComponent.yaml
```

## 🎓 Next Steps

- 📖 Read the [Framework Guide](./LLM_FRAMEWORK_GUIDE.md) to understand concepts
- 🔧 See [PERSISTENCE.md](./PERSISTENCE.md) for event sourcing and persistence
- 💡 Check [examples/](./examples/) for advanced use cases

## ❓ FAQ

**Q: How long do instances stay in memory?**
A: As long as the `xcomponent-ai serve` server is running. For persistence, see PERSISTENCE.md

**Q: How to stop the runtime?**
A: Press Ctrl+C in the terminal where `xcomponent-ai serve` is running

**Q: Can I deploy to production?**
A: Yes, but use programmatic mode (see examples/full-project-structure.md)

**Q: Does the dashboard work with multiple components?**
A: Not yet with `xcomponent-ai serve`, but yes in programmatic mode
