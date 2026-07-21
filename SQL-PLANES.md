# SQL — permiso de escritura en `hogar_config`

La sección **Planes** del panel deja que Andrea edite el nombre, la descripción y el
precio de su producto. Hoy `hogar_config` solo tiene policy de **SELECT** para ella,
así que el guardado falla.

Con RLS, un `UPDATE` sin permiso **no devuelve error**: devuelve 0 filas, en silencio.
Por eso el panel comprueba las filas afectadas y muestra "falta el permiso de escritura
en hogar_config" en vez de decir "Guardado" cuando no guardó nada. Si ves ese mensaje,
es que falta correr esto.

## Cómo correrlo

Supabase → proyecto **Base de datos Stryv** → **SQL Editor** → pega y ejecuta:

```sql
-- ============================================================================
-- HOGAR — hogar_config: permitir que Andrea EDITE su producto (nombre, precio).
-- Lectura ya existía; esto agrega la escritura.
-- El id de Andrea sale de auth.users; single-tenant = una sola fila (id = 1).
-- ============================================================================

ALTER TABLE public.hogar_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hogar_config_andrea_update ON public.hogar_config;

CREATE POLICY hogar_config_andrea_update
  ON public.hogar_config
  FOR UPDATE
  TO authenticated
  USING      (auth.jwt() ->> 'email' = 'andrealaso1997@hotmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'andrealaso1997@hotmail.com');
```

`USING` decide qué filas puede tocar; `WITH CHECK` decide cómo pueden quedar después.
Se necesitan las dos: sin `WITH CHECK`, el update se rechaza.

## Verificar que quedó

1. Entra al panel como Andrea → **Planes**.
2. Escribe un precio (por ejemplo `499`) y toca **Guardar**.
3. Debe aparecer **"Guardado"** en verde. Si aparece el mensaje de permisos, la policy
   no se creó: revisa que el correo del `CREATE POLICY` sea exactamente el de Andrea.
4. Cambia de sección y vuelve a Planes: el precio debe releerse (`499`, no vacío).

También puedes confirmarlo por SQL:

```sql
SELECT policyname, cmd FROM pg_policies
WHERE tablename = 'hogar_config';
```

Deben aparecer la policy de `SELECT` que ya existía y `hogar_config_andrea_update`
con `cmd = 'UPDATE'`.

## Nota

El precio se guarda en **centavos** (`precio_centavos`): el formulario recibe pesos y
multiplica por 100, así que `499` se guarda como `49900`. Es lo que espera la función
`crear-checkout` al construir la sesión de pago. Si algún día editas el valor a mano
en Supabase, recuerda que va en centavos.
