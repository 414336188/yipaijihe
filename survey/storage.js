// 作答資料的寫入點。接資料庫時只需改寫 submitResponse()，問卷其他部分不用動。
//
// 輸入：response 物件（格式見 README.md「資料格式」），一位受訪者完成全部 36 組後呼叫一次。
// 輸出：Promise<{ ok: boolean, message: string }>，message 會顯示在完成頁上。
// 受訪者在完成頁按「重新送出」會以同一份 response 再呼叫一次，
// 因此資料庫端請以 respondent_id 做 upsert，避免重複寫入。
//
// 目前（尚未接資料庫）：在受訪者電腦下載一份 CSV，由受訪者交回研究人員。
async function submitResponse(response) {
  const csv = rowsToCsv(responseToRows(response));
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `response_${response.respondent_id.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true, message: "已下載作答結果檔，請將檔案交回研究人員。" };
}
