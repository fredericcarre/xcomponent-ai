# Subscription Lifecycle Management

Ce composant illustre la gestion complète du cycle de vie d'un abonnement SaaS.

## Cas d'usage métier

Un service SaaS doit gérer :
1. Période d'essai gratuite (14 jours)
2. Conversion en abonnement payant
3. Renouvellements automatiques
4. Gestion des échecs de paiement
5. Suspension et réactivation
6. Annulation avec accès jusqu'à fin de période

## Pattern utilisé : Lifecycle avec états récurrents

Ce composant utilise des **self-loops** pour les événements récurrents :
- `PAYMENT_SUCCESS` sur `Active` → prolonge l'abonnement
- `PAYMENT_FAILED` sur `PastDue` → retente le paiement

## Diagramme

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │  ┌───────┐   11 days   ┌──────────────┐   3 days       │
    │  │ Trial │────────────►│TrialExpiring │───────────┐    │
    │  └───┬───┘             └──────┬───────┘           │    │
    │      │                        │                   │    │
    │      │ SUBSCRIBE              │ SUBSCRIBE         │    │
    │      │                        │                   ▼    │
    │      │                        │            ┌─────────┐ │
    │      └────────────────────────┴───────────►│ Expired │ │
    │                                            └─────────┘ │
    │                    │                             ▲     │
    │                    ▼                             │     │
    │   ┌─────────────────────────────────────────────┼─────┤
    │   │               ┌────────┐                    │     │
    │   │    ┌─────────►│ Active │◄──────────────┐    │     │
    │   │    │          └───┬────┘               │    │     │
    │   │    │              │                    │    │     │
    │   │    │   PAYMENT    │ PAYMENT     PAYMENT│    │     │
    │   │    │   SUCCESS    │ FAILED     SUCCESS │    │     │
    │   │    │              ▼                    │    │     │
    │   │    │         ┌─────────┐               │    │     │
    │   │    │         │ PastDue │───────────────┘    │     │
    │   │    │         └────┬────┘                    │     │
    │   │    │              │ (3 failures)            │     │
    │   │    │              ▼                         │     │
    │   │    │        ┌───────────┐                   │     │
    │   │    └────────┤ Suspended │──────────────────►│     │
    │   │             └───────────┘    30 days        │     │
    │   │                   │          (churn)        │     │
    │   │                   │                   ┌─────┴───┐ │
    │   │                   │                   │ Churned │ │
    │   │                   │                   └─────────┘ │
    │   │    ┌──────────────┴────────────────────────┐     │
    │   │    │             CANCEL                    │     │
    │   │    ▼                                       │     │
    │   │ ┌───────────┐     PERIOD_ENDED       ┌────┴────┐ │
    │   │ │ Cancelled │───────────────────────►│ Expired │ │
    │   │ └───────────┘                        └─────────┘ │
    │   │       │                                          │
    │   │       │ REACTIVATE                               │
    │   │       └──────────────────────────────────────────┘
    │   │
    └───┴──────────────────────────────────────────────────┘
```

## Démarrage

```bash
xcomponent-ai serve examples/subscription-lifecycle/component.yaml
```

## Scénarios de test

### Conversion trial → paid
```
[14 jours] → TRIAL_EXPIRING_SOON → SUBSCRIBE → Active
```

### Renouvellement réussi
```
Active → PAYMENT_SUCCESS (self-loop) → Active
```

### Échec de paiement avec récupération
```
Active → PAYMENT_FAILED → PastDue → PAYMENT_SUCCESS → Active
```

### Suspension et churn
```
Active → PAYMENT_FAILED → PastDue → [3 échecs] → Suspended → [30 jours] → Churned
```

### Annulation volontaire
```
Active → CANCEL → Cancelled → PERIOD_ENDED → Expired
```

### Réactivation après annulation
```
Cancelled → REACTIVATE → Active
```

## Machines liées

### BillingCycle
Gère le cycle de facturation récurrent :
- Génération des factures
- Tentatives de paiement
- Retry automatique (3 tentatives)

## Points d'intérêt

1. **Self-loops** : `PAYMENT_SUCCESS` et `PLAN_CHANGED` sur `Active`
2. **Timeouts multiples** : Trial (14j), Grace period (14j), Suspension (30j)
3. **Guards avec compteur** : Retry limité à 3 tentatives
4. **Inter-machine** : Pourrait être étendu pour créer des factures via `BillingCycle`
5. **Triggered methods** : Provisioning/deprovisioning des ressources
