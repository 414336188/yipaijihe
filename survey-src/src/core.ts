// 設定、本機儲存、API 連線。
import type { MesfLocalRecord, MesfStore } from '@app/modules/mesfController';
import { MESF_LOCAL_VERSION } from '@app/modules/mesfController';

declare const __BUILD__: string;
declare const __APP_COMMIT__: string;

export const BUILD = __BUILD__;
export const APP_COMMIT = __APP_COMMIT__;
export const API_BASE = 'https://155-68.im.fju.edu.tw';
/**
 * ⚠ 寫進 mesf.sessions.consent_version 與 web_survey_participants.consent_version。
 *   偏好問卷的 session 沒有平台欄位，這是分辨「網頁版還是 App 收的」的唯一依據。
 *   同意說明的文字改了就要進版（web-v2…）。
 */
export const CONSENT_VERSION = 'web-v1';

// ───────────────────────── 本機儲存 ─────────────────────────
// ⚠ 一律 try/catch：無痕模式、封鎖網站資料、或儲存空間滿時，存取本身就會丟例外。
//   存不進去時問卷仍可作答，只是中斷後無法接續。

export type Stage = 'consent' | 'email' | 'mesf' | 'transition' | 'ablation' | 'done' | 'ended';

export interface WebState {
  stage: Stage;
  email?: string;
  userUuid?: string;
  resumeToken?: string;
  wHat?: [number, number, number];
  endedReason?: string;
}

const STATE_KEY = 'yipai-web-survey:v1';
const MESF_KEY = 'yipai-web-survey:mesf:v1';

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // 忽略
  }
}

export function loadState(): WebState {
  const s = read<WebState>(STATE_KEY);
  return s && typeof s.stage === 'string' ? s : { stage: 'consent' };
}

export function saveState(s: WebState): boolean {
  return write(STATE_KEY, s);
}

export function storageWorks(): boolean {
  const ok = write('yipai-web-survey:probe', 1);
  remove('yipai-web-survey:probe');
  return ok;
}

/** 偏好問卷控制器的本機紀錄（介面與 App 的 AsyncStorage 版相同）。 */
export const mesfStore: MesfStore = {
  async save(record: MesfLocalRecord) {
    write(MESF_KEY, record);
  },
  async load() {
    const r = read<MesfLocalRecord>(MESF_KEY);
    return r && r.version === MESF_LOCAL_VERSION ? r : null;
  },
  async clear() {
    remove(MESF_KEY);
  },
};

// ───────────────────────── 裝置 ─────────────────────────

export function deviceInfo(): { device: 'mobile' | 'desktop'; viewport: string } {
  let coarse = false;
  try {
    coarse = window.matchMedia('(pointer: coarse)').matches;
  } catch {
    coarse = false;
  }
  const shortSide = Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999);
  return {
    // ⚠ 觸控＋短邊 ≤ 820 才算手機：平板（短邊 ≥ 768）多數仍落在手機，與 App 的使用情境較接近
    device: coarse && shortSide <= 820 ? 'mobile' : 'desktop',
    viewport: `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}`,
  };
}

// ───────────────────────── API ─────────────────────────

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? `${status} ${code}`);
  }

  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

const TIMEOUT_MS = 60_000;

async function request<T>(path: string, init: RequestInit & { uuid?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.uuid) headers['X-User-UUID'] = init.uuid;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_BASE + path, { ...init, headers, signal: ctl.signal });
  } catch (cause) {
    throw new ApiError(0, 'NETWORK_ERROR', '網路連線不穩，請確認連線後重試');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let code = res.status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST';
    let message: string | undefined;
    try {
      const j = (await res.json()) as { code?: string; message?: string; detail?: unknown };
      if (j.code) code = j.code;
      message = j.message ?? (typeof j.detail === 'string' ? j.detail : undefined);
    } catch {
      // 非 JSON
    }
    if (res.status === 401) code = 'UNAUTHORIZED';
    throw new ApiError(res.status, code, message);
  }
  return (await res.json()) as T;
}

export interface EnterResult {
  status: 'new' | 'resume';
  user_uuid: string;
  resume_token?: string;
}

export function enter(email: string, resumeToken: string | undefined): Promise<EnterResult> {
  const d = deviceInfo();
  return request<EnterResult>('/api/web-survey/enter', {
    method: 'POST',
    body: JSON.stringify({
      email,
      resume_token: resumeToken,
      consent: true,
      consent_version: CONSENT_VERSION,
      device: d.device,
      viewport: d.viewport,
    }),
  });
}

// ── 研究問卷（與 App 的 ablationApi.ts 送出相同欄位） ──

export interface AblationSessionRes {
  session_id: string;
  trials: Array<{ trial_index: number; left_image: string; right_image: string; dimension: string }>;
  answered: number[];
  answers?: Record<string, number>;
}

export const ablation = {
  session(uuid: string, wHat: readonly number[]): Promise<AblationSessionRes> {
    return request('/api/ablation/session', {
      method: 'POST',
      uuid,
      body: JSON.stringify({
        w_hat: [wHat[0], wHat[1], wHat[2]],
        // ⚠ platform 只收白名單（ios／android／web）。update_id 放 App 原始碼的
        //   commit，事後可查網頁版用的是哪一版出題邏輯。
        client: {
          platform: 'web',
          runtime_version: BUILD,
          update_id: APP_COMMIT,
          is_embedded: false,
          channel: 'web',
        },
      }),
    });
  },
  answer(uuid: string, body: Record<string, unknown>): Promise<unknown> {
    return request('/api/ablation/answer', { method: 'POST', uuid, body: JSON.stringify(body) });
  },
  complete(uuid: string, sessionId: string): Promise<{ ok: boolean; total: number; answered: number }> {
    return request('/api/ablation/complete', {
      method: 'POST', uuid, body: JSON.stringify({ session_id: sessionId }),
    });
  },
};

/** 研究問卷的圖片要帶 X-User-UUID，不能直接放進 <img src>；取回後轉成 blob URL。 */
export class ImageCache {
  private urls = new Map<string, Promise<string>>();

  constructor(private readonly uuid: string) {}

  load(oid: string): Promise<string> {
    let p = this.urls.get(oid);
    if (!p) {
      p = (async () => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
        try {
          const res = await fetch(`${API_BASE}/api/ablation/image/${encodeURIComponent(oid)}`, {
            headers: { 'X-User-UUID': this.uuid },
            signal: ctl.signal,
          });
          if (!res.ok) throw new ApiError(res.status, res.status === 401 ? 'UNAUTHORIZED' : 'IMAGE_NOT_FOUND');
          return URL.createObjectURL(await res.blob());
        } finally {
          clearTimeout(timer);
        }
      })();
      // 失敗的不要留在快取裡，否則重試永遠拿到同一個失敗
      p.catch(() => this.urls.delete(oid));
      this.urls.set(oid, p);
    }
    return p;
  }

  prefetch(oids: readonly string[]): void {
    for (const o of oids) void this.load(o).catch(() => undefined);
  }
}
