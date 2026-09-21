# iii demos

One static website. Each demo lives in its own subfolder and is reachable from
the root landing page.

- `index.html` - landing page linking to every demo
- `space/` - Space Sim (two builds, iii + claude, on one selectable page)
- `.nojekyll` - GitHub Pages serves files verbatim

## Local dev

```bash
npm install
npm run dev
```

Vite serves the whole tree from the repo root, so the landing page and every
demo subfolder are all available under one dev server. New demos are picked up
automatically - just add a `<demo>/` folder with its own `index.html` and link
to it from the root `index.html`.

## Publishing (GitHub Pages)

Settings -> Pages -> deploy from `main`, folder `/ (root)`. Live at
`https://iii-hq.github.io/demos/`.
