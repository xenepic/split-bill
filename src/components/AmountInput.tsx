import { useState, type InputHTMLAttributes } from 'react';
import { formatYen, parseYen } from '../domain/money';
import { useSelectAllOnFocus } from './selectAll';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'onInvalid'> & {
  value: number | null;
  /** 確定時に呼ばれる。false を返すと入力文字列を元に戻す */
  onCommit: (value: number | null) => boolean | void;
  onParseError: (message: string) => void;
};

/**
 * 金額入力。編集中の文字列はローカルに保持し、確定（Enter / フォーカス外れ）時のみ検証して反映する。
 * Enter（スマホの「完了」）では次の入力欄へ移らず、フォーカスを外して確定しキーボードを閉じる。
 */
export function AmountInput({ value, onCommit, onParseError, onKeyDown, className, ...rest }: Props) {
  const [text, setText] = useState<string | null>(null);
  const selectAll = useSelectAllOnFocus();
  const shown = text ?? (value === null ? '' : formatYen(value));
  const negative = /^\s*[-−－]/.test(shown);

  const commit = () => {
    if (text === null) return true;
    const r = parseYen(text);
    if (!r.ok) {
      onParseError(r.error);
      setText(null);
      return false;
    }
    if (r.value !== value) {
      const accepted = onCommit(r.value);
      setText(null);
      return accepted !== false;
    }
    setText(null);
    return true;
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint="done"
      {...rest}
      className={[className, negative && 'negative'].filter(Boolean).join(' ') || undefined}
      value={shown}
      onChange={(e) => setText(e.target.value)}
      {...selectAll}
      onBlur={commit}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === 'Enter') {
          e.preventDefault();
          // 確定は onBlur で行う
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setText(null);
        }
      }}
    />
  );
}
