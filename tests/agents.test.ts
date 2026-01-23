/**
 * Agentic AI Tests
 * Note: These tests require OPENAI_API_KEY or use mocks
 */

import { FSMAgent, UIAgent, MonitoringAgent, SupervisorAgent } from '../src/agents';
import { Component } from '../src/types';

// Mock LLM for testing without API calls
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockImplementation((prompt: any) => {
      const promptStr = typeof prompt === 'string' ? prompt : String(prompt);

      // For event conversion (simulate path)
      if (promptStr.includes('Convert these event descriptions')) {
        return Promise.resolve({
          content: JSON.stringify([
            { type: 'COMPLETE', payload: {}, timestamp: Date.now() }
          ]),
        });
      }

      // For supervisor planning
      if (promptStr.includes('Analyze this user request')) {
        return Promise.resolve({
          content: JSON.stringify({
            agents: ['fsm'],
            action: 'Create FSM from description',
          }),
        });
      }

      // For monitoring analysis
      if (promptStr.includes('Analyze these FSM execution metrics')) {
        return Promise.resolve({
          content: 'Analysis: The workflow is performing well with minimal errors.',
        });
      }

      // Default: FSM YAML generation
      return Promise.resolve({
        content: `name: MockComponent
version: 1.0.0
stateMachines:
  - name: MockMachine
    initialState: Start
    states:
      - name: Start
        type: entry
      - name: End
        type: final
    transitions:
      - from: Start
        to: End
        event: COMPLETE
        type: regular`,
      });
    }),
  })),
}));

describe('FSMAgent', () => {
  let agent: FSMAgent;

  beforeEach(() => {
    agent = new FSMAgent('mock-api-key');
  });

  describe('FSM Creation', () => {
    it('should create FSM from description', async () => {
      const result = await agent.createFSM('Create a simple payment workflow');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.yaml).toBeDefined();
      expect(result.data.component).toBeDefined();
    });

    it('should detect missing compliance elements', async () => {
      const result = await agent.createFSM('Create a payment workflow for user transactions');

      expect(result.success).toBe(true);
      // Should suggest AML/RGPD
      expect(result.suggestions).toBeDefined();
    });
  });

  describe('FSM Updates', () => {
    it('should update existing FSM', async () => {
      const currentYaml = `name: TestComponent
version: 1.0.0
stateMachines:
  - name: Test
    initialState: Start
    states:
      - name: Start
        type: entry
      - name: End
        type: final
    transitions:
      - from: Start
        to: End
        event: COMPLETE
        type: regular`;

      const result = await agent.updateFSM(currentYaml, 'Add a timeout to the Start state');

      expect(result.success).toBe(true);
      expect(result.data.yaml).toBeDefined();
    });
  });

  describe('Simulation', () => {
    it('should simulate FSM path', async () => {
      const component: Component = {
        name: 'TestComponent',
        version: '1.0.0',
        stateMachines: [
          {
            name: 'Test',
            initialState: 'Start',
            states: [
              { name: 'Start', type: 'entry' as any },
              { name: 'End', type: 'final' as any },
            ],
            transitions: [
              {
                from: 'Start',
                to: 'End',
                event: 'COMPLETE',
                type: 'regular' as any,
              },
            ],
          },
        ],
      };

      const result = await agent.simulatePath(component, 'Test', ['Complete the process']);

      expect(result.success).toBe(true);
    });
  });
});

describe('UIAgent', () => {
  let agent: UIAgent;

  beforeEach(() => {
    agent = new UIAgent('mock-api-key');
  });

  it('should generate API routes', async () => {
    const component: Component = {
      name: 'TestComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Test',
          initialState: 'Start',
          states: [
            { name: 'Start', type: 'entry' as any },
            { name: 'End', type: 'final' as any },
          ],
          transitions: [],
        },
      ],
    };

    const result = await agent.generateAPIRoutes(component);

    expect(result.success).toBe(true);
    expect(result.data.code).toBeDefined();
    expect(result.data.type).toBe('express-routes');
  });

  it('should generate React UI', async () => {
    const component: Component = {
      name: 'TestComponent',
      version: '1.0.0',
      stateMachines: [
        {
          name: 'Test',
          initialState: 'Start',
          states: [
            { name: 'Start', type: 'entry' as any },
            { name: 'End', type: 'final' as any },
          ],
          transitions: [],
        },
      ],
    };

    const result = await agent.generateReactUI(component);

    expect(result.success).toBe(true);
    expect(result.data.code).toBeDefined();
    expect(result.data.type).toBe('react-component');
  });
});

describe('MonitoringAgent', () => {
  let agent: MonitoringAgent;

  beforeEach(() => {
    agent = new MonitoringAgent('mock-api-key');
  });

  it('should analyze logs', async () => {
    const result = await agent.analyzeLogs('TestComponent');

    expect(result.success).toBe(true);
    expect(result.data.summary).toBeDefined();
    expect(result.data.insights).toBeDefined();
  });
});

describe('SupervisorAgent', () => {
  let supervisor: SupervisorAgent;

  beforeEach(() => {
    supervisor = new SupervisorAgent('mock-api-key');
  });

  it('should process user request', async () => {
    const result = await supervisor.processRequest('Create a payment workflow');

    expect(result.success).toBe(true);
    expect(result.data.plan).toBeDefined();
    expect(result.data.results).toBeDefined();
  });

  it('should provide agent access', () => {
    expect(supervisor.getFSMAgent()).toBeDefined();
    expect(supervisor.getUIAgent()).toBeDefined();
    expect(supervisor.getMonitoringAgent()).toBeDefined();
  });
});
