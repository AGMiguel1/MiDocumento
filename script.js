
const API_URL = "https://script.google.com/macros/s/AKfycbyqsawAdg4B-vBNWdmEB3jWNP_gU70dU7xGQZxA1Kznsi7KCxbOqADGwLP3gK-AqP5z/exec";

let documentos = [];
let token = sessionStorage.getItem("docuSesion") || "";
let usuario = null;

const $ = id => document.getElementById(id);

// ===== LLAMADA UNIVERSAL CON FETCH (Sin bloqueos de AdBlock ni JSONP) =====
async function llamarAPI(accion, extras = {}, usarPost = false) {
  let respuesta;
  try {
    if (usarPost) {
      respuesta = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ accion, token, ...extras })
      });
    } else {
      const query = new URLSearchParams({ accion, ...extras });
      respuesta = await fetch(API_URL + "?" + query.toString());
    }
  } catch (err) {
    throw new Error("Bloqueo de red o URL inválida. Verifica tu URL /exec o desactiva AdBlock.");
  }

  const texto = await respuesta.text();
  let json;
  try {
    json = JSON.parse(texto);
  } catch (err) {
    throw new Error("Apps Script devolvió una pantalla de login en vez de datos. Revisa que el acceso esté en 'Cualquier usuario'.");
  }

  if (json.estado === "error") {
    throw new Error(json.mensaje || "Error en el servidor");
  }

  return json.datos;
}

// ===== IMÁGENES =====
function convertirImagenBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result.split(",")[1]);
    lector.onerror = () => reject(new Error("No se pudo leer la imagen"));
    lector.readAsDataURL(archivo);
  });
}

function validarImagen(archivo) {
  if (!archivo) return true;
  if (!["image/jpeg", "image/png"].includes(archivo.type)) {
    throw new Error("Solo se permiten imágenes JPG y PNG");
  }
  if (archivo.size > 5 * 1024 * 1024) {
    throw new Error("La imagen no puede superar los 5 MB");
  }
  return true;
}

function configurarImagen() {
  const imagen = $("imagenDocumento");
  const vistaPrevia = $("vistaPreviaImagen");
  if (!imagen || !vistaPrevia) return;

  imagen.addEventListener("change", () => {
    limpiarVistaPrevia();
    const archivo = imagen.files[0];
    if (!archivo) return;

    try {
      validarImagen(archivo);
      const url = URL.createObjectURL(archivo);
      vistaPrevia.src = url;
      vistaPrevia.dataset.url = url;
      vistaPrevia.hidden = false;
      $("mensajeRegistro").textContent = "";
    } catch (err) {
      imagen.value = "";
      $("mensajeRegistro").textContent = err.message;
    }
  });
}

function limpiarVistaPrevia() {
  const vistaPrevia = $("vistaPreviaImagen");
  if (!vistaPrevia) return;
  if (vistaPrevia.dataset.url) {
    URL.revokeObjectURL(vistaPrevia.dataset.url);
    delete vistaPrevia.dataset.url;
  }
  vistaPrevia.removeAttribute("src");
  vistaPrevia.hidden = true;
}

// ===== SESIÓN =====
function mostrarSesion(perfil, nuevoToken) {
  usuario = perfil;
  token = nuevoToken || "";

  if (token) {
    sessionStorage.setItem("docuSesion", token);
  } else {
    sessionStorage.removeItem("docuSesion");
  }

  $("sesionActual").hidden = !perfil;
  $("iniciarSesion").hidden = Boolean(perfil);
  $("crearUsuario").hidden = Boolean(perfil);

  $("nombreSesion").textContent = perfil ? `${perfil.Nombre} (${perfil.IDUsuario})` : "";
  $("nombreSolicitante").value = perfil ? perfil.Nombre : "";

  ["camposReporte", "camposReclamo"].forEach(id => {
    if ($(id)) $(id).disabled = !perfil;
  });

  document.querySelectorAll(".avisoSesion").forEach(el => {
    el.hidden = Boolean(perfil);
  });
}

// ===== CARGA DE DATOS =====
async function cargarDashboard() {
  const datos = await llamarAPI("dashboard");
  const mapeo = {
    totalDocumentos: "documentosEncontrados",
    totalReclamados: "documentosReclamados",
    totalPendientes: "reclamosPendientes",
    totalZonas: "zonasRegistradas"
  };
  Object.entries(mapeo).forEach(([id, clave]) => {
    if ($(id)) $(id).textContent = datos[clave] ?? 0;
  });
}

async function cargarZonas() {
  const datos = await llamarAPI("zonas");
  $("buscarZona").replaceChildren(new Option("Todas las zonas", ""));
  $("zonaReporte").replaceChildren(new Option("Seleccionar zona", ""));

  datos.forEach(z => {
    if (!z.Zona) return;
    $("buscarZona").add(new Option(z.Zona, z.Zona));
    $("zonaReporte").add(new Option(z.Zona, z.Zona));
  });
}

function disponible(doc) {
  return ["disponible", "encontrado"].includes(String(doc.Estado || "").trim().toLowerCase());
}

function mostrarDocumentos(lista) {
  const tabla = $("tablaDocumentos");
  tabla.replaceChildren();
  $("mensajeDocumentos").textContent = lista.length ? "" : "No se encontraron documentos";

  const campos = ["IDDocumento", "TipoDocumento", "NombreVisible", "NumeroDocumento", "Zona", "Estado"];
  lista.forEach(doc => {
    const fila = document.createElement("tr");
    campos.forEach(c => {
      const celda = document.createElement("td");
      celda.textContent = doc[c] || "";
      fila.appendChild(celda);
    });
    tabla.appendChild(fila);
  });
}

async function cargarDocumentos() {
  const datos = await llamarAPI("documentos");
  documentos = Array.isArray(datos) ? datos : [];
  mostrarDocumentos(documentos);

  const disponibles = documentos.filter(disponible);
  const select = $("documentoReclamo");
  select.replaceChildren(
    new Option(disponibles.length ? "Seleccionar documento" : "No hay documentos disponibles", "")
  );

  disponibles.forEach(doc => {
    const texto = [doc.IDDocumento, doc.TipoDocumento, doc.NombreVisible, doc.Zona].filter(Boolean).join(" - ");
    select.add(new Option(texto, doc.IDDocumento));
  });
}

async function actualizarDatos() {
  const res = await Promise.allSettled([
    cargarDashboard(),
    cargarZonas(),
    cargarDocumentos()
  ]);

  const fallos = res.filter(r => r.status === "rejected");
  $("estadoCarga").textContent = fallos.length
    ? "Error: " + fallos[0].reason.message
    : "";
}

function conectarFormulario(id, mensajeId, trabajo) {
  const form = $(id);
  if (!form) return;
  let ocupado = false;

  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (ocupado || !form.reportValidity()) return;

    ocupado = true;
    const boton = form.querySelector('button[type="submit"]');
    if (boton) boton.disabled = true;
    $(mensajeId).textContent = "Procesando...";

    try {
      await trabajo(form);
    } catch (err) {
      $(mensajeId).textContent = err.message;
    } finally {
      ocupado = false;
      if (boton) boton.disabled = false;
    }
  });
}

// ===== INICIO =====
document.addEventListener("DOMContentLoaded", async () => {
  configurarImagen();
  mostrarSesion(null, token);

  const validarClave = () => {
    $("confirmarClave").setCustomValidity(
      $("claveUsuario").value === $("confirmarClave").value ? "" : "Las contraseñas no coinciden"
    );
  };
  $("claveUsuario").addEventListener("input", validarClave);
  $("confirmarClave").addEventListener("input", validarClave);

  conectarFormulario("formCrearUsuario", "mensajeUsuario", async form => {
    validarClave();
    if (!form.reportValidity()) return;
    const datos = Object.fromEntries(new FormData(form));
    delete datos.confirmacion;

    const res = await llamarAPI("agregarUsuario", datos, true);
    form.reset();
    $("confirmarClave").setCustomValidity("");
    mostrarSesion(res.usuario, res.token);
    $("estadoSesion").textContent = "Cuenta creada e inicio de sesión confirmado";
  });

  conectarFormulario("formIniciarSesion", "mensajeLogin", async form => {
    const res = await llamarAPI("iniciarSesion", Object.fromEntries(new FormData(form)), true);
    form.reset();
    mostrarSesion(res.usuario, res.token);
    $("estadoSesion").textContent = "Sesión iniciada";
  });

  $("cerrarSesion").addEventListener("click", () => {
    mostrarSesion(null, "");
    $("mensajeLogin").textContent = "Sesión cerrada";
  });

  conectarFormulario("formReportar", "mensajeRegistro", async form => {
    const archivo = $("imagenDocumento").files[0];
    validarImagen(archivo);

    const datos = Object.fromEntries(new FormData(form));
    if (archivo) {
      datos.imagenBase64 = await convertirImagenBase64(archivo);
      datos.imagenTipo = archivo.type;
    }

    const res = await llamarAPI("agregarDocumento", datos, true);
    form.reset();
    limpiarVistaPrevia();
    $("mensajeRegistro").textContent = "Documento guardado correctamente: " + res.IDDocumento;
    await actualizarDatos();
  });

  conectarFormulario("formReclamo", "mensajeReclamo", async form => {
    const res = await llamarAPI("agregarReclamo", Object.fromEntries(new FormData(form)), true);
    form.reset();
    $("nombreSolicitante").value = usuario ? usuario.Nombre : "";
    $("mensajeReclamo").textContent = `Reclamo guardado: ${res.IDReclamo}. Estado: Pendiente`;
    await actualizarDatos();
  });

  $("actualizarReclamos").addEventListener("click", async () => {
    $("actualizarReclamos").disabled = true;
    try {
      await cargarDocumentos();
    } catch (err) {
      $("mensajeReclamo").textContent = err.message;
    } finally {
      $("actualizarReclamos").disabled = false;
    }
  });

  $("formBuscar").addEventListener("submit", e => {
    e.preventDefault();
    const nombre = $("buscarNombre").value.trim().toLowerCase();
    const numero = $("buscarNumero").value.trim();
    const zona = $("buscarZona").value;

    mostrarDocumentos(
      documentos.filter(d =>
        String(d.NombreVisible || "").toLowerCase().includes(nombre) &&
        String(d.NumeroDocumento || "").includes(numero) &&
        (!zona || d.Zona === zona)
      )
    );
  });

  if (token) {
    try {
      const res = await llamarAPI("miSesion", { token }, true);
      mostrarSesion(res.usuario, token);
    } catch (err) {
      mostrarSesion(null, "");
    }
  }

  await actualizarDatos();
});
