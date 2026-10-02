"""La merma del plan: cuánto de más se compra sobre lo que la pieza lleva.

Vive aparte de ``plan.py`` porque las puertas de los motores (``armado_arco``, ``armado_columna_organica``,
``armado_guirnalda_organica``) la necesitan como valor por defecto y ``plan.py`` las importa a ellas: un ciclo.
El dueño del número sigue siendo el plan (política de compra, ADR-0034); las puertas no la deciden, la reciben.

Los motores migrados del diseñador traen su propio margen inicial (0,08 en el arco y 0,12 en las orgánicas, en
``REAL_INICIAL``). Ese valor es del diseñador, está dentro de los vectores de oro y no lo usa ninguna puerta: toda
llamada de la aplicación pasa ``MERMA``.
"""

from __future__ import annotations

MERMA: float = 0.08

__all__ = ["MERMA"]
