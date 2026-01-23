# Quick Start Guide

xcomponent-ai can be used in **two ways**:

1. **🛠️ Standalone CLI** - For exploring FSM concepts and testing workflows
2. **🏗️ Framework** - For structuring complete applications with sanctuarized business logic

## 🛠️ Standalone CLI Usage

Use the CLI to load, run, and analyze FSM definitions.

### Installation

```bash
npm install -g xcomponent-ai
```

### Load and Validate FSM

```bash
xcomponent-ai load examples/trading.yaml
```

Output:
```
✓ Loaded component: TradingComponent
  Machines: 2
    - OrderEntry (5 states, 6 transitions)
    - Settlement (4 states, 4 transitions)
```

### Run FSM with Events

```bash
xcomponent-ai run examples/payment.yaml Payment \
  --context '{"accountBalance": 5000}' \
  --events '[
    {"type":"AUTHORIZE_PAYMENT","payload":{"amount":100},"timestamp":1234567890}
  ]'
```

### Simulate FSM Path

```bash
xcomponent-ai simulate examples/kyc.yaml Onboarding \
  --events '[
    {"type":"DOCUMENTS_RECEIVED","payload":{"documentType":"passport"},"timestamp":123}
  ]'
```

### AI-Powered FSM Creation

```bash
export OPENAI_API_KEY=your_key

xcomponent-ai ai-create \
  "Trading order with compliance guards for amounts over 100k" \
  -o my-trading.yaml
```

### Generate UI Code

```bash
xcomponent-ai generate-ui examples/trading.yaml --type api -o routes.ts
xcomponent-ai generate-ui examples/trading.yaml --type react -o Widget.tsx
```

### Analyze Logs

```bash
xcomponent-ai ai-analyze TradingComponent
```

---

## 🏗️ Framework Usage (Recommended for Projects)

Use xcomponent-ai as a **framework** to structure complete applications with sanctuarized business logic.

### 1. Initialize New Project

```bash
npx xcomponent-ai init my-fintech-app
cd my-fintech-app
npm install
```

This creates:
```
my-fintech-app/
├── fsm/              # 🔒 Business logic (sanctuarized)
├── src/
│   ├── runtime/     # FSM runtime
│   ├── api/         # HTTP → FSM wrappers
│   └── ui/          # Frontend
└── tests/fsm/       # FSM tests
```

### 2. Define Business Logic

Edit `fsm/main-workflow.yaml`:

```yaml
name: LendingComponent
version: 1.0.0
metadata:
  domain: fintech
  compliance:
    - Fair Lending Act
    - Equal Credit Opportunity Act

stateMachines:
  - name: LoanApplication
    initialState: Submitted
    states:
      - name: Submitted
        type: entry
      - name: CreditCheck
        type: regular
      - name: Approved
        type: final
      - name: Rejected
        type: error
    transitions:
      - from: Submitted
        to: CreditCheck
        event: START_CHECK
        guards:
          - keys: [applicantId, requestedAmount]
      - from: CreditCheck
        to: Approved
        event: CREDIT_PASSED
        guards:
          - customFunction: "event.payload.creditScore >= 650"
      - from: CreditCheck
        to: Rejected
        event: CREDIT_FAILED
```

### 3. Initialize Runtime

Edit `src/runtime/index.ts`:

```typescript
import { FSMRuntime } from 'xcomponent-ai';
import * as yaml from 'yaml';
import * as fs from 'fs';

const loanFSM = yaml.parse(
  fs.readFileSync('./fsm/main-workflow.yaml', 'utf-8')
);

export const loanRuntime = new FSMRuntime(loanFSM);

loanRuntime.on('state_change', (data) => {
  console.log(`[${data.instanceId}] ${data.previousState} → ${data.newState}`);
});
```

### 4. Create API Layer

Create `src/api/loan-routes.ts`:

```typescript
import express from 'express';
import { loanRuntime } from '../runtime';

const router = express.Router();

// Create loan application (HTTP → FSM event)
router.post('/loans', async (req, res) => {
  const { applicantId, requestedAmount } = req.body;

  // Create FSM instance
  const loanId = loanRuntime.createInstance('LoanApplication', {
    applicantId,
    requestedAmount,
  });

  // Trigger event
  await loanRuntime.sendEvent(loanId, {
    type: 'START_CHECK',
    payload: { applicantId, requestedAmount },
    timestamp: Date.now(),
  });

  res.json({ loanId, status: 'submitted' });
});

// Get loan status
router.get('/loans/:loanId', async (req, res) => {
  const instance = loanRuntime.getInstance(req.params.loanId);
  res.json({
    loanId: instance?.id,
    currentState: instance?.currentState,
    status: instance?.status,
  });
});

export default router;
```

### 5. Build UI

Create `src/ui/LoanForm.tsx`:

```typescript
import React, { useState } from 'react';
import axios from 'axios';

export const LoanForm: React.FC = () => {
  const [applicantId, setApplicantId] = useState('');
  const [amount, setAmount] = useState(0);
  const [loanId, setLoanId] = useState<string | null>(null);

  const handleSubmit = async () => {
    const response = await axios.post('/api/loans', {
      applicantId,
      requestedAmount: amount,
    });
    setLoanId(response.data.loanId);
  };

  return (
    <div>
      <h2>Apply for Loan</h2>
      <input
        placeholder="Applicant ID"
        value={applicantId}
        onChange={(e) => setApplicantId(e.target.value)}
      />
      <input
        type="number"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
      />
      <button onClick={handleSubmit}>Submit</button>
      {loanId && <p>Application submitted! Loan ID: {loanId}</p>}
    </div>
  );
};
```

### 6. Test Business Logic

Create `tests/fsm/loan-application.test.ts`:

```typescript
import { loanRuntime } from '../../src/runtime';

describe('Loan Application FSM', () => {
  it('should approve loan with good credit', () => {
    const result = loanRuntime.simulatePath('LoanApplication', [
      { type: 'START_CHECK', payload: { creditScore: 750 }, timestamp: Date.now() },
      { type: 'CREDIT_PASSED', payload: { creditScore: 750 }, timestamp: Date.now() },
    ]);

    expect(result.success).toBe(true);
    expect(result.path).toEqual(['Submitted', 'CreditCheck', 'Approved']);
  });
});
```

---

## 🤖 Using with LLMs (Claude/GPT)

When asking Claude/GPT to build an application:

### Option 1: Use System Prompt

Copy the system prompt from [SYSTEM_PROMPT_TEMPLATE.md](SYSTEM_PROMPT_TEMPLATE.md) and paste it at the start of your conversation.

### Option 2: Explicit Instructions

```
User: Build a payment processing system

You: Use xcomponent-ai framework. Start with FSM definition...
```

### Option 3: Claude Code Settings

Add to `.claude/settings.json`:

```json
{
  "systemPrompt": "Use xcomponent-ai framework to sanctuarize business logic..."
}
```

See [.claude/settings.example.json](.claude/settings.example.json) for full template.

---

## 📚 Next Steps

### Learn More
- **[LLM Framework Guide](LLM_FRAMEWORK_GUIDE.md)** - Complete usage for LLMs
- **[Full Project Example](examples/full-project-structure.md)** - E-commerce platform
- **[System Prompt Template](SYSTEM_PROMPT_TEMPLATE.md)** - Configure LLMs

### Examples
- **Trading workflow**: `examples/trading.yaml`
- **KYC onboarding**: `examples/kyc.yaml`
- **Payment processing**: `examples/payment.yaml`

### Concepts
- **Sanctuarization**: Business logic in YAML, not code
- **Guards**: Enforce business rules at FSM level
- **Compliance**: Metadata for audit trails
- **Separation**: FSM (business) vs API/UI (technical)

---

## ⚡ Quick Commands Cheat Sheet

```bash
# Initialize project
npx xcomponent-ai init my-app

# Load FSM
xcomponent-ai load fsm/workflow.yaml

# Run with events
xcomponent-ai run fsm/workflow.yaml Machine --events '[...]'

# Simulate path
xcomponent-ai simulate fsm/workflow.yaml Machine --events '[...]'

# AI: Create FSM
xcomponent-ai ai-create "description" -o output.yaml

# AI: Analyze logs
xcomponent-ai ai-analyze ComponentName

# Generate UI
xcomponent-ai generate-ui fsm/workflow.yaml --type api
xcomponent-ai generate-ui fsm/workflow.yaml --type react
```

---

## 💡 Tips

### ✅ DO
- Define business logic in `fsm/*.yaml` first
- Keep API routes as thin HTTP → FSM wrappers
- Add compliance metadata to FSM definitions
- Test FSM paths with `simulatePath()` before integration tests
- Version FSM files in Git with clear commit messages

### ❌ DON'T
- Put business logic in API routes or UI components
- Modify FSM definitions at runtime
- Skip guards for critical business rules
- Hardcode state transitions in application code
- Mix technical concerns (DB, API) with business logic

---

**Get started now**: `npx xcomponent-ai init my-project` 🚀
