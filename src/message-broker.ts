/**
 * Message Broker abstraction for cross-component communication
 * Supports both in-memory (single process) and distributed (multi-process) modes
 */

import { EventEmitter } from 'events';
import { FSMEvent } from './types';

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
}

/**
 * Message Broker interface
 * Abstracts communication mechanism (in-memory, Redis, NATS, etc.)
 */
export interface MessageBroker {
  /**
   * Publish a cross-component message
   */
  publish(channel: string, message: CrossComponentMessage): Promise<void>;

  /**
   * Subscribe to messages for a specific component
   */
  subscribe(componentName: string, handler: (message: CrossComponentMessage) => void): void;

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
  private connected = false;

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.handlers.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async publish(_channel: string, message: CrossComponentMessage): Promise<void> {
    // In-memory: directly invoke the handler
    const handler = this.handlers.get(message.targetComponent);
    if (handler) {
      // Async invocation to simulate network behavior
      setImmediate(() => handler(message));
    }
  }

  subscribe(componentName: string, handler: (message: CrossComponentMessage) => void): void {
    this.handlers.set(componentName, handler);
  }

  unsubscribe(componentName: string): void {
    this.handlers.delete(componentName);
  }
}

/**
 * Redis Pub/Sub Message Broker
 * For distributed multi-process deployment
 */
export class RedisMessageBroker implements MessageBroker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private publishClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private subscribeClient: any;
  private handlers: Map<string, (message: CrossComponentMessage) => void> = new Map();
  private connected = false;
  private redisUrl: string;

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
 * Factory function to create appropriate broker based on configuration
 */
export function createMessageBroker(brokerUrl?: string): MessageBroker {
  if (!brokerUrl || brokerUrl === 'memory' || brokerUrl === 'in-memory') {
    return new InMemoryMessageBroker();
  }

  if (brokerUrl.startsWith('redis://') || brokerUrl.startsWith('rediss://')) {
    return new RedisMessageBroker(brokerUrl);
  }

  throw new Error(`Unsupported broker URL: ${brokerUrl}. Supported: "memory", "redis://..."`);
}
