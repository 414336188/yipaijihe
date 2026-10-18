// 第二部分：研究問卷（裂區實驗，36 個畫面、48 題）。題目由伺服器組好，雙盲。
import {
  CCR_LABEL,
  CCR_SCALE,
  DIMENSION_PROMPT,
  groupIntoScreens,
  type CcrScore,
  type SurveyDimension,
  type SurveyScreen,
} from '@app/modules/ablationSurveyTypes';
import { ApiError, ImageCache, ablation } from './core';
import { MAX_WIDTH, button, errorText, h, shell, spinner } from './ui';

const PART = '第二部分・照片比較';

export type AblationOutcome = { kind: 'done' } | { kind: 'auth' };

interface Pick { firstAt: number; lastAt: number; changes: number }

export function runAblation(root: HTMLElement, uuid: string, wHat: readonly number[]): Promise<AblationOutcome> {
  return new Promise((resolve) => {
    const cache = new ImageCache(uuid);
    let sessionId = '';
    let screens: SurveyScreen[] = [];
    let pos = 0;
    /** 畫面上目前選的分數（含已送出的） */
    const picked: Record<number, CcrScore> = {};
    /**
     * 伺服器已收下的分數。
     *
     * ⚠ 回上一組時，沒改的題目不重送。App 的寫法是整組重送：回到上一組時
     *   「畫面出現時間」變成現在，但點選時間還是第一次作答時的，於是決定時間
     *   算出負數、伺服器存成空值，覆蓋掉原本正確的值（2026-10-15 收卷資料中
     *   實際出現一筆）。只送真的改過的題目，原本的時間紀錄就不會被破壞。
     */
    const submitted: Record<number, CcrScore> = {};
    let busy = false;

    const describe = (e: unknown) => {
      if (e instanceof ApiError) {
        if (e.code === 'SURVEY_UNAVAILABLE') return '問卷暫時無法使用，請稍後再試';
        if (e.retryable) return '連線不穩，作答尚未送出，請重試';
        return e.message;
      }
      return e instanceof Error ? e.message : '發生未知錯誤';
    };
    const isAuth = (e: unknown) => e instanceof ApiError && e.code === 'UNAUTHORIZED';

    const load = async () => {
      shell(root, { part: PART }).append(spinner('正在準備題目'));
      try {
        const res = await ablation.session(uuid, wHat);
        sessionId = res.session_id;
        screens = groupIntoScreens(res.trials as never);
        const answered = new Set(res.answered);
        for (const [k, v] of Object.entries(res.answers ?? {})) {
          const ti = Number(k);
          if (Number.isInteger(ti) && (CCR_SCALE as readonly number[]).includes(v)) {
            picked[ti] = v as CcrScore;
            submitted[ti] = v as CcrScore;
          }
        }
        const first = screens.findIndex((s) => s.trials.some((t) => !answered.has(t.trial_index)));
        if (first < 0) { void complete(); return; }
        pos = first;
        void render();
      } catch (e) {
        if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
        shell(root, { part: PART }).append(errorText(describe(e)), button('重試', () => void load()));
      }
    };

    const render = async () => {
      const cur = screens[pos];
      const textOnly = cur.trials.some((t) => t.dimension === 'instruct');
      const body = shell(root, { part: PART, progress: pos / Math.max(screens.length, 1) });
      body.append(h('p', { class: 'eyebrow', text: `第 ${pos + 1} / ${screens.length} 組` }));

      // ⚠ 這次造訪的點選歷程。每次進入畫面都重新開始，決定時間才會以「這一次
      //   畫面出現」為基準。
      const picks: Record<number, Pick> = {};
      let shownAt = '';
      let shownMs = 0;
      let ready = textOnly;

      // 影像：兩張並排，寬度照 App（左右各留 20、中間 10）
      const cellW = Math.floor((Math.min(window.innerWidth, MAX_WIDTH) - 50) / 2);
      const cellH = Math.round(cellW * 1.33);
      const pair = h('div', { class: 'pair' });
      if (!textOnly) {
        for (const side of ['left', 'right'] as const) {
          pair.append(h('div', { class: 'pair-cell', style: { width: `${cellW}px` } },
            h('p', { class: 'side', text: side === 'left' ? '左' : '右' }),
            h('div', { class: 'photo', attrs: { 'data-side': side }, style: { width: `${cellW}px`, height: `${cellH}px` } },
              h('div', { class: 'spinner small' }))));
        }
        body.append(pair);
      }

      const qWrap = h('div');
      const msg = h('div');
      const allPicked = () => cur.trials.every((t) => picked[t.trial_index] !== undefined);
      const isLast = pos + 1 >= screens.length;
      const next = button(isLast ? '完成' : '下一組', () => void goNext(), { disabled: true, id: 'next' });
      const sync = () => { next.disabled = !allPicked() || busy || !ready; };

      const drawQuestions = () => {
        qWrap.replaceChildren(...cur.trials.map((t) => h('div', { class: 'question' },
          h('p', { class: 'prompt', text: DIMENSION_PROMPT[t.dimension as SurveyDimension] }),
          h('div', { class: 'scale' }, ...CCR_SCALE.map((v) => {
            const on = picked[t.trial_index] === v;
            const b = h('button', {
              class: `chip${on ? ' on' : ''}`,
              attrs: { type: 'button', 'aria-pressed': String(on), 'data-trial': String(t.trial_index), 'data-score': String(v) },
              on: {
                click: () => {
                  if (busy || !ready) return;
                  const now = Date.now();
                  const prev = picks[t.trial_index];
                  picks[t.trial_index] = prev
                    ? { firstAt: prev.firstAt, lastAt: now, changes: prev.changes + 1 }
                    : { firstAt: now, lastAt: now, changes: 0 };
                  picked[t.trial_index] = v;
                  drawQuestions();
                  sync();
                },
              },
            },
            h('span', { class: 'chip-num', text: v > 0 ? `+${v}` : `${v}` }),
            h('span', { class: 'chip-label', text: CCR_LABEL[v] }));
            b.disabled = busy || !ready;
            return b;
          })))));
      };
      drawQuestions();
      body.append(qWrap, msg, next);
      if (pos > 0) {
        body.append(button('回上一組修改', () => { if (!busy) { pos -= 1; void render(); } }, { kind: 'secondary' }));
      }
      body.append(h('p', { class: 'footnote', text: textOnly
        ? '這一題用於確認作答狀態，不影響你的評分結果。'
        : '兩張照片是同一個人的不同版本。請依你的感受作答，沒有標準答案。' }));

      const markShown = () => { shownAt = new Date().toISOString(); shownMs = Date.now(); };
      if (textOnly) {
        markShown();
      } else {
        try {
          const [l, r] = await Promise.all([cur.leftImage, cur.rightImage].map((o) => cache.load(o)));
          if (!body.isConnected) return;
          const cells = pair.querySelectorAll('.photo');
          cells[0].replaceChildren(h('img', { attrs: { src: l, alt: '左', draggable: 'false' } }));
          cells[1].replaceChildren(h('img', { attrs: { src: r, alt: '右', draggable: 'false' } }));
          // ⚠ 與 App 一致：圖片顯示的那一刻才開始計時
          markShown();
          ready = true;
          drawQuestions();
          sync();
        } catch (e) {
          if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
          msg.replaceChildren(errorText('圖片載入失敗'), button('重新載入圖片', () => void render(), { kind: 'secondary' }));
        }
      }
      const nx = screens[pos + 1];
      if (nx && !nx.trials.some((t) => t.dimension === 'instruct')) cache.prefetch([nx.leftImage, nx.rightImage]);
      sync();

      const goNext = async () => {
        if (busy || !allPicked() || !ready) return;
        busy = true;
        sync();
        drawQuestions();
        msg.replaceChildren();
        try {
          // 先送維度題（在陣列前面），與伺服器題序一致；沒改的不重送
          for (const t of cur.trials) {
            const score = picked[t.trial_index];
            if (submitted[t.trial_index] === score) continue;
            const pk = picks[t.trial_index];
            await ablation.answer(uuid, {
              session_id: sessionId,
              trial_index: t.trial_index,
              raw_score: score,
              shown_at: shownAt || undefined,
              rt_ms: shownMs ? Date.now() - shownMs : undefined,
              picked_at: pk ? new Date(pk.lastAt).toISOString() : undefined,
              first_picked_at: pk ? new Date(pk.firstAt).toISOString() : undefined,
              decide_ms: pk && shownMs ? pk.lastAt - shownMs : undefined,
              pick_changes: pk ? pk.changes : undefined,
            });
            submitted[t.trial_index] = score;
          }
          busy = false;
          if (isLast) void complete();
          else { pos += 1; void render(); }
        } catch (e) {
          busy = false;
          if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
          msg.replaceChildren(errorText(describe(e)));
          drawQuestions();
          sync();
        }
      };
    };

    const complete = async () => {
      shell(root, { part: PART, progress: 1 }).append(spinner('正在送出最後的作答'));
      try {
        const res = await ablation.complete(uuid, sessionId);
        if (!res.ok) {
          // 伺服器說還沒答完：回到第一個未完成的畫面，不假裝完成
          void load();
          return;
        }
        resolve({ kind: 'done' });
      } catch (e) {
        if (isAuth(e)) { resolve({ kind: 'auth' }); return; }
        shell(root, { part: PART, progress: 1 }).append(errorText(describe(e)), button('重試', () => void complete()));
      }
    };

    void load();
  });
}
