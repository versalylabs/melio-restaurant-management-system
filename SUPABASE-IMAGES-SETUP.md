# Melio — Supabase image setup

The project is configured for the existing public `menu-images` bucket in the Melio Supabase project.

Supabase project URL:
`https://czqznpcgyhcntlpsecla.supabase.co`

Existing public files used by the seed:
- Samosa.jpg
- Chicken Wings.jpg
- Grilled Chicken.jpg
- Beef Steak.jpg
- Chicken Burger.jpg
- Beef Burger.jpg
- Coke.jpg
- Passion Juice.jpg
- Chocolate Cake.jpg

The seed writes the corresponding public Storage URLs into `MenuItem.image` and creates the featured dish as Grilled Chicken. It also creates six website gallery entries using the same public bucket files.

For local development, after extracting the ZIP:

```powershell
Copy-Item server\.env.example server\.env
npm install
npm run db:generate
npm run db:seed
npm run dev
```

The existing images are public, so the public website can display them without exposing a Supabase secret key.

For **admin uploads/deletes** through Website Management, the server still requires a valid `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) in `server/.env`. Never put that secret in client-side/Vite environment variables or commit it to Git.
