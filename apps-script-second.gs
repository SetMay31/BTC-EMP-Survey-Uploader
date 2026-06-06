/**
 * Ecological Monitoring Program — Second (analytical) sync endpoint.
 *
 * Writes the same submissions that go to the master Sheet, but in the LONG-
 * format that the BTC analysts already use:
 *
 *   Chordates Survey CD / Invertebrates Survey CD:
 *     One row per (date × site × line × species), only when seen at least
 *     once anywhere in the survey. Counts are split across Segement 1–4
 *     with NA for sections not yet surveyed and 0 for sections completed-
 *     but-no-sighting. Total is the row sum (treating NA as 0).
 *
 *   Substrate Survey CD:
 *     One row per recorded point along the transect. Composite key is
 *     (date × site × line × distance). HC carries Form / Health / Taxonomy.
 *
 * SETUP
 *   1. Open the second Google Sheet (ID:
 *      1qoVjcIp2Tne1G2rMxgl6Vm95LPCHmAxvVWRVSHboutw).
 *   2. Extensions → Apps Script. Paste this whole file in.
 *   3. Deploy → New deployment → Web app.
 *        Execute as: Me   ·   Who has access: Anyone
 *   4. Copy the /exec URL and paste it into DEFAULT_SECOND_SYNC_URL in app.js.
 *
 * The shared secret is identical to the master endpoint so a single rotation
 * affects both.
 */

const SYNC_SECRET = "1c4c012f-552e-48b0-8cdd-1f5d83e9fafa-f1f0ad7b";

const TAB_NAMES = {
  chordates: "Chordates Survey CD",
  invertebrate: "Invertebrates Survey CD",
  substrate: "Substrate Survey CD",
};

const SPECIES_HEADERS = ["Date", "Divesite", "Line", "Species", "Segement 1", "Segement 2", "Segement 3", "Segement 4", "Total"];
const SUBSTRATE_HEADERS = ["Date", "Divesite", "Line", "Distance", "Type", "Form", "Health", "Taxonomy"];

// App-side short name → analytical long-form name. Built from the BTC team's
// historic CSV exports. The combined Sea Snake/Turtle and Shark/Ray entries
// were already split client-side, so each lands on its own row here.
const CHORDATES_NAME_MAP = {
  "Copper Banded": "Copperband Butterflyfish",
  "8 Banded": "Eight-Banded Butterflyfish",
  "Lined": "Lined Butterflyfish",
  "Longfin Bannerfish": "Longfin Bannerfish",
  "Wiebel's": "Weibel's Butterflyfish",
  "Shark": "General Shark",
  "Ray": "General Ray",
  "Large (>30cm)": "Large Grouper",
  "Small (<30cm)": "Small Grouper",
  "Moray Eel": "General Moray Eel",
  "Large (>20cm)": "Large Parrotfish",
  "Small (<20cm)": "Small Parrotfish",
  "Rabbitfish": "General Rabbitfish",
  "Sea Snake": "Sea Snake",
  "Sea Turtle": "General Sea Turtle",
  "Snapper": "General Snapper",
  "Surgeonfish": "General Surgeonfish",
  "Juvenile": "Juvenile Sweetlip",
  "Adult": "Adult Sweetlip",
  "Triggerfish": "General Triggerfish",
  "Red Breasted": "Red-Breasted Wrasse",
  "Porcupine Fish": "Porcupine Pufferfish",
  "Yellow Boxfish": "Yellow Box Fish",
};

const INVERTEBRATE_NAME_MAP = {
  "Cuttlefish": "Cuttlefish",
  "Squid": "Squid",
  "Octopus": "Octopus",
  "Hermit Crab": "Hermit Crab",
  "Flatworm": "General Flatworm",
  "Auger Snail": "Auger Snail",
  "Cowrie": "Cowrie",
  "Drupella": "Drupella",
  "Ramose Murex": "Ramose Murex",
  "Sea Slug": "Sea Slug",
  "Boring": "Boring Giant Clam",
  "Giant": "Giant Giant Clam",
  "Black": "Black Sea Cucumber",
  "Marbled": "Marbled Sea Cucumber",
  "Orange Spiked": "Orange-Spiked Sea Cucumber",
  "Pinkfish": "Pinkfish Sea Cucumber",
  "Long-spined Black Sea Urchin": "Long-Spiked Black Sea Urchin",
  "Crown Of Thorns": "Crown Of Thorns",
  "Cushion Star": "Cushion Star",
};

function doGet() {
  return jsonResponse({ ok: true, service: "EMP analytical sync (second Sheet)", time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SYNC_SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const sectionsCompleted = body.sectionsCompleted || {};
    const submittedSections = body.submittedSections || {};

    if (body.chordates && body.chordates.length) {
      const sheet = ensureSpeciesTab(ss, TAB_NAMES.chordates);
      processSpeciesRows(sheet, body.chordates, CHORDATES_NAME_MAP,
                         sectionsCompleted.chordates || [],
                         submittedSections.chordates || []);
    }
    if (body.invertebrate && body.invertebrate.length) {
      const sheet = ensureSpeciesTab(ss, TAB_NAMES.invertebrate);
      processSpeciesRows(sheet, body.invertebrate, INVERTEBRATE_NAME_MAP,
                         sectionsCompleted.invertebrate || [],
                         submittedSections.invertebrate || []);
    }
    if (body.substrate && body.substrate.length) {
      const sheet = ensureSubstrateTab(ss, TAB_NAMES.substrate);
      processSubstrateRows(sheet, body.substrate);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

/* ====================================================================
 *  Tab setup
 * ==================================================================== */

function ensureSpeciesTab(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, SPECIES_HEADERS.length).setValues([SPECIES_HEADERS]);
    sheet.getRange(1, 1, 1, SPECIES_HEADERS.length)
      .setBackground("#0b3d3d").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSubstrateTab(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, SUBSTRATE_HEADERS.length).setValues([SUBSTRATE_HEADERS]);
    sheet.getRange(1, 1, 1, SUBSTRATE_HEADERS.length)
      .setBackground("#0b3d3d").setFontColor("#ffffff").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* ====================================================================
 *  Species: per-section app rows → per-species long rows
 *
 *  Each app row is one section of one survey. The row carries the
 *  full per-species counts as columns. We pivot that into one row per
 *  species in the destination sheet, updating segments based on which
 *  sections are now complete.
 * ==================================================================== */

function processSpeciesRows(sheet, appRows, nameMap, sectionsCompleted, submittedSections) {
  // SECTIONS labels in the app: ["0-20m", "25-45m", "50-70m", "75-95m"]
  var SECTION_LABEL_TO_IDX = { "0-20m": 0, "25-45m": 1, "50-70m": 2, "75-95m": 3 };

  // Pre-load the entire sheet into memory for fast lookups (rather than
  // re-reading per row). Build a key→rowIndex map by (date|site|line|species).
  var lastRow = sheet.getLastRow();
  var data = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, SPECIES_HEADERS.length).getValues()
    : [];
  var rowIndexByKey = {};   // key → 0-based index inside `data`
  for (var i = 0; i < data.length; i++) {
    var key = makeSpeciesKey(data[i][0], data[i][1], data[i][2], data[i][3]);
    rowIndexByKey[key] = i;
  }

  // Group the incoming app rows by (date × site × line). Each group's rows
  // are the same survey leg; the species columns are scattered across them.
  appRows.forEach(function (appRow) {
    var date = formatDateOnly(appRow.date);
    var site = appRow.location || "";
    var line = deriveLine(appRow.fixedTransect, appRow.depth);
    var sectionIdx = SECTION_LABEL_TO_IDX[appRow.section];
    if (sectionIdx === undefined) return;

    // Walk every species we know about in this survey type.
    Object.keys(nameMap).forEach(function (appName) {
      var count = appRow[appName];
      // Treat undefined / "" as no-count for this section.
      var hasCount = count !== "" && count !== null && count !== undefined && !isNaN(parseFloat(count));
      var numCount = hasCount ? parseFloat(count) : 0;

      var longName = nameMap[appName];
      var key = makeSpeciesKey(date, site, line, longName);
      var existingIdx = rowIndexByKey[key];

      if (existingIdx === undefined) {
        // No row yet — only create one if this species had a sighting somewhere
        // *and* the user actually entered a count here. Skip 0-count rows.
        if (!hasCount || numCount <= 0) return;
        var newRow = buildSpeciesRow(date, site, line, longName, sectionIdx, numCount, sectionsCompleted);
        data.push(newRow);
        rowIndexByKey[key] = data.length - 1;
      } else {
        // Row exists — update its segments. The section we're submitting now
        // always overwrites with the latest count (0 included). Other sections
        // get backfilled from NA → 0 if sectionsCompleted says so.
        var row = data[existingIdx];
        var segmentCol = 4 + sectionIdx; // columns 4..7 inside the row
        if (hasCount) row[segmentCol] = numCount;
        // Backfill NA → 0 for sections marked complete elsewhere
        for (var s = 0; s < 4; s++) {
          if (row[4 + s] === "NA" && sectionsCompleted[s]) row[4 + s] = 0;
        }
        // Recompute Total (NA contributes 0)
        row[8] = sumSegments(row);
      }
    });
  });

  // Write the whole data back in one go. Cheaper than per-cell updates.
  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, SPECIES_HEADERS.length).setValues(data);
  }
}

function buildSpeciesRow(date, site, line, species, sectionIdx, count, sectionsCompleted) {
  var row = [date, site, line, species, "NA", "NA", "NA", "NA", 0];
  row[4 + sectionIdx] = count;
  // Backfill NA → 0 for other sections that were marked complete previously
  for (var s = 0; s < 4; s++) {
    if (s !== sectionIdx && sectionsCompleted[s]) row[4 + s] = 0;
  }
  row[8] = sumSegments(row);
  return row;
}

function sumSegments(row) {
  var t = 0;
  for (var i = 4; i < 8; i++) {
    var v = row[i];
    if (typeof v === "number") t += v;
    else if (v !== "NA" && v !== "" && v !== null) {
      var n = parseFloat(v);
      if (!isNaN(n)) t += n;
    }
  }
  return t;
}

function makeSpeciesKey(date, site, line, species) {
  return [date, site, line, species].join("|");
}

/* ====================================================================
 *  Substrate: pure per-point rows.
 *
 *  Each app substrate row carries P1..P40 for one section. We expand
 *  into 40 destination rows (one per point), with HC details carried
 *  through the Form / Health / Taxonomy columns. Composite key is
 *  (date × site × line × distance) so re-submissions overwrite.
 * ==================================================================== */

function processSubstrateRows(sheet, appRows) {
  var lastRow = sheet.getLastRow();
  var data = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, SUBSTRATE_HEADERS.length).getValues()
    : [];
  var rowIndexByKey = {};
  for (var i = 0; i < data.length; i++) {
    var key = makeSubstrateKey(data[i][0], data[i][1], data[i][2], data[i][3]);
    rowIndexByKey[key] = i;
  }

  // 4 transect sections, each 20m long, starting at 0/25/50/75m.
  var SECTION_LABEL_TO_START = { "0-20m": 0, "25-45m": 25, "50-70m": 50, "75-95m": 75 };

  appRows.forEach(function (appRow) {
    var date = formatDateOnly(appRow.date);
    var site = appRow.location || "";
    var line = deriveLine(appRow.fixedTransect, appRow.depth);
    var sectionStart = SECTION_LABEL_TO_START[appRow.section];
    if (sectionStart === undefined) return;

    for (var p = 0; p < 40; p++) {
      var cellRaw = appRow["P" + (p + 1)];
      if (!cellRaw && cellRaw !== 0) continue;
      var parsed = parseSubstrateCell(cellRaw);
      var distance = sectionStart + (p + 1) * 0.5;

      var key = makeSubstrateKey(date, site, line, distance);
      var newRow = [date, site, line, distance, parsed.type, parsed.form, parsed.health, parsed.taxonomy];
      var existingIdx = rowIndexByKey[key];
      if (existingIdx === undefined) {
        data.push(newRow);
        rowIndexByKey[key] = data.length - 1;
      } else {
        data[existingIdx] = newRow;
      }
    }
  });

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, SUBSTRATE_HEADERS.length).setValues(data);
  }
}

// App stores substrate cells as space-separated tokens, e.g.:
//   "SD"  / "RB"  / "RC"  / "NIA"
//   "HC B PBL ACRO"  (Type Form Health Taxonomy)
//   "OTH: GC"  / "OTH GC" / "OTH"
// We split and slot accordingly. OTH gets Type=OTH only; the description
// (if any) is intentionally dropped (per user spec for the second Sheet).
function parseSubstrateCell(cell) {
  var s = String(cell || "").trim();
  if (!s) return { type: "", form: "", health: "", taxonomy: "" };
  // OTH variants — strip any colon/description, keep just "OTH"
  if (s.charAt(0).toUpperCase() === "O" && s.toUpperCase().indexOf("OTH") === 0) {
    return { type: "OTH", form: "", health: "", taxonomy: "" };
  }
  var parts = s.split(/\s+/);
  var type = parts[0] || "";
  if (type === "HC") {
    return {
      type: "HC",
      form: parts[1] || "",
      health: parts[2] || "",
      taxonomy: parts[3] || "",
    };
  }
  return { type: type, form: "", health: "", taxonomy: "" };
}

function makeSubstrateKey(date, site, line, distance) {
  return [date, site, line, distance].join("|");
}

/* ====================================================================
 *  Shared helpers
 * ==================================================================== */

// "Line" in the analytical sheet uses lowercase deep / shallow / random.
function deriveLine(fixedTransect, depth) {
  if (fixedTransect === "no") return "random";
  if (typeof depth === "string") {
    var d = depth.trim().toLowerCase();
    if (d === "deep" || d === "shallow") return d;
    if (d === "random") return "random";
  }
  return "";
}

function formatDateOnly(v) {
  if (!v) return "";
  // Already YYYY-MM-DD?
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    var d = new Date(v);
    if (!isNaN(d.getTime())) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, "0");
      var dd = String(d.getDate()).padStart(2, "0");
      return y + "-" + m + "-" + dd;
    }
  } catch (_) {}
  return s;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
