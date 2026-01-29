# Next.js Integration Guide

This guide shows how to integrate xcomponent-ai with Next.js 14+ (App Router).

## Quick Start

### 1. Install Dependencies

```bash
npm install xcomponent-ai js-yaml redis
```

### 2. Configure Next.js

Add xcomponent-ai to external packages in `next.config.mjs`:

```javascript
// next.config.mjs
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['xcomponent-ai', 'redis']
  }
};

export default nextConfig;
```

### 3. Create Runtime Wrapper

Create `src/lib/xcomponent-runtime.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// Instance mapping: entityType:entityId -> xcomponent instanceId
const instanceMap = new Map<string, string>();

// Singleton state
let runtime: any = null;
let broadcaster: any = null;
let initPromise: Promise<void> | null = null;

async function initRuntime(): Promise<void> {
  if (runtime) return;

  const brokerUrl = process.env.BROKER_URL || 'memory';
  const componentPath = path.join(process.cwd(), 'fsm', 'component.yaml');

  console.log('[XComponent] Initializing runtime...');

  // Load component YAML
  const componentYaml = fs.readFileSync(componentPath, 'utf-8');
  const component = yaml.load(componentYaml);

  // Dynamic import (required for Next.js)
  const xcomponent = await import('xcomponent-ai');

  // Optional: Redis persistence for audit trail
  let eventStore, snapshotStore;
  if (brokerUrl.startsWith('redis://')) {
    try {
      const stores = await xcomponent.createRedisStores({
        url: brokerUrl,
        keyPrefix: 'myapp'
      });
      eventStore = stores.eventStore;
      snapshotStore = stores.snapshotStore;
      console.log('[XComponent] Redis persistence enabled');
    } catch (err) {
      console.warn('[XComponent] Redis persistence failed, continuing without');
    }
  }

  // Create runtime
  runtime = new xcomponent.FSMRuntime(component, {
    eventSourcing: !!eventStore,
    snapshots: !!snapshotStore,
    eventStore,
    snapshotStore
  });

  // Register business logic
  registerBusinessLogic(runtime);

  // Connect to broker for dashboard
  if (brokerUrl !== 'memory') {
    broadcaster = await xcomponent.createRuntimeBroadcaster(
      runtime, component, brokerUrl,
      { host: 'nextjs-app', port: 3000 }
    );
    console.log(`[XComponent] Broadcasting as ${broadcaster.getRuntimeId()}`);
  }

  console.log('[XComponent] Runtime ready!');
}

function registerBusinessLogic(rt: any): void {
  rt.on('triggered_method', async ({ method, event, context, sender }: any) => {
    const payload = event?.payload || {};

    switch (method) {
      case 'onItemAdded':
        if (payload.newItemCount !== undefined) {
          sender.updateContext({
            itemCount: payload.newItemCount,
            total: payload.newTotal
          });
        }
        break;
      // Add more handlers...
    }
  });
}

export async function getRuntime() {
  if (!initPromise) {
    initPromise = initRuntime();
  }
  await initPromise;
  return runtime;
}

export async function createInstance(
  machineName: string,
  entityType: string,
  entityId: string,
  context: Record<string, unknown>,
  initialState?: string
): Promise<string | null> {
  const rt = await getRuntime();
  if (!rt) return null;

  const instanceId = rt.createInstance(machineName, context);
  instanceMap.set(`${entityType}:${entityId}`, instanceId);

  // Restore state for existing entities
  if (initialState) {
    const instance = rt.getInstance(instanceId);
    if (instance && instance.currentState !== initialState) {
      (instance as any).currentState = initialState;
    }
  }

  return instanceId;
}

export function getInstanceId(entityType: string, entityId: string): string | null {
  return instanceMap.get(`${entityType}:${entityId}`) || null;
}

export async function sendEventToEntity(
  entityType: string,
  entityId: string,
  eventType: string,
  payload?: unknown
): Promise<{ success: boolean; newState?: string; error?: string }> {
  const rt = await getRuntime();
  if (!rt) return { success: false, error: 'Runtime not available' };

  const instanceId = getInstanceId(entityType, entityId);
  if (!instanceId) {
    return { success: false, error: `No instance for ${entityType}:${entityId}` };
  }

  try {
    await rt.sendEvent(instanceId, { type: eventType, payload });
    const instance = rt.getInstance(instanceId);
    return { success: true, newState: instance?.currentState };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export default {
  getRuntime,
  createInstance,
  getInstanceId,
  sendEventToEntity
};
```

### 4. Create Component YAML

Create `fsm/component.yaml`:

```yaml
name: MyComponent
version: 1.0.0

entryMachine: Cart
entryMachineMode: multiple
autoCreateEntryPoint: false

stateMachines:
  - name: Cart
    initialState: Empty

    contextSchema:
      cartId: { type: text, required: true }
      itemCount: { type: number, default: 0 }
      total: { type: number, default: 0 }

    states:
      - name: Empty
        type: entry
      - name: Active
        type: regular
      - name: CheckingOut
        type: regular
      - name: Converted
        type: final

    transitions:
      - from: Empty
        to: Active
        event: ADD_ITEM
        triggeredMethod: onItemAdded
      - from: Active
        to: Active
        event: ADD_ITEM
        triggeredMethod: onItemAdded
      - from: Active
        to: CheckingOut
        event: CHECKOUT
      - from: CheckingOut
        to: Converted
        event: COMPLETE
```

### 5. Use in API Routes

```typescript
// app/api/cart/route.ts
import { NextRequest, NextResponse } from 'next/server';
import xcomponent from '@/lib/xcomponent-runtime';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get('session_id')?.value || 'anonymous';

  let cart = await db.cart.findUnique({ where: { sessionId } });

  if (!cart) {
    cart = await db.cart.create({ data: { sessionId, state: 'Empty' } });
  }

  // Ensure xcomponent instance exists
  if (!xcomponent.getInstanceId('cart', cart.id)) {
    await xcomponent.createInstance('Cart', 'cart', cart.id, {
      cartId: cart.id,
      itemCount: cart.items?.length || 0,
      total: cart.total || 0
    }, cart.state);
  }

  return NextResponse.json({ success: true, data: cart });
}

export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get('session_id')?.value || 'anonymous';
  const body = await request.json();

  const cart = await db.cart.findUnique({ where: { sessionId } });
  if (!cart) {
    return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
  }

  // Send event to xcomponent
  const result = await xcomponent.sendEventToEntity('cart', cart.id, body.event, body.payload);

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // Update database
  await db.cart.update({
    where: { id: cart.id },
    data: { state: result.newState }
  });

  return NextResponse.json({ success: true, newState: result.newState });
}
```

### 6. Docker Compose for Development

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - BROKER_URL=redis://redis:6379
    depends_on:
      redis:
        condition: service_healthy

  dashboard:
    image: node:20-alpine
    ports:
      - "4000:4000"
    environment:
      - BROKER_URL=redis://redis:6379
      - PORT=4000
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./fsm:/app/fsm:ro
      - ./scripts/dashboard-server.js:/app/dashboard-server.js:ro
    working_dir: /app
    command: sh -c "npm install xcomponent-ai yaml && node dashboard-server.js"
```

## Common Issues

### "Cannot find module 'xcomponent-ai'"

Add to `next.config.mjs`:
```javascript
serverComponentsExternalPackages: ['xcomponent-ai', 'redis']
```

### Hot Reload Creates New Runtime

Use the singleton pattern shown above with `initPromise`.

### State Mismatch After Restart

Always pass `initialState` when creating instances for existing entities.

## Full Example

See [examples/nextjs-ecommerce](./examples/nextjs-ecommerce/) for a complete e-commerce implementation.
