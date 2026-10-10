"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cabecerasConversacion } from "@/lib/registro/cliente";
import { aplicarDiff, aplicarTurno, textoAplicarTurno } from "@/lib/globos3d/aplicar-turno";
import { mensajeConAlcance, type AlcanceResuelto } from "@/lib/globos3d/alcance-ia";
import { construirCuerpoEscenaIA, mensajeDelPedido, type FotoAdjuntaIA } from "@/lib/globos3d/cuerpo-escena-ia";
import { deshacerTurno, estadoDeTurno, textoDeshacerTurno, type EstadoTurnoEnEscena } from "@/lib/globos3d/deshacer-turno";
import { diffEscenas, diffVacio, idsParaResaltar, type DiffEscena } from "@/lib/globos3d/diff-escenas";
import type { Encuadre } from "@/lib/globos3d/encuadre-foto";
import type { Escena } from "@/lib/globos3d/escena";
import { pedirEscenaIA, type FaseIA, type PasoIA } from "@/lib/globos3d/flujo-escena-ia";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import { resumenDeRefinado, type RondaHecha } from "@/lib/globos3d/refinado/bucle";
import { datosDeRefinado, leerRespuestaIA, mensajeDeError } from "@/lib/globos3d/respuesta-escena-ia";
import { esDeEstaEscena, historialParaModelo, siguienteNumero, tiempoTipico, type AmbitoTurno, type PasoTurno, type TurnoPanel } from "@/lib/globos3d/turnos-ia";
import { RONDAS_AUTOMATICAS, useRefinadoFoto } from "../useRefinadoFoto";
import { crearRegistroFeedback, pasosDelFlujo } from "./registro-feedback";
import { marcarProducido } from "@/components/feedback-ia/producidos";

/** Cuánto se queda marcado en el visor lo que acaba de cambiar la IA. */
const DESTELLO_MS = 5000;

export type Marca = { id: string; nueva: boolean };
/** Lo que está haciendo la IA ahora: el pedido, la fase y los pasos que ya dio. */
export type EnCurso = { pedido: string; contexto: string; foto: boolean; inicio: number; fase: FaseIA; pasos: PasoIA[] };

export type EntradaAsistenteIA = {
  /** La escena que se edita ahora (la entera, o la pieza sola en el editor solitario). */
  escena: Escena;
  /** `escena`, o `pieza:<id de la raíz>` en el editor solitario. */
  ambito: AmbitoTurno;
  /** La identidad de la escena abierta: los turnos de otra escena no actúan sobre esta. */
  clave: string;
  cache: Map<string, PiezaArmada>;
  /** Pone la escena como UN paso nombrado del historial global (Ctrl+Z lo deshace igual que «Deshacer turno»). */
  aplicar: (escena: Escena, etiqueta: string) => void;
  /** Los turnos guardados con la escena. */
  inicial: readonly TurnoPanel[];
  /** Una foto acaba de modelarse y su escena está por aplicarse: la cámara debe ponerse donde estaba la de la foto. */
  verDesdeLaFoto?: (encuadre: Encuadre) => void;
};

export type EnvioIA = { texto: string; foto: FotoAdjuntaIA | null; alcance: AlcanceResuelto; escenaEnteraConElegida: boolean };

/** El id de un turno de «comparando con la foto»: distinto en cada sesión, porque estos turnos se guardan con la escena. */
const idDeRonda = (ronda: number): string => `r${Date.now().toString(36)}${ronda}`;

const pasoDe = (p: { herramienta: string; resumen: string; consulta: boolean }): PasoTurno => ({ herramienta: p.herramienta, resumen: p.resumen, consulta: p.consulta });

/**
 * El asistente de IA del taller como conversación de turnos (D-021): manda el pedido con avance en vivo y «Detener», aplica la
 * respuesta como UN paso nombrado del historial (respetando lo que la persona haya editado mientras tanto), guarda qué cambió
 * en cada turno, deshace y rehace solo lo que tocó ese turno (lo que se puede hacer HOY, mirando la escena), deja ver la
 * escena de antes y marca en el visor lo cambiado. Un turno solo actúa sobre la escena y el editor en que se hizo.
 */
export function useAsistenteIA(entrada: EntradaAsistenteIA) {
  const [turnos, setTurnos] = useState<TurnoPanel[]>(() => [...entrada.inicial]);
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null);
  const [antesId, setAntesId] = useState<string | null>(null);
  const [apuntadas, setApuntadas] = useState<readonly Marca[] | null>(null);
  const [destello, setDestello] = useState<readonly Marca[]>([]);
  /** Lo que se le dijo a la persona al deshacer o rehacer un turno (no se guarda). */
  const [avisos, setAvisos] = useState<Readonly<Record<string, string>>>({});
  /** Los turnos que la persona deshizo con el botón «Deshacer turno» (Ctrl+Z no cuenta aquí): solo ellos cuentan como «deshecho» al calificar. */
  const [deshechosConBoton, setDeshechosConBoton] = useState<ReadonlySet<string>>(() => new Set());
  const control = useRef<AbortController | null>(null);
  /** Escenas, solicitud y pasos de cada turno para calificarlo (REQ-010). */
  const [registroFeedback] = useState(crearRegistroFeedback);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Dónde se pidió la comparación con la foto: si se cambia de escena o de editor, las rondas paran. */
  const origenRefinado = useRef<{ clave: string; ambito: AmbitoTurno } | null>(null);
  const ultima = useRef(entrada);
  useEffect(() => { ultima.current = entrada; });
  useEffect(() => () => { control.current?.abort(); if (reloj.current) clearTimeout(reloj.current); }, []);

  const agregar = (turno: TurnoPanel) => setTurnos((t) => [...t, turno]);
  const destacar = (marcas: readonly Marca[]) => {
    if (reloj.current) clearTimeout(reloj.current);
    setDestello(marcas);
    reloj.current = setTimeout(() => setDestello([]), DESTELLO_MS);
  };

  const refinado = useRefinadoFoto({
    alRonda: (r: RondaHecha) => {
      const u = ultima.current;
      const origen = origenRefinado.current;
      if (!origen || !esDeEstaEscena(origen, u.clave, u.ambito)) { refinado.detener(); return; }
      const diff = diffEscenas(r.antes, r.escena, { cache: u.cache });
      const aplicada = aplicarTurno(u.escena, r.antes, r.escena, diff);
      u.aplicar(aplicada.escena, `Ronda ${r.ronda} con la foto`);
      destacar(idsParaResaltar(aplicada.diff));
      const idRonda = idDeRonda(r.ronda);
      registroFeedback.guardar(idRonda, { pasos: [], escenaAntes: r.antes, escenaDespues: aplicada.escena });
      marcarProducido(idRonda);
      setTurnos((t) => [...t, {
        id: idRonda, numero: siguienteNumero(t), pedido: `Ronda ${r.ronda} con la foto`, contexto: "comparando con la foto", ambito: u.ambito, clave: u.clave, foto: true,
        respuesta: r.respuesta.slice(0, 1400), pasos: r.cambios.map(pasoDe), diff: aplicada.diff, pregunta: null, costeUsd: null, ms: 0, estado: "aplicado", nota: textoAplicarTurno(aplicada.conservadas),
      }]);
    },
    // Al terminar se carga todo lo que costó la comparación (también las rondas sin cambios, las rechazadas y su revisión) al último turno.
    alTerminar: (r) => {
      const resumen = resumenDeRefinado(r);
      if (!resumen && !r.costeUsd) return;
      setTurnos((t) => {
        const ultimo = t[t.length - 1];
        if (!ultimo) return t;
        const costeUsd = r.costeUsd ? (ultimo.costeUsd ?? 0) + r.costeUsd : ultimo.costeUsd;
        return [...t.slice(0, -1), { ...ultimo, costeUsd, nota: resumen ? [ultimo.nota, resumen].filter(Boolean).join(" ") : ultimo.nota }];
      });
    },
  });

  /** Manda un pedido. `true` si la IA contestó (aunque no haya cambiado nada); `false` si falló o se detuvo. */
  const enviar = async (envio: EnvioIA): Promise<boolean> => {
    const pedido = mensajeDelPedido(envio.texto, envio.foto);
    if (!pedido || control.current || refinado.refinando) return false;
    const inicio = Date.now();
    const { escena: antes, ambito, clave } = ultima.current;
    const mio = new AbortController();
    control.current = mio;
    const vistos: PasoTurno[] = [];
    const pasosFlujo: PasoIA[] = [];
    setAntesId(null);
    setEnCurso({ pedido, contexto: envio.alcance.contexto, foto: envio.foto !== null, inicio, fase: envio.foto ? "leyendo_foto" : "pensando", pasos: [] });
    const base = { id: `t${inicio.toString(36)}`, numero: siguienteNumero(turnos), pedido, contexto: envio.alcance.contexto, ambito, clave, foto: envio.foto !== null };
    const sinHacer = (estado: "error" | "detenido", nota: string): false => {
      agregar({ ...base, respuesta: "", pasos: vistos, diff: null, pregunta: null, costeUsd: null, ms: Date.now() - inicio, estado, nota });
      return false;
    };
    try {
      const { estado, datos, solicitudId } = await pedirEscenaIA({
        cuerpo: construirCuerpoEscenaIA({
          escena: antes, mensaje: mensajeConAlcance(pedido, envio.alcance, envio.escenaEnteraConElegida), historial: historialParaModelo(turnos.filter((t) => esDeEstaEscena(t, clave, ambito))),
          seleccion: envio.alcance.seleccion, foto: envio.foto,
        }),
        cabeceras: cabecerasConversacion("3d"),
        signal: mio.signal,
        alEvento: (e) => {
          if (e.tipo === "paso") { vistos.push(pasoDe(e)); pasosFlujo.push(e); }
          setEnCurso((c) => (c ? (e.tipo === "fase" ? { ...c, fase: e.fase } : { ...c, pasos: [...c.pasos, e] }) : c));
        },
      });
      const r = estado >= 200 && estado < 300 ? leerRespuestaIA(datos) : null;
      if (!r) return sinHacer("error", mensajeDeError(datos));
      const completo = r.acciones.some((a) => !a.consulta) ? diffEscenas(antes, r.escena, { cache: ultima.current.cache }) : null;
      let diff: DiffEscena | null = completo && !diffVacio(completo) ? completo : null;
      let nota: string | null = null;
      /** La escena que quedó con este turno (la de antes si no se aplicó nada). */
      let despues: Escena = antes;
      if (diff) {
        const u = ultima.current;
        if (!esDeEstaEscena({ clave, ambito }, u.clave, u.ambito)) {
          nota = "Cambiaste de escena o de editor mientras la IA trabajaba: no apliqué sus cambios. Vuelve a pedírselo.";
          diff = null;
        } else {
          const aplicada = aplicarTurno(u.escena, antes, r.escena, diff);
          diff = aplicada.diff;
          // Una escena armada desde una foto se ve desde el mismo ángulo que la foto (antes quedaba la vista de siempre y no se parecía).
          const deLaFoto = envio.foto ? datosDeRefinado(r.foto) : null;
          if (deLaFoto) u.verDesdeLaFoto?.(deLaFoto.encuadre);
          u.aplicar(aplicada.escena, `Turno ${base.numero} de la IA`);
          despues = aplicada.escena;
          nota = textoAplicarTurno(aplicada.conservadas);
          destacar(idsParaResaltar(diff));
        }
      }
      registroFeedback.guardar(base.id, { ...(solicitudId ? { solicitudId } : {}), pasos: pasosDelFlujo(pasosFlujo), escenaAntes: antes, escenaDespues: despues });
      marcarProducido(base.id);
      agregar({
        ...base, respuesta: r.respuesta, pasos: r.acciones.map(pasoDe), diff, pregunta: r.pregunta, costeUsd: r.costeEstimadoUsd, ms: Date.now() - inicio,
        estado: diff ? "aplicado" : "sin_cambios", nota,
      });
      const comparable = envio.foto ? datosDeRefinado(r.foto) : null;
      if (envio.foto && comparable && RONDAS_AUTOMATICAS > 0) {
        origenRefinado.current = { clave, ambito };
        void refinado.iniciar({ escena: r.escena, foto: envio.foto, lectura: comparable.lectura, encuadre: comparable.encuadre });
      }
      return true;
    } catch (causa) {
      return causa instanceof DOMException && causa.name === "AbortError"
        ? sinHacer("detenido", "Detuve el pedido: no se cambió nada.")
        : sinHacer("error", "No pude hablar con la IA ahora. Revisa la conexión y vuelve a intentarlo.");
    } finally {
      if (control.current === mio) control.current = null;
      setEnCurso(null);
    }
  };

  const detener = () => { control.current?.abort(); refinado.detener(); };

  const delTurno = (id: string): TurnoPanel | null => {
    const turno = turnos.find((t) => t.id === id);
    const u = ultima.current;
    return turno?.diff && esDeEstaEscena(turno, u.clave, u.ambito) ? turno : null;
  };
  const avisar = (id: string, texto: string) => setAvisos((a) => ({ ...a, [id]: texto }));

  /** Revierte SOLO lo que tocó ese turno (campo a campo; lo editado a mano después se conserva) como un paso nombrado del historial. */
  const deshacer = (id: string) => {
    const turno = delTurno(id);
    if (!turno?.diff) return;
    const u = ultima.current;
    const r = deshacerTurno(u.escena, turno.diff);
    if (r.revertidas.length) {
      u.aplicar(r.escena, `Deshacer turno ${turno.numero}`);
      setDeshechosConBoton((s) => new Set(s).add(id));
      destacar(r.revertidas.filter((x) => x !== "sala").map((x) => ({ id: x, nueva: false })));
    }
    setAntesId(null);
    avisar(id, textoDeshacerTurno(r, `el turno ${turno.numero}`));
  };

  /** Vuelve a aplicar un turno que se deshizo (con el botón o con Ctrl+Z), con la misma regla: solo lo que la persona no cambió. */
  const rehacer = (id: string) => {
    const turno = delTurno(id);
    if (!turno?.diff) return;
    const u = ultima.current;
    const r = aplicarDiff(u.escena, turno.diff);
    if (r.escena !== u.escena) {
      u.aplicar(r.escena, `Rehacer turno ${turno.numero}`);
      setDeshechosConBoton((s) => { const n = new Set(s); n.delete(id); return n; });
      destacar(idsParaResaltar(r.diff));
      setTurnos((t) => t.map((x) => (x.id === id ? { ...x, diff: r.diff } : x)));
    }
    setAntesId(null);
    avisar(id, textoAplicarTurno(r.conservadas) ?? (r.escena === u.escena ? `No había nada que rehacer en el turno ${turno.numero}.` : `Rehice el turno ${turno.numero}.`));
  };

  const verAntes = (id: string | null) => setAntesId((actual) => (actual === id ? null : id));
  const turnoAntes = antesId ? turnos.find((t) => t.id === antesId) ?? null : null;
  const { escena, ambito, clave } = entrada;
  const escenaAntes = useMemo(
    () => (turnoAntes?.diff && esDeEstaEscena(turnoAntes, clave, ambito) ? deshacerTurno(escena, turnoAntes.diff).escena : null),
    [turnoAntes, escena, ambito, clave],
  );
  /** Qué se puede hacer hoy con cada turno de esta escena y este editor (no lo que se guardó: Ctrl+Z y Ctrl+Y también cuentan). */
  const estados = useMemo(() => {
    const salida: Record<string, EstadoTurnoEnEscena> = {};
    for (const t of turnos) if (t.diff && esDeEstaEscena(t, clave, ambito)) salida[t.id] = estadoDeTurno(escena, t.diff);
    return salida;
  }, [turnos, escena, ambito, clave]);

  const borrar = () => { if (control.current) return; registroFeedback.vaciar(); setDeshechosConBoton(new Set()); setTurnos([]); setAntesId(null); setDestello([]); setAvisos({}); };
  const ultimoTurno = turnos[turnos.length - 1];
  const preguntaPendiente = !enCurso && ultimoTurno?.pregunta && esDeEstaEscena(ultimoTurno, clave, ambito) ? { turnoId: ultimoTurno.id, ...ultimoTurno.pregunta } : null;

  return {
    turnos, enCurso, refinando: refinado.refinando, ocupado: enCurso !== null || refinado.refinando !== null,
    enviar, detener, deshacer, rehacer, verAntes, antesId: escenaAntes ? antesId : null, escenaAntes, borrar, preguntaPendiente, estados, avisos, deshechosConBoton,
    /** Escenas, solicitud y pasos del turno para calificarlo (REQ-010); `undefined` si es de una sesión anterior. */
    datosFeedback: registroFeedback.leer,
    /** Qué piezas marca el visor: lo que se señala con el cursor y, si no, lo que acaba de cambiar la IA. */
    marcas: apuntadas ?? destello, apuntar: setApuntadas,
    tiempo: tiempoTipico(turnos),
    costeTotalUsd: turnos.reduce((s, t) => s + (t.costeUsd ?? 0), 0),
  };
}

export type AsistenteIA = ReturnType<typeof useAsistenteIA>;
