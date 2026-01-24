# GitHub Configuration

This directory contains GitHub-specific configuration for xcomponent-ai.

## Workflows

### publish-npm.yml

Automatically publishes the package to npm when a new release is created.

**Triggers:**
- New GitHub release is published
- Manual workflow dispatch with tag name

**Prerequisites:**
1. Create npm token at https://www.npmjs.com/settings/YOUR_USERNAME/tokens
2. Add token as `NPM_TOKEN` secret in GitHub repository settings:
   - Go to: Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `NPM_TOKEN`
   - Value: Your npm automation token

**Usage:**

1. **Automatic (Recommended):**
   ```bash
   # Create and push a version tag
   npm version patch  # or minor, major
   git push && git push --tags

   # Create GitHub release from tag
   gh release create v0.1.1 --generate-notes
   ```

   The workflow will automatically:
   - Install dependencies
   - Run linter
   - Run tests
   - Build the package
   - Publish to npm

2. **Manual:**
   - Go to Actions → Publish to npm → Run workflow
   - Enter the tag name (e.g., `v0.1.1`)
   - Click "Run workflow"

**Workflow Steps:**
1. Checkout code at the release tag
2. Setup Node.js 20 with npm registry
3. Install dependencies (`npm ci`)
4. Run linter (`npm run lint`)
5. Run tests (`npm test`)
6. Build package (`npm run build`)
7. Verify build output
8. Publish to npm with provenance

**Security:**
- Uses OpenID Connect (OIDC) for npm authentication
- Includes provenance attestation for supply chain security
- Runs in secure GitHub-hosted runner

## Future Workflows

Potential workflows to add:

### ci.yml - Continuous Integration
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20, 21]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm test
```

### codeql.yml - Security Analysis
```yaml
name: CodeQL
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v2
      - uses: github/codeql-action/analyze@v2
```

### release-drafter.yml - Automatic Release Notes
```yaml
name: Release Drafter
on:
  push:
    branches: [main]
jobs:
  update_release_draft:
    runs-on: ubuntu-latest
    steps:
      - uses: release-drafter/release-drafter@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Issue Templates

Consider adding issue templates:

- `.github/ISSUE_TEMPLATE/bug_report.md` - Bug reports
- `.github/ISSUE_TEMPLATE/feature_request.md` - Feature requests
- `.github/ISSUE_TEMPLATE/question.md` - Questions

## Pull Request Template

Consider adding `.github/pull_request_template.md`:

```markdown
## Description
<!-- Describe your changes -->

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Tests added/updated
- [ ] All tests passing
- [ ] Manual testing completed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] No new warnings generated
```

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Publishing Node.js Packages](https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages)
- [npm Provenance](https://docs.npmjs.com/generating-provenance-statements)
