# ⚡ Scalability Guide

xcomponent-ai can scale from prototypes to production workloads. This guide explains scaling strategies.

---

## 🏗️ Current Architecture (Single Process)

**Default behavior** with `xcomponent-ai serve`:

```
┌─────────────────────────────────────┐
│       Node.js Process               │
│                                     │
│  ┌───────────────────────────────┐ │
│  │   ComponentRegistry (Hub)     │ │
│  │                               │ │
│  │  ┌──────────┐  ┌──────────┐  │ │
│  │  │ OrderCpt │  │ PayCpt   │  │ │
│  │  │ Runtime  │  │ Runtime  │  │ │
│  │  └──────────┘  └──────────┘  │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │      Express API + WS         │ │
│  └───────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Pros
- ✅ Simple deployment (one process)
- ✅ Fast in-memory communication
- ✅ Easy debugging
- ✅ Low latency (<1ms for cascadingRules)
- ✅ Perfect for prototypes and demos

### Cons
- ❌ Single CPU core (Node.js is single-threaded)
- ❌ Limited memory (heap limit ~1.5GB default)
- ❌ Single point of failure
- ❌ Cannot scale horizontally
- ❌ All components restart together

### When to Use
- Prototypes and demos
- Development environments
- Low-traffic applications (<1000 req/s)
- Single-tenant SaaS with moderate load

---

## 🚀 Scaling Strategies

### Strategy 1: Node.js Cluster Mode (Same Machine)

**Use Node.js cluster module** to fork multiple processes on the same machine.

```typescript
// server.ts
import cluster from 'cluster';
import os from 'os';

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Primary ${process.pid} starting ${numCPUs} workers`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  // Each worker runs the full xcomponent-ai runtime
  import('./app');  // Your xcomponent-ai serve logic
}
```

**Architecture:**
```
┌─────────────────────────────────────────┐
│          Load Balancer (nginx)          │
└────────────┬────────────┬───────────────┘
             │            │
    ┌────────▼─────┐  ┌──▼────────┐
    │ Worker 1     │  │ Worker 2  │  ... (4-8 workers)
    │ (All comps)  │  │ (All comps│
    └──────────────┘  └───────────┘
```

**Pros:**
- ✅ Utilizes all CPU cores
- ✅ Built-in worker restart on crash
- ✅ Simple implementation

**Cons:**
- ❌ Memory duplication (each worker loads all components)
- ❌ Still limited to one machine
- ❌ Shared state requires external store (Redis)

**When to Use:** 10k-50k req/s on a single multi-core machine

---

### Strategy 2: Microservices (HTTP/gRPC)

**Separate each component into its own service.**

```typescript
// order-service/index.ts
import express from 'express';
import { FSMRuntime } from 'xcomponent-ai';
import orderComponent from './order.yaml';

const app = express();
const runtime = new FSMRuntime(orderComponent);

app.post('/instances', (req, res) => {
  const id = runtime.createInstance('Order', req.body);
  res.json({ instanceId: id });
});

app.post('/instances/:id/events', async (req, res) => {
  await runtime.sendEvent(req.params.id, req.body);

  // Cross-component: Call payment service via HTTP
  if (req.body.type === 'VALIDATE') {
    const instance = runtime.getInstance(req.params.id);
    await fetch('http://payment-service/instances', {
      method: 'POST',
      body: JSON.stringify({
        machineName: 'Payment',
        context: instance.context
      })
    });
  }

  res.json({ success: true });
});

app.listen(3001);
```

```typescript
// payment-service/index.ts (similar, port 3002)
```

**Architecture:**
```
                  ┌─────────────┐
                  │   Gateway   │
                  └──────┬──────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
  ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
  │  Order    │   │  Payment  │   │ Shipment  │
  │  Service  │   │  Service  │   │  Service  │
  │  :3001    │   │  :3002    │   │  :3003    │
  └───────────┘   └───────────┘   └───────────┘
```

**Pros:**
- ✅ Independent scaling (scale Order service separately from Payment)
- ✅ Independent deployment
- ✅ Technology heterogeneity (different languages if needed)
- ✅ Fault isolation (one service crash doesn't affect others)

**Cons:**
- ❌ Network latency for cross-component calls
- ❌ Complex orchestration
- ❌ Distributed tracing needed
- ❌ Service discovery complexity

**Implementation Options:**
- **HTTP REST:** Simple, works everywhere
- **gRPC:** Faster, strongly typed
- **GraphQL Federation:** For complex client queries

**When to Use:** >100k req/s, need independent scaling, large teams

---

### Strategy 3: Message Broker (Event-Driven)

**Use Redis Pub/Sub, NATS, RabbitMQ, or Kafka for async communication.**

**✨ NEW in v0.3.0:** Redis Pub/Sub is now **built-in**! Use the `--broker` flag:

```bash
# Process 1 (OrderComponent)
xcomponent-ai serve order.yaml --port 3001 --broker redis://localhost:6379

# Process 2 (PaymentComponent)
xcomponent-ai serve payment.yaml --port 3002 --broker redis://localhost:6379
```

Your YAML cascadingRules automatically work across processes! See `examples/distributed-demo/` for a complete working example.

**Manual implementation** (if you need custom logic):

```typescript
// order-service/index.ts
import { FSMRuntime } from 'xcomponent-ai';
import { createClient } from 'redis';
import orderComponent from './order.yaml';

const runtime = new FSMRuntime(orderComponent);
const redis = createClient();

// Listen for incoming events
redis.subscribe('order.events', async (message) => {
  const { instanceId, event } = JSON.parse(message);
  await runtime.sendEvent(instanceId, event);
});

// Publish cross-component events
runtime.on('cross_component_cascade', (data) => {
  redis.publish(`${data.targetComponent.toLowerCase()}.events`, JSON.stringify({
    instanceId: data.targetInstanceId,
    event: { type: data.event, payload: data.payload }
  }));
});
```

**Architecture:**
```
┌──────────┐      ┌─────────────┐      ┌──────────┐
│  Order   │─────▶│ Message     │◀─────│ Payment  │
│  Service │      │ Broker      │      │ Service  │
└──────────┘      │ (Redis/NATS)│      └──────────┘
                  └─────────────┘
                        ▲  │
                        │  │
                  ┌─────┴──▼─────┐
                  │   Shipment   │
                  │   Service    │
                  └──────────────┘
```

**Pros:**
- ✅ Full async, non-blocking
- ✅ Decoupled services (no direct HTTP calls)
- ✅ Built-in retry and dead-letter queues
- ✅ Event sourcing naturally fits
- ✅ Horizontal scaling (add more consumers)

**Cons:**
- ❌ Eventual consistency
- ❌ Message ordering challenges
- ❌ Broker becomes single point of failure (unless clustered)
- ❌ Debugging complexity

**Message Broker Options:**
- **Redis Pub/Sub:** Simple, fast, but no persistence
- **NATS:** Lightweight, cloud-native
- **RabbitMQ:** Rich features, durable queues
- **Kafka:** High throughput, event streaming

**When to Use:** >1M events/day, async workflows, event sourcing

---

### Strategy 4: Distributed ComponentRegistry

**Custom implementation**: Central registry that routes to remote runtimes.

```typescript
// distributed-registry.ts
import { ComponentRegistry } from 'xcomponent-ai';
import { createClient } from 'redis';

class DistributedComponentRegistry extends ComponentRegistry {
  private redis = createClient();
  private serviceMap = new Map<string, string>(); // componentName → serviceURL

  async registerRemoteComponent(name: string, url: string) {
    this.serviceMap.set(name, url);
    await this.redis.set(`component:${name}`, url);
  }

  async broadcastToComponent(
    componentName: string,
    machineName: string,
    state: string,
    event: any
  ) {
    const url = this.serviceMap.get(componentName);
    if (!url) throw new Error(`Component ${componentName} not registered`);

    // HTTP call to remote service
    const response = await fetch(`${url}/broadcast`, {
      method: 'POST',
      body: JSON.stringify({ machineName, state, event })
    });

    return (await response.json()).count;
  }
}
```

**Usage:**
```typescript
const registry = new DistributedComponentRegistry();

// Register remote components
await registry.registerRemoteComponent('OrderComponent', 'http://order-service:3001');
await registry.registerRemoteComponent('PaymentComponent', 'http://payment-service:3002');

// cascadingRules work across network!
```

**Pros:**
- ✅ Transparent cross-component communication
- ✅ Existing YAML cascadingRules work without changes
- ✅ Centralized configuration

**Cons:**
- ❌ Custom implementation required
- ❌ Single registry instance (needs HA)
- ❌ Added network latency

**When to Use:** Migrating from single-process to distributed gradually

---

## 📊 Scaling Comparison

| Strategy | Max Throughput | Latency | Complexity | Cost |
|----------|---------------|---------|------------|------|
| **Single Process** | ~10k req/s | <1ms | Low | $ |
| **Cluster Mode** | ~50k req/s | <1ms | Low | $ |
| **Microservices (HTTP)** | ~200k req/s | 5-20ms | High | $$$ |
| **Message Broker** | >1M events/s | 10-100ms | High | $$$ |
| **Hybrid** | ~500k req/s | 2-50ms | Very High | $$$$ |

---

## 🔧 Database Scaling

### Current: In-Memory

```typescript
const runtime = new FSMRuntime(component);
// All state in memory, lost on restart
```

### With Persistence (PostgreSQL)

```typescript
import { FSMRuntime, PostgresPersistence } from 'xcomponent-ai';

const persistence = new PostgresPersistence({
  connectionString: process.env.DATABASE_URL
});

const runtime = new FSMRuntime(component, {
  persistence,
  snapshotInterval: 10  // Snapshot every 10 events
});
```

**Scaling PostgreSQL:**
- **Read Replicas:** Route read queries to replicas
- **Connection Pooling:** PgBouncer to manage connections
- **Partitioning:** Partition events by componentName or date
- **Sharding:** Shard by instance ID hash

### With Redis (Caching)

```typescript
import Redis from 'ioredis';

const redis = new Redis();

// Cache instance state
runtime.on('state_change', async (data) => {
  await redis.setex(
    `instance:${data.instanceId}`,
    3600,  // 1 hour TTL
    JSON.stringify(runtime.getInstance(data.instanceId))
  );
});

// Read from cache
async function getInstance(id: string) {
  const cached = await redis.get(`instance:${id}`);
  if (cached) return JSON.parse(cached);
  return runtime.getInstance(id);  // Fallback to source
}
```

---

## 🎯 Recommendations by Scale

### Small (<10k req/s, <100k instances)
- **Deploy:** Single process
- **Hosting:** Single VPS or Cloud Run
- **Database:** SQLite or small Postgres
- **Cost:** $20-50/month

### Medium (10k-100k req/s, <1M instances)
- **Deploy:** Cluster mode OR microservices
- **Hosting:** Kubernetes with 3-5 pods
- **Database:** Postgres with read replicas
- **Cache:** Redis for hot instances
- **Cost:** $500-2000/month

### Large (>100k req/s, >1M instances)
- **Deploy:** Microservices + Message Broker
- **Hosting:** Kubernetes with autoscaling
- **Database:** Postgres with sharding
- **Cache:** Redis Cluster
- **Monitoring:** Datadog, New Relic
- **Cost:** $5k-20k/month

---

## 🚨 Common Pitfalls

### 1. Premature Distribution
**Problem:** Starting with microservices for a prototype
**Solution:** Start with single process, migrate when needed

### 2. Tight Coupling via HTTP
**Problem:** Synchronous HTTP for all cross-component calls
**Solution:** Use message broker for async workflows

### 3. No Circuit Breakers
**Problem:** Cascading failures when one service is down
**Solution:** Use circuit breakers (Resilience4j, Polly)

### 4. Shared Database
**Problem:** All services write to same DB table
**Solution:** Each service owns its data, communicate via events

### 5. No Health Checks
**Problem:** Load balancer sends traffic to crashed pods
**Solution:** Implement `/health` endpoint checking runtime status

---

## 📚 Further Reading

- **12-Factor App:** https://12factor.net/
- **Microservices Patterns:** https://microservices.io/patterns/
- **CQRS and Event Sourcing:** https://martinfowler.com/eaaDev/EventSourcing.html
- **Kubernetes Best Practices:** https://kubernetes.io/docs/concepts/

---

**Summary:** xcomponent-ai scales from prototypes (single process) to production (distributed microservices). Choose the strategy that matches your current scale, not your future dreams.
