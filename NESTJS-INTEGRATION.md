# NestJS Integration Guide

This guide shows how to integrate xcomponent-ai with NestJS.

## Quick Start

### 1. Install Dependencies

```bash
npm install xcomponent-ai js-yaml redis
```

### 2. Create XComponent Module

```typescript
// src/xcomponent/xcomponent.module.ts
import { Module, Global } from '@nestjs/common';
import { XComponentService } from './xcomponent.service';

@Global()
@Module({
  providers: [XComponentService],
  exports: [XComponentService],
})
export class XComponentModule {}
```

### 3. Create XComponent Service

```typescript
// src/xcomponent/xcomponent.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

@Injectable()
export class XComponentService implements OnModuleInit, OnModuleDestroy {
  private runtime: any = null;
  private broadcaster: any = null;
  private instanceMap = new Map<string, string>();

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.initRuntime();
  }

  async onModuleDestroy() {
    if (this.broadcaster) {
      await this.broadcaster.disconnect();
    }
  }

  private async initRuntime(): Promise<void> {
    const brokerUrl = this.configService.get('BROKER_URL', 'memory');
    const componentPath = path.join(process.cwd(), 'fsm', 'component.yaml');

    console.log('[XComponent] Initializing runtime...');

    // Load component YAML
    const componentYaml = fs.readFileSync(componentPath, 'utf-8');
    const component = yaml.load(componentYaml);

    // Dynamic import
    const xcomponent = await import('xcomponent-ai');

    // Optional: Redis persistence
    let eventStore, snapshotStore;
    if (brokerUrl.startsWith('redis://')) {
      try {
        const stores = await xcomponent.createRedisStores({
          url: brokerUrl,
          keyPrefix: this.configService.get('XCOMPONENT_PREFIX', 'nestjs'),
        });
        eventStore = stores.eventStore;
        snapshotStore = stores.snapshotStore;
        console.log('[XComponent] Redis persistence enabled');
      } catch (err) {
        console.warn('[XComponent] Redis persistence failed');
      }
    }

    // Create runtime
    this.runtime = new xcomponent.FSMRuntime(component, {
      eventSourcing: !!eventStore,
      snapshots: !!snapshotStore,
      eventStore,
      snapshotStore,
      snapshotInterval: 5,
    });

    // Register business logic
    this.registerBusinessLogic();

    // Connect to broker
    if (brokerUrl !== 'memory') {
      this.broadcaster = await xcomponent.createRuntimeBroadcaster(
        this.runtime,
        component,
        brokerUrl,
        { host: 'nestjs-app', port: 3000 },
      );
      console.log(`[XComponent] Broadcasting as ${this.broadcaster.getRuntimeId()}`);
    }

    console.log('[XComponent] Runtime ready!');
  }

  private registerBusinessLogic(): void {
    this.runtime.on('triggered_method', async ({ method, event, context, sender }: any) => {
      const payload = event?.payload || {};

      switch (method) {
        case 'onOrderValidated':
          console.log(`Order ${context.orderId} validated`);
          break;
        case 'onPaymentReceived':
          console.log(`Payment received for order ${context.orderId}`);
          break;
        case 'onOrderShipped':
          const trackingNumber = `TRK-${Date.now().toString(36).toUpperCase()}`;
          sender.updateContext({ trackingNumber });
          break;
        // Add more handlers...
      }
    });
  }

  getRuntime() {
    return this.runtime;
  }

  async createInstance(
    machineName: string,
    entityType: string,
    entityId: string,
    context: Record<string, unknown>,
    initialState?: string,
  ): Promise<string | null> {
    if (!this.runtime) return null;

    const instanceId = this.runtime.createInstance(machineName, context);
    this.instanceMap.set(`${entityType}:${entityId}`, instanceId);

    // Restore state for existing entities
    if (initialState) {
      const instance = this.runtime.getInstance(instanceId);
      if (instance && instance.currentState !== initialState) {
        (instance as any).currentState = initialState;
      }
    }

    return instanceId;
  }

  getInstanceId(entityType: string, entityId: string): string | null {
    return this.instanceMap.get(`${entityType}:${entityId}`) || null;
  }

  async sendEvent(
    entityType: string,
    entityId: string,
    eventType: string,
    payload?: unknown,
  ): Promise<{ success: boolean; newState?: string; error?: string }> {
    if (!this.runtime) {
      return { success: false, error: 'Runtime not available' };
    }

    const instanceId = this.getInstanceId(entityType, entityId);
    if (!instanceId) {
      return { success: false, error: `No instance for ${entityType}:${entityId}` };
    }

    try {
      await this.runtime.sendEvent(instanceId, { type: eventType, payload });
      const instance = this.runtime.getInstance(instanceId);
      return { success: true, newState: instance?.currentState };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async ensureInstance(
    machineName: string,
    entityType: string,
    entityId: string,
    context: Record<string, unknown>,
    currentState: string,
  ): Promise<string> {
    let instanceId = this.getInstanceId(entityType, entityId);
    if (!instanceId) {
      instanceId = await this.createInstance(
        machineName,
        entityType,
        entityId,
        context,
        currentState,
      );
    }
    return instanceId!;
  }
}
```

### 4. Use in Services

```typescript
// src/orders/orders.service.ts
import { Injectable } from '@nestjs/common';
import { XComponentService } from '../xcomponent/xcomponent.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(
    private xcomponent: XComponentService,
    private prisma: PrismaService,
  ) {}

  async createOrder(data: CreateOrderDto) {
    // Create in database
    const order = await this.prisma.order.create({
      data: {
        ...data,
        state: 'Created',
      },
    });

    // Create xcomponent instance
    await this.xcomponent.createInstance('Order', 'order', order.id, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      total: order.total,
    });

    return order;
  }

  async validateOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('Order not found');

    // Ensure instance exists (handles restart)
    await this.xcomponent.ensureInstance('Order', 'order', order.id, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerEmail: order.customerEmail,
      total: order.total,
    }, order.state);

    // Send event
    const result = await this.xcomponent.sendEvent('order', orderId, 'VALIDATE');
    if (!result.success) {
      throw new Error(result.error);
    }

    // Update database
    return this.prisma.order.update({
      where: { id: orderId },
      data: { state: result.newState },
    });
  }

  async shipOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new Error('Order not found');

    await this.xcomponent.ensureInstance('Order', 'order', order.id, {
      orderId: order.id,
      total: order.total,
    }, order.state);

    const result = await this.xcomponent.sendEvent('order', orderId, 'SHIP');
    if (!result.success) {
      throw new Error(result.error);
    }

    // Get tracking number from xcomponent context
    const instanceId = this.xcomponent.getInstanceId('order', orderId);
    const instance = this.xcomponent.getRuntime().getInstance(instanceId);
    const trackingNumber = instance?.context?.trackingNumber;

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        state: result.newState,
        trackingNumber,
      },
    });
  }
}
```

### 5. Use in Controllers

```typescript
// src/orders/orders.controller.ts
import { Controller, Post, Param, Body } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Post()
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.ordersService.createOrder(createOrderDto);
  }

  @Post(':id/validate')
  validate(@Param('id') id: string) {
    return this.ordersService.validateOrder(id);
  }

  @Post(':id/ship')
  ship(@Param('id') id: string) {
    return this.ordersService.shipOrder(id);
  }
}
```

### 6. App Module Setup

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { XComponentModule } from './xcomponent/xcomponent.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    XComponentModule,
    OrdersModule,
  ],
})
export class AppModule {}
```

### 7. Environment Variables

```bash
# .env
BROKER_URL=redis://localhost:6379
XCOMPONENT_PREFIX=myapp
```

## Testing

```typescript
// src/orders/orders.service.spec.ts
import { Test } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { XComponentService } from '../xcomponent/xcomponent.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let xcomponent: XComponentService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: XComponentService,
          useValue: {
            createInstance: jest.fn().mockResolvedValue('instance-123'),
            sendEvent: jest.fn().mockResolvedValue({ success: true, newState: 'Validated' }),
            ensureInstance: jest.fn().mockResolvedValue('instance-123'),
            getInstanceId: jest.fn().mockReturnValue('instance-123'),
          },
        },
        // ... other providers
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    xcomponent = module.get<XComponentService>(XComponentService);
  });

  it('should validate order', async () => {
    const result = await service.validateOrder('order-123');
    expect(xcomponent.sendEvent).toHaveBeenCalledWith('order', 'order-123', 'VALIDATE');
  });
});
```

## Docker Compose

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - BROKER_URL=redis://redis:6379
      - XCOMPONENT_PREFIX=nestjs
    depends_on:
      - redis

  dashboard:
    image: node:20-alpine
    ports:
      - "4000:4000"
    environment:
      - BROKER_URL=redis://redis:6379
    volumes:
      - ./fsm:/app/fsm:ro
    command: npx xcomponent-ai serve /app/fsm/component.yaml --port 4000 --broker redis://redis:6379
```

## Full Example

See [examples/nestjs-orders](./examples/nestjs-orders/) for a complete implementation.
