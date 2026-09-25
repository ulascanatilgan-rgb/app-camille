import { SimliClient, LogLevel } from 'simli-client/lib/client.ts';

const micButton = document.getElementById('micButton');
const micLabel = document.getElementById('micLabel');
const endButton = document.getElementById('endButton');
const statusEl = document.getElementById('status');
const messages = document.getElementById('messages');
const conversationPane = document.getElementById('conversationPane');
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
const avatarPlaceholder = document.getElementById('avatarPlaceholder');
const avatarPlaceholderText = document.getElementById('avatarPlaceholderText');
const avatarBadge = document.getElementById('avatarBadge');

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled error:', event.reason);
  setStatus('App error — retry after reload');
  if (avatarPlaceholderText) avatarPlaceholderText.textContent = 'The live-avatar client failed to start. Reload after the latest deploy.';
});

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
let partialTranslationTimer = null;
let partialTranslationSeq = 0;
let simliStarted = false;
let lastSubtitlePair = {
  fr: "Hey Ulas. Hoe is 't vandaag?",
  en: 'Hey Ulas. How are you today?'
};

function setStatus(text) {
  statusEl.textContent = text;
}

function setAvatarLive(isLive) {
  portraitWrap.classList.toggle('avatar-live', isLive);
  avatarPlaceholder.classList.toggle('hidden', isLive);
  simliVideo.classList.toggle('visible', isLive);
  avatarBadge.textContent = isLive ? 'Simli Live Avatar' : 'Simli Live Avatar';
  if (!isLive && avatarPlaceholderText) {
    avatarPlaceholderText.textContent = "Camille's live avatar will appear here.";
  }
}

async function checkSimliHealth() {
  const response = await fetch('/simli-health', { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error('Simli API check failed');
  }
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

function trimMessages() {
  const rows = [...messages.querySelectorAll('.message')];
  rows.slice(0, Math.max(0, rows.length - 8)).forEach(row => row.remove());
}

function scrollConversationToBottom() {
  if (conversationPane) {
    conversationPane.scrollTo({ top: conversationPane.scrollHeight, behavior: 'smooth' });
  }
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
  trimMessages();
  scrollConversationToBottom();
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
  trimMessages();
  scrollConversationToBottom();
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
  return 'Correct only one mistake when it clearly matters for meaning or natural Flemish/Dutch.';
}

function modeInstruction() {
  if (currentMode === 'tutor') {
    return 'Coach mode: stay conversational, but prioritize one short useful correction or a more natural Flemish alternative.';
  }
  if (currentMode === 'slow') {
    return 'Extra-slow mode: use very easy practical Dutch, short clauses, deliberate pauses, and no sentence longer than about eight words.';
  }
  return 'Practical mode: use easy spoken Flemish/Dutch, one short reply, then one simple question or scenario.';
}

function sessionInstructions() {
  return [
    'You are Camille, Ulas Atilgan’s long-term Flemish conversation coach and conversation partner.',
    'Goal: within six months, help Ulas communicate comfortably with people in Flanders in everyday life, work and business situations.',
    'Ulas is around A2. Gradually build practical speaking confidence toward B1/B2-style conversation without turning sessions into textbook lessons.',
    'Use natural spoken Belgian Dutch / Flemish. Prefer phrases people actually use in Flanders.',
    'Default to clear informal je/jij Dutch that works across Flanders. Briefly mention a common Flemish ge/gij or local alternative only when genuinely useful.',
    'Teach short, reusable phrases, high-frequency words, natural fillers and compact sentence patterns.',
    'Speak slowly, clearly and naturally. Keep replies short: usually one or two short sentences plus ONE question.',
    correctionInstruction(),
    'Correct sparingly and only one useful point at a time.',
    'Useful correction styles: "Kleine correctie: [his phrase] → [better phrase]." Or: "Je kan ook zeggen: [natural phrase]." Or: "In Vlaanderen hoor je vaak: [common phrase]."',
    'Only occasionally add one very short English explanation when it genuinely helps. Do not explain every correction.',
    'If Ulas is understandable but unnatural, give a natural alternative rather than a grammar lecture.',
    'If Ulas is quiet, stuck, gives a very short answer, or has no topic, YOU take the lead.',
    'Start your own short conversations, propose a practical scenario, say something happened, ask what he thinks, or suggest a topic.',
    'Useful proactive moves include: "Wat denk jij daarvan?", "Zullen we het daar eens over hebben?", "Ik heb een vraag voor jou.", and "Stel dat je morgen..."',
    'Prioritize situations Ulas will actually face in Flanders: neighbours, shops, cafés, restaurants, phone calls, appointments, deliveries, tradespeople, directions, transport, social plans, padel, weather, home, services, administration, work, meetings, colleagues, networking, customers, suppliers and business follow-up.',
    'Use Ulas’s real life naturally: he works at ING in IT, runs Hondinn dog hotel, plays padel, invests, lives around Kapellen/Antwerp, and is interested in business, cars and renovation.',
    'Use these personal topics naturally and one at a time; do not recite his profile.',
    'Teach him to get things done with a few natural words rather than to produce perfect formal Dutch.',
    'When a phrase is useful, say it once clearly, give at most one easier or more Flemish alternative, then ask Ulas to use it.',
    'If Ulas cannot remember a Dutch word and switches to English, understand him normally. Give the short Dutch/Flemish word or phrase he needs, then continue in Dutch.',
    'If he asks a full question in English, use English only for a very short clarification when needed, then steer him back to Flemish/Dutch.',
    'Treat English as a temporary bridge, never as the conversation language.',
    'When useful, invite him to say it again in Flemish: "In het Vlaams kan je zeggen: ... Probeer eens." Keep this very short.',
    'If he mixes English into a Dutch sentence, respond to the meaning first, supply the missing natural Dutch expression, and continue in Dutch.',
    'Avoid overly formal Netherlands-Dutch wording when a common Belgian Dutch expression would be more natural.',
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

function startGuidedConversation() {
  if (!dc || dc.readyState !== 'open') return;
  dc.send(JSON.stringify({
    type: 'response.create',
    response: {
      instructions: [
        'Start the conversation yourself in easy, natural Flemish/Dutch.',
        'Use one or two short sentences and ONE simple question.',
        'Choose a practical Flanders topic or a topic from Ulas’s life: work at ING, Hondinn, padel, investing, Kapellen/Antwerp, business, cars, renovation, coffee, shopping, appointments or daily plans.',
        'Speak slowly and naturally.',
        'Do not explain grammar unless needed.',
        'Example style: Hey Ulas. Hoe is het vandaag? Nog iets gepland?'
      ].join(' ')
    }
  }));
}

function setupBrowserCaptioning() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  recognition = new SR();
  recognition.lang = 'nl-BE';
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


function schedulePartialTranslation(text) {
  const clean = (text || '').trim();
  if (!captionsToggle.checked || clean.length < 6) return;

  clearTimeout(partialTranslationTimer);
  const seq = ++partialTranslationSeq;

  partialTranslationTimer = setTimeout(async () => {
    const en = await translateToEnglish(clean);
    if (seq === partialTranslationSeq && assistantDraft.trim() === clean && en) {
      subtitleEn.textContent = en;
    }
  }, 850);
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
  setStatus('Checking Simli…');
  avatarBadge.textContent = 'Checking Simli…';
  if (avatarPlaceholderText) avatarPlaceholderText.textContent = 'Checking Simli connection…';

  await checkSimliHealth();

  setStatus('Connecting avatar…');
  avatarBadge.textContent = 'Connecting avatar…';
  if (avatarPlaceholderText) avatarPlaceholderText.textContent = 'Connecting live avatar…';

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
    setSubtitle(assistantDraft.trim(), subtitleEn.textContent || '…');
    schedulePartialTranslation(assistantDraft.trim());

    if (currentAssistantMessage) {
      currentAssistantMessage.fr.textContent = assistantDraft.trim();
    }
  }

  if (event.type === 'response.output_audio_transcript.done') {
    clearTimeout(partialTranslationTimer);
    partialTranslationSeq += 1;
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
    setStatus('Ready — spreek Vlaams');
    updateSessionInstructions();
    try { recognition?.start(); } catch {}
    setTimeout(startGuidedConversation, 500);
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
    avatarBadge.textContent = 'Simli connection failed';
    if (avatarPlaceholderText) {
      avatarPlaceholderText.textContent = 'Simli could not connect. Check Railway variables and deploy status.';
    }
    micLabel.textContent = 'Try again';
    micButton.disabled = false;
    await disconnect(false);
  }
}

async function disconnect(resetMessage = true) {
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
  if (resetMessage) {
    setStatus('Ready');
    setSubtitle(lastSubtitlePair.fr, lastSubtitlePair.en);
  }
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
