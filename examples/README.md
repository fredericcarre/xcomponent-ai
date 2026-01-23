# XComponent AI Examples

This directory contains comprehensive examples demonstrating all features of XComponent AI.

## Examples

### 1. Complete Workflow (All Features) - YAML
**File**: `complete-workflow-all-features.yaml`

Demonstrates:
- ✅ **Phase 1**: Auto-transitions (immediate and delayed)
- ✅ **Phase 2**: Sender interface for inter-machine communication
- ✅ **Phase 3**: Cascading rules for cross-machine updates
- Property matching for multi-instance routing
- Guards and validation
- Timeout transitions
- Triggered methods
- Public member pattern

**Scenario**: Complete e-commerce workflow with Order, Inventory, Payment, and Shipment state machines.

### 2. Persistence & Event Sourcing Demo - TypeScript
**File**: `persistence-restart-demo.ts`

Demonstrates:
- ✅ **Phase 4**: Event sourcing with full traceability
- Long-running workflows that survive restarts
- Timeout resynchronization after downtime
- Causality tracking (which events caused other events)
- Snapshot-based state restoration

**Scenario**: E-commerce order processing that can be stopped and restarted without losing state.

## Running the Examples

### Persistence Demo (Executable)

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run build

# Run the persistence demo
npx ts-node examples/persistence-restart-demo.ts
```

Expected output:
```
╔════════════════════════════════════════════════════════════════════╗
║  XComponent AI - Phase 4: Persistence & Event Sourcing Demo       ║
║  Demonstrating long-running workflows with restart capability     ║
╚════════════════════════════════════════════════════════════════════╝

======================================================================
  PHASE 1: Initial System Startup
======================================================================

✓ Runtime started with persistence enabled
✓ Event sourcing: ON
✓ Snapshots: Every 2 transitions
✓ Created 3 orders: ...
...
```

The demo will simulate:
1. Starting a system with multiple orders
2. Processing some orders
3. System shutdown
4. System restart
5. State restoration from snapshots
6. Timeout resynchronization
7. Continuing workflow after restart
8. Event causality tracing

### Complete Workflow YAML (Reference)

The `complete-workflow-all-features.yaml` file is a reference implementation showing:

- **4 State Machines**: Order, Inventory, Payment, Shipment
- **Auto-Transitions**: Order automatically checks inventory after validation
- **Cascading Rules**: Order confirmation triggers inventory reservation
- **Sender Interface**: Payment completion notifies Order via triggered method
- **Property Matching**: Events route to correct instances via OrderId matching
- **100+ Lines of Comments**: Usage examples and triggered method implementations

To use this component:

```typescript
import { FSMRuntime } from 'xcomponent-ai';
import * as yaml from 'js-yaml';
import * as fs from 'fs';

// Load component
const componentYaml = fs.readFileSync('examples/complete-workflow-all-features.yaml', 'utf8');
const component = yaml.load(componentYaml);

// Create runtime
const runtime = new FSMRuntime(component);

// Create inventory
runtime.createInstance('Inventory', { ProductId: 'P1', StockLevel: 1000 });

// Create order
const orderId = runtime.createInstance('Order', {
  Id: 1,
  ProductId: 'P1',
  Quantity: 1,
  CustomerId: 'C1',
  ShippingAddress: '123 Main St',
  Total: 99.99
});

// Validate order → triggers automatic workflow
await runtime.sendEvent(orderId, {
  type: 'VALIDATE',
  payload: { /* validation data */ },
  timestamp: Date.now()
});

// What happens automatically:
// 1. Order: Draft → Validated
// 2. AUTO-TRANSITION: Validated → InventoryChecked
// 3. CASCADING RULE: Inventory receives RESERVE event
// 4. Inventory: Available → Reserved
```

## Key Concepts by Phase

### Phase 1: Auto-Transitions
Transitions that fire automatically upon entering a state.

```yaml
transitions:
  - from: Validated
    to: InventoryChecked
    event: AUTO_CHECK_INVENTORY
    type: auto
    timeoutMs: 0  # Immediate transition
```

**Use cases**:
- Immediate next steps after state entry
- Background processing workflows
- State machine orchestration

### Phase 2: Sender Interface
Triggered methods receive a `Sender` object for inter-machine communication.

```typescript
export const onOrderConfirmed = async (
  event: FSMEvent,
  context: any,
  sender: Sender
) => {
  // Send to specific instance
  await sender.sendTo(shipmentId, { type: 'START', ... });

  // Broadcast to matching instances
  await sender.broadcast('Inventory', 'Available', { type: 'RESERVE', ... });

  // Create new instance
  const paymentId = sender.createInstance('Payment', { orderId: context.Id });
};
```

**Use cases**:
- Coordinated workflows across machines
- Dynamic instance creation
- Event routing based on business logic

### Phase 3: Cascading Rules
Declarative cross-machine updates defined at the state level.

```yaml
states:
  - name: Confirmed
    type: regular
    cascadingRules:
      - targetMachine: Shipment
        targetState: Idle
        event: START
        matchingRules:
          - eventProperty: orderId
            instanceProperty: orderId
        payload:
          orderId: "{{Id}}"
          address: "{{ShippingAddress}}"
```

**Use cases**:
- Automatic downstream updates
- Event propagation patterns
- Declarative workflow orchestration

### Phase 4: Persistence & Event Sourcing
Long-running workflows with restart capability.

```typescript
const runtime = new FSMRuntime(component, {
  eventSourcing: true,      // Track all events
  snapshots: true,          // Periodic snapshots
  snapshotInterval: 10,     // Snapshot every 10 transitions
  eventStore: myEventStore, // Custom store implementation
  snapshotStore: mySnapshotStore,
});

// Process workflow...
// System crashes/restarts...

// Restore state after restart
const result = await runtime.restore();
// result: { restored: 5, failed: 0 }

// Handle expired timeouts
const resync = await runtime.resynchronizeTimeouts();
// resync: { synced: 3, expired: 2 }

// Continue workflow seamlessly
```

**Use cases**:
- Long-running business processes (days/weeks)
- Fault-tolerant systems
- Audit trails and compliance
- Debugging cascading events
- Disaster recovery

## Architecture Patterns

### Property Matching Pattern
Route events to instances based on business properties:

```yaml
transitions:
  - from: Pending
    to: Confirmed
    event: CONFIRM
    type: regular
    matchingRules:
      - eventProperty: OrderId
        instanceProperty: Id
```

Broadcasting an event with `{ OrderId: 42 }` will only affect the Order instance with `Id: 42`.

### Public Member Pattern
Separate public business data from internal FSM context:

```yaml
stateMachines:
  - name: Order
    publicMemberType: Order  # Exposed to external systems
```

The `publicMember` contains business data (OrderId, CustomerId, etc.), while internal FSM context holds state machine metadata.

### Triggered Method Pattern
Execute custom logic during transitions:

```yaml
transitions:
  - from: Draft
    to: Validated
    event: VALIDATE
    type: regular
    triggeredMethod: onOrderValidated  # External function
```

Triggered methods receive `(event, context, sender)` for full control.

## Testing

All examples are covered by the test suite:

```bash
npm test
```

Test files:
- `tests/auto-transitions.test.ts` - Phase 1
- `tests/sender-interface.test.ts` - Phase 2
- `tests/cascading-rules.test.ts` - Phase 3
- `tests/persistence.test.ts` - Phase 4
- `tests/property-matching.test.ts` - Property matching
- `tests/fsm-runtime.test.ts` - Core runtime

**Coverage**: 82.73% (87 tests passing)

## Additional Resources

- [Main README](../README.md) - Full project documentation
- [LLM Framework Guide](../LLM_FRAMEWORK_GUIDE.md) - Guide for LLMs using this framework
- [Type Definitions](../src/types.ts) - Complete TypeScript types
- [FSM Runtime](../src/fsm-runtime.ts) - Core implementation

## Contributing

When adding new examples:
1. Add comprehensive comments explaining the pattern
2. Include usage examples in comments
3. Update this README with the new example
4. Add corresponding test coverage
5. Ensure `npm test` passes

## License

MIT
