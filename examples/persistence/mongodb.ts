/**
 * MongoDB Persistence Implementation for xcomponent-ai
 *
 * This example shows how to implement EventStore and SnapshotStore
 * backed by MongoDB for production use.
 *
 * Prerequisites:
 *   npm install mongodb
 *
 * Usage:
 *   import { MongoDBEventStore, MongoDBSnapshotStore } from './examples/persistence/mongodb';
 *
 *   const eventStore = new MongoDBEventStore(process.env.MONGO_URI);
 *   const snapshotStore = new MongoDBSnapshotStore(process.env.MONGO_URI);
 *
 *   await eventStore.connect();
 *   await snapshotStore.connect();
 *
 *   const runtime = new FSMRuntime(component, {
 *     eventSourcing: true,
 *     snapshots: true,
 *     eventStore,
 *     snapshotStore,
 *   });
 */

import { MongoClient, Collection, Db } from 'mongodb';
import { EventStore, SnapshotStore, PersistedEvent, InstanceSnapshot } from '../../src/types';

/**
 * MongoDB Event Store
 *
 * Stores all FSM events in MongoDB with full causality tracking
 * and cross-component support.
 */
export class MongoDBEventStore implements EventStore {
  private client: MongoClient;
  private db: Db | null = null;
  private events: Collection | null = null;

  constructor(private uri: string, private dbName: string = 'xcomponent') {}

  /**
   * Connect to MongoDB and create indexes
   */
  async connect(): Promise<void> {
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.events = this.db.collection('events');

    // Create indexes for performance
    await this.events.createIndex({ instanceId: 1 });
    await this.events.createIndex({ componentName: 1 });
    await this.events.createIndex({ machineName: 1 });
    await this.events.createIndex({ persistedAt: 1 });
    await this.events.createIndex({ causedBy: 1 });

    console.log('✓ MongoDB EventStore connected and indexed');
  }

  /**
   * Append event to store
   */
  async append(event: PersistedEvent): Promise<void> {
    await this.events!.insertOne({
      _id: event.id,
      ...event,
    });
  }

  /**
   * Get all events for a specific instance
   */
  async getEventsForInstance(instanceId: string): Promise<PersistedEvent[]> {
    const docs = await this.events!
      .find({ instanceId })
      .sort({ persistedAt: 1 })
      .toArray();

    return docs.map(doc => this.docToEvent(doc));
  }

  /**
   * Get events within time range
   */
  async getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]> {
    const docs = await this.events!
      .find({
        persistedAt: { $gte: startTime, $lte: endTime },
      })
      .sort({ persistedAt: 1 })
      .toArray();

    return docs.map(doc => this.docToEvent(doc));
  }

  /**
   * Get events caused by a specific event (causality)
   */
  async getCausedEvents(eventId: string): Promise<PersistedEvent[]> {
    const docs = await this.events!
      .find({ causedBy: eventId })
      .sort({ persistedAt: 1 })
      .toArray();

    return docs.map(doc => this.docToEvent(doc));
  }

  /**
   * Get all events (for backup/export)
   */
  async getAllEvents(): Promise<PersistedEvent[]> {
    const docs = await this.events!
      .find({})
      .sort({ persistedAt: 1 })
      .toArray();

    return docs.map(doc => this.docToEvent(doc));
  }

  /**
   * Convert MongoDB document to PersistedEvent
   */
  private docToEvent(doc: any): PersistedEvent {
    const { _id, ...rest } = doc;
    return { id: _id, ...rest } as PersistedEvent;
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * MongoDB Snapshot Store
 *
 * Stores FSM instance snapshots for fast state restoration
 * without replaying all events.
 */
export class MongoDBSnapshotStore implements SnapshotStore {
  private client: MongoClient;
  private db: Db | null = null;
  private snapshots: Collection | null = null;

  constructor(private uri: string, private dbName: string = 'xcomponent') {}

  /**
   * Connect to MongoDB and create indexes
   */
  async connect(): Promise<void> {
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.snapshots = this.db.collection('snapshots');

    // Create unique index on instance ID
    await this.snapshots.createIndex({ 'instance.id': 1 }, { unique: true });

    console.log('✓ MongoDB SnapshotStore connected and indexed');
  }

  /**
   * Save instance snapshot
   */
  async saveSnapshot(snapshot: InstanceSnapshot): Promise<void> {
    await this.snapshots!.replaceOne(
      { 'instance.id': snapshot.instance.id },
      {
        ...snapshot,
        updatedAt: Date.now(),
      },
      { upsert: true }
    );
  }

  /**
   * Get latest snapshot for instance
   */
  async getSnapshot(instanceId: string): Promise<InstanceSnapshot | null> {
    const doc = await this.snapshots!.findOne({ 'instance.id': instanceId });
    if (!doc) {
      return null;
    }

    const { _id, updatedAt, ...snapshot } = doc;
    return snapshot as InstanceSnapshot;
  }

  /**
   * Get all snapshots (for backup/export)
   */
  async getAllSnapshots(): Promise<InstanceSnapshot[]> {
    const docs = await this.snapshots!.find({}).toArray();
    return docs.map(doc => {
      const { _id, updatedAt, ...snapshot } = doc;
      return snapshot as InstanceSnapshot;
    });
  }

  /**
   * Delete snapshot
   */
  async deleteSnapshot(instanceId: string): Promise<void> {
    await this.snapshots!.deleteOne({ 'instance.id': instanceId });
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Initialize MongoDB with optimal settings
 *
 * Optional: Run this to ensure collections and indexes exist
 */
export async function initializeMongoDB(uri: string, dbName: string = 'xcomponent'): Promise<void> {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);

    // Create events collection with validation
    try {
      await db.createCollection('events', {
        validator: {
          $jsonSchema: {
            bsonType: 'object',
            required: ['_id', 'instanceId', 'machineName', 'componentName', 'persistedAt'],
            properties: {
              _id: { bsonType: 'string' },
              instanceId: { bsonType: 'string' },
              machineName: { bsonType: 'string' },
              componentName: { bsonType: 'string' },
              persistedAt: { bsonType: 'long' },
            },
          },
        },
      });
    } catch (e) {
      // Collection may already exist
    }

    // Create indexes
    const events = db.collection('events');
    await events.createIndex({ instanceId: 1 });
    await events.createIndex({ componentName: 1 });
    await events.createIndex({ machineName: 1 });
    await events.createIndex({ persistedAt: 1 });
    await events.createIndex({ causedBy: 1 });

    // Create snapshots collection
    try {
      await db.createCollection('snapshots');
    } catch (e) {
      // Collection may already exist
    }

    const snapshots = db.collection('snapshots');
    await snapshots.createIndex({ 'instance.id': 1 }, { unique: true });

    console.log('✓ MongoDB initialized successfully');
  } finally {
    await client.close();
  }
}
