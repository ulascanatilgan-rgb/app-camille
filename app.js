import { SimliClient, LogLevel } from 'https://esm.sh/simli-client@3.0.2?bundle';

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
const simliVideo = document.getElementById('simliVideo');
const simliAudio = document.getElementById('simliAudio');
const fallbackPortrait = document.getElementById('fallbackPortrait');
const avatarBadge = document.getElementById('avatarBadge');

let pc;
let dc;
let mediaStream;
let simliClient;
let connected = false;
let assistantDraft = '';
let currentMode = 'natural';
let recognition;
let lastUserTranscript = '';
let currentAssistantMessage = null;
let simliStarted = false;
let lastSubtitlePair = {
  fr: 'Bonjour Ulas. On parle français aujourd’hui ?',
  en: 'Hi Ulas. Shall we speak French today?'
};

function setStatus(text) {
  statusEl.textContent = text;
}

function setAvatarLive(isLive) {
  portraitWrap.classList.toggle('avatar-live', isLive);
  fallbackPortrait.classList.toggle('hidden', isLive);
  simliVideo.classList.toggle('visible', isLive);
  avatarBadge.textContent = isLive ? 'Simli Live Avatar' : 'Connecting avatar…';
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
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  return { row, fr, en };
}

function correctionInstruction() {
  const level = correctionLevel.value;
  if (level === 'strict') {
    return 'Correct one useful mistake on almost every turn when one exists. Never correct more than one mistake at once.';
  }
  if (level === 'medium') {
    return 'Correct one important or recurring mistake whenever it would help learning. Never correct more than one mistake at once.';
  }
  return 'Correct only one mistake when it clearly matters for meaning or natural French.';
}

function modeInstruction() {
  if (currentMode === 'tutor') {
    return 'Tutor mode: still conversational, but prioritize one clear correction and one repetition prompt.';
  }
  if (currentMode === 'slow') {
    return 'Extra-slow mode: use very easy A1 French, short clauses, deliberate pauses, and no sentence longer than about eight words.';
  }
  return 'Guided mode: use easy A1-A2 French, one short reply, then one simple question.';
}

function sessionInstructions() {
  return [
    'You are Camille, Ulas Atilgan’s long-term French conversation tutor and conversation partner.',
    'Your goal is to make Ulas speak more French, not to impress him with long answers.',
    'Use natural metropolitan French at CEFR A1-A2 by default.',
    'Speak slowly, clearly and calmly. Use short pauses between ideas.',
    'Your vocal character should feel grounded, confident, low-energy and cool: lower register, slightly husky or velvety if the voice allows, never bubbly, never over-enthusiastic.',
    'Sound like a self-assured French woman in her 30s having a relaxed coffee conversation.',
    'Keep normal replies extremely short: usually one short French sentence plus one short question.',
    'Prefer 5-12 words per French sentence.',
    'Ask only ONE question at a time.',
    correctionInstruction(),
    'Correction format: "Petite correction : [wrong fragment] → [correct fragment]." Then one very short English reason, maximum 8 words. Then: "Répète : [correct French sentence]." Then ask one easy French question.',
    'If there is no important mistake, do not invent one.',
    'Do not give lists, lectures, grammar monologues, multiple corrections, or long explanations.',
    'If Ulas is stuck, simplify further. If he asks in Turkish or English, explain briefly, then return to French.',
    modeInstruction()
  ].join(' ');
}

function updateSessionInstructions() {
  if (!dc || dc.readyState !== 'open') return;
  dc.send(JSON.stringify({
    type: 'session.update',
    session: {
      type: 'realtime',
      instructions: sessionInstructions()
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

  recognition.onresult = event => {
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript + ' ';
      }
    }

    const transcript = finalText.trim();
    if (transcript && transcript !== lastUserTranscript) {
      lastUserTranscript = transcript;
      appendUserMessage(transcript);
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

    if (!response.ok) throw new Error('Translation failed');
    const data = await response.json();
    return data.translation || '';
  } catch {
    return '';
  }
}

async function finalizeAssistantMessage(text) {
  const frText = (text || '').trim();
  if (!frText) return;

  const enText = await translateToEnglish(frText);
  lastSubtitlePair = { fr: frText, en: enText };
  setSubtitle(frText, enText);

  if (!currentAssistantMessage) {
    currentAssistantMessage = createAssistantMessage();
  }

  currentAssistantMessage.fr.textContent = frText;
  currentAssistantMessage.en.textContent = enText;
  currentAssistantMessage = null;
}

async function initializeSimli() {
  setStatus('Connecting avatar…');
  avatarBadge.textContent = 'Connecting avatar…';

  const response = await fetch('/simli-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const { session_token, ice_servers } = await response.json();

  simliClient = new SimliClient(
    session_token,
    simliVideo,
    simliAudio,
    ice_servers,
    LogLevel.ERROR,
    'p2p'
  );

  simliClient.on('start', () => {
    simliStarted = true;
    setAvatarLive(true);
  });

  simliClient.on('speaking', () => {
    portraitWrap.classList.add('speaking');
    voiceRing.classList.add('active');
  });

  simliClient.on('silent', () => {
    portraitWrap.classList.remove('speaking');
    voiceRing.classList.remove('active');
  });

  simliClient.on('stop', () => {
    simliStarted = false;
    setAvatarLive(false);
  });

  simliClient.on('error', error => {
    console.error('Simli error:', error);
    setStatus('Avatar connection error');
  });

  await simliClient.start();
  setAvatarLive(true);
}

function handleRealtimeEvent(event) {
  if (event.type === 'input_audio_buffer.speech_started') {
    setStatus('Listening…');
    try { simliClient?.ClearBuffer(); } catch {}
  }

  if (event.type === 'input_audio_buffer.speech_stopped') {
    setStatus('Thinking…');
  }

  if (event.type === 'response.created') {
    assistantDraft = '';
    currentAssistantMessage = createAssistantMessage();
  }

  if (event.type === 'response.output_audio_transcript.delta') {
    if (!captionsToggle.checked) return;
    assistantDraft += event.delta || '';
    setSubtitle(assistantDraft.trim(), '…');

    if (currentAssistantMessage) {
      currentAssistantMessage.fr.textContent = assistantDraft.trim();
    }
  }

  if (event.type === 'response.output_audio_transcript.done') {
    const text = (event.transcript || assistantDraft || '').trim();
    assistantDraft = '';
    finalizeAssistantMessage(text);
  }

  if (event.type === 'response.done') {
    setStatus('Ready');
  }

  if (event.type === 'error') {
    console.error(event);
    setStatus('Something went wrong');
  }
}

async function initializeOpenAI() {
  pc = new RTCPeerConnection();

  pc.ontrack = event => {
    if (event.track.kind === 'audio' && simliClient) {
      try {
        simliClient.listenToMediastreamTrack(event.track);
      } catch (error) {
        console.error('Could not route OpenAI audio to Simli:', error);
      }
    }
  };

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  pc.addTrack(mediaStream.getAudioTracks()[0], mediaStream);

  dc = pc.createDataChannel('oai-events');

  dc.addEventListener('open', () => {
    connected = true;
    micButton.classList.add('live');
    micLabel.textContent = 'Camille connected';
    endButton.disabled = false;
    micButton.disabled = false;
    setStatus('Ready — speak French');
    updateSessionInstructions();
    try { recognition?.start(); } catch {}
  });

  dc.addEventListener('message', event => {
    try {
      handleRealtimeEvent(JSON.parse(event.data));
    } catch (error) {
      console.error(error);
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const response = await fetch('/session', {
    method: 'POST',
    body: offer.sdp,
    headers: { 'Content-Type': 'application/sdp' }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  await pc.setRemoteDescription({
    type: 'answer',
    sdp: await response.text()
  });
}

async function connect() {
  if (connected) return;

  setStatus('Connecting…');
  micButton.disabled = true;
  endButton.disabled = true;

  try {
    await initializeSimli();
    await initializeOpenAI();

    try {
      await simliAudio.play();
    } catch {}
  } catch (error) {
    console.error(error);
    setStatus('Could not connect');
    micLabel.textContent = 'Try again';
    micButton.disabled = false;
    await disconnect();
  }
}

async function disconnect() {
  connected = false;

  try { recognition?.stop(); } catch {}
  mediaStream?.getTracks().forEach(track => track.stop());

  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  try { await simliClient?.stop(); } catch {}

  pc = null;
  dc = null;
  mediaStream = null;
  simliClient = null;
  simliStarted = false;

  simliVideo.srcObject = null;
  simliAudio.srcObject = null;
  setAvatarLive(false);
  portraitWrap.classList.remove('speaking');
  voiceRing.classList.remove('active');

  endButton.disabled = true;
  micButton.classList.remove('live');
  micButton.disabled = false;
  micLabel.textContent = 'Start conversation';
  setStatus('Ready');
  setSubtitle(lastSubtitlePair.fr, lastSubtitlePair.en);
}

micButton.addEventListener('click', () => {
  if (!connected) connect();
});

endButton.addEventListener('click', disconnect);

settingsButton.addEventListener('click', () => {
  settingsDialog.showModal();
});

correctionLevel.addEventListener('change', updateSessionInstructions);

captionsToggle.addEventListener('change', () => {
  setSubtitle(lastSubtitlePair.fr, lastSubtitlePair.en);
});

modeButtons.forEach(button => {
  button.addEventListener('click', () => {
    modeButtons.forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    currentMode = button.dataset.mode;
    updateSessionInstructions();
  });
});

setupBrowserCaptioning();
setAvatarLive(false);

// ---- PWA install support ----
const installButton = document.getElementById('installButton');
const installDialog = document.getElementById('installDialog');
const iosInstallHelp = document.getElementById('iosInstallHelp');
const genericInstallHelp = document.getElementById('genericInstallHelp');
const closeInstall = document.getElementById('closeInstall');
let deferredInstallPrompt = null;

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

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
