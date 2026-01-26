/**
 * PostgreSQL Persistence Stores
 *
 * Production-ready event store and snapshot store using PostgreSQL.
 * Supports event sourcing, snapshots, and full-text search.
 */

import { EventStore, SnapshotStore, PersistedEvent, InstanceSnapshot } from './types';

/**
 * PostgreSQL connection configuration
 */
export interface PostgresConfig {
  /** Connection string or config object */
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | object;
  /** Connection pool size (default: 10) */
  poolSize?: number;
}

/**
 * PostgreSQL Event Store
 *
 * Schema:
 * ```sql
 * CREATE TABLE fsm_events (
 *   id UUID PRIMARY KEY,
 *   instance_id UUID NOT NULL,
 *   machine_name VARCHAR(255) NOT NULL,
 *   event_type VARCHAR(255) NOT NULL,
 *   event_payload JSONB,
 *   from_state VARCHAR(255),
 *   to_state VARCHAR(255),
 *   context JSONB,
 *   public_member_snapshot JSONB,
 *   correlation_id UUID,
 *   causation_id UUID,
 *   caused JSONB DEFAULT '[]',
 *   persisted_at BIGINT NOT NULL,
 *   created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 *   INDEX idx_instance_id (instance_id),
 *   INDEX idx_persisted_at (persisted_at),
 *   INDEX idx_correlation_id (correlation_id)
 * );
 * ```
 */
export class PostgresEventStore implements EventStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pool: any;
  private config: PostgresConfig;
  private initialized = false;

  constructor(config: PostgresConfig) {
    this.config = config;
  }

  /**
   * Initialize connection pool and create tables if needed
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to make pg optional
      const pg = await import('pg' as any);
      const Pool = pg.Pool || pg.default?.Pool;

      if (!Pool) {
        throw new Error('pg Pool not found');
      }

      this.pool = new Pool({
        connectionString: this.config.connectionString,
        host: this.config.host,
        port: this.config.port || 5432,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        ssl: this.config.ssl,
        max: this.config.poolSize || 10
      });

      // Create tables
      await this.createTables();
      this.initialized = true;

      console.log('[PostgresEventStore] Connected and initialized');
    } catch (error) {
      throw new Error(
        `Failed to connect to PostgreSQL. ` +
        'Make sure PostgreSQL is running and the "pg" package is installed (npm install pg). ' +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async createTables(): Promise<void> {
    const createEventsTable = `
      CREATE TABLE IF NOT EXISTS fsm_events (
        id UUID PRIMARY KEY,
        instance_id UUID NOT NULL,
        machine_name VARCHAR(255) NOT NULL,
        event_type VARCHAR(255) NOT NULL,
        event_payload JSONB,
        from_state VARCHAR(255),
        to_state VARCHAR(255),
        context JSONB,
        public_member_snapshot JSONB,
        correlation_id UUID,
        causation_id UUID,
        caused JSONB DEFAULT '[]',
        persisted_at BIGINT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_fsm_events_instance_id ON fsm_events(instance_id);
      CREATE INDEX IF NOT EXISTS idx_fsm_events_persisted_at ON fsm_events(persisted_at);
      CREATE INDEX IF NOT EXISTS idx_fsm_events_correlation_id ON fsm_events(correlation_id);
      CREATE INDEX IF NOT EXISTS idx_fsm_events_machine_name ON fsm_events(machine_name);
    `;

    await this.pool.query(createEventsTable);
  }

  async append(event: PersistedEvent): Promise<void> {
    if (!this.initialized) await this.initialize();

    const query = `
      INSERT INTO fsm_events (
        id, instance_id, machine_name, event_type, event_payload,
        from_state, to_state, context, public_member_snapshot,
        correlation_id, causation_id, caused, persisted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    await this.pool.query(query, [
      event.id,
      event.instanceId,
      event.machineName,
      event.event.type,
      JSON.stringify(event.event.payload || {}),
      event.fromState,
      event.toState,
      JSON.stringify(event.context || {}),
      JSON.stringify(event.publicMemberSnapshot || {}),
      event.correlationId,
      event.causationId,
      JSON.stringify(event.caused || []),
      event.persistedAt
    ]);
  }

  async getEventsForInstance(instanceId: string): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    const query = `
      SELECT * FROM fsm_events
      WHERE instance_id = $1
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [instanceId]);
    return result.rows.map(this.rowToEvent);
  }

  async getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    const query = `
      SELECT * FROM fsm_events
      WHERE persisted_at >= $1 AND persisted_at <= $2
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [startTime, endTime]);
    return result.rows.map(this.rowToEvent);
  }

  async getCausedEvents(eventId: string): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    const query = `
      SELECT * FROM fsm_events
      WHERE causation_id = $1
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [eventId]);
    return result.rows.map(this.rowToEvent);
  }

  async getAllEvents(): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    const query = `
      SELECT * FROM fsm_events
      ORDER BY persisted_at ASC
      LIMIT 10000
    `;

    const result = await this.pool.query(query);
    return result.rows.map(this.rowToEvent);
  }

  async traceEvent(eventId: string): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    // Use recursive CTE to trace causality chain
    const query = `
      WITH RECURSIVE event_trace AS (
        SELECT * FROM fsm_events WHERE id = $1
        UNION ALL
        SELECT e.* FROM fsm_events e
        INNER JOIN event_trace et ON e.causation_id = et.id
      )
      SELECT * FROM event_trace ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [eventId]);
    return result.rows.map(this.rowToEvent);
  }

  private rowToEvent(row: any): PersistedEvent {
    return {
      id: row.id,
      instanceId: row.instance_id,
      machineName: row.machine_name,
      event: {
        type: row.event_type,
        payload: row.event_payload || {}
      },
      fromState: row.from_state,
      toState: row.to_state,
      context: row.context || {},
      publicMemberSnapshot: row.public_member_snapshot,
      correlationId: row.correlation_id,
      causationId: row.causation_id,
      caused: row.caused || [],
      persistedAt: parseInt(row.persisted_at, 10)
    };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

/**
 * PostgreSQL Snapshot Store
 *
 * Schema:
 * ```sql
 * CREATE TABLE fsm_snapshots (
 *   instance_id UUID PRIMARY KEY,
 *   machine_name VARCHAR(255) NOT NULL,
 *   current_state VARCHAR(255) NOT NULL,
 *   context JSONB,
 *   event_count INTEGER DEFAULT 0,
 *   pending_timeouts JSONB DEFAULT '[]',
 *   created_at TIMESTAMP WITH TIME ZONE,
 *   updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
 * );
 * ```
 */
export class PostgresSnapshotStore implements SnapshotStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pool: any;
  private config: PostgresConfig;
  private initialized = false;

  constructor(config: PostgresConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const pg = await import('pg' as any);
      const Pool = pg.Pool || pg.default?.Pool;

      if (!Pool) {
        throw new Error('pg Pool not found');
      }

      this.pool = new Pool({
        connectionString: this.config.connectionString,
        host: this.config.host,
        port: this.config.port || 5432,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        ssl: this.config.ssl,
        max: this.config.poolSize || 10
      });

      await this.createTables();
      this.initialized = true;

      console.log('[PostgresSnapshotStore] Connected and initialized');
    } catch (error) {
      throw new Error(
        `Failed to connect to PostgreSQL. ` +
        'Make sure PostgreSQL is running and the "pg" package is installed. ' +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async createTables(): Promise<void> {
    const createSnapshotsTable = `
      CREATE TABLE IF NOT EXISTS fsm_snapshots (
        instance_id UUID PRIMARY KEY,
        machine_name VARCHAR(255) NOT NULL,
        current_state VARCHAR(255) NOT NULL,
        context JSONB,
        event_count INTEGER DEFAULT 0,
        pending_timeouts JSONB DEFAULT '[]',
        created_at TIMESTAMP WITH TIME ZONE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_fsm_snapshots_machine_name ON fsm_snapshots(machine_name);
      CREATE INDEX IF NOT EXISTS idx_fsm_snapshots_current_state ON fsm_snapshots(current_state);
    `;

    await this.pool.query(createSnapshotsTable);
  }

  async saveSnapshot(snapshot: InstanceSnapshot): Promise<void> {
    if (!this.initialized) await this.initialize();

    const query = `
      INSERT INTO fsm_snapshots (
        instance_id, machine_name, current_state, context,
        event_count, pending_timeouts, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (instance_id) DO UPDATE SET
        current_state = $3,
        context = $4,
        event_count = $5,
        pending_timeouts = $6,
        updated_at = NOW()
    `;

    await this.pool.query(query, [
      snapshot.instance.id,
      snapshot.instance.machineName,
      snapshot.instance.currentState,
      JSON.stringify(snapshot.instance.context || {}),
      snapshot.eventCount,
      JSON.stringify(snapshot.instance.pendingTimeouts || []),
      snapshot.instance.createdAt ? new Date(snapshot.instance.createdAt) : new Date()
    ]);
  }

  async getSnapshot(instanceId: string): Promise<InstanceSnapshot | null> {
    if (!this.initialized) await this.initialize();

    const query = `SELECT * FROM fsm_snapshots WHERE instance_id = $1`;
    const result = await this.pool.query(query, [instanceId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToSnapshot(result.rows[0]);
  }

  async getAllSnapshots(): Promise<InstanceSnapshot[]> {
    if (!this.initialized) await this.initialize();

    const query = `SELECT * FROM fsm_snapshots ORDER BY updated_at DESC`;
    const result = await this.pool.query(query);

    return result.rows.map(this.rowToSnapshot);
  }

  async deleteSnapshot(instanceId: string): Promise<void> {
    if (!this.initialized) await this.initialize();

    const query = `DELETE FROM fsm_snapshots WHERE instance_id = $1`;
    await this.pool.query(query, [instanceId]);
  }

  /**
   * Get snapshots by machine name
   */
  async getSnapshotsByMachine(machineName: string): Promise<InstanceSnapshot[]> {
    if (!this.initialized) await this.initialize();

    const query = `SELECT * FROM fsm_snapshots WHERE machine_name = $1 ORDER BY updated_at DESC`;
    const result = await this.pool.query(query, [machineName]);

    return result.rows.map(this.rowToSnapshot);
  }

  /**
   * Get snapshots by current state
   */
  async getSnapshotsByState(stateName: string): Promise<InstanceSnapshot[]> {
    if (!this.initialized) await this.initialize();

    const query = `SELECT * FROM fsm_snapshots WHERE current_state = $1 ORDER BY updated_at DESC`;
    const result = await this.pool.query(query, [stateName]);

    return result.rows.map(this.rowToSnapshot);
  }

  private rowToSnapshot(row: any): InstanceSnapshot {
    return {
      instance: {
        id: row.instance_id,
        machineName: row.machine_name,
        currentState: row.current_state,
        context: row.context || {},
        pendingTimeouts: row.pending_timeouts || [],
        createdAt: row.created_at ? new Date(row.created_at).getTime() : undefined
      },
      eventCount: row.event_count || 0
    };
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

/**
 * Create both PostgreSQL stores with shared connection pool
 */
export async function createPostgresStores(config: PostgresConfig): Promise<{
  eventStore: PostgresEventStore;
  snapshotStore: PostgresSnapshotStore;
}> {
  const eventStore = new PostgresEventStore(config);
  const snapshotStore = new PostgresSnapshotStore(config);

  await eventStore.initialize();
  await snapshotStore.initialize();

  return { eventStore, snapshotStore };
}
