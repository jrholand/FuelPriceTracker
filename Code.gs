// Fuel price tracker (Google Apps Script), bound to the "KMIC Fuel Prices" sheet.
// Every tab with an AirNav URL in row 1 and an airport ID in row 2 is tracked:
// row 3 is the header and a row is added only when a fuel price changes or
// can't be found. Emails an alert only in the latter case. The URL can be an
// FBO page (airnav.com/airport/KMIC/A1) or an airport page (airnav.com/airport/KANE),
// in which case every FBO listed under "FBO, Fuel Providers" is tracked.

const ALERT_TO = ''; // blank = the Google account that owns the trigger
const RUN_HOUR = 8;  // local hour (project time zone, America/Chicago)
const HEADER_ROW = 3;
const HEADER = ['date_checked', 'fbo', 'fuel', 'service', 'price_usd', 'airnav_updated', 'note'];
const SERVICES = { self: 'SS', full: 'FS', assisted: 'AS' };
const DATE_RE = '(\\d{1,2}-[A-Za-z]{3}-\\d{4})';

// Parses an AirNav FBO page into { fbo, prices: { 'fuel|service': { fuel, service, price, updated } } }.
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
  const title = html.match(/<title>\s*AirNav:\s*([\s\S]+?)\s+at\s/i);
  return { fbo: title ? title[1].trim() : '', prices };
}

// FBO page URLs listed in an airport page's "FBO, Fuel Providers" section.
function fboLinks_(html, url) {
  const start = html.search(/FBO, Fuel Providers/i);
  if (start < 0) return [];
  const end = html.slice(start).search(/Aviation Businesses, Services/i);
  const section = html.slice(start, end < 0 ? undefined : start + end);
  const origin = url.match(/^https?:\/\/[^/]+/i)[0];
  const links = [...section.matchAll(/href="(\/airport\/[^/"]+\/[A-Za-z0-9_-]+)"/g)]
    .map(m => m[1])
    .filter(p => !/\/(update-fuel|reportlinks)$/i.test(p));
  return [...new Set(links)].map(p => origin + p);
}

function fetchHtml_(url) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) Utilities.sleep(10000);
    try {
      const res = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'fuel-price-tracker (personal, once a day)' },
      });
      const code = res.getResponseCode();
      if (code !== 200) throw new Error(`AirNav returned HTTP ${code} for ${url}`);
      return res.getContentText();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// Returns { prices: { 'fbo|fuel|service': {...} }, errors: [] } for an FBO or airport page URL.
function fetchPrices_(url) {
  const isAirportPage = /\/airport\/[^/?#]+\/?(?:[?#].*)?$/i.test(url);
  const html = fetchHtml_(url);
  const pages = isAirportPage ? fboLinks_(html, url) : [url];
  if (isAirportPage && !pages.length) throw new Error('No FBOs listed on this airport page');
  const prices = {}, errors = [];
  pages.forEach((page, i) => {
    try {
      if (i) Utilities.sleep(2000);
      const parsed = parse_(page === url ? html : fetchHtml_(page));
      for (const p of Object.values(parsed.prices)) prices[`${parsed.fbo}|${p.fuel}|${p.service}`] = { fbo: parsed.fbo, ...p };
    } catch (e) {
      errors.push(e.message);
    }
  });
  if (!Object.keys(prices).length) {
    throw new Error(errors[0] || 'No prices found; check the URL in row 1, or the page layout may have changed');
  }
  return { prices, errors };
}

// Reads row 1 (URL) and row 2 (airport ID). Each may be in column A, or in B with a label in A.
function tabConfig_(sheet) {
  if (sheet.getLastRow() < 2) return null;
  const [row1, row2] = sheet.getRange(1, 1, 2, 3).getDisplayValues();
  const url = row1.map(v => v.trim()).find(v => /^https?:\/\//i.test(v));
  const id = row2.map(v => v.trim()).filter(Boolean).pop();
  return url && id ? { url, id: id.toUpperCase() } : null;
}

// Most recent price logged for each fbo|fuel|service on a tab, skipping "price not found" rows.
function lastPrices_(sheet) {
  const last = {};
  const n = sheet.getLastRow() - HEADER_ROW;
  if (n < 1) return last;
  for (const [, fbo, fuel, service, price] of sheet.getRange(HEADER_ROW + 1, 1, n, 5).getValues()) {
    if (fuel !== '' && price !== '') last[`${fbo}|${fuel}|${service}`] = { fbo, fuel, service, price: Number(price).toFixed(2) };
  }
  return last;
}

function trackTab_(sheet, { url }, today) {
  sheet.getRange(HEADER_ROW, 1, 1, HEADER.length).setValues([HEADER]);
  sheet.getRange(HEADER_ROW + 1, HEADER.indexOf('price_usd') + 1, sheet.getMaxRows() - HEADER_ROW, 1)
    .setNumberFormat('$#,##0.00');
  const prev = lastPrices_(sheet);
  let prices = {}, errors = [], error = '';
  try {
    ({ prices, errors } = fetchPrices_(url));
  } catch (e) {
    error = e.message;
  }

  const rows = [];
  const missing = [];
  for (const [key, p] of Object.entries(prices)) {
    const row = [today, p.fbo, p.fuel, p.service, Number(p.price), p.updated];
    if (!prev[key]) rows.push([...row, 'first price']);
    else if (prev[key].price !== p.price) rows.push([...row, `changed from $${prev[key].price}`]);
  }
  for (const [key, p] of Object.entries(prev)) {
    if (prices[key]) continue;
    missing.push(`${p.fbo} ${p.fuel} (${p.service})`);
    rows.push([today, p.fbo, p.fuel, p.service, '', '', `price not found${error ? ': ' + error : ''}`]);
  }
  if (error && !Object.keys(prev).length) rows.push([today, '', '', '', '', '', `price not found: ${error}`]);
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
  console.log(`${sheet.getName()}: ${rows.length ? JSON.stringify(rows) : 'no change'}`);

  if (error) return error;
  const problems = [...errors];
  if (missing.length) problems.push(`No price found for: ${missing.join(', ')}`);
  return problems.join('; ');
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
