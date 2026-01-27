/**
 * Persistence implementations for event sourcing and state restoration
 * Phase 4: Event sourcing, snapshots, and long-running workflows
 */

import { EventStore, SnapshotStore, PersistedEvent, InstanceSnapshot } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory event store implementation
 * For testing and development - replace with database in production
 */
export class InMemoryEventStore implements EventStore {
  private events: PersistedEvent[] = [];
  private eventMap: Map<string, PersistedEvent> = new Map();

  async append(event: PersistedEvent): Promise<void> {
    this.events.push(event);
    this.eventMap.set(event.id, event);
  }

  async getEventsForInstance(instanceId: string): Promise<PersistedEvent[]> {
    return this.events.filter(e => e.instanceId === instanceId);
  }

  async getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]> {
    return this.events.filter(e => e.persistedAt >= startTime && e.persistedAt <= endTime);
  }

  async getCausedEvents(eventId: string): Promise<PersistedEvent[]> {
    const causedIds = this.eventMap.get(eventId)?.caused || [];
    return causedIds.map(id => this.eventMap.get(id)).filter(e => e !== undefined) as PersistedEvent[];
  }

  async getAllEvents(): Promise<PersistedEvent[]> {
    return [...this.events];
  }

  /**
   * Get events for tracing causality chain
   */
  async traceEvent(eventId: string): Promise<PersistedEvent[]> {
    const result: PersistedEvent[] = [];
    const visited = new Set<string>();

    const trace = async (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const event = this.eventMap.get(id);
      if (!event) return;

      result.push(event);

      // Trace caused events recursively
      if (event.caused && event.caused.length > 0) {
        for (const causedId of event.caused) {
          await trace(causedId);
        }
      }
    };

    await trace(eventId);
    return result;
  }
}

/**
 * In-memory snapshot store implementation
 * For testing and development - replace with database in production
 */
export class InMemorySnapshotStore implements SnapshotStore {
  private snapshots: Map<string, InstanceSnapshot> = new Map();

  async saveSnapshot(snapshot: InstanceSnapshot): Promise<void> {
    this.snapshots.set(snapshot.instance.id, snapshot);
  }

  async getSnapshot(instanceId: string): Promise<InstanceSnapshot | null> {
    return this.snapshots.get(instanceId) || null;
  }

  async getAllSnapshots(): Promise<InstanceSnapshot[]> {
    return Array.from(this.snapshots.values());
  }

  async deleteSnapshot(instanceId: string): Promise<void> {
    this.snapshots.delete(instanceId);
  }
}

/**
 * Persistence manager for FSM runtime
 * Handles event sourcing, snapshots, and restoration
 */
export class PersistenceManager {
  private eventStore: EventStore;
  private snapshotStore: SnapshotStore;
  private eventSourcingEnabled: boolean;
  private snapshotsEnabled: boolean;
  private snapshotInterval: number;
  private transitionCounts: Map<string, number> = new Map();
  private currentEventId: string | null = null;

  constructor(
    eventStore: EventStore,
    snapshotStore: SnapshotStore,
    options: {
      eventSourcing?: boolean;
      snapshots?: boolean;
      snapshotInterval?: number;
    } = {}
  ) {
    this.eventStore = eventStore;
    this.snapshotStore = snapshotStore;
    this.eventSourcingEnabled = options.eventSourcing !== false; // Default: enabled
    this.snapshotsEnabled = options.snapshots !== false; // Default: enabled
    this.snapshotInterval = options.snapshotInterval || 10; // Snapshot every 10 transitions
  }

  /**
   * Set current event ID for causality tracking
   */
  setCurrentEventId(eventId: string | null) {
    this.currentEventId = eventId;
  }

  /**
   * Get current event ID
   */
  getCurrentEventId(): string | null {
    return this.currentEventId;
  }

  /**
   * Persist event with causality tracking
   */
  async persistEvent(
    instanceId: string,
    machineName: string,
    componentName: string,
    event: import('./types').FSMEvent,
    stateBefore: string,
    stateAfter: string,
    causedBy?: string[],
    sourceComponentName?: string,
    targetComponentName?: string
  ): Promise<string> {
    if (!this.eventSourcingEnabled) {
      return '';
    }

    const eventId = uuidv4();

    const persistedEvent: PersistedEvent = {
      id: eventId,
      instanceId,
      machineName,
      componentName,
      event,
      stateBefore,
      stateAfter,
      persistedAt: Date.now(),
      causedBy: causedBy || (this.currentEventId ? [this.currentEventId] : undefined),
      caused: [],
      sourceComponentName,
      targetComponentName,
    };

    await this.eventStore.append(persistedEvent);

    // Update causality chain: mark parent event as causing this one
    if (this.currentEventId) {
      const parentEvents = await this.eventStore.getAllEvents();
      const parentEvent = parentEvents.find(e => e.id === this.currentEventId);
      if (parentEvent) {
        if (!parentEvent.caused) {
          parentEvent.caused = [];
        }
        parentEvent.caused.push(eventId);
      }
    }

    return eventId;
  }

  /**
   * Save snapshot if interval reached
   */
  async maybeSnapshot(
    instance: import('./types').FSMInstance,
    lastEventId: string,
    pendingTimeouts?: Map<string, NodeJS.Timeout>
  ): Promise<void> {
    if (!this.snapshotsEnabled) {
      return;
    }

    // Increment transition count
    const count = (this.transitionCounts.get(instance.id) || 0) + 1;
    this.transitionCounts.set(instance.id, count);

    // Snapshot every N transitions
    if (count % this.snapshotInterval === 0) {
      await this.saveSnapshot(instance, lastEventId, pendingTimeouts);
    }
  }

  /**
   * Save snapshot explicitly
   */
  async saveSnapshot(
    instance: import('./types').FSMInstance,
    lastEventId: string,
    pendingTimeouts?: Map<string, NodeJS.Timeout>
  ): Promise<void> {
    if (!this.snapshotsEnabled) {
      return;
    }

    // Calculate pending timeouts (for restoration after restart)
    const timeoutData: Array<{ stateKey: string; eventType: string; remainingMs: number }> = [];

    if (pendingTimeouts) {
      // Note: In real implementation, we'd need to track when timeouts were created
      // For now, we'll just mark them as pending
      for (const [stateKey] of pendingTimeouts.entries()) {
        // Extract event type from state key (format: "instanceId-stateName" or "instanceId-stateName-auto")
        timeoutData.push({
          stateKey,
          eventType: 'TIMEOUT',
          remainingMs: 0, // Would need to calculate from creation time
        });
      }
    }

    const snapshot: InstanceSnapshot = {
      instance: { ...instance }, // Deep copy
      snapshotAt: Date.now(),
      lastEventId,
      pendingTimeouts: timeoutData.length > 0 ? timeoutData : undefined,
    };

    await this.snapshotStore.saveSnapshot(snapshot);
  }

  /**
   * Restore instance from snapshot
   */
  async restoreInstance(instanceId: string): Promise<InstanceSnapshot | null> {
    if (!this.snapshotsEnabled) {
      return null;
    }

    return await this.snapshotStore.getSnapshot(instanceId);
  }

  /**
   * Get all snapshots for full system restore
   */
  async getAllSnapshots(): Promise<InstanceSnapshot[]> {
    if (!this.snapshotsEnabled) {
      return [];
    }

    return await this.snapshotStore.getAllSnapshots();
  }

  /**
   * Get events for instance (for replay or audit)
   */
  async getInstanceEvents(instanceId: string): Promise<PersistedEvent[]> {
    if (!this.eventSourcingEnabled) {
      return [];
    }

    return await this.eventStore.getEventsForInstance(instanceId);
  }

  /**
   * Get all events (for cross-component tracing)
   */
  async getAllEvents(): Promise<PersistedEvent[]> {
    if (!this.eventSourcingEnabled) {
      return [];
    }

    return await this.eventStore.getAllEvents();
  }

  /**
   * Trace causality chain from a specific event
   */
  async traceEventCausality(eventId: string): Promise<PersistedEvent[]> {
    if (!this.eventSourcingEnabled) {
      return [];
    }

    if (this.eventStore instanceof InMemoryEventStore) {
      return await this.eventStore.traceEvent(eventId);
    }

    // Fallback: manual tracing
    const result: PersistedEvent[] = [];
    const visited = new Set<string>();

    const trace = async (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const events = await this.eventStore.getAllEvents();
      const event = events.find(e => e.id === id);
      if (!event) return;

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

  /**
   * Get event store (for testing/inspection)
   */
  getEventStore(): EventStore {
    return this.eventStore;
  }

  /**
   * Get snapshot store (for testing/inspection)
   */
  getSnapshotStore(): SnapshotStore {
    return this.snapshotStore;
  }
}
