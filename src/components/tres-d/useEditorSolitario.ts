"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Escena, EscenaArmada } from "@/lib/globos3d/escena";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import type { Solitario } from "@/lib/globos3d/editor-solitario";
import type { EscenaGlobos, VistaCamara } from "./escena-globos";
import { useHistorialEscena } from "./useEdicionEscena";

/** Lo puro del editor solitario y del menú (con la biblioteca): se carga al usarlo, no con la página. */
export type ModuloSolitario = typeof import("@/lib/globos3d/editor-solitario");
let modulo: Promise<ModuloSolitario> | null = null;
export const cargarSolitario = (): Promise<ModuloSolitario> => (modulo ??= import("@/lib/globos3d/editor-solitario"));

const VACIA: Escena = { sala: { anchoCm: 600, fondoCm: 500, altoCm: 320, tonos: { piso: "#d8cbbb", paredes: "#f1ece6", techo: "#fbfaf8" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } }, nodos: [] };

type Opciones = {
  /** La escena de verdad (con su historial) y cómo cambiarla (un paso de deshacer). */
  escena: Escena;
  cambiarEscena: (escena: Escena) => void;
  cache: Map<string, PiezaArmada>;
  visorRef: RefObject<EscenaGlobos | null>;
};

/**
 * El editor solitario de una estructura: `entrar(id)` cambia lo que se ve y se edita por una escena aislada (la pieza y
 * sus decoraciones, ver `editor-solitario.ts`) con su propio deshacer; `aplicar()` devuelve lo editado a la escena en
 * su mismo sitio como UN paso de deshacer y `cancelar()` vuelve sin cambios. Al salir, la cámara vuelve a donde
 * estaba: quien dibuja la escena llama a `tomarVista()` y, si hay una, la pone en vez de reencuadrar.
 *
 * `escena`/`cambiar`/`deshacer`/`rehacer` son los de lo que se ve: la aislada dentro del editor, la de verdad fuera.
 */
export function useEditorSolitario({ escena, cambiarEscena, cache, visorRef }: Opciones) {
  const [abierto, setAbierto] = useState<{ solitario: Solitario; vista: VistaCamara | null } | null>(null);
  const historial = useHistorialEscena(() => VACIA);
  const vistaPendiente = useRef<VistaCamara | null>(null);
  const resuelto = useRef<ModuloSolitario | null>(null);
  const { reiniciar } = historial;
  const datos = useRef({ escena, cache, cambiarEscena, abierto, aislada: historial.escena });
  useEffect(() => { datos.current = { escena, cache, cambiarEscena, abierto, aislada: historial.escena }; });

  /** Abre el editor de la pieza `id` de la escena de verdad (`armada`: esa escena ya armada). Devuelve si se abrió. */
  const entrar = useCallback(async (id: string, armada: EscenaArmada): Promise<boolean> => {
    const m = resuelto.current ?? (resuelto.current = await cargarSolitario());
    const d = datos.current;
    if (d.abierto) return false;
    const solitario = m.abrirSolitario(d.escena, id, armada, d.cache);
    if (!solitario) return false;
    reiniciar(solitario.escena);
    setAbierto({ solitario, vista: visorRef.current?.vistaCamara() ?? null });
    return true;
  }, [reiniciar, visorRef]);

  const salir = useCallback((aplicarCambios: boolean): string | null => {
    const d = datos.current;
    const a = d.abierto;
    const m = resuelto.current;
    if (!a || !m) return null;
    if (aplicarCambios && m.solitarioCambio(a.solitario, d.aislada)) d.cambiarEscena(m.aplicarSolitario(d.escena, a.solitario, d.aislada, d.cache));
    vistaPendiente.current = a.vista;
    setAbierto(null);
    return a.solitario.raizId;
  }, []);
  /** «Listo»: lo editado vuelve a la escena (un paso de deshacer). Devuelve el id de la pieza editada. */
  const aplicar = useCallback(() => salir(true), [salir]);
  /** «Cancelar»: vuelve sin cambios. */
  const cancelar = useCallback(() => salir(false), [salir]);
  /** La vista de cámara que hay que poner al volver a la escena (una sola vez). */
  const tomarVista = useCallback(() => { const v = vistaPendiente.current; vistaPendiente.current = null; return v; }, []);

  const activo = abierto !== null;
  return {
    activo,
    solitario: abierto?.solitario ?? null,
    escena: activo ? historial.escena : escena,
    cambiar: historial.cambiar,
    deshacer: historial.deshacer,
    rehacer: historial.rehacer,
    puedeDeshacer: historial.puedeDeshacer,
    puedeRehacer: historial.puedeRehacer,
    entrar, aplicar, cancelar, tomarVista,
  };
}
