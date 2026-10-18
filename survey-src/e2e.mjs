// 網頁版問卷的瀏覽器端到端測試（無頭 Chrome，經 DevTools 協定操作）。
//   node survey-src/e2e.mjs [mobile|desktop] [full|first]
//
// ⚠ 打的是正式伺服器：會以 zz-web-e2e-*@example.com 建立帳號與研究資料。
//   測試結束後一定要執行清除（見 e2e 結果最後印出的 email）。
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');
const mode = process.argv[2] ?? 'mobile';
const depth = process.argv[3] ?? 'full';
const shots = join(here, '.e2e-shots', mode);
mkdirSync(shots, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// ── 靜態伺服器 ──
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const p = join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = existsSync(p) && statSync(p).isDirectory() ? join(p, 'index.html') : p;
  if (!f.startsWith(site) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
}).listen(8765);

// ── Chrome 與 CDP ──
const profile = mkdtempSync(join(tmpdir(), 'yipai-e2e-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find((t) => t.type === 'page'); } catch { /* 還沒起來 */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const waiting = new Map();
const consoleErrors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval 失敗');
  return r.result?.result?.value;
};
const waitFor = async (expr, label, ms = 90_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(`!!(${expr})`)) return;
    await sleep(250);
  }
  throw new Error(`等待逾時：${label}`);
};
let shotN = 0;
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(shots, `${String(++shotN).padStart(2, '0')}_${name}.png`), Buffer.from(r.result.data, 'base64'));
};

await send('Page.enable');
await send('Runtime.enable');
if (mode === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 zz-e2e' });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}

const email = `zz-web-e2e-${mode}-${Date.now().toString(36)}@example.com`;
const report = { email, mode, revisit: {} };
const textOf = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`);
const click = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.disabled) return false; e.click(); return true; })()`);

try {
  await send('Page.navigate', { url: 'http://localhost:8765/survey-next/' });
  await waitFor(`document.querySelector('#agree')`, '同意頁');
  await shot('consent');
  report.nextDisabledBeforeAgree = await ev(`document.querySelector('#to-email').disabled`);
  await click('#agree');
  await click('#to-email');
  await waitFor(`document.querySelector('#email')`, 'email 頁');
  await ev(`(() => { const i = document.querySelector('#email'); i.value = ${JSON.stringify(email)}; })()`);
  await click('#start');

  // ── 第一部分 ──
  let calSeen = 0, cmpSeen = 0, quadSeen = 0, binSeen = 0, backTested = false, lastKey = '';
  const shotSet = new Set();
  while (true) {
    await waitFor(`document.querySelector('#to-part2') || (document.querySelector('.choice') && document.querySelector('#next'))`, '第一部分題目', 120_000);
    if (await ev(`!!document.querySelector('#to-part2')`)) break;
    const eyebrow = await textOf('.eyebrow');
    const title = await textOf('.title');
    const key = `${title}|${eyebrow}`;
    if (key === lastKey) { await sleep(300); continue; }
    const n = await ev(`document.querySelectorAll('.choice').length`);
    const isCal = title.includes('濾鏡效果');
    if (isCal) calSeen++; else { cmpSeen++; if (n === 4) quadSeen++; else binSeen++; }
    const tag = isCal ? 'calibration' : n === 4 ? 'quad' : 'binary';
    if (!shotSet.has(tag)) { await sleep(300); await shot(tag); shotSet.add(tag); }
    if (depth === 'first') { report.firstScreen = { title, eyebrow, n }; break; }
    // 校準第 3 題時測一次「上一題」：回去後應看到原本的選擇仍被選取
    if (isCal && eyebrow.startsWith('第 3／') && !backTested) {
      backTested = true;
      await ev(`document.querySelector('.icon-btn[aria-label="上一題"]').click()`);
      await waitFor(`document.querySelector('.eyebrow')?.textContent.startsWith('第 2／') && document.querySelector('.choice')`, '回到第 2 題');
      report.backKeepsSelection = await ev(`document.querySelectorAll('.choice.active').length === 1`);
      lastKey = '';
      continue;
    }
    const slot = Math.floor(Math.random() * n);
    // ⚠ 換頁的瞬間可能還讀到上一題（最後一題送出後轉到「正在送出」）：點不到就重新判斷
    const clicked = await ev(`(() => { const c = document.querySelectorAll('.choice')[${slot}]; if (!c) return false; c.click(); return true; })()`);
    if (!clicked) { lastKey = ''; await sleep(300); continue; }
    await waitFor(`!document.querySelector('#next').disabled`, '下一題可按');
    lastKey = key;
    await click('#next');
  }
  report.part1 = { calSeen, cmpSeen, quadSeen, binSeen };
  if (depth === 'first') throw 'done-first';
  await shot('transition');
  await click('#to-part2');

  // ── 第二部分 ──
  const screensSeen = [];
  let screenNo = 0, textOnlySeen = false;
  while (true) {
    await waitFor(`document.body.textContent.includes('全部完成') || (document.querySelector('.chip') && !document.querySelector('.chip').disabled)`, '第二部分題目', 120_000);
    if (await ev(`document.body.textContent.includes('全部完成')`)) break;
    const eyebrow = await textOf('.eyebrow');
    screenNo = Number(eyebrow.match(/第 (\d+)/)[1]);
    const trials = await ev(`[...new Set([...document.querySelectorAll('.chip')].map(c => Number(c.dataset.trial)))]`);
    const textOnly = await ev(`!document.querySelector('.pair')`);
    if (textOnly && !textOnlySeen) { textOnlySeen = true; await shot('text-only'); }
    if (screenNo === 1) await shot('ablation');
    for (const t of trials) {
      const prompt = await ev(`document.querySelector('.chip[data-trial="${t}"]').closest('.question').querySelector('.prompt').textContent`);
      const score = prompt.includes('沒有照片') ? 1 : [-2, -1, 0, 1, 2][Math.floor(Math.random() * 5)];
      await ev(`document.querySelector('.chip[data-trial="${t}"][data-score="${score}"]').click()`);
    }
    screensSeen.push({ screenNo, trials, textOnly });
    await waitFor(`!document.querySelector('#next').disabled`, '下一組可按');
    await click('#next');
    // 第 5 組送出後：回到第 4 組、不改答案、直接下一組 → 不應重送（時間紀錄應維持原值）
    if (screenNo === 5 && !report.revisit.unchanged) {
      await waitFor(`document.querySelector('.eyebrow')?.textContent.startsWith('第 6 ')`, '到第 6 組');
      await ev(`[...document.querySelectorAll('.btn-secondary')].find(b => b.textContent === '回上一組修改').click()`);
      await waitFor(`document.querySelector('.eyebrow')?.textContent.startsWith('第 5 ') && document.querySelector('.chip') && !document.querySelector('.chip').disabled`, '回到第 5 組');
      report.revisit.unchanged = screensSeen.find((s) => s.screenNo === 5).trials;
      await sleep(1500);
      await click('#next');
    }
    // 第 13 組：點完答案「不送出」就回上一組，再回來直接送出 → 決定時間不可為負或缺值
    //   （App 在這個情境會算出負數；見 ablation.ts 的 Pick 說明）
    if (screenNo === 12 && !report.revisit.leftUnsubmitted) {
      await waitFor(`document.querySelector('.eyebrow')?.textContent.startsWith('第 13 ') && document.querySelector('.chip') && !document.querySelector('.chip').disabled`, '到第 13 組');
      const ts = await ev(`[...new Set([...document.querySelectorAll('.chip')].map(c => Number(c.dataset.trial)))]`);
      for (const t of ts) await ev(`document.querySelector('.chip[data-trial="${t}"][data-score="1"]').click()`);
      await sleep(1200);
      await ev(`[...document.querySelectorAll('.btn-secondary')].find(b => b.textContent === '回上一組修改').click()`);
      await waitFor(`document.querySelector('.eyebrow')?.textContent.startsWith('第 12 ') && document.querySelector('.chip') && !document.querySelector('.chip').disabled`, '回到第 12 組');
      await sleep(2500);
      await click('#next');
      await waitFor(`document.querySelector('.eyebrow')?.textContent.startsWith('第 13 ') && !document.querySelector('#next').disabled`, '再到第 13 組（答案仍保留）');
      report.revisit.leftUnsubmitted = ts;
      await click('#next');
      screensSeen.push({ screenNo: 13, trials: ts, textOnly: false });
    }
    // 第 9 組送出後：回到第 9 組、改其中一題 → 應重送並記為修改
    if (screenNo === 9 && !report.revisit.changed) {
      await waitFor(`document.querySelector('.eyebrow')?.textContent.startsWith('第 10 ')`, '到第 10 組');
      await ev(`[...document.querySelectorAll('.btn-secondary')].find(b => b.textContent === '回上一組修改').click()`);
      await waitFor(`document.querySelector('.eyebrow')?.textContent.startsWith('第 9 ') && document.querySelector('.chip') && !document.querySelector('.chip').disabled`, '回到第 9 組');
      const t = screensSeen.find((s) => s.screenNo === 9).trials.at(-1);
      const cur = await ev(`Number(document.querySelector('.chip.on[data-trial="${t}"]').dataset.score)`);
      const nv = cur === 3 ? 2 : 3;
      await ev(`document.querySelector('.chip[data-trial="${t}"][data-score="${nv}"]').click()`);
      report.revisit.changed = { trial: t, from: cur, to: nv };
      await click('#next');
    }
  }
  await shot('done');
  report.part2 = { screens: screensSeen.length, textOnlySeen };
  // 重新整理頁面：應停在完成頁，不可重新開始
  await send('Page.reload');
  await waitFor(`document.body.textContent.includes('全部完成')`, '重新整理後仍是完成頁', 20_000);
  report.reloadStaysDone = true;
} catch (e) {
  if (e !== 'done-first') { report.error = String(e?.message ?? e); await shot('error').catch(() => undefined); }
} finally {
  report.consoleErrors = consoleErrors;
  report.storage = await ev(`localStorage.getItem('yipai-web-survey:v1')`).catch(() => null);
  writeFileSync(join(shots, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  ws.close();
  chrome.kill();
  server.close();
}
