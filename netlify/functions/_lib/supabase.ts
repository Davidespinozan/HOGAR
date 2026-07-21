import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv } from './env';

/**
 * Dos clientes de Supabase, con propósitos distintos:
 *
 *  - getAdminClient(): service role. SALTA RLS. Solo para escribir del lado del
 *    servidor (marcar una clienta como pagada, guardar el account_id). Su llave
 *    NUNCA debe llegar al navegador.
 *  - getUserClient(token): anon key + el JWT de quien llama. Respeta RLS y sirve
 *    para saber QUIÉN está pidiendo algo.
 */

export function getAdminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

export function getUserClient(token: string): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/** La única fila de configuración de HOGAR (single-tenant: id = 1). */
export interface HogarConfig {
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean | null;
  stripe_details_submitted: boolean | null;
  producto_nombre: string | null;
  producto_desc: string | null;
  precio_centavos: number | null;
  moneda: string | null;
  modo_cobro: string | null;
}

const CONFIG_ID = 1;

export async function leerConfig(admin: SupabaseClient): Promise<HogarConfig | null> {
  const { data, error } = await admin
    .from('hogar_config')
    .select(
      'stripe_account_id, stripe_charges_enabled, stripe_details_submitted, producto_nombre, producto_desc, precio_centavos, moneda, modo_cobro'
    )
    .eq('id', CONFIG_ID)
    .maybeSingle();
  if (error) throw new Error(`hogar_config: ${error.message}`);
  return (data as HogarConfig) ?? null;
}

export async function actualizarConfig(
  admin: SupabaseClient,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await admin
    .from('hogar_config')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', CONFIG_ID);
  if (error) throw new Error(`hogar_config update: ${error.message}`);
}
