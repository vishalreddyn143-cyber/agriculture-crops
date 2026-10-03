'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Loader2, VideoOff } from 'lucide-react';

export type CameraType = 'device' | 'hls' | 'mjpeg';

export interface CameraSource {
  type: CameraType;
  streamUrl?: string | null;
  deviceId?: string | null;
}

export interface ConnectedCamera extends CameraSource {
  id: string;
  name: string;
  location: string;
  deviceLabel: string | null;
  aiAlerts: boolean;
  createdAt: string;
}

export type FeedStatus = { state: 'connecting' } | { state: 'live'; note?: string } | { state: 'error'; message: string };

interface CameraFeedProps {
  source: CameraSource;
  // Called with the element showing the picture once frames arrive. `analysable` is false when the
  // stream server does not allow the page to read pixels (CORS), so AI detection can't run on it.
  onElement?: (el: HTMLVideoElement | HTMLImageElement, analysable: boolean) => void;
  onStatus?: (status: FeedStatus) => void;
  // Extra elements drawn over the picture, e.g. detection boxes
  overlay?: React.ReactNode;
  className?: string;
}

// Shows one camera: this device's camera, an HLS stream or an MJPEG stream
export function CameraFeed({ source, onElement, onStatus, overlay, className = '' }: CameraFeedProps) {
  const [status, setStatus] = useState<FeedStatus>({ state: 'connecting' });
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const callbacksRef = useRef({ onElement, onStatus });
  useEffect(() => {
    callbacksRef.current = { onElement, onStatus };
  });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let hls: { destroy: () => void } | null = null;
    const report = (next: FeedStatus) => {
      if (cancelled) return;
      setStatus(next);
      callbacksRef.current.onStatus?.(next);
    };
    report({ state: 'connecting' });

    const startDevice = async () => {
      const video = videoRef.current!;
      let note: string | undefined;
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: source.deviceId ? { deviceId: { exact: source.deviceId } } : { facingMode: { ideal: 'environment' } },
            audio: false,
          });
        } catch (err) {
          // Camera ids only exist on the device that saved them; fall back to this device's camera
          if (!(err instanceof DOMException && err.name === 'OverconstrainedError') && !(err instanceof DOMException && err.name === 'NotFoundError')) throw err;
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          note = 'The saved camera is not on this device, so this device’s camera is shown.';
        }
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        video.srcObject = stream;
        await video.play();
        report({ state: 'live', note });
        callbacksRef.current.onElement?.(video, true);
      } catch (err) {
        report({
          state: 'error',
          message:
            err instanceof DOMException && err.name === 'NotAllowedError'
              ? 'Camera permission was denied. Allow camera access in your browser.'
              : `Could not open the camera: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    };

    const startHls = async () => {
      const video = videoRef.current!;
      const url = source.streamUrl!;
      video.crossOrigin = 'anonymous';
      const onPlaying = () => {
        report({ state: 'live' });
        callbacksRef.current.onElement?.(video, true);
      };
      video.addEventListener('playing', onPlaying, { once: true });
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari plays HLS natively
        video.src = url;
        video.onerror = () => report({ state: 'error', message: 'Could not play this stream. Check the link and that the camera is online.' });
        video.play().catch(() => {});
        return;
      }
      const { default: Hls } = await import('hls.js');
      if (cancelled) return;
      if (!Hls.isSupported()) {
        report({ state: 'error', message: 'This browser cannot play HLS streams.' });
        return;
      }
      const player = new Hls({ lowLatencyMode: true });
      hls = player;
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        report({
          state: 'error',
          message:
            data.type === Hls.ErrorTypes.NETWORK_ERROR
              ? 'Could not reach the stream. Check the link, that the camera is online, and that the stream server allows this website (CORS).'
              : 'The stream could not be played.',
        });
      });
      player.loadSource(url);
      player.attachMedia(video);
      video.play().catch(() => {});
    };

    const startMjpeg = () => {
      const img = imgRef.current!;
      const url = source.streamUrl!;
      // First ask for CORS access (needed for AI detection); if the server refuses, show it view-only
      let triedCors = false;
      const load = (withCors: boolean) => {
        triedCors = withCors;
        if (withCors) img.crossOrigin = 'anonymous';
        else img.removeAttribute('crossorigin');
        img.src = url;
      };
      img.onload = () => {
        report({ state: 'live', note: triedCors ? undefined : 'View only: the stream server does not allow AI detection (CORS).' });
        callbacksRef.current.onElement?.(img, triedCors);
      };
      img.onerror = () => {
        if (triedCors) load(false);
        else report({ state: 'error', message: 'Could not load the stream. Check the link and that the camera is online.' });
      };
      load(true);
    };

    if (source.type === 'device') startDevice();
    else if (!source.streamUrl) report({ state: 'error', message: 'No stream link saved for this camera.' });
    else if (source.type === 'hls') startHls();
    else startMjpeg();

    const video = videoRef.current;
    const img = imgRef.current;
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      hls?.destroy();
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.srcObject = null;
      }
      if (img) {
        // Stops the browser holding an MJPEG connection open
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
      }
    };
  }, [source.type, source.streamUrl, source.deviceId]);

  return (
    <div className={`relative bg-black overflow-hidden ${className}`}>
      {source.type === 'mjpeg' ? (
        // eslint-disable-next-line @next/next/no-img-element -- live MJPEG stream, not a static image
        <img ref={imgRef} alt="Camera stream" className={`block w-full h-auto ${status.state === 'live' ? '' : 'invisible'}`} />
      ) : (
        <video ref={videoRef} muted playsInline className={`block w-full h-auto ${status.state === 'live' ? '' : 'invisible'}`} />
      )}
      {status.state === 'live' && overlay}
      {status.state === 'connecting' && (
        <div className="absolute inset-0 min-h-40 flex items-center justify-center gap-2 text-xs font-bold text-emerald-100">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" /> Connecting…
        </div>
      )}
      {status.state === 'error' && (
        <div className="absolute inset-0 min-h-40 flex flex-col items-center justify-center gap-2 p-4 text-center text-xs text-amber-100">
          <VideoOff className="w-6 h-6 text-amber-300" />
          {status.message}
        </div>
      )}
      {status.state === 'live' && status.note && (
        <span className="absolute bottom-2 left-2 right-2 text-[10px] font-bold bg-black/70 text-amber-100 px-2 py-1 rounded-md">{status.note}</span>
      )}
    </div>
  );
}
