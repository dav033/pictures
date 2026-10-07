import type { Metadata } from "next";
import { Taller3D } from "@/components/tres-d/Taller3D";

export const metadata: Metadata = { title: "Globos en 3D · Sempertex" };

export default function Pagina3D() {
  return <Taller3D />;
}
