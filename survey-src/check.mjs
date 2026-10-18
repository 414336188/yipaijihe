// 網頁版與 App 的一致性檢查：題目文字、排版常數。
//   node survey-src/check.mjs
//
// ⚠ 實驗一要求「四選一呈現方式」事先固定。網頁版有幾個值無法直接匯入
//   （定義在 App 的 React 元件裡），只能複製一份。複製就會有一天不同步，
//   所以這裡逐一比對，App 改了而網頁版沒跟上就會失敗。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..', '..', 'competition');
const read = (p) => readFileSync(p, 'utf8');
const onb = read(join(app, 'src/components/OnboardingQuestionnaireScreen.tsx'));
const abl = read(join(app, 'src/components/AblationSurveyScreen.tsx'));
const webMesf = read(join(here, 'src/mesf.ts'));
const webUi = read(join(here, 'src/ui.ts'));
const webAbl = read(join(here, 'src/ablation.ts'));
const css = read(join(here, 'style.css'));

let fails = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) fails += 1;
};
const constOf = (src, name) => {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*(['"\`])([\\s\\S]*?)\\1`)) ?? src.match(new RegExp(`const ${name}\\s*=\\s*([0-9.]+)`));
  return m ? (m[2] ?? m[1]) : null;
};

// ── 題目文字 ──
for (const name of ['CALIBRATION_TITLE', 'COMPARISON_TITLE', 'QUAD_TITLE']) {
  const a = constOf(onb, name);
  const w = constOf(webMesf, name);
  check(`題目文字 ${name} 與 App 相同`, a !== null && a === w, a === w ? '' : `App「${a}」／網頁「${w}」`);
}
const noPoolApp = '依你的作答結果，目前沒有足夠的比較照片可以繼續這份問卷，謝謝你的參與。';
check('照片不足的說明文字 App 仍在使用', onb.includes(noPoolApp));
check('照片不足的說明文字與 App 相同', webMesf.includes(noPoolApp));

// ── 排版常數 ──
for (const name of ['OPTION_GAP', 'CALIBRATION_CHROME_HEIGHT', 'CALIBRATION_ROW_GUTTER']) {
  const a = constOf(onb, name);
  const w = constOf(webUi, name);
  check(`排版常數 ${name} 與 App 相同`, a !== null && a === w, `App ${a}／網頁 ${w}`);
}
const waitApp = constOf(onb, 'EXPECTED_WAIT_SEC');
check('等待秒數與 App 相同', waitApp !== null && waitApp === constOf(webMesf, 'EXPECTED_WAIT_SEC'), `App ${waitApp}`);
check('四選一：橫圖上下疊、直圖 2×2（App 仍是這個規則）',
  onb.includes('直圖 2×2、橫圖上下疊四張') && webUi.includes('options.slice(0, 2), options.slice(2, 4)'));
check('二選一：masonry 退回並排（App 仍是這個規則）',
  onb.includes("options.length < 3 && rawLayout === 'masonry' ? 'row' : rawLayout")
  && webUi.includes("options.length < 3 && raw === 'masonry' ? 'row' : raw"));
check('直圖列排高度上限 1.55 倍寬（App 仍是這個值）', onb.includes('width * 1.55') && webUi.includes('rowWidth * 1.55'));

// ── 研究問卷 ──
for (const t of ['這一題用於確認作答狀態，不影響你的評分結果。',
  '兩張照片是同一個人的不同版本。請依你的感受作答，沒有標準答案。', '回上一組修改']) {
  check(`研究問卷文字與 App 相同：${t.slice(0, 14)}…`, abl.includes(t) && webAbl.includes(t));
}
check('研究問卷影像寬度公式與 App 相同（(寬 − 50) / 2、高 = 寬 × 1.33）',
  abl.includes('Math.floor((width - 50) / 2)') && abl.includes('cellW * 1.33')
  && webAbl.includes('- 50) / 2)') && webAbl.includes('cellW * 1.33'));

// ── 電腦版限制寬度 ──
const maxW = constOf(webUi, 'MAX_WIDTH');
check('電腦版題目區寬度上限（ui.ts 與 style.css 一致）', maxW !== null && css.includes(`max-width: ${maxW}px`), `${maxW}px`);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
