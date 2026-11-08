# Working on Service Orders

Read this whole file before changing anything. It is written so a Claude that has never seen
Service Orders can work on it safely. The owner is **Jonna Critchley** (Director of Programs &
Operations, MISMO).

- **For people using the portal**, the guide is the **Help** page inside it (`helpFor()` in
  `index.html`, one version per kind of person). Help is not this guide, and this guide is not Help.
- **When a feature changes, update both in the same change**: Help for the people who use it, this
  file for whoever works on it next, and a line in `CHANGELOG.md`.
- Also follow the `mismo-connected-systems` rules: stay in your lane, every connection is in the
  MISMO Connections Map, never overwrite newer work, keep the safety net working.

## What It Does and Who Uses It

The Service Orders and Agreements portal, live at **https://resources.mismo.org/service-orders/**.
It holds MISMO's service orders with its contracting companies (the firms whose people facilitate
workgroups, run certifications and do other work for MISMO), and everything that hangs off them:
signing, hours, invoices, expenses and the Master Services Agreement (MSA) extension letters.

| Who | What they see (their Help page) |
| --- | --- |
| **Jonna** (admin; Vanessa can be too) | Everything, across every company: Needs You, Send Orders, Time Submitted, Invoices, Contractor Expenses, Hours Remaining, New Service Order, Revise an Order, End a Service Order, Executed Documents, Company Details, View As, the Status Board |
| **The VP** (Jonathan Kearns) | Awaiting Your Decision: approves (which sends the order to the company) or holds each order; Already Decided |
| **The President** (Brian Vieaux) | Awaiting Your Approval: approves accepted orders, singly or by company; Already Approved |
| **A contracting company's signer or time manager** (one company key) | Its own company only: To Review (accept or ask a question), My Service Orders, the company's month and weeks of hours, My Invoices, My Agreements |
| **A contractor** (hours-only key) | Only their own hours and expenses: My Hours, My Submitted Time, When I Am Away, My Expenses. **Never money** (Decision 26): no rate, no maximum fee, no totals, not even the order document, because the rate is written on it. Their rates never even reach their browser: an hours-only key can read only `orders-public/` |
| **A staff member who asked for a new order** | Only `review.html`, from the email: fill in [bracketed] gaps, change details, approve or send changes back |

Each company sees only its own work because each company's data is a **separate private
repository**, reached with that company's own relay key. A person with one company's key cannot
read another company's files at all; this is enforced by the relay, not by the page.

How a role is decided (`session()` in the relay module of `index.html`): only hours-only keys →
contractor; one company → that company's person; several companies → MISMO staff, and then the
signed-in email is matched against the `vpProduct` and `mismoSigner` in the orders file to tell the
VP and the President from the admin.

## Where Everything Lives

**This repository is public and holds no data.** Never commit a data file, a real company's
figures, a token or a password here. The checks look for keys and tokens on every upload.

| File | What it is |
| --- | --- |
| `index.html` | The whole portal, one file (about 14,600 lines): styles, the relay module, every screen, Help. **Live copy only: never edit it by hand** (see Making a Change). |
| `review.html` | The staff review page for new orders. **Built, not hand-edited**: `python3 tools/make_review.py releases/<v>/index.html releases/<v>/review.html` copies the theme, logo and version from `index.html`. Uses the shared sign-in (`/assets/session.js`) and Team HQ access, because every staff member has Team HQ and not every one has a company key. |
| `expenses-app.js` | The Expenses phone app layer, loaded by `index.html`: the phone-only My Expenses screen (`?app=expenses`), the install tip, the camera/receipt reader (Tesseract, from cdn.jsdelivr.net, falling back to the relay's ask route), and the eight-hour stay-signed-in on a phone. |
| `expenses.webmanifest`, `xp-icon-*.png` | What a phone needs to install the Expenses app on its home screen. |
| `releases/<version>/` | Every saved version, whole. Each one is also its **Test Copy** at `resources.mismo.org/service-orders/releases/<version>/`. |
| `LIVE` | The version that is live now (written by Publish a Version). |
| `tools/new-version.sh` | Starts a new version folder from the live one. |
| `tools/make_review.py` | Builds `review.html` from `index.html`. |
| `tests/` | The automatic checks (see The Checks). |
| `.github/workflows/checks.yml` | Runs the checks on every upload. |
| `.github/workflows/publish.yml` | **Publish a Version**: checks a saved version, then makes it live (or rolls back). |
| `CHANGELOG.md` | One line per change people would notice, newest first. |

### The data

- **Each company has its own private repository** `GitMISMO/so-<company>-data`, reached only through
  Perry's **save relay** (`https://rgvdi67cg27o5kcmiytcqbqnrm0hmztx.lambda-url.us-east-1.on.aws`).
  The relay keys are in `window.RELAY` near the top of `index.html`: a full key `so-<company>` and an
  hours-only key `so-<company>-hours` for each company, and `slugs` mapping each key to the
  company's file name (`phoenixteam`, `actualize`, `trex`, `falcon`, `trudigital`). **A new company is
  a change there and in the relay's projects.json, and nowhere else.**
- Inside each company repository:

| Path | What | Written by |
| --- | --- | --- |
| `orders/<slug>.json` | The generated service orders, signers, VP, President, MSA letters, people | The order generator, outside this repo. **Read-only to the page**, so a company cannot rewrite its own rate. `fy26-orders.json` (the source of the 57 FY26 order PDFs) is never modified. |
| `orders-public/<slug>.json` | The rate-free copy hours-only people read | The portal, from `orders/` |
| `revisions/<slug>.json` | Revisions to orders, new orders raised in the portal (`additions`, with their `review`), send dates (`sent`), company details | The portal |
| `signatures/<slug>.json` | Every acceptance, question, VP decision and President approval, with a snapshot of the order as signed | The portal |
| `notify/<slug>.json` | The email queue (see Connections) | The portal; the email flow marks them sent |
| `hours/<person>-fy<year>.json` | A person's weeks of hours and their expenses; `hours/receipts/` holds receipt files | The person, their time manager, and Team HQ's expense router |
| `invoices/<slug>.json`, `invoices/files/<slug>-<id>.pdf` | Invoices and expense invoices with their PDFs | The company's signer; Jonna's decisions |
| `agreements/<slug>.json`, `agreements/<slug>/<msa>-fy2027.pdf` | Executed MSA extensions from DocuSign | Jonna |

- **In Team HQ's data** (`team-hq-data`, relay key `team-hq`, records reached with `readData`/`updateData`):
  `soreviews` (staff reviews of new orders), `sotemplates` (saved New Service Order templates),
  `sodrafts` (Jonna's New Service Order drafts), and the portal reads `people` (staff names and emails
  for the reviewer list; no email saved → first initial + surname @mismo.org). Team HQ itself does not
  read the three `so…` records. Do not move or rename them without telling Team HQ's Claude.
- **The Certification Management System's assessor repositories** (key `as-<slug>`): the portal reads
  `engagements/<slug>.json` for per-review invoicing (see Connections). Optional: if it cannot be
  read, invoices stay hours-only and say why.

### How saving works (do not weaken this)

- Every write goes through the relay module (`window.MISMO_RELAY`, the `R` object). `R.update`
  reads the newest copy, applies **only this change**, and commits with the version it read
  (`parentSha`); if a teammate saved in between, the relay refuses (409) and the change is
  re-applied on top of theirs. Team HQ records use `updateData`, which does the same with the file
  version. **Never write a whole file you read earlier**: always pass a change function.
- Nothing is deleted: ended orders, taken-back invoices, withdrawn reviews and removed templates
  are kept with a state, not removed.
- **View As** never saves: every write is refused while viewing as someone (`refuse()` near the
  top of the main script).

## Sign-In, Lockouts and View As

- `index.html` has **its own sign-in** (not the shared `session.js`): `loginAny()` tries each key in
  `window.RELAY.projects` with `POST /<key>/auth/login` until one works; the token covers every key
  the person holds. The session is kept in `sessionStorage` (`resources:service-orders:session`)
  and ends when the tab closes or after eight hours.
- **A wrong password counts once.** A 401 stops at once instead of trying the next key (the relay
  locks an account after five wrong passwords, and trying every key used to lock people out after
  one or two tries). A 423 (locked) shows "Your account is locked…" with a link to
  `/reset-password.html`. Jonna can also unlock someone in the Admin Console. The checks test both.
- **The Expenses phone app** (`?app=expenses`, or the installed home-screen app) keeps the session in
  `localStorage` (`app-session`) for eight hours so closing the app does not sign the person out;
  Sign Out clears both.
- **View As** (Setup › View As): Jonna sees exactly what a company person, a contractor, the VP or the
  President sees, read-only. Use it to check a change from someone else's side.
- `review.html` uses the shared resources.mismo.org sign-in and needs Team HQ access.

## How a Change Goes Live, and How to Roll Back

**Never upload `index.html`, `review.html` or `expenses-app.js` at the top of the repo by hand.**
Every change is a saved version:

1. **Start from the live copy.** `git fetch` and work on `origin/main`. Never upload an older copy
   over a newer one (other Claudes change this repo too; check `git log` first).
2. **Make a new version**: `tools/new-version.sh 20261109a` (the date and a letter; it copies the
   version in `LIVE` into `releases/20261109a/`, stamps the version and rebuilds `review.html`).
3. **Edit the files in `releases/<version>/`.** If you changed `index.html`, run
   `python3 tools/make_review.py releases/<v>/index.html releases/<v>/review.html` again.
4. **Update Help** (in `index.html`) and **this guide** if the feature changed, and add a line to
   `CHANGELOG.md` ending with `[<version>]`.
5. **Run the checks**: `npm install` once, then `npm test` (checks the newest version) or
   `node tests/run.js --version <v>`. All must pass. Add a check for a new feature.
6. **Upload** the new `releases/<version>/` folder (and any changed `tests/`, `CHANGELOG.md`,
   `DEVELOPING.md`) to `main`. The checks run on GitHub; a failure emails the uploader.
7. **Try the Test Copy**: `https://resources.mismo.org/service-orders/releases/<version>/`. It is the
   real portal on the real data (a banner says so), so try it carefully; anything saved there is saved
   for real. Emails it queues are real emails.
8. **Jonna publishes it**: GitHub › GitMISMO/service-orders › Actions › **Publish a Version** › Run
   workflow › the version. It runs every check against that version and only then copies it to the
   top of the repo and writes `LIVE`. GitHub Pages republishes within a minute or two.

**To roll back**, run Publish a Version again with the earlier version (see `LIVE`'s history or
`releases/`). In an emergency, tick *publish without running the checks*.

## The Checks

`npm test` (`tests/run.js`) checks the newest saved version; `--version <v>` checks another.

- **Without a browser**: every script parses; no keys, tokens or passwords anywhere in the repo;
  saving is set right (`window.RELAY` points at the relay with only `so-` keys, hours-only keys
  listed as such, `update`/`updateData`/`review.html` retry on a version clash, every save goes
  through the relay module); every page has its safety list; the version is stamped and the live
  page is a saved version, not a hand upload; the sample data is made up.
- **In a browser** (`tests/harness.js`: a pretend sign-in and a pretend relay with real version
  clashes; `tests/fixtures.js`: two made-up companies, Northwind Facilitation and Bluebird Review
  Partners, with .test email addresses): every screen for staff, VP, President, a company and a
  contractor opens without errors; Help shows the version and the Test Copy banner shows; a wrong
  password counts once and a locked account is told how to unlock; a save on an out-of-date copy
  merges; a new order goes requester › Jonna › VP › company › President with reminders scheduled
  and stopped; drafts save, reopen and send; an approved expense invoice queues the accounts
  payable email with its PDF and Jonna copied; the Expenses phone app opens.
- **This repository is public: no real company names, people, amounts, rates or contacts in tests.**

## The Page Safety List

Each page has a `Content-Security-Policy` naming the only places it may load code from or send data
to. `index.html`: the save relay, Google Fonts, and the receipt reader's files (`cdn.jsdelivr.net`
and `tessdata.projectnaptha.com`, with `'wasm-unsafe-eval'` for its WebAssembly). `review.html`: the
relay and Google Fonts. A new outside service must be added to the page's list **and** to
`SAFETY_LIST` in `tests/run.js`, or the checks fail; a blocked request shows in the browser console
as "Blocked by the page safety list".

## Connections

Every connection is in the **MISMO Connections Map** (Claude Doc `UcBYh3aakukXcjYvjnWBY7`). Read
it before changing one and update your rows in the same session. Service Orders' rows:

**Email (out).** The portal cannot send email. It queues a notice in `notify/<slug>.json`, and the
Power Automate flow **MISMO Service Orders - Send Notifications** (Jonna's account, hourly) sends
each one from Jonna's mailbox as the branded email (`/assets/email-shell.html`) with a button, then
marks it sent. A notice's fields: `kind`, `company`, `orderId`/`orderIds`, `title`, `said`, `to`,
`cc`, `forAttentionOf`, `cta {text, url}`, `file` (a PDF to attach), `sent` (`false`, or
`"scheduled"` with `notBefore` for reminders), `sentOn`. **Add fields; never rename or remove one**:
the flow reads them. The flow holds a GitHub key (`gh1token`) to read and write the notify files and
fetch invoice PDFs; it is in the flow, never in this repo.

| Email | To | Copied |
| --- | --- | --- |
| Review request (one email for several orders) | The staff member who asked | |
| Requester approved / sent changes | Jonna | |
| Orders for a decision | The VP | |
| Held, question raised, revised | Jonna / the VP | |
| Order sent to the company (on the VP's approval) | The company's signer | Jonna |
| Reminders 1, 2 and 3 weeks later; "still not accepted" at 4 weeks | The signer; then Jonna | |
| Accepted, ready for approval | The President | Jonna |
| Invoice and expense steps (received, approved, sent back, paid; hours sent back) | The company / contractor | |
| **Invoice to Process**, with the invoice PDF attached | MBA Accounts Payable (Accounts.Payable@mortgagebankers.org) | Jonna |

When a company accepts or asks a question, the portal strikes that order off its waiting reminders.

**Other connections.**

| From | To | What | Where |
| --- | --- | --- | --- |
| Service Orders | MMS Daily Digest (GitHub) | Facilitators' hours by week | `so-<company>-data` `hours/` (read by the digest with `MMS_DATA_TOKEN`) |
| Service Orders | MISMO Money | Approved invoices with PDFs and paid dates; approved hours on the eEligibility orders for the Snapdocs invoice; each new order's Statement of Activities line (`soaLine`) | MISMO Money reads `invoices/<slug>.json` and `hours/` with the person's own sign-in when someone with Edit opens it; it never writes here. Its company list is `PORTAL_COMPANIES` in MISMO Money's engine |
| Service Orders | Service Order Review page | New orders for their requester | `team-hq/data/soreviews` |
| expense@mismo.org (through Team HQ Expenses) | Service Orders | Contractors' emailed receipts, matched by email, mismo.org first-initial-and-surname address, or name | Team HQ's router writes the receipt and the contractor's hours file into `so-<company>-data`, while Jonna's or Vanessa's Team HQ is open |
| Certification Management System | Service Orders | Finished certification reviews and the fee for each, for per-review invoices (the firms paid per review, and the mixed hours-and-reviews invoices) | `engagements/<slug>.json` in the firm's assessor repository (built by cms-data's `build-engagements.js`), read with the `as-<slug>` key. A review is billed once; reviews invoiced before the portal (in MACTS) are listed in `REVIEWS_BILLED_BEFORE` by CMS row, never by company name |
| DocuSign | Service Orders (by hand) | Executed MSA extensions | Jonna downloads the blank letter (Executed Documents), sends it through DocuSign herself, and uploads the whole signed output (with the Certificate of Completion) and the envelope ID; it lands in the company's My Agreements |
| Aptify | none | Service Orders has no Aptify connection; certification fees are invoiced in Aptify by the Certification Management System, and MISMO Money reconciles Aptify | |

## Rules and Decisions Jonna Has Made

**The order's path** (Nov 6, 2026):

1. A new order goes first to the staff member who asked for it.
2. Anything in [brackets] must be filled in by them; it cannot be approved as it is.
3. Approved or changed, it comes back to Jonna in Needs You.
4. Jonna sends it (one or all) to the VP.
5. The VP's approval sends it to the company, with Jonna copied, and three weekly reminders follow, then a "still not accepted" email to Jonna.
6. Once the company accepts, it goes to the President with Jonna copied.

Every email is the branded email with a button. The button is **Send for Review**, never "Raise".

**Orders.**
- **Decision 33**: only the binding terms bring an order back for signing again (rate, hours, maximum fee, fee type, dates, Services, Deliverables, the MSA, the parties, what MISMO provides, agreed modifications, the standing text). A binding revision un-sends a sent order.
- **Decision 36**: Section V says "MISMO Tools and Resources"; invoices are priced per service order, never per person.
- **Decision 31**: the fiscal-year picker appears once a second year exists.
- New orders name the Statement of Activities line they are paid from.

**Templates and drafts.**
- New Service Order starts from a template: every kind of order on file, worked out from the orders when the page opens (never typed into this public page), plus templates Jonna saves.
- The Summit Workshop Facilitation template is for orders that come up at about every summit.
- Drafts stay until sent or deleted.

**Money.**
- **Decision 26**: a contractor sees hours, never money.
- **Decision 40**: a missed week can be filled in until its month is invoiced.
- Falcon invoices per review, not hours, and MISMO pays those monthly.
- Actualize invoices hours plus any certification assessments on the same invoice.
- A review is billed once.
- Approving an invoice emails accounts payable with the PDF, Jonna copied. Jonna is not copied on the approval emails to the companies.
- Submitters get "received" and "sent to accounts payable" emails.

**Expenses.**
- Contractors' expenses work like Team HQ Expenses: they email receipts to expense@mismo.org, and the receipts land in that contractor's own My Expenses.
- They submit all their expenses at once as an expense report, and print it for their company.
- The company sends a separate expense invoice that matches the report.
- Meghan Tidgewell manages her company's people's time (time manager, full access).

**Hours.** Hours Remaining shows allotted, used and remaining hours per order, filterable by company, facilitator and date range, so Jonna can say how many hours an order has left.

**Page style.**
- MISMO navy and sky, IBM Plex Sans throughout.
- Title Case headings and buttons, in plain words.
- Squared-off buttons and tags, never pill shapes (circles are fine). Buttons never wrap (`white-space:nowrap; min-width:max-content`).
- No big empty spaces.
- A record opens in the right-hand panel.

**Never email anyone, or change a Power Automate flow, without Jonna's OK.** Test emails go to Jonna only.

**Stay in your lane.**
- Edit only Service Orders. If another system needs something, put it where that system already reads, or tell Jonna which system's Claude must change.
- Never put a token, key or password in the page, the repo or a doc. Jonna signs in herself.
