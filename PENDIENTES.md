# Pendientes de HOGAR

Cosas conocidas, decididas conscientemente y **sin hacer**. Cada una dice por qué
sigue abierta y qué haría falta para cerrarla. No es una lista de bugs: nada de
esto está roto, son decisiones aplazadas.

| # | Pendiente | Bloqueado por | Alcance |
|---|---|---|---|
| 1 | [Reembolsos y disputas](#1--reembolsos-y-disputas) | Decisión de negocio de Andrea | `stripe-webhook`, quizá Supabase |
| 2 | [Contraste de las píldoras `.sect-lab`](#2--contraste-de-las-píldoras-sect-lab) | Decisión estética de marca | Una línea, seis píldoras |
| 3 | [Migrar el vídeo a Bunny Stream](#3--migrar-el-vídeo-a-bunny-stream) | **Descartado por coste** en agosto de 2026 | Se retoma `PLAN-CAPA-3.md` |
| 4 | [Cambiar el correo desde el perfil](#4--cambiar-el-correo-desde-el-perfil) | Falta demanda real; primero verificar un trigger | `index.html`, Supabase Auth y una migración |
| 6 | [Cobro huérfano: pagar y borrar la cuenta antes del webhook](#6--cobro-huérfano-pagar-y-borrar-la-cuenta-antes-del-webhook) | **Resuelto para la ventana realista.** Falta reconciliar contra Stripe para cerrarlo del todo | Una función programada |
| 7 | [El editor del cuestionario no debe dejar reordenar los ids de p1](#7--el-editor-del-cuestionario-no-debe-dejar-reordenar-los-ids-de-p1) | **Sorteado, no resuelto:** el editor es solo texto, así que hoy no puede reordenar nada | Vuelve a aplicar si el editor gana añadir o quitar opciones |
| 9 | [Los textos de la landing no son editables, y una columna por texto no escala](#9--los-textos-de-la-landing-no-son-editables-y-una-columna-por-texto-no-escala) | Falta decidir con Andrea qué texto es voz y cuál es estructura | Una tabla nueva y una sección del panel |
| 10 | [Comprimir los vídeos: descartado por una medición que no probó los ajustes recomendados](#10--comprimir-los-vídeos-descartado-por-una-medición-que-no-probó-los-ajustes-recomendados) | Nada: falta medirlo bien | Un `ffmpeg`, ningún código |
| 11 | [Andrea se cuenta a sí misma en sus métricas](#11--andrea-se-cuenta-a-sí-misma-en-sus-métricas) | Decisión de Andrea: ¿quiere verse o no? | Una constante y cuatro consultas |

Los números **no se reutilizan ni se renumeran**: hay commits que citan «pendiente 6»
y renumerar los dejaría apuntando a otra cosa. Por eso falta el 5.

Al final hay un apartado de **[cerrados](#cerrados)**: cosas que se investigaron y
no requieren acción, anotadas por si reaparecen.

---

## 1 · Reembolsos y disputas

**Estado: sin implementar, a la espera de una decisión de Andrea.**
Hallazgo #10 de la auditoría de agosto de 2026.

Hoy el webhook no maneja reembolsos ni contracargos. Si a una clienta se le
devuelve el dinero, **conserva el acceso completo** y Andrea no tiene forma de
retirárselo desde el panel: habría que editar la fila a mano en Supabase.

No corre prisa —no hay clientas todavía—, pero conviene resolverlo antes de la
primera venta real.

### La decisión que falta

**¿El reembolso debe retirar el acceso automáticamente, o prefiere Andrea
manejarlo a mano?**

No es una pregunta técnica. Puede que prefiera devolver el dinero y dejar que la
persona termine lo que empezó; automatizarlo le quita esa opción. Todo lo de abajo
supone que la respuesta es "sí, automático" — si es que no, lo único que hace falta
es un control en el panel para revocar el acceso a mano.

### Lo que ya está resuelto (y no es poco)

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

### La asimetría de la disputa

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

### Dos formas de modelarlo

#### a) Un estado, no un booleano

Reutilizar `estatus` —que hoy no sirve para nada: vale `'activa'` para todas desde
el registro— o añadir una columna, con valores del tipo:

`activa` · `reembolsada` · `en_disputa` · `disputa_perdida`

**A favor:** distingue tres situaciones que hoy se confundirían (nunca pagó, pagó y
se le devolvió, disputa en curso), permite mensajes distintos, y deja revertir una
disputa ganada. Conserva `fecha_compra` y `monto_centavos` como historia.

**En contra:** cuesta SQL, hay que tocar otra vez el badge y el filtro del panel
(que en agosto de 2026 se cambiaron para derivar de `pagado`), y el gate de acceso
tendría que mirar el estado y no solo `pagado`.

#### b) Solo `pagado: false`

**A favor:** una línea. El muro y el badge ya funcionan sobre `pagado`, así que no
hay que tocar nada más.

**En contra:** pierde el porqué. Andrea vería a esa persona como "Pendiente" en su
panel, indistinguible de quien nunca compró. Y sin `estatus` no hay forma de
revertir una disputa ganada salvo volver a poner `pagado: true` a mano.

### Precedente: el webhook de SALA (patrón a copiar)

`sala-studio` (`netlify/functions/stripe-webhook/index.ts`) ya resuelve la forma
de un webhook de Connect con varios eventos. Sus **7 casos**:

| evento | para qué |
|---|---|
| `checkout.session.completed` | alta tras pagar |
| `customer.subscription.deleted` | baja |
| `invoice.paid` + `invoice.payment_succeeded` | renovación (comparten handler) |
| `invoice.payment_failed` | cobro fallido |
| `payment_intent.succeeded` | compra suelta de tienda |
| `account.updated` | estado de la cuenta conectada |

HOGAR escucha hoy solo dos: `checkout.session.completed` y `account.updated`.

Lo que vale la pena copiar es la **estructura**, no los eventos:

- Un `switch` con un `case` por evento y **filtro por `metadata.app` dentro de
  cada rama** (`if (session.metadata?.app !== 'sala') break;`), en vez del filtro
  único y previo que hace `esDeHogar()`. Esto importa para reembolsos: cada tipo
  de objeto guarda la metadata en un sitio distinto, y un filtro global no puede
  con la asimetría de la disputa descrita arriba.
- Dos eventos distintos compartiendo un mismo handler cuando significan lo mismo.
- Firma verificada una sola vez arriba, con `constructEvent` sobre el cuerpo crudo
  — igual que HOGAR ya hace.

**Ojo, no es una implementación de reembolsos.** Se comprobó: ninguno de los 7
eventos es `charge.refunded` ni `charge.dispute.*`. SALA tampoco los maneja. Lo
que aporta es el molde del webhook multi-evento, no la lógica de revocación.

### Qué habría que añadir en Stripe

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

### Qué debería ver la clienta

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

### Resumen de lo que habría que tocar

| Dónde | Qué |
|---|---|
| Stripe Dashboard | Suscribir los tres eventos, en ámbito Connect |
| `stripe-webhook/index.ts` | `case 'charge.refunded'` → revocar |
| `stripe-webhook/index.ts` | `case 'charge.dispute.created'` → expandir el charge para sacar el `user_id` |
| `_lib/stripe.ts` | `esDeHogar()` no sirve para disputas; hace falta otro camino |
| Supabase | Solo si se elige la opción (a): migración de `estatus` |
| `index.html` | El gate y la pantalla de acceso, si se distinguen estados |
| `index.html` | El badge y el filtro del panel, si se elige (a) |

---

## 2 · Contraste de las píldoras `.sect-lab`

**Estado: sin resolver, decisión de paleta global.**
Detectado en agosto de 2026, al reasignar los fondos de la landing.

Las seis píldoras de sección de la landing —"¿QUÉ ES HOGAR?", "TRANSFORMACIÓN",
"¿ES PARA TI?", "— TESTIMONIOS", "TU ESPACIO", "DETRÁS DE HOGAR"— usan
`color:var(--terracota)` sobre fondo claro. El contraste queda **por debajo del
4,5 que pide WCAG AA**, y también del 3,0 de texto grande:

| combinación | ratio |
|---|---|
| terracota `#D88766` sobre salmón claro `#F8DDD0` (píldora de serie) | **2,14** |
| terracota `#D88766` sobre crema claro `#FAF3E5` (píldora de `.cre-sect`) | **2,51** |

Agrava que son 10,4 px en mayúsculas con `letter-spacing:.22em`: texto pequeño,
justo donde el contraste importa más.

**Esto NO es una regresión de ningún cambio reciente.** Es el valor que la píldora
ha tenido siempre. Se anota aquí porque salió a la luz al medir la paleta, no
porque algo lo haya empeorado.

### La corrección, si se decide hacerla

Cambiar el color del texto de `--terracota` a `--terracota-oscuro` (`#B85F3D`):

| combinación | ratio |
|---|---|
| terracota oscuro sobre salmón claro | 3,43 |
| terracota oscuro sobre crema claro | **4,01** |

Sigue sin llegar a 4,5, pero pasa el umbral de 3,0 y casi dobla el actual.

### Por qué no se hizo ya

Es **una sola línea** —el `color` de `.sect-lab` en index.html— pero afecta a las
seis píldoras a la vez, en toda la landing. Es una decisión estética de marca que
oscurece un acento que Andrea eligió, no un arreglo local. La regla acotada
`.cre-sect .sect-lab` que se añadió junto a `.trans-sect .sect-lab` resuelve la
visibilidad de la píldora sobre su fondo nuevo, pero deliberadamente **no toca el
color del texto**: eso es esta decisión, no aquella.

Llegar a 4,5 de verdad exigiría un tono más oscuro que ninguno de la paleta
actual, o engordar la tipografía de la píldora.

---

## 3 · Migrar el vídeo a Bunny Stream

> **DESCARTADO POR COSTE el 8 de agosto de 2026.** Lo que sigue se conserva porque el
> análisis del problema —archivos completos servidos desde Supabase— sigue siendo
> correcto, y porque si algún día el coste deja de ser el obstáculo, el estudio ya
> está hecho.
>
> **`PLAN-CAPA-3.md` vuelve a estar vigente** y es el camino elegido para el agujero
> de seguridad. La parte de coste que Bunny resolvía de serie **sigue abierta**: hoy
> la única palanca es la compresión, que es el pendiente 10.

**Estado original: decidido en agosto de 2026, sin ejecutar.**

Prioridad **media**. No bloquea la venta —los vídeos funcionan hoy— pero conviene
resolverlo antes de tener volumen de clientas.

### El problema

Los 15 vídeos pesan **5,1 GB**. El mayor, `RITMOSUAVE45`, son **729 MB**.

Hoy se sirven como archivos completos desde Supabase Storage, así que cada
reproducción descarga cientos de MB. Eso duele por dos lados a la vez:

- **La usuaria.** Con datos móviles, esperar a que arranque una práctica de 45
  minutos son varios minutos y un pedazo del plan. Muchas cerrarán la app antes
  de empezar.
- **La factura.** Supabase cobra el egress. Cien prácticas al mes son decenas de
  GB. Con un precio de 499 MXN, eso se come el margen deprisa.

### Por qué NO es un problema de compresión

Esto se probó y se descartó, así que **no volver a intentarlo**:

- Se recomprimió `DESCARGASEGURA15` con `crf 28` + `maxrate 2M`: bajó de 297 MB a
  209 MB (**−30%**) con **pérdida de calidad visible**. Descartado.
- El bitrate resultante fue **1759 kbit/s, por debajo del techo de 2M**. Es el
  dato clave: el archivo no estaba tocando el límite, o sea que no le sobraba
  nada. **H.264 ya está exprimido.**
- Se descartó **H.265**: comprime entre un 30 y un 50% mejor, pero no lo
  soportan todos los navegadores Android, y el público de HOGAR es mixto
  iOS/Android.

**Conclusión: el problema no es cómo están comprimidos, es servir archivos
completos.** Ninguna pasada de ffmpeg arregla eso.

### Por qué Bunny Stream

Resuelve cuatro cosas de una vez:

1. **Streaming adaptativo.** Arranca en segundos y ajusta la calidad a la
   conexión, en vez de descargar el archivo entero antes de reproducir.
2. **Más barato** que el egress de Supabase para vídeo.
3. **URLs firmadas con token, incluidas de serie.**
4. Por el punto 3, **hace innecesaria buena parte de `PLAN-CAPA-3.md`.**

### Lo que esto implica para PLAN-CAPA-3.md

`PLAN-CAPA-3.md` propone construir a mano lo que Bunny trae hecho: bucket
privado, URLs firmadas con caducidad y una función que las emita. Ejecutarlo
antes de evaluar Bunny sería trabajo tirado, y además dejaría los vídeos
sirviéndose igual de pesados.

**Evaluar Bunny primero. Después decidir qué queda vivo de ese plan** — la parte
de los audios y las imágenes puede seguir teniendo sentido en Supabase.

---

## 4 · Cambiar el correo desde el perfil

**Estado: decidido NO hacerlo por ahora, agosto de 2026.**

Hoy el correo se muestra en el perfil como texto y no se puede editar. Para
cambiarlo, la clienta escribe a Andrea desde el enlace que hay debajo del campo.

Antes había un formulario de edición, pero **no era alcanzable**: el campo de
email nunca tuvo botón "Editar" —solo el de nombre lo tiene— así que
`editarPerfil('email')` no se llamaba desde ningún sitio. Era marcado muerto,
y su función `guardarPerfil('email')` asignaba `U.email` en memoria y descartaba
el cambio. Todo eso se retiró.

### Por qué no se hizo de verdad

No es difícil, es que arrastra cuatro cosas más y ninguna clienta lo ha pedido
todavía. En un producto de pago único, donde el correo es la llave de acceso,
cambiarlo es raro; el caso frecuente es "me equivoqué al registrarme", y ese se
resuelve mejor escribiéndole a Andrea, que de paso comprueba que el pago siga
atado a la persona correcta.

### ⚠️ Verificar ESTO antes de empezar

**¿El trigger de `auth.users` que rellena `hogar_usuarias` es solo
`AFTER INSERT`?** En Supabase → **Database → Triggers**, sobre `auth.users`: si en
su lista de eventos solo aparece `INSERT`, entonces `hogar_usuarias.email` **no se
actualiza** cuando cambia el correo en `auth.users`.

Eso importa más que todo lo demás, porque `hogar_usuarias.email` es de donde vive
el panel de Andrea: el listado, la ficha y **el diálogo de acceso manual**, que es
donde ella comprueba a quién le está concediendo o revocando el acceso. Un correo
obsoleto ahí no es cosmético: es Andrea decidiendo sobre dinero mirando un dato
falso. También dejaría de funcionar el filtro de `ADMIN_TEST_EMAILS`.

**Implementar el cambio de correo sin resolver esto deja el sistema peor que
ahora.**

### Lo que haría falta

| Dónde | Qué |
|---|---|
| `index.html` | Devolver el formulario y llamar a `supabase.auth.updateUser({ email })` |
| `index.html` | Rama `type=email_change` en el manejador de retorno de enlaces (hoy solo reconoce `type=recovery`, así que la clienta aterrizaría en la landing sin saber si funcionó) |
| Supabase Auth | La URL de retorno en la lista blanca de redirecciones |
| Copy | *Secure email change* está activo por defecto: se mandan **dos** correos, al viejo y al nuevo, y hay que confirmar **los dos**. La interfaz tiene que explicar ese estado y aguantar el limbo sin mentir sobre cuál es su correo |
| Supabase | Migración para sincronizar `hogar_usuarias.email` — un trigger de `UPDATE` sobre `auth.users`, o hacerlo desde una función |

### Alternativa más barata

Si lo que se quiere es solo desatascar casos sueltos, un control en el panel de
Andrea para editar el correo de una clienta es bastante menos trabajo que el
flujo de autoservicio — pero **tiene exactamente el mismo requisito**: cambiar los
dos sitios a la vez, `auth.users` y `hogar_usuarias`.

---

## 6 · Cobro huérfano: pagar y borrar la cuenta antes del webhook

**Estado: resuelto para la ventana realista, no cerrado del todo.** Detectado en
agosto de 2026 al llevar el botón de borrar cuenta al muro; arreglado en agosto de
2026 con `checkout_iniciado_en` (ver `SQL-COBRO-HUERFANO.md`).

> **Qué cubre y qué no.** El arreglo cubre la ventana en la que esto ocurre de
> verdad: los minutos u horas entre pagar y que llegue el webhook. **No** cubre un
> webhook caído durante días — si el endpoint estuviera roto cinco días y ella
> borrara el sexto, la marca ya habría caducado y volveríamos a quedarnos sin
> registro. La cobertura completa pediría **reconciliar contra Stripe**
> periódicamente: listar los cargos de la cuenta conectada y cruzarlos con
> `hogar_usuarias` y `hogar_bajas` para encontrar los que no cuadran. Eso es otra
> tarea, con su propia función programada, y no se ha hecho.
>
> **Un residuo aceptado a sabiendas.** `hogar_cancelar_checkout()` —la RPC que
> apaga la marca cuando Stripe devuelve por `cancel_url`— permite en teoría borrar
> el rastro de un pago **real**: pagar, llamarla desde la consola del navegador y
> borrar la cuenta antes de que llegue el webhook. Esa persona se quedaría sin fila
> en `hogar_bajas`. No se tapa porque **el cargo sigue en Stripe con
> `metadata.user_id`**: `hogar_bajas` no es la prueba del cobro, es un atajo para
> encontrarlo. Taparlo pediría que la cancelación pasara por una función de Netlify
> que consultara a Stripe antes de apagar nada — mucho aparato contra alguien que
> necesita saber SQL para perjudicarse a sí mismo.
>
> Lo que queda abajo es la descripción del problema original y del camino que se
> siguió; se conserva porque explica por qué el arreglo es como es.

### La secuencia

1. La clienta paga. Stripe cobra.
2. El webhook tarda. `hogar_usuarias.pagado` sigue en `false`, así que el muro la
   retiene y le enseña el estado ESPERAR.
3. Se impacienta y borra su cuenta desde ahí.
4. `hogar_borrar_datos_usuaria` **no crea fila en `hogar_bajas`**: solo la crea
   `IF v_u.pagado IS TRUE`, y todavía no lo era.
5. El webhook llega, `acreditarPago` no encuentra la fila, avisa por consola y se
   va sin hacer nada.

**Resultado: dinero cobrado, sin cuenta a la que acreditarlo y sin ningún registro
en la base.** El cargo solo existe en Stripe. Si esa persona reclama —o el banco
lo hace por ella— no hay forma de resolverlo desde HOGAR.

### Lo que ya lo mitiga

El diálogo de borrado detecta el pago en vuelo (por la marca
`hogar_pago_en_vuelo` de `localStorage`) y enseña un aviso propio: *"Tu pago
todavía se está confirmando… espera unos minutos, o escríbenos antes de borrar"*.

**Reduce la probabilidad, no la elimina.** Si insiste, borra igual. Y la marca es
**por dispositivo**: si pagó en el móvil y borra desde el portátil, no hay aviso
ninguno.

### El arreglo de verdad

El problema de fondo es que **la única prueba de que hay un pago en vuelo vive en
el navegador**, y la base de datos no puede consultarla. Hay que dejar rastro del
lado del servidor:

| Dónde | Qué |
|---|---|
| Supabase | Una columna en `hogar_usuarias` — por ejemplo `checkout_iniciado_en timestamptz` |
| `crear-checkout` | Escribirla justo antes de devolver la URL de la sesión de Stripe |
| `hogar_borrar_datos_usuaria` | Crear la baja también si `checkout_iniciado_en` es reciente (una hora basta: una sesión de Checkout caduca sola), aunque `pagado` siga en `false` |
| `stripe-webhook` | Al acreditar, limpiarla |

Con eso, quien pagó y borró deja su fila mínima igual, el webhook tiene dónde
mirar, y el aviso del diálogo deja de depender del `localStorage` del dispositivo.

**De paso resuelve otra cosa**: esa misma columna es la que haría el estado
ESPERAR del muro a prueba de dispositivos, que hoy también depende del
`localStorage` (ver el comentario de `PAGO_EN_VUELO_KEY` en `index.html`).

### Por qué no se hizo ya

Andrea no tiene clientas todavía, y la secuencia exige que coincidan un webhook
lento y una clienta impaciente en el mismo minuto. Pero **es anterior a tener
volumen**: cuanto más se venda, antes ocurre.

---

## 7 · El editor del cuestionario no debe dejar reordenar los ids de p1

**Estado: no aplica todavía.** El cuestionario (`QUEST_TREE`) es una constante del
código y solo se toca en un despliegue; el editor de **Contenido** del panel edita
los textos de las prácticas, no las preguntas. Esto es una restricción de diseño
**para el día que ese editor exista**, anotada en agosto de 2026 al congelar las
preguntas en el historial.

### El riesgo

Cada opción de `p1` tiene un `id` — `"A"`, `"B"`, `"C"`, `"D"` — que hace dos
trabajos a la vez:

1. **Es la respuesta que se guardó** en las filas anteriores a agosto de 2026.
2. **Es la llave que elige la rama** de `p2`, `p3` y `p4`.

Cambiar el texto de una pregunta es inofensivo: el historial viejo se repinta con
la versión nueva de la misma pregunta. Pero **reordenar o reciclar un id convierte
la respuesta de alguien en otra distinta**. Sin error, sin aviso: el historial
simplemente pasa a decir que respondió algo que no respondió.

Desde que las preguntas se congelan al cerrar (`congelarQA`), las prácticas nuevas
son inmunes. Las viejas no, y **no se pueden migrar**: el texto que aquellas
usuarias vieron no se guardó en ningún sitio. El riesgo se extingue solo, cuando
esas filas dejen de importar — pero no hay fecha.

### Cómo debe diseñarse el editor

Que la restricción no dependa de que quien lo use se acuerde:

| Regla | Por qué |
|---|---|
| El id **no se muestra ni se edita**. Se asigna solo al crear la opción | Si no está en la pantalla, no se puede tocar |
| Añadir una opción toma **el siguiente id no usado nunca** (E, F, G…), no el primero libre | Un id reciclado reescribe el pasado; uno sobrante no rompe nada |
| Quitar una opción la marca como retirada y **conserva su rama** | Las filas viejas que la respondieron siguen resolviéndose |
| Reordenar mueve la **posición visual**, nunca el id | Es lo que Andrea querrá hacer, y debe ser seguro |

Dicho de otro modo: **el orden en pantalla y la identidad de la opción tienen que
ser dos cosas separadas.** Hoy son la misma, y por eso hay que tener cuidado a
mano.

### Mientras tanto

La regla está escrita junto a `QUEST_TREE` en `index.html`, que es donde se edita
hoy y donde la va a leer quien lo toque.

---

## 9 · Los textos de la landing no son editables, y una columna por texto no escala

**Estado: sin implementar, a la espera de una decisión de contenido.** Anotado el 8
de agosto de 2026, al pedir Andrea dos cambios de texto que hubo que hacer en código.

### Qué es editable hoy

De toda la landing, solo tres cosas: el **título** y el **subtítulo** del hero
(`landing_hero_titulo`, `landing_hero_subtitulo`) y el **precio**. Más las seis fotos.
Todo lo demás —"¿Es para ti?", "Detrás de HOGAR", los testimonios, las preguntas
frecuentes, "Lo que empieza a cambiar", "Cómo funciona"— vive en `index.html` y solo
cambia con un despliegue.

### Por qué no se resuelve añadiendo columnas

Es lo que se ha venido haciendo, y ya son **ocho columnas** en `hogar_config` entre
textos e imágenes. Cada petición nueva añadiría una o dos más. Con veinte columnas
nadie sabría cuál corresponde a qué trozo de la página, y el editor sería una lista
de campos sin estructura.

### La forma que propongo

Una tabla **por slot**, no por columna:

```
hogar_landing_textos (
  slot        text PRIMARY KEY,   -- 'parati.entradilla', 'cre.parrafo2'…
  texto       text NOT NULL,
  updated_at  timestamptz
)
```

Con el mismo patrón ya probado en el cuestionario: **respaldo en el código** —si la
tabla está vacía o Supabase no responde, se ve lo que hay en `index.html`—, escritura
por una **función que valida** en vez de por policy, y la edición dentro de la sección
"Tu landing" que ya existe.

### La decisión que falta, y es de contenido, no técnica

**Qué texto es voz y qué texto es estructura.**

- *Voz*: el párrafo de "Detrás de HOGAR", la entradilla de "¿Es para ti?", los
  testimonios. Cambiarlos es escribir.
- *Estructura*: los cuatro pasos de "Cómo funciona", los títulos de sección, la lista
  de la tarjeta de precio. Cambiarlos es rediseñar, y desde un campo de texto se
  rompe la página sin darse cuenta.

Mezclarlos sería darle a Andrea un panel donde puede romper la landing sin verlo
venir. Hasta que esa lista esté decidida con ella, no hay nada que construir: el
trabajo técnico es el de siempre y está probado; lo que falta es saber qué entra.

---

## 10 · Comprimir los vídeos: descartado por una medición que no probó los ajustes recomendados

**Estado: sin probar, no descartado.** Separado de `PLAN-CAPA-3.md` el 8 de agosto de
2026, al retomar ese plan.

### Por qué importa ahora

Con **Bunny descartado por coste** (pendiente 3), la salida de datos sigue siendo de
Supabase. Las URLs firmadas del plan de capa 3 cierran el agujero de que se compartan
los enlaces, pero **no reducen la transferencia ni un byte**: un vídeo de 45 minutos
sigue moviendo ~1,4 GB cada vez que alguien lo reproduce.

| Plan Supabase | Salida/mes | Prácticas de 45 min |
|---|---|---|
| Free | 5 GB | **3** |
| Pro | 250 GB | ~175 |

**La compresión es la única palanca que queda** sobre el coste de operar esto.

### La contradicción que hay que resolver

`PLAN-CAPA-3.md` llegó a llevar un aviso diciendo que la recompresión se había
descartado por medición, citando esta prueba sobre `DESCARGASEGURA15`:

> `crf 28` + `maxrate 2M` → −30% con pérdida visible, y el bitrate por debajo del
> techo: «H.264 ya está exprimido».

**Pero eso no es lo que el plan recomienda.** La recomendación es `crf 23 -preset
slow` **sin techo de bitrate**, y un `maxrate` bajo es justo lo que produce pérdida
visible sin ahorrar tanto: fuerza al codificador a tirar calidad en los momentos de
más movimiento en vez de dejarle repartir.

O sea que **la medición registrada no refuta la recomendación**. Puede que al medirla
bien tampoco compense —el material podría estar ya razonablemente codificado—, pero
hoy eso no está probado, y la nota de "descartado" daba por cerrado algo que no se
llegó a intentar.

### Qué haría falta para cerrarlo

Una sola medición honesta, sobre el peor caso:

1. Codificar `DESCARGASEGURA15` con los ajustes del apéndice de `PLAN-CAPA-3.md`
   (`crf 23 -preset slow -r 30 -movflags +faststart`), **sin `maxrate`**.
2. Medir VMAF contra el original. Referencia: ≥ 93 es indistinguible para la mayoría.
   Ojo con los cinco vídeos a 60 fps, donde comparar contra un original de 60 da un
   VMAF falsamente bajo.
3. Verlo en un teléfono, dentro de la app. Ninguna métrica sustituye a eso.

Con eso se sabe si el −65% estimado es real o si el material ya estaba exprimido. Es
media tarde de cómputo y **no toca ni una línea de código**.

### Independiente de la seguridad

Se puede hacer antes, después o nunca del plan de capa 3. Lo único que las relaciona
es que probar la capa 3 reproduce vídeos, y hacerlo con archivos de 1,4 GB quema
ancho de banda — así que si se va a comprimir, sale más barato hacerlo antes.

## 11 · Andrea se cuenta a sí misma en sus métricas

**Estado: sin resolver, a la espera de una decisión de Andrea.** Detectado el 8 de
agosto de 2026, al arreglar que `firmar-practica` la dejaba fuera de sus propias
prácticas.

### El problema

`ADMIN_TEST_EMAILS` excluye de las métricas del panel cuatro correos de prueba. **El
de Andrea no está en esa lista.** Así que sus propias sesiones cuentan como si fuera
una clienta:

| Dónde | Qué pasa |
|---|---|
| "Prácticas de hoy" | Suma las suyas |
| "Prácticas este mes" | Igual |
| "Altas del mes" | Ella misma cuenta como alta |
| Lista de usuarias | Aparece entre sus clientas |
| Retención de 7 días | Su actividad infla el numerador |

### Por qué importa AHORA y no antes

Hasta el 8 de agosto de 2026 Andrea **no podía reproducir prácticas**: la función que
firma las direcciones comprobaba solo `pagado`, y su fila dice `pagado = false`. Al
arreglarlo, ya puede — y va a hacerlo, porque necesita revisar el contenido y grabar
material nuevo. **Cada revisión ensucia sus cifras.**

Con cero clientas todavía, además, el ruido es del 100%: si hace tres prácticas para
revisarlas, su panel dirá que hubo tres prácticas.

### Por qué no se arregló de una

Porque **meterla en `ADMIN_TEST_EMAILS` sería mentir**: esa constante significa
"correos de prueba que no son clientas reales", y Andrea no es un correo de prueba —
es la dueña. Un nombre que miente hoy es un bug mañana, cuando alguien lea la lista y
no entienda por qué está ella ahí.

Lo que hace falta es separar los dos conceptos:

```
ADMIN_TEST_EMAILS   → correos de prueba (los cuatro de siempre)
ADMIN_EMAIL         → la dueña (ya existe, se usa en esAdmin)
_admExcluidosDeMetricas() → la unión de los dos
```

Y que las cuatro consultas de `loadAdmin()` usen esa unión en vez de la lista de
pruebas.

### La decisión que falta, y es suya

**¿Quiere Andrea verse en sus propias cifras, o no?**

Lo esperable es que no: el panel existe para mirar el negocio, y ella no es clienta.
Pero es su panel, y puede que prefiera ver su actividad ahí en vez de en ningún sitio.

Si la respuesta es "no verse", hay una segunda pregunta: ¿solo de las **métricas**, o
también de la **lista de usuarias**? Son dos cosas distintas y puede querer respuestas
distintas — verse en la lista tiene sentido para probar el flujo de acceso manual
sobre su propia cuenta.

---

---

# Cerrados

No son pendientes. Se dejan escritos porque costaron trabajo diagnosticar y
porque, si el síntoma vuelve, esto ahorra repetir la búsqueda.

## Banda blanca bajo el header sticky en móvil — cerrado el 6 de agosto de 2026

**Síntoma reportado:** al hacer scroll en iPhone aparecía una banda de blanco puro
justo debajo del header fijo.

**No es reproducible hoy, y la causa está identificada.** No fue un artefacto de
scroll de Safari: hasta el commit `a20c360` (5 de agosto, 15:20:52) la regla móvil
decía

```css
.prev-sect{background:var(--white) !important;}
```

`#sec-prev` es la sección que queda bajo el header al desplazarse, y `--white` es
`#FFFFFF`. Un header sticky en `--salmon-claro` (`#F8DDD0`) sobre blanco puro
produce exactamente esa banda. `a20c360` la pasó a `--crema-claro` como parte de
la armonización de fondos, y el síntoma desapareció con ella.

**Por qué se buscó en vano al principio:** las capturas eran de las 15:22, dos
minutos después de `a20c360`, así que mostraban el estado **anterior** al commit
—Netlify no había desplegado todavía— mientras que la búsqueda se hizo sobre el
código ya corregido. Ahí no había nada blanco porque ya se había arreglado.

**Lección:** al diagnosticar a partir de capturas, fijar primero la hora de la
captura contra la hora del último despliegue. Tres de los cinco síntomas de aquel
reporte resultaron ser estados ya corregidos o efectos de commits recientes.

**Si reaparece:** mirar primero qué sección queda bajo el header en ese punto del
scroll y cuál es su fondo efectivo en `@media(max-width:480px)`. El header es
`.hero-scapes-header`, `position:sticky` con `z-index:999`.

## Policies en el rol `public` — cerrado el 6 de agosto de 2026

**Hecho.** Trece `ALTER POLICY … TO authenticated` corridos y verificados:
**17 de 17** las policies de `hogar_*` quedaron en `{authenticated}`, ninguna en
`{public}`, y las expresiones sin tocar.

**Qué se cambió**: las tres de `hogar_sesiones` que faltaban, `andrea_ve_todo` de
`hogar_usuarias`, las dos de `hogar_config`, las cuatro de `hogar_notas` y las
tres de `hogar_practica_textos`.

**Por qué no era urgente pero sí correcto**: en Postgres, `public` significa
«todos los roles», así que `anon` entraba en el alcance. Las expresiones ya lo
cerraban —`auth.uid()` es `NULL` sin sesión y `auth.role()` devuelve `'anon'`—,
pero eso hacía que la seguridad dependiera de que cada expresión estuviera bien
escrita. Con `TO authenticated`, un error futuro en un `USING` falla cerrado para
los visitantes anónimos.

**La convención que queda, y esto es lo que importa conservar:** cualquier policy
nueva sobre una tabla `hogar_*` se escribe **`TO authenticated`**, no `TO public`.

**La excepción a tener presente:** `hogar_landing` no aparece en esa lista porque
es una **vista**, y se lee **sin sesión** al cargar la página
(`precargarLandingHogar()`, antes de `_authInit()`). Si algún día se le pone RLS o
se sustituye por una tabla, **debe seguir siendo legible por `anon`** o la landing
deja de mostrar precio y textos a todo visitante que no haya entrado. Ese fue el
motivo de comprobar tabla por tabla en vez de aplicar el cambio a ciegas.

## El paso 5 del cuestionario — construido el 7 de agosto de 2026

Estuvo abierto como pendiente 8 unas horas: los veinte textos de cierre existían en
`QUEST_TREE` y **no los leía nadie**, porque `Q_TOTAL_STEPS` valía 4 y el nodo del
paso 5 nunca se dibujó.

**Se construyó en vez de borrarse**, y la razón fue una: en las cinco emociones, la
cuarta rama es la de quien termina peor —*se intensificó*, *quedé más vacía*, *se
abrió más*— y su texto es el más largo y el que desactiva la culpa (*«No fallaste, no
exageraste, no pasaste de la línea»*). Es contención para el momento en que la
práctica destapó algo, y **era justo quien se quedaba sin nada**.

Qué se tocó: `Q_TOTAL_STEPS` a 5, el nodo del paso 5 en `renderQ()` —con el cierre de
la rama, el texto opcional detrás de un botón y *Terminar*—, y la sección del paso 5
en el editor del panel, que pasó de 56 a 60 campos.

De paso se arregló que `prevQ()` perdía lo escrito al volver atrás desde el cierre.

Y quedó vivo `answers.p5write`, que hasta entonces nunca se rellenaba: ahora llega al
guardado, se congela en `qa` y se ve en el historial.

