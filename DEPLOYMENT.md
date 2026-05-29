# Production Deployment Steps: Sunchaser Energy Systems CRM

Follow these detailed steps to deploy the Sunchaser CRM to a production environment.

---

## Step 1: Database Setup (Supabase)

1.  **Create Supabase Account & Project**:
    *   Sign up at [Supabase.com](https://supabase.com/).
    *   Click **New Project**, choose an organization, set a project name (e.g., `Sunchaser CRM`), and choose a secure database password.
    *   Select your region and click **Create new project**. Wait for the database instance to provision.
2.  **Initialize Database Schema**:
    *   In the Supabase sidebar, click on **SQL Editor** (icon with `>_ SQL`).
    *   Click **New Query** and copy-paste the entire contents of [supabase-schema.sql](file:///Users/apple/antigravity/Sunchaser-Energy-Systems/supabase-schema.sql).
    *   Click **Run** to execute the query. Verify that the tables (`leads`, `tickets`, `net_metering`, `projects`, etc.) are created successfully.
3.  **Retrieve API Credentials**:
    *   Go to **Project Settings** (cog icon at bottom left) > **API**.
    *   Copy and save the following values for later steps:
        *   **Project URL** (e.g., `https://xxtdfvgkurxabpbmjban.supabase.co`)
        *   **anon (public)** key (e.g., `eyJhbGciOi...`)
        *   **service_role (secret)** key (e.g., `eyJhbGciOi...`)

---

## Step 2: Backend Host Setup (Render or Railway)

Choose either Render or Railway to host the backend Express server.

### Option A: Render
1.  **Create a Web Service**:
    *   Sign up at [Render.com](https://render.com/).
    *   Click **New** > **Web Service** and connect your GitHub/GitLab repository.
2.  **Service Configuration**:
    *   **Name**: `sunchaser-backend`
    *   **Environment**: `Node`
    *   **Region**: Select the region closest to your target audience.
    *   **Branch**: `main`
    *   **Build Command**: `npm install && npm run build`
    *   **Start Command**: `npm run start`
3.  **Add Environment Variables**:
    *   Navigate to the **Environment** tab and add:
        *   `NODE_ENV`: `production`
        *   `PORT`: `3000`
        *   `GEMINI_API_KEY`: *(Your Google AI Studio API Key)*
        *   `SUPABASE_URL`: *(Your Supabase Project URL)*
        *   `SUPABASE_SERVICE_ROLE_KEY`: *(Your Supabase service_role Key)*
        *   `SUPABASE_ANON_KEY`: *(Your Supabase anon Key)*
        *   `JWT_SECRET`: `Sunchaser_Energy_2026_Secure_JWT_Secret`
        *   `APP_URL`: `https://crm.sunchaserenergy.co` *(Your custom frontend domain)*
4.  **Deploy**: Click **Create Web Service**. Copy the assigned service URL (e.g., `https://sunchaser-backend.onrender.com`).

### Option B: Railway
1.  **Create a New Project**:
    *   Sign up at [Railway.app](https://railway.app/).
    *   Click **New Project** > **Deploy from GitHub repo** and select your repository.
2.  **Service Configuration**:
    *   In settings, set the **Build Command** to `npm install && npm run build`.
    *   Set the **Start Command** to `npm run start`.
3.  **Add Environment Variables**:
    *   Go to the **Variables** tab and bulk-add the same environment variables list specified in the Render section above.
4.  **Deploy**: Railway will deploy the service automatically. Under the service's **Settings** tab, click **Generate Domain** or set a custom domain, and copy the resulting backend URL.

### Backend Verification & Health Checks
Once the service is active, verify that the backend is responding using the following endpoints:
*   **Root Status Check**:
    *   **URL**: `GET /`
    *   **Expected Response**: `"Sunchaser CRM backend running"` (confirms routing is active)
*   **Deployment Health Endpoint**:
    *   **URL**: `GET /health`
    *   **Expected Response**: `{ "status": "ok" }` (used by Render/Railway for automated health monitoring)
*   **ERP Configuration & DB Status**:
    *   **URL**: `GET /api/state`
    *   **Expected Response**: Complete Sunchaser state JSON (confirms Supabase connection works)

---

## Step 3: Frontend Host Setup (Vercel)

1.  **Import to Vercel**:
    *   Sign up/login at [Vercel.com](https://vercel.com/).
    *   Click **Add New** > **Project** and import your repository.
2.  **Build Settings**:
    *   **Framework Preset**: `Vite` (Vercel configures output directory `dist` automatically).
    *   **Build Command**: `npm run build`
    *   **Output Directory**: `dist`
3.  **Add Environment Variables**:
    *   Under the **Environment Variables** tab, add:
        *   `VITE_API_BASE_URL`: *(Your Render or Railway backend URL from Step 2)*
        *   `VITE_SUPABASE_URL`: *(Your Supabase Project URL)*
        *   `VITE_SUPABASE_ANON_KEY`: *(Your Supabase anon Key)*
4.  **Deploy**: Click **Deploy**. Vercel will build and assign a deployment URL (e.g., `https://sunchaser-crm.vercel.app`).

---

## Step 4: Custom Subdomain Configuration (`crm.sunchaserenergy.co`)

To route your app through your custom domain `crm.sunchaserenergy.co`:

1.  **Add Domain in Vercel**:
    *   In the Vercel dashboard, open your Sunchaser CRM project.
    *   Go to **Settings** > **Domains**.
    *   Enter `crm.sunchaserenergy.co` and click **Add**.
2.  **Configure DNS Settings in Domain Registrar** (e.g., GoDaddy, Namecheap, Cloudflare):
    *   Log in to your domain registrar and navigate to the DNS Management zone for `sunchaserenergy.co`.
    *   Add a new DNS record:
        *   **Type**: `CNAME`
        *   **Name (Host)**: `crm`
        *   **Value (Points to)**: `cname.vercel-dns.com.`
        *   **TTL**: `Auto` or `1 Hour`
3.  **Verify & SSL**:
    *   Vercel will detect the CNAME record, verify ownership, and automatically provision a secure Let's Encrypt SSL certificate for `crm.sunchaserenergy.co`.

---

## Step 5: PWA Installation on Mobile Devices

Because PWA files (`manifest.json` and `sw.js`) are configured, users can install the CRM directly on their home screens:

### On iOS (Apple Safari)
1.  Open **Safari** on your iPhone/iPad and navigate to `https://crm.sunchaserenergy.co`.
2.  Tap the **Share** button (square icon with an upward arrow) in the browser toolbar.
3.  Scroll down the options list and tap **Add to Home Screen**.
4.  Confirm the name "Sunchaser CRM" and tap **Add**. The CRM will appear on the device home screen with the custom Sunchaser logo.

### On Android (Google Chrome)
1.  Open **Chrome** on your Android device and navigate to `https://crm.sunchaserenergy.co`.
2.  A banner prompting "Add Sunchaser CRM to Home Screen" will automatically slide up at the bottom.
3.  Tap **Install** or **Add to Home Screen**.
4.  If the banner doesn't show, tap the three vertical dots menu in the top right, and select **Install app** (or **Add to Home screen**).
