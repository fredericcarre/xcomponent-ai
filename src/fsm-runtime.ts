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
   */
  createInstance(machineName: string, initialContext: Record<string, any> = {}): string {
    const machine = this.machines.get(machineName);
    if (!machine) {
      throw new Error(`Machine ${machineName} not found`);
    }

    const instanceId = uuidv4();
    const instance: FSMInstance = {
      id: instanceId,
      machineName,
      currentState: machine.initialState,
      context: initialContext,
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

    // Find applicable transition
    const transition = this.findTransition(machine, instance.currentState, event);
    if (!transition) {
      this.emit('event_ignored', { instanceId, event, currentState: instance.currentState });
      return;
    }

    // Check guards
    if (transition.guards && !this.evaluateGuards(transition.guards, event, instance.context)) {
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
   * Find applicable transition
   */
  private findTransition(machine: StateMachine, currentState: string, event: FSMEvent): Transition | null {
    return machine.transitions.find(t => t.from === currentState && t.event === event.type) || null;
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
      const transition = this.findTransition(machine, currentState, event);
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
