# MOD VAULT — Complete Setup, Deployment & Storage Guide (Google Drive + Supabase)

This guide walks through running and deploying **MOD VAULT** using **Google Drive API v3** (for your 5 TB private file storage), **Supabase** (for owner authentication and PostgreSQL metadata), and the **Node.js / Express** backend. MOD VAULT does not use Cloudflare, AWS S3, or Supabase Storage buckets.

---

## Step-by-Step Setup

### 1. Create / Verify Your Supabase Project (Auth & PostgreSQL Only)
1. Sign up at [supabase.com](https://supabase.com) and open your project.
2. In **Authentication -> Providers -> Email**:
   - Ensure Email provider is enabled.
   - **Disable "Enable Sign Ups"** so public registration is completely blocked.
3. In **Authentication -> Users -> Add User -> Create new user**:
   - Ensure your single owner user exists with your exact `OWNER_EMAIL` and **Auto Confirm User** enabled.
4. In **Authentication -> URL Configuration**:
   - Set **Site URL** to your hosted app URL (or `http://localhost:3000` for local use).
   - Add your live URL and `http://localhost:3000` to **Redirect URLs** for Password Reset links.

### 2. Apply the Google Drive Metadata Schema in Supabase
1. Open **SQL Editor -> New query** in Supabase.
2. Copy the entire contents of `supabase/schema.sql`.
3. Verify the email inside `public.is_vault_owner` matches your exact `OWNER_EMAIL`.
4. Click **Run**. This safely creates or upgrades `categories`, `mods`, `mod_versions`, `vault_folders`, and `vault_files` with `drive_file_id`, `drive_folder_id`, `drive_parent_id`, `mime_type`, `file_size_bytes`, and `sha256` columns plus owner-only RLS.

### 3. Configure Environment Variables
Add these variables in `.env` (or your hosting provider's Secrets/Environment panel):
- `OWNER_EMAIL` — Your authorized owner email address
- `SUPABASE_URL` — `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY` — Project public anon key
- `SUPABASE_SERVICE_ROLE_KEY` — Server-only Service Role key (never prefix with `VITE_`)
- `VITE_SUPABASE_URL` — Same `https://<project-ref>.supabase.co` URL
- `VITE_SUPABASE_ANON_KEY` — Same project public anon key
- `MAX_UPLOAD_MB` — Default `5120` (5 GB per-file cap; adjust as desired)
- `ALLOWED_FILE_EXTENSIONS` — `*` (allows all file types) or comma-separated extensions

### 4. Build & Run the Application
1. Install dependencies: `npm install`
2. Build the frontend bundle: `npm run build`
3. Start the server on port 3000: `npm start` (or `npm run dev` for development).

### 5. Connect Google Drive & Verify Private Operations
1. Sign in on the **Login** screen with your Supabase owner credentials.
2. Click **Sign in with Google** in the vault header or **Settings** to authorize the `https://www.googleapis.com/auth/drive.file` scope against your 5 TB Google Drive account.
3. MOD VAULT automatically initializes a private `MOD VAULT` root folder in your Google Drive with `Mods`, `Vault`, and `Thumbnails` subfolders (never publicly shared).
4. Upload `.jar` mods in **Upload Mod** or any file type / nested folder in **File Manager** using Google Drive resumable chunked uploads (`uploadType=resumable`).
