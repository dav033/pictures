# ADR 0005: Python como autoridad de dominio

- Estado: aceptado
- Fecha: 2026-09-11
- Decisores: equipo del proyecto

## Contexto

El sistema actual es híbrido. Next/TypeScript contiene la lógica de catálogo,
RAG, parser, planes, geometría, materiales, cotización, chat, generación,
LoRA e integraciones. El servicio Python solo ofrece una frontera autenticada
para echo, rerank y embeddings. Activar sus flags actuales no convierte a
Python en dueño del dominio.

## Decisión

Python será la única autoridad de aplicación para:

- catálogo, disponibilidad, SKU, precios y retrieval RAG;
- interpretación de consultas, chat, herramientas y planificación;
- geometría, materiales, cotización, aprobación y auditoría;
- generación, QA visual y ciclo de vida LoRA;
- Shopify, Happie, órdenes y demás efectos externos.

Next conservará únicamente la interfaz de usuario, el estado efímero de
presentación y una fachada HTTP delgada mientras dure el corte. La fachada no
podrá consultar tablas comerciales, aplicar reglas de negocio, calcular
precios, elegir productos, construir prompts ni ejecutar efectos externos.
La autenticación y autorización de cada operación serán verificadas en Python;
Next solo transportará la identidad y el contexto firmado.

Python será también dueño de los adaptadores de persistencia y proveedores.
Los esquemas y contratos se versionarán antes de mover cada capacidad. Los
efectos externos pagados tendrán idempotencia durable, límites de gasto,
timeouts, reconciliación y estados observables antes de activar el tráfico.

## Alternativas descartadas

- Mantener Next como autoridad comercial y usar Python solo para rerank/embed:
  contradice el objetivo y conserva dos fronteras de decisión.
- Hacer que Python llame a rutas internas de Next: mueve el transporte, pero
  deja la lógica en Next y crea una dependencia circular.
- Borrar inmediatamente la lógica TypeScript: dejaría la UI sin una
  implementación equivalente y destruiría una ruta de rollback.

## Consecuencias

- La migración es un cambio de arquitectura, no un cambio de flag.
- Habrá contratos Python para cada capacidad y adaptadores de transición en
  Next. Estos adaptadores no podrán duplicar reglas de dominio.
- El catálogo comercial y los efectos externos deben ser accesibles al runtime
  Python con permisos mínimos y auditables.
- Las rutas Next existentes pueden conservar sus URLs durante la migración,
  pero solo como proxies sin lógica de aplicación.
- La eliminación de módulos TypeScript se hará después de paridad funcional,
  recuperación, observabilidad y rollback verificados por capacidad.

## Secuencia y rollback

1. Definir y validar el contrato versionado de una capacidad.
2. Implementar la capacidad en Python con tests unitarios y de integración.
3. Cambiar la ruta Next a proxy y ejecutar replay/E2E contra Python.
4. Observar errores, latencia, efectos e idempotencia; mantener rollback por
   capacidad durante la ventana de observación.
5. Retirar la implementación TypeScript solo cuando ningún consumidor la use y
   exista una recuperación documentada.

El selector `PYTHON_BACKEND_ENABLED` queda como mecanismo temporal de corte,
no como solución permanente. Cuando todas las capacidades estén en Python, se
eliminará el selector y Next dejará de tener acceso a la autoridad comercial.
