# xcomponent-ai: Guide de Génération pour LLM

Ce guide est destiné aux LLM (Claude, GPT, etc.) pour générer correctement des composants xcomponent-ai.

## Philosophie du projet

**xcomponent-ai sépare la logique métier (durable) du code d'implémentation (jetable).**

- **YAML** = Logique métier, contrat fonctionnel, valeur durable
- **Code TypeScript** = Implémentation technique, peut être régénéré

Les state machines définissent le "quoi" (états, transitions, règles), pas le "comment".

---

## Structure d'un composant

```yaml
name: ComponentName           # Nom unique du composant
entryMachine: MachineName     # Machine d'entrée (point de départ)

stateMachines:
  - name: MachineName
    initialState: StateName

    # Schéma du contexte (optionnel mais recommandé)
    contextSchema:
      fieldName:
        type: string|number|select
        label: "Label affiché"
        required: true|false
        description: "Description"

    # Type de l'objet métier pour le pattern XComponent
    publicMemberType: BusinessObjectType

    states:
      - name: StateName
        type: entry|final|error|regular  # regular par défaut
        onEntry: methodName              # Méthode appelée à l'entrée
        onExit: methodName               # Méthode appelée à la sortie

    transitions:
      - from: StateA
        to: StateB
        event: EVENT_NAME
        type: regular|inter_machine|timeout|auto|internal
        # Options selon le type...
```

---

## Types d'états

| Type | Description | Couleur Dashboard |
|------|-------------|-------------------|
| `entry` | État d'entrée explicite (premier état) | Jaune |
| `regular` | État normal (défaut si non spécifié) | Blanc |
| `final` | État terminal (succès) | Vert |
| `error` | État d'erreur | Rouge |

**Note:** Les états sans transitions sortantes sont automatiquement détectés comme terminaux (affichés en vert).

```yaml
states:
  - name: Received
    type: entry
  - name: Processing
    # type: regular (implicite)
  - name: Completed
    type: final
  - name: Failed
    type: error
```

---

## Types de transitions

### 1. Regular (défaut)
Transition simple déclenchée par un événement.

```yaml
- from: StateA
  to: StateB
  event: DO_SOMETHING
  # type: regular (implicite)
```

### 2. Inter-machine
Crée une nouvelle instance dans une autre state machine.

```yaml
- from: OrderValidated
  to: AwaitingExecution
  event: SEND_TO_EXECUTION
  type: inter_machine
  targetMachine: ExecutionMachine
  targetState: Pending           # État initial dans la machine cible
  contextMapping:                # Mapping du contexte
    orderId: "context.id"
    quantity: "context.quantity"
```

### 3. Timeout
Transition automatique après un délai.

```yaml
- from: WaitingResponse
  to: TimedOut
  event: TIMEOUT
  type: timeout
  timeoutMs: 30000               # Délai en millisecondes
  resetOnTransition: false       # Reset le timer sur self-loop?
```

### 4. Auto
Transition automatique à l'entrée dans l'état source.

```yaml
- from: ValidationPending
  to: Validated
  event: AUTO_VALIDATE
  type: auto
```

### 5. Internal (self-loop)
Transition vers le même état.

```yaml
- from: Processing
  to: Processing
  event: UPDATE_PROGRESS
  type: internal
```

---

## Guards (conditions)

Les guards permettent de conditionner les transitions.

### Guard par clés requises
```yaml
- from: Received
  to: Validated
  event: VALIDATE
  guard:
    keys:
      - amount
      - customerId
```

### Guard par expression
```yaml
- from: Received
  to: Validated
  event: VALIDATE
  guard:
    expression: "event.payload.amount > 0 && event.payload.amount <= 100000"
```

### Guards multiples (premier qui matche)
```yaml
- from: Executing
  to: FullyExecuted
  event: EXECUTION_REPORT
  guard:
    expression: "event.payload.executedQty === context.remainingQty"

- from: Executing
  to: PartiallyExecuted
  event: EXECUTION_REPORT
  guard:
    expression: "event.payload.executedQty < context.remainingQty"
```

---

## Property Matching (Pattern XComponent)

Permet de router les événements vers les instances par propriétés, sans connaître l'ID.

```yaml
stateMachines:
  - name: OrderMachine
    publicMemberType: Order      # Active le property matching

    transitions:
      - from: Pending
        to: Executed
        event: EXECUTION_RECEIVED
        matchingRules:
          - eventProperty: orderId
            instanceProperty: id
            operator: "==="      # ===, !==, >, <, >=, <=
```

**Usage:** L'événement `EXECUTION_RECEIVED` avec `{ orderId: "123" }` sera routé vers l'instance dont `publicMember.id === "123"`.

---

## Triggered Methods

Méthodes appelées lors des transitions ou entrées/sorties d'état.

```yaml
states:
  - name: Validated
    onEntry: sendConfirmationEmail
    onExit: logStateExit

transitions:
  - from: Received
    to: Validated
    event: VALIDATE
    triggeredMethod: validateOrder
```

**Implémentation (TypeScript):**
```typescript
// Ces méthodes sont injectées dans le runtime
const methods = {
  validateOrder: async (context, event, sender) => {
    // Logique de validation
    // sender.sendTo(instanceId, event) - envoyer à une instance
    // sender.broadcast(machineName, event) - broadcast
  },
  sendConfirmationEmail: async (context, event) => {
    // Envoi d'email
  }
};
```

---

## Schéma de contexte

Définit la structure des données de l'instance (utile pour le Dashboard).

```yaml
contextSchema:
  orderId:
    type: string
    label: "Order ID"
    required: true
    placeholder: "ORD-001"
    description: "Unique order identifier"

  amount:
    type: number
    label: "Amount"
    required: true

  priority:
    type: select
    label: "Priority"
    options:
      - value: low
        label: "Low"
      - value: medium
        label: "Medium"
      - value: high
        label: "High"
```

---

## Patterns courants

### Pattern 1: Workflow linéaire simple

```yaml
name: SimpleWorkflow
entryMachine: Main

stateMachines:
  - name: Main
    initialState: Created
    states:
      - name: Created
        type: entry
      - name: InProgress
      - name: Completed
        type: final
      - name: Failed
        type: error
    transitions:
      - from: Created
        to: InProgress
        event: START
      - from: InProgress
        to: Completed
        event: COMPLETE
      - from: InProgress
        to: Failed
        event: FAIL
```

### Pattern 2: Workflow avec approbation

```yaml
name: ApprovalWorkflow
entryMachine: Request

stateMachines:
  - name: Request
    initialState: Draft
    states:
      - name: Draft
        type: entry
      - name: PendingApproval
      - name: Approved
        type: final
      - name: Rejected
        type: final
    transitions:
      - from: Draft
        to: PendingApproval
        event: SUBMIT
      - from: PendingApproval
        to: Approved
        event: APPROVE
      - from: PendingApproval
        to: Rejected
        event: REJECT
      - from: PendingApproval
        to: Draft
        event: REQUEST_CHANGES
```

### Pattern 3: Saga avec compensation

```yaml
name: OrderSaga
entryMachine: OrderOrchestrator

stateMachines:
  - name: OrderOrchestrator
    initialState: Initiated
    states:
      - name: Initiated
        type: entry
      - name: PaymentPending
      - name: PaymentConfirmed
      - name: ShippingPending
      - name: Completed
        type: final
      - name: Compensating
      - name: Cancelled
        type: final
    transitions:
      # Happy path
      - from: Initiated
        to: PaymentPending
        event: PROCESS_PAYMENT
        type: inter_machine
        targetMachine: PaymentProcessor

      - from: PaymentPending
        to: PaymentConfirmed
        event: PAYMENT_SUCCESS

      - from: PaymentConfirmed
        to: ShippingPending
        event: INITIATE_SHIPPING
        type: inter_machine
        targetMachine: ShippingService

      - from: ShippingPending
        to: Completed
        event: SHIPPING_CONFIRMED

      # Compensation path
      - from: PaymentPending
        to: Cancelled
        event: PAYMENT_FAILED

      - from: ShippingPending
        to: Compensating
        event: SHIPPING_FAILED

      - from: Compensating
        to: Cancelled
        event: REFUND_COMPLETED
        triggeredMethod: refundPayment
```

### Pattern 4: Retry avec backoff

```yaml
name: RetryableOperation
entryMachine: Operation

stateMachines:
  - name: Operation
    initialState: Pending
    contextSchema:
      retryCount:
        type: number
        label: "Retry Count"
    states:
      - name: Pending
        type: entry
      - name: Executing
      - name: WaitingRetry
      - name: Succeeded
        type: final
      - name: MaxRetriesExceeded
        type: error
    transitions:
      - from: Pending
        to: Executing
        event: EXECUTE

      - from: Executing
        to: Succeeded
        event: SUCCESS

      - from: Executing
        to: WaitingRetry
        event: TRANSIENT_ERROR
        guard:
          expression: "context.retryCount < 3"
        triggeredMethod: incrementRetryCount

      - from: Executing
        to: MaxRetriesExceeded
        event: TRANSIENT_ERROR
        guard:
          expression: "context.retryCount >= 3"

      - from: WaitingRetry
        to: Executing
        event: RETRY
        type: timeout
        timeoutMs: 5000  # Backoff de 5 secondes
```

### Pattern 5: État composite (sub-states simulés)

```yaml
name: OrderProcessing
entryMachine: Order

stateMachines:
  - name: Order
    initialState: Created
    states:
      - name: Created
        type: entry
      - name: Validating
      - name: Processing
      - name: Shipped
        type: final
    transitions:
      - from: Created
        to: Validating
        event: SUBMIT
        type: inter_machine
        targetMachine: ValidationSubProcess

      - from: Validating
        to: Processing
        event: VALIDATION_COMPLETE

      - from: Processing
        to: Shipped
        event: SHIP

  - name: ValidationSubProcess
    initialState: CheckingInventory
    states:
      - name: CheckingInventory
        type: entry
      - name: CheckingPayment
      - name: ValidationDone
        type: final
    transitions:
      - from: CheckingInventory
        to: CheckingPayment
        event: INVENTORY_OK
      - from: CheckingPayment
        to: ValidationDone
        event: PAYMENT_OK
        triggeredMethod: notifyParentValidationComplete
```

---

## Bonnes pratiques

### Nommage
- **États**: PascalCase, nom descriptif (`OrderReceived`, `PaymentPending`)
- **Événements**: SCREAMING_SNAKE_CASE, verbe à l'impératif ou passé (`VALIDATE`, `PAYMENT_RECEIVED`)
- **Machines**: PascalCase, nom du domaine (`OrderMachine`, `PaymentProcessor`)

### Structure
- Un composant = un domaine métier cohérent
- Une machine = un cycle de vie d'entité
- Limiter à 7-10 états par machine (sinon découper)

### Transitions
- Toujours avoir un chemin vers un état terminal
- Prévoir les cas d'erreur explicitement
- Utiliser les guards pour la logique conditionnelle, pas le code

### Traçabilité
- Les transitions importantes doivent avoir des `triggeredMethod` pour la logique métier
- Utiliser `publicMemberType` pour les entités métier importantes

---

## Commandes CLI

```bash
# Valider un composant
xcomponent-ai validate component.yaml

# Démarrer le serveur avec dashboard
xcomponent-ai serve component.yaml --port 3000

# Générer un diagramme Mermaid
xcomponent-ai diagram component.yaml MachineName

# Lister les composants
xcomponent-ai list
```

---

## API REST

```
POST /api/components/{name}/instances
  Body: { machineName: string, context: object }

POST /api/components/{name}/instances/{id}/events
  Body: { type: string, payload: object }

GET /api/components/{name}/instances/{id}
GET /api/components/{name}/instances/{id}/history
GET /api/components/{name}/diagrams/{machineName}
```

---

## Checklist de génération

Avant de générer un composant, vérifier:

- [ ] Tous les états ont un nom unique dans leur machine
- [ ] L'état initial existe dans la liste des états
- [ ] Toutes les transitions référencent des états existants
- [ ] Il existe au moins un chemin vers un état terminal
- [ ] Les guards utilisent des propriétés disponibles dans le contexte
- [ ] Les `inter_machine` ont un `targetMachine` valide
- [ ] Les `timeout` ont une valeur `timeout` en millisecondes
