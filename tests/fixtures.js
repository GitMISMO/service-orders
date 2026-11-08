// Made-up sample data for the checks. This repository is PUBLIC: no real company names,
// people, amounts, rates or contacts ever go in here. Every company, person and figure
// below is invented, and every email address uses the reserved .test domain.
const FY = 'FY 2027';
function order(id, subject, hrs, rate, extra) {
  return Object.assign({ id, subject, estimatedHours: hrs, hourlyRate: rate, maximumFee: hrs * rate, feeType: 'hourly',
    msaFlavour: 'Consulting', fiscalYear: FY, contentHash: 'h' + id, recordHash: 'r' + id, startDate: '10/01/26',
    endDate: '09/30/27', services: ['Do the agreed work'], deliverables: ['A short report'], description: 'Sample order' }, extra || {});
}
const companies = {
  northwind: { key: 'so-northwind', company: 'Northwind Facilitation LLC',
    signer: { name: 'Sam Signer', title: 'Director', email: 'sam@northwind.test' },
    people: [
      { slug: 'casey-c', name: 'Casey Contractor', email: 'casey@northwind.test', orders: ['n1'], logsTime: true, expenses: true, canInvoice: false },
      { slug: 'drew-d', name: 'Drew Doe', email: 'drew@northwind.test', orders: ['n2'], logsTime: true, expenses: true },
      { slug: 'sam-s', name: 'Sam Signer', email: 'sam@northwind.test', orders: [], logsTime: false, canInvoice: true } ],
    orders: [
      order('n1', 'FY 2027 Sample Data Workgroup Facilitation', 40, 100, { category: 'Facilitation Existing DWG', template: 'Workgroup Facilitation - Work Product' }),
      order('n2', 'FY 2027 Sample Practice Community of Practice Facilitation', 30, 100, { category: 'Facilitation Existing CoP', template: 'Workgroup Facilitation - Community of Practice' }) ] },
  bluebird: { key: 'so-bluebird', company: 'Bluebird Review Partners LLC',
    signer: { name: 'Blair Bird', title: 'Partner', email: 'blair@bluebird.test' },
    people: [ { slug: 'blair-b', name: 'Blair Bird', email: 'blair@bluebird.test', orders: ['b1'], logsTime: true, expenses: true } ],
    orders: [ order('b1', 'FY 2027 Sample Review Services', 20, 90) ] }
};
const STAFF = {
  admin:     { name: 'Alex Admin', email: 'alex@mismo.test' },
  vp:        { name: 'Victor Vee', title: 'VP of Programs and Operations', email: 'victor@mismo.test' },
  president: { name: 'Pat President', title: 'President', email: 'pat@mismo.test' },
  reviewer:  { name: 'Riley Reviewer', email: 'riley@mismo.test' }
};
function ordersFile(slug) {
  const c = companies[slug];
  return { company: c.company, slug, fiscalYear: FY, coverAll: false, orders: c.orders, people: c.people,
    letters: [{ msaFlavour: 'Consulting', signer: { name: c.signer.name, title: c.signer.title }, extendTo: '09/30/27', address: ['1 Sample Street'], salutation: 'Dear ' + c.signer.name }],
    signers: { order: c.signer }, vpProduct: STAFF.vp, mismoSigner: STAFF.president };
}
function hoursCopy(slug) {
  const F = ordersFile(slug);
  return { company: F.company, slug, fiscalYear: FY, coverAll: false,
    orders: F.orders.map(o => ({ id: o.id, subject: o.subject, estimatedHours: o.estimatedHours, fiscalYear: FY })),
    people: F.people, letters: [], signers: { order: {} } };
}
function seed() {
  const S = {};
  for (const slug of Object.keys(companies)) {
    const k = companies[slug].key;
    S[k + '|orders/' + slug + '.json'] = ordersFile(slug);
    S[k + '|orders-public/' + slug + '.json'] = hoursCopy(slug);
    S[k + '|signatures/' + slug + '.json'] = { signatures: companies[slug].orders.map(o => ({ orderId: o.id, step: 'MISMO Signer', decision: 'Approved',
      contentHash: o.contentHash, recordHash: o.recordHash, rev: 0, signedOn: '2026-10-02T00:00:00Z', by: STAFF.president.name })) };
  }
  S['team-hq|data/people.json'] = { docs: {
    p1: { id: 'p1', name: STAFF.admin.name, email: STAFF.admin.email },
    p2: { id: 'p2', name: STAFF.reviewer.name, email: STAFF.reviewer.email } } };
  return S;
}
// What the page's window.RELAY says during the checks: the made-up companies only.
const RELAY_CONFIG = {
  projects: ['so-northwind', 'so-bluebird', 'so-northwind-hours', 'so-bluebird-hours'],
  slugs: { 'so-northwind': 'northwind', 'so-bluebird': 'bluebird', 'so-northwind-hours': 'northwind', 'so-bluebird-hours': 'bluebird' },
  lite: ['so-northwind-hours', 'so-bluebird-hours']
};
module.exports = { companies, seed, FY, STAFF, RELAY_CONFIG };
