// Fuel price tracker (Google Apps Script), bound to the "KMIC Fuel Prices" sheet.
// Every tab with an airport ID in row 2 (and optionally an AirNav URL in row 1) is tracked:
// row 3 is the header and a row is added only when a fuel price changes or
// can't be found. Emails an alert only in the latter case. The URL can be an
// FBO page (airnav.com/airport/KMIC/A1) or an airport page (airnav.com/airport/KANE),
// in which case every FBO listed under "FBO, Fuel Providers" is tracked, from its own
// page when that lists prices, otherwise from the airport page's price grid.

const ALERT_TO = ''; // blank = the Google account that owns the trigger
const RUN_HOUR = 8;  // local hour (project time zone, America/Chicago)
const HEADER_ROW = 3;
const HEADER = ['date_checked', 'fbo', 'fuel', 'service', 'price_usd', 'airnav_updated', 'note'];
const SERVICES = { self: 'SS', full: 'FS', assisted: 'AS' };
const DATE_RE = '(\\d{1,2}-[A-Za-z]{3}-\\d{4})';

function text_(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Parses an AirNav FBO page into { fbo, prices: { 'fuel|service': { fuel, service, price, updated } } }.
function parse_(html) {
  const page = text_(html).match(new RegExp(/(?:last reported on|Updated)\s+/.source + DATE_RE, 'i'));
  const prices = {};
  for (const tr of html.split(/<tr\b/i).slice(1)) {
    const m = text_('<' + tr).match(/^(.{1,40}?)\s+(Self|Full|Assisted) service\s+\$(\d+\.\d{2,3})\b(.*)$/i);
    if (!m) continue;
    const fuel = m[1], service = SERVICES[m[2].toLowerCase()];
    const reported = m[4].match(new RegExp(/Reported\s+/.source + DATE_RE, 'i'));
    prices[`${fuel}|${service}`] = { fuel, service, price: m[3], updated: reported ? reported[1] : page ? page[1] : '' };
  }
  const title = html.match(/<title>\s*AirNav:\s*([\s\S]+?)\s+at\s/i);
  return { fbo: title ? title[1].trim() : '', prices };
}

// Parses one FBO's price grid on an airport page: a row of fuel names, then one row
// per service code (SS/FS/AS) with a blank cell and a price cell for each fuel.
// The grid rounds to cents, so FBO pages are preferred when they list prices.
function parseGrid_(html) {
  const prices = {};
  const grid = html.match(/<table[^>]*>(?:(?!<table)[\s\S])*?\$\d[\s\S]*?<\/table>/i);
  if (!grid) return prices;
  const updated = text_(grid[0]).match(new RegExp(/Updated\s+/.source + DATE_RE, 'i'));
  let fuels = [];
  for (const tr of grid[0].split(/<tr\b/i).slice(1)) {
    const cells = [...tr.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => text_(c[1]));
    if (cells.length < 2) continue;
    if (cells[0] === '' && cells.slice(1).some(c => /[A-Za-z]/.test(c))) {
      fuels = cells.slice(1).filter(Boolean);
    } else if (/^(SS|FS|AS)$/.test(cells[0])) {
      fuels.forEach((fuel, i) => {
        const m = (cells[2 + 2 * i] || '').match(/\$(\d+\.\d{2,3})/);
        if (m) prices[`${fuel}|${cells[0]}`] = { fuel, service: cells[0], price: m[1], updated: updated ? updated[1] : '' };
      });
    }
  }
  return prices;
}

// FBOs in an airport page's "FBO, Fuel Providers" section, as { name, link, gridPrices }.
// Sponsored FBOs "Located at" other airports are left out.
function fboBlocks_(html, url) {
  const start = html.search(/FBO, Fuel Providers/i);
  if (start < 0) return [];
  const end = html.slice(start).search(/<h3>/i); // next section heading
  const section = html.slice(start, end < 0 ? undefined : start + end);
  const origin = url.match(/^https?:\/\/[^/]+/i)[0];
  const code = ((html.match(/<title>\s*AirNav:\s*([A-Z0-9]+)\s+-/i) || [])[1] || '').toUpperCase();
  return section.split(/<td width=240>/i).slice(1)
    .filter(block => !/Located at/i.test(block))
    .map(block => {
      const cell = block.split(/<td>\s*<\/td>/i)[0]; // name cell ends at an empty spacer cell
      const alt = cell.match(/<img[^>]*\balt="([^"]+)"/i);
      const name = text_(cell) || (alt ? alt[1].trim() : '');
      const link = [...block.matchAll(/href="(\/airport\/([^/"]+)\/[A-Za-z0-9_-]+)"/g)]
        .find(m => m[2].toUpperCase() === code && !/\/(update-fuel|reportlinks)$/i.test(m[1]));
      return { name, link: link ? origin + link[1] : '', gridPrices: parseGrid_(block) };
    })
    .filter(b => b.name);
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
  // AirNav answers an unknown ID with a generic page rather than an error.
  if (/<title>\s*AirNav:\s*Airport Information\s*</i.test(html)) throw new Error('Unknown airport ID; AirNav has no page for it');
  const fbos = isAirportPage ? fboBlocks_(html, url) : [{ name: '', link: url, gridPrices: {} }];
  if (!fbos.length) throw new Error('No FBOs listed on this airport page');

  const prices = {}, errors = [];
  let fetched = 0;
  for (const f of fbos) {
    // Prefer the FBO's own page (full fuel names, exact prices); fall back to the grid
    // when it has no page or its page lists no prices.
    let fbo = f.name, found = f.gridPrices;
    if (f.link) {
      try {
        if (fetched++) Utilities.sleep(2000);
        const parsed = parse_(f.link === url ? html : fetchHtml_(f.link));
        if (Object.keys(parsed.prices).length) {
          fbo = parsed.fbo || f.name;
          found = parsed.prices;
        }
      } catch (e) {
        errors.push(e.message);
        continue;
      }
    }
    for (const p of Object.values(found)) prices[`${fbo}|${p.fuel}|${p.service}`] = { fbo, ...p };
  }
  if (!Object.keys(prices).length) {
    throw new Error(errors[0] || 'No prices found; check the URL in row 1, or the page layout may have changed');
  }
  return { prices, errors };
}

// Reads row 1 (URL, optional) and row 2 (airport ID). Each may be in column A, or in B
// with a label in A. Without a URL, the airport's AirNav page is used.
function tabConfig_(sheet) {
  if (sheet.getLastRow() < 2) return null;
  const [row1, row2] = sheet.getRange(1, 1, 2, 3).getDisplayValues();
  const id = (row2.map(v => v.trim()).filter(Boolean).pop() || '').toUpperCase();
  if (!id) return null;
  const url = row1.map(v => v.trim()).find(v => /^https?:\/\//i.test(v))
    || `https://www.airnav.com/airport/${encodeURIComponent(id)}`;
  return { url, id };
}

// Most recent price logged for each fbo|fuel|service on a tab, skipping "price not found" rows.
function lastPrices_(sheet) {
  const last = {};
  const n = sheet.getLastRow() - HEADER_ROW;
  if (n < 1) return last;
  for (const [, fbo, fuel, service, price] of sheet.getRange(HEADER_ROW + 1, 1, n, 5).getValues()) {
    if (fuel !== '' && price !== '') last[`${fbo}|${fuel}|${service}`] = { fbo, fuel, service, price: Number(price) };
  }
  return last;
}

// $6.60, or $10.921 when AirNav lists a third decimal.
function money_(n) {
  const s = n.toFixed(3);
  return '$' + (s.endsWith('0') ? n.toFixed(2) : s);
}

function trackTab_(sheet, { url }, today) {
  sheet.getRange(HEADER_ROW, 1, 1, HEADER.length).setValues([HEADER]);
  sheet.getRange(HEADER_ROW + 1, HEADER.indexOf('price_usd') + 1, sheet.getMaxRows() - HEADER_ROW, 1)
    .setNumberFormat('$#,##0.00#');
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
    else if (prev[key].price !== Number(p.price)) rows.push([...row, `changed from ${money_(prev[key].price)}`]);
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
      console.log(`${sheet.getName()}: skipped (needs an airport ID in row 2)`);
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
