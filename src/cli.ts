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
  .version('0.1.7');

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

Built with [xcomponent-ai](https://github.com/fredericcarre/mayele-ai) framework.

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

- [xcomponent-ai Framework Guide](https://github.com/fredericcarre/mayele-ai/blob/main/LLM_FRAMEWORK_GUIDE.md)
- [Full Project Example](https://github.com/fredericcarre/mayele-ai/blob/main/examples/full-project-structure.md)

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
      console.log('  LLM Guide: https://github.com/fredericcarre/mayele-ai/blob/main/LLM_FRAMEWORK_GUIDE.md');
      console.log('  Example: https://github.com/fredericcarre/mayele-ai/blob/main/examples/full-project-structure.md');
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
  .command('serve <file>')
  .description('Start runtime with API server and dashboard')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(async (file: string, options: any) => {
    try {
      const resolvedPath = resolveFilePath(file);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      const component = yaml.parse(content) as Component;
      
      console.log('🚀 xcomponent-ai Runtime Started');
      console.log('━'.repeat(40));
      console.log(`\n📦 Component: ${component.name}`);
      console.log(`   Machines:`);
      component.stateMachines.forEach(machine => {
        console.log(`   - ${machine.name} (${machine.states.length} states, ${machine.transitions.length} transitions)`);
      });
      
      const port = parseInt(options.port);
      console.log(`\n🌐 API Server:    http://localhost:${port}`);
      console.log(`📊 Dashboard:     http://localhost:${port}/dashboard`);
      console.log(`📡 WebSocket:     ws://localhost:${port}`);
      console.log('\n' + '━'.repeat(40));
      console.log('Press Ctrl+C to stop\n');
      
      // Create runtime
      const runtime = new FSMRuntime(component);
      
      // Setup logging
      runtime.on('state_change', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${data.instanceId}: ${data.previousState} → ${data.newState} (event: ${data.event.type})`);
      });
      
      runtime.on('instance_created', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] Instance ${data.instanceId} created (${data.machineName})`);
      });
      
      runtime.on('instance_error', (data) => {
        const timestamp = new Date().toLocaleTimeString();
        console.error(`[${timestamp}] ✗ Error in ${data.instanceId}: ${data.error}`);
      });
      
      // Create Express server
      const express = await import('express');
      const { createServer } = await import('http');
      const app = express.default();
      const httpServer = createServer(app);
      
      // Middleware
      app.use(express.default.json());
      
      // API Routes
      app.post('/api/instances', (req: any, res: any) => {
        try {
          const { machineName, context } = req.body;
          const instanceId = runtime.createInstance(machineName, context || {});
          res.json({ instanceId });
        } catch (error: any) {
          res.status(400).json({ error: error.message });
        }
      });
      
      app.get('/api/instances', (_req: any, res: any) => {
        const instances = runtime.getAllInstances();
        res.json({ instances });
      });
      
      app.get('/api/instances/:id', (req: any, res: any) => {
        const instance = runtime.getInstance(req.params.id);
        if (!instance) {
          return res.status(404).json({ error: 'Instance not found' });
        }
        res.json({ instance });
      });
      
      app.post('/api/instances/:id/events', async (req: any, res: any) => {
        try {
          await runtime.sendEvent(req.params.id, req.body);
          res.json({ success: true });
        } catch (error: any) {
          res.status(400).json({ error: error.message });
        }
      });
      
      // Simple dashboard HTML
      app.get('/dashboard', (_req: any, res: any) => {
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>xcomponent-ai Dashboard</title>
            <style>
              body { font-family: sans-serif; margin: 20px; background: #f5f5f5; }
              h1 { color: #333; }
              .instance { background: white; border: 1px solid #ddd; padding: 15px; margin: 10px 0; border-radius: 5px; }
              .instance strong { color: #0066cc; }
              .create-form { background: white; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
              input, select, button { padding: 8px; margin: 5px; }
              button { background: #0066cc; color: white; border: none; cursor: pointer; }
              button:hover { background: #0052a3; }
            </style>
          </head>
          <body>
            <h1>📊 xcomponent-ai Dashboard</h1>
            <p><strong>Component:</strong> ${component.name}</p>
            
            <div class="create-form">
              <h2>Create Instance</h2>
              <select id="machine">
                ${component.stateMachines.map(m => `<option value="${m.name}">${m.name}</option>`).join('')}
              </select>
              <input type="text" id="context" placeholder='{"key": "value"}' />
              <button onclick="createInstance()">Create</button>
            </div>
            
            <h2>Instances</h2>
            <div id="instances">Loading...</div>
            
            <script>
              async function createInstance() {
                const machine = document.getElementById('machine').value;
                const contextStr = document.getElementById('context').value;
                const context = contextStr ? JSON.parse(contextStr) : {};
                await fetch('/api/instances', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ machineName: machine, context })
                });
                document.getElementById('context').value = '';
                loadInstances();
              }
              
              async function loadInstances() {
                const res = await fetch('/api/instances');
                const data = await res.json();
                document.getElementById('instances').innerHTML = data.instances.length === 0
                  ? '<p>No instances yet. Create one above!</p>'
                  : data.instances.map(i => 
                      \`<div class="instance">
                        <strong>\${i.id}</strong><br/>
                        Machine: \${i.machineName}<br/>
                        State: <strong>\${i.currentState}</strong><br/>
                        Status: \${i.status}
                      </div>\`
                    ).join('');
              }
              
              setInterval(loadInstances, 1000);
              loadInstances();
            </script>
          </body>
          </html>
        `);
      });
      
      // Start server
      httpServer.listen(port);
      
      // Keep process alive
      process.on('SIGINT', () => {
        console.log('\n\n👋 Shutting down gracefully...');
        runtime.dispose();
        process.exit(0);
      });
      
    } catch (error: any) {
      console.error(`✗ Error: ${error.message}`);
      process.exit(1);
    }
  });



program.parse();
