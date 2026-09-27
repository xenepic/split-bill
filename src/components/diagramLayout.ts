/**
 * 精算図のレイアウト計算（描画から分離した純粋関数）。
 * - ノード（角丸四角）を円周上に等間隔配置
 * - 送金ごとに二次ベジェ曲線を引き、端点はノードの枠上に置く
 * - 金額ラベルは、他のラベルやノードと重ならない位置を曲線上の候補から選ぶ
 */

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number }; // 左上座標 + 幅・高さ

export type NodeLayout = {
  center: Pt;
  w: number;
  h: number;
  label: string; // 表示用（長い名前は省略）
  status: Pt & { anchor: 'start' | 'middle' | 'end' };
};

export type EdgeLayout = {
  path: string;
  label: Box & { text: string; cx: number; cy: number };
};

export type DiagramLayout = {
  width: number;
  height: number;
  nodes: NodeLayout[];
  edges: EdgeLayout[];
};

export type EdgeInput = { from: number; to: number; text: string };

const NODE_H = 34;
const NODE_MIN_W = 64;
const NODE_MAX_W = 140;
const NAME_MAX_CHARS = 8;
const LABEL_H = 20;
const GAP = 3; // 重なり判定の余白
const CURVE_SAMPLES = 60;

/** 12px 太字でのおおよその文字幅 */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? 12 : 7.2;
  return w;
}

function truncate(s: string, n: number) {
  const chars = [...s];
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : s;
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + GAP;
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + GAP;
  return w > 0 && h > 0 ? w * h : 0;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return overlapArea(a, b) > 0;
}

/** 中心 c・半幅 hw・半高 hh の四角の枠上で、方向 (dx, dy) にある点 */
function rectBoundary(c: Pt, hw: number, hh: number, dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const t = Math.min(ux !== 0 ? hw / Math.abs(ux) : Infinity, uy !== 0 ? hh / Math.abs(uy) : Infinity);
  return { x: c.x + ux * t, y: c.y + uy * t };
}

function bezier(p0: Pt, p1: Pt, p2: Pt, t: number): Pt {
  const s = 1 - t;
  return {
    x: s * s * p0.x + 2 * s * t * p1.x + t * t * p2.x,
    y: s * s * p0.y + 2 * s * t * p1.y + t * t * p2.y,
  };
}

/** ラベル位置の候補（曲線上の位置 t と、曲線からの法線方向のずらし量） */
const LABEL_CANDIDATES: { t: number; off: number }[] = [
  ...[0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8].map((t) => ({ t, off: 0 })),
  ...[0.5, 0.4, 0.6, 0.3, 0.7].flatMap((t) => [
    { t, off: 18 },
    { t, off: -18 },
  ]),
  ...[0.5, 0.35, 0.65].flatMap((t) => [
    { t, off: 34 },
    { t, off: -34 },
  ]),
  ...[0.5, 0.35, 0.65].flatMap((t) => [
    { t, off: 52 },
    { t, off: -52 },
  ]),
];

export function layoutDiagram(names: string[], edges: EdgeInput[]): DiagramLayout {
  const n = names.length;
  const labels = names.map((s) => truncate(s, NAME_MAX_CHARS));
  const widths = labels.map((l) => Math.min(NODE_MAX_W, Math.max(NODE_MIN_W, Math.ceil(textWidth(l)) + 24)));
  const maxW = Math.max(NODE_MIN_W, ...widths);

  // 隣り合うノードが重ならない半径（周長 ≒ 各ノード幅 + 間隔 の合計）
  // 金額ラベルを置く余地も確保するため、ノード間に余裕を持たせる
  const perimeter = widths.reduce((s, w) => s + w + 72, 0);
  const radius = n <= 2 ? 110 : Math.max(130, Math.round(perimeter / (2 * Math.PI)));
  const marginX = maxW / 2 + 64; // 左右はステータス文字を横に置く
  const marginY = NODE_H / 2 + 36;
  const width = Math.round((radius + marginX) * 2);
  const height = Math.round((radius + marginY) * 2);
  const center = { x: width / 2, y: height / 2 };

  const nodes: NodeLayout[] = labels.map((label, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(n, 1);
    const c = { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
    const w = widths[i];
    const cos = Math.cos(a);
    // ステータス文字は円の外側へ（左右のノードは横、上下のノードは上下）
    let status: NodeLayout['status'];
    if (Math.abs(cos) > 0.5) {
      status =
        cos > 0
          ? { x: c.x + w / 2 + 6, y: c.y + 4, anchor: 'start' }
          : { x: c.x - w / 2 - 6, y: c.y + 4, anchor: 'end' };
    } else {
      status =
        Math.sin(a) < 0
          ? { x: c.x, y: c.y - NODE_H / 2 - 8, anchor: 'middle' }
          : { x: c.x, y: c.y + NODE_H / 2 + 16, anchor: 'middle' };
    }
    return { center: c, w, h: NODE_H, label, status };
  });

  const nodeBoxes: Box[] = nodes.map((nd) => ({
    x: nd.center.x - nd.w / 2,
    y: nd.center.y - nd.h / 2,
    w: nd.w,
    h: nd.h,
  }));
  const pairCount = new Map<string, number>();

  // 1) 曲線を決める
  const curves = edges.map((e) => {
    const A = nodes[e.from];
    const B = nodes[e.to];
    const key = [e.from, e.to].sort().join('|');
    const nth = pairCount.get(key) ?? 0;
    pairCount.set(key, nth + 1);

    const dx = B.center.x - A.center.x;
    const dy = B.center.y - A.center.y;
    const dist = Math.hypot(dx, dy) || 1;
    let nx = -dy / dist;
    let ny = dx / dist;
    const mid = { x: (A.center.x + B.center.x) / 2, y: (A.center.y + B.center.y) / 2 };
    // 円の外側へ膨らませ、中心付近で線が重なりにくいようにする
    if ((mid.x - center.x) * nx + (mid.y - center.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const bend = dist * (0.12 + 0.1 * nth) * (nth % 2 === 1 ? -1 : 1);
    const ctrl = { x: mid.x + nx * bend, y: mid.y + ny * bend };
    const start = rectBoundary(A.center, A.w / 2 + 3, A.h / 2 + 3, ctrl.x - A.center.x, ctrl.y - A.center.y);
    const end = rectBoundary(B.center, B.w / 2 + 7, B.h / 2 + 7, ctrl.x - B.center.x, ctrl.y - B.center.y);
    const samples = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => bezier(start, ctrl, end, i / CURVE_SAMPLES));
    return { start, ctrl, end, nx, ny, samples };
  });

  // 2) 金額ラベルを置く。優先順: 他ラベル・ノードと重ならない > 他の矢印の線に乗らない
  //    > 自分の線の上（ずらさない）> 曲線の中央に近い
  const placed: Box[] = [];
  const edgeLayouts: EdgeLayout[] = edges.map((e, ei) => {
    const { start, ctrl, end, nx, ny } = curves[ei];
    const lw = Math.ceil(textWidth(e.text)) + 12;
    let best: { box: Box; cost: number } | null = null;
    for (let k = 0; k < LABEL_CANDIDATES.length; k++) {
      const { t, off } = LABEL_CANDIDATES[k];
      const p = bezier(start, ctrl, end, t);
      const box = { x: p.x + nx * off - lw / 2, y: p.y + ny * off - LABEL_H / 2, w: lw, h: LABEL_H };
      const outside = box.x < 0 || box.y < 0 || box.x + box.w > width || box.y + box.h > height;
      let hard = outside ? 1e6 : 0;
      for (const o of placed) hard += overlapArea(box, o);
      for (const o of nodeBoxes) hard += overlapArea(box, o);
      let linePts = 0;
      curves.forEach((c, ci) => {
        if (ci === ei) return;
        for (const q of c.samples) {
          if (q.x >= box.x - 2 && q.x <= box.x + box.w + 2 && q.y >= box.y - 2 && q.y <= box.y + box.h + 2) linePts++;
        }
      });
      // ラベル・ノードとの重なりは他の条件より常に優先して避ける
      const cost = (hard > 0 ? 1e9 + hard * 1000 : 0) + linePts * 100 + k;
      if (!best || cost < best.cost) best = { box, cost };
      if (hard === 0 && linePts === 0) break; // 候補は優先順に並んでいるので最初の完全解を採用
    }
    const box = best!.box;
    placed.push(box);
    return {
      path: `M${start.x},${start.y} Q${ctrl.x},${ctrl.y} ${end.x},${end.y}`,
      label: { ...box, text: e.text, cx: box.x + box.w / 2, cy: box.y + box.h / 2 },
    };
  });

  return { width, height, nodes, edges: edgeLayouts };
}
