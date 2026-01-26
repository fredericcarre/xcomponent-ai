# xcomponent-ai Technical Specification

> **Single source of truth for all project specifications.**
> Use this document when rewriting, refactoring, or extending the project.

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Core Concepts](#2-core-concepts)
3. [Data Types & Interfaces](#3-data-types--interfaces)
4. [FSM Runtime](#4-fsm-runtime)
5. [YAML Schema](#5-yaml-schema)
6. [XComponent Pattern](#6-xcomponent-pattern)
7. [Communication Patterns](#7-communication-patterns)
8. [Persistence & Event Sourcing](#8-persistence--event-sourcing)
9. [API & WebSocket](#9-api--websocket)
10. [Dashboard](#10-dashboard)
11. [CLI Commands](#11-cli-commands)
12. [Testing Requirements](#12-testing-requirements)

---

## 1. Project Overview

### Purpose
xcomponent-ai is a **state machine runtime framework** inspired by XComponent architecture. It separates **business logic** (defined in YAML) from **implementation code**.

### Key Principles
- **YAML = Business Logic**: States, transitions, guards, compliance rules
- **Code = Thin Integration**: API routes, UI, external integrations
- **Event-Driven**: All state changes are driven by events
- **Multi-Instance**: Supports thousands of concurrent FSM instances
- **Property Matching**: Automatic event routing based on business properties

### Tech Stack
- **Language**: TypeScript 5.7+
- **Runtime**: Node.js 20.0.0+
- **Dependencies**:
  - Express.js (API server)
  - Socket.IO (WebSocket)
  - js-yaml (YAML parsing)
  - winston (logging)
  - uuid (instance IDs)

---

## 2. Core Concepts

### State Types
| Type | Color | Description |
|------|-------|-------------|
| `entry` | Yellow | Initial state (unique per machine) |
| `regular` | White | Normal processing state |
| `final` | Green | Terminal state (triggers deallocation) |
| `error` | Red/Purple | Error state (triggers deallocation) |

### Transition Types
| Type | Description |
|------|-------------|
| `regular` | Normal event-driven transition |
| `triggerable` | Can be triggered via API |
| `inter_machine` | Creates new instance of another machine |
| `timeout` | Fires automatically after delay |
| `auto` | Fires immediately on state entry |
| `internal` | Self-loop without state change event |

### Instance Lifecycle
```
Created → Active → [Processing] → Final/Error → Deallocated
                         ↑
                    Entry Point persists
```

---

## 3. Data Types & Interfaces

### FSMEvent
```typescript
interface FSMEvent {
  type: string;           // Event name (e.g., "VALIDATE", "EXECUTE")
  payload: Record<string, any>;  // Event data
  timestamp: number;      // Unix timestamp
}
```

### FSMInstance
```typescript
interface FSMInstance {
  id: string;                    // UUID
  machineName: string;           // State machine name
  currentState: string;          // Current state name
  context: Record<string, any>;  // Instance context/data
  publicMember?: Record<string, any>;  // Business object (XComponent pattern)
  internalMember?: Record<string, any>; // Private state
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'error';
  isEntryPoint?: boolean;        // Prevents auto-deallocation
  parentInstanceId?: string;     // For child-to-parent communication
  parentMachineName?: string;
}
```

### State
```typescript
interface State {
  name: string;
  type: StateType;              // entry | regular | final | error
  entryMethod?: string;         // Function called on state entry
  exitMethod?: string;          // Function called on state exit
  cascadingRules?: CascadingRule[];  // Cross-machine updates
  metadata?: Record<string, any>;
}
```

### Transition
```typescript
interface Transition {
  from: string;
  to: string;
  event: string;
  type: TransitionType;
  timeoutMs?: number;           // For timeout transitions
  resetOnTransition?: boolean;  // Reset timeout on re-entry
  targetMachine?: string;       // For inter_machine transitions
  triggeredMethod?: string;     // Function to execute
  matchingRules?: MatchingRule[];  // Property-based routing
  specificTriggeringRule?: string; // JS expression for disambiguation
  notifyParent?: NotifyParent;  // Parent notification config
  metadata?: Record<string, any>;
}
```

### MatchingRule (Property Routing)
```typescript
interface MatchingRule {
  eventProperty: string;        // Path in event.payload (e.g., "OrderId")
  instanceProperty: string;     // Path in instance context (e.g., "Id")
  operator?: '===' | '!==' | '>' | '<' | '>=' | '<=';
}
```

### ParentLink (Child-to-Parent Communication)
```typescript
interface ParentLink {
  enabled: boolean;
  onStateChange?: string;       // Event type to send on ANY state change
}

interface NotifyParent {
  event: string;                // Event type to send
  includeState?: boolean;       // Include newState in payload (default: true)
  includeContext?: boolean;     // Include child context (default: false)
}
```

### CascadingRule (Cross-Machine Updates)
```typescript
interface CascadingRule {
  targetComponent?: string;     // For cross-component
  targetMachine: string;
  targetState: string;
  event: string;
  matchingRules?: MatchingRule[];
  payload?: Record<string, any>; // Template with {{property}} syntax
}
```

### StateMachine
```typescript
interface StateMachine {
  name: string;
  states: State[];
  transitions: Transition[];
  initialState: string;
  publicMemberType?: string;    // Business object type name
  parentLink?: ParentLink;      // Child-to-parent notification config
  contextSchema?: Record<string, any>;  // For UI form generation
  metadata?: Record<string, any>;
}
```

### Component
```typescript
interface Component {
  name: string;
  version: string;
  stateMachines: StateMachine[];
  entryMachine?: string;        // Auto-created on startup
  metadata?: Record<string, any>;
  layout?: {
    machines?: Record<string, { x: number; y: number }>;
    algorithm?: 'force' | 'grid' | 'hierarchical';
  };
}
```

---

## 4. FSM Runtime

### Core Class: FSMRuntime

```typescript
class FSMRuntime extends EventEmitter {
  // Instance management
  createInstance(machineName: string, context?: object, parentInfo?: ParentInfo): string;
  getInstance(instanceId: string): FSMInstance | undefined;
  getAllInstances(): FSMInstance[];
  disposeInstance(instanceId: string): void;

  // Event handling
  sendEvent(instanceId: string, event: FSMEvent): Promise<void>;
  broadcastEvent(machineName: string, currentState: string, event: FSMEvent): Promise<number>;

  // State queries
  getAvailableTransitions(instanceId: string): Transition[];
  canTransition(instanceId: string, eventType: string): boolean;

  // Persistence
  restore(): Promise<{ restored: number; failed: number }>;
  resynchronizeTimeouts(): Promise<{ synced: number; expired: number }>;
}
```

### Event Emission
The runtime emits these events:
- `state_change`: `{ instanceId, previousState, newState, event }`
- `instance_created`: `FSMInstance`
- `instance_disposed`: `{ instanceId, machineName }`
- `instance_error`: `{ instanceId, error }`
- `inter_machine_transition`: `{ sourceInstanceId, targetInstanceId, targetMachine, event }`

### Transition Execution Order
1. Check transition exists from current state
2. Evaluate guards (if any)
3. Evaluate matchingRules (if broadcast)
4. Evaluate specificTriggeringRule (if multiple transitions)
5. Execute exit method (if defined)
6. Update instance state
7. Execute triggered method (if defined)
8. Execute entry method (if defined)
9. Notify parent (if configured)
10. Handle cascading rules (if defined)
11. Handle inter_machine (if applicable)
12. Schedule timeout (if applicable)

---

## 5. YAML Schema

### Minimal Example
```yaml
name: MyComponent
version: 1.0.0

stateMachines:
  - name: Order
    initialState: Pending
    states:
      - name: Pending
        type: entry
      - name: Confirmed
        type: final
    transitions:
      - from: Pending
        to: Confirmed
        event: CONFIRM
        type: triggerable
```

### Full Example with All Features
```yaml
name: TradingComponent
version: 1.0.0
metadata:
  domain: fintech
  compliance: [MiFID II, Best Execution]

entryMachine: OrderManager  # Auto-created

layout:
  algorithm: grid

stateMachines:
  - name: OrderManager
    initialState: Ready
    publicMemberType: Order

    contextSchema:
      orderId:
        type: text
        label: Order ID
        required: true
      amount:
        type: number
        min: 1
        max: 100000

    states:
      - name: Ready
        type: entry
      - name: Processing
        type: regular
        cascadingRules:
          - targetMachine: Settlement
            targetState: Pending
            event: START
            payload:
              orderId: "{{orderId}}"
      - name: Done
        type: final

    transitions:
      - from: Ready
        to: Processing
        event: START
        type: triggerable
        guards:
          - keys: [orderId, amount]
          - customFunction: "event.payload.amount <= 100000"

      - from: Processing
        to: Processing
        event: EXECUTION
        type: regular
        matchingRules:
          - eventProperty: OrderId
            instanceProperty: orderId
        triggeredMethod: handleExecution

      - from: Processing
        to: Done
        event: COMPLETE
        type: inter_machine
        targetMachine: Settlement

      - from: Processing
        to: Error
        event: TIMEOUT
        type: timeout
        timeoutMs: 30000
        resetOnTransition: false

  - name: Worker
    initialState: Created
    parentLink:
      enabled: true
      onStateChange: CHILD_STATE_CHANGED
    # ... states and transitions
```

---

## 6. XComponent Pattern

### Entry Point
- Specified via `entryMachine` in component
- Auto-created when component loads
- **Never deallocated** (even in final state)
- Marked with `isEntryPoint: true`

### Inter-Machine Transitions
```yaml
- from: Processing
  to: Done
  event: CREATE_CHILD
  type: inter_machine
  targetMachine: ChildMachine
```
- Creates new instance of `targetMachine`
- Passes parent's context to child
- Sets `parentInstanceId` and `parentMachineName` on child

### Parent-Child Communication
```yaml
# In child machine
parentLink:
  enabled: true
  onStateChange: CHILD_STATE_CHANGED  # Notifies parent on EVERY state change

# Or per-transition
transitions:
  - from: Processing
    to: Done
    event: COMPLETE
    notifyParent:
      event: CHILD_COMPLETED
      includeState: true
      includeContext: true
```

### Auto-Deallocation
- Non-entry-point instances are **automatically deallocated** when reaching `final` or `error` state
- Cleans up timers, removes from instance registry
- Emits `instance_disposed` event

---

## 7. Communication Patterns

### Sender Interface (Triggered Methods)
```typescript
interface Sender {
  sendToSelf(event: FSMEvent): Promise<void>;
  sendTo(instanceId: string, event: FSMEvent): Promise<void>;
  sendToComponent(componentName: string, instanceId: string, event: FSMEvent): Promise<void>;
  broadcast(machineName: string, event: FSMEvent, currentState?: string, componentName?: string): Promise<number>;
  createInstance(machineName: string, initialContext: object): string;
  createInstanceInComponent(componentName: string, machineName: string, initialContext: object): string;
}
```

### Triggered Method Signature
```typescript
type TriggeredMethod = (
  event: FSMEvent,
  context: any,
  sender: Sender
) => Promise<void>;
```

### Example: Explicit Control with sender.sendToSelf()
```javascript
async function accumulateExecution(event, context, sender) {
  context.executedQty += event.payload.quantity;

  if (context.executedQty >= context.totalQty) {
    // Explicitly trigger state transition
    await sender.sendToSelf({
      type: 'FULLY_EXECUTED',
      payload: { total: context.executedQty },
      timestamp: Date.now()
    });
  }
}
```

---

## 8. Persistence & Event Sourcing

### Configuration
```typescript
const runtime = new FSMRuntime(component, {
  eventSourcing: true,
  snapshots: true,
  snapshotInterval: 10,  // Every 10 transitions
  eventStore: myEventStore,
  snapshotStore: mySnapshotStore
});
```

### PersistedEvent
```typescript
interface PersistedEvent {
  id: string;
  instanceId: string;
  machineName: string;
  componentName: string;
  event: FSMEvent;
  stateBefore: string;
  stateAfter: string;
  persistedAt: number;
  causedBy?: string[];    // Causality tracking
  caused?: string[];
}
```

### Restore Flow
1. Load snapshots from store
2. Apply events since last snapshot
3. Resynchronize timeouts (fire expired, reschedule active)

---

## 9. API & WebSocket

### REST Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/components` | List loaded components |
| POST | `/api/component/load` | Load component from YAML |
| GET | `/api/instances` | List all instances |
| POST | `/api/instances` | Create new instance |
| GET | `/api/instances/:id` | Get instance details |
| POST | `/api/instances/:id/events` | Send event to instance |
| GET | `/api/machines/:name/diagram` | Get Mermaid diagram |
| POST | `/api/components/:name/instances/:id/events` | Send event (component-scoped) |

### WebSocket Events
```javascript
// Client → Server
socket.emit('subscribe_component', componentName);
socket.emit('unsubscribe_component', componentName);

// Server → Client
socket.on('state_change', (data) => { /* instanceId, previousState, newState */ });
socket.on('instance_created', (instance) => { /* FSMInstance */ });
socket.on('instance_deallocated', (data) => { /* instanceId */ });
socket.on('components_list', (components) => { /* Component[] */ });
```

---

## 10. Dashboard

### Features
- **Component Overview**: Shows all machines with instance counts
- **Inter-Machine Arrows**: Green SVG arrows between machines
- **Current State Highlighting**: Purple glow on active state
- **Unreachable States**: Grayed out states not reachable from current
- **Quick Actions**: Buttons to trigger available transitions
- **Real-time Updates**: WebSocket-driven refresh

### Mermaid Diagram Generation
```typescript
function generateStyledMermaidDiagram(machine: StateMachine, currentState?: string): string;
```
- Generates `stateDiagram-v2` syntax
- Applies CSS classes for state types
- Computes reachable states for accessibility visualization

### State Accessibility
```typescript
function computeReachableStates(machine: StateMachine, currentState: string): Set<string>;
function getAvailableTransitions(machine: StateMachine, currentState: string): Set<number>;
```

---

## 11. CLI Commands

| Command | Description |
|---------|-------------|
| `xcomponent-ai serve <file.yaml>` | Start runtime with dashboard |
| `xcomponent-ai load <file.yaml>` | Load and inspect component |
| `xcomponent-ai validate <file.yaml>` | Validate YAML schema |
| `xcomponent-ai init <project-name>` | Create new project scaffold |
| `xcomponent-ai run <file.yaml> <machine> --events [...]` | Run with events |
| `xcomponent-ai simulate <file.yaml> <machine> --events [...]` | Simulate path |
| `xcomponent-ai ai-create "<description>"` | AI-powered FSM creation |
| `xcomponent-ai generate-ui <file.yaml>` | Generate API/React code |

---

## 12. Testing Requirements

### Coverage Targets
- Statements: 70%
- Branches: 58%
- Functions: 72%
- Lines: 71%

### Key Test Areas
1. **FSM Runtime**: Instance lifecycle, transitions, guards
2. **Property Matching**: MatchingRules evaluation
3. **Timeouts**: Timer scheduling, reset behavior
4. **Inter-Machine**: Child creation, context passing
5. **Parent-Child**: Notification mechanism
6. **Persistence**: Event sourcing, snapshot restore
7. **WebSocket**: Real-time events
8. **API**: All REST endpoints

### Test Files Structure
```
tests/
├── fsm-runtime.test.ts
├── property-matching.test.ts
├── auto-transitions.test.ts
├── sender-interface.test.ts
├── cascading-rules.test.ts
├── persistence.test.ts
├── timer-wheel.test.ts
└── websockets.test.ts
```

---

## Appendix: Related Documentation

| Document | Purpose |
|----------|---------|
| [README.md](./README.md) | Project overview and quick start |
| [QUICKSTART.md](./QUICKSTART.md) | 5-minute tutorial |
| [XCOMPONENT-PATTERN.md](./XCOMPONENT-PATTERN.md) | XComponent pattern guide |
| [LLM_FRAMEWORK_GUIDE.md](./LLM_FRAMEWORK_GUIDE.md) | Guide for LLM code generation |
| [PERSISTENCE.md](./PERSISTENCE.md) | Event sourcing details |
| [SENDER-BROADCAST-GUIDE.md](./SENDER-BROADCAST-GUIDE.md) | Sender API guide |
| [TIMEOUT-RESET-GUIDE.md](./TIMEOUT-RESET-GUIDE.md) | Timeout behavior |
| [ADVANCED-PATTERNS-GUIDE.md](./ADVANCED-PATTERNS-GUIDE.md) | Advanced FSM patterns |
| [examples/README.md](./examples/README.md) | Example documentation |

---

*Last updated: 2026-01-26*
*Version: 0.4.3*
