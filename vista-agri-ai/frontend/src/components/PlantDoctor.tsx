'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Leaf,
  Camera,
  ImageUp,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Bug,
  Droplets,
  Sun,
  Thermometer,
  Sprout,
  CalendarDays,
  Ruler,
  FlaskConical,
  Lightbulb,
  AlertTriangle,
  RotateCcw,
  X,
} from 'lucide-react';

// Longest side of the photo sent for analysis; keeps uploads around 150-300 KB
const MAX_IMAGE_SIDE = 1024;

interface PlantAnalysis {
  isPlant: boolean;
  plantName: string;
  scientificName: string;
  identificationConfidence: number;
  healthStatus: 'HEALTHY' | 'DISEASED' | 'PEST_DAMAGE' | 'NUTRIENT_DEFICIENCY' | 'WATER_STRESS' | 'UNCERTAIN';
  healthScore: number;
  summary: string;
  diagnosis: {
    name: string;
    cause: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    symptomsSeen: string[];
    spreadRisk: string;
  } | null;
  treatment: {
    immediateActions: string[];
    organic: string[];
    chemical: string[];
    prevention: string[];
  } | null;
  growingGuide: {
    season: string;
    climate: string;
    soil: string;
    sunlight: string;
    watering: string;
    fertilizer: string;
    spacing: string;
    timeToHarvest: string;
    commonProblems: string[];
  } | null;
  tips: string[];
}

const STATUS_STYLE: Record<PlantAnalysis['healthStatus'], { label: string; className: string }> = {
  HEALTHY: { label: 'Healthy', className: 'bg-emerald-400 text-emerald-950' },
  DISEASED: { label: 'Diseased', className: 'bg-red-500 text-white' },
  PEST_DAMAGE: { label: 'Pest damage', className: 'bg-orange-500 text-white' },
  NUTRIENT_DEFICIENCY: { label: 'Nutrient deficiency', className: 'bg-amber-400 text-amber-950' },
  WATER_STRESS: { label: 'Water stress', className: 'bg-sky-400 text-sky-950' },
  UNCERTAIN: { label: 'Unclear photo', className: 'bg-slate-400 text-slate-950' },
};

// Scales the photo down and re-encodes it as JPEG
const toJpegDataUrl = (source: CanvasImageSource, width: number, height: number) => {
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
};

interface PlantDoctorProps {
  apiBase: string;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  language: string;
}

export function PlantDoctor({ apiBase, apiFetch, language }: PlantDoctorProps) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<PlantAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [cameraOn, setCameraOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  };

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const analyze = async (dataUrl: string) => {
    setPhoto(dataUrl);
    setAnalysis(null);
    setError('');
    setIsAnalyzing(true);
    try {
      const res = await apiFetch(`${apiBase}/plant/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, language }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) setError(data.message || 'Could not analyse this photo.');
      else setAnalysis(data.analysis);
    } catch {
      setError('Cannot reach the VISTA server. Please check your connection.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose a photo (JPEG, PNG or WebP).');
      return;
    }
    stopCamera();
    try {
      const bitmap = await createImageBitmap(file);
      analyze(toJpegDataUrl(bitmap, bitmap.width, bitmap.height));
      bitmap.close();
    } catch {
      setError('Could not read that photo. Try a JPEG or PNG.');
    }
  };

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOn(true);
      setPhoto(null);
      setAnalysis(null);
      // The video element mounts on the next render
      requestAnimationFrame(async () => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access, or upload a photo instead.'
          : 'Could not open the camera. Upload a photo instead.',
      );
    }
  };

  const snap = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const dataUrl = toJpegDataUrl(video, video.videoWidth, video.videoHeight);
    stopCamera();
    analyze(dataUrl);
  };

  const reset = () => {
    stopCamera();
    setPhoto(null);
    setAnalysis(null);
    setError('');
  };

  return (
    <div className="space-y-6">
      <div className="bg-emerald-950/80 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-500/20 pb-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Leaf className="w-5 h-5 text-emerald-400" />
              Plant Doctor
            </h2>
            <p className="text-xs text-emerald-200/80 mt-0.5">
              Photograph a leaf or plant to check its health, find diseases or pests, and get a full growing guide.
            </p>
          </div>
          {(photo || cameraOn) && !isAnalyzing && (
            <button
              onClick={reset}
              className="bg-white/10 hover:bg-white/20 text-white font-bold text-xs px-4 py-2.5 rounded-xl border border-white/30 transition flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> New photo
            </button>
          )}
        </div>

        {!photo && !cameraOn && (
          <div className="grid sm:grid-cols-3 gap-3">
            {/* On phones `capture` opens the rear camera directly */}
            <label className="cursor-pointer p-5 rounded-2xl bg-white text-emerald-950 hover:bg-emerald-50 transition flex flex-col items-center gap-2 text-center shadow-lg">
              <Camera className="w-7 h-7" />
              <span className="font-black text-sm">Take photo</span>
              <span className="text-[11px] text-emerald-800">Opens your phone camera</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <label className="cursor-pointer p-5 rounded-2xl bg-emerald-900/50 hover:bg-emerald-800/60 border border-emerald-500/40 transition flex flex-col items-center gap-2 text-center">
              <ImageUp className="w-7 h-7 text-emerald-300" />
              <span className="font-black text-sm text-white">Upload photo</span>
              <span className="text-[11px] text-emerald-200/80">From your gallery or computer</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              onClick={startCamera}
              className="p-5 rounded-2xl bg-emerald-900/50 hover:bg-emerald-800/60 border border-emerald-500/40 transition flex flex-col items-center gap-2 text-center"
            >
              <Leaf className="w-7 h-7 text-emerald-300" />
              <span className="font-black text-sm text-white">Live camera</span>
              <span className="text-[11px] text-emerald-200/80">Scan with your laptop or webcam</span>
            </button>
          </div>
        )}

        {cameraOn && (
          <div className="space-y-3">
            <div className="relative rounded-2xl overflow-hidden border border-emerald-500/40 bg-black">
              <video ref={videoRef} muted playsInline className="block w-full max-h-[420px] object-contain" />
              <div className="absolute inset-8 border-2 border-dashed border-white/60 rounded-2xl pointer-events-none" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={snap}
                className="flex-1 bg-white hover:bg-emerald-50 text-emerald-950 font-black py-3 rounded-xl shadow-lg transition flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" /> Capture &amp; analyse
              </button>
              <button
                onClick={stopCamera}
                className="px-4 bg-white/10 hover:bg-white/20 text-white rounded-xl border border-white/30"
                aria-label="Close camera"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[11px] text-emerald-200/80 text-center">
              Fill the frame with one leaf or plant, in daylight, with the affected part in focus.
            </p>
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-amber-200 bg-amber-950/60 border border-amber-500/40 rounded-xl px-3 py-2 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        {photo && (
          <div className="grid lg:grid-cols-[320px_1fr] gap-6">
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
              <img src={photo} alt="Plant photo" className="w-full rounded-2xl border border-emerald-500/40" />
              {isAnalyzing && (
                <div className="flex items-center gap-2 text-sm text-emerald-100 font-bold">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> Examining the plant…
                </div>
              )}
            </div>
            {analysis && <AnalysisReport analysis={analysis} />}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisReport({ analysis }: { analysis: PlantAnalysis }) {
  if (!analysis.isPlant) {
    return (
      <div className="p-5 rounded-2xl bg-amber-950/50 border border-amber-500/40 text-amber-100 text-sm">
        No plant was found in this photo. Take a closer picture of a leaf, stem or fruit.
      </div>
    );
  }
  const status = STATUS_STYLE[analysis.healthStatus] || STATUS_STYLE.UNCERTAIN;
  const score = Math.max(0, Math.min(100, Math.round(analysis.healthScore)));
  const guide = analysis.growingGuide;

  return (
    <div className="space-y-4 text-sm">
      <div className="p-5 rounded-2xl bg-emerald-900/40 border border-emerald-500/30">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-2xl font-black text-white">{analysis.plantName}</h3>
            <p className="text-xs italic text-emerald-200/80">
              {analysis.scientificName}
              {analysis.identificationConfidence > 0 && ` • ${Math.round(analysis.identificationConfidence * 100)}% sure`}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5 ${status.className}`}>
            {analysis.healthStatus === 'HEALTHY' ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
            {status.label}
          </span>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs font-bold text-emerald-200 mb-1">
            <span>Health score</span>
            <span className="text-white">{score}/100</span>
          </div>
          <div className="h-2 rounded-full bg-emerald-950 overflow-hidden">
            <div
              className={`h-full ${score >= 75 ? 'bg-emerald-400' : score >= 45 ? 'bg-amber-400' : 'bg-red-500'}`}
              style={{ width: `${score}%` }}
            />
          </div>
        </div>
        <p className="mt-4 text-emerald-50 leading-relaxed">{analysis.summary}</p>
      </div>

      {analysis.diagnosis && (
        <div className="p-5 rounded-2xl bg-red-950/40 border border-red-500/40">
          <h4 className="font-black text-white flex items-center gap-2">
            <Bug className="w-4 h-4 text-red-300" /> {analysis.diagnosis.name}
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-red-500/30 text-red-100 font-black">
              {analysis.diagnosis.severity} SEVERITY
            </span>
          </h4>
          <p className="text-xs text-red-100/90 mt-1">Cause: {analysis.diagnosis.cause}</p>
          <List title="What we see" items={analysis.diagnosis.symptomsSeen} />
          {analysis.diagnosis.spreadRisk && <p className="mt-3 text-xs text-red-100/90">Spread risk: {analysis.diagnosis.spreadRisk}</p>}
        </div>
      )}

      {analysis.treatment && (
        <div className="p-5 rounded-2xl bg-emerald-900/40 border border-emerald-500/30">
          <h4 className="font-black text-white flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-emerald-300" /> Treatment plan
          </h4>
          <div className="grid sm:grid-cols-2 gap-x-6">
            <List title="Do this now" items={analysis.treatment.immediateActions} />
            <List title="Organic options" items={analysis.treatment.organic} />
            <List title="Chemical options" items={analysis.treatment.chemical} />
            <List title="Prevent it next time" items={analysis.treatment.prevention} />
          </div>
        </div>
      )}

      {guide && (
        <div className="p-5 rounded-2xl bg-emerald-900/40 border border-emerald-500/30">
          <h4 className="font-black text-white flex items-center gap-2">
            <Sprout className="w-4 h-4 text-emerald-300" /> How to grow {analysis.plantName}
          </h4>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <GuideItem icon={<CalendarDays className="w-4 h-4" />} label="Season" value={guide.season} />
            <GuideItem icon={<Thermometer className="w-4 h-4" />} label="Climate" value={guide.climate} />
            <GuideItem icon={<Sprout className="w-4 h-4" />} label="Soil" value={guide.soil} />
            <GuideItem icon={<Sun className="w-4 h-4" />} label="Sunlight" value={guide.sunlight} />
            <GuideItem icon={<Droplets className="w-4 h-4" />} label="Watering" value={guide.watering} />
            <GuideItem icon={<FlaskConical className="w-4 h-4" />} label="Fertilizer" value={guide.fertilizer} />
            <GuideItem icon={<Ruler className="w-4 h-4" />} label="Spacing" value={guide.spacing} />
            <GuideItem icon={<CalendarDays className="w-4 h-4" />} label="Time to harvest" value={guide.timeToHarvest} />
          </div>
          <List title="Common problems" items={guide.commonProblems} />
        </div>
      )}

      {analysis.tips?.length > 0 && (
        <div className="p-5 rounded-2xl bg-emerald-900/40 border border-emerald-500/30">
          <h4 className="font-black text-white flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-300" /> Tips
          </h4>
          <List items={analysis.tips} />
        </div>
      )}

      <p className="text-[11px] text-emerald-200/70">
        This is an AI estimate from one photo. Before spraying chemicals, confirm the diagnosis with your local agriculture officer or Krishi Vigyan Kendra.
      </p>
    </div>
  );
}

function List({ title, items }: { title?: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3">
      {title && <p className="text-[11px] font-black uppercase tracking-wide text-emerald-300 mb-1">{title}</p>}
      <ul className="space-y-1 text-emerald-50">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-emerald-400">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuideItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/20">
      <p className="text-[11px] font-black uppercase tracking-wide text-emerald-300 flex items-center gap-1.5">
        {icon} {label}
      </p>
      <p className="text-emerald-50 mt-1">{value}</p>
    </div>
  );
}
