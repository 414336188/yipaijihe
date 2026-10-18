// 第一部分：偏好問卷（44 題）。出題、接續、逾期重建都交給 App 的 MesfController。
import { createLiveMesfClient } from '@app/modules/mesfClient';
import { MesfController } from '@app/modules/mesfController';
import { MesfApiError } from '@app/modules/mesfApiTypes';
import type { LoadedImage } from '@app/modules/mesfImage';
import { API_BASE, BUILD, CONSENT_VERSION, mesfStore } from './core';
import { button, choiceGrid, errorText, h, layoutChoices, measure, shell, spinner, type Option } from './ui';

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

export function runMesf(root: HTMLElement, uuid: string): Promise<MesfOutcome> {
  return new Promise((resolve) => {
    const client = createLiveMesfClient(API_BASE, { getUserUuid: () => uuid });
    // ⚠ 第五個參數是同意書版本：網頁版必須傳 web-v1，這是分辨資料來源的唯一欄位
    const ctl = new MesfController(client, mesfStore, BUILD, () => new Date(), CONSENT_VERSION);

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
      body.append(h('p', { class: 'notice', text: '上次的作答已逾時，需要重新開始第一部分。' }), spinner('正在準備題目'));
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
        h('p', { class: 'hint', text: `這一步需要約 ${EXPECTED_WAIT_SEC} 秒，系統正依你的作答重新算圖。` }),
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
      });
      body.append(h('p', { class: 'eyebrow', text: `第 ${cursor + 1}／${total} 題` }), h('h1', { class: 'title', text: CALIBRATION_TITLE }));
      const slot = h('div');
      body.append(slot);
      slot.append(spinner('圖片載入中…'));
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
      const isLast = cursor + 1 >= total;
      const next = button(isLast ? '送出' : '下一題', () => void goNext(), { disabled: selected === null, id: 'next' });
      const draw = () => {
        slot.replaceChildren(choiceGrid(layoutChoices(options, true, false), selected, (s) => { selected = s; next.disabled = false; draw(); }, busy));
      };
      draw();
      body.append(next);
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
      waiting('正在為你產生專屬影像');
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
            body.append(h('p', { class: 'notice', text: NO_POOL_TEXT }),
              h('p', { class: 'hint', text: '第一部分到此結束，接著可以繼續第二部分。' }),
              button('繼續', () => void finishWith(w as W3, true)));
            return;
          }
        }
        void recover(e, () => void submitCalibration());
      }
    };

    // ───────── 比較：24 題（二選一與四選一） ─────────
    const renderComparison = async () => {
      const view = ctl.currentComparison();
      if (!view) { void finish(); return; }
      const quad = view.kind === 'quad';
      const body = shell(root, { part: PART, progress: answeredSoFar() / TOTAL_GUESS });
      body.append(h('p', { class: 'eyebrow', text: `第 ${view.position}／${view.total} 題` }),
        h('h1', { class: 'title', text: quad ? QUAD_TITLE : COMPARISON_TITLE }));
      const slot = h('div');
      body.append(slot);
      slot.append(spinner('圖片載入中…'));
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
      let selected: number | null = null;
      const msg = h('div');
      const isLast = view.position >= view.total;
      const next = button(isLast ? '完成' : '下一題', () => void goNext(), { disabled: true, id: 'next' });
      const draw = () => {
        slot.replaceChildren(choiceGrid(layoutChoices(options, quad, quad), selected, (s) => {
          if (ctl.hasPendingAnswer) return;
          selected = s; next.disabled = false; draw();
        }, busy || ctl.hasPendingAnswer));
      };
      draw();
      body.append(next, msg);
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
      body.append(spinner('正在送出第一部分'));
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
