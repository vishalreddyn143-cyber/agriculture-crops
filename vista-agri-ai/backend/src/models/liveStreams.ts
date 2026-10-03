import crypto from 'crypto';
import { getSupabase } from './farmerAccounts';

// A device streaming its camera to the farmer's other signed-in devices. Only the WebRTC
// handshake (SDP offer/answer) passes through here; the video goes directly between devices.
export interface LiveStream {
  id: string;
  farmerId: string;
  deviceName: string;
  offer: string;
  answer: string | null;
  // 'waiting' until a viewer answers, then 'connected'
  status: 'waiting' | 'connected';
  createdAt: string;
  updatedAt: string;
}

// The streaming device checks in every couple of seconds; a stream silent for longer is gone
export const STREAM_STALE_MS = 20_000;

export class LiveStreamStorageUnavailableError extends Error {}

const isMissingTable = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST205' || error.code === '42P01' || /live_streams/i.test(error.message || '');

const fail = (error: { code?: string; message?: string }, action: string): never => {
  if (isMissingTable(error)) throw new LiveStreamStorageUnavailableError();
  throw new Error(`Supabase ${action} failed: ${error.message}`);
};

const fromRow = (row: any): LiveStream => ({
  id: row.id,
  farmerId: row.farmer_id,
  deviceName: row.device_name,
  offer: row.offer,
  answer: row.answer,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Local development without Supabase: streams live in memory only (they are short-lived anyway)
const memory = new Map<string, LiveStream>();
const staleBefore = () => new Date(Date.now() - STREAM_STALE_MS).toISOString();

// Active streams of this farmer; stale ones are removed on the way
export const listLiveStreams = async (farmerId: string): Promise<LiveStream[]> => {
  const supabase = getSupabase();
  if (!supabase) {
    const cutoff = staleBefore();
    for (const [id, s] of memory) if (s.updatedAt < cutoff) memory.delete(id);
    return [...memory.values()].filter((s) => s.farmerId === farmerId);
  }
  await supabase.from('live_streams').delete().eq('farmer_id', farmerId).lt('updated_at', staleBefore());
  const { data, error } = await supabase.from('live_streams').select('*').eq('farmer_id', farmerId).order('created_at');
  if (error) fail(error, 'live stream lookup');
  return (data || []).map(fromRow);
};

export const getLiveStream = async (farmerId: string, id: string): Promise<LiveStream | null> => {
  const supabase = getSupabase();
  if (!supabase) {
    const s = memory.get(id);
    return s && s.farmerId === farmerId && s.updatedAt >= staleBefore() ? s : null;
  }
  const { data, error } = await supabase
    .from('live_streams')
    .select('*')
    .eq('id', id)
    .eq('farmer_id', farmerId)
    .gte('updated_at', staleBefore())
    .maybeSingle();
  if (error) fail(error, 'live stream lookup');
  return data ? fromRow(data) : null;
};

export const createLiveStream = async (farmerId: string, deviceName: string, offer: string): Promise<LiveStream> => {
  const supabase = getSupabase();
  if (!supabase) {
    const now = new Date().toISOString();
    const stream: LiveStream = { id: crypto.randomUUID(), farmerId, deviceName, offer, answer: null, status: 'waiting', createdAt: now, updatedAt: now };
    memory.set(stream.id, stream);
    return stream;
  }
  const { data, error } = await supabase
    .from('live_streams')
    .insert({ farmer_id: farmerId, device_name: deviceName, offer, status: 'waiting' })
    .select('*')
    .single();
  if (error) fail(error, 'live stream insert');
  return fromRow(data);
};

type StreamPatch = Partial<Pick<LiveStream, 'offer' | 'answer' | 'status'>>;

// Applies a change to this farmer's stream (optionally only while it has a given status) and
// refreshes its check-in time. Returns null if no matching stream exists.
export const updateLiveStream = async (
  farmerId: string,
  id: string,
  patch: StreamPatch,
  onlyIfStatus?: LiveStream['status'],
): Promise<LiveStream | null> => {
  const supabase = getSupabase();
  const updatedAt = new Date().toISOString();
  if (!supabase) {
    const s = memory.get(id);
    if (!s || s.farmerId !== farmerId || (onlyIfStatus && s.status !== onlyIfStatus)) return null;
    Object.assign(s, patch, { updatedAt });
    return s;
  }
  let query = supabase
    .from('live_streams')
    .update({ ...patch, updated_at: updatedAt })
    .eq('id', id)
    .eq('farmer_id', farmerId);
  if (onlyIfStatus) query = query.eq('status', onlyIfStatus);
  const { data, error } = await query.select('*').maybeSingle();
  if (error) fail(error, 'live stream update');
  return data ? fromRow(data) : null;
};

export const endLiveStream = async (farmerId: string, id: string): Promise<void> => {
  const supabase = getSupabase();
  if (!supabase) {
    const s = memory.get(id);
    if (s && s.farmerId === farmerId) memory.delete(id);
    return;
  }
  const { error } = await supabase.from('live_streams').delete().eq('id', id).eq('farmer_id', farmerId);
  if (error) fail(error, 'live stream end');
};
