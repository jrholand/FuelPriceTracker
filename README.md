# KMIC Fuel Price Tracker

Checks the Metropolitan Airports Commission listing at Crystal Airport (KMIC) on AirNav once a day, logs self-serve 100LL and Jet A prices to `data/prices.csv`, and emails you when a price changes.

## Setup
1. Push this folder to a new GitHub repo (private is fine).
2. Optional email alerts: add repo secrets `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_TO`. Without them it just logs.
3. Actions tab → "Track KMIC fuel prices" → Run workflow, to confirm it works. After that it runs daily.

Run locally: `npm install && node track.js`

## CSV columns
`date_checked, fuel, service, price_usd, airnav_updated, changed`

`airnav_updated` is the listing's own "Updated" date when AirNav shows one, so you can tell a real price change from a stale listing. If the script fails with "No prices found", AirNav changed its page layout and the regex in `parse()` needs adjusting.

