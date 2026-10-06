import decoracionesRaw from "./decoraciones.json";
import proveedoresRaw from "./proveedores.json";
import { DecoracionSempertexSchema, ProveedorSempertexSchema, type DecoracionSempertex, type ProveedorSempertex } from "./esquemas";
import { resolveRuntimeCommercialEnvironment } from "@/lib/generacion/provenance";

export const decoracionesSempertex: DecoracionSempertex[] = decoracionesRaw.map((dato) => DecoracionSempertexSchema.parse(dato));
export const proveedoresSempertex: ProveedorSempertex[] = proveedoresRaw.map((dato) => ProveedorSempertexSchema.parse(dato));

export function bibliotecaVisible(): DecoracionSempertex[] {
  return resolveRuntimeCommercialEnvironment() === "production"
    ? decoracionesSempertex.filter((decoracion) => decoracion.origen !== "ejemplo")
    : decoracionesSempertex;
}

export function proveedoresVisibles(): ProveedorSempertex[] {
  return resolveRuntimeCommercialEnvironment() === "production"
    ? proveedoresSempertex.filter((proveedor) => proveedor.origen !== "ejemplo")
    : proveedoresSempertex;
}
