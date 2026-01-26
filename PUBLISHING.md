# Publishing Guide for xcomponent-ai

This document explains how to publish xcomponent-ai to npm and other package registries.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Pre-Publication Checklist](#pre-publication-checklist)
- [Publishing to npm](#publishing-to-npm)
- [Version Management](#version-management)
- [Publishing to GitHub Packages](#publishing-to-github-packages)
- [Alternative Registries](#alternative-registries)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### 1. npm Account
Create an account at [npmjs.com](https://www.npmjs.com/signup) if you don't have one.

### 2. Login to npm
```bash
npm login
# Enter your username, password, and email
```

Verify you're logged in:
```bash
npm whoami
# Should display your npm username
```

### 3. Two-Factor Authentication (Recommended)
Enable 2FA on your npm account for security:
```bash
npm profile enable-2fa auth-and-writes
```

## Pre-Publication Checklist

Before publishing, ensure:

### ✅ Code Quality
- [ ] All tests passing: `npm test`
- [ ] No linting errors: `npm run lint`
- [ ] TypeScript compiles: `npm run build`
- [ ] Coverage acceptable (target: 80%+)

### ✅ Documentation
- [ ] README.md is up to date
- [ ] PERSISTENCE.md is complete
- [ ] CONTRIBUTING.md explains how to contribute
- [ ] API documentation generated: `npm run doc`
- [ ] CHANGELOG.md updated with version changes

### ✅ Package Configuration
- [ ] `package.json` version updated
- [ ] `package.json` keywords relevant
- [ ] `package.json` repository URL correct
- [ ] `LICENSE` file present
- [ ] `.npmignore` excludes dev files

### ✅ Build Verification
```bash
# Clean build
npm run clean
npm run build

# Check what will be published
npm pack --dry-run

# Verify dist/ contains expected files
ls -la dist/
```

## Publishing to npm

### Option 1: Automated Publishing (Recommended)

The package includes automated scripts for safe publishing:

```bash
# This will:
# 1. Run linting
# 2. Run all tests
# 3. Bump version (patch/minor/major)
# 4. Clean and rebuild
# 5. Create git tag
# 6. Publish to npm
# 7. Push to git with tags

# For patch version (0.1.0 → 0.1.1)
npm version patch

# For minor version (0.1.0 → 0.2.0)
npm version minor

# For major version (0.1.0 → 1.0.0)
npm version major
```

Then publish:
```bash
npm publish
```

### Option 2: Manual Publishing

```bash
# 1. Update version in package.json manually
# Edit package.json: "version": "0.1.1"

# 2. Run pre-publish checks
npm run prepublishOnly

# 3. Publish
npm publish

# 4. Tag in git
git tag v0.1.1
git push origin v0.1.1
```

### Publishing Beta/Pre-release Versions

For beta versions:
```bash
# Set version to beta
npm version 0.2.0-beta.1

# Publish with beta tag
npm publish --tag beta
```

Users can install beta with:
```bash
npm install xcomponent-ai@beta
```

### Publishing with Scoped Package

If using a scoped package (e.g., `@yourorg/xcomponent-ai`):

```bash
# Update package.json name
{
  "name": "@yourorg/xcomponent-ai"
}

# Publish as public scoped package
npm publish --access public
```

## Version Management

### Semantic Versioning

Follow [SemVer](https://semver.org/):

- **MAJOR** (1.0.0 → 2.0.0): Breaking changes
- **MINOR** (1.0.0 → 1.1.0): New features, backward compatible
- **PATCH** (1.0.0 → 1.0.1): Bug fixes, backward compatible

### Version Bump Examples

```bash
# Patch: Bug fixes only
npm version patch -m "fix: resolve persistence race condition"

# Minor: New features
npm version minor -m "feat: add Redis persistence implementation"

# Major: Breaking changes
npm version major -m "BREAKING: change ComponentRegistry API"

# Pre-release
npm version prerelease --preid=beta
```

### CHANGELOG.md

Update `CHANGELOG.md` before each release:

```markdown
# Changelog

## [0.2.0] - 2024-01-24

### Added
- Cross-component traceability with causality tracking
- PostgreSQL and MongoDB persistence implementations
- Comprehensive persistence documentation

### Changed
- Improved event deduplication in shared stores
- Enhanced ComponentRegistry API

### Fixed
- Timer wheel precision for fast transitions
- Event causality chain traversal

## [0.1.0] - 2024-01-20

### Added
- Initial release
- FSMRuntime with multi-instance support
- Component-based architecture
- Event sourcing and snapshots
- WebSocket real-time dashboard
```

## Publishing to GitHub Packages

### 1. Create `.npmrc` in Project Root

```bash
# .npmrc
@fredericcarre:registry=https://npm.pkg.github.com
```

### 2. Update `package.json`

```json
{
  "name": "@fredericcarre/xcomponent-ai",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/fredericcarre/xcomponent-ai.git"
  },
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  }
}
```

### 3. Authenticate with GitHub

```bash
# Create Personal Access Token with write:packages permission
# https://github.com/settings/tokens

# Login
npm login --registry=https://npm.pkg.github.com
# Username: your-github-username
# Password: your-personal-access-token
# Email: your-email
```

### 4. Publish

```bash
npm publish
```

### 5. Install from GitHub Packages

Users need to configure `.npmrc`:
```bash
# ~/.npmrc or project .npmrc
@fredericcarre:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

Then install:
```bash
npm install @fredericcarre/xcomponent-ai
```

## Alternative Registries

### Publishing to Private Registry (Verdaccio, Artifactory, etc.)

```bash
# Set registry URL
npm config set registry https://your-private-registry.com

# Login
npm login --registry=https://your-private-registry.com

# Publish
npm publish --registry=https://your-private-registry.com
```

### Publishing to Azure Artifacts

1. Create `.npmrc`:
```bash
registry=https://pkgs.dev.azure.com/yourorg/_packaging/yourfeed/npm/registry/
always-auth=true
```

2. Authenticate:
```bash
npm install -g vsts-npm-auth
vsts-npm-auth -config .npmrc
```

3. Publish:
```bash
npm publish
```

## Automated Publishing with CI/CD

### GitHub Actions Example

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build
        run: npm run build

      - name: Publish to npm
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### GitLab CI Example

Create `.gitlab-ci.yml`:

```yaml
publish:
  stage: deploy
  only:
    - tags
  script:
    - echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc
    - npm ci
    - npm test
    - npm run build
    - npm publish
  variables:
    NPM_TOKEN: $NPM_TOKEN
```

## Package Testing Before Publishing

### Test Locally

```bash
# Create tarball
npm pack

# Install in test project
cd /path/to/test/project
npm install /path/to/xcomponent-ai/xcomponent-ai-0.1.0.tgz

# Test the package
node -e "const { FSMRuntime } = require('xcomponent-ai'); console.log(FSMRuntime);"
```

### Test with `npm link`

```bash
# In xcomponent-ai directory
npm link

# In test project
npm link xcomponent-ai

# Test
npm test

# Unlink when done
npm unlink xcomponent-ai
cd /path/to/xcomponent-ai
npm unlink
```

## Post-Publication Tasks

After successful publication:

1. **Verify on npm**:
   ```bash
   npm info xcomponent-ai
   npm view xcomponent-ai versions
   ```

2. **Test installation**:
   ```bash
   mkdir test-install && cd test-install
   npm init -y
   npm install xcomponent-ai
   ```

3. **Update GitHub Release**:
   - Create release on GitHub with tag
   - Attach `CHANGELOG.md` excerpt
   - Optionally attach tarball

4. **Announce**:
   - Update project website/blog
   - Post on social media
   - Notify users via mailing list

5. **Monitor**:
   - Check download stats: https://npm-stat.com/charts.html?package=xcomponent-ai
   - Watch for issues on GitHub
   - Monitor npm audit results

## Troubleshooting

### Error: 403 Forbidden

**Cause**: Not authenticated or no publish permissions

**Solution**:
```bash
npm logout
npm login
npm whoami  # Verify login
```

### Error: Package name already exists

**Cause**: Package name taken on npm

**Solution**:
1. Use scoped package: `@yourorg/xcomponent-ai`
2. Choose different name
3. Contact npm support if you own the name

### Error: Version already exists

**Cause**: Trying to publish same version twice

**Solution**:
```bash
# Bump version
npm version patch
npm publish
```

### Error: ENEEDAUTH

**Cause**: Authentication token expired

**Solution**:
```bash
npm login
# Or set token manually
npm config set //registry.npmjs.org/:_authToken YOUR_TOKEN
```

### Build Errors Before Publish

**Cause**: TypeScript compilation issues

**Solution**:
```bash
# Clean and rebuild
npm run clean
npm run build

# Check TypeScript errors
npx tsc --noEmit
```

### Tests Failing Before Publish

**Cause**: prepublishOnly script runs tests

**Solution**:
```bash
# Run tests locally
npm test

# Skip tests (not recommended)
npm publish --ignore-scripts
```

## Security Best Practices

1. **Enable 2FA**: Always use two-factor authentication
2. **Use Tokens**: Use automation tokens for CI/CD
3. **Audit Dependencies**: Run `npm audit` regularly
4. **Review Published Files**: Check with `npm pack --dry-run`
5. **Sign Releases**: Use GPG signing for git tags
6. **Monitor Downloads**: Watch for unusual activity

## Useful Commands

```bash
# Check what will be published
npm pack --dry-run

# View package info
npm info xcomponent-ai

# List all versions
npm view xcomponent-ai versions

# View latest version
npm view xcomponent-ai version

# Deprecate old version
npm deprecate xcomponent-ai@0.1.0 "Please upgrade to 0.2.0"

# Unpublish version (within 72 hours)
npm unpublish xcomponent-ai@0.1.0

# View download stats
npm view xcomponent-ai dist-tags
```

## Resources

- [npm Documentation](https://docs.npmjs.com/)
- [Semantic Versioning](https://semver.org/)
- [npm Publishing Guide](https://docs.npmjs.com/cli/v9/commands/npm-publish)
- [GitHub Packages](https://docs.github.com/en/packages)
- [npm Security Best Practices](https://docs.npmjs.com/packages-and-modules/securing-your-code)

## Support

For publishing issues:
- npm Support: https://www.npmjs.com/support
- GitHub Issues: https://github.com/fredericcarre/xcomponent-ai/issues
- Email: dev@xcomponent.com
