/**
 * Small, deterministic classifiers and evaluation utilities. No dependencies, so the
 * same code trains in the app, in tests and in scripts.
 */
import { seededRandom } from "@/features/anomaly-detection/stats";
import type { ClassMetrics, LogisticModel, ThresholdModel } from "./types";

export interface Sample {
  x: Record<string, number>;
  y: string;
}

/* ───────────── majority baseline ───────────── */

export function fitMajority(train: Sample[]): string {
  const counts = new Map<string, number>();
  for (const s of train) counts.set(s.y, (counts.get(s.y) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
}

/* ───────────── ordered-threshold model ───────────── */

/**
 * Learns K-1 cut points on ONE numeric feature so that classes ordered by their mean
 * fall into consecutive ranges, maximising training accuracy (exact dynamic programme).
 * Tries every candidate feature and keeps the best. Fully explainable: "below 1.88 kW → Low".
 */
export function fitThreshold(train: Sample[], features: string[], classes: string[]): ThresholdModel | null {
  let best: { model: ThresholdModel; correct: number } | null = null;
  const K = classes.length;
  for (const feature of features) {
    const rows = train.map((s) => ({ v: s.x[feature]!, y: s.y })).filter((r) => Number.isFinite(r.v));
    if (rows.length < K * 2) continue;
    // Order classes by their mean value of this feature.
    const order = [...classes].sort((a, b) => mean(rows.filter((r) => r.y === a).map((r) => r.v)) - mean(rows.filter((r) => r.y === b).map((r) => r.v)));
    rows.sort((a, b) => a.v - b.v);
    const n = rows.length;
    // prefix[k][i] = rows with class order[k] among the first i rows
    const prefix = order.map((c) => {
      const p = new Int32Array(n + 1);
      for (let i = 0; i < n; i++) p[i + 1] = p[i]! + (rows[i]!.y === c ? 1 : 0);
      return p;
    });
    // Allowed boundaries: positions where the value changes.
    const bounds: number[] = [0];
    for (let i = 1; i < n; i++) if (rows[i]!.v > rows[i - 1]!.v) bounds.push(i);
    bounds.push(n);
    const B = bounds.length;
    // dp[k][b] = best correct count assigning rows [0, bounds[b]) to the first k+1 classes
    const dp: Float64Array[] = [];
    const arg: Int32Array[] = [];
    for (let k = 0; k < K; k++) {
      dp.push(new Float64Array(B).fill(-Infinity));
      arg.push(new Int32Array(B).fill(-1));
    }
    for (let b = 0; b < B; b++) dp[0]![b] = prefix[0]![bounds[b]!]!;
    for (let k = 1; k < K; k++) {
      const p = prefix[k]!;
      // dp[k][b] = max_{a<=b} dp[k-1][a] + count of class k in [bounds[a], bounds[b])
      //          = max_a (dp[k-1][a] - p[bounds[a]]) + p[bounds[b]]
      let bestA = -1;
      let bestVal = -Infinity;
      for (let b = 0; b < B; b++) {
        const cand = dp[k - 1]![b]! - p[bounds[b]!]!;
        if (cand > bestVal) {
          bestVal = cand;
          bestA = b;
        }
        dp[k]![b] = bestVal + p[bounds[b]!]!;
        arg[k]![b] = bestA;
      }
    }
    const correct = dp[K - 1]![B - 1]!;
    if (!best || correct > best.correct) {
      // Recover cut positions.
      const cutsIdx: number[] = [];
      let b = B - 1;
      for (let k = K - 1; k >= 1; k--) {
        const a = arg[k]![b]!;
        cutsIdx.unshift(a);
        b = a;
      }
      const cuts = cutsIdx.map((bi) => {
        const pos = bounds[bi]!;
        // Finite sentinels keep the model JSON-serialisable (JSON has no Infinity).
        if (pos <= 0) return rows[0]!.v - 1;
        if (pos >= n) return rows[n - 1]!.v + 1;
        return (rows[pos - 1]!.v + rows[pos]!.v) / 2;
      });
      best = { model: { kind: "threshold", feature, order, cuts }, correct };
    }
  }
  return best?.model ?? null;
}

export function predictThreshold(m: ThresholdModel, x: Record<string, number>): string {
  const v = x[m.feature]!;
  for (let k = 0; k < m.cuts.length; k++) if (v <= m.cuts[k]!) return m.order[k]!;
  return m.order[m.order.length - 1]!;
}

/* ───────────── multinomial logistic regression ───────────── */

export function fitLogistic(train: Sample[], features: string[], classes: string[], opts = { iterations: 600, lr: 0.5, l2: 1e-3 }): LogisticModel {
  const d = features.length;
  const K = classes.length;
  const n = train.length;
  const meanV = features.map((f) => mean(train.map((s) => s.x[f]!)));
  const stdV = features.map((f, j) => {
    const sd = Math.sqrt(mean(train.map((s) => (s.x[f]! - meanV[j]!) ** 2)));
    return sd > 1e-12 ? sd : 1;
  });
  const X = train.map((s) => features.map((f, j) => (s.x[f]! - meanV[j]!) / stdV[j]!));
  const Y = train.map((s) => classes.indexOf(s.y));
  const W = Array.from({ length: K }, () => new Float64Array(d));
  const b = new Float64Array(K);
  const probs = new Float64Array(K);
  for (let it = 0; it < opts.iterations; it++) {
    const gW = Array.from({ length: K }, () => new Float64Array(d));
    const gb = new Float64Array(K);
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      let max = -Infinity;
      for (let k = 0; k < K; k++) {
        let z = b[k]!;
        const wk = W[k]!;
        for (let j = 0; j < d; j++) z += wk[j]! * xi[j]!;
        probs[k] = z;
        if (z > max) max = z;
      }
      let sum = 0;
      for (let k = 0; k < K; k++) {
        probs[k] = Math.exp(probs[k]! - max);
        sum += probs[k]!;
      }
      for (let k = 0; k < K; k++) {
        const g = probs[k]! / sum - (Y[i] === k ? 1 : 0);
        gb[k] = gb[k]! + g;
        const gwk = gW[k]!;
        for (let j = 0; j < d; j++) gwk[j] = gwk[j]! + g * xi[j]!;
      }
    }
    for (let k = 0; k < K; k++) {
      b[k] = b[k]! - (opts.lr * gb[k]!) / n;
      const wk = W[k]!;
      const gwk = gW[k]!;
      for (let j = 0; j < d; j++) wk[j] = wk[j]! - opts.lr * (gwk[j]! / n + opts.l2 * wk[j]!);
    }
  }
  return {
    kind: "logistic",
    features,
    mean: meanV,
    std: stdV,
    classes,
    weights: W.map((w) => Array.from(w)),
    bias: Array.from(b),
  };
}

export function predictLogistic(m: LogisticModel, x: Record<string, number>): string {
  let bestK = 0;
  let best = -Infinity;
  for (let k = 0; k < m.classes.length; k++) {
    let z = m.bias[k]!;
    for (let j = 0; j < m.features.length; j++) z += m.weights[k]![j]! * ((x[m.features[j]!]! - m.mean[j]!) / m.std[j]!);
    if (z > best) {
      best = z;
      bestK = k;
    }
  }
  return m.classes[bestK]!;
}

/* ───────────── evaluation ───────────── */

/** Stratified k-fold split with a fixed seed: each class is shuffled and dealt round-robin. */
export function stratifiedFolds(samples: Sample[], k: number, seed: number): number[] {
  const rand = seededRandom(seed);
  const fold = new Array<number>(samples.length);
  const byClass = new Map<string, number[]>();
  samples.forEach((s, i) => {
    const list = byClass.get(s.y) ?? [];
    list.push(i);
    byClass.set(s.y, list);
  });
  let offset = 0;
  for (const label of [...byClass.keys()].sort()) {
    const idx = byClass.get(label)!;
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [idx[i], idx[j]] = [idx[j]!, idx[i]!];
    }
    idx.forEach((sampleIdx, pos) => (fold[sampleIdx] = (pos + offset) % k));
    offset += idx.length;
  }
  return fold;
}

export function confusionMatrix(truth: string[], pred: string[], classes: string[]): number[][] {
  const m = classes.map(() => classes.map(() => 0));
  truth.forEach((t, i) => {
    const r = classes.indexOf(t);
    const c = classes.indexOf(pred[i]!);
    if (r >= 0 && c >= 0) m[r]![c]!++;
  });
  return m;
}

export function classMetrics(confusion: number[][], classes: string[]): ClassMetrics[] {
  return classes.map((label, k) => {
    const tp = confusion[k]![k]!;
    const support = confusion[k]!.reduce((a, b) => a + b, 0);
    const predicted = confusion.reduce((a, row) => a + row[k]!, 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    return { label, precision, recall, f1, support };
  });
}

export function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

export function std(v: number[]): number {
  const m = mean(v);
  return Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
}
