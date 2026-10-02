'use client';

import React, { useRef, useState } from 'react';
import { Mail, Lock, User, Phone, LogIn, UserPlus, Loader2, Sprout, ScanFace } from 'lucide-react';
import { MaizeCornLogo } from '@/components/MaizeCornLogo';
import { FaceScanModal, FaceCaptureResult } from '@/components/FaceScanModal';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  preferredLanguage?: string;
  demo?: boolean;
  hasFaceLogin?: boolean;
}

interface LoginPageProps {
  apiBase: string;
  onLogin: (user: AuthUser, token: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ apiBase, onLogin }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [faceScanOpen, setFaceScanOpen] = useState(false);
  // Session from a matched face, applied once the scanner has shown the comparison
  const faceSessionRef = useRef<{ user: AuthUser; token: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submitAuth = async (endpoint: string, body: object) => {
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || 'Something went wrong. Please try again.');
        return;
      }
      onLogin(data.user, data.token);
    } catch {
      setError('Cannot reach the VISTA server. Please check that the backend is running.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Face sign-in: only the live scan's descriptor is sent; the server matches it against saved face photos
  const signInWithFace = async ({ descriptor }: { descriptor: number[] }): Promise<FaceCaptureResult> => {
    try {
      const res = await fetch(`${apiBase}/auth/face/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descriptor }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return { error: data.message || 'Face sign-in failed. Please try again.' };
      faceSessionRef.current = { user: data.user, token: data.token };
      return { savedPhoto: data.savedPhoto, similarity: data.similarity };
    } catch {
      return { error: 'Cannot reach the VISTA server. Please check your connection.' };
    }
  };

  const finishFaceSignIn = () => {
    const session = faceSessionRef.current;
    if (session) onLogin(session.user, session.token);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'signin') submitAuth('login', { email: form.email, password: form.password });
    else submitAuth('register', form);
  };

  const inputClass =
    'w-full bg-emerald-950/60 border border-emerald-500/30 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-emerald-200/50 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 transition';

  return (
    <div className="relative min-h-screen text-white font-sans flex items-center justify-center p-4">
      <div
        className="fixed inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none"
        style={{ backgroundImage: "url('/agriculture/tractor_field_bg.jpg')" }}
      />
      <div className="fixed inset-0 z-0 bg-gradient-to-b from-emerald-950/75 via-emerald-950/80 to-slate-950/90 backdrop-blur-[1.5px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-md bg-emerald-950/80 backdrop-blur-md border border-emerald-400/30 rounded-3xl shadow-2xl p-6 sm:p-8">
        <div className="flex justify-center mb-6">
          <MaizeCornLogo size="lg" showText={true} />
        </div>

        <h1 className="text-2xl font-black text-center">
          {mode === 'signin' ? 'Welcome back, farmer' : 'Create your farm account'}
        </h1>
        <p className="text-sm text-emerald-200/80 text-center mt-1 mb-6">
          {mode === 'signin'
            ? 'Sign in to monitor and protect your fields.'
            : 'Join VISTA AGRI AI to start protecting your crops.'}
        </p>

        <div className="grid grid-cols-2 gap-1 bg-emerald-900/50 p-1 rounded-xl mb-6 text-sm font-bold">
          {(['signin', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`py-2 rounded-lg transition ${
                mode === m ? 'bg-white text-emerald-950 shadow' : 'text-emerald-100 hover:text-white'
              }`}
            >
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <>
              <div className="relative">
                <User className="w-4 h-4 text-emerald-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  className={inputClass}
                  placeholder="Full name"
                  value={form.fullName}
                  onChange={update('fullName')}
                  autoComplete="name"
                  required
                />
              </div>
              <div className="relative">
                <Phone className="w-4 h-4 text-emerald-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  className={inputClass}
                  placeholder="Phone (optional)"
                  type="tel"
                  value={form.phone}
                  onChange={update('phone')}
                  autoComplete="tel"
                />
              </div>
            </>
          )}
          <div className="relative">
            <Mail className="w-4 h-4 text-emerald-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              className={inputClass}
              placeholder="Email address"
              type="email"
              value={form.email}
              onChange={update('email')}
              autoComplete="email"
              required
            />
          </div>
          <div className="relative">
            <Lock className="w-4 h-4 text-emerald-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              className={inputClass}
              placeholder="Password"
              type="password"
              value={form.password}
              onChange={update('password')}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 6 : undefined}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-amber-200 bg-amber-950/60 border border-amber-500/40 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black py-3 rounded-xl shadow-lg transition disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === 'signin' ? (
              <LogIn className="w-4 h-4" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            <span>{mode === 'signin' ? 'Sign In' : 'Create Account'}</span>
          </button>
        </form>

        <div className="flex items-center gap-3 my-5 text-xs text-emerald-200/60">
          <span className="flex-1 h-px bg-emerald-500/30" />
          or
          <span className="flex-1 h-px bg-emerald-500/30" />
        </div>

        <button
          type="button"
          onClick={() => setFaceScanOpen(true)}
          disabled={isSubmitting}
          className="w-full mb-3 bg-white hover:bg-emerald-50 text-emerald-950 font-black py-3 rounded-xl shadow-lg transition disabled:opacity-60 flex items-center justify-center gap-2"
        >
          <ScanFace className="w-4 h-4" />
          <span>Sign in with Photo</span>
        </button>

        <button
          type="button"
          onClick={() => submitAuth('demo', {})}
          disabled={isSubmitting}
          className="w-full bg-transparent hover:bg-emerald-900/60 text-white font-bold py-3 rounded-xl border border-emerald-400/50 transition disabled:opacity-60 flex items-center justify-center gap-2"
        >
          <Sprout className="w-4 h-4 text-emerald-400" />
          <span>Try the Demo Farm</span>
        </button>
      </div>

      {faceScanOpen && <FaceScanModal mode="login" onCapture={signInWithFace} onSuccess={finishFaceSignIn} onClose={() => setFaceScanOpen(false)} />}
    </div>
  );
};
