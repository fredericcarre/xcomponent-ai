# XComponent Pattern Testing Guide

## Important: Use the RIGHT Example!

### DON'T use `explicit-transitions-demo.yaml`
This example **DOES NOT** have:
- `entryMachine` → no instance created at startup
- `inter_machine` transitions → no green arrows in Component View
- It only demonstrates the `sender.sendToSelf()` pattern

### USE `simple-xcomponent-demo.yaml`
This example **HAS EVERYTHING**:
- `entryMachine: Coordinator` → 1 instance created automatically
- 1 `inter_machine` transition → green arrow from Coordinator → Worker
- Complete Component View

## Step-by-Step Testing

### 1. Start the Server

```bash
xcomponent-ai serve examples/simple-xcomponent-demo.yaml
```

**What you MUST see in the terminal:**
```
 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[10:15:46] [SimpleXComponent] Entry point instance created: abc12345 (Coordinator)

 Component: SimpleXComponent
    Entry Point: Coordinator    ← IMPORTANT: Entry point is shown here
   Machines:
   - Coordinator (3 states, 3 transitions)
   - Worker (3 states, 2 transitions)
```

### 2. Verify the Entry Point Instance

In another terminal:

```bash
# Check that an instance was created automatically
curl http://localhost:3000/api/instances
```

**Expected result:**
```json
{
  "instances": [
    {
      "id": "abc12345-...",
      "machineName": "Coordinator",
      "currentState": "Ready",
      "status": "active",
      "isEntryPoint": true,    ← IMPORTANT: Marked as entry point
      "componentName": "SimpleXComponent"
    }
  ]
}
```

### 3. Open the Dashboard

```bash
open http://localhost:3000/dashboard.html
```

## What You Should See in the Dashboard

### Component View (Default Tab)

```
┌─────────────────────────────────────────┐
│   Component Overview: SimpleXComponent │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────┐                      │
│  │  Coordinator│ [1]  ← Badge with 1 instance
│  │ Entry Point  │                      │
│  │ 3 states     │                      │
│  └──────┬───────┘                      │
│         │                              │
│         ↓ CREATE_WORKER (green arrow) ← Click here!
│         │                              │
│  ┌──────┴───────┐                      │
│  │ Worker       │ [0]  ← No instance yet
│  │ 3 states     │                      │
│  └──────────────┘                      │
└─────────────────────────────────────────┘
```

**Key Points:**
- **Yellow star** next to "Coordinator" → It's the entry point
- **Badge [1]** → 1 active Coordinator instance
- **Badge [0]** → 0 Worker instances (normal, not created yet)
- **Green arrow** between Coordinator and Worker → `inter_machine` transition

### 4. Test Instance Creation via Green Arrow

#### Step A: Prepare the Coordinator

The Coordinator must be in the `Working` state to trigger `CREATE_WORKER`.

```bash
# Get the entry point instance ID
ENTRY=$(curl -s http://localhost:3000/api/instances | jq -r '.instances[0].id')

# Move to Working state
curl -X POST http://localhost:3000/api/instances/$ENTRY/events \
  -H "Content-Type: application/json" \
  -d '{"type": "START", "payload": {}}'
```

**In the dashboard**, you'll see:
- Coordinator moves from `Ready` → `Working`

#### Step B: Click the Green Arrow

1. **In Component View**, click on the **green arrow** between Coordinator and Worker
2. A popup asks for the instance (only one exists, so auto-validation)
3. The `CREATE_WORKER` event is sent

**Immediate Result:**
- A **new Worker instance** is created!
- Worker badge changes from [0] to [1]
- In the terminal: `[10:16:05] Instance xyz789 created (Worker)`

#### Step C: Verify the Instances

```bash
curl http://localhost:3000/api/instances
```

**Expected result:**
```json
{
  "instances": [
    {
      "id": "abc12345-...",
      "machineName": "Coordinator",
      "currentState": "Ready",
      "isEntryPoint": true    ← Entry point (persists)
    },
    {
      "id": "xyz789-...",
      "machineName": "Worker",
      "currentState": "Created",
      "isEntryPoint": false   ← Regular instance (will be deallocated)
    }
  ]
}
```

### 5. Test Auto-Deallocation

```bash
# Get the Worker ID
WORKER=$(curl -s http://localhost:3000/api/instances | jq -r '.instances[] | select(.machineName == "Worker") | .id')

# Complete the Worker (move to final state)
curl -X POST http://localhost:3000/api/instances/$WORKER/events \
  -H "Content-Type: application/json" \
  -d '{"type": "PROCESS", "payload": {}}'

curl -X POST http://localhost:3000/api/instances/$WORKER/events \
  -H "Content-Type: application/json" \
  -d '{"type": "COMPLETE", "payload": {}}'
```

**Expected Result:**
- Worker moves to `Completed` state (type: final)
- **Worker is AUTOMATICALLY DEALLOCATED**
- Worker badge goes from [1] back to [0]
- Terminal shows: `Instance xyz789 disposed (Worker)`

```bash
# Verify the Worker was deallocated
curl http://localhost:3000/api/instances
# → Only the Coordinator remains!
```

### 6. Test Entry Point Persistence

```bash
# Move the Coordinator to final state
curl -X POST http://localhost:3000/api/instances/$ENTRY/events \
  -H "Content-Type: application/json" \
  -d '{"type": "FINISH", "payload": {}}'
```

**Expected Result:**
- Coordinator moves to `Done` state (type: final)
- **Coordinator STAYS ALIVE** (because it's the entry point)
- Coordinator badge remains at [1]

```bash
# Verify the Coordinator persists
curl http://localhost:3000/api/instances
# → Coordinator is still there with isEntryPoint: true
```

## Validation Checklist

- [ ] Terminal shows "Entry point instance created"
- [ ] API `/api/instances` returns 1 instance with `isEntryPoint: true`
- [ ] Dashboard Component View shows Coordinator with badge [1]
- [ ] Green arrow visible between Coordinator and Worker
- [ ] Clicking green arrow creates a Worker instance
- [ ] Worker badge increments
- [ ] Worker auto-deallocated when reaching final state
- [ ] Coordinator persists even in final state

## Troubleshooting

### Problem: "No instances yet"
**Cause:** You're using `explicit-transitions-demo.yaml` instead of `simple-xcomponent-demo.yaml`
**Solution:** Restart with the correct file

### Problem: "No inter-machine transitions"
**Cause:** The YAML doesn't have an `entryMachine` field or no `type: inter_machine` transitions
**Solution:** Check the file contents:
```bash
grep "entryMachine:" examples/simple-xcomponent-demo.yaml
grep "inter_machine" examples/simple-xcomponent-demo.yaml
```

### Problem: "Green arrows invisible"
**Cause:** The component has no `inter_machine` transitions defined
**Solution:** Use `simple-xcomponent-demo.yaml` or `xcomponent-pattern-demo.yaml`

## Available Examples

| File | Entry Point | Inter-Machine | Difficulty |
|------|-------------|---------------|------------|
| `simple-xcomponent-demo.yaml` | Yes | Yes (1) | Easy |
| `xcomponent-pattern-demo.yaml` | Yes | Yes (2) | Medium |
| `explicit-transitions-demo.yaml` | No | No | Easy (Different pattern) |

**Recommendation:** Start with `simple-xcomponent-demo.yaml`!
