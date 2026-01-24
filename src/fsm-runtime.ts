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
import { TimerWheel } from './timer-wheel';
import { PersistenceManager, InMemoryEventStore, InMemorySnapshotStore } from './persistence';
import type { ComponentRegistry } from './component-registry';

/**
 * Sender implementation for triggered methods
 * Provides controlled access to runtime operations
 * Supports both intra-component and cross-component communication
 */
class SenderImpl implements Sender {
  constructor(
    private runtime: FSMRuntime,
    private currentInstanceId: string,
    private registry?: ComponentRegistry
  ) {}

  async sendToSelf(event: FSMEvent): Promise<void> {
    // Queue event asynchronously to avoid race conditions
    return this.runtime.sendEvent(this.currentInstanceId, event);
  }

  async sendTo(instanceId: string, event: FSMEvent): Promise<void> {
    return this.runtime.sendEvent(instanceId, event);
  }

  async sendToComponent(componentName: string, instanceId: string, event: FSMEvent): Promise<void> {
    if (!this.registry) {
      throw new Error('Cross-component communication requires ComponentRegistry');
    }
    return this.registry.sendEventToComponent(componentName, instanceId, event);
  }

  async broadcast(
    machineName: string,
    event: FSMEvent,
    currentState?: string,
    componentName?: string
  ): Promise<number> {
    // Unified broadcast: intra-component OR cross-component
    if (componentName) {
      // Cross-component
      if (!this.registry) {
        throw new Error('Cross-component communication requires ComponentRegistry');
      }
      return this.registry.broadcastToComponent(
        componentName,
        machineName,
        event,
        this.runtime.getComponentName(),
        undefined, // No PropertyFilter
        currentState
      );
    } else {
      // Intra-component
      return this.runtime.broadcastEvent(machineName, event, currentState);
    }
  }

  createInstance(machineName: string, initialContext: Record<string, any>): string {
    return this.runtime.createInstance(machineName, initialContext);
  }

  createInstanceInComponent(
    componentName: string,
    machineName: string,
    initialContext: Record<string, any>
  ): string {
    if (!this.registry) {
      throw new Error('Cross-component communication requires ComponentRegistry');
    }
    return this.registry.createInstanceInComponent(componentName, machineName, initialContext);
  }
}

/**
 * FSM Runtime Engine
 * Manages multiple FSM instances with event-driven execution
 */
export class FSMRuntime extends EventEmitter {
  private instances: Map<string, FSMInstance>;
  private machines: Map<string, StateMachine>;
  private timerWheel: TimerWheel; // Performance: Single timer for all timeouts
  private timeoutTasks: Map<string, string[]>; // instanceId → taskIds (for cleanup)
  private persistence: PersistenceManager | null;
  private componentDef: Component;
  private registry?: ComponentRegistry; // For cross-component communication

  // Performance: Hash-based indexes for efficient property matching (XComponent pattern)
  private machineIndex: Map<string, Set<string>>; // machineName → Set<instanceId>
  private stateIndex: Map<string, Set<string>>; // "machineName:state" → Set<instanceId>
  private propertyIndex: Map<string, Set<string>>; // "machineName:propName:propValue" → Set<instanceId>

  // Deprecation warnings (shown once per runtime)
  private guardsDeprecationWarned = false;

  constructor(component: Component, persistenceConfig?: PersistenceConfig) {
    super();
    this.instances = new Map();
    this.machines = new Map();
    // Timer wheel: 10ms ticks for high precision, 6000 buckets = 60s max
    // Still O(1) with single timer - 10ms granularity is sufficient for most use cases
    // For longer timeouts (>60s), tasks will wrap around (multi-lap)
    this.timerWheel = new TimerWheel(10, 6000);
    this.timeoutTasks = new Map(); // Track tasks for cleanup
    this.componentDef = component;

    // Initialize indexes
    this.machineIndex = new Map();
    this.stateIndex = new Map();
    this.propertyIndex = new Map();

    // Start timer wheel
    this.timerWheel.start();

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
   *
   * Supports multiple transitions from same state with same event.
   * When multiple transitions exist with guards, uses "first matching guard wins" semantics.
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

    // Find ALL candidate transitions from current state with matching event
    const candidates = machine.transitions.filter(
      t => t.from === instance.currentState && t.event === event.type
    );

    if (candidates.length === 0) {
      this.emit('event_ignored', { instanceId, event, currentState: instance.currentState });
      return;
    }

    // Try each candidate in order (first matching guard wins)
    let transition: Transition | null = null;

    if (candidates.length === 1) {
      // Single candidate - use it directly
      transition = candidates[0];

      // Check guards
      if (transition.guards && !this.evaluateGuards(transition.guards, event, instanceContext)) {
        this.emit('guard_failed', { instanceId, event, transition });
        return;
      }
    } else {
      // Multiple candidates - try each in order until guards pass
      // This supports patterns like:
      //   - from: PartiallyExecuted, to: PartiallyExecuted, event: EXEC, guard: qty < total
      //   - from: PartiallyExecuted, to: FullyExecuted, event: EXEC, guard: qty >= total
      for (const candidate of candidates) {
        // Evaluate guards if present
        if (candidate.guards) {
          if (this.evaluateGuards(candidate.guards, event, instanceContext)) {
            transition = candidate;
            break; // First matching guard wins
          }
        } else {
          // No guards - this transition always matches
          transition = candidate;
          break;
        }
      }

      if (!transition) {
        // No transition's guards passed
        this.emit('guard_failed', {
          instanceId,
          event,
          currentState: instance.currentState,
          candidateCount: candidates.length,
        });
        return;
      }
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
          this.componentDef.name,
          event,
          previousState,
          transition.to
        );

        // Set as current event for causality tracking
        this.persistence.setCurrentEventId(eventId);
      }

      // Handle timeouts based on whether this is a self-loop
      const isSelfLoop = previousState === transition.to;

      if (isSelfLoop) {
        // Self-loop: only reset timeouts with resetOnTransition !== false
        this.clearTimeoutsForSelfLoop(instanceId, transition.to);
      } else {
        // State change: clear all timeouts
        this.clearTimeouts(instanceId);
      }

      // Emit state change
      this.emit('state_change', {
        instanceId,
        machineName: instance.machineName,
        previousState,
        newState: transition.to,
        event,
        eventId,
        timestamp: Date.now(),
        // Include instance data for external subscribers
        instance: {
          id: instance.id,
          machineName: instance.machineName,
          currentState: transition.to,
          context: instance.context,
          publicMember: instance.publicMember,
          status: instance.status,
          createdAt: instance.createdAt,
          updatedAt: Date.now(),
        },
      });

      // Save snapshot if needed
      // Note: With timer wheel, we don't pass pending timeouts map
      // Timeouts are resynchronized during restore() based on elapsed time
      if (this.persistence) {
        await this.persistence.maybeSnapshot(instance, eventId, undefined);
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
      if (isSelfLoop) {
        // Self-loop: only setup timeouts that were cleared (resetOnTransition !== false)
        this.setupTimeoutsForSelfLoop(instanceId, transition.to);
      } else {
        // State change: setup all timeouts for new state
        this.setupTimeouts(instanceId, transition.to);
      }

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

      this.emit('instance_error', {
        instanceId,
        machineName: instance.machineName,
        error: error.message,
        instance: {
          id: instance.id,
          machineName: instance.machineName,
          currentState: instance.currentState,
          context: instance.context,
          publicMember: instance.publicMember,
          status: instance.status,
        },
      });
      this.instances.delete(instanceId);
    }
  }

  /**
   * Broadcast event to all matching instances
   *
   * Two modes:
   * 1. Simple broadcast - send to all instances (any state or specific state)
   * 2. MatchingRules - XComponent-style routing based on event payload
   *
   * Filtering via matchingRules in YAML, not in code.
   *
   * @param machineName Target state machine name
   * @param event Event to broadcast
   * @param currentState Optional state filter. Omit to broadcast to all states
   * @returns Number of instances that received the event
   *
   * @example
   * // Broadcast to all Orders (any state)
   * await runtime.broadcastEvent('Order', {type: 'ALERT', payload: {}});
   *
   * @example
   * // Broadcast to Orders in Pending state only
   * await runtime.broadcastEvent('Order', {type: 'TIMEOUT', payload: {}}, 'Pending');
   *
   * @example
   * // Filtering via matchingRules in YAML:
   * // transitions:
   * //   - from: Monitoring
   * //     to: Monitoring
   * //     event: ORDER_UPDATE
   * //     matchingRules:
   * //       - eventProperty: payload.customerId
   * //         instanceProperty: customerId
   */
  async broadcastEvent(
    machineName: string,
    event: FSMEvent,
    currentState?: string
  ): Promise<number> {
    const machine = this.machines.get(machineName);
    if (!machine) {
      throw new Error(`Machine ${machineName} not found`);
    }

    // MODE 1: Simple broadcast - send to all instances (or in specific state)
    // No matchingRules - just send the event to all instances
    if (!currentState || currentState === '*') {
      // Broadcast to ALL instances of this machine
      const machineIds = this.machineIndex.get(machineName) || new Set();
      const instances = Array.from(machineIds)
        .map(id => this.instances.get(id))
        .filter((inst): inst is FSMInstance => inst !== undefined);

      let processedCount = 0;

      for (const instance of instances) {
        try {
          await this.sendEvent(instance.id, event);
          processedCount++;
        } catch (error: any) {
          this.emit('broadcast_error', {
            instanceId: instance.id,
            event,
            error: error.message,
          });
        }
      }

      this.emit('broadcast_completed', {
        machineName,
        currentState: '*',
        event,
        matchedCount: instances.length,
        processedCount,
      });

      return processedCount;
    }

    // MODE 2: XComponent-style matching rules
    // Find instances based on event payload matching instance properties
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
        } catch {
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
   *
   * @deprecated Guards are deprecated in favor of explicit control in triggered methods.
   * Use sender.sendToSelf() to explicitly trigger transitions based on business logic.
   *
   * Guards are evaluated with AND logic (all must pass for transition to occur)
   * Supports:
   * - context guards: Check properties in instance context
   * - event guards: Check properties in event payload
   * - custom guards: JavaScript conditions
   */
  private evaluateGuards(guards: Guard[], event: FSMEvent, context: Record<string, any>): boolean {
    // Warning: Guards are deprecated
    if (guards.length > 0 && !this.guardsDeprecationWarned) {
      console.warn(
        '[xcomponent-ai] DEPRECATION WARNING: Guards are deprecated. ' +
        'Use sender.sendToSelf() in triggered methods for explicit control. ' +
        'Guards will be removed in v0.3.0.'
      );
      this.guardsDeprecationWarned = true;
    }

    return guards.every(guard => {
      // Modern guard types
      if (guard.type) {
        switch (guard.type) {
          case 'context':
            return this.evaluatePropertyGuard(context, guard);

          case 'event':
            return this.evaluatePropertyGuard(event.payload || {}, guard);

          case 'custom':
            if (guard.condition) {
              try {
                // Create function with context, event, and publicMember (for backward compatibility)
                // eslint-disable-next-line no-new-func
                const func = new Function('context', 'event', 'publicMember', `return ${guard.condition}`);
                return func(context, event, context); // publicMember = context for backward compat
              } catch (error) {
                console.error(`Guard condition evaluation failed: ${guard.condition}`, error);
                return false;
              }
            }
            return false;

          default:
            console.warn(`Unknown guard type: ${guard.type}`);
            return false;
        }
      }

      // Legacy support
      // Key matching
      if (guard.keys) {
        return guard.keys.every(key => event.payload[key] !== undefined);
      }

      // Contains check
      if (guard.contains) {
        return JSON.stringify(event.payload).includes(guard.contains);
      }

      // Custom function (legacy)
      if (guard.customFunction) {
        try {
          // eslint-disable-next-line no-new-func
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
   * Evaluate a property-based guard (context or event)
   */
  private evaluatePropertyGuard(obj: any, guard: Guard): boolean {
    if (!guard.property) {
      return false;
    }

    // Get property value (supports dot notation)
    const value = this.getNestedProperty(obj, guard.property);
    const operator = guard.operator || '===';

    // Resolve guard.value if it's a template ({{propertyName}})
    let compareValue = guard.value;
    if (typeof compareValue === 'string' && compareValue.startsWith('{{') && compareValue.endsWith('}}')) {
      const propName = compareValue.slice(2, -2);
      compareValue = this.getNestedProperty(obj, propName);
    }

    // Evaluate operator
    switch (operator) {
      case '===':
        return value === compareValue;
      case '!==':
        return value !== compareValue;
      case '>':
        return value > compareValue;
      case '<':
        return value < compareValue;
      case '>=':
        return value >= compareValue;
      case '<=':
        return value <= compareValue;
      case 'contains':
        return String(value).includes(String(compareValue));
      case 'in':
        return Array.isArray(compareValue) && compareValue.includes(value);
      default:
        console.warn(`Unknown operator: ${operator}`);
        return false;
    }
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
      const sender = new SenderImpl(this, instance.id, this.registry);
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
  /**
   * Setup timeout transitions using timer wheel (performance optimized)
   *
   * Instead of creating one setTimeout per instance (O(n) timers),
   * use a single timer wheel that manages all timeouts (O(1) timer).
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
        const taskId = `${instanceId}-${stateName}-${transition.event}`;

        // Track task for cleanup
        if (!this.timeoutTasks.has(instanceId)) {
          this.timeoutTasks.set(instanceId, []);
        }
        this.timeoutTasks.get(instanceId)!.push(taskId);

        // Use timer wheel instead of setTimeout
        this.timerWheel.addTimeout(taskId, transition.timeoutMs, () => {
          // Check if instance still exists and is in the same state
          const currentInstance = this.instances.get(instanceId);
          if (currentInstance && currentInstance.currentState === stateName) {
            this.sendEvent(instanceId, {
              type: transition.event,
              payload: { reason: 'timeout' },
              timestamp: Date.now(),
            }).catch(error => {
              console.error(`Timeout event failed for ${instanceId}:`, error);
            });
          }

          // Remove taskId from tracking
          const tasks = this.timeoutTasks.get(instanceId);
          if (tasks) {
            const index = tasks.indexOf(taskId);
            if (index >= 0) tasks.splice(index, 1);
          }
        });
      }
    });
  }

  /**
   * Setup timeout transitions for self-loop
   *
   * Only sets up timeouts that should reset (resetOnTransition !== false).
   * Timeouts with resetOnTransition: false are already running and shouldn't be recreated.
   */
  private setupTimeoutsForSelfLoop(instanceId: string, stateName: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const machine = this.machines.get(instance.machineName);
    if (!machine) return;

    const timeoutTransitions = machine.transitions.filter(
      t => t.from === stateName && t.type === TransitionType.TIMEOUT
    );

    timeoutTransitions.forEach(transition => {
      // Only setup timeout if it should reset on self-loop (default behavior)
      if (transition.timeoutMs && transition.resetOnTransition !== false) {
        const taskId = `${instanceId}-${stateName}-${transition.event}`;

        // Track task for cleanup
        if (!this.timeoutTasks.has(instanceId)) {
          this.timeoutTasks.set(instanceId, []);
        }
        this.timeoutTasks.get(instanceId)!.push(taskId);

        // Use timer wheel instead of setTimeout
        this.timerWheel.addTimeout(taskId, transition.timeoutMs, () => {
          // Check if instance still exists and is in the same state
          const currentInstance = this.instances.get(instanceId);
          if (currentInstance && currentInstance.currentState === stateName) {
            this.sendEvent(instanceId, {
              type: transition.event,
              payload: { reason: 'timeout' },
              timestamp: Date.now(),
            }).catch(error => {
              console.error(`Timeout event failed for ${instanceId}:`, error);
            });
          }

          // Remove taskId from tracking
          const tasks = this.timeoutTasks.get(instanceId);
          if (tasks) {
            const index = tasks.indexOf(taskId);
            if (index >= 0) tasks.splice(index, 1);
          }
        });
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
      const taskId = `${instanceId}-${stateName}-auto-${transition.event}`;

      // Track task for cleanup
      if (!this.timeoutTasks.has(instanceId)) {
        this.timeoutTasks.set(instanceId, []);
      }
      this.timeoutTasks.get(instanceId)!.push(taskId);

      // Use timer wheel for auto-transitions
      this.timerWheel.addTimeout(taskId, delay, () => {
        // Check if instance still exists and is in the same state
        const currentInstance = this.instances.get(instanceId);
        if (currentInstance && currentInstance.currentState === stateName) {
          this.sendEvent(instanceId, {
            type: transition.event,
            payload: { reason: 'auto-transition' },
            timestamp: Date.now(),
          }).catch(error => {
            console.error(`Auto-transition failed for ${instanceId}:`, error);
          });
        }

        // Remove taskId from tracking
        const tasks = this.timeoutTasks.get(instanceId);
        if (tasks) {
          const index = tasks.indexOf(taskId);
          if (index >= 0) tasks.splice(index, 1);
        }
      });
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

    // CROSS-COMPONENT communication: delegate to ComponentRegistry
    if (rule.targetComponent) {
      if (!this.registry) {
        throw new Error(`Cross-component cascading rule requires a ComponentRegistry. Target: ${rule.targetComponent}.${rule.targetMachine}`);
      }

      // Use registry (ComponentRegistry) to broadcast to another component
      processedCount = await this.registry.broadcastToComponent(
        rule.targetComponent,
        rule.targetMachine,
        event,
        this.componentDef.name, // Pass source component name
        undefined, // No filters
        rule.targetState
      );

      this.emit('cross_component_cascade', {
        sourceInstanceId: sourceInstance.id,
        sourceComponent: this.componentDef.name,
        targetComponent: rule.targetComponent,
        targetMachine: rule.targetMachine,
        targetState: rule.targetState,
        event: rule.event,
        processedCount,
      });
    }
    // INTRA-COMPONENT communication: use local broadcastEvent
    else {
      if (rule.matchingRules && rule.matchingRules.length > 0) {
        // Use property-based routing
        processedCount = await this.broadcastEvent(rule.targetMachine, event, rule.targetState);
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
   * Clear timeouts for instance (using timer wheel)
   */
  private clearTimeouts(instanceId: string): void {
    const taskIds = this.timeoutTasks.get(instanceId);
    if (taskIds) {
      // Remove all timeout tasks for this instance
      taskIds.forEach(taskId => {
        this.timerWheel.removeTimeout(taskId);
      });
      this.timeoutTasks.delete(instanceId);
    }
  }

  /**
   * Clear timeouts for self-loop transition
   *
   * Only clears timeouts that should be reset on self-loop (resetOnTransition !== false).
   * Timeouts with resetOnTransition: false continue running.
   */
  private clearTimeoutsForSelfLoop(instanceId: string, stateName: string): void {
    const instance = this.instances.get(instanceId);
    if (!instance) return;

    const machine = this.machines.get(instance.machineName);
    if (!machine) return;

    // Find timeout transitions from this state
    const timeoutTransitions = machine.transitions.filter(
      t => t.from === stateName && t.type === TransitionType.TIMEOUT
    );

    const taskIds = this.timeoutTasks.get(instanceId);
    if (!taskIds) return;

    // Clear only timeouts that should reset (resetOnTransition !== false)
    const remainingTaskIds: string[] = [];

    taskIds.forEach(taskId => {
      // Parse state and event from taskId format: "{instanceId}-{stateName}-{eventType}"
      const parts = taskId.split('-');
      const taskState = parts[parts.length - 2]; // Second to last is state name
      const taskEvent = parts[parts.length - 1]; // Last is event type

      if (taskState === stateName) {
        // Find corresponding transition
        const transition = timeoutTransitions.find(t => t.event === taskEvent);

        if (transition) {
          // If resetOnTransition is false, keep the timeout running
          if (transition.resetOnTransition === false) {
            remainingTaskIds.push(taskId);
          } else {
            // Default behavior: reset on self-loop
            this.timerWheel.removeTimeout(taskId);
          }
        } else {
          // Unknown transition, remove it
          this.timerWheel.removeTimeout(taskId);
        }
      } else {
        // Different state, keep it
        remainingTaskIds.push(taskId);
      }
    });

    if (remainingTaskIds.length > 0) {
      this.timeoutTasks.set(instanceId, remainingTaskIds);
    } else {
      this.timeoutTasks.delete(instanceId);
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
          // Timeout still pending - reschedule with remaining time using timer wheel
          const taskId = `${instanceId}-${instance.currentState}-${transition.event}`;

          // Track task for cleanup
          if (!this.timeoutTasks.has(instanceId)) {
            this.timeoutTasks.set(instanceId, []);
          }
          this.timeoutTasks.get(instanceId)!.push(taskId);

          this.timerWheel.addTimeout(taskId, remainingMs, () => {
            const currentInstance = this.instances.get(instanceId);
            if (currentInstance && currentInstance.currentState === instance.currentState) {
              this.sendEvent(instanceId, {
                type: transition.event,
                payload: { reason: 'timeout' },
                timestamp: Date.now(),
              }).catch(error => {
                console.error(`Timeout resync failed for ${instanceId}:`, error);
              });
            }

            // Remove taskId from tracking
            const tasks = this.timeoutTasks.get(instanceId);
            if (tasks) {
              const index = tasks.indexOf(taskId);
              if (index >= 0) tasks.splice(index, 1);
            }
          });

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

        const taskId = `${instanceId}-${instance.currentState}-auto-${transition.event}`;

        // Track task for cleanup
        if (!this.timeoutTasks.has(instanceId)) {
          this.timeoutTasks.set(instanceId, []);
        }
        this.timeoutTasks.get(instanceId)!.push(taskId);

        this.timerWheel.addTimeout(taskId, remainingMs, () => {
          const currentInstance = this.instances.get(instanceId);
          if (currentInstance && currentInstance.currentState === instance.currentState) {
            this.sendEvent(instanceId, {
              type: transition.event,
              payload: { reason: 'auto-transition' },
              timestamp: Date.now(),
            }).catch(error => {
              console.error(`Auto-transition resync failed for ${instanceId}:`, error);
            });
          }

          // Remove taskId from tracking
          const tasks = this.timeoutTasks.get(instanceId);
          if (tasks) {
            const index = tasks.indexOf(taskId);
            if (index >= 0) tasks.splice(index, 1);
          }
        });

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
   * Get all persisted events for this component
   */
  async getAllPersistedEvents(): Promise<import('./types').PersistedEvent[]> {
    if (!this.persistence) {
      return [];
    }

    return await this.persistence.getAllEvents();
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
   * Get component name
   */
  getComponentName(): string {
    return this.componentDef.name;
  }

  /**
   * Set component registry for cross-component communication
   */
  setRegistry(registry: ComponentRegistry): void {
    this.registry = registry;
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

  /**
   * Stop the runtime and cleanup resources
   * Important: Call this when done to prevent memory leaks from timer wheel
   */
  dispose(): void {
    // Stop timer wheel
    this.timerWheel.stop();

    // Clear all instances
    this.instances.clear();
    this.timeoutTasks.clear();

    // Clear indexes
    this.machineIndex.clear();
    this.stateIndex.clear();
    this.propertyIndex.clear();

    // Remove all event listeners
    this.removeAllListeners();
  }
}

/**
 * Load component from object
 */
export function loadComponent(data: any): Component {
  return data as Component;
}
