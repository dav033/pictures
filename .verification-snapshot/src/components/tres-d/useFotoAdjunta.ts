"use client";

import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { fotoDeArchivo, primerArchivoDeImagen, type FotoLista } from "@/lib/globos3d/foto-cliente";

/**
 * La foto adjunta de la barra «Pídele a la IA»: se adjunta con el botón, pegando (Ctrl+V con una imagen en el
 * portapapeles) o soltándola sobre la barra. Se reduce en el navegador (`foto-cliente.ts`); `quitar` la suelta y
 * `liberar` la entrega ya enviada (limpia la vista previa).
 */
export function useFotoAdjunta() {
  const [foto, setFoto] = useState<FotoLista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preparando, setPreparando] = useState(false);
  const [encima, setEncima] = useState(false);
  const vista = useRef<string | null>(null);

  const soltarVista = () => { if (vista.current) URL.revokeObjectURL(vista.current); vista.current = null; };
  useEffect(() => soltarVista, []);

  const adjuntar = useCallback(async (archivo: File) => {
    setPreparando(true); setError(null);
    try {
      const lista = await fotoDeArchivo(archivo);
      soltarVista();
      vista.current = lista.vista;
      setFoto(lista);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar la foto.");
    } finally {
      setPreparando(false);
    }
  }, []);

  const quitar = useCallback(() => { soltarVista(); setFoto(null); setError(null); }, []);

  const alPegar = useCallback((e: ClipboardEvent<HTMLElement>) => {
    const archivo = primerArchivoDeImagen(e.clipboardData?.items);
    if (archivo) { e.preventDefault(); void adjuntar(archivo); }
  }, [adjuntar]);

  const alSoltar = useCallback((e: DragEvent<HTMLElement>) => {
    setEncima(false);
    const archivo = primerArchivoDeImagen(e.dataTransfer?.files);
    if (archivo) { e.preventDefault(); void adjuntar(archivo); }
  }, [adjuntar]);

  const alArrastrar = useCallback((e: DragEvent<HTMLElement>) => {
    if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) { e.preventDefault(); setEncima(true); }
  }, []);

  return { foto, error, preparando, encima, adjuntar, quitar, alPegar, alSoltar, alArrastrar, alSalir: () => setEncima(false) };
}

export type FotoAdjuntaEstado = ReturnType<typeof useFotoAdjunta>;
