# Luma Client — Website

A static landing page for Luma Client with a big Download button, feature
highlights, an AI Companion showcase, and the cape gallery. No build step —
just plain HTML/CSS/JS.

## 1. Hook up the real download link

The installer (`.exe`) is a large binary, so it isn't part of this website —
it needs to be hosted somewhere and linked to.

1. Build the installer from the project root:
   ```
   npm run dist
   ```
   This produces something like `dist/Luma Client Setup 1.0.0.exe`.

2. Upload that file somewhere with a stable, direct download URL. Easiest
   free options:
   - **GitHub Releases** — create a repo, then `gh release create v1.0.0 "dist/Luma Client Setup 1.0.0.exe"`.
     The download URL will look like
     `https://github.com/<you>/<repo>/releases/download/v1.0.0/Luma.Client.Setup.1.0.0.exe`.
   - **itch.io**, a CDN, or your own web host.

3. Open `config.js` in this folder and paste the URL in:
   ```js
   window.LUMA_DOWNLOAD = {
     url: 'https://github.com/you/luma-client/releases/download/v1.0.0/Luma-Client-Setup.exe',
     version: '1.0.0',
     platform: 'Windows 10 / 11 (64-bit)',
     approxSize: '250 MB'
   };
   ```
   Until you do this, the Download buttons show a friendly "not live yet"
   message instead of a dead link.

## 2. Deploy the site itself

This folder (`website/`) is a completely static site — drag-and-drop it onto
any of these (all have generous free tiers):

- **Netlify** — drag the `website` folder onto https://app.netlify.com/drop
- **Vercel** — `vercel deploy` from inside this folder
- **GitHub Pages** — push this repo to GitHub, then enable Pages and point it
  at the `website/` folder (or `/docs` if you rename it)
- **Cloudflare Pages** — connect the repo, set build output directory to
  `website`

No server, database or build tooling is required — it's just static files.

## 3. Preview locally

Any static file server works, for example:

```
npx serve website
```

or simply open `website/index.html` directly in a browser.

## Files

- `index.html` — page structure & content
- `styles.css` — Luma's purple/violet brand styling
- `config.js` — **edit this** to set the real download link, version, etc.
- `script.js` — wires `config.js` into the download buttons
- `assets/` — logo, hero art, and cape thumbnails (reused from the app)
