# 🤖 xcomponent-ai

[![CI](https://github.com/fredericcarre/mayele-ai/workflows/CI/badge.svg)](https://github.com/fredericcarre/mayele-ai/actions)
[![Coverage](https://img.shields.io/badge/coverage-88.13%25-brightgreen.svg)](https://github.com/fredericcarre/mayele-ai/actions)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

> **Agentic FSM tool for fintech workflows** - XComponent-inspired state machines orchestrated by LLM agents

xcomponent-ai combines the power of **immutable state machines** (inspired by [XComponent](https://github.com/xcomponent/xcomponent)) with **agentic AI orchestration** (LangChain.js) to deliver secure, compliant, and intelligent fintech workflows.

## 🌟 Why xcomponent-ai?

xcomponent-ai uniquely combines:
- **Sanctuarized Business Logic**: FSM definitions are immutable, version-controlled YAML files - your compliance rules are code
- **Agentic AI Orchestration**: LLM supervisor delegates to specialized agents (FSM creation, UI generation, monitoring)
- **Fintech-First**: Built-in compliance guards (AML, KYC, RGPD), timeout handling, and inter-machine workflows
- **Live Monitoring**: WebSocket-based real-time state tracking with LLM-powered insights
- **Open-Core Model**: Core runtime and agents are free; enterprise features (cloud, advanced AI) available

### Comparison with Existing Solutions

| Feature | xcomponent-ai | LangChain/AutoGen | n8n/Zapier | Camunda | Traditional FSM |
|---------|---------------|-------------------|------------|---------|----------------|
| **Agentic AI** | ✅ LLM supervisor + specialized agents | ✅ Agent frameworks | ❌ No AI orchestration | ❌ Manual workflows | ❌ Manual coding |
| **Immutable FSM** | ✅ YAML-based, Git-versioned | ❌ Code-based | ❌ UI-based config | ⚠️ BPMN (complex) | ⚠️ Code-based |
| **Fintech Compliance** | ✅ Built-in AML/KYC/RGPD guards | ❌ Generic | ❌ Generic | ⚠️ Via plugins | ❌ Manual |
| **Real-time Monitoring** | ✅ WebSocket + LLM insights | ❌ No built-in | ⚠️ Limited | ✅ Dashboard | ❌ Manual logging |
| **UI Generation** | ✅ AI-generated wrappers | ❌ Manual | ✅ Built-in UI | ⚠️ Complex forms | ❌ Manual |
| **Multi-Instance** | ✅ Event-driven runtime | ⚠️ Limited | ⚠️ Limited | ✅ BPMN engine | ⚠️ Manual |
| **Property Matching** | ✅ Automatic instance routing | ❌ No | ❌ No | ⚠️ Correlation keys | ❌ Manual |
| **Natural Language** | ✅ Create/update FSM via prompt | ⚠️ Agent tools only | ❌ No | ❌ No | ❌ No |
| **Open Source** | ✅ Apache 2.0 (core) | ✅ MIT | ❌ Proprietary | ⚠️ Commercial | ✅ Varies |

**Key Differentiators**:
- **LangChain/AutoGen**: Generic agent frameworks lack FSM immutability and fintech-specific compliance
- **n8n/Zapier**: No-code tools with vendor lock-in, no AI orchestration, not designed for regulated workflows
- **Camunda**: Enterprise BPMN engine (complex setup, no AI agents, expensive licensing)
- **Traditional FSM libs**: No AI assistance, manual coding, no built-in monitoring or compliance

## 🤖 For LLMs: Use as a Framework

**xcomponent-ai is designed to be used by LLMs (Claude, GPT, etc.) as a structuring framework** for building applications with sanctuarized business logic.

### Usage Pattern

When a developer asks you to build an application:

```
User: "Build a lending platform with credit checks and approval workflow"

LLM (You): I'll use xcomponent-ai to structure this with sanctuarized business logic.

1️⃣ First, define FSM (business logic):
   fsm/loan-application.yaml → States, guards, compliance rules

2️⃣ Initialize runtime:
   src/runtime/index.ts → FSM runtime setup

3️⃣ Create API layer:
   src/api/loan-routes.ts → HTTP → FSM events (thin wrapper)

4️⃣ Build UI:
   src/ui/LoanForm.tsx → React components reading FSM state

Key principle: Business logic lives in YAML, code just connects to it.
```

### Project Structure

```
my-fintech-app/
├── fsm/                    # 🔒 SANCTUARIZED (business logic)
│   ├── *.yaml             # Immutable state machines
├── src/
│   ├── runtime/           # xcomponent-ai runtime
│   ├── api/               # HTTP → FSM events
│   └── ui/                # UI reading FSM state
└── tests/fsm/             # FSM simulation tests
```

**For detailed guidance**, see:
- **[LLM Framework Guide](LLM_FRAMEWORK_GUIDE.md)** - Complete usage instructions for LLMs
- **[Full Project Example](examples/full-project-structure.md)** - E-commerce platform example

### Why This Matters

✅ **Separation of concerns**: Business logic (FSM) vs technical code (API/UI)
✅ **Auditability**: Compliance officer reviews YAML, not code
✅ **Maintainability**: FSM changes are explicit Git commits
✅ **LLM-friendly**: Clear structure for code generation

## 🚀 Quick Start

> **📖 Full guide: [QUICKSTART.md](QUICKSTART.md)**

### Two Ways to Use xcomponent-ai

#### 1️⃣ Standalone CLI (Exploration)

```bash
npm install -g xcomponent-ai
xcomponent-ai load examples/trading.yaml
```

#### 2️⃣ Framework (Production Projects) **← Recommended**

```bash
npx xcomponent-ai init my-fintech-app
cd my-fintech-app
npm install
# Edit fsm/*.yaml → build API/UI
```

### Prerequisites

- Node.js ≥ 20.0.0
- OpenAI API key (for AI agents): `export OPENAI_API_KEY=your_key`

### CLI Usage Examples

```bash
# Create FSM from natural language (AI-powered)
xcomponent-ai ai-create "Trading order with compliance guards for amounts over 100k" -o trading.yaml

# Load and validate FSM
xcomponent-ai load examples/trading.yaml

# Run instance with events
xcomponent-ai run examples/payment.yaml Payment \
  --context '{"accountBalance": 5000}' \
  --events '[{"type":"AUTHORIZE_PAYMENT","payload":{"amount":100,"currency":"EUR","paymentMethod":"card"},"timestamp":1234567890}]'

# Simulate path
xcomponent-ai simulate examples/kyc.yaml Onboarding \
  --events '[{"type":"DOCUMENTS_RECEIVED","payload":{"documentType":"passport"},"timestamp":123}]'

# Analyze logs with AI insights
xcomponent-ai ai-analyze TradingComponent

# Generate UI code
xcomponent-ai generate-ui examples/trading.yaml --type api -o generated-api.ts
```

### Programmatic Usage

```typescript
import { FSMRuntime, loadComponent, SupervisorAgent } from 'xcomponent-ai';
import * as yaml from 'yaml';
import * as fs from 'fs';

// Load component
const content = fs.readFileSync('examples/trading.yaml', 'utf-8');
const component = yaml.parse(content);

// Create runtime
const runtime = new FSMRuntime(component);

// Create instance
const instanceId = runtime.createInstance('OrderEntry', {
  amount: 50000,
  instrument: 'AAPL'
});

// Send event
await runtime.sendEvent(instanceId, {
  type: 'VALIDATE',
  payload: { amount: 50000, instrument: 'AAPL', clientId: 'C123' },
  timestamp: Date.now(),
});

// AI Agent: Create FSM from description
const supervisor = new SupervisorAgent();
const result = await supervisor.getFSMAgent().createFSM(
  'Payment workflow with SCA compliance and refund capability'
);
console.log(result.data.yaml);
```

### API Server

```bash
# Start API server
npm run api

# Visit dashboard: http://localhost:3000/dashboard
# WebSocket: ws://localhost:3000
```

API endpoints:
- `POST /api/component/load` - Load component from YAML file
- `POST /api/:component/:machine/instance` - Create instance
- `POST /api/:component/instance/:instanceId/event` - Send event
- `GET /api/:component/instance/:instanceId` - Get instance state
- `GET /api/monitor/:component` - Get monitoring data
- `POST /api/ai/create-fsm` - AI-powered FSM creation
- `POST /api/ai/analyze` - AI log analysis

## 📊 Examples

### Trading Workflow (examples/trading.yaml)

```yaml
name: TradingComponent
stateMachines:
  - name: OrderEntry
    initialState: Pending
    states:
      - name: Pending
        type: entry
      - name: Validated
        type: regular
      - name: Executed
        type: regular
      - name: Settled
        type: final
      - name: Rejected
        type: error
    transitions:
      - from: Pending
        to: Validated
        event: VALIDATE
        guards:
          - customFunction: "event.payload.amount <= 100000"  # Compliance limit
        triggeredMethod: validateOrderLimits
      - from: Validated
        to: Executed
        event: EXECUTE
        type: triggerable
      - from: Executed
        to: Settled
        event: SETTLEMENT_COMPLETE
        type: inter_machine  # Instantiates Settlement machine
        targetMachine: Settlement
      - from: Pending
        to: Rejected
        event: TIMEOUT
        type: timeout
        timeoutMs: 30000
```

**Features demonstrated**:
- Compliance guards (amount limits)
- Inter-machine transitions (Settlement)
- Timeout handling
- Error states

### Order Processing with Property Matching (examples/order-processing-xcomponent.yaml)

Complete example demonstrating multi-instance routing:

```typescript
// Create 100 concurrent orders
for (let i = 1; i <= 100; i++) {
  runtime.createInstance('Order', {
    Id: i,
    AssetName: i % 2 === 0 ? 'AAPL' : 'GOOGL',
    Quantity: 1000,
    RemainingQuantity: 1000,
    ExecutedQuantity: 0
  });
}

// Execute specific order #42 (partial execution)
await runtime.broadcastEvent('Order', 'Pending', {
  type: 'ExecutionInput',
  payload: { OrderId: 42, Quantity: 500 },
  timestamp: Date.now()
});

// Only Order #42 transitions to PartiallyExecuted
// Others remain in Pending state
```

**Features demonstrated**:
- Property-based instance routing (OrderId matching)
- Specific triggering rules (full vs partial execution)
- Public member pattern (business object separation)
- Scalable multi-instance management (100+ orders)

### KYC Workflow (examples/kyc.yaml)

Complete customer onboarding with:
- RGPD/GDPR consent checks
- AI document validation
- AML screening
- Manual review escalation

### Payment Workflow (examples/payment.yaml)

PSD2-compliant payment processing with:
- Strong Customer Authentication (SCA)
- Refund capability (inter-machine)
- Timeout guards

## 🧠 Agentic AI Features

### Supervisor Agent

Orchestrates specialized agents based on user intent:

```typescript
const supervisor = new SupervisorAgent();
const result = await supervisor.processRequest(
  'Create a KYC workflow with AML checks and GDPR compliance'
);
```

### FSM Agent

- **Create FSM**: Natural language → YAML
- **Detect Missing Compliance**: Suggests AML, KYC, RGPD guards
- **Update FSM**: Apply changes via prompts
- **Simulate Paths**: Test workflows before deployment

```typescript
const fsmAgent = supervisor.getFSMAgent();

// Create
const result = await fsmAgent.createFSM('Payment with refund');

// Get compliance suggestions
console.log(result.suggestions);
// ["Consider adding AML/KYC compliance checks", ...]
```

### UI Agent

Generates Express routes and React components:

```typescript
const uiAgent = supervisor.getUIAgent();
const apiCode = await uiAgent.generateAPIRoutes(component);
const reactCode = await uiAgent.generateReactUI(component);
```

### Monitoring Agent

Analyzes logs with natural language insights:

```typescript
const monitoringAgent = supervisor.getMonitoringAgent();
const analysis = await monitoringAgent.analyzeLogs('TradingComponent');

// Insights:
// "Bottleneck detected: Validated->Executed takes 8.2s on average"
// "High error rate: 15.3%. Review error states and guards."
```

## 📡 Real-time Monitoring

### WebSocket API

Subscribe to FSM events:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

// Subscribe to component
socket.emit('subscribe_component', 'TradingComponent');

// Listen to state changes
socket.on('state_change', (data) => {
  console.log(`Instance ${data.instanceId}: ${data.previousState} → ${data.newState}`);
});

// Instance lifecycle
socket.on('instance_created', (instance) => { ... });
socket.on('instance_disposed', (instance) => { ... });
socket.on('instance_error', (error) => { ... });
```

### Dashboard

Visit `http://localhost:3000/dashboard` for:
- Active instances table
- Real-time event stream
- State visualizations

## 🏗️ Architecture

### FSM Runtime

Built on `@xstate/core` with XComponent-inspired enhancements:
- **Multi-instance management**: Track unlimited concurrent instances
- **Property matching**: Automatic event routing to instances based on business properties
- **Event-driven execution**: Pub/Sub + WebSocket broadcasting
- **Timeout transitions**: Automatic timeouts with configurable delays
- **Inter-machine workflows**: Create new instances on transition
- **Guard evaluation**: Conditional transitions (keys, contains, custom functions)

See [archi-runtime.mmd](archi-runtime.mmd) for sequence diagram.

### Agentic Layer

```mermaid
graph TD
    User[User Prompt] --> Supervisor[Supervisor Agent]
    Supervisor --> FSM[FSM Agent]
    Supervisor --> UI[UI Agent]
    Supervisor --> Monitor[Monitoring Agent]
    FSM --> |Create/Update| YAML[FSM YAML]
    FSM --> |Detect| Compliance[Compliance Gaps]
    UI --> |Generate| Code[Express/React Code]
    Monitor --> |Analyze| Insights[Natural Language Insights]
```

See [archi-agents.mmd](archi-agents.mmd) for detailed flow.

## 🎯 Property Matching & Multi-Instance Routing

**XComponent-inspired property matching** enables automatic event routing to instances based on business properties, eliminating manual instance ID tracking.

### The Problem

In real-world applications, you often have **many instances of the same state machine** running simultaneously:
- 100+ active orders
- 1000+ customer KYC applications
- Dozens of concurrent trades

When an external event arrives, the system needs to **find the correct instance** to update.

### The Solution

Property matching automatically routes events to instances where specified properties match:

```yaml
transitions:
  - from: Pending
    to: Executed
    event: ExecutionInput
    matchingRules:
      - eventProperty: OrderId      # Property in event payload
        instanceProperty: Id         # Property in instance public member
```

**How it works**:
1. Event arrives: `{ OrderId: 42, Quantity: 500 }`
2. System examines ALL `Order` instances in `Pending` state
3. For each instance, checks: `event.payload.OrderId === instance.publicMember.Id`
4. Routes event ONLY to matching instances
5. Other instances remain unaffected

### Usage Example

```typescript
import { FSMRuntime } from 'xcomponent-ai';

const runtime = new FSMRuntime(component);

// Create 100 orders
for (let i = 1; i <= 100; i++) {
  runtime.createInstance('Order', {
    Id: i,
    AssetName: 'AAPL',
    Quantity: 1000,
    RemainingQuantity: 1000
  });
}

// Execute specific order #42
const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
  type: 'ExecutionInput',
  payload: { OrderId: 42, Quantity: 500 },
  timestamp: Date.now()
});

console.log(`Processed ${processedCount} instances`); // 1
// Only Order #42 transitioned, others remain in Pending
```

### Advanced Features

**Nested Property Matching**:
```yaml
matchingRules:
  - eventProperty: customer.id
    instanceProperty: customerId
```

**Comparison Operators**:
```yaml
matchingRules:
  - eventProperty: threshold
    instanceProperty: balance
    operator: '>'  # Also: ===, !==, <, >=, <=
```

**Specific Triggering Rules** (differentiate multiple transitions):
```yaml
transitions:
  # Full execution
  - from: Pending
    to: FullyExecuted
    event: ExecutionInput
    matchingRules:
      - eventProperty: OrderId
        instanceProperty: Id
    specificTriggeringRule: "event.payload.Quantity === context.RemainingQuantity"

  # Partial execution
  - from: Pending
    to: PartiallyExecuted
    event: ExecutionInput
    matchingRules:
      - eventProperty: OrderId
        instanceProperty: Id
    specificTriggeringRule: "event.payload.Quantity < context.RemainingQuantity"
```

**Public Member Pattern** (XComponent convention):
```yaml
stateMachines:
  - name: Order
    publicMemberType: Order  # Separates business object from internal state
```

### Benefits

✅ **No manual bookkeeping**: No need to maintain external OrderId → InstanceId maps
✅ **Survives restarts**: When persistence is added, routing works automatically
✅ **Decoupled**: External systems don't need runtime internals
✅ **Scalable**: Handles 100-10,000 instances per state efficiently

**For complete documentation**, see [Property Matching Guide](docs/PROPERTY_MATCHING.md).

## 🔐 Open-Core Model

### Free (Apache 2.0)
- Core FSM runtime
- CLI and API server
- Agentic AI layer (FSM, UI, Monitoring agents)
- WebSocket monitoring
- All examples and documentation

### Enterprise (Coming Soon)
- **Cloud Hosting**: Managed runtime with auto-scaling
- **Advanced AI**: Deep compliance analysis (AML risk scoring, GDPR audit trails)
- **Enterprise Monitoring**: Grafana/Prometheus integration, alerting, SLA tracking
- **Premium Support**: Dedicated compliance consulting, custom FSM templates

Contact: [dev@xcomponent.com](mailto:dev@xcomponent.com)

## 🧪 Testing

```bash
# Run all tests
npm test

# With coverage
npm test -- --coverage

# Watch mode
npm run test:watch
```

Coverage target: **>80%** (branches, functions, lines, statements)

## 📚 Documentation

```bash
# Generate API docs
npm run doc

# Open docs/index.html
```

**Guides**:
- **[LLM Framework Guide](LLM_FRAMEWORK_GUIDE.md)** - Complete usage for LLMs (Claude/GPT)
- **[Property Matching Guide](docs/PROPERTY_MATCHING.md)** - Multi-instance routing patterns
- **[Quick Start](QUICKSTART.md)** - Getting started guide
- **[Full Project Example](examples/full-project-structure.md)** - E-commerce application

**JSDoc coverage**: All public APIs documented

## 🤝 Contributing

We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m 'Add my feature'`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

**Guidelines**:
- Write tests (maintain >80% coverage)
- Follow TypeScript strict mode
- Add JSDoc comments
- Update README for new features

## 📄 License

Apache License 2.0 - see [LICENSE](LICENSE)

## 🙏 Acknowledgments

- Inspired by [XComponent](https://github.com/xcomponent/xcomponent) state machine architecture
- Built with [LangChain.js](https://github.com/langchain-ai/langchainjs)
- Powered by [XState](https://xstate.js.org/)

## 🔗 Links

- **Documentation**: [API Docs](docs/index.html)
- **Examples**: [examples/](examples/)
- **Issues**: [GitHub Issues](https://github.com/fredericcarre/mayele-ai/issues)
- **Discussions**: [GitHub Discussions](https://github.com/fredericcarre/mayele-ai/discussions)

---

**Built with ❤️ for secure fintech workflows**

*Reduce compliance risks. Accelerate development. Days → Minutes.*
