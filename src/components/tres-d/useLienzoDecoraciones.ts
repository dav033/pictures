"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  armarEscena, armarNodoSuelto, descendientes, girarNodo, idNuevo, quitarNodo,
  type Caja, type Colocacion, type Escena, type EscenaArmada, type NodoArmado, type NodoEscena,
} from "@/lib/globos3d/escena";
import { armarPieza, type PiezaArmada, type Pieza } from "@/lib/globos3d/piezas";
import { agregarDecoracion } from "@/lib/globos3d/decoraciones-escena";
import { insertarEnEscena } from "@/lib/globos3d/biblioteca";
import {
  aceptaDecoraciones, colocacionEnSala, colocacionSobre, copiaEn, deslizarSobre, moverCopia, quitarCopia, radioLateral, separarCopia, sitioDeSobre, sitioEnPieza,
  type SuperficieSala,
} from "@/lib/globos3d/lienzo-escena";
import type { EscenaGlobos, GloboColocadoEnEscena, Punto3, TuboEnEscena } from "./escena-globos";
import type { DecoracionArrastrada } from "./arrastre-decoracion";

/** Una copia concreta de una pieza (la de un reparto en anclas que se tocó en el visor). */
export type CopiaElegida = { id: string; copia: number };

type Opciones = {
  lienzoRef: RefObject<HTMLCanvasElement | null>;
  visorRef: RefObject<EscenaGlobos | null>;
  activo: boolean;
  escena: Escena;
  armada: EscenaArmada | null;
  seleccion: string | null;
  copia: CopiaElegida | null;
  onCopia: (copia: CopiaElegida | null) => void;
  onSeleccion: (id: string | null) => void;
  onCambio: (escena: Escena) => void;
  /** Qué pasó al soltar (o por qué no se puso), para mostrarlo sobre el visor; `null` lo borra. */
  onAviso: (texto: string | null) => void;
  /** Lo armado de una pieza, como lo dibuja el visor. */
  aEscena: (n: NodoArmado) => { globos: GloboColocadoEnEscena[]; tubos: TuboEnEscena[] };
  cache: Map<string, PiezaArmada>;
};

/** Menos que esto (px) entre apretar y soltar es un clic, no un arrastre. */
const UMBRAL_PX = 6;
const ARRIBA: Punto3 = { x: 0, y: 1, z: 0 };
const ID_FANTASMA = "__fantasma__";
const LUGARES_VALIDOS = "una columna, un arco, un aro, una guirnalda, una pared de globos, una pared o el techo (lo marcado en verde)";
const LUGARES_SALA = "el piso, una pared o el techo (lo marcado en verde)";

/** Lo colgado de un ancla o apoyado sobre otra pieza: se puede coger con el ratón y mover por la superficie. */
const colgada = (n: NodoEscena | undefined): n is NodoEscena => n !== undefined && (n.colocacion.en === "ancla" || n.colocacion.en === "sobre");

function escribiendo(objetivo: EventTarget | null): boolean {
  return objetivo instanceof HTMLElement && (objetivo.isContentEditable || Boolean(objetivo.closest("input, textarea, select, [contenteditable='true'], [role='menu']")));
}

const SUPERFICIE: Readonly<Record<SuperficieSala, string>> = { piso: "en el piso", techo: "colgada del techo", fondo: "en la pared del fondo", izquierda: "en la pared izquierda", derecha: "en la pared derecha" };

type Sesion = {
  pieza: Pieza;
  nombre: string;
  /** Del panel: la decoración nueva; del visor: la copia que se cogió. */
  nueva: DecoracionArrastrada | null;
  origen: (CopiaElegida & { padreId: string | null; caja: NodoArmado["caja"] | null }) | null;
  candidatos: string[];
  inicio: { x: number; y: number };
  puntero: { x: number; y: number; alt: boolean };
  movido: boolean;
  destino: { colocacion: Colocacion; donde: string } | null;
  /** Arrastre desde el panel: se escucha en la ventana; desde el visor: en el lienzo (con captura del puntero). */
  desdePanel: boolean;
  /** Una pieza entera (no una decoración): solo va a la sala (piso, paredes, techo), no sobre otra pieza. */
  soloSala: boolean;
  /** Lo que ocupa la pieza (de pie y de frente), medido una vez al empezar: no se rearma en cada cuadro. */
  cajas: { piso: Caja; frente: Caja } | null;
  idPuntero: number | null;
  etiqueta: HTMLDivElement | null;
};

/**
 * La estructura como lienzo, en el visor:
 * - arrastrar una decoración del panel al visor: se marcan las piezas que la aceptan y las paredes/techo, debajo
 *   del puntero se ve dónde quedaría (vista previa ya orientada sobre la superficie) y al soltar queda ahí (fuera de
 *   un sitio válido no se pone y se dice por qué);
 * - pasar el ratón por una decoración colgada resalta SOLO esa copia; cogerla y arrastrarla la desliza por la
 *   superficie de su estructura o la pasa a otra (si venía de un reparto en anclas, se separa: las demás se quedan);
 * - con una copia elegida (o una pieza `sobre`): flechas la deslizan por la superficie, Q/E la giran, Supr la quita.
 * Imán a las anclas a menos de 6 cm (Alt lo quita). Todo con deshacer/rehacer (cada suelta es un paso).
 */
export function useLienzoDecoraciones(opciones: Opciones) {
  const datos = useRef(opciones);
  useEffect(() => { datos.current = opciones; });
  const sesionRef = useRef<Sesion | null>(null);
  const cuadroRef = useRef(0);
  const { activo, lienzoRef, visorRef } = opciones;

  /** La vista previa y el destino donde está ahora el puntero. */
  const actualizar = useCallback(() => {
    cuadroRef.current = 0;
    const s = sesionRef.current;
    const visor = visorRef.current;
    const lienzo = lienzoRef.current;
    const d = datos.current;
    if (!s || !visor || !lienzo || !d.armada || !s.movido) return;
    if (s.etiqueta) { s.etiqueta.style.left = `${s.puntero.x + 14}px`; s.etiqueta.style.top = `${s.puntero.y + 10}px`; }
    const r = lienzo.getBoundingClientRect();
    const encima = s.puntero.x >= r.left && s.puntero.x <= r.right && s.puntero.y >= r.top && s.puntero.y <= r.bottom;
    const lugar = encima ? visor.lugarEn(s.puntero.x, s.puntero.y, { nodos: s.soloSala ? [] : s.candidatos, sala: true, preferir: s.origen?.padreId ?? null }) : null;
    let destino: Sesion["destino"] = null;
    if (lugar?.tipo === "nodo") {
      const padre = d.armada.porNodo.find((n) => n.id === lugar.nodo);
      if (padre) {
        const sitio = sitioEnPieza(padre, lugar.punto, { normal: lugar.normal, radioCm: radioLateral(s.pieza), iman: !s.puntero.alt });
        const giro = s.origen ? (() => { const c = d.escena.nodos.find((n) => n.id === s.origen?.id)?.colocacion; return c && "giroGrados" in c ? c.giroGrados : 0; })() : 0;
        const colocacion = colocacionSobre(padre, sitio, giro);
        if (colocacion) destino = { colocacion, donde: `sobre «${padre.nombre}»${sitio.ancla !== null ? ` (pegada al ancla ${sitio.ancla + 1})` : ""}` };
      }
    } else if (lugar?.tipo === "sala") {
      destino = { colocacion: colocacionEnSala(d.escena.sala, lugar.superficie, lugar.punto, s.pieza, s.cajas ?? undefined), donde: SUPERFICIE[lugar.superficie] };
    }
    s.destino = destino;
    if (s.etiqueta) s.etiqueta.textContent = destino ? `Soltar ${destino.donde}` : `«${s.nombre}»: suéltala sobre ${s.soloSala ? LUGARES_SALA : LUGARES_VALIDOS}`;
    if (encima) lienzo.style.cursor = destino ? "grabbing" : "no-drop";
    if (!destino) { visor.mostrarFantasma([], []); return; }
    const armado = armarNodoSuelto(d.escena, d.armada, { id: ID_FANTASMA, nombre: s.nombre, pieza: s.pieza, colocacion: destino.colocacion }, d.cache);
    const { globos, tubos } = d.aEscena(armado);
    visor.mostrarFantasma(globos, tubos);
  }, [lienzoRef, visorRef]);

  const pedirCuadro = useCallback(() => { if (!cuadroRef.current) cuadroRef.current = requestAnimationFrame(actualizar); }, [actualizar]);

  /** Arranca de verdad el arrastre (pasado el umbral): marca dónde se puede soltar. */
  const empezarAMover = useCallback((s: Sesion) => {
    const visor = visorRef.current;
    const d = datos.current;
    if (!visor || !d.armada) return;
    s.movido = true;
    const fuera = s.origen ? descendientes(d.escena, s.origen.id) : new Set<string>();
    s.candidatos = s.soloSala ? [] : d.escena.nodos.filter((n) => !fuera.has(n.id) && aceptaDecoraciones(n, d.armada?.porNodo.find((x) => x.id === n.id))).map((n) => n.id);
    if (s.soloSala && !s.cajas) {
      // Una vez: lo que ocupa de pie y de frente (la del caché si la escena ya la armó).
      const caja = (p: Pieza) => (d.cache.get(JSON.stringify(p)) ?? armarPieza(p)).caja;
      s.cajas = { piso: caja(s.pieza), frente: caja(s.pieza) };
    }
    visor.resaltarLugares(s.candidatos.flatMap((id) => { const c = d.armada?.porNodo.find((x) => x.id === id)?.caja; return c ? [c] : []; }), true);
    visor.resaltarEncima(null);
    if (s.origen?.caja) visor.ocultarCopia(s.origen.id, s.origen.caja);
    if (s.desdePanel) {
      const etiqueta = document.createElement("div");
      etiqueta.setAttribute("role", "status");
      // La etiqueta que sigue al puntero («Soltar en…»), con los colores del taller.
      etiqueta.style.cssText = "position:fixed;z-index:60;pointer-events:none;max-width:22rem;padding:3px 8px;border-radius:6px;font-size:12px;background:var(--taller-valido-fondo);color:var(--taller-sobre-valido);box-shadow:0 2px 8px var(--sombra)";
      document.body.appendChild(etiqueta);
      s.etiqueta = etiqueta;
    }
    d.onAviso(null);
  }, [visorRef]);

  const limpiar = useCallback(() => {
    const s = sesionRef.current;
    sesionRef.current = null;
    if (cuadroRef.current) { cancelAnimationFrame(cuadroRef.current); cuadroRef.current = 0; }
    const visor = visorRef.current;
    visor?.mostrarFantasma([], []);
    visor?.resaltarLugares([], false);
    visor?.ocultarCopia(null);
    visor?.orbitar(true);
    s?.etiqueta?.remove();
    const lienzo = lienzoRef.current;
    if (lienzo) {
      lienzo.style.cursor = "";
      if (s?.idPuntero !== null && s?.idPuntero !== undefined && lienzo.hasPointerCapture(s.idPuntero)) lienzo.releasePointerCapture(s.idPuntero);
    }
  }, [lienzoRef, visorRef]);

  /** Suelta: pone la decoración nueva o mueve la copia cogida al destino (un paso del historial). */
  const soltar = useCallback(() => {
    const s = sesionRef.current;
    const d = datos.current;
    if (!s) return;
    if (s.movido) actualizar();
    const destino = s.destino;
    limpiar();
    if (!s.movido || !d.armada) return;
    if (!destino) { d.onAviso(`Ahí no se puede poner «${s.nombre}»: suéltala sobre ${s.soloSala ? LUGARES_SALA : LUGARES_VALIDOS}.`); return; }
    if (s.nueva?.item) {
      // De la biblioteca: el item entero (la estructura y lo que lleva), con su raíz donde se soltó.
      const hecho = insertarEnEscena(d.escena, s.nueva.item, destino.colocacion, d.cache);
      d.onCambio(hecho.escena);
      d.onSeleccion(hecho.raizId);
      d.onCopia(null);
      d.onAviso(`Listo: «${s.nombre}» quedó ${destino.donde}${hecho.ids.length > 1 ? ` con sus ${hecho.ids.length - 1} decoraciones` : ""}. Arrástrala para moverla o ábrela con «Editar sola».`);
      return;
    }
    if (s.nueva?.pieza) {
      const id = idNuevo(d.escena, s.nueva.idBase);
      d.onCambio({ ...d.escena, nodos: [...d.escena.nodos, { id, nombre: s.nueva.nombre, pieza: structuredClone(s.nueva.pieza), colocacion: destino.colocacion }] });
      d.onSeleccion(id);
      d.onCopia(null);
      d.onAviso(`Listo: «${s.nombre}» quedó ${destino.donde}. Arrástrala para moverla o ábrela con «Editar sola».`);
      return;
    }
    if (s.nueva) {
      const { escena, id } = agregarDecoracion(d.escena, s.nueva.decoracion, { en: "sitio", colocacion: destino.colocacion }, { nombre: s.nueva.nombre, idBase: s.nueva.idBase });
      d.onCambio(escena);
      d.onSeleccion(id);
      d.onCopia(null);
      d.onAviso(`Listo: «${s.nombre}» quedó ${destino.donde}. Arrástrala para moverla; flechas, Q/E y Supr con ella elegida.`);
      return;
    }
    if (!s.origen) return;
    const hecho = moverCopia(d.escena, d.armada, s.origen.id, s.origen.copia, destino.colocacion);
    if (!hecho) { d.onAviso(`«${s.nombre}» no puede ir sobre sí misma.`); return; }
    d.onCambio(hecho.escena);
    d.onSeleccion(hecho.id);
    d.onCopia(null);
    d.onAviso(`«${s.nombre}» ${hecho.id !== s.origen.id ? "se separó de su reparto y " : ""}quedó ${destino.donde}.`);
  }, [actualizar, limpiar]);

  // Arrastre desde el panel: la ventana sigue al puntero hasta soltar (Esc cancela).
  const empezarArrastre = useCallback((nueva: DecoracionArrastrada, inicio: { x: number; y: number }) => {
    if (!datos.current.activo || sesionRef.current) return;
    const s: Sesion = {
      pieza: nueva.pieza ? structuredClone(nueva.pieza) : { tipo: "decoracion", decoracion: structuredClone(nueva.decoracion) }, nombre: nueva.nombre, nueva, origen: null, candidatos: [],
      inicio, puntero: { ...inicio, alt: false }, movido: false, destino: null, desdePanel: true, idPuntero: null, etiqueta: null,
      soloSala: Boolean(nueva.pieza), cajas: null,
    };
    sesionRef.current = s;
    const alMover = (e: PointerEvent) => {
      if (sesionRef.current !== s) return;
      s.puntero = { x: e.clientX, y: e.clientY, alt: e.altKey };
      if (!s.movido && Math.hypot(e.clientX - s.inicio.x, e.clientY - s.inicio.y) > UMBRAL_PX) empezarAMover(s);
      if (s.movido) { e.preventDefault(); pedirCuadro(); }
    };
    const terminar = (guardar: boolean) => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      window.removeEventListener("pointercancel", alCancelar);
      window.removeEventListener("keydown", alTeclado, true);
      if (sesionRef.current !== s) return;
      if (guardar) soltar(); else limpiar();
    };
    const alSoltar = (e: PointerEvent) => { s.puntero = { x: e.clientX, y: e.clientY, alt: e.altKey }; terminar(true); };
    const alCancelar = () => terminar(false);
    const alTeclado = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); terminar(false); } };
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    window.addEventListener("pointercancel", alCancelar);
    window.addEventListener("keydown", alTeclado, true);
  }, [empezarAMover, limpiar, pedirCuadro, soltar]);

  // En el visor: pasar por encima resalta UNA copia; apretar sobre ella y arrastrar la mueve.
  useEffect(() => {
    const lienzo = lienzoRef.current;
    const visorInicial = visorRef.current;
    if (!activo || !lienzo) return;
    let encima: { x: number; y: number } | null = null;
    let cuadro = 0;

    /** La pieza colgada y la copia bajo el puntero, si hay. */
    const copiaBajo = (x: number, y: number) => {
      const visor = visorRef.current;
      const d = datos.current;
      if (!visor || !d.armada) return null;
      const toque = visor.piezaEn(x, y);
      const nodo = toque ? d.escena.nodos.find((n) => n.id === toque.nodo) : undefined;
      const armado = toque ? d.armada.porNodo.find((n) => n.id === toque.nodo) : undefined;
      if (!toque || !colgada(nodo) || !armado?.puestas.length) return null;
      const copia = copiaEn(armado, toque.punto);
      return { nodo, armado, copia, caja: armado.puestas[copia]?.caja ?? armado.caja };
    };

    const alApretar = (e: PointerEvent) => {
      if (e.button !== 0 || sesionRef.current) return;
      const bajo = copiaBajo(e.clientX, e.clientY);
      if (!bajo) return;
      const c = bajo.nodo.colocacion;
      // Antes que la cámara (este oyente va en captura): no gira mientras se coge.
      visorRef.current?.orbitar(false);
      lienzo.setPointerCapture(e.pointerId);
      sesionRef.current = {
        pieza: bajo.nodo.pieza, nombre: bajo.nodo.nombre, nueva: null,
        origen: { id: bajo.nodo.id, copia: bajo.copia, padreId: c.en === "ancla" || c.en === "sobre" ? c.padreId : null, caja: bajo.caja },
        candidatos: [], inicio: { x: e.clientX, y: e.clientY }, puntero: { x: e.clientX, y: e.clientY, alt: e.altKey },
        movido: false, destino: null, desdePanel: false, idPuntero: e.pointerId, etiqueta: null, soloSala: false, cajas: null,
      };
    };

    const alMover = (e: PointerEvent) => {
      const s = sesionRef.current;
      if (s) {
        if (s.desdePanel) return;
        s.puntero = { x: e.clientX, y: e.clientY, alt: e.altKey };
        if (!s.movido && Math.hypot(e.clientX - s.inicio.x, e.clientY - s.inicio.y) > UMBRAL_PX) empezarAMover(s);
        if (s.movido) pedirCuadro();
        return;
      }
      if (e.buttons !== 0) return;
      encima = { x: e.clientX, y: e.clientY };
      if (cuadro) return;
      cuadro = requestAnimationFrame(() => {
        cuadro = 0;
        if (!encima || sesionRef.current) return;
        const bajo = copiaBajo(encima.x, encima.y);
        visorRef.current?.resaltarEncima(bajo ? bajo.caja : null);
        if (bajo) lienzo.style.cursor = "grab";
      });
    };

    const alSoltar = () => {
      const s = sesionRef.current;
      if (!s || s.desdePanel) return;
      if (!s.movido && s.origen) {
        // Un clic: elige ESA copia (la pieza la elige el clic de siempre).
        datos.current.onCopia({ id: s.origen.id, copia: s.origen.copia });
        limpiar();
        return;
      }
      soltar();
    };
    const alCancelar = () => { if (sesionRef.current && !sesionRef.current.desdePanel) limpiar(); };
    const alSalir = () => { encima = null; if (!sesionRef.current) visorRef.current?.resaltarEncima(null); };

    lienzo.addEventListener("pointerdown", alApretar, { capture: true });
    lienzo.addEventListener("pointermove", alMover);
    lienzo.addEventListener("pointerup", alSoltar, { capture: true });
    lienzo.addEventListener("pointercancel", alCancelar);
    lienzo.addEventListener("pointerleave", alSalir);
    return () => {
      cancelAnimationFrame(cuadro);
      if (sesionRef.current && !sesionRef.current.desdePanel) limpiar();
      visorInicial?.resaltarEncima(null);
      lienzo.removeEventListener("pointerdown", alApretar, { capture: true });
      lienzo.removeEventListener("pointermove", alMover);
      lienzo.removeEventListener("pointerup", alSoltar, { capture: true });
      lienzo.removeEventListener("pointercancel", alCancelar);
      lienzo.removeEventListener("pointerleave", alSalir);
    };
  }, [activo, lienzoRef, visorRef, empezarAMover, pedirCuadro, soltar, limpiar]);

  // Teclado sobre la copia elegida (o una pieza `sobre`): va en captura, antes que el de las piezas en general.
  useEffect(() => {
    if (!activo) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (e.defaultPrevented || escribiendo(e.target) || e.ctrlKey || e.metaKey) return;
      const d = datos.current;
      const nodo = d.seleccion ? d.escena.nodos.find((n) => n.id === d.seleccion) : undefined;
      if (!nodo || !d.armada) return;
      const c = nodo.colocacion;
      const copia = d.copia && d.copia.id === nodo.id ? d.copia.copia : null;
      // Lo repartido en anclas sin una copia elegida (se eligió en la lista) sigue con las teclas de siempre.
      if (c.en !== "sobre" && !(c.en === "ancla" && copia !== null)) return;
      const tecla = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const flecha = tecla === "ArrowUp" || tecla === "ArrowDown" || tecla === "ArrowLeft" || tecla === "ArrowRight";
      if (!flecha && tecla !== "q" && tecla !== "e" && tecla !== "Delete" && tecla !== "PageUp" && tecla !== "PageDown") return;
      e.preventDefault();
      if (tecla === "PageUp" || tecla === "PageDown") return;
      if (tecla === "Delete") {
        d.onCambio(c.en === "ancla" && copia !== null ? quitarCopia(d.escena, d.armada, nodo.id, copia) : quitarNodo(d.escena, nodo.id, d.armada));
        d.onSeleccion(null);
        d.onCopia(null);
        return;
      }
      // Una copia de un reparto: primero se separa (las demás se quedan) y se sigue con la separada.
      let escena = d.escena, armada = d.armada, id = nodo.id;
      if (c.en === "ancla" && copia !== null) {
        const separada = separarCopia(escena, armada, id, copia);
        if (!separada) return;
        escena = separada.escena; id = separada.id;
        armada = armarEscena(escena, d.cache);
      }
      let nueva = escena;
      if (tecla === "q" || tecla === "e") nueva = girarNodo(escena, id, (tecla === "q" ? 1 : -1) * (e.shiftKey ? 45 : 15));
      else {
        const colocacion = escena.nodos.find((n) => n.id === id)?.colocacion;
        const sitio = colocacion?.en === "sobre" ? sitioDeSobre(armada, colocacion) : null;
        const visor = visorRef.current;
        if (!sitio || !visor) return;
        const paso = e.shiftKey ? 25 : 5;
        const signo = tecla === "ArrowUp" || tecla === "ArrowRight" ? 1 : -1;
        const { adelante, derecha } = visor.ejesCamara();
        // ←/→ hacia la derecha de la pantalla; ↑/↓ hacia arriba (o, si mira al techo o al piso, hacia el fondo).
        const eje = tecla === "ArrowLeft" || tecla === "ArrowRight" ? derecha : Math.abs(sitio.normal.y) < 0.8 ? ARRIBA : adelante;
        nueva = deslizarSobre(escena, armada, id, { x: eje.x * signo * paso, y: eje.y * signo * paso, z: eje.z * signo * paso }, { iman: !e.altKey });
      }
      if (nueva === escena && escena === d.escena) return;
      d.onCambio(nueva);
      if (id !== nodo.id) { d.onSeleccion(id); d.onCopia(null); }
    };
    window.addEventListener("keydown", alTeclado, true);
    return () => window.removeEventListener("keydown", alTeclado, true);
  }, [activo, visorRef]);

  // Al salir de la pestaña (o perder el visor) no queda nada a medias.
  useEffect(() => () => { if (sesionRef.current) limpiar(); }, [limpiar]);

  return { empezarArrastre };
}
