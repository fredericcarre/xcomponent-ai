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
  /** Inter-machine transition (green, instantiates new instance in same component) */
  INTER_MACHINE = 'inter_machine',
  /** Cross-component transition (creates instance in another component via message broker) */
  CROSS_COMPONENT = 'cross_component',
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
   * Send event to current instance (self)
   *
   * Allows triggered methods to explicitly control state transitions.
   * Event is queued and processed asynchronously to avoid race conditions.
   *
   * @param event Event to send to self
   *
   * @example
   * // Triggered method decides when to transition
   * async function(event, context, sender) {
   *   context.executedQuantity += event.payload.quantity;
   *
   *   if (context.executedQuantity >= context.totalQuantity) {
   *     // Explicitly trigger transition to next state
   *     await sender.sendToSelf({
   *       type: 'FULLY_EXECUTED',
   *       payload: {
   *         totalExecuted: context.executedQuantity,
   *         executionDuration: Date.now() - context.startTime
   *       },
   *       timestamp: Date.now()
   *     });
   *   }
   * }
   */
  sendToSelf(event: FSMEvent): Promise<void>;

  /**
   * Send event to specific instance by ID (intra-component)
   */
  sendTo(instanceId: string, event: FSMEvent): Promise<void>;

  /**
   * Send event to specific instance in another component (cross-component)
   */
  sendToComponent(componentName: string, instanceId: string, event: FSMEvent): Promise<void>;

  /**
   * Broadcast event to instances
   *
   * Unified broadcast method for both intra-component and cross-component communication.
   * Filtering is done via matchingRules in YAML, not in code.
   *
   * @param machineName Target state machine name
   * @param event Event to broadcast
   * @param currentState Optional state filter. Omit to broadcast to all states
   * @param componentName Optional component name. Omit for intra-component
   * @returns Number of instances that received the event
   *
   * @example
   * // Broadcast to all Orders in current component (any state)
   * await sender.broadcast('Order', {type: 'SYSTEM_ALERT', payload: {}});
   *
   * @example
   * // Broadcast to Orders in Pending state only
   * await sender.broadcast('Order', {type: 'TIMEOUT', payload: {}}, 'Pending');
   *
   * @example
   * // Cross-component broadcast
   * await sender.broadcast('Payment', {type: 'ORDER_COMPLETED', payload: {...}}, undefined, 'PaymentComponent');
   *
   * @example
   * // Filtering via matchingRules in YAML:
   * // transitions:
   * //   - from: Monitoring
   * //     to: Monitoring
   * //     event: ORDER_UPDATE
   * //     matchingRules:
   * //       - eventProperty: payload.customerId
   * //         instanceProperty: customerId
   */
  broadcast(
    machineName: string,
    event: FSMEvent,
    currentState?: string,
    componentName?: string
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
  /** Timeout in milliseconds (for TIMEOUT type) */
  timeoutMs?: number;
  /**
   * Reset timeout on any transition to this state (for TIMEOUT type)
   *
   * false (default): Timer runs for total time in state (doesn't reset on self-loop)
   * true: Timer resets every time instance enters this state (including self-loops)
   *
   * Example with resetOnTransition: false (default):
   *   - Enter PartiallyExecuted at T=0, timeout=30s
   *   - Self-loop at T=10s (PartiallyExecuted → PartiallyExecuted)
   *   - Timeout fires at T=30s (total time in state)
   *
   * Example with resetOnTransition: true:
   *   - Enter PartiallyExecuted at T=0, timeout=30s
   *   - Self-loop at T=10s → timer RESETS to 30s
   *   - Self-loop at T=25s → timer RESETS to 30s again
   *   - Timeout fires at T=55s (30s after last transition)
   */
  resetOnTransition?: boolean;
  /** Target machine for inter-machine transitions */
  targetMachine?: string;
  /** Target component for cross-component transitions */
  targetComponent?: string;
  /** Target event to send when cross-component instance is created */
  targetEvent?: string;
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
  /**
   * Guard condition for conditional transitions
   * When multiple transitions from same state use same event,
   * guards determine which transition fires
   */
  guard?: TransitionGuard;
  /**
   * Notify parent instance when this transition is executed
   * Allows child state machines to communicate state changes back to parent
   */
  notifyParent?: NotifyParent;
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * Guard condition for conditional transitions
 */
export interface TransitionGuard {
  /**
   * JavaScript expression evaluated with (context, event)
   * Must return boolean
   * Example: "context.amount > 5000"
   */
  expression: string;
}

/**
 * Parent link configuration for child-to-parent notifications
 * Enables XComponent pattern of parent orchestration over child state machines
 */
export interface ParentLink {
  /** Enable parent linking (stores parentInstanceId in child context) */
  enabled: boolean;
  /**
   * Event type to send to parent on ANY state change
   * If set, automatically notifies parent when child changes state
   */
  onStateChange?: string;
}

/**
 * Notification to parent configuration on a specific transition
 * Allows fine-grained control over which transitions notify the parent
 */
export interface NotifyParent {
  /** Event type to send to parent */
  event: string;
  /** Include child's current state in payload (default: true) */
  includeState?: boolean;
  /** Include child's context in payload (default: false) */
  includeContext?: boolean;
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
  /**
   * Parent link configuration for child-to-parent notifications
   * When a child is created via inter_machine, it stores the parent's instanceId
   * and can notify the parent on state changes
   */
  parentLink?: ParentLink;
  /**
   * Context schema for UI form generation and validation
   */
  contextSchema?: Record<string, any>;
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
  /**
   * Entry point machine name.
   * Defines which state machine is the component's main entry point.
   * Entry point instances are never deallocated even in final states.
   * @example entryMachine: 'Order'
   */
  entryMachine?: string;
  /**
   * Entry machine instance creation mode.
   * - 'singleton': Only one instance allowed - good for monitors, supervisors, orchestrators
   * - 'multiple': Multiple instances allowed - good for orders, payments, user workflows
   * @default 'singleton'
   * @example entryMachineMode: 'multiple'  // Allow multiple Order instances
   */
  entryMachineMode?: 'singleton' | 'multiple';
  /**
   * Auto-create entry point instance when runtime starts.
   * - true: Instance created automatically with empty context
   * - false: No auto-create, instances created via API/dashboard with meaningful context
   *
   * For 'multiple' mode, typically set to false so users create instances with specific data.
   * For 'singleton' mode, typically set to true so the single instance always exists.
   *
   * @default true for singleton mode, false for multiple mode
   * @example autoCreateEntryPoint: false  // User creates instances via API
   */
  autoCreateEntryPoint?: boolean;
  /** Metadata */
  metadata?: Record<string, any>;
  /** Layout configuration for dashboard visualization */
  layout?: {
    /** Machine positions for component overview */
    machines?: Record<string, { x: number; y: number }>;
    /** Auto-layout algorithm: force, grid, hierarchical */
    algorithm?: 'force' | 'grid' | 'hierarchical';
  };
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
  /** Entry point flag - prevents auto-deallocation in final state */
  isEntryPoint?: boolean;
  /**
   * Parent instance ID (set when created via inter_machine transition)
   * Enables child-to-parent communication
   */
  parentInstanceId?: string;
  /**
   * Parent machine name (for routing notifications back to parent)
   */
  parentMachineName?: string;
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
  /** Snapshot of publicMember after this transition (for traceability) */
  publicMemberSnapshot?: Record<string, any>;
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
