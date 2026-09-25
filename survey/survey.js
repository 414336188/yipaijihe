// 問卷流程：說明頁 → 36 組作答 → 完成頁（呼叫 storage.js 的 submitResponse 送出）。
// 題目在按下「開始作答」時由 core.js 隨機分派；進度存在 localStorage，關閉後可續答。

const CFG = window.SURVEY_CONFIG;
const MANIFEST = window.SURVEY_MANIFEST;
const STORE_KEY = "yipaijihe_pair_survey";
const $ = id => document.getElementById(id);

let state = null;
let trials = [];
let answers = {};
let t0 = 0;

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return null; }
}

function showSheet(id) {
  for (const s of ["setupError", "intro", "done"]) $(s).classList.toggle("hidden", s !== id);
  for (const r of ["bar", "stage", "panel"]) $(r).classList.toggle("hidden", id !== null);
}

function init() {
  const errors = validateSetup(CFG, MANIFEST);
  if (errors.length) {
    const list = $("setupErrors");
    for (const e of errors) {
      const li = document.createElement("li");
      li.textContent = e;
      list.appendChild(li);
    }
    showSheet("setupError");
    return;
  }

  const plan = planFixed();
  $("nGroups").textContent = plan.totalGroups;
  $("nQuestions").textContent = plan.totalQuestions;

  // manifest 重新產生後代號檔名全變了，舊進度對不上照片，只能作廢。
  const saved = loadSaved();
  if (saved && saved.manifest_version === MANIFEST.version) {
    state = saved;
    trials = buildAssignment(MANIFEST, state.seed).trials;
    if (state.phase === "main") { showSheet(null); render(); return; }
    if (state.phase === "done") {
      $("doneMsg").textContent = state.submitted
        ? "你已經完成作答，謝謝參與。"
        : "作答已完成，但結果尚未送出成功，請按「重新送出」。";
      showSheet("done");
      return;
    }
  }
  showSheet("intro");
}

function start() {
  const seed = randomSeed();
  const assignment = buildAssignment(MANIFEST, seed);
  state = {
    respondent_id: randomId(),
    seed,
    manifest_version: MANIFEST.version,
    assigned_bases: assignment.bases,
    started_at: new Date().toISOString(),
    finished_at: null,
    phase: "main",
    idx: 0,
    results: [],
    submitted: false,
  };
  trials = assignment.trials;
  save();
  showSheet(null);
  render();
}

function render() {
  const tr = trials[state.idx];
  answers = {};
  $("imgL").src = CFG.PHOTO_BASE + tr.left;
  $("imgR").src = CFG.PHOTO_BASE + tr.right;
  $("count").textContent = `${state.idx + 1} / ${trials.length}`;
  $("fill").style.width = `${(state.idx / trials.length) * 100}%`;

  const box = $("qs");
  box.innerHTML = "";
  for (const q of questionsFor(tr.config)) {
    const row = document.createElement("div");
    row.className = "q";
    row.innerHTML = `<div class="name">${q.name}<small>${q.sub}</small></div>`;
    const opts = document.createElement("div");
    opts.className = "opts";
    for (let v = -3; v <= 3; v++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = v > 0 ? `+${v}` : v === 0 ? "0" : `−${-v}`;
      b.setAttribute("aria-pressed", "false");
      b.onclick = () => pick(q.id, v, opts);
      opts.appendChild(b);
    }
    row.appendChild(opts);
    box.appendChild(row);
  }

  $("next").disabled = true;
  $("next").textContent = state.idx === trials.length - 1 ? "完成" : "下一題";
  t0 = performance.now();
}

function pick(qid, v, opts) {
  answers[qid] = v;
  [...opts.children].forEach((b, i) => b.setAttribute("aria-pressed", String(i - 3 === v)));
  const tr = trials[state.idx];
  $("next").disabled = questionsFor(tr.config).some(q => !(q.id in answers));
}

function advance() {
  if ($("next").disabled) return;
  const tr = trials[state.idx];
  const mod = tr.catch ? null : MODULES[tr.config];
  const row = {
    trial_index: state.idx + 1,
    is_catch: tr.catch ? 1 : 0,
    base_image: tr.base,
    config: tr.config,
    M1: mod ? mod.M1 : "",
    M2: mod ? mod.M2 : "",
    M3: mod ? mod.M3 : "",
    ref_side: tr.ref_side,
    left_file: tr.left,
    right_file: tr.right,
    rt_ms: Math.round(performance.now() - t0),
    timestamp: new Date().toISOString(),
  };
  for (const q of QUESTIONS) {
    const raw = q.id in answers ? answers[q.id] : "";
    row[`raw_${q.id}`] = raw;
    row[`delta_${q.id}`] = raw === "" || tr.catch ? "" : toDelta(raw, tr.ref_side);
  }
  state.results.push(row);
  state.idx++;

  if (state.idx < trials.length) {
    save();
    render();
    return;
  }
  state.phase = "done";
  state.finished_at = new Date().toISOString();
  save();
  submit();
}

async function submit() {
  showSheet("done");
  $("doneMsg").textContent = "送出中…";
  $("resendBtn").disabled = true;
  const response = {
    respondent_id: state.respondent_id,
    seed: state.seed,
    survey_version: SURVEY_VERSION,
    manifest_version: state.manifest_version,
    t: CFG.T_PORTRAITS,
    assigned_bases: state.assigned_bases,
    started_at: state.started_at,
    finished_at: state.finished_at,
    user_agent: navigator.userAgent,
    trials: state.results,
  };
  try {
    const r = await submitResponse(response);
    state.submitted = !!r.ok;
    $("doneMsg").textContent = r.message;
  } catch (e) {
    state.submitted = false;
    $("doneMsg").textContent = `送出失敗（${e.message}），請按「重新送出」再試一次。`;
  }
  save();
  $("resendBtn").disabled = false;
}

function reset() {
  if (!confirm("清除後先前的作答會全部消失，確定要重做嗎？")) return;
  try { localStorage.removeItem(STORE_KEY); } catch (e) {}
  location.reload();
}

$("startBtn").onclick = start;
$("next").onclick = advance;
$("resendBtn").onclick = submit;
$("resetBtn").onclick = reset;

// 鍵盤 1–7 對應 −3…+3，套用在第一個尚未作答的題目；Enter 進入下一組。
document.addEventListener("keydown", e => {
  if ($("panel").classList.contains("hidden")) return;
  if (e.key === "Enter") { advance(); return; }
  const n = parseInt(e.key, 10);
  if (!(n >= 1 && n <= 7)) return;
  const qs = questionsFor(trials[state.idx].config);
  const i = qs.findIndex(q => !(q.id in answers));
  if (i < 0) return;
  document.querySelectorAll(".q")[i].querySelector(".opts").children[n - 1].click();
});

init();
