# SQL — borrar la cuenta (opción C)

Prepara la base para que una clienta pueda **borrar su cuenta de verdad** desde su
perfil, con una sola excepción declarada: un registro mínimo de la compra, sin
nombre ni correo, mientras dure la ventana de reclamación bancaria.

**Por qué.** Los términos prometen *"puedes pedirnos que los borremos por
completo… y lo hacemos"*, y no existe ninguna función que lo haga. Es la misma
clase de promesa incumplida que el *"nadie más que tú lo ve"* del aviso de
privacidad.

**Lo que no se puede dar por hecho.** Ni `hogar_usuarias` ni `hogar_sesiones`
tienen clave foránea a `auth.users` (verificado el 6 de agosto de 2026), así que
**borrar la cuenta de Auth no arrastra nada**. Hay que borrar en orden, y por eso
existe la función del paso 4.

---

> ## ⚠️ ORDEN
>
> | | qué | dónde |
> |---|---|---|
> | **1** | Activar la extensión `pg_cron` | panel de Supabase |
> | **2** | Tabla `hogar_bajas` | SQL Editor |
> | **3** | Función de purga | SQL Editor |
> | **4** | Función de borrado | SQL Editor |
> | **5** | Programar el job diario | SQL Editor |
> | **6** | Verificar | SQL Editor |
>
> Este SQL **no borra nada por sí solo** y no toca ninguna fila existente. Solo
> crea la tabla y las dos funciones. El código viene después.

---

## Paso 1 — Activar `pg_cron`

**No viene activado.** En el panel de Supabase:

**Database → Extensions →** buscar `pg_cron` → activarlo.

Crea el esquema `cron`. Solo el rol `postgres` puede programar trabajos, que es
con el que corre el SQL Editor.

Si no aparece o no se deja activar, **para aquí y avísame**: el paso 5 no
funcionará y habría que decidir entre la purga perezosa sola o otra vía.

## Paso 2 — La tabla de bajas

```sql
-- ============================================================================
-- HOGAR — registro mínimo de una cuenta borrada.
--
-- SOLO se crea una fila si la clienta HABÍA PAGADO. Quien nunca compró se borra
-- sin dejar rastro ninguno: la excepción existe únicamente donde hay una razón
-- concreta, y eso la hace defendible.
--
-- NO lleva nombre ni correo. Lleva lo justo para responder a un banco que reclama
-- un cargo: a quién correspondía el pago (user_id, que es como el webhook de una
-- disputa resuelve), su cliente en Stripe, el importe y la fecha.
--
-- purgar_despues_de se calcula AL BORRAR y se guarda: así la regla queda
-- congelada en la fila y la purga es un WHERE simple sobre una columna indexada,
-- sin recalcular intervalos ni depender de que nadie cambie el plazo después.
-- Se usa coalesce(fecha_compra, now()) porque un acceso de cortesía no tiene
-- fecha de compra, y sin eso su fila no caducaría nunca.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hogar_bajas (
  user_id            uuid PRIMARY KEY,
  stripe_customer_id text,
  monto_centavos     integer,
  fecha_compra       timestamptz,
  borrada_en         timestamptz NOT NULL DEFAULT now(),
  purgar_despues_de  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS hogar_bajas_purga_idx
  ON public.hogar_bajas (purgar_despues_de);

ALTER TABLE public.hogar_bajas ENABLE ROW LEVEL SECURITY;

-- SIN NINGUNA POLICY, a propósito: nadie llega a esta tabla por la API, ni
-- Andrea. Solo la tocan las funciones de abajo, que corren con service_role y no
-- pasan por RLS. Si algún día Andrea necesita ver sus bajas, se añade entonces
-- una policy de SELECT y se decide qué columnas.

COMMENT ON TABLE public.hogar_bajas IS
  'Registro mínimo de cuentas borradas, sin nombre ni correo. Existe solo para poder responder a un contracargo. Se purga a los 180 días (ver hogar_purgar_bajas).';
```

## Paso 3 — La purga

```sql
-- ============================================================================
-- Borra las bajas cuyo plazo venció. La llama el job diario del paso 5 y, como
-- respaldo, la propia función de borrado del paso 4.
--
-- Devuelve cuántas borró, para que el job deje rastro en cron.job_run_details.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hogar_purgar_bajas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.hogar_bajas WHERE purgar_despues_de < now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.hogar_purgar_bajas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hogar_purgar_bajas() TO service_role;
```

## Paso 4 — El borrado

```sql
-- ============================================================================
-- Borra TODOS los datos de una clienta EN UNA SOLA TRANSACCIÓN: o se va todo, o
-- no se va nada. Sin esto habría que encadenar borrados desde el cliente y un
-- fallo a mitad dejaría datos sueltos sin dueña.
--
-- El orden interno lo imponen las cascadas:
--   hogar_sesiones            → arrastra hogar_sesiones_respuestas (el diario)
--   hogar_usuarias            → arrastra hogar_acceso_manual_log
--
-- NO borra auth.users: eso no se puede desde SQL y lo hace la función de Netlify
-- con la service role, DESPUÉS de esta. El orden importa — ver el comentario de
-- la función de Netlify: dejando Auth para el final, un fallo intermedio deja a
-- la clienta con sesión y puede reintentar.
--
-- p_user_id ES un parámetro, al revés que en hogar_guardar_sesion. Aquí no puede
-- salir de auth.uid() porque quien llama es la service role, que no tiene JWT de
-- usuaria. Por eso el GRANT de abajo es SOLO para service_role: si `authenticated`
-- pudiera ejecutarla, cualquiera borraría la cuenta de cualquiera pasando su id.
-- ============================================================================

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
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'falta user_id';
  END IF;

  SELECT pagado, stripe_customer_id, monto_centavos, fecha_compra
    INTO v_u
  FROM public.hogar_usuarias
  WHERE id = p_user_id;

  -- La fila mínima, solo si pagó. Va ANTES de los borrados y dentro de la misma
  -- transacción: si algo falla después, no queda ni la baja ni el borrado.
  IF FOUND AND v_u.pagado IS TRUE THEN
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

  -- Respaldo de la purga: si el job diario fallara, cada borrado limpia lo
  -- caducado. No sustituye al job — si nadie borra su cuenta, nada se purga.
  PERFORM public.hogar_purgar_bajas();

  RETURN jsonb_build_object('sesiones_borradas', v_sesiones, 'baja_registrada', v_baja);
END;
$$;

REVOKE ALL ON FUNCTION public.hogar_borrar_datos_usuaria(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hogar_borrar_datos_usuaria(uuid) TO service_role;
```

## Paso 5 — El job diario

```sql
-- A las 03:00 UTC. Si ya existiera un job con ese nombre, se desprograma primero
-- para que este SQL se pueda volver a correr sin duplicarlo.
SELECT cron.unschedule('hogar-purgar-bajas')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hogar-purgar-bajas');

SELECT cron.schedule(
  'hogar-purgar-bajas',
  '0 3 * * *',
  $$SELECT public.hogar_purgar_bajas();$$
);
```

## Paso 6 — Verificar

```sql
-- 1) La tabla existe, con RLS y SIN policies
SELECT c.relrowsecurity AS rls_activa,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname='public' AND tablename='hogar_bajas') AS policies
FROM pg_class c WHERE c.relname='hogar_bajas';

-- 2) Las dos funciones son definer
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN ('hogar_borrar_datos_usuaria','hogar_purgar_bajas')
ORDER BY proname;

-- 3) NADIE salvo service_role puede ejecutar el borrado
SELECT p.proname, r.rolname
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(p.proacl) a
JOIN pg_roles r ON r.oid = a.grantee
WHERE p.proname='hogar_borrar_datos_usuaria' AND a.privilege_type='EXECUTE';

-- 4) El job está programado
SELECT jobname, schedule, active FROM cron.job WHERE jobname='hogar-purgar-bajas';

-- 5) Nadie se ha borrado por accidente
SELECT count(*) FROM public.hogar_bajas;
```

Lo que debe salir:

1. `rls_activa = true`, `policies = 0`.
2. Dos filas, las dos con `prosecdef = true`.
3. **Una sola fila: `service_role`.** Si aparece `authenticated` o `public`,
   **para**: cualquiera podría borrar la cuenta de cualquiera.
4. Una fila, `0 3 * * *`, `active = true`.
5. `0`.

## Volver atrás

Nada de esto altera datos existentes, así que deshacerlo es limpio:

```sql
SELECT cron.unschedule('hogar-purgar-bajas');
DROP FUNCTION IF EXISTS public.hogar_borrar_datos_usuaria(uuid);
DROP FUNCTION IF EXISTS public.hogar_purgar_bajas();
DROP TABLE IF EXISTS public.hogar_bajas;
```

**Con el código ya desplegado**, revertir el SQL deja el botón de borrar cuenta
dando error. Se revierte el código primero.

## Efecto secundario a tener presente

El dinero del mes del panel sale de `hogar_usuarias`. Si alguien compra y borra su
cuenta el mismo mes, **su venta desaparece de esa métrica**, aunque el cobro siga
en Stripe y en `hogar_bajas`. No se corrige aquí: hacerlo obligaría a sumar dos
tablas en esa consulta. Queda anotado por si algún día los números no cuadran.
