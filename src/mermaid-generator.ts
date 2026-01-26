/**
 * Generate Mermaid stateDiagram-v2 syntax from FSM definition
 */

import { StateMachine } from './types';

/**
 * Transition info for UI interaction
 */
export interface TransitionInfo {
  index: number;
  from: string;
  to: string;
  event: string;
  type: string;
  targetMachine?: string;
}

/**
 * Detect terminal states (states with no outgoing transitions)
 */
export function detectTerminalStates(machine: StateMachine): Set<string> {
  const statesWithOutgoingTransitions = new Set<string>();

  machine.transitions.forEach(transition => {
    statesWithOutgoingTransitions.add(transition.from);
  });

  const terminalStates = new Set<string>();
  machine.states.forEach(state => {
    if (!statesWithOutgoingTransitions.has(state.name)) {
      terminalStates.add(state.name);
    }
  });

  return terminalStates;
}

/**
 * Detect inter-machine transitions
 */
export function detectInterMachineTransitions(machine: StateMachine): TransitionInfo[] {
  const interMachineTransitions: TransitionInfo[] = [];

  machine.transitions.forEach((transition, index) => {
    if (transition.type === 'inter_machine' && transition.targetMachine) {
      interMachineTransitions.push({
        index: index + 1, // +1 because [*] --> initial is index 0
        from: transition.from,
        to: transition.to,
        event: transition.event,
        type: transition.type,
        targetMachine: transition.targetMachine
      });
    }
  });

  return interMachineTransitions;
}

/**
 * Get all transitions with their indices for UI interaction
 */
export function getTransitionsInfo(machine: StateMachine): TransitionInfo[] {
  return machine.transitions.map((transition, index) => ({
    index: index + 1, // +1 because [*] --> initial is index 0
    from: transition.from,
    to: transition.to,
    event: transition.event,
    type: transition.type || 'regular',
    targetMachine: transition.targetMachine
  }));
}

/**
 * Generate Mermaid diagram for a state machine
 */
export function generateMermaidDiagram(machine: StateMachine): string {
  const lines: string[] = [];

  lines.push('stateDiagram-v2');
  lines.push('');

  // Mark initial state
  lines.push(`    [*] --> ${machine.initialState}`);
  lines.push('');

  // Add all transitions
  machine.transitions.forEach(transition => {
    const transitionLabel = transition.event;
    // For all transitions, just show the event name
    // Inter-machine connections are visualized with green SVG arrows externally
    lines.push(`    ${transition.from} --> ${transition.to}: ${transitionLabel}`);
  });

  lines.push('');

  // Note: Terminal states are styled with colors but we don't add [*] arrows
  // as they are not needed in this use case

  return lines.join('\n');
}

/**
 * Compute reachable states from the current state using BFS
 */
export function computeReachableStates(
  machine: StateMachine,
  currentState: string
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [currentState];
  reachable.add(currentState);

  while (queue.length > 0) {
    const state = queue.shift()!;
    machine.transitions.forEach(transition => {
      if (transition.from === state && !reachable.has(transition.to)) {
        reachable.add(transition.to);
        queue.push(transition.to);
      }
    });
  }

  return reachable;
}

/**
 * Get transitions that are directly available from current state
 */
export function getAvailableTransitions(
  machine: StateMachine,
  currentState: string
): Set<number> {
  const available = new Set<number>();
  machine.transitions.forEach((transition, index) => {
    if (transition.from === currentState) {
      available.add(index);
    }
  });
  return available;
}

/**
 * Generate Mermaid diagram with styling based on state metadata
 * - Entry states: yellow
 * - Terminal states (no outgoing transitions): green
 * - Error states: red
 * - Current state (if provided): highlighted with thick border
 * - Unreachable states: grayed out (when currentState is provided)
 * - Inter-machine transitions: green arrows
 */
export function generateStyledMermaidDiagram(
  machine: StateMachine,
  currentState?: string
): string {
  const lines: string[] = [];
  const styleLines: string[] = [];
  const usedClasses = new Set<string>();

  lines.push('stateDiagram-v2');
  lines.push('');

  // Mark initial state
  lines.push(`    [*] --> ${machine.initialState}`);
  lines.push('');

  // Detect terminal states automatically
  const terminalStates = detectTerminalStates(machine);

  // Compute reachable states if current state is provided
  const reachableStates = currentState
    ? computeReachableStates(machine, currentState)
    : null;

  // Add all transitions (except inter_machine which are shown as external green arrows)
  machine.transitions.forEach((transition) => {
    // Skip inter_machine transitions - they are displayed as green arrows between machines
    if (transition.type === 'inter_machine') {
      return;
    }
    const transitionLabel = transition.event;
    lines.push(`    ${transition.from} --> ${transition.to}: ${transitionLabel}`);
  });

  lines.push('');

  // Collect state styles
  const stateStyles: string[] = [];
  machine.states.forEach(state => {
    let className = '';
    const isReachable = !reachableStates || reachableStates.has(state.name);

    // Current state takes priority for highlighting
    if (currentState && state.name === currentState) {
      className = 'currentState';
      usedClasses.add('currentState');
    } else if (!isReachable) {
      // Unreachable states are grayed out
      className = 'inactiveState';
      usedClasses.add('inactiveState');
    } else if (state.type === 'entry') {
      className = 'entryState';
      usedClasses.add('entryState');
    } else if (state.type === 'error') {
      className = 'errorState';
      usedClasses.add('errorState');
    } else if (state.type === 'final' || terminalStates.has(state.name)) {
      // Terminal states (explicit final or auto-detected)
      className = 'terminalState';
      usedClasses.add('terminalState');
    }

    if (className) {
      stateStyles.push(`    class ${state.name} ${className}`);
    }
  });

  // Add class definitions for states
  if (usedClasses.has('currentState')) {
    styleLines.push(`    classDef currentState fill:#3b82f6,stroke:#1d4ed8,stroke-width:4px,color:#fff`);
  }
  if (usedClasses.has('entryState')) {
    styleLines.push(`    classDef entryState fill:#fbbf24,stroke:#f59e0b,stroke-width:3px,color:#000`);
  }
  if (usedClasses.has('terminalState')) {
    styleLines.push(`    classDef terminalState fill:#10b981,stroke:#059669,stroke-width:3px,color:#fff`);
  }
  if (usedClasses.has('errorState')) {
    styleLines.push(`    classDef errorState fill:#ef4444,stroke:#dc2626,stroke-width:3px,color:#fff`);
  }
  if (usedClasses.has('inactiveState')) {
    // Use muted colors for inactive states (opacity doesn't work in Mermaid)
    styleLines.push(`    classDef inactiveState fill:#2a2a2a,stroke:#3a3a3a,stroke-width:1px,color:#555,stroke-dasharray:3`);
  }

  // Combine: base diagram + class definitions + state class applications
  let result = lines.join('\n');
  if (styleLines.length > 0 || stateStyles.length > 0) {
    result += '\n\n' + styleLines.join('\n');
    if (stateStyles.length > 0) {
      result += '\n' + stateStyles.join('\n');
    }
  }

  return result;
}
