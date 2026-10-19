import { FORMATOS_GLOBO } from "@/lib/globos3d/formatos";
import { MODULOS } from "@/lib/globos3d/modulos";
import { CATALOGO_UTILERIA, urlTienda } from "@/lib/globos3d/utileria-catalogo";
import { TABLA_SEMPERTEX } from "@/lib/plan/referencia-sempertex";
import { crearEntrada } from "../../construir";
import { PREFIJOS_CLASE_SEMPERTEX as P } from "../../ids";
import type { EntradaCatalogo } from "../../repositorio";
import type { Procedencia } from "../../tipos";

/**
 * Los datos de referencia de Sempertex como entradas: formatos de globo, tabla de colores, utilería de la tienda (enlace sin
 * precio) y módulos de armado. Cada id local lleva el prefijo de su clase (`formato:R-12`, `color:570`…, ver `ids.ts`).
 */

const FORMATOS: Procedencia = { fuente: "tienda-sempertex", titulo: "Formatos de globo de látex Sempertex" };
const MODULOS_TALLER: Procedencia = { fuente: "propio", titulo: "Módulos de armado del taller (pareja a sexteto)" };
const esHttps = (url: string | null): url is string => Boolean(url?.startsWith("https://"));

export const entradasDeFormatos = (): EntradaCatalogo[] => FORMATOS_GLOBO.map((f) =>
  crearEntrada("sempertex", { clase: "formato", idLocal: `${P.formato}${f.id}`, nombre: f.nombre, descripcion: f.descripcion, procedencia: FORMATOS, dato: () => f }));

export const entradasDeColores = (): EntradaCatalogo[] => TABLA_SEMPERTEX.referencias.map((r) =>
  crearEntrada("sempertex", {
    clase: "color", idLocal: `${P.color}${r.codigo}`, nombre: r.nombreCompleto,
    descripcion: `${r.nombreCompleto} (${r.acabado}), código ${r.codigo}; se fabrica en ${r.formatos.join(", ")}.`,
    procedencia: { fuente: "tienda-sempertex", titulo: `Tabla de colores Sempertex (${TABLA_SEMPERTEX.version})`, ...(esHttps(r.foto) ? { fotoUrl: r.foto } : {}) },
    dato: () => r,
  }));

export const entradasDeProductos = (): EntradaCatalogo[] => CATALOGO_UTILERIA.map((p) =>
  crearEntrada("sempertex", {
    clase: "producto-tienda", idLocal: `${P["producto-tienda"]}${p.id}`, nombre: p.nombre,
    descripcion: `${p.tipo.replace(/_/g, " ")} de la tienda, temática ${p.tematica}${p.medidas ? `, ${p.medidas}` : ""}.`,
    procedencia: { fuente: "tienda-sempertex", titulo: p.nombre, url: urlTienda(p.url) },
    dato: () => p,
  }));

export const entradasDeModulos = (): EntradaCatalogo[] => MODULOS.map((m) =>
  crearEntrada("sempertex", { clase: "modulo", idLocal: `${P.modulo}${m.id}`, nombre: m.nombre, descripcion: m.armado, procedencia: MODULOS_TALLER, dato: () => m }));
