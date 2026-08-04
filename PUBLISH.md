# Publishing checklist

## 1. Push this to GitHub

With the [GitHub CLI](https://cli.github.com) installed and logged in
(`brew install gh && gh auth login`), from inside this folder:

```bash
./setup-repo.sh
```

That creates the public repo, pushes it, replaces the `OWNER` placeholders with
your username, and enables GitHub Pages from `/docs` on `main`.

Doing it by hand instead:

```bash
git init -b main
git add -A
git commit -m "Comment Markers for YouTube 1.0.0"
gh repo create comment-markers-for-youtube --public --source=. --push
```

Then in the repo: **Settings → Pages → Source: Deploy from a branch → main → /docs → Save.**

Your policy URL becomes `https://YOURNAME.github.io/comment-markers-for-youtube/privacy.html`.
Give Pages a minute, then open it and confirm it loads before you submit — a
dead privacy URL is a guaranteed rejection.

## 2. Developer account

[Developer Dashboard](https://chrome.google.com/webstore/devconsole) → sign in →
accept the agreement → pay the **one-time $5 fee**. Covers up to 20 extensions,
and it's per account, so use one you intend to keep.

## 3. Upload

**Add new item** → upload `comment-markers-for-youtube-1.0.0.zip`.

## 4. Fill the listing

Everything is written out in `store/STORE-LISTING.md`. Paste it field by field.
Upload both screenshots from `store/`.

## 5. Submit

Review is usually a few days, occasionally a few weeks. The narrow
`https://www.youtube.com/*` host permission and the single `storage` permission
work in your favour here — broad permissions are what trigger long reviews.

## 6. Later updates

Bump `"version"` in `manifest.json` (Chrome rejects re-uploads at the same
version), re-zip the extension files, upload to the same item.

```bash
zip -r -X comment-markers-for-youtube-1.0.1.zip manifest.json popup.html popup.js options.html options.js src icons
```
