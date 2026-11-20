import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const equipos = Array.from({ length: 40 }, (_, i) => 'PC-' + String(i + 1).padStart(2, '0'));
const preguntas = [
  { texto: '¿Cuánto es 12 + 8?', opciones: ['18', '20', '22'] },
  { texto: '¿Cuántos minutos hay en una hora?', opciones: ['30', '60', '100'] },
  { texto: '¿Cuál de estos objetos sirve para escribir?', opciones: ['Vaso', 'Regla', 'Lápiz'] },
  { texto: 'Si pagas $50 por un producto de $35, ¿cuál es tu cambio?', opciones: ['$10', '$15', '$20'] }
];
const formatos = {
  '/': ['equipo.html', 'text/html'],
  '/docente': ['docente.html', 'text/html'],
  '/estilo.css': ['estilo.css', 'text/css'],
  '/comun.js': ['comun.js', 'text/javascript'],
  '/equipo.js': ['equipo.js', 'text/javascript'],
  '/docente.js': ['docente.js', 'text/javascript']
};
const hash = valor => createHash('sha256').update(valor).digest();
const claveAlAzar = bytes => randomBytes(bytes).toString('hex');

class ErrorHttp extends Error {
  constructor(estado, mensaje) {
    super(mensaje);
    this.estado = estado;
  }
}

function responder(res, estado, cuerpo) {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
}

async function leerDatos(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) {
    throw new ErrorHttp(415, 'La solicitud debe usar JSON.');
  }
  const partes = [];
  let bytes = 0;
  for await (const parte of req) {
    bytes += parte.length;
    if (bytes > 4096) throw new ErrorHttp(413, 'Solicitud demasiado grande.');
    partes.push(parte);
  }
  try {
    const datos = JSON.parse(Buffer.concat(partes));
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) throw new Error();
    return datos;
  } catch {
    throw new ErrorHttp(400, 'Datos incorrectos.');
  }
}

function exigirMetodo(req, esperado) {
  if (req.method !== esperado) throw new ErrorHttp(405, 'Método no permitido.');
}

function medir(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > 600000) return null;
  return Math.round(ms);
}

function datosSala(sala) {
  return { id: sala.id, inicio: sala.inicio, envio: sala.envio, horaServidor: Date.now() };
}

function resumenSala(sala) {
  const ahora = Date.now();
  const filas = equipos.map(equipo => {
    const registro = sala.equipos.get(equipo);
    return {
      equipo,
      conectado: Boolean(registro && ahora - registro.visto < 7000),
      registrado: Boolean(registro),
      paginaMs: registro?.paginaMs ?? null,
      primeraSolicitud: registro?.primeraSolicitud ?? null,
      aperturaSolicitada: registro?.aperturaSolicitada ?? null,
      aperturaMs: registro?.aperturaMs ?? null,
      entregaRecibida: registro?.entregaRecibida ?? null,
      confirmacionMs: registro?.confirmacionMs ?? null,
      fallo: registro?.fallo ?? ''
    };
  });
  return { ...datosSala(sala), listasAlInicio: sala.listasAlInicio, filas };
}

export function crearServidor({ clave, avisarMs = 5500, responderMs = 6000 } = {}) {
  if (!clave) throw new Error('Falta la clave docente.');
  const claveHash = hash(clave);
  const salas = new Map();
  const paginas = new Map(Object.entries(formatos).map(([ruta, [archivo, tipo]]) =>
    [ruta, { archivo: readFileSync(new URL('./public/' + archivo, import.meta.url)), tipo }]
  ));

  function verificarDocente(req) {
    const autorizacion = req.headers.authorization || '';
    const recibida = autorizacion.startsWith('Bearer ') ? autorizacion.slice(7) : '';
    if (!timingSafeEqual(hash(recibida), claveHash)) throw new ErrorHttp(401, 'Clave docente incorrecta.');
  }

  function autenticarEquipo(req, sala) {
    const equipo = req.headers['x-equipo'];
    const registro = sala.equipos.get(equipo);
    if (!registro || req.headers['x-token-equipo'] !== registro.token) {
      throw new ErrorHttp(401, 'Este equipo debe registrarse en la sala.');
    }
    registro.visto = Date.now();
    return registro;
  }

  async function manejar(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const ruta = new URL(req.url, 'http://localhost').pathname;

    if (paginas.has(ruta)) {
      exigirMetodo(req, 'GET');
      const pagina = paginas.get(ruta);
      res.writeHead(200, { 'Content-Type': pagina.tipo + '; charset=utf-8' });
      res.end(pagina.archivo);
      return;
    }

    if (ruta === '/api/salas') {
      exigirMetodo(req, 'POST');
      verificarDocente(req);
      const sala = { id: claveAlAzar(5), creado: Date.now(), equipos: new Map(), inicio: null, envio: null, listasAlInicio: null };
      for (const [id, anterior] of salas) {
        if (sala.creado - anterior.creado > 8 * 60 * 60 * 1000) salas.delete(id);
      }
      salas.set(sala.id, sala);
      responder(res, 201, datosSala(sala));
      return;
    }

    const coincidencia = /^\/api\/salas\/([a-f0-9]{10})\/([a-z]+)$/.exec(ruta);
    if (!coincidencia) throw new ErrorHttp(404, 'Página no encontrada.');
    const [, id, accion] = coincidencia;
    const sala = salas.get(id);
    if (!sala) throw new ErrorHttp(404, 'La sala no está disponible. Solicita una liga al docente.');

    switch (accion) {
      case 'panel': {
        exigirMetodo(req, 'GET');
        verificarDocente(req);
        responder(res, 200, resumenSala(sala));
        return;
      }
      case 'iniciar': {
        exigirMetodo(req, 'POST');
        verificarDocente(req);
        if (sala.inicio === null) {
          const ahora = Date.now();
          sala.listasAlInicio = [...sala.equipos.values()].filter(registro => ahora - registro.visto < 7000).length;
          sala.inicio = ahora + avisarMs;
          sala.envio = sala.inicio + responderMs;
        }
        responder(res, 200, datosSala(sala));
        return;
      }
      case 'unir': {
        exigirMetodo(req, 'POST');
        const datos = await leerDatos(req);
        if (!equipos.includes(datos.equipo)) throw new ErrorHttp(400, 'Selecciona PC-01 a PC-40.');
        let registro = sala.equipos.get(datos.equipo);
        if (registro && registro.token !== datos.token) {
          if (sala.inicio !== null || Date.now() - registro.visto < 12000) {
            throw new ErrorHttp(409, 'Ese número ya está en uso. Verifica tu número de PC.');
          }
          registro = null;
        }
        if (!registro) {
          registro = { token: claveAlAzar(18), paginaMs: medir(datos.paginaMs) };
          sala.equipos.set(datos.equipo, registro);
        }
        registro.visto = Date.now();
        responder(res, 200, { ...datosSala(sala), token: registro.token });
        return;
      }
      case 'estado': {
        exigirMetodo(req, 'GET');
        autenticarEquipo(req, sala);
        responder(res, 200, datosSala(sala));
        return;
      }
      case 'examen': {
        exigirMetodo(req, 'GET');
        const registro = autenticarEquipo(req, sala);
        if (sala.inicio === null) throw new ErrorHttp(409, 'Espera la señal del docente.');
        registro.primeraSolicitud ??= Date.now();
        responder(res, 200, { preguntas });
        return;
      }
      case 'abierto': {
        exigirMetodo(req, 'POST');
        const registro = autenticarEquipo(req, sala);
        const datos = await leerDatos(req);
        if (!registro.primeraSolicitud) throw new ErrorHttp(409, 'Primero debes abrir el simulacro.');
        registro.aperturaMs ??= medir(datos.aperturaMs);
        registro.aperturaSolicitada ??= medir(datos.demoraInicioMs);
        responder(res, 200, { registrado: true });
        return;
      }
      case 'entregar': {
        exigirMetodo(req, 'POST');
        const registro = autenticarEquipo(req, sala);
        const recibido = Date.now();
        const datos = await leerDatos(req);
        if (!registro.primeraSolicitud) throw new ErrorHttp(409, 'Primero debes abrir el simulacro.');
        if (!Array.isArray(datos.respuestas) || datos.respuestas.length !== preguntas.length ||
          !datos.respuestas.every((valor, i) =>
            Number.isInteger(valor) && valor >= 0 && valor < preguntas[i].opciones.length)) {
          throw new ErrorHttp(400, 'Las respuestas del simulacro están incompletas.');
        }
        if (!registro.entregaRecibida) {
          registro.entregaRecibida = recibido;
          registro.aperturaMs ??= medir(datos.aperturaMs);
          registro.aperturaSolicitada ??= medir(datos.demoraInicioMs);
        }
        responder(res, 200, { confirmado: true, recibido: registro.entregaRecibida });
        return;
      }
      case 'confirmar': {
        exigirMetodo(req, 'POST');
        const registro = autenticarEquipo(req, sala);
        const datos = await leerDatos(req);
        if (!registro.entregaRecibida) throw new ErrorHttp(409, 'Aún falta el envío.');
        registro.confirmacionMs ??= medir(datos.confirmacionMs);
        responder(res, 200, { confirmado: true });
        return;
      }
      case 'fallo': {
        exigirMetodo(req, 'POST');
        const registro = autenticarEquipo(req, sala);
        const datos = await leerDatos(req);
        registro.fallo = typeof datos.fase === 'string' && ['apertura', 'envío'].includes(datos.fase)
          ? 'Falló ' + datos.fase : 'Fallo informado';
        responder(res, 200, { registrado: true });
        return;
      }
      default:
        throw new ErrorHttp(404, 'Ruta no disponible.');
    }
  }

  return createServer({ requestTimeout: 20000 }, (req, res) => {
    manejar(req, res).catch(error => {
      if (res.destroyed || res.headersSent) return;
      if (!error.estado) console.error(error);
      responder(res, error.estado || 500, { error: error.estado ? error.message : 'Error del servidor.' });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const clave = process.env.CLAVE_DOCENTE || claveAlAzar(12);
  const puerto = Number(process.env.PORT || 3000);
  const servidor = crearServidor({ clave });
  servidor.listen(puerto, '0.0.0.0', () => {
    console.log('Panel docente: http://localhost:' + puerto + '/docente');
    if (!process.env.CLAVE_DOCENTE) console.log('Clave docente de esta ejecución: ' + clave);
  });
}
