# xcomponent-ai Distributed Example

This example demonstrates running xcomponent-ai in distributed mode with:
- **RabbitMQ** as the message broker
- **PostgreSQL** for event persistence
- **Dashboard** in standalone mode
- **Multiple runtime instances** for the same component

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        RabbitMQ (Port 5672)                         │
│                     Management UI (Port 15672)                      │
└──────────▲───────────────────▲────────────────────▲─────────────────┘
           │                   │                    │
    ┌──────┴──────┐    ┌───────┴───────┐    ┌──────┴──────┐
    │  Dashboard  │    │   Runtime 1   │    │   Runtime 2 │
    │  Port 3000  │    │ (approval-1)  │    │ (approval-2)│
    └─────────────┘    └───────┬───────┘    └──────┬──────┘
                               │                   │
                       ┌───────┴───────────────────┴───────┐
                       │         PostgreSQL (Port 5432)    │
                       │         - fsm_events              │
                       │         - fsm_snapshots           │
                       └───────────────────────────────────┘
```

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

## Message Broker Channels

| Channel | Purpose |
|---------|---------|
| `fsm:registry:announce` | Runtime registration |
| `fsm:registry:heartbeat` | Runtime health check |
| `fsm:registry:shutdown` | Runtime shutdown notification |
| `fsm:events:state_change` | State transition events |
| `fsm:events:instance_created` | New instance notifications |
| `fsm:commands:trigger_event` | Dashboard -> Runtime commands |
| `fsm:commands:create_instance` | Instance creation requests |
