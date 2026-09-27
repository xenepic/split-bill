import { err, ok, type Result } from './types';

/**
 * 金額入力文字列を整数円へ変換する。
 * - 空欄（空白のみ含む）は null（未入力）
 * - 半角数字のみ、または3桁カンマ区切りを許可
 * - 負数・小数・指数表記・Infinity/NaN・安全範囲超過は拒否
 */
export function parseYen(input: string): Result<number | null> {
  const s = input.trim();
  if (s === '') return ok(null);
  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(s)) {
    return err('金額は0以上の整数（半角数字）で入力してください');
  }
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isSafeInteger(n)) return err('金額が大きすぎます');
  return ok(n);
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
