// ============================================================================
// HOGAR — create-checkout
// Crea una sesión de Stripe Checkout (PAGO ÚNICO, MXN) para la clienta logueada.
// La clienta debe estar autenticada: usamos su JWT para saber QUIÉN paga y su email.
//
// Secrets requeridos (supabase secrets set ...):
//   STRIPE_SECRET_KEY   → sk_live_... o sk_test_...
//   STRIPE_PRICE_ID     → price_...  (el producto/precio que crea Andrea en Stripe; ahí fija el monto)
//   SITE_URL            → https://hogarbyandrea.netlify.app  (para success/cancel)
// Auto-inyectados por Supabase: SUPABASE_URL, SUPABASE_ANON_KEY
// ============================================================================
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1) Identificar a la clienta por su JWT (Authorization: Bearer <token>).
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'No autenticada' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const priceId = Deno.env.get('STRIPE_PRICE_ID');
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'STRIPE_PRICE_ID no configurado' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const siteUrl = Deno.env.get('SITE_URL') ?? 'https://hogarbyandrea.netlify.app';

    // 2) Crear la sesión de Checkout — PAGO ÚNICO.
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email ?? undefined,
      // metadata → el webhook resuelve a quién marcar 'activa'
      metadata: { user_id: user.id, email: user.email ?? '' },
      payment_intent_data: { metadata: { user_id: user.id, email: user.email ?? '' } },
      success_url: `${siteUrl}/?pago=exito`,
      cancel_url: `${siteUrl}/?pago=cancelado`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[create-checkout] error:', err);
    return new Response(JSON.stringify({ error: 'No se pudo iniciar el pago' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
