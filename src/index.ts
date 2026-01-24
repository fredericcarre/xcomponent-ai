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
  createMessageBroker,
  CrossComponentMessage
} from './message-broker';
