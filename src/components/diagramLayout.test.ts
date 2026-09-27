import { boxesOverlap, layoutDiagram, type Box } from './diagramLayout';
import { findMinTransferPatterns } from '../domain/settlement';

function nodeBoxes(l: ReturnType<typeof layoutDiagram>): Box[] {
  return l.nodes.map((n) => ({ x: n.center.x - n.w / 2, y: n.center.y - n.h / 2, w: n.w, h: n.h }));
}

function overlaps(l: ReturnType<typeof layoutDiagram>) {
  const labels = l.edges.map((e) => e.label);
  const found: string[] = [];
  labels.forEach((a, i) => {
    labels.slice(i + 1).forEach((b) => boxesOverlap(a, b) && found.push(`${a.text}×${b.text}`));
    nodeBoxes(l).forEach((nb, j) => boxesOverlap(a, nb) && found.push(`${a.text}×node${j}`));
  });
  return found;
}

describe('layoutDiagram', () => {
  it('交差する矢印の金額ラベルが重ならない（上 A・右 B・下 C・左 D）', () => {
    const l = layoutDiagram(['nameA', 'nameB', 'nameC', 'nameD'], [
      { from: 3, to: 0, text: '4,750円' },
      { from: 2, to: 0, text: '6,375円' },
      { from: 3, to: 1, text: '1,625円' },
    ]);
    expect(overlaps(l)).toEqual([]);
  });

  it('ノードは重ならず、図の範囲内に収まる', () => {
    const names = ['とても長い名前の参加者', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const l = layoutDiagram(names, []);
    const boxes = nodeBoxes(l);
    boxes.forEach((a, i) => {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(l.width);
      boxes.slice(i + 1).forEach((b) => expect(boxesOverlap(a, b)).toBe(false));
    });
    expect(l.nodes[0].label.endsWith('…')).toBe(true);
  });

  it('ランダムな精算パターン（3〜8人）でラベルが重ならない', () => {
    let seed = 11;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let t = 0; t < 200; t++) {
      const n = 3 + Math.floor(rand() * 6);
      const b = Array.from({ length: n - 1 }, () => Math.floor(rand() * 21 - 10) * 1000 + Math.floor(rand() * 1000));
      b.push(-b.reduce((s, x) => s + x, 0));
      const { patterns } = findMinTransferPatterns(b, { maxPatterns: 3 });
      for (const p of patterns) {
        const l = layoutDiagram(
          b.map((_, i) => `参加者${i + 1}`),
          p.map((e) => ({ from: e.from, to: e.to, text: `${e.amount.toLocaleString('ja-JP')}円` })),
        );
        expect(overlaps(l)).toEqual([]);
      }
    }
  });
});
