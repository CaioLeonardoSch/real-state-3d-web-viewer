// Back-end settings of the build (Supabase URL and public key). A module of its own, so pages can check whether
// there is a back end without loading the client (src/backend/remote.ts and supabase-js load on demand).
export const backendConfig = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? { url, key } : null;
})();
