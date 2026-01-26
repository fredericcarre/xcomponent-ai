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
    // Add target machine info for inter-machine transitions
    if (transition.type === 'inter_machine' && transition.targetMachine) {
      lines.push(`    ${transition.from} --> ${transition.to}: ${transitionLabel} [→${transition.targetMachine}]`);
    } else {
      lines.push(`    ${transition.from} --> ${transition.to}: ${transitionLabel}`);
    }
  });

  lines.push('');

  // Note: Terminal states are styled with colors but we don't add [*] arrows
  // as they are not needed in this use case

  return lines.join('\n');
}

/**
 * Generate Mermaid diagram with styling based on state metadata
 * - Entry states: yellow
 * - Terminal states (no outgoing transitions): green
 * - Error states: red
 * - Current state (if provided): highlighted with thick border
 * - Inter-machine transitions: green arrows
 */
export function generateStyledMermaidDiagram(
  machine: StateMachine,
  currentState?: string
): string {
  const baseDiagram = generateMermaidDiagram(machine);
  const styleLines: string[] = [];

  // Define color classes once at the end
  const usedClasses = new Set<string>();

  // Detect terminal states automatically
  const terminalStates = detectTerminalStates(machine);

  // Detect inter-machine transitions for link styling
  const interMachineTransitions = detectInterMachineTransitions(machine);

  // Collect state styles
  const stateStyles: string[] = [];
  machine.states.forEach(state => {
    let className = '';

    // Current state takes priority for highlighting
    if (currentState && state.name === currentState) {
      className = 'currentState';
      usedClasses.add('currentState');
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

  // Note: linkStyle doesn't work well in stateDiagram-v2 with our setup
  // Inter-machine transitions are indicated in the label with [→TargetMachine]
  // No need for additional styling

  // Combine: base diagram + class definitions + state class applications
  let result = baseDiagram;
  if (styleLines.length > 0 || stateStyles.length > 0) {
    result += '\n\n' + styleLines.join('\n');
    if (stateStyles.length > 0) {
      result += '\n' + stateStyles.join('\n');
    }
  }

  return result;
}
