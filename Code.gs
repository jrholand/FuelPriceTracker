// Fuel price tracker (Google Apps Script), bound to the "KMIC Fuel Prices" sheet.
// Every tab with an AirNav FBO page URL in row 1 and an airport ID in row 2 is
// tracked: row 3 is the header and a row is added only when a fuel price
// changes or can't be found. Emails an alert only in the latter case.

const ALERT_TO = ''; // blank = the Google account that owns the trigger
const RUN_HOUR = 8;  // local hour (project time zone, America/Chicago)
const HEADER_ROW = 3;
const HEADER = ['date_checked', 'fuel', 'service', 'price_usd', 'airnav_updated', 'note'];
const SERVICES = { self: 'SS', full: 'FS', assisted: 'AS' };
const DATE_RE = '(\\d{1,2}-[A-Za-z]{3}-\\d{4})';

// Parses an AirNav FBO page into { 'fuel|service': { fuel, service, price, updated } }.
function parse_(html) {
  const toText = s => s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const page = toText(html).match(new RegExp(`(?:last reported on|Updated)\\s+${DATE_RE}`, 'i'));
  const prices = {};
  for (const tr of html.split(/<tr\b/i).slice(1)) {
    const m = toText('<' + tr).match(/^(.{1,40}?)\s+(Self|Full|Assisted) service\s+\$(\d+\.\d{2})\b(.*)$/i);
    if (!m) continue;
    const fuel = m[1], service = SERVICES[m[2].toLowerCase()];
    const reported = m[4].match(new RegExp(`Reported\\s+${DATE_RE}`, 'i'));
    prices[`${fuel}|${service}`] = { fuel, service, price: m[3], updated: reported ? reported[1] : page ? page[1] : '' };
  }
  return prices;
}

function fetchPrices_(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) Utilities.sleep(10000);
    try {
      const res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'fuel-price-tracker (personal, 1 req/day per airport)' },
      });
      const code = res.getResponseCode();
      if (code !== 200) throw new Error(`AirNav returned HTTP ${code}`);
      const prices = parse_(res.getContentText());
      if (!Object.keys(prices).length) throw new Error('No prices found; check that row 1 is an AirNav FBO page URL, or the page layout may have changed');
      return prices;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Reads row 1 (URL) and row 2 (airport ID). Each may be in column A, or in B with a label in A.
function tabConfig_(sheet) {
  if (sheet.getLastRow() < 2) return null;
  const [row1, row2] = sheet.getRange(1, 1, 2, 3).getDisplayValues();
  const url = row1.map(v => v.trim()).find(v => /^https?:\/\//i.test(v));
  const id = row2.map(v => v.trim()).filter(Boolean).pop();
  return url && id ? { url, id: id.toUpperCase() } : null;
}

// Most recent price logged for each fuel|service on a tab, skipping "price not found" rows.
function lastPrices_(sheet) {
  const last = {};
  const n = sheet.getLastRow() - HEADER_ROW;
  if (n < 1) return last;
  for (const [, fuel, service, price] of sheet.getRange(HEADER_ROW + 1, 1, n, 4).getValues()) {
    if (fuel !== '' && price !== '') last[`${fuel}|${service}`] = { fuel, service, price: Number(price).toFixed(2) };
  }
  return last;
}

function trackTab_(sheet, { url }, today) {
  sheet.getRange(HEADER_ROW, 1, 1, HEADER.length).setValues([HEADER]);
  const prev = lastPrices_(sheet);
  let prices = {}, error = '';
  try {
    prices = fetchPrices_(url);
  } catch (e) {
    error = e.message;
  }

  const rows = [];
  const missing = [];
  for (const [key, p] of Object.entries(prices)) {
    if (!prev[key]) rows.push([today, p.fuel, p.service, Number(p.price), p.updated, 'first price']);
    else if (prev[key].price !== p.price) rows.push([today, p.fuel, p.service, Number(p.price), p.updated, `changed from $${prev[key].price}`]);
  }
  for (const [key, p] of Object.entries(prev)) {
    if (prices[key]) continue;
    missing.push(`${p.fuel} (${p.service})`);
    rows.push([today, p.fuel, p.service, '', '', `price not found${error ? ': ' + error : ''}`]);
  }
  if (error && !Object.keys(prev).length) rows.push([today, '', '', '', '', `price not found: ${error}`]);
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
  console.log(`${sheet.getName()}: ${rows.length ? JSON.stringify(rows) : 'no change'}`);

  return error || (missing.length ? `No price found for: ${missing.join(', ')}` : '');
}

function sendAlert_(problems, ss) {
  const to = ALERT_TO || Session.getEffectiveUser().getEmail();
  const ids = problems.map(p => p.id).join(', ');
  const body = problems.map(p => `${p.id}: ${p.message}\n${p.url}`).join('\n\n');
  MailApp.sendEmail(to, `Fuel tracker: could not retrieve prices (${ids})`, `${body}\n\nSheet: ${ss.getUrl()}`);
}

// Helpers end in _ so the editor's Run menu only lists track and setup.

// Daily entry point (run by the trigger that setup() creates).
function track() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const problems = [];
  let fetched = 0;
  for (const sheet of ss.getSheets()) {
    const config = tabConfig_(sheet);
    if (!config) {
      console.log(`${sheet.getName()}: skipped (needs a URL in row 1 and an airport ID in row 2)`);
      continue;
    }
    if (fetched++) Utilities.sleep(2000);
    let message;
    try {
      message = trackTab_(sheet, config, today);
    } catch (e) {
      message = e.message;
    }
    if (message) problems.push({ ...config, message });
  }
  if (problems.length) sendAlert_(problems, ss);
}

// Run once by hand: authorizes the script and installs the daily trigger.
function setup() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'track') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('track').timeBased().everyDays(1).atHour(RUN_HOUR).create();
}
