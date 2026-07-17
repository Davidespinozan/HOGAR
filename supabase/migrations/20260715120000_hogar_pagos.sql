-- ============================================================================
-- HOGAR — PAGOS (Stripe Checkout, pago único)
-- ============================================================================
-- Journal de eventos de pago de Stripe (idempotencia + auditoría) y columnas
-- de estado de pago en hogar_usuarias. Lo escribe SOLO el webhook (service role);
-- las clientas nunca escriben aquí. Andrea (dueña) puede leer todo para el panel.
--
-- Andrea:  id 'f749320b-bec8-4b60-9de2-1b5fe79c6fcd' · email 'andrealaso1997@hotmail.com'
-- ============================================================================

-- 1) Columnas de estado de pago en hogar_usuarias (estatus/plan ya existen).
ALTER TABLE public.hogar_usuarias
  ADD COLUMN IF NOT EXISTS paid_at            timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

-- 2) Journal de pagos.
CREATE TABLE IF NOT EXISTS public.hogar_pagos (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identificadores de Stripe
  stripe_event_id           text UNIQUE NOT NULL,   -- 'evt_...'  → idempotencia
  stripe_event_type         text NOT NULL,          -- 'checkout.session.completed'
  stripe_session_id         text,                   -- 'cs_...'
  stripe_payment_intent_id  text,                   -- 'pi_...'
  stripe_customer_id        text,                   -- 'cus_...'
  -- Referencia interna (si se pudo resolver por email)
  user_id                   uuid REFERENCES public.hogar_usuarias(id) ON DELETE SET NULL,
  email                     text,
  -- Datos del cobro
  monto_centavos            integer,
  moneda                    text,
  status                    text,                   -- 'paid' | 'failed' | ...
  -- Auditoría
  raw_payload               jsonb NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hogar_pagos_email_idx      ON public.hogar_pagos (email);
CREATE INDEX IF NOT EXISTS hogar_pagos_created_at_idx ON public.hogar_pagos (created_at);

-- 3) RLS: nadie escribe desde el cliente; el webhook usa service role (bypassa RLS).
--    Solo Andrea puede LEER el journal (para el panel admin / sección DINERO).
ALTER TABLE public.hogar_pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hogar_pagos_andrea_select ON public.hogar_pagos;
CREATE POLICY hogar_pagos_andrea_select
  ON public.hogar_pagos
  FOR SELECT
  TO authenticated
  USING ( (auth.jwt() ->> 'email') = 'andrealaso1997@hotmail.com' );

-- (No hay policies de INSERT/UPDATE/DELETE para clientas: el service role del
--  webhook no está sujeto a RLS, así que puede escribir sin políticas abiertas.)
