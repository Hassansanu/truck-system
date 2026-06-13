# Hassan Enterprises Truck & Cash Management

A responsive single-admin React application for truck inventory, salesman running balance, and an independent personal cash book.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

Without environment variables the app starts with local demo data. For production:

1. Create a Supabase project and run `supabase/schema.sql` in the SQL editor.
2. Create the single admin in Supabase Authentication.
3. Add the project URL and anon key to `.env`.
4. Build with `npm run build`.

The salesman ledger is derived from truck sale values and cash collections, so no duplicated balance table is required. Personal cash book entries remain independent.
