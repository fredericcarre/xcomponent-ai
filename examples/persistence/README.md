# Persistence Examples

This directory contains production-ready persistence implementations for xcomponent-ai.

## Available Implementations

### PostgreSQL
- **File**: `postgresql.ts`
- **Prerequisites**: `npm install pg @types/pg`
- **Use Case**: Relational databases, strong consistency, ACID transactions
- **Documentation**: See [PERSISTENCE.md](../../docs/PERSISTENCE.md#postgresql-implementation)

### MongoDB
- **File**: `mongodb.ts`
- **Prerequisites**: `npm install mongodb`
- **Use Case**: Document stores, flexible schemas, high scalability
- **Documentation**: See [PERSISTENCE.md](../../docs/PERSISTENCE.md#mongodb-implementation)

## Quick Start

### PostgreSQL Setup

1. **Install dependencies**:
   ```bash
   npm install pg @types/pg
   ```

2. **Create database schema**:
   ```bash
   psql -d your_database -f schema.sql
   ```

   Or use the initialization function:
   ```typescript
   import { initializeSchema } from './examples/persistence/postgresql';
   await initializeSchema(process.env.DATABASE_URL);
   ```

3. **Use in your application**:
   ```typescript
   import { FSMRuntime } from './src/fsm-runtime';
   import { PostgreSQLEventStore, PostgreSQLSnapshotStore } from './examples/persistence/postgresql';

   const eventStore = new PostgreSQLEventStore(process.env.DATABASE_URL);
   const snapshotStore = new PostgreSQLSnapshotStore(process.env.DATABASE_URL);

   const runtime = new FSMRuntime(component, {
     eventSourcing: true,
     snapshots: true,
     snapshotInterval: 50,
     eventStore,
     snapshotStore,
   });
   ```

### MongoDB Setup

1. **Install dependencies**:
   ```bash
   npm install mongodb
   ```

2. **Initialize MongoDB**:
   ```typescript
   import { initializeMongoDB } from './examples/persistence/mongodb';
   await initializeMongoDB(process.env.MONGO_URI, 'xcomponent');
   ```

3. **Use in your application**:
   ```typescript
   import { FSMRuntime } from './src/fsm-runtime';
   import { MongoDBEventStore, MongoDBSnapshotStore } from './examples/persistence/mongodb';

   const eventStore = new MongoDBEventStore(process.env.MONGO_URI, 'xcomponent');
   const snapshotStore = new MongoDBSnapshotStore(process.env.MONGO_URI, 'xcomponent');

   await eventStore.connect();
   await snapshotStore.connect();

   const runtime = new FSMRuntime(component, {
     eventSourcing: true,
     snapshots: true,
     snapshotInterval: 50,
     eventStore,
     snapshotStore,
   });
   ```

## Environment Variables

Create a `.env` file in your project root:

```bash
# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/xcomponent

# MongoDB
MONGO_URI=mongodb://localhost:27017

# Persistence Configuration
EVENT_SOURCING_ENABLED=true
SNAPSHOTS_ENABLED=true
SNAPSHOT_INTERVAL=50
```

## Production Considerations

### PostgreSQL

**Connection Pooling**:
```typescript
const eventStore = new PostgreSQLEventStore(DATABASE_URL);
// Uses pg.Pool internally with default settings:
// - max: 20 connections
// - idleTimeoutMillis: 30000
// - connectionTimeoutMillis: 2000
```

**Backups**:
```bash
# Backup events and snapshots
pg_dump -t fsm_events -t fsm_snapshots your_database > backup.sql

# Restore
psql -d your_database < backup.sql
```

**Monitoring**:
```sql
-- Check table sizes
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE tablename IN ('fsm_events', 'fsm_snapshots');

-- Check event counts by component
SELECT component_name, COUNT(*) as event_count
FROM fsm_events
GROUP BY component_name;

-- Check causality chains
SELECT
  id,
  component_name,
  array_length(caused, 1) as caused_count
FROM fsm_events
WHERE caused IS NOT NULL AND array_length(caused, 1) > 0;
```

### MongoDB

**Connection Options**:
```typescript
const client = new MongoClient(MONGO_URI, {
  maxPoolSize: 50,
  minPoolSize: 10,
  maxIdleTimeMS: 30000,
  serverSelectionTimeoutMS: 5000,
});
```

**Backups**:
```bash
# Backup events and snapshots
mongodump --uri="mongodb://localhost:27017" --db=xcomponent --out=backup/

# Restore
mongorestore --uri="mongodb://localhost:27017" backup/
```

**Monitoring**:
```javascript
// Check collection stats
db.events.stats()
db.snapshots.stats()

// Check event counts by component
db.events.aggregate([
  { $group: { _id: "$componentName", count: { $sum: 1 } } }
])

// Check causality chains
db.events.find({ "caused.0": { $exists: true } }).count()
```

## Cross-Component Persistence

For cross-component traceability, use shared stores across all components:

```typescript
import { ComponentRegistry } from './src/component-registry';
import { PostgreSQLEventStore, PostgreSQLSnapshotStore } from './examples/persistence/postgresql';

// Shared stores for all components
const sharedEventStore = new PostgreSQLEventStore(DATABASE_URL);
const sharedSnapshotStore = new PostgreSQLSnapshotStore(DATABASE_URL);

// Component registry
const registry = new ComponentRegistry();

// Create runtimes with shared stores
const orderRuntime = new FSMRuntime(orderComponent, {
  eventSourcing: true,
  snapshots: true,
  eventStore: sharedEventStore,
  snapshotStore: sharedSnapshotStore,
});

const inventoryRuntime = new FSMRuntime(inventoryComponent, {
  eventSourcing: true,
  snapshots: true,
  eventStore: sharedEventStore,
  snapshotStore: sharedSnapshotStore,
});

// Register components
orderRuntime.setRegistry(registry);
inventoryRuntime.setRegistry(registry);
registry.registerComponent(orderComponent, orderRuntime);
registry.registerComponent(inventoryComponent, inventoryRuntime);

// Now you can trace events across components
const allEvents = await registry.getAllPersistedEvents();
const causalityChain = await registry.traceEventAcrossComponents(eventId);
```

## Further Reading

- [Complete Persistence Documentation](../../docs/PERSISTENCE.md)
- [PostgreSQL Performance Tuning](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [MongoDB Best Practices](https://docs.mongodb.com/manual/administration/production-notes/)
- [Event Sourcing Pattern](https://martinfowler.com/eaaDev/EventSourcing.html)
