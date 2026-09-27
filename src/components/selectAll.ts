import { useRef, type FocusEvent, type MouseEvent } from 'react';

/**
 * フォーカス時（クリック・Tab 移動とも）に入力内容を全選択する props。
 * クリックでフォーカスした場合は mouseup で選択が解除されるのを防ぐ。
 * 既にフォーカス中の欄をクリックしたときは通常どおりカーソル移動できる。
 */
export function useSelectAllOnFocus() {
  const focusedByMouse = useRef(false);
  return {
    onMouseDown: (e: MouseEvent<HTMLInputElement>) => {
      focusedByMouse.current = document.activeElement !== e.currentTarget;
    },
    onFocus: (e: FocusEvent<HTMLInputElement>) => e.currentTarget.select(),
    onMouseUp: (e: MouseEvent<HTMLInputElement>) => {
      if (focusedByMouse.current) e.preventDefault();
      focusedByMouse.current = false;
    },
  };
}
