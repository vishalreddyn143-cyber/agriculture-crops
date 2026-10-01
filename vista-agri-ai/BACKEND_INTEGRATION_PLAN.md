# VISTA AGRI AI — Comprehensive Backend Integration Plan

## 1. Current Architecture Overview

### Frontend
- **Framework**: Next.js 16 (App Router), React 19, TypeScript
- **Styling**: Tailwind CSS v4, custom Green & White agricultural luxury aesthetic, Plus Jakarta Sans & Inter typography
- **State Management**: React `useState` & `useEffect` (currently in-memory local state)
- **Audio & Sensory**: Web Audio API synthesizing gentle harmonic acoustic chimes (D5, F#5, A5) for sirens and alerts
- **Geolocation**: Browser `navigator.geolocation` for field GPS coordinate acquisition
- **Visuals**: Static SVG Maize Corn Logo, user-provided tractor & rolling hills background image (`/agriculture/tractor_field_bg.jpg`)

### Existing Backend (Prototype)
- **Server**: Node.js + Express + TypeScript (`tsx watch`)
- **Database**: Mongoose connecting to local MongoDB (with fallback in-memory store)
- **Endpoints**: Monolithic `server.ts` containing basic REST endpoints for auth, farms, calculator, devices, events, notifications, AI ask, demo simulation

---

## 2. Existing Frontend Features & Mock/Static Data Audit

| Page / Component / Tab | Current UI Features | Mock / Static Data Used | Required Backend Integration |
| :--- | :--- | :--- | :--- |
| **Top Navigation & Header** | Status pill (Safe / Attention), Siren Silence/Test, Field Work toggle, Demo toggle, Language toggle (EN, TE, HI), GPS location button | Hardcoded region fallback (`Warangal Rural`), local siren state | `/api/v1/users/me/preferences`, `/api/v1/devices/sirens/status`, `/api/v1/farms/active/status` |
| **Dashboard (Overview)** | Farmer greeting, Farm overview banner, 4 Status Cards (Wildlife, Crop Health, Weed, Devices), Interactive Map canvas, Active Incidents feed | Hardcoded counts (1 animal, 92% health, 18% weed, 8 cams/4 sirens), static map markers | Real-time aggregated metrics via `/api/v1/analytics/dashboard-summary`, `/api/v1/events/recent`, Socket.IO rooms |
| **Smart Farm Calculator** | 4-field wizard (name, area, crop, animal risk), outputs recommended cameras (8), sirens (4), coverage (94%), boundary perimeter (804m) | Static formula computation on frontend or single non-persistent backend call | `/api/v1/calculator/plan` with persistence to `FarmProtectionPlan` model scoped to `farmId` and `ownerId` |
| **Field Work Mode** | High-contrast mobile interface with large touch cards for Wild Boar, Crop Damage, Weed Hotspot, rapid verification buttons | Static notifications array, optimistic toast actions | `/api/v1/events/:id/acknowledge`, `/api/v1/events/:id/resolve`, GPS coordinate pinning `/api/v1/fields/pins` |
| **Live Vision & Tracking** | Camera #2 simulation canvas with YOLO bounding box (`Wild Boar #17, 94%`), BoT-SORT trajectory, geofence boundary overlay | Simulated canvas overlay with fixed bounding box | Stream endpoint `/api/v1/cameras/:id/stream`, WebSocket `vision.detection` & `vision.track` from Python vision service |
| **Alerts & History** | Problem-specific incident cards (Wild Boar, Crop Disturbance, Weed Cluster) with Acknowledge and Mark Resolved buttons | Static in-memory notification array | `/api/v1/alerts`, `/api/v1/alerts/:id/acknowledge`, `/api/v1/alerts/:id/resolve`, audit log |
| **Devices Management** | 8 Cameras and 4 Sirens list with online status, solar battery level, and dBA ratings; Test siren button | Hardcoded device names and statuses | `/api/v1/devices`, `/api/v1/devices/:id/command`, `/api/v1/devices/heartbeat`, MQTT status bridge |
| **Ask VISTA AI** | Multilingual assistant with prompt chips in English, Telugu, Hindi, message history | Fallback static text when backend is disconnected | `/api/v1/ai/ask` with owner-isolated MongoDB context + Gemini API + Zod schema validation |

---

## 3. Required Target Architecture

```
                         ┌──────────────────────────────┐
                         │       VISTA AGRI AI UI       │
                         │ Next.js + React + TypeScript │
                         └──────────────┬───────────────┘
                                        │
                              REST + WebSocket (Socket.IO)
                                        │
                         ┌──────────────▼───────────────┐
                         │       Node.js Backend        │
                         │ Express + TypeScript (v1 API)│
                         │                              │
                         │ • Auth & User Isolation      │
                         │ • Multi-Farm / Multi-Field   │
                         │ • Camera & Device Engine     │
                         │ • Event & Geofence Engine    │
                         │ • Alert & Notification Engine│
                         │ • Gemini AI Agricultural GW  │
                         │ • Analytics & Report Engine  │
                         └──────────────┬───────────────┘
                                        │
                 ┌──────────────────────┼──────────────────────┐
                 │                      │                      │
        ┌────────▼────────┐    ┌────────▼─────────┐   ┌──────▼───────┐
        │    MongoDB      │    │ Python FastAPI   │   │   Gemini AI  │
        │     Atlas       │    │ Vision Service   │   │    Gateway   │
        │                 │    │                  │   │              │
        │ Users & Farms   │    │ YOLO Detection   │   │ Contextual   │
        │ Fields & Zones  │    │ ByteTrack/BoTSORT│   │ Multilingual │
        │ Cameras/Devices │    │ Re-ID (Occlusion)│   │ Farm Advice  │
        │ Events & Alerts │    │ Geofence Check   │   │ Audited Logs │
        └─────────────────┘    └──────────────────┘   └──────────────┘
```

---

## 4. Multi-User Isolation & Ownership Hierarchy

Every database record strictly enforces ownership:
```
User (ownerId)
 └── Farm (ownerId)
      ├── Fields (farmId, ownerId)
      │    ├── CropZones & Geofences (fieldId, farmId, ownerId)
      │    ├── Cameras & Devices (fieldId, farmId, ownerId)
      │    ├── Detections & Tracks (cameraId, fieldId, farmId, ownerId)
      │    ├── Events & Alerts (fieldId, farmId, ownerId)
      │    └── Analyses & Reports (farmId, ownerId)
```
- Every MongoDB query will inject `ownerId: req.user.id`.
- Role-based permissions: `FARMER`, `FARM_MANAGER`, `TECHNICIAN`, `ADMIN`.

---

## 5. Required Database Models (Mongoose)

1. **User**: Name, email, passwordHash (bcrypt/argon2), phone, preferredLanguage ('en' | 'te' | 'hi'), role, status, refreshTokens.
2. **Farm**: Name, ownerId, location (GeoJSON point / manual address), area, areaUnit, soilType, irrigationType, primaryCrops.
3. **Field**: FarmId, ownerId, name, boundary (GeoJSON polygon), area, crop, cropStage, soilType, animalRisk.
4. **CropZone / Geofence**: FieldId, farmId, ownerId, name, type (`CROP_PROTECTION`, `ANIMAL_EXCLUSION`, `VEHICLE_ZONE`), polygon, rules.
5. **Camera**: FieldId, farmId, ownerId, name, sourceType (`WEBCAM`, `RTSP`, `SIMULATION`), sourceUrl, status (`ONLINE`, `OFFLINE`), resolution, fps.
6. **Device**: FieldId, farmId, ownerId, type (`SIREN`, `SPEAKER`, `SENSOR`), name, status, ipAddress, mqttTopic, lastPing.
7. **Detection**: CameraId, fieldId, farmId, ownerId, timestamp, className, confidence, boundingBox, trackId.
8. **Track**: TrackId, cameraId, fieldId, farmId, ownerId, className, firstSeen, lastSeen, trajectory, speed, status.
9. **Event**: FarmId, fieldId, ownerId, eventType (`ANIMAL_INTRUSION`, `CROP_DAMAGE`, `WEED_PRESSURE`, `VEHICLE_ACTIVITY`), objectType, trackId, severity, confidence, recommendedAction, status.
10. **Alert**: EventId, farmId, ownerId, title, message, severity (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`), status (`OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `DISMISSED`).
11. **Notification**: OwnerId, alertId, eventId, type, title, message, read, channels (`web`, `mobile`, `sms`, `siren`).
12. **AuditLog**: UserId, action, resource, resourceId, ip, timestamp, details.
13. **AgriculturalDataset**: Dataset registry (name, license, version, classes, downloadUrl).

---

## 6. Required REST API Structure (`/api/v1`)

- **Auth**: `/api/v1/auth/register`, `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/api/v1/auth/me`, `/api/v1/auth/logout`
- **Farms**: `/api/v1/farms` (GET, POST), `/api/v1/farms/:id` (GET, PUT, DELETE)
- **Fields**: `/api/v1/fields` (GET, POST), `/api/v1/fields/:id` (GET, PUT, DELETE)
- **Calculator**: `/api/v1/calculator/calculate`, `/api/v1/calculator/plans` (POST, GET)
- **Cameras**: `/api/v1/cameras` (GET, POST), `/api/v1/cameras/:id/stream`
- **Devices & Sirens**: `/api/v1/devices`, `/api/v1/devices/:id/command`, `/api/v1/devices/sirens/emergency-stop`
- **Geofences**: `/api/v1/geofences` (GET, POST, PUT, DELETE)
- **Events & Alerts**: `/api/v1/events`, `/api/v1/alerts`, `/api/v1/alerts/:id/acknowledge`, `/api/v1/alerts/:id/resolve`
- **Notifications**: `/api/v1/notifications`, `/api/v1/notifications/:id/read`
- **Analytics & Heatmaps**: `/api/v1/analytics/summary`, `/api/v1/analytics/heatmaps`
- **AI Gateway**: `/api/v1/ai/ask` (Gemini with owner farm context)
- **Vision**: `/api/v1/vision/detect`, `/api/v1/vision/track`, `/api/v1/vision/status`
- **System**: `/health`, `/ready`, `/api/v1/system/status`

---

## 7. Real-Time Socket.IO Event Specification

### Rooms:
- `user:{userId}` — Private notifications, alerts, device commands
- `farm:{farmId}` — Farm-level metric updates, active deterrent states
- `camera:{cameraId}` — Real-time detections, tracks, FPS status

### Events:
- `camera.status` — Camera connection/FPS change
- `vision.detection` — New detected object bounding boxes
- `vision.track` — Track updates & trajectory points
- `event.created` — Deterministic agricultural event generated
- `alert.created` — User alert triggered
- `device.status` — Siren activation / gentle chime trigger
- `notification.created` — In-app toast / banner push

---

## 8. Implementation Phases

- **Phase 1 (Completed)**: Repository inspection & creation of `BACKEND_INTEGRATION_PLAN.md`.
- **Phase 2 (Immediate Goal)**: Backend foundation:
  - Structured modular architecture in `backend/src/`
  - Zod-validated environment configuration (`src/config/env.ts`)
  - Robust MongoDB Atlas / Local connection with health state (`src/config/database.ts`)
  - Standardized JSON responses (`src/utils/apiResponse.ts`)
  - Custom error hierarchy (`src/utils/appError.ts`)
  - Centralized error handling & 404 middleware (`src/middleware/errorHandler.ts`)
  - Structured request logging with correlation IDs (`src/middleware/requestLogger.ts`)
  - System health, readiness, and liveness endpoints (`/health`, `/ready`, `/api/v1/system/status`)
  - Clean modular Express routing foundation (`src/app.ts`, `src/server.ts`)
  - Verification with lint, build, and test runs.
- **Phase 3**: Authentication & Multi-user JWT/Session with Argon2/Bcrypt.
- **Phase 4**: User, Farm, and Field models with owner-isolation.
- **Phase 5**: Camera and Device management modules.
- **Phase 6**: Socket.IO authenticated rooms and real-time dispatcher.
- **Phase 7 - 10**: Python FastAPI Vision Service & YOLO/ByteTrack/Geofence integration.
- **Phase 11 - 14**: Deterministic Event Engine, Alert Center, Notification Provider Abstraction, and Device/IoT commands.
- **Phase 15 - 18**: Crop health/damage/weed analysis, real analytics/heatmaps, Gemini AI Gateway, and Reports.
- **Phase 19 - 22**: Offline sync, Security hardening, E2E testing, Docker & deployment.
