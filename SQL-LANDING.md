# SQL — lectura pública de la landing (sin exponer los datos de Stripe)

La landing es **pública**: la ve cualquiera sin iniciar sesión. Para que su título,
subtítulo, imagen y precio salgan de Supabase, el rol **anónimo** tiene que poder
leerlos. Hoy no puede: una consulta anónima a `hogar_config` devuelve 0 filas, así que
la landing usa el texto del código (que funciona, pero Andrea no lo controla).

## Por qué una vista y no una policy directa

Lo natural sería agregar una policy de SELECT anónimo a `hogar_config`. **No lo hagas.**
RLS es por fila, no por columna: esa policy expondría la fila **entera** al público, y
`hogar_config` guarda datos de Stripe (`stripe_account_id`, `stripe_charges_enabled`,
`stripe_details_submitted`, `precio_centavos`, `producto_desc`…). No son llaves
secretas, pero no hay razón para publicarlos en internet.

La solución limpia es una **vista** que exponga solo las cuatro columnas de la landing.
La app pública lee la vista; `hogar_config` sigue cerrada. Andrea, ya autenticada, sigue
leyendo y escribiendo `hogar_config` directo desde el panel (su policy no cambia).

## Cómo correrlo

Supabase → proyecto **Base de datos Stryv** → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — vista pública de la landing.
-- Expone SOLO las columnas de landing + el precio; nunca los campos de Stripe.
-- La lee el rol anon (visitantes sin sesión). hogar_config sigue privada.
-- ============================================================================

CREATE OR REPLACE VIEW public.hogar_landing
WITH (security_invoker = false)      -- corre con permisos del dueño: puede leer
AS                                   -- hogar_config aunque el visitante no pueda
SELECT
  landing_hero_titulo,
  landing_hero_subtitulo,
  landing_hero_imagen,
  precio_centavos
FROM public.hogar_config
WHERE id = 1;

-- Solo lectura, y solo estas columnas, para anónimos y autenticados.
GRANT SELECT ON public.hogar_landing TO anon, authenticated;
```

`security_invoker = false` es lo que hace que la vista pueda leer `hogar_config` en
nombre del visitante sin darle a éste acceso a la tabla. Como la vista solo selecciona
cuatro columnas, es lo único que se ve.

## Verificar

En una terminal (o desde el navegador sin sesión), con la anon key pública:

```bash
curl "https://lxpgqhghxfqsahwrdmzo.supabase.co/rest/v1/hogar_landing" \
  -H "apikey: <ANON_KEY>"
```

Debe devolver **una fila** con los cuatro campos, y **nada** de Stripe.

En la app:

1. Abre HOGAR en una **ventana privada** (sin sesión). En la consola debe verse
   `[HOGAR landing] landing cargada desde Supabase ✓`.
2. El título, el subtítulo, la imagen del hero (en escritorio) y el precio deben salir
   de la base. Si aún no has editado nada, se ven igual que antes.
3. Como Andrea: panel → **Contenido** → **TU LANDING**. Edita el título, Guarda, y
   recarga la landing en la ventana privada: el título nuevo aparece **sin login**.

## Qué es editable y qué no

| Elemento | Editable | De dónde sale |
|---|---|---|
| Título del hero | ✅ panel | `hogar_config.landing_hero_titulo` |
| Subtítulo del hero | ✅ panel | `hogar_config.landing_hero_subtitulo` |
| Imagen del hero (escritorio) | ✅ panel (URL) | `hogar_config.landing_hero_imagen` |
| Precio anunciado | ⛔ aquí no | `hogar_config.precio_centavos` (sección **Planes**) |
| Imagen vertical del teléfono | ⛔ | fija en el código |
| Listas, features, citas, marquee | ⛔ | fijas en el código |

El **precio** se lee de `precio_centavos`, el mismo que alimenta el checkout. Así el
precio anunciado en la landing y el que se cobra **no pueden discrepar**: se cambian en
un solo lugar, Planes. Si `precio_centavos` es 0 o nulo, la landing muestra el texto que
trae el código (`$499 MXN`).

## Red de seguridad

El título, subtítulo, imagen y precio **siguen en el HTML/código**. Si la vista no
existe todavía, la consulta falla o algún campo llega vacío, la landing deja tal cual lo
que ya está escrito. Nunca queda un hueco. Por eso puedes correr este SQL cuando quieras:
antes de correrlo la landing funciona con el texto del código; después, Andrea la
controla desde el panel.

La imagen del hero se cambia solo en **escritorio**: la regla se inyecta scopeada a
`@media(min-width:481px)`, así la imagen vertical del teléfono (que vive en
`@media(max-width:480px)`) no se toca.
