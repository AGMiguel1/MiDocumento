
const API_URL = "https://script.google.com/macros/s/AKfycbwqdVaM53oENQCFxGgYeJ1mnza2JU5qcY5BUVfQ3Ykp7gtcoTgcrjukLg9t8at_SFsr/exec";

let documentos = [];
let contador = 0;

// CONSULTAR APPS SCRIPT
function consultarAPI(accion) {
    return new Promise((resolve, reject) => {
        const callback = "respuesta_" + (++contador);
        const script = document.createElement("script");

        const timeout = setTimeout(() => {
            limpiar();
            reject(new Error("Tiempo de espera agotado"));
        }, 15000);

        function limpiar() {
            clearTimeout(timeout);
            script.remove();
            delete window[callback];
        }

        window[callback] = function(respuesta) {
            limpiar();

            if (respuesta.estado === "ok") {
                resolve(respuesta.datos);
            } else {
                reject(new Error(respuesta.mensaje));
            }
        };

        script.onerror = function() {
            limpiar();
            reject(new Error("Error de conexión"));
        };

        script.src = API_URL
            + "?accion=" + encodeURIComponent(accion)
            + "&callback=" + callback;

        document.body.appendChild(script);
    });
}

// CARGAR DASHBOARD
async function cargarDashboard() {
    const datos = await consultarAPI("dashboard");

    document.getElementById("totalDocumentos").textContent =
        datos.documentosEncontrados;

    document.getElementById("totalReclamados").textContent =
        datos.documentosReclamados;

    document.getElementById("totalPendientes").textContent =
        datos.reclamosPendientes;

    document.getElementById("totalZonas").textContent =
        datos.zonasRegistradas;
}

// CARGAR ZONAS
async function cargarZonas() {
    const zonas = await consultarAPI("zonas");

    const buscar = document.getElementById("buscarZona");
    const reportar = document.getElementById("zonaReporte");

    zonas.forEach(zona => {
        [buscar, reportar].forEach(select => {
            const opcion = document.createElement("option");

            opcion.value = zona.Zona;
            opcion.textContent = zona.Zona;

            select.appendChild(opcion);
        });
    });
}

// MOSTRAR DOCUMENTOS
function mostrarDocumentos(lista) {
    const tabla = document.getElementById("tablaDocumentos");
    const mensaje = document.getElementById("mensajeDocumentos");

    tabla.innerHTML = "";

    mensaje.textContent = lista.length === 0
        ? "No se encontraron documentos."
        : "";

    lista.forEach(documento => {
        const fila = document.createElement("tr");

        const campos = [
            "IDDocumento",
            "TipoDocumento",
            "NombreVisible",
            "NumeroDocumento",
            "Zona",
            "Estado"
        ];

        campos.forEach(campo => {
            const celda = document.createElement("td");

            celda.textContent = documento[campo] || "";

            fila.appendChild(celda);
        });

        tabla.appendChild(fila);
    });
}

// CARGAR DOCUMENTOS
async function cargarDocumentos() {
    documentos = await consultarAPI("documentos");

    mostrarDocumentos(documentos);
}

// BUSCAR DOCUMENTOS
function buscarDocumentos(evento) {
    evento.preventDefault();

    const nombre = document.getElementById("buscarNombre")
        .value.toLowerCase().trim();

    const numero = document.getElementById("buscarNumero")
        .value.trim();

    const zona = document.getElementById("buscarZona").value;

    const resultados = documentos.filter(documento => {
        const coincideNombre =
            String(documento.NombreVisible || "")
                .toLowerCase().includes(nombre);

        const coincideNumero =
            String(documento.NumeroDocumento || "")
                .includes(numero);

        const coincideZona =
            zona === "" || documento.Zona === zona;

        return coincideNombre && coincideNumero && coincideZona;
    });

    mostrarDocumentos(resultados);
}

// REGISTRAR DOCUMENTO DE PRUEBA
async function registrarDocumento(evento) {
    evento.preventDefault();

    const formulario = evento.target;
    const mensaje = document.getElementById("mensajeRegistro");
    const boton = formulario.querySelector("button[type=submit]");

    const datos = Object.fromEntries(
        new FormData(formulario).entries()
    );

    datos.accion = "agregarDocumento";

    boton.disabled = true;
    mensaje.textContent = "Enviando solicitud...";

    try {
        await fetch(API_URL, {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "text/plain"
            },
            body: JSON.stringify(datos)
        });

        mensaje.textContent =
            "Solicitud enviada. Revisa Google Sheets para confirmar.";

        formulario.reset();

    } catch (error) {
        mensaje.textContent =
            "Error al enviar: " + error.message;

    } finally {
        boton.disabled = false;
    }
}

// INICIAR LA PAGINA
async function iniciar() {
    document.getElementById("formBuscar")
        .addEventListener("submit", buscarDocumentos);

    document.getElementById("formReportar")
        .addEventListener("submit", registrarDocumento);

    try {
        await Promise.all([
            cargarDashboard(),
            cargarZonas(),
            cargarDocumentos()
        ]);

        console.log("Conexión con Google Sheets correcta");

    } catch (error) {
        console.error(error);

        document.getElementById("mensajeDocumentos")
            .textContent = "Error: " + error.message;
    }
}

document.addEventListener("DOMContentLoaded", iniciar);
