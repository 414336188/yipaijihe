// 作答資料的寫入點。接資料庫時只需改寫 submitResponse()，問卷其他部分不用動。
//
// 輸入：response 物件（格式見 README.md「資料格式」），一位受訪者完成全部 36 組後呼叫一次。
// 輸出：Promise<{ ok: boolean, message: string }>，message 會顯示在完成頁上。
// 受訪者在完成頁按「重新送出」會以同一份 response 再呼叫一次，
// 後端以 respondent_id 做 upsert，重複送出不會產生重複資料。

// 後端端點（一拍即合的 API 伺服器，資料寫入 Supabase 的 survey_respondents / survey_trials）。
const SUBMIT_URL = "https://155-68.im.fju.edu.tw/api/survey/responses";

// ⚠ 逾時是必要的：fetch 預設沒有逾時，行動網路斷線時這個 Promise 會一直掛著，
//   完成頁就永遠停在「送出中…」，受訪者看不到「重新送出」按鈕。
const TIMEOUT_MS = 20000;

async function submitResponse(response) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(SUBMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
      signal: ctrl.signal,
    });
  } catch (err) {
    // 連線失敗或逾時。丟出例外讓完成頁顯示失敗並提供「重新送出」；
    // 作答內容仍在 localStorage，重送用的是同一份資料，不會遺失。
    throw new Error(err.name === "AbortError" ? "連線逾時，請確認網路後重新送出。" : "無法連線到伺服器，請確認網路後重新送出。");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // FastAPI 的錯誤訊息放在 detail，取出來顯示，受訪者才知道是網路問題還是資料有誤。
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === "string") detail = body.detail;
    } catch (_) { /* 回應不是 JSON 就沿用狀態碼 */ }
    throw new Error(detail);
  }

  return { ok: true, message: "已送出，謝謝參與。" };
}
