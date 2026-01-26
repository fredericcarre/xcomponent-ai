# XComponent Pattern Guide

## 🏗️ What is the XComponent Pattern?

The XComponent pattern enables orchestration of multiple state machines within a single component:

- **Entry Point**: A main machine automatically created at startup
- **Inter-Machine Transitions**: Dynamically create new instances of other machines
- **Auto-Deallocation**: Instances are automatically destroyed in final state (except entry point)
- **Overview**: Dashboard showing all machines and their connections

## 🚀 Quick Start

### 1. Use the XComponent Example

```bash
xcomponent-ai serve examples/xcomponent-pattern-demo.yaml
```

**Expected output:**
```
🚀 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[10:15:46] [OrderProcessingXComponent] ⭐ Entry point instance created: be94a22e (OrderManager)

📦 Component: OrderProcessingXComponent
   ⭐ Entry Point: OrderManager
   Machines:
   - OrderManager (4 states, 4 transitions)
   - OrderExecution (6 states, 6 transitions)
   - Settlement (3 states, 3 transitions)
```

### 2. Open the Dashboard

```bash
open http://localhost:3000/dashboard.html
```

**What you'll see:**
- **"Component View" tab** (default) showing all machines
- **OrderManager** with a star ⭐ (entry point) and badge [1] (1 active instance)
- **Green arrows** between machines = inter_machine transitions
- **Instance counter** for each machine

### 3. Create Instances via Inter-Machine Transitions

**Option A: Via Dashboard Component View**
1. Click on the **green arrow** between OrderManager and OrderExecution
2. This triggers the `START_EXECUTION` transition
3. A new OrderExecution instance is automatically created
4. The counter increments in real-time

**Option B: Via API**
```bash
# Get the entry point instance ID
ENTRY_INSTANCE=$(curl -s http://localhost:3000/api/instances | jq -r '.instances[0].id')

# Move OrderManager to OrderReceived state
curl -X POST http://localhost:3000/api/instances/$ENTRY_INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "NEW_ORDER", "payload": {}}'

# Trigger the inter_machine transition (creates OrderExecution)
curl -X POST http://localhost:3000/api/instances/$ENTRY_INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "START_EXECUTION", "payload": {}}'
```

## 📝 YAML Structure for XComponent

```yaml
name: MyComponent
version: 1.0.0

# Specify the entry point
entryMachine: MachineManager  # ⭐ Automatically created

# Optional layout configuration
layout:
  algorithm: grid  # or 'force', 'hierarchical'

stateMachines:
  # Entry Point - persists even in final state
  - name: MachineManager
    initialState: Ready

    states:
      - name: Ready
        type: entry
      - name: Completed
        type: final  # Entry point stays alive even here

    transitions:
      # Normal transition
      - from: Ready
        to: Processing
        event: START
        type: triggerable

      # inter_machine transition - creates a new instance
      - from: Processing
        to: Ready
        event: CREATE_WORKER
        type: inter_machine        # ← Special type
        targetMachine: WorkerMachine  # ← Machine to create

  # Dynamically created machine
  - name: WorkerMachine
    initialState: Created

    states:
      - name: Created
        type: entry
      - name: Done
        type: final  # Auto-deallocated here

    transitions:
      - from: Created
        to: Done
        event: FINISH
        type: triggerable
```

## 🔄 Instance Lifecycle

### Entry Point (MachineManager)
```
Component Startup
  ↓
⭐ Instance automatically created
  ↓
[Stays alive for the entire component lifetime]
  ↓
Final State → PERSISTS ⭐
```

### Normal Machines (WorkerMachine)
```
inter_machine transition triggered
  ↓
🔄 Instance dynamically created
  ↓
[Processing...]
  ↓
Final State → DEALLOCATED ✓
```

## 🎨 Dashboard - Component View

### Default View
```
🏗️ Component View
┌────────────────────────────────────┐
│ ⭐ MachineManager    [1]           │
│ (Entry Point)                      │
│           ↓ (CREATE_WORKER)        │ ← Click here!
│ WorkerMachine        [5]           │
└────────────────────────────────────┘
```

### Available Actions
- **Click on a machine card** → Detailed diagram view
- **Click on a green arrow** → Execute the inter_machine transition
- **Counter badge** → Number of active instances

## 📊 Monitoring

### Real-Time Logs
```bash
[10:15:46] [MyComponent] ⭐ Entry point instance created: be94a22e (MachineManager)
[10:16:01] [MyComponent] abc123: Ready → Processing (event: START)
[10:16:05] [MyComponent] Instance def456 created (WorkerMachine)
[10:16:10] [MyComponent] def456: Created → Done (event: FINISH)
[10:16:10] [MyComponent] Instance def456 disposed (WorkerMachine)
```

### Instance API
```bash
# List all instances
curl http://localhost:3000/api/instances

# Check if an instance is the entry point
curl http://localhost:3000/api/instances | jq '.instances[] | select(.isEntryPoint == true)'
```

## 🎯 Use Cases

### Workflow Orchestration
```yaml
entryMachine: OrderOrchestrator

stateMachines:
  - name: OrderOrchestrator  # Coordinates everything
    transitions:
      - type: inter_machine
        targetMachine: OrderValidation
      - type: inter_machine
        targetMachine: PaymentProcessing
      - type: inter_machine
        targetMachine: Shipping

  - name: OrderValidation    # Sub-workflow
  - name: PaymentProcessing  # Sub-workflow
  - name: Shipping           # Sub-workflow
```

### Pool Management
```yaml
entryMachine: PoolManager

stateMachines:
  - name: PoolManager  # Creates workers on demand
    transitions:
      - type: inter_machine
        targetMachine: Worker

  - name: Worker  # Auto-destroyed after processing
    states:
      - name: Done
        type: final  # ✓ Deallocated
```

## ⚠️ Best Practices

1. **One entry point per component**
   - Clearly mark with `entryMachine`
   - Use a meaningful name (Manager, Orchestrator, Coordinator)

2. **Clear inter_machine transitions**
   - Explicit names: `CREATE_EXECUTION`, `START_SETTLEMENT`
   - Document the flow in metadata

3. **Appropriate final states**
   - Use `type: final` for auto-deallocation
   - Entry point can remain in final (it persists)

4. **Monitoring**
   - Observe logs for debugging
   - Use Component View for overview

## 🐛 Troubleshooting

### Entry point is not created
```bash
# Check that entryMachine is defined
grep "entryMachine" my-component.yaml

# Check logs at startup
xcomponent-ai serve my-component.yaml
# Look for: "⭐ Entry point instance created"
```

### inter_machine transitions don't work
```bash
# Check the transition type
grep -A 2 "inter_machine" my-component.yaml
# Must have: type: inter_machine + targetMachine: MachineName

# Check that the target machine exists
grep "name:" my-component.yaml
```

### Instances are not deallocated
```bash
# Check that the state is marked final
grep -A 1 "type: final" my-component.yaml

# Check that it's not the entry point
curl http://localhost:3000/api/instances | jq '.instances[] | select(.isEntryPoint == true)'
```

## 📚 Complete Examples

- `examples/xcomponent-pattern-demo.yaml` - Complete demo with 3 machines
- `examples/order-processing-xcomponent.yaml` - Order processing (with guards - legacy version)

## 🔗 Resources

- [CHANGELOG.md](./CHANGELOG.md) - Version history
- [QUICKSTART.md](./QUICKSTART.md) - Quick start guide
- [LLM-GUIDE.md](./LLM-GUIDE.md) - Guide for AI
