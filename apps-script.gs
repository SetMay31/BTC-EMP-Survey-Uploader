/**
 * Ecological Monitoring Survey — Google Sheets sync endpoint.
 *
 * SETUP
 *  1. Create a new Google Sheet.
 *  2. Extensions → Apps Script. Replace the default code with this whole file.
 *  3. Deploy → New deployment → Type: Web app
 *       - Description: EMS sync
 *       - Execute as: Me
 *       - Who has access: Anyone
 *     Copy the deployment URL (ends in /exec). Paste it into the app's Settings.
 *  4. (Optional) Run the `setupAllTabs` function once from the Apps Script editor
 *     to pre-create empty Chordates / Invertebrate / Substrate tabs with headers.
 *     Otherwise, headers are written automatically on first submission.
 *
 * Payload shape (long-format):
 *   {
 *     chordates:    [row, row, ...],   // optional — present if any rows for that survey
 *     invertebrate: [row, row, ...],   // optional
 *     substrate:    [row, row, ...],   // optional
 *     schema: { chordates?: {...}, invertebrate?: {...}, substrate?: {...} }
 *   }
 *
 * Each row is one 20m section: it includes the full metadata + section label
 * + the section's data (species counts or P1..P40 substrate codes).
 *
 * Tabs:
 *   - Chordates Survey
 *   - Invertebrates Survey
 *   - Substrate Survey
 *
 * Each tab has a two-row header:
 *   Row 1: merged category bands (Metadata, Butterfly Fish, Grouper, …)
 *   Row 2: actual column names
 */

const TAB_NAMES = {
  chordates: "Chordates Survey",
  invertebrate: "Invertebrates Survey",
  substrate: "Substrate Survey",
};

// Shared secret token — must match the SYNC_SECRET constant in app.js.
// Rotate by regenerating, updating both files, redeploying the script and
// bumping the service-worker CACHE_VERSION.
const SYNC_SECRET = "1c4c012f-552e-48b0-8cdd-1f5d83e9fafa-f1f0ad7b";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SYNC_SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    ["chordates", "invertebrate", "substrate"].forEach(function (key) {
      const rows = body[key];
      if (!rows || !rows.length) return;
      const schema = body.schema && body.schema[key];
      if (!schema) throw new Error("Missing schema for " + key);
      ensureTab(ss, TAB_NAMES[key], schema);
      const sheet = ss.getSheetByName(TAB_NAMES[key]);
      rows.forEach(function (row) { appendRow(sheet, row); });
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

function doGet() {
  return jsonResponse({ ok: true, service: "EMS sync", time: new Date().toISOString() });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Make sure a tab exists with the right two-row header layout described in
 * the schema. If the tab is brand new, write the merged category row and the
 * column-name row. If headers already exist, leave them alone.
 */
function ensureTab(ss, name, schema) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() >= 2) return; // already initialised

  var meta = schema.meta;
  var groups = schema.groups;

  var allCols = meta.slice();
  var bandRanges = [];
  bandRanges.push({ start: 1, length: meta.length, label: "Metadata" });

  groups.forEach(function (grp) {
    var newCols = grp.columns.filter(function (c) { return allCols.indexOf(c) === -1; });
    if (newCols.length === 0) return;
    bandRanges.push({ start: allCols.length + 1, length: newCols.length, label: grp.category || "" });
    allCols = allCols.concat(newCols);
  });

  // Row 1: category bands (merged cells)
  bandRanges.forEach(function (band) {
    var range = sheet.getRange(1, band.start, 1, band.length);
    range.setValues([[band.label].concat(repeat("", band.length - 1))]);
    if (band.length > 1) range.merge();
    range
      .setBackground("#0b3d3d")
      .setFontColor("#ffffff")
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
  });

  // Row 2: column names
  sheet.getRange(2, 1, 1, allCols.length).setValues([allCols]);
  sheet.getRange(2, 1, 1, allCols.length)
    .setBackground("#156a64")
    .setFontColor("#ffffff")
    .setFontWeight("bold")
    .setWrap(true);

  sheet.setFrozenRows(2);
  for (var i = 1; i <= Math.min(12, allCols.length); i++) sheet.autoResizeColumn(i);
}

function appendRow(sheet, rowObj) {
  var headers = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    return rowObj[h] === undefined ? "" : rowObj[h];
  });
  sheet.appendRow(row);
}

function repeat(v, n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(v);
  return out;
}

/**
 * Optional: pre-create all three tabs with headers, without submitting data.
 * Run once from the Apps Script editor if you want headers ready before
 * the first sync. Uses the same schema as the live app to stay in sync.
 */
function setupAllTabs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var schema = EMBEDDED_SCHEMA;
  ensureTab(ss, TAB_NAMES.chordates,    schema.chordates);
  ensureTab(ss, TAB_NAMES.invertebrate, schema.invertebrate);
  ensureTab(ss, TAB_NAMES.substrate,    schema.substrate);
}

// Mirror of the schema the app sends. Keep in sync with app.js buildSchema().
const EMBEDDED_SCHEMA = (function () {
  var META = ["surveyor", "date", "location", "fixedTransect", "depth", "surveyId", "submittedAt", "section", "startTime", "startDepth", "notes"];

  var CHORDATES = [
    { category: "Butterfly Fish", species: ["Copper Banded", "8 Banded", "Lined", "Longfin Bannerfish", "Wiebel's"] },
    { category: "Cartilaginous", species: ["Shark/Ray"] },
    { category: "Grouper", species: ["Large (>30cm)", "Small (<30cm)"] },
    { category: "", species: ["Moray Eel"] },
    { category: "Parrotfish", species: ["Large (>20cm)", "Small (<20cm)"] },
    { category: "", species: ["Rabbitfish"] },
    { category: "Reptile", species: ["Sea Snake/Turtle"] },
    { category: "", species: ["Snapper"] },
    { category: "", species: ["Surgeonfish"] },
    { category: "Sweetlips", species: ["Juvenile", "Adult"] },
    { category: "", species: ["Triggerfish"] },
    { category: "Wrasse", species: ["Red Breasted"] },
    { category: "Other Fish", species: ["Porcupine Fish", "Yellow Boxfish"] },
  ];
  var INVERTEBRATES = [
    { category: "Cephalopod", species: ["Cuttlefish", "Squid", "Octopus"] },
    { category: "Crustacean", species: ["Hermit Crab"] },
    { category: "", species: ["Flatworm"] },
    { category: "Gastropod", species: ["Auger Snail", "Cowrie", "Drupella", "Ramose Murex", "Sea Slug"] },
    { category: "Giant Clam", species: ["Boring", "Giant"] },
    { category: "Sea Cucumber", species: ["Black", "Marbled", "Orange Spiked", "Pinkfish"] },
    { category: "Sea Urchin", species: ["Long-spined Black Sea Urchin"] },
    { category: "Starfish", species: ["Crown Of Thorns", "Cushion Star"] },
  ];

  function speciesSchema(list) {
    return {
      meta: META,
      groups: list.map(function (grp) {
        return { category: grp.category, columns: grp.species.slice() };
      }),
    };
  }

  var POINTS = [];
  for (var i = 1; i <= 40; i++) POINTS.push("P" + i);

  return {
    chordates: speciesSchema(CHORDATES),
    invertebrate: speciesSchema(INVERTEBRATES),
    substrate: {
      meta: META,
      groups: [{ category: "Points 0.5m–20.0m", columns: POINTS }],
    },
  };
})();
