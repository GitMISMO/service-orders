# Service Orders Checks

`npm test` checks the newest saved version in `releases/`; `node tests/run.js --version 20261108a`
checks another; `node tests/run.js "sign-in"` runs only the checks whose name contains those words.

- `harness.js` opens the page in a headless browser against a pretend sign-in and a pretend save
  relay (with real version clashes), serving the files from this repository. Nothing real is read
  or changed, and nothing outside is reached.
- `fixtures.js` is the made-up sample data: two invented companies, invented people, `.test`
  email addresses. This repository is public, so never put real names, figures or contacts here.
- `session-stub.js` stands in for the shared sign-in (`/assets/session.js`) for `review.html`.
- `run.js` holds the checks. When you add a feature, add a check for it here.

The checks run on GitHub on every upload (`.github/workflows/checks.yml`) and again before every
publish (`.github/workflows/publish.yml`).
