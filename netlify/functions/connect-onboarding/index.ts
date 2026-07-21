import type { Handler } from '@netlify/functions';
import { ok, badRequest, serverError, preflight } from '../_lib/http';
import { optionalEnv } from '../_lib/env';
import { getStripe, APP_TAG } from '../_lib/stripe';
import { getAdminClient, leerConfig, actualizarConfig } from '../_lib/supabase';
import { autenticarAdmin } from '../_lib/auth';

/**
 * POST /connect-onboarding — Andrea activa sus cobros (Stripe Connect Express).
 * Auth: Bearer JWT de Andrea. Body opcional: { country?: 'MX', return_path?: '/' }.
 *
 * Get-or-create de la cuenta conectada + Account Link hospedado por Stripe.
 * Andrea llena UN formulario (identidad + banco, el KYC de Stripe) y no vuelve
 * a tocar Stripe. El estado real (charges_enabled) lo refresca connect-status
 * o el evento account.updated del webhook.
 *
 * Patrón portado de EKKO, sin tenant_id: aquí la cuenta vive en hogar_config.
 */

interface Body {
  country?: string;
  return_path?: string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return badRequest('Método no permitido');

  try {
    const auth = await autenticarAdmin(event);
    if (!auth.ok) return auth.response;

    // Sin llave de Stripe la infraestructura existe pero no puede operar:
    // respondemos algo que la UI sepa mostrar, en vez de reventar.
    if (!process.env.STRIPE_SECRET_KEY) {
      return ok({ url: null, reason: 'stripe_pendiente' });
    }

    const body: Body = JSON.parse(event.body || '{}');
    const country = (body.country || 'MX').toUpperCase();

    const stripe = getStripe();
    const admin = getAdminClient();
    const config = await leerConfig(admin);

    // Get-or-create de la cuenta conectada de Andrea.
    let accountId = config?.stripe_account_id ?? null;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country,
        email: auth.user.email ?? undefined,
        metadata: { app: APP_TAG },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        }
      });
      accountId = account.id;
      await actualizarConfig(admin, { stripe_account_id: accountId });
    }

    // De vuelta al panel de Andrea. El origin sale del request; si no viene,
    // cae a la URL que Netlify inyecta en el build.
    const origin =
      event.headers.origin ||
      event.headers.referer?.replace(/\/+$/, '') ||
      optionalEnv('URL', '');
    const returnPath = body.return_path && body.return_path.startsWith('/') ? body.return_path : '/';

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}${returnPath}?connect=refresh`,
      return_url: `${origin}${returnPath}?connect=done`,
      type: 'account_onboarding'
    });

    return ok({ url: link.url });
  } catch (err) {
    console.error('[connect-onboarding]', err instanceof Error ? err.message : err);
    return serverError('No pudimos iniciar la activación de cobros');
  }
};
