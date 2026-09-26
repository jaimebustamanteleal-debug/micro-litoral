function updateDepartureSchedule() {
  const now = new Date();
  const currentMinOfDay = now.getHours() * 60 + now.getMinutes();
  const startMinBus = 7 * 60 + 15; // 7:15 AM
  const lastMinBus = 19 * 60 + 30;  // 7:30 PM

  // Obtener el objeto del paradero de inicio seleccionado por el usuario
  const startObj = ROUTE_STOPS.find(s => s.id === state.startStopId);
  const offsetMinsToStop = startObj ? startObj.stdMin : 0;

  if (currentMinOfDay < startMinBus + offsetMinsToStop) {
    const nextPassMin = startMinBus + offsetMinsToStop;
    const diff = nextPassMin - currentMinOfDay;
    document.getElementById("setupServiceStatus").innerText = `⏰ Primer bus del día pasa por ${startObj ? startObj.name : 'tu parada'} a las ${Math.floor(nextPassMin/60)}:${String(nextPassMin%60).padStart(2,'0')} hrs`;
    document.getElementById("setupNextDepartureMinutes").innerText = `En ${diff} min`;
  } else if (currentMinOfDay > lastMinBus + offsetMinsToStop) {
    document.getElementById("setupServiceStatus").innerText = "⚠️ Fuera de horario de paso (Servicio finalizado por hoy)";
    document.getElementById("setupNextDepartureMinutes").innerText = "En -- min";
  } else {
    // Buscar la próxima salida desde origen que pasará por el paradero del usuario
    let nextDepartureFromOrigin = startMinBus;
    while ((nextDepartureFromOrigin + offsetMinsToStop) <= currentMinOfDay && nextDepartureFromOrigin <= lastMinBus) {
      nextDepartureFromOrigin += 15; // Frecuencia de 15 minutos
    }
    
    const nextPassMin = nextDepartureFromOrigin + offsetMinsToStop;
    const diffMins = nextPassMin - currentMinOfDay;

    document.getElementById("setupNextDepartureMinutes").innerText = `En aprox. ${diffMins} min`;
    document.getElementById("setupServiceStatus").innerText = `🟢 Tiempo estimado de paso por: ${startObj ? startObj.name : 'tu paradero'}`;
  }
}
