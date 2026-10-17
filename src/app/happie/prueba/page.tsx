import { notFound } from "next/navigation";
import { connection } from "next/server";
import { panelPruebaActivo } from "@/lib/happie/panel-prueba";
import { PanelesPrueba } from "./PanelesPrueba";

// The kill switch (env) is read on every visit: without connection() `cacheComponents` would freeze it into the build.
export const instant = false;

export default async function PruebaHappiePage() {
  await connection();
  if (!panelPruebaActivo()) notFound();
  return <PanelesPrueba />;
}
