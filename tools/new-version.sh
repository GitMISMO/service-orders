#!/usr/bin/env bash
# Starts a new saved version to work on.
#
#   tools/new-version.sh 20261109a            copies the live version
#   tools/new-version.sh 20261109b 20261109a  copies a saved version that is not live yet
#
# Makes releases/<new>/ from the version named (or the one in LIVE), stamps the new
# version into index.html, and rebuilds review.html from it. Then edit the files in
# releases/<new>/, run `npm test`, upload, and try the Test Copy at
#   https://resources.mismo.org/service-orders/releases/<new>/
# before Jonna runs Actions > Publish a Version.
set -euo pipefail
cd "$(dirname "$0")/.."

NEW="${1:-}"
FROM="${2:-$(cat LIVE 2>/dev/null || true)}"
[[ "$NEW" =~ ^[0-9]{8}[a-z]$ ]] || { echo "Name the new version as the date and a letter, for example 20261109a."; exit 1; }
[[ -n "$FROM" && -d "releases/$FROM" ]] || { echo "No saved version '$FROM' to start from. Saved versions:"; ls releases; exit 1; }
[[ ! -e "releases/$NEW" ]] || { echo "releases/$NEW already exists."; exit 1; }

cp -R "releases/$FROM" "releases/$NEW"
sed -i -E "s#<meta name=\"so-version\" content=\"[^\"]*\">#<meta name=\"so-version\" content=\"$NEW\">#" "releases/$NEW/index.html"
grep -q "<meta name=\"so-version\" content=\"$NEW\">" "releases/$NEW/index.html" || { echo "Could not stamp the version into index.html."; exit 1; }
python3 tools/make_review.py "releases/$NEW/index.html" "releases/$NEW/review.html"
echo "releases/$NEW is ready to edit (copied from $FROM)."
