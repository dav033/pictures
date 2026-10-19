"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Box, Download, ImageDown } from "lucide-react";
import type { EscenaGlobos } from "./escena-globos";
import { descargarArchivoLocal, nombreArchivoEscena, type FormatoArchivoEscena } from "./archivo-escena";
import { BTN, FLOTANTE } from "./ui-taller";

type ResultadoExportacion = { tipo: "listo" | "error"; texto: string } | null;

export function ExportarEscenaTaller({ visor, nombre, cantidadGlobos, cantidadPiezas, deshabilitado, compacto = false }: {
  visor: EscenaGlobos | null;
  nombre: string;
  cantidadGlobos: number;
  cantidadPiezas: number;
  deshabilitado: boolean;
  compacto?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const accionesId = useId();
  const [abierto, setAbierto] = useState(false);
  const [exportando, setExportando] = useState<FormatoArchivoEscena | null>(null);
  const [resultado, setResultado] = useState<ResultadoExportacion>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (evento: PointerEvent) => {
      if (!(evento.target instanceof Node) || !ref.current?.contains(evento.target)) setAbierto(false);
    };
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") { setAbierto(false); botonRef.current?.focus(); }
    };
    window.addEventListener("pointerdown", fuera, true);
    window.addEventListener("keydown", tecla);
    ref.current?.querySelector<HTMLButtonElement>("[data-accion-exportacion]")?.focus();
    return () => {
      window.removeEventListener("pointerdown", fuera, true);
      window.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  function cerrarYDevolverFoco() {
    setAbierto(false);
    botonRef.current?.focus();
  }

  async function exportar(formato: FormatoArchivoEscena) {
    if (!visor || deshabilitado || exportando) return;
    setExportando(formato);
    setResultado(null);
    try {
      const blob = formato === "png"
        ? await visor.exportarPng()
        : await visor.exportarGlb({ nombre, globos: cantidadGlobos, piezas: cantidadPiezas });
      descargarArchivoLocal(blob, nombreArchivoEscena(nombre, formato));
      setResultado({ tipo: "listo", texto: `Descarga ${formato.toUpperCase()} iniciada.` });
      cerrarYDevolverFoco();
    } catch (causa: unknown) {
      const detalle = causa instanceof Error ? causa.message : "error inesperado";
      setResultado({ tipo: "error", texto: `No se pudo exportar ${formato.toUpperCase()}: ${detalle}` });
      cerrarYDevolverFoco();
    } finally {
      setExportando(null);
    }
  }

  const bloqueado = deshabilitado || !visor || exportando !== null;
  return (
    <div ref={ref} className="relative">
      <button ref={botonRef} type="button" onClick={() => setAbierto((actual) => !actual)} disabled={deshabilitado || !visor || exportando !== null}
        aria-label="Exportar escena" aria-expanded={abierto} aria-controls={accionesId}
        className={compacto ? `grid size-11 shrink-0 place-items-center rounded-xl disabled:cursor-not-allowed disabled:opacity-45 ${FLOTANTE}` : BTN}>
        <Download className="size-[18px]" aria-hidden />{!compacto && "Exportar"}
      </button>
      {abierto && (
        <div id={accionesId} role="group" aria-label="Descargar archivos de la escena"
          className="absolute right-0 top-full z-50 mt-2 flex w-64 flex-col gap-1 rounded-xl border border-taller-linea bg-taller-boton p-2 shadow-[0_18px_40px_var(--sombra)]">
          <button data-accion-exportacion type="button" onClick={() => void exportar("png")} disabled={bloqueado}
            className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-taller-elegido disabled:opacity-50">
            <ImageDown className="size-4 shrink-0" aria-hidden />{exportando === "png" ? "Preparando PNG…" : "Descargar PNG · 3000 px"}
          </button>
          <button type="button" onClick={() => void exportar("glb")} disabled={bloqueado}
            className="flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-left text-sm hover:bg-taller-elegido disabled:opacity-50">
            <Box className="size-4 shrink-0" aria-hidden />{exportando === "glb" ? "Preparando GLB…" : "Descargar modelo GLB"}
          </button>
        </div>
      )}
      {resultado && <p role={resultado.tipo === "error" ? "alert" : "status"} className={`absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border border-taller-linea bg-taller-tarjeta p-2 text-xs shadow-[0_18px_40px_var(--sombra)] ${resultado.tipo === "error" ? "text-red-600" : "text-taller-texto"}`}>{resultado.texto}</p>}
    </div>
  );
}
