'use client';

import React, { useEffect, useState } from 'react';
import {
  Camera,
  Plus,
  Smartphone,
  Link2,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ScanEye,
  MapPin,
  X,
} from 'lucide-react';
import { CameraFeed, CameraType, ConnectedCamera, FeedStatus } from '@/components/CameraFeed';

// Suggested places on a farm; the farmer can also type their own
const LOCATION_SUGGESTIONS = [
  'North boundary',
  'South boundary',
  'East boundary',
  'West boundary',
  'Main gate',
  'Field centre',
  'Pump house',
  'Storage shed',
  'Cattle shed',
  'Canal / water source',
];

const TYPE_OPTIONS: Array<{ type: CameraType; title: string; text: string; icon: React.ReactNode }> = [
  { type: 'device', title: 'This phone or laptop', text: 'Use a camera on this device, e.g. an old phone mounted in the field', icon: <Smartphone className="w-5 h-5" /> },
  { type: 'hls', title: 'IP camera: HLS link', text: 'An https:// link ending in .m3u8 from a cloud camera or stream bridge', icon: <Link2 className="w-5 h-5" /> },
  { type: 'mjpeg', title: 'IP camera: MJPEG link', text: 'An https:// MJPEG video or snapshot link', icon: <ImageIcon className="w-5 h-5" /> },
];

const TYPE_LABEL: Record<CameraType, string> = { device: 'Device camera', hls: 'HLS stream', mjpeg: 'MJPEG stream' };

interface CameraForm {
  name: string;
  location: string;
  type: CameraType;
  streamUrl: string;
  deviceId: string;
  deviceLabel: string;
  aiAlerts: boolean;
}

const EMPTY_FORM: CameraForm = { name: '', location: '', type: 'device', streamUrl: '', deviceId: '', deviceLabel: '', aiAlerts: true };

interface CameraManagerProps {
  apiBase: string;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onOpenLiveVision: () => void;
}

export function CameraManager({ apiBase, apiFetch, onOpenLiveVision }: CameraManagerProps) {
  const [cameras, setCameras] = useState<ConnectedCamera[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  // null: form closed; 'new': adding; otherwise the id of the camera being edited
  const [editing, setEditing] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await apiFetch(`${apiBase}/cameras`);
      const data = await res.json();
      if (!res.ok || !data.success) setLoadError(data.message || 'Could not load your cameras.');
      else {
        setLoadError('');
        setCameras(data.cameras);
      }
    } catch {
      setLoadError('Cannot reach the VISTA server. Please check your connection.');
    }
  };

  useEffect(() => {
    // Fetch once when the tab opens; state is set after the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (camera: ConnectedCamera) => {
    setConfirmRemove(null);
    try {
      const res = await apiFetch(`${apiBase}/cameras/${camera.id}`, { method: 'DELETE' });
      const data = await res.json();
      setNotice(data.success ? `${camera.name} removed.` : data.message || 'Could not remove the camera.');
      if (data.success) setCameras((list) => (list || []).filter((c) => c.id !== camera.id));
    } catch {
      setNotice('Cannot reach the VISTA server.');
    }
  };

  const onSaved = (camera: ConnectedCamera, isNew: boolean) => {
    setCameras((list) => (isNew ? [...(list || []), camera] : (list || []).map((c) => (c.id === camera.id ? camera : c))));
    setEditing(null);
    setNotice(`${camera.name} ${isNew ? 'connected' : 'updated'}.`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-emerald-950/80 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-500/20 pb-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Camera className="w-5 h-5 text-emerald-400" />
              My Cameras
            </h2>
            <p className="text-xs text-emerald-200/80 mt-0.5">
              Connect your field cameras to watch them here and run AI animal and intruder detection in Live Vision.
            </p>
          </div>
          {editing === null && (
            <button
              onClick={() => {
                setNotice('');
                setEditing('new');
              }}
              className="bg-white hover:bg-emerald-50 text-emerald-950 font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-lg transition flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add camera
            </button>
          )}
        </div>

        {notice && (
          <p className="mb-4 text-sm text-emerald-100 bg-emerald-900/50 border border-emerald-500/40 rounded-xl px-3 py-2 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> {notice}
          </p>
        )}
        {loadError && (
          <p className="mb-4 text-sm text-amber-200 bg-amber-950/60 border border-amber-500/40 rounded-xl px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {loadError}
          </p>
        )}

        {editing !== null && (
          <CameraFormPanel
            key={editing}
            initial={editing === 'new' ? null : (cameras || []).find((c) => c.id === editing) || null}
            apiBase={apiBase}
            apiFetch={apiFetch}
            onSaved={onSaved}
            onCancel={() => setEditing(null)}
          />
        )}

        {cameras === null && !loadError && (
          <div className="py-10 flex items-center justify-center gap-2 text-sm text-emerald-100">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> Loading your cameras…
          </div>
        )}

        {cameras?.length === 0 && editing === null && (
          <div className="py-10 text-center space-y-2">
            <Camera className="w-10 h-10 text-emerald-400 mx-auto" />
            <p className="text-sm font-bold text-white">No cameras connected yet</p>
            <p className="text-xs text-emerald-200/80 max-w-md mx-auto">
              Add a phone or laptop camera, or an IP camera with an https stream link. Each camera can raise AI alerts for animals and people.
            </p>
          </div>
        )}

        {cameras && cameras.length > 0 && (
          <div className="grid md:grid-cols-2 gap-4 mt-2">
            {cameras.map((camera) => (
              <div key={camera.id} className="rounded-2xl bg-emerald-900/40 border border-emerald-500/30 overflow-hidden">
                {previewing === camera.id && <CameraFeed source={camera} className="aspect-video" />}
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black text-white">{camera.name}</h3>
                      <p className="text-xs text-emerald-200/80 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3 h-3" /> {camera.location || 'No location set'}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white/10 text-emerald-100">{TYPE_LABEL[camera.type]}</span>
                      <span
                        className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                          camera.aiAlerts ? 'bg-emerald-400 text-emerald-950' : 'bg-white/10 text-emerald-200/70'
                        }`}
                      >
                        AI alerts {camera.aiAlerts ? 'on' : 'off'}
                      </span>
                    </div>
                  </div>
                  {camera.type === 'device' && camera.deviceLabel && (
                    <p className="text-[11px] text-emerald-200/70">Uses: {camera.deviceLabel}</p>
                  )}
                  {camera.streamUrl && <p className="text-[11px] text-emerald-200/70 truncate">{camera.streamUrl}</p>}

                  {confirmRemove === camera.id ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-amber-100 font-bold mr-auto">Remove this camera?</span>
                      <button onClick={() => remove(camera)} className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold">
                        Remove
                      </button>
                      <button onClick={() => setConfirmRemove(null)} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold">
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 text-xs font-bold">
                      <button
                        onClick={() => setPreviewing(previewing === camera.id ? null : camera.id)}
                        className="px-3 py-1.5 rounded-lg bg-white text-emerald-950 hover:bg-emerald-50 flex items-center gap-1.5"
                      >
                        {previewing === camera.id ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        {previewing === camera.id ? 'Hide' : 'View'}
                      </button>
                      {camera.aiAlerts && (
                        <button
                          onClick={onOpenLiveVision}
                          className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30 border border-emerald-400/40 flex items-center gap-1.5"
                        >
                          <ScanEye className="w-3.5 h-3.5" /> Live Vision
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setNotice('');
                          setPreviewing(null);
                          setEditing(camera.id);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => setConfirmRemove(camera.id)}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-red-900/60 text-red-200 flex items-center gap-1.5 ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface CameraFormPanelProps {
  initial: ConnectedCamera | null;
  apiBase: string;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onSaved: (camera: ConnectedCamera, isNew: boolean) => void;
  onCancel: () => void;
}

function CameraFormPanel({ initial, apiBase, apiFetch, onSaved, onCancel }: CameraFormPanelProps) {
  const [form, setForm] = useState<CameraForm>(() =>
    initial
      ? {
          name: initial.name,
          location: initial.location,
          type: initial.type,
          streamUrl: initial.streamUrl || '',
          deviceId: initial.deviceId || '',
          deviceLabel: initial.deviceLabel || '',
          aiAlerts: initial.aiAlerts,
        }
      : EMPTY_FORM,
  );
  const [devices, setDevices] = useState<MediaDeviceInfo[] | null>(null);
  const [deviceError, setDeviceError] = useState('');
  // The source being test-previewed (null: no test running)
  const [testing, setTesting] = useState<{ type: CameraType; streamUrl: string; deviceId: string } | null>(null);
  const [testStatus, setTestStatus] = useState<FeedStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const set = <K extends keyof CameraForm>(key: K, value: CameraForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError('');
    // A changed source needs a new test
    if (key === 'type' || key === 'streamUrl' || key === 'deviceId') {
      setTesting(null);
      setTestStatus(null);
    }
  };

  // Camera names are only visible after the browser has been given camera permission once
  const findDeviceCameras = async () => {
    setDeviceError('');
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((t) => t.stop());
      const found = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      setDevices(found);
      if (found.length && !form.deviceId) {
        setForm((f) => ({ ...f, deviceId: found[0].deviceId, deviceLabel: found[0].label }));
      }
      if (!found.length) setDeviceError('No cameras were found on this device.');
    } catch (err) {
      setDeviceError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
          : 'Could not look for cameras on this device.',
      );
    }
  };

  const isStream = form.type !== 'device';
  const canTest = isStream ? /^https?:\/\//i.test(form.streamUrl.trim()) : true;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch(`${apiBase}/cameras${initial ? `/${initial.id}` : ''}`, {
        method: initial ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, streamUrl: form.streamUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) setError(data.message || 'Could not save the camera.');
      else onSaved(data.camera, !initial);
    } catch {
      setError('Cannot reach the VISTA server. Please check your connection.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full bg-emerald-950/60 border border-emerald-500/30 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-emerald-200/50 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30';
  const labelClass = 'block text-xs font-bold text-emerald-200 mb-1.5';

  return (
    <form onSubmit={save} className="mb-6 p-5 rounded-2xl bg-emerald-900/30 border border-emerald-400/40 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-black text-white">{initial ? `Edit ${initial.name}` : 'Connect a camera'}</h3>
        <button type="button" onClick={onCancel} className="text-emerald-200 hover:text-white" aria-label="Close form">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* 1. Name & location */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass} htmlFor="camera-name">
            Camera name *
          </label>
          <input
            id="camera-name"
            className={inputClass}
            placeholder="e.g. North gate camera"
            value={form.name}
            maxLength={60}
            onChange={(e) => set('name', e.target.value)}
            required
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="camera-location">
            Where is it on the farm?
          </label>
          <input
            id="camera-location"
            className={inputClass}
            placeholder="e.g. North boundary"
            list="camera-location-suggestions"
            value={form.location}
            maxLength={80}
            onChange={(e) => set('location', e.target.value)}
          />
          <datalist id="camera-location-suggestions">
            {LOCATION_SUGGESTIONS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </div>
      </div>

      {/* 2. Connection type */}
      <div>
        <span className={labelClass}>How does this camera connect? *</span>
        <div className="grid sm:grid-cols-3 gap-2">
          {TYPE_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              onClick={() => set('type', option.type)}
              className={`text-left p-3 rounded-xl border transition ${
                form.type === option.type
                  ? 'bg-white text-emerald-950 border-white shadow-lg'
                  : 'bg-emerald-950/50 text-emerald-50 border-emerald-500/30 hover:border-emerald-300'
              }`}
            >
              <span className="flex items-center gap-2 font-black text-sm">
                {option.icon} {option.title}
              </span>
              <span className={`block text-[11px] mt-1 ${form.type === option.type ? 'text-emerald-800' : 'text-emerald-200/70'}`}>{option.text}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Connection details */}
      {form.type === 'device' ? (
        <div>
          <label className={labelClass} htmlFor="camera-device">
            Which camera on this device?
          </label>
          {devices && devices.length > 0 ? (
            <select
              id="camera-device"
              className={inputClass}
              value={form.deviceId}
              onChange={(e) => {
                const device = devices.find((d) => d.deviceId === e.target.value);
                set('deviceId', e.target.value);
                setForm((f) => ({ ...f, deviceLabel: device?.label || '' }));
              }}
            >
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              onClick={findDeviceCameras}
              className="px-4 py-2.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/40 text-emerald-50 text-sm font-bold flex items-center gap-2"
            >
              <Smartphone className="w-4 h-4" /> Find cameras on this device
            </button>
          )}
          {form.deviceLabel && !devices && <p className="text-[11px] text-emerald-200/70 mt-1.5">Saved camera: {form.deviceLabel}</p>}
          {deviceError && <p className="text-xs text-amber-200 mt-1.5">{deviceError}</p>}
          <p className="text-[11px] text-emerald-200/70 mt-1.5">
            Tip: open this website on an old phone placed in the field, sign in, and add its back camera here.
          </p>
        </div>
      ) : (
        <div>
          <label className={labelClass} htmlFor="camera-url">
            Stream link *
          </label>
          <input
            id="camera-url"
            className={inputClass}
            type="url"
            inputMode="url"
            placeholder={form.type === 'hls' ? 'https://…/stream.m3u8' : 'https://…/video.mjpeg'}
            value={form.streamUrl}
            onChange={(e) => set('streamUrl', e.target.value)}
            required
          />
          <button
            type="button"
            onClick={() => setShowHelp((s) => !s)}
            className="mt-2 text-xs font-bold text-emerald-300 hover:text-white flex items-center gap-1"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition ${showHelp ? 'rotate-180' : ''}`} /> How do I get a stream link?
          </button>
          {showHelp && <StreamLinkHelp />}
        </div>
      )}

      {/* 4. AI alerts */}
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={form.aiAlerts} onChange={(e) => set('aiAlerts', e.target.checked)} className="mt-1 accent-emerald-400" />
        <span>
          <span className="block text-sm font-bold text-white">AI alerts for this camera</span>
          <span className="block text-[11px] text-emerald-200/70">
            Show it in Live Vision and alert you when animals or people are detected.
          </span>
        </span>
      </label>

      {/* 5. Test connection */}
      <div className="space-y-2">
        <button
          type="button"
          disabled={!canTest}
          onClick={() => {
            setTestStatus(null);
            setTesting({ type: form.type, streamUrl: form.streamUrl.trim(), deviceId: form.deviceId });
          }}
          className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/30 text-white text-sm font-bold disabled:opacity-40 flex items-center gap-2"
        >
          <Eye className="w-4 h-4" /> Test connection
        </button>
        {testing && (
          <div className="max-w-md">
            <CameraFeed source={testing} onStatus={setTestStatus} className="rounded-xl border border-emerald-500/40 aspect-video" />
            {testStatus?.state === 'live' && (
              <p className="text-xs text-emerald-300 font-bold mt-1.5 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Connected. You can save this camera.
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-amber-200 bg-amber-950/60 border border-amber-500/40 rounded-xl px-3 py-2 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black text-sm disabled:opacity-60 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {initial ? 'Save changes' : 'Connect camera'}
        </button>
        <button type="button" onClick={onCancel} className="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function StreamLinkHelp() {
  return (
    <div className="mt-2 p-4 rounded-xl bg-emerald-950/70 border border-emerald-500/30 text-xs text-emerald-50 space-y-3">
      <div>
        <p className="font-black text-white">Cloud / Wi-Fi cameras</p>
        <p className="text-emerald-200/80 mt-0.5">
          In the camera&apos;s app or web portal, look for &quot;Share&quot;, &quot;Live stream&quot;, &quot;HLS&quot; or &quot;Embed&quot;. Copy the https link
          (HLS links end in <code>.m3u8</code>).
        </p>
      </div>
      <div>
        <p className="font-black text-white">CCTV / IP cameras with an rtsp:// link</p>
        <p className="text-emerald-200/80 mt-0.5">Browsers can&apos;t play rtsp directly. Convert it with the free go2rtc app on a computer at the farm:</p>
        <ol className="list-decimal ml-4 mt-1 space-y-0.5 text-emerald-200/80">
          <li>Download go2rtc from github.com/AlexxIT/go2rtc and run it.</li>
          <li>
            Put this in its <code>go2rtc.yaml</code> (the <code>origin</code> line lets AI detection read the video):
            <pre className="mt-1 p-2 rounded-lg bg-black/40 text-emerald-100 overflow-x-auto">{`streams:
  field1: rtsp://user:pass@camera-ip:554/stream
api:
  origin: "*"`}</pre>
          </li>
          <li>
            On that computer, use <code>http://localhost:1984/api/stream.m3u8?src=field1</code> (HLS) or{' '}
            <code>…/api/stream.mjpeg?src=field1</code> (MJPEG).
          </li>
          <li>To watch from anywhere, publish go2rtc with a tunnel (e.g. Cloudflare Tunnel) and use the https link it gives you.</li>
        </ol>
      </div>
      <p className="text-emerald-200/70">
        Never put the camera&apos;s username and password in the link you save here. Keep them inside go2rtc or the camera app.
      </p>
    </div>
  );
}
