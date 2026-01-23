/**
 * Dashboard Demo Script
 *
 * This script demonstrates the enhanced dashboard with:
 * - Real-time FSM visualization
 * - Event history (persistence enabled)
 * - Sequence diagrams
 * - Interactive controls
 *
 * Usage:
 *   npm run build
 *   npx ts-node examples/demo-dashboard.ts
 */

import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';
import { APIServer } from '../src/api';
import { InMemoryEventStore, InMemorySnapshotStore } from '../src/persistence';

// E-commerce component with persistence
const ecommerceComponent: Component = {
  name: 'EcommerceDemo',
  version: '1.0.0',
  stateMachines: [
    {
      name: 'Order',
      initialState: 'Draft',
      publicMemberType: 'Order',
      states: [
        { name: 'Draft', type: StateType.ENTRY },
        { name: 'Validated', type: StateType.REGULAR },
        { name: 'PaymentPending', type: StateType.REGULAR },
        { name: 'Confirmed', type: StateType.REGULAR },
        { name: 'Shipped', type: StateType.REGULAR },
        { name: 'Delivered', type: StateType.FINAL },
        { name: 'Cancelled', type: StateType.ERROR },
      ],
      transitions: [
        {
          from: 'Draft',
          to: 'Validated',
          event: 'VALIDATE',
          type: TransitionType.REGULAR,
        },
        {
          from: 'Validated',
          to: 'PaymentPending',
          event: 'REQUEST_PAYMENT',
          type: TransitionType.AUTO,
          timeoutMs: 0, // Auto-transition immédiate
        },
        {
          from: 'PaymentPending',
          to: 'Confirmed',
          event: 'PAYMENT_RECEIVED',
          type: TransitionType.REGULAR,
        },
        {
          from: 'Confirmed',
          to: 'Shipped',
          event: 'SHIP',
          type: TransitionType.REGULAR,
        },
        {
          from: 'Shipped',
          to: 'Delivered',
          event: 'DELIVER',
          type: TransitionType.REGULAR,
        },
        {
          from: 'Draft',
          to: 'Cancelled',
          event: 'CANCEL',
          type: TransitionType.REGULAR,
        },
        {
          from: 'PaymentPending',
          to: 'Cancelled',
          event: 'TIMEOUT',
          type: TransitionType.TIMEOUT,
          timeoutMs: 30000, // 30 secondes timeout
        },
      ],
    },
    {
      name: 'Inventory',
      initialState: 'Available',
      publicMemberType: 'Inventory',
      states: [
        { name: 'Available', type: StateType.ENTRY },
        { name: 'Reserved', type: StateType.REGULAR },
        { name: 'OutOfStock', type: StateType.REGULAR },
      ],
      transitions: [
        {
          from: 'Available',
          to: 'Reserved',
          event: 'RESERVE',
          type: TransitionType.REGULAR,
        },
        {
          from: 'Reserved',
          to: 'OutOfStock',
          event: 'DEPLETE',
          type: TransitionType.REGULAR,
        },
        {
          from: 'Reserved',
          to: 'Available',
          event: 'RELEASE',
          type: TransitionType.REGULAR,
        },
      ],
    },
  ],
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║     XComponent AI - Enhanced Dashboard Demo                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Start API server (it will create its own runtime when loading components)
  const server = new APIServer();

  // We need to manually register a runtime with persistence for this demo
  // Create runtime with persistence enabled
  const eventStore = new InMemoryEventStore();
  const snapshotStore = new InMemorySnapshotStore();

  const runtime = new FSMRuntime(ecommerceComponent, {
    eventSourcing: true,
    snapshots: true,
    snapshotInterval: 2,
    eventStore,
    snapshotStore,
  });

  // Register runtime with API server (accessing private property for demo purposes)
  // In production, you'd load via the API endpoint
  (server as any).runtimes.set('EcommerceDemo', runtime);
  (server as any).wsManager.registerRuntime('EcommerceDemo', runtime);
  (server as any).setupMonitoring(runtime, 'EcommerceDemo');

  server.start(3000);

  await sleep(1000);

  console.log('✓ API Server démarré sur http://localhost:3000');
  console.log('✓ Dashboard disponible sur http://localhost:3000/dashboard');
  console.log('✓ Persistence activée (Event Sourcing + Snapshots)\n');

  // Create sample data
  console.log('═══ Création des données de démonstration ═══\n');

  // Create inventory items
  const laptop = runtime.createInstance('Inventory', {
    ProductId: 'LAPTOP-001',
    Name: 'Laptop Pro 15"',
    StockLevel: 50,
    Price: 1299.99,
  });

  const mouse = runtime.createInstance('Inventory', {
    ProductId: 'MOUSE-001',
    Name: 'Wireless Mouse',
    StockLevel: 200,
    Price: 29.99,
  });

  console.log('✓ Inventaire créé:');
  console.log(`  - Laptop: ${laptop}`);
  console.log(`  - Mouse: ${mouse}\n`);

  // Create orders
  const order1 = runtime.createInstance('Order', {
    Id: 'ORD-001',
    CustomerId: 'CUST-101',
    CustomerName: 'Alice Martin',
    ProductId: 'LAPTOP-001',
    Quantity: 1,
    Total: 1299.99,
    ShippingAddress: '123 Rue de la Paix, 75001 Paris, France',
  });

  const order2 = runtime.createInstance('Order', {
    Id: 'ORD-002',
    CustomerId: 'CUST-102',
    CustomerName: 'Bob Dupont',
    ProductId: 'MOUSE-001',
    Quantity: 2,
    Total: 59.98,
    ShippingAddress: '456 Avenue des Champs-Élysées, 75008 Paris, France',
  });

  const order3 = runtime.createInstance('Order', {
    Id: 'ORD-003',
    CustomerId: 'CUST-103',
    CustomerName: 'Claire Dubois',
    ProductId: 'LAPTOP-001',
    Quantity: 1,
    Total: 1299.99,
    ShippingAddress: '789 Boulevard Saint-Germain, 75006 Paris, France',
  });

  console.log('✓ Commandes créées:');
  console.log(`  - Order 1 (Alice): ${order1}`);
  console.log(`  - Order 2 (Bob): ${order2}`);
  console.log(`  - Order 3 (Claire): ${order3}\n`);

  // Process Order 1 through some transitions
  console.log('═══ Traitement de Order 1 (Alice) ═══\n');

  await runtime.sendEvent(order1, {
    type: 'VALIDATE',
    payload: { validatedBy: 'system', validatedAt: Date.now() },
    timestamp: Date.now(),
  });
  console.log('✓ Order 1: Draft → Validated');

  // Auto-transition will happen
  await sleep(100);
  console.log('✓ Order 1: Validated → PaymentPending (auto-transition)');

  await runtime.sendEvent(order1, {
    type: 'PAYMENT_RECEIVED',
    payload: {
      transactionId: 'TXN-123456',
      method: 'Credit Card',
      amount: 1299.99
    },
    timestamp: Date.now(),
  });
  console.log('✓ Order 1: PaymentPending → Confirmed\n');

  // Process Order 2 partially
  console.log('═══ Traitement de Order 2 (Bob) ═══\n');

  await runtime.sendEvent(order2, {
    type: 'VALIDATE',
    payload: { validatedBy: 'agent-007', validatedAt: Date.now() },
    timestamp: Date.now(),
  });
  console.log('✓ Order 2: Draft → Validated');

  await sleep(100);
  console.log('✓ Order 2: Validated → PaymentPending (auto-transition)\n');

  // Order 3 stays in Draft (incomplete)
  console.log('═══ Order 3 (Claire) reste en Draft ═══\n');

  // Reserve some inventory
  console.log('═══ Réservation d\'inventaire ═══\n');

  await runtime.sendEvent(laptop, {
    type: 'RESERVE',
    payload: { orderId: 'ORD-001', quantity: 1 },
    timestamp: Date.now(),
  });
  console.log('✓ Laptop: Available → Reserved\n');

  // Display instructions
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                    DASHBOARD READY                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('🌐 Ouvrez votre navigateur sur: \x1b[1;36mhttp://localhost:3000/dashboard\x1b[0m\n');

  console.log('📊 Fonctionnalités à tester:\n');
  console.log('  1. \x1b[1mVue des instances\x1b[0m');
  console.log('     → Cliquez sur une instance pour voir ses détails\n');

  console.log('  2. \x1b[1mOnglet Overview\x1b[0m');
  console.log('     → Voir l\'état actuel');
  console.log('     → Inspecter le publicMember (données métier)');
  console.log('     → Voir le context interne\n');

  console.log('  3. \x1b[1mOnglet FSM Diagram\x1b[0m');
  console.log('     → Visualiser le diagramme d\'états');
  console.log('     → État actuel surligné\n');

  console.log('  4. \x1b[1mOnglet History\x1b[0m');
  console.log('     → Timeline complète des événements');
  console.log('     → Sélectionnez Order 1 pour voir l\'historique\n');

  console.log('  5. \x1b[1mOnglet Sequence Diagram\x1b[0m');
  console.log('     → Visualisation des interactions');
  console.log('     → Basé sur l\'event sourcing\n');

  console.log('  6. \x1b[1mOnglet Actions\x1b[0m');
  console.log('     → Déclencher des transitions interactivement');
  console.log('     → Essayez de faire progresser Order 1: Confirmed → Shipped\n');

  console.log('💡 \x1b[1mActions suggérées:\x1b[0m\n');
  console.log('  → Order 1: Cliquer sur "SHIP" pour expédier');
  console.log('  → Order 2: Cliquer sur "PAYMENT_RECEIVED" pour confirmer');
  console.log('  → Order 3: Cliquer sur "VALIDATE" pour valider');
  console.log('  → Order 3: Ou cliquer sur "CANCEL" pour annuler\n');

  console.log('🔄 \x1b[1mMises à jour en temps réel:\x1b[0m');
  console.log('  → Les changements d\'état apparaissent instantanément');
  console.log('  → WebSocket connecté (voyez l\'indicateur en haut à droite)\n');

  console.log('📝 \x1b[1mPersistence:\x1b[0m');
  console.log('  → Historique complet via Event Sourcing');
  console.log('  → Snapshots tous les 2 transitions');
  console.log('  → Causality tracking pour les cascades\n');

  console.log('\x1b[33m⚠  Appuyez sur Ctrl+C pour arrêter le serveur\x1b[0m\n');

  // Keep server running
  process.on('SIGINT', () => {
    console.log('\n\n👋 Arrêt du serveur...');
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ Erreur:', error);
  process.exit(1);
});
