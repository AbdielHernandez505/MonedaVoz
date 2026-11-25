/* Moneda Voz — reconocimiento local, audio de confirmación y accesibilidad. */
(() => {
  'use strict';

  const MODEL_PATH = './my_model/';
  const EXPECTED_CLASSES = ['1 peso', '2 pesos', '5 pesos', '10 pesos', '20 pesos', 'Fondo'];
  const STABLE_FRAMES = 5;
  const COOLDOWN_MS = 3000;
  const CONFIRM_FALLBACK_MS = 800;
  const PHRASES = {
    '1 peso': 'Moneda de un peso', '2 pesos': 'Moneda de dos pesos',
    '5 pesos': 'Moneda de cinco pesos', '10 pesos': 'Moneda de diez pesos', '20 pesos': 'Moneda de veinte pesos',
  };
  const byId = (id) => document.getElementById(id);
  const ui = {
    video: byId('camera-video'), viewport: byId('camera-viewport'), placeholder: byId('camera-placeholder'), hint: byId('live-hint'),
    start: byId('start-button'), startLabel: byId('start-label'), switch: byId('switch-camera'), cameraStatus: byId('camera-status'), cameraState: byId('camera-state'),
    result: byId('coin-result'), detection: byId('detection-state'), confidence: byId('confidence-value'), progress: byId('confidence-progress'), bar: byId('confidence-bar'), resultNote: byId('result-note'),
    status: byId('app-status'), error: byId('error-message'), srResult: byId('screenreader-result'), voice: byId('voice-button'), voiceLabel: byId('voice-label'), voiceStatus: byId('voice-status'),
    threshold: byId('confidence-threshold'), thresholdValue: byId('threshold-value'), repeat: byId('repeat-voice-button'), textSize: byId('text-size-button'), topVoice: byId('top-voice-button'), confirmAudio: byId('confirmation-audio')
  };
  const state = {
    model: null, stream: null, cameras: [], deviceId: null, running: false, busy: false, session: 0, raf: 0,
    muted: false, audioActivated: false, voice: null, threshold: Number(ui.threshold.value) / 100,
    candidate: null, frames: 0, lastAnnounced: null, lastAnnouncedAt: -Infinity, lastConfirmedCoin: null, lastVideoTime: -1,
    lastAccessibleResult: '', speechWarningShown: false, confirmationTimer: 0, confirmationGeneration: 0, giantText: false
  };
  const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

  function setStatus(message) { if (ui.status.textContent !== message) ui.status.textContent = message; }
  function cancelSpeech() { if (speechSupported) window.speechSynthesis.cancel(); }
  function chooseVoice() {
    if (!speechSupported) return;
    const voices = window.speechSynthesis.getVoices();
    state.voice = voices.find((voice) => /^es[-_]MX$/i.test(voice.lang)) || voices.find((voice) => /^es([-_]|$)/i.test(voice.lang)) || null;
  }
  function stopConfirmationSound() {
    state.confirmationGeneration += 1;
    window.clearTimeout(state.confirmationTimer);
    if (!ui.confirmAudio) return;
    ui.confirmAudio.onended = null;
    ui.confirmAudio.onerror = null;
    try { ui.confirmAudio.pause(); ui.confirmAudio.currentTime = 0; } catch (error) { console.warn('No se pudo detener el sonido:', error); }
  }
  function unlockAudio() {
    if (!ui.confirmAudio) return;
    try {
      ui.confirmAudio.load();
      const attempt = ui.confirmAudio.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt.then(() => { ui.confirmAudio.pause(); ui.confirmAudio.currentTime = 0; }).catch(() => { /* El archivo se reintentará al confirmar. */ });
      }
    } catch (error) { console.warn('No se pudo desbloquear el audio:', error); }
    if (speechSupported) { window.speechSynthesis.resume(); chooseVoice(); }
  }
  function speak(text) {
    if (!speechSupported || state.muted || !state.audioActivated) return false;
    chooseVoice();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'es-MX'; utterance.rate = 0.92; utterance.pitch = 1; utterance.volume = 1;
    if (state.voice) utterance.voice = state.voice;
    utterance.onerror = (event) => {
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      if (!state.speechWarningShown) { state.speechWarningShown = true; setStatus('El navegador no pudo reproducir la voz. El resultado visual sigue disponible.'); }
    };
    try { window.speechSynthesis.resume(); window.speechSynthesis.speak(utterance); return true; }
    catch (error) { console.warn('No fue posible iniciar la voz:', error); setStatus('La voz no está disponible. Puedes consultar el resultado en pantalla.'); return false; }
  }
  function announceAfterConfirmation(className) {
    if (state.muted || !state.audioActivated) return;
    // Reservar la moneda antes de iniciar el MP3 evita que los siguientes cuadros reinicienlo.
    state.lastAnnounced = className;
    state.lastAnnouncedAt = performance.now();
    const phrase = PHRASES[className];
    const generation = ++state.confirmationGeneration;
    let announced = false;
    const announce = () => {
      if (announced || generation !== state.confirmationGeneration || state.muted) return;
      announced = true;
      window.clearTimeout(state.confirmationTimer);
      speak(phrase);
    };
    if (!ui.confirmAudio) { announce(); return; }
    ui.confirmAudio.onended = announce;
    ui.confirmAudio.onerror = announce;
    window.clearTimeout(state.confirmationTimer);
    state.confirmationTimer = window.setTimeout(announce, CONFIRM_FALLBACK_MS);
    try {
      ui.confirmAudio.currentTime = 0;
      const attempt = ui.confirmAudio.play();
      if (attempt && typeof attempt.catch === 'function') attempt.catch(announce);
    } catch (error) { announce(); }
  }
  function resetCandidate() { state.candidate = null; state.frames = 0; }
  function resetDetection() { resetCandidate(); state.lastAnnounced = null; state.lastAccessibleResult = ''; state.lastVideoTime = -1; ui.srResult.textContent = ''; renderWaiting(0, 'El resultado aparecerá aquí.'); }
  function setConfidence(probability, active) {
    const percent = Math.max(0, Math.min(100, Math.round(probability * 100)));
    ui.confidence.textContent = active ? `${percent}%` : '—'; ui.bar.style.width = `${active ? percent : 0}%`;
    ui.progress.setAttribute('aria-valuenow', String(active ? percent : 0)); ui.progress.setAttribute('aria-valuetext', active ? `${percent} por ciento de confianza` : 'Sin detección');
  }
  function renderWaiting(probability = 0, note = 'Acerca una sola moneda y mantenla quieta.', active = false) {
    ui.result.textContent = 'Esperando moneda...'; ui.detection.textContent = 'En espera'; ui.detection.classList.remove('is-confirmed'); ui.resultNote.textContent = note; setConfidence(probability, active);
  }
  function renderCoin(className, probability) {
    ui.result.textContent = className; ui.detection.textContent = 'Confirmada'; ui.detection.classList.add('is-confirmed'); setConfidence(probability, true);
    ui.resultNote.textContent = state.muted ? 'Audio silenciado. Puedes leer el valor en pantalla.' : 'Sonido de confirmación y voz listos.';
    state.lastConfirmedCoin = className;
    ui.repeat.disabled = false;
    if (state.lastAccessibleResult !== className) { ui.srResult.textContent = PHRASES[className]; state.lastAccessibleResult = className; }
  }
  function processPredictions(predictions, now) {
    if (!Array.isArray(predictions) || !predictions.length) throw new Error('El modelo no devolvió predicciones válidas.');
    const top = predictions.reduce((best, prediction) => prediction.probability > best.probability ? prediction : best);
    if (!EXPECTED_CLASSES.includes(top.className) || !Number.isFinite(top.probability)) throw new Error('La predicción no corresponde a las clases esperadas del modelo.');
    if (top.className === 'Fondo' || top.probability < state.threshold) {
      resetCandidate();
      // No cancelar la voz aquí: retirar o mover la moneda no debe cortar una frase en curso.
      if (top.className === 'Fondo') { state.lastAnnounced = null; state.lastAccessibleResult = ''; }
      renderWaiting(top.probability, top.className === 'Fondo' ? 'No hay una moneda reconocible en el recuadro.' : `Busca buena luz. Umbral: ${Math.round(state.threshold * 100)}%.`, true); return;
    }
    if (top.className === state.candidate) state.frames = Math.min(state.frames + 1, STABLE_FRAMES);
    else { state.candidate = top.className; state.frames = 1; cancelSpeech(); stopConfirmationSound(); }
    if (state.frames < STABLE_FRAMES) { renderWaiting(top.probability, `Mantén la moneda quieta. Confirmando ${state.frames} de ${STABLE_FRAMES} cuadros.`, true); ui.detection.textContent = 'Confirmando'; return; }
    renderCoin(top.className, top.probability);
    if (state.lastAnnounced !== top.className && now - state.lastAnnouncedAt >= COOLDOWN_MS) announceAfterConfirmation(top.className);
  }
  async function loadModel() {
    if (state.model) return state.model;
    if (!window.tf || !window.tmImage) throw new Error('No se pudieron cargar las librerías desde el CDN. Comprueba tu conexión a internet.');
    await window.tf.ready();
    const model = await window.tmImage.load(`${MODEL_PATH}model.json`, `${MODEL_PATH}metadata.json`); const labels = model.getClassLabels();
    if (labels.length !== EXPECTED_CLASSES.length || !EXPECTED_CLASSES.every((label) => labels.includes(label))) { if (typeof model.dispose === 'function') model.dispose(); throw new Error('Las clases del modelo no coinciden con las seis clases esperadas.'); }
    state.model = model; return model;
  }
  function stopStream(stream) { if (stream) stream.getTracks().forEach((track) => track.stop()); }
  async function listCameras() {
    if (!navigator.mediaDevices.enumerateDevices) return;
    try { const devices = await navigator.mediaDevices.enumerateDevices(); state.cameras = devices.filter((device) => device.kind === 'videoinput' && device.deviceId); ui.switch.hidden = !state.running || state.cameras.length < 2; }
    catch (error) { console.warn('No fue posible enumerar las cámaras:', error); ui.switch.hidden = true; }
  }
  async function openCamera(token, deviceId = null) {
    stopStream(state.stream); state.stream = null; ui.video.srcObject = null;
    const video = deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    if (token !== state.session) { stopStream(stream); return false; }
    state.stream = stream; ui.video.srcObject = stream; ui.video.hidden = false; await ui.video.play();
    if (token !== state.session) { stopStream(stream); return false; }
    const track = stream.getVideoTracks()[0]; if (!track) throw new Error('No se encontró una pista de video.'); state.deviceId = track.getSettings().deviceId || deviceId;
    track.addEventListener('ended', () => { if (token === state.session) { stopCamera(); showError('La cámara se desconectó.'); } }, { once: true }); return true;
  }
  function showError(message) { ui.error.textContent = message; ui.error.hidden = false; }
  function errorText(error) {
    const messages = { NotAllowedError:'No tenemos permiso para usar la cámara. Revisa los permisos y vuelve a intentarlo.', PermissionDeniedError:'El acceso a la cámara fue denegado. Revisa los permisos del navegador.', NotFoundError:'No encontramos una cámara.', NotReadableError:'No se pudo acceder a la cámara. Cierra otras aplicaciones que la estén usando.', OverconstrainedError:'La cámara seleccionada ya no está disponible.', SecurityError:'El navegador bloqueó la cámara. Abre el sitio mediante HTTPS o http://localhost.', AbortError:'La cámara no pudo iniciarse.' };
    if (messages[error.name]) return messages[error.name]; if (/fetch|network|load|HTTP/i.test(error.message)) return 'No fue posible cargar el modelo. Comprueba la conexión y la carpeta my_model/.'; return error.message || 'Ocurrió un problema al iniciar el reconocimiento.';
  }
  function updateCameraUI(active) { ui.placeholder.hidden = active; ui.hint.hidden = !active; ui.video.hidden = !active; ui.viewport.classList.toggle('is-live', active); ui.cameraStatus.classList.toggle('is-live', active); ui.cameraState.textContent = active ? 'Cámara en vivo' : 'Cámara apagada'; ui.startLabel.textContent = active ? 'Detener cámara' : 'Iniciar cámara y audio'; ui.switch.hidden = !active || state.cameras.length < 2; }
  function setBusy(busy, label) { state.busy = busy; ui.start.disabled = busy; ui.switch.disabled = busy; ui.start.setAttribute('aria-busy', String(busy)); if (label) ui.startLabel.textContent = label; }
  async function inferenceLoop(token) {
    if (!state.running || token !== state.session) return;
    if (document.hidden) { state.raf = window.requestAnimationFrame(() => inferenceLoop(token)); return; }
    try {
      if (ui.video.readyState >= 2 && ui.video.currentTime !== state.lastVideoTime) { state.lastVideoTime = ui.video.currentTime; const predictions = await state.model.predict(ui.video, false); if (!state.running || token !== state.session || document.hidden) return scheduleNext(token); processPredictions(predictions, performance.now()); }
    } catch (error) { if (token !== state.session) return; console.error('Error de inferencia:', error); stopCamera(); showError('No se pudo analizar la imagen. Vuelve a iniciar la cámara.'); return; }
    scheduleNext(token);
  }
  function scheduleNext(token) { if (state.running && token === state.session) state.raf = window.requestAnimationFrame(() => inferenceLoop(token)); }
  function stopCamera() { state.session += 1; state.running = false; window.cancelAnimationFrame(state.raf); stopStream(state.stream); state.stream = null; ui.video.srcObject = null; stopConfirmationSound(); cancelSpeech(); resetDetection(); state.lastConfirmedCoin = null; ui.repeat.disabled = true; updateCameraUI(false); setBusy(false); setStatus('Cámara detenida. Pulsa el botón para continuar.'); }
  async function startCamera() {
    if (state.busy) return; if (state.running) return stopCamera(); ui.error.hidden = true; ui.error.textContent = '';
    if (!window.isSecureContext || window.location.protocol === 'file:') { showError('Para usar la cámara, abre el sitio en HTTPS o con http://localhost.'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showError('Tu navegador no permite acceder a la cámara.'); return; }
    const token = ++state.session; setBusy(true, 'Iniciando cámara...'); resetDetection(); state.audioActivated = true; state.speechWarningShown = false;
    // Estas llamadas ocurren dentro del gesto del usuario para desbloquear ambos sistemas de audio.
    unlockAudio(); setStatus('Permite el acceso a la cámara. No se solicita acceso al micrófono.');
    try {
      const opened = await openCamera(token); if (!opened || token !== state.session) return; ui.startLabel.textContent = 'Cargando modelo...'; setStatus('Cámara autorizada. Cargando el modelo en tu dispositivo...'); await loadModel(); if (token !== state.session) return;
      state.running = true; updateCameraUI(true); await listCameras(); if (token !== state.session) return; setBusy(false); setStatus('Cámara lista. Mantén una moneda quieta hasta oír la confirmación.'); scheduleNext(token);
    } catch (error) { if (token !== state.session) return; console.error('Error de inicio:', error); stopCamera(); setStatus('No se pudo iniciar. Consulta el mensaje de error.'); showError(errorText(error)); }
  }
  async function switchCamera() {
    if (state.busy || !state.running || state.cameras.length < 2) return;
    const currentIndex = state.cameras.findIndex((camera) => camera.deviceId === state.deviceId); const nextCamera = state.cameras[(currentIndex + 1) % state.cameras.length]; const token = ++state.session;
    state.running = false; window.cancelAnimationFrame(state.raf); cancelSpeech(); stopConfirmationSound(); resetDetection(); setBusy(true, 'Cambiando cámara...'); setStatus('Cambiando de cámara...');
    try { const opened = await openCamera(token, nextCamera.deviceId); if (!opened || token !== state.session) return; state.running = true; updateCameraUI(true); await listCameras(); if (token !== state.session) return; setBusy(false); setStatus('Cámara cambiada. Mantén la moneda quieta.'); scheduleNext(token); }
    catch (error) { if (token !== state.session) return; stopCamera(); showError(errorText(error)); }
  }
  function updateVoiceUI() { const label = state.muted ? 'Activar voz' : 'Silenciar'; ui.voiceLabel.textContent = label; ui.voiceStatus.textContent = state.muted ? 'Audio silenciado' : 'Voz activada · español de México'; ui.voice.setAttribute('aria-pressed', String(state.muted)); ui.topVoice.textContent = label; ui.topVoice.setAttribute('aria-pressed', String(state.muted)); ui.srResult.setAttribute('aria-live', state.muted || !speechSupported ? 'polite' : 'off'); }
  function toggleVoice() { state.muted = !state.muted; if (state.muted) { stopConfirmationSound(); cancelSpeech(); setStatus('Audio silenciado. La detección continúa en pantalla.'); } else { state.audioActivated = true; unlockAudio(); setStatus('Audio activado. Las monedas confirmadas se anunciarán.'); } updateVoiceUI(); }
  function repeatVoice() { if (!state.lastConfirmedCoin || !PHRASES[state.lastConfirmedCoin]) { setStatus('Todavía no hay una moneda confirmada para repetir.'); return; } if (state.muted) { setStatus('Audio silenciado. Actívalo para repetir la voz.'); return; } state.audioActivated = true; stopConfirmationSound(); speak(PHRASES[state.lastConfirmedCoin]); }
  function updateThreshold() { state.threshold = Number(ui.threshold.value) / 100; const percent = Number(ui.threshold.value); ui.thresholdValue.innerHTML = `${percent}<span>%</span>`; ui.threshold.setAttribute('aria-valuetext', `${percent} por ciento`); ui.threshold.style.setProperty('--range-fill', `${((percent - 50) / 49) * 100}%`); resetCandidate(); if (state.running) renderWaiting(0, `Umbral ajustado a ${percent}%. Esperando una detección estable.`); }
  function toggleTextSize() { state.giantText = !state.giantText; document.body.classList.toggle('giant-text', state.giantText); const label = state.giantText ? 'Texto normal' : 'Texto gigante'; ui.textSize.textContent = label; ui.textSize.setAttribute('aria-pressed', String(state.giantText)); setStatus(state.giantText ? 'Texto gigante activado.' : 'Texto normal activado.'); }
  function isTypingTarget(target) { return target && (target.matches('input, textarea, select, button, a') || target.isContentEditable); }
  ui.start.addEventListener('click', startCamera); ui.switch.addEventListener('click', switchCamera); ui.voice.addEventListener('click', toggleVoice); ui.topVoice.addEventListener('click', toggleVoice); ui.repeat.addEventListener('click', repeatVoice); ui.textSize.addEventListener('click', toggleTextSize); ui.threshold.addEventListener('input', updateThreshold);
  document.addEventListener('keydown', (event) => { if (isTypingTarget(event.target)) return; const key = event.key.toLowerCase(); if (event.code === 'Space') { event.preventDefault(); startCamera(); } else if (key === 'r') { event.preventDefault(); repeatVoice(); } else if (key === 'm') { event.preventDefault(); toggleVoice(); } });
  document.addEventListener('visibilitychange', () => { resetCandidate(); if (state.running && !document.hidden) { state.lastVideoTime = -1; renderWaiting(0, 'La detección se ha reanudado. Mantén la moneda quieta.'); } });
  window.addEventListener('pagehide', stopCamera); if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', listCameras);
  if (speechSupported) { chooseVoice(); window.speechSynthesis.addEventListener('voiceschanged', chooseVoice); } else { state.muted = true; ui.voice.disabled = true; ui.topVoice.disabled = true; ui.voiceLabel.textContent = 'Voz no disponible'; ui.voiceStatus.textContent = 'Usa el resultado visual o un lector de pantalla'; }
  ui.repeat.disabled = true; updateVoiceUI(); updateThreshold();
})();
