import "server-only";

import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS. Server code only — the `server-only`
// import makes any Client Component import of this module a build error.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  throw new Error("Missing env var NEXT_PUBLIC_SUPABASE_URL");
}
if (!serviceRoleKey) {
  throw new Error("Missing env var SUPABASE_SERVICE_ROLE_KEY");
}

export const supabase = createClient(url, serviceRoleKey, {
  auth: {
    // No user session on the server; the service role key is the identity.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
