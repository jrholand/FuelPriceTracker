// KMIC fuel price tracker (Google Apps Script): fetches AirNav's MAC listing at
// Crystal Airport and adds a row to the "KMIC Fuel Prices" Google Sheet only when
// a self-serve price changes or can't be found. Emails an alert only in the
// latter case.

const SHEET_ID = '1kecwol5lrTYjbp9eHOVtZ9We_rtfkxwx8r7UKCwz4wk';
const URL = 'https://www.airnav.com/airport/KMIC/A1';
const ALERT_TO = ''; // blank = the Google account that owns the trigger
const RUN_HOUR = 8;  // local hour (project time zone, America/Chicago)
const HEADER = ['date_checked', 'fuel', 'service', 'price_usd', 'airnav_updated', 'note'];
const FUELS = [
  { key: '100LL', label: '100LL Avgas' },
  { key: 'JetA', label: 'Jet A' },
];

function parse_(html) {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
  const prices = {};
  for (const f of FUELS) {
    const re = new RegExp(`${f.label}[^$]{0,80}?Self service[^$]{0,40}?\\$(\\d+\\.\\d{2})`, 'i');
    const m = text.match(re);
    if (m) prices[f.key] = m[1];
  }
  const upd = text.match(/Updated\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i);
  return { prices, updated: upd ? upd[1] : '' };
}

function fetchPrices_() {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) Utilities.sleep(30000);
    try {
      const res = UrlFetchApp.fetch(URL, {
        muteHttpExceptions: true,
        headers: { 'User-Agent': 'kmic-fuel-tracker (personal, 1 req/day)' },
      });
      const code = res.getResponseCode();
      if (code !== 200) throw new Error(`AirNav returned HTTP ${code}`);
      const result = parse_(res.getContentText());
      if (!Object.keys(result.prices).length) throw new Error('No prices found; page layout may have changed');
      return result;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

function getSheet_() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
  sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  return sheet;
}

// Most recent price logged for each fuel, skipping "price not found" rows.
function lastPrices_(sheet) {
  const last = {};
  const n = sheet.getLastRow() - 1;
  if (n < 1) return last;
  for (const [, fuel, , price] of sheet.getRange(2, 1, n, 4).getValues()) {
    if (fuel !== '' && price !== '') last[fuel] = Number(price).toFixed(2);
  }
  return last;
}

function sendAlert_(message) {
  const to = ALERT_TO || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail(to, 'KMIC fuel tracker: could not retrieve prices',
    `${message}\n\n${URL}\nSheet: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
}

// Helpers end in _ so the editor's Run menu only lists track and setup.

// Daily entry point (run by the trigger that setup() creates).
function track() {
  let prices = {}, updated = '', error = '';
  try {
    ({ prices, updated } = fetchPrices_());
  } catch (e) {
    error = e.message;
  }

  const sheet = getSheet_();
  const prev = lastPrices_(sheet);
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const rows = [];
  const missing = [];
  for (const f of FUELS) {
    const price = prices[f.key];
    if (price === undefined) {
      missing.push(f.label);
      rows.push([today, f.key, 'SS', '', updated, `price not found${error ? ': ' + error : ''}`]);
    } else if (prev[f.key] === undefined) {
      rows.push([today, f.key, 'SS', Number(price), updated, 'first price']);
    } else if (prev[f.key] !== price) {
      rows.push([today, f.key, 'SS', Number(price), updated, `changed from $${prev[f.key]}`]);
    }
  }
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADER.length).setValues(rows);
  console.log(rows.length ? JSON.stringify(rows) : `No change: ${JSON.stringify(prices)}`);

  if (error) sendAlert_(error);
  else if (missing.length) sendAlert_(`No price found for: ${missing.join(', ')}`);
}

// Run once by hand: authorizes the script and installs the daily trigger.
function setup() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'track') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('track').timeBased().everyDays(1).atHour(RUN_HOUR).create();
  getSheet_();
}
