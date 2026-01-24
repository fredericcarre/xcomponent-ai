/**
 * Core type definitions for xcomponent-ai FSM system
 * Inspired by XComponent state machine architecture
 */

/**
 * State types following XComponent conventions
 */
export enum StateType {
  /** Initial state (unique, black, entry point) */
  ENTRY = 'entry',
  /** Regular state (white) */
  REGULAR = 'regular',
  /** Final state (green, disposes instance) */
  FINAL = 'final',
  /** Error state (purple, implicit, disposes instance) */
  ERROR = 'error',
}

/**
 * Transition types
 */
export enum TransitionType {
  /** Regular intra-machine transition (gray) */
  REGULAR = 'regular',
  /** Inter-machine transition (green, instantiates new instance) */
  INTER_MACHINE = 'inter_machine',
  /** Timeout transition */
  TIMEOUT = 'timeout',
  /** Internal self-transition */
  INTERNAL = 'internal',
  /** Triggerable from code */
  TRIGGERABLE = 'triggerable',
  /** Auto-transition (triggered automatically when entering state) */
  AUTO = 'auto',
}

/**
 * Guard function for conditional transitions
 */
export type GuardFunction = (event: FSMEvent, context: any) => boolean;

/**
 * Property filter for targeted broadcasts
 * Allows filtering instances based on context properties
 */
export interface PropertyFilter {
  /** Property path to check (supports dot notation: "customer.tier") */
  property: string;
  /** Comparison operator (default: '===') */
  operator?: '===' | '!==' | '>' | '<' | '>=' | '<=' | 'contains' | 'in';
  /** Value to compare against */
  value: any;
}

/**
 * Sender interface for triggered methods
 * Allows state machines to send events to other instances (XComponent pattern)
 *
 * Supports both intra-component (within same component) and
 * cross-component (between different components) communication
 */
export interface Sender {
  /**
   * Send event to specific instance by ID (intra-component)
   */
  sendTo(instanceId: string, event: FSMEvent): Promise<void>;

  /**
   * Send event to specific instance in another component (cross-component)
   */
  sendToComponent(componentName: string, instanceId: string, event: FSMEvent): Promise<void>;

  /**
   * Broadcast event to instances (intra-component)
   *
   * @param machineName Target state machine name
   * @param currentState Current state filter (only instances in this state)
   * @param event Event to broadcast
   * @param filters Optional property filters to target specific instances
   * @returns Number of instances that received the event
   *
   * @example
   * // Broadcast to all Orders in Pending state
   * await sender.broadcast('Order', 'Pending', {type: 'TIMEOUT', payload: {}});
   *
   * @example
   * // Broadcast only to orders for a specific customer
   * await sender.broadcast('Order', 'Pending', {type: 'TIMEOUT', payload: {}}, [
   *   {property: 'customerId', value: 'CUST-001'}
   * ]);
   */
  broadcast(
    machineName: string,
    currentState: string,
    event: FSMEvent,
    filters?: PropertyFilter[]
  ): Promise<number>;

  /**
   * Broadcast event to instances in another component (cross-component)
   *
   * @param componentName Target component name
   * @param machineName Target state machine name
   * @param currentState Current state filter
   * @param event Event to broadcast
   * @param filters Optional property filters to target specific instances
   * @returns Number of instances that received the event
   */
  broadcastToComponent(
    componentName: string,
    machineName: string,
    currentState: string,
    event: FSMEvent,
    filters?: PropertyFilter[]
  ): Promise<number>;

  /**
   * Create new instance (intra-component)
   */
  createInstance(machineName: string, initialContext: Record<string, any>): string;

  /**
   * Create new instance in another component (cross-component)
   */
  createInstanceInComponent(
    componentName: string,
    machineName: string,
    initialContext: Record<string, any>
  ): string;
}

/**
 * Triggered method (async JS hook on entry/transition)
 * Receives event, context, and sender for cross-instance communication
 */
export type TriggeredMethod = (event: FSMEvent, context: any, sender: Sender) => Promise<void>;

/**
 * Guard configuration
 *
 * Guards are conditions that must be satisfied for a transition to occur.
 * Multiple guards are evaluated with AND logic (all must pass).
 *
 * Examples:
 * ```yaml
 * guards:
 *   # Guard 1: Check context property value
 *   - type: context
 *     property: executedQuantity
 *     operator: ">="
 *     value: "{{totalQuantity}}"  # Can reference other context properties
 *
 *   # Guard 2: Check event payload
 *   - type: event
 *     property: amount
 *     operator: ">"
 *     value: 1000
 *
 *   # Guard 3: Custom JavaScript function
 *   - type: custom
 *     condition: "context.executedQuantity >= context.totalQuantity && event.payload.status === 'confirmed'"
 * ```
 */
export interface Guard {
  /**
   * Guard type
   * - context: Check a property in the instance context
   * - event: Check a property in the event payload
   * - custom: Custom JavaScript condition
   */
  type?: 'context' | 'event' | 'custom';

  /**
   * Property path to check (for context/event guards)
   * Supports dot notation: "customer.tier", "order.items.length"
   */
  property?: string;

  /**
   * Comparison operator
   */
  operator?: '===' | '!==' | '>' | '<' | '>=' | '<=' | 'contains' | 'in';

  /**
   * Value to compare against
   * Can use {{propertyName}} to reference context properties
   */
  value?: any;

  /**
   * Custom JavaScript condition (for custom type)
   * Has access to: context, event, publicMember
   * Example: "context.executedQuantity >= context.totalQuantity"
   */
  condition?: string;

  // Legacy fields (backward compatibility)
  /** @deprecated Use type: 'custom' with condition instead */
  customFunction?: string;
  /** @deprecated Use property with operator instead */
  keys?: string[];
  /** @deprecated Use operator: 'contains' instead */
  contains?: string;
}

/**
 * Property matching rule for instance routing
 * Enables XComponent-style event routing: ExecutionInput.OrderId = Order.Id
 */
export interface MatchingRule {
  /** Property path in event payload (e.g., "OrderId", "customer.id") */
  eventProperty: string;
  /** Property path in instance context (e.g., "Id", "customer.id") */
  instanceProperty: string;
  /** Optional comparison operator (default: '===') */
  operator?: '===' | '!==' | '>' | '<' | '>=' | '<=';
}

/**
 * Cascading rule for automatic cross-machine updates
 * When a source machine reaches a specific state, automatically triggers events on target machines
 *
 * Example: When Order reaches Confirmed, start Shipment workflow
 */
export interface CascadingRule {
  /** Target component name (for cross-component communication). If omitted, targets the same component */
  targetComponent?: string;
  /** Target machine name */
  targetMachine: string;
  /** Target state filter (only instances in this state) */
  targetState: string;
  /** Event to send to target instances */
  event: string;
  /** Property matching rules for routing */
  matchingRules?: MatchingRule[];
  /** Payload template with {{property}} syntax */
  payload?: Record<string, any>;
}

/**
 * State definition
 */
export interface State {
  /** State name */
  name: string;
  /** State type */
  type: StateType;
  /** Entry method name */
  entryMethod?: string;
  /** Exit method name */
  exitMethod?: string;
  /** Metadata */
  metadata?: Record<string, any>;
  /** Cascading rules triggered when entering this state */
  cascadingRules?: CascadingRule[];
}

/**
 * Transition definition
 */
export interface Transition {
  /** Source state */
  from: string;
  /** Target state */
  to: string;
  /** Event that triggers this transition */
  event: string;
  /** Transition type */
  type: TransitionType;
  /** Guards for conditional execution */
  guards?: Guard[];
  /** Timeout in milliseconds (for TIMEOUT type) */
  timeoutMs?: number;
  /** Target machine for inter-machine transitions */
  targetMachine?: string;
  /** Triggered method name */
  triggeredMethod?: string;
  /**
   * Property matching rules for instance routing (XComponent-style)
   * When present, event is routed to instances where these property equality checks pass
   * Example: ExecutionInput.OrderId = Order.Id
   */
  matchingRules?: MatchingRule[];
  /**
   * Specific triggering rule for differentiation when multiple transitions
   * from same state use same event
   * Boolean JavaScript expression evaluated with (event, context)
   * Example: "event.payload.Quantity === context.RemainingQuantity"
   */
  specificTriggeringRule?: string;
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * State Machine definition
 */
export interface StateMachine {
  /** Machine name */
  name: string;
  /** States */
  states: State[];
  /** Transitions */
  transitions: Transition[];
  /** Initial state name */
  initialState: string;
  /**
   * Public member type name (XComponent pattern)
   * Defines the business object type visible to external components
   * Example: "Order", "Trade", "Customer"
   */
  publicMemberType?: string;
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * Component definition (container for state machines)
 */
export interface Component {
  /** Component name */
  name: string;
  /** Version */
  version: string;
  /** State machines */
  stateMachines: StateMachine[];
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * FSM Event
 */
export interface FSMEvent {
  /** Event type */
  type: string;
  /** Event payload */
  payload: Record<string, any>;
  /** Timestamp */
  timestamp: number;
}

/**
 * FSM Instance
 */
export interface FSMInstance {
  /** Unique instance ID */
  id: string;
  /** Machine name */
  machineName: string;
  /** Current state */
  currentState: string;
  /**
   * Context data (legacy/simple usage)
   * For XComponent pattern, use publicMember + internalMember instead
   */
  context: Record<string, any>;
  /**
   * Public member (XComponent pattern)
   * Business object visible to external components/APIs
   * Example: Order { Id, Quantity, AssetName, ... }
   */
  publicMember?: Record<string, any>;
  /**
   * Internal member (XComponent pattern)
   * Private state not exposed externally (rarely used)
   */
  internalMember?: Record<string, any>;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Instance status */
  status: 'active' | 'completed' | 'error';
}

/**
 * Monitoring log entry
 */
export interface LogEntry {
  /** Instance ID */
  instanceId: string;
  /** From state */
  from: string;
  /** To state */
  to: string;
  /** Event that triggered transition */
  event: string;
  /** Timestamp */
  time: number;
  /** Error message if any */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * WebSocket message for state changes
 */
export interface StateChangeMessage {
  /** Instance ID */
  instanceId: string;
  /** New state */
  newState: string;
  /** Previous state */
  previousState: string;
  /** Event that triggered change */
  event: FSMEvent;
  /** Timestamp */
  timestamp: number;
}

/**
 * Agent tool result
 */
export interface AgentToolResult {
  /** Success status */
  success: boolean;
  /** Result data */
  data?: any;
  /** Error message */
  error?: string;
  /** Suggestions */
  suggestions?: string[];
}

// ============================================================
// PHASE 4: PERSISTENCE & EVENT SOURCING
// ============================================================

/**
 * Persisted event with causality tracking
 * Enables full event sourcing and auditability
 */
export interface PersistedEvent {
  /** Unique event ID */
  id: string;
  /** Instance ID that received this event */
  instanceId: string;
  /** Machine name */
  machineName: string;
  /** Component name where this event occurred */
  componentName: string;
  /** The FSM event */
  event: FSMEvent;
  /** State before transition */
  stateBefore: string;
  /** State after transition */
  stateAfter: string;
  /** Timestamp when persisted */
  persistedAt: number;
  /** Causality: IDs of events that caused this event (cascading/sender) */
  causedBy?: string[];
  /** Causality: IDs of events caused by this event */
  caused?: string[];
  /** Cross-component: Source component name (if event originated from another component) */
  sourceComponentName?: string;
  /** Cross-component: Target component name (if event was sent to another component) */
  targetComponentName?: string;
}

/**
 * Instance snapshot for fast restoration
 */
export interface InstanceSnapshot {
  /** Instance data */
  instance: FSMInstance;
  /** Snapshot timestamp */
  snapshotAt: number;
  /** Last event ID processed */
  lastEventId: string;
  /** Pending timeouts (relative ms from now) */
  pendingTimeouts?: Array<{
    stateKey: string;
    eventType: string;
    remainingMs: number;
  }>;
}

/**
 * Event store interface for persistence
 */
export interface EventStore {
  /**
   * Append event to store
   */
  append(event: PersistedEvent): Promise<void>;

  /**
   * Get all events for an instance
   */
  getEventsForInstance(instanceId: string): Promise<PersistedEvent[]>;

  /**
   * Get events in time range
   */
  getEventsByTimeRange(startTime: number, endTime: number): Promise<PersistedEvent[]>;

  /**
   * Get events caused by another event (tracing)
   */
  getCausedEvents(eventId: string): Promise<PersistedEvent[]>;

  /**
   * Get all events (for replay)
   */
  getAllEvents(): Promise<PersistedEvent[]>;
}

/**
 * Snapshot store interface
 */
export interface SnapshotStore {
  /**
   * Save instance snapshot
   */
  saveSnapshot(snapshot: InstanceSnapshot): Promise<void>;

  /**
   * Get latest snapshot for instance
   */
  getSnapshot(instanceId: string): Promise<InstanceSnapshot | null>;

  /**
   * Get all snapshots (for full restore)
   */
  getAllSnapshots(): Promise<InstanceSnapshot[]>;

  /**
   * Delete snapshot
   */
  deleteSnapshot(instanceId: string): Promise<void>;
}

/**
 * Persistence configuration
 */
export interface PersistenceConfig {
  /** Enable event sourcing */
  eventSourcing?: boolean;
  /** Enable snapshots */
  snapshots?: boolean;
  /** Snapshot interval (save every N transitions) */
  snapshotInterval?: number;
  /** Event store implementation */
  eventStore?: EventStore;
  /** Snapshot store implementation */
  snapshotStore?: SnapshotStore;
}
