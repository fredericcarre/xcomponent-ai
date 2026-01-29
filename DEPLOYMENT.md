# Deployment Guide

This document is the single reference for all xcomponent-ai deployment modes.

## Table of Contents

- [Overview](#overview)
- [Architecture Components](#architecture-components)
- [Deployment Modes](#deployment-modes)
  - [Mode 1: Monolith (in-memory)](#mode-1-monolith-in-memory)
  - [Mode 2: Monolith + PostgreSQL](#mode-2-monolith--postgresql)
  - [Mode 3: Distributed + RabbitMQ](#mode-3-distributed--rabbitmq)
  - [Mode 4: Distributed + Redis](#mode-4-distributed--redis)
  - [Mode 5: Redis-only (bus + persistence)](#mode-5-redis-only-bus--persistence)
  - [Mode 6: Distributed + Kafka](#mode-6-distributed--kafka)
- [Comparison Matrix](#comparison-matrix)
- [Persistence Backends](#persistence-backends)
  - [In-Memory](#in-memory)
  - [PostgreSQL](#postgresql)
  - [Redis](#redis)
- [Message Brokers](#message-brokers)
  - [In-Memory (single-process)](#in-memory-single-process)
  - [RabbitMQ](#rabbitmq)
  - [Redis Pub/Sub](#redis-pubsub)
  - [Kafka](#kafka)
- [Dashboard and Audit Trail](#dashboard-and-audit-trail)
- [Docker Examples](#docker-examples)
- [Configuration Reference](#configuration-reference)

---

## Overview

xcomponent-ai has three independently configurable layers:

```
 ┌──────────────────────────────────────────────┐
 │              Dashboard (Web UI)               │
 │         Real-time monitoring + audit          │
 └────────────────────┬─────────────────────────┘
                      │
 ┌────────────────────▼─────────────────────────┐
 │          Message Broker (Bus)                 │
 │   In-memory │ RabbitMQ │ Redis │ Kafka        │
 │   Cross-component event routing               │
 └────────────────────┬─────────────────────────┘
                      │
 ┌────────────────────▼─────────────────────────┐
 │           Persistence (Database)              │
 │   In-memory │ PostgreSQL │ Redis              │
 │   Event sourcing + snapshots + audit trail    │
 └──────────────────────────────────────────────┘
```

Each layer is **optional and independently configurable**:
- **Bus**: How components communicate (in-memory for single-process, Redis/RabbitMQ/Kafka for distributed)
- **Persistence**: Where events and snapshots are stored (in-memory, PostgreSQL, or Redis)
- **Dashboard**: Web UI for monitoring (adapts based on database availability)

---

## Architecture Components

| Component | Role | Required |
|-----------|------|----------|
| **FSMRuntime** | Executes state machines, manages instances | Yes |
| **MessageBroker** | Routes events between components | Yes (in-memory by default) |
| **PersistenceManager** | Stores events and snapshots | No (in-memory by default) |
| **DashboardServer** | Web UI + REST API + WebSocket | No |
| **RuntimeBroadcaster** | Connects runtimes to the message bus | Yes for distributed |

---

## Deployment Modes

### Mode 1: Monolith (in-memory)

**Zero external dependencies.** Everything runs in a single Node.js process.

```
┌──────────────────────────────────────┐
│        Node.js Process               │
│                                      │
│  ┌────────────┐  ┌────────────┐     │
│  │ Component A │  │ Component B │     │
│  │  Runtime    │  │  Runtime    │     │
│  └──────┬─────┘  └─────┬──────┘     │
│         │               │            │
│  ┌──────▼───────────────▼──────┐    │
│  │   InMemoryMessageBroker     │    │
│  │      (singleton)            │    │
│  └─────────────────────────────┘    │
│                                      │
│  ┌─────────────────────────────┐    │
│  │   Dashboard (port 3000)     │    │
│  └─────────────────────────────┘    │
└──────────────────────────────────────┘
```

**Characteristics:**
- No database required
- No external services
- Data lost on restart
- No audit trail (dashboard shows warning)
- Fastest latency (<1ms cross-component)

**Usage:**
```bash
# CLI
xcomponent-ai serve component.yaml

# Programmatic
const runtime = new FSMRuntime(component);
```

**When to use:** Development, prototyping, demos, testing.

---

### Mode 2: Monolith + PostgreSQL

**Single process with database persistence.** Same in-memory bus, but events and snapshots are stored in PostgreSQL.

```
┌──────────────────────────────────────┐
│        Node.js Process               │
│                                      │
│  ┌────────────┐  ┌────────────┐     │
│  │ Component A │  │ Component B │     │
│  │  Runtime    │  │  Runtime    │     │
│  └──────┬─────┘  └─────┬──────┘     │
│         │               │            │
│  ┌──────▼───────────────▼──────┐    │
│  │   InMemoryMessageBroker     │    │
│  │      (singleton)            │    │
│  └─────────────────────────────┘    │
│                                      │
│  ┌─────────────────────────────┐    │
│  │   Dashboard (port 3000)     │    │
│  └─────────────────────────────┘    │
└─────────────────┬────────────────────┘
                  │
         ┌────────▼────────┐
         │   PostgreSQL    │
         │   (port 5432)   │
         └─────────────────┘
```

**Characteristics:**
- PostgreSQL for event sourcing and snapshots
- Full audit trail in dashboard (event history, sequence diagrams)
- Data survives restarts
- Single process simplicity
- Still fast in-memory cross-component communication

**Usage:**
```typescript
import { createPostgresStores, FSMRuntime } from 'xcomponent-ai';

const { eventStore, snapshotStore } = await createPostgresStores({
  connectionString: process.env.DATABASE_URL
});

const runtime = new FSMRuntime(component, {
  eventSourcing: true,
  snapshots: true,
  snapshotInterval: 10,
  eventStore,
  snapshotStore,
});
```

**Docker:** See `examples/monolith-postgres/`
```bash
cd examples/monolith-postgres
docker compose up
# Dashboard: http://localhost:3000/dashboard.html
```

**When to use:** Small production deployments, single-server hosting, when you need audit trail without distributed complexity.

---

### Mode 3: Distributed + RabbitMQ

**Multi-process architecture.** Each component runs in its own process. RabbitMQ handles cross-component messaging.

```
┌────────────┐      ┌────────────┐
│ Runtime 1  │      │ Runtime 2  │
│ Component A│      │ Component B│
└──────┬─────┘      └─────┬──────┘
       │                   │
┌──────▼───────────────────▼──────┐
│           RabbitMQ              │
│     (cross-component bus)       │
└──────┬──────────────────────────┘
       │
┌──────▼──────────────────────────┐
│        Dashboard Server         │
│   (subscribes to RabbitMQ)      │
└──────┬──────────────────────────┘
       │
┌──────▼──────┐
│ PostgreSQL  │  (optional)
└─────────────┘
```

**Characteristics:**
- Independent scaling per component
- Fault isolation (one component crash doesn't affect others)
- Durable message queues (RabbitMQ)
- Optional PostgreSQL for audit trail
- Dashboard shows all components from all runtimes

**Usage:**
```bash
# Runtime 1 (OrderComponent)
node runtime.js --component order.yaml --broker amqp://rabbitmq:5672

# Runtime 2 (PaymentComponent)
node runtime.js --component payment.yaml --broker amqp://rabbitmq:5672

# Dashboard
node dashboard.js --broker amqp://rabbitmq:5672 --database postgresql://...
```

**Docker:** See `examples/distributed/`
```bash
cd examples/distributed
docker compose up
# Dashboard: http://localhost:3000/dashboard.html
```

**When to use:** Production with multiple teams, independent scaling needs, high availability requirements.

---

### Mode 4: Distributed + Redis

**Same as Mode 3, but with Redis Pub/Sub instead of RabbitMQ.** Lighter infrastructure.

```
┌────────────┐      ┌────────────┐
│ Runtime 1  │      │ Runtime 2  │
│ Component A│      │ Component B│
└──────┬─────┘      └─────┬──────┘
       │                   │
┌──────▼───────────────────▼──────┐
│         Redis Pub/Sub           │
│     (cross-component bus)       │
└──────┬──────────────────────────┘
       │
┌──────▼──────────────────────────┐
│        Dashboard Server         │
│    (subscribes to Redis)        │
└──────┬──────────────────────────┘
       │
┌──────▼──────┐
│ PostgreSQL  │  (optional)
└─────────────┘
```

**Characteristics:**
- Lighter than RabbitMQ (no separate broker process if Redis already in stack)
- Redis Pub/Sub for fire-and-forget messaging
- No message persistence (messages lost if no subscriber is connected)
- Optional PostgreSQL for audit trail

**Usage:**
```bash
# Runtime
node runtime.js --component order.yaml --broker redis://redis:6379

# Dashboard
node dashboard.js --broker redis://redis:6379 --database postgresql://...
```

**Docker:** See `examples/distributed-redis/`
```bash
cd examples/distributed-redis
docker compose up
# Dashboard: http://localhost:3000/dashboard.html
```

**When to use:** When Redis is already in your stack, lighter alternative to RabbitMQ, fire-and-forget messaging is acceptable.

---

### Mode 5: Redis-only (bus + persistence)

**Redis for everything.** Both message bus AND event/snapshot storage. No PostgreSQL needed.

```
┌────────────┐      ┌────────────┐
│ Runtime 1  │      │ Runtime 2  │
│ Component A│      │ Component B│
└──────┬─────┘      └─────┬──────┘
       │                   │
┌──────▼───────────────────▼──────┐
│              Redis              │
│   Pub/Sub (bus) + Sorted Sets   │
│   (events) + Keys (snapshots)   │
└──────┬──────────────────────────┘
       │
┌──────▼──────────────────────────┐
│        Dashboard Server         │
└─────────────────────────────────┘
```

**Characteristics:**
- Single external dependency (Redis)
- Persistence via `RedisEventStore` and `RedisSnapshotStore`
- Events stored in sorted sets (ordered by timestamp)
- Snapshots stored as JSON strings
- Full audit trail support
- Simpler infrastructure than Redis + PostgreSQL

**Usage:**
```typescript
import { createRedisStores, createRuntimeBroadcaster } from 'xcomponent-ai';

// Redis for persistence
const { eventStore, snapshotStore } = await createRedisStores({
  url: 'redis://localhost:6379',
  keyPrefix: 'fsm'
});

const runtime = new FSMRuntime(component, {
  eventSourcing: true,
  snapshots: true,
  eventStore,
  snapshotStore,
});

// Redis for bus (same Redis instance)
const broadcaster = await createRuntimeBroadcaster(
  runtime, component, 'redis://localhost:6379'
);
```

**When to use:** When you want distributed deployment with minimal infrastructure (single Redis instance for everything).

---

### Mode 6: Distributed + Kafka

**High-throughput distributed architecture.** Each component runs in its own process. Apache Kafka handles cross-component messaging with durability and ordering guarantees.

```
┌────────────┐      ┌────────────┐
│ Runtime 1  │      │ Runtime 2  │
│ Component A│      │ Component B│
└──────┬─────┘      └─────┬──────┘
       │                   │
┌──────▼───────────────────▼──────┐
│            Kafka                │
│     (cross-component bus)       │
│  Topics: xcomponent.fsm.*       │
└──────┬──────────────────────────┘
       │
┌──────▼──────────────────────────┐
│        Dashboard Server         │
│   (subscribes to Kafka)         │
└──────┬──────────────────────────┘
       │
┌──────▼──────┐
│ PostgreSQL  │  (optional)
└─────────────┘
```

**Characteristics:**
- High throughput (millions of messages/sec)
- Message ordering per partition
- Durable message storage with configurable retention
- Replay capability (consumers can rewind to previous offsets)
- Horizontal scaling with partitions
- Optional PostgreSQL for audit trail

**Usage:**
```bash
# Runtime 1 (OrderComponent)
node runtime.js --component order.yaml --broker kafka://kafka:9092

# Runtime 2 (PaymentComponent)
node runtime.js --component payment.yaml --broker kafka://kafka:9092

# Dashboard
node dashboard.js --broker kafka://kafka:9092 --database postgresql://...
```

**Programmatic:**
```typescript
import { createRuntimeBroadcaster, FSMRuntime } from 'xcomponent-ai';

const runtime = new FSMRuntime(component);
const broadcaster = await createRuntimeBroadcaster(
  runtime, component, 'kafka://localhost:9092'
);
```

**URL formats:**
```
kafka://localhost:9092                        # Single broker
kafka://broker1:9092,broker2:9092             # Multiple brokers
kafka://user:password@localhost:9092          # SASL/PLAIN auth
kafkas://localhost:9093                       # SSL/TLS
kafkas://user:password@localhost:9093         # SSL + SASL
kafka://localhost:9092?clientId=myapp         # Custom client ID
kafka://localhost:9092?groupId=mygroup        # Custom consumer group prefix
```

**Docker:** See `examples/distributed-kafka/`
```bash
cd examples/distributed-kafka
docker compose up
# Dashboard: http://localhost:3000/dashboard.html
```

**When to use:** High-volume production workloads, event streaming architectures, when you need message replay, microservices at scale.

---

## Comparison Matrix

| | Monolith | Monolith+PG | Distributed+RMQ | Distributed+Redis | Redis-only | Distributed+Kafka |
|---|---|---|---|---|---|---|
| **External deps** | None | PostgreSQL | RabbitMQ + PG (opt.) | Redis + PG (opt.) | Redis | Kafka + PG (opt.) |
| **Persistence** | In-memory | PostgreSQL | PostgreSQL (opt.) | PostgreSQL (opt.) | Redis | PostgreSQL (opt.) |
| **Bus** | In-memory | In-memory | RabbitMQ | Redis Pub/Sub | Redis Pub/Sub | Kafka |
| **Audit trail** | No | Yes | If PG configured | If PG configured | Yes | If PG configured |
| **Multi-process** | No | No | Yes | Yes | Yes | Yes |
| **Data on restart** | Lost | Persisted | Persisted (if PG) | Persisted (if PG) | Persisted | Persisted (if PG) |
| **Cross-component latency** | <1ms | <1ms | 5-20ms | 2-10ms | 2-10ms | 5-50ms |
| **Message durability** | N/A | N/A | Yes (queues) | No (Pub/Sub) | No (Pub/Sub) | Yes (topics) |
| **Throughput** | High | High | Medium | Medium | Medium | Very High |
| **Message replay** | No | No | No | No | No | Yes |
| **Complexity** | Low | Low | High | Medium | Medium | High |
| **Example** | CLI default | `monolith-postgres/` | `distributed/` | `distributed-redis/` | Programmatic | `distributed-kafka/` |

---

## Persistence Backends

### In-Memory

Default. No configuration needed. Data lost on restart.

```typescript
import { InMemoryEventStore, InMemorySnapshotStore } from 'xcomponent-ai';

const runtime = new FSMRuntime(component, {
  eventSourcing: true,
  eventStore: new InMemoryEventStore(),
  snapshotStore: new InMemorySnapshotStore(),
});
```

### PostgreSQL

Production-grade persistence with full SQL query support.

```typescript
import { createPostgresStores } from 'xcomponent-ai';

const { eventStore, snapshotStore } = await createPostgresStores({
  connectionString: 'postgresql://user:pass@localhost:5432/xcomponent_fsm'
});
```

**Schema:** See `examples/distributed/init-db.sql`

**Tables:**
- `fsm_events` — Event sourcing (all state transitions)
- `fsm_snapshots` — State snapshots (periodic + terminal states)

### Redis

Event storage using sorted sets, snapshots as JSON keys.

```typescript
import { createRedisStores } from 'xcomponent-ai';

const { eventStore, snapshotStore } = await createRedisStores({
  url: 'redis://localhost:6379',
  keyPrefix: 'fsm'     // optional, default: 'fsm'
});
```

**Data structures:**
- `fsm:events:{instanceId}` — Sorted set (score = timestamp)
- `fsm:events:all` — Global sorted set for time-range queries
- `fsm:event:{eventId}` — Individual event hash
- `fsm:snapshot:{instanceId}` — JSON string
- `fsm:snapshots:all` — Set of all instance IDs with snapshots

---

## Message Brokers

### In-Memory (single-process)

Default for monolith mode. Uses `InMemoryMessageBroker` singleton.

When `DashboardServer` and runtimes run in the same process with `broker='memory'`, they automatically share the same singleton instance, enabling cross-component communication without external services.

```typescript
import { DashboardServer, createRuntimeBroadcaster } from 'xcomponent-ai';

// Dashboard creates the singleton
const dashboard = new DashboardServer('memory', databaseUrl);

// Runtimes connect to the same singleton
const broadcaster = await createRuntimeBroadcaster(runtime, component, 'memory');
```

### RabbitMQ

AMQP-based message broker with durable queues.

```typescript
const broadcaster = await createRuntimeBroadcaster(
  runtime, component, 'amqp://rabbitmq:5672'
);
```

- Messages survive broker restarts (durable queues)
- Dead-letter exchange support
- Multiple consumer pattern

### Redis Pub/Sub

Lightweight fire-and-forget messaging.

```typescript
const broadcaster = await createRuntimeBroadcaster(
  runtime, component, 'redis://redis:6379'
);
```

- No message persistence (Pub/Sub is ephemeral)
- Lower latency than RabbitMQ
- Simpler infrastructure if Redis already in stack

### Kafka

High-throughput distributed streaming platform.

```typescript
const broadcaster = await createRuntimeBroadcaster(
  runtime, component, 'kafka://kafka:9092'
);
```

**Features:**
- Very high throughput (millions of messages/second)
- Durable message storage with configurable retention
- Message ordering per partition
- Replay capability (consumers can rewind)
- Horizontal scaling with partitions
- Built-in fault tolerance with replication

**URL formats:**
| URL | Description |
|-----|-------------|
| `kafka://localhost:9092` | Single broker, no auth |
| `kafka://broker1:9092,broker2:9092` | Multiple brokers |
| `kafka://user:pass@localhost:9092` | SASL/PLAIN authentication |
| `kafkas://localhost:9093` | SSL/TLS encrypted |
| `kafkas://user:pass@localhost:9093` | SSL + SASL |
| `kafka://localhost:9092?clientId=myapp` | Custom client ID |
| `kafka://localhost:9092?groupId=mygroup` | Custom consumer group prefix |

**Topic naming:**
- Channels are converted to Kafka topics with prefix `xcomponent.`
- Example: `fsm:events:state_change` → `xcomponent.fsm.events.state_change`

**Consumer groups:**
- Each subscription creates a unique consumer group
- Ensures all subscribers receive all messages (broadcast semantics)
- Group ID format: `xcomponent.{topic}.{timestamp}.{random}`

**When to choose Kafka over RabbitMQ:**
- Need very high throughput (>100k msgs/sec)
- Want message replay capability
- Building event streaming architecture
- Need long-term message retention

---

## Dashboard and Audit Trail

The dashboard automatically adapts based on database availability:

| Feature | No database | With database |
|---------|-------------|---------------|
| Active instances | Yes (real-time) | Yes (real-time) |
| Event blotter | Yes (real-time) | Yes (real-time) |
| FSM diagram | Yes | Yes |
| Event history search | No | Yes |
| Audit trail | No | Yes |
| Sequence diagram | No | Yes |
| Instance correlation | No | Yes |

When no database is configured, the dashboard displays a warning banner:
> "No database configured. Event history and audit trail require PostgreSQL or Redis persistence."

The `/health` endpoint reports database availability:
```json
{
  "status": "ok",
  "database": true,
  "connectedRuntimes": 2,
  "components": ["OrderComponent", "PaymentComponent"]
}
```

---

## Docker Examples

Each deployment mode has a complete Docker example:

| Directory | Mode | Services |
|-----------|------|----------|
| `examples/monolith-postgres/` | Monolith + PostgreSQL | app, postgres |
| `examples/distributed/` | Distributed + RabbitMQ | runtime-order, runtime-payment, dashboard, rabbitmq, postgres |
| `examples/distributed-redis/` | Distributed + Redis | runtime-order, runtime-payment, dashboard, redis, postgres |
| `examples/distributed-kafka/` | Distributed + Kafka | runtime-order, runtime-payment, dashboard, kafka, zookeeper, postgres |

Run any example:
```bash
cd examples/<directory>
docker compose up
# Dashboard: http://localhost:3000/dashboard.html
```

Run E2E tests:
```bash
docker compose up -d
node e2e-test.js
docker compose down
```

---

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | None (in-memory) |
| `REDIS_URL` | Redis connection string | None |
| `BROKER_URL` | Message broker URL (`amqp://...`, `redis://...`, `kafka://...`, or `memory`) | `memory` |
| `PORT` | Dashboard/API port | `3000` |
| `SNAPSHOT_INTERVAL` | Save snapshot every N transitions | `10` |

### Broker URL Format

| URL | Broker type |
|-----|-------------|
| `memory` | In-memory (single-process) |
| `amqp://host:5672` | RabbitMQ |
| `redis://host:6379` | Redis Pub/Sub |
| `kafka://host:9092` | Apache Kafka |
| `kafkas://host:9093` | Apache Kafka (SSL) |

### Persistence Configuration

```typescript
const runtime = new FSMRuntime(component, {
  // Enable event sourcing
  eventSourcing: true,

  // Enable snapshots
  snapshots: true,

  // Snapshot frequency
  snapshotInterval: 10,

  // Storage backend
  eventStore: store,      // InMemoryEventStore | PostgresEventStore | RedisEventStore
  snapshotStore: store,   // InMemorySnapshotStore | PostgresSnapshotStore | RedisSnapshotStore
});
```

---

## Migration Path

Typical progression from development to production:

```
1. Development    →  Monolith (in-memory)
                     No external deps, fast iteration

2. Staging        →  Monolith + PostgreSQL
                     Add persistence, test audit trail

3. Production     →  Distributed + RabbitMQ/Redis
                     Scale independently, fault isolation

4. Optimization   →  Redis-only (if applicable)
                     Simplify infrastructure
```

Each step is additive — the YAML component definitions and business logic remain unchanged across all deployment modes. Only the infrastructure configuration changes.
