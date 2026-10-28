// 畫面元件與排版。
import { resolveChoiceLayout } from '@app/content/preferenceSurvey';

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: {
    class?: string;
    text?: string;
    attrs?: Record<string, string>;
    style?: Partial<CSSStyleDeclaration>;
    on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  } | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props?.class) el.className = props.class;
  if (props?.text !== undefined) el.textContent = props.text;
  for (const [k, v] of Object.entries(props?.attrs ?? {})) el.setAttribute(k, v);
  Object.assign(el.style, props?.style ?? {});
  for (const [k, fn] of Object.entries(props?.on ?? {})) if (fn) el.addEventListener(k, fn);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function button(label: string, onClick: () => void, opts: { kind?: 'primary' | 'secondary'; disabled?: boolean; id?: string } = {}) {
  const b = h('button', {
    class: opts.kind === 'secondary' ? 'btn btn-secondary' : 'btn btn-primary',
    text: label,
    attrs: { type: 'button', ...(opts.id ? { id: opts.id } : {}) },
    on: { click: () => { if (!b.disabled) onClick(); } },
  });
  b.disabled = !!opts.disabled;
  return b;
}

export function spinner(text: string) {
  return h('div', { class: 'center' }, h('div', { class: 'spinner', attrs: { role: 'status' } }), h('p', { class: 'hint', text }));
}

export function errorText(text: string) {
  return h('p', { class: 'error', text, attrs: { role: 'alert' } });
}

/** 外框：頂部標題列與進度條。回傳內容容器。 */
/**
 * @param fill 題目畫面：頁面高度固定為一個畫面，「下一題」在最下方，中間剩下的空間
 *   全部給圖片（與 App 相同的視覺效果）。
 */
export function shell(root: HTMLElement, opts: { part: string; progress?: number; onBack?: () => void; fill?: boolean }): HTMLElement {
  root.replaceChildren();
  const back = opts.onBack
    ? h('button', { class: 'icon-btn', text: '‹', attrs: { type: 'button', 'aria-label': '上一題' }, on: { click: opts.onBack } })
    : h('span', { class: 'icon-btn' });
  const bar = h('div', { class: 'topbar' }, back, h('span', { class: 'brand', text: opts.part }), h('span', { class: 'icon-btn' }));
  const prog = h('div', { class: 'progress' },
    h('div', { class: 'progress-fill', style: { width: `${Math.max(4, Math.min(100, (opts.progress ?? 0) * 100))}%` } }));
  const body = h('main', { class: opts.fill ? 'body fill' : 'body' });
  root.append(h('div', { class: opts.fill ? 'page fill' : 'page' }, bar, prog, body));
  window.scrollTo(0, 0);
  return body;
}

// ───────────────────────── 選項排版（照 App 的 AdaptiveChoiceGrid） ─────────────────────────
// ⚠ 實驗一要求「四選一呈現方式」事先固定。這裡的常數與公式逐一對應
//   competition/src/components/OnboardingQuestionnaireScreen.tsx，改那邊就要改這裡。

const OPTION_GAP = 10;
const CALIBRATION_CHROME_HEIGHT = 300;
const CALIBRATION_ROW_GUTTER = 8;
/**
 * ⚠ 電腦螢幕上把題目區限制在手機寬度。不限制的話照片會大好幾倍，細微差異
 *   （尤其是畸變校正）比在手機上容易看出來，網頁與 App 的資料就不可比。
 */
export const MAX_WIDTH = 480;

/** 量出圖片區實際可用的寬高（等版面排好後再量）。 */
export async function measureBox(el: HTMLElement): Promise<{ w: number; h: number }> {
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const r = el.getBoundingClientRect();
  return { w: Math.floor(r.width), h: Math.floor(r.height) };
}

/**
 * 電腦版瀏覽器放大（Ctrl＋）時讓圖片跟著放大（v2，2026-10-28 組員回報）。
 *
 * ⚠ 校準題與四選一是「一個畫面放得下、不捲動」：頁高＝min(100dvh, 844px)，圖片依此計算。放大會讓
 *   瀏覽器回報的 CSS 視窗變小、文字變大，結果圖片反而縮小（實測 100%→200%：289→196 px，標題 28→56 px）。
 * 做法：放大（devicePixelRatio 變大）時保留放大前的頁高（CSS px），圖片隨倍率等比放大、頁面改為可捲動；
 *   單純改變視窗大小（devicePixelRatio 不變）或縮小時照舊撐滿一個畫面。手機的雙指放大不改 devicePixelRatio，不受影響。
 * 只有呼叫此函式的頁面（v2）會啟用；v1 不呼叫，行為不變。
 */
export function enableZoomableLayout(): void {
  const FILL_MAX = 844;
  let baseDpr = 0;
  let baseH = 0;
  const update = () => {
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.min(window.innerHeight, FILL_MAX);
    if (!baseDpr || dpr <= baseDpr + 1e-3) {
      baseDpr = dpr;
      baseH = fit;
    }
    document.documentElement.style.setProperty('--fill-h', `${dpr > baseDpr + 1e-3 ? baseH : fit}px`);
  };
  document.documentElement.classList.add('zoomable');
  update();
  window.addEventListener('resize', update);
}

/** 視窗大小改變（轉向、網址列收合）時重新排版；畫面離開後自動解除 */
export function onResize(el: HTMLElement, redraw: () => void) {
  let t = 0;
  const fn = () => {
    if (!el.isConnected) { window.removeEventListener('resize', fn); return; }
    window.clearTimeout(t);
    t = window.setTimeout(redraw, 120);
  };
  window.addEventListener('resize', fn);
}

export interface Option {
  slot: number;
  label: string;
  src: string;
  aspect: number;
}

interface Placed { option: Option; width: number; height: number; contain: boolean }

function windowWidth() { return Math.min(window.innerWidth, MAX_WIDTH); }

/**
 * @param fixedHeight 校準題與四選一：圖片要放進一個畫面不需捲動（App 的 calibrationHeight）
 * @param box 圖片區實際量到的寬高。
 *   ⚠ App 用「視窗高度 − 300」估算可用高度，300 是依 App 自己的畫面調出來的。
 *   手機瀏覽器多了網址列與工具列，套用同一個常數會讓圖片沒撐滿、按鈕不在最下方
 *   （2026-10-18 實機測試回報）。有量到的值就用量到的；排版規則（三角、2×2、
 *   上下疊）不變，只是尺寸以實際空間計算。
 */
export function layoutChoices(options: Option[], fixedHeight: boolean, quad: boolean,
  box?: { w: number; h: number }): Placed[][] {
  const ww = windowWidth();
  const contentWidth = box ? box.w : Math.max(280, ww - 48);
  const avail = box ? Math.max(160, box.h) : Math.max(240, Math.floor(window.innerHeight - CALIBRATION_CHROME_HEIGHT));
  const rowContentWidth = box ? box.w : fixedHeight ? ww - CALIBRATION_ROW_GUTTER * 2 : contentWidth;
  const aspect0 = Math.max(options[0]?.aspect ?? 1, 0.1);

  if (quad && fixedHeight) {
    if (aspect0 >= 1) {
      const hgt = Math.max(48, Math.floor((avail - OPTION_GAP * 3) / 4));
      const w = Math.min(contentWidth, Math.floor(hgt * aspect0));
      return options.map((o) => [{ option: o, width: w, height: hgt, contain: true }]);
    }
    const hgt = Math.max(48, Math.floor(Math.min((avail - OPTION_GAP) / 2, (rowContentWidth - OPTION_GAP - 4) / 2 / aspect0)));
    const w = Math.floor(hgt * aspect0);
    return [options.slice(0, 2), options.slice(2, 4)].map((row) => row.map((o) => ({ option: o, width: w, height: hgt, contain: true })));
  }

  if (fixedHeight) {
    // 校準三選一：橫圖上下疊、直圖上 1 下 2
    if (aspect0 >= 1) {
      const hgt = Math.max(72, Math.floor((avail - OPTION_GAP * (options.length - 1)) / options.length));
      const w = Math.min(contentWidth, Math.floor(hgt * aspect0));
      return options.map((o) => [{ option: o, width: w, height: hgt, contain: true }]);
    }
    const hgt = Math.max(72, Math.floor(Math.min((avail - OPTION_GAP) / 2, (rowContentWidth - OPTION_GAP - 4) / 2 / aspect0)));
    const w = hgt * aspect0;
    return [[{ option: options[0], width: w, height: hgt, contain: true }],
      options.slice(1).map((o) => ({ option: o, width: w, height: hgt, contain: true }))];
  }

  // 二選一：依長寬比決定並排或上下疊；兩張沒有「上二下一」，masonry 退回並排
  const raw = resolveChoiceLayout(options.map((o) => o.aspect));
  const layout = options.length < 3 && raw === 'masonry' ? 'row' : raw;
  if (layout === 'column') {
    return options.map((o) => [{ option: o, width: contentWidth, height: Math.max(72, Math.round(contentWidth / (o.aspect || 1))), contain: false }]);
  }
  const rowWidth = (contentWidth - OPTION_GAP * (options.length - 1)) / options.length;
  return [options.map((o) => {
    const rawH = rowWidth / (o.aspect || 1);
    return { option: o, width: rowWidth, height: Math.max(72, Math.round(Math.min(rawH, rowWidth * 1.55))), contain: false };
  })];
}

export function choiceGrid(rows: Placed[][], selected: number | null, onSelect: (slot: number) => void, disabled: boolean) {
  return h('div', { class: 'choice-grid' }, ...rows.map((row) => h('div', { class: 'choice-row' }, ...row.map((p) => {
    const active = selected === p.option.slot;
    const card = h('button', {
      class: `choice${active ? ' active' : ''}`,
      attrs: { type: 'button', 'aria-pressed': String(active), 'aria-label': `選項 ${p.option.label}`, 'data-slot': String(p.option.slot) },
      style: { width: `${Math.floor(p.width)}px` },
      on: { click: () => { if (!disabled) onSelect(p.option.slot); } },
    },
    h('div', { class: 'frame', style: { height: `${Math.floor(p.height)}px` } },
      h('img', { attrs: { src: p.option.src, alt: '', draggable: 'false' }, style: { objectFit: p.contain ? 'contain' : 'cover' } }),
      h('span', { class: 'badge', text: p.option.label }),
      active ? h('span', { class: 'check', text: '✓' }) : null));
    card.disabled = disabled;
    return card;
  }))));
}

/** 讀出圖片原始長寬比（data URI 或 blob URL）。 */
export function measure(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1);
    img.onerror = () => resolve(1);
    img.src = src;
  });
}
