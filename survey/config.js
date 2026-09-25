/*
 * 問卷參數設定：研究人員只需要改這個檔案。改完重新整理網頁即生效。
 *
 * 可調整
 *   T_PORTRAITS    t，拍攝的人像數量（基礎影像張數）。
 *                  改了 t 之後要重跑 tools/prepare_photos.py，讓照片清單跟著更新。
 *   K_RESPONDENTS  k，預計受訪者人數。只用於 setup-check.html 的規劃推算，
 *                  不影響受訪者看到的題目（每位受訪者的題目都是當場隨機分派）。
 *   PHOTO_BASE     照片所在位置，相對路徑或完整網址（照片改放雲端空間時改這裡）。
 *
 * 固定（依企畫書第四至六節，不在這裡調整）
 *   每張人像 8 種版本（H0–H7）          → 照片總數 = t × 8
 *   每位受訪者 5 張人像 × 7 組比較 = 35 組、95 題，另加 1 題注意力檢核 → 共 96 題
 */
window.SURVEY_CONFIG = {
  T_PORTRAITS: 9,
  K_RESPONDENTS: 45,
  PHOTO_BASE: "photos/",
};
