# SQL — el diario deja de ser legible por Andrea

Saca la columna `answers` de `hogar_sesiones` y la lleva a su propia tabla, donde
la única policy es la de su dueña.

**Por qué.** El aviso de privacidad dice que lo que la clienta escribe en sus
cuestionarios es solo suyo. Hoy la interfaz se comporta así —el panel nunca pide
`answers`— pero el permiso no: RLS filtra **filas**, no columnas, y la policy
`andrea_ve_sesiones` le da la fila entera. Está a un cambio de interfaz de
distancia de dejar de ser verdad, sin que nadie lo decida.

Se descartaron dos alternativas: los `GRANT` por columna (Andrea y las clientas
comparten el rol `authenticated`, así que revocar la columna se la quita también
a su dueña) y una vista con derechos de propietario (salta RLS: si alguien toca
mal su `WHERE`, expone los diarios de todas). Separar la tabla es la única
opción en la que **no queda nada que custodiar**: si la columna no está en la
tabla que Andrea lee, ningún cambio futuro puede filtrarla.

---

> ## ⚠️ TRES FASES, EN ESTE ORDEN
>
> | | qué | quién |
> |---|---|---|
> | **A** | SQL: tabla nueva, policies, migración y RPC | Magaly, ahora |
> | **B** | Desplegar el código | después de verificar A |
> | **C** | SQL: resincronizar y borrar la columna | **solo con B funcionando** |
>
> **La fase C no puede adelantarse.** Si `answers` desaparece antes de desplegar
> el código, el `insert` que todavía la menciona falla y ninguna práctica se
> guarda. Entre A y B el código viejo sigue escribiendo en la columna vieja: por
> eso C empieza resincronizando.
>
> **Hay datos reales en `hogar_sesiones`.** La fase A no borra nada — solo copia.
> Lo único destructivo es el `DROP COLUMN` de la fase C, y va después de una
> verificación que debe cuadrar exactamente.

---

# FASE A — preparar (no rompe nada)

Supabase → proyecto **Base de datos Stryv** → **SQL Editor**.

## A1 · La tabla

```sql
-- ============================================================================
-- HOGAR — las reflexiones escritas, en su propia tabla.
--
-- session_id es a la vez CLAVE PRIMARIA y foránea: una reflexión por práctica,
-- ni más ni menos, y al borrar la práctica se va con ella (ON DELETE CASCADE).
--
-- user_id se repite aquí a propósito, en vez de deducirlo por el join. La policy
-- de abajo lo compara contra auth.uid() sin tocar hogar_sesiones: menos piezas
-- en el camino y ninguna dependencia de las policies de la otra tabla.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hogar_sesiones_respuestas (
  session_id uuid PRIMARY KEY REFERENCES public.hogar_sesiones(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  answers    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hogar_sesiones_respuestas_user_idx
  ON public.hogar_sesiones_respuestas (user_id);

ALTER TABLE public.hogar_sesiones_respuestas ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.hogar_sesiones_respuestas IS
  'Diario íntimo de cada clienta. NO añadir aquí ninguna policy para Andrea: el aviso de privacidad promete que solo su dueña puede leerlo.';
```

## A2 · La policy — una sola, y de lectura

```sql
-- ============================================================================
-- UNA policy y ninguna más. En particular NO hay policy para Andrea: ese es el
-- objetivo entero de esta migración, no un olvido.
--
-- Tampoco hace falta una de INSERT: escribe la función de la fase A4, que es
-- SECURITY DEFINER y no pasa por RLS. Y tampoco una de DELETE: al borrar la
-- práctica, el ON DELETE CASCADE se lleva la reflexión sin consultar policies.
-- ============================================================================

CREATE POLICY usuaria_ve_sus_respuestas
  ON public.hogar_sesiones_respuestas
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
```

## A3 · Migrar lo que ya existe

```sql
-- ON CONFLICT DO NOTHING lo hace REEJECUTABLE: la fase C lo vuelve a correr para
-- recoger lo que se escribiera entre medias, y no duplica nada.
-- Se descarta el jsonb 'null' literal además del NULL de SQL: son cosas
-- distintas y las dos significan "no escribió nada".

INSERT INTO public.hogar_sesiones_respuestas (session_id, user_id, answers, created_at)
SELECT id, user_id, answers, created_at
FROM public.hogar_sesiones
WHERE answers IS NOT NULL AND answers::text <> 'null'
ON CONFLICT (session_id) DO NOTHING;
```

## A4 · La función de guardado

```sql
-- ============================================================================
-- Guarda la práctica y su reflexión EN UNA SOLA TRANSACCIÓN. Si algo falla, no
-- queda ni media: nadie escribe su reflexión para que se pierda a mitad.
--
-- SECURITY DEFINER porque tiene que escribir en una tabla sin policy de INSERT.
-- Lo que la hace segura es que el user_id sale de auth.uid() y NUNCA de un
-- parámetro: no se puede usar para escribir en nombre de otra persona.
--
-- SET search_path = public es obligatorio en una función definer: sin él, quien
-- llama podría anteponer un esquema suyo y secuestrar los nombres de tabla.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hogar_guardar_sesion(
  p_emo      integer,
  p_emo_name text,
  p_practica text,
  p_ritmo    text,
  p_path     text,
  p_answers  jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id  uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'sin sesión activa';
  END IF;

  INSERT INTO public.hogar_sesiones (user_id, emo, emo_name, practica, ritmo, path)
  VALUES (v_uid, p_emo, p_emo_name, p_practica, p_ritmo, p_path)
  RETURNING id INTO v_id;

  IF p_answers IS NOT NULL AND p_answers::text <> 'null' THEN
    INSERT INTO public.hogar_sesiones_respuestas (session_id, user_id, answers)
    VALUES (v_id, v_uid, p_answers);
  END IF;

  RETURN v_id;
END;
$$;

-- Solo las clientas con sesión. Ni anónimos ni el resto del mundo.
REVOKE ALL ON FUNCTION public.hogar_guardar_sesion(integer,text,text,text,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hogar_guardar_sesion(integer,text,text,text,text,jsonb) TO authenticated;
```

## A5 · Verificar la fase A

```sql
-- 1) Los números tienen que CUADRAR EXACTAMENTE
SELECT
  (SELECT count(*) FROM public.hogar_sesiones
     WHERE answers IS NOT NULL AND answers::text <> 'null') AS con_reflexion,
  (SELECT count(*) FROM public.hogar_sesiones_respuestas)   AS migradas;

-- 2) Una sola policy, de SELECT, y ninguna que nombre a Andrea
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname='public' AND tablename='hogar_sesiones_respuestas';

-- 3) La función existe y es definer
SELECT proname, prosecdef FROM pg_proc
WHERE proname='hogar_guardar_sesion';

-- 4) Ningún contenido se perdió por el camino
SELECT count(*) FROM public.hogar_sesiones s
JOIN public.hogar_sesiones_respuestas r ON r.session_id = s.id
WHERE s.answers::text IS DISTINCT FROM r.answers::text;
```

Lo que debe salir: **(1)** los dos números **iguales** · **(2)** una sola fila,
`usuaria_ve_sus_respuestas`, `SELECT`, `{authenticated}` · **(3)**
`prosecdef = true` · **(4)** `0`.

**Si (1) no cuadra o (4) no da 0, PARA.** No sigas a la fase B.

---

# FASE B — desplegar el código

Solo después de que la fase A verifique. Al terminar, comprueba en la app:

- Hacer una práctica entera y que aparezca en el historial **con su reflexión**
- Que el panel de Andrea siga listando usuarias y su actividad

---

# FASE C — cerrar (destructiva)

**Solo con la fase B desplegada y comprobada.**

## C1 · Resincronizar

```sql
-- Recoge lo que el código viejo escribiera entre la fase A y el despliegue.
INSERT INTO public.hogar_sesiones_respuestas (session_id, user_id, answers, created_at)
SELECT id, user_id, answers, created_at
FROM public.hogar_sesiones
WHERE answers IS NOT NULL AND answers::text <> 'null'
ON CONFLICT (session_id) DO NOTHING;
```

## C2 · Verificar otra vez, antes de borrar

```sql
SELECT
  (SELECT count(*) FROM public.hogar_sesiones
     WHERE answers IS NOT NULL AND answers::text <> 'null') AS aun_en_la_vieja,
  (SELECT count(*) FROM public.hogar_sesiones_respuestas)   AS en_la_nueva;
```

Los dos números **iguales**. Si no lo son, algo quedó sin copiar: **no borres**.

## C3 · Borrar la columna

```sql
ALTER TABLE public.hogar_sesiones DROP COLUMN answers;
```

Desde aquí, `andrea_ve_sesiones` puede seguir dando la fila entera: ya no hay
nada íntimo dentro.

## C4 · Comprobación final

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='hogar_sesiones'
ORDER BY ordinal_position;
```

`answers` **no** debe aparecer.

---

## Volver atrás

**Fases A y B** son reversibles sin pérdida: la columna vieja sigue ahí con todo
dentro. Basta con revertir el código.

**Después de C3** la columna ya no existe, pero el contenido sigue completo en la
tabla nueva:

```sql
ALTER TABLE public.hogar_sesiones ADD COLUMN answers jsonb;

UPDATE public.hogar_sesiones s
SET answers = r.answers
FROM public.hogar_sesiones_respuestas r
WHERE r.session_id = s.id;
```

Y después revertir el código. **No se pierde ninguna reflexión en ningún punto
del camino**, pero el orden importa: revertir el código con la columna todavía
borrada deja el guardado roto.

## Pendiente aparte

Tres de las cuatro policies de `hogar_sesiones` están aplicadas al rol `public` en
vez de `authenticated` (`usuaria_borra_sus_sesiones` ya está bien). Sus
expresiones las cierran igual —`auth.uid()` es `NULL` sin sesión—, pero deja al
rol `anon` dentro del alcance sin motivo. Va en su propio commit, después de
esta migración.
