// 網頁版問卷的建置腳本。
//
//   node survey-src/build.mjs            → 產出到 survey-next/（開發與測試用）
//   node survey-src/build.mjs --out survey → 正式發布時才用
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
const outDir = resolve(site, outArg > 0 ? process.argv[outArg + 1] : 'survey-next');

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
const OWN = ['index.html', 'style.css', ...readdirSync(join(here, 'src')).filter((f) => f.endsWith('.ts')).sort().map((f) => `src/${f}`)];
for (const f of OWN) sharedHash.update(`web:${f}`).update(readFileSync(join(here, f)));
const BUILD = `web-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${sharedHash.digest('hex').slice(0, 8)}`;

const esbuild = findEsbuild();
mkdirSync(outDir, { recursive: true });
await esbuild.build({
  entryPoints: [join(here, 'src', 'main.ts')],
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
const html = readFileSync(join(here, 'index.html'), 'utf8').replace(/__BUILD__/g, BUILD);
writeFileSync(join(outDir, 'index.html'), html);
console.log(`建置完成 ${BUILD}（App ${appCommit}）→ ${outDir}`);
