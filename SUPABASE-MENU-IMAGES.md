# Supabase Menu Images

The RMS now uses Supabase Storage for menu-item photos. The database continues to store only the resulting public image URL in `MenuItem.image`.

## What was added

- Menu Items → Add/Edit now has a **Meal Photo** picker with preview.
- JPG, PNG, WEBP and GIF are accepted.
- Maximum image size is 6MB.
- Images are uploaded through the authenticated RMS backend, not directly from the browser with a secret key.
- The server creates the `menu-images` bucket automatically on the first upload and keeps it public so POS and Order Online can display the images.
- Replacing a photo removes the previous RMS-managed photo from Storage.
- Removing a photo clears the database URL and removes the RMS-managed file from Storage.
- POS and Order Online already consume `MenuItem.image`, so no separate upload is required there.

## 1. Create the Supabase project

Create a project at Supabase. In the project dashboard, open the project's Connect/API settings and copy:

- Project URL
- Secret key (server-side only)

The secret key must never be placed in client-side/Vite variables.

## 2. Configure the server

Open:

`server/.env`

Add:

```env
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
SUPABASE_STORAGE_BUCKET=menu-images
```

`SUPABASE_SERVICE_ROLE_KEY` is also accepted as a backwards-compatible alternative to `SUPABASE_SECRET_KEY`.

You do **not** need to create the bucket manually. The RMS creates it when the first image is uploaded and configures it as a public image bucket with image-only MIME types and a 6MB limit.

## 3. Install dependencies

From the project root:

```powershell
npm install
npm run db:generate
```

The project is an npm workspace, so `npm install` installs the server's Supabase and multipart-upload dependencies as well.

## 4. Run the RMS

```powershell
npm run dev
```

Then open:

`http://localhost:5173`

Log in as an Owner, Admin or Manager and go to **Menu → Menu Items**.

Create or edit a meal, choose a photo, save it, and then check:

- **POS** — the meal card should show the uploaded photo.
- **Order Online** — the customer-facing meal card should show the same photo.

## Security note

The browser never receives the Supabase secret key. The browser sends the image to the RMS API using the existing RMS JWT. The backend verifies the user's role/permissions, uploads the file to Supabase Storage, and saves only the public URL in the RMS database.
