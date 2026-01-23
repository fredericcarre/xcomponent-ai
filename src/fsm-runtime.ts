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
} from './types';
import type { MatchingRule } from './types';

/**
 * FSM Runtime Engine
 * Manages multiple FSM instances with event-driven execution
 */
export class FSMRuntime extends EventEmitter {
  private instances: Map<string, FSMInstance>;
  private machines: Map<string, StateMachine>;
  private timeouts: Map<string, NodeJS.Timeout>;

  constructor(component: Component) {
    super();
    this.instances = new Map();
    this.machines = new Map();
    this.timeouts = new Map();

    // Index machines by name
    component.stateMachines.forEach(machine => {
      this.machines.set(machine.name, machine);
    });
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
    this.emit('instance_created', instance);

    // Setup timeout transitions if any from initial state
    this.setupTimeouts(instanceId, machine.initialState);

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

      // Check if final or error state
      const targetState = machine.states.find(s => s.name === transition.to);
      if (targetState && (targetState.type === StateType.FINAL || targetState.type === StateType.ERROR)) {
        instance.status = targetState.type === StateType.FINAL ? 'completed' : 'error';
        this.emit('instance_disposed', instance);
        this.instances.delete(instanceId);
        return;
      }

      // Setup new timeouts
      this.setupTimeouts(instanceId, transition.to);

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
    // Get all instances of the target machine in the specified state
    const candidates = Array.from(this.instances.values()).filter(
      i => i.machineName === machineName && i.currentState === currentState && i.status === 'active'
    );

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
   */
  private async executeTransition(instance: FSMInstance, transition: Transition, event: FSMEvent): Promise<void> {
    // In production, execute triggered methods here
    if (transition.triggeredMethod) {
      this.emit('triggered_method', {
        instanceId: instance.id,
        method: transition.triggeredMethod,
        event,
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
}

/**
 * Load component from object
 */
export function loadComponent(data: any): Component {
  return data as Component;
}
