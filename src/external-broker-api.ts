/**
 * External Broker API
 *
 * Enables external systems to interact with xcomponent-ai via message broker
 * WITHOUT needing HTTP API access. This is useful for:
 * - Microservices communicating via message bus
 * - Event-driven architectures
 * - Language-agnostic integrations (Python, Go, Java can use Redis/RabbitMQ clients)
 * - Real-time subscriptions to FSM events
 *
 * Channels:
 * - `xcomponent:external:commands` - Send events to FSM instances from external systems
 * - `xcomponent:events:state_change` - Subscribe to state transitions
 * - `xcomponent:events:instance_created` - Subscribe to instance creations
 * - `xcomponent:events:instance_disposed` - Subscribe to instance disposals
 */

import { MessageBroker } from './message-broker';
import { ComponentRegistry } from './component-registry';
import { FSMEvent } from './types';

/**
 * External command to send event to FSM instance
 */
export interface ExternalCommand {
  /** Component name */
  componentName: string;
  /** Instance ID to target */
  instanceId: string;
  /** Event to send */
  event: FSMEvent;
}

/**
 * External broadcast command (sends to all instances in a state)
 */
export interface ExternalBroadcastCommand {
  /** Component name */
  componentName: string;
  /** Machine name */
  machineName: string;
  /** Current state filter */
  currentState: string;
  /** Event to broadcast */
  event: FSMEvent;
}

/**
 * Published FSM event for external subscribers
 */
export interface PublishedFSMEvent {
  /** Event type (state_change, instance_created, etc.) */
  type: string;
  /** Component name */
  componentName: string;
  /** Event data */
  data: any;
  /** Timestamp */
  timestamp: number;
}

/**
 * External Broker API Configuration
 */
export interface ExternalBrokerConfig {
  /** Message broker to use */
  broker: MessageBroker;
  /** Component registry */
  registry: ComponentRegistry;
  /** Publish FSM events to broker (default: false) */
  publishEvents?: boolean;
  /** Handle external commands (default: true) */
  handleCommands?: boolean;
}

/**
 * External Broker API
 *
 * Provides message broker-based API for external systems
 */
export class ExternalBrokerAPI {
  private broker: MessageBroker;
  private registry: ComponentRegistry;
  private publishEvents: boolean;
  private handleCommands: boolean;

  constructor(config: ExternalBrokerConfig) {
    this.broker = config.broker;
    this.registry = config.registry;
    this.publishEvents = config.publishEvents ?? false;
    this.handleCommands = config.handleCommands ?? true;
  }

  /**
   * Initialize the external API
   * - Subscribe to external commands
   * - Forward FSM events to broker (if enabled)
   */
  async initialize(): Promise<void> {
    // Handle external commands
    if (this.handleCommands) {
      await this.subscribeToExternalCommands();
    }

    // Publish FSM events to broker
    if (this.publishEvents) {
      this.forwardFSMEventsToBroker();
    }
  }

  /**
   * Subscribe to external commands channel
   * External systems can publish commands to control FSM instances
   */
  private async subscribeToExternalCommands(): Promise<void> {
    // Subscribe to direct instance commands
    this.broker.subscribe('external:commands', async (message: any) => {
      try {
        const cmd = message as ExternalCommand;

        // Validate command
        if (!cmd.componentName || !cmd.instanceId || !cmd.event) {
          throw new Error('Invalid external command format');
        }

        // Send event to instance
        await this.registry.sendEventToComponent(
          cmd.componentName,
          cmd.instanceId,
          cmd.event
        );
      } catch (error) {
        console.error('[ExternalBrokerAPI] Command error:', error);
      }
    });

    // Subscribe to broadcast commands
    this.broker.subscribe('external:broadcasts', async (message: any) => {
      try {
        const cmd = message as ExternalBroadcastCommand;

        // Validate command
        if (!cmd.componentName || !cmd.machineName || !cmd.currentState || !cmd.event) {
          throw new Error('Invalid external broadcast command format');
        }

        // Broadcast event
        await this.registry.broadcastToComponent(
          cmd.componentName,
          cmd.machineName,
          cmd.currentState,
          cmd.event,
          'external'
        );
      } catch (error) {
        console.error('[ExternalBrokerAPI] Broadcast error:', error);
      }
    });
  }

  /**
   * Forward FSM events to message broker for external subscribers
   */
  private forwardFSMEventsToBroker(): void {
    // State changes
    this.registry.on('state_change', (data: any) => {
      this.publishEvent('state_change', data);
    });

    // Instance created
    this.registry.on('instance_created', (data: any) => {
      this.publishEvent('instance_created', data);
    });

    // Instance disposed
    this.registry.on('instance_disposed', (data: any) => {
      this.publishEvent('instance_disposed', data);
    });

    // Instance errors
    this.registry.on('instance_error', (data: any) => {
      this.publishEvent('instance_error', data);
    });

    // Cross-component cascades (for monitoring)
    this.registry.on('cross_component_cascade', (data: any) => {
      this.publishEvent('cross_component_cascade', data);
    });
  }

  /**
   * Publish an FSM event to the broker
   */
  private async publishEvent(type: string, data: any): Promise<void> {
    const event: PublishedFSMEvent = {
      type,
      componentName: data.componentName || 'unknown',
      data,
      timestamp: Date.now(),
    };

    const channel = `xcomponent:events:${type}`;

    try {
      // For in-memory broker, we need to cast the message type
      await this.broker.publish(channel, event as any);
    } catch (error) {
      console.error(`[ExternalBrokerAPI] Failed to publish ${type}:`, error);
    }
  }

  /**
   * Cleanup
   */
  async dispose(): Promise<void> {
    if (this.handleCommands) {
      this.broker.unsubscribe('external:commands');
      this.broker.unsubscribe('external:broadcasts');
    }

    this.registry.removeAllListeners();
  }
}

/**
 * Helper: Publish external command to message broker
 * (For use by external systems)
 *
 * Example (from Node.js):
 * ```typescript
 * import { createClient } from 'redis';
 *
 * const redis = createClient({ url: 'redis://localhost:6379' });
 * await redis.connect();
 *
 * await publishExternalCommand(redis, {
 *   componentName: 'OrderComponent',
 *   instanceId: 'order-123',
 *   event: { type: 'VALIDATE', payload: {} }
 * });
 * ```
 *
 * Example (from Python):
 * ```python
 * import redis
 * import json
 *
 * r = redis.Redis(host='localhost', port=6379)
 * r.publish('xcomponent:external:commands', json.dumps({
 *   'componentName': 'OrderComponent',
 *   'instanceId': 'order-123',
 *   'event': {'type': 'VALIDATE', 'payload': {}}
 * }))
 * ```
 */
export async function publishExternalCommand(
  redisClient: any,
  command: ExternalCommand
): Promise<void> {
  await redisClient.publish(
    'xcomponent:external:commands',
    JSON.stringify(command)
  );
}

/**
 * Helper: Subscribe to FSM events from external systems
 *
 * Example (from Node.js):
 * ```typescript
 * import { createClient } from 'redis';
 *
 * const redis = createClient({ url: 'redis://localhost:6379' });
 * await redis.connect();
 *
 * await subscribeToFSMEvents(redis, 'state_change', (event) => {
 *   console.log('State changed:', event);
 * });
 * ```
 *
 * Example (from Python):
 * ```python
 * import redis
 * import json
 *
 * r = redis.Redis(host='localhost', port=6379)
 * pubsub = r.pubsub()
 * pubsub.subscribe('xcomponent:events:state_change')
 *
 * for message in pubsub.listen():
 *   if message['type'] == 'message':
 *     event = json.loads(message['data'])
 *     print('State changed:', event)
 * ```
 */
export async function subscribeToFSMEvents(
  redisClient: any,
  eventType: string,
  handler: (event: PublishedFSMEvent) => void
): Promise<void> {
  const channel = `xcomponent:events:${eventType}`;

  await redisClient.subscribe(channel, (message: string) => {
    try {
      const event: PublishedFSMEvent = JSON.parse(message);
      handler(event);
    } catch (error) {
      console.error(`Failed to parse FSM event from ${channel}:`, error);
    }
  });
}
