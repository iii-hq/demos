# Space Sim — combined

Static site that hosts two builds of the game on one page, selectable and loaded
dynamically into an iframe.

- `index.html` — landing page + build switcher (deep links: `#iii`, `#claude`)
- `iii/` — Star Fighter build (`index.html` + `game.js`)
- `claude/` — Pixel Brawl build (single `index.html`)
- `.nojekyll` — tells GitHub Pages to serve files verbatim

This folder is fully self-contained and safe to publish — no engine data,
secrets, or `.env` files. Everything is static; no build step required.
