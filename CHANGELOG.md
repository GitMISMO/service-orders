# Service Orders Change Log

One line per change people would notice, newest first. Add a line with every new version (the
version name in brackets once versions began). Before October 2026 many changes were uploaded
without descriptions; the portal has been in use since early October 2026.

## 2026-11-08

- Publishing: a change is saved as a version in `releases/<version>/`, tried first as the Test Copy (resources.mismo.org/service-orders/releases/&lt;version&gt;/), and made live by Jonna with Actions › Publish a Version, which runs every check first; running it with an earlier version rolls back. No more uploading index.html by hand [20261108a]
- Automatic checks on every upload: scripts parse, no keys or tokens, saving is set right, every page has its safety list, the version is stamped, and browser checks of the whole order, review, drafts, sign-in, invoice and phone-app paths on made-up companies [20261108a]
- Each page has a safety list (Content-Security-Policy) naming the only places it may load code from or send data to: the save relay, Google Fonts, and the receipt reader's files [20261108a]
- Help ends with the version you are on; the Test Copy shows a tag in the header saying it is the Test Copy and that its saves are real [20261108a]
- How-it-works guide for whoever works on Service Orders next (DEVELOPING.md), and this change log

## 2026-11-07

- Approving an invoice or expense invoice emails MBA Accounts Payable "Invoice to Process" with the invoice PDF attached and Jonna copied, in the same words as MISMO Money's Email to Accounting
- New service orders name the Statement of Activities line they are paid from (required), so MISMO Money can put their invoices on that line

## 2026-11-06

- New Service Order drafts: Save as Draft, Your Drafts, open one again, delete, and send the chosen drafts together
- A requester's review comes back to Jonna in Needs You before anything goes to the VP; she sends one or all approved orders on; Raise This Order is now Send for Review; several new orders can be sent together, with one email per reviewer
- The VP's approval sends the order to the contracting company with Jonna copied; three weekly reminders follow, then a "still not accepted" email to Jonna; acceptance tells the President with Jonna copied and stops the reminders
- Anything left in [brackets] must be filled in by the requester; such an order cannot be approved as it is or sent straight to the VP
- Saved templates: save any order as a template; a Summit Workshop Facilitation template
- New Service Order starts from a template (DWG, CoP and every other kind of order on file), filling in the services, deliverables, rate and usual hours; the requester can change the details on the review page and send them back
- The Expenses phone app stays signed in for eight hours after it is closed, like Team HQ; Sign Out works in the app
- Sign-in: one wrong password counts once, not once per company key (people were being locked out after one or two tries); a locked account is told how to unlock it

## 2026-11-05

- Opening My Expenses on a phone opens the Expenses app (the iPhone fix Team HQ has)
- Review picker: staff with no email saved in Team HQ get their first initial and surname @mismo.org
- Contractor expenses the Team HQ way: receipts emailed to expense@mismo.org land in the contractor's own My Expenses, they submit all at once as an expense report, print it for their company, and the company sends a matching expense invoice
- Staff review for new service orders: the person who asked for an order reviews it on its own page before it goes on
- Saves merge into the newest copy instead of overwriting a teammate's changes

## 2026-11-04

- A review Actualize had already invoiced (June 2026) stays off its invoices

## 2026-11-02

- Hours Remaining: allotted, used and remaining hours for every service order, by company, facilitator and month

## 2026-11-01

- The Expenses phone app (install to the home screen) and the receipt reader that fills in the date, amount and place

## 2026-10-28

- Certification reviews on invoices: per-review billing for the firms that are paid per review, read from the Certification Management System; reviews already invoiced in MACTS stay off
- The hours table total shows hours only; reviews have their own total
- Reviews-only companies: an old period is not shown as overdue

## 2026-10-24 to 2026-10-25

- A sixth company was added to the portal's sign-in settings; it was taken out again in the October 28 upload, and the portal has five companies

## 2026-10-08

- The MISMO logo leads home and grows on hover, as on every other tool

## Early October 2026

- The portal moves to resources.mismo.org/service-orders/ on the save relay: service orders, e-signing by the company and the President, the VP's decisions, hours, invoices, MSA extension letters and executed documents
