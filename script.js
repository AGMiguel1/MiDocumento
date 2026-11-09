
const API_URL = "https://script.google.com/macros/s/AKfycbxtqoVlGPXG3CK3FsjnzqgD4UmIJy2Jq7sDMNkBNffM30pcoS2Tev6S1Zz1h_em6k9H/exec";

let documentos = [];
let token = sessionStorage.getItem("docuSesion") || "";
let usuario = null;
let contador = 0;

const $ = id => document.getElementById(id);
const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

// ===== CONSULTAR API =====

function consultarAPI(accion, extras = {}) {
    return new Promise((resolve, reject) => {
        const callback = "docu_" + Date.now() + "_" + (++contador);
        const script = document.createElement("script");

        const timer = setTimeout(
            () => terminar(new Error("Tiempo de espera agotado")),
            15000
        );

        function terminar(error, resultado) {
            clearTimeout(timer);
            script.remove();

            window[callback] = () => {};

            setTimeout(() => delete window[callback], 60000);

            if (error) reject(error);
            else resolve(resultado);
        }

        window[callback] = resultado => {
            if (resultado.estado === "error") {
                terminar(new Error(resultado.mensaje));
            } else {
                terminar(null, resultado);
            }
        };

        script.onerror = () => {
            terminar(new Error("No se pudo conectar con Apps Script"));
        };

        const query = new URLSearchParams({
            accion,
            callback,
            ...extras
        });

        script.src = API_URL + "?" + query;
        document.body.appendChild(script);
    });
}

// ===== ENVIAR DATOS =====

async function enviarAPI(accion, datos = {}) {
    const solicitud = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        n => n.toString(16).padStart(2, "0")
    ).join("");

    const limite = Date.now() + 90000;

    await fetch(API_URL, {
        method: "POST",
        mode: "no-cors",
        headers: {
            "Content-Type": "text/plain"
        },
        body: JSON.stringify({
            ...datos,
            accion,
            solicitud,
            token
        })
    });

    while (Date.now() < limite) {
        const resultado = await consultarAPI("resultado", {
            solicitud
        });

        if (resultado.estado === "ok") {
            return resultado.datos;
        }

        if (resultado.estado === "error") {
            throw new Error(resultado.mensaje);
        }

        await esperar(1500);
    }

    throw new Error(
        "No se pudo confirmar el resultado. Revisa la hoja antes de volver a registrar."
    );
}

// ===== CONVERTIR IMAGEN A BASE64 =====

function convertirImagenBase64(archivo) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();

        lector.onload = () => {
            const resultado = lector.result;
            resolve(resultado.split(",")[1]);
        };

        lector.onerror = () => {
            reject(new Error("No se pudo leer la imagen"));
        };

        lector.readAsDataURL(archivo);
    });
}

// ===== VALIDAR IMAGEN =====

function validarImagen(archivo) {
    if (!archivo) return true;

    const formatosPermitidos = [
        "image/jpeg",
        "image/png"
    ];

    if (!formatosPermitidos.includes(archivo.type)) {
        throw new Error("Solo se permiten imágenes JPG y PNG");
    }

    if (archivo.size > 5 * 1024 * 1024) {
        throw new Error("La imagen no puede superar los 5 MB");
    }

    return true;
}

// ===== VISTA PREVIA DE IMAGEN =====

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

        } catch (error) {
            imagen.value = "";

            $("mensajeRegistro").textContent = error.message;
        }
    });
}

// ===== LIMPIAR VISTA PREVIA =====

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

    $("nombreSesion").textContent = perfil
        ? perfil.Nombre + " (" + perfil.IDUsuario + ")"
        : "";

    $("nombreSolicitante").value = perfil
        ? perfil.Nombre
        : "";

    ["camposReporte", "camposReclamo"].forEach(id => {
        $(id).disabled = !perfil;
    });

    document.querySelectorAll(".avisoSesion").forEach(el => {
        el.hidden = Boolean(perfil);
    });
}

// ===== DASHBOARD =====

async function cargarDashboard() {
    const { datos } = await consultarAPI("dashboard");

    const campos = {
        totalDocumentos: "documentosEncontrados",
        totalReclamados: "documentosReclamados",
        totalPendientes: "reclamosPendientes",
        totalZonas: "zonasRegistradas"
    };

    Object.entries(campos).forEach(([id, campo]) => {
        $(id).textContent = datos[campo];
    });
}

// ===== CARGAR ZONAS =====

async function cargarZonas() {
    const { datos } = await consultarAPI("zonas");

    $("buscarZona").replaceChildren(
        new Option("Todas las zonas", "")
    );

    $("zonaReporte").replaceChildren(
        new Option("Seleccionar zona", "")
    );

    datos.forEach(z => {
        if (!z.Zona) return;

        ["buscarZona", "zonaReporte"].forEach(id => {
            $(id).add(new Option(z.Zona, z.Zona));
        });
    });
}

// ===== DISPONIBILIDAD =====

function disponible(doc) {
    return ["disponible", "encontrado"].includes(
        String(doc.Estado || "").trim().toLowerCase()
    );
}

// ===== MOSTRAR DOCUMENTOS =====

function mostrarDocumentos(lista) {
    $("tablaDocumentos").replaceChildren();

    $("mensajeDocumentos").textContent = lista.length
        ? ""
        : "No se encontraron documentos";

    lista.forEach(doc => {
        const fila = document.createElement("tr");

        [
            "IDDocumento",
            "TipoDocumento",
            "NombreVisible",
            "NumeroDocumento",
            "Zona",
            "Estado"
        ].forEach(campo => {
            const celda = document.createElement("td");

            celda.textContent = doc[campo] || "";

            fila.append(celda);
        });

        $("tablaDocumentos").append(fila);
    });
}

// ===== CARGAR DOCUMENTOS =====

async function cargarDocumentos() {
    const { datos } = await consultarAPI("documentos");

    documentos = datos;

    mostrarDocumentos(documentos);

    const disponibles = documentos.filter(disponible);

    $("documentoReclamo").replaceChildren(
        new Option(
            disponibles.length
                ? "Seleccionar documento"
                : "No hay documentos disponibles",
            ""
        )
    );

    disponibles.forEach(doc => {
        $("documentoReclamo").add(
            new Option(
                [
                    doc.IDDocumento,
                    doc.TipoDocumento,
                    doc.NombreVisible,
                    doc.Zona
                ].filter(Boolean).join(" - "),
                doc.IDDocumento
            )
        );
    });
}

// ===== CONECTAR FORMULARIOS =====

function conectarFormulario(id, mensajeId, trabajo) {
    const form = $(id);

    let ocupado = false;

    form.addEventListener("submit", async evento => {
        evento.preventDefault();

        if (ocupado || !form.reportValidity()) return;

        ocupado = true;

        const boton = form.querySelector(
            'button[type="submit"]'
        );

        boton.disabled = true;

        $(mensajeId).textContent = "Procesando...";

        try {
            await trabajo(form);

        } catch (error) {
            $(mensajeId).textContent = error.message;

        } finally {
            ocupado = false;
            boton.disabled = false;
        }
    });
}

// ===== ACTUALIZAR INFORMACIÓN =====

async function actualizarDatos() {
    const resultados = await Promise.allSettled([
        cargarDashboard(),
        cargarZonas(),
        cargarDocumentos()
    ]);

    const fallos = resultados.filter(
        r => r.status === "rejected"
    );

    $("estadoCarga").textContent = fallos.length
        ? "No se pudo actualizar parte de los datos: " +
          fallos.map(r => r.reason.message).join(". ")
        : "";
}

// ===== INICIO DEL SISTEMA =====

document.addEventListener("DOMContentLoaded", async () => {

    // Configurar fotografías
    configurarImagen();

    // Mostrar sesión
    mostrarSesion(null, token);

    // ===== VALIDAR CONTRASEÑAS =====

    const validar = () => {
        $("confirmarClave").setCustomValidity(
            $("claveUsuario").value ===
            $("confirmarClave").value
                ? ""
                : "Las contraseñas no coinciden"
        );
    };

    $("claveUsuario").addEventListener("input", validar);

    $("confirmarClave").addEventListener("input", validar);

    // ===== CREAR USUARIO =====

    conectarFormulario(
        "formCrearUsuario",
        "mensajeUsuario",
        async form => {

            validar();

            if (!form.reportValidity()) return;

            const datos = Object.fromEntries(
                new FormData(form)
            );

            delete datos.confirmacion;

            const resultado = await enviarAPI(
                "agregarUsuario",
                datos
            );

            form.reset();

            $("confirmarClave").setCustomValidity("");

            mostrarSesion(
                resultado.usuario,
                resultado.token
            );

            $("estadoSesion").textContent =
                "Cuenta creada e inicio de sesión confirmado";
        }
    );

    // ===== INICIAR SESIÓN =====

    conectarFormulario(
        "formIniciarSesion",
        "mensajeLogin",
        async form => {

            const resultado = await enviarAPI(
                "iniciarSesion",
                Object.fromEntries(new FormData(form))
            );

            form.reset();

            mostrarSesion(
                resultado.usuario,
                resultado.token
            );

            $("estadoSesion").textContent = "Sesión iniciada";
        }
    );

    // ===== CERRAR SESIÓN =====

    $("cerrarSesion").addEventListener("click", async () => {

        $("cerrarSesion").disabled = true;

        try {
            await enviarAPI("cerrarSesion");

            mostrarSesion(null, "");

            $("mensajeLogin").textContent = "Sesión cerrada";

        } catch (error) {
            $("estadoSesion").textContent = error.message;

        } finally {
            $("cerrarSesion").disabled = false;
        }
    });

    // ===== REPORTAR DOCUMENTO CON IMAGEN =====

    conectarFormulario(
        "formReportar",
        "mensajeRegistro",
        async form => {

            const archivo = $("imagenDocumento").files[0];

            // Validar fotografía
            validarImagen(archivo);

            // Obtener campos del formulario
            const datos = Object.fromEntries(
                new FormData(form)
            );

            // Convertir fotografía
            if (archivo) {
                datos.imagenBase64 =
                    await convertirImagenBase64(archivo);

                datos.imagenTipo = archivo.type;

                datos.imagenNombre = archivo.name;
            }

            // Enviar al servidor
            const resultado = await enviarAPI(
                "agregarDocumento",
                datos
            );

            // Limpiar formulario
            form.reset();

            limpiarVistaPrevia();

            // Mostrar confirmación
            $("mensajeRegistro").textContent =
                "Documento guardado correctamente: " +
                resultado.IDDocumento;

            // Actualizar información
            await actualizarDatos();
        }
    );

    // ===== RECLAMAR DOCUMENTO =====

    conectarFormulario(
        "formReclamo",
        "mensajeReclamo",
        async form => {

            const resultado = await enviarAPI(
                "agregarReclamo",
                Object.fromEntries(new FormData(form))
            );

            form.reset();

            $("nombreSolicitante").value =
                usuario.Nombre;

            $("mensajeReclamo").textContent =
                "Reclamo guardado: " +
                resultado.IDReclamo +
                ". Estado: Pendiente";

            await actualizarDatos();
        }
    );

    // ===== ACTUALIZAR RECLAMOS =====

    $("actualizarReclamos").addEventListener(
        "click",
        async () => {

            $("actualizarReclamos").disabled = true;

            try {
                await cargarDocumentos();

            } catch (error) {
                $("mensajeReclamo").textContent =
                    error.message;

            } finally {
                $("actualizarReclamos").disabled = false;
            }
        }
    );

    // ===== BUSCAR DOCUMENTOS =====

    $("formBuscar").addEventListener(
        "submit",
        evento => {

            evento.preventDefault();

            const nombre = $("buscarNombre")
                .value.trim().toLowerCase();

            const numero = $("buscarNumero")
                .value.trim();

            const zona = $("buscarZona").value;

            mostrarDocumentos(
                documentos.filter(d =>
                    String(d.NombreVisible || "")
                        .toLowerCase()
                        .includes(nombre)

                    && String(d.NumeroDocumento || "")
                        .includes(numero)

                    && (!zona || d.Zona === zona)
                )
            );
        }
    );

    // ===== RECUPERAR SESIÓN =====

    if (token) {
        try {
            const resultado = await enviarAPI("miSesion");

            mostrarSesion(
                resultado.usuario,
                token
            );

        } catch (error) {
            mostrarSesion(null, "");

            $("mensajeLogin").textContent =
                error.message;
        }
    }

    // ===== CARGAR DATOS INICIALES =====

    await actualizarDatos();
});
