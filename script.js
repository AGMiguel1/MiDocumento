
const API_URL = "https://script.google.com/macros/s/AKfycbwqdVaM53oENQCFxGgYeJ1mnza2JU5qcY5BUVfQ3Ykp7gtcoTgcrjukLg9t8at_SFsr/exec";

let documentos = [];
let contador = 0;


// ==========================================
// 1. CONECTAR CON GOOGLE APPS SCRIPT
// ==========================================

function consultarAPI(accion) {

    return new Promise((resolve, reject) => {

        const callback = "respuesta_" + (++contador);
        const script = document.createElement("script");

        let terminado = false;

        const timeout = setTimeout(() => {
            finalizarError(
                new Error("Tiempo de espera agotado")
            );
        }, 15000);

        function limpiar() {
            clearTimeout(timeout);
            script.remove();
            delete window[callback];
        }

        function finalizarError(error) {
            if (terminado) return;

            terminado = true;
            limpiar();
            reject(error);
        }

        window[callback] = function(respuesta) {

            if (terminado) return;

            terminado = true;
            limpiar();

            if (respuesta && respuesta.estado === "ok") {
                resolve(respuesta.datos);
            } else {
                reject(new Error(
                    respuesta?.mensaje || "Respuesta incorrecta"
                ));
            }
        };

        script.onerror = function() {

            console.error(
                "Error al cargar Apps Script:",
                script.src
            );

            finalizarError(new Error(
                "No se pudo conectar con Apps Script. " +
                "Revisa la URL, permisos y versión publicada."
            ));
        };

        script.src = API_URL
            + "?accion=" + encodeURIComponent(accion)
            + "&callback=" + encodeURIComponent(callback);

        document.body.appendChild(script);

    });
}


// ==========================================
// 2. CARGAR DASHBOARD
// ==========================================

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

    console.log("Dashboard cargado correctamente");

}


// ==========================================
// 3. CARGAR ZONAS DESDE GOOGLE SHEETS
// ==========================================

async function cargarZonas() {

    const zonas = await consultarAPI("zonas");

    const buscar = document.getElementById("buscarZona");
    const reportar = document.getElementById("zonaReporte");

    if (!buscar || !reportar) {
        throw new Error(
            "No se encontraron los selectores de zonas en HTML"
        );
    }

    buscar.innerHTML =
        '<option value="">Todas las zonas</option>';

    reportar.innerHTML =
        '<option value="">Seleccionar zona</option>';

    zonas.forEach(zona => {

        if (!zona.Zona) return;

        [buscar, reportar].forEach(select => {

            const opcion = document.createElement("option");

            opcion.value = zona.Zona;
            opcion.textContent = zona.Zona;

            select.appendChild(opcion);

        });

    });

    console.log("Zonas cargadas:", zonas.length);

}


// ==========================================
// 4. MOSTRAR DOCUMENTOS EN LA TABLA
// ==========================================

function mostrarDocumentos(lista) {

    const tabla = document.getElementById("tablaDocumentos");
    const mensaje = document.getElementById("mensajeDocumentos");

    if (!tabla || !mensaje) return;

    tabla.innerHTML = "";

    if (lista.length === 0) {

        mensaje.textContent =
            "No se encontraron documentos.";

        return;
    }

    mensaje.textContent = "";

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


// ==========================================
// 5. CARGAR DOCUMENTOS DE GOOGLE SHEETS
// ==========================================

async function cargarDocumentos() {

    const datos = await consultarAPI("documentos");

    documentos = datos;

    mostrarDocumentos(documentos);

    console.log(
        "Documentos cargados:",
        documentos.length
    );

}


// ==========================================
// 6. BUSCAR DOCUMENTOS
// ==========================================

function buscarDocumentos(evento) {

    evento.preventDefault();

    const nombre = document.getElementById("buscarNombre")
        .value.toLowerCase().trim();

    const numero = document.getElementById("buscarNumero")
        .value.trim();

    const zona = document.getElementById("buscarZona")
        .value;

    const resultados = documentos.filter(documento => {

        const coincideNombre =
            String(documento.NombreVisible || "")
                .toLowerCase()
                .includes(nombre);

        const coincideNumero =
            String(documento.NumeroDocumento || "")
                .includes(numero);

        const coincideZona =
            zona === "" || documento.Zona === zona;

        return coincideNombre &&
               coincideNumero &&
               coincideZona;

    });

    mostrarDocumentos(resultados);

    console.log(
        "Resultados encontrados:",
        resultados.length
    );

}


// ==========================================
// 7. REGISTRAR DOCUMENTO DE PRUEBA
// ==========================================

async function registrarDocumento(evento) {

    evento.preventDefault();

    const formulario = evento.target;

    const mensaje =
        document.getElementById("mensajeRegistro");

    const boton =
        formulario.querySelector('button[type="submit"]');

    const datos = Object.fromEntries(
        new FormData(formulario).entries()
    );

    datos.accion = "agregarDocumento";

    if (!datos.Zona) {

        mensaje.textContent =
            "Debes seleccionar una zona.";

        return;
    }

    boton.disabled = true;

    mensaje.textContent =
        "Enviando documento...";

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
            "Solicitud enviada. Revisa Google Sheets " +
            "para confirmar que se guardó.";

        console.log(
            "Solicitud de registro enviada"
        );

        formulario.reset();

    } catch (error) {

        console.error(
            "Error al enviar documento:",
            error
        );

        mensaje.textContent =
            "Error al enviar: " + error.message;

    } finally {

        boton.disabled = false;

    }

}


// ==========================================
// 8. INICIAR SISTEMA
// ==========================================

async function iniciar() {

    console.log("Iniciando DocuCochabamba...");

    const formBuscar =
        document.getElementById("formBuscar");

    const formReportar =
        document.getElementById("formReportar");

    if (formBuscar) {

        formBuscar.addEventListener(
            "submit",
            buscarDocumentos
        );

    }

    if (formReportar) {

        formReportar.addEventListener(
            "submit",
            registrarDocumento
        );

    }

    // Consultar cada sección de forma independiente

    const resultados = await Promise.allSettled([

        cargarDashboard(),

        cargarZonas(),

        cargarDocumentos()

    ]);

    const nombres = [
        "Dashboard",
        "Zonas",
        "Documentos"
    ];

    resultados.forEach((resultado, indice) => {

        if (resultado.status === "fulfilled") {

            console.log(
                nombres[indice] + " cargado correctamente"
            );

        } else {

            console.error(
                "Error en " + nombres[indice] + ":",
                resultado.reason
            );

        }

    });

    // Mostrar error de documentos

    if (resultados[2].status === "rejected") {

        const mensaje =
            document.getElementById("mensajeDocumentos");

        if (mensaje) {

            mensaje.textContent =
                "Error: " +
                resultados[2].reason.message;

        }

    }

    // Mostrar error de zonas

    if (resultados[1].status === "rejected") {

        const zonaReporte =
            document.getElementById("zonaReporte");

        if (zonaReporte) {

            zonaReporte.innerHTML =
                '<option value="">Error al cargar zonas</option>';

        }

        console.error(
            "No se pudieron cargar las zonas."
        );

    }

}


// ==========================================
// 9. EJECUTAR CUANDO CARGUE EL HTML
// ==========================================

document.addEventListener(
    "DOMContentLoaded",
    iniciar
);
