// 網頁版問卷的建置腳本。
//
//   node survey-src/build.mjs            → 產出到 survey-next/（開發與測試用）
//   node survey-src/build.mjs --out survey → 正式發布時才用
//   node survey-src/build.mjs --variant v2               → 濾鏡問卷 v2，產出到 survey-v2-next/
//   ⚠ v2 已停用（2026-10-31 改用 v3）：survey-v2/ 是導向 v3 的頁面，--variant v2 --out survey-v2 一律拒絕
//   node survey-src/build.mjs --variant v3               → 濾鏡問卷 v3（與 v2 只差常數），產出到 survey-v3-next/
//   node survey-src/build.mjs --variant v3 --out survey-v3 → v3 正式發布時才用（同樣拒絕【】待補內容）
//
// ⚠ 出題邏輯直接沿用 App 專案的原始碼（../competition/src/modules），不重寫。
//   兩份實作一定會在某一天不同步，而實驗一要求「呈現方式事先固定」。
//   代價是只能在兩個 repo 並排的這台機器上建置；產出的 app.js 已提交，
//   官網本身不需要建置。
//
// ⚠ 不在 App 專案裡加 esbuild 或建置設定：package.json 與 .easignore 都會
//   改變 App 的執行環境指紋，build 22 之後就收不到 OTA 更新。
//   esbuild 由 npx 快取提供（tsx 自帶的同一份）。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = resolve(here, '..');
const app = resolve(site, '..', 'competition');
const outArg = process.argv.indexOf('--out');
const varArg = process.argv.indexOf('--variant');
const variant = varArg > 0 ? process.argv[varArg + 1] : 'v1';
if (variant !== 'v1' && variant !== 'v2' && variant !== 'v3') throw new Error(`--variant 只能是 v1、v2 或 v3：${variant}`);
const outDir = resolve(site, outArg > 0 ? process.argv[outArg + 1] : variant === 'v3' ? 'survey-v3-next' : variant === 'v2' ? 'survey-v2-next' : 'survey-next');
const ENTRY = variant === 'v3' ? join(here, 'src', 'v3', 'main.ts') : variant === 'v2' ? join(here, 'src', 'v2', 'main.ts') : join(here, 'src', 'main.ts');
const INDEX = variant === 'v3' ? 'index-v3.html' : variant === 'v2' ? 'index-v2.html' : 'index.html';
// ⚠ v2 已停用（2026-10-31 使用者決定：v2 只是測試，資料已刪、改用 v3）。survey-v2/ 只剩導向 v3 的頁面，
//   重新發布 v2 會讓舊連結又能作答。v2 的原始碼仍保留（v3 建立在 src/v2/ 之上），survey-v2-next/ 仍可建置測試。
if (variant === 'v2' && /[\\/]survey-v2$/.test(outDir)) throw new Error('拒絕發布：濾鏡問卷 v2 已停用，survey-v2/ 是導向 v3 的頁面');

function findEsbuild() {
  // npx 快取的結構是 _npx/<雜湊>/node_modules/esbuild
  const cache = join(process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', '.cache'), 'npm-cache', '_npx');
  const hits = existsSync(cache)
    ? readdirSync(cache).map((d) => join(cache, d, 'node_modules', 'esbuild'))
      .filter((p) => existsSync(join(p, 'package.json')))
    : [];
  if (!hits.length) throw new Error(`找不到 esbuild（${cache}）：先執行一次 npx tsx --version 讓 npx 快取它`);
  return createRequire(import.meta.url)(hits[0]);
}

// 沿用的 App 原始碼。⚠ 雜湊寫進產出檔，事後可以查出網頁版用的是哪一版出題邏輯。
const SHARED = [
  'src/modules/mesfController.ts',
  'src/modules/mesfClient.ts',
  'src/modules/mesfApiTypes.ts',
  'src/modules/mesfImage.ts',
  'src/modules/mesfRandom.ts',
  'src/modules/ablationSurveyTypes.ts',
  'src/content/preferenceSurvey.ts',
];
for (const f of SHARED) {
  if (!existsSync(join(app, f))) throw new Error(`找不到 App 原始碼 ${f}（兩個 repo 必須並排）`);
}
const sharedHash = createHash('sha256');
for (const f of SHARED) sharedHash.update(f).update(readFileSync(join(app, f)));
let appCommit = 'unknown';
try {
  appCommit = execFileSync('git', ['-C', app, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['-C', app, 'status', '--porcelain', '--', ...SHARED], { encoding: 'utf8' }).trim();
  if (dirty) appCommit += '+dirty';
} catch { /* 沒有 git 時保留 unknown */ }

// ⚠ 版本號同時涵蓋 App 共用模組與網頁版自己的原始碼。第一版只雜湊共用模組，
//   網頁版改了版本號卻不變，事後就分不出資料是哪一版網頁收的。
const OWN = [INDEX, 'style.css', ...readdirSync(join(here, 'src')).filter((f) => f.endsWith('.ts')).sort().map((f) => `src/${f}`),
  ...(variant === 'v2' || variant === 'v3' ? readdirSync(join(here, 'src', 'v2')).filter((f) => f.endsWith('.ts')).sort().map((f) => `src/v2/${f}`) : []),
  ...(variant === 'v3' ? readdirSync(join(here, 'src', 'v3')).filter((f) => f.endsWith('.ts')).sort().map((f) => `src/v3/${f}`) : [])];
for (const f of OWN) sharedHash.update(`web:${f}`).update(readFileSync(join(here, f)));
const BUILD = `${variant === 'v3' ? 'webv3' : variant === 'v2' ? 'webv2' : 'web'}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sharedHash.digest('hex').slice(0, 8)}`;

// ⚠ v2 的同意說明有【】待補內容（研究團隊名稱、聯絡信箱、email 刪除日期）。發布目錄不得帶著空白上線。
if ((variant === 'v2' && /[\\/]survey-v2$/.test(outDir)) || (variant === 'v3' && /[\\/]survey-v3$/.test(outDir))) {
  const todo = OWN.filter((f) => readFileSync(join(here, f), 'utf8').includes('【'));
  if (todo.length) throw new Error(`拒絕發布：${todo.join('、')} 仍有【】待補內容`);
}

const esbuild = findEsbuild();
mkdirSync(outDir, { recursive: true });
await esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  // iOS 14.5／Safari 14.1 以上：esbuild 把更舊的 Safari 標為解構語法有瑕疵而拒絕轉換
  target: ['es2020', 'safari14.1', 'ios14.5'],
  minify: true,
  sourcemap: false,
  outfile: join(outDir, 'app.js'),
  define: {
    __BUILD__: JSON.stringify(BUILD),
    __APP_COMMIT__: JSON.stringify(appCommit),
    // mesfClient 的工廠函式讀 process.env（網頁版不呼叫它，但打包時要能解析）
    'process.env': '{}',
  },
  alias: { '@app': join(app, 'src') },
  logLevel: 'warning',
});
cpSync(join(here, 'style.css'), join(outDir, 'style.css'));
const html = readFileSync(join(here, INDEX), 'utf8').replace(/__BUILD__/g, BUILD);
writeFileSync(join(outDir, 'index.html'), html);
console.log(`建置完成 ${BUILD}（App ${appCommit}）→ ${outDir}`);
