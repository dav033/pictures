"""El diseñador de BOUQUETS: un ramillete de globos atados con cintas a un mismo punto, sobre un peso en el piso.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/bouquet/*``. Un módulo de Python por archivo de TypeScript,
con el mismo nombre, para que un cambio allá se encuentre aquí sin buscar.

Son **dos diseñadores distintos** que comparten carpeta en el original y por eso también aquí:

- El ramo propiamente dicho (``tipos``, ``formas``, ``medidas``, ``limites``, ``motor``): globos de látex y
  especiales (burbuja, estrella, corazón, redondo y número de foil) repartidos en niveles de cinta —o en un
  montón a ras del suelo—, cada uno girado para que su nudo apunte al punto donde se juntan las cintas. Reusa
  del motor compartido (``app.organico``) solo el reparto de colores (``colorear``) y la regla con la persona
  de 1,70 m; la colocación, las medidas y el dibujo son propios.
- El bouquet **por partes** (``armado``, ``armado_formas``): el dibujo de lo que describe el contrato
  ``armado-bouquet.v1`` de ADR-0030 (niveles de unidades —pareja, trío, cuarteto…—, remate y números foil).
  Aquí **solo se dibuja**; las reglas comerciales de ese contrato son de ``app/armado_bouquet.py`` y de
  ``plan.py``, y no se repiten. Es otro armado y no se mezcla con el de arriba.

Nada de esto está cableado al plan todavía: es el motor y su oráculo (``contracts/domain/v1/golden/bouquet/``).
"""
