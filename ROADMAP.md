# xcomponent-ai Roadmap

## v0.1.7 (Current)
- ✅ Trading example with contextSchema
- ✅ swagger-ui-express dependency added
- 📝 Documentation for context schema in YAML

## v0.2.0 (Planned - Dashboard & API Improvements)

### Enhanced Dashboard
- [ ] **Event Blotter** - Real-time event stream display with filtering
- [ ] **Dynamic Forms** - Auto-generate form fields from contextSchema
- [ ] **Better Visualization** - Color-coded states, transitions graph
- [ ] **WebSocket Integration** - Real-time updates without polling

### API Documentation
- [ ] **Swagger/OpenAPI** - Interactive API documentation at /api-docs
- [ ] **Auto-generated from routes** - Swagger spec from Express routes
- [ ] **Request/Response examples** - Clear API usage examples

### Context Schema Support
- [ ] **Form Generation** - Generate HTML forms from contextSchema in YAML
- [ ] **Validation** - Validate context against schema before instance creation
- [ ] **Infer from Guards** - Auto-detect context properties from matching rules
- [ ] **Type Coercion** - Automatic number/boolean conversion from form inputs

### Developer Experience
- [ ] **REPL Mode** - Interactive CLI for testing (`xcomponent-ai repl`)
- [ ] **Hot Reload** - Auto-reload on YAML changes
- [ ] **Better Error Messages** - Clear validation errors with suggestions

## v0.3.0 (Future)
- [ ] **Multi-Component Dashboard** - Support multiple components in one view
- [ ] **Advanced Filtering** - Filter instances by state, machine, time range
- [ ] **Export/Import** - Export instance state, import scenarios
- [ ] **Time Travel Debugging** - Replay state transitions

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to contribute to these features.
