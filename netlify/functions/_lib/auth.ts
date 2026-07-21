import type { HandlerEvent, HandlerResponse } from '@netlify/functions';
import { unauthorized, forbidden } from './http';
import { optionalEnv } from './env';
import { getUserClient } from './supabase';

/**
 * Autenticación de las funciones.
 *
 * HOGAR es single-tenant: no hay tabla de roles. "Admin" = el correo de Andrea.
 * Se puede sobreescribir con la env var ADMIN_EMAIL (útil para probar), pero
 * tiene un default para que el deploy no dependa de configurarla.
 */

const ADMIN_EMAIL_DEFAULT = 'andrealaso1997@hotmail.com';

export interface UsuarioAutenticado {
  id: string;
  email: string | null;
  token: string;
}

export type ResultadoAuth =
  | { ok: true; user: UsuarioAutenticado }
  | { ok: false; response: HandlerResponse };

/** Valida el Bearer JWT del request y devuelve a quien llama. */
export async function autenticar(event: HandlerEvent): Promise<ResultadoAuth> {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, response: unauthorized('Falta el token') };
  }
  const token = authHeader.slice('Bearer '.length);

  const asUser = getUserClient(token);
  const {
    data: { user },
    error
  } = await asUser.auth.getUser();
  if (error || !user) {
    return { ok: false, response: unauthorized('Token inválido') };
  }

  return { ok: true, user: { id: user.id, email: user.email ?? null, token } };
}

/**
 * Igual que autenticar(), pero además exige que sea Andrea. Las funciones de
 * administración (Connect) rechazan a cualquier otra cuenta.
 */
export async function autenticarAdmin(event: HandlerEvent): Promise<ResultadoAuth> {
  const res = await autenticar(event);
  if (!res.ok) return res;

  const adminEmail = optionalEnv('ADMIN_EMAIL', ADMIN_EMAIL_DEFAULT).toLowerCase().trim();
  const email = (res.user.email ?? '').toLowerCase().trim();
  if (!email || email !== adminEmail) {
    return { ok: false, response: forbidden('Solo Andrea puede administrar los cobros') };
  }
  return res;
}
