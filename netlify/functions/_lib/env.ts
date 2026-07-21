/**
 * Lectura de variables de entorno. Patrón portado de EKKO.
 * NADA de llaves en el código: todo sale de las env vars de Netlify.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}
