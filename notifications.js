let audioContext = null;

export function playAlertBeep(freq = 587.33, duration = 0.4) {
  try {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioContext.currentTime);
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + duration);
  } catch (e) {}
}

export function triggerSystemNotification(title, body, vibratePattern) {
  if ("vibrate" in navigator && vibratePattern) navigator.vibrate(vibratePattern);
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body: body, icon: 'icon-192.png', tag: 'micro-litoral-alert' });
    } catch(e) {}
  }
}
