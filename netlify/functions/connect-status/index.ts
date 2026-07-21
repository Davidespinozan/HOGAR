import type { Handler } from '@netlify/functions';
import { ok, badRequest, serverError, preflight } from '../_lib/http';
import { getStripe } from '../_lib/stripe';
import { getAdminClient, leerConfig, actualizarConfig } from '../_lib/supabase';
import { autenticarAdmin } from '../_lib/auth';

/**
 * GET|POST /connect-status — estado de los cobros de Andrea.
 * Auth: Bearer JWT de Andrea.
 *
 * Además de charges_enabled/details_submitted (que persistimos en hogar_config),
 * devuelve lo que la UI necesita para que Andrea entienda su situación sin
 * entrar a Stripe: banco de depósito, balance y link a su panel Express.
 *
 * Cada enriquecimiento va en su propio try/catch: si Stripe rechaza uno, el
 * resto del estado se devuelve igual. Patrón portado de EKKO.
 */

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return badRequest('Método no permitido');
  }

  try {
    const auth = await autenticarAdmin(event);
    if (!auth.ok) return auth.response;

    const base = {
      connected: false,
      charges_enabled: false,
      details_submitted: false,
      payouts_enabled: false
    };

    if (!process.env.STRIPE_SECRET_KEY) {
      return ok({ ...base, reason: 'stripe_pendiente' });
    }

    const admin = getAdminClient();
    const config = await leerConfig(admin);
    const accountId = config?.stripe_account_id ?? null;
    if (!accountId) return ok(base);

    const stripe = getStripe();
    const account = await stripe.accounts.retrieve(accountId);

    const chargesEnabled = account.charges_enabled === true;
    const detailsSubmitted = account.details_submitted === true;

    await actualizarConfig(admin, {
      stripe_charges_enabled: chargesEnabled,
      stripe_details_submitted: detailsSubmitted
    });

    const businessName =
      account.business_profile?.name || (account.settings?.dashboard?.display_name ?? null);

    // Cuenta bancaria de depósito (la default, si ya la registró).
    let banco: { bank_name: string | null; last4: string | null } | null = null;
    try {
      const bancos = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'bank_account',
        limit: 1
      });
      const b = bancos.data[0] as { bank_name?: string | null; last4?: string | null } | undefined;
      if (b) banco = { bank_name: b.bank_name ?? null, last4: b.last4 ?? null };
    } catch (e) {
      console.error('[connect-status] banco', e instanceof Error ? e.message : e);
    }

    // Balance de la cuenta conectada (lo que ya es de Andrea).
    let balance: {
      disponible_centavos: number;
      pendiente_centavos: number;
      moneda: string;
    } | null = null;
    try {
      const bal = await stripe.balance.retrieve({ stripeAccount: accountId });
      const disp = bal.available?.[0];
      const pend = bal.pending?.[0];
      balance = {
        disponible_centavos: disp?.amount ?? 0,
        pendiente_centavos: pend?.amount ?? 0,
        moneda: (disp?.currency ?? pend?.currency ?? account.default_currency ?? 'mxn').toUpperCase()
      };
    } catch (e) {
      console.error('[connect-status] balance', e instanceof Error ? e.message : e);
    }

    // Link al panel Express de Stripe (cambiar banco, ver depósitos).
    let dashboard_url: string | null = null;
    try {
      const link = await stripe.accounts.createLoginLink(accountId);
      dashboard_url = link.url ?? null;
    } catch (e) {
      console.error('[connect-status] loginLink', e instanceof Error ? e.message : e);
    }

    return ok({
      connected: true,
      charges_enabled: chargesEnabled,
      details_submitted: detailsSubmitted,
      payouts_enabled: account.payouts_enabled === true,
      account_id: accountId,
      business_name: businessName,
      email: account.email ?? null,
      pais: account.country ?? null,
      payout_interval: account.settings?.payouts?.schedule?.interval ?? null,
      banco,
      balance,
      dashboard_url
    });
  } catch (err) {
    console.error('[connect-status]', err instanceof Error ? err.message : err);
    return serverError('No pudimos consultar el estado de cobros');
  }
};
