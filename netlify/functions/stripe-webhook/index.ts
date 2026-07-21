import type { Handler } from '@netlify/functions';
import type Stripe from 'stripe';
import { ok, badRequest, serverError } from '../_lib/http';
import { getStripe, esDeHogar, APP_TAG } from '../_lib/stripe';
import { getAdminClient, actualizarConfig } from '../_lib/supabase';

/**
 * POST /stripe-webhook — materializa en Supabase lo que pasó en Stripe.
 *
 * PLATAFORMA COMPARTIDA CON EKKO: este endpoint puede recibir eventos que no
 * son de HOGAR. Todo lo que no traiga metadata.app === 'hogar' se responde 200
 * y se ignora, sin tocar la base. Nunca procesar eventos ajenos.
 *
 * Robustez (patrón de EKKO):
 *   - Firma verificada sobre el BODY CRUDO (nada de JSON.parse antes).
 *   - Idempotencia: si la clienta ya está pagada, no se vuelve a marcar.
 *   - Falla suave: sin STRIPE_WEBHOOK_SECRET es un no-op, no rompe el deploy.
 *
 * Eventos que sí procesa:
 *   · checkout.session.completed → acredita el acceso de la clienta.
 *   · account.updated            → refresca el estado de cobros de Andrea.
 * Cualquier otro: 200 + log, sin procesar.
 */

/** La clienta pagó: se le acredita el acceso de por vida. */
async function acreditarPago(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.user_id ?? null;
  if (!userId) {
    console.warn('[stripe-webhook] checkout sin user_id en metadata; no se pudo acreditar');
    return;
  }
  if (session.payment_status !== 'paid') {
    console.log('[stripe-webhook] checkout aún no pagado:', session.payment_status);
    return;
  }

  const admin = getAdminClient();

  // Idempotencia: Stripe reintenta y puede mandar el mismo evento más de una
  // vez. Si ya está pagada, no la volvemos a tocar.
  const { data: actual, error: leerErr } = await admin
    .from('hogar_usuarias')
    .select('id, pagado')
    .eq('id', userId)
    .maybeSingle();
  if (leerErr) throw new Error(`leer hogar_usuarias: ${leerErr.message}`);
  if (!actual) {
    console.warn('[stripe-webhook] no existe hogar_usuarias con id', userId);
    return;
  }
  if (actual.pagado === true) {
    console.log('[stripe-webhook] clienta ya pagada, sin cambios:', userId);
    return;
  }

  const { error } = await admin
    .from('hogar_usuarias')
    .update({
      pagado: true,
      fecha_compra: new Date().toISOString(),
      monto_centavos: session.amount_total ?? null,
      plan: 'completo',
      estatus: 'activa'
    })
    .eq('id', userId);
  if (error) throw new Error(`activar clienta: ${error.message}`);

  console.log('[stripe-webhook] acceso acreditado a', userId);
}

/** Andrea avanzó (o retrocedió) en su onboarding de Connect. */
async function sincronizarCuenta(account: Stripe.Account): Promise<void> {
  const admin = getAdminClient();
  await actualizarConfig(admin, {
    stripe_charges_enabled: account.charges_enabled === true,
    stripe_details_submitted: account.details_submitted === true
  });
  console.log(
    '[stripe-webhook] cuenta actualizada:',
    account.id,
    'charges=',
    account.charges_enabled
  );
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return badRequest('Método no permitido');

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret || !process.env.STRIPE_SECRET_KEY) {
    console.warn('[stripe-webhook] Stripe sin configurar; evento ignorado');
    return ok({ skipped: 'stripe_no_configurado' });
  }

  const sig = event.headers['stripe-signature'];
  if (!sig) return badRequest('Falta stripe-signature');

  // Body CRUDO: Netlify puede entregarlo en base64. Parsearlo antes rompería
  // la verificación de firma.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : event.body || '';

  const stripe = getStripe();
  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] firma inválida:', err instanceof Error ? err.message : err);
    return badRequest('Firma inválida');
  }

  // ── Filtro de plataforma compartida ──────────────────────────────────────
  // La cuenta-plataforma es la misma de EKKO. Si el evento no está etiquetado
  // como de HOGAR, no es nuestro: 200 y a otra cosa.
  if (!esDeHogar(stripeEvent)) {
    console.log('[stripe-webhook] evento ajeno ignorado:', stripeEvent.type, stripeEvent.id);
    return ok({ received: true, ignored: 'otra_app' });
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await acreditarPago(stripeEvent.data.object as Stripe.Checkout.Session);
        break;
      case 'account.updated':
        await sincronizarCuenta(stripeEvent.data.object as Stripe.Account);
        break;
      default:
        console.log('[stripe-webhook] evento de', APP_TAG, 'sin manejar:', stripeEvent.type);
    }
    return ok({ received: true });
  } catch (err) {
    // 500 → Stripe reintenta. Las escrituras son idempotentes, así que
    // reintentar es seguro.
    console.error(
      '[stripe-webhook] error procesando',
      stripeEvent.type,
      err instanceof Error ? err.message : err
    );
    return serverError('Error procesando el evento');
  }
};
