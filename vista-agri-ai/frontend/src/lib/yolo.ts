import type { InferenceSession, Tensor } from 'onnxruntime-web';

// YOLO11n (COCO, 80 classes) exported to ONNX: input [1,3,640,640], output [1,84,8400]
const MODEL_URL = '/models/yolo11n.onnx';
const INPUT_SIZE = 640;
const IOU_THRESHOLD = 0.45;

export const COCO_CLASSES = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow',
  'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
  'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
  'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed',
  'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven',
  'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush',
];

// Objects that raise a farm alert (the backend maps each to a severity and action)
export const THREAT_CLASSES = new Set(['elephant', 'bear', 'cow', 'horse', 'sheep', 'dog', 'cat', 'bird', 'person']);
// Shown on the feed but never alerted on
export const VEHICLE_CLASSES = new Set(['bicycle', 'car', 'motorcycle', 'truck', 'bus']);

export interface Detection {
  classId: number;
  score: number;
  // Box in source-pixel coordinates
  x: number;
  y: number;
  w: number;
  h: number;
  trackId?: number;
}

export type LoadedModel = { ort: typeof import('onnxruntime-web'); session: InferenceSession };

// The ONNX runtime and session are loaded once and shared by every screen
let sessionPromise: Promise<LoadedModel> | null = null;
export const loadModel = () => {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      // Fetch the WebAssembly runtime matching the installed package from the CDN
      ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`;
      // Multi-threading needs a cross-origin isolated page, which this site is not
      ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, session };
    })();
    sessionPromise.catch(() => {
      sessionPromise = null;
    });
  }
  return sessionPromise;
};

export const iou = (a: Detection, b: Detection) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

let prepCanvas: HTMLCanvasElement | null = null;

// Letterboxes the frame into 640x640, runs YOLO and returns boxes in source pixels, plus the
// inference time. Throws a SecurityError if the frame comes from a stream that forbids reading pixels.
export const detectFrame = async (
  loaded: LoadedModel,
  el: CanvasImageSource,
  srcW: number,
  srcH: number,
  { minConfidence, farmObjectsOnly }: { minConfidence: number; farmObjectsOnly: boolean },
): Promise<{ detections: Detection[]; ms: number }> => {
  if (!prepCanvas) {
    prepCanvas = document.createElement('canvas');
    prepCanvas.width = INPUT_SIZE;
    prepCanvas.height = INPUT_SIZE;
  }
  const ctx = prepCanvas.getContext('2d', { willReadFrequently: true })!;
  const scale = Math.min(INPUT_SIZE / srcW, INPUT_SIZE / srcH);
  const nw = Math.round(srcW * scale);
  const nh = Math.round(srcH * scale);
  const padX = (INPUT_SIZE - nw) / 2;
  const padY = (INPUT_SIZE - nh) / 2;
  ctx.fillStyle = 'rgb(114,114,114)';
  ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  ctx.drawImage(el, 0, 0, srcW, srcH, padX, padY, nw, nh);
  const { data } = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  const area = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = data[i * 4] / 255;
    input[i + area] = data[i * 4 + 1] / 255;
    input[i + 2 * area] = data[i * 4 + 2] / 255;
  }

  const start = performance.now();
  const feeds: Record<string, Tensor> = {
    [loaded.session.inputNames[0]]: new loaded.ort.Tensor('float32', input, [1, 3, INPUT_SIZE, INPUT_SIZE]),
  };
  const results = await loaded.session.run(feeds);
  const ms = Math.round(performance.now() - start);

  const output = results[loaded.session.outputNames[0]];
  const out = output.data as Float32Array;
  const anchors = output.dims[2];
  const numClasses = output.dims[1] - 4;

  const candidates: Detection[] = [];
  for (let i = 0; i < anchors; i++) {
    let best = 0;
    let classId = -1;
    for (let c = 0; c < numClasses; c++) {
      const s = out[(4 + c) * anchors + i];
      if (s > best) {
        best = s;
        classId = c;
      }
    }
    if (best < minConfidence) continue;
    const name = COCO_CLASSES[classId];
    if (farmObjectsOnly && !THREAT_CLASSES.has(name) && !VEHICLE_CLASSES.has(name)) continue;
    const cx = out[i];
    const cy = out[anchors + i];
    const bw = out[2 * anchors + i];
    const bh = out[3 * anchors + i];
    const x = Math.max(0, (cx - bw / 2 - padX) / scale);
    const y = Math.max(0, (cy - bh / 2 - padY) / scale);
    candidates.push({
      classId,
      score: best,
      x,
      y,
      w: Math.min(srcW - x, bw / scale),
      h: Math.min(srcH - y, bh / scale),
    });
  }

  // Class-aware non-maximum suppression
  candidates.sort((a, b) => b.score - a.score);
  const kept: Detection[] = [];
  for (const d of candidates) {
    if (kept.every((k) => k.classId !== d.classId || iou(k, d) < IOU_THRESHOLD)) kept.push(d);
    if (kept.length >= 50) break;
  }
  return { detections: kept, ms };
};
