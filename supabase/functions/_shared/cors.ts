// CORS compartido por las Edge Functions de HOGAR.
// El origen exacto se controla con la env var ALLOWED_ORIGIN (por defecto, el sitio en producción).
export const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? 'https://hogarbyandrea.netlify.app';

export const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
