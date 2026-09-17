#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# ManageLM VS Code Extension — Build & package script
#
# Compiles TypeScript and creates a .vsix package for distribution.
#
# Usage:  ./package.sh [--patch|--minor|--major] [--skip-build]
# Output: managelm-<version>.vsix
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
git config --global --add safe.directory "$ROOT_DIR" 2>/dev/null || true

# ── Flags ─────────────────────────────────────────────────────────
SKIP_BUILD=false
BUMP=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
    --patch|--minor|--major) BUMP="${arg#--}" ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ── Version bump (optional) ──────────────────────────────────────
if [ -n "$BUMP" ]; then
  echo "▸ Bumping $BUMP version..."
  npm version "$BUMP" --no-git-tag-version
fi

VERSION=$(node -p "require('./package.json').version")
OUTFILE="managelm-${VERSION}.vsix"

# ── Build ─────────────────────────────────────────────────────────
if [ "$SKIP_BUILD" = false ]; then
  echo "▸ Installing dependencies..."
  npm ci --no-audit --no-fund

  # Everything here is build tooling (the .vsix ships no node_modules);
  # warn in one line instead of npm's full report
  npm audit >/dev/null 2>&1 \
    || echo "  ⚠ npm audit reports vulnerabilities in the build tooling (run: npm audit)"

  echo "▸ Compiling TypeScript..."
  npm run build --silent
else
  echo "▸ Skipping build (--skip-build)"
  if [ ! -d dist ]; then
    echo "ERROR: dist/ missing. Run without --skip-build first."
    exit 1
  fi
fi

# ── Package as .vsix ─────────────────────────────────────────────
echo "▸ Creating .vsix package..."
npm run package --silent -- --no-dependencies -o "$OUTFILE"

SIZE=$(du -h "$OUTFILE" | cut -f1)

# Restore ownership (scripts may run as root)
[[ "$ROOT_DIR" == "/" ]] && { echo "FATAL: ROOT_DIR is /"; exit 1; }
[ "$(id -u)" -eq 0 ] && chown -R "$(stat -c '%U:%G' "$ROOT_DIR")" "$ROOT_DIR" || true

echo ""
echo "Done: $OUTFILE ($SIZE)"
