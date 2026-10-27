// 濾鏡問卷 v2 的控制器：App 的 MesfController（不改）加上「回上一題重選」（2026-10-28 使用者決定 1a 2a 3a）。
//
// 規則：只能回上一題；以最後一次作答為準、決定時間以最後一次造訪計；注意力題也可改。
//   伺服器端同樣只接受修改「最近答的那一題」，並在 questions.answer_history 記下每一次作答。
//
// ⚠ 依賴 MesfController 的內部實作（不在 App 的公開介面上）：
//   - private position：目前題號；resume 時以「已送出作答數」還原（this.position = Math.min(syncedCount, …)）
//   - private flat：攤平的比較題
//   - private persist()：寫入本機紀錄
//   回上一題＝把最後一筆已送出的作答從本機紀錄移除、題號退一格；重答時伺服器記為修改。
//   這樣 resume 仍一致：已送出作答數＝題號。App 若改了這些內部，check.mjs 會失敗，不會悄悄壞掉。
import { MesfController } from '@app/modules/mesfController';

interface Internals {
  position: number;
  flat: Array<{ phase: string; question_index: number }>;
  persist(): Promise<void>;
}

/** 本機紀錄上的旗標：正在重答上一題（此時不能再往回）。存在紀錄裡，重新整理後仍有效。 */
const REVISIT = 'v2_revisiting';

export class V2Controller extends MesfController {
  private get internals(): Internals {
    return this as unknown as Internals;
  }

  private get revisiting(): boolean {
    return (this.snapshot as unknown as Record<string, unknown>)[REVISIT] === true;
  }

  private async setRevisiting(v: boolean): Promise<void> {
    if (this.revisiting === v) return;
    (this.snapshot as unknown as Record<string, unknown>)[REVISIT] = v;
    await this.internals.persist();
  }

  canGoBack(): boolean {
    return this.stage === 'comparison' && !this.hasPendingAnswer && this.internals.position > 0 && !this.revisiting;
  }

  /** 回上一題。回傳上一題原本點選的畫面位置（0 左、1 右），供畫面預選；不能回時回傳 null。 */
  async goBack(): Promise<number | null> {
    if (!this.canGoBack()) return null;
    const rec = this.snapshot;
    const last = rec.answers[rec.answers.length - 1];
    const prev = this.internals.flat[this.internals.position - 1];
    // ⚠ 最後一筆作答必須已送出、且正是上一題；否則不動（避免本機紀錄與伺服器錯位）
    if (!last || !last.synced || !prev || last.phase !== prev.phase || last.question_index !== prev.question_index) return null;
    rec.answers.pop();
    this.internals.position -= 1;
    (rec as unknown as Record<string, unknown>)[REVISIT] = true;
    this.markShown();
    await this.internals.persist();
    return last.chosen_side === 'left' ? 0 : last.chosen_side === 'right' ? 1 : null;
  }

  // 作答成功往前一題後解除旗標（answerComparison 內部會呼叫 retryPending，兩條路都會經過這裡）
  override async retryPending(): Promise<void> {
    await super.retryPending();
    await this.setRevisiting(false);
  }

  override async carryOverFromLocal(): Promise<void> {
    await super.carryOverFromLocal();
    await this.setRevisiting(false);
  }
}
