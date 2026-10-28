// 第一部分：偏好問卷（44 題）。出題、接續、逾期重建都交給 App 的 MesfController。
import { createLiveMesfClient } from '@app/modules/mesfClient';
import { MesfController, type MesfStore } from '@app/modules/mesfController';
import { MesfApiError, type MesfClient } from '@app/modules/mesfApiTypes';
import type { LoadedImage } from '@app/modules/mesfImage';
import { API_BASE, BUILD, CONSENT_VERSION, mesfStore } from './core';
import { button, choiceGrid, errorText, h, layoutChoices, measure, measureBox, onResize, shell, spinner, type Option } from './ui';

// ⚠ 以下文字逐字取自 competition/src/components/OnboardingQuestionnaireScreen.tsx。
//   check.mjs 會比對兩邊，App 改了這裡沒跟上就會失敗。
export const CALIBRATION_TITLE = '下列哪一個濾鏡效果你比較喜歡？';
export const COMPARISON_TITLE = '兩個版本中，哪一個整體看起來更好、是你比較喜歡的？';
export const QUAD_TITLE = '下列哪一張的調色效果你最喜歡？';
const NO_POOL_TEXT = '依你的作答結果，目前沒有足夠的比較照片可以繼續這份問卷，謝謝你的參與。';
const SLOTS = ['A', 'B', 'C', 'D'];
const EXPECTED_WAIT_SEC = 20;
const PART = '第一部分・濾鏡偏好';
/** 校準 20 題＋比較 24 題。只用於進度條。 */
const TOTAL_GUESS = 44;

export type MesfOutcome =
  | { kind: 'done'; wHat: [number, number, number]; skippedComparison: boolean }
  | { kind: 'auth' };

type W3 = [number, number, number];

/**
 * 問卷版本之間不同的部分。未給的欄位一律是 v1（舊問卷）的值，v1 的行為與改版前相同。
 * v2（濾鏡問卷 2 選 1）見 src/v2/main.ts。
 */
export interface MesfConfig {
  client: (uuid: string) => MesfClient;
  store: MesfStore;
  consentVersion: string;
  part: string;
  /** 只用於進度條 */
  totalGuess: number;
  /** 送出校準後的預估等待秒數（v1 與 App 相同，check.mjs 比對） */
  waitSec: number;
  /** 照片不足（422）時，說明之後的下一步文字；null 表示問卷到此結束 */
  noPoolNext: string | null;
  /**
   * 送出校準後等待頁的標題與說明。
   * ⚠ v2 不可提「專屬」「依你的作答」：研究目的用中性寫法，不讓受測者知道兩張中有一張為他調色（2026-10-28 使用者決定）。
   */
  waitTitle: string;
  waitHint: (sec: number) => string;
  /** 伺服器 session 逾期且無法接續、需整份重來時的說明 */
  restartText: string;
  /** 最後送出（/complete）時的等待文字 */
  finishText: string;
  /**
   * 注意力題的問句。未給即與比較題相同（v1：「哪一個比較好看」，喜歡黑白的人會被誤判）。
   * v2 改為明確指示選彩色那張（2026-10-28 使用者決定）。
   */
  attention?: { title: string; hint: string };
  /** 換用 MesfController 的子類別（v2：可回上一題）。未給即 App 原本的控制器（v1：作答即鎖定） */
  makeController?: (...args: ConstructorParameters<typeof MesfController>) => MesfController;
}

/** 控制器若提供這兩個方法，比較題就顯示「上一題」（見 src/v2/controller.ts）。 */
interface BackCapable {
  canGoBack(): boolean;
  /** 回傳上一題原本點選的畫面位置，供預選 */
  goBack(): Promise<number | null>;
}

function backCapable(c: MesfController): c is MesfController & BackCapable {
  return typeof (c as Partial<BackCapable>).goBack === 'function';
}

/**
 * v1（舊問卷）的設定。⚠ 以函式產生、只由 src/main.ts 呼叫：寫成模組層常數的話，
 * v2 的打包也會帶著這些文字（「專屬影像」等），看原始碼就看得到。
 */
export function v1Config(): MesfConfig {
  return {
    client: (uuid) => createLiveMesfClient(API_BASE, { getUserUuid: () => uuid }),
    store: mesfStore,
    consentVersion: CONSENT_VERSION,
    part: PART,
    totalGuess: TOTAL_GUESS,
    waitSec: EXPECTED_WAIT_SEC,
    noPoolNext: '第一部分到此結束，接著可以繼續第二部分。',
    waitTitle: '正在為你產生專屬影像',
    waitHint: (sec) => `這一步需要約 ${sec} 秒，系統正依你的作答重新算圖。`,
    restartText: '上次的作答已逾時，需要重新開始第一部分。',
    finishText: '正在送出第一部分',
  };
}

export function runMesf(root: HTMLElement, uuid: string, cfg: MesfConfig): Promise<MesfOutcome> {
  const { store: mesfStore, part: PART, totalGuess: TOTAL_GUESS, waitSec: EXPECTED_WAIT_SEC } = cfg;
  return new Promise((resolve) => {
    const client = cfg.client(uuid);
    // ⚠ 第五個參數是同意書版本：網頁版必須傳 web-v1／web-v2，這是分辨資料來源的唯一欄位
    const ctlArgs: ConstructorParameters<typeof MesfController> = [client, mesfStore, BUILD, () => new Date(), cfg.consentVersion];
    const ctl = cfg.makeController ? cfg.makeController(...ctlArgs) : new MesfController(...ctlArgs);

    // 圖片快取：App 用 imageCache，這裡用 Promise 快取，失敗的不留
    const imgCache = new Map<string, Promise<LoadedImage>>();
    const loadImage = (id: string) => {
      let p = imgCache.get(id);
      if (!p) {
        p = client.loadImage(id);
        p.catch(() => imgCache.delete(id));
        imgCache.set(id, p);
      }
      return p;
    };
    const prefetch = (ids: string[]) => ids.forEach((id) => void loadImage(id).catch(() => undefined));

    let busy = false;
    const answeredSoFar = () => ctl.calibrationCursor + ctl.snapshot.answers.filter((a) => a.synced).length;

    const finishWith = async (w: W3, skipped: boolean) => {
      await mesfStore.clear();
      resolve({ kind: 'done', wHat: w, skippedComparison: skipped });
    };

    const isGone = (e: unknown) => e instanceof MesfApiError && e.code === 'SESSION_NOT_FOUND';
    const isAuth = (e: unknown) => e instanceof MesfApiError && e.code === 'UNAUTHORIZED';
    const describe = (e: unknown) => {
      if (e instanceof MesfApiError) {
        if (e.retryable) return '資料送出失敗，已保留在這個瀏覽器，請重試';
        return e.message || `${e.status} ${e.code}`;
      }
      return e instanceof Error ? e.message : '發生未知錯誤';
    };

    const fail = (e: unknown, retry: () => void) => {
      if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
      const body = shell(root, { part: PART, progress: answeredSoFar() / TOTAL_GUESS });
      body.append(errorText(describe(e)), button('重試', retry));
    };

    // ── 伺服器的 session 逾期（記憶體 2 小時 TTL）：有 ŵ 就重建比較題，沒有就整份重來 ──
    // ⚠ force：比較題的影像只在伺服器記憶體（同樣 2 小時 TTL），逾期時取圖先拿到的是
    //   404 IMAGE_NOT_FOUND 而不是 SESSION_NOT_FOUND，這種情況也要走重建。
    const recover = async (e: unknown, again: () => void, force = false) => {
      if (!force && !isGone(e)) { fail(e, again); return; }
      if (ctl.canCarryOver) {
        waiting('作答間隔較久，正在重新產生比較影像');
        try {
          await ctl.carryOverFromLocal();
          renderComparison();
        } catch (err) { fail(err, again); }
        return;
      }
      await mesfStore.clear();
      const body = shell(root, { part: PART });
      body.append(h('p', { class: 'notice', text: cfg.restartText }), spinner('正在準備題目'));
      start();
    };

    const waiting = (title: string) => {
      const body = shell(root, { part: PART, progress: answeredSoFar() / TOTAL_GUESS });
      let sec = 0;
      const secEl = h('p', { class: 'hint', text: '' });
      const tick = () => {
        secEl.textContent = `已等待 ${sec} 秒${sec < EXPECTED_WAIT_SEC ? `，約還需 ${EXPECTED_WAIT_SEC - sec} 秒` : ''}`;
        if (sec >= EXPECTED_WAIT_SEC * 3) secEl.textContent += '。比平常久一些，可能有其他人同時在作答，仍在處理中請再稍候。';
      };
      tick();
      const id = window.setInterval(() => { sec += 1; if (!secEl.isConnected) window.clearInterval(id); else tick(); }, 1000);
      body.append(h('div', { class: 'center' },
        h('div', { class: 'spinner' }),
        h('p', { class: 'wait-title', text: title }),
        h('p', { class: 'hint', text: cfg.waitHint(EXPECTED_WAIT_SEC) }),
        h('p', { class: 'warn', text: '請留在此頁面，不要關閉或重新整理' }),
        secEl));
    };

    // ───────── 校準：20 題三選一 ─────────
    const renderCalibration = async () => {
      const q = ctl.currentCalibration();
      const total = ctl.calibrationTarget;
      const cursor = ctl.calibrationCursor;
      const body = shell(root, {
        part: PART,
        progress: cursor / TOTAL_GUESS,
        onBack: cursor > 0 && !busy ? () => { if (ctl.backCalibration()) void renderCalibration(); } : undefined,
        fill: true,
      });
      body.append(h('p', { class: 'eyebrow', text: `第 ${cursor + 1}／${total} 題` }), h('h1', { class: 'title', text: CALIBRATION_TITLE }));
      const slot = h('div', { class: 'grid-slot' });
      body.append(slot);
      slot.append(spinner('圖片載入中…'));
      const isLast = cursor + 1 >= total;
      const next = button(isLast ? '送出' : '下一題', () => void goNext(), { disabled: true, id: 'next' });
      body.append(next);
      let options: Option[];
      try {
        const imgs = await Promise.all(q.display_candidate_order.map((ci) => loadImage(q.image_ids[ci])));
        const aspects = await Promise.all(imgs.map((im) => (im.width && im.height ? Promise.resolve(im.width / im.height) : measure(im.uri))));
        options = imgs.map((im, s) => ({ slot: s, label: SLOTS[s], src: im.uri, aspect: aspects[s] }));
      } catch (e) {
        if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
        slot.replaceChildren(errorText('圖片載入失敗'), button('重試', () => void renderCalibration()));
        return;
      }
      if (!body.isConnected) return;
      prefetch(ctl.calibrationImageIds(cursor + 1));
      const prior = q.choice_index;
      let selected: number | null = prior === null ? null : q.display_candidate_order.indexOf(prior);
      next.disabled = selected === null;
      slot.replaceChildren();
      let box = await measureBox(slot);
      const draw = () => {
        slot.replaceChildren(choiceGrid(layoutChoices(options, true, false, box), selected, (s) => { selected = s; next.disabled = false; draw(); }, busy));
      };
      draw();
      onResize(slot, async () => { slot.replaceChildren(); box = await measureBox(slot); draw(); });
      const goNext = async () => {
        if (busy || selected === null) return;
        busy = true;
        next.disabled = true;
        try {
          const r = await ctl.chooseCalibration(q.display_candidate_order[selected]);
          busy = false;
          if (r === 'next') void renderCalibration();
          else void submitCalibration();
        } catch (e) {
          busy = false;
          fail(e, () => void renderCalibration());
        }
      };
    };

    const submitCalibration = async () => {
      waiting(cfg.waitTitle);
      try {
        await ctl.submitCalibration();
        renderComparison();
      } catch (e) {
        if (e instanceof MesfApiError && e.code === 'INSUFFICIENT_PHOTO_POOL') {
          // ⚠ 照片不足時伺服器仍回 ŵ（契約 R17）。第二部分只需要 ŵ，所以照樣進行；
          //   App 遇到這種情況也保留受測者的個人化濾鏡。
          const w = e.body?.w_hat;
          if (Array.isArray(w) && w.length === 3 && w.every((v) => typeof v === 'number')) {
            const body = shell(root, { part: PART, progress: 1 });
            body.append(h('p', { class: 'notice', text: NO_POOL_TEXT }));
            if (cfg.noPoolNext === null) {
              // v2：沒有第二部分，作答（校準＋ŵ）伺服器已記錄，直接結束
              void finishWith(w as W3, true);
              return;
            }
            body.append(h('p', { class: 'hint', text: cfg.noPoolNext }),
              button('繼續', () => void finishWith(w as W3, true)));
            return;
          }
        }
        void recover(e, () => void submitCalibration());
      }
    };

    // ───────── 比較：24 題（二選一與四選一） ─────────
    // preselect：回上一題時預選原本點的那一側（v2）
    const renderComparison = async (preselect: number | null = null) => {
      const view = ctl.currentComparison();
      if (!view) { void finish(); return; }
      const quad = view.kind === 'quad';
      const goBack = async () => {
        if (busy || !backCapable(ctl)) return;
        busy = true;
        try {
          const side = await ctl.goBack();
          busy = false;
          void renderComparison(side);
        } catch (e) {
          busy = false;
          fail(e, () => void renderComparison());
        }
      };
      // ⚠ 二選一照 App 不限高度（可捲動）；四選一與校準一樣撐滿一個畫面
      const body = shell(root, {
        part: PART, progress: answeredSoFar() / TOTAL_GUESS, fill: quad,
        onBack: backCapable(ctl) && ctl.canGoBack() ? () => void goBack() : undefined,
      });
      // 注意力題（正常圖 vs 灰階圖）：v2 改為明確指示（cfg.attention）；v1 未設定，沿用與比較題相同的問句
      const attn = cfg.attention && view.key.startsWith('attention:') ? cfg.attention : null;
      body.append(h('p', { class: 'eyebrow', text: `第 ${view.position}／${view.total} 題` }),
        h('h1', { class: 'title', text: attn ? attn.title : quad ? QUAD_TITLE : COMPARISON_TITLE }));
      if (attn) body.append(h('p', { class: 'hint', text: attn.hint }));
      const slot = h('div', { class: quad ? 'grid-slot' : '' });
      body.append(slot);
      slot.append(spinner('圖片載入中…'));
      const msg = h('div');
      const isLast = view.position >= view.total;
      const next = button(isLast ? '完成' : '下一題', () => void goNext(), { disabled: true, id: 'next' });
      body.append(next, msg);
      let options: Option[];
      try {
        const imgs = await Promise.all(view.candidates.map((c) => loadImage(c.image_id)));
        const aspects = await Promise.all(imgs.map((im) => (im.width && im.height ? Promise.resolve(im.width / im.height) : measure(im.uri))));
        options = imgs.map((im, s) => ({ slot: s, label: quad ? SLOTS[s] : s === 0 ? '左邊' : '右邊', src: im.uri, aspect: aspects[s] }));
      } catch (e) {
        if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
        const imageGone = e instanceof MesfApiError && e.code === 'IMAGE_NOT_FOUND' && ctl.canCarryOver;
        if (isGone(e) || imageGone) { void recover(e, () => void renderComparison(), imageGone); return; }
        slot.replaceChildren(errorText('圖片載入失敗'), button('重試', () => void renderComparison()));
        return;
      }
      if (!body.isConnected) return;
      prefetch(ctl.upcomingComparisonImageIds(1));
      let selected: number | null = preselect;
      next.disabled = selected === null;
      if (quad) slot.replaceChildren();
      let box = quad ? await measureBox(slot) : undefined;
      const draw = () => {
        slot.replaceChildren(choiceGrid(layoutChoices(options, quad, quad, box), selected, (s) => {
          if (ctl.hasPendingAnswer) return;
          selected = s; next.disabled = false; draw();
        }, busy || ctl.hasPendingAnswer));
      };
      draw();
      if (quad) onResize(slot, async () => { slot.replaceChildren(); box = await measureBox(slot); draw(); });
      const after = () => (ctl.stage === 'finish' ? void finish() : void renderComparison());
      const goNext = async () => {
        if (busy || selected === null) return;
        busy = true;
        next.disabled = true;
        next.textContent = '送出中';
        msg.replaceChildren();
        try {
          await ctl.answerComparison(quad ? selected : selected === 0 ? 'left' : 'right');
          busy = false;
          after();
        } catch (e) {
          busy = false;
          if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
          if (isGone(e)) { void recover(e, () => void renderComparison()); return; }
          // ⚠ 作答已存在瀏覽器（pending），重試只重送、不重答
          next.remove();
          msg.replaceChildren(errorText(describe(e) || '這一題還沒送出成功，作答已保留在這個瀏覽器，請按重試'),
            button('重試送出', () => void retry()));
        }
      };
      const retry = async () => {
        if (busy) return;
        busy = true;
        msg.replaceChildren(spinner('送出中'));
        try {
          await ctl.retryPending();
          busy = false;
          after();
        } catch (e) {
          busy = false;
          if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
          msg.replaceChildren(errorText(describe(e)), button('重試送出', () => void retry()));
        }
      };
    };

    const finish = async () => {
      const body = shell(root, { part: PART, progress: 1 });
      body.append(spinner(cfg.finishText));
      try {
        await ctl.complete();
        const est = ctl.snapshot.estimate;
        if (!est) throw new Error('缺少風格座標');
        void finishWith([est.w_hat_a, est.w_hat_b, est.w_hat_c], false);
      } catch (e) {
        fail(e, () => void finish());
      }
    };

    // ───────── 進入點：有本機紀錄就接續 ─────────
    const start = async () => {
      try {
        await ctl.startSession();
        void renderCalibration();
      } catch (e) {
        fail(e, () => void start());
      }
    };

    void (async () => {
      shell(root, { part: PART }).append(spinner('正在準備題目'));
      const saved = await mesfStore.load();
      // ⚠ 本機紀錄已是 done（第一部分完成、但主狀態還沒存到）：直接取 ŵ，
      //   不可再開一個新 session，否則同一人會有兩份偏好問卷
      if (saved && saved.stage === 'done' && saved.estimate) {
        const e = saved.estimate;
        void finishWith([e.w_hat_a, e.w_hat_b, e.w_hat_c], false);
        return;
      }
      const point = saved ? ctl.resume(saved) : null;
      if (!point) { void start(); return; }
      if (point.kind === 'submit_calibration') { void submitCalibration(); return; }
      if (point.kind === 'finish') { void finish(); return; }
      if (point.kind === 'comparison') {
        // 逾期與否要等第一個請求才知道；取圖若回 SESSION_NOT_FOUND 會走 recover
        void renderComparison();
        return;
      }
      void renderCalibration();
    })();
  });
}
