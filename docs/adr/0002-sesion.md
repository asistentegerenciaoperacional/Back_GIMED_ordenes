# Guardar la sesión en el back

El backend protege los tokens cifrados de Supabase y Gmail, y entrega al navegador un identificador opaco. El proxy de Cloudflare preserva el origen común de aplicación y API. El bloqueo por sesión serializa la rotación del refresh token entre pestañas. La baja revoca el acceso en el servidor.
