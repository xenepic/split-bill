import { computeBalances, type PersonBalance } from './balance';
import { isValidRoundingUnit, roundBalances, type RoundingMethod } from './rounding';
import { findMinTransferPatterns, type SettlementOptions } from './settlement';
import { err, ok, type AppState, type Result, type SettlementMode, type Transfer } from './types';

export type SettlementRow = PersonBalance & {
  settlementBalance: number;
  delta: number;
};

export type SettlementView = {
  rows: SettlementRow[];
  patterns: Transfer[][];
  minCount: number;
  minCountExact: boolean;
  patternsComplete: boolean;
  /** 丸めモード時の丸め方式（通常モードでは null） */
  roundingMethod: RoundingMethod | null;
};

/** 入力データから精算結果を導出する（元の残高 → 丸め → 最小送金件数探索） */
export function computeSettlement(
  state: Pick<AppState, 'persons' | 'expenses'>,
  mode: SettlementMode,
  options?: SettlementOptions,
): Result<SettlementView> {
  const balancesR = computeBalances(state);
  if (!balancesR.ok) return balancesR;
  const balances = balancesR.value;

  let unit = 1;
  let rows: SettlementRow[];
  let roundingMethod: RoundingMethod | null = null;
  if (mode.kind === 'rounded') {
    if (!isValidRoundingUnit(mode.unit)) return err('丸め単位が不正です');
    unit = mode.unit;
    const r = roundBalances(
      balances.map((b) => b.balance),
      balances.map((b) => b.paid),
      unit,
    );
    if (!r.ok) return r;
    roundingMethod = r.value.method;
    rows = balances.map((b, i) => ({
      ...b,
      settlementBalance: r.value.balances[i].settlementBalance,
      delta: r.value.balances[i].delta,
    }));
  } else {
    rows = balances.map((b) => ({ ...b, settlementBalance: b.balance, delta: 0 }));
  }

  const search = findMinTransferPatterns(
    rows.map((r) => r.settlementBalance / unit),
    options,
  );
  const patterns = search.patterns.map((p) =>
    p.map((t) => ({
      fromId: rows[t.from].personId,
      toId: rows[t.to].personId,
      amount: t.amount * unit,
    })),
  );
  return ok({
    rows,
    patterns,
    minCount: search.minCount,
    minCountExact: search.minCountExact,
    patternsComplete: search.patternsComplete,
    roundingMethod,
  });
}
