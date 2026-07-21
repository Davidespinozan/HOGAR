import type { Handler } from '@netlify/functions';
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, badRequest, serverError, preflight } from '../_lib/http';
import { optionalEnv } from '../_lib/env';
import { getStripe, APP_TAG } from '../_lib/stripe';
import { getAdminClient, leerConfig } from '../_lib/supabase';
import { autenticar } from '../_lib/auth';

/**
 * POST /crear-checkout — la clienta logueada paga su acceso a HOGAR.
 * Auth: Bearer JWT de la clienta (NO de Andrea: esta función es para usuarias).
 *
 * PAGO ÚNICO (mode: 'payment', nunca 'subscription'): se paga una vez y el
 * acceso es de por vida. El precio y el producto NO están en el código: salen
 * de hogar_config, que Andrea edita desde su panel.
 *
 * Direct charges: el cobro ocurre EN la cuenta conectada de Andrea, así que
 * tanto el Customer como la Checkout Session van con { stripeAccount }.
 */

/**
 * Customer de la clienta EN la cuenta conectada (los customers son por cuenta,
 * no de la plataforma). Reusa el guardado en hogar_usuarias; si no hay, crea
 * uno con idempotencyKey para que un doble clic no genere dos.
 */
async function getOrCreateCustomer(
  stripe: Stripe,
  admin: SupabaseClient,
  usuaria: { id: string; email: string | null },
  stripeAccount: string
): Promise<string> {
  const { data } = await admin
    .from('hogar_usuarias')
    .select('stripe_customer_id')
    .eq('id', usuaria.id)
    .maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id as string;

  const customer = await stripe.customers.create(
    {
      email: usuaria.email ?? undefined,
      metadata: { app: APP_TAG, user_id: usuaria.id },
      preferred_locales: ['es']
    },
    { idempotencyKey: `hogar_customer_${usuaria.id}`, stripeAccount }
  );

  const { error } = await admin
    .from('hogar_usuarias')
    .update({ stripe_customer_id: customer.id })
    .eq('id', usuaria.id);
  if (error) {
    // No es fatal: el cobro puede seguir. Pero hay que verlo en los logs.
    console.error('[crear-checkout] no se pudo guardar stripe_customer_id:', error.message);
  }
  return customer.id;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return badRequest('Método no permitido');

  try {
    const auth = await autenticar(event);
    if (!auth.ok) return auth.response;

    if (!process.env.STRIPE_SECRET_KEY) {
      return badRequest('cobros_no_activos');
    }

    const admin = getAdminClient();
    const config = await leerConfig(admin);

    // Los cobros solo están vivos si Andrea terminó el onboarding de Connect.
    if (!config?.stripe_account_id || config.stripe_charges_enabled !== true) {
      return badRequest('cobros_no_activos');
    }
    const precio = config.precio_centavos ?? 0;
    if (!precio || precio <= 0) {
      return badRequest('precio_no_configurado');
    }

    const stripeAccount = config.stripe_account_id;
    const moneda = (config.moneda || 'mxn').toLowerCase();
    const stripe = getStripe();

    const customerId = await getOrCreateCustomer(
      stripe,
      admin,
      { id: auth.user.id, email: auth.user.email },
      stripeAccount
    );

    const origin =
      event.headers.origin ||
      event.headers.referer?.replace(/\/+$/, '') ||
      optionalEnv('URL', '');

    // metadata en la session Y en el payment_intent: el webhook resuelve por
    // ahí a quién acreditar, y la etiqueta app lo separa de los eventos de EKKO.
    const metadata = { app: APP_TAG, user_id: auth.user.id };

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        customer: customerId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: moneda,
              unit_amount: precio,
              product_data: {
                name: config.producto_nombre || 'Acceso HOGAR',
                ...(config.producto_desc ? { description: config.producto_desc } : {})
              }
            }
          }
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: `${origin}/?pago=exito`,
        cancel_url: `${origin}/?pago=cancelado`
      },
      { idempotencyKey: `hogar_checkout_${auth.user.id}`, stripeAccount }
    );

    return ok({ url: session.url });
  } catch (err) {
    console.error('[crear-checkout]', err instanceof Error ? err.message : err);
    return serverError('No pudimos iniciar el pago');
  }
};
