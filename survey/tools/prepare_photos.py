# -*- coding: utf-8 -*-
"""把研究人員的照片資料夾轉成問卷用的雙盲代號照片與 manifest.js。用法見 README.md。"""

import argparse
import csv
import json
import re
import secrets
import shutil
import sys
from datetime import datetime
from pathlib import Path

SURVEY_DIR = Path(__file__).resolve().parent.parent
CODES = ["H0", "H1", "H2", "H3", "H4", "H5", "H6", "H7"]
SUFFIX_TO_CODE = {"": "H0", "C": "H1", "D": "H2", "F": "H3",
                  "CD": "H4", "CF": "H5", "DF": "H6", "CDF": "H7"}
CODE_LABEL = {"H0": "原始影像", "H1": "構圖引導", "H2": "畸變校正", "H3": "個人化濾鏡",
              "H4": "構圖＋畸變", "H5": "構圖＋濾鏡", "H6": "畸變＋濾鏡", "H7": "構圖＋畸變＋濾鏡"}
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp"}
STEM_RE = re.compile(r"^(\d{3})(?:_([CDF]{1,3}))?$", re.IGNORECASE)


def read_t():
    text = (SURVEY_DIR / "config.js").read_text(encoding="utf-8")
    m = re.search(r"T_PORTRAITS\s*:\s*(\d+)", text)
    if not m:
        sys.exit("config.js 裡找不到 T_PORTRAITS 設定。")
    return int(m.group(1))


def scan(src):
    """只依檔名判定（001.jpg、001_CDF.jpg…），不依資料夾名稱；後綴字母順序不拘。"""
    found, skipped = {}, []
    for path in sorted(src.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMG_EXT:
            continue
        m = STEM_RE.match(path.stem.strip())
        code = None
        if m:
            suffix = "".join(sorted((m.group(2) or "").upper(), key="CDF".index))
            code = SUFFIX_TO_CODE.get(suffix)
        if code is None:
            skipped.append(path.name)
            continue
        key = (m.group(1), code)
        if key in found:
            print(f"  [警告] 重複：{path}，保留先讀到的 {found[key]}")
            continue
        found[key] = path
    return found, skipped


def main():
    parser = argparse.ArgumentParser(description="產生雙盲代號照片與 manifest.js")
    parser.add_argument("--src", required=True, help="原始照片資料夾（會遞迴掃描子資料夾）")
    parser.add_argument("--mapping", help="解盲對照表輸出路徑，預設為 <src>/master_mapping.csv")
    args = parser.parse_args()

    src = Path(args.src)
    if not src.is_dir():
        sys.exit(f"找不到照片資料夾：{src}")
    t = read_t()
    print(f"config.js：t = {t}，需要 {t} 張人像 × 8 個版本 = {t * 8} 張照片")

    found, skipped = scan(src)
    if skipped:
        print(f"  略過 {len(skipped)} 個無法辨識檔名的圖檔，例如：{'、'.join(skipped[:5])}")

    bases = sorted({b for b, _ in found})
    incomplete = {b: [c for c in CODES if (b, c) not in found] for b in bases}
    incomplete = {b: miss for b, miss in incomplete.items() if miss}
    if incomplete:
        print("[中止] 以下人像的版本不齊，缺檔會破壞全因子設計的平衡：")
        for b, miss in incomplete.items():
            print(f"  {b} 缺 {'、'.join(miss)}")
        sys.exit(1)
    if len(bases) != t:
        sys.exit(f"[中止] config.js 設定 t = {t}，但照片資料夾有 {len(bases)} 張完整人像"
                 f"（{'、'.join(bases)}）。請修改 T_PORTRAITS 或照片資料夾後重跑。")

    photos_dir = SURVEY_DIR / "photos"
    photos_dir.mkdir(exist_ok=True)
    for old in photos_dir.glob("*"):
        try:
            old.unlink()
        except OSError as e:
            print(f"  [警告] 無法刪除舊檔 {old.name}：{e}")

    images = {b: {} for b in bases}
    rows, used = [], set()
    for (b, code), path in sorted(found.items()):
        name = secrets.token_hex(4)
        while name in used:
            name = secrets.token_hex(4)
        used.add(name)
        name += path.suffix.lower()
        shutil.copy2(path, photos_dir / name)
        images[b][code] = name
        rows.append([b, code, CODE_LABEL[code], name, str(path)])

    version = datetime.now().strftime("%Y%m%d-%H%M%S")
    manifest = {"version": version, "t": t, "images": images}
    (SURVEY_DIR / "manifest.js").write_text(
        "// 由 tools/prepare_photos.py 產生，請勿手動修改。\n"
        f"window.SURVEY_MANIFEST = {json.dumps(manifest, ensure_ascii=False, indent=2)};\n",
        encoding="utf-8")

    mapping = Path(args.mapping) if args.mapping else src / "master_mapping.csv"
    with open(mapping, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["base_id", "config", "config_label", "blind_filename", "original_path"])
        w.writerows(rows)

    print(f"完成（manifest 版本 {version}）")
    print(f"  {len(rows)} 張代號照片 → {photos_dir}")
    print(f"  照片清單 → {SURVEY_DIR / 'manifest.js'}")
    print(f"  解盲對照表 → {mapping}（僅研究人員保留，勿上傳）")


if __name__ == "__main__":
    main()
