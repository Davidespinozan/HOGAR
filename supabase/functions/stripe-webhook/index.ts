// ============================================================================
// HOGAR — stripe-webhook
// Recibe eventos de Stripe, verifica la firma, y al confirmarse el pago marca a
// la clienta como 'activa' en hogar_usuarias. Idempotente vía hogar_pagos.
//
// IMPORTANTE: esta función debe desplegarse con verify_jwt = false (Stripe no
// manda JWT de Supabase). La seguridad la da la verificación de firma de Stripe.
//
// Secrets requeridos:
//   STRIPE_SECRET_KEY       → sk_...
//   STRIPE_WEBHOOK_SECRET   → whsec_...  (del endpoint de webhook en Stripe)
// Auto-inyectados por Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
import Stripe from 'https://esm.sh/stripe@16?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';

// Cliente con service role: escribe saltándose RLS (solo el servidor lo tiene).
const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) return new Response('Sin firma', { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    // constructEventAsync: verificación de firma compatible con Deno.
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe-webhook] firma inválida:', err);
    return new Response('Firma inválida', { status: 400 });
  }

  // Idempotencia: si el evento ya se registró, no lo reprocesamos.
  const { error: dupErr } = await admin.from('hogar_pagos').insert({
    stripe_event_id: event.id,
    stripe_event_type: event.type,
    raw_payload: event as unknown as Record<string, unknown>,
  });
  // 23505 = unique_violation → ya procesado. Respondemos 200 para que Stripe no reintente.
  if (dupErr && (dupErr as { code?: string }).code === '23505') {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }
  if (dupErr) {
    console.error('[stripe-webhook] no se pudo registrar el evento:', dupErr);
    return new Response('Error al registrar evento', { status: 500 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      // Solo activamos si el pago realmente se completó.
      if (s.payment_status === 'paid') {
        const email = s.customer_details?.email ?? s.metadata?.email ?? null;
        const userId = s.metadata?.user_id ?? null;

        // Completar la fila del journal con los datos del cobro.
        await admin.from('hogar_pagos')
          .update({
            stripe_session_id: s.id,
            stripe_payment_intent_id: typeof s.payment_intent === 'string' ? s.payment_intent : null,
            stripe_customer_id: typeof s.customer === 'string' ? s.customer : null,
            user_id: userId,
            email,
            monto_centavos: s.amount_total ?? null,
            moneda: s.currency ?? null,
            status: 'paid',
          })
          .eq('stripe_event_id', event.id);

        // Marcar a la clienta como activa. Resolvemos por id si lo tenemos, si no por email.
        const patch = {
          estatus: 'activa',
          paid_at: new Date().toISOString(),
          stripe_customer_id: typeof s.customer === 'string' ? s.customer : null,
        };
        if (userId) {
          await admin.from('hogar_usuarias').update(patch).eq('id', userId);
        } else if (email) {
          await admin.from('hogar_usuarias').update(patch).eq('email', email);
        } else {
          console.warn('[stripe-webhook] pago sin email ni user_id; no se pudo activar');
        }
      }
    }
    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (err) {
    console.error('[stripe-webhook] error procesando', event.type, err);
    return new Response('Error procesando evento', { status: 500 });
  }
});
