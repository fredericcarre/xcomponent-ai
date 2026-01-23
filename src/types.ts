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
}

/**
 * Guard function for conditional transitions
 */
export type GuardFunction = (event: FSMEvent, context: any) => boolean;

/**
 * Triggered method (async JS hook on entry/transition)
 */
export type TriggeredMethod = (event: FSMEvent, context: any) => Promise<void>;

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
  /** Context data */
  context: Record<string, any>;
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
