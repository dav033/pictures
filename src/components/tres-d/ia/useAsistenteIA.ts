"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cabecerasConversacion } from "@/lib/registro/cliente";
import { aplicarTurno, textoAplicarTurno } from "@/lib/globos3d/aplicar-turno";
import { mensajeConAlcance, type AlcanceResuelto } from "@/lib/globos3d/alcance-ia";
import { construirCuerpoEscenaIA, mensajeDelPedido, type FotoAdjuntaIA } from "@/lib/globos3d/cuerpo-escena-ia";
import { deshacerTurno, textoDeshacerTurno } from "@/lib/globos3d/deshacer-turno";
import { diffEscenas, diffVacio, idsParaResaltar, type DiffEscena } from "@/lib/globos3d/diff-escenas";
import type { Escena } from "@/lib/globos3d/escena";
import { pedirEscenaIA, type FaseIA, type PasoIA } from "@/lib/globos3d/flujo-escena-ia";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import { resumenDeRefinado, type RondaHecha } from "@/lib/globos3d/refinado/bucle";
import { datosDeRefinado, leerRespuestaIA, mensajeDeError } from "@/lib/globos3d/respuesta-escena-ia";
import { historialParaModelo, siguienteNumero, tiempoTipico, type AmbitoTurno, type PasoTurno, type TurnoPanel } from "@/lib/globos3d/turnos-ia";
import { RONDAS_AUTOMATICAS, useRefinadoFoto } from "../useRefinadoFoto";

/** Cuánto se queda marcado en el visor lo que acaba de cambiar la IA. */
const DESTELLO_MS = 5000;

export type Marca = { id: string; nueva: boolean };
/** Lo que está haciendo la IA ahora: el pedido, la fase y los pasos que ya dio. */
export type EnCurso = { pedido: string; contexto: string; foto: boolean; inicio: number; fase: FaseIA; pasos: PasoIA[] };

export type EntradaAsistenteIA = {
  /** La escena que se edita ahora (la entera, o la pieza sola en el editor solitario). */
  escena: Escena;
  ambito: AmbitoTurno;
  cache: Map<string, PiezaArmada>;
  /** Pone la escena como UN paso nombrado del historial global (Ctrl+Z lo deshace igual que «Deshacer turno»). */
  aplicar: (escena: Escena, etiqueta: string) => void;
  /** Los turnos guardados con la escena. */
  inicial: readonly TurnoPanel[];
};

export type EnvioIA = { texto: string; foto: FotoAdjuntaIA | null; alcance: AlcanceResuelto; escenaEnteraConElegida: boolean };

const pasoDe = (p: { herramienta: string; resumen: string; consulta: boolean }): PasoTurno => ({ herramienta: p.herramienta, resumen: p.resumen, consulta: p.consulta });

/**
 * El asistente de IA del taller como conversación de turnos (D-021): manda el pedido con avance en vivo y «Detener», aplica la
 * respuesta como UN paso nombrado del historial (respetando lo que la persona haya editado mientras tanto), guarda qué cambió
 * en cada turno, deshace solo lo que tocó ese turno, deja ver la escena de antes y marca en el visor lo cambiado.
 */
export function useAsistenteIA(entrada: EntradaAsistenteIA) {
  const [turnos, setTurnos] = useState<TurnoPanel[]>(() => [...entrada.inicial]);
  const [enCurso, setEnCurso] = useState<EnCurso | null>(null);
  const [antesId, setAntesId] = useState<string | null>(null);
  const [apuntadas, setApuntadas] = useState<readonly Marca[] | null>(null);
  const [destello, setDestello] = useState<readonly Marca[]>([]);
  const control = useRef<AbortController | null>(null);
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      const diff = diffEscenas(r.antes, r.escena, { cache: u.cache });
      const aplicada = aplicarTurno(u.escena, r.antes, r.escena, diff);
      u.aplicar(aplicada.escena, `Ronda ${r.ronda} con la foto`);
      destacar(idsParaResaltar(diff));
      setTurnos((t) => [...t, {
        id: `r${Date.now().toString(36)}${r.ronda}`, numero: siguienteNumero(t), pedido: `Ronda ${r.ronda} con la foto`, contexto: "comparando con la foto", ambito: u.ambito, foto: true,
        respuesta: r.respuesta.slice(0, 1400), pasos: r.cambios.map(pasoDe), diff, pregunta: null, costeUsd: null, ms: 0, estado: "aplicado", nota: textoAplicarTurno(aplicada.conservadas),
      }]);
    },
    alTerminar: (r) => {
      const resumen = resumenDeRefinado(r);
      if (!resumen) return;
      setTurnos((t) => {
        const ultimo = t[t.length - 1];
        return ultimo ? [...t.slice(0, -1), { ...ultimo, nota: [ultimo.nota, resumen].filter(Boolean).join(" ") }] : t;
      });
    },
  });

  /** Manda un pedido. `true` si la IA contestó (aunque no haya cambiado nada); `false` si falló o se detuvo. */
  const enviar = async (envio: EnvioIA): Promise<boolean> => {
    const pedido = mensajeDelPedido(envio.texto, envio.foto);
    if (!pedido || control.current || refinado.refinando) return false;
    const inicio = Date.now();
    const { escena: antes, ambito } = ultima.current;
    const mio = new AbortController();
    control.current = mio;
    const vistos: PasoTurno[] = [];
    setAntesId(null);
    setEnCurso({ pedido, contexto: envio.alcance.contexto, foto: envio.foto !== null, inicio, fase: envio.foto ? "leyendo_foto" : "pensando", pasos: [] });
    const base = { id: `t${inicio.toString(36)}`, numero: siguienteNumero(turnos), pedido, contexto: envio.alcance.contexto, ambito, foto: envio.foto !== null };
    const sinHacer = (estado: "error" | "detenido", nota: string): false => {
      agregar({ ...base, respuesta: "", pasos: vistos, diff: null, pregunta: null, costeUsd: null, ms: Date.now() - inicio, estado, nota });
      return false;
    };
    try {
      const { estado, datos } = await pedirEscenaIA({
        cuerpo: construirCuerpoEscenaIA({
          escena: antes, mensaje: mensajeConAlcance(pedido, envio.alcance, envio.escenaEnteraConElegida), historial: historialParaModelo(turnos),
          seleccion: envio.alcance.seleccion, foto: envio.foto,
        }),
        cabeceras: cabecerasConversacion("3d"),
        signal: mio.signal,
        alEvento: (e) => {
          if (e.tipo === "paso") vistos.push(pasoDe(e));
          setEnCurso((c) => (c ? (e.tipo === "fase" ? { ...c, fase: e.fase } : { ...c, pasos: [...c.pasos, e] }) : c));
        },
      });
      const r = estado >= 200 && estado < 300 ? leerRespuestaIA(datos) : null;
      if (!r) return sinHacer("error", mensajeDeError(datos));
      const completo = r.acciones.some((a) => !a.consulta) ? diffEscenas(antes, r.escena, { cache: ultima.current.cache }) : null;
      let diff: DiffEscena | null = completo && !diffVacio(completo) ? completo : null;
      let nota: string | null = null;
      if (diff) {
        const u = ultima.current;
        if (u.ambito !== ambito) {
          nota = "Cambiaste de editor mientras la IA trabajaba: no apliqué sus cambios. Vuelve a pedírselo.";
          diff = null;
        } else {
          const aplicada = aplicarTurno(u.escena, antes, r.escena, diff);
          u.aplicar(aplicada.escena, `Turno ${base.numero} de la IA`);
          nota = textoAplicarTurno(aplicada.conservadas);
          destacar(idsParaResaltar(diff));
        }
      }
      agregar({
        ...base, respuesta: r.respuesta, pasos: r.acciones.map(pasoDe), diff, pregunta: r.pregunta, costeUsd: r.costeEstimadoUsd, ms: Date.now() - inicio,
        estado: diff ? "aplicado" : "sin_cambios", nota,
      });
      const comparable = envio.foto ? datosDeRefinado(r.foto) : null;
      if (envio.foto && comparable && RONDAS_AUTOMATICAS > 0) void refinado.iniciar({ escena: r.escena, foto: envio.foto, lectura: comparable.lectura, encuadre: comparable.encuadre });
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

  /** Revierte SOLO lo que tocó ese turno (lo editado a mano después se conserva) como un paso nombrado del historial. */
  const deshacer = (id: string) => {
    const turno = turnos.find((t) => t.id === id);
    const u = ultima.current;
    if (!turno?.diff || turno.estado === "deshecho" || turno.ambito !== u.ambito) return;
    const r = deshacerTurno(u.escena, turno.diff);
    if (r.revertidas.length) {
      u.aplicar(r.escena, `Deshacer turno ${turno.numero}`);
      destacar(r.revertidas.filter((x) => x !== "sala").map((x) => ({ id: x, nueva: false })));
    }
    setAntesId(null);
    setTurnos((t) => t.map((x) => (x.id === id ? { ...x, estado: r.revertidas.length || !r.conservadas.length ? "deshecho" : x.estado, nota: textoDeshacerTurno(r, `el turno ${turno.numero}`) } : x)));
  };

  const verAntes = (id: string | null) => setAntesId((actual) => (actual === id ? null : id));
  const turnoAntes = antesId ? turnos.find((t) => t.id === antesId) ?? null : null;
  const { escena, ambito } = entrada;
  const escenaAntes = useMemo(
    () => (turnoAntes?.diff && turnoAntes.ambito === ambito ? deshacerTurno(escena, turnoAntes.diff).escena : null),
    [turnoAntes, escena, ambito],
  );

  const borrar = () => { if (control.current) return; setTurnos([]); setAntesId(null); setDestello([]); };
  const ultimoTurno = turnos[turnos.length - 1];
  const preguntaPendiente = !enCurso && ultimoTurno?.pregunta ? { turnoId: ultimoTurno.id, ...ultimoTurno.pregunta } : null;

  return {
    turnos, enCurso, refinando: refinado.refinando, ocupado: enCurso !== null || refinado.refinando !== null,
    enviar, detener, deshacer, verAntes, antesId: escenaAntes ? antesId : null, escenaAntes, borrar, preguntaPendiente,
    /** Qué piezas marca el visor: lo que se señala con el cursor y, si no, lo que acaba de cambiar la IA. */
    marcas: apuntadas ?? destello, apuntar: setApuntadas,
    tiempo: tiempoTipico(turnos),
    costeTotalUsd: turnos.reduce((s, t) => s + (t.costeUsd ?? 0), 0),
  };
}

export type AsistenteIA = ReturnType<typeof useAsistenteIA>;
