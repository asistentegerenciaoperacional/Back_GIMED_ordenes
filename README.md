# Back_GIMED_ordenes

API de GIMED en TypeScript, Hono y Supabase. Extraída del prototipo `5714641b9e969ca70c0ad8fbe9378253dd56c806`. Los módulos HTTP, identidad, documentos, correos y consultas viven en `supabase/functions/_shared`. Las reglas anteriores se ejercitan detrás del adaptador en `legacy/`. Los contratos públicos se publican desde `contracts/openapi.json`.

## Desarrollo

- Instalar Node 24 y Docker. Ejecutar `npm ci`, `npm run check` y `npm test`.
- Consultar `npx supabase start --help` y ejecutar `npx supabase start` para Postgres, Auth y Storage locales. En Windows el piloto local usa el loopback y las credenciales del entorno local. Usar solo datos sintéticos en ese entorno.
- Definir el secreto TLS y las credenciales descritas en [operación](docs/operacion.md). Configurar el rol `gimed_runtime`, inicializar consecutivos e importar catálogos. Ejecutar `npx supabase functions serve api --env-file .env` para el desarrollo del back y `npm run dev:piloto` desde el front.
- Generar el contrato con `node --import tsx scripts/contrato.ts`. Copiar a la revisión correspondiente del front y generar sus tipos.

[Arquitectura](docs/arquitectura.md) · [Glosario](CONTEXT.md) · [Operación](docs/operacion.md) · [Importación](docs/importacion.md)
