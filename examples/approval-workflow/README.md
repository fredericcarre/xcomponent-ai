# Multi-Level Approval Workflow

Ce composant illustre un workflow d'approbation de dépenses avec plusieurs niveaux d'approbation conditionnels.

## Cas d'usage métier

Une entreprise doit gérer les demandes de remboursement de frais :
1. L'employé crée une demande
2. Le manager approuve
3. Si montant > 5000€, le directeur doit aussi approuver
4. Les finances font la revue finale et déclenchent le paiement

## Pattern utilisé : Workflow conditionnel avec escalade

Ce composant utilise des **guards** pour router dynamiquement :
- Montant ≤ 5000€ → Manager → Finance
- Montant > 5000€ → Manager → Directeur → Finance

## Diagramme

```
                    ┌───────────┐
                    │   Draft   │
                    └─────┬─────┘
                          │ SUBMIT
                          ▼
              ┌─────────────────────────┐
              │ PendingManagerApproval  │◄──────────┐
              └───────────┬─────────────┘           │
                          │                         │
        ┌─────────────────┼─────────────────┐       │
        │ REJECT          │ APPROVE         │ CHANGES
        ▼                 ▼                 │       │
  ┌──────────┐    ┌───────────────┐         │       │
  │ Rejected │    │ManagerApproved│    ┌────┴───┐   │
  └──────────┘    └───────┬───────┘    │ Needs  │───┘
                          │            │Revision│
           ┌──────────────┼─────────┐  └────────┘
           │              │         │
    amount > 5000    amount ≤ 5000  │
           │              │         │
           ▼              │         │
┌──────────────────────┐  │         │
│PendingDirectorApproval│ │         │
└──────────┬───────────┘  │         │
           │ APPROVE      │         │
           ▼              │         │
  ┌────────────────┐      │         │
  │DirectorApproved│      │         │
  └────────┬───────┘      │         │
           │              │         │
           └──────────────┼─────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │ PendingFinanceReview│
              └──────────┬──────────┘
                         │ APPROVE
                         ▼
                   ┌──────────┐
                   │ Approved │
                   └──────────┘
```

## Démarrage

```bash
xcomponent-ai serve examples/approval-workflow/component.yaml
```

## Scénarios de test

### Petit montant (≤ 5000€)
```
SUBMIT → MANAGER_APPROVE → ROUTE_FOR_APPROVAL → FINANCE_APPROVE
```

### Grand montant (> 5000€)
```
SUBMIT → MANAGER_APPROVE → ROUTE_FOR_APPROVAL → DIRECTOR_APPROVE → ROUTE_FOR_APPROVAL → FINANCE_APPROVE
```

### Demande de révision
```
SUBMIT → REQUEST_CHANGES → REVISE → SUBMIT → MANAGER_APPROVE → ...
```

### Expiration (timeout de 7 jours)
```
SUBMIT → [7 jours sans action] → APPROVAL_TIMEOUT → Expired
```

## Points d'intérêt

1. **Guards conditionnels** : Le routage dépend du montant
2. **Timeouts** : Chaque étape a un timeout d'expiration (7 jours)
3. **Boucle de révision** : L'employé peut réviser et resoumettre
4. **Triggered methods** : Notifications automatiques à chaque étape
