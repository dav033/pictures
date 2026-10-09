"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { MAX_SEGUNDOS_AUDIO } from "@/lib/voz/limites";
import { ESTADO_INICIAL, reducirDictado, type EstadoDictado } from "./estado-dictado";
import { codigoDeErrorMicrofono, codigoDeEstadoHttp } from "./mensajes-voz";
import { elegirMimeGrabacion } from "./mime";

const RUTA = "/api/voz/transcribir";
/** El servicio rechaza más de 60 s y el reloj del grabador no es exacto: se corta un poco antes para no perder el dictado. */
export const SEGUNDOS_CORTE = MAX_SEGUNDOS_AUDIO - 1.5;
const MINIMO_MS = 400;
const BITS_POR_SEGUNDO = 32_000;

type VentanaConAudio = Window & { webkitAudioContext?: typeof AudioContext };

type Grabacion = {
  flujo: MediaStream;
  grabadora: MediaRecorder;
  trozos: Blob[];
  inicio: number;
  contexto: AudioContext | null;
  relojes: number[];
};

export type Dictado = {
  estado: EstadoDictado;
  segundos: number;
  /** 0 a 1: qué tan fuerte se oye ahora. */
  nivel: number;
  alternar: () => void;
  cancelar: () => void;
  descartarError: () => void;
};

/**
 * El contexto de audio del medidor de volumen. Se crea (y se reanuda) en el mismo toque que inicia el dictado: iOS Safari
 * lo deja «suspendido», y mudo el medidor, si nace después de esperar el permiso del micrófono. `null` si no hay Web Audio.
 */
function crearContextoAudio(): AudioContext | null {
  try {
    const Contexto = window.AudioContext ?? (window as VentanaConAudio).webkitAudioContext;
    if (!Contexto) return null;
    const contexto = new Contexto();
    void contexto.resume().catch(() => undefined);
    return contexto;
  } catch {
    return null;
  }
}

/** Mide el volumen del micrófono (RMS) sin tocar el audio que se graba. `null` si el navegador no lo permite. */
function medirNivel(flujo: MediaStream, contexto: AudioContext, alNivel: (n: number) => void): number | null {
  try {
    const analizador = contexto.createAnalyser();
    analizador.fftSize = 256;
    contexto.createMediaStreamSource(flujo).connect(analizador);
    const datos = new Uint8Array(analizador.fftSize);
    const reloj = window.setInterval(() => {
      analizador.getByteTimeDomainData(datos);
      let suma = 0;
      for (const v of datos) suma += ((v - 128) / 128) ** 2;
      alNivel(Math.min(1, Math.sqrt(suma / datos.length) * 4));
    }, 90);
    return reloj;
  } catch {
    return null;
  }
}

/**
 * Dictado por voz: toca para grabar, toca para terminar. Graba con MediaRecorder (webm/opus, mp4 en Safari), manda el audio a
 * `/api/voz/transcribir` y entrega el texto a `alTexto`. Suelta el micrófono al terminar, al cancelar (Esc) y al desmontar.
 */
export function useDictado(alTexto: (texto: string) => void, aceptaEsc: (e: KeyboardEvent) => boolean = () => true): Dictado {
  const [estado, despachar] = useReducer(reducirDictado, ESTADO_INICIAL);
  const [segundos, setSegundos] = useState(0);
  const [nivel, setNivel] = useState(0);
  const grabacion = useRef<Grabacion | null>(null);
  const abortador = useRef<AbortController | null>(null);
  const turno = useRef(0);
  const alTextoRef = useRef(alTexto);
  const aceptaEscRef = useRef(aceptaEsc);
  const fase = useRef(estado.fase);
  useEffect(() => { alTextoRef.current = alTexto; aceptaEscRef.current = aceptaEsc; fase.current = estado.fase; });

  const soltar = useCallback(() => {
    const actual = grabacion.current;
    grabacion.current = null;
    if (!actual) return;
    actual.relojes.forEach((r) => window.clearInterval(r));
    actual.flujo.getTracks().forEach((t) => t.stop());
    void actual.contexto?.close().catch(() => undefined);
    setSegundos(0);
    setNivel(0);
  }, []);

  const transcribir = useCallback(async (audio: Blob, miTurno: number) => {
    if (!navigator.onLine) { despachar({ tipo: "fallo", codigo: "sin_conexion" }); return; }
    const control = new AbortController();
    abortador.current = control;
    try {
      const respuesta = await fetch(RUTA, { method: "POST", headers: { "Content-Type": audio.type || "audio/webm" }, body: audio, signal: control.signal });
      if (turno.current !== miTurno) return;
      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => ({}))) as { codigo?: string };
        despachar({ tipo: "fallo", codigo: codigoDeEstadoHttp(respuesta.status, cuerpo.codigo) });
        return;
      }
      const { texto } = (await respuesta.json()) as { texto?: unknown };
      if (turno.current !== miTurno) return;
      if (typeof texto !== "string" || !texto.trim()) { despachar({ tipo: "fallo", codigo: "no_se_entendio" }); return; }
      alTextoRef.current(texto);
      despachar({ tipo: "terminado" });
    } catch {
      if (turno.current !== miTurno) return;
      despachar({ tipo: "fallo", codigo: navigator.onLine ? "fallo" : "sin_conexion" });
    }
  }, []);

  const cancelar = useCallback(() => {
    turno.current += 1;
    abortador.current?.abort();
    abortador.current = null;
    const actual = grabacion.current;
    if (actual) {
      actual.grabadora.onstop = null;
      if (actual.grabadora.state === "recording") actual.grabadora.stop();
    }
    soltar();
    despachar({ tipo: "cancelar" });
  }, [soltar]);

  const terminar = useCallback(() => {
    const actual = grabacion.current;
    if (actual?.grabadora.state !== "recording") return;
    despachar({ tipo: "detener" });
    actual.grabadora.stop();
  }, []);

  const iniciar = useCallback(async () => {
    const miTurno = ++turno.current;
    if (!navigator.onLine) { despachar({ tipo: "fallo", codigo: "sin_conexion" }); return; }
    despachar({ tipo: "pedir" });
    const contexto = crearContextoAudio();
    const cerrarContexto = () => void contexto?.close().catch(() => undefined);
    let flujo: MediaStream;
    try {
      flujo = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      cerrarContexto();
      if (turno.current === miTurno) despachar({ tipo: "fallo", codigo: codigoDeErrorMicrofono(error) });
      return;
    }
    if (turno.current !== miTurno) { flujo.getTracks().forEach((t) => t.stop()); cerrarContexto(); return; }
    let grabadora: MediaRecorder;
    try {
      const mime = elegirMimeGrabacion((m) => MediaRecorder.isTypeSupported(m));
      grabadora = new MediaRecorder(flujo, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: BITS_POR_SEGUNDO });
    } catch {
      flujo.getTracks().forEach((t) => t.stop());
      cerrarContexto();
      despachar({ tipo: "fallo", codigo: "sin_microfono" });
      return;
    }
    const inicio = performance.now();
    const actual: Grabacion = { flujo, grabadora, trozos: [], inicio, contexto, relojes: [] };
    grabacion.current = actual;
    grabadora.ondataavailable = (e) => { if (e.data.size > 0) actual.trozos.push(e.data); };
    grabadora.onstop = () => {
      const duracion = performance.now() - actual.inicio;
      const audio = new Blob(actual.trozos, { type: grabadora.mimeType || actual.trozos[0]?.type || "audio/webm" });
      soltar();
      if (duracion < MINIMO_MS || audio.size === 0) { despachar({ tipo: "fallo", codigo: "muy_corto" }); return; }
      void transcribir(audio, miTurno);
    };
    const medidor = contexto ? medirNivel(flujo, contexto, setNivel) : null;
    if (medidor !== null) actual.relojes.push(medidor);
    actual.relojes.push(window.setInterval(() => {
      const transcurrido = (performance.now() - inicio) / 1000;
      setSegundos(transcurrido);
      if (transcurrido >= SEGUNDOS_CORTE) terminar();
    }, 250));
    grabadora.start();
    despachar({ tipo: "grabando" });
  }, [soltar, terminar, transcribir]);

  const alternar = useCallback(() => {
    if (fase.current === "reposo") void iniciar();
    else if (fase.current === "grabando") terminar();
  }, [iniciar, terminar]);

  // Esc cancela el dictado mientras dura, pero solo si lo pulsó quien dicta (`aceptaEsc`) y nadie lo atendió antes (un diálogo
  // abierto lo usa para cerrarse): sin capturar ni detener la propagación.
  useEffect(() => {
    if (estado.fase === "reposo") return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !aceptaEscRef.current(e)) return;
      e.preventDefault();
      cancelar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [estado.fase, cancelar]);

  useEffect(() => () => {
    turno.current += 1;
    abortador.current?.abort();
    const actual = grabacion.current;
    if (actual) {
      actual.grabadora.onstop = null;
      if (actual.grabadora.state === "recording") actual.grabadora.stop();
    }
    soltar();
  }, [soltar]);

  const descartarError = useCallback(() => despachar({ tipo: "descartar_error" }), []);

  return { estado, segundos, nivel, alternar, cancelar, descartarError };
}
