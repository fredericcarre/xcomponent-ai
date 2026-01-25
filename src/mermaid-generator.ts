/**
 * Generate Mermaid stateDiagram-v2 syntax from FSM definition
 */

import { StateMachine } from './types';

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
    lines.push(`    ${transition.from} --> ${transition.to}: ${transitionLabel}`);
  });

  lines.push('');

  // Mark final and error states
  machine.states.forEach(state => {
    if (state.type === 'final') {
      lines.push(`    ${state.name} --> [*]`);
    }
  });

  return lines.join('\n');
}

/**
 * Generate Mermaid diagram with styling based on state metadata
 */
export function generateStyledMermaidDiagram(machine: StateMachine): string {
  const baseDiagram = generateMermaidDiagram(machine);
  const styleLines: string[] = [];

  // Find terminal states (states with no outgoing transitions except type: final/error)
  const statesWithOutgoingTransitions = new Set<string>();
  machine.transitions.forEach(t => {
    statesWithOutgoingTransitions.add(t.from);
  });

  const terminalStates = machine.states.filter(state =>
    !statesWithOutgoingTransitions.has(state.name) ||
    state.type === 'final' ||
    state.type === 'error'
  );

  // Define color classes once at the end
  const usedClasses = new Set<string>();

  // Collect state styles
  const stateStyles: string[] = [];
  machine.states.forEach(state => {
    let className = '';

    if (state.type === 'entry') {
      className = 'entryState';
      usedClasses.add('entryState');
    } else if (terminalStates.includes(state)) {
      // Terminal states (no outgoing transitions) in green
      className = 'terminalState';
      usedClasses.add('terminalState');
    } else if (state.type === 'error') {
      className = 'errorState';
      usedClasses.add('errorState');
    }

    if (className) {
      stateStyles.push(`    class ${state.name} ${className}`);
    }
  });

  // Add class definitions
  if (usedClasses.has('entryState')) {
    styleLines.push(`    classDef entryState fill:#fbbf24,stroke:#f59e0b,stroke-width:3px,color:#000`);
  }
  if (usedClasses.has('terminalState')) {
    styleLines.push(`    classDef terminalState fill:#10b981,stroke:#059669,stroke-width:3px,color:#fff`);
  }
  if (usedClasses.has('errorState')) {
    styleLines.push(`    classDef errorState fill:#ef4444,stroke:#dc2626,stroke-width:3px,color:#fff`);
  }

  // Combine: base diagram + class definitions + state class applications
  if (styleLines.length > 0 || stateStyles.length > 0) {
    return baseDiagram + '\n\n' + styleLines.join('\n') + '\n' + stateStyles.join('\n');
  }

  return baseDiagram;
}
