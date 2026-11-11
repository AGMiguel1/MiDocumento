// Coloca la URL de tu implementación terminada en /exec
const API_URL = "https://script.google.com/macros/s/AKfycbyqsawAdg4B-vBNWdmEB3jWNP_gU70dU7xGQZxA1Kznsi7KCxbOqADGwLP3gK-AqP5z/exec";

let documentos = [];
let token = sessionStorage.getItem("docuSesion") || "";
let usuario = null;
let contador = 0;

const $ = id => document.getElementById(id);

// ===== CONSULTAR API VIA JSONP =====
function llamarAPI(accion, extras = {}) {
  return new Promise((resolve, reject) => {
    const callback = "cb_" + Date.now() + "_" + (++contador);
    const script = document.createElement("script");

    const timer = setTimeout(() => {
      terminar(new Error("Tiempo de espera agotado al conectar con el servidor"));
    }, 20000);

    function terminar(error, resultado) {
      clearTimeout(timer);
      if (script.parentNode) script.remove();
      window[callback] = () => {};
      setTimeout(() => delete window[callback], 30000);

      if (error) reject(error);
      else resolve(resultado);
    }

    window[callback] = respuesta => {
      if (!respuesta) {
        terminar(new Error("Respuesta vacía del servidor"));
      } else if (respuesta.estado === "error") {
        terminar(new Error(respuesta.mensaje || "Error desconocido en el servidor"));
      } else {
        terminar(null, respuesta.datos);
      }
    };

    script.onerror = () => {
      terminar(new Error("No se pudo conectar con Apps Script. Verifica la URL y los permisos."));
    };

    const query = new URLSearchParams({
      accion,
      callback,
      ...extras
    });

    script.src = API_URL + "?" + query.toString();
    document.body.appendChild(script);
  });
}

// ===== CONVERTIR IMAGEN A BASE64 =====
function convertirImagenBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result.split(",")[1]);
    lector.onerror = () => reject(new Error("No se pudo procesar la fotografía"));
    lector.readAsDataURL(archivo);
  });
}

function validarImagen(archivo) {
  if (!archivo) return true;
  const formatos = ["image/jpeg", "image/png"];
  if (!formatos.includes(archivo.type)) {
    throw new Error("Solo se permiten fotografías en formato JPG o PNG");
  }
  if (archivo.size > 2 * 1024 * 1024) {
    throw new Error("La fotografía no puede exceder los 2 MB");
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
    const el = $(id);
    if (el) el.disabled = !perfil;
  });

  document.querySelectorAll(".avisoSesion").forEach(el => {
    el.hidden = Boolean(perfil);
  });
}

// ===== DASHBOARD Y LISTADOS =====
async function cargarDashboard() {
  const datos = await llamarAPI("dashboard");
  const mapeo = {
    totalDocumentos: "documentosEncontrados",
    totalReclamados: "documentosReclamados",
    totalPendientes: "reclamosPendientes",
    totalZonas: "zonasRegistradas"
  };
  Object.entries(mapeo).forEach(([id, clave]) => {
    if ($(id)) $(id).textContent = datos[clave] !== undefined ? datos[clave] : 0;
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
    ? "Error al actualizar datos: " + fallos.map(f => f.reason.message).join(". ")
    : "";
}

// ===== MANEJADOR DE FORMULARIOS =====
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

  // Validación de clave
  const validarClave = () => {
    $("confirmarClave").setCustomValidity(
      $("claveUsuario").value === $("confirmarClave").value ? "" : "Las contraseñas no coinciden"
    );
  };
  $("claveUsuario").addEventListener("input", validarClave);
  $("confirmarClave").addEventListener("input", validarClave);

  // Registro de usuario
  conectarFormulario("formCrearUsuario", "mensajeUsuario", async form => {
    validarClave();
    if (!form.reportValidity()) return;

    const datos = Object.fromEntries(new FormData(form));
    delete datos.confirmacion;

    const res = await llamarAPI("agregarUsuario", datos);
    form.reset();
    $("confirmarClave").setCustomValidity("");
    mostrarSesion(res.usuario, res.token);
    $("estadoSesion").textContent = "Cuenta registrada con éxito";
  });

  // Login
  conectarFormulario("formIniciarSesion", "mensajeLogin", async form => {
    const res = await llamarAPI("iniciarSesion", Object.fromEntries(new FormData(form)));
    form.reset();
    mostrarSesion(res.usuario, res.token);
    $("estadoSesion").textContent = "Sesión iniciada correctamente";
  });

  // Logout
  $("cerrarSesion").addEventListener("click", () => {
    mostrarSesion(null, "");
    $("mensajeLogin").textContent = "Sesión cerrada";
  });

  // Reportar documento
  conectarFormulario("formReportar", "mensajeRegistro", async form => {
    const archivo = $("imagenDocumento").files[0];
    validarImagen(archivo);

    const datos = Object.fromEntries(new FormData(form));
    if (archivo) {
      datos.imagenBase64 = await convertirImagenBase64(archivo);
      datos.imagenTipo = archivo.type;
    }

    const res = await llamarAPI("agregarDocumento", datos);
    form.reset();
    limpiarVistaPrevia();
    $("mensajeRegistro").textContent = `Documento registrado: ${res.IDDocumento}`;
    await actualizarDatos();
  });

  // Reclamar documento
  conectarFormulario("formReclamo", "mensajeReclamo", async form => {
    const res = await llamarAPI("agregarReclamo", Object.fromEntries(new FormData(form)));
    form.reset();
    $("nombreSolicitante").value = usuario ? usuario.Nombre : "";
    $("mensajeReclamo").textContent = `Reclamo guardado (${res.IDReclamo}) - Estado: Pendiente`;
    await actualizarDatos();
  });

  // Botón recargar reclamos
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

  // Buscador
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

  // Carga inicial
  await actualizarDatos();
});
