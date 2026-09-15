# ADR-0022. Reparto de globos por tamaño y material

Estado: aceptada (2026-09-15). Implementada en `src/lib/medidas/geometria.ts` y `services/ai-api/app/plan.py`, con vectores dorados 20 a 24.

Los ids 0010 a 0021 están reservados por los planes de `docs/planes/estructuras-2026-09`, así que este registro toma el 0022.

## Problema

El despiece de una estructura geométrica repartía un único Hamilton sobre las celdas tamaño × material de una instancia y después multiplicaba por `repeticiones`. Encima, cuando el cliente fijaba tamaños (`restricciones.tamanos` con polaridad `obligatorio`, que el resolutor aplica a **todas** las estructuras geométricas del plan), las proporciones de la mezcla se filtraban sin renormalizar mientras el total seguía saliendo de la mezcla completa. Las dos reglas están duplicadas a mano en TypeScript y en Python.

Comprobado con `npx tsx` y con el intérprete del servicio, sin red ni proveedores:

| Caso | Antes | Ahora |
| --- | ---: | ---: |
| Arco 3 × 2,4 m `organica_fina`, sin restricción | 119 | 119 |
| El mismo arco "solo R-12" | 65 | 104 |
| El mismo arco con R-12 y R-18 | 71 | 94 |
| Arco `clasica` con "R-18 y R-24" | 264 | 64 |
| Arco `organica_fina` con "R-36" | 119 globos de 36″ | 35 |
| Columna 1,8 m `organica_fina`, 1 color | R-24: 1 | R-24: 1 |
| La misma columna con 2 colores | R-24: 0 | R-24: 1 |
| 10 centros de mesa `organica_gruesa`, 2 colores | R-24: 0 | R-24: 10 |
| Columna `clasica` [Terracota 0,5, coral 0,5] | TS 19/20, Python 20/19 | 20/19 en los dos |

Tres defectos distintos:

1. **Total mal calculado con tamaños obligatorios.** Las proporciones filtradas sumaban menos de 1 y el Hamilton solo añadía una unidad por celda, así que el arco se cotizaba a la mitad. Si ningún tamaño de la mezcla sobrevivía al filtro, cada tamaño pedido recibía proporción 1 y el total se multiplicaba por el número de tamaños.
2. **Los acentos desaparecían al añadir color.** Con el Hamilton conjunto, la cuota de un R-24 (2 % de la mezcla) se dividía entre los colores antes de redondear y caía por debajo del corte del mayor resto. El reparto por color de piezas pequeñas repetidas se desviaba y el error se multiplicaba por `repeticiones`.
3. **Desempate dependiente del idioma.** El desempate final comparaba el nombre del color con `localeCompare` en TypeScript y por punto de código en Python, así que los dos backends firmaban planes distintos para la misma entrada.

## Decisión

1. **Mezcla efectiva.** Con tamaños obligatorios, la mezcla efectiva son los tamaños de la mezcla que están en el conjunto pedido, renormalizados a 1; si ninguno está, partes iguales entre los tamaños pedidos, en orden ascendente. El total sale de esa mezcla efectiva: área ponderada del globo y diámetro dominante. El ancho de banda y el perfil de la estructura oficial siguen saliendo de la `mezcla` del plan, porque describen la forma de la pieza, no el tamaño del globo.
2. **Tamaños que no se pueden ubicar.** Un tamaño obligatorio que la mezcla de esa estructura no puede ubicar (porque al menos otro sí está en la mezcla) se reporta como `tamano_obligatorio_sin_ubicar:<estructura_id>:R-<n>` en `advertencias`, en los dos backends. `validarRestriccionesPlan` no revisa tamaños, así que esta advertencia es el único aviso; no bloquea la confirmación.
3. **Reparto en dos márgenes por instancia.** Primero el total por tamaño (Hamilton sobre la mezcla efectiva) y el total por material (Hamilton sobre `participacion` renormalizada); después una matriz entera tamaño × material que respeta los dos márgenes: piso de `R_i × q_j`, y las unidades que faltan se reparten por (mayor resto, mayor diámetro, menor índice de material) solo en celdas donde la fila y la columna todavía necesitan unidades. Al final se multiplica por `repeticiones`, así que las instancias siguen siendo idénticas.
4. **Desempate sin color.** Mayor resto, después mayor diámetro (margen de tamaños) o menor índice de material (margen de materiales). El nombre del color ya no participa en ningún desempate.
5. **Invariante explícito.** Si las cuotas no suman el total con tolerancia 1e-6, o si la matriz no cierra los dos márgenes, se lanza un error tipado (`ErrorRepartoGlobos` / `BalloonApportionmentError`) en vez de devolver un conteo que no cuadra.
6. **Un solo dueño del reparto en TypeScript.** El reparto por partes iguales de `calcularMedidas` (ruta heredada sin plan) usa la misma rutina.

La matriz es completa (existe toda celda tamaño × material) y ninguna celda tiene tope, así que mientras queden déficit de fila y de columna hay una celda que puede recibir la unidad, y los dos déficits —que suman lo mismo— se agotan a la vez. Por eso el barrido codicioso siempre cierra y no se implementó un camino de aumento; el error tipado cubre el caso imposible.

## Alternativas

- **Un único Hamilton sobre las celdas (lo que había).** Conserva el total pero ninguno de los dos márgenes. Es la causa de que los acentos desaparecieran y de que el reparto por color se desviara. Descartada.
- **Anidado tamaño → color.** Repartir por tamaño y, dentro de cada tamaño, por color con mayor resto. Conserva el total por tamaño, pero el total por color puede desviarse hasta el número de tamaños por instancia (en 10 centros de mesa, hasta 40 globos del color equivocado). Descartada por eso; el reparto en dos márgenes da el mismo total por tamaño y además clava el total por color.
- **Anidado color → tamaño.** El espejo: clava el color y desvía los tamaños, así que los acentos volverían a depender del número de colores. Descartada.
- **Redondear sobre el total de la estructura (instancia × repeticiones).** Da los márgenes exactos del conjunto, pero rompe la invariante de que seis repeticiones son seis veces una instancia (`scripts/test-geometria-plan.ts`) y haría instancias distintas entre sí, mientras el prompt de imagen reparte unidades por instancia. Descartada.
- **Renormalizar solo las proporciones y dejar el total de la mezcla completa.** Arregla que la suma cuadre, pero un arco "solo R-36" seguiría contando globos de 12″. Descartada: el tamaño del globo es justamente lo que decide cuántos caben.
- **Acotar la restricción de tamaños por estructura.** Fuera de alcance: hoy `restricciones.tamanos` es del plan entero y así se documenta. Cambiarlo es una decisión de producto aparte.

## Consecuencias

- Cambian las cantidades de los planes con tamaños obligatorios y el reparto por color de los planes con varios materiales. Con eso cambia `plan_hash`: `/api/generate` vuelve a comprobar el hash contra el token de aprobación (`src/app/api/generate/route.ts`), así que **los planes aprobados antes del despliegue y todavía no generados dejan de coincidir y se tienen que volver a aprobar**. Afecta a planes con varios colores o con tamaños obligatorios; un plan de un solo color sin tamaños fijos no cambia.
- Un arco "solo R-12" pasa a cotizar ~60 % más globos que antes (104 frente a 65 en el caso de referencia) y un "R-18 y R-24" sobre mezcla clásica pasa a cotizar 64 en vez de 264: los presupuestos de esos planes cambian en los dos sentidos.
- Los vectores dorados 16 y 18 se regeneraron (cambia el reparto por color, no los totales) y se añadieron los vectores 20 a 24. `npm run plan:test-paridad-python` pasa en los 24.
- Los umbrales de densidad, λ y el ancho de banda siguen sin calibrar; esta decisión no los toca.

En la misma entrega (frente W1) viajan otros dos cambios que también mueven `plan_hash` y las cifras del plan, documentados en el código y en sus commits: la puerta física pasa a evaluarse por estructura lineal con un solo dueño en Next (`physicalWarningsForPlan`) y el paquete extra de la reserva de merma se compra en la presentación más barata, con `additional_waste_packages` y `waste_only_savings_cop` redefinidos como delta real y ahorro real.

## Reversión

Revertir los commits de W1 en `geometria.ts`, `plan.py`, `resolver.ts` y `estimacion.ts`, regenerar `expected` con `npx tsx --conditions=react-server scripts/test-paridad-plan-python.ts --update` y `expected_python` con `PARIDAD_ACTUALIZAR=1 pytest tests/test_plan_parity.py`, y retirar los vectores 20 a 24. No hay migración de datos: los planes guardados conservan su `plan_hash` y un plan re-resuelto con otro reparto deja de coincidir con su token, igual que ante cualquier cambio del resolutor. `PYTHON_BACKEND_KILL_SWITCH` sigue siendo la reversión del backend, pero no revierte este cambio: los dos backends lo llevan.
