# SQL — permitir listar el bucket `hogar`

La sección **Contenido** del panel muestra el inventario de medios: qué videos y
audios están subidos y cuáles faltan. Funciona hoy sin configurar nada, pero en
modo reducido. Este SQL la lleva al modo completo.

## Por qué

Que un bucket sea **público** solo significa que sus archivos se pueden *descargar*
por URL. **Listar** su contenido es otra cosa: pasa por RLS sobre `storage.objects`,
y ahí no hay ninguna policy para el rol de la app.

El síntoma es traicionero: `list()` **no da error**. Devuelve `200` con un array
vacío, como si el bucket estuviera vacío. Por eso el panel no se fía de un listado
vacío — si no reconoce ninguno de sus archivos, pasa a preguntar por cada uno de los
30 por separado.

| | Sin la policy (modo sondeo) | Con la policy (modo listado) |
|---|---|---|
| Saber qué falta | ✅ sí, con certeza | ✅ sí |
| Detectar nombres mal puestos («… (1).mp4») | ❌ no puede | ✅ sí |
| Consultas | 30 (una por archivo) | 1 |

Sin la policy no se pierde lo esencial, pero sí la detección de **nombres
casi-correctos** — que es justo el diagnóstico más difícil de encontrar a ojo.

## Cómo correrlo

Supabase → proyecto **Base de datos Stryv** → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — permitir LISTAR los objetos del bucket "hogar".
-- Solo SELECT (lectura de metadatos). No habilita subir, borrar ni renombrar:
-- el panel es de solo lectura y esto no le da mas permisos.
-- Los archivos ya eran descargables: el bucket es publico.
-- ============================================================================

CREATE POLICY hogar_bucket_listar
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'hogar');
```

Si prefieres restringirlo solo a Andrea, cambia la última línea por:

```sql
  USING (
    bucket_id = 'hogar'
    AND auth.jwt() ->> 'email' = 'andrealaso1997@hotmail.com'
  );
```

## Verificar

1. Entra al panel como Andrea → **Contenido**.
2. Debe desaparecer la nota del final que menciona este archivo.
3. El conteo de arriba debe seguir dando lo mismo que antes de correr el SQL. Si
   cambia, algo no cuadra: avisa antes de subir nada.

Por SQL:

```sql
SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects';
```

## Nota sobre los nombres

La app arma las URLs por convención, no las guarda: `{SLUG}{minutos}.mp4` y
`{SLUG}{minutos}.mp3`, con los slugs de `VIDEO_SLUG` en `index.html`
(`RITMOSUAVE`, `PRESENCIA`, `RECUPERACIONSUAVE`, `CONTENCION`, `DESCARGASEGURA`)
y las duraciones `15`, `30` y `45`. Un nombre que no calce exacto —mayúsculas
distintas, un espacio, un « (1)» al final— hace que la app no encuentre el archivo
aunque esté subido.
