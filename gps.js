let wakeLock = null;

export async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {}
  }
}

export function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().then(() => { wakeLock = null; }); }
}

export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function evaluateGpsSignal(accuracyMeters, isOnline) {
  if (!isOnline || accuracyMeters === null || accuracyMeters === undefined) {
    return { level: 'bad', color: '#EF4444', label: 'Sin señal GPS (Aprox.)' };
  }
  if (accuracyMeters <= 35) {
    return { level: 'good', color: '#35B779', label: 'Señal GPS Óptima' };
  }
  if (accuracyMeters <= 85) {
    return { level: 'weak', color: '#F5A623', label: 'Señal GPS Débil' };
  }
  return { level: 'bad', color: '#EF4444', label: 'Ubicación Aproximada' };
}

export function createBusPinSvg(color) {
  return `
    <svg width="48" height="58" viewBox="0 0 48 58" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 4px 8px rgba(0,0,0,0.35));">
      <!-- Ondas Wi-Fi superiores -->
      <path d="M15 9C20 4.5 28 4.5 33 9" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M18.5 13C21.8 10 26.2 10 29.5 13" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>
      <!-- Pin cuerpo -->
      <path d="M24 16C15.163 16 8 23.163 8 32C8 42.5 24 55 24 55C24 55 40 42.5 40 32C40 23.163 32.837 16 24 16Z" fill="${color}" stroke="#FFFFFF" stroke-width="2.5"/>
      <!-- Círculo interior blanco -->
      <circle cx="24" cy="31" r="10.5" fill="#FFFFFF"/>
      <!-- Ícono Micro en el centro -->
      <rect x="18.5" y="25.5" width="11" height="10" rx="2" fill="#102A43"/>
      <rect x="20" y="27" width="8" height="4" rx="0.8" fill="#38BDF8"/>
      <circle cx="20.8" cy="33.5" r="1.1" fill="#FFFFFF"/>
      <circle cx="27.2" cy="33.5" r="1.1" fill="#FFFFFF"/>
    </svg>
  `;
}
