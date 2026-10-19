import decoracionesRaw from "@/lib/biblioteca-sempertex/decoraciones.json";
import type { DetalleIdea } from "@/lib/biblioteca-sempertex/detalle-idea-esquema";
import detallesRaw from "@/lib/biblioteca-sempertex/detalles-ideas.json";
import type { DecoracionSempertex } from "@/lib/biblioteca-sempertex/esquemas";
import planesRaw from "@/lib/biblioteca-sempertex/planes-ideas.json";
import { perezoso } from "@/lib/globos3d/perezoso";
import type { PlanIdeaGuardado } from "@/lib/plan/plan-de-idea";
import { crearEntrada } from "../../construir";
import { PREFIJOS_CLASE_SEMPERTEX as P } from "../../ids";
import type { EntradaCatalogo } from "../../repositorio";
import type { Procedencia } from "../../tipos";

/**
 * La biblioteca de la vista guiada como entradas de Sempertex (solo para el registro: el chat guiado sigue leyendo sus archivos
 * con sus propios lectores). `decoracion-guiada`: las decoraciones reales (las de ejemplo nunca, como `bibliotecaVisible`);
 * `plan-idea`: cada idea con plan guardado (`planes-ideas.json`) o detalle (`detalles-ideas.json`), en ese orden.
 * Los tres archivos son datos generados del repositorio y se leen tal cual: sus esquemas zod (y que las decoraciones sean las de
 * `bibliotecaVisible`) los comprueba `test-catalogo-repositorios`, no el import, porque importar el registro no puede pagar esos
 * esquemas (`test-carga-3d`, SPEC §4.2).
 */

const decoraciones = decoracionesRaw as unknown as readonly DecoracionSempertex[];
const planes = planesRaw.ideas as unknown as Readonly<Record<string, PlanIdeaGuardado>>;
const detalles = detallesRaw.ideas as unknown as Readonly<Record<string, DetalleIdea>>;
const decoracionPorId = perezoso(() => new Map(decoraciones.map((d) => [d.id, d])));

function procedenciaDeDecoracion(d: DecoracionSempertex): Procedencia {
  const foto = d.fotos.find((f) => f.url.startsWith("https://"));
  const fotoUrl = foto ? { fotoUrl: foto.url } : {};
  if (d.origen === "referencia_real") {
    return { fuente: "referencia-web", titulo: d.titulo, ...fotoUrl, licencia: { regimen: "referencia", titular: foto?.fuente ?? d.titulo, restricciones: ["foto de referencia de la web: solo por url, nunca copiada"] } };
  }
  return d.origen === "ejemplo" ? { fuente: "propio", titulo: d.titulo } : { fuente: "tienda-sempertex", titulo: d.titulo, ...fotoUrl };
}

export const entradasDeDecoracionesGuiadas = (): EntradaCatalogo[] => decoraciones.filter((d) => d.origen !== "ejemplo").map((d) =>
  crearEntrada("sempertex", {
    clase: "decoracion-guiada", idLocal: `${P["decoracion-guiada"]}${d.id}`, nombre: d.titulo,
    descripcion: `${d.titulo}: temática ${d.tematica}, para ${d.eventos.join(", ")}.`, procedencia: procedenciaDeDecoracion(d), dato: () => d,
  }));

function descripcionDePlan(titulo: string, idIdea: string): string {
  const plan = planes[idIdea], detalle = detalles[idIdea];
  const partes = [plan ? `plan guardado de ${plan.globos} globos` : "sin plan guardado", ...(detalle ? [`detalle en ${detalle.piezas.length} piezas`] : [])];
  return `${titulo}: ${partes.join("; ")}.`;
}

export function entradasDePlanesDeIdeas(): EntradaCatalogo[] {
  const ids = [...new Set([...Object.keys(planes), ...Object.keys(detalles)])];
  return ids.map((idIdea) => {
    const decoracion = decoracionPorId().get(idIdea);
    const titulo = decoracion?.titulo ?? idIdea;
    return crearEntrada("sempertex", {
      clase: "plan-idea", idLocal: `${P["plan-idea"]}${idIdea}`, nombre: titulo, descripcion: () => descripcionDePlan(titulo, idIdea),
      procedencia: decoracion ? procedenciaDeDecoracion(decoracion) : { fuente: "propio", titulo },
      dato: () => ({ idIdea, plan: planes[idIdea] ?? null, detalle: detalles[idIdea] ?? null }),
    });
  });
}
