import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const RUTA_ORDENES = "C:\\Users\\davidt\\Downloads\\ordenes-decoracion";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(request: Request, { params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  if (!/^\d+$/.test(numero)) return new Response("Número de orden inválido", { status: 400 });

  const indice = Number(new URL(request.url).searchParams.get("indice") ?? "1");
  if (!Number.isInteger(indice) || indice < 1) return new Response("Índice inválido", { status: 400 });

  const carpetaOrden = path.join(RUTA_ORDENES, numero);
  const archivos = await readdir(carpetaOrden).catch(() => [] as string[]);
  const patron = new RegExp(`^foto-${indice}\\.(jpg|jpeg|png|webp)$`, "i");
  const foto = archivos.find((f) => patron.test(f));
  if (!foto) return new Response("Sin foto", { status: 404 });

  const buffer = await readFile(path.join(carpetaOrden, foto));
  const ext = foto.split(".").pop()!.toLowerCase();
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
  });
}
