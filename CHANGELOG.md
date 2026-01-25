# Changelog

## [0.4.0] - 2026-01-25

### 🏗️ XComponent Pattern - Component Orchestration

This major version implements the complete **XComponent pattern** for orchestrating multiple state machines within a component, inspired by the original XComponent framework.

#### Added

- **Entry Point Mechanism**
  - `entryMachine` field in Component YAML definition
  - Auto-creation of entry point instance on component startup
  - Entry point instances persist even in final state (marked with `isEntryPoint` flag)
  - Regular instances auto-deallocate when reaching final/error states

- **Component View Dashboard** (Default View)
  - New "Component View" tab showing all state machines in a component
  - Visual grid layout with automatic positioning
  - Inter-machine transitions displayed as green arrows
  - Instance count badges per machine
  - Entry point machines marked with ⭐ star icon
  - Click on machine card to view detailed diagram
  - Click on green arrow to execute inter-machine transition

- **Inter-Machine Transitions**
  - Visual triggering of `inter_machine` transitions from dashboard
  - Automatic instance selection (or prompt if multiple candidates)
  - Real-time creation of target machine instances
  - Context propagation between machines

- **Layout Configuration**
  - Optional `layout` metadata in Component YAML
  - Auto-layout algorithms: `grid`, `force`, `hierarchical`
  - Manual positioning support (future enhancement)
  - Configurable machine positions in component view

- **Example: xcomponent-pattern-demo.yaml**
  - Complete demonstration of XComponent orchestration
  - OrderManager (entry point) → OrderExecution → Settlement
  - Shows cascading instance creation
  - Demonstrates auto-deallocation vs persistence

#### Changed

- **FSMRuntime**: Entry point instances skip auto-disposal in final states
- **ComponentRegistry**: Auto-creates entry point instance on component registration
- **Dashboard**: Component View is now the default tab (was FSM Diagram)
- **State Change Events**: Include `stateType` for deallocation detection

#### Architecture

```
Component Lifecycle:
1. Component registers → Entry point instance created automatically ⭐
2. Inter-machine transition triggered → New instance created
3. Instance reaches final state → Auto-deallocated ✓
4. Entry point in final state → Persists ⭐
```

### Breaking Changes
- None - v0.3.0 APIs remain compatible

## [0.3.0] - 2026-01-25

### 🎯 Explicit Control & API Simplification

Major refactoring focused on explicit control and removing implicit behavior (guards).

#### Added
- **sender.sendToSelf()** - Explicit control for self-triggering transitions from triggered methods
- Unified broadcast API: `sender.broadcast(machineName, event, state?, component?)`

#### Removed
- **Guards completely removed** (breaking change)
  - No more `guards` field in transitions
  - Logic moved to triggered methods with explicit `sender.sendToSelf()`
  - Cleaner, more explicit control flow

#### Changed
- All examples updated to use v0.3.0 patterns
- Tests updated (109 passed, 3 skipped)
- Documentation updated for explicit transitions

## [0.2.2] - 2026-01-24

### Fixed
- **Critical**: Fix dashboard component data structure (stateMachines vs machines property)
- Fix WebSocket data extraction (data.component instead of data directly)
- Resolved "Cannot read properties of undefined (reading 'map')" error in dashboard

## [0.2.1] - 2026-01-24

### Fixed
- **Critical**: Include `public/` directory in npm package (dashboard.html was missing)
- Update all documentation to use correct dashboard URL (`/dashboard.html` instead of `/dashboard`)

## [0.2.0] - 2026-01-24

### 🎯 Major Dashboard & UX Improvements

This version transforms xcomponent-ai into a production-ready tool with comprehensive visualization and developer experience.

#### Added
- **Full-featured Dashboard** with 5 tabs
  - Overview: Real-time statistics (total instances, active, final, error states, event count)
  - FSM Diagram: Visual Mermaid diagrams with automatic state styling
  - Event Blotter: Real-time event stream with filtering (state-change, created, error, cross-component)
  - Traceability: Complete instance history with sequence diagram
  - Create Instance: Dynamic form generation from contextSchema

- **WebSocket Integration**
  - Real-time bidirectional communication using Socket.IO
  - Broadcast state changes, instance creation, and errors to all connected clients
  - Live dashboard updates without polling

- **Mermaid FSM Diagram Generation**
  - Automatic diagram generation from YAML definitions
  - State styling based on type (entry/orange, final/green, error/red)
  - Display guards, transitions, and state descriptions
  - New module: `src/mermaid-generator.ts`

- **Swagger/OpenAPI 3.0 Documentation**
  - Interactive API documentation at `/api-docs`
  - Auto-generated from component definitions
  - Complete endpoint documentation with request/response schemas
  - New module: `src/swagger-spec.ts`

- **Enhanced API Endpoints**
  - `GET /api/component` - Component definition with contextSchema
  - `GET /api/diagrams/:machineName` - Mermaid diagram generation
  - `GET /api/instances/:id/history` - Instance event history for traceability

- **Context Schema Support**
  - Define form fields in YAML with types (text, number, select)
  - Validation rules (required, min/max, pattern regex)
  - UI metadata (labels, descriptions, placeholders)
  - Automatic form generation in dashboard
  - Complete example: `examples/trading-complete.yaml`

### Dependencies Added
- `swagger-ui-express@^5.0.1`
- `socket.io@^4.8.1`
- `@types/swagger-ui-express@^4.1.8`

## [0.1.7] - 2026-01-24

### Added
- Context schema support in YAML
- examples/trading-with-schema.yaml
- ROADMAP.md

[Previous versions...]
