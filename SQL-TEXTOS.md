# SQL — sembrar `hogar_practica_textos` con la voz de Andrea

La tabla `public.hogar_practica_textos` ya existe pero está **vacía**. Este SQL mete
las 5 filas (una por práctica) con los textos que hoy viven en el código: las
constantes `RESP_ANDREA`, `CONFIRM_ANDREA` y `RD` de `index.html`, copiados tal cual.

Mientras la tabla esté vacía **no se rompe nada**: la app detecta que no hay textos y
usa los del código. Correr esto es lo que le da a Andrea el control para editarlos
desde el panel.

Cada fila tiene:

| columna | de dónde sale | indexado por |
|---|---|---|
| `practica_key` | key de emoción | — (es la PK) |
| `practica_nombre` | nombre visible | referencia |
| `resp_andrea` | `RESP_ANDREA[key]` | key de emoción |
| `confirm_andrea` | `CONFIRM_ANDREA[key]` | key de emoción |
| `cierre` | `RD[nombre]` | **nombre** de práctica |

> Ojo: en el código `RD` se indexa por **nombre** de práctica, no por key. Aquí ambos
> conviven en la misma fila, atados por el mapa key ↔ nombre.

## Cómo correrlo

Supabase → proyecto **Base de datos Stryv** → **SQL Editor** → pega y ejecuta.

Los textos van con **dollar-quoting** (`$t$…$t$`) en vez de comillas simples, porque
varios llevan apóstrofes ('te escucho, te acompaño'). Así no hay que escapar nada.

```sql
-- ============================================================================
-- HOGAR — textos de la voz de Andrea en las 5 prácticas.
-- Copiados EXACTAMENTE de RESP_ANDREA, CONFIRM_ANDREA y RD.
-- Idempotente: ON CONFLICT sobre la PK no hace nada si la fila ya existe.
-- ============================================================================

INSERT INTO public.hogar_practica_textos
  (practica_key, practica_nombre, resp_andrea, confirm_andrea, cierre)
VALUES
  ('calma', $t$Ritmo Suave$t$, $t$Qué lindo notar la calma. No es algo que se logra y ya: también se cuida y se sostiene. Quedémonos aquí un rato, con un ritmo suave.$t$, $t$Te preparé una práctica de Ritmo Suave: un movimiento amable para acompañar tu calma, sin sacarte de ella.$t$, $t$La calma no es ausencia de movimiento. Es movimiento sin ruido. Cuando el cuerpo ya está en calma, la práctica lo refuerza: le dice 'te escucho, te acompaño'. Hoy no necesitas más. Solo necesitas sostener lo que ya está.$t$),
  ('desconectada', $t$Presencia$t$, $t$Y aun así, lo notaste. Con eso ya volviste un poco. No necesitas entender cómo estás: el cuerpo es el lugar al que regresar, sintiendo, no explicando.$t$, $t$Te preparé una práctica de Presencia: para volver al cuerpo de a poco, sin exigirte claridad.$t$, $t$A veces el cuerpo habla bajo. Y está bien no entender todavía. Esta práctica no busca respuestas. Busca contacto. Volver a sentir que hay un cuerpo, y que ese cuerpo eres tú. Desde ahí se construye todo.$t$),
  ('cansada', $t$Recuperación Suave$t$, $t$Te escucho. El cansancio no se empuja, se atiende. Hoy no toca hacer más, toca recibir: algo bajo y lento, a tu ritmo.$t$, $t$Te preparé una práctica de Recuperación Suave: lenta y restauradora, hecha para recibir, no para esforzarte.$t$, $t$El cansancio no es debilidad. Es información. Hoy tu cuerpo pidió descanso activo, y tú lo escuchaste. La recuperación es donde el cuerpo integra, repara y se prepara. Este es el trabajo invisible que sostiene todo lo demás.$t$),
  ('sensible', $t$Contención$t$, $t$Está bien que algo se mueva adentro. No viene a arreglarse, viene a ser sentido. Aquí no hay que poder con todo, solo dejar que pase, acompañada.$t$, $t$Te preparé una práctica de Contención: un espacio que te sostiene mientras algo se mueve, sin presionarte a entenderlo.$t$, $t$Cuando algo se mueve adentro, el cuerpo necesita un lugar seguro. Esta práctica fue ese lugar. No pedimos que lo resuelvas. Solo que lo sientas con compañía. Lo que necesita ser sentido, necesita primero ser sostenido.$t$),
  ('tensa', $t$Descarga Segura$t$, $t$La tensión no se aguanta, se suelta. No la cargues un rato más: vamos a darle al cuerpo un espacio seguro para descargarla.$t$, $t$Te preparé una práctica de Descarga Segura: para darle salida a la tensión y soltar lo que cargas, con cuidado.$t$, $t$La tensión acumulada busca salida. Esta práctica le dio espacio para moverse sin dañar. Descargar no es explotar. Es soltar con dirección. Cada vez que lo haces, le enseñas a tu cuerpo que hay formas seguras de liberar lo que carga.$t$)
ON CONFLICT (practica_key) DO NOTHING;
```

`ON CONFLICT (practica_key) DO NOTHING` hace seguro correrlo dos veces: si una fila ya
existe, no la toca. Para re-sembrar desde cero, primero
`DELETE FROM public.hogar_practica_textos;` y vuelve a correrlo.

## Verificar

```sql
SELECT practica_key, practica_nombre, left(resp_andrea, 40) AS resp
FROM public.hogar_practica_textos ORDER BY practica_nombre;
```

Deben salir 5 filas: calma/Ritmo Suave, desconectada/Presencia,
cansada/Recuperación Suave, sensible/Contención, tensa/Descarga Segura.

Y en la app:

1. Recarga HOGAR y entra como cualquier usuaria. En la consola debe verse
   `[HOGAR textos] 5 prácticas cargadas desde Supabase ✓`.
2. Elige una emoción: la respuesta de Andrea en el chat debe verse igual que antes.
3. Termina una práctica: el texto de cierre debe verse igual que antes.
4. Como Andrea: panel → **Contenido** → **TEXTOS DE TUS PRÁCTICAS**: ahí están las 5
   tarjetas, editables.

## Cómo funciona la red de seguridad

Los textos **siguen en el código** (`RESP_ANDREA`, `CONFIRM_ANDREA`, `RD`) a propósito.
Al iniciar sesión la app carga los textos de Supabase una sola vez a memoria; si esa
consulta falla, devuelve vacío o todavía no terminó, se usan los del código. La usuaria
nunca ve un hueco ni un error.

Por eso esas constantes no se borran aunque la tabla esté sembrada. Si algún día editas
los textos en el panel y quieres que el fallback también los refleje, hay que
actualizar las constantes a mano — pero no es necesario para que nada funcione.

Es el mismo patrón que ya usan las notas (ver SQL-NOTAS.md).
