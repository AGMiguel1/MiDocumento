"use strict";

/* ==========================================================
   MiDocumento — lógica del cliente
   Frontend (HTML + CSS + JS) conectado a Google Apps Script,
   que usa Google Sheets como base de datos y Drive para fotos.
   ========================================================== */
const API_URL = "https://script.google.com/macros/s/AKfycbyvlsvqEEwByeF67KshJb9QL7aFBOaj8RYcKpfwQOLZMCm8pLJWdGd9RJ0Irf6Wp_I/exec";

const CLAVE_SESION = "midocumento_sesion";
const MAX_FOTO_MB = 5;
const LADO_MAX_FOTO = 1400;

const $ = id => document.getElementById(id);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let documentos = [];          // lista completa (datos públicos)
let resultados = null;        // resultado de búsqueda activa (o null)
let token = sessionStorage.getItem(CLAVE_SESION) || "";
let usuario = null;
let fotoLista = null;         // { base64, dataUrl, kb }

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

const TIPOS = { cedula: "Cédula de identidad", licencia: "Licencia de conducir", otro: "Otro documento" };
function claseTipo(t) {
    const n = norm(t);
    if (n.includes("cedula")) return "cedula";
    if (n.includes("licencia")) return "licencia";
    return "otro";
}

// Debe coincidir con la función del servidor (Code.gs)
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
    const caja = $("toasts");
    const el = document.createElement("div");
    el.className = "toast " + tipo;
    el.innerHTML = icono(tipo === "error" ? "alert" : "check") + `<span>${esc(texto)}</span>`;
    caja.appendChild(el);
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
    try {
        json = JSON.parse(texto);
    } catch (e) {
        throw new Error("El servidor no devolvió datos. Publica el Apps Script como aplicación web con acceso para «Cualquier persona».");
    }
    if (json.estado !== "ok") throw new Error(json.mensaje || "Error en el servidor");
    return json.datos;
}

/* ---------- Tarjeta de identidad ---------- */
const SILUETA = `<svg class="sil" aria-hidden="true"><use href="#i-person"/></svg>`;

function tarjeta(d, opciones = {}) {
    const t = claseTipo(d.TipoDocumento);
    const entregado = norm(d.Estado) === "reclamado";
    const nombre = d.NombreVisible || opciones.nombreVacio || "Nombre del titular";
    const num = d.Ultimos4 ? esc(d.Ultimos4) : "••••";
    return `
    <div class="idc t-${t}${entregado ? " is-done" : ""}" data-tilt>
        <div class="idc-top">
            <span class="idc-kind">${esc(TIPOS[t])}</span>
            <span class="chip ${entregado ? "chip-done" : "chip-ok"}"><i></i>${entregado ? "Entregado" : "Disponible"}</span>
        </div>
        <div class="idc-body">
            <div class="idc-photo" title="${d.TieneImagen ? "Fotografía protegida" : "Sin fotografía"}">${SILUETA}<span class="idc-lock">${icono("lock")}</span></div>
            <div class="idc-data">
                <strong class="idc-name">${esc(nombre)}</strong>
                <span class="idc-bar" style="width:84%"></span>
                <span class="idc-bar" style="width:56%"></span>
                <span class="idc-num"><small>N.º</small> •••• ${num}</span>
            </div>
        </div>
        <div class="idc-foot">
            <span>${icono("pin")}${esc(d.Zona || "Zona")}</span>
            <span>${icono("cal")}${esc(fmtFecha(d.FechaHallazgo) || "Fecha")}</span>
        </div>
        ${entregado ? '<span class="sello">Entregado</span>' : ""}
    </div>`;
}

function esDisponible(d) {
    return ["disponible", "encontrado"].includes(norm(d.Estado));
}

/* ---------- Render de documentos ---------- */
function pintarEsqueleto() {
    $("gridDocumentos").innerHTML = Array.from({ length: 6 }, () => '<li class="skel" aria-hidden="true"></li>').join("");
    $("mensajeDocumentos").hidden = true;
}

function mostrarDocumentos(lista, filtrado = false) {
    const grid = $("gridDocumentos");
    grid.innerHTML = lista.map((d, i) => `
        <li class="dcard rv" style="--d:${Math.min(i, 8) * 0.05}s">
            ${tarjeta(d)}
            <div class="dcard-pie">
                <span class="dcard-id">${esc(d.IDDocumento)}</span>
                ${esDisponible(d)
                    ? `<button type="button" class="btn btn-dark" data-reclamar="${esc(d.IDDocumento)}">Es mío ${icono("arrow")}</button>`
                    : `<span class="tag">${icono("check")}Ya fue entregado</span>`}
            </div>
        </li>`).join("");

    const vacio = $("mensajeDocumentos");
    vacio.hidden = lista.length > 0;
    vacio.textContent = filtrado
        ? "Ninguna coincidencia. Prueba con menos filtros o revisa la ortografía."
        : "Todavía no hay documentos registrados. Sé el primero en reportar uno.";

    $("tituloDocumentos").textContent = filtrado ? "Coincidencias" : "Todos los hallazgos";
    $("resumenResultados").textContent = filtrado
        ? `${lista.length} ${lista.length === 1 ? "coincidencia" : "coincidencias"}`
        : `${lista.length} ${lista.length === 1 ? "documento" : "documentos"}`;

    observarReveal(grid);
}

/* ---------- Carga de datos ---------- */
function contador(el, destino) {
    destino = Number(destino) || 0;
    el.dataset.target = destino;
    if (sinMovimiento || !el.dataset.visto) { el.textContent = destino; return; }
    const inicio = Number(el.textContent) || 0, t0 = performance.now(), dur = 1300;
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
        sel.replaceChildren(new Option(primera, ""));
        datos.forEach(z => z.Zona && sel.add(new Option(z.Zona, z.Zona)));
    };
    const valorBusca = $("buscarZona").value, valorRep = $("zonaReporte").value;
    llenar($("buscarZona"), "Todas las zonas");
    llenar($("zonaReporte"), "Seleccionar zona");
    $("buscarZona").value = valorBusca;
    $("zonaReporte").value = valorRep;
}

function llenarSelectReclamo() {
    const sel = $("documentoReclamo"), previo = sel.value;
    const libres = documentos.filter(esDisponible);
    sel.replaceChildren(new Option(libres.length ? "Seleccionar documento" : "No hay documentos disponibles", ""));
    libres.forEach(d => {
        const etq = [d.IDDocumento, TIPOS[claseTipo(d.TipoDocumento)], d.NombreVisible, d.Zona].filter(Boolean).join(" · ");
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
    $("accionesSesion").hidden = Boolean(perfil);
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
        const ul = $("misVerificados");
        $("listaVerificados").hidden = !lista.length;
        ul.innerHTML = lista.map(d => `
            <li>
                <span>${esc(d.NombreVisible)} <small>${esc(d.IDDocumento)} · ${esc(TIPOS[claseTipo(d.TipoDocumento)])}</small></span>
                <button type="button" class="btn btn-ghost btn-sm" data-entrega="${esc(d.IDDocumento)}">Ver entrega</button>
            </li>`).join("");
    } catch (e) { /* la lista es opcional */ }
}

/* ---------- Diálogos ---------- */
function abrirAuth(tab = "login") {
    cambiarTab(tab);
    const dlg = $("dialogoAuth");
    if (!dlg.open) dlg.showModal();
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
    $$("#dialogoAuth [data-tab]").forEach(b => b.addEventListener("click", () => { cambiarTab(b.dataset.tab); }));
    $$("dialog [data-cerrar]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
    $$("dialog").forEach(dlg => dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); }));
    $("dialogoAuth").addEventListener("toggle", posicionarIndicador);
    window.addEventListener("resize", posicionarIndicador);
}

/* ---------- Formularios ---------- */
function conectarFormulario(id, mensajeId, trabajo) {
    const form = $(id);
    let ocupado = false;
    form.addEventListener("submit", async e => {
        e.preventDefault();
        if (ocupado) return;
        if (!form.reportValidity()) return;
        ocupado = true;
        const boton = form.querySelector('button[type="submit"]');
        if (boton) { boton.disabled = true; boton.classList.add("cargando"); }
        setMensaje(mensajeId, "Procesando…", "carga");
        try {
            await trabajo(form);
        } catch (err) {
            setMensaje(mensajeId, err.message, "error");
        } finally {
            ocupado = false;
            if (boton) { boton.disabled = false; boton.classList.remove("cargando"); }
        }
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
    const validarClave = () => {
        $("confirmarClave").setCustomValidity(
            $("claveUsuario").value === $("confirmarClave").value ? "" : "Las contraseñas no coinciden"
        );
    };
    $("claveUsuario").addEventListener("input", () => {
        validarClave();
        const f = evaluarClave($("claveUsuario").value);
        const barra = $("fuerzaBarra");
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
        try { await fetch(API_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ accion: "cerrarSesion", token: t }) }); } catch (e) { /* sin red: la sesión local ya se cerró */ }
    });
}

/* ---------- Fotografía ---------- */
function cargarImagen(archivo) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(archivo);
        const img = new Image();
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
    const dataUrl = lienzo.toDataURL("image/jpeg", 0.82);
    const base64 = dataUrl.split(",")[1];
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
        pintarVistaPrevia();
    } catch (err) {
        limpiarFoto();
        setMensaje("mensajeRegistro", err.message, "error");
    }
}

function configurarFoto() {
    const input = $("imagenDocumento"), zona = $("dropzone");
    input.addEventListener("change", () => elegirFoto(input.files[0]));
    $("quitarImagen").addEventListener("click", e => { e.preventDefault(); limpiarFoto(); pintarVistaPrevia(); });
    ["dragenter", "dragover"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("arrastra"); }));
    ["dragleave", "drop"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.remove("arrastra"); }));
    zona.addEventListener("drop", e => {
        const f = e.dataTransfer && e.dataTransfer.files[0];
        if (f) elegirFoto(f);
    });
}

/* ---------- Reportar ---------- */
function pintarVistaPrevia() {
    const f = $("formReportar");
    const d = {
        TipoDocumento: f.elements.TipoDocumento.value || "Cédula",
        NombreVisible: enmascararNombre(f.elements.NombreCompleto.value),
        Ultimos4: String(f.elements.NumeroCompleto.value).replace(/[\s.\-]/g, "").slice(-4),
        Zona: f.elements.Zona.value, FechaHallazgo: f.elements.FechaHallazgo.value,
        Estado: "Disponible", TieneImagen: Boolean(fotoLista)
    };
    $("vistaTarjeta").innerHTML = tarjeta(d, { nombreVacio: "Nombre del titular" });
}

function configurarReporte() {
    const f = $("formReportar");
    f.elements.FechaHallazgo.max = hoyISO();
    f.elements.FechaNacimiento.max = hoyISO();
    f.addEventListener("input", pintarVistaPrevia);
    f.addEventListener("change", pintarVistaPrevia);
    pintarVistaPrevia();

    conectarFormulario("formReportar", "mensajeRegistro", async form => {
        const datos = Object.fromEntries(new FormData(form));
        delete datos.undefined;
        if (fotoLista) { datos.imagenBase64 = fotoLista.base64; datos.imagenTipo = "image/jpeg"; }
        const res = await llamarAPI("agregarDocumento", datos, true);
        form.reset();
        limpiarFoto();
        pintarVistaPrevia();
        setMensaje("mensajeRegistro", `Documento registrado correctamente (${res.IDDocumento}). Gracias por ayudar a devolverlo.`, "ok");
        toast("Documento registrado. ¡Gracias!");
        await actualizarDatos();
    });
}

/* ---------- Buscar ---------- */
function configurarBusqueda() {
    $("formBuscar").addEventListener("submit", async e => {
        e.preventDefault();
        const nombre = $("buscarNombre").value.trim();
        const ultimos = $("buscarNumero").value.replace(/\D/g, "");
        const zona = $("buscarZona").value;
        if (!nombre && !ultimos && !zona) { limpiarBusqueda(); return; }
        if (ultimos && ultimos.length !== 4) { toast("Escribe exactamente los 4 últimos dígitos.", "error"); return; }

        const boton = $("btnBuscar");
        boton.disabled = true; boton.classList.add("cargando");
        pintarEsqueleto();
        document.getElementById("documentos").scrollIntoView({ behavior: sinMovimiento ? "auto" : "smooth" });
        try {
            resultados = await llamarAPI("buscar", { nombre, ultimos, zona });
            mostrarDocumentos(resultados, true);
        } catch (err) {
            resultados = null;
            $("gridDocumentos").innerHTML = "";
            $("estadoCarga").hidden = false;
            $("estadoCarga").dataset.estado = "error";
            $("estadoCarga").textContent = err.message;
        } finally {
            boton.disabled = false; boton.classList.remove("cargando");
        }
    });
    $("limpiarBusqueda").addEventListener("click", limpiarBusqueda);
    $("buscarNumero").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4); });
}

function limpiarBusqueda() {
    $("formBuscar").reset();
    resultados = null;
    $("estadoCarga").hidden = true;
    mostrarDocumentos(documentos, false);
}

/* ---------- Reclamar ---------- */
function resumenReclamo() {
    const id = $("documentoReclamo").value;
    const d = documentos.find(x => x.IDDocumento === id);
    $("resumenReclamo").innerHTML = d
        ? tarjeta(d) + `<p class="ayuda">Código <span class="dcard-id">${esc(d.IDDocumento)}</span> · Hallado en ${esc(d.Zona)}</p>`
        : `<div class="vacio-reclamo">${icono("id", "ico-lg")}<p>Elige un documento para ver su tarjeta.</p></div>`;
}

function seleccionarReclamo(id) {
    $("documentoReclamo").value = id;
    resumenReclamo();
    document.getElementById("reclamos").scrollIntoView({ behavior: sinMovimiento ? "auto" : "smooth" });
    setTimeout(() => ($("camposReclamo").disabled ? $$(".avisoSesion .btn")[1] : $("numeroVerificacion")).focus({ preventScroll: true }), 600);
    if (!usuario) toast("Inicia sesión para reclamar este documento.", "error");
}

function enlaceWhatsApp(tel) {
    let d = String(tel || "").replace(/\D/g, "");
    if (d.length === 8) d = "591" + d;
    return d.length >= 8 ? `https://wa.me/${d}` : "";
}

function mostrarEntrega(p) {
    const d = p.documento || {}, c = p.contacto || {};
    const wa = enlaceWhatsApp(c.Telefono);
    $("contenidoEntrega").innerHTML = `
    <div class="entrega">
        <div class="entrega-cab">
            <span class="sello-ok">${icono("check")}</span>
            <div><h2 id="tituloEntrega">Titularidad verificada</h2><p>Los datos coinciden. Ya puedes coordinar la entrega.</p></div>
        </div>
        <div class="entrega-foto">
            ${p.imagen ? `<img src="${esc(p.imagen)}" alt="Fotografía del documento encontrado">` : `<p class="sin-foto">Quien lo encontró no adjuntó fotografía.</p>`}
        </div>
        <dl class="entrega-datos">
            <div><dt>Documento</dt><dd>${esc(TIPOS[claseTipo(d.TipoDocumento)])} · ${esc(d.IDDocumento)}</dd></div>
            <div><dt>Hallado el</dt><dd>${esc(fmtFecha(d.FechaHallazgo))}</dd></div>
            <div class="ancho"><dt>Lugar</dt><dd>${esc(d.LugarHallazgo || d.Zona)} · ${esc(d.Zona)}</dd></div>
            ${d.Descripcion ? `<div class="ancho"><dt>Nota de quien lo encontró</dt><dd>${esc(d.Descripcion)}</dd></div>` : ""}
        </dl>
        <div class="contacto">
            <h3>Quien lo encontró: ${esc(c.Nombre || "")}</h3>
            <p class="tel">${esc(c.Telefono || "Sin teléfono")}</p>
            <div class="btns">
                ${wa ? `<a class="btn btn-solid btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">${icono("phone")}Escribir por WhatsApp</a>` : ""}
            </div>
            <small>Coordina la entrega en un lugar público y lleva otra identificación de respaldo.</small>
        </div>
    </div>`;
    const dlg = $("dialogoEntrega");
    if (!dlg.open) dlg.showModal();
}

function configurarReclamo() {
    $("documentoReclamo").addEventListener("change", resumenReclamo);
    $("nacimientoVerificacion").max = hoyISO();

    $("actualizarReclamos").addEventListener("click", async () => {
        const b = $("actualizarReclamos");
        b.disabled = true;
        try { await cargarDocumentos(); toast("Lista actualizada."); } catch (err) { setMensaje("mensajeReclamo", err.message, "error"); } finally { b.disabled = false; }
    });

    conectarFormulario("formReclamo", "mensajeReclamo", async form => {
        const res = await llamarAPI("verificarReclamo", Object.fromEntries(new FormData(form)), true);
        if (res.verificado) {
            form.reset();
            setMensaje("mensajeReclamo", `Verificación exitosa. Documento ${res.paquete.documento.IDDocumento} marcado como entregado.`, "ok");
            mostrarEntrega(res.paquete);
            await actualizarDatos();
            cargarVerificados();
        } else {
            setMensaje("mensajeReclamo",
                res.restantes > 0
                    ? `Los datos no coinciden. Te quedan ${res.restantes} ${res.restantes === 1 ? "intento" : "intentos"} para este documento.`
                    : "Los datos no coinciden y agotaste tus intentos para este documento.", "error");
        }
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
        observadorReveal = new IntersectionObserver(entradas => {
            entradas.forEach(en => {
                if (en.isIntersecting) { en.target.classList.add("in"); observadorReveal.unobserve(en.target); }
            });
        }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    }
    nodos.forEach(n => observadorReveal.observe(n));
}

function configurarContadores() {
    const nodos = $$(".stat-n");
    const alVer = el => {
        el.dataset.visto = "1";
        const meta = Number(el.dataset.target) || 0;
        el.textContent = "0";
        contador(el, meta);
    };
    if (!("IntersectionObserver" in window) || sinMovimiento) { nodos.forEach(n => { n.dataset.visto = "1"; }); return; }
    const obs = new IntersectionObserver(es => es.forEach(en => {
        if (en.isIntersecting) { alVer(en.target); obs.unobserve(en.target); }
    }), { threshold: 0.6 });
    nodos.forEach(n => obs.observe(n));
}

function configurarScroll() {
    const barra = $("barraScroll"), top = $("top"), hero = $("inicio"), pasos = $("pasos");
    let pendiente = false;
    const actualizar = () => {
        pendiente = false;
        const y = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight;
        barra.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
        top.classList.toggle("scrolled", y > 12);
        if (!sinMovimiento) {
            const h = hero.offsetHeight || 1;
            hero.style.setProperty("--sy", Math.min(1, Math.max(0, y / h)).toFixed(3));
            const r = pasos.getBoundingClientRect(), vh = window.innerHeight;
            const p = (vh * 0.7 - r.top) / (r.height || 1);
            pasos.style.setProperty("--p", Math.min(1, Math.max(0, p)).toFixed(3));
        } else {
            pasos.style.setProperty("--p", 1);
        }
    };
    window.addEventListener("scroll", () => { if (!pendiente) { pendiente = true; requestAnimationFrame(actualizar); } }, { passive: true });
    window.addEventListener("resize", actualizar);
    actualizar();

    // enlace activo en el menú
    const enlaces = $$("#menu a");
    const secciones = enlaces.map(a => document.querySelector(a.getAttribute("href"))).filter(Boolean);
    if ("IntersectionObserver" in window) {
        const obs = new IntersectionObserver(es => es.forEach(en => {
            if (en.isIntersecting) {
                enlaces.forEach(a => a.classList.toggle("activo", a.getAttribute("href") === "#" + en.target.id));
            }
        }), { rootMargin: "-45% 0px -50% 0px" });
        secciones.forEach(s => obs.observe(s));
    }
}

function configurarMenu() {
    const btn = $("btnMenu"), menu = $("menu");
    const cerrar = () => { menu.classList.remove("abierto"); btn.setAttribute("aria-expanded", "false"); };
    btn.addEventListener("click", () => {
        const abierto = menu.classList.toggle("abierto");
        btn.setAttribute("aria-expanded", abierto);
    });
    menu.addEventListener("click", e => { if (e.target.closest("a")) cerrar(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") cerrar(); });
}

// Inclinación 3D de las tarjetas siguiendo el puntero
function configurarInclinacion() {
    if (sinMovimiento || !window.matchMedia("(hover: hover)").matches) return;
    let actual = null;
    const reset = el => { el.classList.remove("tilting"); el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); };
    document.addEventListener("pointermove", e => {
        const el = e.target.closest ? e.target.closest("[data-tilt]") : null;
        if (actual && actual !== el) { reset(actual); actual = null; }
        if (!el) return;
        actual = el;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        el.classList.add("tilting");
        el.style.setProperty("--ry", ((x - 0.5) * 14).toFixed(2) + "deg");
        el.style.setProperty("--rx", ((0.5 - y) * 12).toFixed(2) + "deg");
        el.style.setProperty("--gx", (x * 100).toFixed(1) + "%");
        el.style.setProperty("--gy", (y * 100).toFixed(1) + "%");
    }, { passive: true });
    document.addEventListener("pointerleave", () => { if (actual) { reset(actual); actual = null; } }, true);
}

/* ---------- Inicio ---------- */
document.addEventListener("DOMContentLoaded", async () => {
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
    const tokenGuardado = token;
    mostrarSesion(null, "");
    resumenReclamo();

    if (tokenGuardado) {
        try {
            token = tokenGuardado;
            const res = await llamarAPI("miSesion", {}, true);
            mostrarSesion(res.usuario, tokenGuardado);
        } catch (e) {
            mostrarSesion(null, "");
        }
    }
    await actualizarDatos();
});
