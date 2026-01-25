# Persistence and Event Sourcing

This document covers how to configure and use persistence in xcomponent-ai for event sourcing, snapshots, and production deployments.

## Table of Contents

- [Overview](#overview)
- [Configuration](#configuration)
- [In-Memory Storage](#in-memory-storage)
- [Custom Storage Implementations](#custom-storage-implementations)
  - [EventStore Interface](#eventstore-interface)
  - [SnapshotStore Interface](#snapshotstore-interface)
- [PostgreSQL Implementation](#postgresql-implementation)
- [MongoDB Implementation](#mongodb-implementation)
- [Cross-Component Traceability](#cross-component-traceability)
- [Best Practices](#best-practices)

## Overview

xcomponent-ai supports event sourcing and state snapshots for:

- **Event Sourcing**: Full audit trail of all state transitions
- **Snapshots**: Fast state restoration without replaying all events
- **Cross-Component Traceability**: Trace events across component boundaries
- **Disaster Recovery**: Reconstruct system state from persisted events
- **Debugging**: Analyze event causality chains

## Configuration

Enable persistence when creating an FSMRuntime:

```typescript
import { FSMRuntime } from './fsm-runtime';
import { InMemoryEventStore, InMemorySnapshotStore } from './persistence';

const runtime = new FSMRuntime(component, {
  // Event sourcing: persist all events
  eventSourcing: true,

  // Snapshots: periodically save full state
  snapshots: true,

  // Snapshot interval: save every N transitions (default: 10)
  snapshotInterval: 20,

  // Custom stores (optional)
  eventStore: new InMemoryEventStore(),
  snapshotStore: new InMemorySnapshotStore(),
});
```

## In-Memory Storage

For development and testing, use the built-in in-memory stores:

```typescript
import { InMemoryEventStore, InMemorySnapshotStore } from './persistence';

const eventStore = new InMemoryEventStore();
const snapshotStore = new InMemorySnapshotStore();

const runtime = new FSMRuntime(component, {
  eventSourcing: true,
  snapshots: true,
  eventStore,
  snapshotStore,
});
```

**Note**: In-memory stores lose data on restart. Use database-backed stores for production.

## Custom Storage Implementations

### EventStore Interface

Implement the `EventStore` interface for custom event storage:

```typescript
import { EventStore, PersistedEvent } from './types';

export interface EventStore {
  /**
   * Append event to store
   */
  append(event: PersistedEvent): Promise<void>;

  /**
   * Get all events for a specific instance
   */
  getEventsForInstance(instanceId: string): Promise<PersistedEvent[]>;

  /**
   * Get events within time range
   */
  getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]>;

  /**
   * Get events caused by a specific event (causality)
   */
  getCausedEvents(eventId: string): Promise<PersistedEvent[]>;

  /**
   * Get all events (for backup/export)
   */
  getAllEvents(): Promise<PersistedEvent[]>;
}
```

### SnapshotStore Interface

Implement the `SnapshotStore` interface for custom snapshot storage:

```typescript
import { SnapshotStore, InstanceSnapshot } from './types';

export interface SnapshotStore {
  /**
   * Save instance snapshot
   */
  saveSnapshot(snapshot: InstanceSnapshot): Promise<void>;

  /**
   * Get latest snapshot for instance
   */
  getSnapshot(instanceId: string): Promise<InstanceSnapshot | null>;

  /**
   * Get all snapshots (for backup/export)
   */
  getAllSnapshots(): Promise<InstanceSnapshot[]>;

  /**
   * Delete snapshot
   */
  deleteSnapshot(instanceId: string): Promise<void>;
}
```

## PostgreSQL Implementation

Example PostgreSQL-backed persistence:

### Schema

```sql
-- Events table
CREATE TABLE fsm_events (
  id VARCHAR(50) PRIMARY KEY,
  instance_id VARCHAR(50) NOT NULL,
  machine_name VARCHAR(100) NOT NULL,
  component_name VARCHAR(100) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_payload JSONB NOT NULL,
  state_before VARCHAR(50) NOT NULL,
  state_after VARCHAR(50) NOT NULL,
  persisted_at BIGINT NOT NULL,
  caused_by VARCHAR(50)[],
  caused VARCHAR(50)[],
  source_component_name VARCHAR(100),
  target_component_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_events_instance ON fsm_events(instance_id);
CREATE INDEX idx_events_component ON fsm_events(component_name);
CREATE INDEX idx_events_machine ON fsm_events(machine_name);
CREATE INDEX idx_events_timestamp ON fsm_events(persisted_at);
CREATE INDEX idx_events_caused_by ON fsm_events USING GIN(caused_by);

-- Snapshots table
CREATE TABLE fsm_snapshots (
  instance_id VARCHAR(50) PRIMARY KEY,
  machine_name VARCHAR(100) NOT NULL,
  current_state VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  context JSONB NOT NULL,
  public_member JSONB,
  snapshot_at BIGINT NOT NULL,
  last_event_id VARCHAR(50) NOT NULL,
  pending_timeouts JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Implementation

```typescript
import { Pool } from 'pg';
import { EventStore, PersistedEvent } from './types';

export class PostgreSQLEventStore implements EventStore {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async append(event: PersistedEvent): Promise<void> {
    const query = `
      INSERT INTO fsm_events (
        id, instance_id, machine_name, component_name,
        event_type, event_payload, state_before, state_after,
        persisted_at, caused_by, caused,
        source_component_name, target_component_name
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    await this.pool.query(query, [
      event.id,
      event.instanceId,
      event.machineName,
      event.componentName,
      event.event.type,
      JSON.stringify(event.event.payload),
      event.stateBefore,
      event.stateAfter,
      event.persistedAt,
      event.causedBy || [],
      event.caused || [],
      event.sourceComponentName || null,
      event.targetComponentName || null,
    ]);
  }

  async getEventsForInstance(instanceId: string): Promise<PersistedEvent[]> {
    const query = `
      SELECT * FROM fsm_events
      WHERE instance_id = $1
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [instanceId]);
    return result.rows.map(row => this.rowToEvent(row));
  }

  async getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]> {
    const query = `
      SELECT * FROM fsm_events
      WHERE persisted_at >= $1 AND persisted_at <= $2
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [startTime, endTime]);
    return result.rows.map(row => this.rowToEvent(row));
  }

  async getCausedEvents(eventId: string): Promise<PersistedEvent[]> {
    const query = `
      SELECT * FROM fsm_events
      WHERE $1 = ANY(caused_by)
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [eventId]);
    return result.rows.map(row => this.rowToEvent(row));
  }

  async getAllEvents(): Promise<PersistedEvent[]> {
    const query = `
      SELECT * FROM fsm_events
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query);
    return result.rows.map(row => this.rowToEvent(row));
  }

  private rowToEvent(row: any): PersistedEvent {
    return {
      id: row.id,
      instanceId: row.instance_id,
      machineName: row.machine_name,
      componentName: row.component_name,
      event: {
        type: row.event_type,
        payload: JSON.parse(row.event_payload),
        timestamp: row.persisted_at,
      },
      stateBefore: row.state_before,
      stateAfter: row.state_after,
      persistedAt: row.persisted_at,
      causedBy: row.caused_by,
      caused: row.caused,
      sourceComponentName: row.source_component_name,
      targetComponentName: row.target_component_name,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class PostgreSQLSnapshotStore implements SnapshotStore {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async saveSnapshot(snapshot: InstanceSnapshot): Promise<void> {
    const query = `
      INSERT INTO fsm_snapshots (
        instance_id, machine_name, current_state, status,
        context, public_member, snapshot_at, last_event_id,
        pending_timeouts, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (instance_id)
      DO UPDATE SET
        current_state = $3,
        status = $4,
        context = $5,
        public_member = $6,
        snapshot_at = $7,
        last_event_id = $8,
        pending_timeouts = $9,
        updated_at = CURRENT_TIMESTAMP
    `;

    await this.pool.query(query, [
      snapshot.instance.id,
      snapshot.instance.machineName,
      snapshot.instance.currentState,
      snapshot.instance.status,
      JSON.stringify(snapshot.instance.context),
      snapshot.instance.publicMember ? JSON.stringify(snapshot.instance.publicMember) : null,
      snapshot.snapshotAt,
      snapshot.lastEventId,
      snapshot.pendingTimeouts ? JSON.stringify(snapshot.pendingTimeouts) : null,
    ]);
  }

  async getSnapshot(instanceId: string): Promise<InstanceSnapshot | null> {
    const query = `
      SELECT * FROM fsm_snapshots
      WHERE instance_id = $1
    `;

    const result = await this.pool.query(query, [instanceId]);
    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      instance: {
        id: row.instance_id,
        machineName: row.machine_name,
        currentState: row.current_state,
        status: row.status,
        context: JSON.parse(row.context),
        publicMember: row.public_member ? JSON.parse(row.public_member) : undefined,
        createdAt: 0, // Not stored
        updatedAt: 0, // Not stored
      },
      snapshotAt: row.snapshot_at,
      lastEventId: row.last_event_id,
      pendingTimeouts: row.pending_timeouts ? JSON.parse(row.pending_timeouts) : undefined,
    };
  }

  async getAllSnapshots(): Promise<InstanceSnapshot[]> {
    const query = `SELECT * FROM fsm_snapshots`;
    const result = await this.pool.query(query);

    return result.rows.map(row => ({
      instance: {
        id: row.instance_id,
        machineName: row.machine_name,
        currentState: row.current_state,
        status: row.status,
        context: JSON.parse(row.context),
        publicMember: row.public_member ? JSON.parse(row.public_member) : undefined,
        createdAt: 0,
        updatedAt: 0,
      },
      snapshotAt: row.snapshot_at,
      lastEventId: row.last_event_id,
      pendingTimeouts: row.pending_timeouts ? JSON.parse(row.pending_timeouts) : undefined,
    }));
  }

  async deleteSnapshot(instanceId: string): Promise<void> {
    const query = `DELETE FROM fsm_snapshots WHERE instance_id = $1`;
    await this.pool.query(query, [instanceId]);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

### Usage

```typescript
import { FSMRuntime } from './fsm-runtime';
import { PostgreSQLEventStore, PostgreSQLSnapshotStore } from './persistence/postgresql';

const connectionString = process.env.DATABASE_URL || 'postgresql://user:pass@localhost/xcomponent';

const eventStore = new PostgreSQLEventStore(connectionString);
const snapshotStore = new PostgreSQLSnapshotStore(connectionString);

const runtime = new FSMRuntime(component, {
  eventSourcing: true,
  snapshots: true,
  snapshotInterval: 50,
  eventStore,
  snapshotStore,
});
```

## MongoDB Implementation

Example MongoDB-backed persistence:

```typescript
import { MongoClient, Collection, Db } from 'mongodb';
import { EventStore, SnapshotStore, PersistedEvent, InstanceSnapshot } from './types';

export class MongoDBEventStore implements EventStore {
  private client: MongoClient;
  private db: Db | null = null;
  private events: Collection | null = null;

  constructor(private uri: string, private dbName: string = 'xcomponent') {}

  async connect(): Promise<void> {
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.events = this.db.collection('events');

    // Create indexes
    await this.events.createIndex({ instanceId: 1 });
    await this.events.createIndex({ componentName: 1 });
    await this.events.createIndex({ persistedAt: 1 });
    await this.events.createIndex({ 'causedBy': 1 });
  }

  async append(event: PersistedEvent): Promise<void> {
    await this.events!.insertOne({
      ...event,
      _id: event.id,
    });
  }

  async getEventsForInstance(instanceId: string): Promise<PersistedEvent[]> {
    const docs = await this.events!
      .find({ instanceId })
      .sort({ persistedAt: 1 })
      .toArray();

    return docs.map(doc => this.docToEvent(doc));
  }

  async getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]> {
    const docs = await this.events!
      .find({
        persistedAt: { $gte: startTime, $lte: endTime },
      })
      .sort({ persistedAt: 1 })
      .toArray();

    return docs.map(doc => this.docToEvent(doc));
  }

  async getCausedEvents(eventId: string): Promise<PersistedEvent[]> {
    const docs = await this.events!
      .find({ causedBy: eventId })
      .sort({ persistedAt: 1 })
      .toArray();

    return docs.map(doc => this.docToEvent(doc));
  }

  async getAllEvents(): Promise<PersistedEvent[]> {
    const docs = await this.events!
      .find({})
      .sort({ persistedAt: 1 })
      .toArray();

    return docs.map(doc => this.docToEvent(doc));
  }

  private docToEvent(doc: any): PersistedEvent {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest } as PersistedEvent;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

export class MongoDBSnapshotStore implements SnapshotStore {
  private client: MongoClient;
  private db: Db | null = null;
  private snapshots: Collection | null = null;

  constructor(private uri: string, private dbName: string = 'xcomponent') {}

  async connect(): Promise<void> {
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.snapshots = this.db.collection('snapshots');

    // Create index
    await this.snapshots.createIndex({ 'instance.id': 1 }, { unique: true });
  }

  async saveSnapshot(snapshot: InstanceSnapshot): Promise<void> {
    await this.snapshots!.replaceOne(
      { 'instance.id': snapshot.instance.id },
      snapshot,
      { upsert: true }
    );
  }

  async getSnapshot(instanceId: string): Promise<InstanceSnapshot | null> {
    const doc = await this.snapshots!.findOne({ 'instance.id': instanceId });
    return doc as InstanceSnapshot | null;
  }

  async getAllSnapshots(): Promise<InstanceSnapshot[]> {
    const docs = await this.snapshots!.find({}).toArray();
    return docs as InstanceSnapshot[];
  }

  async deleteSnapshot(instanceId: string): Promise<void> {
    await this.snapshots!.deleteOne({ 'instance.id': instanceId });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
```

### Usage

```typescript
import { FSMRuntime } from './fsm-runtime';
import { MongoDBEventStore, MongoDBSnapshotStore } from './persistence/mongodb';

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017';

const eventStore = new MongoDBEventStore(mongoUri, 'xcomponent');
const snapshotStore = new MongoDBSnapshotStore(mongoUri, 'xcomponent');

await eventStore.connect();
await snapshotStore.connect();

const runtime = new FSMRuntime(component, {
  eventSourcing: true,
  snapshots: true,
  eventStore,
  snapshotStore,
});
```

## Cross-Component Traceability

xcomponent-ai supports tracing events across component boundaries:

### Component Name Tracking

All persisted events include the component name:

```typescript
interface PersistedEvent {
  id: string;
  instanceId: string;
  machineName: string;
  componentName: string;  // Component where event occurred
  // ...
  sourceComponentName?: string;  // Optional: source component
  targetComponentName?: string;  // Optional: target component
}
```

### Tracing Across Components

Use ComponentRegistry for cross-component traceability:

```typescript
import { ComponentRegistry } from './component-registry';

const registry = new ComponentRegistry();

// Register components
registry.registerComponent(orderComponent, orderRuntime);
registry.registerComponent(inventoryComponent, inventoryRuntime);
registry.registerComponent(shippingComponent, shippingRuntime);

// Get all events across components
const allEvents = await registry.getAllPersistedEvents();

// Trace causality chain across components
const causalityChain = await registry.traceEventAcrossComponents(rootEventId);

// Find instance regardless of component
const result = registry.findInstance(instanceId);
```

### API Endpoints

The API server exposes cross-component traceability endpoints:

```bash
# Trace event causality across all components
GET /api/cross-component/causality/:eventId

# Get all events from all components
GET /api/cross-component/events

# Get instance history (searches all components)
GET /api/cross-component/instance/:instanceId/history
```

## Best Practices

### 1. **Event Store Selection**

- **Development**: Use `InMemoryEventStore`
- **Production**: Use PostgreSQL, MongoDB, or similar
- **High Volume**: Consider time-series databases (TimescaleDB, InfluxDB)

### 2. **Snapshot Frequency**

Balance between restoration speed and storage:

```typescript
const runtime = new FSMRuntime(component, {
  snapshots: true,
  snapshotInterval: 50,  // Snapshot every 50 transitions
});
```

- **Low-frequency transitions**: Lower interval (10-20)
- **High-frequency transitions**: Higher interval (50-100)
- **Long-running workflows**: Lower interval for faster recovery

### 3. **Event Retention**

Implement retention policies to manage storage:

```typescript
// Delete events older than 90 days
const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

const oldEvents = await eventStore.getEventsByTimeRange(0, ninetyDaysAgo);
// Archive or delete old events
```

### 4. **Backup Strategy**

Regular backups of event and snapshot stores:

```bash
# PostgreSQL backup
pg_dump -t fsm_events -t fsm_snapshots dbname > backup.sql

# MongoDB backup
mongodump --db=xcomponent --collection=events --out=backup/
mongodump --db=xcomponent --collection=snapshots --out=backup/
```

### 5. **Disaster Recovery**

Restore from snapshots + replay events:

```typescript
// 1. Get latest snapshot
const snapshot = await snapshotStore.getSnapshot(instanceId);

// 2. Restore instance from snapshot
const runtime = new FSMRuntime(component, persistenceConfig);
await runtime.restoreFromSnapshot(snapshot);

// 3. Replay events after snapshot
const events = await eventStore.getEventsAfterSnapshot(
  instanceId,
  snapshot.lastEventId
);

for (const event of events) {
  await runtime.sendEvent(instanceId, event.event);
}
```

### 6. **Monitoring**

Monitor event store health:

```typescript
// Track event append latency
const start = Date.now();
await eventStore.append(event);
const latency = Date.now() - start;

// Alert if latency > threshold
if (latency > 100) {
  console.warn(`High event store latency: ${latency}ms`);
}
```

### 7. **Connection Pooling**

Use connection pools for databases:

```typescript
// PostgreSQL with pooling
const pool = new Pool({
  connectionString,
  max: 20,                  // Max connections
  idleTimeoutMillis: 30000, // Close idle connections
  connectionTimeoutMillis: 2000,
});
```

### 8. **Cross-Component Shared Stores**

For cross-component traceability, use shared event stores:

```typescript
const sharedEventStore = new PostgreSQLEventStore(connectionString);
const sharedSnapshotStore = new PostgreSQLSnapshotStore(connectionString);

// All components use same stores
const orderRuntime = new FSMRuntime(orderComponent, {
  eventStore: sharedEventStore,
  snapshotStore: sharedSnapshotStore,
});

const inventoryRuntime = new FSMRuntime(inventoryComponent, {
  eventStore: sharedEventStore,
  snapshotStore: sharedSnapshotStore,
});
```

This enables system-wide event tracing and causality analysis.

## Environment Variables

Recommended environment variable configuration:

```bash
# Database connection
DATABASE_URL=postgresql://user:pass@localhost:5432/xcomponent
MONGO_URI=mongodb://localhost:27017

# Persistence settings
EVENT_SOURCING_ENABLED=true
SNAPSHOTS_ENABLED=true
SNAPSHOT_INTERVAL=50

# Retention
EVENT_RETENTION_DAYS=90
SNAPSHOT_RETENTION_COUNT=10
```

## Further Reading

- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)
- [CQRS and Event Sourcing](https://docs.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [PostgreSQL Best Practices](https://wiki.postgresql.org/wiki/Tuning_Your_PostgreSQL_Server)
- [MongoDB Performance](https://docs.mongodb.com/manual/administration/analyzing-mongodb-performance/)
