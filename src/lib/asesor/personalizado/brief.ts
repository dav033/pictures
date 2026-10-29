import { z } from "zod";

/** A personalized request may be reviewed even when some facts are still unknown. */
export const PersonalizedBriefSchema = z.object({
  event: z.string().trim().max(500).default(""),
  date: z.string().trim().max(160).default(""),
  city: z.string().trim().max(160).default(""),
  venue: z.string().trim().max(500).default(""),
  guests: z.string().trim().max(160).default(""),
  budget: z.string().trim().max(160).default(""),
  decoration: z.string().trim().max(4000).default(""),
  colors: z.string().trim().max(1000).default(""),
  shapes: z.string().trim().max(1000).default(""),
  references: z.string().trim().max(4000).default(""),
  notes: z.string().trim().max(4000).default(""),
}).strict();

export type PersonalizedBrief = z.infer<typeof PersonalizedBriefSchema>;

export function personalizedBriefRows(brief: PersonalizedBrief): Array<{ label: string; value: string }> {
  const labels: Record<keyof PersonalizedBrief, string> = {
    event: "Evento", date: "Fecha", city: "Ciudad", venue: "Lugar", guests: "Invitados",
    budget: "Presupuesto", decoration: "Decoración", colors: "Colores", shapes: "Formas",
    references: "Referencias", notes: "Otros detalles",
  };
  return (Object.keys(labels) as Array<keyof PersonalizedBrief>).map((key) => ({
    label: labels[key], value: brief[key] || "Pendiente",
  }));
}
