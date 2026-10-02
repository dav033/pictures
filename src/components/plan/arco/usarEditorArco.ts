import { useState } from "react";
import type { ArmadoArcoV1 } from "@/lib/plan/armado-arco";
import { mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoArco, type VistaArmadoArco } from "@/lib/plan/peticion-armado-arco";
import { mismoArmadoArco } from "./borrador-arco";
import { puedeGuardarArco, type PuedeGuardarArco } from "./guardar-arco";
import { firmaColoresArco, peticionVistaArco, type PiezaVistaArco } from "./vista-arco";
import { useVistaBorradorArco } from "./usarVistaBorradorArco";
import { panelDeBorradorArco, type EstadoVistaBorradorArco } from "./vista-borrador-arco";

/**
 * El editor de un arco (ADR-0035, paso 1): el borrador, el dibujo que el motor hace de él y el guardado.
 *
 * Un solo camino: el borrador es un `armado_arco`, el dibujo es lo que el motor devuelve para ese armado
 * (`useVistaBorradorArco`), y guardar lo escribe en el plan por la edición de siempre (`onGuardar`, que firma
 * otra vez). Nada se guarda mientras se edita, y la gráfica no se recalcula nunca en el navegador.
 *
 * **Los colores de la pieza pueden cambiar mientras se edita** (otro control de la tarjeta, el chat). El armado
 * nombra los colores por índice, así que el borrador podría apuntar a otro color o a ninguno: el dibujo se vuelve a
 * pedir con los colores vigentes (el motor rechaza un índice que ya no existe, con su frase) y Guardar espera a que
 * el decorador diga qué hacer con su borrador —seguir con él o tomar el arco de la propuesta—. No se pierde nada
 * en silencio.
 */
export function useEditorArco({ armadoEnPlan, pieza, inicial, onGuardar, ocupado, onCerrar }: {
  /** El armado que trae la pieza en el plan de ahora. */
  armadoEnPlan: ArmadoArcoV1;
  /** La pieza tal como está ahora: sus colores vigentes son con los que se dibuja. */
  pieza: PiezaVistaArco;
  /** El dibujo del armado del plan: se ve al abrir, sin esperar otro. */
  inicial: VistaArmadoArco;
  /** Escribe el armado en el plan; resuelve `null` si quedó guardado o el motivo si no. */
  onGuardar: (armado: ArmadoArcoV1) => Promise<string | null>;
  /** Otro ajuste de la propuesta se está guardando. */
  ocupado: boolean;
  onCerrar: () => void;
}): {
  borrador: ArmadoArcoV1;
  /** El motor sobre el borrador a la vista: su dibujo (o el último que llegó), sus herramientas y sus rangos. */
  vista: EstadoVistaBorradorArco & { reintentar: () => void };
  panel: ReturnType<typeof panelDeBorradorArco>;
  guardar: PuedeGuardarArco;
  guardando: boolean;
  errorGuardado: string | null;
  /** La propuesta cambió mientras se editaba (otro ajuste, el chat): guardar la reemplaza por este borrador. */
  planCambio: boolean;
  /** Los colores de la pieza cambiaron y el patrón no se ha revisado: Guardar espera. */
  coloresCambiaron: boolean;
  hayCambios: boolean;
  cambiar: (siguiente: ArmadoArcoV1) => void;
  restablecer: () => void;
  /** Sigue con el borrador tal como está, ya vuelto a dibujar con los colores de ahora. */
  seguirConMiBorrador: () => void;
  /** Toma el arco que la propuesta lleva ahora (el que Python ya ajustó a los colores vigentes). */
  usarArcoDeLaPropuesta: () => void;
  /** Pide al motor su receta para la pieza y la pone de borrador; resuelve el motivo si no llegó. */
  pedirReceta: () => Promise<string | null>;
  pedirGuardar: () => void;
  descartar: () => void;
} {
  // El armado y los colores con los que se abrió: contra ellos se dice si la propuesta cambió bajo el editor.
  const [inicio] = useState(() => ({ armado: armadoEnPlan, firma: firmaColoresArco(pieza) }));
  const firmaActual = firmaColoresArco(pieza);
  const [borrador, setBorrador] = useState<ArmadoArcoV1>(armadoEnPlan);
  const [revisadaCon, setRevisadaCon] = useState(inicio.firma);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const vista = useVistaBorradorArco({ pieza, armado: borrador, inicial });
  const hayCambios = !mismoArmadoArco(borrador, inicio.armado);
  const coloresCambiaron = firmaActual !== revisadaCon;
  const guardar = puedeGuardarArco({ estado: vista, hayCambios, guardando, ocupado, coloresCambiaron });

  function cambiar(siguiente: ArmadoArcoV1): void {
    setErrorGuardado(null);
    // Tocar un mando con los colores nuevos a la vista es revisarlos: el dibujo ya los usa.
    setRevisadaCon(firmaActual);
    setBorrador(siguiente);
  }

  function restablecer(): void {
    cambiar(inicio.armado);
  }

  async function pedirReceta(): Promise<string | null> {
    try {
      const receta = await pedirVistaArmadoArco(peticionVistaArco(pieza, null));
      cambiar(receta.armado);
      return null;
    } catch (error) {
      return mensajeFalloPlanArmado(error);
    }
  }

  async function guardarBorrador(): Promise<void> {
    setGuardando(true);
    setErrorGuardado(null);
    let motivo: string | null;
    try {
      motivo = await onGuardar(borrador);
    } catch {
      motivo = "No se pudo guardar el arco. Intenta de nuevo en un momento.";
    }
    // Guardado: la tarjeta ya tiene el plan nuevo y cierra el editor; no hay nada más que decir aquí.
    if (motivo === null) {
      onCerrar();
      return;
    }
    setGuardando(false);
    setErrorGuardado(motivo);
  }

  function pedirGuardar(): void {
    if (guardar.puede) void guardarBorrador();
  }

  return {
    borrador,
    vista,
    panel: panelDeBorradorArco(vista),
    guardar,
    guardando,
    errorGuardado,
    planCambio: !mismoArmadoArco(armadoEnPlan, inicio.armado),
    coloresCambiaron,
    hayCambios,
    cambiar,
    restablecer,
    seguirConMiBorrador: () => setRevisadaCon(firmaActual),
    usarArcoDeLaPropuesta: () => cambiar(armadoEnPlan),
    pedirReceta,
    pedirGuardar,
    descartar: () => { if (!guardando) onCerrar(); },
  };
}
