# XComponent Pattern Guide

## 🏗️ Qu'est-ce que le Pattern XComponent ?

Le pattern XComponent permet d'orchestrer plusieurs machines à états au sein d'un même composant :

- **Entry Point** : Une machine principale créée automatiquement au démarrage
- **Transitions Inter-Machines** : Créent dynamiquement de nouvelles instances d'autres machines
- **Auto-Désallocation** : Les instances sont détruites automatiquement en état final (sauf l'entry point)
- **Vue d'Ensemble** : Dashboard montrant toutes les machines et leurs connexions

## 🚀 Démarrage Rapide

### 1. Utiliser l'Exemple XComponent

```bash
xcomponent-ai serve examples/xcomponent-pattern-demo.yaml
```

**Sortie attendue:**
```
🚀 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[10:15:46] [OrderProcessingXComponent] ⭐ Entry point instance created: be94a22e (OrderManager)

📦 Component: OrderProcessingXComponent
   ⭐ Entry Point: OrderManager
   Machines:
   - OrderManager (4 states, 4 transitions)
   - OrderExecution (6 states, 6 transitions)
   - Settlement (3 states, 3 transitions)
```

### 2. Ouvrir le Dashboard

```bash
open http://localhost:3000/dashboard.html
```

**Ce que vous verrez :**
- **Tab "Component View"** (par défaut) montrant toutes les machines
- **OrderManager** avec une étoile ⭐ (entry point) et badge [1] (1 instance active)
- **Flèches vertes** entre les machines = transitions inter_machine
- **Compteur d'instances** pour chaque machine

### 3. Créer des Instances via Transitions Inter-Machines

**Option A : Via le Dashboard Component View**
1. Cliquez sur la **flèche verte** entre OrderManager et OrderExecution
2. Cela déclenche la transition `START_EXECUTION`
3. Une nouvelle instance d'OrderExecution est créée automatiquement
4. Le compteur s'incrémente en temps réel

**Option B : Via l'API**
```bash
# Récupérer l'ID de l'instance entry point
ENTRY_INSTANCE=$(curl -s http://localhost:3000/api/instances | jq -r '.instances[0].id')

# Passer OrderManager à l'état OrderReceived
curl -X POST http://localhost:3000/api/instances/$ENTRY_INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "NEW_ORDER", "payload": {}}'

# Déclencher la transition inter_machine (crée OrderExecution)
curl -X POST http://localhost:3000/api/instances/$ENTRY_INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "START_EXECUTION", "payload": {}}'
```

## 📝 Structure YAML pour XComponent

```yaml
name: MonComposant
version: 1.0.0

# Spécifier l'entry point
entryMachine: MachineManager  # ⭐ Créée automatiquement

# Configuration optionnelle du layout
layout:
  algorithm: grid  # ou 'force', 'hierarchical'

stateMachines:
  # Entry Point - persiste même en état final
  - name: MachineManager
    initialState: Ready

    states:
      - name: Ready
        type: entry
      - name: Completed
        type: final  # Entry point reste vivant même ici

    transitions:
      # Transition normale
      - from: Ready
        to: Processing
        event: START
        type: triggerable

      # Transition inter_machine - crée une nouvelle instance
      - from: Processing
        to: Ready
        event: CREATE_WORKER
        type: inter_machine        # ← Type spécial
        targetMachine: WorkerMachine  # ← Machine à créer

  # Machine créée dynamiquement
  - name: WorkerMachine
    initialState: Created

    states:
      - name: Created
        type: entry
      - name: Done
        type: final  # Auto-désallouée ici

    transitions:
      - from: Created
        to: Done
        event: FINISH
        type: triggerable
```

## 🔄 Cycle de Vie des Instances

### Entry Point (MachineManager)
```
Démarrage Composant
  ↓
⭐ Instance créée automatiquement
  ↓
[Reste vivante toute la durée du composant]
  ↓
État Final → PERSISTE ⭐
```

### Machines Normales (WorkerMachine)
```
Transition inter_machine déclenchée
  ↓
🔄 Instance créée dynamiquement
  ↓
[Traitement...]
  ↓
État Final → DÉSALLOUÉE ✓
```

## 🎨 Dashboard - Component View

### Vue par Défaut
```
🏗️ Component View
┌────────────────────────────────────┐
│ ⭐ MachineManager    [1]           │
│ (Entry Point)                      │
│           ↓ (CREATE_WORKER)        │ ← Cliquez ici !
│ WorkerMachine        [5]           │
└────────────────────────────────────┘
```

### Actions Disponibles
- **Cliquer sur une carte de machine** → Vue diagramme détaillé
- **Cliquer sur une flèche verte** → Exécuter la transition inter_machine
- **Badge de compteur** → Nombre d'instances actives

## 📊 Monitoring

### Logs en Temps Réel
```bash
[10:15:46] [MonComposant] ⭐ Entry point instance created: be94a22e (MachineManager)
[10:16:01] [MonComposant] abc123: Ready → Processing (event: START)
[10:16:05] [MonComposant] Instance def456 created (WorkerMachine)
[10:16:10] [MonComposant] def456: Created → Done (event: FINISH)
[10:16:10] [MonComposant] Instance def456 disposed (WorkerMachine)
```

### API Instances
```bash
# Lister toutes les instances
curl http://localhost:3000/api/instances

# Vérifier qu'une instance est l'entry point
curl http://localhost:3000/api/instances | jq '.instances[] | select(.isEntryPoint == true)'
```

## 🎯 Cas d'Usage

### Orchestration de Workflow
```yaml
entryMachine: OrderOrchestrator

stateMachines:
  - name: OrderOrchestrator  # Coordonne tout
    transitions:
      - type: inter_machine
        targetMachine: OrderValidation
      - type: inter_machine
        targetMachine: PaymentProcessing
      - type: inter_machine
        targetMachine: Shipping

  - name: OrderValidation    # Sous-workflow
  - name: PaymentProcessing  # Sous-workflow
  - name: Shipping           # Sous-workflow
```

### Gestion de Pool
```yaml
entryMachine: PoolManager

stateMachines:
  - name: PoolManager  # Crée des workers à la demande
    transitions:
      - type: inter_machine
        targetMachine: Worker

  - name: Worker  # Auto-détruit après traitement
    states:
      - name: Done
        type: final  # ✓ Désalloué
```

## ⚠️ Bonnes Pratiques

1. **Un seul entry point par composant**
   - Marquer clairement avec `entryMachine`
   - Utiliser un nom significatif (Manager, Orchestrator, Coordinator)

2. **Transitions inter_machine claires**
   - Noms explicites : `CREATE_EXECUTION`, `START_SETTLEMENT`
   - Documenter le flow dans metadata

3. **États finaux appropriés**
   - Utiliser `type: final` pour auto-désallocation
   - Entry point peut rester en final (il persiste)

4. **Monitoring**
   - Observer les logs pour débogage
   - Utiliser Component View pour vue d'ensemble

## 🐛 Dépannage

### L'entry point n'est pas créé
```bash
# Vérifier que entryMachine est défini
grep "entryMachine" mon-component.yaml

# Vérifier les logs au démarrage
xcomponent-ai serve mon-component.yaml
# Chercher: "⭐ Entry point instance created"
```

### Les transitions inter_machine ne fonctionnent pas
```bash
# Vérifier le type de transition
grep -A 2 "inter_machine" mon-component.yaml
# Doit avoir: type: inter_machine + targetMachine: MachineNom

# Vérifier que la machine cible existe
grep "name:" mon-component.yaml
```

### Les instances ne sont pas désallouées
```bash
# Vérifier que l'état est marqué final
grep -A 1 "type: final" mon-component.yaml

# Vérifier que ce n'est pas l'entry point
curl http://localhost:3000/api/instances | jq '.instances[] | select(.isEntryPoint == true)'
```

## 📚 Exemples Complets

- `examples/xcomponent-pattern-demo.yaml` - Demo complète avec 3 machines
- `examples/order-processing-xcomponent.yaml` - Traitement de commandes (avec guards - ancienne version)

## 🔗 Ressources

- [CHANGELOG.md](./CHANGELOG.md) - Historique des versions
- [QUICKSTART.md](./QUICKSTART.md) - Guide de démarrage rapide
- [LLM-GUIDE.md](./LLM-GUIDE.md) - Guide pour les IA
