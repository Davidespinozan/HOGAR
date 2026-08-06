import type { Handler } from '@netlify/functions';
import { ok, badRequest, serverError, preflight } from '../_lib/http';
import { getAdminClient } from '../_lib/supabase';
import { autenticarAdmin } from '../_lib/auth';

/**
 * POST /acceso-manual — Andrea concede o revoca el acceso de una clienta a mano.
 * Auth: Bearer JWT de ANDREA (autenticarAdmin, igual que connect-onboarding).
 *
 * ES LA RED DE SEGURIDAD DEL SISTEMA DE PAGOS. Hasta ahora, si el webhook de
 * Stripe fallaba, la única forma de desbloquear a una clienta que ya había pagado
 * era correr SQL a mano en Supabase. Ocurrió de verdad el 6 de agosto de 2026: el
 * evento checkout.session.completed se perdió —Stripe no encola eventos cuando el
 * endpoint está deshabilitado— y la clienta quedó con stripe_customer_id puesto y
 * pagado=false.
 *
 * VENTA vs CORTESÍA, y por qué importa:
 *   venta    → la clienta pagó de verdad y el cobro no llegó a la base. Es un
 *              ingreso REAL: lleva monto_centavos y suma en las métricas.
 *   cortesia → Andrea regala el acceso. No es una venta y no debe sumar.
 * Sin esa distinción, o los regalos inflan las ventas o los cobros perdidos
 * desaparecen de ellas. Las dos mentiras son malas, en direcciones opuestas.
 *
 * La escritura va SIEMPRE por aquí, con service_role, nunca desde el navegador:
 * hogar_usuarias no tiene ninguna policy de UPDATE (verificado en agosto de 2026,
 * solo dos de SELECT) y no debe tenerla.
 */

/** Quién lo hizo sale del JWT, jamás del cuerpo de la petición. */
interface Body {
  user_id?: string;
  accion?: 'conceder' | 'revocar';
  tipo?: 'venta' | 'cortesia';
  monto_centavos?: number | null;
  nota?: string | null;
}

/** Mismo techo que crear-checkout: caza el dedazo de teclear centavos por pesos. */
const MONTO_MAX_CENTAVOS = 5_000_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return badRequest('Método no permitido');

  try {
    const auth = await autenticarAdmin(event);
    if (!auth.ok) return auth.response;

    let body: Body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return badRequest('cuerpo_invalido');
    }

    const userId = (body.user_id || '').trim();
    if (!UUID_RE.test(userId)) return badRequest('user_id_invalido');

    const accion = body.accion;
    if (accion !== 'conceder' && accion !== 'revocar') return badRequest('accion_invalida');

    const admin = getAdminClient();

    // La fila tiene que existir. Sin esto, un user_id equivocado escribiría 0
    // filas y devolvería éxito: Andrea creería haber concedido un acceso que no
    // concedió a nadie.
    const { data: actual, error: leerErr } = await admin
      .from('hogar_usuarias')
      .select('id, nombre, email, pagado, acceso_manual')
      .eq('id', userId)
      .maybeSingle();
    if (leerErr) throw new Error(`leer hogar_usuarias: ${leerErr.message}`);
    if (!actual) return badRequest('usuaria_no_encontrada');

    const por = auth.user.email || 'andrea';
    const nota = (body.nota || '').trim().slice(0, 500) || null;
    const ahora = new Date().toISOString();

    let cambios: Record<string, unknown>;
    let tipo: 'venta' | 'cortesia' | null = null;
    let monto: number | null = null;

    if (accion === 'conceder') {
      tipo = body.tipo === 'venta' ? 'venta' : 'cortesia';

      if (tipo === 'venta') {
        const n = Number(body.monto_centavos);
        // El importe solo se acepta en una venta, y solo si es un entero sano.
        // En una cortesía se ignora a propósito: un regalo con importe sumaría a
        // los ingresos del mes sin que haya entrado un peso.
        if (!Number.isInteger(n) || n < 0 || n > MONTO_MAX_CENTAVOS) {
          return badRequest('monto_invalido');
        }
        monto = n;
      }

      cambios = {
        pagado: true,
        estatus: 'activa',
        plan: 'completo',
        acceso_manual: true,
        acceso_manual_en: ahora,
        acceso_manual_por: por,
        acceso_manual_nota: nota,
        // fecha_compra solo en una venta: es la columna por la que las métricas
        // filtran el mes. Una cortesía no debe aparecer en el dinero de agosto.
        ...(tipo === 'venta' ? { fecha_compra: ahora, monto_centavos: monto } : {})
      };
    } else {
      cambios = {
        pagado: false,
        acceso_manual: false,
        acceso_manual_en: ahora,
        acceso_manual_por: por,
        acceso_manual_nota: nota
        // fecha_compra y monto_centavos NO se borran: si hubo un cobro real, su
        // rastro se conserva. `pagado` es lo que gobierna el acceso.
      };
    }

    // .select() después del update para confirmar que de verdad escribió. Sin él,
    // un update bloqueado devuelve 0 filas SIN error y parecería que funcionó.
    const { data: filas, error: escErr } = await admin
      .from('hogar_usuarias')
      .update(cambios)
      .eq('id', userId)
      .select('id, pagado, acceso_manual, acceso_manual_en, acceso_manual_por, fecha_compra, monto_centavos');
    if (escErr) throw new Error(`escribir acceso: ${escErr.message}`);
    if (!filas || filas.length === 0) throw new Error('el update no afectó a ninguna fila');

    // Bitácora. Va DESPUÉS del update y su fallo no revierte nada: entre dejar a
    // la clienta sin acceso y quedarnos sin una línea de registro, se prefiere lo
    // segundo. Queda en los logs de Netlify.
    const { error: logErr } = await admin.from('hogar_acceso_manual_log').insert({
      user_id: userId,
      accion,
      tipo,
      monto_centavos: monto,
      por,
      nota
    });
    if (logErr) {
      console.error('[acceso-manual] el acceso se aplicó pero NO se registró:', logErr.message);
    }

    console.log(`[acceso-manual] ${accion} (${tipo ?? '—'}) sobre ${userId} por ${por}`);
    return ok({ usuaria: filas[0], registrado: !logErr });
  } catch (err) {
    console.error('[acceso-manual]', err instanceof Error ? err.message : err);
    return serverError('No pudimos cambiar el acceso');
  }
};
