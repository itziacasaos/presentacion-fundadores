# Publicar la presentación en internet (GitHub + Vercel)

Esta carpeta ya está lista para publicarse tal cual: es un sitio 100% estático
(HTML + imágenes), no necesita servidor ni build.

## Contenido
- `index.html` — la presentación completa
- `p.png`, `logo2.png`, `logoperfil.png`, `meta1.png`…`meta6.png` — las imágenes reales

## Paso 1 — Subir a GitHub

1. Entra a https://github.com/new y crea un repositorio (por ejemplo `presentacion-propiedades`). Puede ser público o privado.
2. En tu computadora, dentro de esta carpeta, ejecuta:
   ```bash
   git init
   git add .
   git commit -m "Presentación ejecutiva Propiedades.com"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/presentacion-propiedades.git
   git push -u origin main
   ```
   (Reemplaza `TU_USUARIO` y el nombre del repo por los tuyos. GitHub te muestra estos mismos comandos exactos al crear el repo vacío.)

## Paso 2 — Conectar con Vercel

1. Entra a https://vercel.com/new
2. Elige "Import Git Repository" y selecciona el repositorio que acabas de crear.
3. Vercel detecta que es un sitio estático — no cambies ninguna configuración de build (déjalo en blanco / "Other").
4. Dale a **Deploy**.
5. En 30-60 segundos tendrás una URL pública tipo `https://presentacion-propiedades.vercel.app` que puedes compartir con quien quieras.

Cada vez que hagas `git push` a `main`, Vercel vuelve a publicar la versión más reciente automáticamente.

## Paso 3 — Conectar Supabase (datos en vivo)

Ya implementé la conexión: `index.html` intenta leer los datos desde una tabla
de Supabase al cargar, y si no puede (porque aún no configuraste las
credenciales, no hay internet, o la tabla está vacía) usa automáticamente los
datos de respaldo que ya vienen incrustados — **la página nunca se rompe**.

1. Entra a https://supabase.com/dashboard y crea un proyecto (o usa uno que ya tengas).
2. Ve a **SQL Editor** → pega el contenido de `supabase_schema_and_seed.sql` (está en esta misma carpeta) → **Run**.
   Esto crea la tabla `dashboard_data`, activa Row Level Security con lectura
   pública (solo lectura, nadie puede escribir con la clave pública), y
   siembra los 4 registros que la presentación necesita: `hist`, `meta`,
   `promos` y `excel_map`.
3. Ve a **Project Settings → API** y copia:
   - **Project URL** (algo como `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public key**
4. Abre `index.html` y busca estas dos líneas cerca del inicio del `<script>` final:
   ```js
   var SUPABASE_URL = 'TU_SUPABASE_URL';
   var SUPABASE_ANON_KEY = 'TU_SUPABASE_ANON_KEY';
   ```
   Reemplázalas con tus valores reales.
5. Guarda, haz `git add . && git commit -m "Conectar Supabase" && git push`.
   Vercel vuelve a publicar solo en unos segundos.

**A partir de ahí:** para actualizar los datos que ve todo el mundo, solo
entras a Supabase → Table Editor → `dashboard_data`, editas el JSON de la
columna `payload` de la fila que quieras (`meta` para los datos de Meta Ads,
`hist` para el histórico, `promos` para las promociones de renovación) y
guardas. No necesitas volver a tocar el código ni a hacer `git push`.
