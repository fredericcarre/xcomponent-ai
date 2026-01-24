# Changelog

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
