# Changelog

All notable changes to xcomponent-ai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-01-24

### Added
- CLI binary configuration to enable global installation (`npm install -g xcomponent-ai`)
- CLI now accessible via `xcomponent-ai` command after global install

### Fixed
- Missing `bin` field in package.json preventing CLI usage after global install

## [0.1.1] - 2026-01-24

### Fixed
- Removed unused variables causing CI build failures in timer-wheel.ts, fsm-runtime.ts, and component-registry.ts
- Fixed GitHub repository displaying .github/README.md instead of main README.md by renaming to WORKFLOWS.md

### Changed
- Enhanced README and package.json to emphasize LLM-first framework design for AI agents (Claude, GPT)

## [0.1.0] - 2024-01-23

### Added

**Core FSM Runtime**
- Multi-instance finite state machine runtime (FSMRuntime)
- Support for entry, regular, final, and error state types
- Event-driven state transitions with guards
- Auto-transitions with configurable timeouts
- XComponent-inspired sender interface for inter-instance communication
- publicMember pattern for typed instance data

**Performance Optimizations**
- Hash-based property indexes for O(1) instance lookups (2666x speedup)
- Timer wheel implementation for efficient timeout management (60% memory reduction)
- Single timer for unlimited instances vs. individual timers per instance
- Property-based routing with machineIndex, stateIndex, propertyIndex

**Component Architecture**
- Component-based organization (1 component = N state machines)
- ComponentRegistry for managing multiple components
- Cross-component communication via Sender interface:
  - `sendToComponent()` - Route events to other components
  - `broadcastToComponent()` - Broadcast to all instances in component
  - `createInstanceInComponent()` - Create instances in other components
- System-wide event broadcasting across all components

**Event Sourcing & Persistence**
- Full event sourcing with causality tracking
- Snapshot support for fast state restoration
- In-memory EventStore and SnapshotStore implementations
- Cross-component traceability with componentName tracking
- Event deduplication for shared stores across components
- Configurable snapshot intervals

**Database Implementations**
- Production-ready PostgreSQL persistence (EventStore & SnapshotStore)
- Production-ready MongoDB persistence (EventStore & SnapshotStore)
- Complete schema definitions with optimized indexes
- Connection pooling and error handling
- Migration and initialization scripts

**Property Matching & Routing**
- XComponent-style property-based event routing
- Matching rules with operators: ===, >, <
- Support for nested property paths (e.g., `payload.orderId`)
- Specific triggering rules for complex conditions
- Broadcast to all instances matching criteria

**Cascading Rules**
- Declarative cross-machine state propagation
- Payload templating with instance context
- Guard support for conditional cascading
- Automatic causality tracking for cascaded events

**Monitoring & Observability**
- Real-time WebSocket dashboard with Vue.js 3
- FSM diagram visualization with Mermaid.js
- Interactive state transition controls
- Event history and sequence diagrams
- Causality chain visualization
- MonitoringService for metrics and analytics

**AI-Powered Features**
- LLM-based FSM design agent
- Automatic compliance checking
- FSM simulation and validation
- UI generation from FSM definitions
- Log analysis and anomaly detection

**API & CLI**
- RESTful API server with Express
- WebSocket real-time updates
- CLI tool for FSM management
- Component loading from YAML
- Instance management endpoints
- Cross-component traceability endpoints:
  - `GET /api/cross-component/causality/:eventId`
  - `GET /api/cross-component/events`
  - `GET /api/cross-component/instance/:instanceId/history`

**Documentation**
- Comprehensive README with examples
- PERSISTENCE.md with database setup guides
- PostgreSQL and MongoDB implementation examples
- Benchmark results and performance analysis
- Contributing guidelines
- Publishing guide for npm

**Examples**
- Complete e-commerce workflow demonstration
- Order → Inventory → Shipping cross-component demo
- Property matching benchmark (50k instances)
- Timeout management benchmark
- Persistence and restart demo
- Enhanced dashboard demo

**Testing**
- 116 comprehensive tests across all features
- 79.91% code coverage (statements)
- Cross-component communication tests
- Cross-component traceability tests
- Persistence and event sourcing tests
- Property matching tests
- Cascading rules tests
- Auto-transition tests

### Technical Details

**Architecture**
- TypeScript 5.7+ with strict type checking
- Event-driven design with EventEmitter
- Dependency injection for extensibility
- Interface-based persistence layer

**Performance**
- O(1) property matching via hash indexes
- Single timer wheel for all timeout transitions
- Minimal memory footprint per instance
- Efficient event causality traversal

**Compatibility**
- Node.js 20.0.0+
- TypeScript 5.0+
- PostgreSQL 12+
- MongoDB 4.4+

### Dependencies

**Core**
- express ^4.21.2
- socket.io ^4.8.1
- uuid ^11.0.3
- yaml ^2.6.1

**Optional**
- pg (for PostgreSQL)
- mongodb (for MongoDB)

**Development**
- typescript ^5.7.3
- jest ^29.7.0
- ts-jest ^29.2.5

[Unreleased]: https://github.com/fredericcarre/mayele-ai/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fredericcarre/mayele-ai/releases/tag/v0.1.0
