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
Once the service is active, verify deployment using:
*   **Web app (React CRM)**:
    *   **URL**: `GET /` (e.g. `https://sunchaser-energy-systems.onrender.com/`)
    *   **Expected Response**: Sunchaser login hub HTML (same URL serves API + SPA)
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

---

## Step 6: Capacitor Android CRM Mobile Build Steps

Follow these exact steps on your MacBook to build and deploy the Android APK from this project.

### 1. Install Android Studio
1.  Download Android Studio from the official developer site: [developer.android.com/studio](https://developer.android.com/studio).
2.  Select the correct download installer for your MacBook:
    *   **Mac with Apple chip** (if using Apple Silicon M1, M2, M3, M4, etc.)
    *   **Mac with Intel chip** (if using older Intel-based Macs)
3.  Open the downloaded `.dmg` file, drag **Android Studio** into your **Applications** folder, and launch it.
4.  Follow the **Setup Wizard** configuration prompts, choose the default installation settings, and wait for the SDK components to finish downloading.

### 2. Open the `/android` folder
1.  Launch Android Studio. On the welcome screen, click **Open** (or go to **File > Open** if another project is open).
2.  Navigate to your local directory: `/Users/apple/antigravity/Sunchaser-Energy-Systems`.
3.  Select the **`android`** folder (do not open the root project folder, choose the nested folder named `android`).
4.  Click **Open**.
5.  Wait for Android Studio to import the project and execute the initial Gradle build/sync. You can monitor this progress in the status bar at the bottom. (First-time sync can take a few minutes as it downloads Gradle dependencies).

### 3. Install required SDK/Gradle tools
1.  Open the SDK Manager:
    *   In the welcome screen: **More Actions > SDK Manager**
    *   In the project view: Go to **Tools > SDK Manager** (or search "SDK Manager" in search box).
2.  Under the **SDK Platforms** tab:
    *   Verify that the latest stable Android platform (e.g., API Level 34 or 35) is checked. If not, check it.
3.  Under the **SDK Tools** tab:
    *   Ensure **Android SDK Build-Tools** is checked.
    *   Ensure **Android SDK Command-line Tools (latest)** is checked.
    *   Ensure **Android SDK Platform-Tools** is checked.
    *   Ensure **Android Emulator** is checked.
4.  Click **Apply**, accept the license agreements, and wait for the downloads and installs to complete.
5.  Set up environment paths in your local zsh terminal:
    *   Open terminal and edit your profile: `nano ~/.zshrc` (or `nano ~/.bash_profile`)
    *   Append these lines (adjust paths if custom SDK directory was used):
        ```bash
        export ANDROID_HOME=$HOME/Library/Android/sdk
        export PATH=$PATH:$ANDROID_HOME/emulator
        export PATH=$PATH:$ANDROID_HOME/platform-tools
        ```
    *   Save and exit (`Control + O` then `Control + X`). Reload profile configuration: `source ~/.zshrc`

### 4. Run the app on Android emulator
1.  Open the Device Manager:
    *   Go to **Tools > Device Manager** (or click the phone icon with a small screen in the right sidebar).
2.  Click **Create Device** (or the **+** icon).
3.  Select a hardware model (e.g., **Pixel 8** or **Pixel 8 Pro**) and click **Next**.
4.  Under the System Image list, select an API level (e.g., **UpsideDownCake / API 34**). If a download link is shown next to it, click it to download the system image first.
5.  Click **Next**, review configuration settings, and click **Finish**.
6.  Launch the emulator by clicking the green **Play** icon next to the virtual device in the Device Manager list.
7.  Once the emulator finishes booting, go back to your main project in Android Studio. Select your running emulator from the device dropdown list in the top menu bar, and click the green **Run (Play)** button (or press `Control + R`).
8.  Alternatively, you can run the Capacitor CLI command from your main workspace root folder in the Terminal:
    ```bash
    npx cap run android
    ```

### 5. Connect my Android phone with USB debugging
1.  On your physical Android phone, go to **Settings > About Phone**.
2.  Locate the **Build Number** row (usually under software information) and tap it rapidly **7 times** in a row. A popup message will say: "You are now a developer!" or "Developer mode has been enabled."
3.  Go back to the main Settings menu, search for **Developer Options** (or look under **Settings > System > Developer Options**), and open it.
4.  Locate the **USB Debugging** toggle switch and turn it **ON**.
5.  Connect your Android phone to your MacBook using a USB data cable.
6.  A prompt will display on your phone screen asking: *Allow USB debugging?* Check the box for *Always allow from this computer* and tap **Allow**.
7.  Verify the connection:
    *   In your terminal, run `adb devices`. You should see your phone's serial number listed as `device`.
    *   In Android Studio, check the device dropdown in the top toolbar; your physical phone's model name will now appear.

### 6. Build debug APK
Choose one of the following methods to compile your debug application package:
*   **Method A (Android Studio GUI - Easy)**:
    1.  Go to the top menu bar and select **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
    2.  Android Studio will execute the compile tasks. When finished, a notification popup will appear in the bottom-right corner saying "APKs generated successfully" with a clickable link named **locate**.
*   **Method B (Terminal Command Line - Fast)**:
    1.  Open your macOS Terminal and navigate to the `android` folder:
        ```bash
        cd /Users/apple/antigravity/Sunchaser-Energy-Systems/android
        ```
    2.  Compile the debug build using the Gradle wrapper:
        ```bash
        ./gradlew assembleDebug
        ```

### 7. Build release APK
To generate a production-ready application package:
*   **Unsigned Release (For Testing/CLI)**:
    1.  Open Terminal and navigate to the `android` folder:
        ```bash
        cd /Users/apple/antigravity/Sunchaser-Energy-Systems/android
        ```
    2.  Run:
        ```bash
        ./gradlew assembleRelease
        ```
*   **Signed Release (For Google Play Store Distribution)**:
    1.  In Android Studio, go to the top menu bar and click **Build > Generate Signed Bundle / APK...**.
    2.  Select **APK** and click **Next**.
    3.  Under **Key store path**, click **Create new...** (if you do not have an existing signing key):
        *   Choose a destination path on your Mac and name it (e.g. `sunchaser-key.jks`).
        *   Create secure passwords for both the Keystore and Key Alias.
        *   Fill in the developer certificate details (Name, Org, City, etc.) and click **OK**.
    4.  Select the newly created key path, enter the passwords, and click **Next**.
    5.  Select **release** build variant and click **Finish**. Gradle will generate the signed production APK.

### 8. Where the APK file will be located
Once compiled, you can find the output binaries in these exact directories on your Mac:
*   **Debug APK**:
    *   Path: `android/app/build/outputs/apk/debug/app-debug.apk`
    *   Absolute path: `/Users/apple/antigravity/Sunchaser-Energy-Systems/android/app/build/outputs/apk/debug/app-debug.apk`
*   **Unsigned Release APK**:
    *   Path: `android/app/build/outputs/apk/release/app-release-unsigned.apk`
    *   Absolute path: `/Users/apple/antigravity/Sunchaser-Energy-Systems/android/app/build/outputs/apk/release/app-release-unsigned.apk`
*   **Signed Release APK**:
    *   Located at the custom path you selected in the "Generate Signed Bundle / APK" wizard (defaults to `android/app/release/app-release.apk`).

### 9. How to install APK on my phone
You can install the generated APK file on your physical device using either of these two methods:
*   **Method A (Via USB command line - Recommended for Developers)**:
    1.  Connect your phone to your Mac via USB with USB debugging enabled.
    2.  Open Terminal and run:
        ```bash
        adb install -r /Users/apple/antigravity/Sunchaser-Energy-Systems/android/app/build/outputs/apk/debug/app-debug.apk
        ```
*   **Method B (Over-the-Air file transfer)**:
    1.  Upload the `app-debug.apk` (or signed release APK) to a file-sharing service (e.g., Google Drive, Dropbox) or send it to yourself via email or messaging app.
    2.  Open the download link or email attachment on your phone.
    3.  Tap the downloaded `.apk` file to install it.
    4.  If your phone prompts you with an "Install unknown apps" block:
        *   Tap **Settings** on the prompt.
        *   Toggle **Allow from this source** to ON for the app you are using (e.g., Chrome, Drive, Gmail).
        *   Go back and complete the installation wizard.

### 10. How to confirm the app is calling `https://sunchaser-energy-systems.onrender.com`
To verify that your mobile client is correctly talking to your Render backend:
*   **Method A (Chrome DevTools Remote Inspector - Best)**:
    1.  Connect your phone (or start the emulator) and open the installed **Sunchaser CRM** app.
    2.  Open **Google Chrome** on your MacBook and navigate to: `chrome://inspect/#devices`.
    3.  Ensure "Discover USB devices" is checked.
    4.  Under the **Remote Target** section, you will see your connected Android device model followed by your running app target (`com.sunchaser.crm`).
    5.  Click the **inspect** link below it. This will open a Chrome Developer Tools window for the running hybrid app webview.
    6.  Switch to the **Network** tab in DevTools.
    7.  Trigger an API call (e.g., try signing in with username `allauddin` or another user, or refresh the page).
    8.  Select the network request (e.g. `login` or `state`) and verify that the **Request URL** starts with:
        `https://sunchaser-energy-systems.onrender.com`
*   **Method B (Android Logcat Inspection)**:
    1.  In Android Studio, click the **Logcat** tab in the bottom toolbar.
    2.  Ensure your device and package `com.sunchaser.crm` are selected.
    3.  In the Logcat filter bar, type `Capacitor` or the URL `sunchaser-energy-systems.onrender.com`.
    4.  Perform actions in the app and monitor the log stream to see printed requests and response logs showing connections to the backend.

