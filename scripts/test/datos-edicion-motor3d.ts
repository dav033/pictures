import { armarDesdeEspec, cotizarBom, crearCachePiezas, crosswalkIncluido, especDesdePropuesta, sobreDelMotor } from "../../src/lib/globos3d/motor/v1";
import { atenderArmadaMotor, crearCacheArmada } from "../../src/lib/guiada-motor/armada-motor";
import { atenderEditarMotor, type DependenciasEditarMotor } from "../../src/lib/guiada-motor/editar-motor";
import { huellaDeNavegador } from "../../src/lib/guiada-motor/plan-motor";
import { crearTopePorNavegador } from "../../src/lib/guiada-motor/tope-imagenes-navegador";
import { firmaDePlan } from "../../src/components/guiado/motor3d/firma-plan";
import { PlanGuiadoSchema } from "../../src/lib/ia/contracts/asistente-guiado-v1";
import { planGuardadoDeIdea } from "../../src/lib/plan/planes-ideas-guardados";
import { sessionToken, SESSION_COOKIE } from "../../src/lib/auth/session";
import { pythonDoble } from "../lib/python-doble-precio";

/**
 * Un plan del motor 3D (un arco y dos columnas) con las respuestas REALES de `/api/guiada/motor/editar` a los cambios que el
 * chat y el panel de «Ajustar mi plan» harían, y la armada real del plan antes y después de un cambio, en JSON por la salida
 * estándar. Las lee `test-ui-ediciones-motor3d.ts`, que no puede importar el motor (solo servidor) y prueba el cliente real
 * con un `fetch` que repite estas respuestas. Sin red ni coste.
 */
const CLAVE_APP = "clave-app-de-prueba";
const IDENTIDAD = "a1".repeat(16);
process.env.APP_PASSWORD = CLAVE_APP;
delete process.env.GUIADA_MOTOR;

type Peticion = { turnoId?: string; edicion: unknown };
const PETICIONES: Record<string, Peticion> = {
  chat_color: { turnoId: "msj-1", edicion: { tipo: "pedido", pedido: { tipo: "reemplazar_color", color: "azul", colorNuevo: "celeste", piezas: ["Columna izquierda"] } } },
  chat_agregar_pieza: { turnoId: "msj-2", edicion: { tipo: "pedido", pedido: { tipo: "agregar_pieza", pieza: { estructura: "guirnalda", ubicacion: "centro", colores: [] } } } },
  chat_quitar_pieza: { turnoId: "msj-3", edicion: { tipo: "pedido", pedido: { tipo: "quitar_pieza", piezas: ["Columna derecha"] } } },
  chat_flores: { turnoId: "msj-4", edicion: { tipo: "pedido", pedido: { tipo: "flores", quitar: false, cantidad: 3, colorPetalo: "dorado", colorCentro: "azul", piezas: ["Arco"] } } },
  chat_renombrar: { turnoId: "msj-5", edicion: { tipo: "pedido", pedido: { tipo: "renombrar_pieza", pieza: "Arco", nombre: "Cascada" } } },
  chat_color_ausente: { turnoId: "msj-6", edicion: { tipo: "pedido", pedido: { tipo: "reemplazar_color", color: "verde", colorNuevo: "rojo", piezas: [] } } },
  chat_tanda_parcial: { turnoId: "msj-7", edicion: { tipo: "ops", ediciones: [{ op: "reemplazar_color", de: "azul", a: "rojo", piezas: ["EST_01_ARCO"] }, { op: "tamano_pieza", pieza: "EST_02_COLUMNA", medidas: { altoM: 9 } }, { op: "quitar_color", color: "verde" }] } },
  panel_tamano_todo: { edicion: { tipo: "cambio", cambio: { tipo: "tamano-todo", direccion: 1 } } },
  panel_reemplazar_color: { edicion: { tipo: "cambio", cambio: { tipo: "reemplazar-color", color: "dorado", nuevo: "015" } } },
  panel_cantidad_pareja: { edicion: { tipo: "cambio", cambio: { tipo: "cantidad", estructuraId: "EST_02_COLUMNA", indice: 0, objetivo: 30, desde: 20, pareja: true } } },
  panel_tamano_globos: { edicion: { tipo: "cambio", cambio: { tipo: "tamano-globos", estructuraId: "EST_01_ARCO", direccion: 1 } } },
  panel_quitar_pieza: { edicion: { tipo: "cambio", cambio: { tipo: "quitar-pieza", estructuraId: "EST_03_COLUMNA" } } },
  panel_agregar_color: { edicion: { tipo: "cambio", cambio: { tipo: "agregar-color", color: "970" } } },
};

async function main(): Promise<void> {
  const cruce = crosswalkIncluido();
  const doble = pythonDoble(cruce);
  const { espec } = especDesdePropuesta({ frase: "x", colores: ["azul", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }, { estructura: "columna", cantidad: 2 }] });
  const resultado = armarDesdeEspec(espec);
  const cotizada = await cotizarBom(resultado.bom, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista });
  if (!cotizada.ok) throw new Error("no se cotizó");
  const sobre = sobreDelMotor({ espec, resultado, cotizacion: cotizada, concepto: { titulo: "Plan de prueba", descripcion: "Plan de prueba" }, requestId: "11111111-1111-4111-8111-111111111111", navegador: huellaDeNavegador(`nav-${IDENTIDAD}`) });
  if (!sobre.ok) throw new Error(sobre.motivo);
  const plan = PlanGuiadoSchema.parse(sobre.plan);

  const cachePiezas = crearCachePiezas(32);
  let ids = 0;
  const crear = (motor: "3d" | "python"): DependenciasEditarMotor => ({
    leerBandera: async () => ({ motor, fuente: "cookie" }),
    auditar: () => undefined,
    armar: (e) => armarDesdeEspec(e, { cachePiezas }),
    planGuardado: planGuardadoDeIdea,
    cotizar: (bom) => cotizarBom({ total: bom.total, porPieza: bom.porPieza }, { crosswalk: async () => cruce, cotizarLista: doble.cotizarLista }),
    nuevoId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    tomarEdicion: crearTopePorNavegador(1000).tomar,
  });
  const cookies = `${SESSION_COOKIE}=${sessionToken(CLAVE_APP)}; feedback_usuario=${IDENTIDAD}`;
  const llamar = async (base: unknown, peticion: Peticion, motor: "3d" | "python" = "3d") => {
    const cuerpo = { plan: base, ...(peticion.turnoId ? { turnoId: peticion.turnoId } : {}), edicion: peticion.edicion };
    const respuesta = await atenderEditarMotor(new Request("https://app.test/api/guiada/motor/editar", { method: "POST", headers: { "content-type": "application/json", cookie: cookies }, body: JSON.stringify(cuerpo) }), crear(motor));
    return { peticion, estado: respuesta.status, json: await respuesta.json() as unknown };
  };

  const respuestas: Record<string, Awaited<ReturnType<typeof llamar>>> = {};
  for (const [clave, peticion] of Object.entries(PETICIONES)) respuestas[clave] = await llamar(plan, peticion);
  const apagado = await llamar(plan, PETICIONES.chat_color!, "python");

  // La armada real del plan de antes y del plan editado (lo que la vista pide al cambiar el hash).
  const armadaDe = async (p: unknown) => {
    const firma = firmaDePlan(PlanGuiadoSchema.parse(p))!;
    const cuerpo = { ...firma, salida: "armada" };
    const respuesta = await atenderArmadaMotor(new Request("https://app.test/api/guiada/motor/armada", { method: "POST", headers: { "content-type": "application/json", cookie: cookies }, body: JSON.stringify(cuerpo) }), { leerBandera: async () => ({ motor: "python" as const, fuente: "env" as const }), armar: armarDesdeEspec, cache: crearCacheArmada(8), auditar: () => undefined });
    return { cuerpo, estado: respuesta.status, texto: await respuesta.text() };
  };
  const editado = (respuestas.chat_color!.json as { plan: unknown }).plan;
  process.stdout.write(JSON.stringify({
    plan, cotizacion: sobre.cotizacion, respuestas, apagado,
    armadas: { antes: await armadaDe(plan), despues: await armadaDe(editado) },
  }));
}

void main();
