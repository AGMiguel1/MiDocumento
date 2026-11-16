# MiDocumento

Sistema web colaborativo para **reportar, buscar y recuperar documentos de identidad extraviados en Cochabamba** (segundo semestre de 2026). Quien encuentra un documento lo registra; quien lo perdió lo busca y, para recuperarlo, debe **demostrar que es el titular**.

> Concepto visual: el papel de un trámite y el sello que lo valida. Fondo papel cálido, tinta verde oscura y un único acento bermellón (el sello). Tipografías Fraunces (títulos) e Instrument Sans (texto).

---

## 1. Archivos

| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de la página (inicio, estadísticas, búsqueda, documentos, reportar, reclamar, seguridad) |
| `style.css` | Sistema de diseño, tarjetas de identidad, animaciones, diseño responsivo |
| `script.js` | Lógica del cliente: sesión, búsqueda, reporte con foto, verificación, animaciones |
| `Code.gs` | Backend en Google Apps Script (Google Sheets como base de datos + Google Drive para fotos) |

Los tres primeros se suben a GitHub Pages; `Code.gs` se pega en el editor de Apps Script.

---

## 2. Cómo funciona (concepto)

1. **Reportar.** Un usuario con sesión registra el documento hallado: tipo, nombre del titular, número completo, fecha de nacimiento del titular, zona, lugar, fecha y fotografía.
2. **Proteger.** El servidor guarda:
   - el **número completo** y la **fecha de nacimiento** únicamente como *hash salado* (no se pueden leer ni recuperar);
   - la **foto** en una carpeta privada de Drive;
   - para mostrar, solo un **nombre abreviado** («María G.») y los **últimos 4 dígitos**.
3. **Buscar.** Cualquiera puede filtrar por nombre, últimos 4 dígitos y zona. Las tarjetas públicas **nunca muestran la foto**: aparece bloqueada.
4. **Verificar y reclamar.** El reclamante (con sesión) escribe el número completo y la fecha de nacimiento del titular. El servidor los cifra con la misma sal y compara.
   - **Coinciden** → el documento pasa a «Reclamado», se revela la fotografía y el contacto de quien lo encontró para coordinar la entrega.
   - **No coinciden** → no se revela nada; tiene **máximo 3 intentos** por documento y luego queda bloqueado.

---

## 3. Cumplimiento del informe

### Objetivo general
Sistema web colaborativo para reporte, búsqueda y recuperación de documentos, con centralización de la información, búsqueda estructurada y manejo seguro de datos personales. → Toda la página.

### Objetivos específicos

| Objetivo | Dónde se cumple |
|---|---|
| Centralizar la información en una plataforma colaborativa | Formulario «Reportar» + hoja `Documentos` + panel de estadísticas y galería de tarjetas |
| Módulo de búsqueda por filtros con coincidencias exactas | Sección «Buscar»: nombre (todas las palabras deben coincidir, sin importar tildes/mayúsculas), últimos 4 dígitos (igualdad exacta) y zona (igualdad exacta). El filtrado se hace en el servidor |
| Protección de datos y verificación de titularidad | Hash salado con secreto del servidor, ocultamiento de datos y foto, verificación por número + fecha de nacimiento, límite de 3 intentos, cuenta obligatoria, registro de cada intento en la hoja `Reclamos` |

### Alcances
- **Solo frontend** con HTML, CSS y JavaScript puros (sin frameworks ni build).
- **Formulario estructurado** para reportar y **motor de búsqueda** por nombre, número y zona.
- **GitHub Pages** para el alojamiento gratuito.
- **Google Sheets como base de datos simulada**, conectada mediante **Apps Script** como backend.

### Límites
- Sin servidor propio ni base de datos relacional: todo es *serverless* (Sheets + Apps Script + GitHub Pages).
- **Sin integración con SEGIP ni biometría.** La seguridad es lógica: ocultar datos sensibles hasta que el reclamante valide información que solo el titular conoce.
- **Solo español** y enfoque en **Cochabamba** (las zonas son de la ciudad y alrededores).

---

## 4. Tecnologías necesarias

Además de lo que ya figuraba en el informe, para que todo funcione se usan **servicios gratuitos de Google** que conviene **agregar al informe**:

| Tecnología | Para qué se usa |
|---|---|
| **Google Drive** (`DriveApp`) | Guardar las fotografías en una carpeta privada (`MiDocumento_Imagenes`). La base de datos solo guarda el ID del archivo |
| **CacheService** de Apps Script | Sesiones de usuario (6 h) y límites de intentos |
| **LockService** de Apps Script | Evita que dos escrituras simultáneas dañen la hoja o repitan IDs |
| **PropertiesService** de Apps Script | Guarda el secreto del servidor («pimienta») para los hashes |
| **Google Fonts** | Tipografías Fraunces e Instrument Sans |
| **Base64** | Las imágenes viajan del navegador al servidor codificadas en Base64 (se redimensionan a 1400 px y se comprimen antes de enviarse) |

---

## 5. Puesta en marcha

### Paso 1 — Google Sheets
1. Crea (o reutiliza) una hoja de cálculo de Google. Copia el ID de la URL (`docs.google.com/spreadsheets/d/`**ESTE_ES_EL_ID**`/edit`).
2. No necesitas crear pestañas ni encabezados: se crean solos.

### Paso 2 — Apps Script
1. En la hoja: **Extensiones → Apps Script**.
2. Borra el contenido, pega todo `Code.gs` y guarda.
3. Verifica que `SPREADSHEET_ID` (primera línea) sea el de tu hoja.
4. Selecciona la función **`configurarHojas`** y pulsa **Ejecutar**. Acepta los permisos (Hojas de cálculo y Drive).
   - Crea las pestañas `Usuarios`, `Documentos`, `Reclamos`, `Zonas` con sus encabezados, carga las zonas de Cochabamba y crea la carpeta privada en Drive.
5. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
6. Copia la URL que termina en `/exec`.

> Si cambias `Code.gs` después, usa **Implementar → Administrar implementaciones → Editar → Nueva versión**. Así la URL no cambia.

### Paso 3 — Frontend
1. En `script.js`, pega la URL en `API_URL`.
2. Prueba abriendo `index.html` en el navegador (la página funciona desde un archivo local o desde un servidor local).

### Paso 4 — GitHub Pages
1. Crea un repositorio y sube `index.html`, `style.css`, `script.js` y este `README.md`.
2. **Settings → Pages → Deploy from a branch → `main` / root**.
3. Tu sitio quedará en `https://TU-USUARIO.github.io/NOMBRE-REPO/`.

> `Code.gs` **no** se sube al repositorio público si no quieres: no contiene contraseñas, pero sí el ID de tu hoja.

---

## 6. Hojas de la base de datos

| Hoja | Contenido |
|---|---|
| `Usuarios` | ID, nombre, correo, teléfono, sal y hash de contraseña |
| `Documentos` | Datos públicos + datos privados (nombre completo, lugar exacto, contacto del reportante, hashes, ID de la foto en Drive) |
| `Reclamos` | Cada intento de verificación (usuario, documento, resultado, fecha) |
| `Zonas` | Lista de zonas disponibles (puedes agregar más filas) |

**Importante:** la hoja contiene datos privados. Mantenla **sin compartir** (solo el dueño del script) y no la publiques en la web.

Si ya tenías usuarios de la versión anterior, deberán **volver a crear su cuenta** (se cambió el método de cifrado de contraseñas). Los documentos antiguos seguirán apareciendo, pero no podrán reclamarse porque no tienen hashes de verificación; vuelve a registrarlos o borra las filas de prueba.

---

## 7. Seguridad: qué se protege y qué no

**Medidas implementadas**
- Contraseñas y datos de verificación con **hash SHA-256 iterado**, con sal individual y un secreto del servidor (`PIMIENTA`).
- Datos sensibles jamás salen del servidor en las consultas públicas (se comprobó con pruebas automáticas).
- Foto, nombre completo, lugar exacto y contacto solo se entregan tras verificar.
- Máximo 3 intentos por usuario y documento; límites por hora para registro, reportes y verificaciones.
- Un usuario no puede reclamar un documento que él mismo reportó.
- Validación de imágenes por contenido (JPG/PNG reales) y tamaño; escritura en celdas como texto (evita inyección de fórmulas en la hoja).
- Mensajes de error genéricos: el servidor no revela detalles internos.

**Limitaciones asumidas (coherentes con los límites del informe)**
- No hay verificación contra SEGIP ni biometría: alguien que conozca el número **y** la fecha de nacimiento del titular podría reclamar. Por eso se entrega el contacto y se recomienda coordinar en un lugar público con otra identificación de respaldo.
- Apps Script no ofrece `bcrypt`/`argon2`; se usa SHA-256 iterado, suficiente para este alcance académico.
- Las sesiones viven en la caché de Apps Script (máx. 6 horas).

---

## 8. Guía rápida de pruebas

1. Crear dos cuentas (A y B) con correos distintos.
2. Con **A**: reportar un documento con foto → aparece una tarjeta sin foto ni datos completos.
3. Cerrar sesión y buscar por nombre, por los últimos 4 dígitos y por zona → debe encontrarlo.
4. Con **B**: pulsar «Es mío», escribir datos **incorrectos** → «te quedan 2 intentos».
5. Con **B**: escribir los datos **correctos** → aparece el sello de verificación, la foto y el contacto de A.
6. El documento pasa a «Entregado» y el panel de estadísticas se actualiza.
7. Con **A**: intentar reclamar su propio documento → el sistema lo rechaza.

---

## 9. Diseño y animaciones

- Tarjetas de identidad con patrón *guilloché* (como los documentos oficiales), foto desenfocada y candado.
- Inclinación 3D que sigue el puntero, tarjetas del *hero* con parallax según el scroll, barra de progreso, contadores animados, línea de progreso en «Cómo funciona», revelado escalonado, sello animado al verificar.
- Vista previa en vivo de la tarjeta mientras se llena el formulario.
- Respeta `prefers-reduced-motion`, navegación por teclado, etiquetas visibles, contraste AA y diseño responsivo.

---

Desarrollado en Cochabamba, Bolivia · 2026
