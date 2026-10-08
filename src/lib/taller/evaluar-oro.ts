import { z } from "zod";
import type { OroBusqueda } from "./evaluar";

/** La forma del oro (`scripts/test/fixtures/oro-busqueda-taller.json`): lo que la prueba y el evaluador exigen de él. */
const RelevanteSchema = z.object({ id: z.string().min(1), grado: z.union([z.literal(1), z.literal(2)]) });

const ConsultaSchema = z.object({
  id: z.string().regex(/^Q\d{2}$/),
  categoria: z.string().min(1),
  texto: z.string().min(3),
  relevantes: z.array(RelevanteSchema).min(1).max(10),
  nota: z.string().min(1),
});

const FotoSchema = z.object({
  id: z.string().regex(/^F\d{2}$/),
  numero: z.number().int().min(1),
  archivo: z.string().regex(/\.(jpe?g|png|webp)$/i),
  esperado: z.string().min(1),
  parecidos: z.array(z.string().min(1)).max(6),
  nota: z.string().min(1),
});

export const OroSchema = z.object({
  version: z.number().int(),
  descripcion: z.string().min(1),
  consultas: z.array(ConsultaSchema).min(1),
  fotos: z.array(FotoSchema),
});

/** Valida el JSON del oro; falla con la lista de problemas. */
export function leerOro(dato: unknown): OroBusqueda {
  return OroSchema.parse(dato);
}

/** Los ids que el oro cita (relevantes, esperados y parecidos), sin repetir. */
export function idsDelOro(oro: OroBusqueda): string[] {
  return [...new Set([...oro.consultas.flatMap((c) => c.relevantes.map((r) => r.id)), ...oro.fotos.flatMap((f) => [f.esperado, ...f.parecidos])])];
}
