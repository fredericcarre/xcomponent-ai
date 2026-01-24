# 🌐 External Broker API Guide

This guide explains how to interact with xcomponent-ai from **any programming language** using the message broker (Redis), without needing HTTP API access.

## 📋 Table of Contents

- [Overview](#overview)
- [Sending Events to FSMs](#sending-events-to-fsms)
- [Subscribing to FSM Events](#subscribing-to-fsm-events)
- [Channel Reference](#channel-reference)
- [Examples by Language](#examples-by-language)

---

## Overview

The External Broker API allows you to:
1. **Send events to FSM instances** from any system via message broker
2. **Subscribe to FSM state changes** in real-time from external applications
3. **Language-agnostic integration** (Python, Go, Java, Ruby, Rust, etc.)

### Architecture

```
┌─────────────────┐         Redis Pub/Sub         ┌─────────────────┐
│   Your App      │                               │ xcomponent-ai   │
│   (Python/Go/   │──────────────────────────────▶│   Runtime       │
│    Java/etc.)   │   Send events via broker      │                 │
│                 │                               │                 │
│                 │◀──────────────────────────────│  Publish state  │
│                 │   Subscribe to FSM events     │    changes      │
└─────────────────┘                               └─────────────────┘
```

**No HTTP needed!** Just publish/subscribe to Redis channels.

---

## Sending Events to FSMs

### Enable External Commands

Start xcomponent-ai with the `--external-api` flag:

```bash
xcomponent-ai serve order.yaml \
  --port 3000 \
  --broker redis://localhost:6379 \
  --external-api
```

### Send Event to Specific Instance

**Channel:** `xcomponent:external:commands`

**Message format:**
```json
{
  "componentName": "OrderComponent",
  "instanceId": "abc-123-def-456",
  "event": {
    "type": "VALIDATE",
    "payload": {
      "approvedBy": "user@example.com"
    },
    "timestamp": 1706280000000
  }
}
```

### Broadcast Event to Instances in a State

**Channel:** `xcomponent:external:broadcasts`

#### Broadcast to ALL instances (no filters)

```json
{
  "componentName": "OrderComponent",
  "machineName": "Order",
  "currentState": "Pending",
  "event": {
    "type": "TIMEOUT",
    "payload": {},
    "timestamp": 1706280000000
  }
}
```

This sends `TIMEOUT` to **ALL** Order instances in `Pending` state.

#### Broadcast to specific instances (with property filters)

**Target a single customer:**
```json
{
  "componentName": "OrderComponent",
  "machineName": "Order",
  "currentState": "Pending",
  "filters": [
    {
      "property": "customerId",
      "operator": "===",
      "value": "CUST-001"
    }
  ],
  "event": {
    "type": "TIMEOUT"
  }
}
```

Sends `TIMEOUT` only to Orders with `customerId === "CUST-001"`.

**Multiple filters (AND logic):**
```json
{
  "componentName": "OrderComponent",
  "machineName": "Order",
  "currentState": "Pending",
  "filters": [
    {
      "property": "customerId",
      "value": "CUST-001"
    },
    {
      "property": "amount",
      "operator": ">",
      "value": 1000
    }
  ],
  "event": {
    "type": "URGENT_REVIEW"
  }
}
```

Sends `URGENT_REVIEW` to Orders with `customerId === "CUST-001"` **AND** `amount > 1000`.

**Nested properties:**
```json
{
  "filters": [
    {
      "property": "customer.tier",
      "value": "premium"
    }
  ]
}
```

**✅ Can target a single instance** if filters are specific enough!

**Supported operators:**
- `===` (equal, default)
- `!==` (not equal)
- `>` (greater than)
- `<` (less than)
- `>=` (greater or equal)
- `<=` (less or equal)

---

## Subscribing to FSM Events

### Enable Event Publishing

Start xcomponent-ai with event publishing enabled:

```bash
xcomponent-ai serve order.yaml \
  --port 3000 \
  --broker redis://localhost:6379 \
  --publish-events
```

### Available Event Channels

| Channel | Description |
|---------|-------------|
| `xcomponent:events:state_change` | State transitions (e.g., Pending → Validated) |
| `xcomponent:events:instance_created` | New FSM instances created |
| `xcomponent:events:instance_disposed` | FSM instances disposed |
| `xcomponent:events:instance_error` | Errors in FSM instances |
| `xcomponent:events:cross_component_cascade` | Cross-component cascades triggered |

### Event Message Format

#### state_change Event

Emitted when an instance transitions between states.

```json
{
  "type": "state_change",
  "componentName": "OrderComponent",
  "data": {
    "instanceId": "abc-123",
    "machineName": "Order",
    "previousState": "Pending",
    "newState": "Validated",
    "event": {
      "type": "VALIDATE",
      "payload": {
        "approvedBy": "user@example.com"
      }
    },
    "eventId": "evt-456",
    "timestamp": 1706280000000,
    "instance": {
      "id": "abc-123",
      "machineName": "Order",
      "currentState": "Validated",
      "context": {
        "orderId": "ORD-001",
        "amount": 1000,
        "customerId": "CUST-001",
        "approvedBy": "user@example.com"
      },
      "publicMember": {
        "status": "validated",
        "totalAmount": 1000
      },
      "status": "active",
      "createdAt": 1706279000000,
      "updatedAt": 1706280000000
    }
  },
  "timestamp": 1706280000000
}
```

**Key fields:**
- ✅ `componentName` - Component name (e.g., "OrderComponent")
- ✅ `data.machineName` - State machine name (e.g., "Order")
- ✅ `data.instanceId` - Instance ID
- ✅ `data.instance` - **Complete instance object** with:
  - `context` - Full instance context (business data)
  - `publicMember` - Public member data (if defined in YAML)
  - `currentState` - Current state after transition
  - `status` - Instance status (active, completed, error)
  - `createdAt`, `updatedAt` - Timestamps

#### instance_created Event

```json
{
  "type": "instance_created",
  "componentName": "OrderComponent",
  "data": {
    "id": "abc-123",
    "machineName": "Order",
    "currentState": "Created",
    "context": {
      "orderId": "ORD-001",
      "amount": 1000
    },
    "publicMember": {},
    "status": "active",
    "createdAt": 1706279000000,
    "updatedAt": 1706279000000
  },
  "timestamp": 1706279000000
}
```

#### instance_disposed Event

```json
{
  "type": "instance_disposed",
  "componentName": "OrderComponent",
  "data": {
    "id": "abc-123",
    "machineName": "Order",
    "currentState": "Completed",
    "context": {
      "orderId": "ORD-001",
      "amount": 1000
    },
    "status": "completed",
    "createdAt": 1706279000000,
    "updatedAt": 1706280000000
  },
  "timestamp": 1706280000000
}
```

#### instance_error Event

```json
{
  "type": "instance_error",
  "componentName": "OrderComponent",
  "data": {
    "instanceId": "abc-123",
    "machineName": "Order",
    "error": "Guard validation failed",
    "instance": {
      "id": "abc-123",
      "machineName": "Order",
      "currentState": "Pending",
      "context": {
        "orderId": "ORD-001"
      },
      "status": "error"
    }
  },
  "timestamp": 1706280000000
}
```

---

## Channel Reference

### Commands (Publish to these)

| Channel | Purpose | Message Type |
|---------|---------|--------------|
| `xcomponent:external:commands` | Send event to specific instance | `ExternalCommand` |
| `xcomponent:external:broadcasts` | Broadcast event to instances in state | `ExternalBroadcastCommand` |

### Events (Subscribe to these)

| Channel | Purpose | Message Type |
|---------|---------|--------------|
| `xcomponent:events:state_change` | State transitions | `PublishedFSMEvent` |
| `xcomponent:events:instance_created` | Instance creations | `PublishedFSMEvent` |
| `xcomponent:events:instance_disposed` | Instance disposals | `PublishedFSMEvent` |
| `xcomponent:events:instance_error` | Instance errors | `PublishedFSMEvent` |
| `xcomponent:events:cross_component_cascade` | Cross-component cascades | `PublishedFSMEvent` |

---

## Examples by Language

### Node.js / TypeScript

```typescript
import { createClient } from 'redis';

// Connect to Redis
const redis = createClient({ url: 'redis://localhost:6379' });
await redis.connect();

// Send event to instance
await redis.publish('xcomponent:external:commands', JSON.stringify({
  componentName: 'OrderComponent',
  instanceId: 'order-123',
  event: {
    type: 'VALIDATE',
    payload: { approvedBy: 'alice@example.com' },
    timestamp: Date.now()
  }
}));

// Broadcast to all instances in a state
await redis.publish('xcomponent:external:broadcasts', JSON.stringify({
  componentName: 'OrderComponent',
  machineName: 'Order',
  currentState: 'Pending',
  event: { type: 'TIMEOUT', timestamp: Date.now() }
}));

// Broadcast with property filters (target specific customer)
await redis.publish('xcomponent:external:broadcasts', JSON.stringify({
  componentName: 'OrderComponent',
  machineName: 'Order',
  currentState: 'Pending',
  filters: [
    { property: 'customerId', value: 'CUST-001' },
    { property: 'amount', operator: '>', value: 1000 }
  ],
  event: { type: 'URGENT_REVIEW', timestamp: Date.now() }
}));

// Subscribe to state changes
const subscriber = redis.duplicate();
await subscriber.connect();

await subscriber.subscribe('xcomponent:events:state_change', (message) => {
  const event = JSON.parse(message);
  console.log(`State changed: ${event.data.previousState} → ${event.data.newState}`);
});
```

### Python

```python
import redis
import json
import time

# Connect to Redis
r = redis.Redis(host='localhost', port=6379, decode_responses=True)

# Send event to instance
command = {
    'componentName': 'OrderComponent',
    'instanceId': 'order-123',
    'event': {
        'type': 'VALIDATE',
        'payload': {'approvedBy': 'alice@example.com'},
        'timestamp': int(time.time() * 1000)
    }
}
r.publish('xcomponent:external:commands', json.dumps(command))

# Broadcast with property filters
broadcast = {
    'componentName': 'OrderComponent',
    'machineName': 'Order',
    'currentState': 'Pending',
    'filters': [
        {'property': 'customerId', 'value': 'CUST-001'},
        {'property': 'amount', 'operator': '>', 'value': 1000}
    ],
    'event': {'type': 'URGENT_REVIEW', 'timestamp': int(time.time() * 1000)}
}
r.publish('xcomponent:external:broadcasts', json.dumps(broadcast))

# Subscribe to state changes
pubsub = r.pubsub()
pubsub.subscribe('xcomponent:events:state_change')

for message in pubsub.listen():
    if message['type'] == 'message':
        event = json.loads(message['data'])
        prev = event['data']['previousState']
        new = event['data']['newState']
        print(f"State changed: {prev} → {new}")
```

### Go

```go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "time"

    "github.com/redis/go-redis/v9"
)

func main() {
    ctx := context.Background()
    client := redis.NewClient(&redis.Options{
        Addr: "localhost:6379",
    })

    // Send event to instance
    command := map[string]interface{}{
        "componentName": "OrderComponent",
        "instanceId":    "order-123",
        "event": map[string]interface{}{
            "type":      "VALIDATE",
            "payload":   map[string]string{"approvedBy": "alice@example.com"},
            "timestamp": time.Now().UnixMilli(),
        },
    }
    commandJSON, _ := json.Marshal(command)
    client.Publish(ctx, "xcomponent:external:commands", commandJSON)

    // Subscribe to state changes
    pubsub := client.Subscribe(ctx, "xcomponent:events:state_change")
    ch := pubsub.Channel()

    for msg := range ch {
        var event map[string]interface{}
        json.Unmarshal([]byte(msg.Payload), &event)

        data := event["data"].(map[string]interface{})
        prev := data["previousState"].(string)
        new := data["newState"].(string)
        fmt.Printf("State changed: %s → %s\n", prev, new)
    }
}
```

### Java

```java
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPubSub;
import com.google.gson.Gson;
import java.util.HashMap;
import java.util.Map;

public class XComponentClient {
    public static void main(String[] args) {
        Jedis jedis = new Jedis("localhost", 6379);
        Gson gson = new Gson();

        // Send event to instance
        Map<String, Object> command = new HashMap<>();
        command.put("componentName", "OrderComponent");
        command.put("instanceId", "order-123");

        Map<String, Object> event = new HashMap<>();
        event.put("type", "VALIDATE");
        event.put("payload", Map.of("approvedBy", "alice@example.com"));
        event.put("timestamp", System.currentTimeMillis());
        command.put("event", event);

        jedis.publish("xcomponent:external:commands", gson.toJson(command));

        // Subscribe to state changes
        Jedis subscriber = new Jedis("localhost", 6379);
        subscriber.subscribe(new JedisPubSub() {
            @Override
            public void onMessage(String channel, String message) {
                Map<String, Object> event = gson.fromJson(message, Map.class);
                Map<String, Object> data = (Map<String, Object>) event.get("data");
                String prev = (String) data.get("previousState");
                String newState = (String) data.get("newState");
                System.out.printf("State changed: %s → %s\n", prev, newState);
            }
        }, "xcomponent:events:state_change");
    }
}
```

### Ruby

```ruby
require 'redis'
require 'json'

# Connect to Redis
redis = Redis.new(host: 'localhost', port: 6379)

# Send event to instance
command = {
  componentName: 'OrderComponent',
  instanceId: 'order-123',
  event: {
    type: 'VALIDATE',
    payload: { approvedBy: 'alice@example.com' },
    timestamp: (Time.now.to_f * 1000).to_i
  }
}
redis.publish('xcomponent:external:commands', command.to_json)

# Subscribe to state changes
redis.subscribe('xcomponent:events:state_change') do |on|
  on.message do |channel, message|
    event = JSON.parse(message)
    prev = event['data']['previousState']
    new_state = event['data']['newState']
    puts "State changed: #{prev} → #{new_state}"
  end
end
```

### Rust

```rust
use redis::{Client, Commands, PubSubCommands};
use serde_json::json;

fn main() -> redis::RedisResult<()> {
    let client = Client::open("redis://127.0.0.1:6379")?;
    let mut con = client.get_connection()?;

    // Send event to instance
    let command = json!({
        "componentName": "OrderComponent",
        "instanceId": "order-123",
        "event": {
            "type": "VALIDATE",
            "payload": { "approvedBy": "alice@example.com" },
            "timestamp": chrono::Utc::now().timestamp_millis()
        }
    });
    con.publish("xcomponent:external:commands", command.to_string())?;

    // Subscribe to state changes
    let mut pubsub = con.as_pubsub();
    pubsub.subscribe("xcomponent:events:state_change")?;

    loop {
        let msg = pubsub.get_message()?;
        let payload: String = msg.get_payload()?;
        let event: serde_json::Value = serde_json::from_str(&payload)?;

        let prev = event["data"]["previousState"].as_str().unwrap();
        let new = event["data"]["newState"].as_str().unwrap();
        println!("State changed: {} → {}", prev, new);
    }
}
```

---

## Authentication & Security

### Redis with Password

All examples support Redis URLs with authentication:

```
redis://:password@localhost:6379
redis://username:password@localhost:6379
```

**Example (Python):**
```python
r = redis.Redis.from_url('redis://:mypassword@prod-redis:6379')
```

### Redis with TLS/SSL

Use `rediss://` protocol for encrypted connections:

```
rediss://username:password@prod-redis:6380
```

### Access Control

Use Redis ACLs to restrict access:

```bash
# Create user that can only publish commands and subscribe to events
redis-cli ACL SETUSER external-app on \
  >password \
  +publish|xcomponent:external:* \
  +subscribe|xcomponent:events:* \
  -@all
```

---

## Use Cases

### 1. Python Data Pipeline → FSM

```python
# data_pipeline.py
import redis, json

r = redis.Redis(host='localhost', port=6379)

# When data processing completes, trigger FSM
def on_data_processed(order_id, result):
    r.publish('xcomponent:external:commands', json.dumps({
        'componentName': 'OrderComponent',
        'instanceId': order_id,
        'event': {'type': 'DATA_PROCESSED', 'payload': result}
    }))
```

### 2. Monitoring Dashboard (React + Go backend)

```go
// Go backend streams FSM events to frontend via WebSocket
func streamFSMEvents(w http.ResponseWriter, r *http.Request) {
    upgrader.Upgrade(w, r, nil) // WebSocket upgrade

    redisClient := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
    pubsub := redisClient.Subscribe(ctx, "xcomponent:events:state_change")

    for msg := range pubsub.Channel() {
        // Forward to frontend WebSocket
        wsConn.WriteMessage(websocket.TextMessage, []byte(msg.Payload))
    }
}
```

### 3. Java Microservice Integration

```java
// OrderService.java - triggers FSM when order validated
public void onOrderValidated(String orderId) {
    jedis.publish("xcomponent:external:commands", gson.toJson(
        Map.of(
            "componentName", "PaymentComponent",
            "instanceId", "payment-" + orderId,
            "event", Map.of("type", "START_PAYMENT")
        )
    ));
}
```

---

## Troubleshooting

### Commands not received

1. Check xcomponent-ai started with `--external-api` flag
2. Verify Redis connection: `redis-cli ping`
3. Check channel name exactly matches `xcomponent:external:commands`

### Events not published

1. Check xcomponent-ai started with `--publish-events` flag
2. Verify subscription to correct channel (e.g., `xcomponent:events:state_change`)
3. Check Redis authentication if using password

### Performance considerations

- Use connection pooling for high-throughput systems
- Consider Redis Cluster for horizontal scaling
- Monitor Redis memory usage (`INFO memory`)

---

## Next Steps

- See [SCALABILITY.md](./SCALABILITY.md) for production deployment
- See [LLM-GUIDE.md](./LLM-GUIDE.md) for YAML FSM design patterns
- See `examples/distributed-demo/` for working examples

**Built for interoperability.** Any language, any platform. 🌍
