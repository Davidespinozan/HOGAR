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

/** Última URL conocida del sitio, para cuando no se puede deducir del request. */
const ORIGEN_PRODUCCION = 'https://hogarbyandrea.netlify.app';

/** Segundos de la ventana de idempotencia del checkout. */
const VENTANA_IDEMPOTENCIA_MS = 30_000;

/**
 * Rango válido del precio, en centavos.
 *
 * El mínimo NO es una preferencia nuestra: Stripe rechaza cualquier cobro por
 * debajo de 10 MXN (ver la tabla de importes mínimos en
 * https://docs.stripe.com/currencies). Con menos, sessions.create lanza
 * `amount_too_small` y la clienta se queda sin poder pagar.
 *
 * El máximo sí es nuestro. El techo técnico de Stripe son 999.999,99 MXN, pero
 * ese número no protege de lo que de verdad pasa: una errata. Un 499 que se
 * convierte en 4990000, o teclear el importe ya en centavos creyendo que son
 * pesos. 50.000 MXN deja muchísimo margen y caza los dedazos.
 *
 * OJO — UMBRALES FIJOS PARA MXN. hogar_config.moneda existe y hoy siempre es
 * MXN. Si algún día se cobra en otra, HAY QUE REVISAR EL MÍNIMO: cada moneda
 * tiene el suyo y varían mucho (USD 0,50 · GBP 0,30 · HUF 175 · MXN 10).
 */
const PRECIO_MIN_CENTAVOS = 1000;       //     10 MXN — límite de Stripe
const PRECIO_MAX_CENTAVOS = 5_000_000;  // 50.000 MXN — nuestro, contra erratas

/**
 * Cubo de tiempo para la clave de idempotencia del checkout.
 *
 * La clave era `hogar_checkout_${user.id}`, constante y para siempre. Stripe
 * guarda la respuesta de la primera llamada con una clave dada y la REPRODUCE
 * durante 24 h, así que el segundo intento de la misma clienta no creaba una
 * sesión nueva: devolvía la de la primera vez, ya pagada o ya expirada. De ahí
 * el "Completaste el pago o se agotó el tiempo de espera para esta sesión"
 * después de un 200 en ~800 ms — era una reproducción, no una sesión nueva.
 *
 * Con el cubo de 30 s la clave sigue protegiendo del doble clic (dos toques
 * seguidos caen en el mismo cubo y reusan la sesión) pero deja de bloquear un
 * intento posterior, que estrena cubo y por tanto sesión.
 *
 * Límite conocido y aceptado: dos clics que caigan a ambos lados de un borde de
 * cubo (…:29.9 y …:30.1) crean dos sesiones. Es inevitable con una clave
 * derivada del reloj y no hace daño: una sesión de Checkout sin pagar caduca
 * sola y no cobra nada.
 */
function ventanaIdempotencia(): number {
  return Math.floor(Date.now() / VENTANA_IDEMPOTENCIA_MS);
}

/**
 * Origen absoluto del sitio, para construir success_url y cancel_url.
 *
 * Stripe RECHAZA una URL relativa, así que el último recurso no puede ser ''
 * —dejaba `success_url: '/?pago=exito'`, que revienta la creación de la sesión—.
 * Además el referer llega con ruta (`https://sitio/perfil`), y usarlo tal cual
 * daba `https://sitio/perfil/?pago=exito`: válido para Stripe, pero devuelve a
 * la clienta a una ruta que no es la raíz. Se le extrae el origen.
 */
function resolverOrigen(headers: Record<string, string | undefined>): string {
  const candidatos = [headers.origin, headers.referer, optionalEnv('URL', '')];
  for (const c of candidatos) {
    if (!c) continue;
    try {
      const u = new URL(c);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
    } catch {
      // No es una URL absoluta: se ignora y se prueba el siguiente.
    }
  }
  return ORIGEN_PRODUCCION;
}

/**
 * Ficha de cobro de la clienta: si ya pagó y su customer de Stripe.
 *
 * Va en UNA sola consulta a propósito. Antes se leía `stripe_customer_id` desde
 * dentro de getOrCreateCustomer; ahora se lee todo aquí, arriba, y el customer
 * se le pasa ya resuelto. Mismo número de viajes a Supabase que antes.
 *
 * Devuelve null si la lectura FALLA — que no es lo mismo que "no ha pagado".
 * Ver el comentario del handler: un fallo de lectura no puede bloquear la venta.
 */
async function leerFichaCobro(
  admin: SupabaseClient,
  userId: string
): Promise<{ pagado: boolean; stripeCustomerId: string | null } | null> {
  const { data, error } = await admin
    .from('hogar_usuarias')
    .select('pagado, stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[crear-checkout] no se pudo leer la ficha de cobro:', error.message);
    return null;
  }
  if (!data) return null;
  return {
    pagado: data.pagado === true,
    stripeCustomerId: (data.stripe_customer_id as string | null) ?? null
  };
}

/**
 * Customer de la clienta EN la cuenta conectada (los customers son por cuenta,
 * no de la plataforma). Reusa el guardado en hogar_usuarias; si no hay, crea
 * uno con idempotencyKey para que un doble clic no genere dos.
 */
async function getOrCreateCustomer(
  stripe: Stripe,
  admin: SupabaseClient,
  usuaria: { id: string; email: string | null },
  stripeAccount: string,
  customerIdGuardado: string | null
): Promise<string> {
  if (customerIdGuardado) return customerIdGuardado;

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
    // Red de seguridad, no duplicado del panel: el panel solo impide GUARDAR un
    // precio inválido de aquí en adelante, y aquí se ve el valor que hay ahora
    // mismo —que pudo escribirse antes de existir esa validación—. Además, sin
    // esto el importe llegaría a Stripe, que lanzaría, y el catch de abajo lo
    // aplanaría a "No pudimos iniciar el pago": la clienta reintentaría para
    // siempre algo que no depende de ella.
    if (precio < PRECIO_MIN_CENTAVOS || precio > PRECIO_MAX_CENTAVOS) {
      console.error(
        '[crear-checkout] precio fuera de rango:',
        precio,
        'centavos (válido:',
        PRECIO_MIN_CENTAVOS,
        '-',
        PRECIO_MAX_CENTAVOS,
        ')'
      );
      return badRequest('precio_invalido');
    }

    const stripeAccount = config.stripe_account_id;
    const moneda = (config.moneda || 'mxn').toLowerCase();
    const stripe = getStripe();

    // ── EL CORTAFUEGOS DEL DOBLE COBRO ──────────────────────────────────────
    // Antes esta función no miraba `pagado` en ningún momento, y el camino al
    // cobro doble era el que recorre cualquiera con un webhook lento: pagas, la
    // confirmación tarda, la app dice "vuelve en unos minutos", recargas, el muro
    // te enseña "Activar mi acceso" —porque `pagado` sigue en false— y lo pulsas.
    // La ventana de idempotencia son 30 s, así que a esas alturas ya expiró: se
    // crea una sesión NUEVA y Stripe cobra otra vez. El webhook no duplica el
    // acceso, pero el cargo ya está hecho, y los Términos dicen que no hay
    // devoluciones. Esta comprobación es la que de verdad lo impide; el aviso
    // del cliente solo evita el susto.
    //
    // FALLO DE LECTURA → SE DEJA PASAR, a propósito. La consulta va con service
    // role, así que RLS no la filtra y solo puede fallar la red. Tratar "no pude
    // leer" como "ya pagó" convertiría un tropiezo de Supabase en una caída de
    // TODAS las ventas. Mismo criterio que cargarAccesoHogar() en el cliente:
    // ante la duda, no bloquear. Se prefiere un cobro doble improbable a una caja
    // cerrada.
    const ficha = await leerFichaCobro(admin, auth.user.id);
    if (ficha?.pagado === true) {
      console.log('[crear-checkout] ya tiene acceso, no se crea sesión:', auth.user.id);
      return badRequest('ya_tienes_acceso');
    }

    const customerId = await getOrCreateCustomer(
      stripe,
      admin,
      { id: auth.user.id, email: auth.user.email },
      stripeAccount,
      ficha?.stripeCustomerId ?? null
    );

    const origin = resolverOrigen(event.headers);

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
      { idempotencyKey: `hogar_checkout_${auth.user.id}_${ventanaIdempotencia()}`, stripeAccount }
    );

    return ok({ url: session.url });
  } catch (err) {
    console.error('[crear-checkout]', err instanceof Error ? err.message : err);
    return serverError('No pudimos iniciar el pago');
  }
};
