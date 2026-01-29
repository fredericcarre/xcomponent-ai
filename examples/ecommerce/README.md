# E-commerce Example with xcomponent-ai

A complete e-commerce implementation demonstrating:
- Cart workflow (Empty → Active → CheckingOut → Converted)
- Order workflow (Created → Validated → Paid → Processing → Shipped → Delivered)
- Payment workflow (Pending → Processing → Authorized → Captured)
- Inventory management (Available → Reserved → LowStock → OutOfStock)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js App                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │   Cart   │  │  Order   │  │ Payment  │  │Inventory │        │
│  │ Service  │  │ Service  │  │ Service  │  │ Service  │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
│  ┌────▼─────────────▼─────────────▼─────────────▼────┐         │
│  │              xcomponent-ai Runtime                 │         │
│  │   Cart FSM │ Order FSM │ Payment FSM │ Inventory  │         │
│  └────────────────────────┬──────────────────────────┘         │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                    ┌───────▼───────┐
                    │     Redis     │
                    │  (bus + audit)│
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │   Dashboard   │
                    │  (port 4000)  │
                    └───────────────┘
```

## Quick Start

```bash
# Clone and navigate
cd examples/ecommerce

# Start services
docker compose up -d

# Open in browser
# App: http://localhost:3000
# Dashboard: http://localhost:4000/dashboard.html
```

## State Machines

### Cart State Machine

```
┌───────┐  ADD_ITEM   ┌────────┐  CHECKOUT   ┌────────────┐  COMPLETE   ┌───────────┐
│ Empty │────────────▶│ Active │────────────▶│ CheckingOut│────────────▶│ Converted │
└───────┘             └────────┘             └────────────┘             └───────────┘
                          │ ▲                      │
                          │ │ ADD_ITEM             │ CANCEL_CHECKOUT
                          └─┘                      ▼
                                              ┌────────┐
                                              │ Active │
                                              └────────┘
```

### Order State Machine

```
┌─────────┐  VALIDATE   ┌───────────┐  PAY   ┌──────┐  PROCESS   ┌────────────┐
│ Created │────────────▶│ Validated │───────▶│ Paid │───────────▶│ Processing │
└─────────┘             └───────────┘        └──────┘            └────────────┘
     │                        │                  │                      │
     │ CANCEL                 │ CANCEL           │ REFUND               │ SHIP
     ▼                        ▼                  ▼                      ▼
┌───────────┐            ┌───────────┐      ┌──────────┐         ┌─────────┐
│ Cancelled │            │ Cancelled │      │ Refunded │         │ Shipped │
└───────────┘            └───────────┘      └──────────┘         └────┬────┘
                                                                      │ DELIVER
                                                                      ▼
                                                                 ┌───────────┐
                                                                 │ Delivered │
                                                                 └───────────┘
```

## File Structure

```
ecommerce/
├── docker-compose.yml      # Redis + App + Dashboard
├── fsm/
│   └── SportShopComponent.yaml  # All state machines
├── src/
│   ├── lib/
│   │   └── xcomponent-runtime.ts  # Runtime wrapper
│   └── services/
│       ├── cart-service.ts
│       ├── order-service.ts
│       └── product-service.ts
└── scripts/
    └── dashboard-server.js  # Standalone dashboard
```

## Key Concepts Demonstrated

### 1. Entity ID Mapping

Maps your database IDs to xcomponent instance IDs:

```typescript
const instanceMap = new Map<string, string>();

// Create: map entity to instance
instanceMap.set(`cart:${cart.id}`, instanceId);

// Lookup: get instance for entity
const instanceId = instanceMap.get(`cart:${cartId}`);
```

### 2. State Restoration

When your app restarts, restore instances to their current state:

```typescript
await createInstance('Cart', 'cart', cart.id, {
  cartId: cart.id,
  itemCount: cart.items.length,
  total: cart.total
}, cart.state);  // Pass current state from DB
```

### 3. Context Updates via Triggered Methods

Update dashboard-visible context in triggered methods:

```typescript
runtime.on('triggered_method', ({ method, event, sender }) => {
  if (method === 'onItemAdded') {
    sender.updateContext({
      itemCount: event.payload.newItemCount,
      total: event.payload.newTotal
    });
  }
});
```

### 4. Redis Persistence (Audit Trail)

All state transitions are stored in Redis:

```typescript
const { eventStore, snapshotStore } = await createRedisStores({
  url: 'redis://localhost:6379',
  keyPrefix: 'ecommerce'
});

const runtime = new FSMRuntime(component, {
  eventSourcing: true,
  snapshots: true,
  eventStore,
  snapshotStore
});
```

Query audit trail:
```bash
redis-cli ZRANGE "ecommerce:events:{instanceId}" 0 -1
```

### 5. Entry Machine Mode

For multiple carts/orders, use `multiple` mode:

```yaml
entryMachine: Cart
entryMachineMode: multiple      # Not singleton
autoCreateEntryPoint: false     # Create manually
```

## Testing the Flow

1. **Add items to cart** → Cart transitions Empty → Active
2. **View dashboard** → See Cart instance with itemCount, total
3. **Checkout** → Cart transitions Active → CheckingOut
4. **Complete order** → Cart → Converted, Order created (Created state)
5. **Process order** → Order: Created → Validated → Paid → Processing → Shipped → Delivered
6. **Check audit trail** → All transitions stored in Redis

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BROKER_URL` | `memory` | Redis URL for bus + persistence |
| `DATABASE_URL` | - | Database connection string |

## Troubleshooting

### "No instance found for cart:xyz"

The app restarted and lost the instance map. Ensure you call `createInstance` with the current state when fetching existing entities.

### Events are ignored

Check that the instance is in a state that allows the event. Use the dashboard to see current states.

### Dashboard shows 0 instances

Ensure your app uses `createRuntimeBroadcaster` to connect to the same Redis as the dashboard.
