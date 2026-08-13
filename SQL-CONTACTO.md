# Cómo te contactan — el contacto de Andrea, editable desde su panel

Hoy el correo de Andrea está **escrito en el código** (`HOGAR_CONTACTO`) y aparece en
doce sitios: el bloque "¿Necesitas algo?" de Mi cuenta, los avisos de error de pago,
el borrado de cuenta… Cambiarlo exige tocar el archivo y volver a publicar.

Esto lo mueve a la base de datos y le añade dos formas más de contacto, las dos
opcionales: **WhatsApp** e **Instagram**.

## El SQL

Supabase → **SQL Editor** → **New query** → pegar → **Run**.

### 1. Las tres columnas

```sql
alter table public.hogar_config
  add column if not exists contacto_email     text,
  add column if not exists contacto_whatsapp  text,
  add column if not exists contacto_instagram text;
```

### 2. Exponerlas en la vista pública

`hogar_landing` es una vista que enseña, **sin sesión**, solo las columnas que la
landing necesita. Los datos de contacto tienen que salir por ahí: quien no ha entrado
también tiene que poder escribirle.

> **Antes de reemplazarla, guarda la definición actual** por si acaso:
> ```sql
> select pg_get_viewdef('public.hogar_landing', true);
> ```
> Copia el resultado a un lado. Si algo saliera mal, con eso se restaura.

```sql
create or replace view public.hogar_landing as
  select
    landing_hero_titulo,
    landing_hero_subtitulo,
    landing_hero_imagen,
    landing_hero_imagen_movil,
    precio_centavos,
    andrea_foto_chat,
    andrea_foto_perfil,
    landing_cierre_imagen,
    landing_trans_imagen,
    contacto_email,
    contacto_whatsapp,
    contacto_instagram
  from public.hogar_config
  where id = 1;
```

Las nueve primeras columnas son **exactamente** las que la vista ya devolvía, en el
mismo orden; solo se añaden tres al final. `create or replace view` conserva los
permisos que ya tenía, así que no hay que volver a concedérselos a nadie.

### 3. Comprobar

```sql
select contacto_email, contacto_whatsapp, contacto_instagram
  from public.hogar_landing;
```

Debe devolver una fila con los tres en `null`. En cuanto Andrea escriba su correo
desde el panel, aparecerá aquí.

## Si NO se corre este SQL

**No se rompe nada.** La app comprueba si esas columnas llegan; si no llegan, sigue
usando el correo del código exactamente como hoy, y el bloque "Cómo te contactan" del
panel avisa de que falta correr esto.

## Qué NO se mueve aquí

Los dos modales legales (Términos y Privacidad) llevan el correo **escrito en su
texto**, y eso se queda así a propósito: son documentos legales publicados, no
configuración. Si Andrea cambia su correo de contacto, el de los legales se cambia a
mano cuando toque revisarlos.
