# SQL — las tres fotos editables desde el panel

Hoy Andrea solo puede cambiar **una** foto desde el panel: la del hero en escritorio
(`hogar_config.landing_hero_imagen`). Las otras dos están escritas a mano en el CSS y
no hay forma de tocarlas sin editar el código:

| Foto | Dónde se ve | Hoy |
|---|---|---|
| Hero escritorio | landing, en computadora | ✅ `landing_hero_imagen` |
| Hero móvil (vertical) | landing, en celular | ⛔ fija en el CSS |
| Foto de Andrea | el chat de la práctica **y** el inicio de la usuaria | ⛔ fija en el CSS |

Este SQL añade las dos columnas que faltan y las **siembra con las URLs que ya se usan
hoy**, así que al correrlo no cambia nada de lo que se ve: la app sigue mostrando
exactamente las mismas fotos, pero a partir de entonces salen de la base y Andrea las
controla desde **Landing**.

## Cómo correrlo

Supabase → proyecto **Base de datos Stryv** → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — dos fotos más, editables desde el panel.
--   landing_hero_imagen_movil → la vertical del hero en celular
--   andrea_foto_chat          → la redonda de Andrea en el chat de la práctica
-- Ambas se siembran con la URL que el código usa hoy: correr esto NO cambia
-- nada de lo que se ve. Solo mueve el control del código a la base.
-- ============================================================================

ALTER TABLE public.hogar_config
  ADD COLUMN IF NOT EXISTS landing_hero_imagen_movil text,
  ADD COLUMN IF NOT EXISTS andrea_foto_chat          text;

-- Sembrado: solo donde está vacío, para no pisar un valor ya elegido si este
-- script se corriera dos veces.
UPDATE public.hogar_config
SET
  landing_hero_imagen_movil = COALESCE(
    NULLIF(TRIM(landing_hero_imagen_movil), ''),
    'https://lxpgqhghxfqsahwrdmzo.supabase.co/storage/v1/object/public/hogar/hero-andrea-vertical-NUEVA.jpg'
  ),
  andrea_foto_chat = COALESCE(
    NULLIF(TRIM(andrea_foto_chat), ''),
    'https://lxpgqhghxfqsahwrdmzo.supabase.co/storage/v1/object/public/hogar/hero-meditacion.jpg'
  )
WHERE id = 1;

-- ============================================================================
-- La vista pública, ampliada con las dos columnas nuevas.
--
-- Hace falta por dos motivos distintos:
--  · el hero móvil lo ve CUALQUIERA en la landing, sin sesión (rol anon);
--  · la foto del chat la ven las usuarias, que tampoco pueden leer hogar_config
--    (esa tabla guarda los datos de Stripe y sigue cerrada).
-- Las dos columnas nuevas son URLs de un bucket público: ya eran accesibles por
-- quien tuviera el enlace. No se expone ningún dato de Stripe.
-- ============================================================================

-- EL ORDEN DE ESTAS COLUMNAS NO ES COSMÉTICO. `andrea_foto_chat` va LA ÚLTIMA,
-- después de precio_centavos, y tiene que quedarse ahí.
--
-- CREATE OR REPLACE VIEW solo sabe AÑADIR columnas AL FINAL: no puede insertarlas
-- en medio ni reordenarlas. Este script antes la ponía entre imagen_movil y
-- precio_centavos, y por eso falló en su día con
--
--     cannot change name of view column "precio_centavos" to "andrea_foto_chat"
--
-- Lo que dejó la base a medias: el ALTER TABLE sí creó la columna, pero la vista
-- se quedó sin ella. Resultado, "Tu foto" era un control muerto — Andrea la subía,
-- la previsualización cambiaba, y ninguna clienta la veía nunca, porque las
-- visitantes leen esta vista y no hogar_config.
CREATE OR REPLACE VIEW public.hogar_landing
WITH (security_invoker = false)      -- corre con permisos del dueño: puede leer
AS                                   -- hogar_config aunque el visitante no pueda
SELECT
  landing_hero_titulo,
  landing_hero_subtitulo,
  landing_hero_imagen,
  landing_hero_imagen_movil,
  precio_centavos,
  andrea_foto_chat                   -- LA ÚLTIMA. Ver el comentario de arriba.
FROM public.hogar_config
WHERE id = 1;

GRANT SELECT ON public.hogar_landing TO anon, authenticated;
```

## Verificar

Con la anon key, sin sesión:

```bash
curl "https://lxpgqhghxfqsahwrdmzo.supabase.co/rest/v1/hogar_landing" \
  -H "apikey: <ANON_KEY>"
```

Debe devolver **una fila** con seis campos — los cuatro de antes más
`landing_hero_imagen_movil` y `andrea_foto_chat` — y **nada** de Stripe.

En la app:

1. Abre HOGAR en una ventana privada. En consola: `[HOGAR landing] landing cargada
   desde Supabase ✓`. La landing se ve **igual que antes** (las fotos sembradas son
   las de siempre).
2. Como Andrea: panel → **Landing**. Deben verse **tres** previsualizaciones
   etiquetadas: *Foto para computadora*, *Foto para celular* y *Tu foto*.
3. Cambia la de celular y vuelve a abrir la landing en un teléfono (o con el
   navegador en modo móvil, ≤480 px): debe salir la nueva.
4. Cambia *Tu foto* y entra a una práctica: el avatar redondo del chat es el nuevo.

## Red de seguridad

Las tres URLs **siguen en el CSS**. Si no corres este SQL, si la vista no tiene las
columnas o si un valor llega vacío, la app deja exactamente lo que ya estaba escrito:
la vertical de siempre en el celular y la foto de siempre en el chat. Nunca queda un
hueco. Por eso puedes correrlo cuando quieras — antes, la app funciona con las fotos
del código; después, Andrea las controla.

## Una sola foto de Andrea, en los dos sitios

`hero-meditacion.jpg` se usaba **en dos lugares**: el avatar redondo del chat de la
práctica y la foto del aside en el inicio de la usuaria. Los dos leen ahora la misma
columna `andrea_foto_chat`, así que **con cambiar *Tu foto* una vez, cambia en los
dos** — no pueden quedar dos Andreas distintas conviviendo en la app.

Son dos mecanismos distintos por debajo, porque son dos cosas distintas: la del chat
es un fondo CSS (`.msg-avatar`) y la del inicio es un `<img>`. La del inicio además
tiene una red de seguridad extra: si la foto nueva no llegara a cargar (borrada del
bucket, red caída), vuelve sola a `hero-meditacion.jpg` en vez de quedarse rota.

---

# Las tres que faltaban — todas las imágenes de la landing editables

Quedaban tres imágenes clavadas en el código. Con estas columnas, **ninguna imagen de
la landing depende ya de un despliegue**:

| Imagen | Dónde se ve | Antes |
|---|---|---|
| `andrea_foto_perfil` | el retrato de *Detrás de HOGAR* | ⛔ en el HTML |
| `landing_trans_imagen` | el recuadro de *Lo que empieza a cambiar* | ⛔ en el HTML |
| `landing_cierre_imagen` | el fondo de *Tu espacio te espera* | ⛔ en el CSS |

Dos decisiones de diseño que conviene entender antes de tocar nada:

**El retrato es una columna aparte del avatar.** `andrea_foto_chat` es el círculo
pequeño de dentro de la app; `andrea_foto_perfil` es la foto grande que ve quien
todavía no ha entrado. Dos encuadres para dos sitios, así que dos columnas. Lo que no
podía seguir pasando es que una fuera editable y la otra no: Andrea cambiaba su foto y
la landing seguía enseñando la vieja.

**El cierre lleva UNA columna aunque el CSS lo pinte dos veces.** El hero necesita dos
(`landing_hero_imagen` y `..._movil`) porque una foto apaisada no funciona en vertical
y hacen falta dos recortes. El cierre es la misma imagen servida a dos anchos —
`_landingSetCierreImg()` inyecta las dos reglas desde un solo valor. Darle dos
controles sería pedirle que suba la misma foto dos veces.

## Cómo correrlo

Supabase → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — las tres imágenes que faltaban, editables desde el panel.
-- Idempotente: se puede correr dos veces sin efecto.
-- ============================================================================

ALTER TABLE public.hogar_config
  ADD COLUMN IF NOT EXISTS andrea_foto_perfil    text,
  ADD COLUMN IF NOT EXISTS landing_cierre_imagen text,
  ADD COLUMN IF NOT EXISTS landing_trans_imagen  text;

-- Siembra con las imágenes que el código usa hoy, solo donde esté vacío: correr
-- esto NO cambia nada de lo que se ve.
UPDATE public.hogar_config
SET
  andrea_foto_perfil = COALESCE(
    NULLIF(TRIM(andrea_foto_perfil), ''),
    'https://lxpgqhghxfqsahwrdmzo.supabase.co/storage/v1/object/public/hogar/andrea-perfil.webp'
  ),
  landing_cierre_imagen = COALESCE(
    NULLIF(TRIM(landing_cierre_imagen), ''),
    'https://lxpgqhghxfqsahwrdmzo.supabase.co/storage/v1/object/public/hogar/ideogram-v3.0_Serene_cozy_minimalist_home_reflection_space_empty_tranquil_room_no_people_warm_-2.jpg_nymnzl.png'
  ),
  landing_trans_imagen = COALESCE(
    NULLIF(TRIM(landing_trans_imagen), ''),
    'https://lxpgqhghxfqsahwrdmzo.supabase.co/storage/v1/object/public/hogar/ideogram-v3.0_Cozy_minimalist_home_yoga_practice_space_serene_modern_house_interior_soft_natur-2.jpg_bvurmm.png'
  )
WHERE id = 1;

-- OTRA VEZ, Y ES LA TERCERA: las columnas NUEVAS van AL FINAL, después de las que
-- la vista ya tenía y en este orden. CREATE OR REPLACE VIEW solo sabe AÑADIR al
-- final — no puede insertar en medio ni reordenar. Meterlas antes de
-- precio_centavos es lo que hizo fallar la migración de andrea_foto_chat y dejó
-- esa foto sin llegar a ninguna clienta.
CREATE OR REPLACE VIEW public.hogar_landing
WITH (security_invoker = false)
AS
SELECT
  landing_hero_titulo,
  landing_hero_subtitulo,
  landing_hero_imagen,
  landing_hero_imagen_movil,
  precio_centavos,
  andrea_foto_chat,
  andrea_foto_perfil,                -- las tres nuevas, al final y en este orden
  landing_cierre_imagen,
  landing_trans_imagen
FROM public.hogar_config
WHERE id = 1;

GRANT SELECT ON public.hogar_landing TO anon, authenticated;
```

## Verificar

```bash
curl -s "https://lxpgqhghxfqsahwrdmzo.supabase.co/rest/v1/hogar_landing" \
  -H "apikey: <ANON_KEY>" | python3 -m json.tool
```

Debe devolver **nueve** campos, con `andrea_foto_perfil`, `landing_cierre_imagen` y
`landing_trans_imagen` los tres últimos. Si siguen siendo seis, el `CREATE OR REPLACE`
falló: mira el error en el editor, no lo des por bueno.

Después, como Andrea: panel → **Tu landing**. Deben verse **seis** fotos — las dos del
hero, las dos de las secciones de más abajo, *Tu foto* y *Tu retrato de la landing*.

## Antes o después del código

**Da igual para la landing, pero el SQL tiene que ir antes de que Andrea suba nada.**
Las tres imágenes siguen escritas en el código, así que la landing se ve bien sin
correr esto. Lo que no funciona sin las columnas son los botones *Cambiar foto* de esas
tres tarjetas: el UPDATE fallaría con un error de columna inexistente.
