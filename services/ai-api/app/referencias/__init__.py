"""Los dibujos propios de la vista previa de una ficha, los que no salen de ningún diseñador.

Puerto 1 a 1 de ``clasificador-decoraciones/src/lib/referencias/*``. De ese directorio solo se migra
``dibujos.ts``: la **pared**, el **círculo**, el **techo** y el **centro de mesa** no tienen diseñador, y dos
formas del arco (el **perlado** y el **túnel**) no las hace su motor. Lo demás de allá —el repositorio de
fichas, el catálogo de estilos y el despachador de la vista previa— es interfaz y no se migra.

Son esquemáticos a propósito y **no calculan cantidades**: colocan globos en metros según la forma elegida,
les ponen color según el patrón y los pinta ``app.organico.dibujo``, así que se ven con la misma luz, sombra
y brillo que los demás. Nada de aquí entra en el conteo, en el precio ni en el ``plan_hash``: es dibujo.
"""
