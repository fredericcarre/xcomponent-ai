/**
 * Cross-Component Communication Demo
 *
 * Demonstrates how multiple components communicate with each other
 * in an e-commerce workflow using ComponentRegistry.
 *
 * Scenario:
 * 1. OrderComponent - Manages customer orders
 * 2. InventoryComponent - Manages stock levels
 * 3. ShippingComponent - Manages shipment fulfillment
 *
 * Flow:
 * - Order is created
 * - Order confirmation triggers inventory reservation (cross-component)
 * - Inventory reservation triggers shipment creation (cross-component)
 * - Shipment delivery completes the order (cross-component)
 *
 * Usage:
 *   npm run build
 *   npx ts-node examples/demo-cross-component.ts
 */

import { ComponentRegistry } from '../src/component-registry';
import { FSMRuntime } from '../src/fsm-runtime';
import { Component, StateType, TransitionType } from '../src/types';

// ============================================================================
// COMPONENT DEFINITIONS
// ============================================================================

const orderComponent: Component = {
  name: 'OrderComponent',
  version: '1.0.0',
  stateMachines: [
    {
      name: 'Order',
      initialState: 'Pending',
      publicMemberType: 'Order',
      states: [
        { name: 'Pending', type: StateType.ENTRY },
        { name: 'Confirmed', type: StateType.REGULAR },
        { name: 'Shipped', type: StateType.REGULAR },
        { name: 'Delivered', type: StateType.FINAL },
        { name: 'Cancelled', type: StateType.ERROR },
      ],
      transitions: [
        {
          from: 'Pending',
          to: 'Confirmed',
          event: 'CONFIRM',
          type: TransitionType.REGULAR,
          triggeredMethod: 'onConfirmed',
          matchingRules: [{ eventProperty: 'orderId', instanceProperty: 'Id' }],
        },
        {
          from: 'Confirmed',
          to: 'Shipped',
          event: 'SHIP',
          type: TransitionType.REGULAR,
          matchingRules: [{ eventProperty: 'orderId', instanceProperty: 'Id' }],
        },
        {
          from: 'Shipped',
          to: 'Delivered',
          event: 'DELIVER',
          type: TransitionType.REGULAR,
          matchingRules: [{ eventProperty: 'orderId', instanceProperty: 'Id' }],
        },
        {
          from: 'Pending',
          to: 'Cancelled',
          event: 'CANCEL',
          type: TransitionType.REGULAR,
          matchingRules: [{ eventProperty: 'orderId', instanceProperty: 'Id' }],
        },
      ],
    },
  ],
};

const inventoryComponent: Component = {
  name: 'InventoryComponent',
  version: '1.0.0',
  stateMachines: [
    {
      name: 'Stock',
      initialState: 'Available',
      publicMemberType: 'Stock',
      states: [
        { name: 'Available', type: StateType.ENTRY },
        { name: 'Reserved', type: StateType.REGULAR },
        { name: 'OutOfStock', type: StateType.ERROR },
      ],
      transitions: [
        {
          from: 'Available',
          to: 'Reserved',
          event: 'RESERVE',
          type: TransitionType.REGULAR,
          triggeredMethod: 'onReserved',
          matchingRules: [{ eventProperty: 'productId', instanceProperty: 'Id' }],
        },
        {
          from: 'Available',
          to: 'OutOfStock',
          event: 'OUT_OF_STOCK',
          type: TransitionType.REGULAR,
          matchingRules: [{ eventProperty: 'productId', instanceProperty: 'Id' }],
        },
        {
          from: 'Reserved',
          to: 'Available',
          event: 'RELEASE',
          type: TransitionType.REGULAR,
          matchingRules: [{ eventProperty: 'productId', instanceProperty: 'Id' }],
        },
      ],
    },
  ],
};

const shippingComponent: Component = {
  name: 'ShippingComponent',
  version: '1.0.0',
  stateMachines: [
    {
      name: 'Shipment',
      initialState: 'Created',
      publicMemberType: 'Shipment',
      states: [
        { name: 'Created', type: StateType.ENTRY },
        { name: 'InTransit', type: StateType.REGULAR },
        { name: 'Delivered', type: StateType.FINAL },
      ],
      transitions: [
        {
          from: 'Created',
          to: 'InTransit',
          event: 'SHIP',
          type: TransitionType.REGULAR,
          triggeredMethod: 'onShipped',
          matchingRules: [{ eventProperty: 'shipmentId', instanceProperty: 'Id' }],
        },
        {
          from: 'InTransit',
          to: 'Delivered',
          event: 'DELIVER',
          type: TransitionType.REGULAR,
          triggeredMethod: 'onDelivered',
          matchingRules: [{ eventProperty: 'shipmentId', instanceProperty: 'Id' }],
        },
      ],
    },
  ],
};

// ============================================================================
// SETUP
// ============================================================================

async function setup() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║     Cross-Component Communication Demo                       ║');
  console.log('║     E-Commerce Workflow with Multiple Components             ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Create component registry
  const registry = new ComponentRegistry();

  // Create runtimes
  const orderRuntime = new FSMRuntime(orderComponent);
  const inventoryRuntime = new FSMRuntime(inventoryComponent);
  const shippingRuntime = new FSMRuntime(shippingComponent);

  // Register components with registry
  orderRuntime.setRegistry(registry);
  inventoryRuntime.setRegistry(registry);
  shippingRuntime.setRegistry(registry);

  registry.registerComponent(orderComponent, orderRuntime);
  registry.registerComponent(inventoryComponent, inventoryRuntime);
  registry.registerComponent(shippingComponent, shippingRuntime);

  console.log('✓ Component Registry initialized');
  console.log('✓ Registered 3 components:\n');
  console.log('  1. OrderComponent     - Manages customer orders');
  console.log('  2. InventoryComponent - Manages stock levels');
  console.log('  3. ShippingComponent  - Manages shipment fulfillment\n');

  // ============================================================================
  // EVENT LISTENERS FOR CROSS-COMPONENT COMMUNICATION
  // ============================================================================

  // When order is confirmed, reserve inventory
  orderRuntime.on('triggered_method', async (data) => {
    if (data.method === 'onConfirmed') {
      const order = data.context;
      console.log(`\n[OrderComponent] Order ${order.Id} confirmed`);
      console.log(`[OrderComponent] → Reserving inventory for product ${order.ProductId}...`);

      try {
        await data.sender.broadcastToComponent(
          'InventoryComponent',
          'Stock',
          'Available',
          {
            type: 'RESERVE',
            payload: { productId: order.ProductId, orderId: order.Id },
            timestamp: Date.now(),
          }
        );
      } catch (error) {
        console.log(`[OrderComponent] ✗ Failed to reserve inventory: ${error}`);
      }
    }
  });

  // When inventory is reserved, create shipment
  inventoryRuntime.on('triggered_method', async (data) => {
    if (data.method === 'onReserved') {
      const stock = data.context;
      const orderId = data.event.payload.orderId;
      console.log(`\n[InventoryComponent] Stock ${stock.Id} reserved`);
      console.log(`[InventoryComponent] → Creating shipment for order ${orderId}...`);

      try {
        const shipmentId = data.sender.createInstanceInComponent(
          'ShippingComponent',
          'Shipment',
          {
            Id: `SHIP-${orderId}`,
            OrderId: orderId,
            ProductId: stock.Id,
          }
        );
        console.log(`[InventoryComponent] ✓ Created shipment ${shipmentId}`);
      } catch (error) {
        console.log(`[InventoryComponent] ✗ Failed to create shipment: ${error}`);
      }
    }
  });

  // When shipment is shipped, notify order
  shippingRuntime.on('triggered_method', async (data) => {
    if (data.method === 'onShipped') {
      const shipment = data.context;
      console.log(`\n[ShippingComponent] Shipment ${shipment.Id} is now in transit`);
      console.log(`[ShippingComponent] → Updating order ${shipment.OrderId} to Shipped...`);

      try {
        await data.sender.broadcastToComponent(
          'OrderComponent',
          'Order',
          'Confirmed',
          {
            type: 'SHIP',
            payload: { orderId: shipment.OrderId },
            timestamp: Date.now(),
          }
        );
        console.log(`[ShippingComponent] ✓ Order ${shipment.OrderId} marked as Shipped`);
      } catch (error) {
        console.log(`[ShippingComponent] ✗ Failed to update order: ${error}`);
      }
    }
  });

  // When shipment is delivered, complete order
  shippingRuntime.on('triggered_method', async (data) => {
    if (data.method === 'onDelivered') {
      const shipment = data.context;
      console.log(`\n[ShippingComponent] Shipment ${shipment.Id} delivered`);
      console.log(`[ShippingComponent] → Completing order ${shipment.OrderId}...`);

      try {
        await data.sender.broadcastToComponent(
          'OrderComponent',
          'Order',
          'Shipped',
          {
            type: 'DELIVER',
            payload: { orderId: shipment.OrderId },
            timestamp: Date.now(),
          }
        );
        console.log(`[ShippingComponent] ✓ Order ${shipment.OrderId} completed`);
      } catch (error) {
        console.log(`[ShippingComponent] ✗ Failed to complete order: ${error}`);
      }
    }
  });

  return { registry, orderRuntime, inventoryRuntime, shippingRuntime };
}

// ============================================================================
// DEMO WORKFLOW
// ============================================================================

async function runDemo() {
  const { registry, orderRuntime, inventoryRuntime, shippingRuntime } = await setup();

  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('Demo: Processing E-Commerce Order\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Create product in inventory
  console.log('[Setup] Creating product in inventory...');
  const productId = inventoryRuntime.createInstance('Stock', {
    Id: 'PROD-001',
    Name: 'MacBook Pro 16"',
    Quantity: 10,
  });
  console.log(`[Setup] ✓ Created product ${productId}\n`);

  // Create order
  console.log('[Customer] Placing order...');
  const orderId = orderRuntime.createInstance('Order', {
    Id: 'ORD-001',
    CustomerId: 'CUST-001',
    ProductId: 'PROD-001',
    Quantity: 1,
    Total: 2499.99,
  });
  console.log(`[Customer] ✓ Created order ${orderId}\n`);

  // Wait a bit to let async operations complete
  await new Promise(resolve => setTimeout(resolve, 100));

  // Confirm order (triggers cross-component cascade)
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('[Action] Confirming order...');
  console.log('═══════════════════════════════════════════════════════════════');

  await orderRuntime.broadcastEvent('Order', 'Pending', {
    type: 'CONFIRM',
    payload: { orderId: 'ORD-001' },
    timestamp: Date.now(),
  });

  // Wait for cross-component communication
  await new Promise(resolve => setTimeout(resolve, 200));

  // Get shipment ID
  const shipments = shippingRuntime.getAllInstances();
  const shipmentId = shipments.length > 0 ? shipments[0].context.Id : null;

  if (shipmentId) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[Action] Shipping order...');
    console.log('═══════════════════════════════════════════════════════════════');

    await shippingRuntime.broadcastEvent('Shipment', 'Created', {
      type: 'SHIP',
      payload: { shipmentId },
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('[Action] Delivering order...');
    console.log('═══════════════════════════════════════════════════════════════');

    await shippingRuntime.broadcastEvent('Shipment', 'InTransit', {
      type: 'DELIVER',
      payload: { shipmentId },
      timestamp: Date.now(),
    });

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // ============================================================================
  // FINAL STATE
  // ============================================================================

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Final State');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const stats = registry.getStats();
  console.log(`Components: ${stats.componentCount}`);
  console.log(`Total Instances: ${stats.totalInstances}`);
  console.log(`Total State Machines: ${stats.totalMachines}\n`);

  stats.components.forEach(comp => {
    console.log(`${comp.name}:`);
    console.log(`  - Instances: ${comp.instances}`);
    console.log(`  - Machines: ${comp.machines}`);
  });

  console.log('\nInstance States:');
  const allInstances = registry.getAllInstances();
  allInstances.forEach(({ instance, componentName }) => {
    const displayId = instance.publicMember?.Id || instance.context.Id || instance.id;
    console.log(`  - [${componentName}] ${displayId}: ${instance.currentState}`);
  });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('Key Observations:');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('✓ Cross-component event routing via ComponentRegistry');
  console.log('✓ Sender interface enables components to communicate');
  console.log('✓ Automatic workflow coordination across 3 components');
  console.log('✓ Type-safe cross-component instance creation');
  console.log('✓ Event causality preserved across component boundaries\n');

  console.log('Cross-Component Methods Used:');
  console.log('  - sender.broadcastToComponent() - Route events to other components');
  console.log('  - sender.createInstanceInComponent() - Create instances in other components');
  console.log('  - registry.getAllInstances() - Query all instances across components');
  console.log('  - registry.getStats() - Get system-wide statistics\n');

  // Cleanup
  registry.dispose();

  console.log('✓ Demo completed successfully\n');
}

// Run demo
runDemo().catch(console.error);
