/**
 * Runtime Broadcaster
 *
 * Publishes FSM runtime events to the message broker for the distributed dashboard.
 * Attach this to an FSMRuntime to enable distributed monitoring.
 */

import { FSMRuntime } from './fsm-runtime';
import { MessageBroker, createMessageBroker } from './message-broker';
import { Component, StateType } from './types';
import { DashboardChannels, RuntimeRegistration, FSMEventBroadcast } from './dashboard-server';
import { v4 as uuidv4 } from 'uuid';

/**
 * Configuration for RuntimeBroadcaster
 */
export interface RuntimeBroadcasterConfig {
  /** Message broker URL (amqp://, redis://, or 'memory') */
  brokerUrl: string;
  /** Host address for this runtime (for direct connections) */
  host?: string;
  /** Port for this runtime */
  port?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
}

/**
 * Broadcasts FSM runtime events to the message broker
 */
export class RuntimeBroadcaster {
  private runtime: FSMRuntime;
  private broker: MessageBroker;
  private component: Component;
  private runtimeId: string;
  private config: RuntimeBroadcasterConfig;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private connected = false;

  constructor(
    runtime: FSMRuntime,
    component: Component,
    config: RuntimeBroadcasterConfig
  ) {
    this.runtime = runtime;
    this.component = component;
    this.config = config;
    this.runtimeId = uuidv4();
    this.broker = createMessageBroker(config.brokerUrl);
  }

  /**
   * Connect to the broker and start broadcasting events
   */
  async connect(): Promise<void> {
    console.log(`[RuntimeBroadcaster] Version: 2024-01-27-v3 - Connecting...`);
    await this.broker.connect();
    this.connected = true;

    // Subscribe to commands from dashboard
    await this.subscribeToCommands();
    console.log(`[RuntimeBroadcaster] Command subscriptions established`);

    // Register event listeners on the runtime
    this.attachRuntimeListeners();

    // Auto-create entry point instance based on configuration
    // Default: auto-create for singleton mode, no auto-create for multiple mode
    if (this.component.entryMachine) {
      const isSingleton = this.component.entryMachineMode === 'singleton';
      const shouldAutoCreate = this.component.autoCreateEntryPoint ?? isSingleton;

      if (shouldAutoCreate) {
        const existingInstances = this.runtime.getAllInstances();
        const hasEntryPointInstance = existingInstances.some(
          inst => inst.machineName === this.component.entryMachine && inst.isEntryPoint
        );

        if (!hasEntryPointInstance) {
          console.log(`[RuntimeBroadcaster] Creating entry point instance for ${this.component.entryMachine}`);
          const entryInstanceId = this.runtime.createInstance(this.component.entryMachine, {});
          // Mark as entry point (won't be auto-deallocated in final state)
          const instance = this.runtime.getInstance(entryInstanceId);
          if (instance) {
            (instance as any).isEntryPoint = true;
          }
          console.log(`[RuntimeBroadcaster] Entry point instance created: ${entryInstanceId}`);
        } else {
          console.log(`[RuntimeBroadcaster] Entry point instance already exists`);
        }
      } else {
        console.log(`[RuntimeBroadcaster] Auto-create disabled for entry point (create via API)`);
      }
    }

    // Announce this runtime to the dashboard
    await this.announce();

    // Start heartbeat
    this.startHeartbeat();

    console.log(`[RuntimeBroadcaster] Connected and broadcasting for ${this.component.name}`);
  }

  /**
   * Disconnect from the broker
   */
  async disconnect(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Notify dashboard of shutdown
    if (this.connected) {
      await this.broker.publish(DashboardChannels.RUNTIME_SHUTDOWN, {
        runtimeId: this.runtimeId,
        componentName: this.component.name,
        timestamp: Date.now()
      } as any);
    }

    await this.broker.disconnect();
    this.connected = false;
  }

  /**
   * Announce this runtime to the dashboard
   */
  private async announce(): Promise<void> {
    const registration: RuntimeRegistration = {
      runtimeId: this.runtimeId,
      componentName: this.component.name,
      component: this.component,
      host: this.config.host || 'localhost',
      port: this.config.port || 0,
      timestamp: Date.now()
    };

    await this.broker.publish(DashboardChannels.RUNTIME_ANNOUNCE, registration as any);
  }

  /**
   * Start sending heartbeats
   */
  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval || 30000;

    this.heartbeatTimer = setInterval(async () => {
      if (this.connected) {
        await this.broker.publish(DashboardChannels.RUNTIME_HEARTBEAT, {
          runtimeId: this.runtimeId,
          componentName: this.component.name,
          timestamp: Date.now()
        } as any);
      }
    }, interval);
  }

  /**
   * Attach listeners to runtime events
   */
  private attachRuntimeListeners(): void {
    // Event ignored (no transition found for event)
    this.runtime.on('event_ignored', (data) => {
      console.log(`[RuntimeBroadcaster] Event IGNORED: ${data.event.type} in state ${data.currentState} for instance ${data.instanceId}`);
    });

    // State change
    this.runtime.on('state_change', async (data) => {
      const broadcast: FSMEventBroadcast = {
        runtimeId: this.runtimeId,
        componentName: this.component.name,
        eventType: 'state_change',
        data: {
          instanceId: data.instanceId,
          machineName: data.machineName,
          previousState: data.previousState,
          newState: data.newState,
          event: data.event,
          context: data.instance?.context || data.context,
          pendingTimeouts: data.pendingTimeouts || []
        },
        timestamp: Date.now()
      };

      await this.broker.publish(DashboardChannels.STATE_CHANGE, broadcast as any);
    });

    // Instance created
    this.runtime.on('instance_created', async (data) => {
      console.log(`[RuntimeBroadcaster] Instance created: ${data.id || data.instanceId} (${data.machineName}) - broadcasting`);
      const broadcast: FSMEventBroadcast = {
        runtimeId: this.runtimeId,
        componentName: this.component.name,
        eventType: 'instance_created',
        data: {
          instanceId: data.id || data.instanceId,
          machineName: data.machineName,
          currentState: data.currentState,
          context: data.context
        },
        timestamp: Date.now()
      };

      await this.broker.publish(DashboardChannels.INSTANCE_CREATED, broadcast as any);
      console.log(`[RuntimeBroadcaster] INSTANCE_CREATED published for ${data.id || data.instanceId}`);
    });

    // Instance completed (terminal state reached)
    this.runtime.on('state_change', async (data) => {
      // Check if the new state is terminal (FINAL or ERROR type)
      const machine = this.component.stateMachines.find(m => m.name === data.machineName);
      const state = machine?.states.find(s => s.name === data.newState);

      if (state?.type === StateType.FINAL || state?.type === StateType.ERROR) {
        const broadcast: FSMEventBroadcast = {
          runtimeId: this.runtimeId,
          componentName: this.component.name,
          eventType: 'instance_completed',
          data: {
            instanceId: data.instanceId,
            machineName: data.machineName,
            finalState: data.newState,
            context: data.instance?.context || data.context
          },
          timestamp: Date.now()
        };

        await this.broker.publish(DashboardChannels.INSTANCE_COMPLETED, broadcast as any);
      }
    });

    // Cross-component transition
    this.runtime.on('cross_component_transition', async (data) => {
      console.log(`[RuntimeBroadcaster] Cross-component transition detected:`);
      console.log(`  Source: ${data.sourceComponent}.${data.sourceMachine} (${data.sourceInstanceId})`);
      console.log(`  Target: ${data.targetComponent}.${data.targetMachine}`);
      console.log(`  Target Event: ${data.targetEvent || '(create new instance)'}`);
      console.log(`  Context: ${JSON.stringify(data.context)}`);

      try {
        if (data.targetEvent) {
          // Send event to existing instances (e.g., Payment.COMPLETE -> Order.PAYMENT_CONFIRMED)
          if (!data.matchingRules || data.matchingRules.length === 0) {
            console.warn(`[RuntimeBroadcaster] WARNING: cross_component transition to ${data.targetComponent}.${data.targetMachine} with targetEvent=${data.targetEvent} has no matchingRules. Event will NOT be dispatched to avoid broadcasting to all instances. Add matchingRules to the transition.`);
            return;
          }
          // Build explicit match criteria from matchingRules + source context
          const matchCriteria = data.matchingRules.map((rule: any) => ({
            eventProperty: rule.eventProperty,
            instanceProperty: rule.instanceProperty,
            operator: rule.operator || '===',
            value: data.context?.[rule.eventProperty],
          }));
          console.log(`[RuntimeBroadcaster] Publishing CROSS_COMPONENT_EVENT for ${data.targetEvent} with ${matchCriteria.length} matching rule(s)`);
          await this.broker.publish(DashboardChannels.CROSS_COMPONENT_EVENT, {
            targetComponent: data.targetComponent,
            targetMachine: data.targetMachine,
            event: { type: data.targetEvent, payload: data.context, timestamp: Date.now() },
            matchingRules: matchCriteria,
            sourceComponent: data.sourceComponent,
            sourceInstanceId: data.sourceInstanceId,
            timestamp: Date.now()
          } as any);
          console.log(`[RuntimeBroadcaster] CROSS_COMPONENT_EVENT published`);
        } else {
          // Create new instance in target component (e.g., Order.SUBMIT -> creates Payment)
          console.log(`[RuntimeBroadcaster] Publishing CREATE_INSTANCE for ${data.targetComponent}`);
          await this.broker.publish(DashboardChannels.CREATE_INSTANCE, {
            componentName: data.targetComponent,
            machineName: data.targetMachine,
            context: data.context,
            sourceComponent: data.sourceComponent,
            sourceInstanceId: data.sourceInstanceId,
            timestamp: Date.now()
          } as any);
          console.log(`[RuntimeBroadcaster] CREATE_INSTANCE published`);
        }
      } catch (error: any) {
        console.error(`[RuntimeBroadcaster] Failed to publish cross-component message:`, error.message);
      }
    });
  }

  /**
   * Subscribe to commands from dashboard
   */
  private async subscribeToCommands(): Promise<void> {
    // Trigger event command
    await this.broker.subscribe(DashboardChannels.TRIGGER_EVENT, async (msg: any) => {
      console.log(`[RuntimeBroadcaster] Received TRIGGER_EVENT for ${msg.componentName || 'any'}:${msg.instanceId}`);

      // Only process if componentName matches or not specified
      if (msg.componentName && msg.componentName !== this.component.name) {
        console.log(`[RuntimeBroadcaster] Ignoring - not for ${this.component.name}`);
        return; // Not for this component
      }

      try {
        const instance = this.runtime.getInstance(msg.instanceId);
        if (instance) {
          console.log(`[RuntimeBroadcaster] Processing event ${msg.event.type} for instance ${msg.instanceId} (state: ${instance.currentState})`);
          await this.runtime.sendEvent(msg.instanceId, msg.event);
          console.log(`[RuntimeBroadcaster] Triggered event ${msg.event.type} on ${msg.instanceId}`);
        } else {
          console.log(`[RuntimeBroadcaster] Instance ${msg.instanceId} not found in ${this.component.name}`);
          // Log all known instances for debugging
          const allInstances = this.runtime.getAllInstances();
          console.log(`[RuntimeBroadcaster] Known instances: ${allInstances.map(i => i.id).join(', ') || 'none'}`);
        }
      } catch (error: any) {
        console.error(`[RuntimeBroadcaster] Failed to trigger event:`, error.message);
      }
    });

    // Create instance command
    await this.broker.subscribe(DashboardChannels.CREATE_INSTANCE, async (msg: any) => {
      console.log(`[RuntimeBroadcaster] Received CREATE_INSTANCE for ${msg.componentName} (this: ${this.component.name})`);
      if (msg.componentName === this.component.name) {
        try {
          // Use specified machine or fall back to entry machine
          const machineName = msg.machineName || this.component.entryMachine;
          if (!machineName) {
            console.error(`[RuntimeBroadcaster] No machine specified and no entry machine defined`);
            return;
          }

          // Check singleton mode for entry machine
          if (machineName === this.component.entryMachine &&
              this.component.entryMachineMode === 'singleton') {
            const existingInstances = this.runtime.getAllInstances()
              .filter(i => i.machineName === this.component.entryMachine);
            if (existingInstances.length > 0) {
              console.log(`[RuntimeBroadcaster] Singleton mode: entry point instance already exists, ignoring CREATE_INSTANCE`);
              return;
            }
          }

          const instanceId = this.runtime.createInstance(machineName, msg.context || {});

          if (msg.sourceComponent) {
            console.log(`[RuntimeBroadcaster] Created instance ${instanceId} (cross-component from ${msg.sourceComponent})`);
          } else {
            console.log(`[RuntimeBroadcaster] Created instance ${instanceId}`);
          }
        } catch (error: any) {
          console.error(`[RuntimeBroadcaster] Failed to create instance:`, error.message);
        }
      }
    });

    // Query instances command
    await this.broker.subscribe(DashboardChannels.QUERY_INSTANCES, async (_msg: any) => {
      // Re-announce ourselves so late-starting dashboards discover us
      await this.announce();

      const instances = this.runtime.getAllInstances().map(inst => ({
        id: inst.id,
        machineName: inst.machineName,
        currentState: inst.currentState,
        context: inst.context,
        pendingTimeouts: this.runtime.getPendingTimeouts(inst.id)
      }));

      await this.broker.publish(DashboardChannels.QUERY_RESPONSE, {
        type: 'instances',
        runtimeId: this.runtimeId,
        componentName: this.component.name,
        instances,
        timestamp: Date.now()
      } as any);
    });

    // Cross-component event command (send event to existing instances)
    await this.broker.subscribe(DashboardChannels.CROSS_COMPONENT_EVENT, async (msg: any) => {
      console.log(`[RuntimeBroadcaster] Received CROSS_COMPONENT_EVENT for ${msg.targetComponent} (this component: ${this.component.name})`);

      if (msg.targetComponent === this.component.name) {
        console.log(`[RuntimeBroadcaster] Processing cross-component event ${msg.event?.type} for ${this.component.name}`);

        try {
          // Require explicit matchingRules — no implicit broadcast
          if (!msg.matchingRules || msg.matchingRules.length === 0) {
            console.warn(`[RuntimeBroadcaster] REJECTED: cross-component event ${msg.event?.type} has no matchingRules. Refusing to broadcast to all instances. Fix the source transition definition.`);
            return;
          }

          // Find matching instances using explicit matchingRules
          const allInstances = this.runtime.getAllInstances();
          console.log(`[RuntimeBroadcaster] Found ${allInstances.length} total instances, applying ${msg.matchingRules.length} matching rule(s)`);

          const matchingInstances = allInstances.filter(inst => {
            // If targetMachine is specified, filter by machine
            if (msg.targetMachine && inst.machineName !== msg.targetMachine) {
              return false;
            }
            // Apply ALL matchingRules (AND logic)
            const context = inst.context || inst.publicMember || {};
            for (const rule of msg.matchingRules) {
              const expectedValue = rule.value;
              const actualValue = context[rule.instanceProperty];
              const op = rule.operator || '===';
              let match = false;
              switch (op) {
                case '===': match = actualValue === expectedValue; break;
                case '!==': match = actualValue !== expectedValue; break;
                case '>': match = actualValue > expectedValue; break;
                case '<': match = actualValue < expectedValue; break;
                case '>=': match = actualValue >= expectedValue; break;
                case '<=': match = actualValue <= expectedValue; break;
                default: match = actualValue === expectedValue;
              }
              if (!match) {
                return false;
              }
            }
            return true;
          });

          console.log(`[RuntimeBroadcaster] Matching instances found: ${matchingInstances.length} (rules: ${JSON.stringify(msg.matchingRules)})`);

          if (matchingInstances.length === 0) {
            console.log(`[RuntimeBroadcaster] No matching instances for cross-component event ${msg.event.type}`);
            return;
          }

          // Send event to matched instances only
          for (const inst of matchingInstances) {
            try {
              await this.runtime.sendEvent(inst.id, msg.event);
              console.log(`[RuntimeBroadcaster] Sent cross-component event ${msg.event.type} to ${inst.id} (matched by ${msg.matchingRules.map((r: any) => r.instanceProperty).join(', ')})`);
            } catch (error: any) {
              console.error(`[RuntimeBroadcaster] Failed to send event to ${inst.id}:`, error.message);
            }
          }
        } catch (error: any) {
          console.error(`[RuntimeBroadcaster] Failed to handle cross-component event:`, error.message);
        }
      }
    });
  }

  /**
   * Get the runtime ID
   */
  getRuntimeId(): string {
    return this.runtimeId;
  }
}

/**
 * Helper function to create a broadcaster and connect it
 */
export async function createRuntimeBroadcaster(
  runtime: FSMRuntime,
  component: Component,
  brokerUrl: string,
  options?: Partial<RuntimeBroadcasterConfig>
): Promise<RuntimeBroadcaster> {
  const broadcaster = new RuntimeBroadcaster(runtime, component, {
    brokerUrl,
    ...options
  });

  await broadcaster.connect();
  return broadcaster;
}
