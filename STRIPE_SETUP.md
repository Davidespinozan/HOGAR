# Cobros con Stripe en HOGAR — guía de activación

HOGAR ahora tiene toda la **infraestructura de cobro** lista en el código: dos Edge
Functions de Supabase, una tabla de journal de pagos y el cableado en la app. Pero el
código no cobra solo: hay pasos que **solo Andrea** puede hacer (crear la cuenta de
Stripe, pegar las llaves, desplegar). Esta guía es ese checklist.

**Modelo:** pago único (no suscripción), en MXN. El monto lo fijas al crear el producto
en Stripe. **No usamos Stripe Connect** — HOGAR es un solo negocio, así que basta una
cuenta Stripe normal + Checkout.

**Cómo funciona (resumen):**
1. La clienta inicia sesión en HOGAR y toca "Activar mi acceso".
2. La app llama a la función `create-checkout`, que la manda a la página de pago de Stripe.
3. Al pagar, Stripe avisa a la función `stripe-webhook`, que la marca como `activa` en
   `hogar_usuarias` y guarda el pago en `hogar_pagos`.
4. La clienta vuelve a HOGAR con acceso activo; el panel de Andrea muestra los ingresos.

---

## Paso 1 — Crear la cuenta de Stripe
1. Entra a https://stripe.com y crea la cuenta a nombre del negocio de Andrea.
2. Completa los datos para poder cobrar en México (MXN).
3. Empieza en **modo prueba** (test) para validar sin cobrar dinero real.

## Paso 2 — Crear el producto y su precio
1. En Stripe: **Productos → Añadir producto**.
2. Nombre: "Acceso HOGAR" (o el que prefieras). Precio: **pago único**, moneda **MXN**,
   el monto que decidas.
3. Copia el **ID del precio** (empieza con `price_...`). Lo necesitas en el paso 4.

## Paso 3 — Copiar las llaves de Stripe
En Stripe → **Desarrolladores → Claves de API**:
- **Clave secreta** (`sk_test_...` en prueba, `sk_live_...` en real). NUNCA se pega en el
  código ni se comparte; solo va como *secret* en Supabase (paso 4).

## Paso 4 — Desplegar las Edge Functions en Supabase
Necesitas el [CLI de Supabase](https://supabase.com/docs/guides/cli) instalado. En una
terminal, dentro de la carpeta `HOGAR`:

```bash
# 1) Enlazar el proyecto (ref: lxpgqhghxfqsahwrdmzo = "Base de datos Stryv")
supabase link --project-ref lxpgqhghxfqsahwrdmzo

# 2) Aplicar la migración (crea la tabla hogar_pagos y las columnas de pago)
supabase db push

# 3) Guardar los secrets (NO van en el código)
supabase secrets set STRIPE_SECRET_KEY=sk_test_xxxxx
supabase secrets set STRIPE_PRICE_ID=price_xxxxx
supabase secrets set SITE_URL=https://hogarbyandrea.netlify.app
# STRIPE_WEBHOOK_SECRET se pone en el paso 5, cuando Stripe lo genere

# 4) Desplegar las dos funciones
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```

> El `--no-verify-jwt` en el webhook es obligatorio: Stripe no manda un token de
> Supabase. Lo que autentica el webhook es la firma de Stripe (paso 5).

## Paso 5 — Registrar el webhook en Stripe
1. En Stripe → **Desarrolladores → Webhooks → Añadir endpoint**.
2. URL del endpoint:
   `https://lxpgqhghxfqsahwrdmzo.supabase.co/functions/v1/stripe-webhook`
3. Evento a escuchar: **`checkout.session.completed`**.
4. Guarda. Stripe te da un **signing secret** (`whsec_...`). Cópialo y guárdalo:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_xxxxx
# vuelve a desplegar para que tome el secret nuevo
supabase functions deploy stripe-webhook --no-verify-jwt
```

## Paso 6 — Encender el botón en la app
En `index.html`, cambia una línea:

```js
const STRIPE_PAGO_ACTIVO = false;   // ← ponlo en true
```

Haz commit y push. A partir de ahí, las clientas logueadas verán "Activar mi acceso" en
su perfil, y el flujo de pago real queda activo.

## Paso 7 — Probar en modo prueba
1. Con las llaves `sk_test_`/`price_` de prueba, entra a HOGAR con una cuenta y toca
   "Activar mi acceso".
2. Usa una [tarjeta de prueba de Stripe](https://stripe.com/docs/testing): `4242 4242 4242 4242`,
   cualquier fecha futura y CVC.
3. Verifica:
   - Vuelves a HOGAR con el mensaje "¡Pago recibido!".
   - En Supabase, `hogar_usuarias` de esa clienta quedó `estatus = 'activa'` con `paid_at`.
   - Apareció una fila en `hogar_pagos`.
   - El panel de Andrea → sección DINERO muestra el ingreso.

## Paso 8 — Pasar a real (live)
Cuando todo funcione en prueba, repite con las llaves `sk_live_`/`price_` reales:
- `supabase secrets set STRIPE_SECRET_KEY=sk_live_...`
- `supabase secrets set STRIPE_PRICE_ID=price_...` (el precio en modo live)
- Crea un webhook nuevo en modo live y actualiza `STRIPE_WEBHOOK_SECRET`.
- Vuelve a desplegar ambas funciones.

---

## Pendiente / decisiones para después
- **Reordenar el embudo de la landing.** Hoy la pantalla de pago de la landing (`doPay`)
  es una **simulación** (anima "¡Pago exitoso!" sin cobrar) y va antes del registro. El
  cobro real vive en el perfil (post-login). Conviene reemplazar esa simulación por el
  flujo real registro → login → "Activar mi acceso". Dime y lo reordeno.
- **Mostrar "Activar mi acceso" solo a clientas no-activas.** Hoy el botón aparece a
  cualquier clienta logueada cuando `STRIPE_PAGO_ACTIVO=true`. Falta leer su `estatus`
  para ocultarlo a quien ya pagó. Es un ajuste chico que hago cuando digas.
- **Cómo se crea la fila en `hogar_usuarias`.** El webhook activa por `id` o por `email`.
  Si tu registro NO crea automáticamente la fila en `hogar_usuarias`, hay que asegurar
  que exista antes o hacer que el webhook la inserte. Confírmame cómo se puebla esa tabla.
