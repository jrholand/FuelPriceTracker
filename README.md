# Fuel Price Tracker

A Google Apps Script attached to the [Aviation Fuel Tracker](https://docs.google.com/spreadsheets/d/1kecwol5lrTYjbp9eHOVtZ9We_rtfkxwx8r7UKCwz4wk/edit) Google Sheet, in the Drive folder "fuel prices". Once a day it checks every tab that names an airport and logs that airport's AirNav fuel prices. To add an airport, add a tab; no code changes are needed.

A row is added only when a price changes or can't be found. Days with no change add nothing. The only email it sends is an alert when prices can't be retrieved (see [Alerts](#alerts)).

## Tab layout
| Row | Column A | Column B | Column C |
|---|---|---|---|
| 1 | Airport ID, e.g. `KMIC`, `MIC` or `21D` | *Optional.* AirNav URL: an airport page like `https://www.airnav.com/airport/KANE`, or one FBO's page like `https://www.airnav.com/airport/KMIC/A1` | `Last checked: …` (written by the script) |
| 2 | Header (written by the script) | | |
| 3+ | Price log (written by the script) | | |

**To track a new airport:** add a tab and type the airport ID in A1. The tab name doesn't matter. It's picked up on the next daily run, or right away if you run `track` from the script editor.

- **C1 is updated on every run**, even when no price changed, so you can see that the daily run happened. It also says "problem; see alert email" when that airport's prices couldn't be retrieved.
- **With no URL, or an airport page URL, every FBO is tracked.** That means every FBO listed under "FBO, Fuel Providers" on the airport's page; sponsored FBOs at other airports are left out. **To track only one seller, put its FBO page URL in B1.**
- **Where the prices come from:** each FBO's own AirNav page when it shows prices, which gives full fuel names and exact prices like $10.921. Otherwise the price grid on the airport page is used, which has short names like `100LL` and rounds to cents. FBOs with a basic listing, like both of those at KBJI, have only the grid.
- **Fuel types are found automatically.** Every fuel and service listed is logged: 100LL, Jet A, MOGAS and so on, as self (SS), full (FS) or assisted (AS) service.
- **Tabs are skipped unless A1 holds an airport ID** (3–4 letters or digits), so you can keep notes or charts on other tabs.
- **Tabs in the old layout are converted automatically**, keeping their price history. In the old layout, row 1 held the URL, row 2 the ID and row 3 the header.

## Log columns (row 2)
`date_checked, fbo, fuel, service, price_usd, airnav_updated, note`

- **`fbo`:** the fuel seller's name.
- **`price_usd`:** the script formats this column as currency, with a third decimal shown only when AirNav lists one.
- **`airnav_updated`:** the date AirNav shows for that price ("Reported …", "last reported on …" or "Updated …"). It's blank when AirNav doesn't show one.
- **`note`:** why the row was added: `first price`, `changed from $X.XX`, or `price not found` with the reason.
- **Not-found rows** have a blank price and are skipped when comparing, so the next price is compared with the last real one.

## Alerts
One email per run lists every airport that had a problem. It goes to the Google account that ran `setup` (currently jrholand@gmail.com). To send it elsewhere, set `ALERT_TO` at the top of `Code.gs`, using commas to separate several addresses.

An airport is included when:
- **the airport ID is unknown:** AirNav has no page for it.
- **no FBOs are listed** on the airport's page.
- **no prices are found:** the URL is wrong, the FBOs list no prices, or AirNav changed its page layout and `parse_()` or `parseGrid_()` needs adjusting.
- **AirNav returns an error**, even after 3 tries.
- **a price that was logged before has disappeared.** If an FBO stops selling a fuel, delete that fuel's old rows to stop the alert.

Google may also email you if the script itself crashes. You can change that in the script editor under **Triggers**.

## Setup and schedule
Everything is already set up. To start fresh in another sheet:
1. Open the sheet and choose **Extensions → Apps Script**. Add `Code.gs` and `appsscript.json`; to see the manifest, turn on "Show appsscript.json" in Project Settings.
2. Run `setup` once and approve the permissions prompt. This installs the daily trigger.
3. Run `track` to check that rows appear.

**Changing the run time:** the run happens at about 8 AM Central. To change it, set `RUN_HOUR` in `Code.gs` (0–23, Central time) and run `setup` again.

## Development
| File | Purpose |
|---|---|
| `Code.gs` | The script. `track()` is the daily entry point and `setup()` installs the trigger. Helper functions end in `_` so they're hidden from the editor's Run menu. |
| `appsscript.json` | Manifest: time zone (America/Chicago) and permissions |
| `.clasp.json` | Links this folder to the sheet's script for [clasp](https://github.com/google/clasp) |
| `.claspignore` | Limits `clasp push` to `Code.gs` and `appsscript.json` |

**To deploy a change:** edit `Code.gs`, then run `clasp push`. This needs a one-time `npm install -g @google/clasp` and `clasp login`. If you change the manifest's permissions, run `setup` again from the editor.
