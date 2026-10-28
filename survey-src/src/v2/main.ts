// 濾鏡問卷 v2（2 選 1）主流程：同意 → email → 濾鏡偏好（校準 20 題＋2 選 1 約 32 題） → 完成。
// 規格：competition/docs/filter-survey-v2-spec.md。
//
// ⚠ 頁面文字不提一拍即合（使用者決定，2026-10-28；發到社群招募）。例外：資料處理說明的蒐集者與聯絡信箱照實寫
//   「一拍即合」開發團隊與 yipaijihe.app@gmail.com（個資法第 8 條須告知蒐集者；使用者決定，2026-10-28）。
// ⚠ 同意說明為 web-v1 的最小修改（2026-10-28 使用者同意）：標題、流程與題數、email 加抽獎用途、
//   隱私權政策連結改為頁內的資料處理說明。研究目的用中性寫法，不透露「個人化 vs 隨機」，避免影響作答。
//   email 刪除只寫「抽獎結束後」、不寫日期（使用者決定，2026-10-28；個資法第 8 條的利用期間已由此說明）。
//   build.mjs 發布到 survey-v2/ 時，原始碼仍有全形方括號的待補標記就拒絕建置。
import { createLiveMesfClient } from '@app/modules/mesfClient';
import { API_BASE, ApiError, BUILD, deviceInfo, makeJsonStore, makeMesfStore, request, storageWorks } from '../core';
import { runMesf, type MesfConfig } from '../mesf';
import { button, enableZoomableLayout, errorText, h, shell, spinner } from '../ui';
import { v2Fetch } from './adapter';
import { V2Controller } from './controller';

/** ⚠ 寫進 mesf.sessions.consent_version 與 web_survey_v2_participants.consent_version；改文字就要進版 */
const CONSENT_VERSION = 'web-v2';
const PART = '濾鏡偏好研究問卷';
const COLLECTOR = '「一拍即合」開發團隊';
const CONTACT = 'yipaijihe.app@gmail.com';

type Stage = 'consent' | 'email' | 'mesf' | 'done';
interface V2State {
  stage: Stage;
  email?: string;
  participantId?: string;
  resumeToken?: string;
  skipped?: boolean;
}

// ⚠ 與 v1 不同的 key：同一個瀏覽器做過 v1 也不會互相覆蓋
const stateStore = makeJsonStore<V2State>('filter-survey-v2:state');
const MESF_CONFIG: Omit<MesfConfig, 'client'> = {
  store: makeMesfStore('filter-survey-v2:mesf'),
  consentVersion: CONSENT_VERSION,
  part: PART,
  totalGuess: 52,
  // 實測（2026-10-28，VM 測試實例）：校準送出到出題完成 40～56 秒
  waitSec: 50,
  noPoolNext: null,
  // ⚠ 中性寫法：不提「專屬」「依你的作答」（見 MesfConfig.waitTitle）
  waitTitle: '正在準備下一部分的題目',
  waitHint: (sec) => `這一步需要約 ${sec} 秒，請稍候。`,
  restartText: '上次的作答已逾時，需要重新開始。',
  finishText: '正在送出作答',
  // 可回上一題重選（2026-10-28 使用者決定：只能回上一題、以最後一次為準、注意力題也可改）
  makeController: (...args) => new V2Controller(...args),
};

const root = document.getElementById('app') as HTMLElement;
const loaded = stateStore.load();
let state: V2State = loaded && typeof loaded.stage === 'string' ? loaded : { stage: 'consent' };
const canStore = storageWorks();

function set(patch: Partial<V2State>) {
  state = { ...state, ...patch };
  stateStore.save(state);
}

// ───────── 同意說明（web-v2） ─────────
function renderConsent() {
  const body = shell(root, { part: PART });
  let agreed = false;
  const box = h('input', { attrs: { type: 'checkbox', id: 'agree' } }) as HTMLInputElement;
  const next = button('下一步', () => { set({ stage: 'email' }); renderEmail(); }, { disabled: true, id: 'to-email' });
  box.addEventListener('change', () => { agreed = box.checked; next.disabled = !agreed; });
  body.append(
    h('h1', { class: 'title', text: PART }),
    h('p', { class: 'lead', text: '全程約 10 分鐘，不需要下載 App。' }),
    h('p', null, h('strong', { text: '濾鏡偏好（約 50 題）' }), h('br'),
      '前 20 題：從三張不同調色的照片中，選出你最喜歡的。', h('br'),
      '後 32 題：從兩張不同調色的照片中，選出你比較喜歡的。'),
    h('p', { class: 'hint', text: '你的作答將用於學術研究，了解每個人對照片調色的偏好。' }),
    h('div', { class: 'notice' },
      h('p', { text: '我們會保存：你的 email、每一題的選擇與作答時間，以及裝置類型、畫面尺寸與瀏覽器版本。' }),
      h('p', { text: 'email 用於辨識同一位作答者、避免重複作答，以及通知抽獎結果；抽獎結束後即刪除。不會要求你上傳任何照片。' })),
    h('div', { class: 'notice' },
      h('p', { text: '參加完全自願，可以隨時關閉頁面離開。之後用同一個瀏覽器開啟這個連結，就能從中斷的地方繼續。' })),
    h('details', { class: 'notice' },
      h('summary', { text: '資料處理說明' }),
      h('ul', null,
        h('li', { text: `蒐集者：${COLLECTOR}；聯絡信箱：${CONTACT}。` }),
        h('li', { text: '目的：學術研究分析，以及辨識作答者、避免重複作答、抽獎通知。' }),
        h('li', { text: `期間：email 於抽獎結束後刪除；作答紀錄以代碼儲存供研究分析，email 刪除後即無法對應到你。` }),
        h('li', { text: '地區與對象：存放於研究團隊使用的雲端資料庫（伺服器可能位於台灣境外）；僅研究團隊與受託的雲端服務商處理，不出售、不提供給廣告商。' }),
        h('li', { text: `你的權利：可請求查詢、閱覽、製給複製本、補充或更正、停止利用或刪除。請來信 ${CONTACT} 並註明作答時使用的 email，我們將於 15 日內處理（必要時延長至 30 日並先告知）。` }),
        h('li', { text: '瀏覽器保存：作答進度、email 與接續憑證存在你的瀏覽器，只用於中斷後接續作答，不使用 Cookie 追蹤。' }),
        h('li', { text: '未滿 18 歲者，應經法定代理人同意後再參加。' }))),
    h('label', { class: 'consent', attrs: { for: 'agree' } }, box, h('span', { text: '我已閱讀上述說明，同意參加並保存我的作答紀錄。' })),
    next,
  );
  if (!canStore) {
    body.append(h('p', { class: 'warn', text: '你的瀏覽器目前無法保存進度（可能是無痕模式）。仍可作答，但中途關閉頁面後將無法接續。' }));
  }
}

// ───────── email ─────────
interface EnterResult {
  status: 'new' | 'resume' | 'other_browser';
  participant_id?: string;
  resume_token?: string;
  message?: string;
}

function enter(email: string, resumeToken: string | undefined): Promise<EnterResult> {
  const d = deviceInfo();
  return request<EnterResult>('/api/web-survey-v2/enter', {
    method: 'POST',
    body: JSON.stringify({ email, resume_token: resumeToken, consent: true, consent_version: CONSENT_VERSION,
      device: d.device, viewport: d.viewport }),
  });
}

function backToEmail(message?: string) {
  set({ stage: 'email', participantId: undefined, resumeToken: undefined });
  renderEmail(message);
}

function renderEmail(message?: string) {
  const body = shell(root, { part: PART, onBack: () => { set({ stage: 'consent' }); renderConsent(); } });
  const input = h('input', {
    class: 'input',
    attrs: { type: 'email', id: 'email', autocomplete: 'email', inputmode: 'email', placeholder: 'name@example.com', maxlength: '254' },
  }) as HTMLInputElement;
  if (state.email) input.value = state.email;
  const msg = h('div');
  if (message) msg.append(errorText(message));
  const go = button('開始作答', () => void submit(), { id: 'start' });
  input.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void submit(); });
  body.append(
    h('h1', { class: 'title', text: '請輸入你的 email' }),
    h('p', { class: 'hint', text: '用來辨識作答者、避免重複作答，以及通知抽獎結果。' }),
    input, msg, go,
  );
  input.focus();

  async function submit() {
    const email = input.value.trim().toLowerCase();
    msg.replaceChildren();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
      msg.append(errorText('email 格式不正確'));
      return;
    }
    go.disabled = true;
    go.textContent = '確認中';
    try {
      // ⚠ 只有同一個 email 才帶上這個瀏覽器保存的接續憑證
      const token = state.email === email ? state.resumeToken : undefined;
      const r = await enter(email, token);
      if (r.status === 'other_browser' || !r.participant_id) {
        // 換了瀏覽器：不是錯誤，提醒回原本的瀏覽器（伺服器不會給這個瀏覽器身分憑證）
        go.disabled = false;
        go.textContent = '開始作答';
        msg.append(h('p', { class: 'notice', text: r.message ?? '請用原本作答的裝置與瀏覽器開啟這個連結繼續。' }));
        return;
      }
      if (state.email && state.email !== email) {
        // ⚠ 換了人：清掉前一個人在這台裝置上的作答進度，絕不讓新的人接到前一個人的題目（作答會寫到錯的人名下）
        await MESF_CONFIG.store.clear();
      }
      set({ email, participantId: r.participant_id, resumeToken: r.resume_token ?? token, stage: 'mesf', skipped: undefined });
      route();
    } catch (e) {
      go.disabled = false;
      go.textContent = '開始作答';
      msg.append(errorText(e instanceof ApiError ? e.message : '發生未知錯誤，請重試'));
    }
  }
}

// ───────── 同一台裝置換人作答（2026-10-28 使用者決定：不綁裝置，email 不同就能再填一份） ─────────
// 伺服器端本來就不綁裝置（一個 email 一份）；綁住的是這個瀏覽器裡的進度。換人時清掉前一個人的本機進度，
// 從同意書重新開始（新的人要自己同意）。前一個人的接續憑證只存在這台裝置，清掉後他就無法再在此接續。

/** 共用裝置上不顯示前一個人的完整 email：e***@gmail.com */
function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 1)}***@${domain ?? ''}`;
}

async function startOver() {
  await MESF_CONFIG.store.clear();
  state = { stage: 'consent' };
  stateStore.save(state);
  renderConsent();
}

function renderResumeChoice() {
  const body = shell(root, { part: PART });
  const msg = h('div');
  const other = button('用另一個 email 開始', () => {
    msg.replaceChildren(
      h('p', { class: 'notice', text: '前一份作答的進度會從這台裝置移除，之後無法在這台裝置接續（已送出的作答不受影響）。' }),
      button('確定，用另一個 email 開始', () => void startOver(), { id: 'confirm-start-over' }));
  }, { kind: 'secondary', id: 'start-over' });
  body.append(
    h('h1', { class: 'title', text: '要繼續之前的作答嗎？' }),
    h('p', { class: 'hint', text: `這台裝置上有一份尚未完成的作答（${maskEmail(state.email ?? '')}）。` }),
    button('繼續作答', () => route(), { id: 'resume' }),
    other, msg,
  );
}

// ───────── 完成 ─────────
function renderDone() {
  const body = shell(root, { part: PART, progress: 1 });
  body.append(h('div', { class: 'center' },
    h('div', { class: 'done-icon', text: '✓' }),
    h('h1', { class: 'title', text: '全部完成，謝謝你的參與' }),
    state.skipped ? h('p', { class: 'hint', text: '依你的作答結果，後半段的比較題已略過，你的作答已完整記錄。' }) : null,
    h('p', { class: 'hint', text: '抽獎結果會寄到你填寫的 email。現在可以關閉這個頁面。' })),
    h('p', { class: 'hint', text: '其他人也可以用這台裝置、以自己的 email 再填一份。' }),
    button('用另一個 email 填寫', () => void startOver(), { kind: 'secondary', id: 'another' }));
}

// ───────── 路由 ─────────
function route() {
  if (state.stage === 'done') { renderDone(); return; }
  if (state.stage === 'consent' || !state.stage) { renderConsent(); return; }
  if (state.stage === 'email' || !state.participantId) { renderEmail(); return; }
  const pid = state.participantId;
  const cfg: MesfConfig = {
    ...MESF_CONFIG,
    client: () => createLiveMesfClient(API_BASE, { getUserUuid: () => pid, fetchImpl: v2Fetch(pid) }),
  };
  void runMesf(root, pid, cfg).then((r) => {
    if (r.kind === 'auth') { backToEmail('身分驗證失效，請重新輸入 email'); return; }
    set({ stage: 'done', skipped: r.skippedComparison });
    renderDone();
  });
}

document.documentElement.setAttribute('data-build', BUILD);
enableZoomableLayout();
shell(root, { part: PART }).append(spinner('載入中'));
// 打開網址時若有未完成的作答，先問要繼續還是換人；其餘情況照常
if (state.stage === 'mesf' && state.participantId && state.email) renderResumeChoice();
else route();
