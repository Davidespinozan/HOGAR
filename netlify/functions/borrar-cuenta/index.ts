import type { Handler } from '@netlify/functions';
import { ok, badRequest, serverError, preflight } from '../_lib/http';
import { getAdminClient, leerConfig } from '../_lib/supabase';
import { getStripe } from '../_lib/stripe';
import { autenticar } from '../_lib/auth';

/**
 * POST /borrar-cuenta — la clienta borra su propia cuenta, de verdad.
 * Auth: Bearer JWT de la clienta. NO recibe ningún id: solo puede borrarse a sí
 * misma, porque el user_id sale del token y nunca del cuerpo.
 *
 * Los términos prometen "puedes pedirnos que los borremos por completo… y lo
 * hacemos", y hasta ahora no existía nada que lo hiciera.
 *
 * ORDEN, Y POR QUÉ ES ESE:
 *   1. RPC hogar_borrar_datos_usuaria → en UNA transacción: registra la baja
 *      mínima (solo si pagó) y borra hogar_sesiones (que arrastra el diario) y
 *      hogar_usuarias (que arrastra la bitácora de accesos manuales).
 *   2. Borrar auth.users con la service role.
 *   3. Best-effort: el Customer de Stripe.
 *
 * Auth va DESPUÉS de los datos, a propósito. Si fuera al revés y fallara el
 * paso 1, la clienta se quedaría con las filas puestas y SIN cuenta con la que
 * reintentar. Dejándolo al final, el estado intermedio es "datos borrados, sesión
 * viva": vuelve a pulsar y termina el trabajo. Por eso el paso 1 es idempotente
 * (el INSERT de la baja lleva ON CONFLICT DO NOTHING y los DELETE no fallan si no
 * hay filas).
 *
 * NI auth.users NI hogar_usuarias/hogar_sesiones tienen clave foránea entre sí
 * (verificado en agosto de 2026): borrar la cuenta de Auth NO arrastra nada. De
 * ahí que haga falta el paso 1.
 */

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return badRequest('Método no permitido');

  try {
    const auth = await autenticar(event);
    if (!auth.ok) return auth.response;

    const userId = auth.user.id;
    const admin = getAdminClient();

    // ── 1. Los datos, en una sola transacción ────────────────────────────────
    const { data: resumen, error: rpcErr } = await admin.rpc('hogar_borrar_datos_usuaria', {
      p_user_id: userId
    });
    if (rpcErr) throw new Error(`borrar datos: ${rpcErr.message}`);

    // El customer de Stripe se lee ANTES de borrar la fila… pero la fila ya no
    // existe. Por eso lo devuelve la baja, si la hubo. Si no pagó, no hay
    // customer que borrar.
    let stripeCustomerId: string | null = null;
    if (resumen && (resumen as { baja_registrada?: boolean }).baja_registrada) {
      const { data: baja } = await admin
        .from('hogar_bajas')
        .select('stripe_customer_id')
        .eq('user_id', userId)
        .maybeSingle();
      stripeCustomerId = (baja?.stripe_customer_id as string | null) ?? null;
    }

    // ── 2. La cuenta de Auth ─────────────────────────────────────────────────
    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) {
      // Los datos ya no están, pero la cuenta sí. La clienta CONSERVA su sesión,
      // así que puede volver a pulsar y esto se completa. Se le dice que no se
      // terminó en vez de fingir que sí.
      console.error('[borrar-cuenta] datos borrados pero auth.users falló:', authErr.message);
      return serverError('No pudimos terminar de borrar tu cuenta');
    }

    // ── 3. Stripe, sin bloquear ──────────────────────────────────────────────
    // El Customer guarda su nombre y su correo; se borra para no dejarlos ahí.
    // El CARGO permanece pase lo que pase —es el registro financiero y Stripe lo
    // conserva—, y por eso los términos lo declaran en vez de prometer lo
    // contrario. Si esto falla, NO se revierte nada: un error de red no puede
    // dejar a alguien sin poder borrarse.
    if (stripeCustomerId && process.env.STRIPE_SECRET_KEY) {
      try {
        const config = await leerConfig(admin);
        if (config?.stripe_account_id) {
          await getStripe().customers.del(stripeCustomerId, {
            stripeAccount: config.stripe_account_id
          });
        }
      } catch (err) {
        console.error(
          '[borrar-cuenta] no se pudo borrar el customer de Stripe',
          stripeCustomerId,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.log('[borrar-cuenta] cuenta borrada:', userId, JSON.stringify(resumen));
    return ok({ borrada: true });
  } catch (err) {
    console.error('[borrar-cuenta]', err instanceof Error ? err.message : err);
    return serverError('No pudimos borrar tu cuenta');
  }
};
