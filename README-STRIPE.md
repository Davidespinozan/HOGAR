# HOGAR — cobros con Stripe Connect (guía de configuración)

Para David. Esta guía es **solo configuración**: pegar llaves en Netlify y crear el
webhook en Stripe. El código ya está en el repo (`netlify/functions/`).

---

## ⚠️ Antes de empezar: lee esto

**1. Hay DOS implementaciones de cobro en este repo.** La nueva (Netlify Functions,
Stripe Connect, esta guía) y una anterior (Supabase Edge Functions, cuenta Stripe
simple, documentada en `STRIPE_SETUP.md`). **Son incompatibles entre sí** y no deben
estar activas al mismo tiempo:

| | Anterior (`supabase/functions/`) | Nueva (`netlify/functions/`) |
|---|---|---|
| Modelo | Cuenta Stripe simple, STRYV cobra | Connect Express, **Andrea** cobra directo |
| Precio | `STRIPE_PRICE_ID` (fijo en Stripe) | `hogar_config.precio_centavos` (lo edita Andrea) |
| Escribe | `estatus`, `paid_at`, `hogar_pagos` | `pagado`, `fecha_compra`, `monto_centavos`, `plan`, `estatus` |
| Filtra EKKO | ❌ no | ✅ sí (`metadata.app`) |

Si registras el webhook nuevo **sin dar de baja el viejo**, un mismo pago se procesa
dos veces por caminos distintos. Antes de pasar a producción: decide cuál se queda y
borra el endpoint del otro en el dashboard de Stripe.

**2. `STRIPE_SETUP.md` quedó obsoleto** con esta guía (dice literalmente "No usamos
Stripe Connect"). Cuando confirmes que te quedas con Connect, hay que borrarlo.

**3. La UI todavía no llama a estas funciones.** `index.html` sigue apuntando a la
Edge Function anterior. El cableado del panel (secciones Cobros y Planes) va en un
paso aparte.

---

## Cómo funciona el modelo

- **Stripe Connect, cuentas Express, direct charges.** STRYV es la plataforma;
  Andrea es una cuenta conectada. Las clientas le pagan **directo a ella**: el dinero
  es suyo y STRYV no es merchant of record.
- **Pago único** (no suscripción): se paga una vez, el acceso es de por vida. MXN.
- **La cuenta-plataforma es la MISMA de EKKO** → se reusan sus llaves de plataforma.
  Por eso todo lo que crea HOGAR lleva `metadata.app = 'hogar'`, y el webhook
  **ignora** cualquier evento que no lo traiga. Sin eso, HOGAR procesaría pagos de EKKO.

Flujo: Andrea activa cobros (`connect-onboarding` → formulario de Stripe) → una
clienta paga (`crear-checkout` → Checkout de Stripe) → Stripe avisa
(`stripe-webhook` → se le acredita el acceso).

---

## Paso 1 — Variables de entorno en Netlify

Netlify → sitio **hogarbyandrea** → *Site configuration* → *Environment variables*.

| Variable | De dónde sale |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe (cuenta-plataforma, **la misma de EKKO**) → Developers → API keys → *Secret key*. `sk_test_…` para probar, `sk_live_…` para real. |
| `STRIPE_WEBHOOK_SECRET` | Lo genera Stripe al crear el endpoint del **Paso 2** (`whsec_…`). Primero haz el paso 2, luego vuelve por este. |
| `SUPABASE_URL` | Supabase → proyecto "Base de datos Stryv" → Settings → API → *Project URL*. |
| `SUPABASE_ANON_KEY` | Mismo lugar → *anon public*. Es la llave pública (la misma que ya usa `index.html`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Mismo lugar → *service_role*. **Salta RLS: nunca en el frontend, nunca en el repo.** Solo aquí. |

Opcional:

| Variable | Para qué |
|---|---|
| `ADMIN_EMAIL` | Sobreescribe el correo de administración (default: `andrealaso1997@hotmail.com`). Útil para probar el panel con otra cuenta. |

Ninguna llave está en el código. Si falta una obligatoria, la función responde error
y lo dice en los logs; no se cae el sitio.

---

## Paso 2 — Crear el webhook en Stripe

1. Stripe → **Developers → Webhooks → Add endpoint**.
2. URL:
   ```
   https://hogarbyandrea.netlify.app/.netlify/functions/stripe-webhook
   ```
3. Eventos a suscribir (solo estos dos):
   - `checkout.session.completed`
   - `account.updated`
4. Como es Connect, marca que escuche también **eventos de cuentas conectadas**
   (*Listen to events on Connected accounts*): el pago ocurre en la cuenta de Andrea,
   no en la plataforma.
5. Guarda → Stripe muestra el **signing secret** (`whsec_…`) → pégalo en Netlify como
   `STRIPE_WEBHOOK_SECRET` (Paso 1) y **redespliega** el sitio para que lo tome.

---

## Paso 3 — Empezar en modo TEST

Haz todo el circuito con llaves `sk_test_…` **antes** de tocar dinero real.

- Tarjeta de prueba: `4242 4242 4242 4242`, cualquier fecha futura, cualquier CVC.
- El onboarding de Connect en test se completa con datos ficticios que Stripe acepta.
- Cuando funcione de punta a punta, repite con `sk_live_…`, crea un webhook **nuevo**
  en modo live y actualiza `STRIPE_WEBHOOK_SECRET`.

---

## Paso 4 — Checklist de verificación

- [ ] Las 5 variables están en Netlify y el sitio se redesplegó después de ponerlas.
- [ ] `hogarbyandrea.netlify.app` sigue cargando igual que antes (sitio estático y PWA intactos).
- [ ] Andrea entra al panel y activa cobros → la manda al formulario de Stripe.
- [ ] Al terminar, en Supabase `hogar_config` tiene `stripe_account_id` y
      `stripe_charges_enabled = true`.
- [ ] `hogar_config.precio_centavos` tiene el precio (ej. `49900` = $499.00 MXN) y
      `moneda = 'mxn'`. **Si es 0 o nulo, el checkout responde `precio_no_configurado`.**
- [ ] Una clienta de prueba paga con `4242…` → vuelve a la app con `?pago=exito`.
- [ ] En `hogar_usuarias` esa clienta quedó `pagado = true`, `estatus = 'activa'`,
      `plan = 'completo'`, con `fecha_compra` y `monto_centavos`.
- [ ] En Stripe → Webhooks, el evento aparece entregado con **200**.
- [ ] Un pago de **EKKO** en la misma plataforma NO toca la base de HOGAR (en los logs
      de Netlify se ve `evento ajeno ignorado`).

---

## Pendientes conocidos

- **La card DINERO del panel lee `hogar_pagos`**, tabla que llenaba el webhook
  anterior. El webhook nuevo **no la escribe** (no estaba en el alcance), así que esa
  card se queda en "Conecta Stripe" aunque haya pagos reales. Hay que decidir si el
  webhook nuevo también escribe el journal o si la card pasa a leer `hogar_usuarias`.
- **Dar de baja la implementación anterior** (ver el aviso del inicio).
- **Cablear la UI** de Cobros y Planes en `index.html`.

---

## Los archivos

```
netlify/functions/
├── _lib/
│   ├── auth.ts        valida el JWT; distingue a Andrea de una clienta
│   ├── env.ts         lectura de variables de entorno
│   ├── http.ts        respuestas JSON + CORS
│   ├── stripe.ts      cliente Stripe (apiVersion fija) + filtro metadata.app
│   └── supabase.ts    clientes admin/usuario + lectura de hogar_config
├── connect-onboarding/  Andrea activa sus cobros        (solo Andrea)
├── connect-status/      estado, banco, balance, panel   (solo Andrea)
├── crear-checkout/      la clienta paga (pago único)    (clienta logueada)
└── stripe-webhook/      Stripe avisa                    (firma de Stripe)
```
