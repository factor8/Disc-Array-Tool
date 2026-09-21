#!/bin/bash
# Plesk post-deployment build script for discs.fnmnl.com.
#
# Expected layout — the checkout and the webroot are siblings, so the source,
# .git and node_modules are never under the document root:
#
#   <site>/app/       this repo (source only)
#   <site>/httpdocs/  document root, receives the built dist/
#
# Plesk > Git > Repository Settings > additional deployment actions:
#   bash /var/www/vhosts/fnmnl.com/discs.fnmnl.com/app/deploy.sh
#
# No argument needed: the docroot is derived as ../httpdocs relative to this
# script. Pass a path only to publish somewhere else. Either way the target is
# validated before anything is deleted — but note that a valid-looking wrong
# path will still be emptied, so the derived default is the safer habit.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCROOT="${1:-$(dirname "$REPO_DIR")/httpdocs}"

# ── Validate the target before spending minutes on a build ──────────────────

[ -d "$DOCROOT" ] || { echo "docroot does not exist: $DOCROOT" >&2; exit 1; }
DOCROOT="$(cd "$DOCROOT" && pwd)"  # canonicalize: resolve symlinks and ..

# Publishing clears the docroot, so it must neither equal nor contain the
# checkout. Both nesting directions matter: docroot-inside-repo would delete
# the build, repo-inside-docroot would delete the repo (and this script) mid-run.
case "$REPO_DIR" in
  "$DOCROOT"|"$DOCROOT"/*)
    echo "refusing: the checkout is inside the docroot $DOCROOT" >&2; exit 1 ;;
esac
case "$DOCROOT" in
  "$REPO_DIR"/*)
    echo "refusing: the docroot is inside the checkout" >&2; exit 1 ;;
esac

# ── Toolchain ───────────────────────────────────────────────────────────────

# Plesk keeps its Node builds in /opt/plesk/node/<version>. Pick the newest.
# The `|| true` matters: under `set -e` a failing command substitution would
# abort here, skipping the readable error below.
if ! command -v npm >/dev/null 2>&1; then
  NODE_BIN="$(ls -d /opt/plesk/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi
command -v npm >/dev/null 2>&1 || { echo "npm not found on PATH" >&2; exit 1; }
command -v rsync >/dev/null 2>&1 || { echo "rsync not found on PATH" >&2; exit 1; }

# ── Build ───────────────────────────────────────────────────────────────────

echo "Building in $REPO_DIR with node $(node -v)"
cd "$REPO_DIR"
npm ci
npm run build

[ -f "$REPO_DIR/dist/index.html" ] || { echo "build produced no dist/index.html" >&2; exit 1; }

# ── Publish ─────────────────────────────────────────────────────────────────

echo "Publishing to $DOCROOT"
# rsync updates the docroot in place, file by file, so there is no moment when
# the site is missing — unlike `rm -rf` followed by a copy. (Not atomic: a
# request landing mid-sync can still mix old and new assets. A true swap needs
# the docroot to be a symlink, which Plesk manages and we do not.)
#
# `protect .*` keeps dotfiles that live in the docroot but not in the build —
# .well-known, .htaccess — from being deleted.
rsync -a --delete --filter='protect .*' "$REPO_DIR/dist/" "$DOCROOT/"

echo "Deployed."
