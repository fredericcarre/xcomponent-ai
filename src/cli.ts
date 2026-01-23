#!/usr/bin/env node
/**
 * CLI for xcomponent-ai
 * Command-line interface for FSM management and AI agent interactions
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as yaml from 'yaml';
import { FSMRuntime } from './fsm-runtime';
import { SupervisorAgent } from './agents';
import { monitoringService } from './monitoring';
import { Component, FSMEvent } from './types';

const program = new Command();

program
  .name('xcomponent-ai')
  .description('Agentic FSM tool for fintech workflows')
  .version('0.1.0');

/**
 * Load component
 */
program
  .command('load <file>')
  .description('Load FSM component from YAML file')
  .action(async (file: string) => {
    try {
      const content = await fs.readFile(file, 'utf-8');
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
      const content = await fs.readFile(file, 'utf-8');
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

program.parse();
