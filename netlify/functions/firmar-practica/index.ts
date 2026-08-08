import type { Handler } from '@netlify/functions';
import { ok, badRequest, forbidden, serverError, preflight } from '../_lib/http';
import { getAdminClient } from '../_lib/supabase';
import { autenticar, esAdmin } from '../_lib/auth';

/**
 * POST /firmar-practica — devuelve las direcciones temporales del vídeo y su voz.
 *
 * ESTE ES EL MURO DE VERDAD. El que existe en el navegador disuade a quien usa la
 * app con normalidad y no detiene a nadie con la consola abierta: hasta ahora los
 * archivos vivían en un bucket público con nombres predecibles y se descargaban
 * con el enlace directo, sin sesión siquiera.
 *
 * Aquí no. Se comprueba el pago contra la base y solo entonces se firman.
 */

/** El bucket privado. La marca vive en `hogar-publico` y no pasa por aquí. */
const BUCKET = 'hogar';

/** Práctica → prefijo del archivo. Espejo de VIDEO_SLUG en index.html. */
const SLUG: Record<string, string> = {
  'Ritmo Suave': 'RITMOSUAVE',
  'Presencia': 'PRESENCIA',
  'Recuperación Suave': 'RECUPERACIONSUAVE',
  'Contención': 'CONTENCION',
  'Descarga Segura': 'DESCARGASEGURA'
};

const DURACIONES = ['15', '30', '45'];

/**
 * CUATRO HORAS.
 *
 * Un <video> no descarga el archivo de una vez: pide trozos con range requests, y
 * TODOS usan la misma dirección firmada. Si caduca a mitad, la siguiente petición
 * da 401 y el vídeo se corta donde esté.
 *
 * Hay que cubrir una práctica de 45 min, más una pausa, más que se vaya a comer y
 * vuelva. Y desde agosto de 2026 también el retomar posición, que hace un salto y
 * pide un rango nuevo.
 *
 * Acortar no protege: quien quiera piratear descarga el archivo entero en mucho
 * menos de 4 horas. Solo molesta a quien está practicando. Y la alternativa
 * —firmar corto y volver a firmar— obliga a cambiar el src a mitad y se pierde la
 * posición, que es justo lo que se acaba de construir.
 */
const VIGENCIA_SEGUNDOS = 4 * 60 * 60;

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return badRequest('Método no permitido');

  try {
    const auth = await autenticar(event);
    if (!auth.ok) return auth.response;

    let cuerpo: { practica?: string; minutos?: string };
    try {
      cuerpo = JSON.parse(event.body || '{}');
    } catch {
      return badRequest('Cuerpo inválido');
    }

    const slug = SLUG[String(cuerpo.practica || '')];
    const min = String(cuerpo.minutos || '');
    if (!slug) return badRequest('Práctica desconocida');
    if (!DURACIONES.includes(min)) return badRequest('Duración desconocida');

    const admin = getAdminClient();

    // ── Quién puede ver una práctica: la dueña, o quien tenga el acceso activo.
    //
    // ANDREA ENTRA POR SER ANDREA, NO POR HABER PAGADO. Su fila tiene
    // `pagado = false` —nunca compró nada, su ficha dice "Sin compra"— y la
    // primera versión de esta función comprobaba solo el pago, así que la dejaba
    // fuera de sus propias prácticas. Necesita verlas para revisarlas y para
    // grabar contenido nuevo.
    //
    // Es el mismo criterio que usa el navegador en cargarAccesoHogar(), donde
    // esAdmin() ya la deja pasar antes de mirar `pagado`. Aquí faltaba.
    //
    // `acceso_manual` NO se mira, y eso sigue igual: es una marca de PROCEDENCIA
    // —cómo se concedió el acceso—, no de autorización. Cuando Andrea concede
    // acceso a mano, acceso-manual escribe `pagado: true` igual.
    if (!esAdmin(auth.user.email)) {
      // Sin fila es 403: la cuenta se borró, y no hay a quién dejar entrar.
      const { data: usuaria, error: errUsuaria } = await admin
        .from('hogar_usuarias')
        .select('pagado')
        .eq('id', auth.user.id)
        .maybeSingle();
      if (errUsuaria) throw new Error(`hogar_usuarias: ${errUsuaria.message}`);
      if (!usuaria || usuaria.pagado !== true) {
        return forbidden('Tu acceso todavía no está activo.');
      }
    }

    // ── Las dos direcciones, en UNA llamada y con la MISMA vigencia.
    //
    // En plural a propósito. El cliente ya no puede derivar la del audio de la del
    // vídeo cambiando la extensión: cada objeto lleva su propio token.
    const rutaVideo = `${slug}${min}.mp4`;
    const rutaAudio = `${slug}${min}.mp3`;
    const { data: firmas, error: errFirma } = await admin.storage
      .from(BUCKET)
      .createSignedUrls([rutaVideo, rutaAudio], VIGENCIA_SEGUNDOS);
    if (errFirma) throw new Error(`firmar: ${errFirma.message}`);

    const porRuta = new Map<string, string | null>();
    (firmas || []).forEach((f) => {
      // createSignedUrls devuelve un error POR OBJETO: el que no existe viene con
      // `error` y sin URL, y los demás se firman igual. Por eso se recorre en vez
      // de dar por hecho que vinieron los dos.
      porRuta.set(f.path || '', f.error ? null : f.signedUrl || null);
    });

    const video = porRuta.get(rutaVideo) || null;
    const audio = porRuta.get(rutaAudio) || null;

    // ── "En preparación", decidido AQUÍ y no en el navegador.
    //
    // Antes el cliente hacía un HEAD y leía 404/400 como "falta el archivo". Con el
    // bucket privado eso deja de distinguir: todo da 401. Quien sabe de verdad si
    // el objeto existe es quien intenta firmarlo.
    //
    // La voz puede faltar sin que la práctica falte: hay vídeos sin su .mp3, y esa
    // combinación se reproduce igual, en silencio. Solo la ausencia del VÍDEO es
    // "en preparación".
    if (!video) {
      return ok({ falta: true, practica: cuerpo.practica, minutos: min });
    }

    return ok({
      falta: false,
      video,
      audio,                       // null si esta práctica no tiene voz
      vigenciaSegundos: VIGENCIA_SEGUNDOS
    });
  } catch (err) {
    console.error('[firmar-practica]', err instanceof Error ? err.message : err);
    return serverError('No pudimos preparar tu práctica');
  }
};
