import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BriefView } from "@/components/asesor/BriefView";
import { advisorSessionFromCookies } from "@/lib/asesor/auth";
import { loadApprovedBrief, type BriefLoadResult, type BriefProjection } from "@/lib/asesor/brief";
import { createAsesorRepository } from "@/lib/asesor/repository";
import sharp from "sharp";
import "@/components/asesor/brief-print.css";

const SAFE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function createThumbnail(mimeType: string, data: Buffer): Promise<string | null> {
  if (!SAFE_IMAGE_TYPES.has(mimeType) || data.length > 6 * 1024 * 1024) return null;
  try {
    const thumbnail = await sharp(data, { limitInputPixels: 40_000_000 })
      .resize({ width: 240, height: 160, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 68 })
      .toBuffer();
    return `data:image/jpeg;base64,${thumbnail.toString("base64")}`;
  } catch {
    console.error("[asesor-brief] thumbnail generation failed");
    return null;
  }
}

export default function BriefPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ projection?: string | string[] }>;
}) {
  return <Suspense fallback={<main className="brief-state"><h1>Cargando resumen…</h1></main>}><BriefContent params={params} searchParams={searchParams} /></Suspense>;
}

async function BriefContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ projection?: string | string[] }>;
}) {
  await connection();
  const jar = await cookies();
  const session = advisorSessionFromCookies((name) => jar.get(name)?.value);
  const { id } = await params;
  if (!session) redirect(`/login?from=${encodeURIComponent(`/asesor/brief/${id}`)}`);
  const query = await searchParams;
  const projection: BriefProjection = query.projection === "vendor" ? "vendor" : "full";
  let result: BriefLoadResult | null = null;
  let loadFailed = false;
  try {
    const repository = createAsesorRepository();
    const { id: accountId } = await repository.upsertAccount(`advisor:${session.role}`);
    result = await loadApprovedBrief({ repository, conversationId: id, accountId, projection, thumbnail: createThumbnail });
  } catch {
    console.error("[asesor-brief] page load failed");
    loadFailed = true;
  }
  if (loadFailed || !result) return <main className="brief-state"><h1>Brief no disponible</h1><p>No fue posible cargar el resumen. Inténtalo de nuevo.</p></main>;
  if (result.status !== "ok") return <main className="brief-state"><h1>Brief no disponible</h1><p>{result.status === "not_approved" ? "Este resumen aún no está aprobado." : "No encontramos este evento."}</p></main>;
  return <BriefView data={result.data} conversationId={id} />;
}
