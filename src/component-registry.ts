/**
 * Component Registry for Cross-Component Communication
 *
 * Manages multiple FSMRuntimes (components) and enables communication
 * between them, reproducing XComponent's cross-component messaging pattern.
 *
 * Features:
 * - Register/unregister components
 * - Route events between components
 * - Broadcast across components
 * - Property-based routing across component boundaries
 * - Instance lookup across all components
 */

import { EventEmitter } from 'events';
import { FSMRuntime } from './fsm-runtime';
import { Component, FSMEvent, FSMInstance } from './types';
import { MessageBroker, InMemoryMessageBroker, CrossComponentMessage } from './message-broker';

export interface ComponentInfo {
  name: string;
  runtime: FSMRuntime;
  version: string;
  machineCount: number;
  instanceCount: number;
}

/**
 * ComponentRegistry manages multiple components and enables cross-component communication
 */
export class ComponentRegistry extends EventEmitter {
  private runtimes: Map<string, FSMRuntime>;
  private components: Map<string, Component>;
  private broker: MessageBroker;

  /**
   * Create a ComponentRegistry
   *
   * @param broker Message broker for cross-component communication (defaults to InMemoryMessageBroker)
   */
  constructor(broker?: MessageBroker) {
    super();
    this.runtimes = new Map();
    this.components = new Map();
    this.broker = broker || new InMemoryMessageBroker();
  }

  /**
   * Initialize the registry and connect the message broker
   */
  async initialize(): Promise<void> {
    await this.broker.connect();
  }

  /**
   * Register a component with its runtime
   *
   * @param component Component definition
   * @param runtime FSM runtime instance
   */
  registerComponent(component: Component, runtime: FSMRuntime): void {
    if (this.runtimes.has(component.name)) {
      throw new Error(`Component ${component.name} is already registered`);
    }

    this.runtimes.set(component.name, runtime);
    this.components.set(component.name, component);

    // Set registry reference in runtime for cross-component communication
    runtime.setRegistry(this);

    // Subscribe to messages for this component via message broker
    this.broker.subscribe(component.name, async (message: CrossComponentMessage) => {
      try {
        // Get all instances of the target machine in the target state
        const instances = runtime.getAllInstances().filter(
          inst =>
            inst.machineName === message.targetMachine &&
            inst.currentState === message.targetState
        );

        // Send event to each matching instance
        for (const instance of instances) {
          try {
            await runtime.sendEvent(instance.id, message.event);
          } catch (error) {
            this.emit('broadcast_error', {
              componentName: component.name,
              instanceId: instance.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        this.emit('message_error', {
          componentName: component.name,
          message,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // Forward runtime events
    this.forwardRuntimeEvents(component.name, runtime);

    this.emit('component_registered', {
      componentName: component.name,
      version: component.version,
      machineCount: component.stateMachines.length,
    });
  }

  /**
   * Unregister a component
   *
   * @param componentName Component name
   */
  unregisterComponent(componentName: string): void {
    const runtime = this.runtimes.get(componentName);
    if (!runtime) {
      throw new Error(`Component ${componentName} not found`);
    }

    // Cleanup runtime
    runtime.dispose();

    this.runtimes.delete(componentName);
    this.components.delete(componentName);

    this.emit('component_unregistered', { componentName });
  }

  /**
   * Get runtime for a component
   *
   * @param componentName Component name
   * @returns FSMRuntime or undefined
   */
  getRuntime(componentName: string): FSMRuntime | undefined {
    return this.runtimes.get(componentName);
  }

  /**
   * Get component definition
   *
   * @param componentName Component name
   * @returns Component or undefined
   */
  getComponent(componentName: string): Component | undefined {
    return this.components.get(componentName);
  }

  /**
   * Check if component is registered
   *
   * @param componentName Component name
   * @returns true if registered
   */
  hasComponent(componentName: string): boolean {
    return this.runtimes.has(componentName);
  }

  /**
   * Get all registered component names
   *
   * @returns Array of component names
   */
  getComponentNames(): string[] {
    return Array.from(this.runtimes.keys());
  }

  /**
   * Get component information
   *
   * @param componentName Component name
   * @returns Component info or undefined
   */
  getComponentInfo(componentName: string): ComponentInfo | undefined {
    const runtime = this.runtimes.get(componentName);
    const component = this.components.get(componentName);

    if (!runtime || !component) {
      return undefined;
    }

    return {
      name: component.name,
      runtime,
      version: component.version,
      machineCount: component.stateMachines.length,
      instanceCount: runtime.getAllInstances().length,
    };
  }

  /**
   * Get all component information
   *
   * @returns Array of component info
   */
  getAllComponentInfo(): ComponentInfo[] {
    return this.getComponentNames()
      .map(name => this.getComponentInfo(name))
      .filter((info): info is ComponentInfo => info !== undefined);
  }

  /**
   * Send event to instance in any component
   *
   * @param componentName Target component name
   * @param instanceId Instance ID
   * @param event Event to send
   */
  async sendEventToComponent(
    componentName: string,
    instanceId: string,
    event: FSMEvent
  ): Promise<void> {
    const runtime = this.runtimes.get(componentName);
    if (!runtime) {
      throw new Error(`Component ${componentName} not found`);
    }

    await runtime.sendEvent(instanceId, event);
  }

  /**
   * Broadcast event to instances in a specific component
   *
   * Uses the configured message broker (in-memory or distributed)
   *
   * @param componentName Target component name
   * @param machineName Target machine name
   * @param currentState Current state filter
   * @param event Event to broadcast
   * @param sourceComponent Source component name (for tracing)
   * @returns Number of instances processed
   */
  async broadcastToComponent(
    componentName: string,
    machineName: string,
    currentState: string,
    event: FSMEvent,
    sourceComponent?: string
  ): Promise<number> {
    // Check if target component exists (only for in-memory broker)
    if (this.broker instanceof InMemoryMessageBroker) {
      const runtime = this.runtimes.get(componentName);
      if (!runtime) {
        throw new Error(`Component ${componentName} not found`);
      }
    }

    // Publish message via broker (works for both in-memory and distributed)
    const message: CrossComponentMessage = {
      sourceComponent: sourceComponent || 'unknown',
      targetComponent: componentName,
      targetMachine: machineName,
      targetState: currentState,
      event,
    };

    const channel = `xcomponent:${componentName}`;

    // For in-memory broker, we can directly process instances and return the count
    // For distributed broker, we publish to Redis and can't know the count
    if (this.broker instanceof InMemoryMessageBroker) {
      const runtime = this.runtimes.get(componentName)!;

      // Get all instances of the target machine in the target state
      const instances = runtime.getAllInstances().filter(
        inst => inst.machineName === machineName && inst.currentState === currentState
      );

      // Send event to each matching instance
      let count = 0;
      for (const instance of instances) {
        try {
          await runtime.sendEvent(instance.id, event);
          count++;
        } catch (error) {
          this.emit('broadcast_error', {
            componentName,
            instanceId: instance.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return count;
    } else {
      // Distributed mode: publish to broker (the handler will process it)
      await this.broker.publish(channel, message);
      return 0; // Count not available in distributed mode
    }
  }

  /**
   * Broadcast event to all components
   *
   * Useful for system-wide notifications (e.g., shutdown, maintenance mode)
   *
   * @param machineName Target machine name
   * @param currentState Current state filter
   * @param event Event to broadcast
   * @returns Total number of instances processed across all components
   */
  async broadcastToAll(
    machineName: string,
    currentState: string,
    event: FSMEvent
  ): Promise<number> {
    let total = 0;

    for (const [componentName, runtime] of this.runtimes) {
      try {
        const count = await runtime.broadcastEvent(machineName, currentState, event);
        total += count;
      } catch (error) {
        this.emit('broadcast_error', {
          componentName,
          machineName,
          currentState,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return total;
  }

  /**
   * Create instance in a specific component
   *
   * @param componentName Target component name
   * @param machineName Machine name
   * @param initialContext Initial context
   * @returns Instance ID
   */
  createInstanceInComponent(
    componentName: string,
    machineName: string,
    initialContext: Record<string, any>
  ): string {
    const runtime = this.runtimes.get(componentName);
    if (!runtime) {
      throw new Error(`Component ${componentName} not found`);
    }

    return runtime.createInstance(machineName, initialContext);
  }

  /**
   * Find instance by ID across all components
   *
   * @param instanceId Instance ID
   * @returns Instance and component name, or undefined
   */
  findInstance(instanceId: string): { instance: FSMInstance; componentName: string } | undefined {
    for (const [componentName, runtime] of this.runtimes) {
      const instance = runtime.getInstance(instanceId);
      if (instance) {
        return { instance, componentName };
      }
    }
    return undefined;
  }

  /**
   * Get all instances across all components
   *
   * @returns Array of instances with component name
   */
  getAllInstances(): Array<{ instance: FSMInstance; componentName: string }> {
    const result: Array<{ instance: FSMInstance; componentName: string }> = [];

    for (const [componentName, runtime] of this.runtimes) {
      const instances = runtime.getAllInstances();
      instances.forEach(instance => {
        result.push({ instance, componentName });
      });
    }

    return result;
  }

  /**
   * Get statistics across all components
   *
   * @returns Registry statistics
   */
  getStats(): {
    componentCount: number;
    totalInstances: number;
    totalMachines: number;
    components: Array<{ name: string; instances: number; machines: number }>;
  } {
    const components = this.getAllComponentInfo();

    return {
      componentCount: components.length,
      totalInstances: components.reduce((sum, c) => sum + c.instanceCount, 0),
      totalMachines: components.reduce((sum, c) => sum + c.machineCount, 0),
      components: components.map(c => ({
        name: c.name,
        instances: c.instanceCount,
        machines: c.machineCount,
      })),
    };
  }

  /**
   * Trace event causality across all components
   *
   * Follows event chains across component boundaries to show
   * complete system-wide workflows
   *
   * @param eventId Starting event ID
   * @returns Array of persisted events showing full causality chain
   */
  async traceEventAcrossComponents(eventId: string): Promise<import('./types').PersistedEvent[]> {
    const allEvents: import('./types').PersistedEvent[] = [];
    const eventMap = new Map<string, import('./types').PersistedEvent>();

    // Collect all events from all components
    for (const [, runtime] of this.runtimes) {
      try {
        const events = await runtime.getAllPersistedEvents();
        events.forEach(event => {
          eventMap.set(event.id, event);
          allEvents.push(event);
        });
      } catch {
        // Component may not have persistence enabled, skip
        continue;
      }
    }

    // Build causality chain
    const result: import('./types').PersistedEvent[] = [];
    const visited = new Set<string>();

    const trace = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);

      const event = eventMap.get(id);
      if (!event) return;

      result.push(event);

      // Trace caused events recursively
      if (event.caused && event.caused.length > 0) {
        for (const causedId of event.caused) {
          trace(causedId);
        }
      }
    };

    trace(eventId);
    return result;
  }

  /**
   * Get all persisted events across all components
   *
   * Useful for system-wide analysis, debugging, and monitoring
   *
   * @returns Array of all persisted events from all components
   */
  async getAllPersistedEvents(): Promise<import('./types').PersistedEvent[]> {
    const eventMap = new Map<string, import('./types').PersistedEvent>();

    for (const [, runtime] of this.runtimes) {
      try {
        const events = await runtime.getAllPersistedEvents();
        // Deduplicate by event ID (in case components share event store)
        events.forEach(event => eventMap.set(event.id, event));
      } catch {
        // Component may not have persistence enabled, skip
        continue;
      }
    }

    // Convert to array and sort by timestamp
    return Array.from(eventMap.values()).sort((a, b) => a.persistedAt - b.persistedAt);
  }

  /**
   * Get persisted events for a specific instance across components
   *
   * @param instanceId Instance ID to query
   * @returns Array of persisted events for the instance
   */
  async getInstanceHistory(instanceId: string): Promise<import('./types').PersistedEvent[]> {
    for (const [, runtime] of this.runtimes) {
      try {
        const instance = runtime.getInstance(instanceId);
        if (instance) {
          return await runtime.getInstanceHistory(instanceId);
        }
      } catch {
        continue;
      }
    }

    return [];
  }

  /**
   * Forward runtime events to registry
   */
  private forwardRuntimeEvents(componentName: string, runtime: FSMRuntime): void {
    // Forward all runtime events with component context
    const eventsToForward = [
      'state_change',
      'instance_created',
      'instance_disposed',
      'instance_error',
      'guard_failed',
      'cascade_completed',
      'cascade_error',
    ];

    eventsToForward.forEach(eventName => {
      runtime.on(eventName, (data: any) => {
        this.emit(eventName, {
          ...data,
          componentName,
        });
      });
    });
  }

  /**
   * Dispose all components and cleanup
   */
  async dispose(): Promise<void> {
    // Unsubscribe from all component messages
    for (const componentName of this.components.keys()) {
      try {
        this.broker.unsubscribe(componentName);
      } catch (error) {
        console.error(`Error unsubscribing component ${componentName}:`, error);
      }
    }

    // Dispose all runtimes
    for (const [componentName, runtime] of this.runtimes) {
      try {
        runtime.dispose();
      } catch (error) {
        console.error(`Error disposing component ${componentName}:`, error);
      }
    }

    // Disconnect broker
    await this.broker.disconnect();

    this.runtimes.clear();
    this.components.clear();
    this.removeAllListeners();
  }
}
