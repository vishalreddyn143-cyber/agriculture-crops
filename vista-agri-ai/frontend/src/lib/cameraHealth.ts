// Watches a live camera picture for tampering and faults: a covered or partly blocked lens,
// a moved camera, a blurry lens, frozen video and low light. Each call to analyse() looks at
// one small greyscale copy of the frame; a problem must persist for a few samples to count.

export type CameraIssue = 'covered' | 'obstructed' | 'moved' | 'blurry' | 'frozen' | 'dark';

export const ISSUE_TEXT: Record<CameraIssue | 'lost', { title: string; detail: string; alert: boolean }> = {
  covered: { title: 'Camera covered', detail: 'The lens is fully blocked or the picture went black.', alert: true },
  obstructed: { title: 'View partly blocked', detail: 'Something is covering part of the view.', alert: true },
  moved: { title: 'Camera moved', detail: 'The camera is now pointing at a different scene.', alert: true },
  blurry: { title: 'Blurry picture', detail: 'The lens may be dirty, wet or out of focus.', alert: true },
  frozen: { title: 'Video frozen', detail: 'The picture has stopped changing.', alert: true },
  dark: { title: 'Low light', detail: 'It is too dark to see clearly.', alert: false },
  lost: { title: 'Stream lost', detail: 'The connection to the streaming device dropped.', alert: true },
};

const W = 160;
const H = 120;
const GRID = 4;
// Samples a condition must hold for before it is reported (at ~2 samples per second)
const SUSTAIN: Record<CameraIssue, number> = { covered: 3, obstructed: 4, moved: 6, blurry: 6, frozen: 20, dark: 4 };
// Frames used to learn the normal view
const CALIBRATION_SAMPLES = 6;
// How quickly the normal view follows slow changes (sun moving, clouds) while nothing is wrong
const ADAPT_RATE = 0.05;

export interface HealthMetrics {
  brightness: number; // 0-255
  sharpnessPct: number; // edge detail compared with the normal view (100 = same)
  blockedPct: number; // share of normally-detailed grid cells that lost their detail
  changePct: number; // difference from the normal view, 0-100
}

export interface HealthResult {
  calibrating: boolean;
  issues: CameraIssue[];
  metrics: HealthMetrics | null;
}

interface Sample {
  gray: Float32Array; // brightness-normalised greyscale (mean subtracted)
  mean: number;
  std: number;
  edge: number;
  cellEdges: number[];
}

export class CameraHealthMonitor {
  private canvas: HTMLCanvasElement;
  private baseline: { gray: Float32Array; edge: number; cellEdges: number[] } | null = null;
  private calibration: Sample[] = [];
  private previous: Float32Array | null = null;
  private counts: Record<CameraIssue, number> = { covered: 0, obstructed: 0, moved: 0, blurry: 0, frozen: 0, dark: 0 };

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
  }

  // Forget the normal view, e.g. after the farmer has deliberately repositioned the camera
  recalibrate() {
    this.baseline = null;
    this.calibration = [];
    this.previous = null;
    for (const k of Object.keys(this.counts) as CameraIssue[]) this.counts[k] = 0;
  }

  private sample(el: CanvasImageSource): Sample {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(el, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const raw = new Float32Array(W * H);
    let sum = 0;
    for (let i = 0; i < W * H; i++) {
      raw[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
      sum += raw[i];
    }
    const mean = sum / (W * H);
    let variance = 0;
    const gray = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      gray[i] = raw[i] - mean;
      variance += gray[i] * gray[i];
    }
    // Edge detail: horizontal + vertical brightness differences, overall and per grid cell
    const cellEdges = new Array(GRID * GRID).fill(0);
    const cellW = W / GRID;
    const cellH = H / GRID;
    let edgeSum = 0;
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const i = y * W + x;
        const e = Math.abs(raw[i + 1] - raw[i]) + Math.abs(raw[i + W] - raw[i]);
        edgeSum += e;
        cellEdges[Math.floor(y / cellH) * GRID + Math.floor(x / cellW)] += e;
      }
    }
    const perCell = cellW * cellH;
    return {
      gray,
      mean,
      std: Math.sqrt(variance / (W * H)),
      edge: edgeSum / ((W - 1) * (H - 1)),
      cellEdges: cellEdges.map((c) => c / perCell),
    };
  }

  analyse(el: CanvasImageSource): HealthResult {
    const s = this.sample(el);
    const dark = s.mean < 45;
    const blank = s.mean < 18 || (s.std < 8 && s.edge < 2);

    // Frozen: consecutive frames almost identical (live cameras always have some sensor noise)
    let frameChange = Infinity;
    if (this.previous) {
      let d = 0;
      for (let i = 0; i < s.gray.length; i++) d += Math.abs(s.gray[i] - this.previous[i]);
      frameChange = d / s.gray.length;
    }
    this.previous = s.gray;

    if (!this.baseline) {
      // Learn the normal view only from clear, detailed frames
      if (!blank && !dark && s.edge > 3) this.calibration.push(s);
      if (this.calibration.length < CALIBRATION_SAMPLES) {
        return { calibrating: true, issues: blank ? ['covered'] : dark ? ['dark'] : [], metrics: null };
      }
      const n = this.calibration.length;
      const gray = new Float32Array(W * H);
      for (const c of this.calibration) for (let i = 0; i < gray.length; i++) gray[i] += c.gray[i] / n;
      this.baseline = {
        gray,
        edge: this.calibration.reduce((t, c) => t + c.edge, 0) / n,
        cellEdges: Array.from({ length: GRID * GRID }, (_, k) => this.calibration.reduce((t, c) => t + c.cellEdges[k], 0) / n),
      };
      this.calibration = [];
    }
    const base = this.baseline;

    // Cells that normally show detail but have gone flat: something is in front of the lens
    const textured = base.cellEdges.map((e, k) => (e > 4 ? k : -1)).filter((k) => k >= 0);
    const blocked = textured.filter((k) => s.cellEdges[k] < base.cellEdges[k] * 0.25).length;
    const blockedFraction = textured.length >= 4 ? blocked / textured.length : 0;

    let diff = 0;
    for (let i = 0; i < s.gray.length; i++) diff += Math.abs(s.gray[i] - base.gray[i]);
    diff /= s.gray.length;

    const raw: Record<CameraIssue, boolean> = {
      covered: blank || blockedFraction >= 0.85,
      obstructed: !blank && blockedFraction >= 0.35 && blockedFraction < 0.85,
      blurry: !blank && blockedFraction < 0.35 && s.edge < base.edge * 0.4,
      moved: !blank && blockedFraction < 0.35 && diff > 28,
      frozen: frameChange < 0.3,
      dark: dark && !blank,
    };
    const issues: CameraIssue[] = [];
    for (const k of Object.keys(raw) as CameraIssue[]) {
      this.counts[k] = raw[k] ? this.counts[k] + 1 : 0;
      if (this.counts[k] >= SUSTAIN[k]) issues.push(k);
    }

    // While everything looks normal, let the reference follow slow changes in light and scene
    if (!Object.values(raw).some(Boolean)) {
      for (let i = 0; i < base.gray.length; i++) base.gray[i] += (s.gray[i] - base.gray[i]) * ADAPT_RATE;
      base.edge += (s.edge - base.edge) * ADAPT_RATE;
      for (let k = 0; k < base.cellEdges.length; k++) base.cellEdges[k] += (s.cellEdges[k] - base.cellEdges[k]) * ADAPT_RATE;
    }

    return {
      calibrating: false,
      issues,
      metrics: {
        brightness: Math.round(s.mean),
        sharpnessPct: Math.round(Math.min(200, (s.edge / (base.edge || 1)) * 100)),
        blockedPct: Math.round(blockedFraction * 100),
        changePct: Math.round(Math.min(100, (diff / 60) * 100)),
      },
    };
  }
}
