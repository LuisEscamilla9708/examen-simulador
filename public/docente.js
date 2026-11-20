
import { elemento, rutaSala, solicitar, tiempo } from '/comun.js';


const estado = elemento('estado');
const crear = elemento('boton-crear');
const iniciar = elemento('iniciar');
const liga = elemento('liga');
const tabla = elemento('equipos');
const csv = elemento('csv');
const fecha = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Mexico_City'
});
let sala;
let clave;
let panel;
let iniciando = false;

function autorizado(verificacion = clave) {
  return { Authorization: 'Bearer ' + verificacion };
}

function estadoEquipo(fila, datos) {
  if (fila.entregaRecibida !== null) return 'Entrega recibida';
  if (fila.fallo) return fila.fallo;
  if (datos.inicio !== null && datos.horaServidor >= datos.inicio) {
    if (datos.horaServidor > datos.envio + 8500) {
      return fila.aperturaMs === null ? 'Sin apertura confirmada' : 'Sin entrega';
    }
    if (fila.aperturaMs !== null) return 'Examen abierto';
    if (fila.primeraSolicitud !== null) return 'Apertura solicitada';
  }
  if (fila.conectado) return 'Lista';
  return fila.registrado ? 'Sin conexión reciente' : 'Sin registrar';
}

function llegadaEntrega(fila, datos) {
  return fila.entregaRecibida === null || datos.envio === null ? null : fila.entregaRecibida - datos.envio;
}

function actualizar(datos) {
  panel = datos;
  const aperturas = datos.filas.filter(fila => fila.aperturaMs !== null);
  const llegadas = datos.filas.map(fila => fila.entregaRecibida).filter(valor => valor !== null);
  const listas = datos.filas.filter(fila => fila.conectado);
  elemento('listas').textContent = (datos.listasAlInicio ?? listas.length) + '/40';
  elemento('abiertas').textContent = aperturas.length + '/40';
  elemento('enviadas').textContent = llegadas.length + '/40';
  elemento('intervalo').textContent = llegadas.length < 2 ? '—' : tiempo(Math.max(...llegadas) - Math.min(...llegadas));
  iniciar.disabled = iniciando || datos.inicio !== null;
  csv.disabled = false;

  if (datos.inicio === null) {
    estado.textContent = 'Sala abierta. Pide a cada PC que se registre con su número.';
  } else if (datos.horaServidor < datos.inicio) {
    estado.textContent = 'Inicio programado a las ' + fecha.format(datos.inicio) + ' (CDMX).';
  } else if (llegadas.length === 40) {
    estado.textContent = 'Las 40 computadoras entregaron el simulacro.';
  } else {
    estado.textContent = 'Ronda iniciada a las ' + fecha.format(datos.inicio) + ' (CDMX).';
  }

  const filas = datos.filas.map(fila => {
    const renglon = document.createElement('tr');
    const situacion = estadoEquipo(fila, datos);
    renglon.dataset.estado = situacion;
    const columnas = [
      fila.equipo, situacion, tiempo(fila.paginaMs), tiempo(fila.aperturaMs),
      tiempo(llegadaEntrega(fila, datos)), tiempo(fila.confirmacionMs)
    ];
    for (const valor of columnas) {
      const celda = document.createElement('td');
      celda.textContent = valor;
      renglon.append(celda);
    }
    return renglon;
  });
  tabla.replaceChildren(...filas);
}

async function consultar() {
  const actual = sala;
  if (actual) {
    try {
      const datos = await solicitar(rutaSala(actual, 'panel'), { cabeceras: autorizado(), esperaMs: 3000 });
      if (sala === actual) actualizar(datos);
    } catch (error) {
      if (sala === actual) estado.textContent = 'No se pudo actualizar la sala. ' + error.message;
    }
  }
  setTimeout(consultar, 1000);
}

elemento('crear').addEventListener('submit', async evento => {
  evento.preventDefault();
  crear.disabled = true;
  try {
    const candidata = elemento('clave').value.trim();
    const datos = await solicitar('/api/salas', { metodo: 'POST', cabeceras: autorizado(candidata) });
    clave = candidata;
    sala = datos.id;
    panel = null;
    tabla.replaceChildren();
    elemento('sala').hidden = false;
    elemento('clave').value = '';
    const direccion = new URL('/', location.href);
    direccion.searchParams.set('s', sala);
    liga.value = direccion.href;
    estado.textContent = 'Sala creada. Comparte la liga para registrar las computadoras.';
    iniciar.disabled = false;
    csv.disabled = true;
  } catch (error) {
    estado.textContent = error.message;
  } finally {
    crear.disabled = false;
  }
});

elemento('copiar').addEventListener('click', async () => {
  liga.select();
  try {
    await navigator.clipboard.writeText(liga.value);
    elemento('copiar').textContent = 'Liga copiada';
  } catch {
    elemento('copiar').textContent = 'Presiona Ctrl + C';
  }
});

iniciar.addEventListener('click', async () => {
  if (!sala || iniciando) return;
  iniciando = true;
  iniciar.disabled = true;
  const actual = sala;
  try {
    const datos = await solicitar(rutaSala(actual, 'iniciar'), { metodo: 'POST', cabeceras: autorizado() });
    if (sala === actual) estado.textContent = 'Inicio programado a las ' + fecha.format(datos.inicio) + ' (CDMX).';
  } catch (error) {
    if (sala === actual) {
      estado.textContent = error.message;
      iniciar.disabled = false;
    }
  } finally {
    iniciando = false;
  }
});

csv.addEventListener('click', () => {
  if (!panel) return;
  const iso = valor => valor === null ? '' : new Date(valor).toISOString();
  const encabezado = [
    'Sala', 'Equipo', 'Estado', 'Carga_de_liga_ms', 'Carga_de_examen_ms',
    'Inicio_previsto_UTC', 'Inicio_recibido_UTC', 'Retraso_apertura_del_navegador_ms',
    'Envio_previsto_UTC', 'Entrega_recibida_UTC', 'Demora_de_entrega_ms', 'Confirmacion_ms'
  ];
  const filas = panel.filas.map(fila => [
    panel.id, fila.equipo, estadoEquipo(fila, panel), fila.paginaMs, fila.aperturaMs,
    iso(panel.inicio), iso(fila.primeraSolicitud), fila.aperturaSolicitada,
    iso(panel.envio), iso(fila.entregaRecibida), llegadaEntrega(fila, panel), fila.confirmacionMs
  ]);
  const texto = [encabezado, ...filas].map(fila =>
    fila.map(valor => '"' + String(valor ?? '').replaceAll('"', '""') + '"').join(',')
  ).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\ufeff', texto], { type: 'text/csv;charset=utf-8' }));
  const descarga = document.createElement('a');
  descarga.href = url;
  descarga.download = 'Resultados-PILARES-' + panel.id + '.csv';
  document.body.append(descarga);
  descarga.click();
  descarga.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

void consultar();
