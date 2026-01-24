# Changelog

## [0.2.0] - 2026-01-24 (In Progress)

### 🎯 Major Dashboard & UX Improvements

This version transforms xcomponent-ai into a production-ready tool with comprehensive visualization and developer experience.

#### Added
- **Full-featured Dashboard** (work in progress)
  - Event Blotter with real-time WebSocket updates
  - Dynamic form generation from contextSchema
  - Mermaid.js FSM visualization
  - Sequence diagram for instance traceability
  - Cross-component event tracking
  - Filter and search capabilities

- **Swagger/OpenAPI Documentation**
  - Interactive API documentation at /api-docs
  - Auto-generated from routes
  - Request/response examples

- **Enhanced Examples**
  - trading-with-schema.yaml with full contextSchema
  - Descriptions for all states and transitions
  - Demonstrates all features

#### Planned Features (v0.2.0)
- [ ] Complete dashboard implementation with all tabs
- [ ] WebSocket integration for real-time updates
- [ ] Mermaid FSM diagram generation
- [ ] Sequence diagram for traceability
- [ ] Trigger transitions from UI
- [ ] Event blotter with filtering
- [ ] Export/import state

### Dependencies Added
- swagger-ui-express
- socket.io-client
- @types/swagger-ui-express

## [0.1.7] - 2026-01-24

### Added
- Context schema support in YAML
- examples/trading-with-schema.yaml
- ROADMAP.md

[Previous versions...]
