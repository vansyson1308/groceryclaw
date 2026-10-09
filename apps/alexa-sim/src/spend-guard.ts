// Cost guard for the Claude brain on a public demo. Each UTC day allows at
// most `dailyTurnCap` Claude turns and about `dailyBudgetUsd` of estimated
// spend (from the API's reported token usage). Past either limit, turns are
// answered by the offline rules brain and the UI shows the "offline brain"
// badge. The Anthropic Console spend limit is the hard backstop; this keeps a
// busy or abused demo from reaching it.

export interface SpendGuardStatus {
  readonly day: string;
  readonly turns: number;
  readonly spentUsd: number;
  readonly dailyTurnCap: number;
  readonly dailyBudgetUsd: number;
  readonly exhausted: boolean;
}

export class SpendGuard {
  private day = '';
  private turns = 0;
  private spentUsd = 0;

  constructor(
    private readonly dailyTurnCap: number,
    private readonly dailyBudgetUsd: number,
    private readonly now: () => number = Date.now
  ) {}

  private roll(): void {
    const today = new Date(this.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.turns = 0;
      this.spentUsd = 0;
    }
  }

  /** Reserves one Claude turn; false when today's turn cap or budget is used up. */
  tryStartTurn(): boolean {
    this.roll();
    if (this.turns >= this.dailyTurnCap || this.spentUsd >= this.dailyBudgetUsd) return false;
    this.turns += 1;
    return true;
  }

  record(costUsd: number): void {
    this.roll();
    if (Number.isFinite(costUsd) && costUsd > 0) this.spentUsd += costUsd;
  }

  status(): SpendGuardStatus {
    this.roll();
    return {
      day: this.day,
      turns: this.turns,
      spentUsd: Math.round(this.spentUsd * 10_000) / 10_000,
      dailyTurnCap: this.dailyTurnCap,
      dailyBudgetUsd: this.dailyBudgetUsd,
      exhausted: this.turns >= this.dailyTurnCap || this.spentUsd >= this.dailyBudgetUsd
    };
  }
}
