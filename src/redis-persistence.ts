/**
 * Redis Persistence Stores
 *
 * Event store and snapshot store using Redis.
 * Uses Redis Hashes for snapshots and Sorted Sets for events (ordered by timestamp).
 *
 * This allows Redis to serve as BOTH message bus AND persistence layer,
 * eliminating the need for PostgreSQL in simpler deployments.
 *
 * Data model:
 * - Events:   ZSET  "fsm:events:{instanceId}"  → score=persistedAt, member=JSON(event)
 *             ZSET  "fsm:events:all"            → score=persistedAt, member=JSON(event)
 *             HASH  "fsm:event:{eventId}"       → full event data (for causality lookups)
 * - Snapshots: HASH "fsm:snapshot:{instanceId}" → instance fields
 *              SET  "fsm:snapshots:all"          → set of instanceIds
 */

import { EventStore, SnapshotStore, PersistedEvent, InstanceSnapshot } from './types';

/**
 * Redis connection configuration
 */
export interface RedisConfig {
  /** Redis connection URL (e.g., redis://localhost:6379) */
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  database?: number;
  /** Key prefix (default: "fsm") */
  keyPrefix?: string;
}

/**
 * Redis Event Store
 *
 * Stores events in sorted sets keyed by instance ID, sorted by persistedAt timestamp.
 * Also maintains a global sorted set for time-range queries and individual hashes
 * for causality lookups.
 */
export class RedisEventStore implements EventStore {
  private client: any;
  private config: RedisConfig;
  private prefix: string;
  private initialized = false;

  constructor(config: RedisConfig) {
    this.config = config;
    this.prefix = config.keyPrefix || 'fsm';
  }

  /**
   * Initialize Redis connection
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const redis = await import('redis' as any);
      const createClient = redis.createClient || redis.default?.createClient;

      if (!createClient) {
        throw new Error('redis createClient not found');
      }

      const url = this.config.url ||
        `redis://${this.config.host || 'localhost'}:${this.config.port || 6379}/${this.config.database || 0}`;

      this.client = createClient({ url });
      await this.client.connect();
      this.initialized = true;

      console.log('[RedisEventStore] Connected and initialized');
    } catch (error) {
      throw new Error(
        `Failed to connect to Redis. ` +
        'Make sure Redis is running and the "redis" package is installed (npm install redis). ' +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private key(...parts: string[]): string {
    return [this.prefix, ...parts].join(':');
  }

  async append(event: PersistedEvent): Promise<void> {
    if (!this.initialized) await this.initialize();

    const serialized = JSON.stringify(event);

    // Store in instance-specific sorted set (score = persistedAt)
    await this.client.zAdd(this.key('events', event.instanceId), {
      score: event.persistedAt,
      value: serialized,
    });

    // Store in global sorted set for time-range queries
    await this.client.zAdd(this.key('events', 'all'), {
      score: event.persistedAt,
      value: serialized,
    });

    // Store individual event hash for causality lookups
    await this.client.set(this.key('event', event.id), serialized);
  }

  async getEventsForInstance(instanceId: string): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    const results = await this.client.zRangeByScore(
      this.key('events', instanceId),
      '-inf',
      '+inf'
    );

    return results.map((r: string) => JSON.parse(r) as PersistedEvent);
  }

  async getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    const results = await this.client.zRangeByScore(
      this.key('events', 'all'),
      startTime,
      endTime
    );

    return results.map((r: string) => JSON.parse(r) as PersistedEvent);
  }

  async getCausedEvents(eventId: string): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    // Get the source event to find its "caused" list
    const eventData = await this.client.get(this.key('event', eventId));
    if (!eventData) return [];

    const event: PersistedEvent = JSON.parse(eventData);
    const causedIds = event.caused || [];

    const results: PersistedEvent[] = [];
    for (const id of causedIds) {
      const data = await this.client.get(this.key('event', id));
      if (data) {
        results.push(JSON.parse(data));
      }
    }

    return results;
  }

  async getAllEvents(): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    const results = await this.client.zRange(
      this.key('events', 'all'),
      0,
      9999 // limit to 10000
    );

    return results.map((r: string) => JSON.parse(r) as PersistedEvent);
  }

  /**
   * Trace causality chain from a given event
   */
  async traceEvent(eventId: string): Promise<PersistedEvent[]> {
    if (!this.initialized) await this.initialize();

    const result: PersistedEvent[] = [];
    const visited = new Set<string>();

    const trace = async (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const data = await this.client.get(this.key('event', id));
      if (!data) return;

      const event: PersistedEvent = JSON.parse(data);
      result.push(event);

      if (event.caused && event.caused.length > 0) {
        for (const causedId of event.caused) {
          await trace(causedId);
        }
      }
    };

    await trace(eventId);
    return result;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
  }
}

/**
 * Redis Snapshot Store
 *
 * Stores instance snapshots as Redis Hashes.
 * Maintains a set of all snapshot instance IDs for enumeration.
 */
export class RedisSnapshotStore implements SnapshotStore {
  private client: any;
  private config: RedisConfig;
  private prefix: string;
  private initialized = false;

  constructor(config: RedisConfig) {
    this.config = config;
    this.prefix = config.keyPrefix || 'fsm';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const redis = await import('redis' as any);
      const createClient = redis.createClient || redis.default?.createClient;

      if (!createClient) {
        throw new Error('redis createClient not found');
      }

      const url = this.config.url ||
        `redis://${this.config.host || 'localhost'}:${this.config.port || 6379}/${this.config.database || 0}`;

      this.client = createClient({ url });
      await this.client.connect();
      this.initialized = true;

      console.log('[RedisSnapshotStore] Connected and initialized');
    } catch (error) {
      throw new Error(
        `Failed to connect to Redis. ` +
        'Make sure Redis is running and the "redis" package is installed. ' +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private key(...parts: string[]): string {
    return [this.prefix, ...parts].join(':');
  }

  async saveSnapshot(snapshot: InstanceSnapshot): Promise<void> {
    if (!this.initialized) await this.initialize();

    const serialized = JSON.stringify(snapshot);
    const instanceId = snapshot.instance.id;

    // Store snapshot as a single JSON string
    await this.client.set(this.key('snapshot', instanceId), serialized);

    // Track in the set of all snapshots
    await this.client.sAdd(this.key('snapshots', 'all'), instanceId);
  }

  async getSnapshot(instanceId: string): Promise<InstanceSnapshot | null> {
    if (!this.initialized) await this.initialize();

    const data = await this.client.get(this.key('snapshot', instanceId));
    if (!data) return null;

    return JSON.parse(data) as InstanceSnapshot;
  }

  async getAllSnapshots(): Promise<InstanceSnapshot[]> {
    if (!this.initialized) await this.initialize();

    const instanceIds = await this.client.sMembers(this.key('snapshots', 'all'));
    const results: InstanceSnapshot[] = [];

    for (const id of instanceIds) {
      const data = await this.client.get(this.key('snapshot', id));
      if (data) {
        results.push(JSON.parse(data));
      }
    }

    return results;
  }

  async deleteSnapshot(instanceId: string): Promise<void> {
    if (!this.initialized) await this.initialize();

    await this.client.del(this.key('snapshot', instanceId));
    await this.client.sRem(this.key('snapshots', 'all'), instanceId);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
  }
}

/**
 * Create both Redis stores with the same configuration
 */
export async function createRedisStores(config: RedisConfig): Promise<{
  eventStore: RedisEventStore;
  snapshotStore: RedisSnapshotStore;
}> {
  const eventStore = new RedisEventStore(config);
  const snapshotStore = new RedisSnapshotStore(config);

  await eventStore.initialize();
  await snapshotStore.initialize();

  return { eventStore, snapshotStore };
}
