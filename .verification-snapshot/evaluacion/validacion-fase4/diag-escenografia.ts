import { DATOS } from "../rutas";
import { readFileSync } from "node:fs";
import { ambientDecorName, sceneryFromReference } from "@/lib/ia/referencia/reference-structure";
const BASE = `${DATOS}/validacion-fase4/planes-ui1c`;
for (const c of [1, 2, 3, 5, 6]) {
  let bp, plan;
  try { bp = JSON.parse(readFileSync(`${BASE}/caso-${c}/corrida-1/blueprint.json`, "utf8")); plan = JSON.parse(readFileSync(`${BASE}/caso-${c}/corrida-1/plan-resuelto.json`, "utf8")); } catch { continue; }
  const mat = new Set<string>(plan.plan.estructuras.map((e: { referencia_element_id?: string }) => e.referencia_element_id).filter(Boolean));
  console.log(`caso ${c}`);
  for (const e of bp.elements) if (e.category !== "balloon_structure") console.log("   ", e.element_id, e.category, "aprob", e.approved, "conf", e.detection_confidence, JSON.stringify(e.name), "->", ambientDecorName(e.name) ?? "(rechazado)");
  console.log("   elegidos:", sceneryFromReference(bp, mat).map((i) => i.name));
}
