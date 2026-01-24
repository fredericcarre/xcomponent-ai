# Distributed Multi-Process Demo

This demo shows how to run xcomponent-ai components in **separate processes** communicating via **Redis Pub/Sub**.

## Architecture

```
┌─────────────────────┐         Redis         ┌─────────────────────┐
│   Process 1         │         Pub/Sub       │   Process 2         │
│                     │                       │                     │
│  OrderComponent     │──────────────────────▶│  PaymentComponent   │
│  Port: 3001         │   PROCESS event       │  Port: 3002         │
│                     │                       │                     │
│  Order FSM          │                       │  Payment FSM        │
│  - Created          │                       │  - Pending          │
│  - Validated ───────┼───────────────────────┼──▶ Processing       │
│  - Completed        │                       │  - Completed        │
└─────────────────────┘                       └─────────────────────┘
```

**How it works:**
1. Process 1 (OrderComponent) runs on port 3001
2. Process 2 (PaymentComponent) runs on port 3002
3. When Order transitions to "Validated", it publishes a message to Redis
4. PaymentComponent receives the message via Redis and triggers the transition

## Prerequisites

1. **Install Redis:**
   ```bash
   # macOS
   brew install redis
   brew services start redis

   # Ubuntu/Debian
   sudo apt-get install redis-server
   sudo systemctl start redis

   # Docker
   docker run -d -p 6379:6379 redis:7-alpine
   ```

2. **Verify Redis is running:**
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

3. **Install xcomponent-ai with Redis support:**
   ```bash
   npm install -g xcomponent-ai redis
   ```

## Running the Demo

### Step 1: Start Process 1 (OrderComponent)

In **Terminal 1:**
```bash
xcomponent-ai serve examples/distributed-demo/order.yaml \
  --port 3001 \
  --broker redis://localhost:6379
```

Expected output:
```
📡 Mode: Distributed (broker: redis://localhost:6379)
🚀 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Component: OrderComponent
   Machines:
   - Order (3 states, 3 transitions)

🌐 API Server:    http://localhost:3001
📊 Dashboard:     http://localhost:3001/dashboard.html
```

### Step 2: Start Process 2 (PaymentComponent)

In **Terminal 2:**
```bash
xcomponent-ai serve examples/distributed-demo/payment.yaml \
  --port 3002 \
  --broker redis://localhost:6379
```

Expected output:
```
📡 Mode: Distributed (broker: redis://localhost:6379)
🚀 xcomponent-ai Runtime Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Component: PaymentComponent
   Machines:
   - Payment (4 states, 3 transitions)

🌐 API Server:    http://localhost:3002
📊 Dashboard:     http://localhost:3002/dashboard.html
```

### Step 3: Test Cross-Process Communication

In **Terminal 3:**

1. **Create a Payment instance in Process 2:**
   ```bash
   curl -X POST http://localhost:3002/api/components/PaymentComponent/instances \
     -H "Content-Type: application/json" \
     -d '{
       "machineName": "Payment",
       "context": {
         "orderId": "ORD-001",
         "amount": 1000,
         "customerId": "CUST-001"
       }
     }'
   ```

   Note the `instanceId` returned (e.g., `abc-123-def-456`).

2. **Create an Order instance in Process 1:**
   ```bash
   curl -X POST http://localhost:3001/api/components/OrderComponent/instances \
     -H "Content-Type: application/json" \
     -d '{
       "machineName": "Order",
       "context": {
         "orderId": "ORD-001",
         "amount": 1000,
         "customerId": "CUST-001"
       }
     }'
   ```

   Note the `instanceId` returned (e.g., `xyz-789-uvw-012`).

3. **Trigger VALIDATE on Order (Process 1):**
   ```bash
   ORDER_ID="xyz-789-uvw-012"  # Replace with actual ID from step 2

   curl -X POST http://localhost:3001/api/instances/$ORDER_ID/events \
     -H "Content-Type: application/json" \
     -d '{
       "type": "VALIDATE"
     }'
   ```

4. **Verify Payment transitioned in Process 2:**
   ```bash
   PAYMENT_ID="abc-123-def-456"  # Replace with actual ID from step 1

   curl http://localhost:3002/api/instances/$PAYMENT_ID
   ```

   You should see the Payment instance now in `Processing` state!

### Step 4: Observe Cross-Process Communication

**In Terminal 1 (OrderComponent):**
You'll see:
```
[2:34:01 PM] [OrderComponent] xyz-789-uvw-012: Created → Validated (event: VALIDATE)
```

**In Terminal 2 (PaymentComponent):**
You'll see:
```
[2:34:01 PM] [PaymentComponent] abc-123-def-456: Pending → Processing (event: PROCESS)
```

**Magic!** The Order in Process 1 triggered the Payment in Process 2 via Redis Pub/Sub! 🎉

## Viewing Dashboards

Open in your browser:
- **Process 1 Dashboard:** http://localhost:3001/dashboard.html
- **Process 2 Dashboard:** http://localhost:3002/dashboard.html

You can see real-time state transitions in both processes independently.

## Scaling Up

You can run **multiple instances** of each process for load balancing:

```bash
# 2 instances of OrderComponent
xcomponent-ai serve order.yaml --port 3001 --broker redis://localhost:6379 &
xcomponent-ai serve order.yaml --port 3011 --broker redis://localhost:6379 &

# 3 instances of PaymentComponent
xcomponent-ai serve payment.yaml --port 3002 --broker redis://localhost:6379 &
xcomponent-ai serve payment.yaml --port 3012 --broker redis://localhost:6379 &
xcomponent-ai serve payment.yaml --port 3022 --broker redis://localhost:6379 &

# Add nginx load balancer in front
```

All instances subscribe to the same Redis channels, enabling **horizontal scaling**.

## Environment Variable

Instead of `--broker` flag, you can use:

```bash
export XCOMPONENT_BROKER_URL=redis://localhost:6379

xcomponent-ai serve order.yaml --port 3001
xcomponent-ai serve payment.yaml --port 3002
```

## Production Deployment

For production, use:
- **Redis Cluster** for high availability
- **Redis Sentinel** for automatic failover
- **Kubernetes** for orchestration
- **Load balancer** (nginx, HAProxy) for API endpoints

See [SCALABILITY.md](../../SCALABILITY.md) for detailed production patterns.

## Switching Back to In-Memory

To run both components in a **single process** (in-memory mode):

```bash
xcomponent-ai serve \
  examples/distributed-demo/order.yaml \
  examples/distributed-demo/payment.yaml \
  --port 3000
  # No --broker flag = in-memory mode by default
```

**Zero code changes!** Just configuration. 🚀
