# CLAUDE.md - Project Context for AI Assistants

## Project Overview

**xcomponent-ai** is a declarative state machine framework inspired by the XComponent pattern.
Components are defined in YAML, runtime is TypeScript. State machines communicate via events
within and across components.

## Architecture

```
YAML (declarative)  →  TypeScript Runtime  →  Dashboard (web UI)
component.yaml          FSMRuntime              dashboard-server.ts
                         ├── SenderImpl          public/dashboard.html
                         ├── Persistence
                         └── RuntimeBroadcaster (cross-component via Redis/memory)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/types.ts` | All TypeScript interfaces (Component, State, Transition, FSMInstance, Sender...) |
| `src/fsm-runtime.ts` | Core runtime: sendEvent, executeTransition, cascading engine, matching rules |
| `src/runtime-broadcaster.ts` | Cross-component messaging via message broker (Redis or in-memory) |
| `src/component-registry.ts` | Multi-component registry, intra-process cross-component communication |
| `src/dashboard-server.ts` | Express API + serves dashboard UI |
| `src/persistence.ts` | Event sourcing + snapshot persistence layer |
| `src/postgres-persistence.ts` | PostgreSQL implementation of persistence |
| `src/cli.ts` | CLI entry point, YAML parsing |
| `src/api.ts` | Programmatic API entry point |
| `schemas/component.schema.json` | JSON Schema for YAML validation |
| `public/dashboard.html` | Single-file dashboard UI (vanilla JS, Mermaid diagrams) |
| `SPECIFICATION.md` | Full framework specification |

## User Code Execution Model

Users write YAML (declarative) + TypeScript handlers (imperative).

### Execution order during a transition:

```
1. onExit(sourceState)        ← state-level: runs when LEAVING a state (any event)
2. triggeredMethod(transition) ← transition-level: runs for THIS specific transition
3. state change happens         (from → to)
4. onEntry(targetState)        ← state-level: runs when ENTERING a state (any event)
```

### Event queue (deferred execution)

Events emitted via `sender.sendToSelf()` (or `sendTo`, `broadcast`) during a
transition (from onExit, triggeredMethod, or onEntry) are **queued** and processed
**after** the current transition completes. This prevents re-entrant state changes
during a transition. Events are processed in FIFO order.

Implementation: `_processingTransition` flag + `_eventQueue` array in FSMRuntime.
`sendEvent()` checks the flag and queues if true. `finally` block drains the queue.

### Three hook points:

| Hook | Defined on | YAML key | Runtime event | Status |
|------|-----------|----------|---------------|--------|
| `triggeredMethod` | Transition | `triggeredMethod: methodName` | `'triggered_method'` | IMPLEMENTED |
| `onEntry` | State | `onEntry: methodName` | `'entry_method'` | IMPLEMENTED |
| `onExit` | State | `onExit: methodName` | `'exit_method'` | IMPLEMENTED |

### Handler pattern (TypeScript user code):

```typescript
runtime.on('triggered_method', async ({ method, event, context, sender }) => {
  if (method === 'checkPayment') {
    const result = await callPaymentAPI(context.amount);
    sender.sendToSelf({ type: result.ok ? 'VALIDATED' : 'REJECTED' });
  }
});

runtime.on('entry_method', async ({ method, state, context, sender }) => {
  if (method === 'notifyCustomer') {
    await sendEmail(context.email, `Order ${context.orderId} is now ${state}`);
  }
});

runtime.on('exit_method', async ({ method, state, context, sender }) => {
  if (method === 'cleanupResources') {
    await releaseHold(context.resourceId);
  }
});
```

### Sender API (available in all hooks):

| Method | Purpose |
|--------|---------|
| `sender.sendToSelf(event)` | Send event to current instance |
| `sender.sendTo(instanceId, event)` | Send to specific instance |
| `sender.sendToComponent(componentName, instanceId, event)` | Cross-component to specific instance |
| `sender.broadcast(machineName, event, state?, componentName?)` | Broadcast with optional filters |
| `sender.createInstance(machineName, context)` | Create new instance in same component |
| `sender.createInstanceInComponent(componentName, machineName, context)` | Cross-component instance creation |

## Cross-Component Communication

### Transition types:

| Type | Scope | Purpose |
|------|-------|---------|
| `regular` | Same machine | Normal state transition |
| `triggerable` | Same machine | Triggered from code/dashboard |
| `internal` | Same machine | Self-transition (no state change) |
| `timeout` | Same machine | Timer-based auto transition |
| `auto` | Same machine | Automatic transition on state entry |
| `inter_machine` | Same component | Creates instance in another machine |
| `cross_component` | Cross component | Communicates with another component via broker |

### cross_component transitions:

```yaml
# Create new instance in target (no targetEvent)
- from: Created
  to: PendingPayment
  event: SUBMIT
  type: cross_component
  targetComponent: PaymentComponent
  targetMachine: Payment
  contextMapping:          # Optional: map source → target properties
    orderId: orderId
    paymentAmount: amount  # rename amount → paymentAmount

# Send event to existing instance (with targetEvent) — REQUIRES matchingRules
- from: Validated
  to: Completed
  event: COMPLETE
  type: cross_component
  targetComponent: OrderComponent
  targetEvent: PAYMENT_CONFIRMED
  matchingRules:
    - eventProperty: orderId
      instanceProperty: orderId
```

### contextMapping:

When present on a cross_component or inter_machine transition, only mapped properties
are sent to the target (with optional renaming). Without contextMapping, the full
source context is sent as-is.

```yaml
contextMapping:
  targetProperty: sourceProperty   # rename
  sameNameProp: sameNameProp       # keep same name (explicit)
```

## YAML ↔ TypeScript Naming

| YAML key | TypeScript interface field | Notes |
|----------|--------------------------|-------|
| `onEntry` | `State.entryMethod` | Schema uses onEntry, types use entryMethod |
| `onExit` | `State.exitMethod` | Schema uses onExit, types use exitMethod |
| `triggeredMethod` | `Transition.triggeredMethod` | Same name |
| `contextMapping` | `Transition.contextMapping` | Same name |

**IMPORTANT**: YAML is parsed with `yaml.parse(content) as Component` (direct cast).
Schema uses `onEntry`/`onExit` but TypeScript types use `entryMethod`/`exitMethod`.
The YAML loader must map between these names.

## Persistence

- **Event sourcing**: Every transition is persisted to `fsm_events` table
- **Snapshots**: Saved every N transitions (`snapshotInterval`) AND always on terminal states
- **History search**: Queries `fsm_snapshots` first, falls back to `fsm_events` GROUP BY

## Testing

```bash
npx jest --no-coverage           # Run all tests
npx jest --testPathPattern=name  # Run specific test
```

## Development Commands

```bash
npm run build          # TypeScript compilation
npx ts-node src/cli.ts run examples/simple.yaml --dashboard  # Run with dashboard
```
