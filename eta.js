import { STOPS_IDA, STOPS_VUELTA } from './stops.js';
import { calculateDistanceKm } from './gps.js';

const ANCHOR_SEGMENT_MINUTES = 80; // 1:20:00 exactos entre Aguas Marinas y Paradero 9

function computeRouteArcKm(stopsList, fromIdx, toIdx) {
  const start = Math.min(fromIdx, toIdx);
  const end = Math.max(fromIdx, toIdx);
  if (start < 0 || end >= stopsList.length || start >= end) return 0;

  let total = 0;
  for (let i = start; i < end; i++) {
    total += calculateDistanceKm(
      stopsList[i].lat,
      stopsList[i].lng,
      stopsList[i + 1].lat,
      stopsList[i + 1].lng
    );
  }
  return total;
}

function findAnchorIndices(stopsList) {
  const idxAguas = stopsList.findIndex(s =>
    s.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("aguas marinas")
  );
  const idxParadero9 = stopsList.findIndex(s => {
    const clean = s.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return clean.includes("paradero 9") || clean.includes("parada 9");
  });
  return { idxAguas, idxParadero9 };
}

export function getBaseDurationMinutes(startStop, endStop, direction = 'IDA') {
  if (!startStop || !endStop || startStop.id === endStop.id) return 0;
  const list = direction === 'VUELTA' ? STOPS_VUELTA : STOPS_IDA;
  const startIdx = list.findIndex(s => s.id === startStop.id);
  const endIdx = list.findIndex(s => s.id === endStop.id);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const segmentKm = computeRouteArcKm(list, startIdx, endIdx);
    const { idxAguas, idxParadero9 } = findAnchorIndices(list);

    // Calibrar usando el tramo real Aguas Marinas <-> Paradero 9 = 80 min
    if (idxAguas !== -1 && idxParadero9 !== -1 && idxAguas !== idxParadero9) {
      const anchorKm = computeRouteArcKm(list, idxAguas, idxParadero9);
      if (anchorKm > 0) {
        const minsPerKm = ANCHOR_SEGMENT_MINUTES / anchorKm;
        return Math.max(1, Math.round(segmentKm * minsPerKm));
      }
    }

    // Respaldo proporcional si no se encontraran las paradas ancla
    const totalRouteKm = computeRouteArcKm(list, 0, list.length - 1);
    if (totalRouteKm > 0) {
      return Math.max(1, Math.round((segmentKm / totalRouteKm) * 115));
    }
  }

  const diff = Math.abs((endStop.stdMin || 0) - (startStop.stdMin || 0));
  return Math.max(1, Math.round(diff));
}

export function calculateEta(startStop, endStop, direction = 'IDA', liveContext = null) {
  const baseRemainingMins = getBaseDurationMinutes(startStop, endStop, direction);
  if (!liveContext || !liveContext.tripStartTime || !liveContext.originStop) {
    return {
      minutes: baseRemainingMins,
      status: 'ontime',
      deltaMinutes: 0
    };
  }

  const elapsedMins = (Date.now() - liveContext.tripStartTime.getTime()) / 60000;
  const scheduledElapsedMins = getBaseDurationMinutes(liveContext.originStop, startStop, direction);

  if (elapsedMins < 1.5 || scheduledElapsedMins < 1) {
    return {
      minutes: baseRemainingMins,
      status: 'ontime',
      deltaMinutes: 0
    };
  }

  const paceRatio = Math.min(1.65, Math.max(0.65, elapsedMins / scheduledElapsedMins));
  const dynamicRemainingMins = Math.max(1, Math.round(baseRemainingMins * paceRatio));

  const totalPlannedMins = getBaseDurationMinutes(liveContext.originStop, endStop, direction);
  const projectedTotalMins = elapsedMins + dynamicRemainingMins;
  const deltaMinutes = Math.round(projectedTotalMins - totalPlannedMins);

  let status = 'ontime';
  if (deltaMinutes <= -2) status = 'early';
  else if (deltaMinutes >= 3) status = 'delayed';

  return {
    minutes: dynamicRemainingMins,
    status,
    deltaMinutes
  };
}
