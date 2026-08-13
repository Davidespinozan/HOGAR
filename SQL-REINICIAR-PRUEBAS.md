# Reiniciar los datos de prueba

Después de probar la app quedan usuarias falsas, prácticas y altas que ensucian las
cifras del panel de Andrea. Esto sirve para limpiarlas.

---

## PASO 1 — Ver qué hay (esto NO borra nada)

Antes de borrar hay que mirar. Pega esto en **Supabase → SQL Editor → New query → Run**.

```sql
-- ── Cada usuaria, con su actividad ───────────────────────────────────────────
select
  u.email,
  u.nombre,
  u.created_at::date            as alta,
  u.plan,
  u.estatus,
  u.pagado,
  u.fecha_compra::date          as compra,
  (u.monto_centavos / 100.0)    as monto,
  (select count(*) from public.hogar_sesiones s where s.user_id = u.id)             as practicas,
  (select count(*) from public.hogar_sesiones_respuestas r where r.user_id = u.id)  as respuestas,
  (a.id is not null)            as tiene_cuenta_de_acceso
from public.hogar_usuarias u
left join auth.users a on a.id = u.id
order by u.created_at;
```

Y el resumen de cuánto hay en total:

```sql
select 'usuarias'   as tabla, count(*) from public.hogar_usuarias
union all select 'sesiones',            count(*) from public.hogar_sesiones
union all select 'respuestas',          count(*) from public.hogar_sesiones_respuestas
union all select 'bajas',               count(*) from public.hogar_bajas
union all select 'accesos manuales',    count(*) from public.hogar_acceso_manual_log
union all select 'cuentas de acceso',   count(*) from auth.users;
```

**Manda el resultado.** Con esa lista delante se escribe el borrado exacto: qué correos
se van y cuáles se quedan.

---

## PASO 2 — El borrado

Decidido con el inventario del 13 de agosto de 2026 delante: de las nueve cuentas,
**ocho eran de prueba**. Las tres `magaly*`, `daen97@`, las tres `magalyb.1804+…` y
`healthyspace.mb@` (Jenny), que se confirmó que también era una prueba pese a tener
compra de 499.

Se queda **solo `andrealaso1997@hotmail.com`**, y a ella se le vacía su propia
actividad: sus 16 prácticas eran de probar la app y hoy inflan sus propias cifras.

### Antes de correrlo

Supabase → **Database → Backups**. Comprueba que hay una copia reciente. Esto no
tiene deshacer.

### El SQL — en DOS bloques, y el orden importa

**LA PRIMERA VERSIÓN DE ESTE DOCUMENTO ESTABA MAL Y NO BORRÓ NADA.** Metía los cinco
borrados en una sola transacción, con `delete from auth.users` al final. Si ése falla
por permisos —que es lo normal—, Postgres **aborta la transacción entera** y el
`commit` se comporta como un `rollback`: deshace también los cuatro anteriores. La
nota que decía "si falla, deja el commit igual" era falsa.

Por eso van separados: lo nuestro en su transacción, las cuentas de acceso en otra.
Si la segunda no pasa, la primera ya quedó hecha.

#### Bloque 1 — nuestras tablas

```sql
begin;

-- Toda la actividad, de todo el mundo. Incluye la de Andrea, que era de pruebas.
delete from public.hogar_sesiones_respuestas;
delete from public.hogar_sesiones;

-- Los dos registros de trámites, que solo tienen rastros de las pruebas.
delete from public.hogar_bajas;
delete from public.hogar_acceso_manual_log;

-- Las fichas de usuaria, todas menos la de Andrea.
delete from public.hogar_usuarias
 where lower(email) <> 'andrealaso1997@hotmail.com';

commit;
```

Comprueba antes de seguir: debe quedar **1** usuaria y **0** sesiones.

#### Bloque 2 — las cuentas de acceso

Aparte, y solo después de que el bloque 1 haya quedado:

```sql
delete from auth.users
 where lower(email) <> 'andrealaso1997@hotmail.com';
```

Si éste da error de permisos, no pasa nada y **no deshace el bloque 1**: borra esas
cuentas a mano desde **Authentication → Users**. Sin ficha en `hogar_usuarias` no
aparecen en ningún sitio del panel; lo único que hacen es ocupar sitio en la lista de
autenticación.

### Comprobar que quedó

```sql
select
  (select count(*) from public.hogar_usuarias)             as usuarias,
  (select count(*) from public.hogar_sesiones)             as sesiones,
  (select count(*) from public.hogar_sesiones_respuestas)  as respuestas,
  (select count(*) from auth.users)                        as cuentas;
```

Debe dar **1, 0, 0, 1**.

---

## Lo que NO se toca nunca

La configuración de Andrea vive en otras tablas y no entra en ningún borrado:

| tabla | qué guarda |
|---|---|
| `hogar_config` | landing, fotos, precio, historial de fotos |
| `hogar_cuestionario` | el recorrido y sus preguntas |
| `hogar_practica_textos` | los textos de cada práctica |
| `hogar_landing` | textos de la página de venta |
| `hogar_notas` | las frases de Andrea que ve la usuaria en su inicio |

> **`hogar_notas` engaña por el nombre.** No son notas *de* las usuarias: son las diez
> frases que escribe Andrea y que aparecen en el inicio de quien entra. Son suyas y
> son configuración. El primer borrador de este documento las contaba como datos de
> usuaria y el SQL falló al no encontrar `user_id` — bien que fallara.
>
> El diario íntimo, ése sí de cada clienta, es `hogar_sesiones_respuestas`.

---

## Lo que este SQL NO puede arreglar

**Las ventas del panel de Cobros no están en esta base de datos.** El panel se las pide
a Stripe a través de la función de Netlify (`connect-status`), así que borrar filas aquí
no las va a quitar.

Si esos cobros son de prueba, viven en el **modo de prueba de Stripe**, que ya está
separado del real: al pasar la cuenta a modo real desaparecen solos. Si se hicieron en
modo real con tarjetas reales, hay que reembolsarlos o anularlos desde el panel de
Stripe — no desde aquí.

## Lo que ya existe y quizá baste

El panel **ya excluye de sus cifras** una lista de correos de prueba, en `index.html`:

```js
const ADMIN_TEST_EMAILS=['magalyb.1804@gmail.com','magalybl.1804@gmail.com',
                         'magalyblltt@gmail.com','daen97@hotmail.com'];
```

Si las cuentas falsas son otras, añadirlas ahí las esconde de las métricas **sin borrar
nada**, que es reversible y no toca datos. A veces es todo lo que hace falta.
