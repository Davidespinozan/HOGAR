# SQL — que cada usuaria pueda leer su propio acceso

La app necesita saber si quien entra ha pagado, para dejarla practicar o pedirle
que active su acceso. Ese dato ya existe: `hogar_usuarias.pagado`, que marca el
webhook de Stripe cuando el cobro se confirma.

El problema es que **hoy nadie salvo Andrea puede leerlo**. La única policy de la
tabla ata a un UUID fijo:

```
andrea_ve_todo · SELECT · roles {public} · auth.uid() = 'f749320b-…'::uuid
```

Con RLS activo y sin más policies, una usuaria normal que consulte su propia fila
recibe `[]` y HTTP 200 — no un error. Para la app son indistinguibles «no ha
pagado» y «no pude verlo», y sobre esa ambigüedad no se puede decidir un bloqueo.

Este SQL añade **una** policy para cerrar ese hueco.

## Cómo correrlo

Supabase → proyecto **Base de datos Stryv** → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — cada usuaria puede leer SU propia fila de hogar_usuarias.
--
-- Es aditiva: las policies de RLS se combinan con OR, así que `andrea_ve_todo`
-- sigue intacta y el panel de Andrea no cambia en nada.
--
-- `to authenticated` y no `{public}` como la de Andrea: `anon` no tiene ningún
-- motivo para leer esta tabla, y así queda dicho explícitamente.
--
-- No se añade ninguna policy de INSERT/UPDATE/DELETE: la tabla no tiene ninguna
-- hoy y no hace falta. Quien escribe son el trigger de auth.users (security
-- definer) y el webhook de Stripe (service_role); ninguno pasa por RLS.
-- ============================================================================

CREATE POLICY hogar_usuaria_lee_lo_suyo
  ON public.hogar_usuarias
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);
```

## Verificar

**1. Que ahora hay dos policies:**

```sql
SELECT policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'hogar_usuarias';
```

Deben salir dos filas: `andrea_ve_todo` (la de siempre) y
`hogar_usuaria_lee_lo_suyo`.

**2. Que el panel de Andrea sigue completo.** Entra como Andrea → **Usuarias**.
Deben verse las 6. Si ves solo la suya, algo salió mal: avisa antes de seguir.

**3. Que una usuaria ve lo suyo y solo lo suyo.** Entra con una cuenta que NO sea
la de Andrea, abre la consola del navegador y ejecuta:

```js
await window.sb.from('hogar_usuarias').select('id,email,pagado')
```

Debe devolver **exactamente una fila**, la suya, con su `pagado`. Si devuelve más
de una, la policy quedó demasiado abierta y hay que revisarla. Si devuelve `[]`,
no se aplicó.

## Qué queda expuesto

Cada usuaria pasa a ver **su propia fila entera**: su nombre, su correo, su fecha
de compra, su importe y su `stripe_customer_id`. Son sus datos, y `id` es su
propio `auth.uid()`, así que no alcanza los de nadie más.

Si prefieres acotarlo a solo `pagado`, se puede hacer con una vista al estilo de
`hogar_landing` en vez de con esta policy. No se hizo así porque aquel caso era
distinto: la fila de `hogar_config` contenía datos de Stripe **de Andrea**, y
había que esconderlos de quien la leyera. Aquí cada quien lee lo suyo.

## Qué NO arregla esto

Nada del contenido. Los videos y audios siguen en un bucket **público** con
nombres predecibles (`{SLUG}{minutos}.mp4`): se descargan con el enlace directo,
sin sesión siquiera. Esta policy y el bloqueo que la acompaña disuaden a quien usa
la app con normalidad; no detienen a nadie con la consola abierta. Cerrar eso pide
bucket privado y URLs firmadas, que es otro proyecto.

## Orden respecto al deploy

**Corre este SQL ANTES de desplegar el código.** El orden importa:

- **SQL primero, deploy después** — correcto. Entre uno y otro no cambia nada:
  la policy solo concede una lectura que todavía nadie hace.
- **Deploy primero, SQL después** — evitable. En esa ventana las usuarias leerían
  `[]`, el acceso quedaría en «desconocido» y el bloqueo no actuaría. No rompe
  nada (por diseño, lo desconocido deja pasar), pero el gate no protegería hasta
  que corras el SQL, y podrías creerlo activo sin estarlo.
