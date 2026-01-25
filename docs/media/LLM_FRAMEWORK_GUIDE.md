# LLM Framework Usage Guide

## 🎯 Purpose

**xcomponent-ai** is a framework designed to help LLMs (Claude, GPT, etc.) structure projects with **sanctuarized business logic** using state machines. When a developer asks you to build an application, use this framework to:

1. **Separate business logic from technical code**
2. **Make business rules explicit, immutable, and auditable**
3. **Enable compliance-first development** (especially for fintech/regulated domains)

## 🧠 Core Philosophy

When you receive a prompt like:
> "Build a payment processing application with refunds and compliance checks"

You should:
1. ✅ **Start with FSM** - Define business logic as immutable YAML state machines
2. ✅ **Sanctuarize** - Keep FSM definitions separate from UI/API code
3. ✅ **Connect** - Generate UI/API that interacts with FSM runtime
4. ✅ **Version control** - FSM changes are Git commits, not code patches

## 📋 Project Structure Convention

When using xcomponent-ai as a framework, structure projects like this:

```
my-fintech-app/
├── fsm/                          # 🔒 SANCTUARIZED BUSINESS LOGIC
│   ├── payment-flow.yaml        # Immutable FSM definitions
│   ├── kyc-process.yaml
│   └── refund-workflow.yaml
├── src/
│   ├── runtime/                 # FSM runtime (from xcomponent-ai)
│   │   └── index.ts
│   ├── api/                     # Technical layer (UI/API)
│   │   ├── payment-routes.ts    # Express routes triggering FSM events
│   │   ├── kyc-api.ts
│   │   └── websocket-server.ts
│   ├── ui/                      # Frontend
│   │   ├── PaymentWidget.tsx   # React components
│   │   └── KYCForm.tsx
│   └── services/                # External integrations
│       ├── stripe.ts
│       └── identity-provider.ts
├── tests/
│   ├── fsm/                     # FSM simulation tests
│   └── api/                     # Integration tests
└── README.md
```

**Key principle**: `fsm/` directory is **read-only in production**. Changes = new Git commits + review process.

## 🛠️ Step-by-Step Usage

### Step 1: Analyze Requirements & Extract Business Logic

**User prompt**: "Build a lending platform with credit checks and approval workflow"

**Your analysis**:
```
Business logic to extract:
1. Loan application states: Submitted → CreditCheck → Underwriting → Approved/Rejected
2. Compliance guards: Credit score > 650, debt-to-income < 40%
3. Timeouts: Credit check must complete in 2 hours
4. Inter-machine: Approved → Disbursement workflow
```

### Step 2: Generate FSM Definitions

Create `fsm/loan-application.yaml`:

```yaml
name: LendingComponent
version: 1.0.0
metadata:
  domain: lending
  compliance:
    - Fair Lending Act
    - Equal Credit Opportunity Act

stateMachines:
  - name: LoanApplication
    initialState: Submitted
    states:
      - name: Submitted
        type: entry
        entryMethod: recordApplication
      - name: CreditCheck
        type: regular
        entryMethod: requestCreditReport
      - name: Underwriting
        type: regular
        entryMethod: assignUnderwriter
      - name: Approved
        type: final
      - name: Rejected
        type: error
    transitions:
      - from: Submitted
        to: CreditCheck
        event: START_CREDIT_CHECK
        type: triggerable
        guards:
          - keys: [applicantId, requestedAmount]
          - customFunction: "event.payload.requestedAmount >= 1000"
      - from: CreditCheck
        to: Underwriting
        event: CREDIT_REPORT_RECEIVED
        guards:
          - customFunction: "event.payload.creditScore >= 650"
        triggeredMethod: logCreditCheckSuccess
      - from: CreditCheck
        to: Rejected
        event: CREDIT_REPORT_RECEIVED
        guards:
          - customFunction: "event.payload.creditScore < 650"
      - from: CreditCheck
        to: Rejected
        event: TIMEOUT
        type: timeout
        timeoutMs: 7200000  # 2 hours
      - from: Underwriting
        to: Approved
        event: UNDERWRITER_APPROVE
        type: inter_machine
        targetMachine: Disbursement
      - from: Underwriting
        to: Rejected
        event: UNDERWRITER_REJECT
```

**Important**: Include metadata for compliance tracking!

### Step 3: Initialize Runtime

Create `src/runtime/index.ts`:

```typescript
import { FSMRuntime } from 'xcomponent-ai';
import * as yaml from 'yaml';
import * as fs from 'fs';

// Load FSM from sanctuarized directory
const loanFSM = yaml.parse(
  fs.readFileSync('./fsm/loan-application.yaml', 'utf-8')
);

export const loanRuntime = new FSMRuntime(loanFSM);

// Setup monitoring
loanRuntime.on('state_change', (data) => {
  console.log(`Loan ${data.instanceId}: ${data.previousState} → ${data.newState}`);
});

loanRuntime.on('guard_failed', (data) => {
  console.log(`Guard failed for loan ${data.instanceId}: ${data.transition}`);
});
```

### Step 4: Generate API Layer (Technical Code)

Create `src/api/loan-routes.ts`:

```typescript
import express from 'express';
import { loanRuntime } from '../runtime';

const router = express.Router();

// Create loan application (triggers FSM)
router.post('/loans', async (req, res) => {
  try {
    const { applicantId, requestedAmount, term } = req.body;

    // Create FSM instance (business logic)
    const loanId = loanRuntime.createInstance('LoanApplication', {
      applicantId,
      requestedAmount,
      term,
    });

    // Trigger first event
    await loanRuntime.sendEvent(loanId, {
      type: 'START_CREDIT_CHECK',
      payload: { applicantId, requestedAmount },
      timestamp: Date.now(),
    });

    res.json({ loanId, status: 'submitted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook from credit bureau (external event)
router.post('/webhooks/credit-report', async (req, res) => {
  const { loanId, creditScore, creditReport } = req.body;

  await loanRuntime.sendEvent(loanId, {
    type: 'CREDIT_REPORT_RECEIVED',
    payload: { creditScore, creditReport },
    timestamp: Date.now(),
  });

  res.json({ received: true });
});

// Underwriter decision
router.post('/loans/:loanId/decision', async (req, res) => {
  const { loanId } = req.params;
  const { decision, notes } = req.body;

  await loanRuntime.sendEvent(loanId, {
    type: decision === 'approve' ? 'UNDERWRITER_APPROVE' : 'UNDERWRITER_REJECT',
    payload: { decision, notes, underwriterId: req.user.id },
    timestamp: Date.now(),
  });

  res.json({ loanId, decision });
});

export default router;
```

**Key insight**: API routes are thin wrappers that translate HTTP → FSM events. Business logic stays in YAML.

### Step 5: Generate UI Components

Create `src/ui/LoanApplicationForm.tsx`:

```typescript
import React, { useState } from 'react';
import axios from 'axios';

export const LoanApplicationForm: React.FC = () => {
  const [applicantId, setApplicantId] = useState('');
  const [amount, setAmount] = useState(0);
  const [loanId, setLoanId] = useState<string | null>(null);

  const handleSubmit = async () => {
    const response = await axios.post('/api/loans', {
      applicantId,
      requestedAmount: amount,
      term: 36,
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
      <button onClick={handleSubmit}>Submit Application</button>
      {loanId && <p>Application submitted! Loan ID: {loanId}</p>}
    </div>
  );
};
```

### Step 6: External Service Integration

Create `src/services/credit-bureau.ts`:

```typescript
import axios from 'axios';

export class CreditBureauService {
  async requestCreditReport(applicantId: string): Promise<void> {
    // Call external API
    const report = await axios.post('https://credit-api.example.com/reports', {
      applicantId,
      callbackUrl: `${process.env.BASE_URL}/webhooks/credit-report`,
    });

    // Webhook will trigger FSM event when ready
    console.log(`Credit report requested: ${report.data.requestId}`);
  }
}

// Hook into FSM events
import { loanRuntime } from '../runtime';

loanRuntime.on('triggered_method', async (data) => {
  if (data.method === 'requestCreditReport') {
    const service = new CreditBureauService();
    await service.requestCreditReport(data.event.payload.applicantId);
  }
});
```

## 🔒 Sanctuarization Rules

When generating code, enforce these rules:

### ✅ DO
- Put ALL business logic in FSM YAML files
- Generate thin API/UI wrappers that translate to FSM events
- Use guards for business rules (credit score, amounts, timeouts)
- Use property matching for multi-instance scenarios (100+ concurrent instances)
- Use publicMemberType to separate business objects from internal state
- Version FSM changes through Git
- Test FSM paths with `runtime.simulatePath()`
- Add compliance metadata to FSM definitions

### ❌ DON'T
- Put business logic in API routes or UI components
- Modify FSM definitions at runtime
- Hardcode state transitions in code
- Skip guard definitions for critical rules
- Mix technical concerns (DB, API) with business logic

## 📊 Common Patterns

### Pattern 1: Compliance-First Fintech

```yaml
# Always include compliance metadata
metadata:
  domain: payments
  compliance:
    - PSD2
    - AML
    - KYC
  dataRetention: 7 years

# Guards for regulatory limits
guards:
  - customFunction: "event.payload.amount <= 10000"  # AML threshold
  - keys: [customerKYCStatus]  # Require KYC
```

### Pattern 2: Timeout for External Operations

```yaml
# Credit check, payment gateway, identity verification
transitions:
  - from: WaitingForGateway
    to: Failed
    event: TIMEOUT
    type: timeout
    timeoutMs: 30000
    metadata:
      reason: "Payment gateway timeout"
```

### Pattern 3: Inter-Machine Workflows

```yaml
# Order → Payment → Shipping
transitions:
  - from: OrderValidated
    to: PaymentPending
    event: PROCEED_TO_PAYMENT
    type: inter_machine
    targetMachine: Payment
```

### Pattern 4: Manual Review Escalation

```yaml
states:
  - name: ManualReview
    type: regular
    entryMethod: assignToReviewQueue
transitions:
  - from: AutomatedCheck
    to: ManualReview
    event: FRAUD_RISK_HIGH
    guards:
      - customFunction: "event.payload.riskScore > 0.7"
```

### Pattern 5: Property Matching for Multi-Instance Routing

**Use case**: When you have many instances of the same state machine (100+ orders, 1000+ customers) and need to route external events to specific instances based on business properties.

**Problem**: Without property matching, you must maintain external maps (OrderId → InstanceId), which doesn't scale.

**Solution**: Use property matching to automatically route events based on business identifiers.

```yaml
stateMachines:
  - name: Order
    publicMemberType: Order  # Enable public member pattern
    states:
      - name: Pending
        type: entry
      - name: PartiallyExecuted
        type: regular
      - name: FullyExecuted
        type: final
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

**Usage in code**:

```typescript
// Create 100 concurrent orders
for (let i = 1; i <= 100; i++) {
  runtime.createInstance('Order', {
    Id: i,
    AssetName: 'AAPL',
    Quantity: 1000,
    RemainingQuantity: 1000,
    ExecutedQuantity: 0
  });
}

// External event arrives (e.g., from execution venue)
// No need to maintain OrderId → InstanceId mapping!
const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
  type: 'ExecutionInput',
  payload: { OrderId: 42, Quantity: 500 },
  timestamp: Date.now()
});

console.log(`Processed ${processedCount} instances`); // 1
// System automatically found Order #42 and transitioned it
```

**Advanced: Nested properties and comparison operators**:

```yaml
matchingRules:
  # Nested property access
  - eventProperty: customer.id
    instanceProperty: customerId

  # Comparison operators (for range queries)
  - eventProperty: threshold
    instanceProperty: balance
    operator: '>'  # Also: ===, !==, <, >=, <=
```

**When to use**:
- ✅ 100-10,000 concurrent instances per state
- ✅ External events need to update specific instances (order executions, document uploads)
- ✅ Multi-tenant systems (route by customerId, accountId)
- ✅ IoT/device management (route by deviceId)
- ❌ Single instance workflows (use sendEvent directly)

**Best practices**:
- Choose unique matching properties (OrderId, CustomerId, not AssetName)
- Always specify target state in broadcastEvent() for filtering
- Monitor processedCount to detect routing issues
- Use publicMemberType to separate business object from internal state

**For complete documentation**, see [Property Matching Guide](docs/PROPERTY_MATCHING.md).

## 🎨 Code Generation Guidelines

When the user says "Build X with FSMs":

1. **Identify business entities**: Payment, User, Order, Loan, etc.
2. **Extract state flows**: Draft → Validated → Processed → Complete
3. **Identify guards**: Amount limits, status checks, time windows
4. **Map external systems**: Payment gateways, identity providers, etc.
5. **Consider multi-instance scenarios**: Will there be 100+ concurrent instances? → Use property matching
6. **Generate FSM YAML first** ← MOST IMPORTANT
7. **Then generate API/UI code** that references FSM events

### Example Prompt Flow

**User**: "Build a KYC onboarding flow with document upload and manual review"

**Your response**:
```
I'll structure this using xcomponent-ai to sanctuarize the KYC business logic.

First, let me define the FSM for the KYC workflow in `fsm/kyc-onboarding.yaml`:

[Generate YAML with states: DocumentPending → Uploaded → AIValidation →
 ManualReview → Approved/Rejected, with appropriate guards and timeouts]

Now I'll create the API layer in `src/api/kyc-routes.ts`:

[Generate Express routes that trigger FSM events: upload-document,
 ai-validation-complete, reviewer-decision]

And the UI components in `src/ui/KYCWidget.tsx`:

[Generate React form with file upload, status display, real-time updates via WebSocket]

The business logic is now immutable in the YAML file. Any compliance changes
(new document types, validation rules) are FSM updates, not code changes.
```

**Example with property matching**:

**User**: "Build an order execution system handling 100+ concurrent orders with real-time executions from exchanges"

**Your response**:
```
This is a perfect use case for property matching! I'll structure it with xcomponent-ai.

First, let me define the FSM in `fsm/order-execution.yaml` with property-based routing:

[Generate YAML with publicMemberType: Order, matchingRules for OrderId,
 specificTriggeringRule for full vs partial execution]

The key feature here is property matching:
- When execution confirmations arrive from exchanges, they include OrderId
- The system automatically routes to the correct Order instance
- No manual OrderId → InstanceId mapping required

Now the API layer in `src/api/order-routes.ts`:

[Generate routes using broadcastEvent() instead of sendEvent()]

typescript
// External execution arrives from exchange webhook
router.post('/webhooks/execution', async (req, res) => {
  const { orderId, quantity, price } = req.body;

  // System automatically finds the right order instance
  const processedCount = await orderRuntime.broadcastEvent('Order', 'Pending', {
    type: 'ExecutionInput',
    payload: { OrderId: orderId, Quantity: quantity, Price: price },
    timestamp: Date.now()
  });

  res.json({ processed: processedCount });
});


This scales to thousands of concurrent orders without performance issues.
```

## 🧪 Testing Approach

Always generate FSM tests first:

```typescript
describe('Loan Application FSM', () => {
  it('should approve loan with good credit', () => {
    const result = loanRuntime.simulatePath('LoanApplication', [
      { type: 'START_CREDIT_CHECK', payload: { creditScore: 750 }, timestamp: Date.now() },
      { type: 'CREDIT_REPORT_RECEIVED', payload: { creditScore: 750 }, timestamp: Date.now() },
      { type: 'UNDERWRITER_APPROVE', payload: {}, timestamp: Date.now() },
    ]);

    expect(result.success).toBe(true);
    expect(result.path).toEqual(['Submitted', 'CreditCheck', 'Underwriting', 'Approved']);
  });

  it('should reject loan with poor credit', () => {
    const result = loanRuntime.simulatePath('LoanApplication', [
      { type: 'START_CREDIT_CHECK', payload: { creditScore: 500 }, timestamp: Date.now() },
      { type: 'CREDIT_REPORT_RECEIVED', payload: { creditScore: 500 }, timestamp: Date.now() },
    ]);

    expect(result.success).toBe(true);
    expect(result.path).toEqual(['Submitted', 'CreditCheck', 'Rejected']);
  });
});
```

**Testing property matching**:

```typescript
describe('Order Execution with Property Matching', () => {
  it('should route execution to correct order instance', async () => {
    const runtime = new FSMRuntime(orderComponent);

    // Create 100 orders
    for (let i = 1; i <= 100; i++) {
      runtime.createInstance('Order', { Id: i, Quantity: 1000 });
    }

    // Execute order #42
    const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
      type: 'ExecutionInput',
      payload: { OrderId: 42, Quantity: 500 },
      timestamp: Date.now()
    });

    expect(processedCount).toBe(1); // Only one instance matched

    // Verify only order #42 transitioned
    const allInstances = runtime.getInstancesByMachine('Order');
    const order42 = allInstances.find(i => i.publicMember.Id === 42);
    expect(order42?.currentState).toBe('PartiallyExecuted');

    // Others remain in Pending
    const pendingOrders = allInstances.filter(i => i.currentState === 'Pending');
    expect(pendingOrders.length).toBe(99);
  });

  it('should handle no matches gracefully', async () => {
    const runtime = new FSMRuntime(orderComponent);
    runtime.createInstance('Order', { Id: 1, Quantity: 1000 });

    const processedCount = await runtime.broadcastEvent('Order', 'Pending', {
      type: 'ExecutionInput',
      payload: { OrderId: 999, Quantity: 100 }, // No match
      timestamp: Date.now()
    });

    expect(processedCount).toBe(0);
  });
});
```

## 📦 Project Bootstrap

When starting a new project, generate this structure:

```bash
npx xcomponent-ai init my-fintech-app
cd my-fintech-app
```

This creates:
- `fsm/` directory for business logic
- Runtime setup in `src/runtime/`
- Example API routes
- Docker Compose with monitoring
- CI/CD for FSM validation

## 🎯 Success Criteria

You've successfully used xcomponent-ai when:

1. ✅ Business logic can be explained by showing YAML files
2. ✅ Compliance officer can audit FSM without reading code
3. ✅ UI/API changes don't require FSM changes (and vice versa)
4. ✅ FSM simulations cover all business paths
5. ✅ Git history shows FSM evolution as meaningful commits
6. ✅ Multi-instance scenarios use property matching, not manual ID tracking

## 🚨 Red Flags

Warn the user if:
- Business logic appears in API routes (move to FSM guards)
- State transitions are hardcoded in UI (use FSM events)
- Compliance rules are in if/else statements (use guards)
- FSM files are modified at runtime (immutable!)

## 💡 Pro Tips

1. **Start with FSM diagram**: Draw states on whiteboard/mermaid before coding
2. **Use AI agent for compliance**: Let FSMAgent detect missing guards
3. **Monitor in production**: FSM events = perfect audit logs
4. **Version FSMs semantically**: v1.0.0 → v1.1.0 when adding states
5. **Generate docs from FSM**: Mermaid diagrams from YAML

---

**Remember**: xcomponent-ai is not just a library—it's a **development philosophy** where business logic is first-class, explicit, and separate from technical implementation. Use it to help users build maintainable, auditable, compliance-ready applications.
