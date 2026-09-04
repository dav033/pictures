import { NextResponse } from "next/server";
import { isAuthenticatedRequest, isSameOriginRequest } from "@/lib/auth/request";
import { auditStructureCandidates, type StructureCandidate } from "@/lib/lora/dataset-builder";
import { LoraSpecializationSchema } from "@/lib/lora/schema";
import { z } from "zod";

const PreviewSchema = z.object({
  specialization: LoraSpecializationSchema,
  candidates: z.array(z.object({
    key: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    groupKey: z.string().min(1),
    structureTypes: z.array(z.string()),
    caption: z.string().max(750),
    sourceRef: z.string().optional(),
    quality: z.object({
      people: z.boolean().optional(),
      text: z.boolean().optional(),
      watermark: z.boolean().optional(),
      nearDuplicate: z.boolean().optional(),
      licenseVerified: z.boolean().optional(),
    }).optional(),
  })).max(5000),
});

export async function POST(request: Request) {
  if (!isAuthenticatedRequest(request)) return NextResponse.json({ code: "UNAUTHORIZED", message: "Sesión requerida" }, { status: 401 });
  if (!isSameOriginRequest(request)) return NextResponse.json({ code: "INVALID_ORIGIN", message: "Origen no permitido" }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ code: "INVALID_JSON", message: "Cuerpo JSON inválido" }, { status: 400 }); }
  const parsed = PreviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ code: "INVALID_INPUT", message: "Preview de dataset inválido", details: parsed.error.issues }, { status: 400 });
  if (parsed.data.specialization !== "structure") return NextResponse.json({ code: "SPECIALIZATION_UNSUPPORTED", message: "Este preview solo audita datasets de estructuras" }, { status: 422 });
  const audit = auditStructureCandidates(parsed.data.candidates as StructureCandidate[]);
  return NextResponse.json({ specialization: "structure", trigger: "eventdecor_structure_v1", audit });
}

