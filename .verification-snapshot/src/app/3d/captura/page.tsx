import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CapturaRender } from "@/components/tres-d/CapturaRender";

export const metadata: Metadata = { title: "Captura de renders · interno", robots: { index: false, follow: false } };
/** Se arma en cada petición (lee `searchParams` y el entorno): en producción la página existe solo si se enciende la bandera. */
export const instant = false;

const habilitada = () => process.env.NODE_ENV === "development" || process.env.CAPTURA_RENDERS_ENABLED === "1" || process.env.CAPTURA_RENDERS_ENABLED === "true";

const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Página interna para `scripts/taller/capturar-renders.ts`: dibuja un item de la biblioteca con la cámara estándar. */
export default async function PaginaCaptura({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!habilitada()) notFound();
  const q = await searchParams;
  return <CapturaRender item={primero(q.item)} vista={primero(q.vista)} />;
}
