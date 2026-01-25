# E-Commerce Order Processing

Ce composant illustre un cas d'usage classique : le traitement d'une commande e-commerce avec paiement et livraison.

## Cas d'usage métier

Une boutique en ligne doit gérer le cycle de vie complet d'une commande :
1. Création et validation de la commande
2. Traitement du paiement (avec timeout et retry)
3. Préparation et expédition
4. Suivi de livraison
5. Gestion des retours et remboursements

## Pattern utilisé : Saga avec Compensation

Ce composant utilise le pattern **Saga** pour orchestrer plusieurs opérations :
- Si le paiement échoue → la commande est annulée
- Si la livraison échoue → un remboursement est déclenché
- Chaque étape peut être compensée

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OrderOrchestrator                     │
│  (Machine principale qui orchestre le flux)              │
├─────────────────────────────────────────────────────────┤
│  Created → Validating → PaymentPending → Paid → ...     │
└────────────────┬─────────────────┬──────────────────────┘
                 │                 │
                 ▼                 ▼
    ┌────────────────────┐  ┌──────────────────┐
    │  PaymentProcessor  │  │  ShippingTracker │
    │  (Sous-machine)    │  │  (Sous-machine)  │
    └────────────────────┘  └──────────────────┘
```

## Démarrage

```bash
# Démarrer le serveur
xcomponent-ai serve examples/e-commerce-order/component.yaml

# Ouvrir le dashboard
open http://localhost:3000
```

## Scénarios de test

### Happy Path (succès)
```
SUBMIT → VALIDATION_SUCCESS → PAYMENT_SUCCESS → START_PREPARATION → SHIP → DELIVERY_CONFIRMED
```

### Échec paiement
```
SUBMIT → VALIDATION_SUCCESS → PAYMENT_FAILED
```

### Annulation
```
SUBMIT → CANCEL
```

### Remboursement après livraison
```
... → DELIVERED → RETURN_REQUESTED → REFUND_COMPLETED
```

## Points d'intérêt

1. **Inter-machine transitions** : Le paiement et la livraison sont gérés par des sous-machines dédiées
2. **Timeout** : Le paiement a un timeout de 30 secondes
3. **Guards** : Le retry de livraison est limité à 3 tentatives
4. **Compensation** : Chemin de remboursement clairement défini
