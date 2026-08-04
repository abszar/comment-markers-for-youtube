#!/usr/bin/env bash
# Creates the public GitHub repo, pushes this folder, and turns on GitHub Pages.
# Requires the GitHub CLI:  brew install gh && gh auth login
set -euo pipefail

REPO="comment-markers-for-youtube"
DESC="Chrome extension: marks the moments people mention in YouTube comments on the video timeline"

command -v gh >/dev/null || { echo "GitHub CLI not found. Install it: brew install gh"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not logged in. Run: gh auth login"; exit 1; }

OWNER="$(gh api user -q .login)"
echo "==> GitHub user: $OWNER"

# swap the OWNER placeholder for the real username
if sed --version >/dev/null 2>&1; then
  SED_INPLACE=(-i)          # GNU sed
else
  SED_INPLACE=(-i '')       # BSD/macOS sed
fi
sed "${SED_INPLACE[@]}" "s|OWNER|$OWNER|g" docs/index.html docs/privacy.html README.md store/STORE-LISTING.md

git init -b main >/dev/null 2>&1 || true
git add -A
git commit -m "Comment Markers for YouTube 1.0.0" >/dev/null
echo "==> Committed"

gh repo create "$REPO" --public --source=. --remote=origin --push --description "$DESC"
echo "==> Pushed to https://github.com/$OWNER/$REPO"

# GitHub Pages from main:/docs
gh api -X POST "repos/$OWNER/$REPO/pages" \
  -f "source[branch]=main" -f "source[path]=/docs" >/dev/null 2>&1 \
  && echo "==> Pages enabled" \
  || echo "==> Enable Pages manually: Settings -> Pages -> main -> /docs"

echo
echo "Privacy policy URL (give it a minute, then check it loads):"
echo "  https://$OWNER.github.io/$REPO/privacy.html"
