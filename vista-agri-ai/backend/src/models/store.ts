export interface Farm {
  id: string;
  name: string;
  village: string;
  district: string;
  state: string;
  country: string;
  area: number;
  areaUnit: string;
  createdAt: string;
}

export interface Field {
  id: string;
  farmId: string;
  name: string;
  area: number;
  shape: 'Rectangle' | 'Polygon' | 'Irregular';
  soilType: string;
  irrigationType: string;
  crop: string;
  cropStage: string;
  animalRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface FarmProtectionPlan {
  id: string;
  farmId: string;
  fieldId: string;
  crop: string;
  fieldArea: number;
  estimatedCameraCount: number;
  existingCameraCount: number;
  additionalCameraCount: number;
  estimatedSirenCount: number;
  existingSirenCount: number;
  additionalSirenCount: number;
  coverageEstimate: number;
  highRiskZones: string[];
  blindSpots: string[];
  cameraPlacements: Array<{ id: string; name: string; x: number; y: number; angle: number; range: number }>;
  sirenPlacements: Array<{ id: string; name: string; x: number; y: number; radius: number }>;
  calculationInputs: Record<string, any>;
  calculationTimestamp: string;
}

export interface Device {
  id: string;
  type: 'CAMERA' | 'SIREN';
  name: string;
  status: 'ONLINE' | 'OFFLINE' | 'TRIGGERED';
  location: string;
  batteryLevel?: number;
  solarPowered?: boolean;
  fieldId: string;
  lastPing: string;
}

export interface EventItem {
  id: string;
  eventType: 'ANIMAL' | 'CROP_DAMAGE' | 'WEED' | 'CROP_HEALTH' | 'VEHICLE' | 'SIREN';
  objectType: string;
  trackId?: string;
  farmId: string;
  fieldId: string;
  timestamp: string;
  location: string;
  zone: string;
  confidence: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  observations: string;
  possibleCause: string;
  recommendedAction: string;
  status: 'DETECTED' | 'NOTIFIED' | 'ACTION_TAKEN' | 'UNDER_REVIEW' | 'RESOLVED';
  evidence: {
    imageUrl: string;
    trajectoryPoints?: Array<{ x: number; y: number; time: string }>;
    damageAreaAcres?: number;
    weedCoveragePercent?: number;
    affectedPercent?: number;
  };
  sirenActivated?: boolean;
  sirenId?: string;
}

export interface NotificationItem {
  id: string;
  eventId: string;
  title: string;
  problem: string;
  objectType: string;
  location: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  timestamp: string;
  evidenceSummary: string;
  recommendedAction: string;
  devicesTriggered: string[];
  read: boolean;
  channels: {
    web: boolean;
    mobile: boolean;
    siren: boolean;
    sms: boolean;
  };
}

// In-Memory Database initialized with Realistic Master Demo Data
export class DataStore {
  public farms: Farm[] = [
    {
      id: 'farm-01',
      name: 'Smart Cotton & Chilli Farm',
      village: 'Warangal Rural',
      district: 'Warangal',
      state: 'Telangana',
      country: 'India',
      area: 10,
      areaUnit: 'Acres',
      createdAt: new Date().toISOString(),
    },
  ];

  public fields: Field[] = [
    {
      id: 'field-01',
      farmId: 'farm-01',
      name: 'North Cotton Zone',
      area: 10,
      shape: 'Rectangle',
      soilType: 'Black Cotton Soil',
      irrigationType: 'Drip Irrigation',
      crop: 'Cotton',
      cropStage: 'Boll Formation',
      animalRisk: 'HIGH',
    },
  ];

  public protectionPlans: FarmProtectionPlan[] = [
    {
      id: 'plan-01',
      farmId: 'farm-01',
      fieldId: 'field-01',
      crop: 'Cotton',
      fieldArea: 10,
      estimatedCameraCount: 8,
      existingCameraCount: 2,
      additionalCameraCount: 6,
      estimatedSirenCount: 4,
      existingSirenCount: 1,
      additionalSirenCount: 3,
      coverageEstimate: 92,
      highRiskZones: ['North Forest Boundary', 'East Farm Entrance', 'West Animal Corridor'],
      blindSpots: ['South-East Canal Dip', 'Dense Shrub Corner'],
      cameraPlacements: [
        { id: 'cam-1', name: 'North Boundary PTZ', x: 25, y: 15, angle: 180, range: 45 },
        { id: 'cam-2', name: 'East Entrance Cam', x: 80, y: 30, angle: 260, range: 40 },
        { id: 'cam-3', name: 'South Crop Zone', x: 70, y: 80, angle: 330, range: 42 },
        { id: 'cam-4', name: 'West Animal Entry', x: 15, y: 70, angle: 45, range: 50 },
        { id: 'cam-5', name: 'Center Irrigation Hub', x: 50, y: 50, angle: 0, range: 38 },
        { id: 'cam-6', name: 'North-East Buffer', x: 85, y: 15, angle: 220, range: 35 },
        { id: 'cam-7', name: 'South-West Canal', x: 20, y: 88, angle: 60, range: 40 },
        { id: 'cam-8', name: 'Main Road Gate', x: 50, y: 10, angle: 170, range: 45 },
      ],
      sirenPlacements: [
        { id: 'siren-1', name: 'North Boundary Sonic Deterrent', x: 30, y: 12, radius: 45 },
        { id: 'siren-2', name: 'East Entrance Siren #2', x: 82, y: 32, radius: 40 },
        { id: 'siren-3', name: 'South Boundary Siren #3', x: 65, y: 85, radius: 42 },
        { id: 'siren-4', name: 'West Wildlife Deterrent #4', x: 18, y: 68, radius: 48 },
      ],
      calculationInputs: {
        acres: 10,
        crop: 'Cotton',
        perimeterMeters: 804,
        animalPressure: 'HIGH',
        entrances: 2,
      },
      calculationTimestamp: new Date().toISOString(),
    },
  ];

  public devices: Device[] = [
    { id: 'cam-01', type: 'CAMERA', name: 'Camera #1 - North Border', status: 'ONLINE', location: 'Field 1', batteryLevel: 94, solarPowered: true, fieldId: 'field-01', lastPing: 'Just now' },
    { id: 'cam-02', type: 'CAMERA', name: 'Camera #2 - East Entrance', status: 'ONLINE', location: 'Field 1', batteryLevel: 88, solarPowered: true, fieldId: 'field-01', lastPing: 'Just now' },
    { id: 'cam-03', type: 'CAMERA', name: 'Camera #3 - South Crop Zone', status: 'ONLINE', location: 'Field 1', batteryLevel: 99, solarPowered: true, fieldId: 'field-01', lastPing: 'Just now' },
    { id: 'cam-04', type: 'CAMERA', name: 'Camera #4 - West Animal Corridor', status: 'ONLINE', location: 'Field 1', batteryLevel: 91, solarPowered: true, fieldId: 'field-01', lastPing: 'Just now' },
    { id: 'siren-01', type: 'SIREN', name: 'Siren #1 - North Sonic Horn', status: 'ONLINE', location: 'Field 1 - North', fieldId: 'field-01', lastPing: 'Just now' },
    { id: 'siren-02', type: 'SIREN', name: 'Siren #2 - East Strobe & Sounder', status: 'TRIGGERED', location: 'Field 1 - East', fieldId: 'field-01', lastPing: 'Just now' },
    { id: 'siren-03', type: 'SIREN', name: 'Siren #3 - South Boundary Unit', status: 'ONLINE', location: 'Field 1 - South', fieldId: 'field-01', lastPing: 'Just now' },
    { id: 'siren-04', type: 'SIREN', name: 'Siren #4 - Wildlife Repeller', status: 'ONLINE', location: 'Field 1 - West', fieldId: 'field-01', lastPing: 'Just now' },
  ];

  public events: EventItem[] = [
    {
      id: 'evt-01',
      eventType: 'ANIMAL',
      objectType: 'Wild Boar',
      trackId: '#17',
      farmId: 'farm-01',
      fieldId: 'field-01',
      timestamp: '10:42 AM',
      location: 'North-East field',
      zone: 'Crop Protection Zone',
      confidence: 0.94,
      severity: 'HIGH',
      observations: 'Single wild boar moving steadily toward flowering cotton plants',
      possibleCause: 'Night/early morning foraging from adjacent forest corridor',
      recommendedAction: 'Inspect north-east boundary fence after animal departs. Check perimeter wire integrity.',
      status: 'ACTION_TAKEN',
      evidence: {
        imageUrl: '/agriculture/wild-boar-detection.jpg',
        trajectoryPoints: [
          { x: 20, y: 15, time: '10:40:12' },
          { x: 35, y: 28, time: '10:41:05' },
          { x: 52, y: 44, time: '10:41:50' },
          { x: 68, y: 55, time: '10:42:15' },
        ],
      },
      sirenActivated: true,
      sirenId: 'siren-02',
    },
    {
      id: 'evt-02',
      eventType: 'CROP_DAMAGE',
      objectType: 'Cotton Foliage Disturbance',
      farmId: 'farm-01',
      fieldId: 'field-01',
      timestamp: '09:50 AM',
      location: 'Field 1 - East border',
      zone: 'Cotton Canopy Area',
      confidence: 0.86,
      severity: 'MEDIUM',
      observations: 'Flattened crop and broken cotton stems observed in localized patch',
      possibleCause: 'Physical disturbance / localized wildlife crossing overnight',
      recommendedAction: 'Physically inspect the marked 0.8 acre crop area to verify stem damage before evening irrigation.',
      status: 'UNDER_REVIEW',
      evidence: {
        imageUrl: '/agriculture/crop-damage.jpg',
        damageAreaAcres: 0.8,
      },
    },
    {
      id: 'evt-03',
      eventType: 'WEED',
      objectType: 'Parthenium & Broadleaf Weeds',
      farmId: 'farm-01',
      fieldId: 'field-01',
      timestamp: '09:15 AM',
      location: 'South-West section',
      zone: 'Irrigation Furrows',
      confidence: 0.89,
      severity: 'MEDIUM',
      observations: 'High weed density cluster competing with young cotton root zones',
      possibleCause: 'Excess moisture retention in low-elevation furrow',
      recommendedAction: 'Inspect highlighted weed hotspot. Inter-cultivation or targeted spot de-weeding recommended.',
      status: 'NOTIFIED',
      evidence: {
        imageUrl: '/agriculture/weed-hotspot.jpg',
        weedCoveragePercent: 18,
      },
    },
    {
      id: 'evt-04',
      eventType: 'CROP_HEALTH',
      objectType: 'Foliage Chlorosis / Yellowing',
      farmId: 'farm-01',
      fieldId: 'field-01',
      timestamp: '08:30 AM',
      location: 'Field 1 - Central plot',
      zone: 'Main Cotton Stand',
      confidence: 0.78,
      severity: 'LOW',
      observations: 'Visible yellowing stress on lower leaves across 12% of canopy',
      possibleCause: 'Possible nitrogen leaching or temporary micronutrient stress after recent rain',
      recommendedAction: 'Inspect affected plants in central plot. Consider leaf tissue test or consulting local agricultural officer.',
      status: 'DETECTED',
      evidence: {
        imageUrl: '/agriculture/crop-health.jpg',
        affectedPercent: 12,
      },
    },
    {
      id: 'evt-05',
      eventType: 'VEHICLE',
      objectType: 'Mahindra Tractor 575 DI',
      trackId: '#04',
      farmId: 'farm-01',
      fieldId: 'field-01',
      timestamp: '08:02 AM',
      location: 'North equipment zone',
      zone: 'Farm Machinery Lane',
      confidence: 0.98,
      severity: 'LOW',
      observations: 'Tractor entered via standard north gate at 12 km/h',
      possibleCause: 'Scheduled morning cultivation activity',
      recommendedAction: 'Authorized farm vehicle activity logged. No action needed.',
      status: 'RESOLVED',
      evidence: {
        imageUrl: '/agriculture/tractor.jpg',
      },
    },
  ];

  public notifications: NotificationItem[] = [
    {
      id: 'notif-01',
      eventId: 'evt-01',
      title: '🐗 WILD BOAR ALERT',
      problem: 'Wild boar entered Crop Protection Zone in Field 1',
      objectType: 'Wild Boar',
      location: 'North-East crop zone',
      severity: 'HIGH',
      timestamp: '10:42 AM',
      evidenceSummary: 'Track #17 confirmed (94% confidence) moving toward cotton crop',
      recommendedAction: 'Siren #2 automatically sounded for 10s. Verify boundary fence.',
      devicesTriggered: ['Siren #2 (Acoustic)', 'Mobile Push', 'Web Alert'],
      read: false,
      channels: { web: true, mobile: true, siren: true, sms: true },
    },
    {
      id: 'notif-02',
      eventId: 'evt-02',
      title: '⚠️ CROP DAMAGE ALERT',
      problem: 'Moderate crop disturbance detected in Field 1',
      objectType: 'Damaged Foliage',
      location: 'East boundary',
      severity: 'MEDIUM',
      timestamp: '09:50 AM',
      evidenceSummary: '0.8 acres flattened crop detected from aerial camera scan',
      recommendedAction: 'Inspect marked crop area before sunset.',
      devicesTriggered: ['Mobile Push', 'Web Alert'],
      read: false,
      channels: { web: true, mobile: true, siren: false, sms: false },
    },
    {
      id: 'notif-03',
      eventId: 'evt-03',
      title: '🌿 WEED HOTSPOT DETECTED',
      problem: 'High weed pressure cluster in South-West section',
      objectType: 'Weed Cluster',
      location: 'South-West section',
      severity: 'MEDIUM',
      timestamp: '09:15 AM',
      evidenceSummary: '18% weed canopy density detected competing with cotton',
      recommendedAction: 'Plan inter-cultivation or spot weeding.',
      devicesTriggered: ['Web Alert'],
      read: true,
      channels: { web: true, mobile: false, siren: false, sms: false },
    },
    {
      id: 'notif-04',
      eventId: 'evt-04',
      title: '🌱 CROP HEALTH WARNING',
      problem: 'Visible leaf yellowing detected in Central Plot',
      objectType: 'Crop Health Stress',
      location: 'Central plot',
      severity: 'LOW',
      timestamp: '08:30 AM',
      evidenceSummary: '12% canopy shows early chlorosis',
      recommendedAction: 'Check soil moisture & consult local Krishi Kendra if symptoms spread.',
      devicesTriggered: ['Web Alert'],
      read: true,
      channels: { web: true, mobile: false, siren: false, sms: false },
    },
  ];

  public sirenCooldown = false;
  public sirenCooldownTimer: NodeJS.Timeout | null = null;
}

// A store with no farm data, for newly registered farmers
export const createEmptyStore = (): DataStore =>
  Object.assign(new DataStore(), {
    farms: [],
    fields: [],
    protectionPlans: [],
    devices: [],
    events: [],
    notifications: [],
  });
