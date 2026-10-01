'use client';

import React, { useState } from 'react';
import { Mail, Lock, User, Phone, LogIn, UserPlus, Loader2 } from 'lucide-react';
import { MaizeCornLogo } from '@/components/MaizeCornLogo';

export interface AuthUser {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  preferredLanguage?: string;
}

interface LoginPageProps {
  apiBase: string;
  onLogin: (user: AuthUser, token: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ apiBase, onLogin }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = (field: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/auth/${mode === 'signin' ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'signin' ? { email: form.email, password: form.password } : form
        ),
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

        {mode === 'signin' && (
          <p className="text-xs text-emerald-200/70 text-center mt-5">
            Demo account: <span className="font-bold text-white">farmer@vistaagri.ai</span> /{' '}
            <span className="font-bold text-white">farmer123</span>
          </p>
        )}
      </div>
    </div>
  );
};
