import type { SettlementMode } from '../domain/types';
import { SUPPORTED_ROUNDING_UNITS } from '../domain/types';

/** 精算モードの切替スイッチ（オフ=通常、オン=丸め） */
export function RoundingToggle({ mode, onChange }: { mode: SettlementMode; onChange: (m: SettlementMode) => void }) {
  const unit = SUPPORTED_ROUNDING_UNITS[0];
  const on = mode.kind === 'rounded';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${unit}円丸め`}
      className={`toggle ${on ? 'on' : ''}`}
      onClick={() => onChange(on ? { kind: 'exact' } : { kind: 'rounded', unit })}
    >
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">{unit}円丸め</span>
      <span className="toggle-state">{on ? 'ON' : 'OFF'}</span>
    </button>
  );
}
