import { formatYen } from '../domain/money';
import type { Person, Transfer } from '../domain/types';
import { layoutDiagram } from './diagramLayout';
import { balanceLabel } from './SummaryTable';

type Props = {
  persons: Person[];
  /** personId → 精算用収支 */
  settlementBalance: Map<string, number>;
  transfers: Transfer[];
};

/** 円環上の送金図（送金人 → 受取人）。描画のみを担当し、計算はしない。 */
export function SettlementDiagram({ persons, settlementBalance, transfers }: Props) {
  const idx = new Map(persons.map((p, i) => [p.id, i]));
  const name = new Map(persons.map((p) => [p.id, p.name]));
  const layout = layoutDiagram(
    persons.map((p) => p.name),
    transfers.map((t) => ({ from: idx.get(t.fromId)!, to: idx.get(t.toId)!, text: `${formatYen(t.amount)}円` })),
  );

  return (
    <svg
      className="diagram"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      // 狭い画面では 70% まで縮小して収め、それでも入らなければ横スクロール
      style={{ width: '100%', maxWidth: layout.width, minWidth: Math.round(layout.width * 0.7), height: 'auto' }}
      role="img"
      aria-label={
        transfers.length === 0
          ? '精算図：送金はありません'
          : `精算図：${transfers.map((t) => `${name.get(t.fromId)}から${name.get(t.toId)}へ${formatYen(t.amount)}円`).join('、')}`
      }
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
        </marker>
      </defs>
      {layout.edges.map((e, k) => (
        <path key={k} className="edge-line" d={e.path} markerEnd="url(#arrow)" />
      ))}
      {/* ラベルは全ての線より前面に描く */}
      {layout.edges.map((e, k) => (
        <g key={k} className="edge">
          <rect x={e.label.x} y={e.label.y} width={e.label.w} height={e.label.h} rx={4} className="edge-label-bg" />
          <text x={e.label.cx} y={e.label.cy + 4} textAnchor="middle" className="edge-label">
            {e.label.text}
          </text>
        </g>
      ))}
      {persons.map((p, i) => {
        const nd = layout.nodes[i];
        const bal = settlementBalance.get(p.id) ?? 0;
        const status = balanceLabel(bal);
        return (
          <g key={p.id} className={`node node-${bal > 0 ? 'pos' : bal < 0 ? 'neg' : 'zero'}`}>
            <rect x={nd.center.x - nd.w / 2} y={nd.center.y - nd.h / 2} width={nd.w} height={nd.h} rx={10} />
            <text x={nd.center.x} y={nd.center.y + 4} textAnchor="middle" className="node-name">
              {nd.label}
            </text>
            <text x={nd.status.x} y={nd.status.y} textAnchor={nd.status.anchor} className="node-status">
              {status}
            </text>
            <title>{`${p.name}（${status}）`}</title>
          </g>
        );
      })}
    </svg>
  );
}
