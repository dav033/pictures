/**
 * Una pasada sobre una foto, por el mismo camino que usa el Taller: «modelar desde foto» (`/api/escena-desde-foto`, con
 * sus dependencias reales: `modelarFotoReal`) y luego hasta N vueltas del asistente de escena (`/api/escena-ia`), llamando
 * a los handlers directamente y sin HTTP. El coste y las llamadas salen del contador (observador de cierre de cada llamada).
 * Si la pasada para (tope, llamadas o modelo sin precio), se aborta la petición en curso y se conserva la escena del último
 * turno pagado. Cada pasada corre en su propia conversación de auditoría (`entrenamiento-<corrida>-<foto>`), así que todos
 * sus eventos de IA se pueden correlacionar con `npm run registros`. Nunca lanza: siempre devuelve un registro.
 */
import { detectarGlobos, type Deteccion } from "@/lib/globos3d/detectar-globos-ia";
import type { Escena } from "@/lib/globos3d/escena";
import { reiniciarCupoEscenaIA } from "@/lib/globos3d/cupo-escena-ia";
import { resumenParaAgente, type Modelado } from "@/lib/globos3d/modelar-desde-foto";
import { modelarFotoReal } from "@/lib/taller/modelar-foto-real";
import { normalizarFotoA } from "@/lib/taller/normalizar-foto";
import { atenderEscenaDesdeFoto, LADO_MAXIMO_LECTURA } from "@/lib/taller/escena-desde-foto";
import { POST as escenaIA } from "@/app/api/escena-ia/route";
import { conContexto, sanearIdConversacion } from "@/lib/registro/contexto";
import { clasificarFallos, HECHOS_SIN_FALLOS, type HechosPasada } from "./lib-fallos";
import type { ModoPasada, Puntajes, RegistroPasada, TransporteArnes } from "./lib-agregado";
import type { ContadorLlamadas } from "./lib-contador";
import { claveDeteccion, guardarDeteccionCacheada, leerDeteccionCacheada } from "./lib-cache-deteccion";
import { puntuarEscena, type PuntuacionEscena } from "./lib-puntuacion";
import { refinarEscena, type ResultadoRefino, type RespuestaTurno } from "./lib-refino";

export const MENSAJE_REFINO = "Compara la escena armada con la lectura de la foto y corrige lo que no coincide (tamaños, colores, piezas que faltan o sobran). Si ya coincide, dilo sin cambiar nada.";

const PUNTAJES_VACIOS: Puntajes = { proporciones: null, colores: null, zonas: null, iou: null };

export type OpcionesPasada = {
  /** Identificador de la corrida (su carpeta): con el nombre de la foto, la conversación de auditoría de la pasada. */
  corrida: string;
  nombre: string;
  bytes: Uint8Array;
  turnos: number;
  contador: ContadorLlamadas;
  modo: ModoPasada;
  transporte: TransporteArnes;
  modelo: string;
  /** El esfuerzo y el razonamiento con que corre el modelo (de la config de la app). */
  esfuerzo: string;
  pensamiento: boolean;
  commit: string;
  dirCacheDeteccion: string;
};

export type ResultadoPasada = { registro: RegistroPasada; escena: Escena | null; topeAlcanzado: boolean };

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function idConversacionDePasada(corrida: string, nombre: string): string {
  return sanearIdConversacion(`entrenamiento-${corrida}-${nombre.replace(/\.jpg$/, "")}`) ?? "entrenamiento";
}

export function pasadaDeFoto(o: OpcionesPasada): Promise<ResultadoPasada> {
  return conContexto({ conversacion: idConversacionDePasada(o.corrida, o.nombre) }, () => ejecutarPasada(o));
}

async function ejecutarPasada(o: OpcionesPasada): Promise<ResultadoPasada> {
  const iniciadaEn = new Date().toISOString();
  // Tope por hora de la app: límite de tráfico de producción, no de coste. El arnés lo reinicia; el tope real es el contador.
  reiniciarCupoEscenaIA();
  const llamadasAntes = o.contador.llamadas, gastoAntes = o.contador.gastado;
  const controlador = new AbortController();
  o.contador.vigilar(controlador);

  const hechos: HechosPasada = { ...HECHOS_SIN_FALLOS };
  const capturado: { modelado?: Modelado; deteccion?: Deteccion } = {};
  let error: string | null = null;
  const avisos: string[] = [];
  let escena: Escena | null = null;
  let refino: ResultadoRefino | null = null;
  const clave = claveDeteccion({ bytes: o.bytes, modo: o.modo, transporte: o.transporte, modelo: o.modelo, esfuerzo: o.esfuerzo, pensamiento: o.pensamiento, ladoLectura: LADO_MAXIMO_LECTURA });
  const cacheada = leerDeteccionCacheada(o.dirCacheDeteccion, clave, o.modo);
  const detectar = async (foto: Parameters<typeof detectarGlobos>[0]): Promise<Deteccion> => {
    const erroresAntes = o.contador.errores;
    const deteccion = cacheada ?? await detectarGlobos(foto, { signal: controlador.signal });
    // Los fondos y la revisión de racimos tragan sus fallos y devuelven una detección «sin fallidos»: si algo falló o se
    // cortó mientras se detectaba, la detección puede estar incompleta y no se guarda como verdad.
    const limpia = !controlador.signal.aborted && o.contador.paro === null && o.contador.errores === erroresAntes;
    if (!cacheada && limpia) guardarDeteccionCacheada(o.dirCacheDeteccion, clave, deteccion, o.modo, o.nombre);
    capturado.deteccion = deteccion;
    return deteccion;
  };

  try {
    const formulario = new FormData();
    formulario.append("imagen", new Blob([new Uint8Array(o.bytes)], { type: "image/jpeg" }), o.nombre);
    const respuesta = await atenderEscenaDesdeFoto(new Request("http://local/api/escena-desde-foto", { method: "POST", body: formulario, signal: controlador.signal }), {
      autenticado: () => true,
      mismoOrigen: () => true,
      normalizar: normalizarFotoA,
      modelar: async (foto, signal) => {
        const m = await modelarFotoReal(foto, signal, detectar);
        capturado.modelado = m;
        return m;
      },
    });
    if (!respuesta.ok) {
      hechos.errorLectura = true;
      error = String(((await respuesta.json()) as { error?: string }).error ?? `HTTP ${respuesta.status}`);
    }
  } catch (e) {
    hechos.errorLectura = true;
    error = mensajeDe(e);
  }

  const modelado = capturado.modelado;
  const deteccion = capturado.deteccion ?? null;
  if (modelado) {
    escena = modelado.escena;
    hechos.piezasDescartadas = modelado.descartadas.length;
    const otro = modelado.lectura.piezas.filter((p) => p.tipo === "otro").length;
    hechos.piezasOtro = otro;
    hechos.omitidasCompilacion = Math.max(0, modelado.omitidas.length - otro);
    hechos.sinDeteccion = deteccion === null;
    hechos.errorLectura = false;
    error = null;
  }

  /** La puntuación de una escena con la detección de la pasada; `null` si no hay detección o no se pudo medir (no para la pasada). */
  const puntuar = (e: Escena): PuntuacionEscena | null => {
    if (!modelado || !deteccion) return null;
    try { return puntuarEscena({ lectura: modelado.lectura, escena: e, deteccion }); } catch (fallo) { avisos.push(`No se pudo puntuar una escena: ${mensajeDe(fallo)}`); return null; }
  };
  if (modelado && escena) {
    refino = await refinarEscena({
      escena, turnos: o.turnos, mensaje: MENSAJE_REFINO, margen: () => o.contador.margen(), puntuar,
      historialInicial: [{ rol: "usuario", texto: resumenParaAgente(modelado, "foto armada, falta el ajuste del asistente").slice(0, 1500) }],
      atender: async (actual, historial): Promise<RespuestaTurno> => {
        const cuerpo = { escena: actual, mensaje: MENSAJE_REFINO, historial: historial.slice(-8), seleccion: null };
        const respuesta = await escenaIA(new Request("http://local/api/escena-ia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo), signal: controlador.signal }));
        if (!respuesta.ok) throw new Error(`El asistente respondió HTTP ${respuesta.status}.`);
        // La escena del turno pagado se conserva aunque el contador pare justo después (el coste ya está contado).
        return (await respuesta.json()) as RespuestaTurno;
      },
    });
    escena = refino.escena;
    hechos.erroresAgente += refino.erroresAgente;
    error = refino.error ?? error;
  }

  let puntajes = PUNTAJES_VACIOS;
  let puntajesTodos: Puntajes = PUNTAJES_VACIOS;
  let globosFoto = 0, globosArmados = 0, globosArmadosVisibles = 0;
  if (modelado && escena) {
    hechos.escenaVacia = escena.nodos.length === 0;
    if (deteccion) {
      try {
        const p = puntuarEscena({ lectura: modelado.lectura, escena, deteccion });
        puntajes = p.puntajes;
        puntajesTodos = p.puntajesTodos;
        globosArmadosVisibles = p.piezas.globosArmadosVisibles;
        globosFoto = p.piezas.globosFoto;
        globosArmados = p.piezas.globosArmados;
        if (p.escenaVacia) hechos.escenaVacia = true;
      } catch (e) {
        hechos.errorMedida = true;
        error = error ?? mensajeDe(e);
      }
    }
  }

  o.contador.vigilar(null);
  const paro = o.contador.paro;
  const registro: RegistroPasada = {
    foto: o.nombre, modo: o.modo, transporte: o.transporte, modelo: o.modelo, esfuerzo: o.esfuerzo, pensamiento: o.pensamiento, commit: o.commit, iniciadaEn,
    turnos: refino?.turnosHechos ?? 0, turnosMax: o.turnos, llamadas: o.contador.llamadas - llamadasAntes, deteccionCacheada: cacheada !== null, convergio: refino?.convergio ?? false,
    metrica: "visibles", puntajes, puntajesTodos, puntajePorTurno: refino?.puntajePorTurno ?? [], motivoParada: refino?.motivoParada ?? null, turnoConservado: refino?.turnoConservado ?? 0,
    piezas: { leidas: modelado?.lectura.piezas.length ?? 0, armadas: escena?.nodos.length ?? 0, omitidas: modelado?.omitidas.length ?? 0, globosFoto, globosArmados, globosArmadosVisibles },
    fallos: clasificarFallos(hechos), captura: "pendiente",
    costeUsd: Math.round((o.contador.gastado - gastoAntes) * 1e6) / 1e6,
    abortada: paro, error, ...(avisos.length ? { avisos } : {}),
  };
  return { registro, escena, topeAlcanzado: paro !== null };
}
