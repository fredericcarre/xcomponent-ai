/**
 * FSM Runtime Engine
 * Implements XComponent-inspired state machine execution with multi-instance support
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import {
  Component,
  StateMachine,
  Transition,
  FSMEvent,
  FSMInstance,
  StateType,
  TransitionType,
  Guard,
  Sender,
  PersistenceConfig,
} from './types';
import type { MatchingRule } from './types';
import { PersistenceManager, InMemoryEventStore, InMemorySnapshotStore } from './persistence';

/**
 * Sender implementation for triggered methods
 * Provides controlled access to runtime operations
 */
class SenderImpl implements Sender {
  constructor(private runtime: FSMRuntime) {}

  async sendTo(instanceId: string, event: FSMEvent): Promise<void> {
    return this.runtime.sendEvent(instanceId, event);
  }

  async broadcast(machineName: string, currentState: string, event: FSMEvent): Promise<number> {
    return this.runtime.broadcastEvent(machineName, currentState, event);
  }

  createInstance(machineName: string, initialContext: Record<string, any>): string {
    return this.runtime.createInstance(machineName, initialContext);
  }
}

/**
 * FSM Runtime Engine
 * Manages multiple FSM instances with event-driven execution
 */
export class FSMRuntime extends EventEmitter {
  private instances: Map<string, FSMInstance>;
  private machines: Map<string, StateMachine>;
  private timeouts: Map<string, NodeJS.Timeout>;
  private persistence: PersistenceManager | null;
  private componentDef: Component;

  // Performance: Hash-based indexes for efficient property matching (XComponent pattern)
  private machineIndex: Map<string, Set<string>>; // machineName → Set<instanceId>
  private stateIndex: Map<string, Set<string>>; // "machineName:state" → Set<instanceId>
  private propertyIndex: Map<string, Set<string>>; // "machineName:propName:propValue" → Set<instanceId>

  constructor(component: Component, persistenceConfig?: PersistenceConfig) {
    super();
    this.instances = new Map();
    this.machines = new Map();
    this.timeouts = new Map();
    this.componentDef = component;

    // Initialize indexes
    this.machineIndex = new Map();
    this.stateIndex = new Map();
    this.propertyIndex = new Map();

    // Setup persistence (optional)
    if (persistenceConfig && (persistenceConfig.eventSourcing || persistenceConfig.snapshots)) {
      const eventStore = persistenceConfig.eventStore || new InMemoryEventStore();
      const snapshotStore = persistenceConfig.snapshotStore || new InMemorySnapshotStore();

      this.persistence = new PersistenceManager(eventStore, snapshotStore, {
        eventSourcing: persistenceConfig.eventSourcing,
        snapshots: persistenceConfig.snapshots,
        snapshotInterval: persistenceConfig.snapshotInterval,
      });
    } else {
      this.persistence = null;
    }

    // Index machines by name
    component.stateMachines.forEach(machine => {
      this.machines.set(machine.name, machine);
    });

    // Setup cascading rules engine (XComponent pattern)
    this.setupCascadingEngine();
  }

  /**
   * Create a new FSM instance
   *
   * If the state machine defines a publicMemberType (XComponent pattern),
   * the instance will have separate publicMember and internalMember.
   * Otherwise, it uses the simple context pattern.
   *
   * @param machineName State machine name
   * @param initialContext Initial context or public member data
   * @returns Instance ID
   */
  createInstance(machineName: string, initialContext: Record<string, any> = {}): string {
    const machine = this.machines.get(machineName);
    if (!machine) {
      throw new Error(`Machine ${machineName} not found`);
    }

    const instanceId = uuidv4();

    // XComponent pattern: separate publicMember and internalMember
    const instance: FSMInstance = {
      id: instanceId,
      machineName,
      currentState: machine.initialState,
      context: machine.publicMemberType ? {} : initialContext,
      publicMember: machine.publicMemberType ? initialContext : undefined,
      internalMember: machine.publicMemberType ? {} : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'active',
    };

    this.instances.set(instanceId, instance);

    // Add to indexes for fast lookups
    this.addToIndex(instance);

    this.emit('instance_created', instance);

    // Setup timeout transitions if any from initial state
    this.setupTimeouts(instanceId, machine.initialState);

    // Setup auto-transitions if any from initial state
    this.setupAutoTransitions(instanceId, machine.initialState);

    return instanceId;
  }

  /**
   * Send event to an instance
   */
  async sendEvent(instanceId: string, event: FSMEvent): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      throw new Error(`Instance ${instanceId} not found`);
    }

    if (instance.status !== 'active') {
      throw new Error(`Instance ${instanceId} is not active`);
    }

    const machine = this.machines.get(instance.machineName);
    if (!machine) {
      throw new Error(`Machine ${instance.machineName} not found`);
    }

    // Use publicMember if available (XComponent pattern), otherwise fallback to context
    const instanceContext = instance.publicMember || instance.context;

    // Find applicable transition
    const transition = this.findTransition(machine, instance.currentState, event, instanceContext);
    if (!transition) {
      this.emit('event_ignored', { instanceId, event, currentState: instance.currentState });
      return;
    }

    // Check guards
    if (transition.guards && !this.evaluateGuards(transition.guards, event, instanceContext)) {
      this.emit('guard_failed', { instanceId, event, transition });
      return;
    }

    const previousState = instance.currentState;

    try {
      // Execute transition
      await this.executeTransition(instance, transition, event);

      // Update instance
      instance.currentState = transition.to;
      instance.updatedAt = Date.now();

      // Update indexes
      this.updateIndexOnStateChange(instance, previousState, transition.to);

      // Persist event (event sourcing)
      let eventId = '';
      if (this.persistence) {
        eventId = await this.persistence.persistEvent(
          instanceId,
          instance.machineName,
          event,
          previousState,
          transition.to
        );

        // Set as current event for causality tracking
        this.persistence.setCurrentEventId(eventId);
      }

      // Clear old timeouts
      this.clearTimeouts(instanceId);

      // Emit state change
      this.emit('state_change', {
        instanceId,
        previousState,
        newState: transition.to,
        event,
        timestamp: Date.now(),
      });

      // Save snapshot if needed
      if (this.persistence) {
        await this.persistence.maybeSnapshot(instance, eventId, this.timeouts);
      }

      // Check if final or error state
      const targetState = machine.states.find(s => s.name === transition.to);
      if (targetState && (targetState.type === StateType.FINAL || targetState.type === StateType.ERROR)) {
        instance.status = targetState.type === StateType.FINAL ? 'completed' : 'error';

        // Remove from indexes before disposing
        this.removeFromIndex(instance);

        this.emit('instance_disposed', instance);
        this.instances.delete(instanceId);
        return;
      }

      // Setup new timeouts
      this.setupTimeouts(instanceId, transition.to);

      // Setup auto-transitions
      this.setupAutoTransitions(instanceId, transition.to);

      // Handle inter-machine transitions
      if (transition.type === TransitionType.INTER_MACHINE && transition.targetMachine) {
        const newInstanceId = this.createInstance(transition.targetMachine, { ...instance.context });
        this.emit('inter_machine_transition', {
          sourceInstanceId: instanceId,
          targetInstanceId: newInstanceId,
          targetMachine: transition.targetMachine,
        });
      }
    } catch (error: any) {
      instance.status = 'error';

      // Remove from indexes before deleting
      this.removeFromIndex(instance);

      this.emit('instance_error', { instanceId, error: error.message });
      this.instances.delete(instanceId);
    }
  }

  /**
   * Broadcast event to all matching instances (XComponent-style property matching)
   *
   * This method implements XComponent's property-based instance routing:
   * - Finds all instances of the target machine in the specified state
   * - Evaluates matching rules (property equality checks)
   * - Routes event to ALL instances where matching rules pass
   *
   * Example:
   *   // 100 Order instances exist
   *   // Event: ExecutionInput { OrderId: 42, Quantity: 500 }
   *   // Matching rule: ExecutionInput.OrderId = Order.Id
   *   // → Automatically routes to Order instance with Id=42
   *
   * @param machineName Target state machine name
   * @param currentState Current state filter (only instances in this state)
   * @param event Event to broadcast
   * @returns Number of instances that received the event
   */
  async broadcastEvent(
    machineName: string,
    currentState: string,
    event: FSMEvent
  ): Promise<number> {
    const machine = this.machines.get(machineName);
    if (!machine) {
      throw new Error(`Machine ${machineName} not found`);
    }

    // Find ALL transitions with matching rules for this state/event combination
    const transitionsWithMatchingRules = machine.transitions.filter(
      t => t.from === currentState && t.event === event.type && t.matchingRules && t.matchingRules.length > 0
    );

    if (transitionsWithMatchingRules.length === 0) {
      throw new Error(
        `No transition with matching rules found for ${machineName}.${currentState} on event ${event.type}`
      );
    }

    let processedCount = 0;
    const processedInstances = new Set<string>();

    // For each transition with matching rules, find and process matching instances
    for (const transition of transitionsWithMatchingRules) {
      // Find all instances that match this transition's rules
      const matchingInstances = this.findMatchingInstances(
        machineName,
        currentState,
        event,
        transition.matchingRules!
      );

      // Send event to each matching instance (only once per instance)
      for (const instance of matchingInstances) {
        if (processedInstances.has(instance.id)) {
          continue; // Already processed by another transition
        }

        try {
          const stateBefore = instance.currentState;
          await this.sendEvent(instance.id, event);

          // Check if state actually changed (or instance was disposed)
          const instanceAfter = this.instances.get(instance.id);
          const transitioned = !instanceAfter || instanceAfter.currentState !== stateBefore;

          if (transitioned) {
            processedInstances.add(instance.id);
            processedCount++;
          }
        } catch (error: any) {
          this.emit('broadcast_error', {
            instanceId: instance.id,
            event,
            error: error.message,
          });
        }
      }
    }

    this.emit('broadcast_completed', {
      machineName,
      currentState,
      event,
      matchedCount: processedInstances.size,
      processedCount,
    });

    return processedCount;
  }

  /**
   * Find instances that match the property matching rules
   *
   * @param machineName Target machine name
   * @param currentState Current state filter
   * @param event Event to match against
   * @param matchingRules Property matching rules
   * @returns Array of matching instances
   */
  private findMatchingInstances(
    machineName: string,
    currentState: string,
    event: FSMEvent,
    matchingRules: MatchingRule[]
  ): FSMInstance[] {
    // Performance optimization: Use hash-based index for O(1) lookup
    // Instead of iterating all instances, use state index

    // Try to use property index for direct lookup (fastest path)
    // If we have a single matching rule with === operator, we can use the property index
    if (matchingRules.length === 1 && (!matchingRules[0].operator || matchingRules[0].operator === '===')) {
      const rule = matchingRules[0];
      const eventValue = this.getNestedProperty(event.payload, rule.eventProperty);

      if (eventValue !== undefined) {
        // Check if property is top-level (no dots) for direct index lookup
        if (!rule.instanceProperty.includes('.')) {
          const propKey = `${machineName}:${rule.instanceProperty}:${String(eventValue)}`;
          const candidateIds = this.propertyIndex.get(propKey);

          if (candidateIds) {
            // Filter by state and status
            return Array.from(candidateIds)
              .map(id => this.instances.get(id)!)
              .filter(instance =>
                instance &&
                instance.currentState === currentState &&
                instance.status === 'active'
              );
          }
        }
      }
    }

    // Fallback: Use state index (still faster than iterating all instances)
    const stateKey = `${machineName}:${currentState}`;
    const candidateIds = this.stateIndex.get(stateKey);

    if (!candidateIds || candidateIds.size === 0) {
      return [];
    }

    // Get instances and filter by matching rules
    const candidates = Array.from(candidateIds)
      .map(id => this.instances.get(id)!)
      .filter(instance => instance && instance.status === 'active');

    // Filter by matching rules
    return candidates.filter(instance => {
      return this.evaluateMatchingRules(instance, event, matchingRules);
    });
  }

  /**
   * Evaluate matching rules for an instance
   *
   * @param instance FSM instance to check
   * @param event Event to match against
   * @param matchingRules Matching rules to evaluate
   * @returns true if all matching rules pass
   */
  private evaluateMatchingRules(
    instance: FSMInstance,
    event: FSMEvent,
    matchingRules: MatchingRule[]
  ): boolean {
    return matchingRules.every(rule => {
      const eventValue = this.getNestedProperty(event.payload, rule.eventProperty);

      // Use publicMember if available (XComponent pattern), otherwise fallback to context
      const instanceData = instance.publicMember || instance.context;
      const instanceValue = this.getNestedProperty(instanceData, rule.instanceProperty);

      // Handle undefined values
      if (eventValue === undefined || instanceValue === undefined) {
        return false;
      }

      // Apply operator (default to strict equality)
      // Semantics: instanceValue operator eventValue
      // Example: balance > threshold means instanceValue (balance) > eventValue (threshold)
      const operator = rule.operator || '===';
      switch (operator) {
        case '===':
          return instanceValue === eventValue;
        case '!==':
          return instanceValue !== eventValue;
        case '>':
          return instanceValue > eventValue;
        case '<':
          return instanceValue < eventValue;
        case '>=':
          return instanceValue >= eventValue;
        case '<=':
          return instanceValue <= eventValue;
        default:
          return instanceValue === eventValue;
      }
    });
  }

  /**
   * Get nested property value from object using dot notation
   *
   * Example: getNestedProperty({ customer: { id: 42 } }, "customer.id") → 42
   *
   * @param obj Object to get property from
   * @param path Property path (dot notation)
   * @returns Property value or undefined
   */
  private getNestedProperty(obj: any, path: string): any {
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
  }

  /**
   * Find applicable transition with support for specific triggering rules
   *
   * When multiple transitions exist from the same state with the same event,
   * specific triggering rules differentiate them (XComponent pattern).
   *
   * @param machine State machine
   * @param currentState Current state name
   * @param event Event to match
   * @param instanceContext Instance context for specific triggering rule evaluation
   * @returns Matching transition or null
   */
  private findTransition(
    machine: StateMachine,
    currentState: string,
    event: FSMEvent,
    instanceContext: Record<string, any>
  ): Transition | null {
    // Find all candidate transitions
    const candidates = machine.transitions.filter(
      t => t.from === currentState && t.event === event.type
    );

    if (candidates.length === 0) {
      return null;
    }

    // Single candidate - return it
    if (candidates.length === 1) {
      return candidates[0];
    }

    // Multiple candidates - try specific triggering rules first
    for (const transition of candidates) {
      if (transition.specificTriggeringRule) {
        try {
          const func = new Function(
            'event',
            'context',
            `return ${transition.specificTriggeringRule}`
          );
          if (func(event, instanceContext)) {
            return transition;
          }
        } catch (error) {
          // Rule evaluation failed, skip this transition
          continue;
        }
      }
    }

    // If no specific triggering rules matched, try matching rules
    // This handles cases where multiple transitions differentiate by matching rules (e.g., different operators)
    for (const transition of candidates) {
      if (transition.matchingRules && transition.matchingRules.length > 0) {
        // Create a mock instance to evaluate matching rules
        const mockInstance: FSMInstance = {
          id: 'temp',
          machineName: machine.name,
          currentState,
          context: instanceContext,
          publicMember: instanceContext,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: 'active',
        };

        if (this.evaluateMatchingRules(mockInstance, event, transition.matchingRules)) {
          return transition;
        }
      }
    }

    // No rules matched - return first candidate (backward compatibility)
    return candidates[0];
  }

  /**
   * Evaluate guards
   */
  private evaluateGuards(guards: Guard[], event: FSMEvent, context: Record<string, any>): boolean {
    return guards.every(guard => {
      // Key matching
      if (guard.keys) {
        return guard.keys.every(key => event.payload[key] !== undefined);
      }

      // Contains check
      if (guard.contains) {
        return JSON.stringify(event.payload).includes(guard.contains);
      }

      // Custom function (evaluate as string - in production, use sandboxed eval)
      if (guard.customFunction) {
        try {
          const func = new Function('event', 'context', `return ${guard.customFunction}`);
          return func(event, context);
        } catch {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Execute transition
   *
   * Creates a Sender instance and passes it to triggered methods,
   * enabling cross-instance communication (XComponent pattern)
   */
  private async executeTransition(instance: FSMInstance, transition: Transition, event: FSMEvent): Promise<void> {
    // In production, execute triggered methods here
    if (transition.triggeredMethod) {
      const sender = new SenderImpl(this);
      const instanceContext = instance.publicMember || instance.context;

      this.emit('triggered_method', {
        instanceId: instance.id,
        method: transition.triggeredMethod,
        event,
        context: instanceContext,
        sender,
      });
    }
  }

  /**
   * Setup timeout transitions
   */
  private setupTimeouts(instanceId: string, stateName: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const machine = this.machines.get(instance.machineName);
    if (!machine) return;

    const timeoutTransitions = machine.transitions.filter(
      t => t.from === stateName && t.type === TransitionType.TIMEOUT
    );

    timeoutTransitions.forEach(transition => {
      if (transition.timeoutMs) {
        const timeout = setTimeout(() => {
          this.sendEvent(instanceId, {
            type: transition.event,
            payload: { reason: 'timeout' },
            timestamp: Date.now(),
          });
        }, transition.timeoutMs);

        this.timeouts.set(`${instanceId}-${stateName}`, timeout);
      }
    });
  }

  /**
   * Setup auto-transitions (XComponent-style automatic transitions)
   *
   * Auto-transitions are triggered automatically when entering a state,
   * typically with timeoutMs: 0 for immediate execution.
   *
   * Example:
   *   - from: Validated
   *     to: Processing
   *     event: AUTO_PROCESS
   *     type: auto
   *     timeoutMs: 0
   */
  private setupAutoTransitions(instanceId: string, stateName: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const machine = this.machines.get(instance.machineName);
    if (!machine) return;

    const autoTransitions = machine.transitions.filter(
      t => t.from === stateName && t.type === TransitionType.AUTO
    );

    autoTransitions.forEach(transition => {
      // Use publicMember if available (XComponent pattern), otherwise fallback to context
      const instanceContext = instance.publicMember || instance.context;

      // Check guards before scheduling auto-transition
      if (transition.guards && !this.evaluateGuards(transition.guards,
        { type: transition.event, payload: {}, timestamp: Date.now() },
        instanceContext)) {
        return; // Guard failed, skip this auto-transition
      }

      const delay = transition.timeoutMs || 0; // Default to immediate (0ms)
      const timeout = setTimeout(() => {
        this.sendEvent(instanceId, {
          type: transition.event,
          payload: { reason: 'auto-transition' },
          timestamp: Date.now(),
        });
      }, delay);

      this.timeouts.set(`${instanceId}-${stateName}-auto`, timeout);
    });
  }

  /**
   * Setup cascading rules engine (XComponent pattern)
   *
   * Listens to state_change events and automatically triggers cross-machine updates
   * based on cascading rules defined in state definitions.
   */
  private setupCascadingEngine(): void {
    this.on('state_change', async (data: any) => {
      const { instanceId, newState } = data;
      const instance = this.instances.get(instanceId);

      if (!instance) return;

      const machine = this.machines.get(instance.machineName);
      if (!machine) return;

      // Find the state definition
      const state = machine.states.find(s => s.name === newState);
      if (!state || !state.cascadingRules || state.cascadingRules.length === 0) {
        return; // No cascading rules for this state
      }

      // Process each cascading rule
      for (const rule of state.cascadingRules) {
        try {
          await this.processCascadingRule(instance, rule);
        } catch (error: any) {
          this.emit('cascade_error', {
            sourceInstanceId: instanceId,
            rule,
            error: error.message,
          });
        }
      }
    });
  }

  /**
   * Add instance to indexes (for O(1) lookup)
   * Performance optimization: XComponent hash-based matching
   */
  private addToIndex(instance: FSMInstance): void {
    const { id, machineName, currentState, publicMember, context } = instance;

    // Machine index
    if (!this.machineIndex.has(machineName)) {
      this.machineIndex.set(machineName, new Set());
    }
    this.machineIndex.get(machineName)!.add(id);

    // State index
    const stateKey = `${machineName}:${currentState}`;
    if (!this.stateIndex.has(stateKey)) {
      this.stateIndex.set(stateKey, new Set());
    }
    this.stateIndex.get(stateKey)!.add(id);

    // Property index (for commonly matched properties)
    const instanceData = publicMember || context;
    if (instanceData) {
      // Index all top-level properties for fast matching
      for (const [propName, propValue] of Object.entries(instanceData)) {
        if (propValue !== null && propValue !== undefined) {
          const propKey = `${machineName}:${propName}:${String(propValue)}`;
          if (!this.propertyIndex.has(propKey)) {
            this.propertyIndex.set(propKey, new Set());
          }
          this.propertyIndex.get(propKey)!.add(id);
        }
      }
    }
  }

  /**
   * Remove instance from indexes
   */
  private removeFromIndex(instance: FSMInstance): void {
    const { id, machineName, currentState, publicMember, context } = instance;

    // Machine index
    this.machineIndex.get(machineName)?.delete(id);

    // State index
    const stateKey = `${machineName}:${currentState}`;
    this.stateIndex.get(stateKey)?.delete(id);

    // Property index
    const instanceData = publicMember || context;
    if (instanceData) {
      for (const [propName, propValue] of Object.entries(instanceData)) {
        if (propValue !== null && propValue !== undefined) {
          const propKey = `${machineName}:${propName}:${String(propValue)}`;
          this.propertyIndex.get(propKey)?.delete(id);
        }
      }
    }
  }

  /**
   * Update state index when state changes
   */
  private updateIndexOnStateChange(instance: FSMInstance, oldState: string, newState: string): void {
    const { id, machineName } = instance;

    // Remove from old state index
    const oldStateKey = `${machineName}:${oldState}`;
    this.stateIndex.get(oldStateKey)?.delete(id);

    // Add to new state index
    const newStateKey = `${machineName}:${newState}`;
    if (!this.stateIndex.has(newStateKey)) {
      this.stateIndex.set(newStateKey, new Set());
    }
    this.stateIndex.get(newStateKey)!.add(id);
  }

  /**
   * Process a single cascading rule
   *
   * Applies payload templating and broadcasts event to target instances
   * If matchingRules exist, uses property-based routing
   * Otherwise, sends to ALL instances in the target state
   */
  private async processCascadingRule(
    sourceInstance: FSMInstance,
    rule: import('./types').CascadingRule
  ): Promise<void> {
    // Get source context (publicMember or context)
    const sourceContext = sourceInstance.publicMember || sourceInstance.context;

    // Apply payload templating
    const payload = rule.payload ? this.applyPayloadTemplate(rule.payload, sourceContext) : {};

    const event: import('./types').FSMEvent = {
      type: rule.event,
      payload,
      timestamp: Date.now(),
    };

    let processedCount = 0;

    if (rule.matchingRules && rule.matchingRules.length > 0) {
      // Use property-based routing
      processedCount = await this.broadcastEvent(rule.targetMachine, rule.targetState, event);
    } else {
      // No matching rules - send to ALL instances in target state
      // Performance: Use state index instead of iterating all instances
      const stateKey = `${rule.targetMachine}:${rule.targetState}`;
      const candidateIds = this.stateIndex.get(stateKey);

      if (candidateIds) {
        for (const instanceId of candidateIds) {
          const instance = this.instances.get(instanceId);
          if (!instance || instance.status !== 'active') continue;

          try {
            await this.sendEvent(instance.id, event);
            processedCount++;
          } catch (error: any) {
            // Continue processing other instances even if one fails
            this.emit('cascade_error', {
              sourceInstanceId: sourceInstance.id,
              targetInstanceId: instance.id,
              error: error.message,
            });
          }
        }
      }
    }

    this.emit('cascade_completed', {
      sourceInstanceId: sourceInstance.id,
      targetMachine: rule.targetMachine,
      targetState: rule.targetState,
      event: rule.event,
      processedCount,
    });
  }

  /**
   * Apply payload template with {{property}} syntax
   *
   * Replaces {{property}} with actual values from source context
   *
   * Example:
   *   payload: { orderId: "{{Id}}", total: "{{Total}}" }
   *   context: { Id: 42, Total: 99.99 }
   *   result: { orderId: 42, total: 99.99 }
   */
  private applyPayloadTemplate(
    template: Record<string, any>,
    context: Record<string, any>
  ): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(template)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        // Extract property name: "{{Id}}" → "Id"
        const propertyPath = value.slice(2, -2).trim();
        result[key] = this.getNestedProperty(context, propertyPath);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Recursively apply template for nested objects
        result[key] = this.applyPayloadTemplate(value, context);
      } else {
        // Use value as-is
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Clear timeouts for instance
   */
  private clearTimeouts(instanceId: string): void {
    for (const [key, timeout] of this.timeouts.entries()) {
      if (key.startsWith(instanceId)) {
        clearTimeout(timeout);
        this.timeouts.delete(key);
      }
    }
  }

  /**
   * Get instance
   */
  getInstance(instanceId: string): FSMInstance | undefined {
    return this.instances.get(instanceId);
  }

  /**
   * Get all instances
   */
  getAllInstances(): FSMInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Get instances by machine
   */
  getInstancesByMachine(machineName: string): FSMInstance[] {
    return Array.from(this.instances.values()).filter(i => i.machineName === machineName);
  }

  /**
   * Simulate FSM path
   */
  simulatePath(machineName: string, events: FSMEvent[]): { success: boolean; path: string[]; error?: string } {
    const machine = this.machines.get(machineName);
    if (!machine) {
      return { success: false, path: [], error: `Machine ${machineName} not found` };
    }

    const path: string[] = [machine.initialState];
    let currentState = machine.initialState;
    const context: Record<string, any> = {};

    for (const event of events) {
      const transition = this.findTransition(machine, currentState, event, context);
      if (!transition) {
        return { success: false, path, error: `No transition from ${currentState} for event ${event.type}` };
      }

      if (transition.guards && !this.evaluateGuards(transition.guards, event, context)) {
        return { success: false, path, error: `Guard failed for transition from ${currentState}` };
      }

      currentState = transition.to;
      path.push(currentState);

      const state = machine.states.find(s => s.name === currentState);
      if (state && (state.type === StateType.FINAL || state.type === StateType.ERROR)) {
        break;
      }
    }

    return { success: true, path };
  }

  // ============================================================
  // PHASE 4: PERSISTENCE & RESTORATION
  // ============================================================

  /**
   * Restore all instances from snapshots (for long-running workflows)
   *
   * Called after restart to restore system state from persistence
   *
   * Example:
   *   const runtime = new FSMRuntime(component, { snapshots: true });
   *   await runtime.restore();
   *   // System is now in same state as before restart
   */
  async restore(): Promise<{ restored: number; failed: number }> {
    if (!this.persistence) {
      throw new Error('Persistence is not enabled');
    }

    const snapshots = await this.persistence.getAllSnapshots();
    let restored = 0;
    let failed = 0;

    for (const snapshot of snapshots) {
      try {
        const instance = snapshot.instance;

        // Validate machine exists
        if (!this.machines.has(instance.machineName)) {
          failed++;
          this.emit('restore_error', {
            instanceId: instance.id,
            error: `Machine ${instance.machineName} not found`,
          });
          continue;
        }

        // Restore instance
        this.instances.set(instance.id, instance);
        restored++;

        this.emit('instance_restored', {
          instanceId: instance.id,
          machineName: instance.machineName,
          currentState: instance.currentState,
        });
      } catch (error: any) {
        failed++;
        this.emit('restore_error', {
          instanceId: snapshot.instance.id,
          error: error.message,
        });
      }
    }

    // Resynchronize timeouts after restore
    if (restored > 0) {
      await this.resynchronizeTimeouts();
    }

    return { restored, failed };
  }

  /**
   * Resynchronize timeouts after restart
   *
   * Recalculates timeout transitions based on current state and elapsed time
   * Handles expired timeouts by triggering them immediately
   */
  async resynchronizeTimeouts(): Promise<{ synced: number; expired: number }> {
    let synced = 0;
    let expired = 0;

    for (const [instanceId, instance] of this.instances.entries()) {
      if (instance.status !== 'active') {
        continue;
      }

      const machine = this.machines.get(instance.machineName);
      if (!machine) {
        continue;
      }

      // Find timeout transitions from current state
      const timeoutTransitions = machine.transitions.filter(
        t => t.from === instance.currentState && t.type === TransitionType.TIMEOUT
      );

      for (const transition of timeoutTransitions) {
        if (!transition.timeoutMs) {
          continue;
        }

        // Calculate elapsed time since last update
        const elapsedMs = Date.now() - instance.updatedAt;
        const remainingMs = transition.timeoutMs - elapsedMs;

        if (remainingMs <= 0) {
          // Timeout already expired - trigger immediately
          try {
            await this.sendEvent(instanceId, {
              type: transition.event,
              payload: { reason: 'timeout_expired_during_restart' },
              timestamp: Date.now(),
            });
            expired++;
          } catch (error: any) {
            this.emit('timeout_resync_error', {
              instanceId,
              error: error.message,
            });
          }
        } else {
          // Timeout still pending - reschedule with remaining time
          const timeout = setTimeout(() => {
            this.sendEvent(instanceId, {
              type: transition.event,
              payload: { reason: 'timeout' },
              timestamp: Date.now(),
            });
          }, remainingMs);

          this.timeouts.set(`${instanceId}-${instance.currentState}`, timeout);
          synced++;
        }
      }

      // Resynchronize auto-transitions (should trigger immediately if not already transitioned)
      const autoTransitions = machine.transitions.filter(
        t => t.from === instance.currentState && t.type === TransitionType.AUTO
      );

      for (const transition of autoTransitions) {
        // Use publicMember if available (XComponent pattern), otherwise fallback to context
        const instanceContext = instance.publicMember || instance.context;

        // Check guards before scheduling auto-transition
        if (transition.guards && !this.evaluateGuards(transition.guards,
          { type: transition.event, payload: {}, timestamp: Date.now() },
          instanceContext)) {
          continue; // Guard failed, skip this auto-transition
        }

        const delay = transition.timeoutMs || 0;

        // Calculate elapsed time
        const elapsedMs = Date.now() - instance.updatedAt;
        const remainingMs = Math.max(0, delay - elapsedMs);

        const timeout = setTimeout(() => {
          this.sendEvent(instanceId, {
            type: transition.event,
            payload: { reason: 'auto-transition' },
            timestamp: Date.now(),
          });
        }, remainingMs);

        this.timeouts.set(`${instanceId}-${instance.currentState}-auto`, timeout);
        synced++;
      }
    }

    return { synced, expired };
  }

  /**
   * Get persistence manager (for testing/inspection)
   */
  getPersistenceManager(): PersistenceManager | null {
    return this.persistence;
  }

  /**
   * Get instance event history (for audit/debug)
   */
  async getInstanceHistory(instanceId: string): Promise<import('./types').PersistedEvent[]> {
    if (!this.persistence) {
      return [];
    }

    return await this.persistence.getInstanceEvents(instanceId);
  }

  /**
   * Trace event causality chain (for debugging cascades/sender)
   */
  async traceEventCausality(eventId: string): Promise<import('./types').PersistedEvent[]> {
    if (!this.persistence) {
      return [];
    }

    return await this.persistence.traceEventCausality(eventId);
  }

  /**
   * Get component definition
   */
  getComponent(): Component {
    return this.componentDef;
  }

  /**
   * Get available transitions from current state of an instance
   */
  getAvailableTransitions(instanceId: string): Transition[] {
    const instance = this.getInstance(instanceId);
    if (!instance) {
      return [];
    }

    const machine = this.machines.get(instance.machineName);
    if (!machine) {
      return [];
    }

    // Find all transitions from current state
    return machine.transitions.filter(t => t.from === instance.currentState);
  }
}

/**
 * Load component from object
 */
export function loadComponent(data: any): Component {
  return data as Component;
}
