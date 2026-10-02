import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { FarmerAccount, findFarmerByEmail, createFarmer, DuplicateEmailError } from './models/farmerAccounts';
import connectDB from './config/db';
import { DataStore, createEmptyStore, FarmProtectionPlan, EventItem, NotificationItem } from './models/store';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Security and standard middlewares
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(express.json());
// Render and Vercel sit behind a proxy; trust it so req.ip is the real client IP for rate limiting
app.set('trust proxy', 1);

// Simple in-memory fixed-window rate limiter
const rateLimit = (max: number, windowMs: number, keyFn: (req: Request) => string) => {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = keyFn(req);
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
      return next();
    }
    if (++entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ success: false, message: 'Too many requests. Please wait and try again.' });
    }
    return next();
  };
};

// Initialize DB
connectDB();

/* ============================================================
                      1. HEALTH & SYSTEM
============================================================ */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    app: 'VISTA AGRI AI API',
    version: '1.0.0',
    mode: 'PRODUCTION_HYBRID',
    timestamp: new Date().toISOString(),
  });
});

/* ============================================================
                      2. AUTHENTICATION
============================================================ */
// Without a configured secret, use a random one so tokens can't be forged (they reset on restart).
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

const publicUser = ({ passwordHash, ...user }: FarmerAccount) => ({ ...user, verified: true });
type PublicUser = ReturnType<typeof publicUser> & { demo?: boolean };

// The token carries the farmer's profile, so sessions survive server restarts
const signToken = (user: FarmerAccount) =>
  jwt.sign({ user: publicUser(user) }, JWT_SECRET, { expiresIn: '7d' });

// Returns the signed-in farmer for a request's Bearer token, or null
const userFromRequest = (req: Request): PublicUser | null => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { user?: PublicUser };
    return payload.user || null;
  } catch {
    return null;
  }
};

// 10 sign-in / sign-up attempts per IP every 15 minutes
const authAttemptLimit = rateLimit(10, 15 * 60 * 1000, (req) => req.ip || 'unknown');

// Demo account: opened with the "Try demo" button and comes with the sample farm data
const DEMO_USER = {
  id: 'usr-demo',
  fullName: 'Ramesh Patel',
  email: 'demo@vistaagri.ai',
  phone: '+91 98765 43210',
  preferredLanguage: 'en',
  verified: true,
  demo: true,
};

// Each farmer gets their own farm data: the demo sees the sample farm, everyone else starts empty
const farmStores = new Map<string, DataStore>();
const db = (res: Response): DataStore => {
  const userId: string = res.locals.user.id;
  let store = farmStores.get(userId);
  if (!store) {
    store = userId === DEMO_USER.id ? new DataStore() : createEmptyStore();
    farmStores.set(userId, store);
  }
  return store;
};

app.post('/api/auth/demo', authAttemptLimit, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to the VISTA AGRI AI demo farm',
    user: DEMO_USER,
    token: jwt.sign({ user: DEMO_USER }, JWT_SECRET, { expiresIn: '1d' }),
  });
});

app.post('/api/auth/register', authAttemptLimit, async (req, res) => {
  const { fullName, email, phone, password, preferredLanguage } = req.body;
  if (!email || !fullName || !password) {
    return res.status(400).json({ success: false, message: 'Full name, email and password are required.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }
  let account: FarmerAccount;
  try {
    account = await createFarmer({
      fullName: String(fullName).trim(),
      email: String(email).trim().toLowerCase(),
      phone: phone || '',
      preferredLanguage: preferredLanguage || 'en',
      passwordHash: await bcrypt.hash(String(password), 10),
    });
  } catch (error: any) {
    if (error instanceof DuplicateEmailError) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }
    console.error(`❌ [VISTA-AUTH] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Could not create your account. Please try again.' });
  }

  return res.status(201).json({
    success: true,
    message: 'Farmer account created successfully.',
    user: publicUser(account),
    token: signToken(account),
  });
});

app.post('/api/auth/login', authAttemptLimit, async (req, res) => {
  const { email, password } = req.body;
  let account: FarmerAccount | null;
  try {
    account = await findFarmerByEmail(String(email || '').trim().toLowerCase());
  } catch (error: any) {
    console.error(`❌ [VISTA-AUTH] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Could not sign you in. Please try again.' });
  }
  if (!account || !password || !(await bcrypt.compare(String(password), account.passwordHash))) {
    return res.status(401).json({ success: false, message: 'Invalid email or password.' });
  }
  return res.status(200).json({
    success: true,
    message: 'Welcome back to VISTA AGRI AI',
    user: publicUser(account),
    token: signToken(account),
  });
});

// Every API route registered after this point requires a signed-in farmer
app.use('/api', (req, res, next) => {
  const user = userFromRequest(req);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Not signed in.' });
  }
  res.locals.user = user;
  return next();
});

app.get('/api/auth/me', (req, res) => {
  res.status(200).json({ success: true, user: res.locals.user });
});

/* ============================================================
                   3. FARMS & FIELDS
============================================================ */
app.get('/api/farms', (req, res) => {
  res.status(200).json({ success: true, farms: db(res).farms });
});

app.post('/api/farms', (req, res) => {
  const { name, village, district, state, area, areaUnit } = req.body;
  const newFarm = {
    id: `farm-${Date.now()}`,
    name: name || 'New Smart Farm',
    village: village || 'Village Center',
    district: district || 'Rural District',
    state: state || 'Telangana',
    country: 'India',
    area: Number(area) || 5,
    areaUnit: areaUnit || 'Acres',
    createdAt: new Date().toISOString(),
  };
  db(res).farms.unshift(newFarm);
  res.status(201).json({ success: true, farm: newFarm });
});

app.get('/api/fields', (req, res) => {
  res.status(200).json({ success: true, fields: db(res).fields });
});

app.post('/api/fields', (req, res) => {
  const { farmId, name, area, shape, soilType, irrigationType, crop, cropStage, animalRisk } = req.body;
  const newField = {
    id: `field-${Date.now()}`,
    farmId: farmId || db(res).farms[0]?.id || 'farm-01',
    name: name || 'Main Field Block',
    area: Number(area) || 5,
    shape: shape || 'Rectangle',
    soilType: soilType || 'Alluvial',
    irrigationType: irrigationType || 'Drip',
    crop: crop || 'Cotton',
    cropStage: cropStage || 'Vegetative',
    animalRisk: animalRisk || 'HIGH',
  };
  db(res).fields.unshift(newField);
  res.status(201).json({ success: true, field: newField });
});

/* ============================================================
             4. SMART FARM CALCULATOR ENGINE
============================================================ */
app.post('/api/calculator/calculate', (req, res) => {
  const {
    fieldArea = 10,
    areaUnit = 'Acres',
    crop = 'Cotton',
    cropStage = 'Boll Formation',
    animalRisk = 'HIGH',
    entrances = 2,
    existingCameras = 0,
    existingSirens = 0,
    fieldShape = 'Rectangle',
  } = req.body;

  // Transparent Agricultural Infrastructure Formulas:
  // Base perimeter coverage: 1 camera per ~100m of perimeter + entrance gates
  const acres = Number(fieldArea) || 10;
  // Approximated perimeter in meters for standard square/rectangular plot: P = 4 * sqrt(acres * 4046.86)
  const approxPerimeterMeters = Math.round(4 * Math.sqrt(acres * 4046.86));
  
  // Camera formula: base 1 cam per 1.5 acres, +1 per entrance, +2 if high animal risk
  const riskMultiplier = animalRisk === 'CRITICAL' ? 1.5 : animalRisk === 'HIGH' ? 1.25 : 1.0;
  const rawCameras = Math.ceil((acres / 1.5) * riskMultiplier) + Number(entrances);
  const estimatedCameraCount = Math.max(rawCameras, 4);

  // Siren formula: Sonic range ~ 100m radius (~3-4 hectares/siren). High animal corridors require dedicated acoustic repeller.
  const rawSirens = Math.ceil(acres / 3) + (animalRisk === 'HIGH' || animalRisk === 'CRITICAL' ? 1 : 0);
  const estimatedSirenCount = Math.max(rawSirens, 2);

  const additionalCameras = Math.max(0, estimatedCameraCount - Number(existingCameras));
  const additionalSirens = Math.max(0, estimatedSirenCount - Number(existingSirens));

  // High-Risk Zones calculation based on crop and risk factor
  const highRiskZones = [
    'North Boundary (Adjacent forest/brush entry corridor)',
    'East Access Gate & Machinery Path',
    'South Canal & Low Water Drainage Corner',
  ];

  const blindSpots = [
    'Dense shrubbery cluster at West perimeter',
    'South-East canal depression slope',
  ];

  const coverageEstimate = Math.min(96, Math.max(75, 88 + Math.floor(acres % 7)));

  // Generate suggested device placements (percentage coordinates 0-100 on field map)
  const cameraPlacements = [
    { id: 'c-1', name: 'North Boundary PTZ', x: 25, y: 15, angle: 180, range: 45 },
    { id: 'c-2', name: 'East Main Entrance', x: 80, y: 30, angle: 260, range: 40 },
    { id: 'c-3', name: 'South Crop Zone', x: 70, y: 80, angle: 330, range: 42 },
    { id: 'c-4', name: 'West Wildlife Corridor', x: 15, y: 70, angle: 45, range: 50 },
    { id: 'c-5', name: 'Center Irrigation Hub', x: 50, y: 50, angle: 0, range: 38 },
    { id: 'c-6', name: 'North-East Perimeter Gate', x: 85, y: 15, angle: 220, range: 35 },
    { id: 'c-7', name: 'South-West Runoff Dip', x: 20, y: 88, angle: 60, range: 40 },
    { id: 'c-8', name: 'Main Road Approach', x: 50, y: 10, angle: 170, range: 45 },
  ].slice(0, estimatedCameraCount);

  const sirenPlacements = [
    { id: 's-1', name: 'North Boundary Sonic Horn', x: 30, y: 12, radius: 45 },
    { id: 's-2', name: 'East Gate Strobe-Siren', x: 82, y: 32, radius: 40 },
    { id: 's-3', name: 'South Buffer Siren', x: 65, y: 85, radius: 42 },
    { id: 's-4', name: 'West Corridor Repeller', x: 18, y: 68, radius: 48 },
  ].slice(0, estimatedSirenCount);

  const formulaExplanation = {
    title: `Why ${estimatedCameraCount} Cameras & ${estimatedSirenCount} Sirens?`,
    factors: [
      `Field Area: ${acres} ${areaUnit} (approx. ${approxPerimeterMeters}m perimeter)`,
      `Crop Vulnerability: ${crop} in ${cropStage} stage requires uninterrupted line of sight over canopy`,
      `Wildlife Risk Level: ${animalRisk} risk adds dedicated corridor surveillance`,
      `Entrances: ${entrances} physical gates requiring entry-angle optical coverage`,
      `Acoustic Coverage: High-decibel safe acoustic sirens spaced for minimum 85dB deterrent coverage across boundaries`,
    ],
    note: 'Estimated planning result for agricultural layout guidance.',
  };

  res.status(200).json({
    success: true,
    estimatedCameraCount,
    existingCameraCount: Number(existingCameras),
    additionalCameraCount: additionalCameras,
    estimatedSirenCount,
    existingSirenCount: Number(existingSirens),
    additionalSirenCount: additionalSirens,
    coverageEstimate,
    approxPerimeterMeters,
    highRiskZones,
    blindSpots,
    cameraPlacements,
    sirenPlacements,
    formulaExplanation,
  });
});

app.post('/api/calculator/farm-protection-plan', (req, res) => {
  const planData = req.body;
  const newPlan: FarmProtectionPlan = {
    id: `plan-${Date.now()}`,
    farmId: planData.farmId || 'farm-01',
    fieldId: planData.fieldId || 'field-01',
    crop: planData.crop || 'Cotton',
    fieldArea: planData.fieldArea || 10,
    estimatedCameraCount: planData.estimatedCameraCount || 8,
    existingCameraCount: planData.existingCameraCount || 2,
    additionalCameraCount: planData.additionalCameraCount || 6,
    estimatedSirenCount: planData.estimatedSirenCount || 4,
    existingSirenCount: planData.existingSirenCount || 1,
    additionalSirenCount: planData.additionalSirenCount || 3,
    coverageEstimate: planData.coverageEstimate || 92,
    highRiskZones: planData.highRiskZones || ['North Boundary', 'East Entrance', 'West Animal Corridor'],
    blindSpots: planData.blindSpots || ['South Canal Corner', 'Dense Shrubbery'],
    cameraPlacements: planData.cameraPlacements || [],
    sirenPlacements: planData.sirenPlacements || [],
    calculationInputs: planData.calculationInputs || {},
    calculationTimestamp: new Date().toISOString(),
  };

  db(res).protectionPlans.unshift(newPlan);
  res.status(201).json({
    success: true,
    message: 'Farm Protection Plan saved successfully',
    plan: newPlan,
  });
});

app.get('/api/calculator/farm-protection-plan', (req, res) => {
  const latestPlan = db(res).protectionPlans[0];
  res.status(200).json({ success: true, plan: latestPlan });
});

/* ============================================================
                      5. DEVICES & SIRENS
============================================================ */
app.get('/api/devices', (req, res) => {
  res.status(200).json({ success: true, devices: db(res).devices });
});

app.post('/api/sirens/:id/test', (req, res) => {
  const { id } = req.params;
  const siren = db(res).devices.find((d) => d.id === id);
  if (!siren) {
    return res.status(404).json({ success: false, message: 'Siren not found' });
  }

  siren.status = 'TRIGGERED';
  setTimeout(() => {
    siren.status = 'ONLINE';
  }, 4000);

  res.status(200).json({
    success: true,
    message: `🔊 Test alert sounded on ${siren.name} for 4 seconds. Decibel reading: 95dB. Safe deterrent pulse active.`,
    device: siren,
  });
});

app.post('/api/sirens/emergency-stop', (req, res) => {
  db(res).devices.forEach((d) => {
    if (d.type === 'SIREN' && d.status === 'TRIGGERED') {
      d.status = 'ONLINE';
    }
  });

  res.status(200).json({
    success: true,
    message: '🛑 All sirens silenced immediately. Emergency Stop executed.',
  });
});

/* ============================================================
                6. EVENTS & LIFE CYCLE
============================================================ */
app.get('/api/events', (req, res) => {
  res.status(200).json({ success: true, events: db(res).events });
});

app.get('/api/events/:id', (req, res) => {
  const event = db(res).events.find((e) => e.id === req.params.id);
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }
  res.status(200).json({ success: true, event });
});

app.post('/api/events/:id/resolve', (req, res) => {
  const event = db(res).events.find((e) => e.id === req.params.id);
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }
  event.status = 'RESOLVED';
  res.status(200).json({
    success: true,
    message: `Event ${event.id} marked as RESOLVED. Action closed.`,
    event,
  });
});

app.post('/api/events/:id/confirm', (req, res) => {
  const event = db(res).events.find((e) => e.id === req.params.id);
  if (!event) {
    return res.status(404).json({ success: false, message: 'Event not found' });
  }
  event.status = 'ACTION_TAKEN';
  res.status(200).json({
    success: true,
    message: `Farmer confirmed incident ${event.id}.`,
    event,
  });
});

/* ============================================================
                7. NOTIFICATIONS ENGINE
============================================================ */
app.get('/api/notifications', (req, res) => {
  // Alerts whose incident has been resolved are closed and no longer listed
  const resolvedEventIds = new Set(db(res).events.filter((e) => e.status === 'RESOLVED').map((e) => e.id));
  const openNotifications = db(res).notifications.filter((n) => !resolvedEventIds.has(n.eventId));
  res.status(200).json({ success: true, notifications: openNotifications });
});

app.post('/api/notifications/:id/read', (req, res) => {
  const notif = db(res).notifications.find((n) => n.id === req.params.id);
  if (notif) notif.read = true;
  res.status(200).json({ success: true, notification: notif });
});

/* ============================================================
                8. MASTER DEMO SIMULATOR
============================================================ */
app.post('/api/demo/trigger-wild-boar', (req, res) => {
  // Simulate complete end-to-end detection pipeline
  const newEventId = `evt-${Date.now()}`;
  const newEvent: EventItem = {
    id: newEventId,
    eventType: 'ANIMAL',
    objectType: 'Wild Boar',
    trackId: `#${Math.floor(Math.random() * 80 + 10)}`,
    farmId: 'farm-01',
    fieldId: 'field-01',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    location: 'North-East Boundary Corridor',
    zone: 'Crop Protection Zone',
    confidence: 0.95,
    severity: 'HIGH',
    observations: 'Wild boar crossed fence perimeter heading south toward cotton flowering block',
    possibleCause: 'Forest corridor crossing',
    recommendedAction: 'Safe siren #2 triggered. Verify fence integrity once animal departs.',
    status: 'ACTION_TAKEN',
    evidence: {
      imageUrl: '/agriculture/wild-boar-detection.jpg',
      trajectoryPoints: [
        { x: 18, y: 12, time: 'T-30s' },
        { x: 32, y: 24, time: 'T-20s' },
        { x: 48, y: 38, time: 'T-10s' },
        { x: 62, y: 50, time: 'Now' },
      ],
    },
    sirenActivated: true,
    sirenId: 'siren-02',
  };

  db(res).events.unshift(newEvent);

  // Trigger siren
  const s2 = db(res).devices.find((d) => d.id === 'siren-02');
  if (s2) s2.status = 'TRIGGERED';

  // Push targeted notification
  const newNotif: NotificationItem = {
    id: `notif-${Date.now()}`,
    eventId: newEventId,
    title: '🐗 WILD BOAR ALERT',
    problem: `Wild boar entered Crop Protection Zone (${newEvent.trackId})`,
    objectType: 'Wild Boar',
    location: newEvent.location,
    severity: 'HIGH',
    timestamp: newEvent.timestamp,
    evidenceSummary: `Track ${newEvent.trackId} (95% confidence) inside crop protection boundary`,
    recommendedAction: 'Siren #2 acoustic repellent active. Monitor trajectory.',
    devicesTriggered: ['Siren #2 (Acoustic)', 'Mobile Push', 'Web Alert'],
    read: false,
    channels: { web: true, mobile: true, siren: true, sms: true },
  };
  db(res).notifications.unshift(newNotif);

  res.status(201).json({
    success: true,
    message: 'Master Demo Incident Triggered: YOLO Detect -> BoT-SORT Track -> Geofence Violation -> Siren Activated -> Push Sent!',
    event: newEvent,
    notification: newNotif,
  });
});

/* ============================================================
         9. LIVE VISION DETECTIONS (YOLO IN THE BROWSER)
============================================================ */
// The Live Vision tab runs YOLO11n on the farmer's camera in the browser and
// reports each confirmed sighting here, which turns it into an event and an alert.
const VISION_THREATS: Record<string, { label: string; eventType: EventItem['eventType']; severity: EventItem['severity']; action: string }> = {
  elephant: { label: 'Elephant', eventType: 'ANIMAL', severity: 'CRITICAL', action: 'Keep a safe distance and alert the forest department. Do not approach the animal.' },
  bear: { label: 'Bear', eventType: 'ANIMAL', severity: 'CRITICAL', action: 'Stay indoors and alert the forest department. Do not approach the animal.' },
  cow: { label: 'Cattle', eventType: 'ANIMAL', severity: 'HIGH', action: 'Stray cattle can graze the crop quickly. Guide them out and check the gate.' },
  horse: { label: 'Horse', eventType: 'ANIMAL', severity: 'HIGH', action: 'Guide the animal out of the field and check the boundary for gaps.' },
  sheep: { label: 'Sheep / Goat', eventType: 'ANIMAL', severity: 'HIGH', action: 'A grazing herd can strip young plants. Move them out and close the gate.' },
  dog: { label: 'Dog', eventType: 'ANIMAL', severity: 'MEDIUM', action: 'Check whether it is a stray or a wild canine moving through the field.' },
  cat: { label: 'Cat', eventType: 'ANIMAL', severity: 'LOW', action: 'Usually harmless to crops. No action needed unless it keeps returning.' },
  bird: { label: 'Bird', eventType: 'ANIMAL', severity: 'MEDIUM', action: 'Flocks can damage grain and fruiting crops. Use a scare device if birds keep returning.' },
  person: { label: 'Person', eventType: 'INTRUDER', severity: 'MEDIUM', action: 'Someone is in the field. Confirm whether they are a worker or an intruder.' },
};

// 30 detection reports per farmer per minute (the browser already waits between repeat alerts)
const visionReportLimit = rateLimit(30, 60 * 1000, (req) => req.headers.authorization || req.ip || 'unknown');

app.post('/api/vision/detections', visionReportLimit, (req, res) => {
  const { className, confidence, trackId } = req.body;
  const threat = VISION_THREATS[String(className)];
  const score = Number(confidence);
  if (!threat || !(score > 0 && score <= 1)) {
    return res.status(400).json({ success: false, message: 'Unknown object class or invalid confidence.' });
  }

  const store = db(res);
  const siren = threat.severity === 'LOW' ? undefined : store.devices.find((d) => d.type === 'SIREN' && d.status !== 'OFFLINE');
  if (siren) {
    siren.status = 'TRIGGERED';
    setTimeout(() => {
      siren.status = 'ONLINE';
    }, 10000);
  }

  const id = `evt-${Date.now()}`;
  const confidencePct = Math.round(score * 100);
  const track = trackId ? `#${String(trackId).replace(/[^0-9]/g, '').slice(0, 6)}` : undefined;
  // Farmers are in India, so show times in IST rather than the server's UTC
  const timestamp = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const event: EventItem = {
    id,
    eventType: threat.eventType,
    objectType: threat.label,
    trackId: track,
    farmId: store.farms[0]?.id || 'farm-01',
    fieldId: store.fields[0]?.id || 'field-01',
    timestamp,
    location: 'Live camera feed',
    zone: 'Camera view',
    confidence: score,
    severity: threat.severity,
    observations: `${threat.label} detected by YOLO11n with ${confidencePct}% confidence${track ? ` (track ${track})` : ''}.`,
    possibleCause: threat.eventType === 'INTRUDER' ? 'Person in the field' : 'Animal entering the field',
    recommendedAction: threat.action,
    status: 'DETECTED',
    evidence: { imageUrl: '' },
    sirenActivated: Boolean(siren),
    sirenId: siren?.id,
  };
  store.events.unshift(event);

  const notification: NotificationItem = {
    id: `notif-${Date.now()}`,
    eventId: id,
    title: `${threat.eventType === 'INTRUDER' ? '🚶' : '🐾'} ${threat.label.toUpperCase()} DETECTED`,
    problem: `${threat.label} seen on the live camera`,
    objectType: threat.label,
    location: event.location,
    severity: threat.severity,
    timestamp,
    evidenceSummary: `${event.observations}${siren ? ` ${siren.name} sounded.` : ''}`,
    recommendedAction: threat.action,
    devicesTriggered: siren ? [siren.name, 'Web Alert'] : ['Web Alert'],
    read: false,
    channels: { web: true, mobile: false, siren: Boolean(siren), sms: false },
    source: 'camera',
  };
  store.notifications.unshift(notification);
  // Keep the in-memory history bounded for long camera sessions
  store.events.splice(200);
  store.notifications.splice(200);

  res.status(201).json({ success: true, event, notification, sirenTriggered: Boolean(siren) });
});

/* ============================================================
             10. ASK VISTA AI (ENGLISH, TELUGU, HINDI)
============================================================ */
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', te: 'Telugu', hi: 'Hindi' };

// Ask Groq for an answer grounded in the current farm state. Returns null if Groq is unavailable.
const askGroq = async (question: string, language: string, farmContext: object): Promise<string | null> => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        reasoning_effort: 'low',
        temperature: 0.4,
        max_completion_tokens: 1024,
        messages: [
          {
            role: 'system',
            content:
              `You are VISTA Agri Assistant, a friendly expert agronomist helping Indian farmers protect their crops. ` +
              `Answer in ${LANGUAGE_NAMES[language] || 'English'} only. Keep answers short, practical and use only bold text and bullet lists for formatting (no tables or headings), with a relevant emoji. ` +
              `If farmSetUp is false, the farmer has not added their farm, devices or crops yet: never invent field events, and give general advice instead. ` +
              `Use this live farm data when it is relevant:\n${JSON.stringify(farmContext)}`,
          },
          { role: 'user', content: question },
        ],
      }),
    });
    if (!response.ok) {
      console.warn(`⚠️ [VISTA-AI] Groq request failed: ${response.status} ${await response.text()}`);
      return null;
    }
    const data: any = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (error: any) {
    console.warn(`⚠️ [VISTA-AI] Groq request error: ${error.message}`);
    return null;
  }
};

// 20 chatbot questions per farmer per minute, to protect the Groq quota
const aiAskLimit = rateLimit(20, 60 * 1000, (req) => req.headers.authorization || req.ip || 'unknown');

app.post('/api/ai/ask', aiAskLimit, async (req, res) => {
  const { question, language = 'en' } = req.body;
  const qLower = (question || '').toLowerCase();

  // Ground answers in this farmer's own events & plan
  const activeEvents = db(res).events;
  const plan = db(res).protectionPlans[0];
  const boarEvent = activeEvents.find((e) => e.eventType === 'ANIMAL');
  const damageEvent = activeEvents.find((e) => e.eventType === 'CROP_DAMAGE');
  const weedEvent = activeEvents.find((e) => e.eventType === 'WEED');
  const healthEvent = activeEvents.find((e) => e.eventType === 'CROP_HEALTH');

  let answerEn = '';
  let answerTe = '';
  let answerHi = '';

  // 1. TODAY'S SUMMARY
  if (
    qLower.includes('today') ||
    qLower.includes('happened') ||
    qLower.includes('summary') ||
    qLower.includes('ఏమి జరిగింది') ||
    qLower.includes('ఏం జరిగింది') ||
    qLower.includes('ఈరోజు') ||
    qLower.includes('क्या हुआ') ||
    qLower.includes('आज')
  ) {
    const boarTrack = boarEvent?.trackId || '#17';
    const boarTime = boarEvent?.timestamp || '10:42 AM';

    answerEn = `🌾 **Field Summary for Today:**
1. **🐗 Animal Detection:** At ${boarTime}, a Wild Boar (${boarTrack}) was detected near the North-East boundary. Siren #2 was safely triggered with gentle harmonic deterrence.
2. **⚠️ Crop Disturbance:** 0.8 acres of flattened foliage observed near East boundary plot. Physical stem inspection recommended.
3. **🌿 Weed Pressure:** An 18% weed hotspot was detected in the South-West irrigation furrow competing with root zones.
4. **🌱 Crop Health:** Early leaf yellowing (12% canopy) observed in central plot. All 8 cameras and 4 sirens are fully online.`;

    answerTe = `🌾 **ఈరోజు మీ పొలంలో సమగ్ర వివరాలు:**
1. **🐗 అడవి పంది హెచ్చరిక:** ${boarTime} గంటలకు ఈశాన్య భాగంలో కాటన్ పంట రక్షణ జోన్‌లోకి అడవి పంది (${boarTrack}) వచ్చింది. సైరన్ #2 స్వయంచాలకంగా మోగి జంతువును సురక్షితంగా వెనక్కి పంపింది.
2. **⚠️ పంట నష్టం:** తూర్పు సరిహద్దు వద్ద 0.8 ఎకరాలలో మొక్కలు వాలిపోయినట్లు గుర్తించబడింది. సాయంత్రంలోగా పరిశీలించండి.
3. **🌿 కలుపు మొక్కల సమస్య:** నైరుతి కాలువ ప్రాంతంలో 18% కలుపు వ్యాప్తి కనిపించింది.
4. **🌱 పంట ఆరోగ్యం:** మధ్య భాగంలో 12% పత్తి ఆకులు పసుపు రంగులోకి మారినట్లు గమనించబడింది. 8 కెమెరాలు, 4 సైరన్లు సమర్థవంతంగా పనిచేస్తున్నాయి.`;

    answerHi = `🌾 **आज आपके खेत की मुख्य स्थिति:**
1. **🐗 जंगली सूअर अलर्ट:** ${boarTime} बजे उत्तर-पूर्व फसल सुरक्षा क्षेत्र में जंगली सूअर (ट्रैक ${boarTrack}) आया। सायरन #2 तुरंत बज उठा और जानवर सुरक्षित रूप से दूर चला गया।
2. **⚠️ फसल नुकसान:** पूर्व सीमा के पास 0.8 एकड़ में पौधे मुड़े पाए गए। निरीक्षण की सलाह दी जाती है।
3. **🌿 खरपतवार:** दक्षिण-पश्चिम क्षेत्र में 18% खरपतवार का दबाव देखा गया।
4. **🌱 फसल स्वास्थ्य:** मध्य क्षेत्र में 12% पत्तियों में पीलापन देखा गया है। सभी 8 कैमरे और 4 सायरन चालू हैं।`;
  }
  // 2. SIRENS & DETERRENTS
  else if (
    qLower.includes('siren') ||
    qLower.includes('sound') ||
    qLower.includes('alarm') ||
    qLower.includes('సైరన్') ||
    qLower.includes('ధ్వని') ||
    qLower.includes('सायरन') ||
    qLower.includes('आवाज')
  ) {
    const boarTrack = boarEvent?.trackId || '#17';
    answerEn = `🔊 **Why did Siren #2 activate?**
At ${boarEvent?.timestamp || '10:42 AM'}, Camera #2 detected a wild boar (${boarTrack}) with ${Math.round((boarEvent?.confidence || 0.94) * 100)}% confidence crossing the North-East boundary fence into the sensitive Crop Protection Zone.
Because wildlife risk is set to HIGH and tracking duration exceeded 5 seconds, Siren #2 safely sounded a non-harmful acoustic pulse for 10 seconds to protect the crop.`;

    answerTe = `🔊 **సైరన్ ఎందుకు మోగింది?**
${boarEvent?.timestamp || '10:42 AM'} గంటలకు కెమెరా #2 అడవి పందిని (${boarTrack}) ${Math.round((boarEvent?.confidence || 0.94) * 100)}% ఖచ్చితత్వంతో ఈశాన్య రక్షణ జోన్‌లోకి ప్రవేశించడాన్ని గుర్తించింది.
పంటను రక్షించడానికి మరియు జంతువుకు హాని కలగకుండా సైరన్ #2 పది సెకన్ల పాటు సురక్షితమైన శబ్ద తరంగాలతో మోగించబడింది.`;

    answerHi = `🔊 **सायरन क्यों बजा?**
${boarEvent?.timestamp || '10:42 AM'} बजे कैमरा #2 ने ${Math.round((boarEvent?.confidence || 0.94) * 100)}% विश्वसनीयता के साथ जंगली सूअर (ट्रैक ${boarTrack}) को उत्तर-पूर्व फसल क्षेत्र में आते देखा।
फसल सुरक्षा नियमों के अनुसार सायरन #2 सुरक्षित ध्वनि तरंगों के साथ 10 सेकंड के लिए बजा।`;
  }
  // 3. CROP DAMAGE
  else if (
    qLower.includes('damage') ||
    qLower.includes('disturb') ||
    qLower.includes('నష్టం') ||
    qLower.includes('నష్ట') ||
    qLower.includes('పడిపోయిన') ||
    qLower.includes('नुकसान') ||
    qLower.includes('क्षति')
  ) {
    answerEn = `⚠️ **Crop Damage Status & Inspection Guide:**
- **Location:** Field 1 East Border (Plot #4).
- **Extent:** Approximately 0.8 acres of flattened foliage and broken cotton stems.
- **Probable Cause:** Nocturnal animal transit path or localized wind disturbance.
- **Recommended Action:** Conduct a physical row walk before scheduled irrigation. Stake bending stems and verify perimeter fence tension.`;

    answerTe = `⚠️ **పంట నష్టం వివరాలు మరియు సూచనలు:**
- **ప్రాంతం:** పొలం 1 తూర్పు సరిహద్దు (ప్లాట్ #4).
- **విస్తీర్ణం:** దాదాపు 0.8 ఎకరాలలో పత్తి మొక్కలు నేలవాలినట్లు గుర్తించబడింది.
- **కారణం:** రాత్రిపూట జంతువుల సంచారం లేదా బరువైన గాలుల వల్ల సంభవించి ఉండవచ్చు.
- **చర్య:** నీరు పెట్టే ముందు ఆ ప్రాంతాన్ని స్వయంగా నడిచి పరిశీలించండి. పడిపోయిన మొక్కలకు ఊతం ఇవ్వండి.`;

    answerHi = `⚠️ **फसल क्षति का विवरण एवं सुझाव:**
- **स्थान:** खेत 1 की पूर्वी सीमा (प्लॉट #4)।
- **क्षेत्रफल:** लगभग 0.8 एकड़ में कपास के पौधे गिरे हुए पाए गए हैं।
- **संभावित कारण:** रात्रि में जानवरों की आवाजाही या हवा का दबाव।
- **सुझाव:** अगली सिंचाई से पहले उस क्षेत्र का निरीक्षण करें और झुके हुए पौधों को सहारा दें।`;
  }
  // 4. CROP HEALTH & FOLIAGE
  else if (
    qLower.includes('health') ||
    qLower.includes('cotton') ||
    qLower.includes('foliage') ||
    qLower.includes('yellow') ||
    qLower.includes('ఆరోగ్య') ||
    qLower.includes('పత్తి') ||
    qLower.includes('ఆకులు') ||
    qLower.includes('स्वास्थ्य') ||
    qLower.includes('कपास') ||
    qLower.includes('पत्ती')
  ) {
    answerEn = `🌱 **Cotton Crop Health Analysis:**
- **Overall Foliage Health:** 92% Healthy across 10 Acres.
- **Current Stage:** Boll formation and flowering.
- **Observations:** Multispectral imagery detected 12% canopy chlorosis (mild leaf yellowing) in Central Plot 2, indicative of mild nitrogen leaching or micro-nutrient deficiency.
- **Agronomist Advice:** Apply foliar spray of 1% 19:19:19 NPK with Magnesium Sulphate within 48 hours.`;

    answerTe = `🌱 **పత్తి పంట ఆరోగ్య స్థితి:**
- **మొత్తం పంట ఆరోగ్యం:** 10 ఎకరాలలో 92% ఆరోగ్యంగా ఉంది.
- **ప్రస్తుత దశ:** పూత మరియు కాయ దశ (Boll Formation).
- **పరిశీలన:** సెంట్రల్ ప్లాట్ 2 లో 12% ఆకులలో లేత పసుపు రంగు (క్లోరోసిస్) గమనించబడింది. ఇది నత్రజని లేదా సూక్ష్మపోషకాల లోపం కావచ్చు.
- **వ్యవసాయ సలహా:** 48 గంటల్లోగా 1% 19:19:19 NPK మరియు మెగ్నీషియం సల్ఫేట్ పిచికారీ చేయండి.`;

    answerHi = `🌱 **कपास फसल स्वास्थ्य रिपोर्ट:**
- **समग्र स्वास्थ्य:** 10 एकड़ में 92% स्वस्थ।
- **वर्तमान अवस्था:** फूल एवं टिंडे बनने की अवस्था।
- **निरीक्षण:** मध्य भाग में 12% पत्तियों में हल्का पीलापन पाया गया है, जो सूक्ष्म पोषक तत्वों की कमी का संकेत हो सकता है।
- **कृषि विशेषज्ञ की सलाह:** 48 घंटे के भीतर 1% 19:19:19 NPK और मैग्नीशियम सल्फेट का छिड़काव करें।`;
  }
  // 5. WEEDS
  else if (
    qLower.includes('weed') ||
    qLower.includes('కలుపు') ||
    qLower.includes('खरपतवार')
  ) {
    answerEn = `🌿 **Weed Pressure Report:**
- **Location:** South-West irrigation drainage furrow.
- **Infestation Density:** 18% weed coverage detected.
- **Impact:** Competing with cotton root zones for moisture and nutrients.
- **Action Plan:** Target selective herbicide or manual inter-cultivation along the marked coordinates.`;

    answerTe = `🌿 **కలుపు సమస్య వివరాలు:**
- **ప్రాంతం:** నైరుతి కాలువ మరియు నీటి పారుదల కాలువ వద్ద.
- **తీవ్రత:** 18% కలుపు వ్యాప్తి నమోదైంది.
- **ప్రభావం:** పత్తి వేర్లతో తేమ మరియు పోషకాల కోసం పోటీపడుతోంది.
- **పరిష్కారం:** గుర్తించిన ప్రాంతంలో తక్షణమే అంతర కృషి లేదా కలుపు నివారణ చర్యలు చేపట్టండి.`;

    answerHi = `🌿 **खरपतवार रिपोर्ट:**
- **स्थान:** दक्षिण-पश्चिम जल निकास नाली के पास।
- **घनत्व:** 18% खरपतवार पाया गया।
- **प्रभाव:** मुख्य फसल की जड़ों से नमी और पोषक तत्वों की प्रतिस्पर्धा।
- **सुझाव:** चिन्हित क्षेत्र में तुरंत निराई-गुड़ाई या उपयुक्त खरपतवार नाशक का प्रयोग करें।`;
  }
  // 6. GENERAL ASSISTANT
  else {
    answerEn = `🌾 **VISTA Agri Assistant:**
Monitoring 10 Acres Cotton across 8 camera zones and 4 acoustic sirens. Current overall field safety status is **ATTENTION NEEDED** due to active animal threat and localized weed hotspot. All deterrents and solar sensors are online. You can ask me about field events, sirens, crop damage, weed hotspots, or crop health.`;

    answerTe = `🌾 **విస్టా వ్యవసాయ సహాయకుడు:**
మీ 10 ఎకరాల పత్తి పొలంలో 8 కెమెరాలు మరియు 4 సైరన్లు సమర్థవంతంగా పనిచేస్తున్నాయి. అడవి పంది రాక మరియు కలుపు కారణంగా ప్రస్తుతం క్షేత్రస్థాయి పరిశీలన అవసరం. పొలంలో జరిగిన సంఘటనలు, సైరన్లు, పంట నష్టం, లేదా పంట ఆరోగ్యం గురించి నన్ను అడగవచ్చు.`;

    answerHi = `🌾 **विस्टा कृषि सहायक:**
आपके 10 एकड़ कपास खेत में 8 कैमरे और 4 सायरन सक्रिय हैं। जंगली जानवर की गतिविधि के कारण वर्तमान स्थिति **सावधानी आवश्यक** है। सभी उपकरण चालू हैं। आप मुझसे खेत की घटनाओं, सायरन, फसल क्षति, खरपतवार या स्वास्थ्य के बारे में पूछ सकते हैं।`;
  }

  let finalResponse = answerEn;
  if (language === 'te') finalResponse = answerTe;
  if (language === 'hi') finalResponse = answerHi;

  // The built-in answers describe the sample farm, so only the demo account gets them
  const isDemo = res.locals.user.id === DEMO_USER.id;
  if (!isDemo) {
    finalResponse =
      language === 'te'
        ? '🌾 మీ పొలం వివరాలు ఇంకా జోడించబడలేదు. **స్మార్ట్ ఫార్మ్ ప్లానర్**లో మీ పొలాన్ని సెటప్ చేయండి. ప్రస్తుతం AI సహాయకుడు అందుబాటులో లేరు, దయచేసి కొద్దిసేపటి తర్వాత మళ్లీ ప్రయత్నించండి.'
        : language === 'hi'
        ? '🌾 आपके खेत की जानकारी अभी जोड़ी नहीं गई है। **स्मार्ट फार्म प्लानर** में अपना खेत सेट करें। AI सहायक अभी उपलब्ध नहीं है, कृपया थोड़ी देर बाद फिर से प्रयास करें।'
        : "🌾 Your farm hasn't been set up yet. Start with the **Smart Farm Planner** to add your field. The AI assistant is unavailable right now, so please try again in a moment.";
  }

  const devices = db(res).devices;
  const onlineCameras = devices.filter((d) => d.type === 'CAMERA' && d.status !== 'OFFLINE').length;
  const onlineSirens = devices.filter((d) => d.type === 'SIREN' && d.status !== 'OFFLINE').length;

  const groqReply = await askGroq(question || '', language, {
    farmerName: res.locals.user.fullName,
    farmSetUp: Boolean(plan) || devices.length > 0,
    crop: plan?.crop || 'not set',
    farmArea: plan ? `${plan.fieldArea} Acres` : 'not set',
    cameras: onlineCameras,
    sirens: onlineSirens,
    recentEvents: activeEvents.slice(0, 6).map((e) => ({
      type: e.eventType,
      object: e.objectType,
      time: e.timestamp,
      location: e.location,
      severity: e.severity,
      status: e.status,
      observations: e.observations,
      recommendedAction: e.recommendedAction,
    })),
  });
  if (groqReply) finalResponse = groqReply;

  res.status(200).json({
    success: true,
    query: question,
    language,
    reply: finalResponse,
    source: groqReply ? 'groq' : 'rules',
    contextSummary: {
      activeAlerts: activeEvents.filter((e) => e.status !== 'RESOLVED').length,
      fieldSafe: activeEvents.every((e) => e.status === 'RESOLVED'),
      crop: plan?.crop || null,
      farmArea: plan ? `${plan.fieldArea} Acres` : null,
      onlineCameras,
      onlineSirens,
    },
  });
});


/* ============================================================
                      START SERVER
============================================================ */
// Only listen when running directly (local dev). Vercel imports this as a module.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`============================================================`);
    console.log(`🌾 VISTA AGRI AI - BACKEND ENGINE RUNNING ON PORT ${PORT}`);
    console.log(`📡 SEE • TRACK • PROTECT • UNDERSTAND • ACT`);
    console.log(`============================================================`);
  });
}

export default app;
