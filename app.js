const micButton = document.getElementById('micButton');
const micLabel = document.getElementById('micLabel');
const endButton = document.getElementById('endButton');
const statusEl = document.getElementById('status');
const messages = document.getElementById('messages');
const portraitWrap = document.getElementById('portraitWrap');
const voiceRing = document.getElementById('voiceRing');
const settingsButton = document.getElementById('settingsButton');
const settingsDialog = document.getElementById('settingsDialog');
const correctionLevel = document.getElementById('correctionLevel');
const captionsToggle = document.getElementById('captionsToggle');
const modeButtons = [...document.querySelectorAll('.mode')];
const subtitleFr = document.getElementById('subtitleFr');
const subtitleEn = document.getElementById('subtitleEn');

const frames = {
  base: document.getElementById('frameBase'),
  talk1: document.getElementById('frameTalk1'),
  talk2: document.getElementById('frameTalk2'),
  blink: document.getElementById('frameBlink')
};

let pc;
let dc;
let mediaStream;
let remoteAudio;
let analyser;
let animationFrame;
let connected = false;
let assistantDraft = '';
let currentMode = 'natural';
let recognition;
let lastUserTranscript = '';
let currentAssistantMessage = null;
let currentSpeechLevel = 0;
let lastMouthSwap = 0;
let blinkTimeout;
let blinkOverride = false;
let lastSubtitlePair = {
  fr: 'Bonjour Ulas. On parle français aujourd’hui ?',
  en: 'Hi Ulas. Shall we speak French today?'
};

function setStatus(text) { statusEl.textContent = text; }

function setFrame(name) {
  Object.values(frames).forEach(el => el.classList.remove('active'));
  frames[name]?.classList.add('active');
}

function scheduleBlink() {
  clearTimeout(blinkTimeout);
  const delay = 2200 + Math.random() * 2600;
  blinkTimeout = setTimeout(() => {
    blinkOnce();
    scheduleBlink();
  }, delay);
}

function blinkOnce() {
  if (blinkOverride) return;
  blinkOverride = true;
  setFrame('blink');
  setTimeout(() => {
    blinkOverride = false;
    setFrame(currentSpeechLevel > 8 ? 'talk1' : 'base');
  }, 140);
}

function setSubtitle(fr = '', en = '') {
  if (!captionsToggle.checked) {
    subtitleFr.textContent = '';
    subtitleEn.textContent = '';
    return;
  }
  subtitleFr.textContent = fr || '';
  subtitleEn.textContent = en || '';
}

function appendUserMessage(text) {
  if (!text?.trim()) return;
  const row = document.createElement('div');
  row.className = 'message user';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text.trim();
  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
}

function createAssistantMessage() {
  const row = document.createElement('div');
  row.className = 'message assistant';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const fr = document.createElement('div');
  fr.className = 'assistant-fr';
  const en = document.createElement('div');
  en.className = 'assistant-en';
  bubble.appendChild(fr);
  bubble.appendChild(en);
  row.appendChild(bubble);
  messages.appendChild(row);
  messages.scrollTop = messages.scrollHeight;
  return { row, fr, en };
}

function correctionInstruction() {
  const level = correctionLevel.value;
  if (level === 'strict') return 'Correct noticeable grammar, word-choice and pronunciation-related mistakes briefly after answering.';
  if (level === 'medium') return 'Correct important recurring mistakes briefly after answering.';
  return 'Correct only mistakes that block understanding or are especially important.';
}

function modeInstruction() {
  if (currentMode === 'tutor') return 'Tutor mode: still conversational, but give one short correction or better phrasing when useful.';
  if (currentMode === 'slow') return 'Slow mode: speak noticeably slower, use simpler vocabulary and shorter sentences.';
  return 'Natural mode: speak at a normal conversational pace and prioritize flow over correction.';
}

function updateSessionInstructions() {
  if (!dc || dc.readyState !== 'open') return;
  dc.send(JSON.stringify({
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: `You are Camille, a calm French conversation partner. Speak mostly in natural metropolitan French. Keep answers concise, usually 1-3 sentences. Ask natural follow-up questions. ${modeInstruction()} ${correctionInstruction()} If the user switches to Turkish or English for help, explain briefly and return to French.`
    }
  }));
}

function setupBrowserCaptioning() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.lang = 'fr-FR';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalText += event.results[i][0].transcript + ' ';
    }
    if (finalText.trim() && finalText.trim() !== lastUserTranscript) {
      lastUserTranscript = finalText.trim();
      appendUserMessage(lastUserTranscript);
    }
  };
  recognition.onerror = () => {};
}

async function translateToEnglish(text) {
  try {
    const response = await fetch('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error('translation failed');
    const data = await response.json();
    return data.translation || '';
  } catch (_) {
    return '';
  }
}

async function finalizeAssistantMessage(text) {
  const frText = (text || '').trim();
  if (!frText) return;
  const enText = await translateToEnglish(frText);
  lastSubtitlePair = { fr: frText, en: enText };
  setSubtitle(frText, enText);
  if (!currentAssistantMessage) currentAssistantMessage = createAssistantMessage();
  currentAssistantMessage.fr.textContent = frText;
  currentAssistantMessage.en.textContent = enText;
  currentAssistantMessage = null;
}

function startVisualizer(stream) {
  try {
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      currentSpeechLevel = avg;
      const active = avg > 10;
      portraitWrap.classList.toggle('speaking', active);
      portraitWrap.classList.toggle('idle', !active);
      const glow = Math.min(28, avg / 2.5);
      voiceRing.style.boxShadow = `inset 0 0 0 2px rgba(255,255,255,.18), 0 0 ${glow}px rgba(125,217,255,.22)`;

      if (!blinkOverride) {
        if (active) {
          const now = performance.now();
          if (now - lastMouthSwap > 80) {
            setFrame(avg > 24 ? 'talk2' : 'talk1');
            lastMouthSwap = now;
          }
        } else {
          setFrame('base');
        }
      }

      animationFrame = requestAnimationFrame(tick);
    };

    portraitWrap.classList.add('idle');
    tick();
  } catch (_) {}
}

function handleRealtimeEvent(event) {
  if (event.type === 'input_audio_buffer.speech_started') setStatus('Listening…');
  if (event.type === 'input_audio_buffer.speech_stopped') setStatus('Thinking…');

  if (event.type === 'response.created') {
    assistantDraft = '';
    currentAssistantMessage = createAssistantMessage();
  }

  if (event.type === 'response.output_audio_transcript.delta') {
    if (!captionsToggle.checked) return;
    assistantDraft += event.delta || '';
    setSubtitle(assistantDraft.trim(), '…');
    if (currentAssistantMessage) currentAssistantMessage.fr.textContent = assistantDraft.trim();
  }

  if (event.type === 'response.output_audio_transcript.done') {
    const text = (event.transcript || assistantDraft || '').trim();
    assistantDraft = '';
    finalizeAssistantMessage(text);
  }

  if (event.type === 'response.done') setStatus('Ready');
  if (event.type === 'error') {
    console.error(event);
    setStatus('Something went wrong');
  }
}

async function connect() {
  if (connected) return;
  setStatus('Connecting…');
  micButton.disabled = true;

  try {
    pc = new RTCPeerConnection();
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;

    pc.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
      startVisualizer(event.streams[0]);
    };

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    pc.addTrack(mediaStream.getTracks()[0]);

    dc = pc.createDataChannel('oai-events');
    dc.addEventListener('open', () => {
      connected = true;
      micButton.classList.add('live');
      micLabel.textContent = 'Camille connected';
      endButton.disabled = false;
      micButton.disabled = false;
      setStatus('Ready — you can speak');
      updateSessionInstructions();
      scheduleBlink();
      try { recognition?.start(); } catch (_) {}
    });
    dc.addEventListener('message', (e) => {
      try { handleRealtimeEvent(JSON.parse(e.data)); } catch (_) {}
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const response = await fetch('/session', {
      method: 'POST',
      body: offer.sdp,
      headers: { 'Content-Type': 'application/sdp' }
    });

    if (!response.ok) throw new Error(await response.text());
    await pc.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  } catch (err) {
    console.error(err);
    setStatus('Could not connect');
    micLabel.textContent = 'Try again';
    micButton.disabled = false;
    disconnect();
  }
}

function disconnect() {
  connected = false;
  try { recognition?.stop(); } catch (_) {}
  clearTimeout(blinkTimeout);
  if (animationFrame) cancelAnimationFrame(animationFrame);
  portraitWrap.classList.remove('speaking');
  portraitWrap.classList.add('idle');
  voiceRing.style.boxShadow = '';
  currentSpeechLevel = 0;
  blinkOverride = false;
  setFrame('base');
  mediaStream?.getTracks().forEach(t => t.stop());
  dc?.close();
  pc?.close();
  pc = null;
  dc = null;
  mediaStream = null;
  endButton.disabled = true;
  micButton.classList.remove('live');
  micButton.disabled = false;
  micLabel.textContent = 'Start conversation';
  setStatus('Ready');
  setSubtitle(lastSubtitlePair.fr, lastSubtitlePair.en);
}

micButton.addEventListener('click', () => connected ? null : connect());
endButton.addEventListener('click', disconnect);
settingsButton.addEventListener('click', () => settingsDialog.showModal());
correctionLevel.addEventListener('change', updateSessionInstructions);
captionsToggle.addEventListener('change', () => {
  setSubtitle(lastSubtitlePair.fr, lastSubtitlePair.en);
});
modeButtons.forEach(btn => btn.addEventListener('click', () => {
  modeButtons.forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentMode = btn.dataset.mode;
  updateSessionInstructions();
}));

setupBrowserCaptioning();
setFrame('base');
portraitWrap.classList.add('idle');

// ---- PWA install support ----
const installButton = document.getElementById('installButton');
const installDialog = document.getElementById('installDialog');
const iosInstallHelp = document.getElementById('iosInstallHelp');
const genericInstallHelp = document.getElementById('genericInstallHelp');
const closeInstall = document.getElementById('closeInstall');
let deferredInstallPrompt = null;

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!isStandalone) installButton.hidden = false;
});

window.addEventListener('appinstalled', () => {
  installButton.hidden = true;
  deferredInstallPrompt = null;
});

if (isIOS && !isStandalone) {
  installButton.hidden = false;
}

installButton?.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
    return;
  }
  iosInstallHelp.hidden = !isIOS;
  genericInstallHelp.hidden = isIOS;
  installDialog.showModal();
});

closeInstall?.addEventListener('click', () => installDialog.close());
