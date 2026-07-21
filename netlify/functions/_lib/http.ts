import type { HandlerResponse } from '@netlify/functions';

/**
 * Respuestas HTTP con JSON + CORS. Patrón portado de EKKO, con el manejo de
 * preflight que necesitan las funciones que llama el navegador.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

const baseHeaders = {
  'Content-Type': 'application/json',
  ...corsHeaders
};

/** Respuesta al preflight OPTIONS del navegador. */
export const preflight = (): HandlerResponse => ({
  statusCode: 204,
  headers: corsHeaders,
  body: ''
});

export const ok = <T>(body: T): HandlerResponse => ({
  statusCode: 200,
  headers: baseHeaders,
  body: JSON.stringify(body)
});

export const badRequest = (message: string): HandlerResponse => ({
  statusCode: 400,
  headers: baseHeaders,
  body: JSON.stringify({ error: message })
});

export const unauthorized = (message = 'No autenticada'): HandlerResponse => ({
  statusCode: 401,
  headers: baseHeaders,
  body: JSON.stringify({ error: message })
});

export const forbidden = (message = 'Sin permiso'): HandlerResponse => ({
  statusCode: 403,
  headers: baseHeaders,
  body: JSON.stringify({ error: message })
});

export const serverError = (message = 'Error interno'): HandlerResponse => ({
  statusCode: 500,
  headers: baseHeaders,
  body: JSON.stringify({ error: message })
});
