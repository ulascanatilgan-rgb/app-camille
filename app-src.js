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
const subtitleNl = document.getElementById('subtitleNl');
const subtitleEn = document.getElementById('subtitleEn');
const avatarVideo = document.getElementById('avatarVideo');
const avatarPlaceholder = document.getElementById('avatarPlaceholder');
const avatarPlaceholderText = document.getElementById('avatarPlaceholderText');
const avatarBadge = document.getElementById('avatarBadge');

const difficultySlider = document.getElementById('difficultySlider');
const difficultyValue = document.getElementById('difficultyValue');
const difficultyName = document.getElementById('difficultyName');
const difficultyToggle = document.getElementById('difficultyToggle');
const difficultyToggleValue = document.getElementById('difficultyToggleValue');

const historyButton = document.getElementById('historyButton');
const wordsButton = document.getElementById('wordsButton');
const historyDialog = document.getElementById('historyDialog');
const wordsDialog = document.getElementById('wordsDialog');
const historyContent = document.getElementById('historyContent');
const wordsContent = document.getElementById('wordsContent');
const historyCount = document.getElementById('historyCount');
const wordsCount = document.getElementById('wordsCount');
const closeHistory = document.getElementById('closeHistory');
const closeWords = document.getElementById('closeWords');

const wordCard = document.getElementById('wordCard');
const wordNl = document.getElementById('wordNl');
const wordEn = document.getElementById('wordEn');
const lastUserPin = document.getElementById('lastUserPin');
const lastUserPinText = document.getElementById('lastUserPinText');
const successBalloon = document.getElementById('successBalloon');

const HISTORY_KEY = 'camille.history.v2';
const WORDS_KEY = 'camille.words.v2';
const LEVEL_KEY = 'camille.difficulty.v1';

let anamClient = null;
let connected = false;
let connecting = false;
let customLlmMode = false;
let currentMessages = [];
let lastProcessedUserMessageId = null;
let isResponding = false;
let activeChatAbort = null;
let activeTalkStream = null;
let partialTranslationSeq = 0;
let lastPartialTranslationAt = 0;
let activeSubtitleMessageId = null;
let currentHistorySessionId = null;
let runtimeContextApplied = false;
let pinnedUserMessageId = null;
let popAudioContext = null;

const streamBuffers = new Map();
const vocabProcessedIds = new Set();
const vocabSentenceCounts = new Map();
const translationByMessageId = new Map();
const lengthInterruptedIds = new Set();
let vocabQueue = Promise.resolve();

let learnedWords = loadJson(WORDS_KEY, []);
let difficulty = clampLevel(Number(localStorage.getItem(LEVEL_KEY) || 2));

let lastSubtitlePair = {
  nl: "Hey Ulas. Hoe is 't vandaag?",
  en: 'Hey Ulas. How are you today?'
};

const difficultyMeta = {
  1: { cefr: 'A1', name: 'Very easy', maxWords: 10, sentence: 'very short' },
  2: { cefr: 'A2', name: 'Easy', maxWords: 14, sentence: 'short' },
  3: { cefr: 'B1', name: 'Everyday', maxWords: 16, sentence: 'short' },
  4: { cefr: 'B2', name: 'Natural', maxWords: 18, sentence: 'short natural' },
  5: { cefr: 'C1', name: 'Advanced', maxWords: 20, sentence: 'concise natural' }
};

function loadJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '');
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Local storage save failed:', error);
  }
}

function clampLevel(value) {
  return Math.max(1, Math.min(5, Number(value) || 2));
}

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

function setLastUserPin(text, messageId = null) {
  const clean = String(text || '').trim();

  if (!clean) {
    if (!lastUserPinText.textContent.trim()) lastUserPin.hidden = true;
    return;
  }

  if (messageId) pinnedUserMessageId = messageId;
  lastUserPinText.textContent = clean;
  lastUserPin.hidden = false;
}

function countSpokenWords(text) {
  return String(text || '').trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length || 0;
}

function limitCamilleReply(text) {
  const original = String(text || '').trim();
  if (!original) return { text: '', limited: false };

  const words = original.split(/\s+/).filter(Boolean);
  let limited = words.slice(0, 20).join(' ');

  const sentenceEnds = [...limited.matchAll(/[.!?](?=\s|$)/g)];
  if (sentenceEnds.length > 3) {
    limited = limited.slice(0, sentenceEnds[2].index + 1).trim();
  }

  return {
    text: limited,
    limited: words.length > 20 || sentenceEnds.length > 3
  };
}

function primePopAudio() {
  try {
    if (!popAudioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      popAudioContext = new AudioCtx();
    }

    if (popAudioContext.state === 'suspended') {
      popAudioContext.resume().catch(() => {});
    }
  } catch {}
}

function playTinyPop() {
  try {
    primePopAudio();
    if (!popAudioContext) return;

    const now = popAudioContext.currentTime;
    const oscillator = popAudioContext.createOscillator();
    const gain = popAudioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(760, now);
    oscillator.frequency.exponentialRampToValueAtTime(460, now + 0.045);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.018, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    oscillator.connect(gain);
    gain.connect(popAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.06);
  } catch {}
}

function celebrateUserTurn() {
  if (!successBalloon) return;

  successBalloon.classList.remove('listening', 'pop');
  void successBalloon.offsetWidth;
  successBalloon.classList.add('pop');
  playTinyPop();

  window.setTimeout(() => {
    successBalloon.classList.remove('pop');
  }, 420);
}

function renderLiveDutch(text, activeChunk = '') {
  if (!captionsToggle.checked) {
    subtitleNl.textContent = '';
    return;
  }

  const clean = String(text || '');
  const chunk = String(activeChunk || '');
  const matches = [...chunk.matchAll(/[\p{L}\p{M}][\p{L}\p{M}'’\-]*/gu)];
  const activeWord = matches.length ? matches[matches.length - 1][0] : '';

  if (!activeWord) {
    subtitleNl.textContent = clean;
    return;
  }

  const lower = clean.toLocaleLowerCase('nl-BE');
  const target = activeWord.toLocaleLowerCase('nl-BE');
  const index = lower.lastIndexOf(target);

  if (index < 0) {
    subtitleNl.textContent = clean;
    return;
  }

  subtitleNl.replaceChildren();

  const before = clean.slice(0, index);
  const word = clean.slice(index, index + activeWord.length);
  const after = clean.slice(index + activeWord.length);

  if (before) subtitleNl.appendChild(document.createTextNode(before));

  const active = document.createElement('span');
  active.className = 'spoken-word';
  active.textContent = word;
  subtitleNl.appendChild(active);

  if (after) subtitleNl.appendChild(document.createTextNode(after));
}

function scrollConversationToBottom() {
  if (window.matchMedia('(max-width: 760px)').matches && messagesEl) {
    messagesEl.scrollTo({
      top: messagesEl.scrollHeight,
      behavior: 'smooth'
    });
    return;
  }

  if (!conversationPane) return;
  conversationPane.scrollTo({
    top: conversationPane.scrollHeight,
    behavior: 'smooth'
  });
}

function normalizedRole(role) {
  return role === 'user' ? 'user' : 'persona';
}

function renderMessages(messages) {
  const isMobile = window.matchMedia('(max-width: 760px)').matches;
  const previousTop = messagesEl.scrollTop;
  const distanceFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
  const shouldFollowLatest = !isMobile || distanceFromBottom < 72 || messagesEl.scrollHeight <= messagesEl.clientHeight + 8;

  messagesEl.innerHTML = '';

  const recent = messages
    .filter(message => message?.content?.trim())
    .filter(message => !(activeSubtitleMessageId && message.id === activeSubtitleMessageId && message.role === 'persona'))
    .filter(message => !(pinnedUserMessageId && message.id === pinnedUserMessageId && message.role === 'user'))
    .slice(-60);

  if (!recent.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty-inline';
    empty.textContent = 'Previous turns will appear here.';
    messagesEl.appendChild(empty);
    return;
  }

  for (const message of recent) {
    const role = normalizedRole(message.role);
    const row = document.createElement('div');
    row.className = `message ${role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (role === 'user') {
      bubble.textContent = message.content.trim();
    } else {
      const nl = document.createElement('div');
      nl.className = 'assistant-fr';
      nl.textContent = limitCamilleReply(message.content).text;
      bubble.appendChild(nl);

      const english = translationByMessageId.get(message.id);
      if (english) {
        const en = document.createElement('div');
        en.className = 'assistant-en';
        en.textContent = english;
        bubble.appendChild(en);
      }
    }

    row.appendChild(bubble);
    messagesEl.appendChild(row);
  }

  if (shouldFollowLatest) {
    scrollConversationToBottom();
  } else if (isMobile) {
    messagesEl.scrollTop = previousTop;
  }
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

async function schedulePartialTranslation(text, messageId) {
  const clean = (text || '').trim();
  if (!captionsToggle.checked || clean.length < 2) return;

  const now = Date.now();
  if (now - lastPartialTranslationAt < 160) return;

  lastPartialTranslationAt = now;
  const seq = ++partialTranslationSeq;
  const english = await translateToEnglish(clean);

  if (
    seq === partialTranslationSeq &&
    activeSubtitleMessageId === messageId &&
    english
  ) {
    subtitleEn.textContent = english;
  }
}

async function finalizeSubtitle(nlText, messageId) {
  const clean = (nlText || '').trim();
  if (!clean) return;

  const english = await translateToEnglish(clean);
  if (messageId && english) translationByMessageId.set(messageId, english);

  lastSubtitlePair = { nl: clean, en: english };
  setSubtitle(clean, english);
  saveCurrentHistory();
  renderMessages(currentMessages);
}

function buildRuntimeContext() {
  const meta = difficultyMeta[difficulty];

  const levelRules = {
    1: 'Use very easy A1 Dutch. Speak slowly. Aim for 6–10 words total.',
    2: 'Use easy A2 practical Flemish. Speak noticeably slower than normal. Aim for 10–14 words total.',
    3: 'Use practical B1 Dutch. Speak calmly and clearly. Aim for 12–16 words total.',
    4: 'Use natural B2 Flemish. Speak clearly at a calm natural pace. Aim for 14–18 words total.',
    5: 'Use advanced natural Flemish, but stay concise. Never exceed 20 words total.'
  };

  return [
    'SESSION LEARNING CONTEXT — IMPORTANT:',
    'You are Camille, Ulas Atilgan’s Flemish conversation coach.',
    'The goal is short back-and-forth conversation, not explanations.',
    `Current difficulty is level ${difficulty}/5 (${meta.cefr}, ${meta.name}).`,
    levelRules[difficulty],
    'HARD LIMIT FOR EVERY REPLY: maximum 20 spoken words total and maximum 3 short sentences.',
    'Prefer 1 or 2 short sentences. Use a third only if truly useful.',
    'Never exceed 20 words, even for corrections, explanations, or advanced levels.',
    'Usually give one short statement and one short question.',
    'Use simple reusable Belgian Dutch/Flemish patterns.',
    'Use clear pauses and speak slowly enough for an A2 learner to follow.',
    'Correct only one useful mistake at a time and keep it inside the same 20-word limit.',
    'If Ulas uses English because he forgot a word, give the Dutch/Flemish expression briefly, then continue in Dutch.',
    'If Ulas is quiet or stuck, take the lead with one easy question.',
    'Useful personal context: ING/IT, Hondinn, padel, investing, Kapellen/Antwerp, business, cars and renovation.',
    'Use personal details naturally, one at a time.'
  ].join(' ');
}

function pushLearningContext() {
  if (!anamClient || !connected) return;

  try {
    anamClient.addContext(buildRuntimeContext());
    runtimeContextApplied = true;
  } catch (error) {
    console.warn('Could not add learning context:', error);
  }
}

function updateDifficultyUi() {
  const meta = difficultyMeta[difficulty];
  difficultySlider.value = String(difficulty);
  difficultyValue.textContent = String(difficulty);
  if (difficultyToggleValue) difficultyToggleValue.textContent = String(difficulty);
  difficultyName.textContent = `${meta.cefr} · ${meta.name}`;
  difficultySlider.style.setProperty('--level-progress', `${((difficulty - 1) / 4) * 100}%`);
}

function beginHistorySession() {
  if (currentHistorySessionId) return;

  currentHistorySessionId =
    globalThis.crypto?.randomUUID?.() ||
    `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const history = loadJson(HISTORY_KEY, []);
  history.push({
    id: currentHistorySessionId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    difficulty,
    messages: []
  });

  saveJson(HISTORY_KEY, history.slice(-180));
}

function saveCurrentHistory() {
  if (!currentHistorySessionId) return;

  const history = loadJson(HISTORY_KEY, []);
  const session = history.find(item => item.id === currentHistorySessionId);
  if (!session) return;

  session.difficulty = difficulty;
  session.messages = currentMessages
    .filter(message => message?.content?.trim())
    .slice(-80)
    .map(message => ({
      id: message.id,
      role: normalizedRole(message.role),
      content: message.content.trim(),
      en: translationByMessageId.get(message.id) || ''
    }));

  saveJson(HISTORY_KEY, history.slice(-180));
}

function endHistorySession() {
  if (!currentHistorySessionId) return;

  saveCurrentHistory();
  const history = loadJson(HISTORY_KEY, []);
  const session = history.find(item => item.id === currentHistorySessionId);

  if (session) {
    session.endedAt = new Date().toISOString();
    saveJson(HISTORY_KEY, history.slice(-180));
  }

  currentHistorySessionId = null;
}

function formatDay(iso) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

function renderHistoryDialog() {
  saveCurrentHistory();
  const history = loadJson(HISTORY_KEY, [])
    .filter(session => Array.isArray(session.messages) && session.messages.length)
    .slice()
    .reverse();

  historyContent.innerHTML = '';
  historyCount.textContent = `${history.length} sessions`;

  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No saved conversations yet.';
    historyContent.appendChild(empty);
    return;
  }

  const grouped = new Map();

  for (const session of history) {
    const key = new Date(session.startedAt).toLocaleDateString();
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(session);
  }

  for (const sessions of grouped.values()) {
    const dateHeading = document.createElement('div');
    dateHeading.className = 'history-date';
    dateHeading.textContent = formatDay(sessions[0].startedAt);
    historyContent.appendChild(dateHeading);

    for (const session of sessions) {
      const card = document.createElement('section');
      card.className = 'history-session';

      const meta = document.createElement('div');
      meta.className = 'history-session-meta';
      const end = session.endedAt ? `–${formatTime(session.endedAt)}` : '';
      meta.textContent = `${formatTime(session.startedAt)}${end} · Level ${session.difficulty || 2}`;
      card.appendChild(meta);

      for (const message of session.messages) {
        const row = document.createElement('div');
        row.className = `archive-message ${message.role === 'user' ? 'archive-user' : 'archive-camille'}`;

        const role = document.createElement('span');
        role.className = 'archive-role';
        role.textContent = message.role === 'user' ? 'ULAS' : 'CAMILLE';

        const body = document.createElement('div');
        body.className = 'archive-body';

        const nl = document.createElement('div');
        nl.textContent = message.content;
        body.appendChild(nl);

        if (message.role !== 'user' && message.en) {
          const en = document.createElement('div');
          en.className = 'archive-english';
          en.textContent = message.en;
          body.appendChild(en);
        }

        row.append(role, body);
        card.appendChild(row);
      }

      historyContent.appendChild(card);
    }
  }
}

function normalizeWord(word) {
  return String(word || '')
    .trim()
    .toLocaleLowerCase('nl-BE')
    .replace(/[.!?,;:]+$/g, '');
}

function showWordCard(word) {
  if (!word?.nl || !word?.en) return;

  wordNl.textContent = word.nl;
  wordEn.textContent = word.en;
  wordCard.hidden = false;
  wordCard.classList.remove('word-pop');
  requestAnimationFrame(() => wordCard.classList.add('word-pop'));
}

async function captureVocabulary(text, vocabularyId) {
  if (!text?.trim() || !vocabularyId || vocabProcessedIds.has(vocabularyId)) return;
  vocabProcessedIds.add(vocabularyId);

  const knownWords = learnedWords.map(item => item.nl).slice(-120);

  try {
    const response = await fetch('/vocab', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, knownWords })
    });

    if (!response.ok) return;
    const data = await response.json();
    const word = data.word;
    if (!word?.nl || !word?.en) return;

    const normalized = normalizeWord(word.nl);
    if (!normalized) return;

    const exists = learnedWords.some(item => normalizeWord(item.nl) === normalized);
    if (exists) return;

    const learned = {
      id: globalThis.crypto?.randomUUID?.() || `word-${Date.now()}`,
      nl: word.nl.trim(),
      en: word.en.trim(),
      addedAt: new Date().toISOString()
    };

    learnedWords.push(learned);
    learnedWords = learnedWords.slice(-800);
    saveJson(WORDS_KEY, learnedWords);
    showWordCard(learned);
  } catch (error) {
    console.warn('Vocabulary capture failed:', error);
  }
}

function completedSentences(text, includeRemainder = false) {
  const clean = String(text || '').trim();
  if (!clean) return [];

  const completed = clean.match(/[^.!?]+[.!?]+/g) || [];
  const consumed = completed.join('').length;
  const remainder = clean.slice(consumed).trim();

  if (includeRemainder && remainder) completed.push(remainder);
  return completed.map(sentence => sentence.trim()).filter(Boolean);
}

function processVocabularyProgress(messageId, text, endOfSpeech = false) {
  if (!messageId || !text?.trim()) return;

  const sentences = completedSentences(text, endOfSpeech);
  const alreadyQueued = vocabSentenceCounts.get(messageId) || 0;

  if (sentences.length <= alreadyQueued) return;

  for (let index = alreadyQueued; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    const vocabularyId = `${messageId}:sentence:${index}`;

    vocabQueue = vocabQueue
      .then(() => captureVocabulary(sentence, vocabularyId))
      .catch(error => console.warn('Vocabulary queue failed:', error));
  }

  vocabSentenceCounts.set(messageId, sentences.length);

  if (endOfSpeech) {
    setTimeout(() => vocabSentenceCounts.delete(messageId), 15000);
  }
}

function renderWordsDialog() {
  learnedWords = loadJson(WORDS_KEY, []);
  wordsContent.innerHTML = '';
  wordsCount.textContent = `${learnedWords.length} words`;

  if (!learnedWords.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'New words from Camille will appear here.';
    wordsContent.appendChild(empty);
    return;
  }

  const items = [...learnedWords].reverse();

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'word-list-row';

    const pair = document.createElement('div');
    pair.className = 'word-list-pair';

    const nl = document.createElement('div');
    nl.className = 'word-list-nl';
    nl.textContent = item.nl;

    const en = document.createElement('div');
    en.className = 'word-list-en';
    en.textContent = item.en;

    pair.append(nl, en);

    const date = document.createElement('div');
    date.className = 'word-list-date';
    date.textContent = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'short'
    }).format(new Date(item.addedAt));

    row.append(pair, date);
    wordsContent.appendChild(row);
  }
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
        difficulty,
        correctionLevel: correctionLevel.value || 'medium'
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

    if (connected) setStatus('Ready — spreek Vlaams');
  }
}

async function handleMessagesUpdated(messages) {
  currentMessages = Array.isArray(messages) ? [...messages] : [];
  saveCurrentHistory();
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
  if (!event?.id || typeof event?.content !== 'string') return;

  const previous = streamBuffers.get(event.id) || '';
  const next = previous + event.content;
  streamBuffers.set(event.id, next);

  if (event.role === 'user') {
    setLastUserPin(next, event.id);

    // The new utterance becomes the pinned line; the previous one naturally
    // drops back into the independently scrollable history.
    renderMessages(currentMessages);

    if (event.endOfSpeech) {
      streamBuffers.delete(event.id);
    }
    return;
  }

  if (event.role === 'persona') {
    const isNewMessage = activeSubtitleMessageId !== event.id;
    activeSubtitleMessageId = event.id;

    if (isNewMessage) {
      partialTranslationSeq += 1;
      lastPartialTranslationAt = 0;
      if (captionsToggle.checked) subtitleEn.textContent = '…';
    }

    const limited = limitCamilleReply(next);

    if (limited.limited && !lengthInterruptedIds.has(event.id) && !event.endOfSpeech) {
      lengthInterruptedIds.add(event.id);
      try {
        anamClient?.interruptPersona();
      } catch (error) {
        console.warn('Could not stop overlong Camille reply:', error);
      }
    }

    if (captionsToggle.checked) {
      renderLiveDutch(limited.text, event.content);
      schedulePartialTranslation(limited.text, event.id);
    }

    processVocabularyProgress(event.id, limited.text, event.endOfSpeech);
    renderMessages(currentMessages);

    if (event.endOfSpeech || limited.limited) {
      streamBuffers.delete(event.id);
      partialTranslationSeq += 1;
      lastPartialTranslationAt = 0;
      finalizeSubtitle(limited.text, event.id);
    }

    if (event.endOfSpeech) {
      window.setTimeout(() => lengthInterruptedIds.delete(event.id), 12000);
    }
  }
}

function attachAnamListeners(client) {
  client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
    connected = true;
    connecting = false;
    document.body.classList.add('conversation-live');
    document.body.classList.remove('level-expanded');
    micButton.disabled = false;
    micButton.classList.add('live');
    micLabel.textContent = 'Camille connected';
    endButton.disabled = false;
    setAvatarLive(true);
    setStatus('Ready — spreek Vlaams');
  });

  client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
    setAvatarLive(true);
    if (!runtimeContextApplied) {
      setTimeout(pushLearningContext, 150);
    }
  });

  client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, handleStreamEvent);
  client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, handleMessagesUpdated);

  client.addListener(AnamEvent.USER_SPEECH_STARTED, () => {
    setStatus('Listening…');
    voiceRing.classList.add('active');
    successBalloon?.classList.add('listening');
    activeSubtitleMessageId = null;
    setSubtitle('…', '');
    renderMessages(currentMessages);

    if (isResponding) {
      try { activeChatAbort?.abort(); } catch {}
    }
  });

  client.addListener(AnamEvent.USER_SPEECH_ENDED, () => {
    setStatus('Thinking…');
    voiceRing.classList.remove('active');
    successBalloon?.classList.remove('listening');
    celebrateUserTurn();

    // Reinforce the short-dialog rules before Camille's next turn.
    if (connected) pushLearningContext();
  });

  client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, () => {
    try { activeChatAbort?.abort(); } catch {}
    isResponding = false;
  });

  client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
    endHistorySession();
    resetUiAfterDisconnect();
  });

  client.addListener(AnamEvent.MIC_PERMISSION_DENIED, () => {
    setStatus('Microphone permission needed');
  });
}

async function connect() {
  if (connected || connecting) return;

  connecting = true;
  runtimeContextApplied = false;
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
      const detail = data.anamMessage
        ? `${data.error || 'Anam error'} — ${data.anamMessage}`
        : (data.error || 'Could not create Anam session.');
      throw new Error(detail);
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
      document.body.classList.add('conversation-live');
      document.body.classList.remove('level-expanded');
      micButton.disabled = false;
      micButton.classList.add('live');
      micLabel.textContent = 'Camille connected';
      endButton.disabled = false;
      setAvatarLive(true);
      setStatus('Ready — spreek Vlaams');
    }

    beginHistorySession();
    saveCurrentHistory();
    setTimeout(pushLearningContext, 180);

    if (customLlmMode) {
      setTimeout(() => streamCamilleResponse([], true), 450);
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
    const message = String(error?.message || 'Camille could not connect to Anam.').slice(0, 180);
    avatarPlaceholderText.textContent = message;
    setStatus('Could not connect');
  }
}

function resetUiAfterDisconnect() {
  connected = false;
  connecting = false;
  document.body.classList.remove('conversation-live', 'level-expanded');
  customLlmMode = false;
  runtimeContextApplied = false;
  lastProcessedUserMessageId = null;
  isResponding = false;
  currentMessages = [];
  activeSubtitleMessageId = null;
  pinnedUserMessageId = null;
  lastUserPin.hidden = true;
  lastUserPinText.textContent = '';
  successBalloon?.classList.remove('listening', 'pop');
  streamBuffers.clear();
  lengthInterruptedIds.clear();
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
  endHistorySession();

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
  primePopAudio();
  if (!connected && !connecting) connect();
});

endButton.addEventListener('click', disconnect);

settingsButton.addEventListener('click', () => {
  settingsDialog.showModal();
});

captionsToggle.addEventListener('change', () => {
  setSubtitle(lastSubtitlePair.nl, lastSubtitlePair.en);
});

correctionLevel.addEventListener('change', () => {
  if (connected) pushLearningContext();
});

difficultySlider.addEventListener('input', () => {
  difficulty = clampLevel(Number(difficultySlider.value));
  updateDifficultyUi();
});

difficultySlider.addEventListener('change', () => {
  difficulty = clampLevel(Number(difficultySlider.value));
  localStorage.setItem(LEVEL_KEY, String(difficulty));
  updateDifficultyUi();
  saveCurrentHistory();
  if (connected) pushLearningContext();
  document.body.classList.remove('level-expanded');
});

difficultyToggle?.addEventListener('click', () => {
  document.body.classList.toggle('level-expanded');
});

historyButton.addEventListener('click', () => {
  renderHistoryDialog();
  historyDialog.showModal();
});

wordsButton.addEventListener('click', () => {
  renderWordsDialog();
  wordsDialog.showModal();
});

closeHistory.addEventListener('click', () => historyDialog.close());
closeWords.addEventListener('click', () => wordsDialog.close());

historyDialog.addEventListener('click', event => {
  if (event.target === historyDialog) historyDialog.close();
});

wordsDialog.addEventListener('click', event => {
  if (event.target === wordsDialog) wordsDialog.close();
});

window.addEventListener('beforeunload', () => {
  if (currentHistorySessionId) saveCurrentHistory();
});

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled error:', event.reason);
});

updateDifficultyUi();
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
