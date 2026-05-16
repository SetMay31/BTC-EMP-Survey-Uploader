# Ecological Monitoring Program — Survey Data Uploader

A mobile-friendly offline-capable data input tool for the Black Turtle Conservation Ecological Monitoring Program. Covers three reef monitoring surveys:

- **Chordates Survey** — belt transect, indicator species per 20 m section
- **Invertebrates Survey** — belt transect, indicator species per 20 m section (with abundance scale for Drupella and Long-spined Black Sea Urchin)
- **Substrate Survey** — point-intercept, substrate type at 0.5 m intervals (160 points)

Each site visit shares: Surveyor Name, Survey Date, Location, Depth (Shallow / Deep / Random). Completed surveys sync to a Google Sheet, with one tab per survey type.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell — screen templates and navigation |
| `styles.css` | Mobile-first UI |
| `app.js` | All survey logic: state, persistence, syncing |
| `sw.js` | Service worker for offline use |
| `manifest.json` | PWA install manifest |
| `icon.svg` | App icon |
| `apps-script.gs` | Google Apps Script that receives submissions and writes to Sheets |

---

## Run locally (quick test)

You need to serve over HTTP — the service worker won't register from `file://`.

```bash
cd ~/Desktop/ecological-monitoring-survey
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

---

## Deploy to GitHub Pages

1. Create a new repo on GitHub (public; private also works on Pages but requires Pro).
2. From this folder:
   ```bash
   cd ~/Desktop/ecological-monitoring-survey
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. In the repo on GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`** → Save.
4. After ~30 seconds, the app is live at `https://<your-username>.github.io/<repo-name>/`.
5. On your phone/tablet, open that URL in Chrome or Safari and choose **Add to Home Screen** to install as a PWA.

---

## Set up Google Sheets sync

1. Create a new Google Sheet (any name).
2. **Extensions → Apps Script**. Replace the placeholder code with the contents of [`apps-script.gs`](apps-script.gs). Click the Save icon.
3. **Deploy → New deployment**.
   - Type: **Web app**
   - Description: `EMS sync`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**.
4. The first deployment will ask for permissions — review and accept.
5. Copy the **Web app URL** (ends in `/exec`).
6. In the app, tap the ⚙ button → paste the URL into **Google Apps Script Web App URL** → Save.

Submissions will now append rows to your Sheet, creating tabs automatically on first use.

### Sheet layout

All three tabs are **long-format**: one row per 20m section. A complete survey adds 4 rows.

Each tab has a **two-row header**:
- Row 1: merged category labels (e.g. *Metadata*, *Butterfly Fish*, *Grouper*, *Gastropod*) in dark teal.
- Row 2: the actual column names — species names (e.g. `Copper Banded`), or point IDs (`P1`, `P2`, …) for the Substrate tab. The `section` column tells you which transect section a row covers.

Substrate values are encoded compactly:
- Simple codes: `SD`, `RB`, `NIA`, …
- Hard coral: `HC B PBL ACRO` (substrate, growth form, health, genus)
- Other: `OTH: <description>`

### Submission granularity

The Review screen lets you submit at three levels:

- **By section** — push just one 20m section of one survey (one row appended to one tab). Useful for syncing as you go between dives or transect lengths. Sections already pushed show a ✓ and are disabled until you re-enter data.
- **By survey** — push all four sections of one survey (up to 4 rows appended). Sections without any data are skipped.
- **All three surveys** — push the entire site visit in one go.

If the device is offline, submissions queue locally and auto-sync when you reconnect (provided "Auto-sync when online" is on in Settings).

### Exports (CSV / TSV / JSON)

For each survey, the Review screen offers:

- **Download CSV** — a CSV matching that survey's tab columns exactly. Open in Excel/Numbers or import into Sheets.
- **Copy as TSV** — tab-separated copy of the same rows to your clipboard. Paste directly into your Google Sheet under the existing header rows.
- **Export JSON** — the full structured payload (all three surveys + schema) for analysis in R / Python.

---

## Offline behaviour

- All edits persist to browser storage (`localStorage`), so closing the tab or losing signal won't lose data.
- Submissions that can't reach the server queue locally. The pill in the top right shows the queue size.
- When the device comes back online, queued submissions auto-sync (if enabled in Settings).
- The app shell is cached by the service worker — you can open the app fully offline once it's been visited at least once.

---

## Updating the indicator lists

The species and substrate lists live near the top of [`app.js`](app.js) — `CHORDATES`, `INVERTEBRATES`, `SUBSTRATE_TYPES`, `HC_GROWTH`, `HC_HEALTH`. Editing those lists is enough; the rendered UI and the sheet schema follow automatically.

If you change the lists, also update the matching `EMBEDDED_SCHEMA` at the bottom of [`apps-script.gs`](apps-script.gs) so the optional `setupAllTabs()` helper stays in sync.

> **Important:** existing tabs keep their original headers. If you add a new species after data has already been submitted, create a fresh tab (e.g. rename the old one to `Chordates Survey (2025)`) or extend headers manually — the script only writes headers when a tab is empty.

---

## Data export

The **Review** screen has an **Export JSON** button — useful if you want to download a copy of the current draft (or the queue) for analysis in R / Python before it reaches Sheets.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Sync URL set, but submissions still queue | Open the Apps Script URL in a browser — it should return `{"ok": true}`. If it asks you to sign in or shows an error, the deployment may not be set to "Anyone". |
| "Authorization required" error from Apps Script | Re-deploy the web app and accept the OAuth scopes for your Google account. |
| App won't install as PWA | Some browsers require multiple visits. Make sure you're on HTTPS (GitHub Pages provides this) and that the service worker registered (DevTools → Application → Service Workers). |
| Need to clear a stuck draft | Tap **Discard draft** on the Review screen, or in DevTools: `localStorage.clear()`. |
