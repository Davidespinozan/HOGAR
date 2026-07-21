import Stripe from 'stripe';
import { requireEnv } from './env';

/**
 * Cliente de Stripe para HOGAR.
 *
 * Modelo: Stripe Connect, cuentas EXPRESS, DIRECT CHARGES. STRYV es la
 * plataforma; Andrea es la cuenta conectada y cobra directo a sus clientas.
 * Por eso TODA operación de cobro va con `{ stripeAccount }`.
 *
 * OJO: la cuenta-plataforma es la MISMA que usa EKKO. Para no confundir los
 * eventos de un producto con los del otro, todo lo que creamos lleva
 * metadata { app: 'hogar' } y el webhook descarta lo que no sea de HOGAR.
 */

// apiVersion FIJA (nunca implícita: así actualizar el SDK no cambia el
// comportamiento sin avisar). Misma versión que la plataforma de EKKO.
const API_VERSION = '2025-08-27.basil';

/** Etiqueta con la que marcamos todo lo de HOGAR en la plataforma compartida. */
export const APP_TAG = 'hogar';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  _stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'), {
    apiVersion: API_VERSION,
    typescript: true
  });
  return _stripe;
}

/**
 * ¿El evento es de HOGAR? La plataforma es compartida con EKKO, así que solo
 * procesamos lo que lleve metadata.app === 'hogar'. Función PURA a propósito:
 * la decisión de ignorar un evento se puede razonar (y testear) sin Stripe.
 *
 * Busca la etiqueta en el objeto del evento (session, account, payment_intent…),
 * que es donde la ponemos al crear cada recurso.
 */
export function esDeHogar(stripeEvent: Stripe.Event): boolean {
  const obj = stripeEvent.data?.object as { metadata?: Record<string, string> | null } | undefined;
  return obj?.metadata?.app === APP_TAG;
}
