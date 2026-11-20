export const elemento = id => document.getElementById(id);

export function rutaSala(sala, accion) {
  return '/api/salas/' + sala + '/' + accion;
}

export async function solicitar(ruta, { metodo = 'GET', cabeceras = {}, datos, esperaMs = 8000 } = {}) {
  const controlador = new AbortController();
  const limite = setTimeout(() => controlador.abort(), esperaMs);
  try {
    const opciones = { method: metodo, headers: { ...cabeceras }, signal: controlador.signal };
    if (datos !== undefined) {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(datos);
    }
    const respuesta = await fetch(ruta, opciones);
    const tipo = respuesta.headers.get('Content-Type') || '';
    const salida = tipo.includes('application/json') ? await respuesta.json() : null;
    if (!respuesta.ok || !salida) {
      throw new Error(salida?.error || 'El servidor respondió con HTTP ' + respuesta.status + '.');
    }
    return salida;
  } catch (error) {
    if (controlador.signal.aborted) throw new Error('Se agotó el tiempo de conexión.');
    throw error;
  } finally {
    clearTimeout(limite);
  }
}

export function tiempo(ms) {
  return ms === null || ms === undefined ? '—' : (ms / 1000).toFixed(2) + ' s';
}
