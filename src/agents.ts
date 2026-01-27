/**
 * Agentic AI Layer with LangChain
 * Supervisor LLM orchestrating specialized agents
 */

import { ChatOpenAI } from '@langchain/openai';
import { Component, FSMEvent, AgentToolResult } from './types';
import { FSMRuntime } from './fsm-runtime';
import { monitoringService } from './monitoring';
import * as yaml from 'yaml';

/**
 * FSM Agent - handles FSM creation, updates, and simulation
 */
export class FSMAgent {
  private llm: ChatOpenAI;

  constructor(apiKey?: string) {
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.2,
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Create FSM from natural language description
   */
  async createFSM(description: string): Promise<AgentToolResult> {
    try {
      const prompt = `You are an expert in creating finite state machines for fintech workflows.
Create a complete FSM component in YAML format based on this description: "${description}"

Requirements:
- Follow XComponent conventions: entry state (initial), regular states, final state, error state
- Include triggered methods for compliance logic (e.g., amount limits, KYC checks, RGPD)
- Add timeout transitions where appropriate
- Include metadata for compliance tracking
- Use inter-machine transitions if multiple workflows are involved

Return ONLY the YAML content, no explanations.`;

      const response = await this.llm.invoke(prompt);
      const yamlContent = response.content.toString();

      // Parse to validate
      const component = yaml.parse(yamlContent) as Component;

      // Detect missing compliance elements
      const suggestions = this.detectMissingCompliance(component, description);

      return {
        success: true,
        data: {
          yaml: yamlContent,
          component,
        },
        suggestions,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update existing FSM
   */
  async updateFSM(currentYaml: string, changes: string): Promise<AgentToolResult> {
    try {
      const prompt = `You are an expert in updating finite state machines.
Current FSM:
\`\`\`yaml
${currentYaml}
\`\`\`

Apply these changes: "${changes}"

Return ONLY the updated YAML content, no explanations.`;

      const response = await this.llm.invoke(prompt);
      const yamlContent = response.content.toString();

      // Parse to validate
      const component = yaml.parse(yamlContent) as Component;

      return {
        success: true,
        data: {
          yaml: yamlContent,
          component,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Simulate FSM path
   */
  async simulatePath(component: Component, machineName: string, eventDescriptions: string[]): Promise<AgentToolResult> {
    try {
      // Convert descriptions to events using LLM
      const prompt = `Convert these event descriptions into JSON event objects:
${eventDescriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

For a state machine with these transitions:
${JSON.stringify(component.stateMachines.find(m => m.name === machineName)?.transitions || [])}

Return a JSON array of events with type and payload fields.`;

      const response = await this.llm.invoke(prompt);
      const eventsJson = response.content.toString();
      const events: FSMEvent[] = JSON.parse(eventsJson);

      // Simulate
      const runtime = new FSMRuntime(component);
      const result = runtime.simulatePath(machineName, events);

      return {
        success: result.success,
        data: result,
        error: result.error,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Detect missing compliance elements
   */
  private detectMissingCompliance(component: Component, description: string): string[] {
    const suggestions: string[] = [];
    const descLower = description.toLowerCase();

    // Check for AML/KYC
    if ((descLower.includes('payment') || descLower.includes('trading') || descLower.includes('kyc')) &&
        !JSON.stringify(component).toLowerCase().includes('aml') &&
        !JSON.stringify(component).toLowerCase().includes('kyc')) {
      suggestions.push('Consider adding AML/KYC compliance checks as triggered methods');
    }

    // Check for RGPD/GDPR
    if (descLower.includes('user') || descLower.includes('customer')) {
      if (!JSON.stringify(component).toLowerCase().includes('rgpd') &&
          !JSON.stringify(component).toLowerCase().includes('gdpr')) {
        suggestions.push('Consider adding RGPD/GDPR compliance checks as triggered methods for user data');
      }
    }

    // Check for error states
    component.stateMachines.forEach(machine => {
      const hasErrorState = machine.states.some(s => s.type === 'error');
      if (!hasErrorState) {
        suggestions.push(`Machine "${machine.name}" missing explicit error state`);
      }
    });

    // Check for timeouts on critical operations
    if (descLower.includes('payment') || descLower.includes('transaction')) {
      component.stateMachines.forEach(machine => {
        const hasTimeouts = machine.transitions.some(t => t.type === 'timeout');
        if (!hasTimeouts) {
          suggestions.push(`Machine "${machine.name}" should have timeout transitions for payment operations`);
        }
      });
    }

    return suggestions;
  }
}

/**
 * UI Agent - generates code wrappers
 */
export class UIAgent {
  private llm: ChatOpenAI;

  constructor(apiKey?: string) {
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.3,
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Generate Express API routes for FSM
   */
  async generateAPIRoutes(component: Component): Promise<AgentToolResult> {
    try {
      const prompt = `Generate Express.js TypeScript code for API routes that trigger events on this FSM component:

${JSON.stringify(component, null, 2)}

Generate:
1. POST /api/:machine/instance - Create instance
2. POST /api/:machine/:instanceId/event - Send event
3. GET /api/:machine/:instanceId - Get instance state

Return only the TypeScript code, no explanations.`;

      const response = await this.llm.invoke(prompt);
      const code = response.content.toString();

      return {
        success: true,
        data: { code, type: 'express-routes' },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate React UI stub
   */
  async generateReactUI(component: Component): Promise<AgentToolResult> {
    try {
      const prompt = `Generate a React TypeScript component stub for interacting with this FSM:

${JSON.stringify(component, null, 2)}

Include:
- State display
- Event trigger buttons
- Instance list

Return only the React component code, no explanations.`;

      const response = await this.llm.invoke(prompt);
      const code = response.content.toString();

      return {
        success: true,
        data: { code, type: 'react-component' },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

/**
 * Monitoring Agent - analyzes logs and provides insights
 */
export class MonitoringAgent {
  private llm: ChatOpenAI;

  constructor(apiKey?: string) {
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.1,
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Analyze logs with natural language insights
   */
  async analyzeLogs(componentName: string): Promise<AgentToolResult> {
    try {
      const summary = monitoringService.generateSummary(componentName);
      const insights = monitoringService.analyzeLogs(componentName);

      const prompt = `Analyze these FSM execution metrics and provide actionable insights for a fintech workflow:

${summary}

Provide:
1. Key issues and risks
2. Performance optimization suggestions
3. Compliance concerns if any
4. Recommended FSM changes

Be specific and actionable.`;

      const response = await this.llm.invoke(prompt);
      const analysis = response.content.toString();

      return {
        success: true,
        data: {
          summary,
          insights,
          llmAnalysis: analysis,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

/**
 * Supervisor Agent - orchestrates other agents
 */
export class SupervisorAgent {
  private fsmAgent: FSMAgent;
  private uiAgent: UIAgent;
  private monitoringAgent: MonitoringAgent;
  private llm: ChatOpenAI;

  constructor(apiKey?: string) {
    this.fsmAgent = new FSMAgent(apiKey);
    this.uiAgent = new UIAgent(apiKey);
    this.monitoringAgent = new MonitoringAgent(apiKey);
    this.llm = new ChatOpenAI({
      modelName: 'gpt-4o',
      temperature: 0.2,
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
  }

  /**
   * Process user request
   */
  async processRequest(request: string): Promise<AgentToolResult> {
    try {
      // Determine which agent(s) to use
      const prompt = `Analyze this user request and determine which agent(s) to use:
"${request}"

Available agents:
- fsm: Create or update state machines
- ui: Generate UI/API code
- monitoring: Analyze logs and performance

Return a JSON object: { "agents": ["agent1", "agent2"], "action": "description" }`;

      const response = await this.llm.invoke(prompt);
      const plan = JSON.parse(response.content.toString());

      const results: any[] = [];

      // Execute agent actions
      for (const agent of plan.agents) {
        if (agent === 'fsm') {
          results.push(await this.fsmAgent.createFSM(request));
        } else if (agent === 'ui') {
          // Would need component context
          results.push({ success: true, data: 'UI generation requires component context' });
        } else if (agent === 'monitoring') {
          results.push(await this.monitoringAgent.analyzeLogs('default'));
        }
      }

      return {
        success: true,
        data: {
          plan,
          results,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get FSM agent
   */
  getFSMAgent(): FSMAgent {
    return this.fsmAgent;
  }

  /**
   * Get UI agent
   */
  getUIAgent(): UIAgent {
    return this.uiAgent;
  }

  /**
   * Get monitoring agent
   */
  getMonitoringAgent(): MonitoringAgent {
    return this.monitoringAgent;
  }
}
