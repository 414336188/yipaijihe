// 實驗規則、隨機分派與資料格式。問卷頁（index.html）與設定檢查頁（setup-check.html）共用。
// 規則依企畫書第四至六節；設計說明見 README.md。

const SURVEY_VERSION = "2026-09-25";

// H0 = 原始影像，為所有比較的共同基準；H1–H7 各自與同一張人像的 H0 成對呈現。
const CODES = ["H0", "H1", "H2", "H3", "H4", "H5", "H6", "H7"];
const COMPARE_CODES = CODES.slice(1);

// 各配置啟用的模組（M1 構圖引導、M2 畸變校正、M3 個人化濾鏡），企畫書表 3-3。
const MODULES = {
  H1: { M1: 1, M2: 0, M3: 0 },
  H2: { M1: 0, M2: 1, M3: 0 },
  H3: { M1: 0, M2: 0, M3: 1 },
  H4: { M1: 1, M2: 1, M3: 0 },
  H5: { M1: 1, M2: 0, M3: 1 },
  H6: { M1: 0, M2: 1, M3: 1 },
  H7: { M1: 1, M2: 1, M3: 1 },
};

// 條件式提問（企畫書表 3-6）：整體美感每組必問，其餘維度僅在對應模組啟用時提問。
const QUESTIONS = [
  { id: "aesthetic",   name: "整體美感",   sub: "哪張整體比較好看",   module: null },
  { id: "composition", name: "構圖",       sub: "人物位置與畫面佈局", module: "M1" },
  { id: "geometry",    name: "臉部幾何",   sub: "五官與臉型自然度",   module: "M2" },
  { id: "color",       name: "色彩與膚色", sub: "色調與膚色舒適度",   module: "M3" },
];

const PORTRAITS_PER_RESPONDENT = 5;
const CATCH_TRIALS = 1;

function questionsFor(config) {
  if (config === "CATCH") return QUESTIONS.filter(q => q.module === null);
  return QUESTIONS.filter(q => q.module === null || MODULES[config][q.module] === 1);
}

// 由規則推算，而非寫死：每張人像 19 題、每人 35 組 95 題，加檢核共 36 組 96 題。
function planFixed() {
  const perPortrait = COMPARE_CODES.reduce((n, c) => n + questionsFor(c).length, 0);
  const mainGroups = PORTRAITS_PER_RESPONDENT * COMPARE_CODES.length;
  const mainQuestions = PORTRAITS_PER_RESPONDENT * perPortrait;
  return {
    versionsPerPortrait: CODES.length,
    portraitsPerRespondent: PORTRAITS_PER_RESPONDENT,
    questionsPerPortrait: perPortrait,
    mainGroups,
    mainQuestions,
    totalGroups: mainGroups + CATCH_TRIALS,
    totalQuestions: mainQuestions + CATCH_TRIALS * questionsFor("CATCH").length,
  };
}

function planDerived(t, k) {
  const fixed = planFixed();
  return {
    totalPhotos: t * fixed.versionsPerPortrait,
    expectedRatingsPerPortrait: (k * fixed.portraitsPerRespondent) / t,
    expectedRows: k * fixed.totalGroups,
    expectedAnswers: k * fixed.totalQuestions,
  };
}

function validateSetup(config, manifest) {
  const errors = [];
  if (!config) return ["找不到 config.js。"];
  const t = config.T_PORTRAITS;
  const k = config.K_RESPONDENTS;
  if (!Number.isInteger(t) || t < PORTRAITS_PER_RESPONDENT) {
    errors.push(`T_PORTRAITS 必須是 ≥ ${PORTRAITS_PER_RESPONDENT} 的整數（每位受訪者要分到 ${PORTRAITS_PER_RESPONDENT} 張不同人像），目前為 ${t}。`);
  }
  if (!Number.isInteger(k) || k < 1) errors.push(`K_RESPONDENTS 必須是正整數，目前為 ${k}。`);
  if (!manifest) {
    errors.push("找不到 manifest.js，請先執行 tools/prepare_photos.py 產生照片清單。");
    return errors;
  }
  const ids = Object.keys(manifest.images || {});
  if (ids.length !== t) {
    errors.push(`config.js 設定 t = ${t}，但 manifest.js 裡是 ${ids.length} 張人像。請確認照片數量後重跑 tools/prepare_photos.py。`);
  }
  for (const id of ids) {
    const missing = CODES.filter(c => !manifest.images[id][c]);
    if (missing.length) errors.push(`人像 ${id} 缺少版本：${missing.join("、")}`);
  }
  return errors;
}

function randomSeed() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function randomId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 以種子決定全部隨機結果，同一個 seed + manifest 必定重現同一份題目，方便事後稽核與續答。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildAssignment(manifest, seed) {
  const rng = mulberry32(seed);
  const ids = Object.keys(manifest.images).sort();
  const bases = shuffle(ids, rng).slice(0, PORTRAITS_PER_RESPONDENT).sort();

  const trials = [];
  for (const base of bases) {
    for (const config of COMPARE_CODES) {
      const refLeft = rng() < 0.5;
      const ref = manifest.images[base].H0;
      const alt = manifest.images[base][config];
      trials.push({
        base, config, catch: false,
        ref_side: refLeft ? "left" : "right",
        left: refLeft ? ref : alt,
        right: refLeft ? alt : ref,
      });
    }
  }
  shuffle(trials, rng);

  // 注意力檢核：同一張 H0 左右並列，期望作答 0；插在第 13 至 24 組之間（全 36 組的中段）。
  const catchBase = bases[Math.floor(rng() * bases.length)];
  const same = manifest.images[catchBase].H0;
  const total = trials.length + CATCH_TRIALS;
  const lo = Math.ceil(total / 3);
  const hi = Math.floor((2 * total) / 3) - 1;
  const pos = lo + Math.floor(rng() * (hi - lo + 1));
  trials.splice(pos, 0, {
    base: catchBase, config: "CATCH", catch: true,
    ref_side: "left", left: same, right: same,
  });

  return { bases, trials };
}

// raw 為「右圖相對於左圖」的評分；delta 轉為「處理後影像相對於原始影像」，正值代表處理後較佳。
function toDelta(raw, refSide) {
  return refSide === "left" ? raw : -raw;
}

const CSV_COLUMNS = [
  "respondent_id", "seed", "survey_version", "manifest_version",
  "trial_index", "is_catch", "base_image", "config", "M1", "M2", "M3",
  "ref_side", "left_file", "right_file", "rt_ms", "timestamp",
  "raw_aesthetic", "delta_aesthetic",
  "raw_composition", "delta_composition",
  "raw_geometry", "delta_geometry",
  "raw_color", "delta_color",
];

function responseToRows(response) {
  return response.trials.map(tr => {
    const row = {
      respondent_id: response.respondent_id,
      seed: response.seed,
      survey_version: response.survey_version,
      manifest_version: response.manifest_version,
    };
    for (const col of CSV_COLUMNS) if (!(col in row)) row[col] = tr[col] ?? "";
    return row;
  });
}

function rowsToCsv(rows) {
  const esc = v => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [CSV_COLUMNS.join(",")].concat(rows.map(r => CSV_COLUMNS.map(c => esc(r[c])).join(",")));
  return "﻿" + lines.join("\r\n");
}

if (typeof module !== "undefined") {
  module.exports = {
    CODES, COMPARE_CODES, MODULES, QUESTIONS, PORTRAITS_PER_RESPONDENT,
    questionsFor, planFixed, planDerived, validateSetup, buildAssignment,
    mulberry32, toDelta, CSV_COLUMNS, responseToRows, rowsToCsv,
  };
}
