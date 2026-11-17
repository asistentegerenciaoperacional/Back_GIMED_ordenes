# Cargar archivos directamente a Storage

El back reserva espacio y autoriza una clave inmutable en un bucket privado. La carga directa permite reanudar archivos grandes. Postgres conserva el documento vigente después de confirmar el objeto. El reemplazo retira el objeto anterior y la limpieza libera su espacio de forma diferida.
