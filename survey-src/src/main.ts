// 網頁版問卷主流程：同意 → email → 第一部分（偏好） → 過場 → 第二部分（比較） → 完成。
import { runAblation } from './ablation';
import { ApiError, BUILD, enter, loadState, saveState, storageWorks, type WebState } from './core';
import { runMesf } from './mesf';
import { button, errorText, h, shell, spinner } from './ui';

const root = document.getElementById('app') as HTMLElement;
let state: WebState = loadState();
const canStore = storageWorks();

function set(patch: Partial<WebState>) {
  state = { ...state, ...patch };
  saveState(state);
}

// ⚠ 帳號失效（例如受測者申請刪除資料後又回來）：回到填 email，不無限重試
function backToEmail(message?: string) {
  set({ stage: 'email', userUuid: undefined, resumeToken: undefined, wHat: undefined });
  renderEmail(message);
}

// ───────── 同意說明（⚠ 草稿，正式發布前需審閱；改文字就要把 CONSENT_VERSION 進版） ─────────
function renderConsent() {
  const body = shell(root, { part: '一拍即合 研究問卷' });
  let agreed = false;
  const box = h('input', { attrs: { type: 'checkbox', id: 'agree' } }) as HTMLInputElement;
  const next = button('下一步', () => { set({ stage: 'email' }); renderEmail(); }, { disabled: true, id: 'to-email' });
  box.addEventListener('change', () => { agreed = box.checked; next.disabled = !agreed; });
  body.append(
    h('h1', { class: 'title', text: '一拍即合 研究問卷' }),
    h('p', { class: 'lead', text: '這份問卷分成兩個部分，全程約 15 分鐘，不需要下載 App。' }),
    h('ol', { class: 'parts' },
      h('li', null, h('strong', { text: '濾鏡偏好（44 題，約 7 分鐘）' }), h('br'), '從三張或四張不同調色的照片中，選出你最喜歡的。'),
      h('li', null, h('strong', { text: '照片比較（36 組，約 6 分鐘）' }), h('br'), '比較同一個人的兩個處理版本，評分右邊比左邊好或差。')),
    h('div', { class: 'notice' },
      h('p', { text: '我們會保存：你的 email、每一題的選擇與作答時間，以及裝置類型與螢幕尺寸。' }),
      h('p', { text: 'email 用於辨識同一位作答者、避免重複作答，以及受理你的資料刪除申請。不會要求你上傳任何照片。' })),
    h('div', { class: 'notice' },
      h('p', { text: '參加完全自願，可以隨時關閉頁面離開。之後用同一個瀏覽器開啟這個連結，就能從中斷的地方繼續。' }),
      h('p', null, '資料的使用與刪除方式，請見', h('a', { text: '隱私權政策', attrs: { href: '../privacy.html', target: '_blank', rel: 'noopener' } }), '。')),
    h('label', { class: 'consent', attrs: { for: 'agree' } }, box, h('span', { text: '我已閱讀上述說明，同意參加並保存我的作答紀錄。' })),
    next,
  );
  if (!canStore) {
    body.append(h('p', { class: 'warn', text: '你的瀏覽器目前無法保存進度（可能是無痕模式）。仍可作答，但中途關閉頁面後將無法接續。' }));
  }
}

// ───────── email ─────────
function renderEmail(message?: string) {
  const body = shell(root, { part: '一拍即合 研究問卷', onBack: () => { set({ stage: 'consent' }); renderConsent(); } });
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
    h('p', { class: 'hint', text: '用來辨識作答者、避免重複作答。除非你申請刪除資料，我們不會寄信給你。' }),
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
      set({
        email,
        userUuid: r.user_uuid,
        resumeToken: r.resume_token ?? token,
        stage: state.stage === 'transition' || state.stage === 'ablation' ? state.stage : 'mesf',
      });
      route();
    } catch (e) {
      go.disabled = false;
      go.textContent = '開始作答';
      msg.append(errorText(e instanceof ApiError ? e.message : '發生未知錯誤，請重試'));
    }
  }
}

// ───────── 過場、完成 ─────────
function renderTransition(skipped: boolean) {
  const body = shell(root, { part: '一拍即合 研究問卷', progress: 0.5 });
  body.append(
    h('div', { class: 'center' },
      h('div', { class: 'done-icon', text: '✓' }),
      h('h1', { class: 'title', text: '第一部分完成' }),
      skipped ? null : h('p', { class: 'hint', text: '已記錄你的濾鏡偏好。' }),
      h('p', { class: 'lead', text: '接著是第二部分：照片比較，共 36 組，約 6 分鐘。' }),
      h('p', { class: 'hint', text: '第二部分的照片會依你在第一部分的偏好調色。' })),
    button('開始第二部分', () => { set({ stage: 'ablation' }); route(); }, { id: 'to-part2' }),
  );
}

function renderDone() {
  const body = shell(root, { part: '一拍即合 研究問卷', progress: 1 });
  body.append(h('div', { class: 'center' },
    h('div', { class: 'done-icon', text: '✓' }),
    h('h1', { class: 'title', text: '全部完成，謝謝你的參與' }),
    h('p', { class: 'hint', text: '你的評分會用來比較構圖引導、畸變校正、個人化濾鏡三項功能各自帶來多少改善。現在可以關閉這個頁面。' })));
}

// ───────── 路由 ─────────
function route() {
  if (state.stage === 'done') { renderDone(); return; }
  if (state.stage === 'consent' || !state.stage) { renderConsent(); return; }
  if (state.stage === 'email' || !state.userUuid) { renderEmail(); return; }
  const uuid = state.userUuid;
  if (state.stage === 'mesf') {
    void runMesf(root, uuid).then((r) => {
      if (r.kind === 'auth') { backToEmail('身分驗證失效，請重新輸入 email'); return; }
      set({ stage: 'transition', wHat: r.wHat });
      renderTransition(r.skippedComparison);
    });
    return;
  }
  if (state.stage === 'transition' && state.wHat) { renderTransition(false); return; }
  if (state.stage === 'ablation' && state.wHat) {
    void runAblation(root, uuid, state.wHat).then((r) => {
      if (r.kind === 'auth') { backToEmail('身分驗證失效，請重新輸入 email'); return; }
      set({ stage: 'done' });
      renderDone();
    });
    return;
  }
  // 狀態不完整（例如缺 ŵ）：回到第一部分，控制器會從本機紀錄接續或取回 ŵ
  set({ stage: 'mesf' });
  route();
}

document.documentElement.setAttribute('data-build', BUILD);
shell(root, { part: '一拍即合 研究問卷' }).append(spinner('載入中'));
route();
