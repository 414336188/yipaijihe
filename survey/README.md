# 一拍即合 研究問卷（網頁版）

不需下載 App，以 email 進入後依序完成兩份問卷：

1. 濾鏡偏好（44 題）：20 題三選一校準＋24 題比較（四選一、重複題、注意力檢核）
2. 照片比較（36 組、48 題）：裂區因子實驗

題目、出題邏輯與資料表都與 App 相同，資料可合併分析。來源以同意版本 `web-v1`
（偏好問卷）與平台 `web`（照片比較）標記。

## 這個目錄的檔案是建置產物

原始碼在 `../survey-src/`。出題邏輯直接打包 App 專案的模組
（`../../competition/src/modules`），只能在兩個 repo 並排的機器上建置：

```
node survey-src/build.mjs --out survey   # 建置到這裡（發布用）
node survey-src/check.mjs                # 與 App 的題目文字、排版常數一致性檢查
node survey-src/e2e.mjs mobile full      # 瀏覽器端到端測試（會打正式伺服器，事後要清資料）
```

## 舊版

`LEGACY_README.md` 是 2026-10-18 以前的官網問卷（固定濾鏡版）的設計文件。
舊版的 M3 使用固定濾鏡，資料無法與 App 合併，已由本網頁版取代。
