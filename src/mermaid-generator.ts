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

  // Add note at the top if there's a description in metadata
  if (machine.metadata?.description) {
    lines.push(`    note right of ${machine.initialState}`);
    lines.push(`        ${machine.metadata.description}`);
    lines.push(`    end note`);
    lines.push('');
  }

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

  lines.push('');

  // Add state descriptions as notes
  machine.states.forEach(state => {
    if (state.metadata?.description) {
      const desc = state.metadata.description;
      lines.push(`    note right of ${state.name}`);
      // Handle multi-line descriptions
      if (desc.includes('\n')) {
        desc.split('\n').forEach((line: string) => {
          lines.push(`        ${line.trim()}`);
        });
      } else {
        lines.push(`        ${desc}`);
      }
      lines.push(`    end note`);
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

  // Add styling based on state type and metadata
  machine.states.forEach((state, index) => {
    const stateClass = `state${index}`;

    if (state.type === 'entry') {
      styleLines.push(`    class ${state.name} ${stateClass}`);
      styleLines.push(`    classDef ${stateClass} fill:#FFA500,stroke:#FF8C00,stroke-width:2px,color:#000`);
    } else if (state.type === 'final') {
      styleLines.push(`    class ${state.name} ${stateClass}`);
      styleLines.push(`    classDef ${stateClass} fill:#27ae60,stroke:#229954,stroke-width:2px,color:#fff`);
    } else if (state.type === 'error') {
      styleLines.push(`    class ${state.name} ${stateClass}`);
      styleLines.push(`    classDef ${stateClass} fill:#e74c3c,stroke:#c0392b,stroke-width:2px,color:#fff`);
    } else if (state.metadata?.displayColor) {
      styleLines.push(`    class ${state.name} ${stateClass}`);
      styleLines.push(`    classDef ${stateClass} fill:${state.metadata.displayColor},stroke-width:2px`);
    }
  });

  if (styleLines.length > 0) {
    return baseDiagram + '\n\n' + styleLines.join('\n');
  }

  return baseDiagram;
}
