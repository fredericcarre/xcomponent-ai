#!/usr/bin/env node
/**
 * CLI for xcomponent-ai
 * Command-line interface for FSM management and AI agent interactions
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { FSMRuntime } from './fsm-runtime';
import { SupervisorAgent } from './agents';
import { monitoringService } from './monitoring';
import { Component, FSMEvent } from './types';

/**
 * Resolve file path - supports both local paths and package-installed examples
 */
function resolveFilePath(filePath: string): string {
  // If path starts with 'examples/', resolve to package installation directory
  if (filePath.startsWith('examples/')) {
    // __dirname points to dist/, go up one level to package root
    return path.join(__dirname, '..', filePath);
  }
  // Otherwise, use path as-is (relative to current directory)
  return filePath;
}

const program = new Command();

program
  .name('xcomponent-ai')
  .description('Agentic FSM tool for fintech workflows')
  .version('0.2.2');

/**
 * Initialize new project
 */
program
  .command('init <project-name>')
  .description('Initialize new project with xcomponent-ai framework structure')
  .option('-d, --domain <domain>', 'Domain (fintech, healthcare, ecommerce)', 'fintech')
  .action(async (projectName: string, options: any) => {
    try {
      const path = require('path');
      const projectPath = path.join(process.cwd(), projectName);

      console.log(`🚀 Initializing xcomponent-ai project: ${projectName}\n`);

      // Create directory structure
      const dirs = [
        projectPath,
        path.join(projectPath, 'fsm'),
        path.join(projectPath, 'src'),
        path.join(projectPath, 'src/runtime'),
        path.join(projectPath, 'src/api'),
        path.join(projectPath, 'src/ui'),
        path.join(projectPath, 'src/services'),
        path.join(projectPath, 'tests'),
        path.join(projectPath, 'tests/fsm'),
      ];

      for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
      }

      // Create README
      const readme = `# ${projectName}

Built with [xcomponent-ai](https://github.com/fredericcarre/xcomponent-ai) framework.

## 🏗️ Structure

\`\`\`
${projectName}/
├── fsm/              # 🔒 SANCTUARIZED BUSINESS LOGIC
│   └── *.yaml       # FSM definitions (immutable)
├── src/
│   ├── runtime/     # FSM runtime initialization
│   ├── api/         # HTTP → FSM event wrappers
│   ├── ui/          # Frontend components
│   └── services/    # External integrations
└── tests/fsm/       # FSM simulation tests
\`\`\`

## 🚀 Getting Started

1. Define your business logic in \`fsm/*.yaml\`
2. Initialize runtime in \`src/runtime/index.ts\`
3. Create API routes in \`src/api/\`
4. Build UI in \`src/ui/\`

## 📚 Documentation

- [xcomponent-ai Framework Guide](https://github.com/fredericcarre/xcomponent-ai/blob/main/LLM_FRAMEWORK_GUIDE.md)
- [Full Project Example](https://github.com/fredericcarre/xcomponent-ai/blob/main/examples/full-project-structure.md)

## 🔒 Sanctuarization Principle

Business logic lives in \`fsm/\` directory as YAML files. These are:
- Immutable (changes = Git commits)
- Version controlled
- Auditable by non-technical stakeholders
- Separate from technical implementation
`;

      await fs.writeFile(path.join(projectPath, 'README.md'), readme);

      // Create example FSM
      const exampleFSM = `name: ${projectName.charAt(0).toUpperCase() + projectName.slice(1)}Component
version: 1.0.0
metadata:
  domain: ${options.domain}
  description: Main business workflow
  compliance: []

stateMachines:
  - name: MainWorkflow
    initialState: Start
    metadata:
      description: Primary business flow
    states:
      - name: Start
        type: entry
        metadata:
          description: Initial state
      - name: Processing
        type: regular
      - name: Complete
        type: final
      - name: Failed
        type: error
    transitions:
      - from: Start
        to: Processing
        event: BEGIN
        type: triggerable
        guards:
          - keys: [userId]
      - from: Processing
        to: Complete
        event: SUCCESS
        type: regular
      - from: Processing
        to: Failed
        event: ERROR
        type: regular
`;

      await fs.writeFile(path.join(projectPath, 'fsm', 'main-workflow.yaml'), exampleFSM);

      // Create runtime template
      const runtimeTemplate = `import { FSMRuntime } from 'xcomponent-ai';
import * as yaml from 'yaml';
import * as fs from 'fs';

// Load FSM from sanctuarized directory
const mainWorkflowFSM = yaml.parse(
  fs.readFileSync('./fsm/main-workflow.yaml', 'utf-8')
);

export const mainRuntime = new FSMRuntime(mainWorkflowFSM);

// Setup monitoring
mainRuntime.on('state_change', (data) => {
  console.log(\`[\${data.instanceId}] \${data.previousState} → \${data.newState}\`);
});

mainRuntime.on('instance_error', (data) => {
  console.error(\`[ERROR] \${data.instanceId}: \${data.error}\`);
});
`;

      await fs.writeFile(path.join(projectPath, 'src/runtime/index.ts'), runtimeTemplate);

      // Create package.json
      const packageJson = {
        name: projectName,
        version: '1.0.0',
        description: `${projectName} - built with xcomponent-ai`,
        main: 'src/index.ts',
        scripts: {
          dev: 'ts-node src/api/server.ts',
          test: 'jest',
          build: 'tsc',
        },
        dependencies: {
          'xcomponent-ai': '^0.1.0',
          express: '^4.21.2',
          'socket.io': '^4.8.1',
          yaml: '^2.6.1',
        },
        devDependencies: {
          '@types/node': '^22.10.5',
          typescript: '^5.7.3',
          'ts-node': '^10.9.2',
          jest: '^29.7.0',
        },
      };

      await fs.writeFile(path.join(projectPath, 'package.json'), JSON.stringify(packageJson, null, 2));

      // Create .gitignore
      const gitignore = `node_modules/
dist/
coverage/
.env
*.log
`;
      await fs.writeFile(path.join(projectPath, '.gitignore'), gitignore);

      console.log('✓ Project structure created');
      console.log('✓ Example FSM: fsm/main-workflow.yaml');
      console.log('✓ Runtime template: src/runtime/index.ts');
      console.log('✓ README.md created\n');

      console.log('📝 Next steps:');
      console.log(`  cd ${projectName}`);
      console.log('  npm install');
      console.log('  # Edit fsm/main-workflow.yaml to define your business logic');
      console.log('  # Build API/UI that connects to FSM runtime\n');

      console.log('📚 Resources:');
      console.log('  LLM Guide: https://github.com/fredericcarre/xcomponent-ai/blob/main/LLM_FRAMEWORK_GUIDE.md');
      console.log('  Example: https://github.com/fredericcarre/xcomponent-ai/blob/main/examples/full-project-structure.md');
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Load component
 */
program
  .command('load <file>')
  .description('Load FSM component from YAML file')
  .action(async (file: string) => {
    try {
      const resolvedPath = resolveFilePath(file);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const component = yaml.parse(content) as Component;
      console.log(`✓ Loaded component: ${component.name}`);
      console.log(`  Machines: ${component.stateMachines.length}`);
      component.stateMachines.forEach(machine => {
        console.log(`    - ${machine.name} (${machine.states.length} states, ${machine.transitions.length} transitions)`);
      });
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Validate component
 */
program
  .command('validate <file>')
  .description('Validate FSM component YAML file')
  .option('--strict', 'Enable strict validation (warnings become errors)')
  .action(async (file: string, options: any) => {
    try {
      const resolvedPath = resolveFilePath(file);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const component = yaml.parse(content) as Component;

      console.log(`\n🔍 Validating component: ${component.name}\n`);

      let errors: string[] = [];
      let warnings: string[] = [];

      // Check required fields
      if (!component.name) {
        errors.push('Missing required field: name');
      }
      if (!component.stateMachines || component.stateMachines.length === 0) {
        errors.push('Component must have at least one state machine');
      }

      // First pass: collect all machine names
      const machineNames = new Set<string>();
      component.stateMachines?.forEach(machine => {
        if (machine.name) {
          machineNames.add(machine.name);
        }
      });

      // Second pass: validate each state machine
      component.stateMachines?.forEach((machine, idx) => {
        const prefix = `Machine "${machine.name || `#${idx}`}"`;

        if (!machine.name) {
          errors.push(`${prefix}: Missing required field: name`);
        } else {
          // Check for duplicate names
          const count = component.stateMachines.filter(m => m.name === machine.name).length;
          if (count > 1) {
            errors.push(`${prefix}: Duplicate machine name`);
          }
        }

        if (!machine.initialState) {
          errors.push(`${prefix}: Missing required field: initialState`);
        }

        if (!machine.states || machine.states.length === 0) {
          errors.push(`${prefix}: Must have at least one state`);
        }

        // Build state set
        const stateNames = new Set<string>();
        machine.states?.forEach(state => {
          if (stateNames.has(state.name)) {
            errors.push(`${prefix}: Duplicate state name "${state.name}"`);
          }
          stateNames.add(state.name);
        });

        // Check initialState exists
        if (machine.initialState && !stateNames.has(machine.initialState)) {
          errors.push(`${prefix}: initialState "${machine.initialState}" does not exist in states`);
        }

        // Validate transitions
        const statesWithOutgoing = new Set<string>();
        const terminalStates = new Set<string>();

        machine.states?.forEach(state => {
          if (state.type === 'final' || state.type === 'error') {
            terminalStates.add(state.name);
          }
        });

        machine.transitions?.forEach((transition, tidx) => {
          const tPrefix = `${prefix} transition #${tidx + 1}`;

          if (!transition.from) {
            errors.push(`${tPrefix}: Missing required field: from`);
          } else if (!stateNames.has(transition.from)) {
            errors.push(`${tPrefix}: "from" state "${transition.from}" does not exist`);
          } else {
            statesWithOutgoing.add(transition.from);
          }

          if (!transition.to) {
            errors.push(`${tPrefix}: Missing required field: to`);
          } else if (!stateNames.has(transition.to)) {
            errors.push(`${tPrefix}: "to" state "${transition.to}" does not exist`);
          }

          if (!transition.event) {
            errors.push(`${tPrefix}: Missing required field: event`);
          }

          // Check inter_machine transitions
          if (transition.type === 'inter_machine') {
            if (!transition.targetMachine) {
              errors.push(`${tPrefix}: inter_machine transition must have targetMachine`);
            } else if (!machineNames.has(transition.targetMachine) && transition.targetMachine !== machine.name) {
              warnings.push(`${tPrefix}: targetMachine "${transition.targetMachine}" not found in this component (may be external)`);
            }
          }

          // Check timeout transitions
          if (transition.type === 'timeout' && !transition.timeoutMs) {
            errors.push(`${tPrefix}: timeout transition must have timeoutMs value`);
          }
        });

        // Check for terminal states (states with no outgoing transitions)
        machine.states?.forEach(state => {
          if (!statesWithOutgoing.has(state.name) && state.type !== 'final' && state.type !== 'error') {
            terminalStates.add(state.name);
          }
        });

        // Check reachability from initial state (simplified)
        if (terminalStates.size === 0) {
          warnings.push(`${prefix}: No terminal states detected (final, error, or states without outgoing transitions)`);
        }
      });

      // Check entryMachine
      if (component.entryMachine && !machineNames.has(component.entryMachine)) {
        errors.push(`entryMachine "${component.entryMachine}" does not exist in stateMachines`);
      }

      // Report results
      console.log('📊 Validation Results\n');

      if (errors.length === 0 && warnings.length === 0) {
        console.log('✅ Component is valid!\n');
        console.log(`   ${component.stateMachines.length} state machine(s)`);
        let totalStates = 0;
        let totalTransitions = 0;
        component.stateMachines.forEach(m => {
          totalStates += m.states?.length || 0;
          totalTransitions += m.transitions?.length || 0;
        });
        console.log(`   ${totalStates} state(s) total`);
        console.log(`   ${totalTransitions} transition(s) total`);
      } else {
        if (errors.length > 0) {
          console.log(`❌ ${errors.length} error(s):\n`);
          errors.forEach(e => console.log(`   • ${e}`));
          console.log('');
        }

        if (warnings.length > 0) {
          console.log(`⚠️  ${warnings.length} warning(s):\n`);
          warnings.forEach(w => console.log(`   • ${w}`));
          console.log('');
        }

        if (errors.length > 0 || (options.strict && warnings.length > 0)) {
          process.exit(1);
        }
      }
    } catch (error: any) {
      console.error(`\n❌ Validation failed: ${error.message}\n`);
      process.exit(1);
    }
  });

/**
 * Run FSM instance
 */
program
  .command('run <file> <machine>')
  .description('Create and run FSM instance')
  .option('-c, --context <json>', 'Initial context as JSON')
  .option('-e, --events <json>', 'Events to send as JSON array')
  .action(async (file: string, machine: string, options: any) => {
    try {
      const resolvedPath = resolveFilePath(file);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const component = yaml.parse(content) as Component;
      const runtime = new FSMRuntime(component);

      // Setup logging
      runtime.on('state_change', (data) => {
        console.log(`  ${data.previousState} → ${data.newState} (event: ${data.event.type})`);
        monitoringService.logTransition({
          instanceId: data.instanceId,
          from: data.previousState,
          to: data.newState,
          event: data.event.type,
          time: data.timestamp,
        });
      });

      runtime.on('instance_error', (data) => {
        console.error(`  ✗ Error: ${data.error}`);
      });

      runtime.on('guard_failed', (data) => {
        console.log(`  ⚠ Guard failed for event: ${data.event.type}`);
      });

      const context = options.context ? JSON.parse(options.context) : {};
      const instanceId = runtime.createInstance(machine, context);
      console.log(`✓ Created instance: ${instanceId}`);

      if (options.events) {
        const events: FSMEvent[] = JSON.parse(options.events);
        for (const event of events) {
          await runtime.sendEvent(instanceId, event);
        }
      }

      const instance = runtime.getInstance(instanceId);
      if (instance) {
        console.log(`\n✓ Final state: ${instance.currentState}`);
        console.log(`  Status: ${instance.status}`);
      }
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Simulate FSM path
 */
program
  .command('simulate <file> <machine>')
  .description('Simulate FSM execution path')
  .option('-e, --events <json>', 'Events to simulate as JSON array')
  .action(async (file: string, machine: string, options: any) => {
    try {
      const content = await fs.readFile(file, 'utf-8');
      const component = yaml.parse(content) as Component;
      const runtime = new FSMRuntime(component);

      const events: FSMEvent[] = options.events ? JSON.parse(options.events) : [];
      const result = runtime.simulatePath(machine, events);

      if (result.success) {
        console.log(`✓ Simulation successful`);
        console.log(`  Path: ${result.path.join(' → ')}`);
      } else {
        console.error(`✗ Simulation failed: ${result.error}`);
        console.log(`  Path: ${result.path.join(' → ')}`);
      }
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Create FSM with AI
 */
program
  .command('ai-create <description>')
  .description('Create FSM using AI from natural language description')
  .option('-o, --output <file>', 'Output file for generated YAML')
  .action(async (description: string, options: any) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable not set');
      }

      const supervisor = new SupervisorAgent();
      console.log('🤖 Creating FSM with AI...');

      const result = await supervisor.getFSMAgent().createFSM(description);

      if (result.success) {
        console.log('✓ FSM created successfully\n');
        console.log(result.data.yaml);

        if (result.suggestions && result.suggestions.length > 0) {
          console.log('\n💡 Suggestions:');
          result.suggestions.forEach((s: string) => console.log(`  - ${s}`));
        }

        if (options.output) {
          await fs.writeFile(options.output, result.data.yaml);
          console.log(`\n✓ Saved to: ${options.output}`);
        }
      } else {
        console.error(`✗ Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Analyze logs with AI
 */
program
  .command('ai-analyze <component>')
  .description('Analyze FSM logs with AI insights')
  .action(async (component: string) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable not set');
      }

      const supervisor = new SupervisorAgent();
      console.log('🤖 Analyzing logs with AI...\n');

      const result = await supervisor.getMonitoringAgent().analyzeLogs(component);

      if (result.success) {
        console.log('📊 Summary:');
        console.log(result.data.summary);
        console.log('\n🧠 AI Analysis:');
        console.log(result.data.llmAnalysis);
      } else {
        console.error(`✗ Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });

/**
 * Generate UI code
 */
program
  .command('generate-ui <file>')
  .description('Generate UI code for FSM')
  .option('-t, --type <type>', 'UI type: api or react', 'api')
  .option('-o, --output <file>', 'Output file')
  .action(async (file: string, options: any) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY environment variable not set');
      }

      const content = await fs.readFile(file, 'utf-8');
      const component = yaml.parse(content) as Component;

      const supervisor = new SupervisorAgent();
      console.log(`🤖 Generating ${options.type} code...\n`);

      const result = options.type === 'api'
        ? await supervisor.getUIAgent().generateAPIRoutes(component)
        : await supervisor.getUIAgent().generateReactUI(component);

      if (result.success) {
        console.log(result.data.code);

        if (options.output) {
          await fs.writeFile(options.output, result.data.code);
          console.log(`\n✓ Saved to: ${options.output}`);
        }
      } else {
        console.error(`✗ Error: ${result.error}`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });
/**
 * Serve FSM with runtime, API, and dashboard
 */
program
  .command('serve <files...>')
  .description('Start runtime with API server and dashboard (supports multiple YAML files)')
  .option('-p, --port <port>', 'Port number', '3000')
  .option('-b, --broker <url>', 'Message broker URL (memory, redis://..., amqp://...)', process.env.XCOMPONENT_BROKER_URL || 'memory')
  .option('--external-api', 'Enable external API for sending events via message broker')
  .option('--publish-events', 'Publish FSM events to message broker for external subscribers')
  .action(async (files: string[], options: any) => {
    try {
      // Import ComponentRegistry and MessageBroker
      const { ComponentRegistry } = await import('./component-registry');
      const { createMessageBroker } = await import('./message-broker');
      const { ExternalBrokerAPI } = await import('./external-broker-api');

      // Create message broker based on option
      const brokerUrl = options.broker;
      const broker = createMessageBroker(brokerUrl);

      // Create registry with broker
      const registry = new ComponentRegistry(broker);

      // Initialize broker connection
      await registry.initialize();

      // Log broker mode
      if (brokerUrl === 'memory' || brokerUrl === 'in-memory') {
        console.log('📡 Mode: In-Memory (single process)');
      } else {
        console.log(`📡 Mode: Distributed (broker: ${brokerUrl})`);
      }

      // Setup external broker API if enabled
      let externalAPI: typeof ExternalBrokerAPI.prototype | null = null;
      if (options.externalApi || options.publishEvents) {
        externalAPI = new ExternalBrokerAPI({
          broker,
          registry,
          handleCommands: options.externalApi ?? false,
          publishEvents: options.publishEvents ?? false,
        });
        await externalAPI.initialize();

        if (options.externalApi) {
          console.log('🌐 External API: Enabled (listening for commands on broker)');
        }
        if (options.publishEvents) {
          console.log('📢 Event Publishing: Enabled (publishing FSM events to broker)');
        }
      }

      console.log('🚀 xcomponent-ai Runtime Started');
      console.log('━'.repeat(40));

      // Listen to registry events for entry points (before loading components)
      registry.on('entry_point_created', (data: any) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] [${data.componentName}] ⭐ Entry point instance created: ${data.instanceId.substring(0, 8)} (${data.machineName})`);
      });

      // Load all component files
      for (const file of files) {
        const resolvedPath = resolveFilePath(file);
        const content = await fs.readFile(resolvedPath, 'utf-8');
        const component = yaml.parse(content) as Component;

        // Create runtime for this component
        const runtime = new FSMRuntime(component);
        registry.registerComponent(component, runtime);

        console.log(`\n📦 Component: ${component.name}`);
        if (component.entryMachine) {
          console.log(`   ⭐ Entry Point: ${component.entryMachine}`);
        }
        console.log(`   Machines:`);
        component.stateMachines.forEach(machine => {
          console.log(`   - ${machine.name} (${machine.states.length} states, ${machine.transitions.length} transitions)`);
        });

        // Setup logging for each runtime
        runtime.on('state_change', (data) => {
          const timestamp = new Date().toLocaleTimeString();
          console.log(`[${timestamp}] [${component.name}] ${data.instanceId}: ${data.previousState} → ${data.newState} (event: ${data.event.type})`);
        });

        runtime.on('instance_created', (data) => {
          const timestamp = new Date().toLocaleTimeString();
          console.log(`[${timestamp}] [${component.name}] Instance ${data.instanceId} created (${data.machineName})`);
        });

        runtime.on('instance_error', (data) => {
          const timestamp = new Date().toLocaleTimeString();
          console.error(`[${timestamp}] [${component.name}] ✗ Error in ${data.instanceId}: ${data.error}`);
        });
      }

      const port = parseInt(options.port);
      console.log(`\n🌐 API Server:    http://localhost:${port}`);
      console.log(`📊 Dashboard:     http://localhost:${port}/dashboard.html`);
      console.log(`📚 API Docs:      http://localhost:${port}/api-docs`);
      console.log(`📡 WebSocket:     ws://localhost:${port}`);
      console.log('\n' + '━'.repeat(40));
      console.log('Press Ctrl+C to stop\n');

      // Create Express server
      const express = await import('express');
      const { createServer } = await import('http');
      const { Server } = await import('socket.io');
      const swaggerUi = await import('swagger-ui-express');
      const path = await import('path');

      const app = express.default();
      const httpServer = createServer(app);
      const io = new Server(httpServer);

      // Middleware
      app.use(express.default.json());

      // Serve static files from public directory
      const publicPath = path.join(__dirname, '..', 'public');
      app.use(express.default.static(publicPath));

      // Generate and serve Swagger documentation (for first component)
      const { generateSwaggerSpec } = await import('./swagger-spec');
      const firstComponent = registry.getAllComponentInfo()[0];
      if (firstComponent) {
        const swaggerSpec = generateSwaggerSpec(registry.getComponent(firstComponent.name)!, port);
        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
      }

      // API Routes - Multi-component support
      // List all components
      app.get('/api/components', (_req: any, res: any) => {
        const components = registry.getAllComponentInfo().map(info => ({
          name: info.name,
          version: info.version,
          machineCount: info.machineCount,
          instanceCount: info.instanceCount
        }));
        res.json({ components });
      });

      // Get component definition
      app.get('/api/components/:componentName', (req: any, res: any) => {
        const component = registry.getComponent(req.params.componentName);
        if (!component) {
          return res.status(404).json({ error: 'Component not found' });
        }
        res.json({ component });
      });

      // Create instance in a component
      app.post('/api/components/:componentName/instances', (req: any, res: any) => {
        try {
          const runtime = registry.getRuntime(req.params.componentName);
          if (!runtime) {
            return res.status(404).json({ error: 'Component not found' });
          }
          const { machineName, context } = req.body;
          const instanceId = runtime.createInstance(machineName, context || {});
          res.json({ instanceId, componentName: req.params.componentName });
        } catch (error: any) {
          res.status(400).json({ error: error.message });
        }
      });

      // Get all instances across all components
      app.get('/api/instances', (_req: any, res: any) => {
        const allInstances: any[] = [];
        for (const componentName of registry.getComponentNames()) {
          const runtime = registry.getRuntime(componentName);
          if (runtime) {
            const instances = runtime.getAllInstances().map(i => ({
              ...i,
              componentName,
              pendingTimeouts: runtime.getPendingTimeouts(i.id)
            }));
            allInstances.push(...instances);
          }
        }
        res.json({ instances: allInstances });
      });

      // Get specific instance (searches all components)
      app.get('/api/instances/:id', (req: any, res: any) => {
        for (const componentName of registry.getComponentNames()) {
          const runtime = registry.getRuntime(componentName);
          if (runtime) {
            const instance = runtime.getInstance(req.params.id);
            if (instance) {
              return res.json({ instance: { ...instance, componentName } });
            }
          }
        }
        res.status(404).json({ error: 'Instance not found' });
      });

      // Send event to instance (auto-detects component)
      app.post('/api/instances/:id/events', async (req: any, res: any) => {
        try {
          for (const componentName of registry.getComponentNames()) {
            const runtime = registry.getRuntime(componentName);
            if (runtime && runtime.getInstance(req.params.id)) {
              await runtime.sendEvent(req.params.id, req.body);
              return res.json({ success: true });
            }
          }
          res.status(404).json({ error: 'Instance not found' });
        } catch (error: any) {
          res.status(400).json({ error: error.message });
        }
      });

      // Send event to instance (component-scoped route for dashboard compatibility)
      app.post('/api/components/:componentName/instances/:id/events', async (req: any, res: any) => {
        try {
          const runtime = registry.getRuntime(req.params.componentName);
          if (!runtime) {
            return res.status(404).json({ error: 'Component not found' });
          }
          if (!runtime.getInstance(req.params.id)) {
            return res.status(404).json({ error: 'Instance not found' });
          }
          await runtime.sendEvent(req.params.id, req.body);
          return res.json({ success: true });
        } catch (error: any) {
          res.status(400).json({ error: error.message });
        }
      });

      // Get instance history
      app.get('/api/instances/:id/history', async (req: any, res: any) => {
        try {
          for (const componentName of registry.getComponentNames()) {
            const runtime = registry.getRuntime(componentName);
            if (runtime && runtime.getInstance(req.params.id)) {
              const history = await runtime.getInstanceHistory(req.params.id);
              return res.json({ history });
            }
          }
          res.status(404).json({ error: 'Instance not found' });
        } catch (error: any) {
          res.status(400).json({ error: error.message });
        }
      });

      // Mermaid diagram endpoint
      // Supports optional ?currentState=stateName to highlight the current state
      app.get('/api/components/:componentName/diagrams/:machineName', (req: any, res: any) => {
        const component = registry.getComponent(req.params.componentName);
        if (!component) {
          return res.status(404).json({ error: 'Component not found' });
        }

        const machine = component.stateMachines.find(m => m.name === req.params.machineName);
        if (!machine) {
          return res.status(404).json({ error: 'State machine not found' });
        }

        const { generateStyledMermaidDiagram, detectTerminalStates, getTransitionsInfo } = require('./mermaid-generator');
        const currentState = req.query.currentState;
        const diagram = generateStyledMermaidDiagram(machine, currentState);
        const terminalStates = Array.from(detectTerminalStates(machine));
        const transitions = getTransitionsInfo(machine);
        res.json({ diagram, terminalStates, transitions });
      });

      // Mermaid diagram endpoint (auto-detects component by machine name)
      app.get('/api/machines/:machineName/diagram', (req: any, res: any) => {
        // Search for machine across all components
        for (const componentName of registry.getComponentNames()) {
          const component = registry.getComponent(componentName);
          if (component) {
            const machine = component.stateMachines.find(m => m.name === req.params.machineName);
            if (machine) {
              const { generateStyledMermaidDiagram, detectTerminalStates, getTransitionsInfo } = require('./mermaid-generator');
              const currentState = req.query.currentState;
              const diagram = generateStyledMermaidDiagram(machine, currentState);
              const terminalStates = Array.from(detectTerminalStates(machine));
              const transitions = getTransitionsInfo(machine);
              return res.json({ diagram, terminalStates, transitions });
            }
          }
        }
        res.status(404).json({ error: 'State machine not found' });
      });

      // WebSocket Integration
      io.on('connection', (socket) => {
        console.log(`[WebSocket] Client connected: ${socket.id}`);

        // Send all components data on connection
        const components = registry.getComponentNames().map(name => registry.getComponent(name));
        socket.emit('components_list', { components });

        socket.on('disconnect', () => {
          console.log(`[WebSocket] Client disconnected: ${socket.id}`);
        });
      });

      // Broadcast runtime events from all components to WebSocket clients
      for (const componentName of registry.getComponentNames()) {
        const runtime = registry.getRuntime(componentName);
        if (runtime) {
          runtime.on('state_change', (data) => {
            io.emit('state_change', { ...data, componentName });
          });

          runtime.on('instance_created', (data) => {
            io.emit('instance_created', { ...data, componentName });
          });

          runtime.on('instance_error', (data) => {
            io.emit('instance_error', { ...data, componentName });
          });

          runtime.on('instance_disposed', (data) => {
            io.emit('instance_disposed', { ...data, componentName });
          });
        }
      }
      
      // Start server
      httpServer.listen(port);
      
      // Keep process alive
      process.on('SIGINT', async () => {
        console.log('\n\n👋 Shutting down gracefully...');
        if (externalAPI) {
          await externalAPI.dispose();
        }
        await registry.dispose();
        process.exit(0);
      });
      
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });



program.parse();
