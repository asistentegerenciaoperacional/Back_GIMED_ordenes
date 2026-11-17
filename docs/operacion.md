# Operación del piloto

## Configuración local

1. Ejecutar `npx supabase start`. Usar `npx supabase status` localmente para ubicar el URL y las claves de desarrollo.
2. Copiar `.env.example` a `.env` y completar los valores localmente. Crear un password con `\\password gimed_runtime` dentro de psql y guardar su conexión en `GIMED_DB_URL`. Edge local usa el alias `db:5432`. Las herramientas que se ejecutan en Windows usan `127.0.0.1:54322`. El rol de administración se usa para migración y carga inicial.
3. Definir `GIMED_OC_BASE` y `GIMED_OCM_BASE` como últimos números usados. Ejecutar `node --env-file=.env --import tsx scripts/consecutivos.ts` antes de emitir.
4. Configurar el mismo `GIMED_PROXY_SECRET` en front y back. Crear `GIMED_TOKEN_KEY` con 32 bytes aleatorios codificados como 64 caracteres hexadecimales. Dentro de Edge local, usar la URL interna de Supabase y `GIMED_STORAGE_PUBLIC_URL=http://127.0.0.1:54321` para el navegador. Mantener host idéntico al de `GIMED_APP_ORIGIN` al probar cookies.
5. Ejecutar el back con `npx supabase functions serve api --env-file .env`. En el front usar `npm run dev:piloto`. Para desarrollo sintético usar `npm run dev` en el front histórico.

## Google Workspace y servicios

Crear clientes de aplicación web internos de la organización para login y Gmail. Registrar callbacks exactos `<origen>/api/v1/auth/callback` y `<origen>/api/v1/correos/gmail/callback`. Configurar el cliente de login además en Supabase Auth → Google. Habilitar Gmail API y autorizar el cliente de Gmail según la política de Workspace. El cliente de Gmail solicita `gmail.send` con consentimiento individual. En comprobación, configurar `GIMED_GMAIL_TEST_RECIPIENTS` con las direcciones autorizadas. El back valida todos los destinos cuando esa variable tiene valores.

El identificador de autorización se usa una sola vez durante 10 minutos. La sesión de GIMED dura hasta 30 días y caduca a los 7 días de inactividad. Para deshabilitar una cuenta, actualizar `identity.disabled_at` y borrar sus filas de `session` y `gmail_connection` desde una transacción de administración. La autoría histórica permanece asociada al UUID. Revocar también la autorización del cliente en Google Workspace cuando corresponda.

## Publicación y mantenimiento

Usar nombres y cuentas corporativos de GitHub y Cloudflare. Preparar QA sintético separado. Aplicar el SQL revisado en QA y ejecutar los recorridos antes de apuntar al Supabase del piloto. Publicar back y front con revisiones identificables. En el Worker desplegado, `GIMED_EDGE_URL` termina en `/functions/v1/api` y `GIMED_PROXY_SECRET` se guarda como secreto.

Programar `npm run limpiar-archivos` desde el entorno corporativo para retirar archivos huérfanos y sesiones vencidas. Verificar uso y alertar sobre 600 MB. Se limitan las cargas a 750 MB, incluyendo reservas y archivos retirados pendientes de limpiar. Una carga fallida queda reservada durante el período de recuperación o hasta que venza.

Verificar los correos inciertos en Enviados del buzón corporativo antes de preparar otro envío. Una confirmación anterior se conserva en el registro de intentos. El cuerpo y los archivos adjuntos quedan fuera del historial.

## Copias y reversión

Configurar el runner corporativo `gimed-backup` con Node 24, `pg_dump`, un destino absoluto autorizado y la clave de respaldo. Ejecutar `node --env-file=.env --import tsx scripts/respaldo.ts` durante la ventana de mantenimiento o habilitar el workflow diario. El respaldo contiene el dump de datos de `gimed`, los objetos vigentes y el manifiesto. Cada archivo lleva un IV inicial de 12 bytes, datos cifrados con AES-256-GCM y una etiqueta de 16 bytes. La AAD es el nombre sin extensión `.gcm`. Usar solo carpetas finalizadas.

Probar restauración en una base y bucket aislados. Desactivar envíos, aplicar las migraciones, verificar el manifiesto antes de cargar los objetos y restaurar con `pg_restore` en una transacción. Hacerlo en el orden de claves referenciadas o usar un rol de restauración autorizado con triggers temporalmente desactivados. Invalidar sesiones restauradas antes de habilitar el acceso. Revisar metadatos, tamaños, hashes y acceso al documento vigente.

Si se necesita revertir una publicación, recuperar los builds anteriores compatibles conservando la información capturada. Deshabilitar envíos externos mientras se verifica un incidente que afecte Gmail. Corregir hacia delante con migraciones aditivas. Meta inicial de recuperación, 24 horas de pérdida máxima y 4 horas para restaurar.

La apertura del piloto requiere catálogos oficiales, bases numéricas, OAuth, Gmail y destino de respaldo confirmados.
