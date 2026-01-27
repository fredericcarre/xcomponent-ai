/**
 * xcomponent-ai
 * Agentic FSM tool for fintech workflows
 *
 * @packageDocumentation
 */

export * from './types';
export * from './fsm-runtime';
export * from './agents';
export * from './monitoring';
export * from './websockets';
export * from './component-registry';
export * from './persistence';
export * from './timer-wheel';
export * from './message-broker';
export * from './external-broker-api';

// Main exports
export { FSMRuntime, loadComponent } from './fsm-runtime';
export { SupervisorAgent, FSMAgent, UIAgent, MonitoringAgent } from './agents';
export { MonitoringService, monitoringService } from './monitoring';
export { WebSocketManager } from './websockets';
export { APIServer } from './api';
export { ComponentRegistry } from './component-registry';
export {
  InMemoryEventStore,
  InMemorySnapshotStore,
  PersistenceManager
} from './persistence';
export { TimerWheel } from './timer-wheel';
export {
  MessageBroker,
  InMemoryMessageBroker,
  RedisMessageBroker,
  RabbitMQMessageBroker,
  createMessageBroker,
  CrossComponentMessage,
  PropertyFilter
} from './message-broker';
export {
  ExternalBrokerAPI,
  ExternalCommand,
  ExternalBroadcastCommand,
  PublishedFSMEvent,
  publishExternalCommand,
  subscribeToFSMEvents
} from './external-broker-api';

// Distributed dashboard
export { DashboardServer, DashboardChannels, RuntimeRegistration, FSMEventBroadcast } from './dashboard-server';
export { RuntimeBroadcaster, RuntimeBroadcasterConfig, createRuntimeBroadcaster } from './runtime-broadcaster';

// PostgreSQL persistence
export {
  PostgresEventStore,
  PostgresSnapshotStore,
  PostgresConfig,
  createPostgresStores
} from './postgres-persistence';

// Redis persistence
export {
  RedisEventStore,
  RedisSnapshotStore,
  RedisConfig,
  createRedisStores
} from './redis-persistence';
