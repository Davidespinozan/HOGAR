# SQL — sembrar `hogar_notas` con las notas de Andrea

La tabla `public.hogar_notas` ya existe pero está **vacía**. Este SQL mete las 10
frases que hoy viven en el código (la constante `PH` de `index.html`), copiadas tal
cual, con `orden` 1–10 y `activa = true`.

Mientras la tabla esté vacía **no se rompe nada**: la app detecta que no hay notas y
usa las del código. Correr esto es lo que le da a Andrea el control para editarlas
desde el panel.

## Cómo correrlo

Supabase → proyecto **Base de datos Stryv** → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — notas de Andrea ("nota del día" del dashboard).
-- Las 10 frases actuales, copiadas EXACTAMENTE de la constante PH.
-- Idempotente: si ya hay notas, no duplica (ver el WHERE NOT EXISTS del final).
-- ============================================================================

INSERT INTO public.hogar_notas (orden, texto, activa)
SELECT v.orden, v.texto, true
FROM (VALUES
  (1, 'Lo que hiciste hoy por tu cuerpo, tu cuerpo lo recuerda.'),
  (2, 'No necesitas haber hecho todo bien. Solo necesitabas estar.'),
  (3, 'El movimiento no se mide. Se habita.'),
  (4, 'Hoy elegiste presencia. Eso es suficiente.'),
  (5, 'Tu cuerpo no necesita que lo corrijas. Solo que lo escuches.'),
  (6, 'La calma también se entrena.'),
  (7, 'No hay forma incorrecta de volver a ti.'),
  (8, 'Cada vez que vuelves, el camino es más corto.'),
  (9, 'Hoy te diste espacio. Eso ya es fuerza.'),
  (10, 'La constancia no es no fallar. Es volver.')
) AS v(orden, texto)
WHERE NOT EXISTS (SELECT 1 FROM public.hogar_notas);
```

El `WHERE NOT EXISTS` hace que sea seguro correrlo dos veces: si la tabla ya tiene
algo, no inserta nada. Si alguna vez quieres re-sembrar desde cero, primero vacía la
tabla a propósito con `DELETE FROM public.hogar_notas;` y vuelve a correrlo.

## Verificar

```sql
SELECT orden, activa, texto FROM public.hogar_notas ORDER BY orden;
```

Deben salir 10 filas, todas `activa = true`, en orden 1–10.

Y en la app:

1. Recarga HOGAR y entra como cualquier usuaria. En la consola del navegador debe
   verse `[HOGAR notas] 10 notas cargadas desde Supabase ✓`.
2. La nota del dashboard debe seguir viéndose igual que antes (son las mismas frases).
3. Como Andrea: panel → **Contenido** → bloque **TUS NOTAS**: ahí están las 10, se
   pueden editar, activar/desactivar y agregar nuevas.

## Cómo funciona la red de seguridad

Las frases **siguen en el código** (`PH`) a propósito. Al iniciar sesión la app carga
las notas activas de Supabase una sola vez a memoria; si esa consulta falla, devuelve
vacío o todavía no terminó, se usan las del código. La usuaria nunca ve un hueco ni un
error: en el peor caso ve las frases originales.

Por eso `PH` no se borra aunque la tabla esté sembrada. Si algún día editas las notas
en el panel y quieres que el fallback también refleje los cambios, hay que actualizar
`PH` a mano — pero no es necesario para que nada funcione.

## Nota sobre la rotación

La nota del día se elige por el día local: la misma durante 24 h, cambia a medianoche.
El índice es `días transcurridos % número de notas`, así que **desactivar o agregar
notas cambia qué frase toca hoy** (el divisor cambia). Es esperado, no un error.
