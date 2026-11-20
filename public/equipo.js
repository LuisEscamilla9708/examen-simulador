import { elemento, rutaSala, solicitar, tiempo } from './public/comun.js';

const params = new URLSearchParams(location.search);
const sala = params.get('s');
const numero = elemento('numero');
const boton = elemento('boton-unir');
const estado = elemento('estado');
const detalle = elemento('detalle');
const preguntasVista = elemento('preguntas');
const claveLocal = 'pilares-equipo-' + sala;
const validez = /^PC-(0[1-9]|[1-3][0-9]|40)$/;
let registro;
let referenciaServidor = null;
let menorIdaVuelta = Infinity;
let ejecutando = false;

for (let i = 1; i <= 40; i++) {
  const codigo = 'PC-' + String(i).padStart(2, '0');
  numero.add(new Option(codigo, codigo));
}

function mensaje(titulo, info = '') {
  estado.textContent = titulo;
  detalle.textContent = info;
}

function cargarRegistro() {
  try { return JSON.parse(sessionStorage.getItem(claveLocal)); } catch { return null; }
}

function guardarRegistro() {
  try { sessionStorage.setItem(claveLocal, JSON.stringify(registro)); } catch { /* La pestaña conserva el registro. */ }
}

function optarTiempoServidor(antes, despues, horaServidor) {
  const viaje = despues - antes;
  if (viaje < menorIdaVuelta) {
    menorIdaVuelta = viaje;
    referenciaServidor = horaServidor - (antes + despues) / 2;
  }
}

function horaServidor() {
  return performance.now() + referenciaServidor;
}

function esperarHasta(hora) {
  return new Promise(continuar => setTimeout(continuar, Math.max(0, hora - horaServidor())));
}

function llamada(accion, opciones = {}) {
  return solicitar(rutaSala(sala, accion), {
    ...opciones,
    cabeceras: { 'X-Equipo': registro.equipo, 'X-Token-Equipo': registro.token }
  });
}

function mostrarPreguntas(preguntas) {
  return preguntas.map((pregunta, indice) => {
    const bloque = document.createElement('div');
    bloque.className = 'pregunta';
    const titulo = document.createElement('strong');
    titulo.textContent = (indice + 1) + '. ' + pregunta.texto;
    const respuesta = document.createElement('p');
    respuesta.className = 'respuesta';
    respuesta.textContent = 'Pendiente';
    bloque.append(titulo, respuesta);
    preguntasVista.append(bloque);
    return respuesta;
  });
}

async function ejecutar(datos) {
  ejecutando = true;
  mensaje('Inicio programado', 'Esta computadora comenzará automáticamente. Mantén esta pestaña al frente.');
  await esperarHasta(datos.inicio);
  mensaje('Abriendo el examen…');
  const desde = performance.now();
  const demoraInicioMs = Math.max(0, horaServidor() - datos.inicio);
  let fase = 'apertura';
  try {
    const examen = await llamada('examen', { esperaMs: 7000 });
    const etiquetas = mostrarPreguntas(examen.preguntas);
    const aperturaMs = performance.now() - desde;
    const tiempos = { aperturaMs, demoraInicioMs };
    void llamada('abierto', { metodo: 'POST', datos: tiempos, esperaMs: 2500 }).catch(() => {});
    fase = 'envío';

    mensaje('Respondiendo automáticamente…');
    const respuestas = [];
    for (const [indice, pregunta] of examen.preguntas.entries()) {
      await esperarHasta(datos.inicio + 1000 + indice * 650);
      const valor = Math.floor(Math.random() * pregunta.opciones.length);
      respuestas.push(valor);
      etiquetas[indice].textContent = 'Opción seleccionada: ' + pregunta.opciones[valor];
    }
    mensaje('Respuestas listas', 'El envío empezará a la hora común de la sala.');
    await esperarHasta(datos.envio);

    mensaje('Enviando el examen…');
    const enviado = performance.now();
    const confirmacion = await llamada('entregar', {
      metodo: 'POST', datos: { respuestas, ...tiempos }, esperaMs: 8000
    });
    if (!confirmacion.confirmado) throw new Error('El servidor no confirmó la entrega.');
    const confirmacionMs = performance.now() - enviado;
    mensaje('Envío confirmado');
    elemento('medicion').textContent =
      'Carga del examen: ' + tiempo(aperturaMs) + ' · Confirmación: ' + tiempo(confirmacionMs);
    void llamada('confirmar', { metodo: 'POST', datos: { confirmacionMs }, esperaMs: 2500 }).catch(() => {});
  } catch (error) {
    mensaje('Falló ' + fase, error.message);
    void llamada('fallo', { metodo: 'POST', datos: { fase }, esperaMs: 2500 }).catch(() => {});
  }
}

async function comprobarEstado() {
  if (ejecutando) return;
  try {
    const antes = performance.now();
    const datos = await llamada('estado', { esperaMs: 3500 });
    optarTiempoServidor(antes, performance.now(), datos.horaServidor);
    if (datos.inicio !== null) {
      await ejecutar(datos);
      return;
    }
    mensaje('Equipo listo', 'Espera a que el docente pulse Iniciar examen.');
  } catch {
    mensaje('Intentando reconectar…', 'La pestaña volverá a consultar al servidor.');
  }
  setTimeout(comprobarEstado, 1500 + Math.random() * 500);
}

async function unir() {
  if (!sala || !validez.test(numero.value)) return;
  boton.disabled = true;
  const previo = cargarRegistro();
  const nav = performance.getEntriesByType('navigation')[0];
  const antes = performance.now();
  try {
    const datos = await solicitar(rutaSala(sala, 'unir'), {
      metodo: 'POST',
      datos: {
        equipo: numero.value,
        token: previo?.equipo === numero.value ? previo.token : undefined,
        paginaMs: nav?.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd : null
      }
    });
    optarTiempoServidor(antes, performance.now(), datos.horaServidor);
    registro = { equipo: numero.value, token: datos.token };
    guardarRegistro();
    elemento('registro').hidden = true;
    elemento('identidad').textContent = registro.equipo;
    mensaje('Equipo listo', 'Espera a que el docente pulse Iniciar examen.');
    if (datos.inicio !== null) await ejecutar(datos);
    else void comprobarEstado();
  } catch (error) {
    mensaje('La PC aún no está lista', error.message);
  } finally {
    boton.disabled = false;
  }
}

elemento('unir').addEventListener('submit', evento => {
  evento.preventDefault();
  void unir();
});

if (!sala || !/^[a-f0-9]{10}$/.test(sala)) {
  elemento('registro').hidden = true;
} else {
  mensaje('Sala disponible', 'Selecciona el número que identifica esta computadora.');
  const preseleccion = params.get('pc') || cargarRegistro()?.equipo;
  if (validez.test(preseleccion || '')) {
    numero.value = preseleccion;
    window.addEventListener('load', () => setTimeout(unir, 0), { once: true });
  }
}
