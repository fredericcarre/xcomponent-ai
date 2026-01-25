# 🧪 Test du Pattern XComponent

## ⚠️ IMPORTANT : Utilisez le BON Exemple !

### ❌ PAS `explicit-transitions-demo.yaml`
Cet exemple **N'A PAS** :
- `entryMachine` → aucune instance créée au démarrage
- Transitions `inter_machine` → pas de flèches vertes dans Component View
- Il montre seulement le pattern `sender.sendToSelf()`

### ✅ Utilisez `simple-xcomponent-demo.yaml`
Cet exemple **A TOUT** :
- `entryMachine: Coordinator` → 1 instance créée automatiquement ⭐
- 1 transition `inter_machine` → flèche verte Coordinator → Worker
- Vue Component complète

## 🚀 Test Étape par Étape

### 1. Démarrer le Serveur

```bash
xcomponent-ai serve examples/simple-xcomponent-demo.yaml
```

**Ce que vous DEVEZ voir dans le terminal :**
```
🚀 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[10:15:46] [SimpleXComponent] ⭐ Entry point instance created: abc12345 (Coordinator)

📦 Component: SimpleXComponent
   ⭐ Entry Point: Coordinator    ← IMPORTANT : L'entry point est indiqué ici
   Machines:
   - Coordinator (3 states, 3 transitions)
   - Worker (3 states, 2 transitions)
```

### 2. Vérifier l'Instance Entry Point

Dans un autre terminal :

```bash
# Vérifier qu'une instance a été créée automatiquement
curl http://localhost:3000/api/instances
```

**Résultat attendu :**
```json
{
  "instances": [
    {
      "id": "abc12345-...",
      "machineName": "Coordinator",
      "currentState": "Ready",
      "status": "active",
      "isEntryPoint": true,    ← IMPORTANT : Marqué comme entry point
      "componentName": "SimpleXComponent"
    }
  ]
}
```

### 3. Ouvrir le Dashboard

```bash
open http://localhost:3000/dashboard.html
```

## 📊 Ce que Vous Devez Voir dans le Dashboard

### Vue "Component View" (Tab par Défaut)

```
┌─────────────────────────────────────────┐
│  🏗️ Component Overview: SimpleXComponent │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────┐                      │
│  │ ⭐ Coordinator│ [1]  ← Badge avec 1 instance
│  │ Entry Point  │                      │
│  │ 3 states     │                      │
│  └──────┬───────┘                      │
│         │                              │
│         ↓ CREATE_WORKER (flèche verte) ← Cliquez ici !
│         │                              │
│  ┌──────┴───────┐                      │
│  │ Worker       │ [0]  ← Pas d'instance encore
│  │ 3 states     │                      │
│  └──────────────┘                      │
└─────────────────────────────────────────┘
```

**Points Importants :**
- ⭐ **Étoile jaune** à côté de "Coordinator" → C'est l'entry point
- **Badge [1]** → 1 instance active du Coordinator
- **Badge [0]** → 0 instance de Worker (normal, pas encore créée)
- **Flèche verte** entre Coordinator et Worker → Transition `inter_machine`

### 4. Tester la Création d'Instance via Flèche Verte

#### Étape A : Préparer le Coordinator

Le Coordinator doit être dans l'état `Working` pour déclencher `CREATE_WORKER`.

```bash
# Récupérer l'ID de l'instance entry point
ENTRY=$(curl -s http://localhost:3000/api/instances | jq -r '.instances[0].id')

# Passer à Working
curl -X POST http://localhost:3000/api/instances/$ENTRY/events \
  -H "Content-Type: application/json" \
  -d '{"type": "START", "payload": {}}'
```

**Dans le dashboard**, vous verrez :
- Coordinator passe de `Ready` → `Working`

#### Étape B : Cliquer sur la Flèche Verte

1. **Dans Component View**, cliquez sur la **flèche verte** entre Coordinator et Worker
2. Une popup vous demande l'instance (il n'y en a qu'une, donc validation auto)
3. L'événement `CREATE_WORKER` est envoyé

**Résultat Immédiat :**
- 🎉 Une **nouvelle instance de Worker** est créée !
- Badge Worker passe de [0] à [1]
- Dans le terminal, vous voyez : `[10:16:05] Instance xyz789 created (Worker)`

#### Étape C : Vérifier les Instances

```bash
curl http://localhost:3000/api/instances
```

**Résultat attendu :**
```json
{
  "instances": [
    {
      "id": "abc12345-...",
      "machineName": "Coordinator",
      "currentState": "Ready",
      "isEntryPoint": true    ← Entry point (persiste)
    },
    {
      "id": "xyz789-...",
      "machineName": "Worker",
      "currentState": "Created",
      "isEntryPoint": false   ← Instance normale (sera désallouée)
    }
  ]
}
```

### 5. Tester l'Auto-Désallocation

```bash
# Récupérer l'ID du Worker
WORKER=$(curl -s http://localhost:3000/api/instances | jq -r '.instances[] | select(.machineName == "Worker") | .id')

# Compléter le Worker (le mettre en état final)
curl -X POST http://localhost:3000/api/instances/$WORKER/events \
  -H "Content-Type: application/json" \
  -d '{"type": "PROCESS", "payload": {}}'

curl -X POST http://localhost:3000/api/instances/$WORKER/events \
  -H "Content-Type: application/json" \
  -d '{"type": "COMPLETE", "payload": {}}'
```

**Résultat Attendu :**
- Worker passe à l'état `Completed` (type: final)
- **Worker est DÉSALLOUÉ automatiquement** ✓
- Badge Worker repasse de [1] à [0]
- Terminal affiche : `Instance xyz789 disposed (Worker)`

```bash
# Vérifier que le Worker a été désalloué
curl http://localhost:3000/api/instances
# → Seulement le Coordinator reste !
```

### 6. Tester la Persistance de l'Entry Point

```bash
# Mettre le Coordinator en état final
curl -X POST http://localhost:3000/api/instances/$ENTRY/events \
  -H "Content-Type: application/json" \
  -d '{"type": "FINISH", "payload": {}}'
```

**Résultat Attendu :**
- Coordinator passe à l'état `Done` (type: final)
- **Coordinator RESTE VIVANT** ⭐ (car c'est l'entry point)
- Badge Coordinator reste à [1]

```bash
# Vérifier que le Coordinator persiste
curl http://localhost:3000/api/instances
# → Le Coordinator est toujours là avec isEntryPoint: true
```

## 🎯 Checklist de Validation

- [ ] Le terminal affiche "⭐ Entry point instance created"
- [ ] API `/api/instances` retourne 1 instance avec `isEntryPoint: true`
- [ ] Dashboard Component View affiche ⭐ Coordinator avec badge [1]
- [ ] Flèche verte visible entre Coordinator et Worker
- [ ] Clic sur flèche verte crée une instance Worker
- [ ] Badge Worker s'incrémente
- [ ] Worker désalloué automatiquement en état final
- [ ] Coordinator persiste même en état final

## 🐛 Dépannage

### Problème : "No instances yet"
**Cause :** Vous utilisez `explicit-transitions-demo.yaml` au lieu de `simple-xcomponent-demo.yaml`
**Solution :** Relancer avec le bon fichier

### Problème : "No inter-machine transitions"
**Cause :** Le YAML n'a pas de champ `entryMachine` ou pas de transitions `type: inter_machine`
**Solution :** Vérifier le contenu du fichier :
```bash
grep "entryMachine:" examples/simple-xcomponent-demo.yaml
grep "inter_machine" examples/simple-xcomponent-demo.yaml
```

### Problème : "Flèches vertes invisibles"
**Cause :** Le composant n'a pas de transitions `inter_machine` définies
**Solution :** Utiliser `simple-xcomponent-demo.yaml` ou `xcomponent-pattern-demo.yaml`

## 📚 Exemples Disponibles

| Fichier | Entry Point | Inter-Machine | Difficulté |
|---------|-------------|---------------|------------|
| `simple-xcomponent-demo.yaml` | ✅ | ✅ (1) | ⭐ Facile |
| `xcomponent-pattern-demo.yaml` | ✅ | ✅ (2) | ⭐⭐ Moyen |
| `explicit-transitions-demo.yaml` | ❌ | ❌ | ⭐ (Autre pattern) |

**Recommandation :** Commencez par `simple-xcomponent-demo.yaml` !
