# 人像影像成對比較問卷

「一拍即合」2×2×2 全因子實驗的線上問卷，完全依照企畫書第四至六節設計。
給接手的組員（與你們的 AI）：先讀 **0. 總覽** 與 **6. 交接項目**。

---

## 0. 總覽

- **目的**：驗證構圖引導（M1）、臉部畸變校正（M2）、個人化濾鏡（M3）三個模組的主效果、兩兩交互與三因子交互效果。
- **形式**：純前端靜態網頁，可直接放在 GitHub Pages。受訪者點網址 → 當場隨機分派題目 → 作答 36 組、96 題 → 送出。
- **已完成**：問卷流程、隨機分派、條件式提問、資料格式、可調參數的設定檔與設定檢查頁、照片雙盲工具。
- **尚未完成（交接給組員）**：官網按鈕連到問卷、作答寫入資料庫、照片正式託管。見第 6 節。

## 1. 檔案

| 檔案 | 用途 | 誰會改 |
|---|---|---|
| `config.js` | **唯一需要人工調整的檔案**：t（人像數）、k（預計受訪者數）、照片位置 | 研究人員 |
| `index.html` + `survey.js` | 問卷頁面與作答流程 | 一般不用改 |
| `core.js` | 實驗規則、隨機分派、資料格式（兩個頁面共用） | 不要改（見第 7 節） |
| `storage.js` | 作答送出的位置。**接資料庫只改這個檔案** | 組員 |
| `setup-check.html` | 設定檢查頁：顯示 t、k 及推算數字，檢查照片是否都載入得到 | 不用改 |
| `tools/prepare_photos.py` | 把原始照片轉成雙盲代號照片，並產生 `manifest.js` | 不用改 |
| `photos/`、`manifest.js` | 由上面的工具產生，**不進 git**（見 6.3） | 自動產生 |

## 2. 研究人員操作流程

1. **準備照片**：一個資料夾（可有子資料夾），每張人像 8 個版本，檔名規則：
   `001.jpg`（原圖 H0）、`001_C.jpg`、`001_D.jpg`、`001_F.jpg`、`001_CD.jpg`、`001_CF.jpg`、`001_DF.jpg`、`001_CDF.jpg`。
   只依檔名判斷，不看資料夾名稱；後綴字母順序不拘（`_DC` 等同 `_CD`）；支援 jpg / jpeg / png / webp。
2. **改 `config.js`**：`T_PORTRAITS` 設成人像數 t，`K_RESPONDENTS` 設成預計受訪者數 k。
3. **產生雙盲照片**：
   ```bash
   python tools/prepare_photos.py --src "照片資料夾路徑"
   ```
   工具會檢查資料夾裡剛好有 t 張完整人像（每張 8 個版本），不符就列出缺檔並中止、不動現有檔案。
   成功會產生 `photos/`（隨機 8 碼代號檔名）、`manifest.js`，以及解盲對照表 `master_mapping.csv`
   （預設存在照片來源資料夾裡，只留在研究人員電腦上）。
4. **開 `setup-check.html`**：確認「設定正確」，按「開始檢查」確認照片全部載入得到。
5. **開 `index.html`** 試做一次。本機可直接雙擊開啟，或在 `survey/` 下執行 `python -m http.server` 後開 `http://localhost:8000`。

改了 t 就要重跑第 3 步；只改 k 不用重跑，重新整理 `setup-check.html` 即可看到推算數字更新。

## 3. 實驗設計（固定規則）

### 3.1 八種配置（企畫書表 3-3）

| 配置 | M1 構圖 | M2 畸變 | M3 濾鏡 | 照片後綴 |
|---|:-:|:-:|:-:|---|
| H0 原始影像 | 0 | 0 | 0 | 無 |
| H1 | 1 | 0 | 0 | `_C` |
| H2 | 0 | 1 | 0 | `_D` |
| H3 | 0 | 0 | 1 | `_F` |
| H4 | 1 | 1 | 0 | `_CD` |
| H5 | 1 | 0 | 1 | `_CF` |
| H6 | 0 | 1 | 1 | `_DF` |
| H7 | 1 | 1 | 1 | `_CDF` |

照片總數 = t × 8。

### 3.2 每位受訪者的份量

- 從 t 張人像中隨機抽 **5 張**（不重複），每張做 7 組比較（H1–H7 各自對同一張人像的 H0）＝ **35 組**。
- 另加 **1 組注意力檢核** ＝ 共 **36 組**。
- 同一組的兩張照片必定是同一張人像，其中一張必定是 H0。

### 3.3 條件式提問（企畫書表 3-6）

「整體美感」每組必問；其餘維度只在對應模組啟用時提問。

| 比較組 | 整體美感 | 構圖（M1） | 臉部幾何（M2） | 色彩與膚色（M3） | 題數 |
|---|:-:|:-:|:-:|:-:|:-:|
| H1 對 H0 | ✓ | ✓ | | | 2 |
| H2 對 H0 | ✓ | | ✓ | | 2 |
| H3 對 H0 | ✓ | | | ✓ | 2 |
| H4 對 H0 | ✓ | ✓ | ✓ | | 3 |
| H5 對 H0 | ✓ | ✓ | | ✓ | 3 |
| H6 對 H0 | ✓ | | ✓ | ✓ | 3 |
| H7 對 H0 | ✓ | ✓ | ✓ | ✓ | 4 |
| 注意力檢核 | ✓ | | | | 1 |

每張人像 19 題 × 5 張 = **95 題**，加檢核 1 題 = **96 題**。這些數字由 `core.js` 依規則推算，不是寫死的。

### 3.4 量尺與提問方式（企畫書第五、六節）

受訪者判斷**右圖相對於左圖**的優劣，七點雙極量尺（ITU-T P.910 CCR）：

| −3 | −2 | −1 | 0 | +1 | +2 | +3 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 明顯較差 | 較差 | 略差 | 兩者相當 | 略佳 | 較佳 | 明顯較佳 |

受訪者看到的只有「左／右」，不會知道哪張是原始影像。

### 3.5 其他實驗控制

- **位置平衡**：每組獨立以 50% 機率決定 H0 在左或右，記錄於 `ref_side`。
- **注意力檢核**：同一張 H0 左右並列（兩邊同一個檔案），只問整體美感，期望作答 0；隨機插在第 13 至 24 組之間。
- **雙盲**：照片以隨機 8 碼檔名呈現，檔名不透露配置。限制：`manifest.js` 在前端，懂技術的人打開原始碼仍能看出對應；要做到更完整的雙盲需改成伺服器端分派（見 6.5）。
- **無練習題**：企畫書未規劃練習題，且每人固定 96 題。

## 4. 隨機分派

- 受訪者按「開始作答」時，產生一個 32-bit 隨機種子 `seed` 與一組匿名 `respondent_id`（UUID v4）。
- 抽哪 5 張人像、每組左右位置、題目順序、檢核題位置，全部由 `seed` 決定。同一個 `seed` + 同一份 `manifest.js` 一定得到同一份題目，因此可以續答，也可以事後稽核。
- 進度存在瀏覽器 localStorage：中途關閉，用同一個瀏覽器重開會回到原題號；已完成者重開會直接看到完成頁。
- 採**純隨機**分派，不依人數預先排好。因此 **k 不影響任何一位受訪者看到的題目**，只用來推算規劃數字（每張人像預期被評 k × 5 ÷ t 次）。實際次數會有自然波動（例如 k = 45、t = 9 時，每張人像約 25 ± 3 次）。
- 若 `manifest.js` 重新產生（照片代號全換），進行中的舊進度會作廢、重新開始。

## 5. 資料格式

### 5.1 送出的物件

受訪者完成 36 組後，`survey.js` 組成以下物件並呼叫 `storage.js` 的 `submitResponse(response)`：

```json
{
  "respondent_id": "1bb835c9-8a49-481b-9a19-82a83007b1ec",
  "seed": 1676399839,
  "survey_version": "2026-09-25",
  "manifest_version": "20260925-110600",
  "t": 9,
  "assigned_bases": ["002", "004", "005", "007", "009"],
  "started_at": "2026-09-25T03:09:23.065Z",
  "finished_at": "2026-09-25T03:25:10.412Z",
  "user_agent": "Mozilla/5.0 ...",
  "trials": [ { "trial_index": 1, "is_catch": 0, "base_image": "004", "config": "H2", "...": "..." } ]
}
```

`trials` 固定 36 筆，每筆一組比較，欄位見 5.2。

### 5.2 每組一列的欄位（CSV 與資料庫共用）

`core.js` 的 `CSV_COLUMNS` 定義順序；`responseToRows()` 把上面的物件攤平成每組一列（每列帶上受訪者層級的前四欄）。

| 欄位 | 說明 |
|---|---|
| `respondent_id` | 受訪者匿名編號（UUID v4） |
| `seed` | 隨機種子 |
| `survey_version` | 問卷規則版本（`core.js` 的 `SURVEY_VERSION`） |
| `manifest_version` | 照片清單版本（`manifest.js` 產生時間） |
| `trial_index` | 題組順序，1–36 |
| `is_catch` | 注意力檢核為 1，否則 0 |
| `base_image` | 人像編號（如 `004`） |
| `config` | `H1`–`H7`，檢核題為 `CATCH` |
| `M1` `M2` `M3` | 該配置啟用的模組（0／1），檢核題為空 |
| `ref_side` | H0 所在側，`left` 或 `right` |
| `left_file` `right_file` | 左右兩側的代號檔名 |
| `rt_ms` | 該組作答時間（毫秒） |
| `timestamp` | 該組完成時間（ISO 8601，UTC） |
| `raw_aesthetic` `delta_aesthetic` | 整體美感：原始作答與轉換後 Δ |
| `raw_composition` `delta_composition` | 構圖（僅 M1 啟用時） |
| `raw_geometry` `delta_geometry` | 臉部幾何（僅 M2 啟用時） |
| `raw_color` `delta_color` | 色彩與膚色（僅 M3 啟用時） |

### 5.3 Δ 轉換（分析用的主要數值）

`raw` 是「右圖相對於左圖」；`delta` 轉成「處理後影像相對於原始影像」，正值代表處理後較佳：

```
delta = raw     當 ref_side = "left"（H0 在左，處理後在右）
delta = -raw    當 ref_side = "right"（H0 在右，處理後在左）
```

### 5.4 空值規則

- 沒問到的維度：`raw` 與 `delta` 都是空字串（資料庫存 NULL）。
- 注意力檢核：保留 `raw_aesthetic`，所有 `delta` 為空，`M1`–`M3` 為空。

## 6. 交接項目（給組員）

### 6.1 官網連到問卷

問卷在 repo 的 `survey/` 資料夾，部署後網址為 `https://414336188.github.io/yipaijihe/survey/`。
在官網 `index.html` 加一顆連到 `survey/` 的按鈕即可。上線前需先完成 6.3（照片與 `manifest.js` 要能被存取到），
否則問卷頁會顯示「問卷尚未設定完成」。

### 6.2 資料庫

**只需改寫 `storage.js` 的 `submitResponse(response)`**，問卷其他部分不用動。約定：

- 輸入：5.1 的物件。
- 回傳：`Promise<{ ok, message }>`；`message` 會顯示在完成頁。丟出例外時，完成頁會顯示失敗並提供「重新送出」。
- 受訪者按「重新送出」會以同一份資料再呼叫一次，**請以 `respondent_id` 做 upsert**，避免重複寫入。

範例（前端改呼叫後端 API）：

```js
async function submitResponse(response) {
  const res = await fetch("https://<後端網址>/api/survey/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(response),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { ok: true, message: "已送出，謝謝參與。" };
}
```

後端建議（配合專案現有的 MySQL／MariaDB + SQLAlchemy 慣例）：

```sql
CREATE TABLE survey_respondents (
  respondent_id    VARCHAR(36)  PRIMARY KEY,
  seed             INT UNSIGNED NOT NULL,
  survey_version   VARCHAR(16)  NOT NULL,
  manifest_version VARCHAR(32)  NOT NULL,
  t                INT          NOT NULL,
  assigned_bases   JSON         NOT NULL,
  started_at       DATETIME(3)  NOT NULL,
  finished_at      DATETIME(3)  NOT NULL,
  user_agent       VARCHAR(512),
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE survey_trials (
  respondent_id     VARCHAR(36) NOT NULL,
  trial_index       TINYINT     NOT NULL,
  is_catch          TINYINT(1)  NOT NULL,
  base_image        VARCHAR(8)  NOT NULL,
  config            VARCHAR(8)  NOT NULL,
  M1 TINYINT NULL, M2 TINYINT NULL, M3 TINYINT NULL,
  ref_side          VARCHAR(5)  NOT NULL,
  left_file         VARCHAR(32) NOT NULL,
  right_file        VARCHAR(32) NOT NULL,
  rt_ms             INT         NOT NULL,
  `timestamp`       DATETIME(3) NOT NULL,
  raw_aesthetic     TINYINT     NOT NULL,
  delta_aesthetic   TINYINT     NULL,
  raw_composition   TINYINT NULL, delta_composition TINYINT NULL,
  raw_geometry      TINYINT NULL, delta_geometry    TINYINT NULL,
  raw_color         TINYINT NULL, delta_color       TINYINT NULL,
  PRIMARY KEY (respondent_id, trial_index),
  FOREIGN KEY (respondent_id) REFERENCES survey_respondents (respondent_id)
);
```

欄位名稱請與 5.2 保持一致（分析腳本依賴這些名稱）。若偏好沿用 `user_questionnaires.response_log` 的做法，
也可以把整份 `trials` 存成一個 JSON 欄位，分析時再攤平。

後端寫入前建議驗證：`trials` 恰為 36 筆（35 筆 H1–H7 各 5 次 ＋ 1 筆 CATCH）、所有 `raw_*` 為 −3 到 +3 的整數或空值、
ISO 時間字串轉成 DATETIME。受訪者匿名作答、不需登入，端點需要開 CORS（來源為 GitHub Pages 網域），並建議做基本的頻率限制。

### 6.3 照片託管與隱私（上線前必須決定）

- 照片是真人臉孔。`photos/`、`manifest.js`、`master_mapping.csv` 都已列在 `.gitignore`，**沒有放進這個 public repo**。
- 問卷一旦公開上線，受訪者的瀏覽器必須下載照片，也就是**照片會對任何拿到網址的人公開**。上線前請確認受試者（被拍攝者）同意這種使用方式。
- 託管方式二選一：
  - 放在 GitHub Pages：把 `photos/` 與 `manifest.js` 從 `.gitignore` 移除後一起提交（照片會永久留在 git 歷史裡）。
  - 放在其他空間（自家伺服器、雲端儲存）：把 `config.js` 的 `PHOTO_BASE` 改成該位置的網址，只提交 `manifest.js`。
- `manifest.js` 本身不含個資（只有代號檔名與配置代碼），但必須跟同一次產生的照片一起部署，兩者代號才對得上。
- 檔案大小：目前每張約 1.4 MB，每位受訪者要載入 40 張（5 張人像 × 8 版本）約 50 MB。若要壓縮，請對全部照片用同一套參數，
  並注意 JPEG 重新壓縮可能影響色彩細節（色彩是受測維度之一）。

### 6.4 上線前檢查

1. `setup-check.html` 顯示「設定正確」，照片載入檢查全部成功。
2. 在正式網址完整作答一次，確認資料庫收到 1 筆受訪者與 36 筆題組，Δ 符號正確。
3. 同一瀏覽器中途關閉再開，確認回到原題號；完成後再開，確認顯示完成頁。
4. 評估是否移除完成頁的「清除紀錄重做」按鈕（保留便於測試，但正式收案時會讓同一人可重複作答）。

### 6.5 可選的後續升級

- **平衡分派**：接上資料庫後，可改成「從目前被評次數最少的人像中抽 5 張」，讓各人像次數更平均。改 `core.js` 的 `buildAssignment` 抽樣那一步即可，其餘不變。
- **伺服器端分派**：由後端產生題目、前端只拿到不透明的題目編號與照片網址，可避免從前端原始碼看出配置，達成更完整的雙盲。
- **手機版面**：目前為電腦橫向版面（1280×720 以上四題全開無捲軸）。手機上兩張照片會很小，若預期大量手機作答需另行設計。

## 7. 不要改的東西

- `core.js` 的 `MODULES`、`QUESTIONS`、`PORTRAITS_PER_RESPONDENT`：直接對應企畫書的實驗設計。
- `toDelta()` 的符號轉換。
- `CSV_COLUMNS` 的欄位名稱與順序：分析腳本依賴。
- 照片區的中性灰背景（`--stage: #808080`）與評分選取的白底黑字：色彩與膚色是受測維度之一，照片周圍與介面上的彩色會影響受訪者的色彩判斷（ITU-T P.910 觀看環境要求）。其餘版面可自由美編。
- 規則有任何修改時，請更新 `core.js` 的 `SURVEY_VERSION`，讓資料能區分不同版本。

## 8. 分析銜接（參考）

- **主要應變數**：`delta_aesthetic`，排除 `is_catch = 1`。
- **主模型**（企畫書第六節，交叉隨機效應、無截距）：
  `delta_aesthetic ~ 0 + M1 * M2 * M3 + (1 | respondent_id) + (1 | base_image)`
  核心假說 β123 > 0（單尾，α = 0.05），並報告三個主效果與三個兩兩交互。
- **操弄檢核**：`delta_composition` 取 M1 = 1 的配置、`delta_geometry` 取 M2 = 1、`delta_color` 取 M3 = 1，各自檢定截距 > 0（單尾），Holm–Bonferroni 校正。
- **注意力檢核**：建議 `raw_aesthetic` 偏離 0 超過 ±1 的受訪者標記為品質可疑（門檻可依前導研究調整）。
- **前導研究**：檢查各維度選 0 的比例，過高代表該模組效果在現行呈現方式下難以察覺。

## 9. 已驗證

- 以 20,000 位模擬受訪者測試分派邏輯：每人 5 張不同人像、36 組、96 題；H1–H7 各 5 次；每組兩張為同一人像且其一為 H0；檢核題落在第 13–24 組；H0 左右比例 49.95%；各人像被抽中次數均勻；同 seed 可完全重現。
- 瀏覽器實測（t = 9 的真實照片）：1280×720 下四題全開無捲軸；鍵盤 1–7 與 Enter；Δ 轉換與空值規則；CSV 欄位；中途重開續答；完成後重開顯示完成頁；預設 `storage.js` 會下載 CSV。
- 設定錯誤處理：t 與照片數不符時，`prepare_photos.py` 中止且不動現有檔案，問卷頁與設定檢查頁皆顯示錯誤原因。
