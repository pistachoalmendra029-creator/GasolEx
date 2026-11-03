
"use strict";

// ========================================
// CONFIGURACIÓN
// ========================================

const DATA_URL = "https://preciosgasolina.es/datos/gasolineras-hoy.csv";

const FUEL_COLUMNS = {
    "Gasolina 95": "gasolina_95_eur_l",
    "Gasolina 98": "gasolina_98_eur_l",
    "Gasóleo A": "gasoleo_a_eur_l",
    "Gasóleo Premium": "gasoleo_premium_eur_l",
    "GLP": "glp_eur_l"
};

let gasolineras = [];
let resultadosActuales = [];
let ubicacionActual = null;
let mapa = null;
let marcadores = null;
let circuloRadio = null;


// ========================================
// ELEMENTOS HTML
// ========================================

const formulario = document.getElementById("searchForm");
const inputCiudad = document.getElementById("ciudad");
const selectCombustible = document.getElementById("combustible");
const selectRadio = document.getElementById("radioKm");
const botonUbicacion = document.getElementById("locationButton");
const estado = document.getElementById("status");
const resultados = document.getElementById("stations");
const contador = document.getElementById("resultCount");


// ========================================
// INICIAR MAPA
// ========================================

function iniciarMapa() {
    if (typeof L === "undefined") {
        estado.textContent = "No se pudo cargar el mapa. Comprueba tu conexión.";
        return;
    }

    mapa = L.map("map").setView([40.4168, -3.7038], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(mapa);

    marcadores = L.layerGroup().addTo(mapa);
}


// ========================================
// UTILIDADES
// ========================================

function escapar(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, caracter => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[caracter]);
}

function distanciaKm(lat1, lon1, lat2, lon2) {
    const radioTierra = 6371;

    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    return 2 * radioTierra * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}


// ========================================
// PARSER CSV
// ========================================

function parseCSV(texto) {
    const lineas = texto
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .filter(linea => linea.trim() && !linea.trim().startsWith("#"));

    if (lineas.length < 2) {
        throw new Error("El archivo de gasolineras está vacío.");
    }

    function separarLinea(linea) {
        const columnas = [];
        let valor = "";
        let comillas = false;

        for (let i = 0; i < linea.length; i++) {
            const caracter = linea[i];

            if (caracter === '"') {
                if (comillas && linea[i + 1] === '"') {
                    valor += '"';
                    i++;
                } else {
                    comillas = !comillas;
                }
            } else if (caracter === "," && !comillas) {
                columnas.push(valor);
                valor = "";
            } else {
                valor += caracter;
            }
        }

        columnas.push(valor);

        return columnas;
    }

    const cabeceras = separarLinea(lineas[0]).map(c => c.trim());

    return lineas.slice(1).map(linea => {
        const valores = separarLinea(linea);
        const objeto = {};

        cabeceras.forEach((cabecera, indice) => {
            objeto[cabecera] = valores[indice]?.trim() ?? "";
        });

        return objeto;
    });
}


// ========================================
// CARGAR GASOLINERAS
// ========================================

async function cargarGasolineras() {
    if (gasolineras.length) {
        return gasolineras;
    }

    estado.textContent = "Descargando datos de gasolineras...";

    const respuesta = await fetch(DATA_URL);

    if (!respuesta.ok) {
        throw new Error("No se pudieron descargar los precios.");
    }

    const texto = await respuesta.text();
    gasolineras = parseCSV(texto);

    if (!gasolineras.length || !("latitud" in gasolineras[0])) {
        throw new Error("El formato de los datos no es válido.");
    }

    return gasolineras;
}


// ========================================
// OBTENER UBICACIÓN GPS
// ========================================

function obtenerUbicacion() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Tu navegador no permite obtener la ubicación."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            posicion => {
                resolve({
                    lat: posicion.coords.latitude,
                    lon: posicion.coords.longitude
                });
            },
            error => {
                let mensaje = "No se pudo obtener tu ubicación.";

                if (error.code === 1) {
                    mensaje = "Has denegado el permiso de ubicación.";
                }

                if (error.code === 2) {
                    mensaje = "No se pudo determinar tu ubicación.";
                }

                if (error.code === 3) {
                    mensaje = "La ubicación ha tardado demasiado.";
                }

                reject(new Error(mensaje));
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 60000
            }
        );
    });
}


// ========================================
// BUSCAR CIUDAD O DIRECCIÓN
// ========================================

async function buscarLugar(nombre) {
    const url =
        "https://nominatim.openstreetmap.org/search?" +
        new URLSearchParams({
            q: nombre,
            format: "jsonv2",
            countrycodes: "es",
            limit: "1"
        });

    const respuesta = await fetch(url);

    if (!respuesta.ok) {
        throw new Error("No se pudo buscar esa ubicación.");
    }

    const datos = await respuesta.json();

    if (!datos.length) {
        throw new Error("No se ha encontrado esa ciudad o dirección.");
    }

    return {
        lat: Number(datos[0].lat),
        lon: Number(datos[0].lon)
    };
}


// ========================================
// CLASIFICAR PRECIOS POR COLORES
// ========================================

function obtenerClasePrecio(precio, columna) {
    const precios = resultadosActuales
        .map(g => Number(g[columna]))
        .filter(p => Number.isFinite(p) && p > 0)
        .sort((a, b) => a - b);

    if (!precios.length) {
        return "price-medium";
    }

    const posicion = precios.findIndex(p => p >= precio);
    const porcentaje = (posicion === -1 ? precios.length - 1 : posicion)
        / precios.length;

    if (porcentaje <= 0.33) {
        return "price-cheap";
    }

    if (porcentaje <= 0.66) {
        return "price-medium";
    }

    return "price-expensive";
}


// ========================================
// BUSCAR GASOLINERAS
// ========================================

async function buscarGasolineras() {
    try {
        const combustible = selectCombustible.value;
        const columna = FUEL_COLUMNS[combustible];
        const radio = Number(selectRadio.value);
        const ciudad = inputCiudad.value.trim();

        if (!columna) {
            throw new Error("Selecciona un combustible válido.");
        }

        estado.textContent = "Buscando gasolineras...";

        // Si el usuario escribe una ciudad, usamos esa ubicación.
        // Si deja el campo vacío, utilizamos su GPS.

        if (ciudad) {
            ubicacionActual = await buscarLugar(ciudad);
        } else {
            ubicacionActual = await obtenerUbicacion();
        }

        await cargarGasolineras();

        const lista = gasolineras
            .map(g => {
                const lat = Number(g.latitud);
                const lon = Number(g.longitud);

                if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
                    return null;
                }

                const precio = Number(g[columna]);

                if (!Number.isFinite(precio) || precio <= 0) {
                    return null;
                }

                const distancia = distanciaKm(
                    ubicacionActual.lat,
                    ubicacionActual.lon,
                    lat,
                    lon
                );

                return {
                    ...g,
                    distancia,
                    precio
                };
            })
            .filter(g => g && g.distancia <= radio)
            .sort((a, b) => a.precio - b.precio);

        resultadosActuales = lista;

        mostrarGasolineras(lista, columna);

        estado.textContent =
            `Búsqueda completada: ${lista.length} gasolineras encontradas.`;

        if (mapa) {
            mapa.setView(
                [ubicacionActual.lat, ubicacionActual.lon],
                11
            );
        }

    } catch (error) {
        estado.textContent = error.message;

        resultados.innerHTML = `
            <div class="empty-state">
                <span>⚠️</span>
                <h3>No se pudo completar la búsqueda</h3>
                <p>${escapar(error.message)}</p>
            </div>
        `;

        contador.textContent = "0 gasolineras";
        resultadosActuales = [];
    }
}


// ========================================
// ABRIR FICHA DE GASOLINERA
// ========================================

function abrirFicha(g) {
    const modal = document.getElementById("stationModal");
    const details = document.getElementById("stationDetails");

    const nombre = escapar(g.rotulo || g.marca || "Gasolinera");
    const marca = escapar(g.marca || "");
    const direccion = escapar(g.direccion || "");
    const municipio = escapar(g.municipio || "");

    const lat = Number(g.latitud);
    const lon = Number(g.longitud);

    const preciosHTML = Object.entries(FUEL_COLUMNS)
        .map(([nombreCombustible, columna]) => {
            const precio = Number(g[columna]);

            if (!Number.isFinite(precio) || precio <= 0) {
                return `
                    <div class="fuel-price-row">
                        <span>${escapar(nombreCombustible)}</span>
                        <strong class="price-unavailable">
                            No disponible
                        </strong>
                    </div>
                `;
            }

            const clase = obtenerClasePrecio(precio, columna);

            return `
                <div class="fuel-price-row">
                    <span>${escapar(nombreCombustible)}</span>
                    <strong class="${clase}">
                        ${precio.toFixed(3).replace(".", ",")} €/L
                    </strong>
                </div>
            `;
        })
        .join("");

    const destino =
        "https://www.google.com/maps/dir/?api=1" +
        `&destination=${lat},${lon}&travelmode=driving`;

    details.innerHTML = `
        <h2 class="station-detail-title">${nombre}</h2>

        ${marca
            ? `<p class="station-detail-address">${marca}</p>`
            : ""}

        <p class="station-detail-address">
            ${direccion}${direccion && municipio ? ", " : ""}${municipio}
        </p>

        <span class="station-detail-distance">
            📍 A ${g.distancia.toFixed(2)} km de tu búsqueda
        </span>

        <h3 class="fuel-prices-title">
            Precios de combustible
        </h3>

        ${preciosHTML}

        <div class="price-legend">
            <span><i class="legend-dot dot-green"></i>Barato</span>
            <span><i class="legend-dot dot-orange"></i>Intermedio</span>
            <span><i class="legend-dot dot-red"></i>Caro</span>
        </div>

        <a
            class="directions-button"
            href="${destino}"
            target="_blank"
            rel="noopener noreferrer">
            📍 Cómo llegar con Google Maps
        </a>
    `;

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
}


// ========================================
// CERRAR FICHA
// ========================================

const modalGasolinera = document.getElementById("stationModal");

document.getElementById("closeStationModal")
    .addEventListener("click", cerrarFicha);

modalGasolinera.addEventListener("click", event => {
    if (event.target === modalGasolinera) {
        cerrarFicha();
    }
});

document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        cerrarFicha();
    }
});

function cerrarFicha() {
    modalGasolinera.classList.remove("active");
    modalGasolinera.setAttribute("aria-hidden", "true");
}


// ========================================
// MOSTRAR GASOLINERAS EN LISTA Y MAPA
// ========================================

function mostrarGasolineras(lista, columna) {
    resultados.innerHTML = "";

    if (marcadores) {
        marcadores.clearLayers();
    }

    contador.textContent = `${lista.length} gasolineras encontradas`;

    if (circuloRadio && mapa) {
        mapa.removeLayer(circuloRadio);
        circuloRadio = null;
    }

    if (!lista.length) {
        resultados.innerHTML = `
            <div class="empty-state">
                <span>⛽</span>
                <h3>No hay gasolineras disponibles</h3>
                <p>Prueba con otro combustible o amplía la distancia.</p>
            </div>
        `;

        return;
    }

    const limites = [];

    lista.forEach(g => {
        const lat = Number(g.latitud);
        const lon = Number(g.longitud);
        const precio = Number(g[columna]);

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            return;
        }

        const nombre = escapar(g.rotulo || g.marca || "Gasolinera");
        const direccion = escapar(g.direccion || "");
        const municipio = escapar(g.municipio || "");
        const clase = obtenerClasePrecio(precio, columna);

        const tarjeta = document.createElement("article");

        tarjeta.className = "station-card";

        tarjeta.innerHTML = `
            <h3>${nombre}</h3>
            <p>${direccion}</p>
            <p>${municipio}</p>

            <strong class="station-price ${clase}">
                ${precio.toFixed(3).replace(".", ",")} €/L
            </strong>

            <p>📍 ${g.distancia.toFixed(2)} km de distancia</p>

            <p><strong>Ver información y cómo llegar →</strong></p>
        `;

        tarjeta.addEventListener("click", () => abrirFicha(g));

        resultados.appendChild(tarjeta);

        const marcador = L.marker([lat, lon]);

        marcador.bindPopup(`
            <strong>${nombre}</strong><br>
            ${precio.toFixed(3).replace(".", ",")} €/L<br>
            <small>Pulsa el marcador para ver todos los precios</small>
        `);

        marcador.on("click", () => abrirFicha(g));

        marcador.addTo(marcadores);

        limites.push([lat, lon]);
    });

    if (ubicacionActual) {
        const radio = Number(selectRadio.value);

        circuloRadio = L.circle(
            [ubicacionActual.lat, ubicacionActual.lon],
            {
                radius: radio * 1000,
                color: "#159b54",
                fillColor: "#159b54",
                fillOpacity: 0.06,
                weight: 2
            }
        ).addTo(mapa);

        limites.push([
            ubicacionActual.lat,
            ubicacionActual.lon
        ]);
    }

    if (limites.length) {
        mapa.fitBounds(limites, {
            padding: [30, 30],
            maxZoom: 14
        });
    }
}


// ========================================
// EVENTOS
// ========================================

formulario.addEventListener("submit", event => {
    event.preventDefault();
    buscarGasolineras();
});

botonUbicacion.addEventListener("click", async () => {
    inputCiudad.value = "";

    await buscarGasolineras();
});


// ========================================
// INICIAR APLICACIÓN
// ========================================

document.addEventListener("DOMContentLoaded", () => {
    iniciarMapa();
});
