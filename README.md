# KMIC Fuel Price Tracker

A Google Apps Script that checks the Metropolitan Airports Commission listing at Crystal Airport (KMIC) on AirNav once a day. It adds a row to the **KMIC Fuel Prices** Google Sheet in the Drive folder "fuel prices" only when a self-serve 100LL or Jet A price changes, or when a price can't be found. Days with no change add nothing.

The only email it sends is an alert when it can't retrieve prices: an HTTP error, a network failure, or a page with no prices on it. It also alerts when only one of the two fuels is found. A price change doesn't send an email; it only adds a row.

## Setup
1. Open the sheet: https://docs.google.com/spreadsheets/d/1kecwol5lrTYjbp9eHOVtZ9We_rtfkxwx8r7UKCwz4wk/edit
2. Choose **Extensions → Apps Script**.
3. Replace the contents of `Code.gs` with this repo's [Code.gs](Code.gs).
4. Under **Project Settings**, tick "Show appsscript.json manifest file in editor". Then replace that file with this repo's [appsscript.json](appsscript.json), which sets the time zone to America/Chicago.
5. Select `setup` in the function dropdown and click **Run**. Approve the permissions prompt. This installs a daily trigger at about 8 AM Central.
6. Select `track` and click **Run** once to confirm that a row is written.

**Updating the code with clasp:** this repo is already linked to the sheet's script through `.clasp.json`. After editing `Code.gs`, run `clasp push`. `.claspignore` makes sure only `Code.gs` and `appsscript.json` are uploaded. If you change the manifest's permissions, run `setup` again from the editor.

Optional: set `ALERT_TO` in `Code.gs` to send alerts somewhere other than your Google account.

## Sheet columns
`date_checked, fuel, service, price_usd, airnav_updated, note`

`note` says why the row was added: `first price`, `changed from $X.XX`, or `price not found` (with the error). A not-found row has a blank price and is skipped when comparing later prices, so the next price is compared with the last real one.

`airnav_updated` is the listing's own "Updated" date when AirNav shows one. The current "guaranteed prices" layout doesn't show one, so the column may be blank. If you get a "No prices found" alert, AirNav changed its page layout and the regex in `parse()` needs adjusting.
