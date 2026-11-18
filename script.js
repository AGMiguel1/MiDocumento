"use strict";

/* ==========================================================
   MiDocumento — lógica del cliente (v3)
   HTML + CSS + JS puros · Google Apps Script + Sheets + Drive
   ========================================================== */

const API_URL = "https://script.google.com/macros/s/AKfycbxvT-mSdTl24ilD1YPin8sjTZdVE-CtPEoIIOI9fxMUefarkHtCpM8kALASugYGMnIW/exec";

const CLAVE_SESION = "midocumento_sesion";
const MAX_FOTO_MB = 5;
const LADO_MAX_FOTO = 1400;

const $ = id => document.getElementById(id);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let documentos = [];
let resultados = null;
let token = sessionStorage.getItem(CLAVE_SESION) || "";
let usuario = null;
let fotoLista = null;
let tipoBusqueda = "";
let ordenBusqueda = 0;

/* ---------- Utilidades ---------- */
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sinAcentos = v => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const norm = v => sinAcentos(v).trim().toLowerCase();
const icono = (n, c = "") => `<svg class="ico ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtFecha(valor) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ""));
    return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : "";
}
function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- Validaciones (las mismas reglas se repiten en el servidor) ---------- */
const FECHA_MIN_NAC = "1900-01-01";
const FECHA_MIN_HALLAZGO = "2000-01-01";
const EDAD_MAX = 110;
const RE_NOMBRE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.\- ]*$/;

function edadEn(nac, ref) {
    const [y, m, d] = nac.split("-").map(Number), [Y, M, D] = ref.split("-").map(Number);
    let e = Y - y;
    if (M < m || (M === m && D < d)) e--;
    return e;
}
function errorNombre(v) {
    v = String(v || "").trim().replace(/\s+/g, " ");
    if (!v) return "Escribe el nombre completo.";
    if (!RE_NOMBRE.test(v)) return "Usa solo letras, espacios, apóstrofes, puntos o guiones.";
    if (v.split(" ").length < 2) return "Escribe nombres y apellidos (al menos dos palabras).";
    if (v.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "").length < 4) return "El nombre es demasiado corto.";
    return "";
}
function errorNumero(v, clave) {
    const n = String(v || "").toUpperCase().replace(/[\s.\-]/g, "");
    if (clave === "cedula") return /^\d{5,10}$/.test(n) ? "" : "La cédula debe tener entre 5 y 10 dígitos, sin complemento.";
    return /^[0-9A-Z]{5,15}$/.test(n) ? "" : "Debe tener entre 5 y 15 caracteres (letras y números).";
}
function errorNacimiento(v) {
    if (!v) return "Indica la fecha de nacimiento.";
    if (v > hoyISO()) return "La fecha de nacimiento no puede ser posterior a hoy.";
    if (v < FECHA_MIN_NAC || edadEn(v, hoyISO()) > EDAD_MAX) return "La fecha de nacimiento no es válida.";
    return "";
}
function errorHallazgo(h, nac, clave) {
    if (!h) return "Indica la fecha del hallazgo.";
    if (h > hoyISO()) return "La fecha del hallazgo no puede ser futura.";
    if (h < FECHA_MIN_HALLAZGO) return "La fecha del hallazgo es demasiado antigua.";
    if (nac && h < nac) return "El hallazgo no puede ser anterior al nacimiento del titular.";
    if (nac && clave === "licencia" && edadEn(nac, h) < 16) return "Una licencia de conducir exige un titular de 16 años o más.";
    return "";
}
// Aplica el mensaje solo si el campo tiene contenido (el atributo required cubre el vacío)
function fijarError(el, msg) { el.setCustomValidity(el.value && msg ? msg : ""); }

/* ---------- Catálogo de documentos ---------- */
const DEPARTAMENTOS = ["La Paz", "Cochabamba", "Santa Cruz", "Oruro", "Potosí", "Chuquisaca", "Tarija", "Beni", "Pando"];
const SIGLAS = { "La Paz": "LP", "Cochabamba": "CB", "Santa Cruz": "SC", "Oruro": "OR", "Potosí": "PT", "Chuquisaca": "CH", "Tarija": "TJ", "Beni": "BN", "Pando": "PD" };

// Debe coincidir con DETALLES en Code.gs
const TIPOS = {
    cedula: {
        valor: "Cédula de identidad", corto: "Cédula", icono: "id", numero: "Número de cédula", ejemplo: "1234567",
        extras: [{ k: "Expedido", label: "Expedida en", opts: DEPARTAMENTOS.map(d => [d, d]), req: true, publico: "departamento de expedición" }]
    },
    extranjero: {
        valor: "Cédula de extranjero", corto: "Extranjero", icono: "globe", numero: "Número de cédula de extranjero", ejemplo: "1234567",
        extras: [{ k: "Nacionalidad", label: "Nacionalidad", texto: true, req: true, publico: "nacionalidad" }]
    },
    licencia: {
        valor: "Licencia de conducir", corto: "Licencia", icono: "car", numero: "Número de licencia", ejemplo: "4567890",
        extras: [{ k: "Categoria", label: "Categoría", opts: [["M", "M · Motociclista"], ["P", "P · Particular"], ["A", "A · Profesional A"], ["B", "B · Profesional B"], ["C", "C · Profesional C"]], req: true, publico: "categoría" }]
    },
    pasaporte: {
        valor: "Pasaporte", corto: "Pasaporte", icono: "book", numero: "Número de pasaporte", ejemplo: "9012345",
        extras: [{ k: "Pais", label: "País emisor", texto: true, req: true, def: "Bolivia", publico: "país emisor" }]
    },
    libreta: {
        valor: "Libreta de servicio militar", corto: "Libreta militar", icono: "star", numero: "Número de libreta", ejemplo: "045123",
        extras: [{ k: "Clase", label: "Tipo de libreta", opts: ["Servicio militar", "Premilitar", "Auxiliar", "Inhábil", "Redención"].map(o => [o, o]), req: true, publico: "tipo de libreta" }]
    },
    universitario: {
        valor: "Carnet universitario", corto: "Universitario", icono: "cap", numero: "Número de registro o matrícula", ejemplo: "2021145879",
        extras: [{ k: "Institucion", label: "Universidad o instituto", texto: true, req: true, publico: "institución" }]
    },
    otro: {
        valor: "Otro", corto: "Otro", icono: "file", numero: "Número del documento", ejemplo: "123456",
        extras: [{ k: "Nombre", label: "¿Qué documento es?", texto: true, req: true, publico: "nombre del documento" }]
    }
};

function claveTipo(t) {
    const n = norm(t);
    if (n.includes("extranjer")) return "extranjero";
    if (n.includes("cedula")) return "cedula";
    if (n.includes("licencia")) return "licencia";
    if (n.includes("pasaporte")) return "pasaporte";
    if (n.includes("libreta") || n.includes("militar")) return "libreta";
    if (n.includes("universit")) return "universitario";
    return "otro";
}

// Debe coincidir con el servidor (Code.gs)
function enmascararNombre(nombre) {
    const p = String(nombre || "").trim().split(/\s+/).filter(Boolean);
    if (!p.length) return "";
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    if (p.length === 1) return cap(p[0]).slice(0, 2) + "•••";
    return cap(p[0]) + " " + p.slice(1).map(s => s.charAt(0).toUpperCase() + ".").join(" ");
}

function setMensaje(id, texto, tipo = "") {
    const el = $(id);
    if (!el) return;
    el.textContent = texto || "";
    if (tipo) el.dataset.estado = tipo; else delete el.dataset.estado;
}

function toast(texto, tipo = "ok") {
    const el = document.createElement("div");
    el.className = "toast " + tipo;
    el.innerHTML = icono(tipo === "error" ? "alert" : "check") + `<span>${esc(texto)}</span>`;
    $("toasts").appendChild(el);
    setTimeout(() => {
        el.classList.add("sale");
        el.addEventListener("animationend", () => el.remove(), { once: true });
    }, 4200);
}

/* ---------- API ---------- */
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
            respuesta = await fetch(API_URL + "?" + new URLSearchParams({ accion, ...extras }).toString());
        }
    } catch (e) {
        throw new Error("No se pudo conectar con el servidor. Revisa tu conexión o la URL del Apps Script.");
    }
    const texto = await respuesta.text();
    let json;
    try { json = JSON.parse(texto); } catch (e) {
        throw new Error("El servidor no devolvió datos. Publica el Apps Script como aplicación web con acceso para «Cualquier persona».");
    }
    if (json.estado !== "ok") throw new Error(json.mensaje || "Error en el servidor");
    return json.datos;
}

/* ==========================================================
   DOCUMENTOS: render de cada tipo como el documento real
   ========================================================== */
const SILUETA = `<svg class="sil" aria-hidden="true"><use href="#i-person"/></svg>`;
const mk = w => `<i class="mk" style="--w:${w}cqw"></i>`;
const campo = (etq, valor, cls = "") => `<div class="d-f ${cls}"><small>${etq}</small><b>${valor}</b></div>`;
const fotoBloqueada = () => `<div class="d-foto">${SILUETA}<span class="lock">${icono("lock")}</span></div>`;

function partesNombre(visible) {
    const p = String(visible || "").trim().split(/\s+/).filter(Boolean);
    return { nombres: p[0] || "", apellidos: p.slice(1).join(" ") };
}

function codigoPais(pais) {
    const n = norm(pais);
    if (!n || n === "bolivia" || n.startsWith("boliv")) return "BOL";
    return sinAcentos(pais).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "<");
}

function docHTML(d, clase = "") {
    const k = claveTipo(d.TipoDocumento);
    const det = d.Detalles || {};
    const hecho = norm(d.Estado) === "reclamado";
    const { nombres, apellidos } = partesNombre(d.NombreVisible);
    const vN = nombres ? esc(nombres) : mk(22);
    const vA = apellidos ? esc(apellidos) : mk(22);
    const ult = String(d.Ultimos4 || "").replace(/\D/g, "").slice(-4);
    const num = ult ? "••••" + esc(ult) : "•••••••";
    const base = `doc doc-${{ cedula: "ci", extranjero: "ex", licencia: "lic", pasaporte: "pas", libreta: "sm", universitario: "uni", otro: "ot" }[k]}${hecho ? " is-done" : ""} ${clase}`;
    const sello = hecho ? '<span class="d-stamp">Entregado</span>' : "";
    const bandera = '<i class="d-flag"></i>';
    let cuerpo = "";

    switch (k) {
        case "cedula": {
            const sigla = SIGLAS[det.Expedido] || "";
            cuerpo = `
            <span class="ci-serie">${sigla ? "EXP. " + sigla : "0000001"}</span>
            <div class="ci-head">${bandera}<div><b>ESTADO PLURINACIONAL DE BOLIVIA</b><span>SERVICIO GENERAL DE IDENTIFICACIÓN PERSONAL</span></div></div>
            <div class="ci-titulo"><b>CÉDULA DE<br>IDENTIDAD</b><strong>N° ${num}</strong></div>
            ${fotoBloqueada()}
            <div class="ci-datos">
                <div class="d-row">${campo("Serie:", mk(10))}${campo("Sección:", mk(10))}</div>
                ${campo("Nombres:", vN)}${campo("Apellidos:", vA)}${campo("Fecha de nacimiento:", mk(20))}
                <div class="d-row">${campo("Fecha de emisión:", mk(14))}${campo("Fecha de expiración:", mk(14))}</div>
            </div>
            <span class="ci-firma">FIRMA DEL TITULAR</span>
            <svg class="ci-sello" viewBox="0 0 48 48" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="24" cy="24" r="22" stroke-width="1.4"/><circle cx="24" cy="24" r="16" stroke-width="1" stroke-dasharray="1.5 1.5"/><circle cx="24" cy="24" r="9" stroke-width="1.2"/><path d="M24 15v18M15 24h18M18 18l12 12M30 18 18 30" stroke-width=".8"/></svg>
            <svg class="ci-mapa" aria-hidden="true"><use href="#i-bolivia"/></svg>`;
            break;
        }
        case "extranjero":
            cuerpo = `
            <div class="ex-banda">${bandera}<div><b>ESTADO PLURINACIONAL DE BOLIVIA</b><span>CÉDULA DE IDENTIDAD DE EXTRANJERO</span></div></div>
            ${fotoBloqueada()}
            <div class="ex-datos">${campo("Nombres", vN)}${campo("Apellidos", vA)}${campo("Nacionalidad", det.Nacionalidad ? esc(det.Nacionalidad) : mk(18))}${campo("Fecha de nacimiento", mk(18))}</div>
            <svg class="ico ex-mundo" aria-hidden="true"><use href="#i-globe"/></svg><i class="ex-holo"></i>
            <span class="ex-num">N° ${num}</span>`;
            break;
        case "licencia":
            cuerpo = `
            <div class="lc-banda">${bandera}<div><b>ESTADO PLURINACIONAL DE BOLIVIA</b><span>LICENCIA PARA CONDUCIR</span></div></div>
            ${fotoBloqueada()}
            <div class="lc-datos">${campo("Nombres", vN)}${campo("Apellidos", vA)}${campo("Fecha de nacimiento", mk(18))}</div>
            <span class="lc-num">N° ${num}</span>
            <div class="lc-cat"><small>CAT.</small><b>${esc(det.Categoria || "–")}</b></div>
            <svg class="ico lc-auto" aria-hidden="true"><use href="#i-car"/></svg><i class="lc-barras"></i>`;
            break;
        case "pasaporte": {
            const pais = det.Pais || "Bolivia", cod = codigoPais(pais);
            const apMRZ = sinAcentos(apellidos).toUpperCase().replace(/[^A-Z]/g, "") || "";
            const noMRZ = sinAcentos(nombres).toUpperCase().replace(/[^A-Z]/g, "") || "";
            const l1 = ("P<" + cod + apMRZ + "<<" + noMRZ).padEnd(36, "<").slice(0, 36);
            const l2 = ("<".repeat(28) + (ult || "••••") + "<<<<").slice(-36);
            cuerpo = `
            <div class="ps-cab"><b>PASAPORTE</b><span>PASSPORT · ${esc(cod)}</span></div>
            ${fotoBloqueada()}
            <div class="ps-datos">
                ${campo("Tipo / Type", "P")}${campo("N.º de pasaporte", num)}
                ${campo("Apellidos y nombres", d.NombreVisible ? esc(d.NombreVisible) : mk(26), "ancho")}
                ${campo("Nacionalidad", esc(pais))}${campo("Fecha de nacimiento", mk(16))}
                ${campo("Lugar de nacimiento", mk(16))}${campo("Fecha de expiración", mk(16))}
            </div>
            <div class="ps-mrz">${esc(l1)}<br>${esc(l2)}</div>`;
            break;
        }
        case "libreta":
            cuerpo = `
            <div class="sm-cab"><span class="sm-escudo">${icono("star")}</span><div><small>MINISTERIO DE DEFENSA</small><b>LIBRETA DE SERVICIO MILITAR</b></div></div>
            <span class="sm-tipo">${esc(det.Clase || "Servicio militar")}</span>
            ${fotoBloqueada()}
            <div class="sm-datos">${campo("Nombres", vN)}${campo("Apellidos", vA)}${campo("N.º de libreta", num)}</div>
            <i class="sm-cinta"></i>`;
            break;
        case "universitario":
            cuerpo = `
            <div class="un-banda"><b>${esc(det.Institucion || "Universidad")}</b><span>CARNET UNIVERSITARIO</span></div>
            ${fotoBloqueada()}
            <div class="un-datos">${campo("Nombres", vN)}${campo("Apellidos", vA)}${campo("Registro", num)}</div>
            <i class="un-barras"></i><i class="un-acento"></i>`;
            break;
        default:
            cuerpo = `
            <div class="ot-cab">${bandera}<div><small>DOCUMENTO</small><b>${esc(det.Nombre || "Documento")}</b></div></div>
            ${fotoBloqueada()}
            <div class="ot-datos">${campo("Nombres", vN)}${campo("Apellidos", vA)}${campo("N.º", num)}</div>`;
    }
    return `<div class="${base}" data-tilt>${cuerpo}${sello}</div>`;
}

/* ---------- Hero ---------- */
function pintarHero() {
    $("heroStack").innerHTML =
        docHTML({ TipoDocumento: TIPOS.cedula.valor, Estado: "Disponible", Detalles: { Expedido: "Cochabamba" } }, "stack-1") +
        docHTML({ TipoDocumento: TIPOS.licencia.valor, Estado: "Disponible", Detalles: { Categoria: "B" } }, "stack-2") +
        docHTML({ TipoDocumento: TIPOS.pasaporte.valor, Estado: "Disponible", Detalles: { Pais: "Bolivia" } }, "stack-3");
}

/* ---------- Lista de documentos ---------- */
function esDisponible(d) { return ["disponible", "encontrado"].includes(norm(d.Estado)); }

function pintarEsqueleto() {
    $("gridDocumentos").innerHTML = Array.from({ length: 6 }, () => '<li class="skel" aria-hidden="true"></li>').join("");
    $("mensajeDocumentos").hidden = true;
}

function mostrarDocumentos(lista, filtrado = false) {
    $("gridDocumentos").innerHTML = lista.map((d, i) => `
        <li class="dcard rv" style="--d:${Math.min(i, 8) * 0.05}s">
            ${docHTML(d)}
            <div class="dcard-info"><span>${icono("pin")}${esc(d.Zona)}</span><span>${icono("cal")}${esc(fmtFecha(d.FechaHallazgo))}</span></div>
            <div class="dcard-pie">
                ${esDisponible(d) ? '<span class="etq-estado"><i></i>Disponible</span>' : '<span class="etq-estado hecho"><i></i>Entregado</span>'}
                <span class="dcard-id">${esc(d.IDDocumento)}</span>
                ${esDisponible(d) ? `<button type="button" class="btn btn-dark" data-reclamar="${esc(d.IDDocumento)}">Es mío ${icono("arrow")}</button>` : ""}
            </div>
        </li>`).join("");

    const vacio = $("mensajeDocumentos");
    vacio.hidden = lista.length > 0;
    vacio.textContent = filtrado
        ? "Ninguna coincidencia. Prueba con menos filtros o revisa la ortografía."
        : "Todavía no hay documentos registrados.";
    $("tituloDocumentos").textContent = filtrado ? "Coincidencias" : "Todos los hallazgos";
    $("resumenResultados").textContent = `${lista.length} ${filtrado ? (lista.length === 1 ? "coincidencia" : "coincidencias") : (lista.length === 1 ? "documento" : "documentos")}`;
    observarReveal($("gridDocumentos"));
}

/* ---------- Carga de datos ---------- */
function contador(el, destino) {
    destino = Number(destino) || 0;
    el.dataset.target = destino;
    if (sinMovimiento || !el.dataset.visto) { el.textContent = destino; return; }
    const inicio = Number(el.textContent) || 0, t0 = performance.now(), dur = 1200;
    const paso = t => {
        const p = Math.min(1, (t - t0) / dur), e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        el.textContent = Math.round(inicio + (destino - inicio) * e);
        if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
}

async function cargarDashboard() {
    const d = await llamarAPI("dashboard");
    const mapa = { totalDocumentos: d.documentosEncontrados, totalDisponibles: d.documentosDisponibles, totalReclamados: d.documentosReclamados, totalZonas: d.zonasRegistradas };
    Object.entries(mapa).forEach(([id, v]) => contador($(id), v ?? 0));
}

async function cargarZonas() {
    const datos = await llamarAPI("zonas");
    const llenar = (sel, primera) => {
        const previo = sel.value;
        sel.replaceChildren(new Option(primera, ""));
        datos.forEach(z => z.Zona && sel.add(new Option(z.Zona, z.Zona)));
        sel.value = previo;
    };
    llenar($("buscarZona"), "Todas las zonas");
    llenar($("zonaReporte"), "Seleccionar zona");
}

function llenarSelectReclamo() {
    const sel = $("documentoReclamo"), previo = sel.value;
    const libres = documentos.filter(esDisponible);
    sel.replaceChildren(new Option(libres.length ? "Seleccionar documento" : "No hay documentos disponibles", ""));
    libres.forEach(d => {
        const etq = [d.IDDocumento, TIPOS[claveTipo(d.TipoDocumento)].corto, d.NombreVisible, d.Zona].filter(Boolean).join(" · ");
        sel.add(new Option(etq, d.IDDocumento));
    });
    if (libres.some(d => d.IDDocumento === previo)) sel.value = previo;
    resumenReclamo();
}

async function cargarDocumentos() {
    const datos = await llamarAPI("documentos");
    documentos = Array.isArray(datos) ? datos : [];
    if (!resultados) mostrarDocumentos(documentos, false);
    llenarSelectReclamo();
}

async function actualizarDatos() {
    const estado = $("estadoCarga");
    estado.hidden = true;
    if (!documentos.length) pintarEsqueleto();
    const res = await Promise.allSettled([cargarDashboard(), cargarZonas(), cargarDocumentos()]);
    const fallo = res.find(r => r.status === "rejected");
    if (fallo) {
        estado.hidden = false;
        estado.dataset.estado = "error";
        estado.textContent = fallo.reason.message;
        if (!documentos.length) $("gridDocumentos").innerHTML = "";
    }
}

/* ---------- Sesión ---------- */
function iniciales(nombre) {
    const p = String(nombre || "").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
}

function mostrarSesion(perfil, nuevoToken) {
    usuario = perfil;
    token = perfil ? (nuevoToken || token) : "";
    if (token) sessionStorage.setItem(CLAVE_SESION, token); else sessionStorage.removeItem(CLAVE_SESION);

    $("sesionActual").hidden = !perfil;
    $("btnIngresar").hidden = Boolean(perfil);
    $("nombreSesion").textContent = perfil ? perfil.Nombre : "";
    $("avatarSesion").textContent = perfil ? iniciales(perfil.Nombre) : "";
    ["camposReporte", "camposReclamo"].forEach(id => { $(id).disabled = !perfil; });
    $$(".avisoSesion").forEach(el => { el.hidden = Boolean(perfil); });

    if (perfil) cargarVerificados(); else {
        $("listaVerificados").hidden = true;
        $("misVerificados").innerHTML = "";
    }
}

async function cargarVerificados() {
    try {
        const lista = await llamarAPI("misVerificados", {}, true);
        $("listaVerificados").hidden = !lista.length;
        $("misVerificados").innerHTML = lista.map(d => `
            <li>
                <span>${esc(d.NombreVisible)} <small>${esc(d.IDDocumento)} · ${esc(TIPOS[claveTipo(d.TipoDocumento)].corto)}</small></span>
                <button type="button" class="btn btn-ghost btn-sm" data-entrega="${esc(d.IDDocumento)}">Ver entrega</button>
            </li>`).join("");
    } catch (e) { /* opcional */ }
}

/* ---------- Diálogos ---------- */
function abrirAuth(tab = "login") {
    cambiarTab(tab);
    const dlg = $("dialogoAuth");
    if (!dlg.open) dlg.showModal();
    posicionarIndicador();
    setTimeout(() => $(tab === "login" ? "correoLogin" : "nombreUsuario").focus(), 60);
}

function cambiarTab(tab) {
    $$("#dialogoAuth .tab").forEach(b => {
        const activa = b.dataset.tab === tab;
        b.setAttribute("aria-selected", activa);
        b.tabIndex = activa ? 0 : -1;
    });
    $("panelLogin").hidden = tab !== "login";
    $("panelRegistro").hidden = tab !== "registro";
    posicionarIndicador();
}

function posicionarIndicador() {
    const act = document.querySelector("#dialogoAuth .tab[aria-selected='true']");
    const ind = document.querySelector("#dialogoAuth .tab-ind");
    if (!act || !ind) return;
    ind.style.width = act.offsetWidth + "px";
    ind.style.transform = `translateX(${act.offsetLeft - 4}px)`;
}

function configurarDialogos() {
    $$("[data-auth]").forEach(b => b.addEventListener("click", () => abrirAuth(b.dataset.auth)));
    $$("#dialogoAuth [data-tab]").forEach(b => b.addEventListener("click", () => cambiarTab(b.dataset.tab)));
    $$("dialog [data-cerrar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
    $$("dialog").forEach(dlg => dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }));
    window.addEventListener("resize", posicionarIndicador);
}

/* ---------- Formularios ---------- */
function conectarFormulario(id, mensajeId, trabajo, ganchos = {}) {
    const form = $(id);
    let ocupado = false;
    form.addEventListener("submit", async e => {
        e.preventDefault();
        if (ocupado) return;
        if (ganchos.antes) ganchos.antes(form);
        if (!form.reportValidity()) return;
        if (ganchos.despues && !ganchos.despues(form)) return;
        ocupado = true;
        const boton = form.querySelector('button[type="submit"]');
        if (boton) { boton.disabled = true; boton.classList.add("cargando"); }
        setMensaje(mensajeId, "Procesando…", "carga");
        try { await trabajo(form); } catch (err) { setMensaje(mensajeId, err.message, "error"); }
        finally { ocupado = false; if (boton) { boton.disabled = false; boton.classList.remove("cargando"); } }
    });
}

function evaluarClave(v) {
    let n = 0;
    if (v.length >= 12) n++;
    if (v.length >= 16) n++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v)) n++;
    if (/\d/.test(v)) n++;
    if (/[^A-Za-z0-9]/.test(v)) n++;
    return Math.min(n, 5);
}

function configurarAuth() {
    const validarClave = () => $("confirmarClave").setCustomValidity($("claveUsuario").value === $("confirmarClave").value ? "" : "Las contraseñas no coinciden");
    $("claveUsuario").addEventListener("input", () => {
        validarClave();
        const f = evaluarClave($("claveUsuario").value), barra = $("fuerzaBarra");
        barra.style.transform = `scaleX(${f / 5})`;
        barra.style.background = f <= 2 ? "var(--bad)" : f <= 3 ? "#D99A1E" : "var(--ok)";
    });
    $("confirmarClave").addEventListener("input", validarClave);

    conectarFormulario("formCrearUsuario", "mensajeUsuario", async form => {
        validarClave();
        if (!form.reportValidity()) return;
        const datos = Object.fromEntries(new FormData(form));
        delete datos.confirmacion;
        const res = await llamarAPI("agregarUsuario", datos, true);
        form.reset();
        $("fuerzaBarra").style.transform = "scaleX(0)";
        mostrarSesion(res.usuario, res.token);
        setMensaje("mensajeUsuario", "");
        $("dialogoAuth").close();
        $("estadoSesion").textContent = "Cuenta creada e inicio de sesión confirmado";
        toast("Cuenta creada. ¡Bienvenido a MiDocumento!");
    });

    conectarFormulario("formIniciarSesion", "mensajeLogin", async form => {
        const res = await llamarAPI("iniciarSesion", Object.fromEntries(new FormData(form)), true);
        form.reset();
        mostrarSesion(res.usuario, res.token);
        setMensaje("mensajeLogin", "");
        $("dialogoAuth").close();
        $("estadoSesion").textContent = "Sesión iniciada";
        toast(`Hola, ${res.usuario.Nombre.split(" ")[0]}.`);
    });

    $("cerrarSesion").addEventListener("click", async () => {
        const t = token;
        mostrarSesion(null, "");
        toast("Sesión cerrada.");
        try { await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ accion: "cerrarSesion", token: t }) }); } catch (e) { /* sin red */ }
    });
}

/* ---------- Fotografía ---------- */
function cargarImagen(archivo) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(archivo), img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen. Prueba con otra foto.")); };
        img.src = url;
    });
}

async function procesarFoto(archivo) {
    if (!["image/jpeg", "image/png"].includes(archivo.type)) throw new Error("Solo se permiten imágenes JPG y PNG.");
    if (archivo.size > MAX_FOTO_MB * 1024 * 1024) throw new Error(`La imagen no puede superar los ${MAX_FOTO_MB} MB.`);
    const img = await cargarImagen(archivo);
    const escala = Math.min(1, LADO_MAX_FOTO / Math.max(img.naturalWidth, img.naturalHeight));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(img.naturalWidth * escala);
    lienzo.height = Math.round(img.naturalHeight * escala);
    const ctx = lienzo.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    ctx.drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const dataUrl = lienzo.toDataURL("image/jpeg", 0.82), base64 = dataUrl.split(",")[1];
    return { base64, dataUrl, kb: Math.round(base64.length * 0.75 / 1024) };
}

function limpiarFoto() {
    fotoLista = null;
    $("imagenDocumento").value = "";
    $("vistaPreviaImagen").removeAttribute("src");
    $("vistaPreviaImagen").hidden = true;
    $("dzPrev").hidden = true;
    $("dzVacio").hidden = false;
}

async function elegirFoto(archivo) {
    if (!archivo) return;
    setMensaje("mensajeRegistro", "");
    try {
        fotoLista = await procesarFoto(archivo);
        $("vistaPreviaImagen").src = fotoLista.dataUrl;
        $("vistaPreviaImagen").hidden = false;
        $("infoImagen").textContent = `Foto lista · ${fotoLista.kb} KB optimizada`;
        $("dzVacio").hidden = true;
        $("dzPrev").hidden = false;
        $("errorFoto").hidden = true;
        $("dropzone").classList.remove("invalida");
    } catch (err) {
        limpiarFoto();
        setMensaje("mensajeRegistro", err.message, "error");
    }
}

function configurarFoto() {
    const input = $("imagenDocumento"), zona = $("dropzone");
    input.addEventListener("change", () => elegirFoto(input.files[0]));
    $("quitarImagen").addEventListener("click", e => { e.preventDefault(); limpiarFoto(); });
    ["dragenter", "dragover"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("arrastra"); }));
    ["dragleave", "drop"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("arrastra"); }));
    zona.addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) elegirFoto(f); });
}

/* ---------- Reportar ---------- */
function tipoSeleccionado() {
    const v = $("formReportar").elements.TipoDocumento.value;
    return v ? claveTipo(v) : "";
}

function detallesDelFormulario() {
    const det = {};
    $$("#camposExtra [name^='det_']").forEach(el => { if (el.value.trim()) det[el.name.slice(4)] = el.value.trim(); });
    return det;
}

function pintarTipos() {
    $("tiposReporte").innerHTML = Object.entries(TIPOS).map(([k, t]) =>
        `<label class="tile">${icono(t.icono)}<span>${esc(t.corto)}</span><input type="radio" name="TipoDocumento" value="${esc(t.valor)}" required></label>`).join("");
}

function pintarExtras() {
    const k = tipoSeleccionado(), t = TIPOS[k];
    $("etqNumero").textContent = t ? t.numero : "Número del documento";
    $("numeroCompleto").placeholder = t ? "Ej. " + t.ejemplo : "";
    $("ayudaNumero").textContent = (k === "cedula" ? "Solo el número, sin complemento. " : "") + "Se guarda cifrado; solo se muestran los últimos 4 dígitos.";
    $("camposExtra").innerHTML = t ? t.extras.map(x => x.opts
        ? `<div class="campo"><label for="det_${x.k}">${esc(x.label)}</label><select id="det_${x.k}" name="det_${x.k}" ${x.req ? "required" : ""}><option value="">Seleccionar</option>${x.opts.map(o => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join("")}</select></div>`
        : `<div class="campo"><label for="det_${x.k}">${esc(x.label)}</label><input type="text" id="det_${x.k}" name="det_${x.k}" maxlength="60" value="${esc(x.def || "")}" ${x.req ? "required" : ""}></div>`).join("") : "";
}

function pintarVistaPrevia() {
    const f = $("formReportar"), k = tipoSeleccionado() || "cedula";
    $("vistaTarjeta").innerHTML = docHTML({
        TipoDocumento: TIPOS[k].valor,
        NombreVisible: enmascararNombre(f.elements.NombreCompleto.value),
        Ultimos4: String(f.elements.NumeroCompleto.value).replace(/[\s.\-]/g, "").slice(-4),
        Estado: "Disponible", Detalles: detallesDelFormulario()
    });
}

function validarReporte() {
    const f = $("formReportar"), k = tipoSeleccionado();
    const nac = f.elements.FechaNacimiento, hal = f.elements.FechaHallazgo;
    fijarError(f.elements.NombreCompleto, errorNombre(f.elements.NombreCompleto.value));
    fijarError(f.elements.NumeroCompleto, errorNumero(f.elements.NumeroCompleto.value, k));
    fijarError(nac, errorNacimiento(nac.value));
    // el hallazgo nunca puede ser anterior al nacimiento del titular
    hal.min = nac.value && !errorNacimiento(nac.value) && nac.value > FECHA_MIN_HALLAZGO ? nac.value : FECHA_MIN_HALLAZGO;
    fijarError(hal, errorHallazgo(hal.value, errorNacimiento(nac.value) ? "" : nac.value, k));
}

function configurarReporte() {
    const f = $("formReportar");
    pintarTipos();
    f.elements.FechaHallazgo.max = hoyISO();
    f.elements.FechaNacimiento.max = hoyISO();
    f.addEventListener("change", e => { if (e.target.name === "TipoDocumento") pintarExtras(); validarReporte(); pintarVistaPrevia(); });
    f.addEventListener("input", () => { validarReporte(); pintarVistaPrevia(); });
    pintarVistaPrevia();

    conectarFormulario("formReportar", "mensajeRegistro", async form => {
        const datos = Object.fromEntries(new FormData(form));
        const detalles = {};
        Object.keys(datos).forEach(k => { if (k.startsWith("det_")) { detalles[k.slice(4)] = datos[k]; delete datos[k]; } });
        datos.Detalles = detalles;
        datos.imagenBase64 = fotoLista.base64;
        datos.imagenTipo = "image/jpeg";
        const res = await llamarAPI("agregarDocumento", datos, true);
        form.reset();
        limpiarFoto();
        pintarExtras();
        validarReporte();
        pintarVistaPrevia();
        setMensaje("mensajeRegistro", `Documento registrado correctamente (${res.IDDocumento}). Gracias por ayudar a devolverlo.`, "ok");
        toast("Documento registrado. ¡Gracias!");
        await actualizarDatos();
    }, {
        antes: validarReporte,
        despues: () => {
            // la fotografía del documento es obligatoria
            const hay = Boolean(fotoLista);
            $("errorFoto").hidden = hay;
            $("dropzone").classList.toggle("invalida", !hay);
            if (!hay) {
                $("dropzone").scrollIntoView({ block: "center", behavior: sinMovimiento ? "auto" : "smooth" });
                $("imagenDocumento").focus({ preventScroll: true });
            }
            return hay;
        }
    });
}

/* ---------- Buscador ---------- */
function pintarChips() {
    const items = [["", "Todos", "search"], ...Object.values(TIPOS).map(t => [t.valor, t.corto, t.icono])];
    $("chipsTipo").innerHTML = items.map(([v, etq, ic]) =>
        `<button type="button" class="chip-tipo" data-tipo="${esc(v)}" aria-pressed="${v === tipoBusqueda}">${icono(ic)}${esc(etq)}</button>`).join("");
}

async function buscarAhora(explicito = false) {
    const nombre = $("buscarNombre").value.trim();
    const ultimos = $("buscarNumero").value.replace(/\D/g, "");
    const zona = $("buscarZona").value;
    if (!nombre && !ultimos && !zona && !tipoBusqueda) { limpiarResultados(); return; }
    if (ultimos && ultimos.length !== 4) {
        if (explicito) toast("Escribe exactamente los 4 últimos dígitos.", "error");
        return;
    }
    const mio = ++ordenBusqueda;
    const boton = $("btnBuscar");
    boton.classList.add("cargando");
    pintarEsqueleto();
    if (explicito) $("documentos").scrollIntoView({ behavior: sinMovimiento ? "auto" : "smooth" });
    try {
        const r = await llamarAPI("buscar", { nombre, ultimos, zona, tipo: tipoBusqueda });
        if (mio !== ordenBusqueda) return;
        resultados = r;
        $("estadoCarga").hidden = true;
        mostrarDocumentos(resultados, true);
    } catch (err) {
        if (mio !== ordenBusqueda) return;
        resultados = null;
        $("gridDocumentos").innerHTML = "";
        $("estadoCarga").hidden = false;
        $("estadoCarga").dataset.estado = "error";
        $("estadoCarga").textContent = err.message;
    } finally {
        if (mio === ordenBusqueda) boton.classList.remove("cargando");
    }
}

function limpiarResultados() {
    ++ordenBusqueda;
    resultados = null;
    $("estadoCarga").hidden = true;
    $("btnBuscar").classList.remove("cargando");
    mostrarDocumentos(documentos, false);
}

function configurarBusqueda() {
    pintarChips();
    const enVivo = debounce(() => buscarAhora(false), 450);
    $("formBuscar").addEventListener("submit", e => { e.preventDefault(); buscarAhora(true); });
    ["buscarNombre", "buscarNumero"].forEach(id => $(id).addEventListener("input", enVivo));
    $("buscarZona").addEventListener("change", () => buscarAhora(false));
    $("buscarNumero").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });
    $("chipsTipo").addEventListener("click", e => {
        const b = e.target.closest(".chip-tipo");
        if (!b) return;
        tipoBusqueda = b.dataset.tipo;
        pintarChips();
        buscarAhora(false);
    });
    $("limpiarBusqueda").addEventListener("click", () => {
        $("formBuscar").reset();
        tipoBusqueda = "";
        pintarChips();
        limpiarResultados();
    });
}

/* ---------- Reclamar ---------- */
function resumenReclamo() {
    const id = $("documentoReclamo").value;
    const d = documentos.find(x => x.IDDocumento === id);
    $("etqNumeroVer").textContent = d ? TIPOS[claveTipo(d.TipoDocumento)].numero + " completo" : "Número completo del documento";
    $("resumenReclamo").innerHTML = d
        ? docHTML(d) + `<p class="ayuda">Código ${esc(d.IDDocumento)} · hallado en ${esc(d.Zona)}</p>`
        : `<div class="vacio-reclamo">${icono("id", "ico-lg")}<p>Elige un documento para ver su tarjeta.</p></div>`;
}

function seleccionarReclamo(id) {
    $("documentoReclamo").value = id;
    resumenReclamo();
    $("reclamos").scrollIntoView({ behavior: sinMovimiento ? "auto" : "smooth" });
    setTimeout(() => { if (!$("camposReclamo").disabled) $("numeroVerificacion").focus({ preventScroll: true }); }, 600);
    if (!usuario) toast("Inicia sesión para reclamar este documento.", "error");
}

function enlaceWhatsApp(tel) {
    let d = String(tel || "").replace(/\D/g, "");
    if (d.length === 8) d = "591" + d;
    return d.length >= 8 ? `https://wa.me/${d}` : "";
}

function mostrarEntrega(p) {
    const d = p.documento || {}, c = p.contacto || {}, wa = enlaceWhatsApp(c.Telefono);
    $("contenidoEntrega").innerHTML = `
    <div class="entrega">
        <div class="entrega-cab">
            <span class="sello-ok">${icono("check")}</span>
            <div><h2 id="tituloEntrega">Titularidad verificada</h2><p>Los datos coinciden. Ya puedes coordinar la entrega.</p></div>
        </div>
        <div class="entrega-foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="Fotografía del documento encontrado">` : '<p class="sin-foto">Quien lo encontró no adjuntó fotografía.</p>'}</div>
        <dl class="entrega-datos">
            <div><dt>Documento</dt><dd>${esc(TIPOS[claveTipo(d.TipoDocumento)].valor)} · ${esc(d.IDDocumento)}</dd></div>
            <div><dt>Hallado el</dt><dd>${esc(fmtFecha(d.FechaHallazgo))}</dd></div>
            <div class="ancho"><dt>Lugar</dt><dd>${esc(d.LugarHallazgo || d.Zona)} · ${esc(d.Zona)}</dd></div>
            ${d.Descripcion ? `<div class="ancho"><dt>Nota de quien lo encontró</dt><dd>${esc(d.Descripcion)}</dd></div>` : ""}
        </dl>
        <div class="contacto">
            <h3>Quien lo encontró: ${esc(c.Nombre || "")}</h3>
            <p class="tel">${esc(c.Telefono || "Sin teléfono")}</p>
            ${wa ? `<div><a class="btn btn-solid btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">${icono("phone")}Escribir por WhatsApp</a></div>` : ""}
            <small>Coordina la entrega en un lugar público y lleva otra identificación de respaldo.</small>
        </div>
    </div>`;
    const dlg = $("dialogoEntrega");
    if (!dlg.open) dlg.showModal();
}

function validarReclamo() {
    const f = $("formReclamo");
    const d = documentos.find(x => x.IDDocumento === f.elements.IDDocumento.value);
    fijarError(f.elements.NombreCompleto, errorNombre(f.elements.NombreCompleto.value));
    fijarError(f.elements.NumeroCompleto, errorNumero(f.elements.NumeroCompleto.value, d ? claveTipo(d.TipoDocumento) : ""));
    fijarError(f.elements.FechaNacimiento, errorNacimiento(f.elements.FechaNacimiento.value));
}

function configurarReclamo() {
    const f = $("formReclamo");
    f.elements.FechaNacimiento.max = hoyISO();
    $("documentoReclamo").addEventListener("change", () => { resumenReclamo(); validarReclamo(); });
    f.addEventListener("input", validarReclamo);
    $("actualizarReclamos").addEventListener("click", async () => {
        const b = $("actualizarReclamos");
        b.disabled = true;
        try { await cargarDocumentos(); toast("Lista actualizada."); } catch (err) { setMensaje("mensajeReclamo", err.message, "error"); } finally { b.disabled = false; }
    });

    conectarFormulario("formReclamo", "mensajeReclamo", async form => {
        const res = await llamarAPI("verificarReclamo", Object.fromEntries(new FormData(form)), true);
        if (res.verificado) {
            form.reset();
            setMensaje("mensajeReclamo", `Verificación exitosa. El documento ${res.paquete.documento.IDDocumento} quedó marcado como entregado.`, "ok");
            mostrarEntrega(res.paquete);
            await actualizarDatos();
            cargarVerificados();
        } else {
            setMensaje("mensajeReclamo", res.restantes > 0
                ? `Los datos no coinciden con el documento. Te quedan ${res.restantes} ${res.restantes === 1 ? "intento" : "intentos"}.`
                : "Los datos no coinciden y agotaste tus intentos para este documento.", "error");
        }
    }, { antes: validarReclamo });
}

/* ---------- Guía ---------- */
function pintarTablaGuia() {
    $("tablaTipos").innerHTML = Object.values(TIPOS).map(t => `
        <tr>
            <td>${icono(t.icono)}${esc(t.valor)}</td>
            <td data-etq="Se solicita">${esc(t.numero)}${t.extras.map(x => ", " + esc(x.label.toLowerCase().replace(/^¿|\?$/g, ""))).join("")}</td>
            <td data-etq="Se muestra públicamente">Nombre abreviado, últimos 4 dígitos, zona${t.extras.map(x => ", " + esc(x.publico)).join("")}</td>
        </tr>`).join("");
}

function configurarGuia() {
    pintarTablaGuia();
    const tabs = $$(".g-tab");
    const activar = tab => {
        tabs.forEach(t => {
            const on = t === tab;
            t.setAttribute("aria-selected", on);
            t.tabIndex = on ? 0 : -1;
            $(t.getAttribute("aria-controls")).hidden = !on;
        });
        tab.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
    };
    tabs.forEach((t, i) => {
        t.addEventListener("click", () => activar(t));
        t.addEventListener("keydown", e => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            const sig = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
            activar(sig); sig.focus();
        });
    });
}

/* ---------- Vistas (aplicación / guía) ---------- */
function aplicarVista() {
    const esGuia = location.hash.startsWith("#guia");
    document.body.dataset.vista = esGuia ? "guia" : "app";
    $("vistaApp").hidden = esGuia;
    $("vistaGuia").hidden = !esGuia;
    $("enlaceGuia").classList.toggle("activo", esGuia);
    $("menu").classList.remove("abierto");
    $("btnMenu").setAttribute("aria-expanded", "false");
    return esGuia;
}

function configurarVistas() {
    aplicarVista();
    window.addEventListener("hashchange", () => {
        const esGuia = aplicarVista();
        if (esGuia) { window.scrollTo(0, 0); return; }
        const id = location.hash.slice(1), destino = id && document.getElementById(id);
        if (destino) destino.scrollIntoView({ behavior: "auto" }); else window.scrollTo(0, 0);
    });
}

/* ---------- Eventos globales ---------- */
function configurarDelegados() {
    document.addEventListener("click", async e => {
        const rec = e.target.closest("[data-reclamar]");
        if (rec) { seleccionarReclamo(rec.dataset.reclamar); return; }
        const ent = e.target.closest("[data-entrega]");
        if (ent) {
            ent.disabled = true;
            try { mostrarEntrega(await llamarAPI("entrega", { IDDocumento: ent.dataset.entrega }, true)); }
            catch (err) { toast(err.message, "error"); }
            finally { ent.disabled = false; }
        }
    });
}

/* ---------- Animaciones y scroll ---------- */
let observadorReveal = null;
function observarReveal(raiz = document) {
    const nodos = $$(".rv:not(.in)", raiz);
    if (!("IntersectionObserver" in window) || sinMovimiento) { nodos.forEach(n => n.classList.add("in")); return; }
    if (!observadorReveal) {
        observadorReveal = new IntersectionObserver(es => es.forEach(en => {
            if (en.isIntersecting) { en.target.classList.add("in"); observadorReveal.unobserve(en.target); }
        }), { threshold: 0.1, rootMargin: "0px 0px -5% 0px" });
    }
    nodos.forEach(n => observadorReveal.observe(n));
}

function configurarContadores() {
    const nodos = $$(".stat-n");
    if (!("IntersectionObserver" in window) || sinMovimiento) { nodos.forEach(n => { n.dataset.visto = "1"; }); return; }
    const obs = new IntersectionObserver(es => es.forEach(en => {
        if (!en.isIntersecting) return;
        const el = en.target, meta = Number(el.dataset.target) || 0;
        el.dataset.visto = "1";
        el.textContent = "0";
        contador(el, meta);
        obs.unobserve(el);
    }), { threshold: 0.6 });
    nodos.forEach(n => obs.observe(n));
}

function configurarScroll() {
    const barra = $("barraScroll"), top = $("top"), hero = $("inicio");
    let pendiente = false;
    const actualizar = () => {
        pendiente = false;
        const y = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight;
        barra.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
        top.classList.toggle("scrolled", y > 12);
        if (!sinMovimiento && !hero.closest("[hidden]")) {
            hero.style.setProperty("--sy", Math.min(1, Math.max(0, y / (hero.offsetHeight || 1))).toFixed(3));
        }
    };
    window.addEventListener("scroll", () => { if (!pendiente) { pendiente = true; requestAnimationFrame(actualizar); } }, { passive: true });
    window.addEventListener("resize", actualizar);
    actualizar();

    const enlaces = $$("#menu a").filter(a => a.id !== "enlaceGuia");
    const secciones = enlaces.map(a => document.querySelector(a.getAttribute("href"))).filter(Boolean);
    if ("IntersectionObserver" in window) {
        const obs = new IntersectionObserver(es => es.forEach(en => {
            if (en.isIntersecting && document.body.dataset.vista === "app") {
                enlaces.forEach(a => a.classList.toggle("activo", a.getAttribute("href") === "#" + en.target.id));
            }
        }), { rootMargin: "-45% 0px -50% 0px" });
        secciones.forEach(s => obs.observe(s));
    }
}

function configurarMenu() {
    const btn = $("btnMenu"), menu = $("menu");
    const cerrar = () => { menu.classList.remove("abierto"); btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", () => btn.setAttribute("aria-expanded", menu.classList.toggle("abierto")));
    menu.addEventListener("click", e => { if (e.target.closest("a")) cerrar(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") cerrar(); });
    document.addEventListener("click", e => { if (!e.target.closest("#menu, #btnMenu")) cerrar(); });
}

function configurarInclinacion() {
    if (sinMovimiento || !window.matchMedia("(hover: hover)").matches) return;
    let actual = null;
    const reset = el => { el.classList.remove("tilting"); el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); };
    document.addEventListener("pointermove", e => {
        const el = e.target.closest ? e.target.closest("[data-tilt]") : null;
        if (actual && actual !== el) { reset(actual); actual = null; }
        if (!el || el.closest(".hero-vis")) return;
        actual = el;
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.classList.add("tilting");
        el.style.setProperty("--ry", ((x - 0.5) * 12).toFixed(2) + "deg");
        el.style.setProperty("--rx", ((0.5 - y) * 10).toFixed(2) + "deg");
        el.style.setProperty("--gx", (x * 100).toFixed(1) + "%");
        el.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
    }, { passive: true });
}

// Si el logo no carga (sin red o bloqueado) se muestra un icono de respaldo
function configurarLogo() {
    $$(".logo-img").forEach(img => {
        const respaldo = () => {
            const s = document.createElement("span");
            s.className = "logo-fallback";
            s.style.width = s.style.height = (img.getAttribute("width") || 40) + "px";
            s.innerHTML = icono("shield");
            img.replaceWith(s);
        };
        if (img.complete && img.naturalWidth === 0) respaldo(); else img.addEventListener("error", respaldo, { once: true });
    });
}

/* ---------- Inicio ---------- */
document.addEventListener("DOMContentLoaded", async () => {
    configurarLogo();
    pintarHero();
    configurarVistas();
    configurarGuia();
    configurarDialogos();
    configurarAuth();
    configurarFoto();
    configurarReporte();
    configurarBusqueda();
    configurarReclamo();
    configurarDelegados();
    configurarMenu();
    configurarScroll();
    configurarInclinacion();
    configurarContadores();
    observarReveal();

    const guardado = token;
    mostrarSesion(null, "");
    resumenReclamo();
    if (guardado) {
        try {
            token = guardado;
            const res = await llamarAPI("miSesion", {}, true);
            mostrarSesion(res.usuario, guardado);
        } catch (e) { mostrarSesion(null, ""); }
    }
    await actualizarDatos();
});
