// Ecological Monitoring Survey — single-page PWA
// Three surveys (Chordates, Invertebrate, Substrate) sharing site metadata.
// Persists drafts to localStorage; syncs completed surveys to a Google Apps Script web app.

/* =========================================================================
 *  DATA: indicator species lists and substrate definitions
 *  These are the authoritative reference data for the surveys.
 * ========================================================================= */

const SECTIONS = ["0-20m", "25-45m", "50-70m", "75-95m"];
// Start of each section in metres along the full transect line — the four
// sections have 5m gaps between them, so distances are non-contiguous.
const SECTION_STARTS = [0, 25, 50, 75];

// Absolute distance (m) along the transect for the (sectionIdx, pointIdx) pair.
// pointIdx 0 → first point at +0.5m; pointIdx 39 → last point at +20.0m.
function absoluteDistance(sectionIdx, pointIdx) {
  return SECTION_STARTS[sectionIdx] + (pointIdx + 1) * 0.5;
}

// Special abundance scale used for Drupella and Long-spined Black Sea Urchin
const ABUNDANCE_SCALE = {
  values: [0, 1, 2, 3],
  labels: { 0: "0", 1: "1–50", 2: "51–150", 3: ">150" },
};

const CHORDATES = [
  {
    category: "Butterfly Fish",
    species: ["Copper Banded", "8 Banded", "Lined", "Longfin Bannerfish", "Wiebel's"],
  },
  { category: "Cartilaginous Fish", species: ["Shark", "Ray"] },
  { category: "Grouper", species: ["Large (>30cm)", "Small (<30cm)"] },
  { category: null, species: ["Moray Eel"] },
  { category: "Parrotfish", species: ["Large (>20cm)", "Small (<20cm)"] },
  { category: null, species: ["Rabbitfish"] },
  { category: "Reptile", species: ["Sea Snake/Turtle"] },
  { category: null, species: ["Snapper"] },
  { category: null, species: ["Surgeonfish"] },
  { category: "Sweetlips", species: ["Juvenile", "Adult"] },
  { category: null, species: ["Triggerfish"] },
  { category: "Wrasse", species: ["Red Breasted"] },
  { category: "Other Fish", species: ["Porcupine Fish", "Yellow Boxfish"] },
];

const INVERTEBRATES = [
  { category: "Cephalopod", species: ["Cuttlefish", "Squid", "Octopus"] },
  { category: "Crustacean", species: ["Hermit Crab"] },
  { category: null, species: ["Flatworm"] },
  {
    category: "Gastropod",
    species: [
      "Auger Snail",
      "Cowrie",
      { name: "Drupella", scale: "abundance" },
      "Ramose Murex",
      "Sea Slug",
    ],
  },
  { category: "Giant Clam", species: ["Boring", "Giant"] },
  {
    category: "Sea Cucumber",
    species: ["Black", "Marbled", "Orange Spiked", "Pinkfish"],
  },
  {
    category: "Sea Urchin",
    species: [{ name: "Long-spined Black Sea Urchin", scale: "abundance" }],
  },
  { category: "Starfish", species: ["Crown Of Thorns", "Cushion Star"] },
];

const SUBSTRATE_TYPES = [
  // Abiotic
  { code: "SI", name: "Silt", group: "abiotic" },
  { code: "SD", name: "Sand", group: "abiotic" },
  { code: "RB", name: "Rubble", group: "abiotic" },
  { code: "RC", name: "Rock", group: "abiotic" },
  { code: "AR", name: "Artificial Reef", group: "abiotic" },
  { code: "TR", name: "Trash", group: "abiotic" },
  // Biotic
  { code: "SC", name: "Soft Coral", group: "biotic" },
  { code: "SP", name: "Sponge", group: "biotic" },
  { code: "NIA", name: "Nutrient Indicator Algae", group: "biotic" },
  { code: "OTH", name: "Other", group: "biotic", needsText: true },
  { code: "HC", name: "Hard Coral", group: "biotic", needsHC: true },
];

const HC_GROWTH = [
  ["B", "Branching"],
  ["C", "Corymbose"],
  ["D", "Digitate"],
  ["E", "Encrusting"],
  ["F", "Foliose"],
  ["L", "Laminar"],
  ["M", "Massive"],
  ["R", "Solitary"],
  ["S", "Submassive"],
  ["T", "Tabulate"],
  ["U", "Unknown"],
];

// Coral genus codes grouped by Tax tier. The HC details modal narrows the
// genus picker by tier so the surveyor doesn't have to scroll one giant
// alphabetical list. Codes are uppercase by convention.
const HC_GENUS_TIERS = {
  "Tax I":   ["ACRO", "POCI", "DUNC", "DIPL", "LOBO", "GONIO", "HYDN", "PAVO", "PECT", "MERU", "PACH", "GARD", "GALA", "PORI", "MONT", "STYL", "FIMB", "PLER"],
  "Tax II":  ["ASTR", "TURB", "CAUL", "DIPS", "PLES", "CYPH", "ECHINOPO", "OXYP", "FUNG", "DANA", "PLEU", "CTEN", "HERP", "POLY", "CYCL", "LITH", "PODA", "SAND"],
  "Tax III": ["ACAN", "ECHINOPH", "PSAM", "COSC", "LEPTA", "PSEU", "LEPTOS", "FAVI", "GONIA", "PARA", "PLAT", "LEPTOR", "TUBA", "CLAD"],
};

// Given a genus code, return its tier ("Tax I" / "Tax II" / "Tax III") or
// null if unknown. Used to pre-select the tier dropdown when editing a point.
function findGenusTier(genus) {
  for (const tier of Object.keys(HC_GENUS_TIERS)) {
    if (HC_GENUS_TIERS[tier].includes(genus)) return tier;
  }
  return null;
}

const HC_HEALTH = [
  ["H", "Healthy"],
  ["PBL", "Partially Bleached"],
  ["FBL", "Fully Bleached"],
  ["RKC", "Recently Killed Coral"],
  ["DC", "Dead Coral"],
];

const POINTS_PER_SECTION = 40; // 0.5m spacing × 20m

// "Location Within" predefined options — a refinement under the chosen dive
// site (which part of the site this survey covers). "Other" triggers a free-
// text input that gets folded into the stored string as "Other: <text>".
const LOCATION_WITHIN_OPTIONS = [
  "Main Site",
  "Artificial Reef",
  "Pinnacle",
  "Reef",
  "North Wall",
  "East Wall",
  "South Wall",
  "West Wall",
  "Sand Patch",
];

// Seeded dive sites — the surveyor can append device-local custom sites too.
const DEFAULT_DIVE_SITES = [
  "Twins",
  "Mango Bay",
  "Junkyard",
  "Aow Leuk",
  "Tanote Bay",
  "BTD Reef",
  "Tao Tong",
  "Freedom Beach",
  "Laem Thian",
  "Japanese Gardens",
];

/* =========================================================================
 *  STORAGE KEYS
 * ========================================================================= */

const LS_DRAFT = "ems:draft";
const LS_QUEUE = "ems:queue";
const LS_SETTINGS = "ems:settings";
const LS_CUSTOM_SITES = "ems:customDiveSites";

// Baked-in Apps Script Web App endpoint for the BTC team's shared master
// Sheet. New devices pick this up automatically — teammates only need to
// open the URL and start submitting. If you ever need a different endpoint,
// override it in Settings (⚙). If you clear the field there, sync turns off.
const DEFAULT_SYNC_URL = "https://script.google.com/macros/s/AKfycbxls2SjgPyuMLWxuAiF-AUkusoW2DTZvy1kqOLcEtIWw0ZpYmkUNTK8R61Lmd_D0XS6rw/exec";

// Shared secret token sent in every submission payload. The Apps Script
// checks this value at the top of doPost and rejects requests without a
// match. Stops drive-by scrapers and bots. Not strong security — the token
// is visible to anyone who reads app.js — but a good speed-bump.
//
// To rotate: generate a new token, update this constant AND the SYNC_SECRET
// constant in apps-script.gs, redeploy the Apps Script, bump CACHE_VERSION.
const SYNC_SECRET = "1c4c012f-552e-48b0-8cdd-1f5d83e9fafa-f1f0ad7b";

/* =========================================================================
 *  STATE
 *  draft: the in-progress survey set (one site visit = 3 surveys)
 *  queue: completed survey-sets waiting to be synced to Sheets
 * ========================================================================= */

const state = {
  draft: null,
  queue: [],
  settings: { syncUrl: "", autoSync: true },
  current: "setup",
  inputModes: { chordates: "tally", invertebrate: "tally" },
  activeSection: { chordates: 0, invertebrate: 0, substrate: 0 },
  substrateCursor: { section: 0, point: 0 },
};

function newDraft() {
  return {
    id: cryptoId(),
    createdAt: new Date().toISOString(),
    metadata: {
      // "single" → one shared surveyor name; "multiple" → three separate ones.
      // Toggle lives in the Setup / Info screens.
      surveyorMode: "single",
      surveyors: { chordates: "", invertebrate: "", substrate: "" },
      date: "",
      location: "",
      depth: "",
      fixedTransect: "",
    },
    chordates: blankSpeciesData(CHORDATES),
    invertebrate: blankSpeciesData(INVERTEBRATES),
    substrate: blankSubstrateData(),
    // Tracks which sections have been submitted to Sheets so we can flag duplicates.
    submitted: {
      chordates: [false, false, false, false],
      invertebrate: [false, false, false, false],
      substrate: [false, false, false, false],
    },
    // User-driven "I'm done with this section" flag for species surveys.
    // Most reef counts are 0 (default), so we don't infer completion from cell
    // fills — the surveyor explicitly marks the section as done.
    sectionComplete: {
      chordates: [false, false, false, false],
      invertebrate: [false, false, false, false],
    },
    // Per-section metadata captured at the start of each transect leg:
    // a time-of-day stamp and a starting depth in metres. Stored as strings
    // so they round-trip cleanly through localStorage / JSON / Sheets.
    sectionMeta: blankSectionMeta(),
  };
}

function blankSectionMeta() {
  return {
    chordates: SECTIONS.map(() => ({ startTime: "", startDepth: "", notes: "" })),
    invertebrate: SECTIONS.map(() => ({ startTime: "", startDepth: "", notes: "" })),
    substrate: SECTIONS.map(() => ({ startTime: "", startDepth: "", notes: "" })),
  };
}

function blankSpeciesData(list) {
  const out = {};
  flattenSpecies(list).forEach((sp) => {
    out[sp.name] = SECTIONS.map(() => null); // null = not entered
  });
  return out;
}

function blankSubstrateData() {
  // 4 sections × 40 points each. Each cell stores a value object or null.
  return SECTIONS.map(() => Array(POINTS_PER_SECTION).fill(null));
}

function flattenSpecies(list) {
  const out = [];
  list.forEach((grp) => {
    grp.species.forEach((sp) => {
      const obj = typeof sp === "string" ? { name: sp } : sp;
      out.push({ ...obj, category: grp.category });
    });
  });
  return out;
}

function cryptoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* =========================================================================
 *  PERSISTENCE
 * ========================================================================= */

function saveDraft() {
  if (state.draft) localStorage.setItem(LS_DRAFT, JSON.stringify(state.draft));
}
function loadDraft() {
  const raw = localStorage.getItem(LS_DRAFT);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    // Migrate older drafts that pre-date the sectionComplete flag.
    if (!d.sectionComplete) {
      d.sectionComplete = {
        chordates: [false, false, false, false],
        invertebrate: [false, false, false, false],
      };
    }
    if (!d.submitted) {
      d.submitted = {
        chordates: [false, false, false, false],
        invertebrate: [false, false, false, false],
        substrate: [false, false, false, false],
      };
    }
    if (!d.sectionMeta) d.sectionMeta = blankSectionMeta();
    // One-off: split the old "Shark/Ray" combined entry into the new "Shark"
    // and "Ray" species. Copy its values into both so historic counts aren't
    // lost — the surveyor can refine per-species going forward.
    if (d.chordates && d.chordates["Shark/Ray"]) {
      d.chordates["Shark"] = d.chordates["Shark"] || d.chordates["Shark/Ray"].slice();
      d.chordates["Ray"] = d.chordates["Ray"] || d.chordates["Shark/Ray"].slice();
      delete d.chordates["Shark/Ray"];
    }
    // Ensure every species in the current schema has an array on the draft —
    // schemas change (additions / renames) and we don't want runtime undefined
    // errors when rendering an older draft against a newer schema.
    [["chordates", CHORDATES], ["invertebrate", INVERTEBRATES]].forEach(([key, list]) => {
      if (!d[key]) d[key] = {};
      flattenSpecies(list).forEach((sp) => {
        if (!d[key][sp.name]) d[key][sp.name] = SECTIONS.map(() => null);
      });
    });
    // Ensure sectionMeta entries have notes (older drafts may not).
    ["chordates", "invertebrate", "substrate"].forEach((k) => {
      if (!d.sectionMeta[k]) d.sectionMeta[k] = SECTIONS.map(() => ({ startTime: "", startDepth: "", notes: "" }));
      d.sectionMeta[k].forEach((sm) => {
        if (typeof sm.notes !== "string") sm.notes = "";
      });
    });
    // Migrate single `surveyor` field → per-survey surveyors map. Old single
    // value is copied to all three so behaviour stays identical until edited.
    if (d.metadata && !d.metadata.surveyors) {
      const legacy = d.metadata.surveyor || "";
      d.metadata.surveyors = {
        chordates: legacy,
        invertebrate: legacy,
        substrate: legacy,
      };
      delete d.metadata.surveyor;
    }
    // Default surveyor mode based on whether the three names already differ —
    // existing draft users keep their data visible without reconfiguring.
    if (d.metadata && !d.metadata.surveyorMode) {
      const s = d.metadata.surveyors || {};
      const allSame = (s.chordates || "") === (s.invertebrate || "") && (s.invertebrate || "") === (s.substrate || "");
      d.metadata.surveyorMode = allSame ? "single" : "multiple";
    }
    return d;
  } catch { return null; }
}
function clearDraft() {
  localStorage.removeItem(LS_DRAFT);
  state.draft = null;
}
function saveQueue() { localStorage.setItem(LS_QUEUE, JSON.stringify(state.queue)); }
function loadQueue() {
  const raw = localStorage.getItem(LS_QUEUE);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
function loadCustomSites() {
  try { return JSON.parse(localStorage.getItem(LS_CUSTOM_SITES) || "[]"); }
  catch { return []; }
}
function saveCustomSites(list) {
  localStorage.setItem(LS_CUSTOM_SITES, JSON.stringify(list));
}
// Combined dive sites: defaults + any device-local additions, deduped
// case-insensitively and sorted alphabetically. New additions slot in
// naturally because this is called on every render.
function getAllDiveSites() {
  const seen = new Set();
  const out = [];
  [...DEFAULT_DIVE_SITES, ...loadCustomSites()].forEach((s) => {
    const trimmed = (s || "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  });
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}
function addCustomSite(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  const all = getAllDiveSites().map((s) => s.toLowerCase());
  if (all.includes(trimmed.toLowerCase())) return false;
  const custom = loadCustomSites();
  custom.push(trimmed);
  saveCustomSites(custom);
  return true;
}

function saveSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); }
function loadSettings() {
  // Default to the baked-in team endpoint so new devices work without any
  // manual setup. Existing saved settings override (user values win, even if
  // they explicitly cleared the URL to disable sync).
  const defaults = { syncUrl: DEFAULT_SYNC_URL, autoSync: true };
  const raw = localStorage.getItem(LS_SETTINGS);
  if (!raw) return defaults;
  try { return { ...defaults, ...JSON.parse(raw) }; }
  catch { return defaults; }
}

/* =========================================================================
 *  ROUTING / RENDER
 * ========================================================================= */

const $app = () => document.getElementById("app");

function renderTpl(id) {
  const tpl = document.getElementById(id);
  const node = tpl.content.firstElementChild.cloneNode(true);
  $app().innerHTML = "";
  $app().appendChild(node);
  return node;
}

function go(screen) {
  state.current = screen;
  document.querySelectorAll("#survey-tabs .tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.screen === screen);
  });
  const tabs = document.getElementById("survey-tabs");
  tabs.classList.toggle("hidden", screen === "setup");
  if (screen === "setup") renderSetup();
  else if (screen === "info") renderInfo();
  else if (screen === "chordates") renderSpecies("chordates", CHORDATES, "Chordates Survey");
  else if (screen === "invertebrate") renderSpecies("invertebrate", INVERTEBRATES, "Invertebrates Survey");
  else if (screen === "substrate") renderSubstrate();
  else if (screen === "review") renderReview();
}

/* =========================================================================
 *  DIVE SITE PICKER
 *  Enhances a plain text input with three features:
 *    - native <datalist> autocomplete (filters as the user types)
 *    - a "+" toggle that opens a tap-list of all known sites
 *    - an inline "Add new site" form at the bottom of that list
 *  Used on both the Setup and Info screens. Custom additions persist per
 *  device in localStorage so the same user gets them on future site visits.
 * ========================================================================= */

function attachDiveSitePicker(input) {
  // Wrap the existing input so we can sit a + button next to it and float a
  // dropdown panel below.
  const wrap = document.createElement("div");
  wrap.className = "dive-site-wrap";
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  // Native autocomplete suggestions
  const datalistId = "dive-sites-" + Math.random().toString(36).slice(2, 8);
  const datalist = document.createElement("datalist");
  datalist.id = datalistId;
  input.setAttribute("list", datalistId);
  wrap.appendChild(datalist);

  function refreshDatalist() {
    datalist.innerHTML = "";
    getAllDiveSites().forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      datalist.appendChild(opt);
    });
  }
  refreshDatalist();

  // + toggle button — opens the full pickable list
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "dive-site-toggle";
  toggle.textContent = "+";
  toggle.title = "Pick from list";
  wrap.appendChild(toggle);

  const panel = document.createElement("div");
  panel.className = "dive-site-panel hidden";
  wrap.appendChild(panel);

  function setValue(val) {
    input.value = val;
    // Trigger 'input' so any auto-save listeners (Info screen) pick it up.
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderPanel() {
    panel.innerHTML = "";
    getAllDiveSites().forEach((s) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "dive-site-item";
      item.textContent = s;
      item.addEventListener("click", () => { setValue(s); closePanel(); });
      panel.appendChild(item);
    });

    // Inline "Add new" — starts as a single button, expands into a small form.
    const addRow = document.createElement("div");
    addRow.className = "dive-site-add-row";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "dive-site-add";
    addBtn.textContent = "+ Add new site";

    const addForm = document.createElement("div");
    addForm.className = "dive-site-add-form hidden";
    const newInput = document.createElement("input");
    newInput.type = "text";
    newInput.maxLength = 40;
    newInput.placeholder = "New dive site name";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ghost";
    cancelBtn.textContent = "Cancel";
    addForm.append(newInput, saveBtn, cancelBtn);

    addBtn.addEventListener("click", () => {
      addBtn.classList.add("hidden");
      addForm.classList.remove("hidden");
      newInput.focus();
    });
    cancelBtn.addEventListener("click", () => {
      addForm.classList.add("hidden");
      addBtn.classList.remove("hidden");
      newInput.value = "";
    });
    function commitNew() {
      const name = newInput.value.trim();
      if (!name) return;
      const added = addCustomSite(name);
      refreshDatalist();
      setValue(name);
      if (added) toast(`Added "${name}" to dive sites.`);
      renderPanel();
      closePanel();
    }
    saveBtn.addEventListener("click", commitNew);
    newInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitNew(); }
      if (e.key === "Escape") { cancelBtn.click(); }
    });

    addRow.append(addBtn, addForm);
    panel.appendChild(addRow);
  }
  renderPanel();

  function openPanel() { panel.classList.remove("hidden"); }
  function closePanel() { panel.classList.add("hidden"); }
  function togglePanel() { panel.classList.toggle("hidden"); }

  toggle.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });

  // Close panel when clicking outside the wrap.
  const outsideHandler = (e) => { if (!wrap.contains(e.target)) closePanel(); };
  document.addEventListener("click", outsideHandler);
  // No formal teardown — the next renderTpl() blows away the DOM and the
  // detached document listener becomes a no-op.
}

// Wires the "Location Within" select + companion "Other" text input. Populates
// the dropdown options, restores the stored value, shows/hides the Other text
// box, and exposes read/write helpers so the Setup submit and Info auto-save
// can stay simple.
//
// Stored format:
//   - One of the predefined values:  "Main Site", "Pinnacle", …
//   - For Other:                     "Other: <free text>"  (or just "Other")
function attachLocationWithinPicker(scope) {
  const select = scope.querySelector('[name="locationWithin"]');
  const otherField = scope.querySelector(".location-within-other");
  const otherInput = scope.querySelector('[name="locationWithinOther"]');
  if (!select) return null;

  // Populate dropdown — preserve "— Choose —" placeholder, append predefined
  // values, then append "Other: Please Specify" at the bottom.
  LOCATION_WITHIN_OPTIONS.forEach((opt) => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    select.appendChild(o);
  });
  const otherOpt = document.createElement("option");
  otherOpt.value = "Other";
  otherOpt.textContent = "Other: Please Specify";
  select.appendChild(otherOpt);

  function toggleOther() {
    const isOther = select.value === "Other";
    otherField.classList.toggle("hidden", !isOther);
  }
  select.addEventListener("change", toggleOther);

  function setValueFromStored(stored) {
    if (!stored) { select.value = ""; otherInput.value = ""; toggleOther(); return; }
    if (stored.startsWith("Other:")) {
      select.value = "Other";
      otherInput.value = stored.replace(/^Other:\s*/, "");
    } else if (stored === "Other") {
      select.value = "Other";
      otherInput.value = "";
    } else if (LOCATION_WITHIN_OPTIONS.includes(stored)) {
      select.value = stored;
      otherInput.value = "";
    } else {
      // Custom legacy value — treat as Other with that text
      select.value = "Other";
      otherInput.value = stored;
    }
    toggleOther();
  }

  function readValue() {
    if (select.value !== "Other") return select.value || "";
    const free = (otherInput.value || "").trim();
    return free ? `Other: ${free}` : "Other";
  }

  return { setValueFromStored, readValue, select, otherInput };
}

/* =========================================================================
 *  SETUP SCREEN
 * ========================================================================= */

function renderSetup() {
  const node = renderTpl("tpl-setup");
  const form = node.querySelector("#setup-form");
  const resumeBtn = node.querySelector("#resume-btn");
  const depthField = node.querySelector("#depth-field");
  const depthSelect = form.querySelector('[name="depth"]');

  function applyFixedState(fixedVal) {
    if (fixedVal === "yes") {
      depthField.classList.remove("hidden");
      depthSelect.required = true;
    } else if (fixedVal === "no") {
      depthField.classList.add("hidden");
      depthSelect.required = false;
      depthSelect.value = ""; // depth auto-fills to Random on submit
    } else {
      depthField.classList.add("hidden");
      depthSelect.required = false;
    }
  }

  form.querySelectorAll('[name="fixed"]').forEach((r) => {
    r.addEventListener("change", () => applyFixedState(r.value));
  });

  // Copy Previous buttons — each copies the value from data-source to data-target.
  function wireCopyButtons(scope) {
    scope.querySelectorAll(".copy-prev").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = scope.querySelector(`[name="${btn.dataset.source}"]`);
        const tgt = scope.querySelector(`[name="${btn.dataset.target}"]`);
        if (!src || !tgt) return;
        tgt.value = src.value;
        tgt.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  }
  wireCopyButtons(form);

  // Surveyor One/Multiple toggle
  const singleBlock = form.querySelector(".surveyor-single");
  const multiBlock = form.querySelector(".surveyor-multiple");
  function applySurveyorMode(mode) {
    form.querySelectorAll("[data-surveyor-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.surveyorMode === mode);
    });
    singleBlock.classList.toggle("hidden", mode !== "single");
    multiBlock.classList.toggle("hidden", mode !== "multiple");
  }
  form.querySelectorAll("[data-surveyor-mode]").forEach((b) => {
    b.addEventListener("click", () => {
      const next = b.dataset.surveyorMode;
      applySurveyorMode(next);
      // When switching multiple → single, snapshot chordates' value as the
      // canonical single. When single → multiple, push the single value into
      // all three multi inputs so they're not empty.
      const singleInp = form.querySelector('[name="surveyor_single"]');
      const cInp = form.querySelector('[name="surveyor_chordates"]');
      const iInp = form.querySelector('[name="surveyor_invertebrate"]');
      const sInp = form.querySelector('[name="surveyor_substrate"]');
      if (next === "single") {
        // Multiple → Single: collapse to the chordates value (canonical).
        singleInp.value = cInp.value || iInp.value || sInp.value || singleInp.value;
      } else {
        // Single → Multiple: mirror the single value into all three inputs so
        // the visible state matches the stored data (all three identical).
        const v = singleInp.value;
        cInp.value = v;
        iInp.value = v;
        sInp.value = v;
      }
    });
  });

  const existing = loadDraft();
  if (existing) {
    resumeBtn.classList.remove("hidden");
    const m = existing.metadata || {};
    const mode = m.surveyorMode || "single";
    applySurveyorMode(mode);
    form.querySelector('[name="surveyor_chordates"]').value = m.surveyors?.chordates || "";
    form.querySelector('[name="surveyor_invertebrate"]').value = m.surveyors?.invertebrate || "";
    form.querySelector('[name="surveyor_substrate"]').value = m.surveyors?.substrate || "";
    // The single input mirrors whichever name is canonical for single mode.
    form.querySelector('[name="surveyor_single"]').value =
      m.surveyors?.chordates || m.surveyors?.invertebrate || m.surveyors?.substrate || "";
    if (m.date) form.querySelector('[name="date"]').value = m.date;
    if (m.location) form.querySelector('[name="location"]').value = m.location;
    if (m.depth) form.querySelector('[name="depth"]').value = m.depth;
    // Pre-fill the Fixed Transect radio + depth visibility
    if (m.fixedTransect) {
      const r = form.querySelector(`[name="fixed"][value="${m.fixedTransect}"]`);
      if (r) { r.checked = true; applyFixedState(m.fixedTransect); }
    }
    resumeBtn.addEventListener("click", () => {
      state.draft = existing;
      saveDraft();
      go("chordates");
    });
  }

  // Default date today
  if (!form.date.value) form.date.value = new Date().toISOString().slice(0, 10);

  attachDiveSitePicker(form.querySelector('[name="location"]'));
  const locWithin = attachLocationWithinPicker(form);
  if (locWithin && existing) locWithin.setValueFromStored(existing.metadata?.locationWithin || "");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const fixed = (fd.get("fixed") || "").toString();
    const depth = fixed === "no" ? "Random" : (fd.get("depth") || "").toString();
    const mode = form.querySelector("[data-surveyor-mode].active")?.dataset.surveyorMode || "single";
    let surveyors;
    if (mode === "single") {
      const v = (fd.get("surveyor_single") || "").toString().trim();
      surveyors = { chordates: v, invertebrate: v, substrate: v };
    } else {
      surveyors = {
        chordates: (fd.get("surveyor_chordates") || "").toString().trim(),
        invertebrate: (fd.get("surveyor_invertebrate") || "").toString().trim(),
        substrate: (fd.get("surveyor_substrate") || "").toString().trim(),
      };
    }
    const meta = {
      surveyorMode: mode,
      surveyors,
      date: fd.get("date").toString(),
      location: (fd.get("location") || "").toString().trim(),
      locationWithin: locWithin ? locWithin.readValue() : "",
      depth: depth,
      fixedTransect: fixed,
    };
    // At least one surveyor must be filled; date/location/fixed are required.
    const anySurveyor = surveyors.chordates || surveyors.invertebrate || surveyors.substrate;
    if (!anySurveyor) { toast("Fill at least one surveyor name."); return; }
    if (!meta.date || !meta.location || !meta.fixedTransect) return;
    if (meta.fixedTransect === "yes" && !meta.depth) return;

    if (!state.draft) state.draft = newDraft();
    state.draft.metadata = meta;
    // If this is a brand-new draft we also need the submitted-flags scaffold.
    if (!state.draft.submitted) {
      state.draft.submitted = {
        chordates: [false, false, false, false],
        invertebrate: [false, false, false, false],
        substrate: [false, false, false, false],
      };
    }
    saveDraft();
    go("chordates");
  });
}

// Builds the free-text Notes box that sits at the bottom of each section.
// Notes auto-persist per (survey, section) into state.draft.sectionMeta and
// are included as a column in the Sheet rows on submit.
function renderSectionNotesBar(surveyKey, sectionIdx) {
  const meta = state.draft.sectionMeta[surveyKey][sectionIdx];
  const bar = document.createElement("div");
  bar.className = "section-notes-bar";

  const label = document.createElement("label");
  label.className = "section-notes-field";
  const labelText = document.createElement("span");
  labelText.textContent = `Notes — ${SECTIONS[sectionIdx]}`;
  const textarea = document.createElement("textarea");
  textarea.className = "section-notes-input";
  textarea.maxLength = 2000;
  textarea.rows = 4;
  textarea.placeholder = "Anything noteworthy about this section — sightings, conditions, gear issues, …";
  textarea.value = meta.notes || "";
  textarea.addEventListener("input", () => {
    state.draft.sectionMeta[surveyKey][sectionIdx].notes = textarea.value;
    saveDraft();
  });
  label.append(labelText, textarea);
  bar.appendChild(label);
  return bar;
}

/* =========================================================================
 *  SURVEY INFO (mid-survey metadata editor)
 *  Renders an auto-saving form pre-filled from state.draft.metadata. Lets the
 *  surveyor correct the surveyor name, date, location, fixed-transect, and
 *  depth without losing any survey data.
 * ========================================================================= */

function renderInfo() {
  if (!state.draft) return go("setup");
  const node = renderTpl("tpl-info");
  const form = node.querySelector("#info-form");
  const depthField = node.querySelector("#info-depth-field");
  const depthSelect = form.querySelector('[name="depth"]');
  const savedIndicator = node.querySelector("#info-saved");

  function applyFixedState(val) {
    if (val === "yes") {
      depthField.classList.remove("hidden");
    } else if (val === "no") {
      depthField.classList.add("hidden");
      depthSelect.value = "";
    } else {
      depthField.classList.add("hidden");
    }
  }

  // Pre-fill with current metadata
  const m = state.draft.metadata;
  const singleBlock = form.querySelector(".surveyor-single");
  const multiBlock = form.querySelector(".surveyor-multiple");
  function applySurveyorMode(mode) {
    form.querySelectorAll("[data-surveyor-mode]").forEach((b) => {
      b.classList.toggle("active", b.dataset.surveyorMode === mode);
    });
    singleBlock.classList.toggle("hidden", mode !== "single");
    multiBlock.classList.toggle("hidden", mode !== "multiple");
  }
  applySurveyorMode(m.surveyorMode || "single");

  form.querySelector('[name="surveyor_chordates"]').value = m.surveyors?.chordates || "";
  form.querySelector('[name="surveyor_invertebrate"]').value = m.surveyors?.invertebrate || "";
  form.querySelector('[name="surveyor_substrate"]').value = m.surveyors?.substrate || "";
  form.querySelector('[name="surveyor_single"]').value =
    m.surveyors?.chordates || m.surveyors?.invertebrate || m.surveyors?.substrate || "";
  form.querySelector('[name="date"]').value = m.date || "";
  form.querySelector('[name="location"]').value = m.location || "";
  // Location Within picker + Other text input
  const locWithin = attachLocationWithinPicker(form);
  if (locWithin) locWithin.setValueFromStored(m.locationWithin || "");
  if (m.fixedTransect) {
    const radio = form.querySelector(`[name="fixed"][value="${m.fixedTransect}"]`);
    if (radio) radio.checked = true;
    applyFixedState(m.fixedTransect);
    if (m.fixedTransect === "yes") depthSelect.value = m.depth || "";
  } else {
    depthField.classList.add("hidden");
  }

  // Copy Previous buttons within the Info form
  form.querySelectorAll(".copy-prev").forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = form.querySelector(`[name="${btn.dataset.source}"]`);
      const tgt = form.querySelector(`[name="${btn.dataset.target}"]`);
      if (!src || !tgt) return;
      tgt.value = src.value;
      tgt.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  let savedTimer = null;
  function flashSaved() {
    if (!savedIndicator) return;
    savedIndicator.textContent = "Saved ✓";
    savedIndicator.classList.add("flash");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      savedIndicator.textContent = "Changes save automatically.";
      savedIndicator.classList.remove("flash");
    }, 1400);
  }

  function currentMode() {
    return form.querySelector("[data-surveyor-mode].active")?.dataset.surveyorMode || "single";
  }
  function persist() {
    const fd = new FormData(form);
    const fixed = (fd.get("fixed") || "").toString();
    const mode = currentMode();
    if (!state.draft.metadata.surveyors) state.draft.metadata.surveyors = {};
    if (mode === "single") {
      const v = (fd.get("surveyor_single") || "").toString().trim();
      state.draft.metadata.surveyors.chordates = v;
      state.draft.metadata.surveyors.invertebrate = v;
      state.draft.metadata.surveyors.substrate = v;
    } else {
      state.draft.metadata.surveyors.chordates = (fd.get("surveyor_chordates") || "").toString().trim();
      state.draft.metadata.surveyors.invertebrate = (fd.get("surveyor_invertebrate") || "").toString().trim();
      state.draft.metadata.surveyors.substrate = (fd.get("surveyor_substrate") || "").toString().trim();
    }
    state.draft.metadata.surveyorMode = mode;
    state.draft.metadata.date = (fd.get("date") || "").toString();
    state.draft.metadata.location = (fd.get("location") || "").toString().trim();
    state.draft.metadata.locationWithin = locWithin ? locWithin.readValue() : "";
    state.draft.metadata.fixedTransect = fixed;
    state.draft.metadata.depth = fixed === "no" ? "Random" : (fd.get("depth") || "").toString();
    saveDraft();
    flashSaved();
  }

  // Mode toggle handlers on Info screen
  form.querySelectorAll("[data-surveyor-mode]").forEach((b) => {
    b.addEventListener("click", () => {
      const next = b.dataset.surveyorMode;
      applySurveyorMode(next);
      const singleInp = form.querySelector('[name="surveyor_single"]');
      const cInp = form.querySelector('[name="surveyor_chordates"]');
      const iInp = form.querySelector('[name="surveyor_invertebrate"]');
      const sInp = form.querySelector('[name="surveyor_substrate"]');
      if (next === "single") {
        // Multiple → Single: collapse to the chordates value (canonical).
        singleInp.value = cInp.value || iInp.value || sInp.value || singleInp.value;
      } else {
        // Single → Multiple: mirror the single value into all three inputs so
        // the visible state matches the stored data (all three identical).
        const v = singleInp.value;
        cInp.value = v;
        iInp.value = v;
        sInp.value = v;
      }
      persist();
    });
  });

  // Fixed Transect radio toggles depth visibility, then persists.
  form.querySelectorAll('[name="fixed"]').forEach((r) => {
    r.addEventListener("change", () => { applyFixedState(r.value); persist(); });
  });
  // Text/date inputs persist on each keystroke; selects on change.
  ["surveyor_single", "surveyor_chordates", "surveyor_invertebrate", "surveyor_substrate"].forEach((n) => {
    const el = form.querySelector(`[name="${n}"]`);
    if (el) el.addEventListener("input", persist);
  });
  form.querySelector('[name="date"]').addEventListener("change", persist);
  // Location Within select + Other free text both persist on change/input
  if (locWithin) {
    locWithin.select.addEventListener("change", persist);
    locWithin.otherInput.addEventListener("input", persist);
  }
  form.querySelector('[name="location"]').addEventListener("input", persist);
  depthSelect.addEventListener("change", persist);

  attachDiveSitePicker(form.querySelector('[name="location"]'));
}

// Builds the Start Time + Start Depth bar shown at the top of each section.
// surveyKey is "chordates" / "invertebrate" / "substrate". The values live
// in state.draft.sectionMeta[surveyKey][sectionIdx] and auto-persist.
function renderSectionMetaBar(surveyKey, sectionIdx) {
  const meta = state.draft.sectionMeta[surveyKey][sectionIdx];

  const bar = document.createElement("div");
  bar.className = "section-meta-bar";

  const timeField = document.createElement("label");
  timeField.className = "section-meta-field";
  const timeLabel = document.createElement("span");
  timeLabel.textContent = "Start Time";
  const timeInput = document.createElement("input");
  timeInput.type = "time";
  timeInput.value = meta.startTime || "";
  timeInput.addEventListener("change", () => {
    state.draft.sectionMeta[surveyKey][sectionIdx].startTime = timeInput.value;
    saveDraft();
  });
  timeField.append(timeLabel, timeInput);

  const depthField = document.createElement("label");
  depthField.className = "section-meta-field";
  const depthLabel = document.createElement("span");
  depthLabel.textContent = "Start Depth (m)";
  const depthInput = document.createElement("input");
  depthInput.type = "number";
  depthInput.step = "0.1";
  depthInput.min = "0";
  depthInput.inputMode = "decimal";
  depthInput.placeholder = "e.g. 8.4";
  depthInput.value = meta.startDepth || "";
  // Select existing content on focus so the surveyor can type the new depth
  // directly without their input being appended to the previous value
  // (e.g. avoids "0.0" + typing 6 → "0.06"). The setTimeout sidesteps mobile
  // browsers where focus + select fire too quickly to take effect.
  depthInput.addEventListener("focus", () => {
    setTimeout(() => depthInput.select(), 0);
  });
  depthInput.addEventListener("input", () => {
    state.draft.sectionMeta[surveyKey][sectionIdx].startDepth = depthInput.value;
    saveDraft();
  });
  // Pad to 1 decimal place when the user finishes editing — typing "6" leaves
  // as "6" until blur, then becomes "6.0". Negatives are clamped to 0.
  depthInput.addEventListener("blur", () => {
    const raw = depthInput.value.trim();
    if (!raw) return;
    const num = parseFloat(raw);
    if (isNaN(num)) return;
    const formatted = Math.max(0, num).toFixed(1);
    depthInput.value = formatted;
    state.draft.sectionMeta[surveyKey][sectionIdx].startDepth = formatted;
    saveDraft();
  });
  depthField.append(depthLabel, depthInput);

  bar.append(timeField, depthField);
  return bar;
}

/* =========================================================================
 *  SPECIES SURVEY (Chordates & Invertebrate share this renderer)
 * ========================================================================= */

function renderSpecies(key, list, title) {
  if (!state.draft) return go("setup");
  const node = renderTpl("tpl-species");
  node.querySelector("#species-title").textContent = title;

  // Mode toggle
  node.querySelectorAll(".mode-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === state.inputModes[key]);
    b.addEventListener("click", () => {
      state.inputModes[key] = b.dataset.mode;
      renderSpecies(key, list, title);
    });
  });

  // Section tabs (no pill counts — Chordates/Invertebrate UI stays clean).
  // A small dot on the tab marks sections the surveyor has flagged complete.
  const secTabs = node.querySelector("#section-tabs");
  SECTIONS.forEach((label, i) => {
    const b = document.createElement("button");
    const done = state.draft.sectionComplete[key][i];
    b.className = "sec-tab" + (i === state.activeSection[key] ? " active" : "") + (done ? " section-done" : "");
    b.textContent = label;
    if (done) {
      const dot = document.createElement("span");
      dot.className = "done-dot";
      dot.textContent = "✓";
      b.appendChild(dot);
    }
    b.addEventListener("click", () => {
      state.activeSection[key] = i;
      renderSpecies(key, list, title);
    });
    secTabs.appendChild(b);
  });

  const secIdxCurrent = state.activeSection[key];

  // "Mark section complete" toggle — sits between section meta and species list.
  const markBar = document.createElement("div");
  markBar.className = "mark-complete-bar";
  const markBtn = document.createElement("button");
  const isDone = state.draft.sectionComplete[key][secIdxCurrent];
  markBtn.className = "mark-complete-btn" + (isDone ? " done" : "");
  markBtn.textContent = isDone
    ? `✓ ${SECTIONS[secIdxCurrent]} marked complete — tap to unmark`
    : `Mark ${SECTIONS[secIdxCurrent]} as complete`;
  markBtn.addEventListener("click", () => {
    state.draft.sectionComplete[key][secIdxCurrent] = !isDone;
    saveDraft();
    renderSpecies(key, list, title);
  });
  markBar.appendChild(markBtn);
  node.querySelector("#section-tabs").after(markBar);

  // Section meta bar (Start Time + Start Depth) goes between section tabs
  // and the Mark-Complete button. Insert after both have been placed so the
  // final order is: tabs → metaBar → markBar → species list.
  markBar.before(renderSectionMetaBar(key, secIdxCurrent));

  // Species rows
  const body = node.querySelector("#species-body");
  const secIdx = state.activeSection[key];
  list.forEach((grp) => {
    const card = document.createElement("div");
    card.className = "species-category";
    if (grp.category) {
      const t = document.createElement("div");
      t.className = "cat-title";
      t.textContent = grp.category;
      card.appendChild(t);
    }
    grp.species.forEach((spDef) => {
      const sp = typeof spDef === "string" ? { name: spDef } : spDef;
      const row = document.createElement("div");
      row.className = "species-row";

      const nameWrap = document.createElement("div");
      nameWrap.className = "species-name";
      nameWrap.textContent = sp.name;
      if (sp.scale === "abundance") {
        const hint = document.createElement("span");
        hint.className = "species-scale-hint";
        hint.textContent = "Scale: 0 / 1–50 / 51–150 / >150";
        nameWrap.appendChild(hint);
      }
      row.appendChild(nameWrap);

      row.appendChild(buildSpeciesInput(key, sp, secIdx));
      card.appendChild(row);
    });
    body.appendChild(card);
  });

  // Per-section Notes box (free text) sits between the species list and the
  // destructive "Clear & Start Over" button.
  body.appendChild(renderSectionNotesBar(key, secIdx));

  // "Clear & Start Over" — scoped to the current section of the current survey.
  // Confirm before wiping; resets all species counts, the section-complete flag,
  // and the section-submitted flag (note: it does NOT delete the row already in
  // the Google Sheet — only the local draft is cleared).
  const clearBar = document.createElement("div");
  clearBar.className = "clear-section-bar";
  const clearBtn = document.createElement("button");
  clearBtn.className = "clear-section-btn";
  clearBtn.textContent = `Clear & Start Over · ${SECTIONS[secIdx]}`;
  clearBtn.addEventListener("click", () => {
    const ok = confirm(`Are you sure? This will clear all ${title.replace(" Survey", "")} data for ${SECTIONS[secIdx]} from this device.\n\n(Rows already submitted to Google Sheets are not removed.)`);
    if (!ok) return;
    flattenSpecies(list).forEach((sp) => { state.draft[key][sp.name][secIdx] = null; });
    state.draft.sectionComplete[key][secIdx] = false;
    state.draft.submitted[key][secIdx] = false;
    state.draft.sectionMeta[key][secIdx] = { startTime: "", startDepth: "", notes: "" };
    saveDraft();
    toast(`${SECTIONS[secIdx]} cleared.`);
    renderSpecies(key, list, title);
  });
  clearBar.appendChild(clearBtn);
  body.appendChild(clearBar);
}

function buildSpeciesInput(key, sp, secIdx) {
  const current = state.draft[key][sp.name][secIdx];

  if (sp.scale === "abundance") {
    const wrap = document.createElement("div");
    wrap.className = "scale-buttons";
    ABUNDANCE_SCALE.values.forEach((v) => {
      const b = document.createElement("button");
      b.className = "scale-btn" + (current === v ? " selected" : "");
      b.textContent = v;
      b.title = ABUNDANCE_SCALE.labels[v];
      b.addEventListener("click", () => {
        state.draft[key][sp.name][secIdx] = current === v ? null : v;
        saveDraft();
        renderSpecies(
          key,
          key === "chordates" ? CHORDATES : INVERTEBRATES,
          key === "chordates" ? "Chordates Survey" : "Invertebrates Survey"
        );
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  if (state.inputModes[key] === "tally") {
    const wrap = document.createElement("div");
    wrap.className = "tally";

    const minus = document.createElement("button");
    minus.className = "tally-btn minus";
    minus.textContent = "−";
    minus.addEventListener("click", () => {
      const c = state.draft[key][sp.name][secIdx] || 0;
      const next = Math.max(0, c - 1);
      state.draft[key][sp.name][secIdx] = next === 0 && current === null ? null : next;
      saveDraft();
      countSpan.textContent = state.draft[key][sp.name][secIdx] ?? 0;
    });

    const countSpan = document.createElement("span");
    countSpan.className = "tally-count";
    countSpan.textContent = current ?? 0;

    const plus = document.createElement("button");
    plus.className = "tally-btn plus";
    plus.textContent = "+";
    plus.addEventListener("click", () => {
      const c = state.draft[key][sp.name][secIdx] || 0;
      state.draft[key][sp.name][secIdx] = c + 1;
      saveDraft();
      countSpan.textContent = state.draft[key][sp.name][secIdx];
      updateSecTab();
    });

    wrap.append(minus, countSpan, plus);
    return wrap;
  }

  // Number input mode
  const inp = document.createElement("input");
  inp.type = "number";
  inp.inputMode = "numeric";
  inp.min = "0";
  inp.className = "num-input";
  inp.value = current ?? "";
  inp.placeholder = "0";
  inp.addEventListener("input", () => {
    const v = inp.value === "" ? null : Math.max(0, parseInt(inp.value, 10) || 0);
    state.draft[key][sp.name][secIdx] = v;
    saveDraft();
  });
  return inp;
}

function sectionFillCount(key, secIdx, list) {
  let count = 0;
  flattenSpecies(list).forEach((sp) => {
    if (state.draft[key][sp.name][secIdx] !== null) count++;
  });
  return count;
}

/* =========================================================================
 *  SUBSTRATE SURVEY (one-at-a-time stepper)
 * ========================================================================= */

function renderSubstrate() {
  if (!state.draft) return go("setup");
  const node = renderTpl("tpl-substrate");

  // Section tabs
  const secTabs = node.querySelector("#substrate-section-tabs");
  SECTIONS.forEach((label, i) => {
    const b = document.createElement("button");
    b.className = "sec-tab" + (i === state.substrateCursor.section ? " active" : "");
    b.textContent = label;
    const filled = state.draft.substrate[i].filter((x) => x !== null).length;
    const span = document.createElement("span");
    span.className = "pill-count";
    span.textContent = `${filled}/${POINTS_PER_SECTION}`;
    b.appendChild(span);
    b.addEventListener("click", () => {
      state.substrateCursor.section = i;
      // Position cursor at first empty point, or 0 if all filled
      const arr = state.draft.substrate[i];
      const firstEmpty = arr.findIndex((x) => x === null);
      state.substrateCursor.point = firstEmpty === -1 ? 0 : firstEmpty;
      renderSubstrate();
    });
    secTabs.appendChild(b);
  });

  // Section meta bar (Start Time + Start Depth) under the section tabs.
  const { section, point } = state.substrateCursor;
  node.querySelector("#substrate-section-tabs").after(renderSectionMetaBar("substrate", section));

  // Prompt header
  node.querySelector("#step-section").textContent = SECTIONS[section];
  node.querySelector("#step-point").textContent = point + 1;
  node.querySelector("#step-position").textContent = absoluteDistance(section, point).toFixed(1);

  const cur = state.draft.substrate[section][point];
  const curEl = node.querySelector("#step-current");
  curEl.textContent = cur ? `Current: ${formatSubstrateValue(cur)}` : "Tap a substrate code to record this point";

  // Total progress
  const totalFilled = state.draft.substrate.flat().filter((x) => x !== null).length;
  node.querySelector("#substrate-progress").textContent = `${totalFilled} / 160`;

  // Substrate buttons
  const btnWrap = node.querySelector("#substrate-buttons");
  SUBSTRATE_TYPES.forEach((sub) => {
    const b = document.createElement("button");
    b.className = "sub-btn " + (sub.code === "HC" ? "hc" : sub.group);
    b.innerHTML = `<span class="code">${sub.code}</span><span class="name">${sub.name}</span>`;
    b.addEventListener("click", () => handleSubstratePick(sub));
    btnWrap.appendChild(b);
  });

  // Stepper controls
  node.querySelector("#step-back").addEventListener("click", () => {
    if (state.substrateCursor.point > 0) {
      state.substrateCursor.point--;
    } else if (state.substrateCursor.section > 0) {
      state.substrateCursor.section--;
      state.substrateCursor.point = POINTS_PER_SECTION - 1;
    }
    renderSubstrate();
  });
  node.querySelector("#step-jump").addEventListener("click", openJumpModal);
  node.querySelector("#step-next").addEventListener("click", () => {
    const { section: s, point: p } = state.substrateCursor;
    if (p < POINTS_PER_SECTION - 1) {
      state.substrateCursor.point++;
    } else if (s < SECTIONS.length - 1) {
      state.substrateCursor.section++;
      state.substrateCursor.point = 0;
    }
    renderSubstrate();
  });

  // Grid review
  renderGridReview(node.querySelector("#grid-review-body"));

  // Per-section Notes box for substrate, just above the destructive Clear button.
  node.appendChild(renderSectionNotesBar("substrate", section));

  // "Clear & Start Over" for the current substrate section
  const clearBar = document.createElement("div");
  clearBar.className = "clear-section-bar";
  const clearBtn = document.createElement("button");
  clearBtn.className = "clear-section-btn";
  clearBtn.textContent = `Clear & Start Over · ${SECTIONS[section]}`;
  clearBtn.addEventListener("click", () => {
    const ok = confirm(`Are you sure? This will clear all 40 substrate points for ${SECTIONS[section]} from this device.\n\n(Rows already submitted to Google Sheets are not removed.)`);
    if (!ok) return;
    state.draft.substrate[section] = Array(POINTS_PER_SECTION).fill(null);
    state.draft.submitted.substrate[section] = false;
    state.draft.sectionMeta.substrate[section] = { startTime: "", startDepth: "", notes: "" };
    state.substrateCursor.point = 0;
    saveDraft();
    toast(`${SECTIONS[section]} cleared.`);
    renderSubstrate();
  });
  clearBar.appendChild(clearBtn);
  node.appendChild(clearBar);
}

function renderGridReview(container) {
  const { section, point } = state.substrateCursor;
  state.draft.substrate[section].forEach((val, i) => {
    const cell = document.createElement("div");
    cell.className = "grid-cell";
    if (i === point) cell.classList.add("current");
    if (val) {
      cell.classList.add("filled");
      const code = val.code;
      const sub = SUBSTRATE_TYPES.find((s) => s.code === code);
      if (sub) cell.classList.add(code === "HC" ? "hc" : sub.group);
      // For HC and OTH, show the whole annotation in the cell so the recap
      // is self-documenting. CSS wraps each token onto its own line.
      if (code === "HC") {
        cell.textContent = formatSubstrateValue(val);
      } else if (code === "OTH") {
        cell.textContent = val.text ? `OTH ${val.text}` : "OTH";
        cell.classList.add("oth");
      } else {
        cell.textContent = code;
      }
      cell.title = `${absoluteDistance(section, i).toFixed(1)}m — ${formatSubstrateValue(val)}`;
    } else {
      // Show the absolute distance along the full transect line, in metres,
      // so section 25-45m reads as 25.5 → 45.0 (not 0.5 → 20.0).
      cell.textContent = absoluteDistance(section, i).toFixed(1);
    }
    cell.addEventListener("click", () => {
      state.substrateCursor.point = i;
      renderSubstrate();
    });
    container.appendChild(cell);
  });
}

function handleSubstratePick(sub) {
  const { section, point } = state.substrateCursor;
  if (sub.needsHC) {
    openHCModal((details) => {
      if (!details) return;
      state.draft.substrate[section][point] = {
        code: "HC",
        growth: details.growth,
        health: details.health,
        genus: details.genus,
      };
      saveDraft();
      advancePoint();
    });
  } else if (sub.needsText) {
    openOTHModal((text) => {
      if (text === null) return;
      state.draft.substrate[section][point] = { code: "OTH", text: text };
      saveDraft();
      advancePoint();
    });
  } else {
    state.draft.substrate[section][point] = { code: sub.code };
    saveDraft();
    advancePoint();
  }
}

function advancePoint() {
  const { section, point } = state.substrateCursor;
  if (point < POINTS_PER_SECTION - 1) {
    state.substrateCursor.point++;
    renderSubstrate();
  } else if (section < SECTIONS.length - 1) {
    // End of section — confirm before advancing
    const ok = confirm(`Section ${SECTIONS[section]} complete. Start section ${SECTIONS[section + 1]}?`);
    if (ok) {
      state.substrateCursor.section++;
      state.substrateCursor.point = 0;
    }
    renderSubstrate();
  } else {
    toast("All 160 points recorded — head to Review when ready.");
    renderSubstrate();
  }
}

function formatSubstrateValue(val) {
  if (!val) return "";
  if (val.code === "HC") return `HC ${val.growth} ${val.health} ${val.genus}`;
  if (val.code === "OTH") return `OTH: ${val.text}`;
  return val.code;
}

/* =========================================================================
 *  MODALS: HC details, OTH text, Jump-to-point, Settings
 * ========================================================================= */

// Builds a button with the abbreviation in bold on top and the full term
// underneath in normal weight, used in the HC Growth Form and Health Code
// selectors. Keeps text from overflowing narrow grid cells.
function makeCodeButton(code, name) {
  const b = document.createElement("button");
  b.className = "code-btn";
  const codeEl = document.createElement("span");
  codeEl.className = "code-btn-code";
  codeEl.textContent = code;
  const nameEl = document.createElement("span");
  nameEl.className = "code-btn-name";
  nameEl.textContent = name;
  b.append(codeEl, nameEl);
  return b;
}

function openHCModal(onClose) {
  const node = renderModal("tpl-hc-modal");
  let growth = null;
  let health = null;

  const growthWrap = node.querySelector('[data-group="growth"]');
  HC_GROWTH.forEach(([code, name]) => {
    const b = makeCodeButton(code, name);
    b.addEventListener("click", () => {
      growth = code;
      growthWrap.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    growthWrap.appendChild(b);
  });

  const healthWrap = node.querySelector('[data-group="health"]');
  HC_HEALTH.forEach(([code, name]) => {
    const b = makeCodeButton(code, name);
    b.addEventListener("click", () => {
      health = code;
      healthWrap.querySelectorAll("button").forEach((x) => x.classList.remove("selected"));
      b.classList.add("selected");
    });
    healthWrap.appendChild(b);
  });

  // Two dependent dropdowns: Tax tier narrows the genus picker so the
  // surveyor doesn't have to scroll a single ~50-entry list. Genus dropdown
  // stays disabled until a tier is chosen.
  const tier = node.querySelector("#hc-genus-tier");
  const genus = node.querySelector("#hc-genus");
  function fillGenusForTier(tierName) {
    // Reset to just the placeholder, then add the tier's codes alphabetically.
    genus.innerHTML = '<option value="">— Genus —</option>';
    if (!tierName || !HC_GENUS_TIERS[tierName]) { genus.disabled = true; return; }
    const codes = [...HC_GENUS_TIERS[tierName]].sort();
    codes.forEach((code) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code;
      genus.appendChild(opt);
    });
    genus.disabled = false;
  }
  tier.addEventListener("change", () => fillGenusForTier(tier.value));

  node.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    closeModal(node); onClose(null);
  });
  node.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    if (!growth || !health) {
      toast("Pick a growth form and health code.");
      return;
    }
    // Genus is optional — fall back to UNDEF when left blank so the Sheet
    // cell still carries a valid token (HC B PBL UNDEF) rather than a gap.
    const genusValue = (genus.value || "").trim() || "UNDEF";
    closeModal(node);
    onClose({ growth, health, genus: genusValue });
  });
}

function openOTHModal(onClose) {
  const node = renderModal("tpl-oth-modal");
  const inp = node.querySelector("#oth-text");
  setTimeout(() => inp.focus(), 50);
  // Force uppercase as the surveyor types — short codes like "GC", "TN",
  // "AN" stay consistent across rows regardless of keyboard / mobile auto-cap.
  inp.addEventListener("input", () => {
    const pos = inp.selectionStart;
    const upper = inp.value.toUpperCase();
    if (upper !== inp.value) {
      inp.value = upper;
      try { inp.setSelectionRange(pos, pos); } catch (_) {}
    }
  });
  node.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    closeModal(node); onClose(null);
  });
  node.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    if (!inp.value.trim()) { toast("Describe what was at this point."); return; }
    closeModal(node);
    onClose(inp.value.trim().toUpperCase());
  });
}

function openJumpModal() {
  const node = renderModal("tpl-jump-modal");
  const secSel = node.querySelector("#jump-section");
  const ptSel = node.querySelector("#jump-point");
  SECTIONS.forEach((label, i) => {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = label;
    if (i === state.substrateCursor.section) opt.selected = true;
    secSel.appendChild(opt);
  });

  // Repopulates the point dropdown so the distance shown matches whichever
  // section is currently selected (the four sections are spaced apart along
  // the transect, so absolute distances differ).
  function rebuildPoints() {
    const sectionIdx = parseInt(secSel.value, 10);
    const prev = ptSel.value;
    ptSel.innerHTML = "";
    for (let i = 0; i < POINTS_PER_SECTION; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${i + 1} (${absoluteDistance(sectionIdx, i).toFixed(1)}m)`;
      if (i === (parseInt(prev, 10) || state.substrateCursor.point)) opt.selected = true;
      ptSel.appendChild(opt);
    }
  }
  rebuildPoints();
  secSel.addEventListener("change", rebuildPoints);

  node.querySelector('[data-action="cancel"]').addEventListener("click", () => closeModal(node));
  node.querySelector('[data-action="confirm"]').addEventListener("click", () => {
    state.substrateCursor.section = parseInt(secSel.value, 10);
    state.substrateCursor.point = parseInt(ptSel.value, 10);
    closeModal(node);
    renderSubstrate();
  });
}

/* =========================================================================
 *  PENDING SYNC QUEUE — modal viewer
 *  Opened by tapping the queue pill in the topbar. Lists each queued payload
 *  with a human-readable summary, lets the surveyor remove individual items
 *  or retry the whole queue.
 * ========================================================================= */

function relativeTime(iso) {
  if (!iso) return "queued";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function summarizeQueueItem(item) {
  const surveys = ["chordates", "invertebrate", "substrate"].filter(
    (k) => item.payload && item.payload[k] && item.payload[k].length
  );
  if (surveys.length === 0) {
    return { title: "Unknown submission", detail: "", rows: 0 };
  }
  if (surveys.length === 1) {
    const k = surveys[0];
    const rows = item.payload[k];
    const sections = rows.map((r) => r.section).join(", ");
    return {
      title: `${shortName(k)} · ${sections}`,
      detail: `${rows.length} row${rows.length === 1 ? "" : "s"}`,
      rows: rows.length,
    };
  }
  const parts = surveys.map((k) =>
    `${shortName(k)} ${item.payload[k].length}`
  );
  const total = surveys.reduce((sum, k) => sum + item.payload[k].length, 0);
  return {
    title: "Site visit submission",
    detail: `${parts.join(" · ")} (${total} rows)`,
    rows: total,
  };
}

function removeQueueItem(idx) {
  const item = state.queue[idx];
  // Un-mark the sections this item covered so they're submittable again —
  // removing from the queue means the rows never reached the Sheet.
  if (state.draft && item && item.payload) {
    ["chordates", "invertebrate", "substrate"].forEach((k) => {
      const rows = item.payload[k];
      if (!rows) return;
      rows.forEach((r) => {
        const sectionIdx = SECTIONS.indexOf(r.section);
        if (sectionIdx >= 0 && state.draft.submitted[k][sectionIdx]) {
          state.draft.submitted[k][sectionIdx] = false;
        }
      });
    });
    saveDraft();
  }
  state.queue.splice(idx, 1);
  saveQueue();
  updateQueuePill();
}

function openQueueModal() {
  const node = renderModal("tpl-queue-modal");
  const list = node.querySelector("#queue-list");
  const emptyHint = node.querySelector("#queue-empty-hint");
  const syncHint = node.querySelector("#queue-sync-hint");
  const retryBtn = node.querySelector("#queue-retry-btn");

  function render() {
    list.innerHTML = "";
    if (state.queue.length === 0) {
      emptyHint.classList.remove("hidden");
      retryBtn.disabled = true;
      syncHint.textContent = "";
      return;
    }
    emptyHint.classList.add("hidden");

    state.queue.forEach((item, idx) => {
      const card = document.createElement("div");
      card.className = "queue-item";

      const top = document.createElement("div");
      top.className = "queue-item-top";

      const titleWrap = document.createElement("div");
      titleWrap.className = "queue-item-title-wrap";
      const summary = summarizeQueueItem(item);
      const title = document.createElement("div");
      title.className = "queue-item-title";
      title.textContent = summary.title;
      const detail = document.createElement("div");
      detail.className = "queue-item-detail muted small";
      detail.textContent = `${summary.detail} · ${relativeTime(item.queuedAt)}`;
      titleWrap.append(title, detail);
      top.appendChild(titleWrap);

      const rmBtn = document.createElement("button");
      rmBtn.className = "queue-item-remove";
      rmBtn.textContent = "Remove";
      rmBtn.title = "Drop this submission and re-mark its sections as submittable";
      rmBtn.addEventListener("click", () => {
        if (!confirm(`Remove this queued submission?\n\n${summary.title}\n${summary.detail}\n\nThe sections it covers will become submittable again so you can re-do them or push them later.`)) return;
        removeQueueItem(idx);
        render();
        // If the user is on the Review screen, update the section buttons too
        if (state.current === "review") renderReview();
      });
      top.appendChild(rmBtn);

      card.appendChild(top);
      list.appendChild(card);
    });

    // Footer hint depends on sync URL / online state
    if (!state.settings.syncUrl) {
      syncHint.textContent = "No Sheets sync URL set in Settings — Retry won't push anywhere yet.";
      retryBtn.disabled = true;
    } else if (!navigator.onLine) {
      syncHint.textContent = "Offline — Retry will fail until the device is back online.";
      retryBtn.disabled = false;
    } else {
      syncHint.textContent = "";
      retryBtn.disabled = false;
    }
  }
  render();

  node.querySelector('[data-action="close"]').addEventListener("click", () => closeModal(node));
  retryBtn.addEventListener("click", async () => {
    retryBtn.disabled = true;
    retryBtn.textContent = "Retrying…";
    try {
      await flushQueue();
      toast("Queue flushed ✓");
      closeModal(node);
      if (state.current === "review") renderReview();
    } catch (e) {
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry now";
      toast(`Retry failed (${e.message})`);
      render();
    }
  });
}

function openSettings() {
  const node = renderModal("tpl-settings");
  node.querySelector("#sync-url").value = state.settings.syncUrl || "";
  node.querySelector("#auto-sync").checked = !!state.settings.autoSync;
  node.querySelector('[data-action="cancel"]').addEventListener("click", () => closeModal(node));
  node.querySelector('[data-action="save"]').addEventListener("click", () => {
    state.settings.syncUrl = node.querySelector("#sync-url").value.trim();
    state.settings.autoSync = node.querySelector("#auto-sync").checked;
    saveSettings();
    closeModal(node);
    toast("Settings saved");
    updateQueuePill();
  });
}

function renderModal(tplId) {
  const tpl = document.getElementById(tplId);
  const node = tpl.content.firstElementChild.cloneNode(true);
  document.body.appendChild(node);
  return node;
}
function closeModal(node) {
  if (node && node.parentNode) node.parentNode.removeChild(node);
}

/* =========================================================================
 *  REVIEW / SUBMIT
 *
 *  Three submission granularities:
 *    - Section:  1 row to 1 survey tab (the 20m section just collected)
 *    - Survey:   up to 4 rows to 1 survey tab (any unsent sections)
 *    - All:      everything in the draft, across all 3 surveys
 *
 *  Every survey tab is now long-format: one row per section, with a "section"
 *  column. This is consistent across Chordates / Invertebrate / Substrate.
 * ========================================================================= */

const SURVEYS = [
  { key: "chordates", title: "Chordates Survey", list: CHORDATES, kind: "species" },
  { key: "invertebrate", title: "Invertebrates Survey", list: INVERTEBRATES, kind: "species" },
  { key: "substrate", title: "Substrate Survey", kind: "substrate" },
];

function renderReview() {
  if (!state.draft) return go("setup");
  const node = renderTpl("tpl-review");
  const sum = node.querySelector("#review-summary");

  const meta = state.draft.metadata;
  const sv = meta.surveyors || {};
  const metaList = document.createElement("dl");
  metaList.className = "review-meta";
  [
    ["Chordates Surveyor", sv.chordates],
    ["Invertebrates Surveyor", sv.invertebrate],
    ["Substrate Surveyor", sv.substrate],
    ["Date", meta.date],
    ["Dive Site", meta.location],
    ["Location Within", meta.locationWithin],
    ["Fixed Transect", meta.fixedTransect ? capitalize(meta.fixedTransect) : "—"],
    ["Depth", meta.depth],
  ].forEach(([k, v]) => {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v || "—";
    metaList.append(dt, dd);
  });
  sum.appendChild(metaList);

  SURVEYS.forEach((s) => sum.appendChild(reviewBlock(s)));

  // Global "Submit all 3" — disabled if nothing across the three surveys is ready.
  const submitAllBtn = node.querySelector("#submit-all");
  const totalReady = SURVEYS.reduce((sum, s) => sum + readySectionIdxs(s).length, 0);
  submitAllBtn.disabled = totalReady === 0;
  submitAllBtn.title = totalReady === 0
    ? "Nothing ready to submit yet. Mark Chordates / Invertebrates sections complete or fill all 40 Substrate points."
    : `Submit ${totalReady} ready row${totalReady === 1 ? "" : "s"} across all three surveys.`;
  submitAllBtn.addEventListener("click", submitAll);

  // New global "Download CSV" — triggers a CSV download for each of the three
  // survey tabs. Tiny stagger so the browser handles the multi-download cleanly.
  node.querySelector("#download-all-csv").addEventListener("click", () => {
    if (!state.draft) return;
    ["chordates", "invertebrate", "substrate"].forEach((key, i) => {
      setTimeout(() => downloadCSV(key), i * 300);
    });
    toast("Downloading 3 CSV files (one per survey)…");
  });
  node.querySelector("#export-json").addEventListener("click", exportJSON);
  node.querySelector("#discard-all").addEventListener("click", () => {
    if (confirm("Reset all data for this site visit? This wipes the entire draft and cannot be undone.")) {
      clearDraft();
      toast("All data reset");
      go("setup");
    }
  });
}

function reviewBlock(survey) {
  const status = surveyStatus(survey);
  const block = document.createElement("div");
  block.className = "review-block";

  const h = document.createElement("h4");
  h.textContent = survey.title;
  const badge = document.createElement("span");
  const badgeLabels = { complete: "Complete", partial: "Partial", nodata: "No Data" };
  badge.className = "review-status " + status.status;
  badge.textContent = badgeLabels[status.status] || "Partial";
  h.appendChild(document.createTextNode(" "));
  h.appendChild(badge);
  block.appendChild(h);

  if (status.summary) {
    const p = document.createElement("p");
    p.className = "muted small";
    p.textContent = status.summary;
    p.style.margin = "4px 0 0";
    block.appendChild(p);
  }

  // Section submit buttons (one per 20m section)
  const secRow = document.createElement("div");
  secRow.className = "section-submit-row";
  SECTIONS.forEach((label, i) => {
    const b = document.createElement("button");
    const sent = state.draft.submitted[survey.key][i];
    const ready = sectionReadyToSubmit(survey, i);
    b.className = "sec-submit-btn" + (sent ? " sent" : ready ? " ready" : "");
    b.textContent = `Submit ${label}`;
    b.disabled = sent || !ready;
    b.title = sent
      ? "Already submitted — tap Submit Survey to re-send if needed."
      : ready
        ? `Ready to submit ${label} to Sheets.`
        : notReadyReason(survey, label);
    b.addEventListener("click", () => submitSurveySections(survey.key, [i]));
    secRow.appendChild(b);
  });
  block.appendChild(secRow);

  // Per-survey actions
  const surveyRow = document.createElement("div");
  surveyRow.className = "survey-submit-row";

  const submitSurveyBtn = document.createElement("button");
  submitSurveyBtn.className = "submit-survey";
  submitSurveyBtn.textContent = "Submit whole " + shortName(survey.key) + " survey";
  const readyCount = readySectionIdxs(survey).length;
  submitSurveyBtn.disabled = readyCount === 0;
  submitSurveyBtn.title = readyCount === 0
    ? (survey.kind === "species"
        ? `Mark at least one ${shortName(survey.key)} section as complete before submitting.`
        : "Fill all 40 points of at least one Substrate section before submitting.")
    : `Submit ${readyCount} ready section${readyCount === 1 ? "" : "s"}.`;
  submitSurveyBtn.addEventListener("click", () => submitSurveySections(survey.key, [0, 1, 2, 3]));
  surveyRow.appendChild(submitSurveyBtn);

  const csvBtn = document.createElement("button");
  csvBtn.className = "ghost";
  csvBtn.textContent = "Download CSV";
  csvBtn.addEventListener("click", () => downloadCSV(survey.key));
  surveyRow.appendChild(csvBtn);

  const tsvBtn = document.createElement("button");
  tsvBtn.className = "ghost";
  tsvBtn.textContent = "Copy as TSV";
  tsvBtn.addEventListener("click", () => copyTSV(survey.key));
  surveyRow.appendChild(tsvBtn);

  block.appendChild(surveyRow);
  return block;
}

function shortName(key) {
  return { chordates: "Chordates", invertebrate: "Invertebrates", substrate: "Substrate" }[key];
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function sectionHasData(survey, i) {
  if (survey.kind === "species") {
    return flattenSpecies(survey.list).some((sp) => state.draft[survey.key][sp.name][i] !== null);
  }
  return state.draft.substrate[i].some((x) => x !== null);
}

// A section is "ready to submit" when the surveyor has explicitly signalled
// completion: marked-complete for species surveys, all 40 points filled for
// substrate. Already-sent sections are not ready (they need a re-send via
// Submit Survey to push duplicates).
function sectionReadyToSubmit(survey, i) {
  if (state.draft.submitted[survey.key][i]) return false;
  if (survey.kind === "species") {
    return !!state.draft.sectionComplete[survey.key][i];
  }
  // Use loose != null so undefined cells (rare, e.g. legacy drafts) also gate.
  const arr = state.draft.substrate[i];
  if (arr.length < POINTS_PER_SECTION) return false;
  for (let j = 0; j < POINTS_PER_SECTION; j++) if (arr[j] == null) return false;
  return true;
}

function readySectionIdxs(survey) {
  return SECTIONS.map((_, i) => i).filter((i) => sectionReadyToSubmit(survey, i));
}

function notReadyReason(survey, label) {
  return survey.kind === "species"
    ? `Mark ${label} as complete in the ${shortName(survey.key)} tab before submitting.`
    : `Fill all 40 points of ${label} before submitting.`;
}

function surveyStatus(survey) {
  // Three states: nodata (nothing touched yet), partial (some progress),
  // complete (all sections / all points). The badge in reviewBlock keys off
  // the `status` string for both class and label.
  if (survey.kind === "species") {
    // For species, "done" = sections the surveyor has marked complete.
    const done = state.draft.sectionComplete[survey.key].filter(Boolean).length;
    let status = "partial";
    if (done === SECTIONS.length) status = "complete";
    else if (done === 0) status = "nodata";
    return { status, summary: null };
  }
  // Substrate uses raw fill count: 0 → No Data, 160 → Complete, else Partial.
  const filled = state.draft.substrate.flat().filter((x) => x !== null).length;
  let status = "partial";
  if (filled === 160) status = "complete";
  else if (filled === 0) status = "nodata";
  return { status, summary: `${filled} / 160 substrate points recorded` };
}

/* =========================================================================
 *  SHEETS SYNC
 *
 *  Long-format data model:
 *    Each survey tab gets one row per (surveyId × section). A full survey
 *    submission appends 4 rows; a section submission appends 1.
 *
 *  Payload shape sent to Apps Script:
 *    { chordates: [row, ...], invertebrate: [row, ...], substrate: [row, ...],
 *      schema: { chordates: {meta, groups}, invertebrate: {...}, substrate: {...} } }
 *
 *  Each row carries the full metadata + section, so rows are self-describing.
 * ========================================================================= */

function baseMeta(draft, surveyKey) {
  const m = draft.metadata;
  // Each survey carries its own surveyor name; fall back to a legacy single
  // value if loadDraft hasn't migrated yet (shouldn't happen, defensive only).
  const surveyors = m.surveyors || {};
  const surveyor = surveyors[surveyKey] !== undefined ? surveyors[surveyKey] : (m.surveyor || "");
  return {
    surveyor,
    date: m.date,
    location: m.location,
    locationWithin: m.locationWithin || "",
    fixedTransect: m.fixedTransect,
    depth: m.depth,
    surveyId: draft.id,
    submittedAt: new Date().toISOString(),
  };
}

function sectionMetaFor(draft, key, sectionIdx) {
  const sm = (draft.sectionMeta && draft.sectionMeta[key] && draft.sectionMeta[key][sectionIdx]) || {};
  return {
    startTime: sm.startTime || "",
    startDepth: sm.startDepth || "",
    notes: sm.notes || "",
  };
}

function speciesRow(draft, list, key, sectionIdx) {
  const row = {
    ...baseMeta(draft, key),
    section: SECTIONS[sectionIdx],
    ...sectionMetaFor(draft, key, sectionIdx),
  };
  flattenSpecies(list).forEach((sp) => {
    row[sp.name] = draft[key][sp.name][sectionIdx] ?? "";
  });
  return row;
}

function substrateRow(draft, sectionIdx) {
  const row = {
    ...baseMeta(draft, "substrate"),
    section: SECTIONS[sectionIdx],
    ...sectionMetaFor(draft, "substrate", sectionIdx),
  };
  draft.substrate[sectionIdx].forEach((val, j) => {
    row[`P${j + 1}`] = val ? formatSubstrateValue(val) : "";
  });
  return row;
}

// Build a payload with whichever sections you ask for, for one survey only.
function buildSurveyPayload(draft, surveyKey, sectionIdxs) {
  const list = surveyKey === "chordates" ? CHORDATES : surveyKey === "invertebrate" ? INVERTEBRATES : null;
  const rows = sectionIdxs.map((i) =>
    surveyKey === "substrate" ? substrateRow(draft, i) : speciesRow(draft, list, surveyKey, i)
  );
  const schema = buildSchema();
  // Only include the schema for the survey actually being submitted (keeps payload small)
  return {
    [surveyKey]: rows,
    schema: { [surveyKey]: schema[surveyKey] },
  };
}

function buildAllPayload(draft) {
  const sectionIdxs = [0, 1, 2, 3];
  return {
    chordates: sectionIdxs.map((i) => speciesRow(draft, CHORDATES, "chordates", i)),
    invertebrate: sectionIdxs.map((i) => speciesRow(draft, INVERTEBRATES, "invertebrate", i)),
    substrate: sectionIdxs.map((i) => substrateRow(draft, i)),
    schema: buildSchema(),
  };
}

// Schema describes tab layout (merged category band + column row).
// All three surveys are long-format: meta + section, then the data columns.
function buildSchema() {
  const meta = ["surveyor", "date", "location", "locationWithin", "fixedTransect", "depth", "surveyId", "submittedAt", "section", "startTime", "startDepth", "notes"];

  function speciesSchema(list) {
    const groups = list.map((grp) => {
      const cols = grp.species.map((sp) => (typeof sp === "string" ? sp : sp.name));
      return { category: grp.category || "", columns: cols };
    });
    return { meta, groups };
  }

  return {
    chordates: speciesSchema(CHORDATES),
    invertebrate: speciesSchema(INVERTEBRATES),
    substrate: {
      meta,
      groups: [
        { category: "Points 0.5m–20.0m", columns: Array.from({ length: POINTS_PER_SECTION }, (_, i) => `P${i + 1}`) },
      ],
    },
  };
}

/* ----- Submission entry points ----- */

async function submitSurveySections(surveyKey, sectionIdxs) {
  if (!state.draft) return;

  // Only push sections that are ready: species must be marked complete, and
  // substrate must have all 40 points recorded. Already-sent sections also
  // skipped (re-send is intentional and handled via separate flow).
  const survey = SURVEYS.find((s) => s.key === surveyKey);
  const validIdxs = sectionIdxs.filter((i) => sectionReadyToSubmit(survey, i));
  if (validIdxs.length === 0) {
    toast(survey.kind === "species"
      ? `Mark a ${shortName(surveyKey)} section as complete before submitting.`
      : "Fill all 40 points of a Substrate section before submitting.");
    return;
  }

  const payload = buildSurveyPayload(state.draft, surveyKey, validIdxs);
  state.queue.push({
    id: state.draft.id + ":" + surveyKey + ":" + validIdxs.join(","),
    queuedAt: new Date().toISOString(),
    payload,
  });
  saveQueue();
  updateQueuePill();

  // Mark these sections as submitted
  validIdxs.forEach((i) => { state.draft.submitted[surveyKey][i] = true; });
  saveDraft();
  renderReview();

  if (!state.settings.syncUrl) {
    toast(`Queued ${validIdxs.length} row(s) locally — add a Sheets URL in Settings to push.`);
    return;
  }

  try {
    await flushQueue();
    toast(`Submitted ${validIdxs.length} row(s) for ${shortName(surveyKey)} to Google Sheets ✓`);
  } catch (e) {
    toast(`Sync failed (${e.message}). Rows are queued and will retry when online.`);
  }
}

async function submitAll() {
  if (!state.draft) return;

  // Build a combined payload from only the sections that are ready across all
  // three surveys. Nothing gets pushed until the surveyor has explicitly
  // signalled completion (species: marked-complete; substrate: all 40 points).
  const payload = { schema: {} };
  let totalRows = 0;
  const readyMap = {};
  SURVEYS.forEach((survey) => {
    const idxs = readySectionIdxs(survey);
    readyMap[survey.key] = idxs;
    if (idxs.length === 0) return;
    const sub = buildSurveyPayload(state.draft, survey.key, idxs);
    payload[survey.key] = sub[survey.key];
    payload.schema[survey.key] = sub.schema[survey.key];
    totalRows += idxs.length;
  });

  if (totalRows === 0) {
    toast("Nothing ready to submit. Mark Chordates / Invertebrates sections complete, or fill all 40 Substrate points.");
    return;
  }

  state.queue.push({
    id: state.draft.id + ":all",
    queuedAt: new Date().toISOString(),
    payload,
  });
  saveQueue();
  updateQueuePill();

  // Only mark sections that actually got queued
  Object.entries(readyMap).forEach(([k, idxs]) => {
    idxs.forEach((i) => { state.draft.submitted[k][i] = true; });
  });
  saveDraft();
  renderReview();

  if (!state.settings.syncUrl) {
    toast(`Queued ${totalRows} row${totalRows === 1 ? "" : "s"} locally — add a Sheets URL in Settings to push.`);
    return;
  }

  try {
    await flushQueue();
    toast(`Submitted ${totalRows} row${totalRows === 1 ? "" : "s"} to Google Sheets ✓`);
  } catch (e) {
    toast(`Sync failed (${e.message}). Rows queued, will retry when online.`);
  }
}

function setResult(el, kind, msg) {
  if (!el) return;
  el.className = "submit-result " + kind;
  el.textContent = msg;
}

/* ----- JSON / CSV / TSV exports ----- */

function exportJSON() {
  if (!state.draft && state.queue.length === 0) return;
  const data = state.draft ? buildAllPayload(state.draft) : state.queue;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `ems-${stampForFilename()}.json`);
}

function downloadCSV(surveyKey) {
  if (!state.draft) return;
  const payload = buildSurveyPayload(state.draft, surveyKey, [0, 1, 2, 3]);
  const csv = surveyToDelimited(surveyKey, payload, ",");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `ems-${surveyKey}-${stampForFilename()}.csv`);
}

async function copyTSV(surveyKey) {
  if (!state.draft) return;
  const payload = buildSurveyPayload(state.draft, surveyKey, [0, 1, 2, 3]);
  const tsv = surveyToDelimited(surveyKey, payload, "\t");
  try {
    await navigator.clipboard.writeText(tsv);
    toast(`Copied ${shortName(surveyKey)} as TSV — paste into Sheets.`);
  } catch (e) {
    // Fallback: open a textarea so the user can copy manually
    const ta = document.createElement("textarea");
    ta.value = tsv;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); toast("Copied to clipboard."); }
    catch { toast("Could not copy — select and copy manually."); }
    ta.remove();
  }
}

// Build a delimited string: header row, then one row per section.
// Columns follow the schema order so a paste into a fresh Sheet matches the
// merged-header layout exactly (without the merged band row).
function surveyToDelimited(surveyKey, payload, sep) {
  const schema = payload.schema[surveyKey];
  const cols = [...schema.meta, ...schema.groups.flatMap((g) => g.columns)];
  // Dedupe in case any meta column got duplicated by a group
  const seen = new Set(); const orderedCols = [];
  cols.forEach((c) => { if (!seen.has(c)) { seen.add(c); orderedCols.push(c); } });

  const rows = payload[surveyKey];
  const lines = [orderedCols.map(csvEscape).join(sep)];
  rows.forEach((r) => {
    lines.push(orderedCols.map((c) => csvEscape(r[c] === undefined ? "" : r[c])).join(sep));
  });
  return lines.join("\n");
}

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote if it contains a comma, quote, tab, or newline.
  if (/[",\t\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function stampForFilename() {
  const meta = state.draft?.metadata || {};
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const loc = (meta.location || "survey").replace(/[^a-z0-9]+/gi, "_");
  return `${date}-${loc}`;
}

async function flushQueue() {
  if (!state.settings.syncUrl) return;
  if (!navigator.onLine) throw new Error("Offline");
  while (state.queue.length > 0) {
    const item = state.queue[0];
    // Apps Script web apps reject preflight (no custom headers) — use text/plain.
    // The shared secret rides inside the JSON body so it's never in a URL or
    // header (where it'd be more likely to leak via logs / referrers).
    const body = { ...item.payload, secret: SYNC_SECRET };
    const res = await fetch(state.settings.syncUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data && data.ok === false) throw new Error(data.error || "Apps Script error");
    state.queue.shift();
    saveQueue();
    updateQueuePill();
  }
}

/* =========================================================================
 *  UI helpers, toast, network status
 * ========================================================================= */

function updateQueuePill() {
  const el = document.getElementById("queue-count");
  if (el) el.textContent = state.queue.length;
}

function updateNetStatus() {
  const dot = document.getElementById("net-status");
  if (!dot) return;
  dot.classList.toggle("offline", !navigator.onLine);
  dot.title = navigator.onLine ? "Online" : "Offline — submissions will queue";
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

/* =========================================================================
 *  BOOT
 * ========================================================================= */

function boot() {
  state.queue = loadQueue();
  state.settings = loadSettings();
  state.draft = loadDraft();
  updateQueuePill();
  updateNetStatus();

  document.querySelectorAll("#survey-tabs .tab").forEach((b) => {
    b.addEventListener("click", () => {
      if (!state.draft) return go("setup");
      go(b.dataset.screen);
    });
  });
  document.getElementById("settings-btn").addEventListener("click", openSettings);
  document.getElementById("queue-count").addEventListener("click", openQueueModal);

  window.addEventListener("online", () => {
    updateNetStatus();
    if (state.settings.autoSync && state.queue.length > 0) {
      flushQueue().catch(() => {});
    }
  });
  window.addEventListener("offline", updateNetStatus);

  go(state.draft ? "chordates" : "setup");

  // Register service worker for offline support
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", boot);
