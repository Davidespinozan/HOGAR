# Plan — capa 3: comprimir el contenido, bucket privado y URLs firmadas

Cierra el hallazgo #1 de la auditoría: hoy los vídeos y audios están en un bucket
**público** con nombres predecibles (`{SLUG}{minutos}.mp4`), así que se descargan
con el enlace directo **sin sesión siquiera**. El muro que existe hoy vive en el
navegador: disuade a quien usa la app con normalidad y no detiene a nadie con la
consola abierta.

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

## La decisión que da forma al plan

Lo obvio sería mover el contenido de pago a un bucket privado: **12,32 GB**.

Lo correcto es al revés: **mover los 7,8 MB de marca a un bucket público nuevo y
volver privado el `hogar` actual.** Mismo resultado, 1.500 veces menos que mover.

Los 12 GB **no se mueven nunca**.

---

## FASE 0 — Comprimir *(la hace David con su pipeline)*

Independiente del resto: se puede hacer, verificar y desplegar antes de tocar
ningún bucket. Va primero porque cada prueba de las fases siguientes reproduce
vídeos, y probar con archivos de 1,4 GB quema ancho de banda.

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

## FASE 1 — Bucket público nuevo *(la hace David en el panel)*

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

**Reversible**: nada apunta ahí todavía.

- [ ] Bucket creado y público
- [ ] 8 archivos copiados
- [ ] Policies creadas

---

## FASE 2 — El código apunta la marca al bucket nuevo *(Claude)*

~16 referencias de URL, más la subida de las tres fotos de Andrea y sus
previsualizaciones.

**Verificar:** la landing en ventana privada, y que "Cambiar foto" siga subiendo.

**Reversible**: revertir el deploy.

- [ ] Desplegado
- [ ] Landing correcta sin sesión
- [ ] Subida de fotos funcionando

---

## FASE 3 — Firmar URLs, con `hogar` todavía público *(Claude)*

Una Netlify Function nueva que:

1. Autentica el JWT de la clienta.
2. **Comprueba `pagado` contra la base.**
3. Devuelve las URLs firmadas del vídeo y del audio (`createSignedUrls`, en plural:
   una sola llamada para los dos).

**Aquí el muro deja de ser cosmético.** Un `if` en el navegador se salta con la
consola; esto no. Es el cierre real del hallazgo #1.

En el cliente, `practiceVideoURL()` y `practiceAudioURL()` pasan a ser asíncronas,
y con ellas `pT()` — que ya lo es desde el muro de acceso.

**Caducidad: 4 horas.** El razonamiento está abajo.

**Verificar:** hacer una práctica entera. Con el bucket aún público, un fallo se
arregla revirtiendo el deploy.

- [ ] Function desplegada
- [ ] Práctica completa reproducida con URL firmada
- [ ] Una cuenta sin pagar recibe 403 de la function

---

## FASE 4 — Volver `hogar` privado *(David, en el panel)*

Storage → `hogar` → **Configuration** → desmarcar **Public bucket** → Save.

**Comprobación:** abre en ventana privada
`https://…/storage/v1/object/public/hogar/RITMOSUAVE15.mp4`. **Debe dar error.**
Si sigue dando 200, el cambio no se aplicó.

**Reversible**: volver a marcarlo. Las URLs firmadas siguen siendo válidas sobre un
bucket público, así que la vuelta atrás no rompe nada.

- [ ] Bucket privado
- [ ] La URL pública ya no sirve
- [ ] La landing sigue bien (usa el otro bucket)
- [ ] Las prácticas siguen reproduciéndose

---

## FASE 5 — Limpieza *(opcional, semanas después)*

Borrar de `hogar` las copias de marca que quedaron duplicadas.

**⚠️ Único paso irreversible de todo el plan.** No aporta nada salvo 8 MB. Puede no
hacerse nunca.

- [ ] *(opcional)* Copias borradas

---

## La caducidad de las URLs firmadas

Un `<video>` **no descarga el archivo de una vez**: va pidiendo trozos con *range
requests*, y **cada trozo usa la misma URL firmada**. Si caduca a mitad, la
siguiente petición da 401 y **el vídeo se corta donde esté**.

El caso real: práctica de 45 min + una pausa de 30 = **75 minutos** con la misma
URL. Y puede irse a comer y volver.

**4 horas.** Cubre una práctica larga con pausas y despistes. El coste es que un
enlace compartido funciona durante esas 4 horas — pero quien quiera piratear el
contenido lo descarga entero en mucho menos, así que acortar molesta a las clientas
legítimas sin detener a nadie.

La alternativa —firmar corto y re-firmar— obliga a cambiar el `src` a mitad de
reproducción y se pierde la posición. No compensa.

---

## Qué se rompe y cómo detectarlo

| Qué | Por qué | Cómo se nota |
|---|---|---|
| **Inventario del panel** | El sondeo por HEAD leía 400 como "no existe". Con bucket privado **todo** da 401 → diría que faltan los 30 | Contenido → "0 de 30 archivos" |
| **Listar el bucket** | Sigue bien: la policy `hogar_bucket_listar` es para `authenticated` y los buckets privados la respetan | — |
| **Subida de fotos** | `subirFotoHogar` escribe en `hogar`; las fotos pasan al bucket nuevo | "Cambiar foto" falla |
| **Previsualizaciones del panel** | `getPublicUrl` sobre bucket privado devuelve una URL que no sirve | Imágenes rotas en Landing |
| **Guardas de media** | Detectan "falta el archivo" por 404/400; con privado sería 401 | El overlay "en preparación" saldría siempre |

Todo eso se cubre en la fase 3. Está aquí para saber **qué mirar** al verificar.

---

## Vuelta atrás

| Fase | Cómo se deshace |
|---|---|
| 0 | Los originales siguen guardados (por eso no se sobrescriben) |
| 1 | Borrar el bucket nuevo; nada apuntaba ahí |
| 2 | Revertir el deploy |
| 3 | Revertir el deploy |
| 4 | Volver a marcar *Public bucket* |
| 5 | **Sin vuelta atrás** — por eso va al final y es opcional |

---

## Por qué esto también es una decisión de negocio

Un vídeo de 45 min pesa hoy **1,4 GB**. Cada práctica larga transfiere eso de
salida.

| Plan Supabase | Salida/mes | Prácticas de 45 min |
|---|---|---|
| Free | 5 GB | **3** |
| Pro | 250 GB | ~175 |

Con la compresión de la fase 0 (~450 MB), el mismo plan Pro pasa de ~175 a **~550
prácticas al mes**. Con 20 clientas activas, la diferencia es entre superar el
límite y no acercarse.

La compresión no es un extra del plan: es lo que hace que el producto sea viable
de operar.
