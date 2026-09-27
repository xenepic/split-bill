import { useCallback, useState } from 'react';

/** persons-cols: 参加者が横（列）に並ぶ / persons-rows: 参加者が縦（行）に並ぶ */
export type TableOrientation = 'persons-cols' | 'persons-rows';

const KEY = 'split-bill:table-orientation';
const MOBILE_QUERY = '(max-width: 640px)';

function initialOrientation(): TableOrientation {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'persons-cols' || saved === 'persons-rows') return saved;
  } catch {
    /* 保存領域が使えない場合は画面幅で決める */
  }
  try {
    if (window.matchMedia?.(MOBILE_QUERY).matches) return 'persons-rows';
  } catch {
    /* noop */
  }
  return 'persons-cols';
}

/**
 * 支出入力表の向き。既定はスマホ幅なら参加者が縦、それ以外は横。
 * 利用者が切り替えた場合はこのブラウザに記憶する（AppState とは別の表示設定）。
 */
export function useTableOrientation(): [TableOrientation, () => void] {
  const [orientation, setOrientation] = useState<TableOrientation>(initialOrientation);
  const toggle = useCallback(() => {
    setOrientation((o) => {
      const next = o === 'persons-cols' ? 'persons-rows' : 'persons-cols';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);
  return [orientation, toggle];
}
