# Distributed Dashboard Guide

This guide explains how to use the xcomponent-ai monitoring dashboard in **distributed mode** where your application runs separately from the dashboard.

## The Problem

When using `xcomponent-ai serve`, the CLI creates its **own isolated runtime**. This works great for demos and simple use cases, but **doesn't work** when:

- Your app (Next.js, Express, NestJS, etc.) creates FSM instances using `FSMRuntime`
- You want the dashboard to show instances created by your external app
- You have multiple services/runtimes that need to be monitored together

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│      Your App               │     │    xcomponent-ai serve      │
│   creates instances         │     │   has its OWN runtime       │
│   via FSMRuntime            │     │   (doesn't see your app)    │
└─────────────────────────────┘     └─────────────────────────────┘
        │                                      │
        │  ❌ No connection!                   │
        └──────────────────────────────────────┘
```

## The Solution: Distributed Mode with Message Broker

In distributed mode, a **message broker** (Redis or RabbitMQ) connects your app to the dashboard:

1. **Message Broker** (Redis or RabbitMQ) handles communication
2. **Your app** uses `RuntimeBroadcaster` to announce instances
3. **DashboardServer** subscribes and aggregates all instances

```
┌─────────────────────────────┐
│    Redis or RabbitMQ        │
│     (Message Broker)        │
└─────────────┬───────────────┘
              │
    ┌─────────┴─────────┐
    │                   │
┌───▼───────────┐  ┌───▼───────────┐
│   Your App    │  │  Dashboard    │
│ + Broadcaster │  │   Server      │
│   (port 3000) │  │   (port 4000) │
└───────────────┘  └───────────────┘
```

### Choosing a Broker

| Broker | URL Format | Best For |
|--------|-----------|----------|
| **Redis** | `redis://host:6379` | Simple setup, fast, good for most cases |
| **RabbitMQ** | `amqp://host:5672` | Reliable delivery, dead-letter queues, enterprise |

## Quick Start with Redis

### 1. docker-compose.yml (Redis)

```yaml
services:
  # Redis Message Broker
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  # Your Application (creates FSM instances)
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - BROKER_URL=redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy

  # xcomponent-ai Dashboard (aggregates instances from all runtimes)
  dashboard:
    image: node:20-alpine
    ports:
      - "4000:4000"
    environment:
      - BROKER_URL=redis://redis:6379
      - PORT=4000
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./fsm:/app/fsm:ro
      - ./scripts/dashboard-server.js:/app/dashboard-server.js:ro
    working_dir: /app
    command: >
      sh -c "
        npm install xcomponent-ai yaml &&
        node dashboard-server.js
      "
```

### 2. Dashboard Server Script (scripts/dashboard-server.js)

```javascript
/**
 * xcomponent-ai Dashboard - Distributed Mode
 *
 * This dashboard subscribes to Redis and aggregates instances
 * from all connected runtimes.
 */

const fs = require('fs');
const yaml = require('yaml');

async function main() {
  const brokerUrl = process.env.BROKER_URL || 'redis://redis:6379';
  const port = parseInt(process.env.PORT || '4000', 10);
  const componentFile = process.env.COMPONENT_FILE || '/app/fsm/component.yaml';

  console.log('Starting Dashboard in Distributed Mode');
  console.log(`Broker: ${brokerUrl}`);
  console.log(`Port: ${port}`);

  // Load xcomponent-ai
  const { DashboardServer } = require('xcomponent-ai');

  // Load component schema (optional, for validation)
  let component = null;
  if (fs.existsSync(componentFile)) {
    component = yaml.parse(fs.readFileSync(componentFile, 'utf-8'));
    console.log(`Loaded component: ${component.name}`);
  }

  // Create dashboard in distributed mode
  // Args: brokerUrl, databaseUrl (null = no persistence), component (optional)
  const dashboard = new DashboardServer(brokerUrl, null, component);
  await dashboard.start(port);

  console.log(`Dashboard ready at http://localhost:${port}/dashboard.html`);
  console.log('Waiting for runtimes to announce...');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await dashboard.stop();
    process.exit(0);
  });
}

main().catch(console.error);
```

### 3. Your App Integration (TypeScript/JavaScript)

```typescript
import { FSMRuntime, createRuntimeBroadcaster } from 'xcomponent-ai';
import * as fs from 'fs';
import * as yaml from 'yaml';

// Load your component
const component = yaml.parse(fs.readFileSync('./fsm/component.yaml', 'utf-8'));

// Create FSM Runtime
const runtime = new FSMRuntime(component);

// Connect to Redis and start broadcasting
const brokerUrl = process.env.BROKER_URL || 'redis://localhost:6379';
const broadcaster = await createRuntimeBroadcaster(runtime, component, brokerUrl, {
  host: 'my-app',  // Identifier for this runtime
  port: 3000
});

console.log(`Broadcasting as ${broadcaster.getRuntimeId()}`);

// Now create instances - they will appear in the dashboard!
const orderId = runtime.createInstance('Order', {
  orderId: 'ORD-001',
  amount: 99.99
});

// Send events
await runtime.sendEvent(orderId, { type: 'VALIDATE' });
```

### 4. Next.js / React Integration

For Next.js apps, add `xcomponent-ai` and `redis` to external packages:

```javascript
// next.config.mjs
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['xcomponent-ai', 'redis']
  }
};

export default nextConfig;
```

Then in your API route or server action:

```typescript
// app/api/orders/route.ts
import { getRuntime } from '@/lib/xcomponent-runtime';

export async function POST(request: Request) {
  const runtime = await getRuntime();
  const body = await request.json();

  const instanceId = runtime.createInstance('Order', {
    orderId: body.orderId,
    amount: body.amount
  });

  return Response.json({ instanceId });
}
```

## Alternative: RabbitMQ

RabbitMQ provides reliable message delivery with features like dead-letter queues and message acknowledgments.

### docker-compose.yml (RabbitMQ)

```yaml
services:
  # RabbitMQ Message Broker
  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "5672:5672"   # AMQP
      - "15672:15672" # Management UI
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "check_port_connectivity"]
      interval: 10s
      timeout: 5s
      retries: 10

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - BROKER_URL=amqp://guest:guest@rabbitmq:5672
    depends_on:
      rabbitmq:
        condition: service_healthy

  dashboard:
    image: node:20-alpine
    ports:
      - "4000:4000"
    environment:
      - BROKER_URL=amqp://guest:guest@rabbitmq:5672
      - PORT=4000
    depends_on:
      rabbitmq:
        condition: service_healthy
    volumes:
      - ./fsm:/app/fsm:ro
      - ./scripts/dashboard-server.js:/app/dashboard-server.js:ro
    working_dir: /app
    command: >
      sh -c "
        npm install xcomponent-ai yaml amqplib &&
        node dashboard-server.js
      "
```

### App Integration (RabbitMQ)

```typescript
// Just change the broker URL - the API is the same!
const brokerUrl = process.env.BROKER_URL || 'amqp://guest:guest@localhost:5672';

const broadcaster = await createRuntimeBroadcaster(runtime, component, brokerUrl, {
  host: 'my-app',
  port: 3000
});
```

### When to Choose RabbitMQ over Redis

| Use Case | Recommended Broker |
|----------|-------------------|
| Simple monitoring | Redis |
| Development/testing | Redis |
| Need message persistence | RabbitMQ |
| Need dead-letter queues | RabbitMQ |
| High reliability requirements | RabbitMQ |
| Already using RabbitMQ | RabbitMQ |

## Understanding the Architecture

### RuntimeBroadcaster

The `RuntimeBroadcaster` is the key class that connects your app to the dashboard:

```typescript
const broadcaster = await createRuntimeBroadcaster(
  runtime,      // Your FSMRuntime instance
  component,    // Component definition (for schema info)
  brokerUrl,    // 'redis://...', 'amqp://...', or 'memory'
  options       // { host, port } for identification
);
```

It automatically:
- Announces the runtime to the broker on startup
- Sends heartbeats to indicate the runtime is alive
- Publishes events: `instance_created`, `state_change`, `instance_completed`
- Responds to instance queries from the dashboard

### DashboardServer

The `DashboardServer` aggregates all runtimes:

```typescript
const dashboard = new DashboardServer(
  brokerUrl,     // 'redis://...' or 'amqp://...' to subscribe to runtime events
  databaseUrl,   // Optional PostgreSQL for persistence
  component      // Optional component for schema validation
);
```

It:
- Subscribes to runtime announcements on the broker
- Queries new runtimes for their instances
- Caches instances in memory
- Serves the dashboard UI with real-time updates via WebSocket

### Message Flow

```
1. App starts
   └── RuntimeBroadcaster.connect()
       └── Publishes to broker: xcomponent:announce

2. Dashboard receives announcement
   └── Queries runtime for instances
       └── Publishes to broker: xcomponent:query

3. RuntimeBroadcaster receives query
   └── Responds with all instances
       └── Publishes to broker: xcomponent:query_response

4. App creates instance
   └── runtime.createInstance()
       └── RuntimeBroadcaster publishes: xcomponent:instance_created

5. Dashboard receives instance_created
   └── Updates cache
       └── Broadcasts to WebSocket clients
           └── Dashboard UI updates in real-time
```

## Common Issues

### Dashboard shows 0 instances

**Cause**: Your app isn't using `RuntimeBroadcaster`

**Fix**: Add broadcaster to your app:
```typescript
const broadcaster = await createRuntimeBroadcaster(runtime, component, brokerUrl);
```

### "Cannot find module 'redis'"

**Cause**: The `redis` package isn't installed or webpack can't resolve it

**Fix**:
1. Install: `npm install redis`
2. For Next.js, add to `serverComponentsExternalPackages`

### Dashboard shows stale instances

**Cause**: Runtime crashed without graceful shutdown

**Fix**: Implement graceful shutdown:
```typescript
process.on('SIGTERM', async () => {
  await broadcaster.disconnect();
  process.exit(0);
});
```

### CLI serve vs DashboardServer

| `xcomponent-ai serve` | `DashboardServer` |
|----------------------|-------------------|
| Creates its own runtime | Subscribes to external runtimes |
| Good for demos | Good for production |
| Single process | Distributed architecture |
| Doesn't see external apps | Aggregates all runtimes |

**Rule of thumb**: Use `DashboardServer` directly when your app creates instances outside the CLI.

## Complete Example

See `examples/distributed-redis/` for a complete working example with:
- docker-compose.yml
- Dashboard server script
- Two separate runtime services
- Instance creation and monitoring

```bash
cd examples/distributed-redis
docker compose up
# Dashboard: http://localhost:3000
# Instances will appear as runtimes create them
```

## Persistence (Optional)

For production, add PostgreSQL to persist events:

```javascript
const dashboard = new DashboardServer(
  'redis://redis:6379',
  'postgresql://user:pass@postgres:5432/xcomponent'  // Enables persistence
);
```

See `PERSISTENCE.md` for schema and setup details.
