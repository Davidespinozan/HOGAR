# Pendiente — reembolsos y disputas

**Estado: sin implementar, a la espera de una decisión de Andrea.**
Hallazgo #10 de la auditoría de agosto de 2026.

Hoy el webhook no maneja reembolsos ni contracargos. Si a una clienta se le
devuelve el dinero, **conserva el acceso completo** y Andrea no tiene forma de
retirárselo desde el panel: habría que editar la fila a mano en Supabase.

No corre prisa —no hay clientas todavía—, pero conviene resolverlo antes de la
primera venta real.

## La decisión que falta

**¿El reembolso debe retirar el acceso automáticamente, o prefiere Andrea
manejarlo a mano?**

No es una pregunta técnica. Puede que prefiera devolver el dinero y dejar que la
persona termine lo que empezó; automatizarlo le quita esa opción. Todo lo de abajo
supone que la respuesta es "sí, automático" — si es que no, lo único que hace falta
es un control en el panel para revocar el acceso a mano.

## Lo que ya está resuelto (y no es poco)

Verificado sobre el código en agosto de 2026:

- `crear-checkout` pone `metadata: { app:'hogar', user_id }` **en el
  `payment_intent_data`**, no solo en la sesión.
- La documentación de Stripe confirma que **el Charge copia la metadata del
  PaymentIntent** al crearse ("When a PaymentIntent creates a charge, the
  PaymentIntent copies its metadata to the charge").
- Por tanto, en un evento `charge.refunded` el objeto ya trae `metadata.app` y
  `metadata.user_id`: **pasa el filtro `esDeHogar()` y sabe a quién revocar, sin
  ninguna consulta extra.**

El reembolso encaja en la arquitectura actual sin tocarla.

## La asimetría de la disputa

**La disputa NO encaja igual, y es el detalle que más fácil se pasa por alto.**

En `charge.dispute.created`, `data.object` es un objeto **Dispute**, no un Charge.
La Dispute tiene su propio campo `metadata`, y la documentación de Stripe **no
dice en ningún sitio que lo herede** del Charge ni del PaymentIntent: nace vacío
salvo que se rellene explícitamente.

Consecuencia: `esDeHogar()` devolvería `false` y **el evento se descartaría en
silencio**, aunque el endpoint estuviera suscrito. Parecería que "no llega".

Para tratarlo hay que expandir `dispute.charge` (o `dispute.payment_intent`) y leer
la metadata de ahí — una llamada extra a la API de Stripe dentro del handler.

Y una diferencia de fondo: **una disputa no es definitiva**. Puede resolverse a
favor de Andrea, y entonces habría que devolver el acceso. Si se modela igual que
un reembolso, ese camino de vuelta no existe.

## Dos formas de modelarlo

### a) Un estado, no un booleano

Reutilizar `estatus` —que hoy no sirve para nada: vale `'activa'` para todas desde
el registro— o añadir una columna, con valores del tipo:

`activa` · `reembolsada` · `en_disputa` · `disputa_perdida`

**A favor:** distingue tres situaciones que hoy se confundirían (nunca pagó, pagó y
se le devolvió, disputa en curso), permite mensajes distintos, y deja revertir una
disputa ganada. Conserva `fecha_compra` y `monto_centavos` como historia.

**En contra:** cuesta SQL, hay que tocar otra vez el badge y el filtro del panel
(que en agosto de 2026 se cambiaron para derivar de `pagado`), y el gate de acceso
tendría que mirar el estado y no solo `pagado`.

### b) Solo `pagado: false`

**A favor:** una línea. El muro y el badge ya funcionan sobre `pagado`, así que no
hay que tocar nada más.

**En contra:** pierde el porqué. Andrea vería a esa persona como "Pendiente" en su
panel, indistinguible de quien nunca compró. Y sin `estatus` no hay forma de
revertir una disputa ganada salvo volver a poner `pagado: true` a mano.

## Qué habría que añadir en Stripe

**No está suscrito hoy** — es configuración del Dashboard, no del repo, así que hay
que comprobarlo y añadirlo allí:

Stripe → **Developers** → **Webhooks** → el endpoint → **Events to send**:

- `charge.refunded` — el reembolso
- `charge.dispute.created` — el contracargo se abre
- `charge.dispute.closed` — se resuelve (mirar `dispute.status`: `won` o `lost`)

**Ojo con el ámbito de Connect:** son cobros directos en la cuenta de Andrea, así
que el endpoint tiene que recibir eventos **de cuentas conectadas**, no solo de la
plataforma. Eso ya funciona (por eso llega `checkout.session.completed`), pero al
añadir los nuevos hay que confirmar que quedan en el mismo ámbito.

## Qué debería ver la clienta

La pantalla de acceso actual (`#s-acceso`) diría *"Tu cuenta está lista. Falta
activar tu acceso"* a alguien que **sí** activó, usó la app y recibió su dinero de
vuelta. Suena a que se le olvidó pagar. Hace falta al menos un texto distinto:

- **Tras un reembolso iniciado por Andrea** — normalmente hay acuerdo previo y la
  clienta ya sabe lo que pasó. Un tono sereno, sin fricción, y con el botón de
  activar disponible: volver es plausible.
- **Tras una disputa** — la relación está rota y suele haber fraude. Ofrecer el
  mismo botón alegre es raro; conviene un mensaje más seco y probablemente sin
  botón, remitiendo a contacto.

Esa diferencia solo es posible con la opción (a). Con la (b), las dos verían el
mismo mensaje que quien nunca pagó.

## Resumen de lo que habría que tocar

| Dónde | Qué |
|---|---|
| Stripe Dashboard | Suscribir los tres eventos, en ámbito Connect |
| `stripe-webhook/index.ts` | `case 'charge.refunded'` → revocar |
| `stripe-webhook/index.ts` | `case 'charge.dispute.created'` → expandir el charge para sacar el `user_id` |
| `_lib/stripe.ts` | `esDeHogar()` no sirve para disputas; hace falta otro camino |
| Supabase | Solo si se elige la opción (a): migración de `estatus` |
| `index.html` | El gate y la pantalla de acceso, si se distinguen estados |
| `index.html` | El badge y el filtro del panel, si se elige (a) |
