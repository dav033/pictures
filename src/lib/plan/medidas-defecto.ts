import type { EstructuraPlan, PlanDecoracion } from "./tipos";

type Medidas = { ancho_m?: number; alto_m?: number; largo_m?: number };
const EXTERIOR = /jard[ií]n|exterior|terraza|playa|patio|campo/i;

const DEFAULTS: Record<EstructuraPlan["tipo"], { interior: Medidas; exterior: Medidas; texto: string }> = {
  arco: { interior: { ancho_m: 3, alto_m: 2.4 }, exterior: { ancho_m: 4, alto_m: 2.6 }, texto: "ancho × alto" },
  semiarco: { interior: { ancho_m: 2.4, alto_m: 2.2 }, exterior: { ancho_m: 3, alto_m: 2.4 }, texto: "ancho × alto" },
  guirnalda: { interior: { largo_m: 2.5 }, exterior: { largo_m: 3.5 }, texto: "largo" },
  columna: { interior: { alto_m: 1.8 }, exterior: { alto_m: 2 }, texto: "alto" },
  pared: { interior: { ancho_m: 2.4, alto_m: 2.4 }, exterior: { ancho_m: 3, alto_m: 2.4 }, texto: "ancho × alto" },
  centro_mesa: { interior: { ancho_m: 0.4, alto_m: 0.5 }, exterior: { ancho_m: 0.4, alto_m: 0.5 }, texto: "diámetro × alto" },
  backdrop: { interior: {}, exterior: {}, texto: "" },
  kit: { interior: {}, exterior: {}, texto: "" },
  accesorio: { interior: {}, exterior: {}, texto: "" },
};

export function completarMedidas(plan: PlanDecoracion): PlanDecoracion {
  const exterior = EXTERIOR.test(plan.espacio.tipo);
  const supuestos = [...plan.supuestos];
  const estructuras = plan.estructuras.map((estructura) => {
    if (["backdrop", "kit", "accesorio"].includes(estructura.tipo)) return estructura;
    const defaults = DEFAULTS[estructura.tipo][exterior ? "exterior" : "interior"];
    const medidas = { ...defaults, ...estructura.medidas };
    const faltaban = Object.keys(defaults).some((key) => (estructura.medidas as Record<string, unknown>)[key] == null);
    if (faltaban) {
      const valores = [medidas.ancho_m, medidas.alto_m, medidas.largo_m].filter((value): value is number => value != null);
      const texto = valores.length === 1 ? `${valores[0]} m` : valores.map((value) => `${value} m`).join(" × ");
      supuestos.push(`medidas asumidas para ${estructura.tipo}: ${texto} — no nos diste el tamaño del espacio`);
    }
    return { ...estructura, medidas };
  });
  return { ...plan, estructuras, supuestos: [...new Set(supuestos)] };
}
