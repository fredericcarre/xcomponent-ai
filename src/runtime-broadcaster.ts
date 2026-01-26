/**
 * Runtime Broadcaster
 *
 * Publishes FSM runtime events to the message broker for the distributed dashboard.
 * Attach this to an FSMRuntime to enable distributed monitoring.
 */

import { FSMRuntime } from './fsm-runtime';
import { MessageBroker, createMessageBroker } from './message-broker';
import { Component } from './types';
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
    await this.broker.connect();
    this.connected = true;

    // Subscribe to commands from dashboard
    await this.subscribeToCommands();

    // Register event listeners on the runtime
    this.attachRuntimeListeners();

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
      });
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

    await this.broker.publish(DashboardChannels.RUNTIME_ANNOUNCE, registration);
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
        });
      }
    }, interval);
  }

  /**
   * Attach listeners to runtime events
   */
  private attachRuntimeListeners(): void {
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
          context: data.context,
          pendingTimeouts: data.pendingTimeouts || []
        },
        timestamp: Date.now()
      };

      await this.broker.publish(DashboardChannels.STATE_CHANGE, broadcast);
    });

    // Instance created
    this.runtime.on('instance_created', async (data) => {
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

      await this.broker.publish(DashboardChannels.INSTANCE_CREATED, broadcast);
    });

    // Instance completed (terminal state reached)
    this.runtime.on('state_change', async (data) => {
      // Check if the new state is terminal
      const machine = this.component.stateMachines.find(m => m.name === data.machineName);
      const state = machine?.states.find(s => s.name === data.newState);

      if (state?.terminal) {
        const broadcast: FSMEventBroadcast = {
          runtimeId: this.runtimeId,
          componentName: this.component.name,
          eventType: 'instance_completed',
          data: {
            instanceId: data.instanceId,
            machineName: data.machineName,
            finalState: data.newState
          },
          timestamp: Date.now()
        };

        await this.broker.publish(DashboardChannels.INSTANCE_COMPLETED, broadcast);
      }
    });
  }

  /**
   * Subscribe to commands from dashboard
   */
  private async subscribeToCommands(): Promise<void> {
    // Trigger event command
    await this.broker.subscribe(DashboardChannels.TRIGGER_EVENT, async (msg: any) => {
      try {
        const instance = this.runtime.getInstance(msg.instanceId);
        if (instance) {
          await this.runtime.trigger(msg.instanceId, msg.event);
          console.log(`[RuntimeBroadcaster] Triggered event ${msg.event.type} on ${msg.instanceId}`);
        }
      } catch (error: any) {
        console.error(`[RuntimeBroadcaster] Failed to trigger event:`, error.message);
      }
    });

    // Create instance command
    await this.broker.subscribe(DashboardChannels.CREATE_INSTANCE, async (msg: any) => {
      if (msg.componentName === this.component.name) {
        try {
          const instance = await this.runtime.createInstance(
            this.component.entryMachine,
            msg.context || {},
            msg.event || { type: 'START', payload: {} }
          );
          console.log(`[RuntimeBroadcaster] Created instance ${instance.id}`);
        } catch (error: any) {
          console.error(`[RuntimeBroadcaster] Failed to create instance:`, error.message);
        }
      }
    });

    // Query instances command
    await this.broker.subscribe(DashboardChannels.QUERY_INSTANCES, async (_msg: any) => {
      const instances = this.runtime.getAllInstances().map(inst => ({
        id: inst.id,
        machineName: inst.machineName,
        currentState: inst.currentState,
        context: inst.context,
        pendingTimeouts: inst.pendingTimeouts || []
      }));

      await this.broker.publish(DashboardChannels.QUERY_RESPONSE, {
        type: 'instances',
        runtimeId: this.runtimeId,
        componentName: this.component.name,
        instances,
        timestamp: Date.now()
      });
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
