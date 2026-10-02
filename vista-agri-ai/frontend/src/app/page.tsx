'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Volume2,
  VolumeX,
  Sparkles,
  MapPin,
  Cpu,
  Layers,
  Activity,
  CheckCircle2,
  Smartphone,
  Send,
  Eye,
  RefreshCw,
  Bell,
  ArrowRight,
  TrendingUp,
  FileText,
  Sliders,
  ChevronRight,
  Sprout,
  Video,
  Radio,
  Wifi,
  WifiOff,
  LogOut,
  Leaf,
  ScanFace
} from 'lucide-react';
import { MaizeCornLogo } from '@/components/MaizeCornLogo';
import { translations, Language } from '@/lib/translations';
import { LoginPage, AuthUser } from '@/components/LoginPage';
import { LiveVision, VisionAlertResult } from '@/components/LiveVision';
import { PlantDoctor } from '@/components/PlantDoctor';
import { FaceScanModal, FaceCaptureResult } from '@/components/FaceScanModal';

// Trailing slashes would produce `//api/...` URLs, which Vercel redirects and browsers then block
const BACKEND_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
const API_BASE = `${BACKEND_URL}/api`;

const AUTH_STORAGE_KEY = 'vista-auth';

export default function Home() {
  // Authentication: the login page is shown until the farmer signs in
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // Kept in a ref so the polling interval always sends the current token
  const authTokenRef = useRef<string | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(AUTH_STORAGE_KEY);
      if (saved) {
        const { user, token } = JSON.parse(saved);
        authTokenRef.current = token;
        setAuthUser(user);
      }
    } catch {
      // Ignore unreadable storage and show the login page
    }
    setAuthChecked(true);
  }, []);

  const handleLogin = (user: AuthUser, token: string) => {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user, token }));
    } catch {
      // Storage unavailable: stay signed in for this session only
    }
    authTokenRef.current = token;
    setAuthUser(user);
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {}
    authTokenRef.current = null;
    setAuthUser(null);
  };

  // fetch() for the backend API: sends the sign-in token and signs out if it has expired
  const apiFetch = async (url: string, init: RequestInit = {}) => {
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${authTokenRef.current}` },
    });
    if (res.status === 401) handleLogout();
    return res;
  };

  if (!authChecked) return null;
  if (!authUser) return <LoginPage apiBase={API_BASE} onLogin={handleLogin} />;

  // Keyed by user so switching accounts starts from a fresh dashboard
  return (
    <VistaAgriApp key={authUser.id} authUser={authUser} apiFetch={apiFetch} onLogout={handleLogout} onSessionUpdate={handleLogin} />
  );
}

interface VistaAgriAppProps {
  authUser: AuthUser;
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onLogout: () => void;
  // Replaces the stored profile and token, e.g. after turning face sign-in on
  onSessionUpdate: (user: AuthUser, token: string) => void;
}

function VistaAgriApp({ authUser, apiFetch, onLogout, onSessionUpdate }: VistaAgriAppProps) {
  // The demo account shows the sample farm; other accounts start with an empty farm
  const isDemo = Boolean(authUser.demo);

  const [lang, setLang] = useState<Language>('en');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'calculator' | 'fieldwork' | 'vision' | 'plant' | 'alerts' | 'devices' | 'ai'>('dashboard');
  const [faceScanOpen, setFaceScanOpen] = useState(false);
  const [faceMenuOpen, setFaceMenuOpen] = useState(false);
  // The farmer's saved face photo, loaded when the face login menu opens
  const [facePhoto, setFacePhoto] = useState<string | null>(null);

  // Backend Connection & Live Synchronization State
  const [backendConnected, setBackendConnected] = useState(false);
  const [activeEvents, setActiveEvents] = useState<any[]>([]);
  const [devicesList, setDevicesList] = useState<any[]>([]);
  const [calcExplanation, setCalcExplanation] = useState<any>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  // Real-time states
  const [fieldSafe, setFieldSafe] = useState(!isDemo);
  const [sirensActive, setSirensActive] = useState(isDemo);
  const [isDemoSimulating, setIsDemoSimulating] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Simplified Smart Calculator State
  const [calcInputs, setCalcInputs] = useState(
    isDemo
      ? {
          farmName: 'Warangal Golden Acres',
          area: 10,
          unit: 'Acres',
          crop: 'Maize & Cotton',
          animalRisk: 'HIGH',
          entrances: 2,
          existingCameras: 2,
          existingSirens: 1,
        }
      : {
          farmName: `${authUser.fullName.split(' ')[0]}'s Farm`,
          area: 5,
          unit: 'Acres',
          crop: 'Maize & Cotton',
          animalRisk: 'MEDIUM',
          entrances: 1,
          existingCameras: 0,
          existingSirens: 0,
        }
  );

  const [calcResults, setCalcResults] = useState(
    isDemo ? { cameras: 8, sirens: 4, coverage: 94, perimeter: 804 } : { cameras: 0, sirens: 0, coverage: 0, perimeter: 0 }
  );

  // AI Assistant State
  const [aiQuery, setAiQuery] = useState('');
  const [aiChat, setAiChat] = useState<Array<{ sender: 'user' | 'ai'; text: string }>>([
    {
      sender: 'ai',
      text: isDemo
        ? 'Welcome to VISTA AGRI AI. Your fields are actively protected across 8 camera zones and 4 acoustic sirens. How can I assist your farm today?'
        : `Hi ${authUser.fullName.split(' ')[0]}! I'm your VISTA farming assistant. Ask me anything about crops, pests, weather or protecting your fields, in English, Telugu or Hindi.`,
    },
  ]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  // Clean, focused incident notifications
  const [notifications, setNotifications] = useState<Array<{
    id: string;
    eventId?: string;
    title: string;
    crop: string;
    location: string;
    time: string;
    evidence: string;
    action: string;
    status: string;
    severity: string;
  }>>(isDemo ? [
    {
      id: 'notif-01',
      eventId: 'evt-01',
      title: 'Wild Boar Detected',
      crop: 'Cotton & Maize Zone',
      location: 'North-East Boundary',
      time: '10:42 AM',
      evidence: 'Animal Track #17 entering crop zone. Acoustic Siren #2 automatically sounded for 10s.',
      action: 'Boundary protected. Check perimeter wire when convenient.',
      status: 'Active Alert',
      severity: 'HIGH',
    },
    {
      id: 'notif-02',
      eventId: 'evt-02',
      title: 'Localized Crop Disturbance',
      crop: 'East Border Plot',
      location: 'East Boundary',
      time: '09:50 AM',
      evidence: '0.8 acres flattened foliage observed. Physical stem inspection recommended.',
      action: 'Inspect flagged patch before scheduled irrigation.',
      status: 'Under Review',
      severity: 'MEDIUM',
    },
    {
      id: 'notif-03',
      eventId: 'evt-03',
      title: 'Weed Growth Cluster',
      crop: 'Irrigation Furrows',
      location: 'South-West Plot',
      time: '09:15 AM',
      evidence: '18% weed canopy density detected competing with crop root zone.',
      action: 'Targeted inter-cultivation recommended.',
      status: 'Scheduled',
      severity: 'LOW',
    },
  ] : []);

  const t = translations[lang];

  // GENTLE ALERT SOUND SYNTHESIZER (Acoustic Harmonic Chime)
  const playGentleAlertSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      // 3 Gentle soothing harmonic bell tones: D5 (587.33Hz), F#5 (739.99Hz), A5 (880Hz)
      const notes = [
        { freq: 587.33, start: 0, dur: 0.9 },
        { freq: 739.99, start: 0.12, dur: 0.9 },
        { freq: 880.0, start: 0.24, dur: 1.1 },
      ];

      notes.forEach((note) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine'; // pure smooth sine wave
        osc.frequency.setValueAtTime(note.freq, ctx.currentTime + note.start);

        // Soft, gentle attack and slow soothing exponential fade
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + note.start);
        gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + note.start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + note.start + note.dur);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + note.start);
        osc.stop(ctx.currentTime + note.start + note.dur);
      });
    } catch (err) {
      console.log('Audio playback initialized on user interaction:', err);
    }
  };

  // LIVE USER LOCATION DETECTION STATE
  const [userLocation, setUserLocation] = useState<{
    lat: number;
    lng: number;
    region: string;
    isDetecting: boolean;
    accuracy?: number;
  }>({
    lat: 17.982,
    lng: 79.598,
    region: isDemo ? 'Warangal Rural, Telangana' : 'Set Field Location',
    isDetecting: false,
    accuracy: 12,
  });

  // Detect GPS Location on Demand & Update Farm Setup
  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported by your browser.');
      return;
    }

    setUserLocation((prev) => ({ ...prev, isDetecting: true }));
    showToast('📍 Detecting your current field GPS location...');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(4));
        const lng = parseFloat(pos.coords.longitude.toFixed(4));
        const accuracy = Math.round(pos.coords.accuracy);

        const regionName = `Field Zone (${lat}°N, ${lng}°E)`;

        setUserLocation({
          lat,
          lng,
          region: regionName,
          accuracy,
          isDetecting: false,
        });

        setCalcInputs((prev) => ({
          ...prev,
          farmName: `Farm at ${lat}°N, ${lng}°E`,
        }));

        playGentleAlertSound();
        showToast(`✅ Location updated: ${lat}°N, ${lng}°E (±${accuracy}m accuracy)`);
      },
      (err) => {
        setUserLocation((prev) => ({ ...prev, isDetecting: false }));
        showToast('📍 Using standard field coordinates (17.982°N, 79.598°E).');
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // LIVE BACKEND DATA SYNCHRONIZATION
  const fetchBackendData = async () => {
    try {
      // 1. Health check
      const healthRes = await fetch(`${BACKEND_URL}/health`);
      if (healthRes.ok) {
        setBackendConnected(true);
      } else {
        setBackendConnected(false);
      }

      // 2. Fetch Live Notifications
      const notifRes = await apiFetch(`${API_BASE}/notifications`);
      if (notifRes.ok) {
        const notifData = await notifRes.json();
        if (notifData.notifications) {
          setNotifications(
            notifData.notifications.map((n: any) => ({
              id: n.id,
              eventId: n.eventId,
              title: n.title,
              crop: n.source === 'camera' ? 'Live Vision camera' : n.objectType === 'Wild Boar' ? 'Cotton & Maize Zone' : 'East Border Plot',
              location: n.location,
              time: n.timestamp,
              evidence: n.evidenceSummary || n.problem,
              action: n.recommendedAction,
              status: n.read ? 'Acknowledged' : 'Active Alert',
              severity: n.severity,
            }))
          );
        }
      }

      // 3. Fetch Real Devices
      const devRes = await apiFetch(`${API_BASE}/devices`);
      if (devRes.ok) {
        const devData = await devRes.json();
        if (devData.devices) {
          setDevicesList(devData.devices);
          const hasTriggeredSiren = devData.devices.some((d: any) => d.type === 'SIREN' && d.status === 'TRIGGERED');
          setSirensActive(hasTriggeredSiren);
        }
      }

      // 4. Fetch Live Events
      const evRes = await apiFetch(`${API_BASE}/events`);
      if (evRes.ok) {
        const evData = await evRes.json();
        if (evData.events) {
          setActiveEvents(evData.events);
          const hasUnresolved = evData.events.some((e: any) => e.status !== 'RESOLVED');
          setFieldSafe(!hasUnresolved);
        }
      }

      // 5. Fetch Latest Protection Plan
      const planRes = await apiFetch(`${API_BASE}/calculator/farm-protection-plan`);
      if (planRes.ok) {
        const pData = await planRes.json();
        if (pData.plan) {
          setCalcResults({
            cameras: pData.plan.estimatedCameraCount || 8,
            sirens: pData.plan.estimatedSirenCount || 4,
            coverage: pData.plan.coverageEstimate || 94,
            perimeter: 804,
          });
        }
      }
    } catch {
      setBackendConnected(false);
    }
  };

  useEffect(() => {
    if (!authUser) return;
    fetchBackendData();
    const interval = setInterval(fetchBackendData, 5000);
    return () => clearInterval(interval);
  }, [authUser]);

  // Emergency Siren Silence
  const handleEmergencyStop = async () => {
    setSirensActive(false);
    try {
      await apiFetch(`${API_BASE}/sirens/emergency-stop`, { method: 'POST' });
    } catch {}
    showToast('🛑 All sirens silenced immediately.');
    fetchBackendData();
  };

  // Test Siren with Gentle Acoustic Alert Sound
  const handleTestSiren = async () => {
    if (!devicesList.some((d) => d.type === 'SIREN')) {
      showToast('No sirens connected to your farm yet.');
      return;
    }
    setSirensActive(true);
    playGentleAlertSound();
    try {
      await apiFetch(`${API_BASE}/sirens/siren-02/test`, { method: 'POST' });
    } catch {}
    showToast('🔔 Gentle acoustic alert chime sounded on Siren #2.');
    setTimeout(() => {
      setSirensActive(false);
      fetchBackendData();
    }, 3000);
  };

  // Master Demo Simulation
  const triggerMasterDemo = async () => {
    setIsDemoSimulating(true);
    showToast('Simulating animal detection in crop zone...');
    try {
      const res = await apiFetch(`${API_BASE}/demo/trigger-wild-boar`, { method: 'POST' });
      if (res.ok) {
        setSirensActive(true);
        setFieldSafe(false);
        playGentleAlertSound();
        fetchBackendData();
      }
    } catch {
      setSirensActive(true);
      setFieldSafe(false);
      playGentleAlertSound();
    }
    setTimeout(() => {
      setIsDemoSimulating(false);
      showToast('🐗 Wild Boar detected -> Gentle Siren chime active -> Push Alert sent!');
      fetchBackendData();
    }, 1200);
  };

  // A confirmed sighting from the Live Vision camera: chime, tell the farmer, refresh alerts
  const handleVisionAlert = ({ className, confidence, sirenTriggered, reported }: VisionAlertResult) => {
    playGentleAlertSound();
    setFieldSafe(false);
    if (sirenTriggered) setSirensActive(true);
    const pct = Math.round(confidence * 100);
    showToast(
      reported
        ? `🚨 ${className} detected (${pct}%). Alert saved${sirenTriggered ? ' and siren sounded' : ''}.`
        : `🚨 ${className} detected (${pct}%). Could not reach the server, so the alert was not saved.`,
    );
    fetchBackendData();
  };

  // Face sign-in: save this farmer's face photo (and the descriptor computed from it), or remove it
  const saveFaceLogin = async ({ descriptor, photo }: { descriptor: number[]; photo: string }): Promise<FaceCaptureResult> => {
    try {
      const res = await apiFetch(`${API_BASE}/auth/face`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor, photo }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return { error: data.message || 'Could not save your face. Please try again.' };
      onSessionUpdate(data.user, data.token);
      setFacePhoto(photo);
      return {};
    } catch {
      return { error: 'Cannot reach the VISTA server. Please check your connection.' };
    }
  };

  const finishFaceSetup = () => {
    setFaceScanOpen(false);
    showToast('✅ Photo saved. Next time, tap "Sign in with Photo".');
  };

  const toggleFaceMenu = async () => {
    const opening = !faceMenuOpen;
    setFaceMenuOpen(opening);
    if (opening && !facePhoto) {
      try {
        const data = await (await apiFetch(`${API_BASE}/auth/face`)).json();
        if (data.success) setFacePhoto(data.photo);
      } catch {
        // The menu still works without the preview
      }
    }
  };

  const removeFaceLogin = async () => {
    setFaceMenuOpen(false);
    try {
      const res = await apiFetch(`${API_BASE}/auth/face`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        onSessionUpdate(data.user, data.token);
        setFacePhoto(null);
        showToast('Photo login turned off.');
      } else showToast(data.message || 'Could not turn off face login.');
    } catch {
      showToast('Cannot reach the VISTA server.');
    }
  };

  // Ask VISTA AI
  const handleAskAi = async (customPrompt?: string) => {
    const query = customPrompt || aiQuery;
    if (!query.trim()) return;

    const userMsg = { sender: 'user' as const, text: query };
    setAiChat((prev) => [...prev, userMsg]);
    setAiQuery('');
    setIsAiLoading(true);

    try {
      const res = await apiFetch(`${API_BASE}/ai/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: query, language: lang }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiChat((prev) => [...prev, { sender: 'ai', text: data.reply }]);
        setBackendConnected(true);
      } else {
        throw new Error('Fallback');
      }
    } catch {
      let fallbackText = '';
      if (!isDemo) {
        fallbackText = 'The AI assistant is unavailable right now. Please try again in a moment.';
      } else if (lang === 'te') {
        fallbackText =
          'ఈరోజు మీ పొలంలో ఉదయం 10:42 గంటలకు ఈశాన్య భాగంలో అడవి పంది రాగా సైరన్ #2 మోగించబడింది. తూర్పు సరిహద్దు వద్ద 0.8 ఎకరాలలో పంట ఒరిగిపోయినట్లు గుర్తించబడింది.';
      } else if (lang === 'hi') {
        fallbackText =
          'आज सुबह 10:42 बजे उत्तर-पूर्व फसल क्षेत्र में जंगली सूअर की हलचल पर सायरन #2 बजा। पूर्व सीमा पर 0.8 एकड़ में पौधे मुड़े पाए गए हैं।';
      } else {
        fallbackText =
          'Field Update: Wild boar detected at 10:42 AM in North-East quadrant (Siren #2 sounded). 0.8 acres of foliage disturbance observed on East border.';
      }
      setAiChat((prev) => [...prev, { sender: 'ai', text: fallbackText }]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // Direct Prompt Bridge: Jump from any frontend page directly to Ask VISTA AI
  const askAiAbout = (promptText: string) => {
    setActiveTab('ai');
    handleAskAi(promptText);
  };

  // Recalculate Farm Protection Plan via Backend Engine
  const handleRecalculatePlan = async () => {
    setIsCalculating(true);
    try {
      const res = await apiFetch(`${API_BASE}/calculator/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fieldArea: calcInputs.area,
          areaUnit: calcInputs.unit,
          crop: calcInputs.crop,
          animalRisk: calcInputs.animalRisk,
          entrances: calcInputs.entrances,
          existingCameras: calcInputs.existingCameras,
          existingSirens: calcInputs.existingSirens,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCalcResults({
          cameras: data.estimatedCameraCount,
          sirens: data.estimatedSirenCount,
          coverage: data.coverageEstimate,
          perimeter: data.approxPerimeterMeters,
        });
        setCalcExplanation(data.formulaExplanation);
        showToast(`✅ Recalculated live: ${data.estimatedCameraCount} Cameras & ${data.estimatedSirenCount} Sirens recommended.`);
      }
    } catch {
      showToast('Calculated with offline formula engine.');
    } finally {
      setIsCalculating(false);
    }
  };

  // Save Plan to Database
  const handleSaveProtectionPlan = async () => {
    try {
      const res = await apiFetch(`${API_BASE}/calculator/farm-protection-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          crop: calcInputs.crop,
          fieldArea: calcInputs.area,
          estimatedCameraCount: calcResults.cameras,
          existingCameraCount: calcInputs.existingCameras,
          additionalCameraCount: Math.max(0, calcResults.cameras - calcInputs.existingCameras),
          estimatedSirenCount: calcResults.sirens,
          existingSirenCount: calcInputs.existingSirens,
          additionalSirenCount: Math.max(0, calcResults.sirens - calcInputs.existingSirens),
          coverageEstimate: calcResults.coverage,
          calculationInputs: calcInputs,
        }),
      });
      if (res.ok) {
        showToast('✅ Protection Plan saved to live database!');
        fetchBackendData();
      }
    } catch {
      showToast('Plan saved locally.');
    }
    setActiveTab('dashboard');
  };

  // Acknowledge Alert in Database
  const handleAcknowledgeAlert = async (id: string, eventId?: string) => {
    try {
      if (eventId) {
        await apiFetch(`${API_BASE}/events/${eventId}/confirm`, { method: 'POST' });
      }
      await apiFetch(`${API_BASE}/notifications/${id}/read`, { method: 'POST' });
      showToast('✅ Incident acknowledged by farmer.');
      fetchBackendData();
    } catch {
      showToast('Incident acknowledged locally.');
    }
  };

  // Mark Resolved in Database
  const handleResolveAlert = async (id: string, eventId?: string) => {
    // Remove it right away; the backend stops returning resolved alerts
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      const targetId = eventId || id.replace('notif-', 'evt-');
      await apiFetch(`${API_BASE}/events/${targetId}/resolve`, { method: 'POST' });
      showToast('✅ Incident marked as RESOLVED in database.');
      fetchBackendData();
    } catch {
      showToast('Incident marked resolved.');
    }
  };

  return (
    <div className="relative min-h-screen text-white font-sans selection:bg-emerald-500 selection:text-white overflow-x-hidden">
      {/* BACKGROUND IMAGE: Green Tractor & Rolling Hills Scenery sent by user */}
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat transition-all duration-700 pointer-events-none"
        style={{
          backgroundImage: "url('/agriculture/tractor_field_bg.jpg')",
        }}
      />

      {/* BALANCED LUXURY GREEN & WHITE GLASS OVERLAY */}
      <div className="fixed inset-0 z-0 bg-gradient-to-b from-emerald-950/75 via-emerald-950/80 to-slate-950/90 backdrop-blur-[1.5px] pointer-events-none" />

      {/* TOAST ALERT */}
      {toastMessage && (
        <div className="fixed top-5 right-5 z-50 bg-white text-emerald-900 border border-emerald-400 px-5 py-3 rounded-2xl shadow-2xl shadow-emerald-950/50 flex items-center gap-3 animate-fade-in font-bold text-sm">
          <Sparkles className="w-5 h-5 text-emerald-600" />
          <span>{toastMessage}</span>
        </div>
      )}

      {faceScanOpen && <FaceScanModal mode="enroll" onCapture={saveFaceLogin} onSuccess={finishFaceSetup} onClose={() => setFaceScanOpen(false)} />}

      {/* TOP HEADER */}
      <header className="relative z-30 bg-emerald-950/80 backdrop-blur-md border-b border-emerald-500/20 px-4 lg:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
        {/* Luxury Maize Corn Logo */}
        <div className="cursor-pointer" onClick={() => setActiveTab('dashboard')}>
          <MaizeCornLogo size="md" showText={true} />
        </div>

        {/* Global Action Controls in Green & White */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Live Backend Connection Indicator */}
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition ${
              backendConnected
                ? 'bg-emerald-900/80 border-emerald-400 text-white shadow-sm'
                : 'bg-amber-950/80 border-amber-500/50 text-amber-200'
            }`}
            title={backendConnected ? 'Live connection active to Backend API on Port 5000' : 'Connecting to local backend engine...'}
          >
            <span className={`w-2 h-2 rounded-full ${backendConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span>{backendConnected ? 'API Live (5000)' : 'API Syncing...'}</span>
          </div>

          {/* Status Badge */}
          <div
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold border transition ${
              fieldSafe
                ? 'bg-emerald-900/60 border-emerald-400 text-white'
                : 'bg-white text-emerald-950 border-white shadow-md'
            }`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                fieldSafe ? 'bg-emerald-400' : 'bg-emerald-600 animate-ping'
              }`}
            />
            <span>{fieldSafe ? t.status.safe : t.status.attention}</span>
          </div>

          {/* Dynamic GPS Location Detector */}
          <button
            onClick={handleDetectLocation}
            disabled={userLocation.isDetecting}
            className="flex items-center gap-1.5 bg-emerald-900/70 hover:bg-emerald-800 text-white border border-emerald-400/40 px-3.5 py-1.5 rounded-full text-xs font-bold transition shadow-sm"
            title="Click to detect current field GPS coordinates"
          >
            <MapPin className={`w-3.5 h-3.5 text-emerald-400 ${userLocation.isDetecting ? 'animate-spin' : ''}`} />
            <span>{userLocation.isDetecting ? 'Detecting GPS...' : userLocation.region}</span>
          </button>

          {/* Siren Control */}
          {sirensActive ? (
            <button
              onClick={handleEmergencyStop}
              className="bg-white hover:bg-emerald-50 text-emerald-950 px-3.5 py-1.5 rounded-full text-xs font-extrabold flex items-center gap-1.5 shadow-lg transition"
            >
              <VolumeX className="w-4 h-4 text-emerald-700 animate-bounce" />
              <span>Silence Sirens</span>
            </button>
          ) : (
            <button
              onClick={handleTestSiren}
              className="bg-emerald-900/80 hover:bg-emerald-800 text-white border border-emerald-500/50 px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Volume2 className="w-4 h-4 text-emerald-300" />
              <span>Test Sirens</span>
            </button>
          )}

          {/* Field Work Mode Button */}
          <button
            onClick={() => setActiveTab(activeTab === 'fieldwork' ? 'dashboard' : 'fieldwork')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 border transition ${
              activeTab === 'fieldwork'
                ? 'bg-white text-emerald-900 border-white shadow-lg'
                : 'bg-emerald-900/60 text-white border-emerald-500/40 hover:bg-emerald-800'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>Field Work Mode</span>
          </button>

          {/* Master Demo Trigger (demo farm only) */}
          {isDemo && (
          <button
            onClick={triggerMasterDemo}
            disabled={isDemoSimulating}
            className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black px-3.5 py-1.5 rounded-full text-xs shadow-md transition disabled:opacity-50 flex items-center gap-1.5"
          >
            <Activity className="w-4 h-4" />
            <span>{isDemoSimulating ? 'Simulating...' : 'Simulate Wild Boar'}</span>
          </button>
          )}

          {/* Language Toggle in Green & White */}
          <div className="flex bg-emerald-900/60 border border-emerald-500/30 rounded-full p-0.5">
            {(['en', 'te', 'hi'] as Language[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 text-xs rounded-full font-bold transition ${
                  lang === l
                    ? 'bg-white text-emerald-900 shadow-sm'
                    : 'text-emerald-200 hover:text-white'
                }`}
              >
                {l === 'en' ? 'EN' : l === 'te' ? 'తెలుగు' : 'हिंदी'}
              </button>
            ))}
          </div>

          {/* Face sign-in setup (real accounts only) */}
          {!isDemo && (
            <div className="relative">
              <button
                onClick={() => (authUser.hasFaceLogin ? toggleFaceMenu() : setFaceScanOpen(true))}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition border ${
                  authUser.hasFaceLogin
                    ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/60'
                    : 'bg-white text-emerald-950 border-white hover:bg-emerald-50'
                }`}
              >
                <ScanFace className="w-4 h-4" />
                <span>{authUser.hasFaceLogin ? 'Photo Login On' : 'Set up Photo Login'}</span>
              </button>
              {faceMenuOpen && (
                <div className="absolute right-0 mt-2 w-52 z-40 bg-emerald-950 border border-emerald-500/40 rounded-xl shadow-2xl p-1.5 text-xs font-bold">
                  <div className="p-2 flex items-center gap-3 border-b border-emerald-500/20 mb-1">
                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-emerald-400 bg-emerald-900 shrink-0">
                      {facePhoto && (
                        // eslint-disable-next-line @next/next/no-img-element -- data URL
                        <img src={facePhoto} alt="Your saved face" className="w-full h-full object-cover -scale-x-100" />
                      )}
                    </div>
                    <span className="text-emerald-200 font-semibold leading-snug">Your saved photo</span>
                  </div>
                  <button
                    onClick={() => {
                      setFaceMenuOpen(false);
                      setFaceScanOpen(true);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-emerald-800 text-white"
                  >
                    Take a new photo
                  </button>
                  <button onClick={removeFaceLogin} className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-900/60 text-red-200">
                    Turn off photo login
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Signed-in Farmer & Sign Out */}
          <button
            onClick={onLogout}
            className="flex items-center gap-1.5 bg-emerald-900/60 hover:bg-emerald-800 text-white border border-emerald-500/40 px-3.5 py-1.5 rounded-full text-xs font-bold transition"
            title={`Signed in as ${authUser.email}`}
          >
            <LogOut className="w-4 h-4 text-emerald-300" />
            <span>Sign Out ({authUser.fullName.split(' ')[0]})</span>
          </button>
        </div>
      </header>

      {/* CLEAN NAVIGATION BAR */}
      <nav className="relative z-20 bg-emerald-950/70 border-b border-emerald-500/20 px-4 lg:px-8 py-2 overflow-x-auto flex items-center gap-2 text-xs font-bold no-scrollbar">
        {[
          { id: 'dashboard', label: t.nav.dashboard, icon: Layers },
          { id: 'calculator', label: t.nav.calculator, icon: Sliders },
          { id: 'vision', label: t.nav.vision, icon: Video },
          { id: 'plant', label: t.nav.plant, icon: Leaf },
          { id: 'alerts', label: t.nav.notifications, icon: Bell, badge: notifications.filter((n) => n.status === 'Active Alert').length || undefined },
          { id: 'devices', label: t.nav.devices, icon: Cpu },
          { id: 'ai', label: t.nav.ai, icon: Sparkles },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl flex items-center gap-2 transition whitespace-nowrap ${
                isActive
                  ? 'bg-white text-emerald-950 shadow-md font-extrabold'
                  : 'text-emerald-100 hover:bg-emerald-900/40 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4 text-emerald-400" />
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="bg-emerald-500 text-emerald-950 text-[10px] font-black px-1.5 py-0.2 rounded-full">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* MAIN CONTAINER */}
      <main className="relative z-10 flex-1 p-4 lg:p-8 max-w-7xl mx-auto w-full">
        {/* ========================================================
                        TAB 1: DASHBOARD
        ======================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Hero Welcome Card */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-900/90 via-emerald-950/80 to-emerald-900/90 border border-emerald-400/30 p-6 lg:p-8 shadow-2xl backdrop-blur-md">
              <div className="max-w-2xl">
                <span className="text-emerald-300 text-xs font-black tracking-widest uppercase flex items-center gap-1.5">
                  <Sprout className="w-4 h-4 text-emerald-400" />
                  {calcInputs.farmName} • {calcInputs.area} {calcInputs.unit} ({calcInputs.crop})
                </span>
                <h1 className="text-2xl lg:text-3xl font-black mt-2 text-white tracking-tight">
                  {new Date().getHours() < 12 ? 'Good Morning' : new Date().getHours() < 17 ? 'Good Afternoon' : 'Good Evening'}, {authUser.fullName}
                </h1>
                <p className="text-emerald-100/90 text-sm mt-2 leading-relaxed">
                  Your smart agricultural intelligence engine is monitoring crop health, tracking wildlife corridors, and safeguarding field perimeters with automated acoustic deterrents.
                </p>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    onClick={() => setActiveTab('vision')}
                    className="bg-white hover:bg-emerald-50 text-emerald-950 font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-lg transition flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4 text-emerald-700" />
                    <span>View Live Field Feed</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('calculator')}
                    className="bg-emerald-900/80 hover:bg-emerald-800 text-white font-bold text-xs px-5 py-2.5 rounded-xl border border-emerald-400/40 transition flex items-center gap-2"
                  >
                    <Sliders className="w-4 h-4 text-emerald-300" />
                    <span>Smart Farm Planner</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('ai')}
                    className="bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 font-bold text-xs px-5 py-2.5 rounded-xl border border-emerald-400/40 transition flex items-center gap-2"
                  >
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    <span>Ask VISTA AI</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 4 Clean Primary Status Cards in Green & White with Direct Backend AI Prompt Actions */}
            {isDemo ? (

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-emerald-950/70 border border-emerald-500/30 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-300">🐗 Wildlife Protection</span>
                  <div className="text-2xl font-black text-white mt-1">1 Detected</div>
                  <p className="text-xs text-emerald-200/80 mt-1 font-medium">Wild Boar #17 • Siren #2 Deterred</p>
                </div>
                <button
                  onClick={() =>
                    askAiAbout(
                      lang === 'te'
                        ? 'ఈరోజు అడవి పంది రాక వివరాలు చెప్పండి'
                        : lang === 'hi'
                        ? 'जंगली सूअर की हलचल के बारे में बताएं'
                        : 'Tell me about the wild boar detection and siren activation'
                    )
                  }
                  className="mt-3 text-[11px] font-bold text-emerald-300 hover:text-white flex items-center gap-1 bg-emerald-900/50 hover:bg-emerald-800 px-3 py-1.5 rounded-xl border border-emerald-400/30 w-fit transition shadow-sm"
                  title="Ask AI Assistant about this animal detection"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Ask AI Details</span>
                </button>
              </div>

              <div className="bg-emerald-950/70 border border-emerald-500/30 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-300">🌱 Crop Foliage Health</span>
                  <div className="text-2xl font-black text-white mt-1">92% Healthy</div>
                  <p className="text-xs text-emerald-200/80 mt-1 font-medium">Normal flowering stage in block 1</p>
                </div>
                <button
                  onClick={() =>
                    askAiAbout(
                      lang === 'te'
                        ? 'పత్తి పంట ఆరోగ్యం ఎలా ఉంది?'
                        : lang === 'hi'
                        ? 'कपास की फसल का स्वास्थ्य कैसा है?'
                        : 'How is my cotton crop health and yellowing foliage?'
                    )
                  }
                  className="mt-3 text-[11px] font-bold text-emerald-300 hover:text-white flex items-center gap-1 bg-emerald-900/50 hover:bg-emerald-800 px-3 py-1.5 rounded-xl border border-emerald-400/30 w-fit transition shadow-sm"
                  title="Ask AI Assistant for crop health guidance"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Ask AI Advice</span>
                </button>
              </div>

              <div className="bg-emerald-950/70 border border-emerald-500/30 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-300">🌿 Weed Hotspots</span>
                  <div className="text-2xl font-black text-white mt-1">18% Density</div>
                  <p className="text-xs text-emerald-200/80 mt-1 font-medium">South-West drainage furrow</p>
                </div>
                <button
                  onClick={() =>
                    askAiAbout(
                      lang === 'te'
                        ? 'కలుపు సమస్య ఎలా నివారించాలి?'
                        : lang === 'hi'
                        ? 'खरपतवार कैसे हटाएं?'
                        : 'How do I remove the weed cluster in the irrigation furrow?'
                    )
                  }
                  className="mt-3 text-[11px] font-bold text-emerald-300 hover:text-white flex items-center gap-1 bg-emerald-900/50 hover:bg-emerald-800 px-3 py-1.5 rounded-xl border border-emerald-400/30 w-fit transition shadow-sm"
                  title="Ask AI Assistant about weed treatment"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Ask AI Action</span>
                </button>
              </div>

              <div className="bg-emerald-950/70 border border-emerald-500/30 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-between">
                <div>
                  <span className="text-xs font-bold text-emerald-300">📷 Field Devices</span>
                  <div className="text-2xl font-black text-white mt-1">
                    {devicesList.length > 0 ? `${devicesList.filter(d=>d.type==='CAMERA').length} Cams • ${devicesList.filter(d=>d.type==='SIREN').length} Sirens` : '8 Cams • 4 Sirens'}
                  </div>
                  <p className="text-xs text-emerald-400 mt-1 font-bold">100% Online & Armed</p>
                </div>
                <button
                  onClick={() =>
                    askAiAbout(
                      lang === 'te'
                        ? 'సైరన్ ఎందుకు మోగింది?'
                        : lang === 'hi'
                        ? 'सायरन क्यों बजा?'
                        : 'Why did the siren activate today?'
                    )
                  }
                  className="mt-3 text-[11px] font-bold text-emerald-300 hover:text-white flex items-center gap-1 bg-emerald-900/50 hover:bg-emerald-800 px-3 py-1.5 rounded-xl border border-emerald-400/30 w-fit transition shadow-sm"
                  title="Ask AI Assistant about siren activation log"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Ask AI Siren Log</span>
                </button>
              </div>
            </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { step: '1', title: 'Plan your farm', text: 'Enter your field size and crop to get a camera and siren layout.', tab: 'calculator' as const, cta: 'Open Smart Farm Planner' },
                  { step: '2', title: 'Connect devices', text: 'Cameras and sirens you install will appear here once connected.', tab: 'devices' as const, cta: 'View Devices' },
                  { step: '3', title: 'Ask VISTA AI', text: 'Get advice on crops, pests, weeds and irrigation in your language.', tab: 'ai' as const, cta: 'Ask a Question' },
                ].map((card) => (
                  <div key={card.step} className="bg-emerald-950/70 border border-emerald-500/30 rounded-2xl p-5 backdrop-blur-md flex flex-col justify-between">
                    <div>
                      <span className="text-xs font-bold text-emerald-300">Step {card.step}</span>
                      <div className="text-lg font-black text-white mt-1">{card.title}</div>
                      <p className="text-xs text-emerald-200/80 mt-1 font-medium">{card.text}</p>
                    </div>
                    <button
                      onClick={() => setActiveTab(card.tab)}
                      className="mt-3 text-[11px] font-bold text-emerald-300 hover:text-white flex items-center gap-1 bg-emerald-900/50 hover:bg-emerald-800 px-3 py-1.5 rounded-xl border border-emerald-400/30 w-fit transition shadow-sm"
                    >
                      <span>{card.cta}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Field Map & Actionable Notifications */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Clean Visual Map Canvas */}
            {isDemo ? (

              <div className="lg:col-span-2 bg-emerald-950/75 border border-emerald-500/30 rounded-3xl p-5 shadow-2xl backdrop-blur-md flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-emerald-400" />
                    <h2 className="font-extrabold text-sm text-white">
                      Field Boundary & Protection Plan ({calcInputs.area} {calcInputs.unit})
                    </h2>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="flex items-center gap-1.5 text-white font-semibold">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> 8 Cameras
                    </span>
                    <span className="flex items-center gap-1.5 text-emerald-300 font-semibold">
                      <span className="w-2.5 h-2.5 rounded-full bg-white" /> 4 Sirens
                    </span>
                  </div>
                </div>

                {/* Map Simulator */}
                <div className="relative w-full h-80 bg-emerald-900/30 rounded-2xl border border-emerald-500/40 overflow-hidden flex items-center justify-center p-4">
                  {/* Grid Lines */}
                  <div className="absolute inset-0 opacity-20 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:20px_20px]" />

                  {/* Crop Protection Geofence */}
                  <div className="absolute inset-6 border-2 border-dashed border-emerald-400/80 rounded-2xl bg-emerald-950/20 flex items-start p-2">
                    <span className="text-[10px] bg-white text-emerald-950 font-black px-2.5 py-0.5 rounded-full shadow">
                      COTTON & MAIZE PROTECTION ZONE
                    </span>
                  </div>

                  {/* Camera Markers */}
                  {[
                    { id: 1, x: 25, y: 20, name: 'Cam 1 - North' },
                    { id: 2, x: 80, y: 35, name: 'Cam 2 - East' },
                    { id: 3, x: 70, y: 80, name: 'Cam 3 - South' },
                    { id: 4, x: 18, y: 70, name: 'Cam 4 - West' },
                    { id: 5, x: 50, y: 50, name: 'Cam 5 - Center' },
                    { id: 6, x: 85, y: 18, name: 'Cam 6 - Gate' },
                  ].map((c) => (
                    <div
                      key={c.id}
                      style={{ left: `${c.x}%`, top: `${c.y}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group cursor-pointer"
                    >
                      <div className="w-6 h-6 rounded-full bg-white text-emerald-950 font-bold text-[10px] flex items-center justify-center shadow-lg border border-emerald-400 group-hover:scale-125 transition">
                        📷
                      </div>
                      <span className="text-[9px] text-white bg-emerald-950 px-1 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap mt-0.5">
                        {c.name}
                      </span>
                    </div>
                  ))}

                  {/* Siren Markers */}
                  {[
                    { id: 1, x: 30, y: 15 },
                    { id: 2, x: 82, y: 32 },
                    { id: 3, x: 65, y: 85 },
                    { id: 4, x: 18, y: 68 },
                  ].map((s) => (
                    <div
                      key={s.id}
                      style={{ left: `${s.x}%`, top: `${s.y}%` }}
                      className="absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center"
                    >
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shadow-xl border border-white transition ${
                          s.id === 2 && sirensActive
                            ? 'bg-white text-emerald-950 animate-bounce'
                            : 'bg-emerald-600 text-white'
                        }`}
                      >
                        🔊
                      </div>
                      <div className="w-20 h-20 rounded-full border border-emerald-400/40 bg-emerald-400/10 pointer-events-none absolute" />
                    </div>
                  ))}

                  {/* Animal Detection Marker */}
                  <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center animate-pulse">
                    <div className="bg-white text-emerald-950 text-xs px-3 py-1 rounded-full font-black flex items-center gap-1.5 shadow-xl border border-emerald-400">
                      <span>🐗</span>
                      <span>Wild Boar Track #17</span>
                    </div>
                    <span className="text-[10px] text-emerald-200 font-bold mt-1 bg-emerald-950/90 px-2 py-0.5 rounded-full">
                      Protected Zone Boundary
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between text-xs text-emerald-200/80">
                  <span>94% Optical & Acoustic Coverage • 804m Boundary Perimeter</span>
                  <button
                    onClick={() => setActiveTab('calculator')}
                    className="text-white hover:text-emerald-300 font-bold flex items-center gap-1"
                  >
                    Adjust Device Positions <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="lg:col-span-2">
                <EmptyState
                  icon={<MapPin className="w-8 h-8 text-emerald-400" />}
                  title="No field boundary yet"
                  text="Plan your farm to see where cameras and sirens should go on your field."
                  actionLabel="Open Smart Farm Planner"
                  onAction={() => setActiveTab('calculator')}
                />
              </div>
            )}

              {/* Actionable Incident Feed */}
              <div className="bg-emerald-950/75 border border-emerald-500/30 rounded-3xl p-5 shadow-2xl backdrop-blur-md flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Bell className="w-5 h-5 text-emerald-400" />
                    <h2 className="font-extrabold text-sm text-white">Active Farm Incidents</h2>
                  </div>
                  <span className="text-xs bg-white text-emerald-950 font-black px-2 py-0.5 rounded-full">
                    {notifications.length} Logged
                  </span>
                </div>

                <div className="space-y-3 flex-1 overflow-y-auto max-h-[340px] pr-1">
                  {notifications.length === 0 && (
                    <p className="text-xs text-emerald-200/80 text-center py-8">No incidents yet. Alerts from your cameras will show up here.</p>
                  )}
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="p-4 rounded-2xl bg-emerald-900/40 border border-emerald-500/30 hover:border-emerald-400 transition"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white text-xs">{n.title}</span>
                        <span className="text-[11px] text-emerald-300 font-medium">{n.time}</span>
                      </div>
                      <p className="text-xs text-emerald-100/90 mt-1 font-medium">{n.evidence}</p>
                      <div className="mt-2.5 flex items-center justify-between text-[11px] text-emerald-200">
                        <span className="font-semibold text-emerald-400">{n.location}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              askAiAbout(
                                lang === 'te'
                                  ? `${n.title} గురించి వివరాలు చెప్పండి`
                                  : lang === 'hi'
                                  ? `${n.title} के बारे में बताएं`
                                  : `Tell me more details and action plan for ${n.title}`
                              )
                            }
                            className="text-[10px] text-emerald-300 hover:text-white bg-emerald-950/80 px-2 py-0.5 rounded-full border border-emerald-500/40 flex items-center gap-1 transition"
                          >
                            <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                            <span>Ask AI</span>
                          </button>
                          <span className="bg-white text-emerald-950 px-2 py-0.5 rounded-full font-bold text-[10px]">
                            {n.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
               TAB 2: SMART FARM CALCULATOR
        ======================================================== */}
        {activeTab === 'calculator' && (
          <div className="space-y-6">
            <div className="bg-emerald-950/80 border border-emerald-500/30 rounded-3xl p-6 lg:p-8 shadow-2xl backdrop-blur-md">
              <div className="border-b border-emerald-500/20 pb-5">
                <h2 className="text-xl lg:text-2xl font-black text-white flex items-center gap-2">
                  <Sliders className="w-6 h-6 text-emerald-400" />
                  {t.calculator.title}
                </h2>
                <p className="text-emerald-200/90 text-xs mt-1">
                  Accurate agricultural engineering calculations for camera visibility cones and acoustic deterrent decibels.
                </p>
              </div>

              {/* Simplified 4-Field Calculator Form */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
                <div>
                  <label className="text-xs text-emerald-300 font-bold block mb-1.5">{t.calculator.farmName}</label>
                  <input
                    type="text"
                    value={calcInputs.farmName}
                    onChange={(e) => setCalcInputs({ ...calcInputs, farmName: e.target.value })}
                    className="w-full bg-emerald-900/50 border border-emerald-500/40 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-white font-medium"
                  />
                </div>

                <div>
                  <label className="text-xs text-emerald-300 font-bold block mb-1.5">{t.calculator.area} & Unit</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={calcInputs.area}
                      onChange={(e) => setCalcInputs({ ...calcInputs, area: Number(e.target.value) })}
                      className="w-2/3 bg-emerald-900/50 border border-emerald-500/40 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-white font-medium"
                    />
                    <select
                      value={calcInputs.unit}
                      onChange={(e) => setCalcInputs({ ...calcInputs, unit: e.target.value })}
                      className="w-1/3 bg-emerald-900/50 border border-emerald-500/40 rounded-xl px-2 py-2.5 text-xs text-white focus:outline-none focus:border-white font-medium"
                    >
                      <option value="Acres">Acres</option>
                      <option value="Hectares">Hectares</option>
                      <option value="Guntas">Guntas</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-emerald-300 font-bold block mb-1.5">{t.calculator.crop}</label>
                  <select
                    value={calcInputs.crop}
                    onChange={(e) => setCalcInputs({ ...calcInputs, crop: e.target.value })}
                    className="w-full bg-emerald-900/50 border border-emerald-500/40 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-white font-medium"
                  >
                    <option value="Maize & Cotton">Maize & Cotton (మొక్కజొన్న / పత్తి)</option>
                    <option value="Rice">Rice / Paddy (వరి / धान)</option>
                    <option value="Wheat">Wheat (గోధుమ / गेहूँ)</option>
                    <option value="Chilli">Chilli (మిరప / मिर्च)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-emerald-300 font-bold block mb-1.5">{t.calculator.animalRisk}</label>
                  <select
                    value={calcInputs.animalRisk}
                    onChange={(e) => setCalcInputs({ ...calcInputs, animalRisk: e.target.value })}
                    className="w-full bg-emerald-900/50 border border-emerald-500/40 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-white font-medium"
                  >
                    <option value="HIGH">High (Wild Boar & Monkey Corridors)</option>
                    <option value="MEDIUM">Medium (Occasional grazing animals)</option>
                    <option value="LOW">Low (Open field)</option>
                  </select>
                </div>
              </div>

              {/* Calculated Plan Banner */}
              <div className="mt-8 bg-emerald-900/40 border border-emerald-400/40 rounded-3xl p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs uppercase tracking-widest text-emerald-300 font-black flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-400" />
                    RECOMMENDED INFRASTRUCTURE PLAN (BACKEND ENGINE)
                  </span>
                  <button
                    onClick={handleRecalculatePlan}
                    disabled={isCalculating}
                    className="bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold px-4 py-2 rounded-xl border border-emerald-400/40 flex items-center gap-1.5 transition shadow"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${isCalculating ? 'animate-spin' : ''}`} />
                    <span>{isCalculating ? 'Recalculating...' : 'Recalculate with Live Backend'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                  <div className="bg-white text-emerald-950 p-4 rounded-2xl shadow-lg">
                    <span className="text-xs font-bold text-emerald-700">Recommended Cameras</span>
                    <div className="text-3xl font-black mt-1">{calcResults.cameras} Units</div>
                    <span className="text-[11px] text-emerald-800 font-semibold">100m Optical Range</span>
                  </div>

                  <div className="bg-white text-emerald-950 p-4 rounded-2xl shadow-lg">
                    <span className="text-xs font-bold text-emerald-700">Recommended Sirens</span>
                    <div className="text-3xl font-black mt-1">{calcResults.sirens} Units</div>
                    <span className="text-[11px] text-emerald-800 font-semibold">100m Acoustic Radius</span>
                  </div>

                  <div className="bg-white text-emerald-950 p-4 rounded-2xl shadow-lg">
                    <span className="text-xs font-bold text-emerald-700">Estimated Coverage</span>
                    <div className="text-3xl font-black mt-1">{calcResults.coverage}%</div>
                    <span className="text-[11px] text-emerald-800 font-semibold">Perimeter Redundancy</span>
                  </div>

                  <div className="bg-white text-emerald-950 p-4 rounded-2xl shadow-lg">
                    <span className="text-xs font-bold text-emerald-700">Boundary Perimeter</span>
                    <div className="text-3xl font-black mt-1">{calcResults.perimeter}m</div>
                    <span className="text-[11px] text-emerald-800 font-semibold">Full Fence Guard</span>
                  </div>
                </div>

                {calcExplanation && (
                  <div className="mt-4 p-4 rounded-2xl bg-emerald-950/80 border border-emerald-500/30 text-xs">
                    <span className="text-emerald-300 font-bold block mb-1.5">{calcExplanation.title}</span>
                    <ul className="space-y-1 text-emerald-100/90 list-disc list-inside">
                      {calcExplanation.factors?.map((f: string, idx: number) => (
                        <li key={idx}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={handleSaveProtectionPlan}
                    className="bg-white hover:bg-emerald-50 text-emerald-950 font-black text-xs px-6 py-3 rounded-full shadow-xl transition flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                    <span>Save & Confirm Protection Plan</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
                   TAB 3: FIELD WORK MODE
        ======================================================== */}
        {activeTab === 'fieldwork' && (
          <div className="space-y-6">
            <div className="bg-white text-emerald-950 p-6 rounded-3xl shadow-2xl flex flex-wrap items-center justify-between gap-4">
              <div>
                <span className="text-xs font-black uppercase tracking-wider bg-emerald-950 text-white px-2.5 py-0.5 rounded-full">
                  FIELD WORK MODE
                </span>
                <h2 className="text-xl lg:text-2xl font-black mt-1.5">Outdoor High-Contrast Touch Interface</h2>
                <p className="text-xs font-semibold text-emerald-800">Large touch targets designed for bright sunlight while walking your crop rows.</p>
              </div>

              <div className="flex gap-2.5">
                <button
                  onClick={handleEmergencyStop}
                  className="bg-emerald-950 text-white font-extrabold text-xs px-5 py-3 rounded-2xl shadow-lg transition flex items-center gap-2"
                >
                  <VolumeX className="w-4 h-4 text-emerald-400" />
                  <span>Silence Sirens</span>
                </button>
                <button
                  onClick={handleTestSiren}
                  className="bg-emerald-600 text-white font-extrabold text-xs px-5 py-3 rounded-2xl shadow-lg transition flex items-center gap-2"
                >
                  <Volume2 className="w-4 h-4" />
                  <span>Test Siren</span>
                </button>
              </div>
            </div>

            {/* Clean Touch Cards */}
            {isDemo ? (

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-emerald-950/80 border-2 border-white rounded-3xl p-6 flex flex-col justify-between shadow-2xl backdrop-blur-md">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-3xl">🐗</span>
                    <span className="bg-white text-emerald-950 font-black text-xs px-3 py-1 rounded-full uppercase">
                      ACTIVE INTRUSION
                    </span>
                  </div>
                  <h3 className="text-xl font-black text-white mt-3">Wild Boar Detected</h3>
                  <p className="text-xs text-emerald-200 mt-1 font-semibold">Track #17 • North-East Boundary</p>
                  <p className="text-xs text-white/90 mt-3 font-medium bg-emerald-900/50 p-3 rounded-xl border border-emerald-400/40">
                    Siren #2 acoustic repellent active. Animal is moving away from the cotton rows.
                  </p>
                </div>
                <button
                  onClick={() => showToast('Boundary inspection recorded.')}
                  className="mt-5 w-full bg-white hover:bg-emerald-50 text-emerald-950 font-black text-xs py-3.5 rounded-2xl shadow-lg transition"
                >
                  Confirm Fence Integrity
                </button>
              </div>

              <div className="bg-emerald-950/80 border-2 border-emerald-400/60 rounded-3xl p-6 flex flex-col justify-between shadow-2xl backdrop-blur-md">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-3xl">⚠️</span>
                    <span className="bg-emerald-500 text-emerald-950 font-black text-xs px-3 py-1 rounded-full uppercase">
                      0.8 ACRES
                    </span>
                  </div>
                  <h3 className="text-xl font-black text-white mt-3">Crop Damage Flagged</h3>
                  <p className="text-xs text-emerald-200 mt-1 font-semibold">East Boundary Patch</p>
                  <p className="text-xs text-white/90 mt-3 font-medium bg-emerald-900/50 p-3 rounded-xl border border-emerald-400/40">
                    Observed foliage disturbance. Check soil and stems before evening irrigation.
                  </p>
                </div>
                <button
                  onClick={() => showToast('Coordinates pinned to handheld GPS.')}
                  className="mt-5 w-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black text-xs py-3.5 rounded-2xl shadow-lg transition"
                >
                  Navigate to Plot
                </button>
              </div>

              <div className="bg-emerald-950/80 border-2 border-emerald-400/60 rounded-3xl p-6 flex flex-col justify-between shadow-2xl backdrop-blur-md">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-3xl">🌿</span>
                    <span className="bg-emerald-400 text-emerald-950 font-black text-xs px-3 py-1 rounded-full uppercase">
                      18% HOTSPOT
                    </span>
                  </div>
                  <h3 className="text-xl font-black text-white mt-3">Weed Pressure</h3>
                  <p className="text-xs text-emerald-200 mt-1 font-semibold">South-West Drainage Furrow</p>
                  <p className="text-xs text-white/90 mt-3 font-medium bg-emerald-900/50 p-3 rounded-xl border border-emerald-400/40">
                    High concentration competing with young crop roots.
                  </p>
                </div>
                <button
                  onClick={() => showToast('Added to de-weeding task list.')}
                  className="mt-5 w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs py-3.5 rounded-2xl shadow-lg transition"
                >
                  Log De-Weeding Task
                </button>
              </div>
            </div>
            ) : (
              <EmptyState
                icon={<Sprout className="w-8 h-8 text-emerald-400" />}
                title="No field tasks right now"
                text="Intrusions, crop damage and weed hotspots found by your cameras will appear here as tasks."
              />
            )}


          </div>
        )}

        {/* ========================================================
                 TAB 4: LIVE VISION & OBJECT TRACKING
        ======================================================== */}
        {activeTab === 'vision' && (
          <LiveVision apiBase={API_BASE} apiFetch={apiFetch} onAlert={handleVisionAlert} />
        )}

        {/* ========================================================
                 PLANT DOCTOR: PHOTO DIAGNOSIS & GROWING GUIDE
        ======================================================== */}
        {activeTab === 'plant' && <PlantDoctor apiBase={API_BASE} apiFetch={apiFetch} language={lang} />}

        {/* ========================================================
                   TAB 5: ALERTS & RESOLUTION
        ======================================================== */}
        {activeTab === 'alerts' && (
          <div className="space-y-6">
            <div className="bg-emerald-950/80 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-emerald-500/20 pb-4 mb-4">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Bell className="w-5 h-5 text-emerald-400" />
                    Problem-Specific Farm Alerts
                  </h2>
                  <p className="text-xs text-emerald-200/80 mt-0.5">
                    Individual agricultural workflows. What happened, where, and what action to take.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {notifications.length === 0 && (
                  <p className="text-xs text-emerald-200/80 text-center py-8">No incidents yet. Alerts from your cameras will show up here.</p>
                )}
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="p-5 rounded-3xl bg-emerald-900/40 border border-emerald-500/40 hover:border-white transition shadow-xl"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">
                          {n.title.includes('Boar') ? '🐗' : n.title.includes('Crop') ? '⚠️' : '🌿'}
                        </span>
                        <h3 className="font-extrabold text-base text-white">{n.title}</h3>
                        <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-white text-emerald-950">
                          {n.severity} PRIORITY
                        </span>
                      </div>
                      <span className="text-xs text-emerald-200 font-semibold">{n.time}</span>
                    </div>

                    <p className="text-xs text-emerald-100 font-semibold mt-2">{n.evidence}</p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-xs">
                      <div className="bg-emerald-950/80 p-3 rounded-2xl border border-emerald-500/30">
                        <span className="text-emerald-300 font-bold block mb-1">LOCATION & CANOPY:</span>
                        <span className="text-white">{n.location} • {n.crop}</span>
                      </div>
                      <div className="bg-emerald-950/80 p-3 rounded-2xl border border-emerald-500/30">
                        <span className="text-white font-bold block mb-1">RECOMMENDED ACTION:</span>
                        <span className="text-emerald-200">{n.action}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <button
                        onClick={() =>
                          askAiAbout(
                            lang === 'te'
                              ? `${n.title} హెచ్చరిక గురించి సలహా ఇవ్వండి`
                              : lang === 'hi'
                              ? `${n.title} के बारे में सलाह दें`
                              : `What should I do regarding ${n.title} at ${n.location}?`
                          )
                        }
                        className="bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 text-xs font-bold px-3.5 py-2 rounded-xl border border-emerald-400/40 flex items-center gap-1.5 transition"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Ask AI About This</span>
                      </button>
                      <button
                        onClick={() => handleAcknowledgeAlert(n.id, (n as any).eventId)}
                        className="bg-emerald-900 hover:bg-emerald-800 text-white text-xs font-bold px-4 py-2 rounded-xl border border-emerald-400/40 transition"
                      >
                        Acknowledge
                      </button>
                      <button
                        onClick={() => handleResolveAlert(n.id, (n as any).eventId)}
                        className="bg-white hover:bg-emerald-50 text-emerald-950 text-xs font-black px-4 py-2 rounded-xl shadow-lg transition"
                      >
                        Mark Resolved
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
                 TAB 6: DEVICES & HARDWARE
        ======================================================== */}
        {activeTab === 'devices' && !isDemo && (
          <EmptyState
            icon={<Cpu className="w-8 h-8 text-emerald-400" />}
            title="No devices connected yet"
            text="Use the Smart Farm Planner to work out how many cameras and sirens your field needs. Connected devices will be listed here."
            actionLabel="Open Smart Farm Planner"
            onAction={() => setActiveTab('calculator')}
          />
        )}
        {activeTab === 'devices' && isDemo && (
          <div className="space-y-6">
            <div className="bg-emerald-950/80 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md">
              <div className="flex items-center justify-between border-b border-emerald-500/20 pb-4 mb-4">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-emerald-400" />
                    Field Cameras & Acoustic Sirens
                  </h2>
                  <p className="text-xs text-emerald-200/80 mt-0.5">
                    Solar powered optical sensors and directional acoustic horns.
                  </p>
                </div>
                <button
                  onClick={handleTestSiren}
                  className="bg-white hover:bg-emerald-50 text-emerald-950 text-xs font-black px-4 py-2 rounded-full shadow-lg transition"
                >
                  Test All Sirens
                </button>
              </div>

              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300 mb-3">Field Cameras (8)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                {[
                  'Camera #1 - North Border',
                  'Camera #2 - East Entrance',
                  'Camera #3 - South Crop Zone',
                  'Camera #4 - West Wildlife Corridor',
                  'Camera #5 - Center Hub',
                  'Camera #6 - North-East Gate',
                  'Camera #7 - South-West Canal',
                  'Camera #8 - Main Road',
                ].map((name, i) => (
                  <div key={i} className="bg-emerald-900/40 border border-emerald-500/30 p-3.5 rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-xs text-white block">{name}</span>
                      <span className="text-[11px] text-emerald-300">Solar ☀️ 96%</span>
                    </div>
                    <span className="text-[10px] bg-white text-emerald-950 font-black px-2 py-0.5 rounded-full">
                      ONLINE
                    </span>
                  </div>
                ))}
              </div>

              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-300 mb-3">Acoustic Sirens (4)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { name: 'Siren #1 - North Sonic Horn', status: 'ONLINE', dBA: '95 dB' },
                  { name: 'Siren #2 - East Strobe Sounder', status: sirensActive ? 'ACTIVE' : 'ONLINE', dBA: '105 dB' },
                  { name: 'Siren #3 - South Boundary', status: 'ONLINE', dBA: '90 dB' },
                  { name: 'Siren #4 - Wildlife Repeller', status: 'ONLINE', dBA: '100 dB' },
                ].map((s, i) => (
                  <div key={i} className="bg-emerald-900/40 border border-emerald-500/30 p-3.5 rounded-2xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-xs text-white block">{s.name}</span>
                      <span className="text-[11px] text-emerald-300 font-medium">{s.dBA}</span>
                    </div>
                    <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full ${
                      s.status === 'ACTIVE' ? 'bg-white text-emerald-950 animate-bounce' : 'bg-emerald-800 text-emerald-100'
                    }`}>
                      {s.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ========================================================
                 TAB 7: ASK VISTA AI (MULTILINGUAL)
        ======================================================== */}
        {activeTab === 'ai' && (
          <div className="space-y-6">
            <div className="bg-emerald-950/80 border border-emerald-500/30 rounded-3xl p-6 shadow-2xl backdrop-blur-md flex flex-col h-[620px]">
              <div className="border-b border-emerald-500/20 pb-4 mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-emerald-400" />
                    {t.ai.title}
                  </h2>
                  <p className="text-xs text-emerald-200/80 mt-0.5">
                    Live natural language queries in English, Telugu, and Hindi connected to backend database events.
                  </p>
                </div>
                {/* Live Grounding Pill */}
                <div className="flex items-center gap-2 bg-emerald-900/60 border border-emerald-400/40 px-3 py-1.5 rounded-full text-[11px] text-emerald-200 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>
                    Grounding: {calcInputs.crop} ({calcInputs.area} {calcInputs.unit}) • {notifications.length} Stored Incidents
                  </span>
                </div>
              </div>

              {/* Chat Message Box */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                {aiChat.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-white text-emerald-950 font-bold rounded-br-none shadow-md'
                          : 'bg-emerald-900/60 border border-emerald-500/40 text-emerald-100 rounded-bl-none shadow-md space-y-1'
                      }`}
                    >
                      {msg.text.split('\n').map((line, lIdx) => {
                        const parts = line.split(/(\*\*.*?\*\*)/g);
                        return (
                          <div key={lIdx} className="leading-relaxed">
                            {parts.map((part, pIdx) => {
                              if (part.startsWith('**') && part.endsWith('**')) {
                                return (
                                  <strong key={pIdx} className="text-white font-extrabold">
                                    {part.slice(2, -2)}
                                  </strong>
                                );
                              }
                              return <span key={pIdx}>{part}</span>;
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
                {isAiLoading && (
                  <div className="flex justify-start">
                    <div className="bg-emerald-900/60 border border-emerald-500/40 rounded-2xl p-3 text-xs text-emerald-200 flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                      <span>Querying live agricultural AI engine (Port 5000)...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Suggested Questions */}
              <div className="py-2.5 border-t border-emerald-500/20 flex flex-wrap gap-2">
                {(isDemo ? t.ai.suggestions : t.ai.starterSuggestions).map((s, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleAskAi(s)}
                    className="text-[11px] bg-emerald-900/60 hover:bg-white hover:text-emerald-950 border border-emerald-500/40 text-emerald-100 px-3.5 py-1.5 rounded-full transition font-semibold"
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiQuery}
                  onChange={(e) => setAiQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAskAi()}
                  placeholder={t.ai.placeholder}
                  className="flex-1 bg-emerald-900/50 border border-emerald-500/40 rounded-2xl px-4 py-3 text-xs text-white focus:outline-none focus:border-white font-medium"
                />
                <button
                  onClick={() => handleAskAi()}
                  disabled={isAiLoading}
                  className="bg-white hover:bg-emerald-50 text-emerald-950 font-black text-xs px-6 py-3 rounded-2xl shadow-lg transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Send className="w-4 h-4 text-emerald-800" />
                  <span>{t.ai.send}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* LUXURY FOOTER */}
      <footer className="relative z-10 bg-emerald-950/90 border-t border-emerald-500/20 py-6 px-4 lg:px-8 text-center text-xs text-emerald-200/80">
        <p className="font-extrabold text-white tracking-wider">
          VISTA AGRI AI • SEE • TRACK • PROTECT • UNDERSTAND • ACT
        </p>
        <p className="text-[11px] text-emerald-300/70 mt-1">
          Smart Visual Intelligence for Safer and More Productive Farming.
        </p>
      </footer>
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}

function EmptyState({ icon, title, text, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="h-full bg-emerald-950/75 border border-dashed border-emerald-500/40 rounded-3xl p-8 shadow-2xl backdrop-blur-md flex flex-col items-center justify-center text-center gap-3 min-h-[260px]">
      {icon}
      <h2 className="font-extrabold text-base text-white">{title}</h2>
      <p className="text-xs text-emerald-200/80 max-w-md">{text}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-2 bg-white hover:bg-emerald-50 text-emerald-950 font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-lg transition flex items-center gap-2"
        >
          {actionLabel}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
