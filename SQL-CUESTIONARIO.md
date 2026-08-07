# SQL — el cuestionario, editable desde el panel

Hoy `QUEST_TREE` vive en `index.html` y solo se cambia en un despliegue. Esto lo
mueve a `hogar_cuestionario` para que Andrea edite los textos desde **Cuestionario**,
sin tocar código.

El paso previo ya está hecho: desde agosto de 2026 las preguntas **se congelan al
guardar la reflexión**, así que editar el árbol ya no reescribe el historial de nadie.
Sin eso, este editor habría sido peligroso.

## No hay siembra, y es deliberado

La tabla nace **vacía**. Sin filas, la app usa el `QUEST_TREE` del código, que es
exactamente lo que se ve hoy: correr este SQL **no cambia nada**. La primera vez que
Andrea guarde una práctica se crea su fila.

Lo alternativo era volcar los cinco árboles en un `INSERT` de unos 18 KB de JSON. Se
descartó porque crea una copia que puede desviarse del código sin que nadie se entere,
y porque el respaldo tiene que existir igualmente. Así solo hay una fuente inicial.

## La validación vive aquí, no en el navegador

**No hay ninguna policy de escritura sobre la tabla.** La única forma de escribir es
`hogar_guardar_cuestionario`, que valida y aborta entero si algo no cuadra. No existe
un camino por el que entre un árbol roto: ni desde la consola del navegador, ni desde
un panel con un bug.

Lo que comprueba:

| Regla | Por qué |
|---|---|
| Quien llama es Andrea | Es su cuestionario |
| Las cinco claves `p1`…`p5` | El motor las espera todas |
| `p1` con **exactamente cuatro** opciones | La forma no se toca desde el editor |
| Los `id` de `p1` son `A,B,C,D` **en ese orden** | Reordenarlos cambiaría respuestas ya guardadas (ver pendiente 7) |
| `p2` y `p3` con sus cuatro ramas, cada una con pregunta y cuatro opciones | Si falta una rama, el cuestionario se corta a medias |
| `p4` con `ABC` y `D`, y `D` con cuatro opciones | Son dos formas distintas del mismo paso |
| Ningún texto vacío en ninguno | Una pregunta en blanco es una pantalla rota |

## Cómo correrlo

Supabase → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — el cuestionario, editable desde el panel.
-- Idempotente: se puede correr dos veces sin efecto.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hogar_cuestionario (
  emo        int PRIMARY KEY CHECK (emo BETWEEN 0 AND 4),
  arbol      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hogar_cuestionario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hogar_cuestionario_leer ON public.hogar_cuestionario;
CREATE POLICY hogar_cuestionario_leer
  ON public.hogar_cuestionario FOR SELECT TO anon, authenticated USING (true);

GRANT SELECT ON public.hogar_cuestionario TO anon, authenticated;

-- NO HAY POLICY DE ESCRITURA, Y ES EL PUNTO ENTERO.
CREATE OR REPLACE FUNCTION public.hogar_guardar_cuestionario(p_emo int, p_arbol jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email text := auth.jwt() ->> 'email';
  v_ids   text[] := ARRAY['A','B','C','D'];
  v_paso  text;
  v_rama  text;
  v_nodo  jsonb;
  v_op    jsonb;
  i       int;
BEGIN
  IF v_email IS DISTINCT FROM 'andrealaso1997@hotmail.com' THEN
    RAISE EXCEPTION 'Sin permiso para editar el cuestionario.';
  END IF;
  IF p_emo IS NULL OR p_emo < 0 OR p_emo > 4 THEN
    RAISE EXCEPTION 'Emoción fuera de rango (0 a 4).';
  END IF;
  IF p_arbol IS NULL OR jsonb_typeof(p_arbol) <> 'object' THEN
    RAISE EXCEPTION 'El árbol no llegó como un objeto.';
  END IF;

  FOREACH v_paso IN ARRAY ARRAY['p1','p2','p3','p4','p5'] LOOP
    IF NOT (p_arbol ? v_paso) THEN
      RAISE EXCEPTION 'Falta el paso % del cuestionario.', v_paso;
    END IF;
  END LOOP;

  IF coalesce(btrim(p_arbol->'p1'->>'pregunta'), '') = '' THEN
    RAISE EXCEPTION 'La pregunta del paso 1 no puede quedar vacía.';
  END IF;
  IF jsonb_typeof(p_arbol->'p1'->'opciones') <> 'array'
     OR jsonb_array_length(p_arbol->'p1'->'opciones') <> 4 THEN
    RAISE EXCEPTION 'El paso 1 tiene que tener exactamente cuatro opciones.';
  END IF;
  FOR i IN 0..3 LOOP
    v_op := p_arbol->'p1'->'opciones'->i;
    IF (v_op->>'id') IS DISTINCT FROM v_ids[i+1] THEN
      RAISE EXCEPTION 'Los identificadores del paso 1 tienen que ser A, B, C y D en ese orden. Reordenarlos cambiaría respuestas ya guardadas.';
    END IF;
    IF coalesce(btrim(v_op->>'titulo'), '') = '' OR coalesce(btrim(v_op->>'desc'), '') = '' THEN
      RAISE EXCEPTION 'La opción % del paso 1 tiene algún texto vacío.', v_ids[i+1];
    END IF;
  END LOOP;

  FOREACH v_paso IN ARRAY ARRAY['p2','p3'] LOOP
    FOREACH v_rama IN ARRAY v_ids LOOP
      v_nodo := p_arbol->v_paso->v_rama;
      IF v_nodo IS NULL OR jsonb_typeof(v_nodo) <> 'object' THEN
        RAISE EXCEPTION 'Falta la rama % del paso %.', v_rama, v_paso;
      END IF;
      IF coalesce(btrim(v_nodo->>'pregunta'), '') = '' THEN
        RAISE EXCEPTION 'La pregunta de la rama % del paso % está vacía.', v_rama, v_paso;
      END IF;
      IF jsonb_typeof(v_nodo->'opciones') <> 'array'
         OR jsonb_array_length(v_nodo->'opciones') <> 4 THEN
        RAISE EXCEPTION 'La rama % del paso % tiene que tener cuatro opciones.', v_rama, v_paso;
      END IF;
      FOR i IN 0..3 LOOP
        IF coalesce(btrim(v_nodo->'opciones'->i->>'titulo'), '') = '' THEN
          RAISE EXCEPTION 'Hay una opción vacía en la rama % del paso %.', v_rama, v_paso;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  FOREACH v_rama IN ARRAY ARRAY['ABC','D'] LOOP
    IF coalesce(btrim(p_arbol->'p4'->v_rama->>'pregunta'), '') = '' THEN
      RAISE EXCEPTION 'La pregunta del paso 4 (%) está vacía.', v_rama;
    END IF;
  END LOOP;
  IF jsonb_typeof(p_arbol->'p4'->'D'->'opciones') <> 'array'
     OR jsonb_array_length(p_arbol->'p4'->'D'->'opciones') <> 4 THEN
    RAISE EXCEPTION 'El paso 4 del camino D tiene que tener cuatro opciones.';
  END IF;
  FOR i IN 0..3 LOOP
    IF coalesce(btrim(p_arbol->'p4'->'D'->'opciones'->i->>'titulo'), '') = '' THEN
      RAISE EXCEPTION 'Hay una opción vacía en el paso 4 del camino D.';
    END IF;
  END LOOP;

  FOREACH v_rama IN ARRAY v_ids LOOP
    IF coalesce(btrim(p_arbol->'p5'->>v_rama), '') = '' THEN
      RAISE EXCEPTION 'Falta el texto de cierre de la rama %.', v_rama;
    END IF;
  END LOOP;

  INSERT INTO public.hogar_cuestionario (emo, arbol, updated_at)
  VALUES (p_emo, p_arbol, now())
  ON CONFLICT (emo) DO UPDATE SET arbol = EXCLUDED.arbol, updated_at = now();
END;
$fn$;

REVOKE ALL ON FUNCTION public.hogar_guardar_cuestionario(int, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hogar_guardar_cuestionario(int, jsonb) TO authenticated;
```

## Antes o después del código: **antes**

Con las dos órdenes el sitio funciona, porque `QUEST_TREE` sigue en el código como
respaldo. Pero al revés el cargador consultaría una tabla inexistente y dejaría un
error en consola en cada arranque.

## Verificar

```sql
SELECT count(*) AS filas FROM public.hogar_cuestionario;
SELECT proname, prosecdef FROM pg_proc WHERE proname = 'hogar_guardar_cuestionario';
SELECT polname, polcmd FROM pg_policy
 WHERE polrelid = 'public.hogar_cuestionario'::regclass;
```

Debe dar **0 filas** (correcto: no hay siembra), la función con `prosecdef = t`, y
**una sola policy**, de tipo `r` (SELECT). Si aparece alguna de escritura, algo se
coló: no debe haberla.

En la app, como Andrea: panel → **Cuestionario**. Cambia un texto de una práctica,
guarda, y haz esa práctica: la pregunta nueva debe salir. Abre después una reflexión
vieja del historial: **no** debe haber cambiado.

## El paso 5

El árbol trae una clave `p5` con cuatro textos de cierre que **nadie lee** hoy (ver
pendiente 8 en `PENDIENTES.md`). El validador exige las cinco claves y el editor las
devuelve intactas, así que no se pierden — pero `p5` **no tiene campos en pantalla**:
sería un control muerto, que Andrea escribiera textos que ninguna usuaria ve.

## Si algo sale mal

El respaldo del código no se quita nunca. Si esta tabla se borra, si la consulta falla
o si una fila queda mal, `arbolCuestionario()` cae a `QUEST_TREE` y el cuestionario
funciona igual. La usuaria no se entera.
