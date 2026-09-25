import { createClient, AnamEvent } from '@anam-ai/js-sdk';

const micButton = document.getElementById('micButton');
const micLabel = document.getElementById('micLabel');
const endButton = document.getElementById('endButton');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const conversationPane = document.getElementById('conversationPane');
const portraitWrap = document.getElementById('portraitWrap');
const voiceRing = document.getElementById('voiceRing');
const settingsButton = document.getElementById('settingsButton');
const settingsDialog = document.getElementById('settingsDialog');
const correctionLevel = document.getElementById('correctionLevel');
const captionsToggle = document.getElementById('captionsToggle');
const modeButtons = [...document.querySelectorAll('.mode')];
const subtitleNl = document.getElementById('subtitleNl');
const subtitleEn = document.getElementById('subtitleEn');
const avatarVideo = document.getElementById('avatarVideo');
const avatarPlaceholder = document.getElementById('avatarPlaceholder');
const avatarPlaceholderText = document.getElementById('avatarPlaceholderText');
const avatarBadge = document.getElementById('avatarBadge');

let anamClient = null;
let connected = false;
let connecting = false;
let customLlmMode = false;
let currentMode = 'natural';
let currentMessages = [];
let lastProcessedUserMessageId = null;
let isResponding = false;
let activeChatAbort = null;
let activeTalkStream = null;
let partialTranslationSeq = 0;
let lastPartialTranslationAt = 0;
const streamBuffers = new Map();

let lastSubtitlePair = {
  nl: "Hey Ulas. Hoe is 't vandaag?",
  en: 'Hey Ulas. How are you today?'
};

function setStatus(text) {
  statusEl.textContent = text;
}

function setAvatarLive(isLive) {
  portraitWrap.classList.toggle('avatar-live', isLive);
  avatarPlaceholder.classList.toggle('hidden', isLive);
  avatarVideo.classList.toggle('visible', isLive);
  avatarBadge.textContent = isLive ? 'ANAM LIVE' : 'LIVE AVATAR';
}

function setSubtitle(nl = '', en = '') {
  if (!captionsToggle.checked) {
    subtitleNl.textContent = '';
    subtitleEn.textContent = '';
    return;
  }

  subtitleNl.textContent = nl || '';
  subtitleEn.textContent = en || '';
}

function scrollConversationToBottom() {
  if (!conversationPane) return;
  conversationPane.scrollTo({
    top: conversationPane.scrollHeight,
    behavior: 'smooth'
  });
}

function renderMessages(messages) {
  messagesEl.innerHTML = '';

  const recent = messages
    .filter(message => message?.content?.trim())
    .slice(-6);

  for (const message of recent) {
    const row = document.createElement('div');
    row.className = `message ${message.role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (message.role === 'user') {
      bubble.textContent = message.content.trim();
    } else {
      const nl = document.createElement('div');
      nl.className = 'assistant-fr';
      nl.textContent = message.content.trim();
      bubble.appendChild(nl);

      if (
        lastSubtitlePair.nl &&
        message.content.trim() === lastSubtitlePair.nl.trim() &&
        lastSubtitlePair.en
      ) {
        const en = document.createElement('div');
        en.className = 'assistant-en';
        en.textContent = lastSubtitlePair.en;
        bubble.appendChild(en);
      }
    }

    row.appendChild(bubble);
    messagesEl.appendChild(row);
  }

  scrollConversationToBottom();
}

async function translateToEnglish(text) {
  const clean = (text || '').trim();
  if (!clean) return '';

  try {
    const response = await fetch('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean })
    });

    if (!response.ok) return '';
    const data = await response.json();
    return data.translation || '';
  } catch {
    return '';
  }
}

async function schedulePartialTranslation(text) {
  const clean = (text || '').trim();
  if (!captionsToggle.checked || clean.length < 7) return;

  const now = Date.now();
  if (now - lastPartialTranslationAt < 1100) return;

  lastPartialTranslationAt = now;
  const seq = ++partialTranslationSeq;
  const english = await translateToEnglish(clean);

  if (seq === partialTranslationSeq && english) {
    subtitleEn.textContent = english;
  }
}

async function finalizeSubtitle(nlText) {
  const clean = (nlText || '').trim();
  if (!clean) return;

  const english = await translateToEnglish(clean);
  lastSubtitlePair = { nl: clean, en: english };
  setSubtitle(clean, english);
  renderMessages(currentMessages);
}

function correctionInstruction() {
  if (correctionLevel.value === 'strict') return 'strict';
  if (correctionLevel.value === 'light') return 'light';
  return 'medium';
}

async function streamCamilleResponse(messages = currentMessages, kickoff = false) {
  if (!anamClient || !customLlmMode || isResponding) return;

  isResponding = true;
  setStatus('Camille denkt…');
  activeChatAbort = new AbortController();

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: activeChatAbort.signal,
      body: JSON.stringify({
        messages,
        kickoff,
        mode: currentMode,
        correctionLevel: correctionInstruction()
      })
    });

    if (!response.ok || !response.body) {
      throw new Error(await response.text());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    activeTalkStream = anamClient.createTalkMessageStream();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;

      await activeTalkStream.streamMessageChunk(chunk, false);
    }

    await activeTalkStream.endMessage();
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('Camille response error:', error);
      setStatus('Response error');
    }
  } finally {
    activeChatAbort = null;
    activeTalkStream = null;
    isResponding = false;

    if (connected) {
      setStatus('Ready — spreek Vlaams');
    }
  }
}

async function handleMessagesUpdated(messages) {
  currentMessages = Array.isArray(messages) ? [...messages] : [];
  renderMessages(currentMessages);

  if (!customLlmMode) return;

  const latestUserMessage = [...currentMessages]
    .reverse()
    .find(message => message.role === 'user' && message.content?.trim());

  if (!latestUserMessage) return;
  if (latestUserMessage.id === lastProcessedUserMessageId) return;

  lastProcessedUserMessageId = latestUserMessage.id;
  await streamCamilleResponse(currentMessages, false);
}

function handleStreamEvent(event) {
  if (!event?.id || !event?.content) return;

  const previous = streamBuffers.get(event.id) || '';
  const next = previous + event.content;
  streamBuffers.set(event.id, next);

  if (event.role === 'persona') {
    setSubtitle(next.trim(), '…');
    schedulePartialTranslation(next);

    if (event.endOfSpeech) {
      streamBuffers.delete(event.id);
      partialTranslationSeq += 1;
      lastPartialTranslationAt = 0;
      finalizeSubtitle(next);
    }
  }

  if (event.endOfSpeech && event.role === 'user') {
    streamBuffers.delete(event.id);
  }
}

function attachAnamListeners(client) {
  client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
    connected = true;
    connecting = false;
    micButton.disabled = false;
    micButton.classList.add('live');
    micLabel.textContent = 'Camille connected';
    endButton.disabled = false;
    setAvatarLive(true);
    setStatus('Ready — spreek Vlaams');
  });

  client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
    setAvatarLive(true);
  });

  client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, handleStreamEvent);
  client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, handleMessagesUpdated);

  client.addListener(AnamEvent.USER_SPEECH_STARTED, () => {
    setStatus('Listening…');
    voiceRing.classList.add('active');

    if (isResponding) {
      try { activeChatAbort?.abort(); } catch {}
    }
  });

  client.addListener(AnamEvent.USER_SPEECH_ENDED, () => {
    setStatus('Thinking…');
    voiceRing.classList.remove('active');
  });

  client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, () => {
    try { activeChatAbort?.abort(); } catch {}
    isResponding = false;
  });

  client.addListener(AnamEvent.CONNECTION_CLOSED, (_reason, details) => {
    console.log('Anam connection closed:', details || '');
    resetUiAfterDisconnect();
  });

  client.addListener(AnamEvent.MIC_PERMISSION_DENIED, () => {
    setStatus('Microphone permission needed');
  });
}

async function connect() {
  if (connected || connecting) return;

  connecting = true;
  micButton.disabled = true;
  endButton.disabled = true;
  micLabel.textContent = 'Connecting…';
  setStatus('Connecting Anam…');
  avatarBadge.textContent = 'CONNECTING';
  avatarPlaceholderText.textContent = 'Connecting Camille…';

  try {
    const response = await fetch('/anam-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      cache: 'no-store'
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.sessionToken) {
      throw new Error(data.error || 'Could not create Anam session.');
    }

    customLlmMode = data.mode === 'custom-llm';

    anamClient = createClient(data.sessionToken, {
      disableInputAudio: false,
      voiceDetection: {
        endOfSpeechSensitivity: 0.55
      }
    });

    attachAnamListeners(anamClient);

    await anamClient.streamToVideoElement('avatarVideo');

    if (!connected) {
      connected = true;
      connecting = false;
      micButton.disabled = false;
      micButton.classList.add('live');
      micLabel.textContent = 'Camille connected';
      endButton.disabled = false;
      setAvatarLive(true);
      setStatus('Ready — spreek Vlaams');
    }

    if (customLlmMode) {
      setTimeout(() => streamCamilleResponse([], true), 350);
    }
  } catch (error) {
    console.error('Anam connection failed:', error);
    connecting = false;
    connected = false;
    customLlmMode = false;
    micButton.disabled = false;
    micLabel.textContent = 'Try again';
    endButton.disabled = true;
    avatarBadge.textContent = 'AVATAR OFFLINE';
    avatarPlaceholderText.textContent = 'Camille could not connect to Anam.';
    setStatus('Could not connect');
  }
}

function resetUiAfterDisconnect() {
  connected = false;
  connecting = false;
  customLlmMode = false;
  lastProcessedUserMessageId = null;
  isResponding = false;
  currentMessages = [];
  streamBuffers.clear();
  partialTranslationSeq += 1;
  lastPartialTranslationAt = 0;

  try { activeChatAbort?.abort(); } catch {}
  activeChatAbort = null;
  activeTalkStream = null;

  avatarVideo.srcObject = null;
  setAvatarLive(false);
  voiceRing.classList.remove('active');

  micButton.disabled = false;
  micButton.classList.remove('live');
  micLabel.textContent = 'Start conversation';
  endButton.disabled = true;
  setStatus('Ready');
  setSubtitle(lastSubtitlePair.nl, lastSubtitlePair.en);
  messagesEl.innerHTML = '';
}

async function disconnect() {
  try { activeChatAbort?.abort(); } catch {}

  try {
    await anamClient?.stopStreaming();
  } catch (error) {
    console.warn('Anam stop error:', error);
  }

  anamClient = null;
  resetUiAfterDisconnect();
}

micButton.addEventListener('click', () => {
  if (!connected && !connecting) connect();
});

endButton.addEventListener('click', disconnect);

settingsButton.addEventListener('click', () => {
  settingsDialog.showModal();
});

captionsToggle.addEventListener('change', () => {
  setSubtitle(lastSubtitlePair.nl, lastSubtitlePair.en);
});

modeButtons.forEach(button => {
  button.addEventListener('click', () => {
    modeButtons.forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    currentMode = button.dataset.mode;
  });
});

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled error:', event.reason);
});

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
