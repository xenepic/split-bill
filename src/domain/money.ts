import { err, ok, type Result } from './types';

/**
 * 金額入力文字列を整数円へ変換する。
 * - 空欄（空白のみ含む）は null（未入力）
 * - 半角数字のみ、または3桁カンマ区切りを許可
 * - 先頭のマイナス記号（- / − / －）で負数（競馬の払戻など収益の行）
 * - 小数・指数表記・Infinity/NaN・安全範囲超過は拒否
 */
export function parseYen(input: string): Result<number | null> {
  const s = input.trim();
  if (s === '') return ok(null);
  const m = /^([-−－]?)\s*(\d+|\d{1,3}(,\d{3})+)$/.exec(s);
  if (!m) {
    return err('金額は整数（半角数字、マイナスは先頭に「-」）で入力してください');
  }
  const n = Number(m[2].replace(/,/g, ''));
  if (!Number.isSafeInteger(n)) return err('金額が大きすぎます');
  return ok(m[1] && n !== 0 ? -n : n);
}

/** 符号を反転した入力値（null はそのまま） */
export function negateYen(n: number | null): number | null {
  return n === null || n === 0 ? n : -n;
}

export function formatYen(n: number): string {
  return n.toLocaleString('ja-JP');
}

/** 符号付き表示（+1,000 / −1,000 / 0） */
export function formatSignedYen(n: number): string {
  if (n > 0) return `+${formatYen(n)}`;
  if (n < 0) return `−${formatYen(-n)}`;
  return '0';
}

export function isYenInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}
