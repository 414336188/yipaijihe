# -*- coding: utf-8 -*-
"""
build_survey.py
---------------
掃描照片資料夾，產生 2x2x2 全因子消融實驗之成對比較問卷。

輸出：
  survey/photos/            雙盲代號照片（72 張，所有評分者共用）
  survey/rater_01.html ...  每位評分者一個獨立檔案（離線可開）
  survey/master_mapping.csv 代號與真實檔案對照表（研究者保留，勿外流）
  survey/使用說明.txt

使用方式：
  1. 修改下方 ROOT_DIR 為照片資料夾路徑
  2. 修改 N_RATERS 為實際評分者人數
  3. python build_survey.py
"""

import os
import re
import csv
import json
import random
import shutil
import secrets
from pathlib import Path

# ============ 參數設定 ============

ROOT_DIR = r"C:\Users\user\Desktop\photo"   # 照片資料夾
OUT_DIR = r"C:\Users\user\Desktop\survey"    # 輸出資料夾
N_RATERS = 45          # 評分者人數（規劃 40-50）
N_BASE_PER_RATER = 5   # 每人評 5 張基礎照片
MASTER_SEED = 20260924 # 隨機種子，固定以利重現

# ==================================

CONFIGS = ["", "C", "D", "F", "CD", "CF", "DF", "CDF"]
CONFIG_TO_H = {"": "H0", "C": "H1", "D": "H2", "F": "H3",
               "CD": "H4", "CF": "H5", "DF": "H6", "CDF": "H7"}
CONFIG_LABEL = {
    "H0": "原始影像", "H1": "構圖引導", "H2": "畸變校正", "H3": "個人化濾鏡",
    "H4": "構圖＋畸變", "H5": "構圖＋濾鏡", "H6": "畸變＋濾鏡",
    "H7": "構圖＋畸變＋濾鏡",
}
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
STEM_RE = re.compile(r"^(\d{3})(?:_([CDF]{1,3}))?$", re.IGNORECASE)


def scan_photos(root):
    """走訪所有子資料夾，依檔名後綴判定配置，不依賴資料夾命名。"""
    found = {}
    for path in Path(root).rglob("*"):
        if not path.is_file() or path.suffix.lower() not in IMG_EXT:
            continue
        m = STEM_RE.match(path.stem.strip())
        if not m:
            continue
        base_id = m.group(1)
        suffix = (m.group(2) or "").upper()
        cfg = "".join(sorted(suffix, key="CDF".index)) if suffix else ""
        if cfg not in CONFIGS:
            print(f"  [略過] 無法辨識的後綴：{path.name}")
            continue
        key = (base_id, cfg)
        if key in found:
            print(f"  [警告] 重複檔案：{path.name}，保留先讀到的 {found[key].name}")
            continue
        found[key] = path
    return found


def verify(found):
    """檢查 9 張基礎照片 x 8 種配置是否齊全。"""
    base_ids = sorted({b for b, _ in found})
    missing = []
    for b in base_ids:
        for cfg in CONFIGS:
            if (b, cfg) not in found:
                missing.append(f"{b}_{cfg or '原圖'}")
    return base_ids, missing


def build_blind_photos(found, out_photos):
    """複製為隨機代號檔名，回傳 (base_id, cfg) -> 代號檔名。"""
    out_photos.mkdir(parents=True, exist_ok=True)
    mapping, used = {}, set()
    for key in sorted(found):
        while True:
            code = secrets.token_hex(4)
            if code not in used:
                used.add(code)
                break
        src = found[key]
        dst_name = code + src.suffix.lower()
        shutil.copy2(src, out_photos / dst_name)
        mapping[key] = dst_name
    return mapping


def assign_bases(base_ids, n_raters, k, rng):
    """每位評分者取目前被評次數最少的 k 張（同分隨機排序），
    確保單一評分者內不重複，且各照片累計次數盡量平均。"""
    counts = {b: 0 for b in base_ids}
    out = []
    for i in range(n_raters):
        candidates = base_ids[:]
        rng.shuffle(candidates)
        candidates.sort(key=lambda b: counts[b])
        picked = candidates[:k]
        for b in picked:
            counts[b] += 1
        rng.shuffle(picked)
        out.append(picked)
    return out


def make_trials(bases, base_ids, mapping, rng):
    """產生某位評分者的全部題組。"""
    trials = []
    for b in bases:
        for cfg in CONFIGS[1:]:            # H1..H7
            ref_left = rng.random() < 0.5  # 原始影像是否置左
            trials.append({
                "base": b,
                "config": CONFIG_TO_H[cfg],
                "left": mapping[(b, "")] if ref_left else mapping[(b, cfg)],
                "right": mapping[(b, cfg)] if ref_left else mapping[(b, "")],
                "ref_side": "left" if ref_left else "right",
                "ask": {"C": "C" in cfg, "D": "D" in cfg, "F": "F" in cfg},
                "catch": False,
            })
    rng.shuffle(trials)

    # 注意力檢核：同一張原圖對自己，插在中段
    catch_base = rng.choice(bases)
    catch = {
        "base": catch_base, "config": "CATCH",
        "left": mapping[(catch_base, "")], "right": mapping[(catch_base, "")],
        "ref_side": "left",
        "ask": {"C": False, "D": False, "F": False},
        "catch": True,
    }
    trials.insert(rng.randint(len(trials) // 3, 2 * len(trials) // 3), catch)

    # 練習題：取未指派給該評分者的基礎照片
    spare = [b for b in base_ids if b not in bases] or base_ids
    pb = rng.choice(spare)
    practice = []
    for cfg in ("F", "CDF"):
        ref_left = rng.random() < 0.5
        practice.append({
            "base": pb, "config": CONFIG_TO_H[cfg],
            "left": mapping[(pb, "")] if ref_left else mapping[(pb, cfg)],
            "right": mapping[(pb, cfg)] if ref_left else mapping[(pb, "")],
            "ref_side": "left" if ref_left else "right",
            "ask": {"C": "C" in cfg, "D": "D" in cfg, "F": "F" in cfg},
            "catch": False,
        })
    return practice, trials


def main():
    rng = random.Random(MASTER_SEED)
    root, out = Path(ROOT_DIR), Path(OUT_DIR)

    if not root.exists():
        raise SystemExit(f"找不到照片資料夾：{root}\n請修改 ROOT_DIR 後重新執行。")

    print(f"掃描 {root} ...")
    found = scan_photos(root)
    base_ids, missing = verify(found)
    print(f"  基礎照片 {len(base_ids)} 張，影像檔 {len(found)} 個")
    if missing:
        print(f"  [中止] 缺少 {len(missing)} 個檔案：")
        for m in missing[:20]:
            print(f"    {m}")
        raise SystemExit("請補齊後重新執行。")
    if len(base_ids) < N_BASE_PER_RATER:
        raise SystemExit(f"基礎照片僅 {len(base_ids)} 張，少於每人需評的 {N_BASE_PER_RATER} 張。")

    out.mkdir(parents=True, exist_ok=True)
    photos_dir = out / "photos"
    if photos_dir.exists():
        for stale in photos_dir.glob("*"):
            try:
                stale.unlink()
            except OSError as e:
                print(f"  [警告] 無法刪除舊檔 {stale.name}（可能被其他程式佔用）：{e}")
    for stale in out.glob("rater_*.html"):
        try:
            stale.unlink()
        except OSError as e:
            print(f"  [警告] 無法刪除舊檔 {stale.name}：{e}")
    print("複製並改為雙盲代號 ...")
    mapping = build_blind_photos(found, photos_dir)

    with open(out / "master_mapping.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["base_id", "config", "config_code", "config_label",
                    "blind_filename", "original_path"])
        for (b, cfg), name in sorted(mapping.items()):
            h = CONFIG_TO_H[cfg]
            w.writerow([b, cfg or "ORIG", h, CONFIG_LABEL[h], name, str(found[(b, cfg)])])

    template = (Path(__file__).parent / "survey_template.html").read_text(encoding="utf-8")
    assignments = assign_bases(base_ids, N_RATERS, N_BASE_PER_RATER, rng)

    print(f"產生 {N_RATERS} 份問卷 ...")
    log = []
    for i, bases in enumerate(assignments, start=1):
        rid = f"{i:02d}"
        practice, trials = make_trials(bases, base_ids, mapping, random.Random(MASTER_SEED + i))
        payload = {"rater_id": rid, "practice": practice, "trials": trials}
        html = template.replace("/*__DATA__*/", json.dumps(payload, ensure_ascii=False))
        html = html.replace("__RATER_ID__", rid)
        (out / f"rater_{rid}.html").write_text(html, encoding="utf-8")
        log.append([rid, " ".join(bases), len(trials)])

    with open(out / "rater_assignment.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["rater_id", "base_images", "n_trials"])
        w.writerows(log)

    counts = {b: 0 for b in base_ids}
    for _, bs, _ in log:
        for b in bs.split():
            counts[b] += 1
    print("  每張基礎照片被評次數：" +
          "  ".join(f"{b}:{c}" for b, c in sorted(counts.items())))

    (out / "使用說明.txt").write_text(f"""施測說明

1. 整個 survey 資料夾複製到施測用電腦，勿更動內部結構。
   photos 資料夾與 rater_XX.html 必須放在一起。

2. 每位評分者開啟專屬的 rater_XX.html（用 Chrome 或 Edge，直接雙擊）。
   一位評分者只能用一個編號，不可共用。

3. 作答中途可關閉，下次開啟同一檔案會回到原進度。

4. 作答完成後按「下載作答結果」，會存出 responses_raterXX.csv，
   請收齊所有評分者的檔案後交給研究者。

5. master_mapping.csv 是解盲對照表，僅研究者保留，切勿放入施測電腦。

每人題數：練習 2 題（不計分）＋ 正式 {log[0][2] if log else 36} 題組
預估作答時間：20 至 25 分鐘
""", encoding="utf-8")

    print(f"\n完成，輸出於 {out}")
    print("  photos/               雙盲照片")
    print(f"  rater_01.html ... rater_{N_RATERS:02d}.html")
    print("  master_mapping.csv    解盲對照表（勿外流）")
    print("  rater_assignment.csv  指派紀錄")


if __name__ == "__main__":
    main()
