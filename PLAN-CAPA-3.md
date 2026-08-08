# Plan — capa 3: bucket privado y URLs firmadas

Cierra el hallazgo #1 de la auditoría: hoy los vídeos y audios están en un bucket
**público** con nombres predecibles (`{SLUG}{minutos}.mp4`), así que se descargan
con el enlace directo **sin sesión siquiera**. El muro que existe hoy vive en el
navegador: disuade a quien usa la app con normalidad y no detiene a nadie con la
consola abierta.

Revisado el 8 de agosto de 2026, con Bunny Stream descartado por coste. El aviso de
"superado por Bunny" que encabezaba este documento se ha quitado: el plan vuelve a
estar vigente.

**La compresión ya no vive aquí.** Era la fase 0 y se ha separado —ver el pendiente
10 y el apéndice del final—: es independiente de la seguridad y la duda sobre si
compensa no debe bloquear el cierre del agujero.

Marca cada fase al completarla. Nada aquí se ha ejecutado todavía.

---

## Inventario real (medido en agosto de 2026)

### Contenido de pago — 30 archivos, 12,32 GB

Los 30 existen. Los tres audios de 30 min que faltaban (`RITMOSUAVE30`,
`PRESENCIA30`, `DESCARGASEGURA30`) ya están subidos: el inventario está completo.

| Archivo | Res | fps | v.bitrate | Duración | Tamaño | MB/min |
|---|---|---|---|---|---|---|
| RITMOSUAVE15 | 1080p | 30 | 3,82 Mb | 15,7 m | 446 MB | 28,3 |
| RITMOSUAVE30 | 1080p | 30 | 3,12 Mb | 33,0 m | 770 MB | 23,3 |
| RITMOSUAVE45 | 1080p | **60** | 4,00 Mb | 45,0 m | 1333 MB | 29,6 |
| PRESENCIA15 | 1080p | **60** | 4,00 Mb | 15,3 m | 452 MB | 29,6 |
| PRESENCIA30 | 1080p | 30 | 3,31 Mb | 30,1 m | 743 MB | 24,7 |
| PRESENCIA45 | 1080p | **60** | 4,00 Mb | 45,1 m | 1335 MB | 29,6 |
| RECUPERACIONSUAVE15 | 1080p | 30 | **1,00 Mb** | 15,1 m | 123 MB | **8,2** |
| RECUPERACIONSUAVE30 | 1080p | 30 | 1,45 Mb | 30,1 m | 342 MB | 11,4 |
| RECUPERACIONSUAVE45 | 1080p | **60** | 4,00 Mb | 45,3 m | 1341 MB | 29,6 |
| CONTENCION15 | 1080p | 30 | 1,42 Mb | 15,0 m | 167 MB | 11,2 |
| CONTENCION30 | 1080p | 30 | 4,00 Mb | 30,3 m | 895 MB | 29,6 |
| CONTENCION45 | 1080p | **60** | 4,00 Mb | 45,8 m | 1357 MB | 29,6 |
| DESCARGASEGURA15 | 1080p | **60** | **6,26 Mb** | 16,6 m | 759 MB | **45,8** |
| DESCARGASEGURA30 | 1080p | 30 | 3,99 Mb | 30,3 m | 895 MB | 29,6 |
| DESCARGASEGURA45 | 1080p | 30 | 4,00 Mb | 45,3 m | 1339 MB | 29,6 |

Los 15 audios `.mp3` suman ~360 MB (14-32 MB cada uno). No hace falta tocarlos.

**Todos son H.264 High, yuv420p, 1920×1080, con pista AAC propia de ~128 kbps**
(además del `.mp3` de voz que la app superpone: son dos audios distintos).

### Lo que dice esta tabla

1. **Los ajustes de exportación derivaron.** El mismo tipo de material va de 1,00 a
   6,26 Mbps — **5,6× de diferencia** entre `RECUPERACIONSUAVE15` y
   `DESCARGASEGURA15`. Eso no es una decisión de calidad, es que se exportó con
   distintos ajustes en distintos momentos.
2. **Cinco vídeos están a 60 fps** sin motivo: son prácticas de movimiento guiado,
   cuerpo en plano, sin acción rápida. 30 fps sobra y ahorra la mitad de fotogramas.
3. **`RECUPERACIONSUAVE15` es la prueba de que se puede.** Lleva meses en
   producción a 1,00 Mbps y nadie se ha quejado. Es el mismo tipo de plano que los
   que van a 4 Mbps.
4. **El faststart es inconsistente**: `RITMOSUAVE15` NO lo tiene (el índice `moov`
   está al final, así que el navegador descarga casi todo antes de empezar);
   `CONTENCION45` sí. Se arregla gratis al recodificar.

### Marca y landing — 8 archivos reales, 7,8 MB

> **Desactualizado.** Este inventario es de antes del recortador y de la sustitución
> del retrato. La lista viva y comprobada son los **nueve** archivos de la fase 1.

`LOGOHOGAR_qasyyc.png`, `hero-andrea.jpg`, `hero-andrea-vertical-NUEVA.jpg`,
`hero-meditacion.jpg`, `IMG_9251_wrlvvu.jpg` y tres `ideogram-*`.

Otras **4 imágenes referenciadas en el código no existen** en el bucket
(`4_zgnxw3.webp`, `5_qlsvxi.webp` y dos `ideogram`). Las dos primeras son las
clases CSS `.IMG4`/`.IMG5`, **que no usa ningún elemento**: CSS muerto apuntando a
archivos muertos. No rompe nada; limpiarlo es opcional.

---

---

## La decisión que da forma al plan

Lo obvio sería mover el contenido de pago a un bucket privado: **12,32 GB**.

Lo correcto es al revés: **mover los 7,8 MB de marca a un bucket público nuevo y
volver privado el `hogar` actual.** Mismo resultado, 1.500 veces menos que mover.

Los 12 GB **no se mueven nunca**.

---

---

## FASE 0 — Las policies de `storage.objects` *(David, SQL)* ✅ HECHA

**Comprobado el 8 de agosto de 2026, y el resultado no fue el esperado.**

La versión anterior de esta fase daba por hecho que existía una policy demasiado
permisiva (`hogar_bucket_listar` para todo `authenticated`), heredada de
`SQL-CONTENIDO.md`, que en un bucket privado sería la puerta de atrás: las descargas
de un bucket privado pasan por `/object/authenticated/…` y comprueban esa misma
policy.

**No existía.** Nunca se creó. Sobre `storage.objects` solo había dos policies, las
dos atadas al uid de Andrea:

| Policy | Qué |
|---|---|
| `hogar_andrea_update` | UPDATE sobre `hogar`, solo su uid |
| `hogar_andrea_upload` | INSERT sobre `hogar`, solo su uid |

Ninguna con `to public`, así que tampoco había lectura anónima por esa vía.

### La otra cara, que sí era un problema

No había **ninguna** policy de SELECT. Y eso significa que `list()` devolvía `[]`
**hasta para Andrea**. El código ya lo sabía —hay un comentario en `loadContenido()`
que dice literalmente *«un `[]` por falta de policy»*— y cae a su modo de respaldo:
**sondear con HEAD las URLs públicas**.

O sea que el inventario del panel funciona hoy **solo porque el bucket es público**.
Al volverlo privado morirían los dos caminos a la vez —el listado por falta de
policy, el sondeo por falta de bucket público— y diría "0 de 30 archivos".

Así que la fase se dio la vuelta: **no había que restringir una policy, había que
crear una.**

### El SQL que se corrió

```sql
-- ============================================================================
-- HOGAR — capa 3, fases 0 y 1.  Bucket privado y bucket público nuevo.
-- Idempotente: se puede correr dos veces sin efecto.
--
-- Estado de partida (comprobado el 8 de agosto de 2026): sobre storage.objects
-- solo existen hogar_andrea_update y hogar_andrea_upload, las dos atadas al uid
-- de Andrea. NO hay ninguna policy de SELECT, ni ninguna con `to public`.
-- ============================================================================

-- ── 1) LECTURA DEL BUCKET PRIVADO, SOLO PARA ANDREA ─────────────────────────
--
-- Hoy no existe ninguna policy de SELECT, y por eso `list()` devuelve [] hasta
-- para Andrea. El panel lo sabe y cae a su modo de respaldo: sondear con HEAD
-- las URLs PÚBLICAS. Eso funciona solo mientras el bucket sea público.
--
-- Al volverlo privado mueren los dos caminos a la vez —el listado por falta de
-- policy, el sondeo por falta de bucket público— y el inventario diría "0 de 30".
-- Esta policy es lo que deja vivo el primero.
--
-- Se ata al uid y no al correo, igual que las dos que ya existen: el correo se
-- puede cambiar desde Supabase Auth, el uid no.
--
-- OJO: esto NO abre la puerta a las clientas. Da SELECT solo a Andrea, así que
-- ninguna otra cuenta autenticada puede leer ni descargar por la vía
-- /object/authenticated/. Las clientas entran por URL firmada, que la emite una
-- función con service_role y no pasa por RLS.
DROP POLICY IF EXISTS hogar_andrea_listar ON storage.objects;
CREATE POLICY hogar_andrea_listar ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'hogar' AND auth.uid() = 'f749320b-bec8-4b60-9de2-1b5fe79c6fcd');

-- ── 2) EL BUCKET PÚBLICO NUEVO ──────────────────────────────────────────────
--
-- Aquí van los 9 archivos de marca. El bucket es público, así que la LECTURA no
-- pasa por RLS y no hace falta policy para que la landing se vea.
--
-- La escritura sí, y va atada al uid de Andrea igual que en `hogar`. El plan
-- original proponía `to authenticated` a secas: eso dejaría a CUALQUIER cuenta
-- registrada subir archivos a un bucket público servido desde el dominio de
-- HOGAR. No es el agujero de los vídeos, pero es un sitio donde alojar lo que
-- sea a costa de Andrea.
DROP POLICY IF EXISTS hogar_publico_subir ON storage.objects;
CREATE POLICY hogar_publico_subir ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'hogar-publico' AND auth.uid() = 'f749320b-bec8-4b60-9de2-1b5fe79c6fcd');

-- Reemplazar una foto por otra con el mismo nombre es un UPDATE, no un INSERT.
-- Hoy no ocurre —cada subida lleva su timestamp— pero sin esto un upsert fallaría
-- con un error de permisos difícil de leer.
DROP POLICY IF EXISTS hogar_publico_actualizar ON storage.objects;
CREATE POLICY hogar_publico_actualizar ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'hogar-publico' AND auth.uid() = 'f749320b-bec8-4b60-9de2-1b5fe79c6fcd');

-- El panel también lista este bucket al previsualizar. Mismo criterio.
DROP POLICY IF EXISTS hogar_publico_listar ON storage.objects;
CREATE POLICY hogar_publico_listar ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'hogar-publico' AND auth.uid() = 'f749320b-bec8-4b60-9de2-1b5fe79c6fcd');
```

### Por qué el `insert` del bucket público va atado al uid

La versión anterior de este plan proponía `for insert to authenticated with check
(bucket_id = 'hogar-publico')`, sin comprobar quién. Con las dos policies existentes
delante se ve que desentona: las de `hogar` van atadas al uid.

Dejarlo abierto permitiría a **cualquier cuenta registrada** subir archivos a un
bucket público servido desde el dominio de HOGAR. No es el agujero de los vídeos,
pero es un sitio gratis donde alojar lo que sea a costa de Andrea.

### Verificación

```sql
SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid)      AS lectura,
       pg_get_expr(polwithcheck, polrelid) AS escritura
  FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
 ORDER BY polname;
```

Deben salir **seis**, todas con el uid dentro y ninguna con `to public`.

Probado además en un Postgres local reproduciendo las dos policies originales:
7 comprobaciones, 7 correctas. Andrea lista el bucket privado; una clienta
autenticada no ve nada; `anon` tampoco; Andrea sube al público; una clienta no puede
subir ni al público ni al privado.

> **Nadie puede BORRAR objetos**: no hay policy de DELETE, ni la había antes. Si
> algún día hay que borrar un archivo, se hace desde el panel de Supabase, no desde
> la app.

- [x] Listadas las policies actuales
- [x] Creada `hogar_andrea_listar` (SELECT sobre `hogar`, solo su uid)
- [x] Creadas las tres de `hogar-publico`, todas atadas al uid
- [ ] El inventario del panel sigue funcionando como Andrea

---

## FASE 1 — Bucket público nuevo *(David, panel)*

Storage → **New bucket** → nombre `hogar-publico`, marcar **Public bucket** →
Create.

Las policies de escritura ya están puestas (fase 0). Solo queda **copiar** (no
mover) los archivos de marca: en `hogar`, seleccionarlos → *Download*; entrar a
`hogar-publico` → *Upload files*.

### Los archivos — son NUEVE, no ocho

La versión anterior de este plan decía ocho, y se escribió antes de que existiera el
recortador. **Andrea ya subió dos fotos con él, y son las que el sitio sirve hoy.**

| # | Nombre exacto | KB | Qué es |
|---|---|---|---|
| 1 | `LOGOHOGAR_qasyyc.png` | 649 | El logo. Sale en 19 sitios |
| 2 | `hero-andrea.jpg` | 432 | Hero de escritorio |
| 3 | `hero-andrea-vertical-NUEVA.jpg` | 221 | Hero de celular |
| 4 | `hero-meditacion.jpg` | 336 | Respaldo de "Tu foto" |
| 5 | `andrea-perfil.webp` | 106 | Respaldo del retrato |
| 6 | `andrea-chat-1786120884226.webp` | 106 | **"Tu foto" en vivo** |
| 7 | `andrea-perfil-1786120873420.webp` | 106 | **El retrato en vivo** |
| 8 | `ideogram-v3.0_Cozy_minimalist_home_yoga_practice_space_serene_modern_house_interior_soft_natur-2.jpg_bvurmm.png` | 955 | Fondo de "Lo que empieza a cambiar" |
| 9 | `ideogram-v3.0_Serene_cozy_minimalist_home_reflection_space_empty_tranquil_room_no_people_warm_-2.jpg_nymnzl.png` | 816 | Fondo de "Tu espacio te espera" |

**3,6 MB en total.** Los dos nombres largos van literales, con el `.jpg` en medio y
el sufijo: no son erratas, así se subieron.

**Las 6 y 7 son las que el plan viejo no conocía.** Si se copian solo las ocho de
entonces, la foto y el retrato de Andrea se rompen en cuanto el bucket sea privado.

**Las 4 y 5 también, aunque la base ya no las use.** Siguen escritas en el código
como red de seguridad: son lo que se ve si la consulta a Supabase falla. Sin ellas
en el bucket público, ese respaldo sería una imagen rota.

**`IMG_9251_wrlvvu.jpg` NO se copia.** Es el retrato de 3,7 MB que se sustituyó por
`andrea-perfil.webp`: cero referencias en el código. Se queda en `hogar`, donde no
molesta.

**Reversible**: borrar el bucket; nada apunta ahí todavía.

- [ ] Bucket creado y público
- [ ] Los 9 archivos copiados, con sus nombres exactos
- [ ] Comprobado que los 9 dan 200 desde `hogar-publico`

---

## FASE 2 — El código apunta la marca al bucket nuevo *(Claude)*

**El alcance creció desde la versión anterior**, que hablaba de "~16 referencias y
tres fotos". Hoy son:

| Qué | Dónde |
|---|---|
| **40 apariciones** de `public/hogar/` | por todo `index.html` |
| `_fotoOptimizada()` | lleva la ruta del bucket escrita dentro (`MARCA`) |
| `_fotoOriginal()` | lo mismo, en sentido inverso |
| `subirFotoHogar()` | sube con `.from('hogar')` y resuelve con `getPublicUrl` |
| Las **seis** fotos editables | eran tres cuando se escribió el plan |
| El recortador | lee la foto actual por CORS desde la URL pública |

### El transformador de imágenes solo funciona en buckets públicos

Desde que se escribió este plan, **todas** las imágenes pasan por `/render/image/`.
Ese endpoint es de buckets públicos. Si `hogar` se vuelve privado sin haber
actualizado los normalizadores, **se cae toda la imagen de la landing**, no solo las
fotos de Andrea.

No es un riesgo, es trabajo: las imágenes de marca viven en `hogar-publico`, así que
basta con que los normalizadores apunten ahí. Pero olvidarlo rompe la portada.

**Verificar:** la landing en ventana privada, y que "Cambiar foto" y "Recortar"
sigan funcionando en las seis.

**Reversible**: revertir el deploy.

- [ ] Las 40 referencias apuntan a `hogar-publico`
- [ ] Los dos normalizadores actualizados
- [ ] Subida y recorte funcionando en las seis fotos
- [ ] Landing correcta sin sesión

---

## FASE 3 — Firmar URLs, con `hogar` todavía público *(Claude)*

Una Netlify Function nueva que:

1. Autentica el JWT de la clienta.
2. **Comprueba `pagado`** contra la base (ver más abajo por qué solo eso).
3. Devuelve las URLs firmadas del vídeo **y del audio** con `createSignedUrls` — en
   plural, una sola llamada para los dos, misma caducidad.

**Aquí el muro deja de ser cosmético.** Un `if` en el navegador se salta con la
consola; esto no.

### El audio ya no se puede derivar del vídeo

Hoy `practiceAudioURL()` construye su URL reemplazando `.mp4` por `.mp3` sobre la
del vídeo. Con URLs firmadas **cada objeto lleva su propio token**, así que esa
derivación deja de funcionar. La función devuelve las dos y el cliente deja de
derivar.

La sincronía no se ve afectada: `_reconcileAudio()` compara `currentTime` entre los
dos elementos y eso es independiente de cómo se obtuvo cada `src`.

### Dos cosas más que hay que mover al servidor

- **El aviso "en preparación"**: hoy `_vpClasificarFallo()` hace un HEAD desde el
  cliente y lee 404/400 como "falta el archivo". Con bucket privado eso deja de
  distinguir. Lo natural es que lo diga la función: si no puede firmar ese objeto,
  es que no está.
- **El inventario del panel**: `_admSondearMedios()` sondea con HEAD público y
  diría "0 de 30". La salida es usar solo `list()`, que ya existe como MODO 1 y sí
  funciona en buckets privados con la policy de la fase 0.

**Verificar:** una práctica entera, y que una cuenta sin pagar reciba 403.

**Reversible**: revertir el deploy. Con el bucket aún público, el vídeo se
reproduce igual mientras tanto.

- [ ] Function desplegada
- [ ] Práctica completa reproducida con URL firmada
- [ ] Audio sonando y sincronizado
- [ ] Una cuenta sin pagar recibe 403
- [ ] El inventario del panel sigue contando 30
- [ ] El aviso "en preparación" sigue saliendo cuando falta un archivo

---

## FASE 4 — Volver `hogar` privado *(David, panel)*

Storage → `hogar` → **Configuration** → desmarcar **Public bucket** → Save.

**Comprobación:** abre en ventana privada
`https://…/storage/v1/object/public/hogar/RITMOSUAVE15.mp4`. **Debe dar error.**
Si sigue dando 200, el cambio no se aplicó.

**Y la que de verdad importa:** entra con una cuenta registrada **sin pagar** e
intenta esa misma URL por la vía autenticada. Si la descarga, la policy de la fase 0
no está bien puesta.

**Reversible**: volver a marcarlo. Las URLs firmadas siguen siendo válidas sobre un
bucket público, así que la vuelta atrás no rompe nada.

- [ ] Bucket privado
- [ ] La URL pública ya no sirve
- [ ] Una cuenta registrada sin pagar tampoco puede descargar
- [ ] La landing sigue bien (usa el otro bucket)
- [ ] Las prácticas siguen reproduciéndose

---

## FASE 5 — Limpieza *(opcional, semanas después)*

Borrar de `hogar` las copias de marca que quedaron duplicadas.

**⚠️ Único paso irreversible de todo el plan.** No aporta nada salvo 8 MB. Puede no
hacerse nunca.

- [ ] *(opcional)* Copias borradas

---

## La caducidad de las URLs firmadas — 4 horas

Un `<video>` **no descarga el archivo de una vez**: va pidiendo trozos con *range
requests*, y **cada trozo usa la misma URL firmada**. Si caduca a mitad, la
siguiente petición da 401 y **el vídeo se corta donde esté**.

El caso real: práctica de 45 min + una pausa de 30 = **75 minutos** con la misma
URL. Y puede irse a comer y volver.

**Y desde agosto de 2026 hay un caso más: retomar la posición.**
`retomarPractica()` hace `currentTime = seg`, y eso dispara una petición de rango
nueva sobre la misma URL. No es un problema mientras la URL siga viva —con 4 horas
lo está—, pero es una razón más para no acortar.

Acortar no protege: quien quiera piratear descarga el archivo entero en mucho menos
de 4 horas. Solo molesta a quien está practicando.

La alternativa —firmar corto y re-firmar— obliga a cambiar el `src` a mitad de
reproducción y **se pierde la posición**. Precisamente lo que se acaba de construir.

---

## Cómo se comprueba el pago: solo `pagado`

Comprobado en `netlify/functions/acceso-manual`: cuando Andrea concede acceso a
mano, escribe **`pagado: true`** *y* `acceso_manual: true`. El comentario de esa
función lo dice: *"`pagado` es lo que gobierna el acceso"*.

`acceso_manual` es una marca de **procedencia** —cómo se concedió el acceso—, no de
autorización. Sirve para que las métricas de Andrea distingan cortesías de ventas.
Si la función de firma lo mirara, o duplicaría la comprobación o dejaría fuera por
error a quien tiene acceso legítimo.

Así que: `select pagado from hogar_usuarias where id = <uid del JWT>`, y firmar solo
si es `true`. Sin fila —cuenta borrada— es 403, que es lo correcto.

---

## Qué se rompe y cómo detectarlo

| Qué | Por qué | Se cubre en |
|---|---|---|
| **El inventario del panel** (el grave) | Hoy vive del sondeo por HEAD público. Sin bucket público **y** sin policy de SELECT, no queda ningún camino | Fase 0 ✅ + fase 3 |
| **Todas las imágenes de la landing** | `/render/image/` es de buckets públicos y los normalizadores llevan el bucket escrito | Fase 2 |
| **Subida y recorte de fotos** | Escriben en `hogar` y resuelven con `getPublicUrl` | Fase 2 |
| **El audio de la práctica** | Su URL se deriva de la del vídeo por reemplazo de extensión | Fase 3 |
| **El inventario del panel** | Sondea con HEAD público; con privado diría "0 de 30" | Fase 3 |
| **El aviso "en preparación"** | Detecta el archivo ausente por 404/400 desde el cliente | Fase 3 |

---

## Vuelta atrás

| Fase | Cómo se deshace |
|---|---|
| 0 | Borrar las cuatro policies nuevas. Se vuelve al estado anterior: nadie lista, y el panel sigue con el sondeo mientras el bucket sea público |
| 1 | Borrar el bucket nuevo; nada apuntaba ahí |
| 2 | Revertir el deploy |
| 3 | Revertir el deploy |
| 4 | Volver a marcar *Public bucket* |
| 5 | **Sin vuelta atrás** — por eso va al final y es opcional |

---

## Lo que este plan NO resuelve

Con Bunny descartado, **la salida de datos sigue siendo de Supabase, y las URLs
firmadas no la reducen ni un byte**. Un vídeo de 45 minutos sigue transfiriendo
~1,4 GB por reproducción.

| Plan Supabase | Salida/mes | Prácticas de 45 min |
|---|---|---|
| Free | 5 GB | **3** |
| Pro | 250 GB | ~175 |

Este plan cierra el agujero de que se **compartan los enlaces**. No cierra el
problema de **coste**. La única palanca que queda ahí es la compresión — ver el
pendiente 10.

---

## Apéndice — la compresión, separada de este plan

Era la fase 0 de la versión anterior. Se separa porque **es independiente de la
seguridad**: se puede hacer antes, después o nunca, y la duda sobre si compensa no
debe bloquear el cierre del agujero.

**El estado real es "sin probar", no "descartado".** El aviso anterior decía que la
recompresión se había descartado por medición, citando `crf 28 + maxrate 2M` sobre
`DESCARGASEGURA15`: −30% con pérdida visible. Pero **eso no es lo que este apéndice
recomienda**. Un `maxrate` bajo es justo lo que produce pérdida visible sin ahorrar
tanto; la recomendación es `crf 23 -preset slow` **sin techo de bitrate**.

Puede que al medirlo bien tampoco compense —el material podría estar ya bien
codificado—, pero hoy eso no está probado. Ver el pendiente 10.

### Ajustes recomendados

```bash
ffmpeg -i ORIGINAL.mp4 \
  -c:v libx264 -profile:v high -level 4.0 -pix_fmt yuv420p \
  -crf 23 -preset slow \
  -r 30 \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  SALIDA.mp4
```

| Ajuste | Por qué |
|---|---|
| `libx264` | H.264 sigue siendo lo único que reproduce **todo**. HEVC comprime mejor pero Chrome no lo acepta en MP4 de forma fiable; AV1/VP9 exigirían un segundo archivo de respaldo. No compensa para un producto de pago en móvil. |
| `-crf 23` | Calidad objetivo en vez de bitrate fijo. **Es el arreglo de fondo**: la inconsistencia actual viene de fijar bitrate. Con CRF, cada vídeo pesa lo que necesita. |
| `-preset slow` | Codificación única; `slow` da ~10% menos peso que `medium`. `veryslow` añade otro 5% por 2-3× de tiempo: no compensa. |
| `-r 30` | Normaliza los cinco de 60 fps. Inocuo en los que ya van a 30. |
| `-c:a aac -b:a 128k` | Conserva la pista de audio propia del vídeo, igualando el original. **No omitir `-c:a`**: sin él se pierde. |
| `-movflags +faststart` | Mueve el índice al principio para que la reproducción empiece antes de descargar el archivo entero. Hoy falta en parte de los vídeos. |

Si tras verificar quieres afinar: **CRF 21** es más conservador (más peso, margen
de sobra) y **CRF 25** más agresivo. No bajes de 20 ni subas de 26.

### Peso estimado

Para este material a 1080p30 y CRF 23, lo esperable son **1,0-1,5 Mbps de vídeo**
más 128 kbps de audio ≈ **9-11 MB/min**. `RECUPERACIONSUAVE15` ya vive ahí hoy.

| | Antes | Estimado | |
|---|---|---|---|
| Un vídeo de 45 min | ~1.340 MB | ~450 MB | −66% |
| Un vídeo de 30 min | ~800 MB | ~300 MB | −62% |
| Un vídeo de 15 min | ~450 MB | ~150 MB | −67% |
| **Total de los 15** | **12,32 GB** | **~4,3 GB** | **≈ −65%** |

**Es una estimación.** El número real sale de codificar uno y medirlo — ver abajo.

### Verificar antes de reemplazar

**Regla que no hay que saltarse: no sobrescribir los originales.** Sube los
comprimidos con otro nombre (`TEST-…`) o a un bucket aparte. Mientras el original
exista, todo es reversible; en cuanto se sobrescriba, no.

**1. Empieza por el peor caso.** `DESCARGASEGURA15`: es el más gordo por minuto
(45,8 MB/min), está a 60 fps y solo dura 16 min, así que codifica rápido.

**2. Mide con VMAF** (el ffmpeg local ya lo trae):

```bash
ffmpeg -i SALIDA.mp4 -i ORIGINAL.mp4 \
  -lavfi "[0:v]setpts=PTS-STARTPTS[d];[1:v]setpts=PTS-STARTPTS[r];[d][r]libvmaf=n_threads=4" \
  -f null -
```

Referencia: **VMAF ≥ 93** es indistinguible del original para la mayoría;
**≥ 95** es margen de sobra. Por debajo de 90, baja el CRF.

⚠️ **Cuidado con los cinco de 60 fps.** Comparar un encode de 30 fps contra un
original de 60 desalinea los fotogramas y da un VMAF falsamente bajo. Para esos,
genera primero una referencia a 30 fps (`-r 30 -crf 0`) y compara contra ella, o
acepta que ahí VMAF no aplica y decide a ojo.

**3. La prueba que de verdad importa: verlo en un teléfono, dentro de la app.**
Sube el comprimido con su nombre definitivo a un bucket de pruebas, apunta una
práctica ahí y hazla entera. Ninguna métrica sustituye a eso.

**4. Solo entonces, el lote.** Y aun así, conserva los originales fuera del bucket
hasta que hayan pasado semanas.

- [ ] Codificado y medido `DESCARGASEGURA15`
- [ ] VMAF ≥ 93 (o validado a ojo si es de 60 fps)
- [ ] Visto en un teléfono real dentro de la app
- [ ] Lote de los 15 codificado
- [ ] Subidos y verificados
- [ ] Originales guardados fuera del bucket

---

---

**Regla que no hay que saltarse: no sobrescribir los originales.** Mientras el
original exista, todo es reversible; en cuanto se sobrescriba, no.
