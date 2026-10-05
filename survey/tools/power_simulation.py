"""2×2×2 裂區消融實驗的檢定力模擬。

用途：決定「拍攝組數 t」、「每位評分者評分的人像數 P」與「評分者人數 k」。
前導研究結束後，把實測的三個變異數填進 PARAMS 重跑即可。

執行：
    python power_simulation.py

方法
----
以虛無分布（β123 = 0）的分位數定出臨界值，再於對立假設下計算超過臨界值的比例。
⚠ 這樣 Type I 錯誤率由構造保證等於 α，不依賴任何標準誤估計式，
  得到的是「理想分析」能達到的檢定力上限；實際混合模型的檢定力不會更高。

資料產生模型（企畫書第三節的裂區結構）
    delta[r,s,c] = Σ β·x_c + u_r + v_s + m1_c·w_s + ε
      u_r  評分者隨機截距          σ_rater
      v_s  拍攝組隨機截距          σ_subject
      w_s  整區（兩次快門）誤差     σ_shot    僅作用於 M1=1 的配置
      ε    逐題誤差                σ_resid

編碼
----
0/1 編碼、無截距，七個比較配置對應七個參數。三階交互的對比權重為
    H1 +1, H2 +1, H3 +1, H4 −1, H5 −1, H6 −1, H7 +1
β1 則僅由 H1 一格估計。

⚠ 由此可得一項結構性結論（verify_cancellation 會以模擬驗證）：
  M1=1 的四格權重和為 1−1−1+1 = 0，故整區誤差 σ_shot 在 β123 中相消。
  整區變異衝擊的是 β1，不是 β123。
⚠ 但拍攝組變異不相消，且其貢獻為 σ²_subject / t ——
  那是增加評分者無法降低的地板，故 t 是比 k 更有效的槓桿。
"""
from __future__ import annotations

import numpy as np
from statistics import NormalDist

NORM = NormalDist()

# ---------------------------------------------------------------------------
# 參數
# ---------------------------------------------------------------------------
PARAMS = {
    # 來源：企畫書「樣本規模與統計檢定力」節明確給出
    "s_rater": 0.8,
    # ⚠ 以下三項企畫書未提供，為本模擬之假設，前導研究後須替換為實測值
    "s_subject": 0.5,   # 拍攝組之間的差異
    "s_shot": 0.6,      # 同一被攝者兩次快門之間的差異（對 β123 無影響）
    "s_resid": 1.0,     # 逐題誤差（量尺為 −3..+3）
    # ⚠ 真實三階交互之假設值。由企畫書「50 人 power 0.90」反推而得（見 reverse_engineer）
    "beta123": 0.6,
}

# 七個比較配置的 (M1, M2, M3)
CONFIG = np.array([
    [1, 0, 0],  # H1
    [0, 1, 0],  # H2
    [0, 0, 1],  # H3
    [1, 1, 0],  # H4
    [1, 0, 1],  # H5
    [0, 1, 1],  # H6
    [1, 1, 1],  # H7
], dtype=float)
M1_ON = CONFIG[:, 0]
W_BETA123 = np.array([1, 1, 1, -1, -1, -1, 1], dtype=float)
W_BETA1 = np.array([1, 0, 0, 0, 0, 0, 0], dtype=float)


# ---------------------------------------------------------------------------
# 核心
# ---------------------------------------------------------------------------
def sample_contrast(k, P, t, beta123, s_rater, s_subject, s_shot, s_resid,
                    weights, reps, rng):
    """回傳 reps 次重複的對比估計值（每次為所有 (評分者, 拍攝組) 配對的對比平均）。"""
    out = np.empty(reps)
    fixed = beta123 * (CONFIG[:, 0] * CONFIG[:, 1] * CONFIG[:, 2])
    for i in range(reps):
        subj = np.empty((k, P), dtype=int)
        for r in range(k):
            subj[r] = rng.choice(t, size=P, replace=False)
        u = rng.normal(0, s_rater, size=k)[:, None]
        v = rng.normal(0, s_subject, size=t)[subj]
        w = rng.normal(0, s_shot, size=t)[subj]
        eps = rng.normal(0, s_resid, size=(k, P, 7))
        y = (fixed[None, None, :] + u[:, :, None] + v[:, :, None]
             + w[:, :, None] * M1_ON[None, None, :] + eps)
        out[i] = (y * weights[None, None, :]).sum(axis=2).mean()
    return out


def power(k, P, t, two_sided=True, alpha=0.05, weights=W_BETA123,
          reps=3000, seed=0, **over):
    """以虛無分布定臨界值，回傳檢定力。"""
    p = {**PARAMS, **over}
    rng = np.random.default_rng(seed)
    null = sample_contrast(k, P, t, 0.0, p["s_rater"], p["s_subject"],
                           p["s_shot"], p["s_resid"], weights, reps, rng)
    alt = sample_contrast(k, P, t, p["beta123"], p["s_rater"], p["s_subject"],
                          p["s_shot"], p["s_resid"], weights, reps, rng)
    if two_sided:
        lo, hi = np.quantile(null, [alpha / 2, 1 - alpha / 2])
        return float(((alt < lo) | (alt > hi)).mean())
    return float((alt > np.quantile(null, 1 - alpha)).mean())


def required_k(P, t, target=0.90, two_sided=True, lo=40, hi=320, seed=0, **over):
    """二分搜尋達到目標檢定力所需的評分者人數（10 人為級距）。"""
    lo, hi = lo // 10, hi // 10
    while lo < hi:
        mid = (lo + hi) // 2
        if power(mid * 10, P, t, two_sided, reps=2500, seed=seed, **over) >= target:
            hi = mid
        else:
            lo = mid + 1
    return lo * 10


# ---------------------------------------------------------------------------
# 報表
# ---------------------------------------------------------------------------
def verify_cancellation():
    print("【驗證一】整區誤差 σ_shot 在 β123 中相消，但 β1 完整承受")
    base = dict(k=50, P=5, t=24, beta123=0.0, s_rater=PARAMS["s_rater"],
                s_subject=PARAMS["s_subject"], s_resid=PARAMS["s_resid"])
    for name, wts in (("β123", W_BETA123), ("β1  ", W_BETA1)):
        sds = []
        for shot in (0.0, 0.6, 1.2):
            d = sample_contrast(weights=wts, reps=1500,
                                rng=np.random.default_rng(1), s_shot=shot, **base)
            sds.append(d.std())
        print(f"   {name} 的估計值 SD：σ_shot=0.0 → {sds[0]:.4f}   "
              f"0.6 → {sds[1]:.4f}   1.2 → {sds[2]:.4f}")
    print()


def reverse_engineer():
    print("【驗證二】反推企畫書「σ_rater=0.8、50 人、P=5 → power 0.90」隱含的真實 β123")
    print("   （該模擬未納入 σ_subject 與 σ_shot，故此處亦設為 0 以求可比）")
    for s_resid in (0.8, 1.0, 1.2):
        se = sample_contrast(k=50, P=5, t=24, beta123=0.0,
                             s_rater=0.8, s_subject=0.0, s_shot=0.0,
                             s_resid=s_resid, weights=W_BETA123, reps=2500,
                             rng=np.random.default_rng(7)).std()
        d1 = (NORM.inv_cdf(0.95) + NORM.inv_cdf(0.90)) * se
        d2 = (NORM.inv_cdf(0.975) + NORM.inv_cdf(0.90)) * se
        print(f"   σ_resid={s_resid}  SE={se:.4f}  →  單尾隱含 β123={d1:.3f}   雙尾={d2:.3f}")
    print()


def lever_comparison():
    print("【結果一】固定 k=100，比較「增加拍攝組」與「增加每人人像數」（雙尾 α=.05）")
    print(f"   {'設定':<26}{'人像評分格':>10}{'雙尾檢定力':>12}")
    for t, P in ((24, 3), (36, 3), (48, 3), (24, 5), (48, 5)):
        pw = power(100, P, t, True, reps=2500, seed=500 + t * 10 + P)
        print(f"   t={t:<3}組、每人 {P} 張{'':<10}{100*P:>10}{pw:>12.3f}")
    print()


def sample_size_table():
    print("【結果二】達成目標檢定力所需之評分者人數（雙尾 α=.05）")
    print(f"   {'拍攝組 t':<10}{'每人張數':<10}{'power .80':>11}{'power .90':>11}")
    for t in (24, 36, 48):
        for P in (3, 5):
            k80 = required_k(P, t, 0.80, True, seed=11)
            k90 = required_k(P, t, 0.90, True, seed=11)
            print(f"   {t:<10}{P:<10}{k80:>11}{k90:>11}")
    print()


def sensitivity():
    print("【結果三】對兩項假設值的敏感度（t=36、每人 3 張、雙尾、power 目標 .90）")
    print(f"   {'β123':<8}{'σ_subject':<12}{'所需人數':>10}")
    for beta in (0.6, 0.5, 0.4):
        for ssub in (0.3, 0.5, 0.8):
            k = required_k(3, 36, 0.90, True, seed=21, beta123=beta, s_subject=ssub)
            tag = "" if k < 320 else "（超過搜尋上限 320）"
            print(f"   {beta:<8}{ssub:<12}{k:>10} {tag}")
    print()


def tails():
    print("【結果四】單尾與雙尾之差異（t=36、每人 3 張）")
    print(f"   {'k':<8}{'單尾':>10}{'雙尾':>10}")
    for k in (80, 100, 120, 140):
        p1 = power(k, 3, 36, False, reps=2500, seed=31)
        p2 = power(k, 3, 36, True, reps=2500, seed=32)
        print(f"   {k:<8}{p1:>10.3f}{p2:>10.3f}")
    print()


if __name__ == "__main__":
    print("=" * 70)
    print("2×2×2 裂區消融實驗檢定力模擬")
    print("=" * 70)
    print("參數（★ 為企畫書提供，其餘為本模擬假設，前導研究後須替換）")
    print(f"   ★ σ_rater   = {PARAMS['s_rater']}")
    print(f"     σ_subject = {PARAMS['s_subject']}")
    print(f"     σ_shot    = {PARAMS['s_shot']}（對 β123 無影響，見驗證一）")
    print(f"     σ_resid   = {PARAMS['s_resid']}")
    print(f"     β123      = {PARAMS['beta123']}（由驗證二反推）")
    print()
    verify_cancellation()
    reverse_engineer()
    lever_comparison()
    sample_size_table()
    sensitivity()
    tails()
