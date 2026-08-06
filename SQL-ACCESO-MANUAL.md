# SQL — acceso manual (red de seguridad del sistema de pagos)

Prepara la base para que Andrea pueda **conceder y revocar el acceso a mano**
desde su panel, sin que nadie tenga que entrar a Supabase.

**El caso que lo motivó, ocurrido el 6 de agosto de 2026:** el evento
`checkout.session.completed` se perdió —Stripe no encola eventos cuando el
endpoint está deshabilitado—, la clienta quedó con `stripe_customer_id` puesto y
`pagado = false`, y hubo que correr SQL a mano para desbloquearla.

> ## ⚠️ ESTE SQL VA ANTES QUE EL CÓDIGO
>
> El panel pasará a pedir las columnas nuevas en su `select`. Si el código se
> despliega primero, PostgREST responde error a una columna que no existe y **el
> listado de usuarias deja de cargar entero**, no solo la parte nueva.
>
> Orden: **1)** este SQL · **2)** verificar · **3)** desplegar el código.

---

## Paso 1 — Columnas en `hogar_usuarias`

Supabase → proyecto **Base de datos Stryv** → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — acceso concedido a mano.
--
-- Cuatro columnas que conviven con las que ya escribe el webhook de Stripe
-- (pagado, fecha_compra, monto_centavos). `pagado` sigue siendo LA fuente de
-- verdad del acceso: estas columnas solo dicen CÓMO llegó a ser true.
--
-- `acceso_manual` con NOT NULL DEFAULT false para que las filas que ya existen
-- queden en false sin tocar nada, y para que el panel nunca tenga que distinguir
-- entre false y null.
-- ============================================================================

ALTER TABLE public.hogar_usuarias
  ADD COLUMN IF NOT EXISTS acceso_manual      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acceso_manual_en   timestamptz,
  ADD COLUMN IF NOT EXISTS acceso_manual_por  text,
  ADD COLUMN IF NOT EXISTS acceso_manual_nota text;

COMMENT ON COLUMN public.hogar_usuarias.acceso_manual IS
  'true = el acceso lo concedió Andrea a mano, no un cobro de Stripe. El webhook lo pone en false si el cobro real acaba llegando.';
```

## Paso 2 — Tabla de registro

```sql
-- ============================================================================
-- HOGAR — bitácora de concesiones y revocaciones manuales.
--
-- Es APPEND-ONLY y existe por una razón concreta: las cuatro columnas de arriba
-- guardan el ESTADO ACTUAL, así que una revocación machacaría los datos de la
-- concesión que la precedió. Justo lo que se quería poder auditar.
--
-- Aquí queda la secuencia completa: conceder → revocar → conceder, cada una con
-- su fecha, su motivo y quién la hizo.
--
-- `tipo` separa la venta real del regalo:
--   venta    → la clienta pagó de verdad y el webhook se perdió. CUENTA como
--              ingreso, y por eso lleva monto_centavos.
--   cortesia → Andrea regala el acceso. NO cuenta como ingreso.
-- Sin esa distinción, o se inflan las ventas con regalos, o se ocultan cobros
-- reales que sí entraron en la cuenta de Andrea.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hogar_acceso_manual_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.hogar_usuarias(id) ON DELETE CASCADE,
  accion         text NOT NULL CHECK (accion IN ('conceder','revocar')),
  tipo           text          CHECK (tipo   IN ('venta','cortesia')),
  monto_centavos integer       CHECK (monto_centavos IS NULL OR monto_centavos >= 0),
  por            text NOT NULL,
  nota           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hogar_acceso_manual_log_user_idx
  ON public.hogar_acceso_manual_log (user_id, created_at DESC);

ALTER TABLE public.hogar_acceso_manual_log ENABLE ROW LEVEL SECURITY;
```

## Paso 3 — Policy de lectura

Solo Andrea lee la bitácora. **Quien escribe es la función de Netlify con
`service_role`, que salta RLS**: no hace falta ninguna policy de INSERT, y no
ponerla es lo correcto — nadie más debe poder escribir aquí.

El SQL de abajo copia el UUID de la policy que ya existe en `hogar_usuarias`, así
que no hay que teclearlo ni buscarlo:

```sql
DO $$
DECLARE cond text;
BEGIN
  SELECT qual INTO cond
  FROM pg_policies
  WHERE schemaname='public' AND tablename='hogar_usuarias' AND policyname='andrea_ve_todo';

  IF cond IS NULL THEN
    RAISE EXCEPTION 'No existe andrea_ve_todo en hogar_usuarias: revisa antes de seguir';
  END IF;

  EXECUTE format(
    'CREATE POLICY hogar_acceso_manual_log_andrea_lee ON public.hogar_acceso_manual_log '
    'FOR SELECT TO authenticated USING (%s)', cond);
END $$;
```

Va `TO authenticated` y no `{public}`. `anon` no tiene ningún motivo para leer
esto, y así queda dicho de forma explícita. (La `andrea_ve_todo` de
`hogar_usuarias` está en `{public}`, pero su `USING` la cierra igual: `auth.uid()`
es `NULL` sin sesión y `NULL = uuid` se evalúa como falso. Es diferencia de
estilo, no de permiso.)

---

## Verificación

```sql
-- 1) Las cuatro columnas nuevas
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='hogar_usuarias'
  AND column_name LIKE 'acceso_manual%'
ORDER BY column_name;

-- 2) La tabla y su RLS
SELECT relname, relrowsecurity
FROM pg_class WHERE relname='hogar_acceso_manual_log';

-- 3) Las policies: una sola, de SELECT
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname='public' AND tablename='hogar_acceso_manual_log';

-- 4) Nadie quedó marcado como manual por accidente
SELECT count(*) FROM public.hogar_usuarias WHERE acceso_manual = true;
```

Lo que debe salir:

1. **Cuatro filas**: `acceso_manual` (`boolean`, `NO`, `false`), y las otras tres
   nullable.
2. **`relrowsecurity = true`**.
3. **Una fila**: `hogar_acceso_manual_log_andrea_lee`, `SELECT`,
   `{authenticated}`, con el mismo `qual` que `andrea_ve_todo`.
4. **`0`**.

Si el punto 4 no da `0`, algo se ejecutó dos veces o con datos: revísalo antes de
desplegar el código.

## Volver atrás

Nada de esto rompe lo que ya funciona —las columnas son aditivas y la tabla es
nueva—, pero si hiciera falta deshacerlo:

```sql
DROP TABLE IF EXISTS public.hogar_acceso_manual_log;
ALTER TABLE public.hogar_usuarias
  DROP COLUMN IF EXISTS acceso_manual,
  DROP COLUMN IF EXISTS acceso_manual_en,
  DROP COLUMN IF EXISTS acceso_manual_por,
  DROP COLUMN IF EXISTS acceso_manual_nota;
```

**Ojo:** revertir con el código ya desplegado deja el panel pidiendo columnas que
no existen, y el listado de usuarias dejaría de cargar. Si hay que revertir, se
revierte el código primero.
