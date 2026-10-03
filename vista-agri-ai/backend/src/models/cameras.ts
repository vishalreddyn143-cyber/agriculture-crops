import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getSupabase } from './farmerAccounts';

// How the browser reaches the camera:
// - 'device': a camera attached to the viewing phone/laptop (getUserMedia)
// - 'hls':    an HTTPS HLS stream (.m3u8), e.g. from a cloud camera or a go2rtc/MediaMTX bridge
// - 'mjpeg':  an HTTPS MJPEG stream or snapshot URL
export type CameraType = 'device' | 'hls' | 'mjpeg';

export interface Camera {
  id: string;
  farmerId: string;
  name: string;
  location: string;
  type: CameraType;
  streamUrl: string | null;
  // 'device' cameras: the browser's camera id and label, which only work on the device that saved them
  deviceId: string | null;
  deviceLabel: string | null;
  // Run YOLO on this camera in Live Vision and raise alerts
  aiAlerts: boolean;
  createdAt: string;
}

export type CameraInput = Omit<Camera, 'id' | 'farmerId' | 'createdAt'>;

// Thrown when the `cameras` table has not been created in Supabase yet
export class CameraStorageUnavailableError extends Error {}

// PostgREST reports a missing table as PGRST205, Postgres as 42P01
const isMissingTable = (error: { code?: string; message?: string }) =>
  error.code === 'PGRST205' || error.code === '42P01' || /relation .*cameras.* does not exist|table .*cameras/i.test(error.message || '');

const fromRow = (row: any): Camera => ({
  id: row.id,
  farmerId: row.farmer_id,
  name: row.name,
  location: row.location || '',
  type: row.type,
  streamUrl: row.stream_url,
  deviceId: row.device_id,
  deviceLabel: row.device_label,
  aiAlerts: row.ai_alerts,
  createdAt: row.created_at,
});

const toRow = (input: CameraInput) => ({
  name: input.name,
  location: input.location,
  type: input.type,
  stream_url: input.streamUrl,
  device_id: input.deviceId,
  device_label: input.deviceLabel,
  ai_alerts: input.aiAlerts,
});

/* Without Supabase (local development), cameras are kept in memory and in a git-ignored file */
const LOCAL_FILE = path.join(__dirname, '..', '..', '.data', 'cameras.json');
let localCameras: Camera[] | null = null;
const local = (): Camera[] => {
  if (!localCameras) {
    try {
      localCameras = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
    } catch {
      localCameras = [];
    }
  }
  return localCameras!;
};
const saveLocal = () => {
  try {
    fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(local(), null, 2), { mode: 0o600 });
    fs.chmodSync(LOCAL_FILE, 0o600);
  } catch (error: any) {
    console.warn(`⚠️ [VISTA-CAMERAS] Could not save local cameras: ${error.message}`);
  }
};

const fail = (error: { code?: string; message?: string }, action: string): never => {
  if (isMissingTable(error)) throw new CameraStorageUnavailableError();
  throw new Error(`Supabase ${action} failed: ${error.message}`);
};

export const listCameras = async (farmerId: string): Promise<Camera[]> => {
  const supabase = getSupabase();
  if (!supabase) return local().filter((c) => c.farmerId === farmerId);
  const { data, error } = await supabase.from('cameras').select('*').eq('farmer_id', farmerId).order('created_at');
  if (error) fail(error, 'camera lookup');
  return (data || []).map(fromRow);
};

export const createCamera = async (farmerId: string, input: CameraInput): Promise<Camera> => {
  const supabase = getSupabase();
  if (!supabase) {
    const camera: Camera = { ...input, id: crypto.randomUUID(), farmerId, createdAt: new Date().toISOString() };
    local().push(camera);
    saveLocal();
    return camera;
  }
  const { data, error } = await supabase
    .from('cameras')
    .insert({ ...toRow(input), farmer_id: farmerId })
    .select('*')
    .single();
  if (error) fail(error, 'camera insert');
  return fromRow(data);
};

// Updates or deletes only when the camera belongs to this farmer; returns null otherwise
export const updateCamera = async (farmerId: string, id: string, input: CameraInput): Promise<Camera | null> => {
  const supabase = getSupabase();
  if (!supabase) {
    const camera = local().find((c) => c.id === id && c.farmerId === farmerId);
    if (!camera) return null;
    Object.assign(camera, input);
    saveLocal();
    return camera;
  }
  const { data, error } = await supabase
    .from('cameras')
    .update(toRow(input))
    .eq('id', id)
    .eq('farmer_id', farmerId)
    .select('*')
    .maybeSingle();
  if (error) fail(error, 'camera update');
  return data ? fromRow(data) : null;
};

export const deleteCamera = async (farmerId: string, id: string): Promise<boolean> => {
  const supabase = getSupabase();
  if (!supabase) {
    const before = local().length;
    localCameras = local().filter((c) => !(c.id === id && c.farmerId === farmerId));
    saveLocal();
    return localCameras.length < before;
  }
  const { data, error } = await supabase.from('cameras').delete().eq('id', id).eq('farmer_id', farmerId).select('id');
  if (error) fail(error, 'camera delete');
  return (data || []).length > 0;
};
