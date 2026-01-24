#!/bin/bash

# verify-package.sh
# Pre-publication verification script for xcomponent-ai
# Run this before publishing to npm to ensure package quality

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║          xcomponent-ai Package Verification                   ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# Function to check status
check_status() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓${NC} $1"
  else
    echo -e "${RED}✗${NC} $1"
    ((ERRORS++))
  fi
}

echo "1. Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 20 ]; then
  echo -e "${GREEN}✓${NC} Node.js version: $(node -v)"
else
  echo -e "${RED}✗${NC} Node.js version must be >= 20.0.0"
  ((ERRORS++))
fi
echo ""

echo "2. Checking npm login status..."
npm whoami > /dev/null 2>&1
check_status "npm authentication"
echo ""

echo "3. Cleaning previous builds..."
npm run clean 2>/dev/null || rm -rf dist/
check_status "Clean completed"
echo ""

echo "4. Installing dependencies..."
npm ci
check_status "Dependencies installed"
echo ""

echo "5. Running linter..."
npm run lint 2>/dev/null || echo -e "${YELLOW}⚠${NC} Linter not configured or errors found"
echo ""

echo "6. Running tests..."
npm test
check_status "All tests passed"
echo ""

echo "7. Building package..."
npm run build
check_status "Build completed"
echo ""

echo "8. Checking build output..."
if [ -d "dist" ] && [ -f "dist/index.js" ] && [ -f "dist/index.d.ts" ]; then
  echo -e "${GREEN}✓${NC} dist/ contains expected files"
  echo "   Files in dist/:"
  ls -lh dist/ | tail -n +2 | awk '{print "   - " $9 " (" $5 ")"}'
else
  echo -e "${RED}✗${NC} dist/ missing required files"
  ((ERRORS++))
fi
echo ""

echo "9. Verifying package.json..."
PACKAGE_NAME=$(node -p "require('./package.json').name")
PACKAGE_VERSION=$(node -p "require('./package.json').version")
PACKAGE_MAIN=$(node -p "require('./package.json').main")
PACKAGE_TYPES=$(node -p "require('./package.json').types")

echo "   Name: $PACKAGE_NAME"
echo "   Version: $PACKAGE_VERSION"
echo "   Main: $PACKAGE_MAIN"
echo "   Types: $PACKAGE_TYPES"

if [ -f "$PACKAGE_MAIN" ] && [ -f "$PACKAGE_TYPES" ]; then
  echo -e "${GREEN}✓${NC} Entry files exist"
else
  echo -e "${RED}✗${NC} Entry files missing"
  ((ERRORS++))
fi
echo ""

echo "10. Checking required files..."
REQUIRED_FILES=("README.md" "LICENSE" "PERSISTENCE.md" "CHANGELOG.md")
for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "${GREEN}✓${NC} $file exists"
  else
    echo -e "${RED}✗${NC} $file missing"
    ((ERRORS++))
  fi
done
echo ""

echo "11. Simulating package contents..."
echo "   Files that will be published:"
npm pack --dry-run 2>&1 | grep -E "^(npm notice |package:)" | head -20
echo ""

echo "12. Checking package size..."
TARBALL=$(npm pack --silent 2>/dev/null)
SIZE=$(ls -lh "$TARBALL" 2>/dev/null | awk '{print $5}')
echo "   Package size: $SIZE"
rm -f "$TARBALL"

# Warn if package is too large
BYTES=$(ls -l "$TARBALL" 2>/dev/null | awk '{print $5}')
if [ ! -z "$BYTES" ] && [ "$BYTES" -gt 10485760 ]; then
  echo -e "${YELLOW}⚠${NC}  Package is larger than 10MB"
fi
echo ""

echo "13. Checking for common issues..."

# Check for hardcoded secrets
if grep -r "sk-" src/ 2>/dev/null | grep -v node_modules > /dev/null; then
  echo -e "${YELLOW}⚠${NC}  Possible hardcoded API keys detected"
  ((ERRORS++))
else
  echo -e "${GREEN}✓${NC} No obvious hardcoded secrets"
fi

# Check for console.log in production code
LOG_COUNT=$(grep -r "console.log" src/ 2>/dev/null | grep -v node_modules | grep -v "\.test\." | wc -l)
if [ "$LOG_COUNT" -gt 5 ]; then
  echo -e "${YELLOW}⚠${NC}  Many console.log statements found ($LOG_COUNT)"
else
  echo -e "${GREEN}✓${NC} Console.log usage acceptable"
fi

# Check TypeScript errors
if npx tsc --noEmit; then
  echo -e "${GREEN}✓${NC} No TypeScript errors"
else
  echo -e "${RED}✗${NC} TypeScript compilation has errors"
  ((ERRORS++))
fi
echo ""

echo "14. Version check..."
CURRENT_VERSION=$(npm view xcomponent-ai version 2>/dev/null || echo "none")
echo "   Current published version: $CURRENT_VERSION"
echo "   Version to publish: $PACKAGE_VERSION"

if [ "$CURRENT_VERSION" = "$PACKAGE_VERSION" ] && [ "$CURRENT_VERSION" != "none" ]; then
  echo -e "${RED}✗${NC} Version $PACKAGE_VERSION already published!"
  echo "   Run: npm version patch|minor|major"
  ((ERRORS++))
else
  echo -e "${GREEN}✓${NC} Version is new"
fi
echo ""

echo "═══════════════════════════════════════════════════════════════"
echo ""

if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed!${NC}"
  echo ""
  echo "Ready to publish. Run:"
  echo "  npm publish"
  echo ""
  echo "Or to publish with tag:"
  echo "  npm publish --tag beta"
  echo ""
  exit 0
else
  echo -e "${RED}❌ $ERRORS error(s) found${NC}"
  echo ""
  echo "Please fix the errors before publishing."
  echo ""
  exit 1
fi
