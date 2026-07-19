# gym-log

Personal gym-logging PWA, served via GitHub Pages at
https://curtisnn.github.io/gym-log/. App code only — workout data lives in a
separate private repo and syncs via the GitHub Contents API.

Vanilla ES modules, no build step.

- `js/logic.js` — pure session/model logic (pre-fill, progression axis, finish)
- `js/store.js` — localStorage persistence
- `js/app.js` — rendering and interactions
- `test/logic.test.js` — `npm test` (node --test)

Run locally: `npm run serve` → http://localhost:8080/

First run shows an import screen: paste the contents of `data.json` from the
private data repo. Data stays in localStorage on the device; GitHub backup is
the durability layer (wired separately).
