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

  constructor() {
    super();
    this.runtimes = new Map();
    this.components = new Map();
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
   * @param componentName Target component name
   * @param machineName Target machine name
   * @param currentState Current state filter
   * @param event Event to broadcast
   * @returns Number of instances processed
   */
  async broadcastToComponent(
    componentName: string,
    machineName: string,
    currentState: string,
    event: FSMEvent
  ): Promise<number> {
    const runtime = this.runtimes.get(componentName);
    if (!runtime) {
      throw new Error(`Component ${componentName} not found`);
    }

    return await runtime.broadcastEvent(machineName, currentState, event);
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
  dispose(): void {
    for (const [componentName, runtime] of this.runtimes) {
      try {
        runtime.dispose();
      } catch (error) {
        console.error(`Error disposing component ${componentName}:`, error);
      }
    }

    this.runtimes.clear();
    this.components.clear();
    this.removeAllListeners();
  }
}
