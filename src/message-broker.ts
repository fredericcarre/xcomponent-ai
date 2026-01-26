/**
 * Message Broker abstraction for cross-component communication
 * Supports both in-memory (single process) and distributed (multi-process) modes
 */

import { EventEmitter } from 'events';
import { FSMEvent } from './types';

/**
 * Property filter for instance targeting
 */
export interface PropertyFilter {
  property: string;
  operator?: '===' | '!==' | '>' | '<' | '>=' | '<=';
  value: any;
}

/**
 * Message sent between components
 */
export interface CrossComponentMessage {
  sourceComponent: string;
  targetComponent: string;
  targetMachine: string;
  targetState: string;
  event: FSMEvent;
  payload?: Record<string, any>;
  /** Optional filters to target specific instances based on context properties */
  filters?: PropertyFilter[];
}

/**
 * Message Broker interface
 * Abstracts communication mechanism (in-memory, Redis, NATS, etc.)
 */
export interface MessageBroker {
  /**
   * Publish a message to a channel
   * Accepts CrossComponentMessage or any other message type for flexibility
   */
  publish(channel: string, message: CrossComponentMessage | Record<string, any>): Promise<void>;

  /**
   * Subscribe to messages on a channel
   * Handler receives any message type for flexibility
   */
  subscribe(channel: string, handler: (message: any) => void): void;

  /**
   * Unsubscribe from a component's messages
   */
  unsubscribe(componentName: string): void;

  /**
   * Connect to the broker (for distributed brokers)
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the broker
   */
  disconnect(): Promise<void>;

  /**
   * Check if broker is connected
   */
  isConnected(): boolean;
}

/**
 * In-Memory Message Broker
 * For single-process deployment (default)
 */
export class InMemoryMessageBroker extends EventEmitter implements MessageBroker {
  private handlers: Map<string, (message: CrossComponentMessage) => void> = new Map();
  private channelHandlers: Map<string, Set<(message: any) => void>> = new Map();
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.handlers.clear();
    this.channelHandlers.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(channel: string, message: CrossComponentMessage | any): Promise<void> {
    // Check if this is a cross-component message (has targetComponent field)
    if (message.targetComponent) {
      // Cross-component message: use component-based routing
      const handler = this.handlers.get(message.targetComponent);
      if (handler) {
        // Async invocation to simulate network behavior
        setImmediate(() => handler(message));
      }
    } else {
      // General channel-based message (e.g., xcomponent:events:state_change)
      const handlers = this.channelHandlers.get(channel);
      if (handlers && handlers.size > 0) {
        // Async invocation to simulate network behavior
        setImmediate(() => {
          handlers.forEach(handler => handler(message));
        });
      }
    }
  }

  subscribe(channelOrComponent: string, handler: (message: any) => void): void {
    // If contains ':', treat as channel subscription (e.g., 'xcomponent:events:state_change')
    // Otherwise, treat as component name for cross-component messages
    if (channelOrComponent.includes(':')) {
      // Channel-based subscription
      if (!this.channelHandlers.has(channelOrComponent)) {
        this.channelHandlers.set(channelOrComponent, new Set());
      }
      this.channelHandlers.get(channelOrComponent)!.add(handler);
    } else {
      // Component-based subscription (backward compatibility)
      this.handlers.set(channelOrComponent, handler);
    }
  }

  unsubscribe(channelOrComponent: string): void {
    if (channelOrComponent.includes(':')) {
      // Channel-based unsubscription
      this.channelHandlers.delete(channelOrComponent);
    } else {
      // Component-based unsubscription
      this.handlers.delete(channelOrComponent);
    }
  }
}

/**
 * Redis Pub/Sub Message Broker
 * For distributed multi-process deployment
 *
 * Supported URL formats:
 * - redis://localhost:6379                    (no auth)
 * - redis://:password@localhost:6379          (password only)
 * - redis://username:password@localhost:6379  (username + password)
 * - redis://localhost:6379/2                  (specific database)
 * - rediss://localhost:6380                   (TLS/SSL)
 *
 * Query parameters:
 * - redis://localhost:6379?connectTimeout=5000
 *
 * Example:
 * ```typescript
 * const broker = new RedisMessageBroker('redis://:mypassword@prod-redis.example.com:6379/0');
 * await broker.connect();
 * ```
 */
export class RedisMessageBroker implements MessageBroker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private publishClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private subscribeClient: any;
  private handlers: Map<string, (message: CrossComponentMessage) => void> = new Map();
  private connected = false;
  private redisUrl: string;

  /**
   * Create a Redis message broker
   *
   * @param redisUrl Redis connection URL (supports authentication, TLS, database selection)
   */
  constructor(redisUrl: string) {
    this.redisUrl = redisUrl;
  }

  async connect(): Promise<void> {
    try {
      // Lazy dynamic import to make Redis optional dependency
      // This allows the package to work without redis installed
      const redisModule = await import('redis' as any);
      const createClient = redisModule.createClient || redisModule.default?.createClient;

      if (!createClient) {
        throw new Error('Redis createClient function not found');
      }

      this.publishClient = createClient({ url: this.redisUrl });
      this.subscribeClient = createClient({ url: this.redisUrl });

      await this.publishClient.connect();
      await this.subscribeClient.connect();

      this.connected = true;
    } catch (error) {
      throw new Error(
        `Failed to connect to Redis at ${this.redisUrl}. ` +
        'Make sure Redis is running and the "redis" package is installed (npm install redis). ' +
        `Error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.publishClient) {
      await this.publishClient.quit();
    }
    if (this.subscribeClient) {
      await this.subscribeClient.quit();
    }
    this.handlers.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(channel: string, message: CrossComponentMessage): Promise<void> {
    if (!this.connected) {
      throw new Error('RedisMessageBroker is not connected. Call connect() first.');
    }

    const serialized = JSON.stringify(message);
    await this.publishClient.publish(channel, serialized);
  }

  subscribe(componentName: string, handler: (message: CrossComponentMessage) => void): void {
    if (!this.connected) {
      throw new Error('RedisMessageBroker is not connected. Call connect() first.');
    }

    this.handlers.set(componentName, handler);

    const channel = `xcomponent:${componentName}`;

    this.subscribeClient.subscribe(channel, (messageJson: string) => {
      try {
        const message: CrossComponentMessage = JSON.parse(messageJson);
        const h = this.handlers.get(componentName);
        if (h) {
          h(message);
        }
      } catch (err) {
        console.error(`Failed to parse message from Redis channel ${channel}:`, err);
      }
    });
  }

  unsubscribe(componentName: string): void {
    this.handlers.delete(componentName);
    const channel = `xcomponent:${componentName}`;
    this.subscribeClient.unsubscribe(channel);
  }
}

/**
 * RabbitMQ Message Broker
 * For distributed multi-process deployment with reliable message delivery
 *
 * Supported URL formats:
 * - amqp://localhost:5672                       (no auth)
 * - amqp://user:password@localhost:5672         (with auth)
 * - amqp://user:password@localhost:5672/vhost   (with vhost)
 * - amqps://localhost:5671                      (TLS/SSL)
 *
 * Example:
 * ```typescript
 * const broker = new RabbitMQMessageBroker('amqp://guest:guest@localhost:5672');
 * await broker.connect();
 * ```
 */
export class RabbitMQMessageBroker implements MessageBroker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private publishChannel: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private subscribeChannel: any;
  private handlers: Map<string, (message: CrossComponentMessage) => void> = new Map();
  private channelHandlers: Map<string, Set<(message: any) => void>> = new Map();
  private connected = false;
  private amqpUrl: string;
  private exchangeName = 'xcomponent.events';

  /**
   * Create a RabbitMQ message broker
   *
   * @param amqpUrl RabbitMQ connection URL
   */
  constructor(amqpUrl: string) {
    this.amqpUrl = amqpUrl;
  }

  async connect(maxRetries: number = 10, initialDelayMs: number = 1000): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Lazy dynamic import to make amqplib optional dependency
        const amqplib = await import('amqplib' as any);
        const connect = amqplib.connect || amqplib.default?.connect;

        if (!connect) {
          throw new Error('amqplib connect function not found');
        }

        this.connection = await connect(this.amqpUrl);

        // Create separate channels for publish and subscribe
        this.publishChannel = await this.connection.createChannel();
        this.subscribeChannel = await this.connection.createChannel();

        // Declare the exchange for FSM events (topic exchange for flexible routing)
        await this.publishChannel.assertExchange(this.exchangeName, 'topic', { durable: true });
        await this.subscribeChannel.assertExchange(this.exchangeName, 'topic', { durable: true });

        // Handle connection close
        this.connection.on('close', () => {
          console.warn('[RabbitMQ] Connection closed');
          this.connected = false;
        });

        this.connection.on('error', (err: Error) => {
          console.error('[RabbitMQ] Connection error:', err.message);
        });

        this.connected = true;
        console.log('[RabbitMQ] Connected to', this.amqpUrl.replace(/:[^:@]+@/, ':***@'));
        return; // Success!
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          const delay = initialDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
          console.log(`[RabbitMQ] Connection attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(
      `Failed to connect to RabbitMQ at ${this.amqpUrl.replace(/:[^:@]+@/, ':***@')} after ${maxRetries} attempts. ` +
      'Make sure RabbitMQ is running and the "amqplib" package is installed (npm install amqplib). ' +
      `Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  async disconnect(): Promise<void> {
    if (this.publishChannel) {
      await this.publishChannel.close();
    }
    if (this.subscribeChannel) {
      await this.subscribeChannel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
    this.handlers.clear();
    this.channelHandlers.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(channel: string, message: CrossComponentMessage | any): Promise<void> {
    if (!this.connected) {
      throw new Error('RabbitMQMessageBroker is not connected. Call connect() first.');
    }

    const serialized = JSON.stringify(message);

    // Use channel as routing key (e.g., 'fsm.events.state_change', 'fsm.registry.announce')
    const routingKey = channel.replace(/:/g, '.');

    this.publishChannel.publish(
      this.exchangeName,
      routingKey,
      Buffer.from(serialized),
      { persistent: true }
    );
  }

  async subscribe(channelOrComponent: string, handler: (message: any) => void): Promise<void> {
    if (!this.connected) {
      throw new Error('RabbitMQMessageBroker is not connected. Call connect() first.');
    }

    // Convert channel format to routing key pattern
    const routingKey = channelOrComponent.includes(':')
      ? channelOrComponent.replace(/:/g, '.')
      : `xcomponent.${channelOrComponent}`;

    // Create a unique queue for this subscription
    const queueName = `xcomponent.${routingKey}.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;

    await this.subscribeChannel.assertQueue(queueName, {
      exclusive: true,
      autoDelete: true
    });

    await this.subscribeChannel.bindQueue(queueName, this.exchangeName, routingKey);

    // Store handler
    if (channelOrComponent.includes(':')) {
      if (!this.channelHandlers.has(channelOrComponent)) {
        this.channelHandlers.set(channelOrComponent, new Set());
      }
      this.channelHandlers.get(channelOrComponent)!.add(handler);
    } else {
      this.handlers.set(channelOrComponent, handler);
    }

    // Consume messages
    await this.subscribeChannel.consume(queueName, (msg: any) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());

          if (channelOrComponent.includes(':')) {
            const handlers = this.channelHandlers.get(channelOrComponent);
            if (handlers) {
              handlers.forEach(h => h(content));
            }
          } else {
            const h = this.handlers.get(channelOrComponent);
            if (h) {
              h(content);
            }
          }

          this.subscribeChannel.ack(msg);
        } catch (err) {
          console.error(`[RabbitMQ] Failed to parse message:`, err);
          this.subscribeChannel.nack(msg, false, false);
        }
      }
    });
  }

  unsubscribe(channelOrComponent: string): void {
    if (channelOrComponent.includes(':')) {
      this.channelHandlers.delete(channelOrComponent);
    } else {
      this.handlers.delete(channelOrComponent);
    }
    // Note: Queue will be auto-deleted when consumer disconnects
  }
}

/**
 * Factory function to create appropriate broker based on configuration
 */
export function createMessageBroker(brokerUrl?: string): MessageBroker {
  if (!brokerUrl || brokerUrl === 'memory' || brokerUrl === 'in-memory') {
    return new InMemoryMessageBroker();
  }

  if (brokerUrl.startsWith('redis://') || brokerUrl.startsWith('rediss://')) {
    return new RedisMessageBroker(brokerUrl);
  }

  if (brokerUrl.startsWith('amqp://') || brokerUrl.startsWith('amqps://')) {
    return new RabbitMQMessageBroker(brokerUrl);
  }

  throw new Error(`Unsupported broker URL: ${brokerUrl}. Supported: "memory", "redis://...", "amqp://..."`);
}
