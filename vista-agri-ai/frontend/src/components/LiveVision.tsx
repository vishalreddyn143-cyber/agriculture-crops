'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { Camera, CameraOff, ImageUp, Loader2, Video, ShieldAlert, Cpu } from 'lucide-react';

// YOLO11n (COCO, 80 classes) exported to ONNX: input [1,3,640,640], output [1,84,8400]
const MODEL_URL = '/models/yolo11n.onnx';
const INPUT_SIZE = 640;
const IOU_THRESHOLD = 0.45;
// A sighting must persist for this many frames before it raises an alert
const CONFIRM_FRAMES = 3;
// Wait this long before alerting again for the same kind of object
const ALERT_COOLDOWN_MS = 60_000;

const COCO_CLASSES = [
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
const THREAT_CLASSES = new Set(['elephant', 'bear', 'cow', 'horse', 'sheep', 'dog', 'cat', 'bird', 'person']);
// Shown on the feed but never alerted on
const VEHICLE_CLASSES = new Set(['bicycle', 'car', 'motorcycle', 'truck', 'bus']);

interface Detection {
  classId: number;
  score: number;
  // Box in source-pixel coordinates
  x: number;
  y: number;
  w: number;
  h: number;
  trackId?: number;
}

interface Track {
  id: number;
  classId: number;
  box: Detection;
  hits: number;
  missed: number;
  alerted: boolean;
}

type Source = 'none' | 'camera' | 'image' | 'video';
type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface VisionAlertResult {
  className: string;
  confidence: number;
  sirenTriggered: boolean;
  reported: boolean;
}

interface LiveVisionProps {
  apiBase: string;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onAlert: (result: VisionAlertResult) => void;
}

// The ONNX runtime and session are loaded once and shared across tab switches
let sessionPromise: Promise<{ ort: typeof import('onnxruntime-web'); session: InferenceSession }> | null = null;
const loadModel = () => {
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

const iou = (a: Detection, b: Detection) => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

export function LiveVision({ apiBase, apiFetch, onAlert }: LiveVisionProps) {
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelError, setModelError] = useState('');
  const [source, setSource] = useState<Source>('none');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [minConfidence, setMinConfidence] = useState(0.4);
  const [farmObjectsOnly, setFarmObjectsOnly] = useState(true);
  const [alertsSent, setAlertsSent] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoOverlayRef = useRef<HTMLCanvasElement>(null);
  const imageOverlayRef = useRef<HTMLCanvasElement>(null);
  const prepCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopIdRef = useRef(0);
  const tracksRef = useRef<Track[]>([]);
  const nextTrackIdRef = useRef(1);
  const lastAlertRef = useRef<Record<string, number>>({});
  // Read inside the detection loop, so kept in refs to always see current values
  const settingsRef = useRef({ minConfidence, farmObjectsOnly });
  const onAlertRef = useRef(onAlert);
  useEffect(() => {
    settingsRef.current = { minConfidence, farmObjectsOnly };
    onAlertRef.current = onAlert;
  });

  const ensureModel = async () => {
    setModelStatus('loading');
    try {
      const loaded = await loadModel();
      setModelStatus('ready');
      return loaded;
    } catch (err) {
      setModelStatus('error');
      setModelError(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  const stopAll = () => {
    loopIdRef.current++;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute('src');
    }
    tracksRef.current = [];
  };

  // Stop the camera and loop when leaving the tab
  useEffect(
    () => () => {
      loopIdRef.current++;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const resetView = (next: Source) => {
    stopAll();
    setDetections([]);
    setImageUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setSource(next);
  };

  // Letterbox the frame into 640x640 and run YOLO; returns boxes in source pixels
  const detect = async (
    loaded: { ort: typeof import('onnxruntime-web'); session: InferenceSession },
    el: HTMLVideoElement | HTMLImageElement,
    srcW: number,
    srcH: number,
  ): Promise<Detection[]> => {
    if (!prepCanvasRef.current) {
      prepCanvasRef.current = document.createElement('canvas');
      prepCanvasRef.current.width = INPUT_SIZE;
      prepCanvasRef.current.height = INPUT_SIZE;
    }
    const ctx = prepCanvasRef.current.getContext('2d', { willReadFrequently: true })!;
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
    setInferenceMs(Math.round(performance.now() - start));

    const output = results[loaded.session.outputNames[0]];
    const out = output.data as Float32Array;
    const anchors = output.dims[2];
    const numClasses = output.dims[1] - 4;
    const { minConfidence: threshold, farmObjectsOnly: farmOnly } = settingsRef.current;

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
      if (best < threshold) continue;
      const name = COCO_CLASSES[classId];
      if (farmOnly && !THREAT_CLASSES.has(name) && !VEHICLE_CLASSES.has(name)) continue;
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
    return kept;
  };

  // Match detections to the previous frame's tracks by overlap, so each object keeps an ID
  const updateTracks = (dets: Detection[]) => {
    const tracks = tracksRef.current;
    const matched = new Set<Track>();
    for (const d of dets) {
      let bestTrack: Track | undefined;
      let bestIou = 0.3;
      for (const t of tracks) {
        if (matched.has(t) || t.classId !== d.classId) continue;
        const overlap = iou(t.box, d);
        if (overlap > bestIou) {
          bestIou = overlap;
          bestTrack = t;
        }
      }
      if (bestTrack) {
        bestTrack.box = d;
        bestTrack.hits++;
        bestTrack.missed = 0;
      } else {
        bestTrack = { id: nextTrackIdRef.current++, classId: d.classId, box: d, hits: 1, missed: 0, alerted: false };
        tracks.push(bestTrack);
      }
      matched.add(bestTrack);
      d.trackId = bestTrack.id;
    }
    for (const t of tracks) if (!matched.has(t)) t.missed++;
    tracksRef.current = tracks.filter((t) => t.missed <= 5);
    return tracksRef.current;
  };

  const reportSighting = async (classId: number, score: number, trackId?: number) => {
    const className = COCO_CLASSES[classId];
    const now = Date.now();
    if (now - (lastAlertRef.current[className] || 0) < ALERT_COOLDOWN_MS) return;
    lastAlertRef.current[className] = now;
    setAlertsSent((n) => n + 1);
    let reported = false;
    let sirenTriggered = false;
    try {
      const res = await apiFetch(`${apiBase}/vision/detections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ className, confidence: Number(score.toFixed(3)), trackId }),
      });
      if (res.ok) {
        reported = true;
        sirenTriggered = Boolean((await res.json()).sirenTriggered);
      }
    } catch {
      // Backend unreachable: still alert the farmer locally
    }
    onAlertRef.current({ className, confidence: score, sirenTriggered, reported });
  };

  const draw = (canvas: HTMLCanvasElement | null, dets: Detection[], srcW: number, srcH: number) => {
    if (!canvas) return;
    if (canvas.width !== srcW || canvas.height !== srcH) {
      canvas.width = srcW;
      canvas.height = srcH;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, srcW, srcH);
    const line = Math.max(2, Math.round(srcW / 320));
    const font = Math.max(12, Math.round(srcW / 45));
    ctx.font = `bold ${font}px sans-serif`;
    ctx.textBaseline = 'top';
    for (const d of dets) {
      const name = COCO_CLASSES[d.classId];
      const color = THREAT_CLASSES.has(name) ? (name === 'person' ? '#f59e0b' : '#ef4444') : '#34d399';
      ctx.strokeStyle = color;
      ctx.lineWidth = line;
      ctx.strokeRect(d.x, d.y, d.w, d.h);
      const label = `${name}${d.trackId ? ` #${d.trackId}` : ''} ${Math.round(d.score * 100)}%`;
      const tw = ctx.measureText(label).width + 10;
      const ty = d.y - font - 8 < 0 ? d.y : d.y - font - 8;
      ctx.fillStyle = color;
      ctx.fillRect(d.x, ty, tw, font + 8);
      ctx.fillStyle = '#022c22';
      ctx.fillText(label, d.x + 5, ty + 4);
    }
  };

  // Runs detection on the playing video until the source changes
  const runVideoLoop = (loaded: { ort: typeof import('onnxruntime-web'); session: InferenceSession }) => {
    const loopId = ++loopIdRef.current;
    const step = async () => {
      const video = videoRef.current;
      if (loopId !== loopIdRef.current || !video) return;
      if (video.readyState >= 2 && !video.paused && video.videoWidth) {
        const dets = await detect(loaded, video, video.videoWidth, video.videoHeight);
        if (loopId !== loopIdRef.current) return;
        const tracks = updateTracks(dets);
        for (const t of tracks) {
          if (!t.alerted && t.missed === 0 && t.hits >= CONFIRM_FRAMES && THREAT_CLASSES.has(COCO_CLASSES[t.classId])) {
            t.alerted = true;
            reportSighting(t.classId, t.box.score, t.id);
          }
        }
        draw(videoOverlayRef.current, dets, video.videoWidth, video.videoHeight);
        setDetections(dets);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const startCamera = async () => {
    resetView('camera');
    const loaded = await ensureModel();
    if (!loaded) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      runVideoLoop(loaded);
    } catch (err) {
      setSource('none');
      setModelError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
          : `Could not open the camera: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleFile = async (file: File) => {
    const isVideo = file.type.startsWith('video/');
    resetView(isVideo ? 'video' : 'image');
    const url = URL.createObjectURL(file);
    const loaded = await ensureModel();
    if (!loaded) return;

    if (isVideo) {
      const video = videoRef.current!;
      video.src = url;
      video.loop = true;
      await video.play().catch(() => {});
      runVideoLoop(loaded);
      return;
    }

    setImageUrl(url);
    const img = imageRef.current!;
    img.src = url;
    await img.decode();
    const dets = await detect(loaded, img, img.naturalWidth, img.naturalHeight);
    // Assign IDs so the labels match the video view
    dets.forEach((d, i) => (d.trackId = i + 1));
    draw(imageOverlayRef.current, dets, img.naturalWidth, img.naturalHeight);
    setDetections(dets);
    // A still photo is a single confirmed frame: alert once per threat type found
    const seen = new Set<number>();
    for (const d of dets) {
      if (THREAT_CLASSES.has(COCO_CLASSES[d.classId]) && !seen.has(d.classId)) {
        seen.add(d.classId);
        reportSighting(d.classId, d.score, d.trackId);
      }
    }
  };

  const threats = detections.filter((d) => THREAT_CLASSES.has(COCO_CLASSES[d.classId]));

  return (
    <div className="space-y-6">
      <div className="bg-emerald-950/80 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-500/20 pb-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Video className="w-5 h-5 text-emerald-400" />
              Live Vision: Animal &amp; Intruder Detection
            </h2>
            <p className="text-xs text-emerald-200/80 mt-0.5">
              YOLO11n runs on this device, in your browser. Point a camera at the field or upload a photo or video.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {source === 'camera' ? (
              <button
                onClick={() => resetView('none')}
                className="bg-white/10 hover:bg-white/20 text-white font-bold text-xs px-4 py-2.5 rounded-xl border border-white/30 transition flex items-center gap-2"
              >
                <CameraOff className="w-4 h-4" /> Stop camera
              </button>
            ) : (
              <button
                onClick={startCamera}
                className="bg-white hover:bg-emerald-50 text-emerald-950 font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-lg transition flex items-center gap-2"
              >
                <Camera className="w-4 h-4" /> Start camera
              </button>
            )}
            <label className="cursor-pointer bg-emerald-800/60 hover:bg-emerald-700/60 text-white font-bold text-xs px-4 py-2.5 rounded-xl border border-emerald-500/40 transition flex items-center gap-2">
              <ImageUp className="w-4 h-4" /> Upload photo / video
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_280px] gap-5">
          <div className="relative w-full min-h-[300px] bg-black/60 rounded-2xl overflow-hidden border border-emerald-500/40 flex items-center justify-center">
            <div className={`relative w-full ${source === 'camera' || source === 'video' ? '' : 'hidden'}`}>
              <video ref={videoRef} muted playsInline className="block w-full h-auto" />
              <canvas ref={videoOverlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            </div>
            <div className={`relative w-full ${source === 'image' ? '' : 'hidden'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img ref={imageRef} src={imageUrl || undefined} alt="Uploaded field" className="block w-full h-auto" />
              <canvas ref={imageOverlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
            </div>

            {source === 'none' && modelStatus !== 'loading' && (
              <div className="text-center p-8 space-y-2">
                <Camera className="w-10 h-10 text-emerald-400 mx-auto" />
                <p className="text-sm font-bold text-white">No feed running</p>
                <p className="text-xs text-emerald-200/80 max-w-sm">
                  Start your phone or laptop camera, or upload a photo of cattle, goats, dogs, birds or people to test detection.
                </p>
              </div>
            )}
            {modelStatus === 'loading' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-950/80 text-white text-xs font-bold">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                Loading the detection model (about 11 MB, first time only)…
              </div>
            )}
            {(source === 'camera' || source === 'video') && (
              <span className="absolute top-3 left-3 bg-red-600 text-white font-black px-2.5 py-0.5 rounded-full text-[10px] animate-pulse">
                ● LIVE
              </span>
            )}
          </div>

          <div className="space-y-4">
            {(modelStatus === 'error' || modelError) && (
              <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/50 text-xs text-red-100">
                {modelError || 'The detection model failed to load.'}
              </div>
            )}

            <div className="p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 space-y-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-white">
                <Cpu className="w-4 h-4 text-emerald-400" /> Model status
              </div>
              <Row label="Model" value="YOLO11n · COCO-80" />
              <Row label="Status" value={{ idle: 'Not loaded', loading: 'Loading…', ready: 'Ready', error: 'Failed' }[modelStatus]} />
              <Row label="Inference" value={inferenceMs ? `${inferenceMs} ms / frame` : '-'} />
              <Row label="Alerts sent" value={String(alertsSent)} />
            </div>

            <div className="p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 space-y-3 text-xs">
              <label className="block text-emerald-200 font-bold">
                Min confidence: {Math.round(minConfidence * 100)}%
                <input
                  type="range"
                  min={0.2}
                  max={0.9}
                  step={0.05}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Number(e.target.value))}
                  className="w-full mt-1 accent-emerald-400"
                />
              </label>
              <label className="flex items-center gap-2 text-emerald-200 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={farmObjectsOnly}
                  onChange={(e) => setFarmObjectsOnly(e.target.checked)}
                  className="accent-emerald-400"
                />
                Farm objects only (animals, people, vehicles)
              </label>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-white">
                <ShieldAlert className="w-4 h-4 text-emerald-400" /> In view now ({detections.length})
              </div>
              {detections.length === 0 && <p className="text-emerald-200/70">Nothing detected.</p>}
              {detections.slice(0, 8).map((d, i) => {
                const name = COCO_CLASSES[d.classId];
                return (
                  <div key={i} className="flex justify-between">
                    <span className={THREAT_CLASSES.has(name) ? 'text-red-300 font-bold' : 'text-emerald-100'}>
                      {name} {d.trackId ? `#${d.trackId}` : ''}
                    </span>
                    <span className="text-emerald-200/80">{Math.round(d.score * 100)}%</span>
                  </div>
                );
              })}
              {threats.length > 0 && (
                <p className="pt-2 border-t border-emerald-500/20 text-red-200">
                  Alerts are sent when an animal or person stays in view for {CONFIRM_FRAMES} frames, at most once a minute per type.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-emerald-200/70">{label}</span>
      <span className="text-white font-bold">{value}</span>
    </div>
  );
}
