# xcomponent-ai Distributed Example

This example demonstrates running xcomponent-ai in distributed mode with:
- **RabbitMQ** as the message broker for cross-component communication
- **PostgreSQL** for event persistence
- **Dashboard** in standalone mode
- **Two components** (Order & Payment) communicating via RabbitMQ

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RabbitMQ (Port 5672)                         │
│                     Management UI (Port 15672)                      │
└──────────▲───────────────────▲────────────────────▲─────────────────┘
           │                   │                    │
    ┌──────┴──────┐    ┌───────┴───────┐    ┌──────┴──────┐
    │  Dashboard  │    │ Order Runtime │    │Payment Runtime│
    │  Port 3000  │    │ (OrderComponent)│  │(PaymentComponent)│
    └─────────────┘    └───────┬───────┘    └──────┬──────┘
                               │                   │
                       ┌───────┴───────────────────┴───────┐
                       │         PostgreSQL (Port 5432)    │
                       │         - fsm_events              │
                       │         - fsm_snapshots           │
                       └───────────────────────────────────┘
```

## Cross-Component Communication Demo

This example showcases how two independent components communicate via RabbitMQ:

```
┌─────────────────┐                      ┌─────────────────┐
│  OrderComponent │                      │ PaymentComponent│
│  (Runtime 1)    │                      │   (Runtime 2)   │
├─────────────────┤                      ├─────────────────┤
│                 │                      │                 │
│   Created       │                      │    Pending      │
│      │          │   SUBMIT (creates    │       │         │
│      ▼          │   Payment instance)  │       ▼         │
│ PendingPayment ─┼─────────────────────►│   Processing    │
│      │          │                      │       │         │
│      │          │   PAYMENT_CONFIRMED  │       ▼         │
│      ▼          │◄─────────────────────┼─   Validated    │
│     Paid        │                      │       │         │
│      │          │                      │       ▼         │
│      ▼          │                      │   Completed     │
│   Shipped       │                      │                 │
│      │          │                      │                 │
│      ▼          │                      │                 │
│  Completed      │                      │                 │
└─────────────────┘                      └─────────────────┘
```

**Flow:**
1. Create an Order instance in OrderComponent
2. SUBMIT the order → creates a Payment instance in PaymentComponent (via RabbitMQ)
3. Process the payment: PROCESS → VALIDATE → COMPLETE
4. Payment completion sends PAYMENT_CONFIRMED back to OrderComponent (via RabbitMQ)
5. Order transitions to Paid, then can be Shipped and Completed

## Quick Start

### 1. Start the infrastructure

```bash
docker-compose up -d
```

This starts:
- RabbitMQ on ports 5672 (AMQP) and 15672 (Management UI)
- PostgreSQL on port 5432
- Dashboard on port 3000
- Two runtime instances

### 2. Access the services

- **Dashboard**: http://localhost:3000
- **RabbitMQ Management**: http://localhost:15672 (login: xcomponent / xcomponent123)
- **PostgreSQL**: localhost:5432 (user: xcomponent, password: xcomponent123, db: xcomponent_fsm)

### 3. Watch the logs

```bash
# All services
docker-compose logs -f

# Just the dashboard
docker-compose logs -f dashboard

# Just the runtimes
docker-compose logs -f runtime-approval runtime-approval-2
```

### 4. Create instances via the dashboard

1. Open http://localhost:3000
2. Click on the ApprovalWorkflow component
3. Use the "Quick Actions" to trigger events
4. Watch events flow through both runtimes

### 5. Stop everything

```bash
docker-compose down

# To also remove volumes (database data):
docker-compose down -v
```

## Running Locally (without Docker)

### Prerequisites

```bash
# Install RabbitMQ and PostgreSQL locally, or use Docker for just those:
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
docker run -d --name postgres -p 5432:5432 -e POSTGRES_PASSWORD=xcomponent123 postgres:15

# Install Node.js dependencies
npm install amqplib pg
```

### Start the Dashboard

```bash
# From the xcomponent-ai directory
BROKER_URL=amqp://guest:guest@localhost:5672 node dist/dashboard-server.js
```

### Start a Runtime

```bash
# From the xcomponent-ai directory
BROKER_URL=amqp://guest:guest@localhost:5672 \
DATABASE_URL=postgresql://postgres:xcomponent123@localhost:5432/postgres \
node examples/distributed/runtime.js
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BROKER_URL` | RabbitMQ connection URL | `amqp://guest:guest@localhost:5672` |
| `DATABASE_URL` | PostgreSQL connection URL | (in-memory if not set) |
| `PORT` | Dashboard HTTP port | `3000` |
| `COMPONENT_FILE` | Path to component YAML | `./examples/approval-workflow.yaml` |
| `RUNTIME_NAME` | Unique name for this runtime | `runtime-{timestamp}` |
| `CREATE_DEMO_INSTANCE` | Create a demo instance on startup | `false` |

### Scaling Runtimes

Add more runtime instances in `docker-compose.yml`:

```yaml
  runtime-approval-3:
    build:
      context: ../..
      dockerfile: examples/distributed/Dockerfile.runtime
    environment:
      BROKER_URL: amqp://xcomponent:xcomponent123@rabbitmq:5672
      DATABASE_URL: postgresql://xcomponent:xcomponent123@postgres:5432/xcomponent_fsm
      COMPONENT_FILE: /app/examples/approval-workflow.yaml
      RUNTIME_NAME: approval-runtime-3
    depends_on:
      rabbitmq:
        condition: service_healthy
      postgres:
        condition: service_healthy
```

## Troubleshooting

### Dashboard shows no runtimes

1. Check RabbitMQ is running: `docker-compose logs rabbitmq`
2. Check runtime logs: `docker-compose logs runtime-approval`
3. Verify broker URL is correct

### Database connection errors

1. Check PostgreSQL is running: `docker-compose logs postgres`
2. Verify the database was initialized: `docker-compose exec postgres psql -U xcomponent -d xcomponent_fsm -c '\dt'`

### Events not appearing

1. Check RabbitMQ Management UI for message flow
2. Verify exchanges exist: `xcomponent.events`
3. Check queue bindings

## Database Schema

The PostgreSQL database uses these tables:

- `fsm_events`: Event sourcing log
- `fsm_snapshots`: Current state snapshots

See `init-db.sql` for the complete schema.

## Communication Architecture

The distributed system uses three complementary communication channels, each serving a specific purpose:

### 1. REST API (Dashboard ↔ Browser)

The Dashboard exposes a REST API for the web UI to fetch data and send commands.

```
Browser                          Dashboard
   │                                 │
   │  GET /api/components           │
   │────────────────────────────────►│  Returns all registered components
   │◄────────────────────────────────│  with their state machines
   │                                 │
   │  GET /api/instances            │
   │────────────────────────────────►│  Returns all active instances
   │◄────────────────────────────────│  across all runtimes
   │                                 │
   │  POST /api/.../events          │
   │────────────────────────────────►│  Trigger event on an instance
   │◄────────────────────────────────│  (dashboard forwards via RabbitMQ)
```

**Key Endpoints:**
- `GET /api/components` - List registered components and their state machines
- `GET /api/instances` - List all active instances across all runtimes
- `POST /api/components/:name/instances` - Create a new instance
- `POST /api/components/:name/instances/:id/events` - Trigger an event
- `GET /health` - Health check

### 2. WebSocket (Dashboard → Browser)

Real-time push notifications from the Dashboard to the browser for immediate UI updates.

```
Browser                          Dashboard
   │                                 │
   │  ws://localhost:3000           │
   │════════════════════════════════►│  WebSocket connection
   │                                 │
   │◄── state_change ───────────────│  Instance changed state
   │◄── instance_created ───────────│  New instance created
   │◄── instance_completed ─────────│  Instance reached final state
   │◄── components_list ────────────│  Updated component list
   │◄── runtimes_update ────────────│  Runtime connected/disconnected
```

The WebSocket provides real-time updates so the UI reflects changes immediately without polling.

### 3. RabbitMQ (Runtime ↔ Dashboard ↔ Runtime)

The message broker enables:
- **Runtime registration**: Runtimes announce themselves when they start
- **Event broadcasting**: State changes are broadcast to all interested parties
- **Command distribution**: Dashboard commands are routed to the correct runtime
- **Cross-component communication**: Events flow between components in different runtimes

```
                          RabbitMQ (xcomponent.events exchange)
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │                            │                            │
         ▼                            ▼                            ▼
   ┌───────────┐               ┌───────────┐               ┌───────────┐
   │ Dashboard │               │ Runtime 1 │               │ Runtime 2 │
   │           │               │  (Order)  │               │ (Payment) │
   └───────────┘               └───────────┘               └───────────┘
         │                            │                            │
         │  Subscribes to:            │  Subscribes to:            │  Subscribes to:
         │  - announce                │  - trigger_event           │  - trigger_event
         │  - heartbeat               │  - create_instance         │  - create_instance
         │  - state_change            │  - cross_component_event   │  - cross_component_event
         │  - instance_created        │                            │
         │                            │  Publishes:                │  Publishes:
         │  Publishes:                │  - announce                │  - announce
         │  - trigger_event           │  - state_change            │  - state_change
         │  - create_instance         │  - instance_created        │  - instance_created
         │                            │  - cross_component_event   │  - cross_component_event
```

### Cross-Component Message Flow

When Order.SUBMIT triggers Payment creation:

```
1. User clicks "SUBMIT" in browser
         │
         ▼
2. Browser → Dashboard (REST API)
   POST /api/components/OrderComponent/instances/123/events
   Body: { event: "SUBMIT" }
         │
         ▼
3. Dashboard → RabbitMQ
   Publish to: fsm:commands:trigger_event
   Payload: { componentName: "OrderComponent", instanceId: "123", event: { type: "SUBMIT" } }
         │
         ▼
4. Order Runtime (subscribes to trigger_event)
   - Receives message, finds instance 123
   - Executes transition: Created → PendingPayment
   - Detects cross_component transition → PaymentComponent
         │
         ▼
5. Order Runtime → RabbitMQ
   Publish to: fsm:commands:create_instance
   Payload: { componentName: "PaymentComponent", machineName: "Payment", context: { orderId, amount } }
         │
         ▼
6. Payment Runtime (subscribes to create_instance)
   - Receives message, creates new Payment instance
   - Emits instance_created event
```

When Payment.COMPLETE notifies Order:

```
1. Payment Runtime executes COMPLETE transition
   - Detects cross_component transition → OrderComponent with targetEvent: PAYMENT_CONFIRMED
         │
         ▼
2. Payment Runtime → RabbitMQ
   Publish to: fsm:commands:cross_component_event
   Payload: { targetComponent: "OrderComponent", targetMachine: "Order",
              event: { type: "PAYMENT_CONFIRMED" }, matchContext: { orderId: "..." } }
         │
         ▼
3. Order Runtime (subscribes to cross_component_event)
   - Receives message, finds instance with matching orderId
   - Sends PAYMENT_CONFIRMED event to that instance
   - Order transitions: PendingPayment → Paid
```

## Message Broker Channels

| Channel | Purpose |
|---------|---------|
| `fsm:registry:announce` | Runtime registration |
| `fsm:registry:heartbeat` | Runtime health check |
| `fsm:registry:shutdown` | Runtime shutdown notification |
| `fsm:events:state_change` | State transition events |
| `fsm:events:instance_created` | New instance notifications |
| `fsm:events:instance_completed` | Instance reached final state |
| `fsm:commands:trigger_event` | Dashboard → Runtime commands |
| `fsm:commands:create_instance` | Instance creation requests |
| `fsm:commands:cross_component_event` | Cross-component event routing |
