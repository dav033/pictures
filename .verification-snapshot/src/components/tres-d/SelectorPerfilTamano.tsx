"use client";

import { useState } from "react";
import type { OpcionesOrganico } from "@/lib/globos3d/organico";
import { PERFILES_FABRICA, aplicarPerfilTamano, mezclaDeOpciones, nuevoPerfilPropio, perfilActivo, type PerfilTamano } from "@/lib/globos3d/perfiles-tamano";
import { BOTON, INACTIVO, ACTIVO } from "./PanelFlor";
import { usePerfilesPropios } from "./usePerfilesTamano";

/**
 * Perfiles de tamaño de la columna de un orgánico (champaña, botella, bolo, cónico, lápiz y los propios). Elegir uno
 * cambia la mezcla de tamaños de la columna; la pieza muestra cuál tiene puesto (o que su mezcla es personalizada).
 * Guardar la mezcla de la pieza la deja como perfil propio en este navegador, y los propios se pueden quitar.
 */
export function SelectorPerfilTamano({ opciones, onElegir }: { opciones: OpcionesOrganico; onElegir: (opciones: OpcionesOrganico) => void }) {
  const { propios, guardar, eliminar } = usePerfilesPropios();
  const [nombre, setNombre] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const tieneColumna = mezclaDeOpciones(opciones) !== undefined;
  const activo = perfilActivo(opciones, propios);

  const guardarMezcla = () => {
    const mezcla = mezclaDeOpciones(opciones);
    const perfil = mezcla ? nuevoPerfilPropio(nombre, mezcla, [...PERFILES_FABRICA, ...propios]) : null;
    if (!perfil) { setAviso("Escribe un nombre para el perfil."); return; }
    const ok = guardar(perfil);
    setAviso(ok ? `Guardado «${perfil.nombre}» en este navegador.` : `No se pudo guardar «${perfil.nombre}» en este navegador: solo vale mientras esta página esté abierta.`);
    setNombre("");
  };

  const elegir = (perfil: PerfilTamano) => { onElegir(aplicarPerfilTamano(opciones, perfil)); setAviso(null); };

  const quitar = (perfil: PerfilTamano) => {
    const ok = eliminar(perfil.id);
    setAviso(ok ? `Quitado «${perfil.nombre}».` : `Quitado «${perfil.nombre}» de esta página; el navegador no dejó guardar el cambio.`);
  };

  return (
    <section className="flex flex-col gap-2.5" aria-label="Perfiles de tamaño">
      <h3 className="taller-rotulo">Perfiles de tamaño</h3>
      <p role="status" className="text-xs text-taller-suave">
        {!tieneColumna ? "Esta pieza no tiene columna: los perfiles de tamaño son para columnas orgánicas."
          : activo ? `Perfil activo: ${activo.nombre}.` : "Mezcla personalizada (ningún perfil puesto)."}
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {[...PERFILES_FABRICA, ...propios].map((p) => (
          <button key={p.id} type="button" disabled={!tieneColumna} aria-pressed={activo?.id === p.id} onClick={() => elegir(p)}
            className={`${BOTON} ${activo?.id === p.id ? ACTIVO : INACTIVO} disabled:opacity-50`}>{p.nombre}</button>
        ))}
      </div>
      {propios.length > 0 && (
        <ul className="flex flex-col gap-1">
          {propios.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-xs text-taller-suave">
              <span className="truncate">Propio: {p.nombre}</span>
              <button type="button" onClick={() => quitar(p)} className="min-h-8 shrink-0 px-2 text-taller-acento hover:underline">Quitar</button>
            </li>
          ))}
        </ul>
      )}
      {tieneColumna && (
        <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); guardarMezcla(); }}>
          <label className="text-xs text-taller-suave" htmlFor="perfil-tamano-nombre">Guardar la mezcla de esta pieza como perfil propio</label>
          <div className="flex gap-1.5">
            <input id="perfil-tamano-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={40} placeholder="Nombre del perfil"
              className="min-h-11 min-w-0 flex-1 rounded-[9px] bg-superficie px-2 text-base text-texto ring-1 ring-borde lg:min-h-8 lg:text-sm" />
            <button type="submit" className={`${BOTON} ${INACTIVO} px-3`}>Guardar</button>
          </div>
        </form>
      )}
      {aviso && <p role="status" className="text-xs text-taller-suave">{aviso}</p>}
    </section>
  );
}
