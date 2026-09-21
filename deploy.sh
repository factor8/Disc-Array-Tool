#!/bin/bash
# Plesk post-deployment build script for discs.fnmnl.com.
# Repo is deployed (source only) to /var/www/vhosts/fnmnl.com/repos/disc-array-tool
# and this publishes the built dist/ into the site's document root.
#
# Plesk > Git > Repository Settings > additional deployment actions:
#   bash /var/www/vhosts/fnmnl.com/repos/disc-array-tool/deploy.sh \
#        /var/www/vhosts/fnmnl.com/discs.fnmnl.com
#
# The argument is the document root from Plesk > Hosting Settings. If it is
# wrong the script aborts rather than deleting anything.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCROOT="${1:-${DOCROOT:-$(dirname "$REPO_DIR")/httpdocs}}"

# Plesk keeps its Node builds in /opt/plesk/node/<version>. Pick the newest.
if ! command -v npm >/dev/null 2>&1; then
  NODE_BIN="$(ls -d /opt/plesk/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$NODE_BIN" ] && export PATH="$NODE_BIN:$PATH"
fi
command -v npm >/dev/null 2>&1 || { echo "npm not found on PATH"; exit 1; }

# Validate the target before spending minutes on a build.
[ -d "$DOCROOT" ] || { echo "docroot $DOCROOT does not exist"; exit 1; }
DOCROOT="$(cd "$DOCROOT" && pwd)"
# Never let the publish step eat the source checkout.
case "$DOCROOT" in
  "$REPO_DIR"|"$REPO_DIR"/*) echo "refusing: docroot is inside the repo"; exit 1 ;;
esac

echo "Building in $REPO_DIR with node $(node -v)"
cd "$REPO_DIR"
npm ci
npm run build

[ -f "$REPO_DIR/dist/index.html" ] || { echo "build produced no dist/index.html"; exit 1; }

echo "Publishing to $DOCROOT"
# Leaves dotfiles (.well-known, .htaccess) alone.
rm -rf "${DOCROOT:?}"/*
cp -r "$REPO_DIR/dist/." "$DOCROOT/"

echo "Deployed."
