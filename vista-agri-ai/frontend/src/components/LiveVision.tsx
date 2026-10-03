'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ImageUp, Loader2, Video, ShieldAlert, Cpu, Cctv } from 'lucide-react';
import { CameraFeed, ConnectedCamera } from '@/components/CameraFeed';
import { COCO_CLASSES, THREAT_CLASSES, Detection, LoadedModel, loadModel, iou, detectFrame } from '@/lib/yolo';

// A sighting must persist for this many frames before it raises an alert
const CONFIRM_FRAMES = 3;
// Wait this long before alerting again for the same kind of object
const ALERT_COOLDOWN_MS = 60_000;

interface Track {
  id: number;
  classId: number;
  box: Detection;
  hits: number;
  missed: number;
  alerted: boolean;
}

type Source = 'none' | 'camera' | 'image' | 'video' | 'connected';
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
  // The farmer's connected cameras with AI alerts on (real accounts), and the one being watched
  const [connectedCameras, setConnectedCameras] = useState<ConnectedCamera[]>([]);
  const [activeCamera, setActiveCamera] = useState<ConnectedCamera | null>(null);
  const [streamNote, setStreamNote] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoOverlayRef = useRef<HTMLCanvasElement>(null);
  const imageOverlayRef = useRef<HTMLCanvasElement>(null);
  const streamOverlayRef = useRef<HTMLCanvasElement>(null);
  // The picture element of the connected camera being analysed
  const streamElRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  // Camera name and location sent with alerts
  const alertSourceRef = useRef<{ cameraName?: string; location?: string }>({});
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

  useEffect(() => {
    let cancelled = false;
    apiFetch(`${apiBase}/cameras`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.success) setConnectedCameras(data.cameras.filter((c: ConnectedCamera) => c.aiAlerts));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiBase, apiFetch]);

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
    streamElRef.current = null;
    alertSourceRef.current = {};
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
    setActiveCamera(null);
    setStreamNote('');
  };

  // Runs YOLO on one frame with the current settings and records the inference time
  const detect = async (loaded: LoadedModel, el: HTMLVideoElement | HTMLImageElement, srcW: number, srcH: number): Promise<Detection[]> => {
    const { detections, ms } = await detectFrame(loaded, el, srcW, srcH, settingsRef.current);
    setInferenceMs(ms);
    return detections;
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
        body: JSON.stringify({ className, confidence: Number(score.toFixed(3)), trackId, ...alertSourceRef.current }),
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

  // Runs detection on a playing video (or a live MJPEG image) until the source changes
  const runVideoLoop = (
    loaded: LoadedModel,
    getElement: () => HTMLVideoElement | HTMLImageElement | null = () => videoRef.current,
    overlay: () => HTMLCanvasElement | null = () => videoOverlayRef.current,
  ) => {
    const loopId = ++loopIdRef.current;
    const step = async () => {
      const el = getElement();
      if (loopId !== loopIdRef.current || !el) return;
      const isVideo = el instanceof HTMLVideoElement;
      const width = isVideo ? el.videoWidth : el.naturalWidth;
      const height = isVideo ? el.videoHeight : el.naturalHeight;
      const ready = isVideo ? el.readyState >= 2 && !el.paused : el.complete;
      if (ready && width) {
        let dets: Detection[];
        try {
          dets = await detect(loaded, el, width, height);
        } catch (err) {
          // A stream without CORS permission can be shown but not read by the page
          if (err instanceof DOMException && err.name === 'SecurityError') {
            setStreamNote('View only: this stream does not allow AI detection (the stream server must allow CORS).');
            return;
          }
          throw err;
        }
        if (loopId !== loopIdRef.current) return;
        const tracks = updateTracks(dets);
        for (const t of tracks) {
          if (!t.alerted && t.missed === 0 && t.hits >= CONFIRM_FRAMES && THREAT_CLASSES.has(COCO_CLASSES[t.classId])) {
            t.alerted = true;
            reportSighting(t.classId, t.box.score, t.id);
          }
        }
        draw(overlay(), dets, width, height);
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

  // Watch a connected camera; detection starts once its picture arrives
  const watchConnectedCamera = (cameraId: string) => {
    const camera = connectedCameras.find((c) => c.id === cameraId);
    resetView(camera ? 'connected' : 'none');
    if (!camera) return;
    setActiveCamera(camera);
    alertSourceRef.current = { cameraName: camera.name, location: camera.location };
    ensureModel();
  };

  const onConnectedFrame = async (el: HTMLVideoElement | HTMLImageElement, analysable: boolean) => {
    streamElRef.current = el;
    if (!analysable) {
      setStreamNote('View only: this stream does not allow AI detection (the stream server must allow CORS).');
      return;
    }
    const loaded = await loadModel().catch(() => null);
    if (!loaded || streamElRef.current !== el) return;
    setModelStatus('ready');
    runVideoLoop(loaded, () => streamElRef.current, () => streamOverlayRef.current);
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
            {connectedCameras.length > 0 && (
              <label className="flex items-center gap-2 bg-emerald-900/60 border border-emerald-500/40 rounded-xl px-3 py-1.5 text-xs font-bold text-white">
                <Cctv className="w-4 h-4 text-emerald-300" />
                <select
                  value={activeCamera?.id || ''}
                  onChange={(e) => watchConnectedCamera(e.target.value)}
                  className="bg-transparent focus:outline-none text-white"
                  aria-label="Watch a connected camera"
                >
                  <option value="" className="text-emerald-950">
                    My cameras…
                  </option>
                  {connectedCameras.map((c) => (
                    <option key={c.id} value={c.id} className="text-emerald-950">
                      {c.name}
                      {c.location ? ` (${c.location})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            {source === 'connected' && activeCamera && (
              <div className="relative w-full">
                <CameraFeed
                  key={activeCamera.id}
                  source={activeCamera}
                  onElement={onConnectedFrame}
                  overlay={<canvas ref={streamOverlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />}
                />
                <span className="absolute top-3 right-3 bg-black/70 text-white font-bold px-2.5 py-0.5 rounded-full text-[10px]">
                  {activeCamera.name}
                </span>
                {streamNote && (
                  <span className="absolute bottom-3 left-3 right-3 bg-black/75 text-amber-100 font-bold px-3 py-1.5 rounded-lg text-[11px]">
                    {streamNote}
                  </span>
                )}
              </div>
            )}
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
                  Start your phone or laptop camera, pick one of your connected cameras, or upload a photo of cattle, goats, dogs, birds or people to test detection.
                </p>
              </div>
            )}
            {modelStatus === 'loading' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-950/80 text-white text-xs font-bold">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                Loading the detection model (about 11 MB, first time only)…
              </div>
            )}
            {(source === 'camera' || source === 'video' || source === 'connected') && (
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
