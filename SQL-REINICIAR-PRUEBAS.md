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
