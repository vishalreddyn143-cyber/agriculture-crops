# VISTA AGRI AI
### SEE • TRACK • PROTECT • UNDERSTAND • ACT
**Smart visual intelligence for safer and more productive farming.**

---

## 🌟 Local Development Status
Both Frontend and Backend are currently running locally on your machine:
- **Frontend Web Application:** [http://localhost:3000](http://localhost:3000)
- **Backend API Engine:** [http://localhost:5000](http://localhost:5000) (Health: [http://localhost:5000/health](http://localhost:5000/health))

---

## 🚜 System Architecture & Core Modules

### 1. Smart Farm Calculator & Planner
- Transparent agricultural infrastructure formulas based on acreage, boundary perimeter, crop canopy height, and wildlife corridor density.
- Calculates:
  - Estimated Cameras (e.g. 8 cameras for 10 Acres Cotton)
  - Estimated Acoustic Sirens (e.g. 4 sirens with 100m acoustic radius)
  - Protection Coverage Percentage (92%)
  - High-risk monitoring zones & potential blind spots
  - Interactive placement map with field boundary geofencing and viewing angles.
  - "Why 8 Cameras?" agronomic & optical explanation breakdown.

### 2. Field Work Mode
- Specially tailored high-contrast mobile layout with large touch controls for farmers inspecting their fields under bright sunlight.
- One-tap quick actions: **Silence Sirens**, **Test Acoustic Deterrent**, **Acknowledge Alert**, and **Navigate to Damaged Area**.

### 3. Live Vision & Tracking (YOLO + BoT-SORT + Re-ID)
- High-FPS optical detection pipeline tracking wild animals (Wild Boar, Monkeys, Cattle) and farm machinery (Tractors).
- **BoT-SORT Multi-Object Tracking:** Generates unique track IDs (e.g. `Track #17`), calculates trajectory and velocity.
- **Re-ID Occlusion Recovery:** Recognizes and reconnects the animal ID even after temporary visual obstruction behind bushes or trees.
- **Geofence Enforcement:** Triggers safe acoustic sirens immediately when an animal enters the designated **Crop Protection Zone**.

### 4. Problem-Specific Alert & Action Workflows
Every incident has its own structured, non-generic agricultural lifecycle:
1. **🐗 Wild Boar Detection:** North-East field entry, 94% confidence, Siren #2 auto-triggered, fence inspection advised.
2. **⚠️ Crop Damage:** 0.8 acres of flattened cotton foliage detected on East boundary. Distinguishes observed physical damage without false assumptions.
3. **🌿 Weed Hotspots:** 18% weed coverage in South-West drainage furrow competing with cotton root zones.
4. **🌱 Crop Health Warning:** 12% lower leaf chlorosis/nutrient stress flagged for inspection.
5. **🚜 Farm Machinery:** Authorized tractor activity logged in equipment lane.

### 5. Multilingual "Ask VISTA" AI Assistant
- Grounded strictly in stored farm events and sensor data (no hallucinations).
- Supports:
  - **English:** *"What happened in my field today?"* / *"Why did the siren activate?"*
  - **Telugu (తెలుగు):** *"నా పొలంలో ఈరోజు ఏమి జరిగింది?"* / *"సైరన్ ఎందుకు మోగింది?"*
  - **Hindi (हिंदी):** *"मेरे खेत में आज क्या हुआ?"* / *"सायरन क्यों बजा?"*

---

## 🛠️ Technology Stack
- **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS, Lucide Icons, Framer Motion.
- **Backend:** Node.js, Express, TypeScript (TSX), Helmet, CORS, Resilient In-Memory & MongoDB Hybrid Store.
- **Computer Vision Pipeline:** YOLO Object Detection, BoT-SORT Tracking, Re-ID Feature Matching.

---

## 🏃‍♂️ Commands to Run Locally

### Start Backend:
```bash
cd vista-agri-ai/backend
npm run dev
```

### Start Frontend:
```bash
cd vista-agri-ai/frontend
npm run dev
```
