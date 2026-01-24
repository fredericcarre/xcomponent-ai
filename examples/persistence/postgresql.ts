/**
 * PostgreSQL Persistence Implementation for xcomponent-ai
 *
 * This example shows how to implement EventStore and SnapshotStore
 * backed by PostgreSQL for production use.
 *
 * Prerequisites:
 *   npm install pg @types/pg
 *
 * Usage:
 *   import { PostgreSQLEventStore, PostgreSQLSnapshotStore } from './examples/persistence/postgresql';
 *
 *   const eventStore = new PostgreSQLEventStore(process.env.DATABASE_URL);
 *   const snapshotStore = new PostgreSQLSnapshotStore(process.env.DATABASE_URL);
 *
 *   const runtime = new FSMRuntime(component, {
 *     eventSourcing: true,
 *     snapshots: true,
 *     eventStore,
 *     snapshotStore,
 *   });
 */

import { Pool, PoolClient } from 'pg';
import { EventStore, SnapshotStore, PersistedEvent, InstanceSnapshot } from '../../src/types';

/**
 * PostgreSQL Event Store
 *
 * Stores all FSM events in PostgreSQL with full causality tracking
 * and cross-component support.
 */
export class PostgreSQLEventStore implements EventStore {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 20, // Maximum connections
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  /**
   * Append event to store
   */
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

  /**
   * Get all events for a specific instance
   */
  async getEventsForInstance(instanceId: string): Promise<PersistedEvent[]> {
    const query = `
      SELECT * FROM fsm_events
      WHERE instance_id = $1
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [instanceId]);
    return result.rows.map(row => this.rowToEvent(row));
  }

  /**
   * Get events within time range
   */
  async getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]> {
    const query = `
      SELECT * FROM fsm_events
      WHERE persisted_at >= $1 AND persisted_at <= $2
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [startTime, endTime]);
    return result.rows.map(row => this.rowToEvent(row));
  }

  /**
   * Get events caused by a specific event (causality)
   */
  async getCausedEvents(eventId: string): Promise<PersistedEvent[]> {
    const query = `
      SELECT * FROM fsm_events
      WHERE $1 = ANY(caused_by)
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query, [eventId]);
    return result.rows.map(row => this.rowToEvent(row));
  }

  /**
   * Get all events (for backup/export)
   */
  async getAllEvents(): Promise<PersistedEvent[]> {
    const query = `
      SELECT * FROM fsm_events
      ORDER BY persisted_at ASC
    `;

    const result = await this.pool.query(query);
    return result.rows.map(row => this.rowToEvent(row));
  }

  /**
   * Convert database row to PersistedEvent
   */
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

  /**
   * Close database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * PostgreSQL Snapshot Store
 *
 * Stores FSM instance snapshots for fast state restoration
 * without replaying all events.
 */
export class PostgreSQLSnapshotStore implements SnapshotStore {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  /**
   * Save instance snapshot
   */
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

  /**
   * Get latest snapshot for instance
   */
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
        createdAt: 0, // Not stored in snapshot
        updatedAt: 0, // Not stored in snapshot
      },
      snapshotAt: row.snapshot_at,
      lastEventId: row.last_event_id,
      pendingTimeouts: row.pending_timeouts ? JSON.parse(row.pending_timeouts) : undefined,
    };
  }

  /**
   * Get all snapshots (for backup/export)
   */
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

  /**
   * Delete snapshot
   */
  async deleteSnapshot(instanceId: string): Promise<void> {
    const query = `DELETE FROM fsm_snapshots WHERE instance_id = $1`;
    await this.pool.query(query, [instanceId]);
  }

  /**
   * Close database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * Initialize PostgreSQL database schema
 *
 * Run this once to create the required tables and indexes.
 */
export async function initializeSchema(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString });

  try {
    // Create events table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fsm_events (
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
      )
    `);

    // Create indexes for events
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_instance ON fsm_events(instance_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_component ON fsm_events(component_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_machine ON fsm_events(machine_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON fsm_events(persisted_at)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_caused_by ON fsm_events USING GIN(caused_by)`);

    // Create snapshots table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fsm_snapshots (
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
      )
    `);

    console.log('✓ PostgreSQL schema initialized successfully');
  } finally {
    await pool.end();
  }
}
