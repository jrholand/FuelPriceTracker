// KMIC fuel price tracker: fetches AirNav's MAC listing at Crystal Airport,
// appends today's self-serve prices to data/prices.csv, and emails on change.
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.AIRNAV_URL || 'https://www.airnav.com/airport/KMIC/A1';
const CSV = path.resolve('data/prices.csv');
const HEADER = 'date_checked,fuel,service,price_usd,airnav_updated,changed\n';
const FUELS = [
  { key: '100LL', label: '100LL Avgas' },
  { key: 'JetA', label: 'Jet A' },
];

export function parse(html) {
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

function lastPrices() {
  if (!fs.existsSync(CSV)) return {};
  const last = {};
  for (const line of fs.readFileSync(CSV, 'utf8').trim().split('\n').slice(1)) {
    const [, fuel, , price] = line.split(',');
    last[fuel] = price;
  }
  return last;
}

async function notify(changes, updated) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO } = process.env;
  if (!SMTP_HOST || !MAIL_TO) return;
  const nodemailer = (await import('nodemailer')).default;
  const tx = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const lines = changes.map(c => `${c.fuel} self-serve: ${c.old ? '$' + c.old : '(none)'} → $${c.price}`);
  await tx.sendMail({
    from: SMTP_USER, to: MAIL_TO,
    subject: `KMIC fuel price change: ${lines.join('; ')}`,
    text: `${lines.join('\n')}\n\nAirNav listing updated: ${updated || 'n/a'}\n${URL}`,
  });
}

async function main() {
  const res = await fetch(URL, { headers: { 'User-Agent': 'kmic-fuel-tracker (personal, 1 req/day)' } });
  if (!res.ok) throw new Error(`AirNav returned HTTP ${res.status}`);
  const { prices, updated } = parse(await res.text());
  if (!Object.keys(prices).length) throw new Error('No prices found; page layout may have changed');

  const today = new Date().toISOString().slice(0, 10);
  const prev = lastPrices();
  fs.mkdirSync(path.dirname(CSV), { recursive: true });
  if (!fs.existsSync(CSV)) fs.writeFileSync(CSV, HEADER);

  const changes = [];
  let rows = '';
  for (const [fuel, price] of Object.entries(prices)) {
    const changed = prev[fuel] !== undefined && prev[fuel] !== price;
    if (changed) changes.push({ fuel, old: prev[fuel], price });
    rows += `${today},${fuel},SS,${price},${updated},${changed ? 'yes' : 'no'}\n`;
  }
  fs.appendFileSync(CSV, rows);
  console.log(rows.trim());
  if (changes.length) await notify(changes, updated);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
