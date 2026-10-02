'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, ScanFace, X, CheckCircle2, AlertTriangle, Camera, RotateCcw } from 'lucide-react';

// face-api.js models, used only to compare the face in two photos once they are taken
const MODEL_URL = '/models/face';
// Size of the photo (square JPEG from the centre of the camera frame, about 30-60 KB)
const PHOTO_SIZE = 480;

type FaceApi = typeof import('@vladmandic/face-api');
type Step = 'starting' | 'camera' | 'checking' | 'review' | 'submitting' | 'matched' | 'done' | 'error';

let faceApiPromise: Promise<FaceApi> | null = null;
const loadFaceApi = () => {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = await import('@vladmandic/face-api');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })();
    faceApiPromise.catch(() => {
      faceApiPromise = null;
    });
  }
  return faceApiPromise;
};

// Takes a square photo from the centre of the current camera frame
const snapshot = (video: HTMLVideoElement) => {
  const side = Math.min(video.videoWidth, video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  canvas
    .getContext('2d')!
    .drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  return canvas;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FaceCaptureResult {
  error?: string;
  // Sign-in: the account's saved photo and how closely the new photo matched it
  savedPhoto?: string | null;
  similarity?: number;
}

interface FaceScanModalProps {
  mode: 'enroll' | 'login';
  // Receives the photo the user took and the face descriptor computed from it
  onCapture: (capture: { descriptor: number[]; photo: string }) => Promise<FaceCaptureResult>;
  // Called after the success screen has been shown
  onSuccess: () => void;
  onClose: () => void;
}

export function FaceScanModal({ mode, onCapture, onSuccess, onClose }: FaceScanModalProps) {
  const [step, setStep] = useState<Step>('starting');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [photo, setPhoto] = useState<{ dataUrl: string; descriptor: number[] } | null>(null);
  const [match, setMatch] = useState<{ saved: string | null; similarity: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const callbacksRef = useRef({ onCapture, onSuccess });
  useEffect(() => {
    callbacksRef.current = { onCapture, onSuccess };
  });

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Open the camera (and start loading the comparison models in the background)
  useEffect(() => {
    let cancelled = false;
    loadFaceApi().catch(() => {});
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (stream) => {
        // Closed while the permission prompt was open: release the camera we just got
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStep('camera');
      })
      .catch((err) => {
        if (cancelled) return;
        setStep('error');
        setError(
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Camera permission was denied. Allow camera access in your browser and try again.'
            : `Could not start the camera: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [attempt]);

  const takePhoto = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = snapshot(video);
    stopCamera();
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setPhoto({ dataUrl, descriptor: [] });
    setStep('checking');
    setMessage('Reading your photo…');

    let descriptor: number[];
    try {
      const faceapi = await loadFaceApi();
      const result = await faceapi
        .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!result) {
        setStep('error');
        setError('No face could be seen in that photo. Face the camera in good light and take it again.');
        return;
      }
      descriptor = Array.from(result.descriptor, (v) => Number(v.toFixed(5)));
    } catch (err) {
      setStep('error');
      setError(`Could not read the photo: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const taken = { dataUrl, descriptor };
    setPhoto(taken);
    if (mode === 'enroll') {
      setStep('review');
      return;
    }
    await submit(taken);
  };

  const submit = async (taken: { dataUrl: string; descriptor: number[] }) => {
    setStep('submitting');
    setMessage(mode === 'enroll' ? 'Saving your photo…' : 'Matching with your saved photo…');
    const result = await callbacksRef.current.onCapture({ descriptor: taken.descriptor, photo: taken.dataUrl });
    if (result.error) {
      setStep('error');
      setError(result.error);
      if (mode === 'login' && result.similarity !== undefined) setMatch({ saved: null, similarity: result.similarity });
      return;
    }
    if (mode === 'login') {
      setMatch({ saved: result.savedPhoto ?? null, similarity: result.similarity ?? 0 });
      setStep('matched');
      await sleep(1800);
    } else {
      setStep('done');
      setMessage('Photo saved');
      await sleep(1200);
    }
    callbacksRef.current.onSuccess();
  };

  const retake = () => {
    setError('');
    setMessage('');
    setPhoto(null);
    setMatch(null);
    setStep('starting');
    setAttempt((n) => n + 1);
  };

  const showCamera = !photo && step !== 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-md bg-emerald-950 border border-emerald-400/40 rounded-3xl shadow-2xl p-6 text-white">
        <button onClick={onClose} className="absolute top-4 right-4 text-emerald-200 hover:text-white" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-black flex items-center gap-2">
          <ScanFace className="w-5 h-5 text-emerald-400" />
          {mode === 'enroll' ? 'Set up photo sign-in' : 'Sign in with a photo'}
        </h2>
        <p className="text-xs text-emerald-200/80 mt-1">
          {mode === 'enroll'
            ? 'Take a photo of yourself. It is saved to your account, and sign-in photos are matched against it.'
            : 'Take a photo of yourself. It is matched against the photo saved to your account (95% needed).'}
        </p>

        {/* Camera (kept mounted while hidden so the stream has an element to attach to) */}
        <div className={`relative mx-auto mt-5 w-64 h-64 rounded-2xl overflow-hidden border-4 border-white/70 bg-black ${showCamera ? '' : 'hidden'}`}>
          <video ref={videoRef} muted playsInline className="w-full h-full object-cover -scale-x-100" />
          {step === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center bg-emerald-950/70">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
            </div>
          )}
        </div>

        {/* The photo just taken */}
        {photo && !(match && step === 'matched') && (
          <div className="relative mx-auto mt-5 w-64 h-64 rounded-2xl overflow-hidden border-4 border-emerald-400">
            {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
            <img src={photo.dataUrl} alt="Your photo" className="w-full h-full object-cover -scale-x-100" />
            {(step === 'checking' || step === 'submitting' || step === 'done') && (
              <div className="absolute inset-0 flex items-center justify-center bg-emerald-950/60">
                {step === 'done' ? <CheckCircle2 className="w-12 h-12 text-emerald-400" /> : <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />}
              </div>
            )}
          </div>
        )}

        {/* Sign-in result: saved photo next to the photo just taken */}
        {match && step === 'matched' && photo && (
          <div className="mt-5">
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Saved photo', src: match.saved },
                { label: 'Your photo now', src: photo.dataUrl },
              ].map(({ label, src }) => (
                <div key={label} className="text-center">
                  <div className="aspect-square rounded-2xl overflow-hidden border-2 border-emerald-400 bg-emerald-900">
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data URL
                      <img src={src} alt={label} className="w-full h-full object-cover -scale-x-100" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[11px] text-emerald-200/70">No photo</div>
                    )}
                  </div>
                  <p className="text-[11px] font-bold text-emerald-200 mt-1.5">{label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-center text-sm font-black text-emerald-300 flex items-center justify-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> {match.similarity}% match, signing you in…
            </p>
          </div>
        )}

        {step === 'error' ? (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-amber-200 bg-amber-950/60 border border-amber-500/40 rounded-xl px-3 py-2 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </p>
            <button onClick={retake} className="w-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black py-2.5 rounded-xl transition">
              Take another photo
            </button>
          </div>
        ) : step === 'review' ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={retake}
              className="bg-white/10 hover:bg-white/20 text-white font-bold py-2.5 rounded-xl border border-white/30 transition flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Retake
            </button>
            <button
              onClick={() => photo && submit(photo)}
              className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black py-2.5 rounded-xl transition flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> Save this photo
            </button>
          </div>
        ) : step === 'camera' ? (
          <button
            onClick={takePhoto}
            className="mt-5 w-full bg-white hover:bg-emerald-50 text-emerald-950 font-black py-3 rounded-xl shadow-lg transition flex items-center justify-center gap-2"
          >
            <Camera className="w-4 h-4" /> Take photo
          </button>
        ) : (
          message && <p className="mt-5 text-center text-sm font-bold text-emerald-100">{message}</p>
        )}
      </div>
    </div>
  );
}
