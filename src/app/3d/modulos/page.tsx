import type { Metadata, Viewport } from "next";
import { EstudioModulos } from "@/components/modulos-estudio/EstudioModulos";

export const metadata: Metadata = { title: "Estudio de módulos · Sempertex" };

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function PaginaEstudioModulos() {
  return <EstudioModulos />;
}
