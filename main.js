import { STOPS_IDA, STOPS_VUELTA } from './stops.js';
import { calculateEta } from './eta.js';
import { playAlertBeep, triggerSystemNotification } from './notifications.js';
import { requestWakeLock, releaseWakeLock, calculateDistanceKm } from './gps.js';

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
    }).catch(err => console.log('SW error:', err));
  });
}

let ROUTE_STOPS = STOPS_IDA;
let state = {
  userName: localStorage.getItem("userName") || "Pasajero",
  theme: localStorage.getItem("appTheme") || "auto",
  direction: "IDA",
  startStopId: STOPS_IDA[0].id,
  endStopId: STOPS_IDA[STOPS_IDA.length - 1].id,
  isTripActive: false,
  currentBaseIndex: 0,
  atStop: false,
  isGpsLive: false,
  userTouchedStartStop: false,
  tripStartTime: null,
  watchPositionId: null,
  currentSpeed: 0,
  avgSpeed: 0,
  totalSpeedReadings: 0,
  sumSpeedReadings: 0,
  lastLat: null,
  lastLng: null,
  alert2StopsTriggered: false,
  alert1StopTriggered: false,
  alertArrivedTriggered: false,
  favorites: JSON.parse(localStorage.getItem("favorites") || "[]"),
  recentDestinations: JSON.parse(localStorage.getItem("recentDestinations") || "[]")
};

let realMap = null;
let busMarker = null;
let nextStopMarker = null;
let pedestrianMap = null;
let pedestrianPersonMarker = null;
let pedestrianStopMarker = null;

document.addEventListener("DOMContentLoaded", () => {
  checkAutoTheme();
  initUI();
  checkPermissionsStatus();
  checkUrlShortcuts();
  restoreSessionIfExists();
  renderFavorites();
  renderRecentDestinations();
  initLeafletMap();

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.isTripActive) {
      requestWakeLock();
      syncGpsPositionToClosestStop();
    }
  });
});

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
  checkPermissionsStatus();
}

function initUI() {
  document.getElementById("btnThemeToggle").addEventListener("click", () => {
    applyTheme(document.body.classList.contains("light-mode") ? "dark" : "light");
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
    updateHeaderGreeting(null);
    updateClockAndETA();
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

function initLeafletMap() {
  realMap = L.map('realMap', {
    dragging: false, touchZoom: false, scrollWheelZoom: false,
    doubleClickZoom: false, boxZoom: false, tap: false, zoomControl: false
  }).setView([-33.3605, -71.6649], 16);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(realMap);

  const busIcon = L.divIcon({ html: '🚌', className: 'map-blue-bus-icon', iconSize: [26, 26] });
  const stopIcon = L.divIcon({ html: '📍', className: 'map-stop-icon', iconSize: [24, 24] });

  busMarker = L.marker([-33.3605, -71.6649], { icon: busIcon }).addTo(realMap);
  nextStopMarker = L.marker([-33.3605, -71.6649], { icon: stopIcon }).addTo(realMap);
}

function updateHeaderGreeting(nearestStop) {
  const title = document.getElementById("headerGreeting");
  const sub = document.getElementById("headerSub");
  if (state.isTripActive) {
    title.innerText = `🚌 Viajando con ${state.userName}`;
    sub.innerText = state.isGpsLive ? "🟢 En Ruta | Señal Fuerte" : "⚠️ GPS Buscando Señal...";
    sub.style.color = state.isGpsLive ? "var(--success)" : "var(--warning)";
  } else {
    title.innerText = `¡Hola, ${state.userName}!`;
    if (nearestStop) {
      sub.innerText = `📍 Cerca de: ${nearestStop.name}`;
      sub.style.color = "var(--success)";
    } else {
      sub.innerText = `⚠️ Estás fuera de la ruta.`;
      sub.style.color = "var(--warning)";
    }
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
  const estMins = calculateEta(startObj, endObj);

  const now = new Date();
  const arrivalTime = new Date(now.getTime() + estMins * 60000);
  document.getElementById("setupTripEta").innerText = `${arrivalTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
  document.getElementById("setupTripStops").innerText = `${stopsCount}`;
  document.getElementById("setupTripKm").innerText = `${kmDist.toFixed(1)}`;
}

function addRecentDestination(stopId) {
  const stop = ROUTE_STOPS.find(s => s.id === stopId);
  if (!stop) return;
  state.recentDestinations = state.recentDestinations.filter(d => d.id !== stopId);
  state.recentDestinations.unshift({ id: stop.id, name: stop.name, direction: state.direction });
  if (state.recentDestinations.length > 4) state.recentDestinations.pop();
  localStorage.setItem("recentDestinations", JSON.stringify(state.recentDestinations));
  renderRecentDestinations();
}

function renderRecentDestinations() {
  const container = document.getElementById("recentDestinationsChips");
  const wrapper = document.getElementById("recentDestinationsContainer");
  container.innerHTML = "";

  if (state.recentDestinations.length === 0) {
    wrapper.classList.add("hidden");
    return;
  }
  wrapper.classList.remove("hidden");

  state.recentDestinations.forEach(dest => {
    const chip = document.createElement("button");
    chip.className = "btn btn-secondary";
    chip.style.cssText = "width: auto; padding: 6px 12px; font-size: 0.75rem; border-radius: 12px; background: rgba(56,189,248,0.1); border-color: rgba(56,189,248,0.3); color: var(--accent) !important;";
    chip.innerText = `🎯 ${dest.name}`;
    chip.addEventListener("click", () => {
      state.direction = dest.direction;
      document.getElementById("selectDirection").value = dest.direction;
      ROUTE_STOPS = dest.direction === 'IDA' ? STOPS_IDA : STOPS_VUELTA;
      populateStopsDropdowns();
      document.getElementById("selectEndStop").value = dest.id;
      state.endStopId = dest.id;
      updateSetupSummary();
    });
    container.appendChild(chip);
  });
}

function saveFavoriteRoute() {
  const favName = document.getElementById("favNameInput").value.trim() || "Ruta Frecuente";
  state.favorites.push({ id: Date.now(), name: favName, direction: state.direction, startStopId: state.startStopId, endStopId: state.endStopId });
  localStorage.setItem("favorites", JSON.stringify(state.favorites));
  document.getElementById("favNameInput").value = "";
  renderFavorites();
}

function renderFavorites() {
  const container = document.getElementById("favoritesList");
  container.innerHTML = "";
  if (state.favorites.length === 0) {
    container.innerHTML = `<div style="font-size:0.75rem; color:var(--muted);">No has guardado rutas aún.</div>`;
    return;
  }
  state.favorites.forEach(fav => {
    const item = document.createElement("div");
    item.style.cssText = "background:rgba(255,255,255,0.04); padding:10px 14px; border-radius:14px; border:1px solid var(--glass-border); display:flex; justify-content:space-between; align-items:center;";
    item.innerHTML = `
      <div>
        <div style="font-size:0.9rem; font-weight:800; color:var(--text);">${fav.name}</div>
        <div style="font-size:0.7rem; color:var(--accent); font-weight:600;">${fav.direction === 'IDA' ? 'Hacia Tejas Verdes' : 'Hacia El Yeco'}</div>
      </div>
      <button class="btn btn-secondary" style="width:auto; padding:6px 12px; font-size:0.75rem; border-radius:10px;">Cargar</button>
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
    });
    container.appendChild(item);
  });
}

function saveActiveStateToStorage() {
  if (state.isTripActive) {
    localStorage.setItem("activeTripState", JSON.stringify({ ...state, tripStartTime: state.tripStartTime ? state.tripStartTime.toISOString() : null }));
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
        document.getElementById("viewSetup").classList.add("hidden");
        document.getElementById("viewFavorites").classList.add("hidden");
        document.getElementById("viewActive").classList.remove("hidden");
        document.getElementById("floatingActionBar").classList.remove("hidden");
        requestWakeLock();
        populateActiveChangeEndDropdown();
        initGPS();
        renderFixedMetroMap();
        updateHeaderGreeting(null);
      }
    } catch(e) {}
  }
}

function syncGpsPositionToClosestStop() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    state.lastLat = lat;
    state.lastLng = lng;
    setGpsLiveStatus(true);
    if (realMap && busMarker) { realMap.setView([lat, lng], 16); busMarker.setLatLng([lat, lng]); }

    let closestIdx = 0;
    let minDistance = Infinity;
    for (let i = 0; i < ROUTE_STOPS.length; i++) {
      const d = calculateDistanceKm(lat, lng, ROUTE_STOPS[i].lat, ROUTE_STOPS[i].lng);
      if (d < minDistance) { minDistance = d; closestIdx = i; }
    }
    state.currentBaseIndex = closestIdx;
    saveActiveStateToStorage();
    populateActiveChangeEndDropdown();
    renderFixedMetroMap();
    updateClockAndETA();
  }, () => { setGpsLiveStatus(false); }, { enableHighAccuracy: true, timeout: 6000, maximumAge: 0 });
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
    document.getElementById("setupServiceStatus").innerText = "⚠️ Fuera de horario";
    document.getElementById("setupNextDepartureMinutes").innerText = "-- min";
  } else {
    let nextDep = startMinBus;
    while ((nextDep + offsetMinsToStop) <= currentMinOfDay && nextDep <= lastMinBus) { nextDep += 15; }
    const nextPassMin = nextDep + offsetMinsToStop;
    document.getElementById("setupNextDepartureMinutes").innerText = `En ${Math.max(1, Math.round(nextPassMin - currentMinOfDay))} min`;
    document.getElementById("setupServiceStatus").innerText = `🟢 Frecuencia regular (~15 min)`;
  }
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) - Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function updateCompass(userLat, userLng) {
  const startObj = ROUTE_STOPS.find(s => s.id === state.startStopId);
  if (!startObj) return;
  const distMeters = Math.round(calculateDistanceKm(userLat, userLng, startObj.lat, startObj.lng) * 1000);
  document.getElementById("compassArrow").style.transform = `rotate(${calculateBearing(userLat, userLng, startObj.lat, startObj.lng)}deg)`;
  document.getElementById("compassTitle").innerText = `${startObj.name}`;
  document.getElementById("compassDesc").innerText = `A ${distMeters} m (Toca para mapa)`;
}

function openPedestrianModal() {
  document.getElementById("pedestrianModal").classList.add("active");
  if (!pedestrianMap) {
    pedestrianMap = L.map('pedestrianMap').setView([-33.3605, -71.6649], 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(pedestrianMap);
    pedestrianPersonMarker = L.marker([-33.3605, -71.6649], { icon: L.divIcon({ html: '🚶‍♂', className: 'map-person-icon', iconSize: [26, 26] }) }).addTo(pedestrianMap);
    pedestrianStopMarker = L.marker([-33.3605, -71.6649], { icon: L.divIcon({ html: '📍', className: 'map-stop-icon', iconSize: [26, 26] }) }).addTo(pedestrianMap);
  }
  const startObj = ROUTE_STOPS.find(s => s.id === state.startStopId);
  if (startObj) pedestrianStopMarker.setLatLng([startObj.lat, startObj.lng]);
  if (state.lastLat && state.lastLng) {
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
      if (!state.isTripActive) {
        updateCompass(state.lastLat, state.lastLng);
        if (pedestrianPersonMarker && pedestrianMap) pedestrianPersonMarker.setLatLng([state.lastLat, state.lastLng]);
        let nearestStop = null, minDist = 999;
        ROUTE_STOPS.forEach((s) => {
          const d = calculateDistanceKm(state.lastLat, state.lastLng, s.lat, s.lng);
          if (d < minDist) { minDist = d; nearestStop = s; }
        });
        if (minDist <= 0.20) {
          updateHeaderGreeting(nearestStop);
          if (!state.userTouchedStartStop) {
            state.currentBaseIndex = ROUTE_STOPS.findIndex(s => s.id === nearestStop.id);
            document.getElementById("selectStartStop").value = nearestStop.id;
            state.startStopId = nearestStop.id;
          }
        } else { updateHeaderGreeting(null); }
      }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 });
  }
}

function setGpsLiveStatus(isLive) {
  state.isGpsLive = isLive;
  const dot = document.getElementById("gpsPulseDot");
  const txt = document.getElementById("gpsStatusText");
  if (isLive) {
    dot.className = "pulse-dot pulse-green";
    txt.innerText = "En Vivo";
    txt.style.color = "var(--success)";
  } else {
    dot.className = "pulse-dot pulse-red";
    txt.innerText = "Offline";
    txt.style.color = "var(--danger)";
  }
  updateHeaderGreeting(null);
}

function startTrip() {
  state.isTripActive = true;
  state.tripStartTime = new Date();
  state.totalSpeedReadings = 0;
  state.sumSpeedReadings = 0;
  state.alert2StopsTriggered = false;
  state.alert1StopTriggered = false;
  state.alertArrivedTriggered = false;

  state.startStopId = document.getElementById("selectStartStop").value;
  state.endStopId = document.getElementById("selectEndStop").value;
  const baseIndex = ROUTE_STOPS.findIndex(s => s.id === state.startStopId);
  state.currentBaseIndex = baseIndex !== -1 ? baseIndex : 0;
  state.atStop = true;

  document.getElementById("viewSetup").classList.add("hidden");
  document.getElementById("viewFavorites").classList.add("hidden");
  document.getElementById("viewActive").classList.remove("hidden");
  document.getElementById("floatingActionBar").classList.remove("hidden");

  requestWakeLock();
  populateActiveChangeEndDropdown();
  saveActiveStateToStorage();
  initGPS();
  renderFixedMetroMap();
  updateHeaderGreeting(null);
}

function updateUnifiedAlertPanel(type, title, desc, icon) {
  const panel = document.getElementById("unifiedAlertPanel");
  panel.className = "alert-panel";
  if (type === "speed") panel.classList.add("alert-speed");
  else if (type === "stop") panel.classList.add("alert-stop");
  else if (type === "drop") panel.classList.add("alert-drop");
  else panel.classList.add("alert-normal");
  document.getElementById("alertTitle").innerText = title;
  document.getElementById("alertDesc").innerText = desc;
  document.getElementById("alertIcon").innerText = icon || "🔔";
}

function initGPS() {
  if ("geolocation" in navigator) {
    state.watchPositionId = navigator.geolocation.watchPosition((pos) => {
      setGpsLiveStatus(true);
      state.lastLat = pos.coords.latitude;
      state.lastLng = pos.coords.longitude;
      state.currentSpeed = Math.round(pos.coords.speed ? (pos.coords.speed * 3.6) : 0);
      document.getElementById("gpsCurrentSpeed").innerText = `${state.currentSpeed}`;

      const busEl = document.querySelector('.map-blue-bus-icon');
      if (busEl) {
        if (state.currentSpeed < 5) {
          busEl.style.background = 'var(--warning)';
          busEl.style.boxShadow = '0 0 15px var(--warning)';
        } else {
          busEl.style.background = 'var(--blue-bus)';
          busEl.style.boxShadow = '0 0 15px var(--accent)';
        }
      }

      if (state.currentSpeed > 0) {
        state.sumSpeedReadings += state.currentSpeed;
        state.totalSpeedReadings++;
        state.avgSpeed = Math.round(state.sumSpeedReadings / state.totalSpeedReadings);
        document.getElementById("gpsAvgSpeed").innerText = `${state.avgSpeed}`;
      }

      if (realMap) { realMap.setView([state.lastLat, state.lastLng], 16); if (busMarker) busMarker.setLatLng([state.lastLat, state.lastLng]); }

      // Auto-reorientación si hay gran distancia acumulada
      let closestIdx = state.currentBaseIndex;
      let minDistance = Infinity;
      for (let i = 0; i < ROUTE_STOPS.length; i++) {
        const d = calculateDistanceKm(state.lastLat, state.lastLng, ROUTE_STOPS[i].lat, ROUTE_STOPS[i].lng);
        if (d < minDistance) { minDistance = d; closestIdx = i; }
      }
      if (Math.round(minDistance * 1000) > 300 || closestIdx > state.currentBaseIndex) {
        state.currentBaseIndex = closestIdx;
      }

      let targetStop = ROUTE_STOPS[state.currentBaseIndex];
      if (!targetStop) return;
      let distToTarget = Math.round(calculateDistanceKm(state.lastLat, state.lastLng, targetStop.lat, targetStop.lng) * 1000);

      // MÁQUINA DE ESTADOS Y GEOFENCE BLINDADA CONTRA EL PARPADEO
      if (state.atStop) {
        if (distToTarget > 75) {
          state.atStop = false;
        }
      } else {
        if (distToTarget <= 50) {
          state.atStop = true;
          if (state.currentBaseIndex < ROUTE_STOPS.length - 1) {
            state.currentBaseIndex++;
            saveActiveStateToStorage();
            populateActiveChangeEndDropdown();
          }
        }
      }

      targetStop = ROUTE_STOPS[state.currentBaseIndex];
      if (!targetStop) return;
      distToTarget = Math.round(calculateDistanceKm(state.lastLat, state.lastLng, targetStop.lat, targetStop.lng) * 1000);

      const dynamicLabel = document.getElementById("stopDynamicLabel");
      const distanceContainer = document.getElementById("activeNextStopDistance");
      document.getElementById("activeNextStopName").innerText = targetStop.name;
      if (realMap && nextStopMarker) nextStopMarker.setLatLng([targetStop.lat, targetStop.lng]);

      if (state.atStop) {
        dynamicLabel.innerText = "🛑 ESTÁS EN LA PARADA"; dynamicLabel.style.color = "var(--success)"; distanceContainer.innerText = "";
      } else if (distToTarget <= 150) {
        dynamicLabel.innerText = "⚠️ LLEGANDO A LA PARADA"; dynamicLabel.style.color = "var(--warning)"; distanceContainer.innerText = `${distToTarget} m`;
      } else {
        dynamicLabel.innerText = "➡ PRÓXIMA PARADA"; dynamicLabel.style.color = "var(--muted)"; distanceContainer.innerText = `+${distToTarget} m`;
      }

      const endIndex = ROUTE_STOPS.findIndex(s => s.id === state.endStopId);
      const stopsRemaining = Math.max(0, endIndex - state.currentBaseIndex);
      const destStopName = ROUTE_STOPS[endIndex] ? ROUTE_STOPS[endIndex].name : "tu destino";

      if (stopsRemaining === 2 && !state.alert2StopsTriggered) {
        state.alert2StopsTriggered = true; playAlertBeep(440, 0.3); triggerSystemNotification("🔔 FALTAN 2 PARADAS", `Prepárate para bajar en: ${destStopName}`, [200, 100, 200]);
      } else if (stopsRemaining === 1 && !state.alert1StopTriggered) {
        state.alert1StopTriggered = true; playAlertBeep(660, 0.5); triggerSystemNotification("⚠️ ¡ATENCIÓN! PRÓXIMA PARADA", `Te bajas en la siguiente parada: ${destStopName}`, [400, 150, 400]);
      } else if (stopsRemaining === 0 && state.atStop && !state.alertArrivedTriggered) {
        state.alertArrivedTriggered = true; playAlertBeep(880, 0.8); triggerSystemNotification("📍 ¡LLEGASTE A TU DESTINO!", `¡Bájate aquí en: ${destStopName}!`, [500, 200, 500, 200, 500]);
      }

      if (state.currentSpeed > 55) {
        updateUnifiedAlertPanel("speed", "Exceso de velocidad (>55 km/h)", "El vehículo supera el límite de seguridad.", "⚠️");
      } else if (stopsRemaining === 0) {
        updateUnifiedAlertPanel("drop", `¡Llegaste! (${destStopName})`, "Has llegado a tu destino. Presiona Terminar.", "📍");
      } else if (state.currentSpeed === 0 && state.atStop) {
        updateUnifiedAlertPanel("stop", "Bus Detenido", `Tomando pasajeros en ${targetStop.name}`, "🛑");
      } else {
        updateUnifiedAlertPanel("normal", "En Ruta", `Faltan ${stopsRemaining} paradas.`, "🟢");
      }

      renderFixedMetroMap();
    }, () => { setGpsLiveStatus(false); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 });
  }
}

function updateClockAndETA() {
  if (!state.isTripActive) { updateDepartureSchedule(); return; }
  
  const endObj = ROUTE_STOPS.find(s => s.id === state.endStopId);
  const currObj = ROUTE_STOPS[state.currentBaseIndex];
  const endIndex = ROUTE_STOPS.findIndex(s => s.id === state.endStopId);
  let stopsRemaining = Math.max(0, endIndex - state.currentBaseIndex);
  let kmLeft = currObj && endObj ? Math.max(0.1, calculateDistanceKm(currObj.lat, currObj.lng, endObj.lat, endObj.lng) * 1.25) : 0;

  let stableMins = calculateEta(currObj, endObj);

  const etaTime = new Date(new Date().getTime() + stableMins * 60000);
  document.getElementById("etaBoxTime").innerText = `${etaTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}`;
  document.getElementById("etaStopsLeft").innerText = stopsRemaining;
  document.getElementById("etaKmLeft").innerText = `${kmLeft.toFixed(1)}`;
  document.getElementById("etaTimeLeft").innerText = stableMins >= 60 ? `${Math.floor(stableMins/60)}h ${stableMins%60}m` : `${stableMins} min`;
  document.getElementById("segmentTime").innerText = `${Math.max(1, Math.round((new Date() - state.tripStartTime) / 60000))}`;
}

function renderFixedMetroMap() {
  const container = document.getElementById("metroFixedNodes");
  const fill = document.getElementById("metroFixedLineFill");
  container.innerHTML = "";
  const total = ROUTE_STOPS.length;
  const displayIndex = state.atStop ? state.currentBaseIndex : Math.max(0, state.currentBaseIndex - 1);
  let startIndex = Math.max(0, displayIndex - 3), endIndex = Math.min(total - 1, displayIndex + 3);
  if (displayIndex < 3) endIndex = Math.min(total - 1, 6);
  else if (displayIndex > total - 4) startIndex = Math.max(0, total - 7);

  ROUTE_STOPS.slice(startIndex, endIndex + 1).forEach((s) => {
    const globalIdx = ROUTE_STOPS.findIndex(item => item.id === s.id);
    const node = document.createElement("div");
    node.className = "metro-fixed-node";
    if (globalIdx < displayIndex) node.classList.add("visited");
    if (globalIdx === displayIndex) node.classList.add("current");
    if (s.id === state.endStopId) node.classList.add("destination");

    const iconContent = (globalIdx === displayIndex) ? '🚌' : '';
    node.innerHTML = `<div class="metro-fixed-circle">${iconContent}</div><div class="metro-fixed-label">${s.name}</div>`;
    container.appendChild(node);
  });
  fill.style.width = `${Math.min(100, Math.max(0, (ROUTE_STOPS.slice(startIndex, endIndex + 1).findIndex(s => s.id === ROUTE_STOPS[displayIndex].id) / (endIndex - startIndex)) * 100))}%`;
}

function cancelTrip() {
  if (state.watchPositionId) navigator.geolocation.clearWatch(state.watchPositionId);
  releaseWakeLock();
  state.isTripActive = false;
  saveActiveStateToStorage();
  resetToSetupView();
}

function finishTrip() {
  const endObj = ROUTE_STOPS[state.currentBaseIndex] || ROUTE_STOPS.find(s => s.id === state.endStopId);
  const toast = document.getElementById("toastNotification");
  document.getElementById("toastMessage").innerText = `Te bajaste en: ${endObj ? endObj.name : 'tu destino'}.`;
  toast.classList.add("active");
  setTimeout(() => { toast.classList.remove("active"); }, 4000);

  if (state.watchPositionId) navigator.geolocation.clearWatch(state.watchPositionId);
  releaseWakeLock();
  state.isTripActive = false;
  saveActiveStateToStorage();
  resetToSetupView();
}

function resetToSetupView() {
  state.userTouchedStartStop = false;
  document.getElementById("viewActive").classList.add("hidden");
  document.getElementById("floatingActionBar").classList.add("hidden");
  document.getElementById("viewSetup").classList.remove("hidden");
  document.getElementById("viewFavorites").classList.remove("hidden");
  updateHeaderGreeting(null);
  updateSetupSummary();
}
