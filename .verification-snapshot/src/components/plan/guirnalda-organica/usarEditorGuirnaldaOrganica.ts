import { useState } from "react";
import type { ArmadoGuirnaldaOrganicaV1 } from "@/lib/plan/armado-guirnalda-organica";
import { mensajeFalloPlanArmado } from "@/lib/plan/peticion-armado";
import { pedirVistaArmadoGuirnaldaOrganica, type VistaArmadoGuirnaldaOrganica } from "@/lib/plan/peticion-armado-guirnalda-organica";
import { mismoArmadoGuirnaldaOrganica } from "./borrador-guirnalda-organica";
import { puedeGuardarGuirnaldaOrganica, type PuedeGuardarGuirnaldaOrganica } from "./guardar-guirnalda-organica";
import { firmaColoresGuirnaldaOrganica, peticionVistaGuirnaldaOrganica, type PiezaVistaGuirnaldaOrganica } from "./vista-guirnalda-organica";
import { useVistaBorradorGuirnaldaOrganica } from "./usarVistaBorradorGuirnaldaOrganica";
import { panelDeBorradorGuirnaldaOrganica, type EstadoVistaBorradorGuirnaldaOrganica } from "./vista-borrador-guirnalda-organica";

/**
 * El editor de una guirnalda del motor (ADR-0035, paso 3): el borrador, el dibujo que el motor hace de él y el guardado.
 *
 * Un solo camino: el borrador es un `armado_guirnalda_organica`, el dibujo es lo que el motor devuelve para ese armado
 * (`useVistaBorradorGuirnaldaOrganica`), y guardar lo escribe en el plan por la edición de siempre (`onGuardar`, que firma
 * otra vez). Nada se guarda mientras se edita, y la gráfica no se recalcula nunca en el navegador.
 *
 * **Los colores de la pieza pueden cambiar mientras se edita** (otro control de la tarjeta, el chat). El armado
 * nombra los colores por índice, así que el borrador podría apuntar a otro color o a ninguno: el dibujo se vuelve a
 * pedir con los colores vigentes (el motor rechaza un índice que ya no existe, con su frase) y Guardar espera a que
 * el decorador diga qué hacer con su borrador —seguir con él o tomar la guirnalda de la propuesta—. No se pierde nada
 * en silencio.
 */
export function useEditorGuirnaldaOrganica({ armadoEnPlan, pieza, inicial, onGuardar, ocupado, onCerrar }: {
  /** El armado que trae la pieza en el plan de ahora. */
  armadoEnPlan: ArmadoGuirnaldaOrganicaV1;
  /** La pieza tal como está ahora: sus colores vigentes son con los que se dibuja. */
  pieza: PiezaVistaGuirnaldaOrganica;
  /** El dibujo del armado del plan: se ve al abrir, sin esperar otro. */
  inicial: VistaArmadoGuirnaldaOrganica;
  /** Escribe el armado en el plan; resuelve `null` si quedó guardado o el motivo si no. */
  onGuardar: (armado: ArmadoGuirnaldaOrganicaV1) => Promise<string | null>;
  /** Otro ajuste de la propuesta se está guardando. */
  ocupado: boolean;
  onCerrar: () => void;
}): {
  borrador: ArmadoGuirnaldaOrganicaV1;
  /** El motor sobre el borrador a la vista: su dibujo (o el último que llegó), sus herramientas y sus rangos. */
  vista: EstadoVistaBorradorGuirnaldaOrganica & { reintentar: () => void };
  panel: ReturnType<typeof panelDeBorradorGuirnaldaOrganica>;
  guardar: PuedeGuardarGuirnaldaOrganica;
  guardando: boolean;
  errorGuardado: string | null;
  /** La propuesta cambió mientras se editaba (otro ajuste, el chat): guardar la reemplaza por este borrador. */
  planCambio: boolean;
  /** Los colores de la pieza cambiaron y el patrón no se ha revisado: Guardar espera. */
  coloresCambiaron: boolean;
  hayCambios: boolean;
  cambiar: (siguiente: ArmadoGuirnaldaOrganicaV1) => void;
  restablecer: () => void;
  /** Sigue con el borrador tal como está, ya vuelto a dibujar con los colores de ahora. */
  seguirConMiBorrador: () => void;
  /** Toma la guirnalda que la propuesta lleva ahora (el que Python ya ajustó a los colores vigentes). */
  usarGuirnaldaDeLaPropuesta: () => void;
  /** Pide al motor su receta para la pieza y la pone de borrador; resuelve el motivo si no llegó. */
  pedirReceta: () => Promise<string | null>;
  pedirGuardar: () => void;
  descartar: () => void;
} {
  // El armado y los colores con los que se abrió: contra ellos se dice si la propuesta cambió bajo el editor.
  const [inicio] = useState(() => ({ armado: armadoEnPlan, firma: firmaColoresGuirnaldaOrganica(pieza) }));
  const firmaActual = firmaColoresGuirnaldaOrganica(pieza);
  const [borrador, setBorrador] = useState<ArmadoGuirnaldaOrganicaV1>(armadoEnPlan);
  const [revisadaCon, setRevisadaCon] = useState(inicio.firma);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const vista = useVistaBorradorGuirnaldaOrganica({ pieza, armado: borrador, inicial });
  const hayCambios = !mismoArmadoGuirnaldaOrganica(borrador, inicio.armado);
  const coloresCambiaron = firmaActual !== revisadaCon;
  const guardar = puedeGuardarGuirnaldaOrganica({ estado: vista, hayCambios, guardando, ocupado, coloresCambiaron });

  function cambiar(siguiente: ArmadoGuirnaldaOrganicaV1): void {
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
      const receta = await pedirVistaArmadoGuirnaldaOrganica(peticionVistaGuirnaldaOrganica(pieza, null));
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
      motivo = "No se pudo guardar la guirnalda. Intenta de nuevo en un momento.";
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
    panel: panelDeBorradorGuirnaldaOrganica(vista),
    guardar,
    guardando,
    errorGuardado,
    planCambio: !mismoArmadoGuirnaldaOrganica(armadoEnPlan, inicio.armado),
    coloresCambiaron,
    hayCambios,
    cambiar,
    restablecer,
    seguirConMiBorrador: () => setRevisadaCon(firmaActual),
    usarGuirnaldaDeLaPropuesta: () => cambiar(armadoEnPlan),
    pedirReceta,
    pedirGuardar,
    descartar: () => { if (!guardando) onCerrar(); },
  };
}
