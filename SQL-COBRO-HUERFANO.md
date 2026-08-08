# SQL — cobro huérfano: dejar rastro del pago en vuelo

Cierra el **pendiente 6** para la ventana en la que el problema ocurre de verdad.

## El problema

1. La clienta paga. Stripe cobra.
2. El webhook tarda. `pagado` sigue en `false` y el muro la retiene en ESPERAR.
3. Se impacienta y borra su cuenta.
4. `hogar_borrar_datos_usuaria` **no** creaba fila en `hogar_bajas`: solo la creaba
   `IF v_u.pagado IS TRUE`, y todavía no lo era.
5. El webhook llega, no encuentra la fila y se va.

**Dinero cobrado, sin cuenta y sin ningún registro.** Si esa persona reclama —o el
banco lo hace por ella— no hay nada que aportar.

## La idea

Una columna, `hogar_usuarias.checkout_iniciado_en`, que dice "aquí pudo haber
dinero". La escribe `crear-checkout`, la borra `stripe-webhook` al acreditar, y el
job diario barre las caducadas.

## Dos ventanas, y no es un detalle

| | Ventana | Pregunta que responde |
|---|---|---|
| **Baja** (esta función) | 72 h | ¿Pudo haber dinero? |
| **Muro ESPERAR** (cliente) | 30 min | ¿Le enseño el botón de pagar? |

Las 72 h salen de sumar lo que puede tardar el dinero en aparecer: una Checkout
Session vive **24 h** (el valor por defecto de Stripe; `crear-checkout` no fija
`expires_at`) y encima Stripe reintenta el webhook durante unos **3 días**. Se peca
de generoso: una baja de más es una fila que nadie lee y que se purga sola; una de
menos es el desastre que venimos a arreglar.

Los 30 min del muro **no se pueden subir a 72 h**. Quien abre el checkout y se
arrepiente se quedaría tres días viendo "esperando confirmación" **sin poder pagar**.
Ese es el peor fallo posible de todo esto: bloquea el ingreso y parece un bug.

## Cómo correrlo

Supabase → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — cobro huérfano: dejar rastro del pago en vuelo.  (Pendiente 6)
-- Idempotente: se puede correr dos veces sin efecto.
-- ============================================================================

ALTER TABLE public.hogar_usuarias
  ADD COLUMN IF NOT EXISTS checkout_iniciado_en timestamptz;

COMMENT ON COLUMN public.hogar_usuarias.checkout_iniciado_en IS
  'Momento en que se creó una Checkout Session para esta clienta. La escribe crear-checkout, la borra stripe-webhook al acreditar, y hogar_limpiar_checkouts() barre las caducadas. Sirve para dos cosas: dejar baja aunque el webhook no haya llegado, y sostener el estado ESPERAR entre dispositivos.';

-- ── Ventanas ────────────────────────────────────────────────────────────────
-- 72 h para la BAJA. Una Checkout Session vive 24 h (el valor por defecto de
-- Stripe: crear-checkout no fija expires_at) y encima Stripe reintenta el
-- webhook durante unos 3 días. Se peca de generoso a propósito: una baja de más
-- es una fila que nadie lee y que se purga sola; una baja de menos es dinero
-- cobrado sin ningún registro, que es justo lo que venimos a arreglar.
--
-- OJO: la ventana del muro ESPERAR es OTRA, y mucho más corta (30 min, en el
-- cliente). Son dos preguntas distintas: "¿pudo haber dinero?" y "¿le enseño el
-- botón de pagar?". Confundirlas encerraría en "esperando confirmación" a quien
-- abandonó el checkout sin pagar.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hogar_borrar_datos_usuaria(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_u        record;
  v_sesiones integer;
  v_baja     boolean := false;
  v_motivo   text := null;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'falta user_id';
  END IF;

  SELECT pagado, stripe_customer_id, monto_centavos, fecha_compra, checkout_iniciado_en
    INTO v_u
  FROM public.hogar_usuarias
  WHERE id = p_user_id;

  -- La fila mínima. Ahora por DOS motivos:
  --   'pagado'   → como siempre: el webhook ya acreditó.
  --   'checkout' → pagó y el webhook no ha llegado, o está a punto de llegar.
  -- El segundo es el que arregla el cobro huérfano. monto y fecha van NULL —
  -- todavía no se saben— pero stripe_customer_id SÍ está, porque crear-checkout
  -- lo guarda antes de abrir la sesión. Con eso se encuentra el cargo en Stripe,
  -- que es para lo único que existe esta tabla.
  IF FOUND THEN
    IF v_u.pagado IS TRUE THEN
      v_motivo := 'pagado';
    ELSIF v_u.checkout_iniciado_en IS NOT NULL
          AND v_u.checkout_iniciado_en > now() - interval '72 hours' THEN
      v_motivo := 'checkout';
    END IF;
  END IF;

  IF v_motivo IS NOT NULL THEN
    INSERT INTO public.hogar_bajas
      (user_id, stripe_customer_id, monto_centavos, fecha_compra, purgar_despues_de)
    VALUES
      (p_user_id, v_u.stripe_customer_id, v_u.monto_centavos, v_u.fecha_compra,
       coalesce(v_u.fecha_compra, now()) + interval '180 days')
    ON CONFLICT (user_id) DO NOTHING;
    v_baja := true;
  END IF;

  DELETE FROM public.hogar_sesiones WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_sesiones = ROW_COUNT;

  DELETE FROM public.hogar_usuarias WHERE id = p_user_id;

  PERFORM public.hogar_purgar_bajas();

  -- baja_motivo es nuevo y sirve para los logs de borrar-cuenta: distinguir una
  -- baja normal de una por pago en vuelo es lo que permite detectar el problema
  -- si vuelve a pasar.
  RETURN jsonb_build_object('sesiones_borradas', v_sesiones,
                            'baja_registrada', v_baja,
                            'baja_motivo', v_motivo);
END;
$$;

REVOKE ALL ON FUNCTION public.hogar_borrar_datos_usuaria(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hogar_borrar_datos_usuaria(uuid) TO service_role;

-- ── La limpieza ─────────────────────────────────────────────────────────────
-- Sin esto la columna se llenaría de marcas de checkouts abandonados que no
-- significan nada. No es solo higiene: una marca vieja que se quedara ahí haría
-- que la fila MIENTA sobre si hubo dinero en juego.
CREATE OR REPLACE FUNCTION public.hogar_limpiar_checkouts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.hogar_usuarias
     SET checkout_iniciado_en = NULL
   WHERE checkout_iniciado_en IS NOT NULL
     AND checkout_iniciado_en < now() - interval '72 hours';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.hogar_limpiar_checkouts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hogar_limpiar_checkouts() TO service_role;

-- El job diario ya existe: se reprograma para que también barra los checkouts.
SELECT cron.unschedule('hogar-purgar-bajas')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hogar-purgar-bajas');

SELECT cron.schedule(
  'hogar-purgar-bajas',
  '0 3 * * *',
  $$SELECT public.hogar_purgar_bajas(); SELECT public.hogar_limpiar_checkouts();$$
);
```

## Verificar

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='hogar_usuarias' AND column_name='checkout_iniciado_en';
SELECT jobname, schedule, command FROM cron.job WHERE jobname='hogar-purgar-bajas';
SELECT public.hogar_limpiar_checkouts();   -- debe devolver 0
```

Debe salir la columna, **un solo job** (el `unschedule` evita el duplicado) con las
dos llamadas en el comando, y 0 filas limpiadas.

## Antes o después del código: **antes**

Si se corre el SQL y el código no cambia, no pasa nada: la columna se queda en `NULL`,
la rama nueva de la función nunca se toma y todo funciona como hoy. Al revés,
`crear-checkout` intentaría escribir una columna inexistente — y aunque su `update`
está envuelto para no tumbar el pago, dejaría un error en los logs de cada compra.

## Qué NO cubre

La ventana realista de minutos u horas entre pagar y que llegue el webhook. **No**
cubre un webhook caído durante días: si el endpoint estuviera roto cinco días y ella
borrara el sexto, la marca ya habría caducado. La cobertura completa pediría
reconciliar contra Stripe periódicamente, y es otra tarea (ver pendiente 6).


---

# La cancelación — `hogar_cancelar_checkout()`

Añadido el 8 de agosto de 2026, después de que la columna causara un bug en
producción.

## Por qué hizo falta

`checkout_iniciado_en` se escribe al **iniciar** el checkout, así que solo significa
"empezó un pago". El muro la trataba como si significara "pagó": quien abría Stripe y
lo cerraba sin pagar leía **"Recibimos tu pago y lo estamos confirmando"** y, peor,
se le escondía el botón de pagar durante 30 minutos. Un bug que bloqueaba ventas.

El arreglo de fondo fue en el cliente —tres estados en vez de un booleano, ver
`_estadoPago()`—. Esta función resuelve además el caso más común: cuando Stripe la
devuelve por `cancel_url` **sabemos con certeza que no pagó**, así que la marca se
apaga en el acto y en todos sus dispositivos.

## Cómo correrlo

```sql
-- ============================================================================
-- HOGAR — apagar la marca de checkout cuando Stripe devuelve ?pago=cancelado.
-- Idempotente: se puede correr dos veces sin efecto.
-- ============================================================================

-- SIN PARÁMETROS, Y ES LA GARANTÍA ENTERA. La llama el NAVEGADOR, así que si
-- aceptara un user_id cualquiera podría apuntar a la fila de otra. Al no
-- aceptarlo, el único destino posible es auth.uid(): la sesión de quien llama.
-- Tampoco devuelve nada — ni siquiera si encontró fila — para no convertirla en
-- una forma de averiguar qué cuentas existen.
CREATE OR REPLACE FUNCTION public.hogar_cancelar_checkout()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Sin sesión no hay nada que apagar. Se sale en silencio: que alguien llame a
  -- esto sin estar dentro no es un error del que haya que informar.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- SOLO esta columna y SOLO esta fila. Nada de pagado, ni de acceso_manual, ni
  -- de nada que decida si entra o no: esta función existe para desmentir un pago
  -- que no ocurrió, no para tocar el acceso.
  UPDATE public.hogar_usuarias
     SET checkout_iniciado_en = NULL
   WHERE id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.hogar_cancelar_checkout() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hogar_cancelar_checkout() TO authenticated;
```

## Verificar

```sql
SELECT proname, pronargs, prosecdef
  FROM pg_proc WHERE proname = 'hogar_cancelar_checkout';

SELECT has_function_privilege('anon',          'public.hogar_cancelar_checkout()', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.hogar_cancelar_checkout()', 'EXECUTE') AS autenticada;
```

`pronargs = 0`, `prosecdef = t`, `anon = false`, `autenticada = true`. **Si `pronargs`
no es 0, para**: significa que se coló una versión con parámetro, y entonces sí se
podría apuntar a la fila de otra.

## El residuo que se acepta a sabiendas

Esta función permite, en teoría, borrar la marca de un pago **real**: pagar, abrir la
consola del navegador, llamarla, y borrar la cuenta antes de que llegue el webhook.
Esa persona se quedaría sin fila en `hogar_bajas`.

**No se tapa**, y la razón es concreta: **el cargo sigue en Stripe, con
`metadata.user_id` dentro**. `hogar_bajas` no es la prueba del cobro — es un atajo
para encontrarlo. Andrea puede rastrearlo igual, solo que con más trabajo.

Taparlo exigiría que la cancelación pasara por una función de Netlify que preguntara
a Stripe si esa sesión se pagó antes de apagar nada. Es mucho aparato contra un
atacante que necesita saber SQL para perjudicarse a sí mismo. Si algún día hay volumen
y alguien lo intenta, ahí está el camino.
