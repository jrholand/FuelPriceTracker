# Fuel Price Tracker

A Google Apps Script attached to the **KMIC Fuel Prices** Google Sheet (Drive folder "fuel prices"). Once a day it checks every tab that names an airport and logs AirNav fuel prices for it. You add an airport by adding a tab; no code changes are needed.

A row is added only when a price changes or can't be found. Days with no change add nothing. The only email it sends is an alert listing the airports whose prices couldn't be retrieved.

## Tab layout
| Row | Column A | Column B |
|---|---|---|
| 1 | Airport ID, e.g. `KMIC`, `MIC` or `21D` | *Optional.* AirNav URL: an airport page like `https://www.airnav.com/airport/KANE`, or one FBO's page like `https://www.airnav.com/airport/KMIC/A1` |
| 2 | Header (written by the script) | |
| 3+ | Price log (written by the script) | |

**To track a new airport:** add a tab and type the airport ID in A1. It's picked up on the next daily run, or right away if you run `track` from the script editor.

- **With no URL, or an airport page URL, every FBO is tracked.** That means every FBO listed under "FBO, Fuel Providers" on the airport's page; sponsored FBOs at other airports are left out. **To track only one seller, put its FBO page URL in B1.**
- **Where the prices come from:** each FBO's own AirNav page when it shows prices, which gives full fuel names and exact prices like $10.921. Otherwise the price grid on the airport page is used, which has short names like `100LL` and rounds to cents. FBOs with a basic listing, like both of those at KBJI, have only the grid.
- **An unknown airport ID** gives a "price not found" row and an alert email.
- **Fuel types are found automatically.** Every fuel and service listed on the page is logged: 100LL, Jet A, MOGAS and so on, as self (SS), full (FS) or assisted (AS) service.
- **Tabs are skipped unless A1 holds an airport ID** (3–4 letters or digits), so you can keep notes or charts on other tabs.
- **Old-layout tabs are converted automatically.** These are tabs with the URL in row 1, the ID in row 2 and the header in row 3. The next run moves the ID to A1 and the URL to B1, and deletes the old ID row. The price history is kept.

## Setup
1. Open the sheet and choose **Extensions → Apps Script**.
2. Run `setup` once and approve the permissions prompt. It installs a daily trigger at about 8 AM Central.
3. Run `track` to check that rows appear.

**Updating the code with clasp:** this repo is linked to the sheet's script through `.clasp.json`. After editing `Code.gs`, run `clasp push`. `.claspignore` makes sure only `Code.gs` and `appsscript.json` are uploaded. If you change the manifest's permissions, run `setup` again from the editor.

Optional: set `ALERT_TO` in `Code.gs` to send alerts somewhere other than your Google account.

## Log columns (row 2)
`date_checked, fbo, fuel, service, price_usd, airnav_updated, note`

- **`fbo`** is the fuel seller's name from its AirNav page.
- **`airnav_updated`** is the date AirNav shows for that price ("Reported …" or "last reported on …"). It's blank when the page doesn't show one.
- **`note`** says why the row was added: `first price`, `changed from $X.XX`, or `price not found` (with the error).
- **Not-found rows** have a blank price and are skipped when comparing, so the next price is compared with the last real one.
- **If you get a "No prices found" alert**, the URL is wrong, the FBO(s) list no prices, or AirNav changed its page layout and the regex in `parse_()` needs adjusting.
