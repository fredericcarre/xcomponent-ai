# 🚀 Quick Start Guide

Ce guide vous montre comment utiliser xcomponent-ai en 5 minutes.

## 📦 Installation

```bash
npm install -g xcomponent-ai
```

## 🎯 Workflow en 4 étapes

### 1. Créer ou Utiliser un FSM

Utilisez un exemple fourni :
```bash
# Voir la liste des exemples
ls $(npm root -g)/xcomponent-ai/examples/

# Charger un exemple pour voir sa structure
xcomponent-ai load examples/trading.yaml
```

Ou créez votre propre projet :
```bash
xcomponent-ai init my-project
cd my-project
```

### 2. Démarrer le Runtime + Dashboard

**C'est LA commande principale** - elle démarre :
- ✅ Le runtime FSM (pour créer et gérer les instances)
- ✅ L'API REST (pour envoyer des événements)
- ✅ Le dashboard web (pour visualiser en temps réel)

```bash
xcomponent-ai serve examples/trading.yaml
```

**Sortie attendue :**
```
🚀 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Component: TradingComponent
   Machines:
   - OrderEntry (5 states, 7 transitions)
   - Settlement (3 states, 3 transitions)

🌐 API Server:    http://localhost:3000
📊 Dashboard:     http://localhost:3000/dashboard
📡 WebSocket:     ws://localhost:3000

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Press Ctrl+C to stop
```

### 3. Visualiser dans le Dashboard

Ouvrez votre navigateur sur **http://localhost:3000/dashboard**

Vous verrez :
- 📊 **Toutes les instances** actives (tableau en temps réel)
- 🔄 **Les transitions** d'état en direct
- 📈 **Statistiques** (nombre d'instances par état)
- 🎨 **Graphe visuel** des FSM

### 4. Interagir avec le Runtime

**Option A : Via l'API REST (curl)**

```bash
# Créer une nouvelle instance
curl -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{
    "machineName": "OrderEntry",
    "context": {
      "orderId": "ORD-001",
      "amount": 1000,
      "symbol": "AAPL"
    }
  }'

# Réponse : {"instanceId": "abc-123"}

# Envoyer un événement
curl -X POST http://localhost:3000/api/instances/abc-123/events \
  -H "Content-Type: application/json" \
  -d '{
    "type": "VALIDATE",
    "payload": {}
  }'

# Voir l'état d'une instance
curl http://localhost:3000/api/instances/abc-123

# Lister toutes les instances
curl http://localhost:3000/api/instances
```

**Option B : Via le CLI (mode interactif)**

```bash
# Démarrer le mode REPL
xcomponent-ai repl examples/trading.yaml

# Puis tapez des commandes :
> create OrderEntry { orderId: "ORD-001", amount: 1000 }
Instance created: abc-123

> send abc-123 VALIDATE
Transition: Pending → Validated

> list
Instances:
- abc-123 (OrderEntry) : Validated

> inspect abc-123
Instance: abc-123
Machine: OrderEntry
State: Validated
Context: { orderId: "ORD-001", amount: 1000, symbol: "AAPL" }
```

**Option C : Via le Dashboard Web**

1. Ouvrez http://localhost:3000/dashboard
2. Cliquez sur **"+ New Instance"**
3. Sélectionnez la machine : `OrderEntry`
4. Entrez le contexte : `{ "orderId": "ORD-001", "amount": 1000 }`
5. Cliquez sur **"Create"**
6. Voyez l'instance apparaître dans le tableau
7. Cliquez sur l'instance pour envoyer des événements

## 🔍 Monitorer les FSM

### Voir les logs en temps réel

Dans le terminal où tourne `xcomponent-ai serve` :
```
[14:32:15] Instance abc-123 created (OrderEntry)
[14:32:18] abc-123: Pending → Validated (event: VALIDATE)
[14:32:20] abc-123: Validated → Executed (event: EXECUTE)
```

### Analyser les logs

```bash
# Dans un autre terminal
xcomponent-ai logs --component TradingComponent

# Filtrer par instance
xcomponent-ai logs --instance abc-123

# Voir les statistiques
xcomponent-ai stats
```

## 🧪 Tester un Scénario Complet

```bash
# 1. Démarrer le runtime
xcomponent-ai serve examples/trading.yaml &

# 2. Créer une instance
INSTANCE=$(curl -s -X POST http://localhost:3000/api/instances \
  -H "Content-Type: application/json" \
  -d '{"machineName": "OrderEntry", "context": {"orderId": "ORD-001"}}' \
  | jq -r '.instanceId')

# 3. Envoyer des événements en séquence
curl -X POST http://localhost:3000/api/instances/$INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "VALIDATE"}'

sleep 1

curl -X POST http://localhost:3000/api/instances/$INSTANCE/events \
  -H "Content-Type: application/json" \
  -d '{"type": "EXECUTE"}'

# 4. Vérifier l'état final
curl http://localhost:3000/api/instances/$INSTANCE
```

## 📝 Créer Votre Propre FSM

```bash
# Créer un nouveau projet
xcomponent-ai init loan-approval

cd loan-approval

# Éditer fsm/LoanApprovalComponent.yaml
# (Ajouter vos états, transitions, guards)

# Tester votre FSM
xcomponent-ai serve fsm/LoanApprovalComponent.yaml
```

## 🎓 Prochaines Étapes

- 📖 Lire le [Framework Guide](./LLM_FRAMEWORK_GUIDE.md) pour comprendre les concepts
- 🔧 Voir [PERSISTENCE.md](./PERSISTENCE.md) pour l'event sourcing et la persistance
- 💡 Consulter [examples/](./examples/) pour des cas d'usage avancés

## ❓ FAQ

**Q: Combien de temps les instances restent en mémoire ?**
R: Tant que le serveur `xcomponent-ai serve` tourne. Pour la persistance, voir PERSISTENCE.md

**Q: Comment arrêter le runtime ?**
R: Ctrl+C dans le terminal où tourne `xcomponent-ai serve`

**Q: Puis-je déployer en production ?**
R: Oui, mais utilisez le mode programmatique (voir examples/full-project-structure.md)

**Q: Le dashboard fonctionne-t-il avec plusieurs composants ?**
R: Pas encore avec `xcomponent-ai serve`, mais oui en mode programmatique

