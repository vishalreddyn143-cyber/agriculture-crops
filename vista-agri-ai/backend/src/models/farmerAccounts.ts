import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface FarmerAccount {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  preferredLanguage: string;
  passwordHash: string;
}

export type NewFarmerAccount = Omit<FarmerAccount, 'id'>;

export class DuplicateEmailError extends Error {}

// Farmer accounts live in the Supabase `farmers` table when SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are set; otherwise in memory (local development).
// Created on first use, because .env is loaded after this module is imported.
let supabase: SupabaseClient | null | undefined;
const getSupabase = (): SupabaseClient | null => {
  if (supabase === undefined) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    supabase = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
    if (!supabase) console.warn('⚠️ [VISTA-AUTH] Supabase not configured. Farmer accounts are kept in memory only.');
  }
  return supabase;
};

const memoryAccounts = new Map<string, FarmerAccount>();

const fromRow = (row: any): FarmerAccount => ({
  id: row.id,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone || '',
  preferredLanguage: row.preferred_language || 'en',
  passwordHash: row.password_hash,
});

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
    const created = { ...account, id: crypto.randomUUID() };
    memoryAccounts.set(account.email, created);
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
