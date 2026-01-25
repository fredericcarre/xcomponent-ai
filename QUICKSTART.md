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
xcomponent-ai load examples/order-processing-xcomponent.yaml
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
xcomponent-ai serve examples/order-processing-xcomponent.yaml
```

**Expected output:**
```
🚀 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Component: OrderProcessingComponent
   Machines:
   - Order (5 states, 6 transitions)
   - Execution (4 states, 5 transitions)

🌐 API Server:    http://localhost:3000
📊 Dashboard:     http://localhost:3000/dashboard.html
📚 API Docs:      http://localhost:3000/api-docs
📡 WebSocket:     ws://localhost:3000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Press Ctrl+C to stop
```

### 3. Visualize in the Dashboard

Open your browser to **http://localhost:3000/dashboard.html**

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
    "machineName": "Order",
    "context": {
      "Id": 1,
      "AssetName": "AAPL",
      "Quantity": 1000,
      "ExecutedQuantity": 0,
      "RemainingQuantity": 1000
    }
  }'

# Response: {"instanceId": "abc-123"}

# Send an event
curl -X POST http://localhost:3000/api/instances/abc-123/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "FILL",
    "payload": {
      "Quantity": 500
    }
  }'

# Check instance state
curl http://localhost:3000/api/instances/abc-123

# List all instances
curl http://localhost:3000/api/instances
```

**Option B: Via Web Dashboard**

1. Open http://localhost:3000/dashboard.html
2. Go to the **"FSM Diagram"** tab (default view)
3. Select machine: `Order` from the dropdown
4. Fill in the context fields:
   - Id: 1
   - AssetName: AAPL
   - Quantity: 1000
   - ExecutedQuantity: 0
   - RemainingQuantity: 1000
5. Click **"Create Instance"**
6. Watch the instance appear in the "Active Instances" list
7. Click on instance to view details

## 🔍 Monitor FSM

### View real-time logs

In the terminal where `xcomponent-ai serve` is running, you'll see real-time activity:
```
[14:32:15] Instance abc-123 created (Order)
[14:32:18] abc-123: Pending → PartiallyExecuted (event: FILL)
[14:32:20] abc-123: PartiallyExecuted → FullyExecuted (event: FILL)
```

### Monitor via Dashboard

The web dashboard at **http://localhost:3000/dashboard.html** provides:
- **📊 Event Blotter**: Real-time event stream with filtering
- **📈 Statistics**: Instance counts by state (active, final, error)
- **🎨 FSM Diagrams**: Visual state machine representations
- **🔍 Traceability**: Instance history and transitions

### Check Instance Status via API

```bash
# Get specific instance details
curl http://localhost:3000/api/instances/abc-123

# List all instances
curl http://localhost:3000/api/instances

# Get component info
curl http://localhost:3000/api/components
```

## 🧪 Test Complete Scenario

```bash
# 1. Start runtime
xcomponent-ai serve examples/order-processing-xcomponent.yaml &

# 2. Create instance
INSTANCE=$(curl -s -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{"machineName": "Order", "context": {"Id": 1, "AssetName": "AAPL", "Quantity": 1000, "ExecutedQuantity": 0, "RemainingQuantity": 1000}}' \
  | jq -r '.instanceId')

# 3. Send events in sequence (partial fill, then complete fill)
curl -X POST http://localhost:3000/api/instances/$INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "FILL", "payload": {"Quantity": 500}}'

sleep 1

curl -X POST http://localhost:3000/api/instances/$INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "FILL", "payload": {"Quantity": 500}}'

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
A: Yes! Use `xcomponent-ai serve file1.yaml file2.yaml file3.yaml` to load multiple components. The dashboard has a component selector to switch between them.
