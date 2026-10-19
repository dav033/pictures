"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TipoItem } from "@/lib/globos3d/biblioteca";
import { esFotoValida, reducirFoto } from "./imagen-cliente";

/**
 * «Buscar por foto» de la Biblioteca: sube la foto a `/api/taller/buscar-foto` (la reduce antes a ≤ 1024 px JPEG) y
 * guarda los ids parecidos, del más al menos parecido. Al cambiar de pestaña (otros `tipos`) NO vuelve a embeber la
 * foto: reusa el vector con `/api/taller/buscar`. Sin la biblioteca indexada el servidor contesta con un mensaje y aquí
 * se muestra tal cual; nunca se inventan resultados.
 */
export type EstadoFoto =
  | { fase: "inactivo" }
  | { fase: "buscando"; previa: string }
  | { fase: "listo"; previa: string; ids: readonly string[]; cargando: boolean }
  | { fase: "error"; mensaje: string; previa: string | null; noDisponible: boolean };

const MENSAJE_GENERAL = "No se pudo buscar por foto. Inténtalo de nuevo.";
const SIN_BIBLIOTECA = "La búsqueda por foto necesita la biblioteca indexada.";
const LIMITE_FOTO = 50;

async function leerJson(r: Response): Promise<Record<string, unknown>> {
  try { return (await r.json()) as Record<string, unknown>; } catch { return {}; }
}
const textoDe = (v: unknown, otro: string) => (typeof v === "string" && v ? v : otro);
const idsDe = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const vectorDe = (v: unknown): number[] | null => (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number") ? (v as number[]) : null);
const previaDe = (e: EstadoFoto): string | null => (e.fase === "inactivo" ? null : e.previa);

export function useBusquedaFoto(tipos: readonly TipoItem[]) {
  const [estado, setEstado] = useState<EstadoFoto>({ fase: "inactivo" });
  const clave = tipos.join("|");
  const vectorRef = useRef<number[] | null>(null);
  const tiposDelVectorRef = useRef<string>("");
  const pedidoRef = useRef(0);
  const previaRef = useRef<string | null>(null);

  const soltarPrevia = useCallback(() => { if (previaRef.current) URL.revokeObjectURL(previaRef.current); previaRef.current = null; }, []);
  useEffect(() => soltarPrevia, [soltarPrevia]);

  const limpiar = useCallback(() => {
    pedidoRef.current += 1;
    vectorRef.current = null;
    soltarPrevia();
    setEstado({ fase: "inactivo" });
  }, [soltarPrevia]);

  const buscar = useCallback(async (archivo: Blob) => {
    const pedido = ++pedidoRef.current;
    vectorRef.current = null;
    soltarPrevia();
    if (!esFotoValida(archivo)) { setEstado({ fase: "error", mensaje: "La foto debe ser JPEG, PNG o WebP.", previa: null, noDisponible: false }); return; }
    const previa = URL.createObjectURL(archivo);
    previaRef.current = previa;
    setEstado({ fase: "buscando", previa });
    try {
      const reducida = await reducirFoto(archivo);
      const formulario = new FormData();
      formulario.set("imagen", reducida, "foto.jpg");
      formulario.set("tipos", JSON.stringify(clave ? clave.split("|") : []));
      const r = await fetch("/api/taller/buscar-foto", { method: "POST", body: formulario });
      const cuerpo = await leerJson(r);
      if (pedido !== pedidoRef.current) return;
      if (!r.ok || cuerpo.disponible === false) {
        setEstado({ fase: "error", mensaje: textoDe(cuerpo.error, MENSAJE_GENERAL), previa, noDisponible: cuerpo.disponible === false });
        return;
      }
      vectorRef.current = vectorDe(cuerpo.vectorImagen);
      tiposDelVectorRef.current = clave;
      setEstado({ fase: "listo", previa, ids: idsDe(cuerpo.ids), cargando: false });
    } catch (causa) {
      if (pedido !== pedidoRef.current) return;
      setEstado({ fase: "error", mensaje: causa instanceof Error && causa.message ? causa.message : MENSAJE_GENERAL, previa, noDisponible: false });
    }
  }, [clave, soltarPrevia]);

  // Otra pestaña (otros tipos): busca de nuevo con el vector que ya se calculó (sin volver a pagar el embedding).
  useEffect(() => {
    const vector = vectorRef.current;
    if (!vector || tiposDelVectorRef.current === clave) return;
    const pedido = ++pedidoRef.current;
    tiposDelVectorRef.current = clave;
    setEstado((e) => (e.fase === "listo" ? { ...e, cargando: true } : e));
    (async () => {
      try {
        const r = await fetch("/api/taller/buscar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ vectorImagen: vector, filtros: clave ? { tipos: clave.split("|") } : {}, limite: LIMITE_FOTO }),
        });
        const cuerpo = await leerJson(r);
        if (pedido !== pedidoRef.current) return;
        if (!r.ok || cuerpo.fuente !== "rag") {
          setEstado((e) => ({ fase: "error", mensaje: r.ok ? SIN_BIBLIOTECA : textoDe(cuerpo.error, MENSAJE_GENERAL), previa: previaDe(e), noDisponible: r.ok }));
          return;
        }
        setEstado((e) => (e.fase === "listo" ? { ...e, ids: idsDe(cuerpo.ids), cargando: false } : e));
      } catch {
        if (pedido !== pedidoRef.current) return;
        setEstado((e) => (e.fase === "listo" ? { ...e, cargando: false } : e));
      }
    })();
  }, [clave]);

  return { estado, buscar, limpiar };
}
