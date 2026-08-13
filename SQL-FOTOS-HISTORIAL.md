# Historial de fotos de la landing

Para que Andrea pueda **volver a una foto anterior** desde su panel.

## Qué resuelve

Cambia una foto, la ve en la landing y prefiere la de antes. Hasta ahora no había
vuelta atrás: la columna guardaba una sola URL y al cambiarla se perdía la anterior.

## Por qué hace falta SQL

Las fotos viejas **siguen en el bucket** —cada subida crea un archivo nuevo con su
fecha en el nombre y no se borra ninguna—, pero la llave pública **no puede listar**
el bucket, así que desde el navegador no hay forma de encontrarlas. Se comprobó:
la petición de listado responde correctamente y devuelve cero archivos.

La alternativa era abrir una política de lectura sobre `storage.objects`, que es más
delicada que añadir una columna. Se eligió guardar las URLs anteriores nosotros.

## El SQL

Una sola línea, en el editor SQL de Supabase:

```sql
alter table public.hogar_config
  add column if not exists landing_fotos_previas jsonb not null default '{}'::jsonb;
```

No hace falta tocar políticas: `hogar_config` ya tiene las suyas y esta columna entra
en el mismo `update` que la foto, con el mismo permiso.

## Qué guarda

Un objeto donde cada clave es la columna de una foto y su valor la lista de URLs
anteriores, de más reciente a más antigua, **con un tope de 5**:

```json
{
  "landing_hero_imagen":       ["https://…/hero-landing-1723.jpg", "https://…"],
  "landing_hero_imagen_movil": ["https://…/hero-movil-1699.jpg"],
  "andrea_foto_chat":          []
}
```

El tope existe para que la columna no crezca sin fin: cinco pasos atrás cubren de
sobra el caso real, que es arrepentirse del último cambio.

## Si NO se corre este SQL

**No se rompe nada.** El panel comprueba si la columna existe antes de escribir en
ella —le llega en el `select('*')` de siempre—, así que sin ella las subidas funcionan
exactamente como hoy y el botón "Fotos anteriores" no aparece.

## Comprobar que quedó

```sql
select landing_fotos_previas from public.hogar_config where id = 1;
```

Debe devolver `{}` la primera vez. Después de cambiar una foto, esa columna ya tendrá
dentro la URL de la que había antes.
