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
 * Sender interface for triggered methods
 * Allows state machines to send events to other instances (XComponent pattern)
 */
export interface Sender {
  /**
   * Send event to specific instance by ID
   */
  sendTo(instanceId: string, event: FSMEvent): Promise<void>;

  /**
   * Broadcast event to instances matching property rules
   */
  broadcast(machineName: string, currentState: string, event: FSMEvent): Promise<number>;

  /**
   * Create new instance (inter-machine pattern)
   */
  createInstance(machineName: string, initialContext: Record<string, any>): string;
}

/**
 * Triggered method (async JS hook on entry/transition)
 * Receives event, context, and sender for cross-instance communication
 */
export type TriggeredMethod = (event: FSMEvent, context: any, sender: Sender) => Promise<void>;

/**
 * Guard configuration
 */
export interface Guard {
  /** Matching keys */
  keys?: string[];
  /** Contains check */
  contains?: string;
  /** Custom JavaScript function */
  customFunction?: string;
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
