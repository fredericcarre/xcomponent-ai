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
   * Returns Promise for async brokers (RabbitMQ, Redis) or void for sync brokers (memory)
   */
  subscribe(channel: string, handler: (message: any) => void): void | Promise<void>;

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
 *
 * Uses singleton pattern when accessed via createMessageBroker('memory')
 * to ensure all runtimes in the same process share the same broker.
 */
export class InMemoryMessageBroker extends EventEmitter implements MessageBroker {
  private static instance: InMemoryMessageBroker | null = null;

  private handlers: Map<string, (message: CrossComponentMessage) => void> = new Map();
  private channelHandlers: Map<string, Set<(message: any) => void>> = new Map();
  private connected = false;

  /**
   * Get the singleton instance (used by createMessageBroker)
   */
  static getInstance(): InMemoryMessageBroker {
    if (!InMemoryMessageBroker.instance) {
      InMemoryMessageBroker.instance = new InMemoryMessageBroker();
    }
    return InMemoryMessageBroker.instance;
  }

  /**
   * Reset the singleton (useful for testing)
   */
  static resetInstance(): void {
    if (InMemoryMessageBroker.instance) {
      InMemoryMessageBroker.instance.handlers.clear();
      InMemoryMessageBroker.instance.channelHandlers.clear();
      InMemoryMessageBroker.instance.connected = false;
    }
    InMemoryMessageBroker.instance = null;
  }

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
    // Always use channel-based routing first (this is the primary mechanism)
    const channelHandlers = this.channelHandlers.get(channel);
    if (channelHandlers && channelHandlers.size > 0) {
      // Async invocation to simulate network behavior
      setImmediate(() => {
        channelHandlers.forEach(handler => handler(message));
      });
    }

    // Fallback to component-based routing for backward compatibility
    // (only if message has targetComponent and no channel handlers matched)
    if (message.targetComponent && (!channelHandlers || channelHandlers.size === 0)) {
      const handler = this.handlers.get(message.targetComponent);
      if (handler) {
        // Async invocation to simulate network behavior
        setImmediate(() => handler(message));
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
  private channelHandlers: Map<string, Set<(message: any) => void>> = new Map();
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
    this.channelHandlers.clear();
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

  async subscribe(channelOrComponent: string, handler: (message: any) => void): Promise<void> {
    if (!this.connected) {
      throw new Error('RedisMessageBroker is not connected. Call connect() first.');
    }

    // Channel-based subscriptions (containing ':') use the raw channel name.
    // Component-based subscriptions (plain names) add the 'xcomponent:' prefix.
    const redisChannel = channelOrComponent.includes(':')
      ? channelOrComponent
      : `xcomponent:${channelOrComponent}`;

    // Store handler
    if (channelOrComponent.includes(':')) {
      if (!this.channelHandlers.has(channelOrComponent)) {
        this.channelHandlers.set(channelOrComponent, new Set());
      }
      this.channelHandlers.get(channelOrComponent)!.add(handler);
    } else {
      this.handlers.set(channelOrComponent, handler);
    }

    await this.subscribeClient.subscribe(redisChannel, (messageJson: string) => {
      try {
        const message = JSON.parse(messageJson);
        if (channelOrComponent.includes(':')) {
          const handlers = this.channelHandlers.get(channelOrComponent);
          if (handlers) {
            handlers.forEach(h => h(message));
          }
        } else {
          const h = this.handlers.get(channelOrComponent);
          if (h) {
            h(message);
          }
        }
      } catch (err) {
        console.error(`Failed to parse message from Redis channel ${redisChannel}:`, err);
      }
    });
  }

  unsubscribe(channelOrComponent: string): void {
    const redisChannel = channelOrComponent.includes(':')
      ? channelOrComponent
      : `xcomponent:${channelOrComponent}`;

    if (channelOrComponent.includes(':')) {
      this.channelHandlers.delete(channelOrComponent);
    } else {
      this.handlers.delete(channelOrComponent);
    }
    this.subscribeClient.unsubscribe(redisChannel);
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

    console.log(`[RabbitMQ] Publishing to exchange '${this.exchangeName}' with routing key '${routingKey}'`);

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

    console.log(`[RabbitMQ] Subscribing to '${channelOrComponent}' with routing key '${routingKey}' on queue '${queueName}'`);

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
          console.log(`[RabbitMQ] Received message on '${channelOrComponent}':`, JSON.stringify(content).substring(0, 200));

          if (channelOrComponent.includes(':')) {
            const handlers = this.channelHandlers.get(channelOrComponent);
            if (handlers) {
              console.log(`[RabbitMQ] Dispatching to ${handlers.size} handler(s)`);
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

    console.log(`[RabbitMQ] Subscription to '${channelOrComponent}' established`);
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
 * Kafka Message Broker
 * For distributed multi-process deployment with high throughput and durability
 *
 * Supported URL formats:
 * - kafka://localhost:9092                        (single broker, no auth)
 * - kafka://broker1:9092,broker2:9092             (multiple brokers)
 * - kafka://user:password@localhost:9092          (SASL/PLAIN auth)
 * - kafkas://localhost:9093                       (SSL/TLS)
 * - kafkas://user:password@localhost:9093         (SSL + SASL auth)
 *
 * Query parameters:
 * - kafka://localhost:9092?clientId=myapp         (custom client ID)
 * - kafka://localhost:9092?groupId=mygroup        (custom consumer group prefix)
 *
 * Example:
 * ```typescript
 * const broker = new KafkaMessageBroker('kafka://localhost:9092');
 * await broker.connect();
 * ```
 */
export class KafkaMessageBroker implements MessageBroker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private kafka: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private producer: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private admin: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private consumers: Map<string, any> = new Map();
  private handlers: Map<string, (message: CrossComponentMessage) => void> = new Map();
  private channelHandlers: Map<string, Set<(message: any) => void>> = new Map();
  private connected = false;
  private kafkaUrl: string;
  private clientId: string;
  private groupIdPrefix: string;
  private topicPrefix = 'xcomponent';
  private createdTopics: Set<string> = new Set();

  /**
   * Create a Kafka message broker
   *
   * @param kafkaUrl Kafka connection URL
   */
  constructor(kafkaUrl: string) {
    this.kafkaUrl = kafkaUrl;

    // Parse URL to extract configuration
    const url = new URL(kafkaUrl.replace(/^kafkas?:\/\//, 'http://'));
    this.clientId = url.searchParams.get('clientId') || `xcomponent-${process.pid}`;
    this.groupIdPrefix = url.searchParams.get('groupId') || 'xcomponent';
  }

  /**
   * Parse Kafka URL and return KafkaJS configuration
   */
  private parseKafkaUrl(): { brokers: string[]; ssl: boolean; sasl?: { mechanism: 'plain'; username: string; password: string } } {
    const isSSL = this.kafkaUrl.startsWith('kafkas://');
    const urlStr = this.kafkaUrl.replace(/^kafkas?:\/\//, 'http://');
    const url = new URL(urlStr);

    // Extract credentials if present
    const username = url.username ? decodeURIComponent(url.username) : undefined;
    const password = url.password ? decodeURIComponent(url.password) : undefined;

    // Extract brokers (host:port or comma-separated list)
    // The URL might have credentials, so we need to rebuild the broker list
    const hostPart = url.host; // This includes port
    const brokers = hostPart.split(',').map(b => {
      // If broker doesn't have port, add default
      if (!b.includes(':')) {
        return `${b}:${isSSL ? '9093' : '9092'}`;
      }
      return b;
    });

    const config: { brokers: string[]; ssl: boolean; sasl?: { mechanism: 'plain'; username: string; password: string } } = {
      brokers,
      ssl: isSSL,
    };

    if (username && password) {
      config.sasl = {
        mechanism: 'plain',
        username,
        password,
      };
    }

    return config;
  }

  /**
   * Convert channel name to Kafka topic name
   * e.g., 'fsm:events:state_change' -> 'xcomponent.fsm.events.state_change'
   */
  private channelToTopic(channel: string): string {
    const normalized = channel.replace(/:/g, '.');
    if (normalized.startsWith('xcomponent.')) {
      return normalized;
    }
    return `${this.topicPrefix}.${normalized}`;
  }

  async connect(maxRetries: number = 10, initialDelayMs: number = 1000): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Lazy dynamic import to make kafkajs optional dependency
        const kafkajs = await import('kafkajs' as any);
        const { Kafka } = kafkajs;

        if (!Kafka) {
          throw new Error('kafkajs Kafka class not found');
        }

        const config = this.parseKafkaUrl();

        this.kafka = new Kafka({
          clientId: this.clientId,
          brokers: config.brokers,
          ssl: config.ssl,
          sasl: config.sasl,
          retry: {
            initialRetryTime: 100,
            retries: 8,
          },
          logLevel: 1, // ERROR only
        });

        // Create producer
        this.producer = this.kafka.producer({
          allowAutoTopicCreation: true,
          transactionTimeout: 30000,
        });

        // Create admin client for topic management
        this.admin = this.kafka.admin();

        // Connect producer and admin
        await this.producer.connect();
        await this.admin.connect();

        this.connected = true;
        const maskedUrl = this.kafkaUrl.replace(/:[^:@]+@/, ':***@');
        console.log(`[Kafka] Connected to ${maskedUrl}`);
        return; // Success!
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries) {
          const delay = initialDelayMs * Math.pow(2, attempt - 1); // Exponential backoff
          console.log(`[Kafka] Connection attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    const maskedUrl = this.kafkaUrl.replace(/:[^:@]+@/, ':***@');
    throw new Error(
      `Failed to connect to Kafka at ${maskedUrl} after ${maxRetries} attempts. ` +
      'Make sure Kafka is running and the "kafkajs" package is installed (npm install kafkajs). ' +
      `Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  async disconnect(): Promise<void> {
    // Disconnect all consumers
    for (const [, consumer] of this.consumers) {
      try {
        await consumer.disconnect();
      } catch (err) {
        console.warn('[Kafka] Error disconnecting consumer:', err);
      }
    }
    this.consumers.clear();

    // Disconnect producer
    if (this.producer) {
      try {
        await this.producer.disconnect();
      } catch (err) {
        console.warn('[Kafka] Error disconnecting producer:', err);
      }
    }

    // Disconnect admin
    if (this.admin) {
      try {
        await this.admin.disconnect();
      } catch (err) {
        console.warn('[Kafka] Error disconnecting admin:', err);
      }
    }

    this.handlers.clear();
    this.channelHandlers.clear();
    this.createdTopics.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Ensure a topic exists, create it if necessary
   */
  private async ensureTopic(topic: string): Promise<void> {
    if (this.createdTopics.has(topic)) {
      return;
    }

    try {
      const existingTopics = await this.admin.listTopics();
      if (!existingTopics.includes(topic)) {
        await this.admin.createTopics({
          waitForLeaders: true,
          topics: [
            {
              topic,
              numPartitions: 1,
              replicationFactor: 1,
            },
          ],
        });
        console.log(`[Kafka] Created topic: ${topic}`);
      }
      this.createdTopics.add(topic);
    } catch (err: any) {
      // Topic might already exist or we don't have permissions - that's OK
      if (!err.message?.includes('TOPIC_ALREADY_EXISTS')) {
        console.warn(`[Kafka] Could not ensure topic ${topic}:`, err.message);
      }
      this.createdTopics.add(topic);
    }
  }

  async publish(channel: string, message: CrossComponentMessage | any): Promise<void> {
    if (!this.connected) {
      throw new Error('KafkaMessageBroker is not connected. Call connect() first.');
    }

    const topic = this.channelToTopic(channel);
    const serialized = JSON.stringify(message);

    // Ensure topic exists
    await this.ensureTopic(topic);

    console.log(`[Kafka] Publishing to topic '${topic}'`);

    await this.producer.send({
      topic,
      messages: [
        {
          value: serialized,
          timestamp: Date.now().toString(),
        },
      ],
    });
  }

  async subscribe(channelOrComponent: string, handler: (message: any) => void): Promise<void> {
    if (!this.connected) {
      throw new Error('KafkaMessageBroker is not connected. Call connect() first.');
    }

    // Convert channel to topic
    const topic = channelOrComponent.includes(':')
      ? this.channelToTopic(channelOrComponent)
      : this.channelToTopic(channelOrComponent);

    // Ensure topic exists
    await this.ensureTopic(topic);

    // Create a unique consumer group for this subscription
    // Using unique group ID ensures each subscriber receives all messages (like RabbitMQ exclusive queues)
    const groupId = `${this.groupIdPrefix}.${topic}.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Kafka] Subscribing to '${channelOrComponent}' on topic '${topic}' with group '${groupId}'`);

    // Store handler
    if (channelOrComponent.includes(':')) {
      if (!this.channelHandlers.has(channelOrComponent)) {
        this.channelHandlers.set(channelOrComponent, new Set());
      }
      this.channelHandlers.get(channelOrComponent)!.add(handler);
    } else {
      this.handlers.set(channelOrComponent, handler);
    }

    // Create a new consumer for this subscription
    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
    });

    await consumer.connect();

    await consumer.subscribe({
      topic,
      fromBeginning: false, // Only new messages
    });

    // Store consumer for cleanup
    this.consumers.set(channelOrComponent, consumer);

    // Run consumer
    await consumer.run({
      eachMessage: async ({ message }: { topic: string; partition: number; message: any }) => {
        try {
          const content = JSON.parse(message.value.toString());
          console.log(`[Kafka] Received message on '${channelOrComponent}':`, JSON.stringify(content).substring(0, 200));

          if (channelOrComponent.includes(':')) {
            const handlers = this.channelHandlers.get(channelOrComponent);
            if (handlers) {
              console.log(`[Kafka] Dispatching to ${handlers.size} handler(s)`);
              handlers.forEach(h => h(content));
            }
          } else {
            const h = this.handlers.get(channelOrComponent);
            if (h) {
              h(content);
            }
          }
        } catch (err) {
          console.error(`[Kafka] Failed to parse message:`, err);
        }
      },
    });

    console.log(`[Kafka] Subscription to '${channelOrComponent}' established`);
  }

  unsubscribe(channelOrComponent: string): void {
    if (channelOrComponent.includes(':')) {
      this.channelHandlers.delete(channelOrComponent);
    } else {
      this.handlers.delete(channelOrComponent);
    }

    // Disconnect the consumer
    const consumer = this.consumers.get(channelOrComponent);
    if (consumer) {
      consumer.disconnect().catch((err: Error) => {
        console.warn(`[Kafka] Error disconnecting consumer for ${channelOrComponent}:`, err.message);
      });
      this.consumers.delete(channelOrComponent);
    }
  }
}

/**
 * Factory function to create appropriate broker based on configuration
 *
 * For 'memory' broker, returns a singleton instance so all runtimes
 * in the same process share the same broker for cross-component communication.
 */
export function createMessageBroker(brokerUrl?: string): MessageBroker {
  if (!brokerUrl || brokerUrl === 'memory' || brokerUrl === 'in-memory') {
    return InMemoryMessageBroker.getInstance();
  }

  if (brokerUrl.startsWith('redis://') || brokerUrl.startsWith('rediss://')) {
    return new RedisMessageBroker(brokerUrl);
  }

  if (brokerUrl.startsWith('amqp://') || brokerUrl.startsWith('amqps://')) {
    return new RabbitMQMessageBroker(brokerUrl);
  }

  if (brokerUrl.startsWith('kafka://') || brokerUrl.startsWith('kafkas://')) {
    return new KafkaMessageBroker(brokerUrl);
  }

  throw new Error(`Unsupported broker URL: ${brokerUrl}. Supported: "memory", "redis://...", "amqp://...", "kafka://..."`);
}
