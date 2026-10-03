import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface FarmerAccount {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  preferredLanguage: string;
  passwordHash: string;
  // True once the farmer has registered their face for password-free sign-in
  hasFaceLogin: boolean;
}

export type NewFarmerAccount = Omit<FarmerAccount, 'id' | 'hasFaceLogin'>;

export class DuplicateEmailError extends Error {}

// Thrown when the `face_descriptor` column has not been added to the farmers table yet
export class FaceLoginUnavailableError extends Error {}

// Farmer accounts live in the Supabase `farmers` table when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set; otherwise in memory (local development).
// Created on first use, because .env is loaded after this module is imported.
let supabase: SupabaseClient | null | undefined;
const getSupabase = (): SupabaseClient | null => {
  if (supabase === undefined) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    supabase = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
    if (!supabase) {
      loadLocalStore();
      console.warn(`⚠️ [VISTA-AUTH] Supabase not configured. Farmer accounts are saved locally in ${LOCAL_STORE_FILE}`);
    }
  }
  return supabase;
};

const memoryAccounts = new Map<string, FarmerAccount>();
// Face data is kept apart from FarmerAccount so it never reaches a token or response
export interface FaceRecord {
  descriptor: number[];
  // Small JPEG data URL of the farmer's registered face, shown when comparing a sign-in scan
  photo: string;
}
const memoryFaces = new Map<string, FaceRecord>();

// Without Supabase (local development), accounts are also written to this file so they survive
// restarts of the dev server. It holds password hashes and photos, so it is git-ignored.
const LOCAL_STORE_FILE = path.join(__dirname, '..', '..', '.data', 'farmers.json');

const loadLocalStore = () => {
  try {
    const saved = JSON.parse(fs.readFileSync(LOCAL_STORE_FILE, 'utf8'));
    for (const account of saved.accounts || []) memoryAccounts.set(account.email, account);
    for (const [id, face] of Object.entries(saved.faces || {})) memoryFaces.set(id, face as FaceRecord);
  } catch {
    // No saved file yet
  }
};

const saveLocalStore = () => {
  try {
    // Owner-only permissions: the file holds password hashes and photos
    fs.mkdirSync(path.dirname(LOCAL_STORE_FILE), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(LOCAL_STORE_FILE), 0o700);
    fs.writeFileSync(
      LOCAL_STORE_FILE,
      JSON.stringify({ accounts: [...memoryAccounts.values()], faces: Object.fromEntries(memoryFaces) }, null, 2),
      { mode: 0o600 },
    );
    // writeFileSync's mode only applies when creating the file, so tighten an existing one too
    fs.chmodSync(LOCAL_STORE_FILE, 0o600);
  } catch (error: any) {
    // Read-only filesystems (e.g. serverless) keep accounts in memory only
    console.warn(`⚠️ [VISTA-AUTH] Could not save local accounts: ${error.message}`);
  }
};

const fromRow = (row: any): FarmerAccount => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone || '',
  preferredLanguage: row.preferred_language || 'en',
  passwordHash: row.password_hash,
  hasFaceLogin: Array.isArray(row.face_descriptor),
});

// PostgREST reports a missing column as PGRST204, Postgres as 42703
const isMissingFaceColumn = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST204' || error.code === '42703' || /face_(descriptor|photo)/.test(error.message || '');

export const findFarmerByEmail = async (email: string): Promise<FarmerAccount | null> => {
  const supabase = getSupabase();
  if (!supabase) return memoryAccounts.get(email) || null;
  const { data, error } = await supabase.from('farmers').select('*').eq('email', email).maybeSingle();
  if (error) throw new Error(`Supabase lookup failed: ${error.message}`);
  return data ? fromRow(data) : null;
};

export const createFarmer = async (account: NewFarmerAccount): Promise<FarmerAccount> => {
  const supabase = getSupabase();
  if (!supabase) {
    if (memoryAccounts.has(account.email)) throw new DuplicateEmailError();
    const created = { ...account, id: crypto.randomUUID(), hasFaceLogin: false };
    memoryAccounts.set(account.email, created);
    saveLocalStore();
    return created;
  }
  const { data, error } = await supabase
    .from('farmers')
    .insert({
      full_name: account.fullName,
      email: account.email,
      phone: account.phone,
      preferred_language: account.preferredLanguage,
      password_hash: account.passwordHash,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new DuplicateEmailError();
    throw new Error(`Supabase insert failed: ${error.message}`);
  }
  return fromRow(data);
};

// Saves (or with null, removes) the farmer's face photo and the descriptor computed from it
export const setFace = async (farmerId: string, face: FaceRecord | null): Promise<FarmerAccount | null> => {
  const supabase = getSupabase();
  if (!supabase) {
    const account = [...memoryAccounts.values()].find((a) => a.id === farmerId);
    if (!account) return null;
    if (face) memoryFaces.set(farmerId, face);
    else memoryFaces.delete(farmerId);
    account.hasFaceLogin = Boolean(face);
    saveLocalStore();
    return account;
  }
  const { data, error } = await supabase
    .from('farmers')
    .update({ face_descriptor: face?.descriptor ?? null, face_photo: face?.photo ?? null })
    .eq('id', farmerId)
    .select('*')
    .maybeSingle();
  if (error) {
    if (isMissingFaceColumn(error)) throw new FaceLoginUnavailableError();
    throw new Error(`Supabase update failed: ${error.message}`);
  }
  return data ? fromRow(data) : null;
};

// Every farmer who has registered a face, for matching a face sign-in (photos are fetched separately)
export const listFaceDescriptors = async (): Promise<Array<{ account: FarmerAccount; descriptor: number[] }>> => {
  const supabase = getSupabase();
  if (!supabase) {
    return [...memoryAccounts.values()]
      .filter((a) => memoryFaces.has(a.id))
      .map((account) => ({ account, descriptor: memoryFaces.get(account.id)!.descriptor }));
  }
  const { data, error } = await supabase
    .from('farmers')
    .select('id, full_name, email, phone, preferred_language, password_hash, face_descriptor')
    .not('face_descriptor', 'is', null);
  if (error) {
    if (isMissingFaceColumn(error)) throw new FaceLoginUnavailableError();
    throw new Error(`Supabase lookup failed: ${error.message}`);
  }
  return (data || []).map((row) => ({ account: fromRow(row), descriptor: row.face_descriptor as number[] }));
};

// The farmer's registered face photo, or null if they have none
export const getFacePhoto = async (farmerId: string): Promise<string | null> => {
  const supabase = getSupabase();
  if (!supabase) return memoryFaces.get(farmerId)?.photo || null;
  const { data, error } = await supabase.from('farmers').select('face_photo').eq('id', farmerId).maybeSingle();
  if (error) {
    if (isMissingFaceColumn(error)) throw new FaceLoginUnavailableError();
    throw new Error(`Supabase lookup failed: ${error.message}`);
  }
  return data?.face_photo || null;
};

// The farmer's registered face descriptor, or null if they have none
export const getFaceDescriptor = async (farmerId: string): Promise<number[] | null> => {
  const supabase = getSupabase();
  if (!supabase) return memoryFaces.get(farmerId)?.descriptor || null;
  const { data, error } = await supabase.from('farmers').select('face_descriptor').eq('id', farmerId).maybeSingle();
  if (error) {
    if (isMissingFaceColumn(error)) throw new FaceLoginUnavailableError();
    throw new Error(`Supabase lookup failed: ${error.message}`);
  }
  return Array.isArray(data?.face_descriptor) ? data.face_descriptor : null;
};
