# 👟📍📈 MotionMap Analyzer v2

An interactive, production-grade fitness telemetry workspace and data analytics platform designed for endurance athletes who demand deep biometric insights without compromising personal data privacy.

MotionMap Analyzer v2 has transitioned from a monolithic architecture to a completely **Decoupled Architecture** built with **React 18 (Vite)** on the frontend and an asynchronous **FastAPI** engine on the backend, backed by a serverless **Neon PostgreSQL** ledger. The system operates on a **completely zero-knowledge data model**, meaning real-world user identities and raw email paths are fully masked using irreversible one-way cryptographic SHA-256 hashes before hitting long-term storage buckets.

---

## ✨ Key Features

* **Stateless Multi-Stream Ingestion Engine:** Vectorized parsing routines for Garmin/Coros Training Center Extensions (`.tcx`) and flexible Flexible-Rate file structures (`.fit`) to compute smoothed velocity profiles, distance deltas, and split configurations in volatile memory.
* **Automated Dynamic Privacy Masking:** An optional on-the-fly distance mask that trims the first and last 500 meters of your activity path to secure precise home/office locations while automatically recalculating all underlying speed arrays to maintain mathematical accuracy.
* **Synchronized Cross-Section Interaction Canvas:** A responsive split-pane grid combining vector map metric overlays (Pace, Heart Rate, and Cadence tracking profiles) with an interactive altitude cross-section chart. Hovering dynamically pairs geographic coordinates with biometric data.
* **Stateful History Persistence & Deduplication Guardrail:** Optional passwordless account connection using short-lived tokens. The database checks incoming files against the *original un-sliced start time* found in the raw file headers to block duplicate data writes, protecting your aggregate statistics from volume distortion.
* **Deterministic Order-Safe CSV Exporter:** Generates standardized, multi-section spreadsheet documents mapping your overall metrics, peak rolling interval windows (400m, 1000m, 5000m), per-kilometer splits, and cardiovascular time-in-zone bands in a clean, predictable layout.
* **Headless Server-Side Snapshot Compiler:** Uses background worker browser instances powered by **Playwright** to inject metrics directly into high-fidelity HTML layout vectors, capturing crisp, un-aliased graphic infographic share cards on the fly.

---

## 🏗️ Technical Architecture & Ecosystem

```
┌────────────────────────────────┐       Secure REST HTTPS       ┌────────────────────────────────┐
│      React 18 Web Client       │ ────────────────────────────> │     FastAPI Core Engine        │
│    (Vite, Tailwind, Axios)     │ <──────────────────────────── │   (Python 3.11, Pandas, etc.)  │
└────────────────────────────────┘      JSON Bearer Tokens       └────────────────────────────────┘
                                                                                 │
                                                                       Auto-Healing Connection
                                                                                 │
                                                                                 ▼
                                                                 ┌────────────────────────────────┐
                                                                 │   Neon Serverless PostgreSQL   │
                                                                 │   (JSONB High-Fidelity Data)   │
                                                                 └────────────────────────────────┘

```

* **Frontend:** React 18, Vite, Tailwind CSS, Lucide React, Axios, and custom coordinate path canvas managers.
* **Backend:** FastAPI (Python 3.11+), Pandas (telemetry processing), Playwright (headless image rendering), Geopy (Nominatim reverse-geocoding API), and python-jose (JWT signatures processing).
* **Database:** Neon Serverless Postgres leveraging custom `JSONB` data columns to securely encapsulate high-resolution telemetry frames into single-document slots.
* **Mailing Carrier:** Resend API for token delivery.

---

## 📂 Repository Structure

```text
motion-map-appv2/
├── frontend/
│   ├── package.json             # Frontend library dependencies configurations
│   ├── vite.config.js           # Vite server build boundaries configuration
│   ├── index.html               # Main Single Page Application anchor DOM
│   ├── public/                  # Static web assets
│   └── src/
│       ├── App.jsx              # Global core state manager, handlers & tab routes
│       ├── index.css            # Tailwind directives canvas injector
│       └── components/          # Modular workspace visual instrumentation blocks
│           ├── RunSummary.jsx       # High-level performance stat cards
│           ├── MapControls.jsx      # Visual layer configuration toggles
│           ├── PerformanceStats.jsx # Expandable zone intervals & splits data grids
│           ├── RouteMap.jsx         # Geospatial path overlay canvas
│           └── ElevationProfile.jsx # Dynamic cross-section hover tracking chart
└── backend/
    ├── main.py                  # Core REST API controller endpoints (CORS/Auth/History)
    ├── engine.py                # Computational telemetry calculations file
    ├── database.py              # Resilient Threaded Connection Pool manager
    ├── requirements.txt         # Python dependencies mapping manifest
    ├── Dockerfile               # Production container instructions (Browser layers setup)
    └── templates/
        └── card.html            # Share graphic visual vector canvas template

```

---

## 🚀 How to Run Locally

### 1. Prerequisites

Ensure you have the following frameworks pre-installed on your operating system:

* **Python 3.11+**
* **Node.js (v18+) & npm**
* A free cloud account database instance at **Neon.tech**
* A free email transmission key from **Resend.com**

### 2. Clone and Initialize the Repository

```bash
git clone https://github.com/your-username/MotionMapAnalyzer.git
cd MotionMapAnalyzer

```

### 3. Backend Setup & Local Runtime Launch

Navigate to your backend folder, instantiate a clean environment workspace, install dependencies, and declare connection configurations:

```cmd
cd backend
python -m venv venv

# On Windows (Command Prompt):
call venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt

```

Before booting, you must declare your specific runtime configurations into your shell environment context block:

**On Windows (Command Prompt):**

```cmd
set DATABASE_URL=postgresql://your_neon_string_here
set RESEND_API_KEY=re_your_copied_resend_key_here
set JWT_SECRET_KEY=a_long_random_alphanumeric_string_for_signing_sessions
uvicorn main:app --reload

```

**On macOS/Linux:**

```bash
export DATABASE_URL="postgresql://your_neon_string_here"
export RESEND_API_KEY="re_your_copied_resend_key_here"
export JWT_SECRET_KEY="a_long_random_alphanumeric_string_for_signing_sessions"
uvicorn main:app --reload

```

The console will boot, apply your parameters, and output operational state lines at `http://127.0.0.1:8000`. You can review the fully interactive built-in API testing board at `http://127.0.0.1:8000/docs`.

### 4. Frontend Setup & Local Client Launch

Open a secondary terminal node console workspace tab container and step into your frontend folder layout to configure your packages:

```bash
cd frontend
npm install

```

Create a standard local environment variable file inside your frontend folder (`frontend/.env.local`) to instruct Axios where to forward its REST communications:

```text
VITE_API_BASE_URL=http://localhost:8000

```

Boot up your Vite local hot-reloading development server profile container:

```bash
npm run dev

```

Open your browser canvas viewer and navigate to `http://localhost:5173` to test the full processing dashboard.

---

## 🌐 Production Cloud Deployment Expectations

When deploying this decoupled repository framework to cloud networks, follow this target environmental pipeline sequence:

### 🐋 The Backend Service Layer (Railway / Render)

Because the automated share card component spawns background Chromium instances inside the Linux host environment, standard serverless architectures will fail due to missing native OS graphics libraries. You **must deploy the backend using its custom `Dockerfile` via a container runtime platform like Railway or Render**.

Ensure your cloud variables contain the following properties:

* `DATABASE_URL`: Your serverless pooled Postgres connection path string.
* `RESEND_API_KEY`: Your live validated Resend API token key.
* `JWT_SECRET_KEY`: A production-grade security signature alphanumeric string.
* `FRONTEND_URL`: The production web URL generated by Vercel (e.g., `https://motion-map-analyzer.vercel.app`) to authorize cross-origin resource handshakes cleanly.

### ⚡ The Frontend Hosting Layer (Vercel)

Connect your repository layout directory configuration straight to **Vercel**:

* **Root Directory Set Selection:** Choose `frontend/`
* **Environment Configuration Injection:** Declare a production environment variable key named **`VITE_API_BASE_URL`** and paste your live, public container address link provided by Railway (e.g., `https://backend-production-xxxx.up.railway.app`).

---

## 🔒 Zero-Knowledge Privacy Manifesto

MotionMap Analyzer v2 is designed to protect your data. Your tracking locations are highly sensitive metrics that can reveal home addresses or daily routine patterns.

Our application architecture enforces data isolation boundaries. Your email address is processed through a one-way mathematical signature engine before hitting the database, so your data remains strictly isolated. The platform records metrics to anonymous rows under a secure signature ledger. Your training tracks belong entirely to you.

---

## 📄 License

This application is distributed under the terms of the open-source **MIT License**. Review the `LICENSE` root tracking index for more details.
