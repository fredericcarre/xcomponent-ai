# Docker Development Environment

Ce guide explique comment utiliser Docker pour développer et tester xcomponent-ai localement.

## Prérequis

- Docker et Docker Compose V2 installés
  - Utilise la commande `docker compose` (avec espace) et non `docker-compose` (avec tiret)
  - Docker Desktop inclut déjà Compose V2
- Make (optionnel, pour utiliser les commandes simplifiées)

## Démarrage Rapide

### Avec Make (recommandé)

```bash
# Afficher toutes les commandes disponibles
make help

# Build et démarrer l'environnement de développement
make quick-start

# Ou simplement
make dev
```

### Sans Make

```bash
# Build les images
docker compose build

# Démarrer l'environnement de développement
docker compose up dev
```

## Accès au Dashboard

Une fois le conteneur démarré, ouvre ton navigateur sur:

**http://localhost:3000/dashboard.html**

Tu verras:
- ✅ Le composant "SimpleXComponent" dans le sélecteur
- ✅ Vue d'ensemble avec toutes les machines
- ✅ Transitions cliquables
- ✅ Instances en temps réel

## Commandes Disponibles

### Environnement de Développement

```bash
# Démarrer en mode développement
make dev

# Voir les logs
make logs

# Ouvrir un shell dans le conteneur
make shell
```

### Exemples Différents

```bash
# Exemple simple (par défaut)
make dev

# Exemple e-commerce
make ecommerce

# Exemple workflow d'approbation
make approval

# Exemple cycle de vie d'abonnement
make subscription
```

### Production

```bash
# Démarrer en mode production
make prod
```

### Tests

```bash
# Exécuter les tests
make test
```

### Nettoyage

```bash
# Arrêter les conteneurs
make stop

# Supprimer tout (conteneurs, volumes, images)
make clean
```

## Structure Docker

### Dockerfile Multi-stage

Le `Dockerfile` utilise une approche multi-stage:

1. **builder**: Compile TypeScript
2. **production**: Image optimisée pour la prod (sans devDependencies)
3. **development**: Image avec tous les outils de dev

### docker-compose.yml

Trois services sont définis:

- **dev**: Développement avec volumes montés pour le hot reload
- **prod**: Production avec image optimisée
- **test**: Exécution des tests

## Développement avec Hot Reload

Le service `dev` monte les répertoires source en lecture seule:

```yaml
volumes:
  - ./src:/app/src:ro
  - ./public:/app/public:ro
  - ./examples:/app/examples:ro
```

Pour appliquer tes changements:

1. Modifie le code localement
2. Le conteneur détecte les changements
3. Rebuild automatique (via watch mode si configuré)
4. OU redémarre manuellement: `make dev`

## Tester un Exemple Personnalisé

Pour tester avec ton propre fichier YAML:

```bash
# Crée ton fichier example
# examples/mon-exemple/component.yaml

# Lance avec Docker
docker-compose run --rm -p 3000:3000 dev sh -c \
  "npm run build && node dist/cli.js serve examples/mon-exemple/component.yaml --port 3000"
```

## Debug dans Docker

### Voir les logs en temps réel

```bash
make logs
```

### Shell interactif dans le conteneur

```bash
make shell

# Puis dans le conteneur
ls -la
node dist/cli.js --help
```

### Inspecter l'état du système

```bash
# Dans le shell du conteneur
node dist/cli.js serve examples/simple-xcomponent-demo.yaml
```

## Variables d'Environnement

Tu peux personnaliser le comportement avec des variables d'environnement:

```bash
# Modifier le port
PORT=4000 docker-compose up dev

# Mode debug
DEBUG=* docker-compose up dev
```

## Volumes Docker

Les `node_modules` sont stockés dans un volume nommé pour:
- Éviter les conflits avec ta machine hôte
- Améliorer les performances
- Isolation complète

## Troubleshooting

### Port 3000 déjà utilisé

```bash
# Utilise un autre port
docker-compose run --rm -p 4000:3000 dev sh -c \
  "npm run build && node dist/cli.js serve examples/simple-xcomponent-demo.yaml --port 3000"
```

### Build lent

```bash
# Rebuild sans cache
docker-compose build --no-cache

# Ou avec Make
make clean
make build
```

### Problèmes de permissions

Sur Linux, si tu as des problèmes de permissions:

```bash
# Ajoute ton utilisateur au groupe docker
sudo usermod -aG docker $USER

# Reconnecte-toi pour appliquer les changements
```

## Avantages de Docker pour ce Projet

✅ **Environnement cohérent**: Même Node.js, même npm, partout
✅ **Pas de pollution locale**: node_modules isolé
✅ **Démarrage rapide**: Un seul `make dev` pour tout configurer
✅ **Tests faciles**: Environnement propre pour chaque test
✅ **Production-ready**: Image optimisée pour le déploiement

## Prochaines Étapes

1. **Tester le dashboard**: `make dev` puis ouvre http://localhost:3000/dashboard.html
2. **Essayer les exemples**: `make ecommerce`, `make approval`, etc.
3. **Développer**: Modifie le code et teste immédiatement
4. **Déployer**: Utilise l'image production pour le déploiement
