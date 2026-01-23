# Contributing to xcomponent-ai

Thank you for your interest in contributing to xcomponent-ai! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/fredericcarre/mayele-ai/issues)
2. If not, create a new issue with:
   - Clear, descriptive title
   - Steps to reproduce
   - Expected vs actual behavior
   - Environment details (Node version, OS, etc.)
   - Code samples if applicable

### Suggesting Features

1. Check existing [Discussions](https://github.com/fredericcarre/mayele-ai/discussions) and Issues
2. Create a new discussion with:
   - Use case description
   - Proposed solution
   - Alternatives considered
   - Example code/FSM definitions

### Pull Requests

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/mayele-ai.git
   cd mayele-ai
   npm install
   ```

2. **Create a Feature Branch**
   ```bash
   git checkout -b feature/my-feature
   ```

3. **Make Changes**
   - Follow TypeScript strict mode
   - Write tests (maintain >80% coverage)
   - Add JSDoc comments to public APIs
   - Update README if needed

4. **Run Tests**
   ```bash
   npm test
   npm run build
   ```

5. **Commit**
   ```bash
   git commit -m "feat: add my feature"
   ```

   Use conventional commits:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation
   - `test:` Tests
   - `refactor:` Code refactoring
   - `chore:` Maintenance

6. **Push and Create PR**
   ```bash
   git push origin feature/my-feature
   ```

   Then create a Pull Request on GitHub with:
   - Clear description of changes
   - Link to related issues
   - Screenshots/examples if applicable

## Development Guidelines

### Code Style

- Use TypeScript strict mode
- Follow existing code patterns
- Use meaningful variable names
- Keep functions small and focused
- Add JSDoc comments to public APIs

### Testing

- Write unit tests for new features
- Maintain >80% code coverage
- Test edge cases and error scenarios
- Use descriptive test names

Example:
```typescript
describe('FSMRuntime', () => {
  describe('Instance Management', () => {
    it('should create an instance with initial context', () => {
      // Test implementation
    });
  });
});
```

### Documentation

- Update README for new features
- Add JSDoc comments with examples
- Create/update Mermaid diagrams if architecture changes
- Include example FSM definitions for new use cases

### Commit Messages

Follow conventional commits:
```
<type>(<scope>): <subject>

<body>

<footer>
```

Example:
```
feat(agents): add compliance gap detection for GDPR

Implemented automatic detection of missing GDPR compliance guards
in FSM definitions. The FSMAgent now suggests adding consent checks
and data retention policies when user-related workflows are detected.

Closes #42
```

## Project Structure

```
xcomponent-ai/
├── src/
│   ├── types.ts          # Type definitions
│   ├── fsm-runtime.ts    # Core FSM runtime
│   ├── agents.ts         # Agentic AI layer
│   ├── monitoring.ts     # Monitoring service
│   ├── websockets.ts     # WebSocket infrastructure
│   ├── api.ts            # Express API server
│   ├── cli.ts            # CLI commands
│   └── index.ts          # Public exports
├── tests/                # Jest tests
├── examples/             # Example FSM definitions
├── docs/                 # Generated documentation
└── .github/workflows/    # CI/CD
```

## Testing Your Changes

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm test -- --coverage

# Build project
npm run build

# Generate documentation
npm run doc

# Test CLI locally
npm run cli -- load examples/trading.yaml
```

## Release Process

(For maintainers only)

1. Update version in `package.json`
2. Update CHANGELOG.md
3. Create git tag: `git tag v0.x.0`
4. Push: `git push --tags`
5. Publish to npm: `npm publish`

## Questions?

- Open a [Discussion](https://github.com/fredericcarre/mayele-ai/discussions)
- Join our community chat (coming soon)
- Email: contributors@xcomponent.com

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.
