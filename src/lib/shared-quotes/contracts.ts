import { z } from "zod";
import { EntradaCotizacionProfesionalSchema } from "@/lib/cotizacion/profesional";

export const MAX_SHARED_STILL_BYTES = 512 * 1024;
export const MAX_SHARED_STILL_BASE64 = Math.ceil(MAX_SHARED_STILL_BYTES / 3) * 4;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const ValidUntilSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato AAAA-MM-DD.")
  .refine(isCalendarDate, "La fecha no existe.");

export const CreateSharedQuoteSchema = z.object({
  sceneName: z.string().trim().min(1).max(120),
  sceneKey: z.string().trim().min(1).max(128),
  validUntil: ValidUntilSchema,
  quoteInput: EntradaCotizacionProfesionalSchema,
  stillBase64: z.string().min(1).max(MAX_SHARED_STILL_BASE64).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
}).strict();

export const SharedQuoteDecisionSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  customerName: z.string().trim().min(1).max(100),
  comment: z.string().trim().min(1).max(2000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "changes_requested" && !value.comment) {
    context.addIssue({ code: "custom", path: ["comment"], message: "Escribe qué cambios necesitas." });
  }
  if (value.decision === "approved" && value.comment !== undefined) {
    context.addIssue({ code: "custom", path: ["comment"], message: "La aprobación no admite comentarios de cambios." });
  }
});

export type CreateSharedQuote = z.infer<typeof CreateSharedQuoteSchema>;
export type SharedQuoteDecision = z.infer<typeof SharedQuoteDecisionSchema>;
export type SharedQuoteStatus = "pending" | "approved" | "changes_requested";

export type PublicSharedQuote = {
  sceneName: string;
  validUntil: string;
  totalCop: number;
  currency: "COP";
  status: SharedQuoteStatus;
  createdAt: string;
};

export type OwnerSharedQuote = {
  id: string;
  sceneName: string;
  validUntil: string;
  status: SharedQuoteStatus;
  customerName: string | null;
  comment: string | null;
  respondedAt: string | null;
  createdAt: string;
};
