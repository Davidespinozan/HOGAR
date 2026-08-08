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

## FASE 0 — Las policies de `storage.objects` *(David, SQL)*

**Es la fase crítica, y no estaba en la versión anterior de este plan.**

`SQL-CONTENIDO.md` creó esta policy para que el panel pudiera listar el bucket:

```sql
create policy hogar_bucket_listar on storage.objects
  for select to authenticated using (bucket_id = 'hogar');
```

Sobre un bucket **público** es inofensiva. Sobre uno **privado** es la puerta de
atrás: las descargas de un bucket privado pasan por `/object/authenticated/…` y
**comprueban esa misma policy**. Con ella puesta, cualquier cuenta registrada
—aunque no haya pagado nunca— puede bajarse los 15 vídeos.

Habríamos cerrado la puerta de la calle dejando la de atrás abierta. Todo el trabajo
de las fases siguientes no serviría de nada.

Aquel documento ofrecía la variante restringida a Andrea como opcional. **Al volver
el bucket privado deja de serlo.**

### Primero, ver qué hay vivo

```sql
select polname, polcmd, pg_get_expr(polqual, polrelid) as condicion
  from pg_policy where polrelid = 'storage.objects'::regclass;
```

### Después, restringir

```sql
drop policy if exists hogar_bucket_listar on storage.objects;
create policy hogar_bucket_listar on storage.objects
  for select to authenticated
  using (bucket_id = 'hogar'
         and auth.jwt() ->> 'email' = 'andrealaso1997@hotmail.com');
```

El inventario del panel es de Andrea, así que restringirlo a ella no quita nada.
La función que firma usa el `service_role`, que no pasa por RLS y no se ve afectada.

**Reversible**: volver a la policy amplia.

- [ ] Listadas las policies actuales
- [ ] `hogar_bucket_listar` restringida a Andrea
- [ ] El inventario del panel sigue funcionando como Andrea

---

## FASE 1 — Bucket público nuevo *(David, panel)*

Storage → **New bucket** → nombre `hogar-publico`, marcar **Public bucket** →
Create.

Luego **copiar** (no mover) los 8 archivos de marca: en `hogar`, seleccionarlos →
*Download*; entrar a `hogar-publico` → *Upload files*.

Después, en SQL Editor, para que Andrea pueda seguir subiendo sus fotos:

```sql
create policy hogar_publico_subir on storage.objects
  for insert to authenticated with check (bucket_id = 'hogar-publico');
create policy hogar_publico_listar on storage.objects
  for select to authenticated using (bucket_id = 'hogar-publico');
```

**Reversible**: borrar el bucket; nada apunta ahí todavía.

- [ ] Bucket creado y público
- [ ] 8 archivos copiados
- [ ] Policies creadas

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
| **Cualquier registrada puede bajar los vídeos** | La policy amplia de `authenticated` sobre `storage.objects` | **Fase 0 — la crítica** |
| **Todas las imágenes de la landing** | `/render/image/` es de buckets públicos y los normalizadores llevan el bucket escrito | Fase 2 |
| **Subida y recorte de fotos** | Escriben en `hogar` y resuelven con `getPublicUrl` | Fase 2 |
| **El audio de la práctica** | Su URL se deriva de la del vídeo por reemplazo de extensión | Fase 3 |
| **El inventario del panel** | Sondea con HEAD público; con privado diría "0 de 30" | Fase 3 |
| **El aviso "en preparación"** | Detecta el archivo ausente por 404/400 desde el cliente | Fase 3 |

---

## Vuelta atrás

| Fase | Cómo se deshace |
|---|---|
| 0 | Volver a la policy amplia |
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
