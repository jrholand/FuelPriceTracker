# Fuel Price Tracker

A Google Apps Script attached to the **KMIC Fuel Prices** Google Sheet (Drive folder "fuel prices"). Once a day it checks every tab that names an airport and logs AirNav fuel prices for it. You add an airport by adding a tab; no code changes are needed.

A row is added only when a price changes or can't be found. Days with no change add nothing. The only email it sends is an alert listing the airports whose prices couldn't be retrieved.

## Tab layout
| Row | Column A | Notes |
|---|---|---|
| 1 | AirNav URL: an airport page like `https://www.airnav.com/airport/KANE`, or one FBO's page like `https://www.airnav.com/airport/KMIC/A1` | Or put a label in A1 and the URL in B1 |
| 2 | Airport ID, e.g. `KMIC` | Or a label in A2 and the ID in B2 |
| 3 | Header | Written by the script |
| 4+ | Price log | Written by the script |

**To track a new airport:** add a tab, put the URL in A1 and the airport ID in A2. It's picked up on the next daily run, or right away if you run `track` from the script editor.

- **An airport page URL tracks every FBO** listed under "FBO, Fuel Providers" on that page. **An FBO page URL tracks only that seller.**
- **Fuel types are found automatically.** Every fuel and service listed on the page is logged: 100LL, Jet A, MOGAS and so on, as self (SS), full (FS) or assisted (AS) service.
- **Tabs are skipped without a URL in row 1 and an ID in row 2**, so you can keep notes or charts on other tabs.

## Setup
1. Open the sheet and choose **Extensions → Apps Script**.
2. Run `setup` once and approve the permissions prompt. It installs a daily trigger at about 8 AM Central.
3. Run `track` to check that rows appear.

**Updating the code with clasp:** this repo is linked to the sheet's script through `.clasp.json`. After editing `Code.gs`, run `clasp push`. `.claspignore` makes sure only `Code.gs` and `appsscript.json` are uploaded. If you change the manifest's permissions, run `setup` again from the editor.

Optional: set `ALERT_TO` in `Code.gs` to send alerts somewhere other than your Google account.

## Log columns (row 3)
`date_checked, fbo, fuel, service, price_usd, airnav_updated, note`

- **`fbo`** is the fuel seller's name from its AirNav page.

- **`airnav_updated`** is the date AirNav shows for that price ("Reported …" or "last reported on …"). It's blank when the page doesn't show one.
- **`note`** says why the row was added: `first price`, `changed from $X.XX`, or `price not found` (with the error).
- **Not-found rows** have a blank price and are skipped when comparing, so the next price is compared with the last real one.
- **If you get a "No prices found" alert**, the URL is wrong, the FBO(s) list no prices, or AirNav changed its page layout and the regex in `parse_()` needs adjusting.
