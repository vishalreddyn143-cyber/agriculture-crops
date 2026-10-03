'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Radio,
  Smartphone,
  MonitorPlay,
  Loader2,
  StopCircle,
  RefreshCw,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Eye,
  SwitchCamera,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { CameraHealthMonitor, CameraIssue, HealthMetrics, ISSUE_TEXT } from '@/lib/cameraHealth';
import { COCO_CLASSES, THREAT_CLASSES, Detection, loadModel, detectFrame } from '@/lib/yolo';

// STUN finds each device's public address; a TURN relay (optional env vars) is needed on networks
// that block direct connections, such as some mobile data networks
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ...(process.env.NEXT_PUBLIC_TURN_URL
    ? [{ urls: process.env.NEXT_PUBLIC_TURN_URL, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL }]
    : []),
];
// The streaming device checks in this often (the server forgets streams silent for 20 s)
const POLL_MS = 2000;
// Camera health is checked this often on the watching device
const HEALTH_MS = 500;
// Animal detection runs this often on the watching device
const DETECT_MS = 1200;
// Wait this long before alerting again about the same problem
const ISSUE_COOLDOWN_MS = 2 * 60 * 1000;
const ANIMAL_COOLDOWN_MS = 60 * 1000;

interface StreamInfo {
  id: string;
  deviceName: string;
  status: 'waiting' | 'connected';
  createdAt: string;
}

interface DeviceStreamProps {
  apiBase: string;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  // A camera problem or animal was found on the watched stream (for the chime and toast)
  onAlert: (message: string) => void;
}

// A friendly default name for this device
const guessDeviceName = () => {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'My device';
};

// Waits until the browser has gathered its network addresses, so one SDP carries them all
const gatherIce = (pc: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    pc.addEventListener('icegatheringstatechange', check);
    // Don't wait forever on networks with slow address lookups
    setTimeout(done, 4000);
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function DeviceStream({ apiBase, apiFetch, onAlert }: DeviceStreamProps) {
  const [mode, setMode] = useState<'choose' | 'stream' | 'watch'>('choose');

  return (
    <div className="space-y-6">
      <div className="bg-emerald-950/80 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-500/20 pb-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Radio className="w-5 h-5 text-emerald-400" />
              Device Live Stream
            </h2>
            <p className="text-xs text-emerald-200/80 mt-0.5">
              Signed in on two devices? Stream one device&apos;s camera live to the other, which watches for a covered, moved or
              blocked camera, and for animals.
            </p>
          </div>
          {mode !== 'choose' && (
            <button
              onClick={() => setMode('choose')}
              className="bg-white/10 hover:bg-white/20 text-white font-bold text-xs px-4 py-2.5 rounded-xl border border-white/30"
            >
              Back
            </button>
          )}
        </div>

        {mode === 'choose' && (
          <div className="grid sm:grid-cols-2 gap-4">
            <button
              onClick={() => setMode('stream')}
              className="text-left p-6 rounded-2xl bg-white text-emerald-950 hover:bg-emerald-50 shadow-lg transition"
            >
              <Smartphone className="w-8 h-8" />
              <p className="font-black text-lg mt-3">Stream from this device</p>
              <p className="text-xs text-emerald-800 mt-1">
                Use this phone or laptop as a field camera. Mount it facing the field and keep this page open.
              </p>
            </button>
            <button
              onClick={() => setMode('watch')}
              className="text-left p-6 rounded-2xl bg-emerald-900/50 border border-emerald-400/40 hover:border-white text-white transition"
            >
              <MonitorPlay className="w-8 h-8 text-emerald-300" />
              <p className="font-black text-lg mt-3">Watch my other device</p>
              <p className="text-xs text-emerald-200/80 mt-1">
                See the live picture from your streaming device, with alerts if its camera is covered, moved, blocked or blurry.
              </p>
            </button>
          </div>
        )}

        {mode === 'stream' && <Broadcaster apiBase={apiBase} apiFetch={apiFetch} />}
        {mode === 'watch' && <Viewer apiBase={apiBase} apiFetch={apiFetch} onAlert={onAlert} />}
      </div>
    </div>
  );
}

/* ============================================================
   STREAMING DEVICE
============================================================ */
function Broadcaster({ apiBase, apiFetch }: Omit<DeviceStreamProps, 'onAlert'>) {
  const [deviceName, setDeviceName] = useState(guessDeviceName);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [state, setState] = useState<'idle' | 'starting' | 'waiting' | 'live' | 'error'>('idle');
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const runRef = useRef<{ stop: () => void } | null>(null);

  // Stop streaming when leaving the screen
  useEffect(() => () => runRef.current?.stop(), []);

  const start = async () => {
    setError('');
    setState('starting');
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      setState('error');
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings.'
          : `Could not open the camera: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }
    videoRef.current!.srcObject = media;
    videoRef.current!.play().catch(() => {});

    let stopped = false;
    let streamId: string | null = null;
    let pc: RTCPeerConnection | null = null;
    let wakeLock: { release: () => Promise<void> } | null = null;
    // Keep the phone screen awake while streaming, where the browser allows it. Not awaited: some
    // browsers only answer once the page is visible, and streaming must not wait for that.
    (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((lock) => {
        if (stopped) lock.release().catch(() => {});
        else wakeLock = lock;
      })
      .catch(() => {
        // Not supported or not allowed: the farmer may need to keep the screen on manually
      });

    // Prepare a fresh connection and publish its offer, so the next viewer can join
    const arm = async () => {
      pc?.close();
      const conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pc = conn;
      media.getTracks().forEach((t) => conn.addTrack(t, media));
      await conn.setLocalDescription(await conn.createOffer());
      await gatherIce(conn);
      const offer = conn.localDescription!.sdp;
      const res = streamId
        ? await apiFetch(`${apiBase}/live/streams/${streamId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offer }),
          })
        : await apiFetch(`${apiBase}/live/streams`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceName, offer }),
          });
      const data = await res.json();
      if (!res.ok || !data.success) {
        // The server forgot this stream (e.g. after a long pause): start a new one
        if (res.status === 404 && streamId) {
          streamId = null;
          return arm();
        }
        throw new Error(data.message || 'Could not start the stream.');
      }
      streamId = data.stream.id;
      conn.onconnectionstatechange = () => {
        if (conn !== pc || stopped) return;
        if (conn.connectionState === 'connected') setState('live');
        // The viewer left or the network dropped: open the stream to the next viewer
        if (['failed', 'closed'].includes(conn.connectionState)) {
          setState('waiting');
          arm().catch(() => {});
        }
      };
      if (!stopped) setState('waiting');
    };

    const stop = () => {
      stopped = true;
      pc?.close();
      media.getTracks().forEach((t) => t.stop());
      wakeLock?.release().catch(() => {});
      if (streamId) {
        // keepalive lets the request finish even if the page is closing
        apiFetch(`${apiBase}/live/streams/${streamId}`, { method: 'DELETE', keepalive: true }).catch(() => {});
      }
    };
    runRef.current = { stop };

    try {
      await arm();
    } catch (err) {
      stop();
      setState('error');
      setError(err instanceof Error ? err.message : String(err));
      return;
    }

    // Check in regularly and pick up a viewer's answer
    while (!stopped) {
      await sleep(POLL_MS);
      if (stopped || !streamId) continue;
      try {
        const res = await apiFetch(`${apiBase}/live/streams/${streamId}/poll`, { method: 'POST' });
        const data = await res.json();
        if (res.status === 404) {
          streamId = null;
          await arm();
          continue;
        }
        const conn = pc as RTCPeerConnection | null;
        if (data.success && data.status === 'connected' && data.answer && conn && !conn.currentRemoteDescription) {
          await conn.setRemoteDescription({ type: 'answer', sdp: data.answer });
        }
      } catch {
        // Network hiccup: try again on the next check-in
      }
    }
  };

  const stopStreaming = () => {
    runRef.current?.stop();
    runRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState('idle');
  };

  const active = state === 'waiting' || state === 'live' || state === 'starting';

  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-5">
      <div className="relative bg-black rounded-2xl overflow-hidden border border-emerald-500/40 min-h-[260px] flex items-center justify-center">
        <video ref={videoRef} muted playsInline className={`block w-full h-auto ${active ? '' : 'hidden'}`} />
        {!active && (
          <div className="text-center p-8 space-y-2">
            <Smartphone className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-sm font-bold text-white">Camera off</p>
            <p className="text-xs text-emerald-200/80">Start streaming to share this camera with your other signed-in device.</p>
          </div>
        )}
        {state === 'live' && (
          <span className="absolute top-3 left-3 bg-red-600 text-white font-black px-2.5 py-0.5 rounded-full text-[10px] animate-pulse">
            ● LIVE
          </span>
        )}
      </div>

      <div className="space-y-4 text-xs">
        <div className="p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 space-y-3">
          <label className="block">
            <span className="block font-bold text-emerald-200 mb-1">Device name</span>
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              disabled={active}
              maxLength={60}
              className="w-full bg-emerald-950/60 border border-emerald-500/30 rounded-xl px-3 py-2 text-sm text-white disabled:opacity-60"
            />
          </label>
          <button
            onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
            disabled={active}
            className="w-full px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <SwitchCamera className="w-4 h-4" /> {facing === 'environment' ? 'Back camera' : 'Front camera'}
          </button>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 space-y-2">
          <p className="font-bold text-white flex items-center gap-2">
            {state === 'live' ? <Wifi className="w-4 h-4 text-emerald-400" /> : <WifiOff className="w-4 h-4 text-emerald-200/60" />}
            {
              {
                idle: 'Not streaming',
                starting: 'Starting…',
                waiting: 'Live: waiting for your other device to watch',
                live: 'Streaming to your other device',
                error: 'Stopped',
              }[state]
            }
          </p>
          {state === 'waiting' && (
            <p className="text-emerald-200/80">
              On your other device, sign in to this account and open <b>Device Live Stream → Watch my other device</b>.
            </p>
          )}
          {error && <p className="text-amber-200">{error}</p>}
        </div>

        {active ? (
          <button
            onClick={stopStreaming}
            className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-black flex items-center justify-center gap-2"
          >
            <StopCircle className="w-4 h-4" /> Stop streaming
          </button>
        ) : (
          <button
            onClick={start}
            className="w-full py-3 rounded-xl bg-white hover:bg-emerald-50 text-emerald-950 font-black shadow-lg flex items-center justify-center gap-2"
          >
            <Radio className="w-4 h-4" /> Start streaming
          </button>
        )}
        <p className="text-[11px] text-emerald-200/70">Keep this page open and the device charging. The video goes directly to your other device.</p>
      </div>
    </div>
  );
}

/* ============================================================
   WATCHING DEVICE
============================================================ */
function Viewer({ apiBase, apiFetch, onAlert }: DeviceStreamProps) {
  const [streams, setStreams] = useState<StreamInfo[] | null>(null);
  const [listError, setListError] = useState('');
  const [watching, setWatching] = useState<StreamInfo | null>(null);
  const [conn, setConn] = useState<'connecting' | 'live' | 'lost' | 'error'>('connecting');
  const [connError, setConnError] = useState('');
  const [calibrating, setCalibrating] = useState(true);
  const [issues, setIssues] = useState<Array<CameraIssue | 'lost'>>([]);
  const [metrics, setMetrics] = useState<HealthMetrics | null>(null);
  const [animalDetection, setAnimalDetection] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [alertLog, setAlertLog] = useState<Array<{ time: string; text: string }>>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const monitorRef = useRef<CameraHealthMonitor | null>(null);
  const lastAlertRef = useRef<Record<string, number>>({});
  const animalSeenRef = useRef<Record<string, number>>({});
  // Set once the streaming device has ended its stream on purpose
  const endedRef = useRef(false);
  const onAlertRef = useRef(onAlert);
  useEffect(() => {
    onAlertRef.current = onAlert;
  });

  // Keep the list of this account's streaming devices fresh while choosing
  useEffect(() => {
    if (watching) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiFetch(`${apiBase}/live/streams`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.success) setListError(data.message || 'Could not load your devices.');
        else {
          setListError('');
          setStreams(data.streams);
        }
      } catch {
        if (!cancelled) setListError('Cannot reach the VISTA server.');
      }
    };
    load();
    const timer = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [watching, apiBase, apiFetch]);

  // Is the device still streaming? (false once it has ended its stream on purpose)
  const stillStreaming = async (streamId: string) => {
    try {
      const data = await (await apiFetch(`${apiBase}/live/streams`)).json();
      return !data.success || data.streams.some((st: StreamInfo) => st.id === streamId);
    } catch {
      return true; // Can't tell: assume it is still meant to be streaming
    }
  };

  // Raise an alert for a camera problem, at most once per cooldown
  const raiseIssue = async (issue: CameraIssue | 'lost', stream: StreamInfo) => {
    const deviceName = stream.deviceName;
    const info = ISSUE_TEXT[issue];
    if (!info.alert || endedRef.current) return;
    const now = Date.now();
    if (now - (lastAlertRef.current[issue] || 0) < ISSUE_COOLDOWN_MS) return;
    lastAlertRef.current[issue] = now;
    // A stopped stream also looks frozen or lost: only alarm if the device is still meant to be streaming
    if ((issue === 'frozen' || issue === 'lost') && !(await stillStreaming(stream.id))) {
      endedRef.current = true;
      return;
    }
    setAlertLog((log) => [{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: `${info.title} on ${deviceName}` }, ...log].slice(0, 8));
    onAlertRef.current(`📷 ${info.title} on ${deviceName}. ${info.detail}`);
    apiFetch(`${apiBase}/vision/camera-issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue, cameraName: deviceName }),
    }).catch(() => {});
  };

  // Connect to a streaming device and start monitoring its picture
  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    const video = videoRef.current!;
    const monitor = new CameraHealthMonitor();
    monitorRef.current = monitor;
    lastAlertRef.current = {};
    endedRef.current = false;

    const connect = async () => {
      setConn('connecting');
      setConnError('');
      setIssues([]);
      setMetrics(null);
      setCalibrating(true);
      try {
        const offerRes = await apiFetch(`${apiBase}/live/streams/${watching.id}/offer`);
        const offerData = await offerRes.json();
        if (!offerRes.ok || !offerData.success) throw new Error(offerData.message || 'Could not join the stream.');
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;
        pc.ontrack = (e) => {
          video.srcObject = e.streams[0] || new MediaStream([e.track]);
          video.play().catch(() => {});
        };
        let dropTimer: ReturnType<typeof setTimeout> | undefined;
        let everConnected = false;
        pc.onconnectionstatechange = () => {
          if (cancelled || pcRef.current !== pc) return;
          if (pc.connectionState === 'connected') {
            everConnected = true;
            clearTimeout(dropTimer);
            setConn('live');
          }
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            // 'disconnected' can recover from a short network blip: give it a few seconds
            clearTimeout(dropTimer);
            dropTimer = setTimeout(async () => {
              if (cancelled || pcRef.current !== pc || pc.connectionState === 'connected') return;
              // If the device ended its stream, the farmer stopped it on purpose: no alarm
              const stillListed = !endedRef.current && (await stillStreaming(watching.id));
              if (cancelled) return;
              setConn('lost');
              if (stillListed) {
                setIssues(['lost']);
                raiseIssue('lost', watching);
              } else {
                endedRef.current = true;
                setIssues([]);
                setConnError(`${watching.deviceName} stopped streaming.`);
              }
            }, pc.connectionState === 'failed' ? 0 : 5000);
          }
        };
        await pc.setRemoteDescription({ type: 'offer', sdp: offerData.offer });
        await pc.setLocalDescription(await pc.createAnswer());
        await gatherIce(pc);
        if (cancelled) return pc.close();
        const ansRes = await apiFetch(`${apiBase}/live/streams/${watching.id}/answer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer: pc.localDescription!.sdp }),
        });
        const ansData = await ansRes.json();
        if (!ansRes.ok || !ansData.success) throw new Error(ansData.message || 'Could not join the stream.');
        // If the connection never comes up, the networks probably block direct connections
        setTimeout(() => {
          if (!cancelled && pcRef.current === pc && !everConnected && !endedRef.current) {
            setConn('error');
            setConnError(
              'Could not connect directly to the streaming device. Try both devices on the same Wi-Fi; some mobile networks need a TURN relay server.',
            );
          }
        }, 25000);
      } catch (err) {
        if (cancelled) return;
        setConn('error');
        setConnError(err instanceof Error ? err.message : String(err));
      }
    };
    connect();

    // Camera health checks run on a timer (not animation frames) so they continue in the background
    const healthTimer = setInterval(() => {
      // Only judge the picture while connected; a closing stream would look frozen
      if (!video.videoWidth || video.readyState < 2 || pcRef.current?.connectionState !== 'connected') return;
      const result = monitor.analyse(video);
      setCalibrating(result.calibrating);
      setMetrics(result.metrics);
      setIssues((prev) => (prev.includes('lost') && pcRef.current?.connectionState !== 'connected' ? prev : result.issues));
      for (const issue of result.issues) raiseIssue(issue, watching);
    }, HEALTH_MS);

    // Notice quickly when the device stops streaming on purpose (the connection itself can take
    // a while to report closing, and meanwhile the last frame would look frozen)
    const endCheck = setInterval(async () => {
      if (endedRef.current || pcRef.current?.connectionState !== 'connected') return;
      if (!(await stillStreaming(watching.id)) && !cancelled) {
        endedRef.current = true;
        pcRef.current?.close();
        setConn('lost');
        setIssues([]);
        setConnError(`${watching.deviceName} stopped streaming.`);
      }
    }, 4000);

    return () => {
      cancelled = true;
      clearInterval(healthTimer);
      clearInterval(endCheck);
      pcRef.current?.close();
      pcRef.current = null;
      video.srcObject = null;
    };
    // raiseIssue only uses refs and stable props
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, apiBase, apiFetch]);

  // Optional animal and intruder detection on the live picture
  useEffect(() => {
    if (!watching || !animalDetection) return;
    let busy = false;
    const video = videoRef.current!;
    const timer = setInterval(async () => {
      if (busy || !video.videoWidth || video.readyState < 2) return;
      busy = true;
      try {
        const loaded = await loadModel();
        const { detections: found } = await detectFrame(loaded, video, video.videoWidth, video.videoHeight, { minConfidence: 0.45, farmObjectsOnly: true });
        setDetections(found);
        drawBoxes(overlayRef.current, found, video.videoWidth, video.videoHeight);
        // Alert when the same kind of animal/person shows up in two checks in a row
        const now = Date.now();
        const present = new Set(found.filter((d) => THREAT_CLASSES.has(COCO_CLASSES[d.classId])).map((d) => d.classId));
        for (const classId of present) {
          const name = COCO_CLASSES[classId];
          const seen = animalSeenRef.current[name] || 0;
          animalSeenRef.current[name] = seen + 1;
          if (seen + 1 === 2 && now - (lastAlertRef.current[`animal:${name}`] || 0) > ANIMAL_COOLDOWN_MS) {
            lastAlertRef.current[`animal:${name}`] = now;
            const best = found.find((d) => d.classId === classId)!;
            setAlertLog((log) => [{ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), text: `${name} seen on ${watching.deviceName}` }, ...log].slice(0, 8));
            onAlertRef.current(`🚨 ${name} seen on ${watching.deviceName} (${Math.round(best.score * 100)}%).`);
            apiFetch(`${apiBase}/vision/detections`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ className: name, confidence: Number(best.score.toFixed(3)), cameraName: watching.deviceName }),
            }).catch(() => {});
          }
        }
        for (const name of Object.keys(animalSeenRef.current)) {
          if (!present.has(COCO_CLASSES.indexOf(name))) animalSeenRef.current[name] = 0;
        }
      } catch {
        // Detection is best-effort; the camera health monitor keeps running
      } finally {
        busy = false;
      }
    }, DETECT_MS);
    const overlay = overlayRef.current;
    return () => {
      clearInterval(timer);
      overlay?.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
    };
  }, [watching, animalDetection, apiBase, apiFetch]);

  if (!watching) {
    return (
      <div className="space-y-4">
        {listError && (
          <p className="text-sm text-amber-200 bg-amber-950/60 border border-amber-500/40 rounded-xl px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> {listError}
          </p>
        )}
        {streams === null && !listError && (
          <p className="text-sm text-emerald-100 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> Looking for your streaming devices…
          </p>
        )}
        {streams?.length === 0 && (
          <div className="py-8 text-center space-y-2">
            <Smartphone className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-sm font-bold text-white">No device is streaming right now</p>
            <p className="text-xs text-emerald-200/80 max-w-md mx-auto">
              On your phone, sign in to this account, open <b>Device Live Stream</b> and tap <b>Stream from this device</b>. It will appear
              here within a few seconds.
            </p>
          </div>
        )}
        {streams && streams.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-3">
            {streams.map((s) => (
              <div key={s.id} className="p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                <div className="mr-auto">
                  <p className="font-black text-white">{s.deviceName}</p>
                  <p className="text-[11px] text-emerald-200/70">
                    Live since {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {s.status === 'connected' && ' • being watched on another device'}
                  </p>
                </div>
                <button
                  onClick={() => setWatching(s)}
                  disabled={s.status !== 'waiting'}
                  className="px-4 py-2 rounded-xl bg-white hover:bg-emerald-50 text-emerald-950 font-black text-xs flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Eye className="w-3.5 h-3.5" /> Watch
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const healthy = conn === 'live' && !calibrating && issues.filter((i) => ISSUE_TEXT[i].alert).length === 0;

  return (
    <div className="grid lg:grid-cols-[1fr_300px] gap-5">
      <div className="space-y-3">
        <div className="relative bg-black rounded-2xl overflow-hidden border border-emerald-500/40 min-h-[260px]">
          <video ref={videoRef} muted playsInline className="block w-full h-auto" />
          <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          {conn === 'connecting' && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm font-bold text-white bg-emerald-950/70">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-400" /> Connecting to {watching.deviceName}…
            </div>
          )}
          {conn === 'live' && (
            <span className="absolute top-3 left-3 bg-red-600 text-white font-black px-2.5 py-0.5 rounded-full text-[10px] animate-pulse">
              ● LIVE • {watching.deviceName}
            </span>
          )}
          {issues.some((i) => ISSUE_TEXT[i].alert) && (
            <div className="absolute bottom-3 left-3 right-3 bg-red-600/90 text-white rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              {issues
                .filter((i) => ISSUE_TEXT[i].alert)
                .map((i) => ISSUE_TEXT[i].title)
                .join(' • ')}
            </div>
          )}
        </div>
        {(conn === 'error' || conn === 'lost') && (
          <div className="p-3 rounded-xl bg-amber-950/60 border border-amber-500/40 text-sm text-amber-100 space-y-2">
            <p className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {connError || 'The connection to the streaming device dropped.'}
            </p>
            <button
              onClick={() => setWatching(null)}
              className="px-3 py-1.5 rounded-lg bg-white text-emerald-950 font-bold text-xs flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Back to devices
            </button>
          </div>
        )}
      </div>

      <div className="space-y-4 text-xs">
        <div className={`p-4 rounded-2xl border space-y-2 ${healthy ? 'bg-emerald-900/40 border-emerald-500/30' : 'bg-red-950/40 border-red-500/40'}`}>
          <p className="font-black text-white flex items-center gap-2">
            {healthy ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldAlert className="w-4 h-4 text-red-300" />}
            Camera health
          </p>
          {conn !== 'live' ? (
            <p className="text-emerald-200/80">Waiting for the picture…</p>
          ) : calibrating ? (
            <p className="text-emerald-200/80 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Learning the normal view (keep the camera still for a few seconds)…
            </p>
          ) : issues.length === 0 ? (
            <p className="text-emerald-100">All clear: the camera is unobstructed and in position.</p>
          ) : (
            <ul className="space-y-1.5">
              {issues.map((i) => (
                <li key={i} className={ISSUE_TEXT[i].alert ? 'text-red-100' : 'text-amber-100'}>
                  <b>{ISSUE_TEXT[i].title}:</b> {ISSUE_TEXT[i].detail}
                </li>
              ))}
            </ul>
          )}
          {metrics && (
            <div className="pt-2 border-t border-white/10 space-y-1.5">
              <Meter label="Sharpness" value={Math.min(100, metrics.sharpnessPct)} text={`${metrics.sharpnessPct}%`} />
              <Meter label="View blocked" value={metrics.blockedPct} text={`${metrics.blockedPct}%`} danger />
              <Meter label="Scene change" value={metrics.changePct} text={`${metrics.changePct}%`} danger />
              <Meter label="Brightness" value={Math.round((metrics.brightness / 255) * 100)} text={String(metrics.brightness)} />
            </div>
          )}
          {conn === 'live' && !calibrating && (
            <button
              onClick={() => monitorRef.current?.recalibrate()}
              className="mt-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold"
            >
              I moved the camera on purpose: learn the new view
            </button>
          )}
        </div>

        <label className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 cursor-pointer">
          <input type="checkbox" checked={animalDetection} onChange={(e) => setAnimalDetection(e.target.checked)} className="mt-0.5 accent-emerald-400" />
          <span>
            <span className="block font-bold text-white">Animal &amp; intruder detection</span>
            <span className="block text-emerald-200/70">Run YOLO on this stream and alert for animals and people.</span>
            {animalDetection && detections.length > 0 && (
              <span className="block mt-1 text-emerald-100">
                In view: {detections.map((d) => `${COCO_CLASSES[d.classId]} ${Math.round(d.score * 100)}%`).join(', ')}
              </span>
            )}
          </span>
        </label>

        <div className="p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 space-y-1.5">
          <p className="font-black text-white">Alerts from this stream</p>
          {alertLog.length === 0 ? (
            <p className="text-emerald-200/70">None yet.</p>
          ) : (
            alertLog.map((a, i) => (
              <p key={i} className="text-emerald-100">
                <span className="text-emerald-300 font-bold">{a.time}</span> {a.text}
              </p>
            ))
          )}
        </div>

        <button onClick={() => setWatching(null)} className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold">
          Stop watching
        </button>
      </div>
    </div>
  );
}

function Meter({ label, value, text, danger }: { label: string; value: number; text: string; danger?: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = danger ? (pct >= 35 ? 'bg-red-500' : 'bg-emerald-400') : pct < 40 ? 'bg-amber-400' : 'bg-emerald-400';
  return (
    <div>
      <div className="flex justify-between text-[11px] text-emerald-200/80">
        <span>{label}</span>
        <span className="text-white font-bold">{text}</span>
      </div>
      <div className="h-1.5 rounded-full bg-emerald-950 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Draws detection boxes over the live picture
function drawBoxes(canvas: HTMLCanvasElement | null, dets: Detection[], w: number, h: number) {
  if (!canvas) return;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const line = Math.max(2, Math.round(w / 320));
  const font = Math.max(12, Math.round(w / 45));
  ctx.font = `bold ${font}px sans-serif`;
  ctx.textBaseline = 'top';
  for (const d of dets) {
    const name = COCO_CLASSES[d.classId];
    const color = THREAT_CLASSES.has(name) ? (name === 'person' ? '#f59e0b' : '#ef4444') : '#34d399';
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.strokeRect(d.x, d.y, d.w, d.h);
    const label = `${name} ${Math.round(d.score * 100)}%`;
    const tw = ctx.measureText(label).width + 10;
    const ty = d.y - font - 8 < 0 ? d.y : d.y - font - 8;
    ctx.fillStyle = color;
    ctx.fillRect(d.x, ty, tw, font + 8);
    ctx.fillStyle = '#022c22';
    ctx.fillText(label, d.x + 5, ty + 4);
  }
}
