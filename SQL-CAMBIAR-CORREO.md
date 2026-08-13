# Cambiar el correo desde Mi cuenta

Hasta ahora el correo se mostraba y no se podía editar. Esto lo abre — pero **primero
hay que correr este SQL**, y no es opcional.

## Por qué el SQL va primero

El correo de verdad vive en `auth.users`, la tabla de acceso de Supabase.
`hogar_usuarias.email` es una **copia**, y es de esa copia de la que vive el panel de
Andrea: la lista de usuarias, la búsqueda, el filtro de correos de prueba y —lo que
importa— la pantalla donde decide a quién concede o revoca el acceso.

Si una clienta cambia su correo y esa copia no se actualiza, Andrea acaba tomando esas
decisiones sobre una dirección que ya no existe. **Abrir el cambio sin esto deja el
sistema peor que cerrado.**

El trigger de alta que ya existe solo escucha `INSERT`. Este añade el `UPDATE`.

## El SQL

Supabase → **SQL Editor** → **New query** → pegar → **Run**.

```sql
-- Mantiene hogar_usuarias.email igual que auth.users.email.
-- SECURITY DEFINER porque el que dispara el UPDATE es el propio usuario al confirmar
-- su correo, y él no tiene permiso de escritura sobre la fila de otra tabla.
create or replace function public.hogar_sync_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.hogar_usuarias
     set email = new.email
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists hogar_sync_email_tr on auth.users;

create trigger hogar_sync_email_tr
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.hogar_sync_email();
```

El `when (old.email is distinct from new.email)` es lo que hace que no se dispare en
cada guardado de `auth.users` —que ocurre en cada inicio de sesión— sino solo cuando
el correo cambia de verdad.

## Comprobar que quedó

```sql
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'auth.users'::regclass
   and tgname = 'hogar_sync_email_tr';
```

Debe devolver una fila con `tgenabled = 'O'` (activo).

## Cómo se ve desde la app

Supabase trae activado **Secure email change**, así que al pedir el cambio manda
**dos** correos: uno a la dirección vieja y otro a la nueva, y hay que confirmar
**los dos**. Hasta que se confirmen, la sesión sigue con el correo antiguo y con él se
entra. La app lo dice con esas palabras para que nadie crea que ya cambió.

Al pulsar el enlace, se vuelve a la app con `type=email_change` en la dirección;
`_authInit()` lo reconoce y enseña el aviso de que falta el otro correo o de que ya
quedó.

## Si NO se corre este SQL

El campo del correo **sigue en solo lectura**, igual que antes, y Mi cuenta avisa de
que falta este paso. No se rompe nada y nadie puede dejar la copia desincronizada.
