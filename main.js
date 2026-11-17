import { STOPS_IDA, STOPS_VUELTA } from './stops.js';
import { calculateEta } from './eta.js';
import { playAlertBeep, triggerSystemNotification } from './notifications.js';
import {
  requestWakeLock,
  releaseWakeLock,
  calculateDistanceKm,
  evaluateGpsSignal,
  createBusPinSvg,
  fetchStreetRouteCoordinates,
  snapPointToPolyline
} from './gps.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });
    }).catch(() => {});
  });
}

const I18N = {
  es: {
    planTrip: 'Planificar Viaje',
    boardingStop: 'Parada de Subida',
    alightingStop: 'Parada de Bajada',
    estArrival: 'Llegada Estimada',
    stops: 'Paradas',
    stopsLower: 'paradas',
    nextDeparture: 'Próxima Salida',
    startTracking: '🚌 Iniciar Seguimiento',
    myTripsTitle: 'Últimos 10 Viajes',
    recentDestinations: 'Destinos Recientes',
    saveCurrentRoute: 'Guardar Trayecto Actual',
    savedRoutes: 'Mis Rutas Guardadas',
    profileAndPrefs: 'Perfil y Preferencias',
    yourName: 'Tu Nombre',
    speedUnit: 'Unidad',
    language: 'Idioma',
    visualTheme: 'Tema Visual',
    notificationsGps: 'Notificaciones y Push',
    info: 'Información',
    navHome: 'Inicio',
    navTrips: 'Mis viajes',
    navFavs: 'Favoritos',
    navSettings: 'Ajustes',
    recenter: 'Centrar micro',
    tripMins: 'Min Viaje',
    changeStop: 'Cambiar parada de bajada',
    cancelTracking: '❌ Cancelar Seguimiento',
    details: '📊 Detalles',
    hide: '🔽 Ocultar',
    finishTrip: '🏁 Terminar Viaje',
    repeatTrip: '🔄 Repetir viaje',
    clearBtn: 'Limpiar',
    noTripsYet: 'Aún no has registrado viajes completados.',
    noFavsYet: 'Aún no tienes rutas favoritas guardadas.',
    early: '🟢 Adelantado',
    ontime: '🔵 A tiempo',
    delayed: '🟠 Con retraso'
  },
  en: {
    planTrip: 'Plan Trip',
    boardingStop: 'Boarding Stop',
    alightingStop: 'Alighting Stop',
    estArrival: 'Estimated Arrival',
    stops: 'Stops',
    stopsLower: 'stops',
    nextDeparture: 'Next Departure',
    startTracking: '🚌 Start Tracking',
    myTripsTitle: 'Last 10 Trips',
    recentDestinations: 'Recent Destinations',
    saveCurrentRoute: 'Save Current Route',
    savedRoutes: 'Saved Routes',
    profileAndPrefs: 'Profile & Preferences',
    yourName: 'Your Name',
    speedUnit: 'Unit',
    language: 'Language',
    visualTheme: 'Visual Theme',
    notificationsGps: 'Notifications & Push',
    info: 'Information',
    navHome: 'Home',
    navTrips: 'My Trips',
    navFavs: 'Favorites',
    navSettings: 'Settings',
    recenter: 'Center bus',
    tripMins: 'Trip Mins',
    changeStop: 'Change destination stop',
    cancelTracking: '❌ Cancel Tracking',
    details: '📊 Details',
    hide: '🔽 Hide',
    finishTrip: '🏁 Finish Trip',
    repeatTrip: '🔄 Repeat trip',
    clearBtn: 'Clear',
    noTripsYet: 'No completed trips recorded yet.',
    noFavsYet: 'No saved favorite routes yet.',
    early: '🟢 Ahead of schedule',
    ontime: '🔵 On time',
    delayed: '🟠 Delayed'
  }
};

let ROUTE_STOPS = STOPS_IDA;
let state = {
  userName: localStorage.getItem("userName") || "Pasajero",
  theme: localStorage.getItem("appTheme") || "auto",
  speedUnit: localStorage.getItem("speedUnit") || "kmh",
  lang: localStorage.getItem("appLang") || "es",
  direction: "IDA",
  startStopId: STOPS_IDA[0].id,
  endStopId: STOPS_IDA[STOPS_IDA.length - 1].id,
  originStopObj: null,
  isTripActive: false,
  currentBaseIndex: 0,
  atStop: false,
  isGpsLive: false,
  gpsAccuracy: null,
  autoFollowMap: true,
  userTouchedStartStop: false,
  tripStartTime: null,
  watchPositionId: null,
  currentSpeedKmh: 0,
  avgSpeedKmh: 0,
  totalSpeedReadings: 0,
  sumSpeedReadings: 0,
  lastLat: null,
  lastLng: null,
  snappedLat: null,
  snappedLng: null,
  alert2StopsTriggered: false,
  alert1StopTriggered: false,
  alertArrivedTriggered: false,
  favorites: JSON.parse(localStorage.getItem("favorites") || "[]"),
  recentDestinations: JSON.parse(localStorage.getItem("recentDestinations") || "[]"),
  tripHistory: JSON.parse(localStorage.getItem("tripHistory") || "[]")
};

let fullMap = null;
let busMarker = null;
let routePolyline = null;
let staticStreetCoords = [];
let stopsLayerGroup = null;
let pedestrianMap = null;
let pedestrianPersonMarker = null;
let pedestrianStopMarker = null;

document.addEventListener("DOMContentLoaded", () => {
  checkAutoTheme();
  applyLanguage(state.lang);
  initNavigation();
  initUI();
  checkPermissionsStatus();
  checkUrlShortcuts();
  restoreSessionIfExists();
  renderFavorites();
  renderRecentDestinations();
  renderTripHistory();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.isTripActive) {
      requestWakeLock();
      syncGpsPositionToClosestStop();
    }
  });
});

function t(key) {
  return (I18N[state.lang] && I18N[state.lang][key]) || I18N.es[key] || key;
}

function applyLanguage(lang) {
  state.lang = lang;
  localStorage.setItem("appLang", lang);
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.dataset.i18n;
    if (t(key)) el.innerText = t(key);
  });
  updateUnitLabels();
  updateBusMarkerSignalVisual();
  updateSetupSummary();
  renderFavorites();
  renderTripHistory();
}

function updateUnitLabels() {
  const isMph = state.speedUnit === "mph";
  const setupDistLbl = document.getElementById("setupDistUnitLabel");
  if (setupDistLbl) setupDistLbl.innerText = isMph ? "Mi Aprox" : "Km Aprox";

  const lblCurr = document.getElementById("lblCurrentSpeedUnit");
  const lblAvg = document.getElementById("lblAvgSpeedUnit");
  if (lblCurr) lblCurr.innerText = isMph ? "mph Act." : "km/h Act.";
  if (lblAvg) lblAvg.innerText = isMph ? "mph Prom." : "km/h Prom.";

  document.getElementById("gpsCurrentSpeed").innerText = formatSpeed(state.currentSpeedKmh);
  document.getElementById("gpsAvgSpeed").innerText = formatSpeed(state.avgSpeedKmh);
}

function formatSpeed(kmh) {
  if (state.speedUnit === "mph") return Math.round(kmh * 0.621371);
  return Math.round(kmh);
}

function formatDistanceValue(km) {
  if (state.speedUnit === "mph") return (km * 0.621371).toFixed(1);
  return km.toFixed(1);
}

function formatDurationHMS(ms) {
  const totalSec = Math.max(1, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function initNavigation() {
  const navButtons = document.querySelectorAll(".nav-item");
  navButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      switchTab(btn.dataset.tab);
    });
  });
}

function switchTab(tabId) {
  const tabs = ["tabInicio", "tabMisViajes", "tabFavoritos", "tabConfig"];
  tabs.forEach(id => {
    document.getElementById(id).classList.toggle("hidden", id !== tabId);
  });
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  if (tabId === "tabMisViajes") renderTripHistory();
}

function checkAutoTheme() {
  const savedTheme = localStorage.getItem("appTheme");
  if (savedTheme && savedTheme !== "auto") {
    applyTheme(savedTheme);
  } else {
    const hour = new Date().getHours();
    applyTheme((hour >= 19 || hour < 7) ? "dark" : "light");
  }
}

function applyTheme(theme) {
  state.theme = theme;
  localStorage.setItem("appTheme", theme);
  const btn = document.getElementById("btnThemeToggle");
  if (theme === "light") {
    document.body.classList.add("light-mode");
    if (btn) btn.innerText = "🌙 Modo Oscuro";
  } else {
    document.body.classList.remove("light-mode");
    if (btn) btn.innerText = "☀️ Modo Claro";
  }
}

function checkUrlShortcuts() {
  const urlParams = new URLSearchParams(window.location.search);
  const dirParam = urlParams.get('dir');
  if (dirParam && (dirParam === 'IDA' || dirParam === 'VUELTA')) {
    state.direction = dirParam;
    document.getElementById("selectDirection").value = dirParam;
    ROUTE_STOPS = dirParam === 'IDA' ? STOPS_IDA : STOPS_VUELTA;
    populateStopsDropdowns();
  }
}

function checkPermissionsStatus() {
  const banner = document.getElementById("permissionBanner");
  if ("Notification" in window && Notification.permission === "granted") {
    banner.classList.add("hidden");
  } else {
    banner.classList.remove("hidden");
  }
}

async function requestSystemPermissions() {
  if ("Notification" in window && Notification.permission !== "granted") {
    await Notification.requestPermission();
  }
  if ("serviceWorker" in navigator && "PushManager" in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.pushManager.getSubscription();
    } catch (e) {}
  }
  checkPermissionsStatus();
}

function expandSheetAndRecenter() {
  state.autoFollowMap = true;
  document.getElementById("btnRecenterMap").classList.add("hidden");
  document.getElementById("tripBottomSheet").classList.remove("minimized");
  focusMapOnBusAndNextStop();
}

function minimizeSheetOnMapExplore() {
  state.autoFollowMap = false;
  document.getElementById("btnRecenterMap").classList.remove("hidden");
  document.getElementById("tripBottomSheet").classList.add("minimized");
}

function initUI() {
  document.getElementById("btnThemeToggle").addEventListener("click", () => {
    applyTheme(document.body.classList.contains("light-mode") ? "dark" : "light");
  });

  document.getElementById("selectSpeedUnit").value = state.speedUnit;
  document.getElementById("selectSpeedUnit").addEventListener("change", (e) => {
    state.speedUnit = e.target.value;
    localStorage.setItem("speedUnit", state.speedUnit);
    updateUnitLabels();
    updateSetupSummary();
    updateClockAndETA();
  });

  document.getElementById("selectLanguage").value = state.lang;
  document.getElementById("selectLanguage").addEventListener("change", (e) => {
    applyLanguage(e.target.value);
  });

  document.getElementById("btnGrantPermissions").addEventListener("click", requestSystemPermissions);

  document.getElementById("inputName").value = state.userName;
  document.getElementById("inputName").addEventListener("input", (e) => {
    state.userName = e.target.value.trim() || "Pasajero";
    localStorage.setItem("userName", state.userName);
    updateHeaderGreeting(null);
  });

  document.getElementById("selectDirection").addEventListener("change", (e) => {
    state.direction = e.target.value;
    ROUTE_STOPS = state.direction === "IDA" ? STOPS_IDA : STOPS_VUELTA;
    state.userTouchedStartStop = false;
    populateStopsDropdowns();
    updateDepartureSchedule();
    updateSetupSummary();
  });

  document.getElementById("btnSwapDirection").addEventListener("click", () => {
    const newDir = state.direction === "IDA" ? "VUELTA" : "IDA";
    state.direction = newDir;
    document.getElementById("selectDirection").value = newDir;
    ROUTE_STOPS = newDir === "IDA" ? STOPS_IDA : STOPS_VUELTA;
    state.userTouchedStartStop = false;
    populateStopsDropdowns();
    updateDepartureSchedule();
    updateSetupSummary();
  });

  document.getElementById("selectStartStop").addEventListener("change", (e) => {
    state.userTouchedStartStop = true;
    state.startStopId = e.target.value;
    updateDepartureSchedule();
    updateSetupSummary();
  });

  document.getElementById("selectEndStop").addEventListener("change", (e) => {
    state.endStopId = e.target.value;
    updateSetupSummary();
  });

  document.getElementById("activeChangeEndStop").addEventListener("change", (e) => {
    state.endStopId = e.target.value;
    state.alert2StopsTriggered = false;
    state.alert1StopTriggered = false;
    state.alertArrivedTriggered = false;
    saveActiveStateToStorage();
    updateClockAndETA();
    buildStaticStreetRoute();
  });

  populateStopsDropdowns();

  document.getElementById("btnStartTrip").addEventListener("click", () => {
    requestSystemPermissions();
    addRecentDestination(state.endStopId);
    startTrip();
  });

  document.getElementById("btnCancelTrip").addEventListener("click", cancelTrip);
  document.getElementById("btnFinishTrip").addEventListener("click", finishTrip);
  document.getElementById("btnSaveFavorite").addEventListener("click", saveFavoriteRoute);

  document.getElementById("btnClearFavorites").addEventListener("click", () => {
    state.favorites = [];
    localStorage.setItem("favorites", JSON.stringify([]));
    renderFavorites();
  });

  document.getElementById("btnClearHistory").addEventListener("click", () => {
    state.tripHistory = [];
    localStorage.setItem("tripHistory", JSON.stringify([]));
    renderTripHistory();
  });

  document.getElementById("btnToggleTelemetry").addEventListener("click", () => {
    const drawer = document.getElementById("telemetryDrawer");
    const btn = document.getElementById("btnToggleTelemetry");
    const isHidden = drawer.classList.toggle("hidden");
    btn.innerText = isHidden ? t("details") : t("hide");
  });

  // Al tocar el borde superior del panel minimizado o el botón Centrar micro, sube y centra
  document.getElementById("sheetTopBar").addEventListener("click", () => {
    const sheet = document.getElementById("tripBottomSheet");
    if (sheet.classList.contains("minimized")) {
      expandSheetAndRecenter();
    }
  });

  document.getElementById("btnRecenterMap").addEventListener("click", expandSheetAndRecenter);

  document.getElementById("compassContainer").addEventListener("click", openPedestrianModal);
  document.getElementById("btnClosePedestrianModal").addEventListener("click", () => {
    document.getElementById("pedestrianModal").classList.remove("active");
  });

  document.getElementById("btnHowItWorks").addEventListener("click", () => {
    document.getElementById("howItWorksModal").classList.add("active");
  });
  document.getElementById("btnCloseHowItWorks").addEventListener("click", () => {
    document.getElementById("howItWorksModal").classList.remove("active");
  });

  document.getElementById("btnFAQ").addEventListener("click", () => {
    document.getElementById("faqModal").classList.add("active");
  });
  document.getElementById("btnCloseFAQ").addEventListener("click", () => {
    document.getElementById("faqModal").classList.remove("active");
  });

  setInterval(updateClockAndETA, 1000);
  initPassiveGPS();
}

function initFullInteractiveMap() {
  if (fullMap) {
    setTimeout(() => fullMap.invalidateSize(), 150);
    return;
  }

  const startObj = ROUTE_STOPS[state.currentBaseIndex] || ROUTE_STOPS[0];
  fullMap = L.map('fullMap', {
    zoomControl: false,
    attributionControl: false
  }).setView([startObj.lat, startObj.lng], 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(fullMap);

  stopsLayerGroup = L.layerGroup().addTo(fullMap);

  const initialSignal = evaluateGpsSignal(state.gpsAccuracy, state.isGpsLive, state.lang);
  const busIcon = L.divIcon({
    html: createBusPinSvg(initialSignal.color),
    className: '',
    iconSize: [48, 58],
    iconAnchor: [24, 55]
  });

  busMarker = L.marker([startObj.lat, startObj.lng], { icon: busIcon, zIndexOffset: 1000 }).addTo(fullMap);

  // Al mover o hacer zoom en el mapa, minimiza el panel inferior y pausa seguimiento
  fullMap.on('dragstart zoomstart', () => {
    minimizeSheetOnMapExplore();
  });
}

function updateBusMarkerSignalVisual() {
  const sig = evaluateGpsSignal(state.gpsAccuracy, state.isGpsLive, state.lang);

  const headerDot = document.getElementById("headerGpsDot");
  const headerLbl = document.getElementById("headerGpsLabel");
  if (headerDot && headerLbl) {
    headerDot.className = `gps-dot ${sig.level}`;
    headerLbl.innerText = sig.label;
  }

  const activeDot = document.getElementById("activeGpsDot");
  const activeTxt = document.getElementById("activeGpsSignalText");
  if (activeDot && activeTxt) {
    activeDot.className = `gps-dot ${sig.level}`;
    activeTxt.innerText = sig.label;
  }

  if (busMarker) {
    const newIcon = L.divIcon({
      html: createBusPinSvg(sig.color),
      className: '',
      iconSize: [48, 58],
      iconAnchor: [24, 55]
    });
    busMarker.setIcon(newIcon);
  }
}

// Construye una ruta fija por calles usando EXCLUSIVAMENTE las paradas oficiales (sin coordenadas crudas GPS)
async function buildStaticStreetRoute() {
  if (!fullMap || !stopsLayerGroup) return;

  const startIdx = Math.max(0, ROUTE_STOPS.findIndex(s => s.id === state.startStopId));
  const endIdx = ROUTE_STOPS.findIndex(s => s.id === state.endStopId);
  const finalIdx = endIdx >= startIdx ? endIdx : ROUTE_STOPS.length - 1;
  const tripStops = ROUTE_STOPS.slice(Math.min(startIdx, state.currentBaseIndex), finalIdx + 1);

  if (tripStops.length < 2) return;

  const stopWaypoints = tripStops.map(s => [s.lat, s.lng]);
  staticStreetCoords = await fetchStreetRouteCoordinates(stopWaypoints);

  if (!fullMap) return;
  if (routePolyline) fullMap.removeLayer(routePolyline);

  routePolyline = L.polyline(staticStreetCoords, {
    color: '#087E8B',
    weight: 6,
    opacity: 0.88,
    lineJoin: 'round'
  }).addTo(fullMap);

  renderStopMarkersOnMap();
}

function renderStopMarkersOnMap() {
  if (!fullMap || !stopsLayerGroup) return;
  stopsLayerGroup.clearLayers();

  const endIndex = ROUTE_STOPS.findIndex(s => s.id === state.endStopId);
  const finalIdx = endIndex >= state.currentBaseIndex ? endIndex : ROUTE_STOPS.length - 1;
  const remainingStops = ROUTE_STOPS.slice(state.currentBaseIndex, finalIdx + 1);

  remainingStops.forEach((stop, idx) => {
    const isNext = idx === 0;
    const isFinal = idx === remainingStops.length - 1;

    let markerHtml = '';
    let size = [16, 16];
    let anchor = [8, 8];

    if (isFinal) {
      markerHtml = `<div style="background:#EF4444; color:#fff; width:28px; height:28px; border-radius:50%; border:3px solid #fff; display:flex; align-items:center; justify-content:center; font-size:14px; box-shadow:0 3px 10px rgba(0,0,0,0.4);">🏁</div>`;
      size = [28, 28];
      anchor = [14, 14];
    } else if (isNext) {
      markerHtml = `<div style="background:#087E8B; width:20px; height:20px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 12px #087E8B;"></div>`;
      size = [20, 20];
      anchor = [10, 10];
    } else {
      markerHtml = `<div style="background:#FFFFFF; width:13px; height:13px; border-radius:50%; border:3px solid #087E8B; box-shadow:0 2px 6px rgba(0,0,0,0.25);"></div>`;
      size = [13, 13];
      anchor = [6, 6];
    }

    const icon = L.divIcon({
      html: markerHtml,
      className: '',
      iconSize: size,
      iconAnchor: anchor
    });

    const m = L.marker([stop.lat, stop.lng], { icon }).addTo(stopsLayerGroup);
    const prefix = isFinal ? '🏁 Destino: ' : (isNext ? '📍 Parada: ' : '🚏 Paradero: ');
    m.bindPopup(`<strong>${prefix}${stop.name}</strong>`);
  });
}

function focusMapOnBusAndNextStop() {
  if (!fullMap || !state.autoFollowMap) return;
  const targetStop = ROUTE_STOPS[state.currentBaseIndex];
  const busLat = state.snappedLat || state.lastLat;
  const busLng = state.snappedLng || state.lastLng;

  if (busLat && busLng && targetStop) {
    const bounds = L.latLngBounds([
      [busLat, busLng],
      [targetStop.lat, targetStop.lng]
    ]);
    fullMap.fitBounds(bounds, {
      paddingTopLeft: [40, 80],
      paddingBottomRight: [40, 320],
      maxZoom: 16
    });
  } else if (busLat && busLng) {
    fullMap.setView([busLat, busLng], 16);
  }
}

function updateHeaderGreeting(nearestStop) {
  const greeting = document.getElementById("headerGreeting");
  if (!greeting) return;
  if (nearestStop) {
    greeting.innerText = state.lang === "en"
      ? `Hi ${state.userName} · Near ${nearestStop.name}`
      : `Hola ${state.userName} · Cerca de ${nearestStop.name}`;
  } else {
    greeting.innerText = state.lang === "en" ? `Hi, ${state.userName}!` : `¡Hola, ${state.userName}!`;
  }
}

function populateStopsDropdowns() {
  const selectStart = document.getElementById("selectStartStop");
  const selectEnd = document.getElementById("selectEndStop");
  selectStart.innerHTML = "";
  selectEnd.innerHTML = "";

  ROUTE_STOPS.forEach((s) => {
    selectStart.appendChild(new Option(s.name, s.id));
    selectEnd.appendChild(new Option(s.name, s.id));
  });

  state.startStopId = ROUTE_STOPS[0].id;
  state.endStopId = ROUTE_STOPS[ROUTE_STOPS.length - 1].id;
  selectStart.value = state.startStopId;
  selectEnd.value = state.endStopId;

  updateSetupSummary();
}

function populateActiveChangeEndDropdown() {
  const select = document.getElementById("activeChangeEndStop");
  select.innerHTML = "";
  const remaining = ROUTE_STOPS.slice(state.currentBaseIndex + 1);
  remaining.forEach(s => { select.appendChild(new Option(s.name, s.id)); });
  select.value = state.endStopId;
}

function updateSetupSummary() {
  const startObj = ROUTE_STOPS.find(s => s.id === state.startStopId);
  const endObj = ROUTE_STOPS.find(s => s.id === state.endStopId);
  if (!startObj || !endObj) return;

  const startIdx = ROUTE_STOPS.findIndex(s => s.id === state.startStopId);
  const endIdx = ROUTE_STOPS.findIndex(s => s.id === state.endStopId);
  const stopsCount = Math.max(0, endIdx - startIdx);
  const kmDist = Math.max(0.1, calculateDistanceKm(startObj.lat, startObj.lng, endObj.lat, endObj.lng) * 1.25);
  const etaInfo = calculateEta(startObj, endObj, state.direction, null);

  const arrivalTime = new Date(new Date().getTime() + etaInfo.minutes * 60000);
  document.getElementById("setupTripEta").innerText = `${arrivalTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
  document.getElementById("setupTripStops").innerText = `${stopsCount}`;
  document.getElementById("setupTripDist").innerText = `${formatDistanceValue(kmDist)}`;
}

function addRecentDestination(stopId) {
  const stop = ROUTE_STOPS.find(s => s.id === stopId);
  if (!stop) return;
  state.recentDestinations = state.recentDestinations.filter(d => d.id !== stopId);
  state.recentDestinations.unshift({ id: stop.id, name: stop.name, direction: state.direction });
  if (state.recentDestinations.length > 5) state.recentDestinations.pop();
  localStorage.setItem("recentDestinations", JSON.stringify(state.recentDestinations));
  renderRecentDestinations();
}

function renderRecentDestinations() {
  const container = document.getElementById("recentDestinationsChips");
  const wrapper = document.getElementById("recentDestinationsContainer");
  if (!container || !wrapper) return;
  container.innerHTML = "";

  if (state.recentDestinations.length === 0) {
    wrapper.classList.add("hidden");
    return;
  }
  wrapper.classList.remove("hidden");

  state.recentDestinations.forEach(dest => {
    const chip = document.createElement("button");
    chip.className = "btn-secondary";
    chip.style.cssText = "padding: 8px 12px; font-size: 0.78rem; border-radius: 99px; min-height: 36px;";
    chip.innerText = `🎯 ${dest.name}`;
    chip.addEventListener("click", () => {
      state.direction = dest.direction;
      document.getElementById("selectDirection").value = dest.direction;
      ROUTE_STOPS = dest.direction === 'IDA' ? STOPS_IDA : STOPS_VUELTA;
      populateStopsDropdowns();
      document.getElementById("selectEndStop").value = dest.id;
      state.endStopId = dest.id;
      updateSetupSummary();
      switchTab("tabInicio");
    });
    container.appendChild(chip);
  });
}

function saveFavoriteRoute() {
  const favName = document.getElementById("favNameInput").value.trim() || "Ruta Frecuente";
  state.favorites.push({
    id: Date.now(),
    name: favName,
    direction: state.direction,
    startStopId: state.startStopId,
    endStopId: state.endStopId
  });
  localStorage.setItem("favorites", JSON.stringify(state.favorites));
  document.getElementById("favNameInput").value = "";
  renderFavorites();
}

function renderFavorites() {
  const container = document.getElementById("favoritesList");
  if (!container) return;
  container.innerHTML = "";
  if (state.favorites.length === 0) {
    container.innerHTML = `<div style="font-size:0.82rem; color:var(--text-muted);">${t("noFavsYet")}</div>`;
    return;
  }
  state.favorites.forEach(fav => {
    const item = document.createElement("div");
    item.style.cssText = "background:var(--surface-alt); padding:12px 14px; border-radius:16px; display:flex; justify-content:space-between; align-items:center;";
    item.innerHTML = `
      <div>
        <div style="font-size:0.95rem; font-weight:800;">${fav.name}</div>
        <div style="font-size:0.75rem; color:var(--secondary); font-weight:700;">${fav.direction === 'IDA' ? 'Hacia San Antonio' : 'Hacia El Yeco'}</div>
      </div>
      <button class="btn-secondary" style="padding:8px 14px; min-height:38px;">Usar</button>
    `;
    item.querySelector("button").addEventListener("click", () => {
      state.direction = fav.direction;
      document.getElementById("selectDirection").value = fav.direction;
      ROUTE_STOPS = fav.direction === 'IDA' ? STOPS_IDA : STOPS_VUELTA;
      populateStopsDropdowns();
      document.getElementById("selectStartStop").value = fav.startStopId;
      state.startStopId = fav.startStopId;
      state.userTouchedStartStop = true;
      document.getElementById("selectEndStop").value = fav.endStopId;
      state.endStopId = fav.endStopId;
      updateDepartureSchedule();
      updateSetupSummary();
      switchTab("tabInicio");
    });
    container.appendChild(item);
  });
}

function recordCompletedTrip(endStopObj) {
  const startObj = state.originStopObj || ROUTE_STOPS.find(s => s.id === state.startStopId) || ROUTE_STOPS[0];
  const endObj = endStopObj || ROUTE_STOPS.find(s => s.id === state.endStopId) || ROUTE_STOPS[ROUTE_STOPS.length - 1];
  const startDt = state.tripStartTime ? new Date(state.tripStartTime) : new Date();
  const endDt = new Date();
  const durationFormatted = formatDurationHMS(endDt.getTime() - startDt.getTime());

  const record = {
    id: Date.now(),
    dateStr: startDt.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    startTimeStr: startDt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    endTimeStr: endDt.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    durationStr: durationFormatted,
    startStopId: startObj.id,
    startStopName: startObj.name,
    endStopId: endObj.id,
    endStopName: endObj.name,
    direction: state.direction
  };

  state.tripHistory.unshift(record);
  if (state.tripHistory.length > 10) state.tripHistory = state.tripHistory.slice(0, 10);
  localStorage.setItem("tripHistory", JSON.stringify(state.tripHistory));
  renderTripHistory();
}

function renderTripHistory() {
  const container = document.getElementById("tripHistoryList");
  if (!container) return;
  container.innerHTML = "";

  if (state.tripHistory.length === 0) {
    container.innerHTML = `<div style="font-size:0.85rem; color:var(--text-muted); text-align:center; padding:16px 0;">${t("noTripsYet")}</div>`;
    return;
  }

  state.tripHistory.forEach(item => {
    const card = document.createElement("div");
    card.className = "history-card";
    const durText = item.durationStr ? `<span class="duration-pill">⏱️ ${item.durationStr}</span>` : '';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
        <span style="font-size:0.75rem; font-weight:800; color:var(--secondary);">📅 ${item.dateStr}</span>
        ${durText}
      </div>
      <div style="font-size:0.85rem; line-height:1.45;">
        <div><strong>🟢 ${item.startTimeStr}</strong> · ${item.startStopName}</div>
        <div><strong>🏁 ${item.endTimeStr}</strong> · ${item.endStopName}</div>
      </div>
      <button class="btn-secondary" style="width:100%; margin-top:4px; min-height:38px; font-size:0.82rem;">${t("repeatTrip")}</button>
    `;

    card.querySelector("button").addEventListener("click", () => {
      state.direction = item.direction;
      document.getElementById("selectDirection").value = item.direction;
      ROUTE_STOPS = item.direction === 'IDA' ? STOPS_IDA : STOPS_VUELTA;
      populateStopsDropdowns();
      document.getElementById("selectStartStop").value = item.startStopId;
      state.startStopId = item.startStopId;
      state.userTouchedStartStop = true;
      document.getElementById("selectEndStop").value = item.endStopId;
      state.endStopId = item.endStopId;
      updateDepartureSchedule();
      updateSetupSummary();
      switchTab("tabInicio");
    });

    container.appendChild(card);
  });
}

function saveActiveStateToStorage() {
  if (state.isTripActive) {
    localStorage.setItem("activeTripState", JSON.stringify({
      ...state,
      tripStartTime: state.tripStartTime ? state.tripStartTime.toISOString() : null
    }));
  } else {
    localStorage.removeItem("activeTripState");
  }
}

function restoreSessionIfExists() {
  const saved = localStorage.getItem("activeTripState");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state = { ...state, ...parsed, tripStartTime: new Date(parsed.tripStartTime) };
      ROUTE_STOPS = state.direction === "IDA" ? STOPS_IDA : STOPS_VUELTA;
      if (state.isTripActive) {
        enterActiveTripMode();
      }
    } catch (e) {}
  }
}

function enterActiveTripMode() {
  document.getElementById("mainShell").classList.add("hidden");
  document.getElementById("activeTripScreen").classList.remove("hidden");
  document.getElementById("tripBottomSheet").classList.remove("minimized");
  requestWakeLock();
  populateActiveChangeEndDropdown();
  initFullInteractiveMap();
  buildStaticStreetRoute();
  initGPS();
  updateClockAndETA();
}

function syncGpsPositionToClosestStop() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    state.lastLat = pos.coords.latitude;
    state.lastLng = pos.coords.longitude;
    state.gpsAccuracy = pos.coords.accuracy;
    state.isGpsLive = true;
    updateBusMarkerSignalVisual();

    let closestIdx = 0;
    let minDistance = Infinity;
    for (let i = 0; i < ROUTE_STOPS.length; i++) {
      const d = calculateDistanceKm(state.lastLat, state.lastLng, ROUTE_STOPS[i].lat, ROUTE_STOPS[i].lng);
      if (d < minDistance) { minDistance = d; closestIdx = i; }
    }
    state.currentBaseIndex = closestIdx;
    state.atStop = Math.round(minDistance * 1000) <= 50;
    saveActiveStateToStorage();
    populateActiveChangeEndDropdown();
    renderStopMarkersOnMap();
    focusMapOnBusAndNextStop();
    updateClockAndETA();
  }, () => {
    state.isGpsLive = false;
    updateBusMarkerSignalVisual();
  }, { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 });
}

function updateDepartureSchedule() {
  const now = new Date();
  const currentMinOfDay = now.getHours() * 60 + now.getMinutes();
  const startMinBus = state.direction === "IDA" ? (7 * 60 + 12) : (6 * 60 + 0);
  const lastMinBus = 21 * 60 + 30;
  const startObj = ROUTE_STOPS.find(s => s.id === state.startStopId);
  const offsetMinsToStop = Math.max(0, (startObj ? startObj.stdMin : 0));

  if (currentMinOfDay < startMinBus + offsetMinsToStop) {
    const nextPassMin = startMinBus + offsetMinsToStop;
    document.getElementById("setupServiceStatus").innerText = `Primer bus pasa a las ${Math.floor(nextPassMin/60)}:${String(Math.round(nextPassMin%60)).padStart(2,'0')} hrs`;
    document.getElementById("setupNextDepartureMinutes").innerText = `En ${Math.round(nextPassMin - currentMinOfDay)} min`;
  } else if (currentMinOfDay > lastMinBus + offsetMinsToStop) {
    document.getElementById("setupServiceStatus").innerText = "Fuera de horario habitual";
    document.getElementById("setupNextDepartureMinutes").innerText = "-- min";
  } else {
    let nextDep = startMinBus;
    while ((nextDep + offsetMinsToStop) <= currentMinOfDay && nextDep <= lastMinBus) { nextDep += 15; }
    const nextPassMin = nextDep + offsetMinsToStop;
    document.getElementById("setupNextDepartureMinutes").innerText = `En ${Math.max(1, Math.round(nextPassMin - currentMinOfDay))} min`;
    document.getElementById("setupServiceStatus").innerText = `Frecuencia estimada cada 15 min`;
  }
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function updateCompass(userLat, userLng) {
  const startObj = ROUTE_STOPS.find(s => s.id === state.startStopId);
  if (!startObj) return;
  const distMeters = Math.round(calculateDistanceKm(userLat, userLng, startObj.lat, startObj.lng) * 1000);
  document.getElementById("compassArrow").style.transform = `rotate(${calculateBearing(userLat, userLng, startObj.lat, startObj.lng)}deg)`;
  document.getElementById("compassTitle").innerText = `${startObj.name}`;
  document.getElementById("compassDesc").innerText = `A ${distMeters} m · Toca para ver mapa peatonal`;
}

function openPedestrianModal() {
  document.getElementById("pedestrianModal").classList.add("active");
  if (!pedestrianMap) {
    pedestrianMap = L.map('pedestrianMap').setView([-33.3605, -71.6649], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pedestrianMap);
    pedestrianPersonMarker = L.marker([-33.3605, -71.6649], {
      icon: L.divIcon({ html: '🚶‍♂️', className: '', iconSize: [26, 26] })
    }).addTo(pedestrianMap);
    pedestrianStopMarker = L.marker([-33.3605, -71.6649], {
      icon: L.divIcon({ html: '📍', className: '', iconSize: [26, 26] })
    }).addTo(pedestrianMap);
  }
  const startObj = ROUTE_STOPS.find(s => s.id === state.startStopId);
  if (startObj) pedestrianStopMarker.setLatLng([startObj.lat, startObj.lng]);
  if (state.lastLat && state.lastLng && startObj) {
    pedestrianPersonMarker.setLatLng([state.lastLat, state.lastLng]);
    pedestrianMap.fitBounds([[state.lastLat, state.lastLng], [startObj.lat, startObj.lng]], { padding: [40, 40] });
  }
  setTimeout(() => { pedestrianMap.invalidateSize(); }, 300);
}

function initPassiveGPS() {
  if ("geolocation" in navigator) {
    navigator.geolocation.watchPosition((pos) => {
      state.lastLat = pos.coords.latitude;
      state.lastLng = pos.coords.longitude;
      state.gpsAccuracy = pos.coords.accuracy;
      state.isGpsLive = true;
      updateBusMarkerSignalVisual();

      if (!state.isTripActive) {
        updateCompass(state.lastLat, state.lastLng);
        if (pedestrianPersonMarker && pedestrianMap) pedestrianPersonMarker.setLatLng([state.lastLat, state.lastLng]);
        let nearestStop = null, minDist = 999;
        ROUTE_STOPS.forEach((s) => {
          const d = calculateDistanceKm(state.lastLat, state.lastLng, s.lat, s.lng);
          if (d < minDist) { minDist = d; nearestStop = s; }
        });
        if (minDist <= 0.25) {
          updateHeaderGreeting(nearestStop);
          if (!state.userTouchedStartStop) {
            state.currentBaseIndex = ROUTE_STOPS.findIndex(s => s.id === nearestStop.id);
            document.getElementById("selectStartStop").value = nearestStop.id;
            state.startStopId = nearestStop.id;
            updateSetupSummary();
          }
        } else {
          updateHeaderGreeting(null);
        }
      }
    }, () => {
      state.isGpsLive = false;
      updateBusMarkerSignalVisual();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 6000 });
  }
}

function startTrip() {
  state.isTripActive = true;
  state.autoFollowMap = true;
  state.tripStartTime = new Date();
  state.totalSpeedReadings = 0;
  state.sumSpeedReadings = 0;
  state.currentSpeedKmh = 0;
  state.avgSpeedKmh = 0;
  state.alert2StopsTriggered = false;
  state.alert1StopTriggered = false;
  state.alertArrivedTriggered = false;

  state.startStopId = document.getElementById("selectStartStop").value;
  state.endStopId = document.getElementById("selectEndStop").value;
  const baseIndex = ROUTE_STOPS.findIndex(s => s.id === state.startStopId);
  state.currentBaseIndex = baseIndex !== -1 ? baseIndex : 0;
  state.originStopObj = ROUTE_STOPS[state.currentBaseIndex];
  state.atStop = true;

  saveActiveStateToStorage();
  enterActiveTripMode();
}

function initGPS() {
  if ("geolocation" in navigator) {
    if (state.watchPositionId) navigator.geolocation.clearWatch(state.watchPositionId);
    state.watchPositionId = navigator.geolocation.watchPosition((pos) => {
      state.isGpsLive = true;
      state.gpsAccuracy = pos.coords.accuracy;
      state.lastLat = pos.coords.latitude;
      state.lastLng = pos.coords.longitude;
      updateBusMarkerSignalVisual();

      state.currentSpeedKmh = pos.coords.speed ? (pos.coords.speed * 3.6) : 0;
      document.getElementById("gpsCurrentSpeed").innerText = `${formatSpeed(state.currentSpeedKmh)}`;

      if (state.currentSpeedKmh > 0) {
        state.sumSpeedReadings += state.currentSpeedKmh;
        state.totalSpeedReadings++;
        state.avgSpeedKmh = state.sumSpeedReadings / state.totalSpeedReadings;
        document.getElementById("gpsAvgSpeed").innerText = `${formatSpeed(state.avgSpeedKmh)}`;
      }

      // Snap-to-route: proyectar el pin de la micro sobre la línea de la calle para que no salte por cuadras vecinas
      const snapped = snapPointToPolyline(state.lastLat, state.lastLng, staticStreetCoords, 140);
      state.snappedLat = snapped.lat;
      state.snappedLng = snapped.lng;

      if (busMarker) {
        busMarker.setLatLng([state.snappedLat, state.snappedLng]);
      }

      // Recortar visualmente la polilínea recorrida para que solo muestre lo que falta hacia adelante
      if (routePolyline && snapped.snapped && staticStreetCoords.length > 2) {
        const remainingPoly = [[state.snappedLat, state.snappedLng], ...staticStreetCoords.slice(snapped.index + 1)];
        routePolyline.setLatLngs(remainingPoly);
      }

      // Reorientación por salto brusco (ej. salida de túnel o reconexión)
      let closestIdx = state.currentBaseIndex;
      let minDistance = Infinity;
      for (let i = state.currentBaseIndex; i < ROUTE_STOPS.length; i++) {
        const d = calculateDistanceKm(state.lastLat, state.lastLng, ROUTE_STOPS[i].lat, ROUTE_STOPS[i].lng);
        if (d < minDistance) { minDistance = d; closestIdx = i; }
      }
      if (Math.round(minDistance * 1000) > 350 && closestIdx > state.currentBaseIndex) {
        state.currentBaseIndex = closestIdx;
        state.atStop = false;
        saveActiveStateToStorage();
        populateActiveChangeEndDropdown();
        renderStopMarkersOnMap();
      }

      let targetStop = ROUTE_STOPS[state.currentBaseIndex];
      if (!targetStop) return;
      let distToTarget = Math.round(calculateDistanceKm(state.lastLat, state.lastLng, targetStop.lat, targetStop.lng) * 1000);

      // GEOCERCAS CORREGIDAS:
      // 1) Al entrar a <= 50m: atStop = true, pero NO incrementa el índice (muestra la parada donde estás bajando).
      // 2) Al salir a > 75m: atStop = false y AHORA sí avanza el índice a la siguiente parada.
      let stopIndexChanged = false;
      if (state.atStop) {
        if (distToTarget > 75) {
          state.atStop = false;
          if (state.currentBaseIndex < ROUTE_STOPS.length - 1) {
            state.currentBaseIndex++;
            stopIndexChanged = true;
            saveActiveStateToStorage();
            populateActiveChangeEndDropdown();
            renderStopMarkersOnMap();
          }
        }
      } else {
        if (distToTarget <= 50) {
          state.atStop = true;
        }
      }

      targetStop = ROUTE_STOPS[state.currentBaseIndex];
      if (!targetStop) return;
      distToTarget = Math.round(calculateDistanceKm(state.lastLat, state.lastLng, targetStop.lat, targetStop.lng) * 1000);

      const dynamicLabel = document.getElementById("stopDynamicLabel");
      const distanceContainer = document.getElementById("activeNextStopDistance");
      const statusCard = document.getElementById("stopStatusCard");
      document.getElementById("activeNextStopName").innerText = targetStop.name;
      document.getElementById("miniStopPreview").innerText = `${state.atStop ? '🛑' : '➡'} ${targetStop.name}`;

      if (state.atStop) {
        dynamicLabel.innerText = "🛑 PARADA ACTUAL";
        dynamicLabel.style.color = "#35B779";
        statusCard.style.borderLeftColor = "#35B779";
        distanceContainer.innerText = "En paradero";
      } else if (distToTarget <= 150) {
        dynamicLabel.innerText = "⚠️ LLEGANDO A PARADA";
        dynamicLabel.style.color = "#F5A623";
        statusCard.style.borderLeftColor = "#F5A623";
        distanceContainer.innerText = `${distToTarget} m`;
      } else {
        dynamicLabel.innerText = "➡ PARADA SIGUIENTE";
        dynamicLabel.style.color = "#087E8B";
        statusCard.style.borderLeftColor = "#087E8B";
        distanceContainer.innerText = `${distToTarget} m`;
      }

      // Cálculo exacto de paradas restantes (sin adelanto)
      const endIndex = ROUTE_STOPS.findIndex(s => s.id === state.endStopId);
      const stopsRemaining = Math.max(0, endIndex - state.currentBaseIndex);
      const destStopName = ROUTE_STOPS[endIndex] ? ROUTE_STOPS[endIndex].name : "tu destino";
      const sheet = document.getElementById("tripBottomSheet");

      sheet.classList.remove("alert-approaching", "alert-arrived");

      if (stopsRemaining === 0 && state.atStop) {
        sheet.classList.add("alert-arrived");
        dynamicLabel.innerText = "📍 ¡BAJA AQUÍ! DESTINO ALCANZADO";
        if (!state.alertArrivedTriggered) {
          state.alertArrivedTriggered = true;
          playAlertBeep(880, 0.8);
          triggerSystemNotification("📍 ¡LLEGASTE A TU DESTINO!", `¡Bájate aquí en: ${destStopName}!`, [500, 200, 500, 200, 500]);
        }
      } else if (stopsRemaining === 1 && !state.atStop) {
        sheet.classList.add("alert-approaching");
        dynamicLabel.innerText = "🔔 ¡PREPÁRATE PARA BAJAR! (Siguiente parada)";
        if (!state.alert1StopTriggered) {
          state.alert1StopTriggered = true;
          playAlertBeep(660, 0.5);
          triggerSystemNotification("⚠️ ¡ATENCIÓN! PRÓXIMA PARADA", `Te bajas en la siguiente parada: ${destStopName}`, [400, 150, 400]);
        }
      } else if (stopsRemaining === 2 && !state.atStop) {
        sheet.classList.add("alert-approaching");
        dynamicLabel.innerText = "🔔 ¡PREPÁRATE PARA BAJAR! (Faltan 2 paradas)";
        if (!state.alert2StopsTriggered) {
          state.alert2StopsTriggered = true;
          playAlertBeep(440, 0.3);
          triggerSystemNotification("🔔 ¡PREPÁRATE PARA BAJAR!", `Faltan 2 paradas para: ${destStopName}`, [200, 100, 200]);
        }
      }

      if (stopIndexChanged || state.autoFollowMap) {
        focusMapOnBusAndNextStop();
      }
    }, () => {
      state.isGpsLive = false;
      updateBusMarkerSignalVisual();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 6000 });
  }
}

function updateClockAndETA() {
  if (!state.isTripActive) { updateDepartureSchedule(); return; }

  const endObj = ROUTE_STOPS.find(s => s.id === state.endStopId);
  const currObj = ROUTE_STOPS[state.currentBaseIndex];
  const endIndex = ROUTE_STOPS.findIndex(s => s.id === state.endStopId);
  const stopsRemaining = Math.max(0, endIndex - state.currentBaseIndex);
  const kmLeft = currObj && endObj ? Math.max(0.1, calculateDistanceKm(currObj.lat, currObj.lng, endObj.lat, endObj.lng) * 1.25) : 0;

  const etaResult = calculateEta(currObj, endObj, state.direction, {
    tripStartTime: state.tripStartTime,
    originStop: state.originStopObj
  });

  const etaTime = new Date(new Date().getTime() + etaResult.minutes * 60000);
  const formattedEta = etaTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });

  document.getElementById("etaBoxTime").innerText = formattedEta;
  document.getElementById("miniEtaPreview").innerText = `${formattedEta} · ▲`;
  document.getElementById("topStopsLeft").innerText = stopsRemaining;

  const unitStr = state.speedUnit === "mph" ? "mi" : "km";
  const remWord = state.lang === "en" ? "remaining" : "restantes";
  document.getElementById("etaDistRemainingText").innerText = `${formatDistanceValue(kmLeft)} ${unitStr} ${remWord}`;

  document.getElementById("etaTimeLeft").innerText = etaResult.minutes >= 60
    ? `${Math.floor(etaResult.minutes / 60)}h ${etaResult.minutes % 60}m`
    : `${etaResult.minutes} min`;

  const badge = document.getElementById("punctualityBadge");
  if (badge) {
    badge.className = "punctuality-badge";
    if (etaResult.status === "early") {
      badge.classList.add("punctuality-early");
      badge.innerText = `${t("early")} (${Math.abs(etaResult.deltaMinutes)} min)`;
    } else if (etaResult.status === "delayed") {
      badge.classList.add("punctuality-delayed");
      badge.innerText = `${t("delayed")} (+${etaResult.deltaMinutes} min)`;
    } else {
      badge.classList.add("punctuality-ontime");
      badge.innerText = t("ontime");
    }
  }

  document.getElementById("segmentTime").innerText = `${Math.max(1, Math.round((new Date() - state.tripStartTime) / 60000))}`;
}

function cancelTrip() {
  if (state.watchPositionId) navigator.geolocation.clearWatch(state.watchPositionId);
  releaseWakeLock();
  state.isTripActive = false;
  saveActiveStateToStorage();
  exitActiveTripMode();
}

function finishTrip() {
  const endObj = ROUTE_STOPS[state.currentBaseIndex] || ROUTE_STOPS.find(s => s.id === state.endStopId);
  recordCompletedTrip(endObj);

  const toast = document.getElementById("toastNotification");
  document.getElementById("toastMessage").innerText = `Te bajaste en: ${endObj ? endObj.name : 'tu destino'}.`;
  toast.classList.add("active");
  setTimeout(() => { toast.classList.remove("active"); }, 4000);

  if (state.watchPositionId) navigator.geolocation.clearWatch(state.watchPositionId);
  releaseWakeLock();
  state.isTripActive = false;
  saveActiveStateToStorage();
  exitActiveTripMode();
}

function exitActiveTripMode() {
  state.userTouchedStartStop = false;
  document.getElementById("activeTripScreen").classList.add("hidden");
  document.getElementById("mainShell").classList.remove("hidden");
  switchTab("tabInicio");
  updateHeaderGreeting(null);
  updateSetupSummary();
}
