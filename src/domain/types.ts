export type Person = { id: string; name: string; order: number };

export type ShareMode = 'auto' | 'fixed' | 'excluded';

export type Share = {
  personId: string;
  amount: number; // 整数円
  mode: ShareMode;
};

export type Expense = {
  id: string;
  title: string; // 空文字可
  payerId: string | null;
  amount: number | null; // 未入力ならnull、入力済みは正の整数
  shares: Share[]; // 全参加者分の状態を持つ
  order: number;
};

export const SUPPORTED_ROUNDING_UNITS = [50] as const; // 将来 [10, 50, 100] 等へ拡張
export type SupportedRoundingUnit = (typeof SUPPORTED_ROUNDING_UNITS)[number];

export type SettlementMode = { kind: 'exact' } | { kind: 'rounded'; unit: number };

export type AppState = {
  schemaVersion: 1;
  persons: Person[];
  expenses: Expense[];
  settlementMode: SettlementMode;
  selectedPatternIndex: number;
};

export type Transfer = { fromId: string; toId: string; amount: number };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T = never>(error: string): Result<T> => ({ ok: false, error });
