// 濾鏡問卷 v2 的轉接層：讓 App 的 MesfController（不改）跑 v2 的題目。
//
// ⚠ 為什麼不改 App 的控制器：它會隨 App 的下一次更新出去，而 v2 只有網頁版（spec §2「App 不改」）。
//   改在這裡，只影響網頁 v2。做法是替換連線用的 fetch（createLiveMesfClient 的 fetchImpl）：
//
//   1. 身分：X-User-UUID → X-Survey-Participant（v2 受測者沒有 App 帳號，見 mesf_proxy）。
//   2. 建立 session（/session、/carry_over）：本文加上 survey_version=filter-v2。
//   3. /calibration、/carry_over 的回應：伺服器回 { r2, attention }，控制器只認舊的六個鍵，
//      且只把「沒有 display_candidate_order 的 2 張題」當二選一（有的話要求 4 張）。
//      因此把 r2 放進控制器會讀的 c2prime 陣列、拿掉 display_candidate_order，其餘鍵補空陣列。
//      ⚠ 題目本身（phase='r2'、題號、候選）原樣保留：作答送回伺服器時仍是 r2，資料不受影響。
//      左右由 left_right_assignment 決定：personalized_left → [候選 0, 候選 1]，與伺服器記錄的順序相同。
import { API_BASE } from '../core';

export const SURVEY_VERSION = 'filter-v2';
const PARTICIPANT_HEADER = 'X-Survey-Participant';
/**
 * 4. 逾時：App 的連線程式固定 120 秒中斷（mesfClient 的 LIVE_TIMEOUT_MS，不改 App）。v2 送出校準要 57～77 秒，
 *    多人同時送出會更久，伺服器轉發上限已改 300 秒（mesf_proxy，2026-10-29 方案 B1 由 180 秒放寬）。這兩個端點
 *    不用 App 的中斷訊號，改用自己的 320 秒（略長於伺服器，讓伺服器先回 504、畫面顯示可重試的錯誤，而不是瀏覽器先放棄）。
 */
const LONG_TIMEOUT_MS = 320_000;

type Json = Record<string, unknown>;

function toControllerShape(body: Json): Json {
  const q = body.comparison_questions as Record<string, Json[]> | undefined;
  if (!q || !Array.isArray(q.r2)) return body;
  const r2 = q.r2.map((item) => {
    const cands = item.candidates as unknown[];
    const lr = item.left_right_assignment;
    if (!Array.isArray(cands) || cands.length !== 2 || (lr !== 'personalized_left' && lr !== 'personalized_right')) {
      throw new Error(`契約違反：r2:${String(item.question_index)} 必須是 2 張且 left_right_assignment 合法`);
    }
    const { display_candidate_order: _drop, ...rest } = item;
    return rest;
  });
  return {
    ...body,
    comparison_questions: { c4: [], c2prime: r2, c2: [], c1: [], attention: q.attention ?? [], repeat: [] },
  };
}

/** createLiveMesfClient 的 fetchImpl。participantId 由入口取得。 */
export function v2Fetch(participantId: string): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(API_BASE)) throw new Error('v2 只能連線問卷伺服器');
    const path = new URL(url).pathname;
    const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
    delete headers['X-User-UUID'];
    headers[PARTICIPANT_HEADER] = participantId;
    let body = init?.body;
    if (/\/(session|carry_over)$/.test(path) && typeof body === 'string') {
      body = JSON.stringify({ ...(JSON.parse(body) as Json), survey_version: SURVEY_VERSION });
    }
    const long = /\/(calibration|carry_over)$/.test(path);
    let res: Response;
    if (long) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), LONG_TIMEOUT_MS);
      try {
        res = await fetch(input, { ...init, headers, body, signal: ctl.signal });
      } finally {
        clearTimeout(timer);
      }
    } else {
      res = await fetch(input, { ...init, headers, body });
    }
    if (!res.ok || !long) return res;
    const shaped = toControllerShape((await res.json()) as Json);
    return new Response(JSON.stringify(shaped), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
