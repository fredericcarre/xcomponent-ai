# Changelog

All notable changes to xcomponent-ai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.7] - 2026-01-24

### Added
- **Context Schema Support** - Optional `contextSchema` in YAML state machines to define instance properties
- **Trading Example with Schema** - examples/trading-with-schema.yaml demonstrates context schema usage
- **Swagger UI dependency** - Added swagger-ui-express for future API documentation
- **ROADMAP.md** - Public roadmap for planned dashboard and API improvements

### Changed
- Dashboard will support dynamic form generation from contextSchema (in progress)
- API documentation endpoint /api-docs (planned for v0.2.0)

## [0.1.6] - 2026-01-24

### Added
- **QUICKSTART.md** - Comprehensive 5-minute quick start guide
- **`serve` command** - Start runtime with API server and dashboard (`xcomponent-ai serve examples/trading.yaml`)
- Clear workflow documentation: load → serve → interact → monitor
- Real-time logging with timestamps for state transitions and instance creation

### Changed
- Updated README with prominent Quick Start section and `serve` command example
- Included QUICKSTART.md in npm package files

### Fixed
- CLI now provides clear workflow instead of confusing standalone `load` command
- Users can now visualize and interact with FSM through web dashboard

## [0.1.5] - 2026-01-24

### Fixed
- CLI now correctly resolves `examples/` paths to package installation directory
- `xcomponent-ai load examples/trading.yaml` now works after global install
- Added path resolution helper function for package-installed files

## [0.1.4] - 2026-01-24

### Changed
- Consolidated all recent fixes and improvements into stable release

### Fixed
- Workflow authentication using NPM_TOKEN (removed conflicting --provenance flag)

## [0.1.3] - 2026-01-24

### Added
- Included `examples/` directory in published npm package
- Users can now run `xcomponent-ai load examples/trading.yaml` after global install

### Fixed
- Fixed "ENOENT: no such file or directory" error when trying to load example files

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

**XComponent Triggering Mechanisms (Phase 1 & 2)**
- Property-based routing with matching rules
- Broadcast to multiple instances based on context matching
- Specific triggering (full vs partial execution)
- Support for comparison operators (>, <, ==, !=)

**Cascading Rules (Phase 3)**
- Automatic cross-machine updates via cascading rules
- Payload templating for event data propagation
- Guard-based conditional cascading

**Persistence & Event Sourcing (Phase 4)**
- Event sourcing with causality tracking
- Snapshot management for long-running workflows
- Timeout resynchronization after restart
- In-memory and extensible storage backends
- Complete workflow reconstruction from events

**Cross-Component Communication**
- ComponentRegistry for managing multiple FSM components
- Cross-component event routing and broadcasting
- Instance lookup across components
- Traceability across component boundaries

**Performance Optimizations**
- Timer Wheel for O(1) timeout management
- Hash-based property matching indexes for O(1) lookups

**Developer Experience**
- Comprehensive test suite with 113 passing tests
- TypeScript definitions
- Winston logging integration
- Monitoring and analytics service
- WebSocket support for real-time updates
- Express API server with REST endpoints
- Enhanced dashboard with FSM visualization
