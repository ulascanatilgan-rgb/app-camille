import { createClient, AnamEvent } from '@anam-ai/js-sdk';
import { createVoiceOnlySession } from './voice-only.mjs';
import { initStudyPages } from './study-pages.mjs';
import { ECL_TOPICS, normalizeTopic, topicOpening, topicStarterChoices, topicInstruction } from './ecl-topics.mjs';

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
const liveReplayButton = document.getElementById('liveReplayButton');
const tipButton = document.getElementById('tipButton');
const tipPanel = document.getElementById('tipPanel');
const tipCloseButton = document.getElementById('tipCloseButton');
const tipTarget = document.getElementById('tipTarget');
const tipEnglish = document.getElementById('tipEnglish');
const avatarVideo = document.getElementById('avatarVideo');
const avatarPlaceholder = document.getElementById('avatarPlaceholder');
const avatarPlaceholderText = document.getElementById('avatarPlaceholderText');
const avatarBadge = document.getElementById('avatarBadge');
const personaPreview = document.getElementById('personaPreview');
const personaPicker = document.getElementById('personaPicker');
const personaButtons = [...document.querySelectorAll('.persona-select')];
const personaVoiceNotice = document.getElementById('personaVoiceNotice');
const providerButtons = [...document.querySelectorAll('.provider-choice')];
const providerNote = document.getElementById('providerNote');

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
const sessionHistoryButton = document.getElementById('sessionHistoryButton');
const sessionHistoryDialog = document.getElementById('sessionHistoryDialog');
const sessionHistoryContent = document.getElementById('sessionHistoryContent');
const sessionHistoryCount = document.getElementById('sessionHistoryCount');
const closeSessionHistory = document.getElementById('closeSessionHistory');
const workspaceEl = document.querySelector('.workspace');
const talkImmersiveHeader = document.getElementById('talkImmersiveHeader');
const talkImmersiveClose = document.getElementById('talkImmersiveClose');
const talkImmersiveTitle = document.getElementById('talkImmersiveTitle');
function setTalkImmersive(active){
  const visible=Boolean(active&&(!studyPages||studyPages.getPage()==='talk'));
  document.body.classList.toggle('talk-immersive',visible);
  if(talkImmersiveHeader)talkImmersiveHeader.hidden=!visible;
  if(visible){
    if(talkImmersiveTitle)talkImmersiveTitle.textContent=personaName()+' · '+
      ({nl:'Dutch',fr:'French',en:'English'}[targetLanguage]||'Dutch');
    updateTypeKeyboardOffset();
  }else{
    document.documentElement.style.removeProperty('--ecl-live-visible-height');
  }
}

const wordCard = document.getElementById('wordCard');
const wordNl = document.getElementById('wordNl');
const wordEn = document.getElementById('wordEn');
const lastUserPin = document.getElementById('lastUserPin');
const lastUserPinText = document.getElementById('lastUserPinText');
const lastUserPinEn = document.getElementById('lastUserPinEn');
const successBalloon = document.getElementById('successBalloon');
const typeToggle = document.getElementById('typeToggle');
const typeComposer = document.getElementById('typeComposer');
const typeInput = document.getElementById('typeInput');
const speakModeButton = document.getElementById('speakModeButton');
const typeModeButton = document.getElementById('typeModeButton');
const buttonModeButton = document.getElementById('buttonModeButton');
const quickReplyBar = document.getElementById('quickReplyBar');
const languageToggle = document.getElementById('languageToggle');
const languageToggleLabel = document.getElementById('languageToggleLabel');
const topicSelect = document.getElementById('topicSelect');
const topicCaption = document.getElementById('topicCaption');
const practiceEyebrow = document.getElementById('practiceEyebrow');
const practiceTitle = document.getElementById('practiceTitle');
const practiceDescription = document.getElementById('practiceDescription');
const avatarGoal = document.getElementById('avatarGoal');
const levelLabel = document.getElementById('levelLabel');
const modeHint = document.getElementById('modeHint');

const LEGACY_HISTORY_KEY = 'camille.history.v2';
const LEGACY_WORDS_KEY = 'camille.words.v2';
const HISTORY_BASE_KEY = 'camille.history.v3';
const WORDS_BASE_KEY = 'camille.words.v3';
const LEVEL_KEY = 'camille.difficulty.v1';
const LANGUAGE_KEY = 'camille.targetLanguage.v1';
const TOPIC_KEY = 'ecl.selectedTopic.v1';
const CHOICE_MODE_KEY = 'camille.choiceMode.v1';
const INPUT_MODE_KEY = 'camille.inputMode.v1';
const PERSONA_KEY = 'ecl.selectedPersona.v1';
const PERSONA_NAMES = Object.freeze({emma:'Emma',charlotte:'Charlotte',louis:'Louis'});
const storedPersona = localStorage.getItem(PERSONA_KEY);
let selectedPersona = Object.hasOwn(PERSONA_NAMES,storedPersona) ? storedPersona : 'emma';
let switchingPersona = false;
const PROVIDER_KEY = 'ecl.connectionMode.v1';
let selectedProvider = localStorage.getItem(PROVIDER_KEY)==='voice' ? 'voice' : 'video';
let switchingProvider = false;
let voiceSession = null;
let handoffContext = '';
function updateProviderUi() {
  document.body.classList.toggle('ecl-voice-only',selectedProvider==='voice');
  for(const button of providerButtons) {
    const active=button.dataset.provider===selectedProvider;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
    button.disabled=connecting || switchingProvider || switchingPersona;
  }
  if(providerNote)providerNote.textContent=selectedProvider==='voice'
    ? 'AI-generated voice · OpenAI'
    : 'Anam avatar & voice';
  if(personaVoiceNotice)personaVoiceNotice.textContent=selectedProvider==='voice'
    ? personaName()+' uses an AI-generated OpenAI voice.'
    : 'Voice provided by '+personaName()+'\'s Anam persona.';
}
function personaName(key=selectedPersona){return PERSONA_NAMES[key] || 'Emma';}

let anamClient = null;
let connected = false;
let connecting = false;
let customLlmMode = false;
let sessionOpeningSeq = 0;
let connectionEpoch = 0; // Cancel pending Anam or OpenAI connection when leaving Talk.
let currentMessages = [];
let lastProcessedUserMessageId = null;
let isResponding = false;
let voiceButtonTimer = null;
let activeChatAbort = null;
let activeTalkStream = null;
let partialTranslationSeq = 0;
let lastPartialTranslationAt = 0;
let activeSubtitleMessageId = null;
let currentHistorySessionId = null;
let runtimeContextApplied = false;
let pinnedUserMessageId = null;
let popAudioContext = null;
let userTranslationSeq = 0;
let lastUserTranslationAt = 0;
const savedInputMode = localStorage.getItem(INPUT_MODE_KEY);
let interactionMode = ['speak', 'type', 'button'].includes(savedInputMode)
  ? savedInputMode
  : (localStorage.getItem(CHOICE_MODE_KEY) === 'true' ? 'button' : 'speak');
let choiceModeEnabled = interactionMode === 'button';
let choiceGenerationSeq = 0;
let lastChoiceSource = '';
let pendingChoiceSource = '';
let tipRequestSeq = 0;
let tipAbortController = null;
let cachedTip = null;
let replaySequence = 0;
let replayingAudio = false;
let replayHighlightTimer = null;

const streamBuffers = new Map();
const vocabProcessedIds = new Set();
const vocabSentenceCounts = new Map();
const translationByMessageId = new Map();
const lengthInterruptedIds = new Set();
let vocabQueue = Promise.resolve();

let difficulty = clampLevel(Number(localStorage.getItem(LEVEL_KEY) || 2));
const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
let targetLanguage = ['nl', 'fr', 'en'].includes(savedLanguage) ? savedLanguage : 'nl';
let selectedTopic = normalizeTopic(localStorage.getItem(TOPIC_KEY));
let switchingTopic = false;
let studyPages = null;
let learnedWords = [];

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

const englishDifficultyMeta = {
  1: { cefr: 'B1', name: 'Clear' },
  2: { cefr: 'B2', name: 'Professional' },
  3: { cefr: 'B2+', name: 'Fluent' },
  4: { cefr: 'C1', name: 'Polished' },
  5: { cefr: 'C1+', name: 'Executive' }
};

const languageUi = {
  nl: {
    short: 'NL',
    name: 'Dutch',
    coach: 'Flemish',
    locale: 'nl-BE',
    eyebrow: 'PRACTICAL FLEMISH',
    title: 'Praat gewoon.',
    description: 'Practical spoken Flemish for work, daily life and real conversations.',
    goal: '6 months · Flanders',
    level: 'DUTCH LEVEL',
    hint: 'Speak or type in Dutch or English. Emma always answers in Dutch.',
    placeholder: 'Write in Dutch or English…',
    greeting: "Hey Ulas. Hoe is 't vandaag?",
    greetingEn: 'Hey Ulas. How are you today?',
    ready: 'Ready — spreek Vlaams'
  },
  fr: {
    short: 'FR',
    name: 'French',
    coach: 'French',
    locale: 'fr-FR',
    eyebrow: 'PRACTICAL FRENCH',
    title: 'Parle simplement.',
    description: 'Practical spoken French for work, daily life and real conversations.',
    goal: '6 months · French',
    level: 'FRENCH LEVEL',
    hint: 'Speak or type in French or English. Emma always answers in French.',
    placeholder: 'Write in French or English…',
    greeting: 'Salut Ulas. Ça va aujourd’hui ?',
    greetingEn: 'Hi Ulas. How are you today?',
    ready: 'Ready — parle français'
  },
  en: {
    short: 'EN',
    name: 'English',
    coach: 'Professional English',
    locale: 'en-GB',
    eyebrow: 'PROFESSIONAL ENGLISH',
    title: 'Speak with impact.',
    description: 'Fluent, polished English for meetings, stakeholders, interviews and international work.',
    goal: 'Professional · Global',
    level: 'ENGLISH LEVEL',
    hint: 'Speak or type in English. Emma improves clarity, fluency and professional impact.',
    placeholder: 'Write in English…',
    greeting: 'Hi Ulas. What are you working on today?',
    greetingEn: '',
    ready: 'Ready — professional English'
  }
};

function languageConfig() {
  return languageUi[targetLanguage] || languageUi.nl;
}

function updatePersonaUi() {
  const name = personaName();
  for(const button of personaButtons){
    const active = button.dataset.persona === selectedPersona;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
    button.disabled = switchingPersona || connecting;
  }
  document.querySelector('.avatar-column')?.setAttribute('aria-label', name+' live Anam avatar');
  if(personaPreview){
    personaPreview.onerror = () => {
      personaPreview.onerror = null;
      const fallback = selectedPersona === 'emma' ? '/emma-portrait.jpg' :
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 520">'+
          '<rect width="360" height="520" fill="#292725"/>'+
          '<circle cx="180" cy="188" r="70" fill="#766e65"/>'+
          '<path d="M66 505v-70c0-78 51-130 114-130s114 52 114 130v70" fill="#766e65"/>'+
          '<text x="180" y="492" fill="#fff5e8" font-family="sans-serif" font-size="26" text-anchor="middle">'+name+'</text></svg>');
      personaPreview.src = fallback;
    };
    personaPreview.src = '/ecl-avatar-image/'+selectedPersona+'.jpg?v=3';
    personaPreview.alt = name+' avatar';
  }
  const label=document.querySelector('.live-camille .live-speaker-label');
  if(label)label.textContent=name.toUpperCase();
  updateProviderUi();
  if(!connected && !connecting && avatarPlaceholderText)avatarPlaceholderText.textContent=name+' is ready to talk.';
}
function updateTopicUi() {
  if(topicSelect) {
    topicSelect.value=selectedTopic;
    topicSelect.disabled=switchingTopic || connecting || switchingPersona;
  }
  if(topicCaption)topicCaption.textContent=selectedTopic==='open'
    ? 'Free conversation'
    : 'Focused: '+ECL_TOPICS[selectedTopic].label;
  document.body.dataset.practiceTopic=selectedTopic;
}
function updateLanguageUi(resetSubtitle = false) {
  const cfg = languageConfig();
  document.documentElement.lang = targetLanguage;
  document.body.dataset.learningLanguage = targetLanguage;
  languageToggleLabel.textContent = cfg.short;
  const nextLanguage = targetLanguage === 'nl' ? 'French' : targetLanguage === 'fr' ? 'English' : 'Dutch';
  languageToggle.title = `Switch to ${nextLanguage}`;
  practiceEyebrow.textContent = cfg.eyebrow;
  practiceTitle.textContent = cfg.title;
  practiceDescription.textContent = cfg.description;
  if (avatarGoal) avatarGoal.textContent = cfg.goal;
  levelLabel.textContent = cfg.level;
  modeHint.textContent = cfg.hint.replaceAll('Emma',personaName());
  typeInput.placeholder = cfg.placeholder;
  const displayMeta = targetLanguage === 'en' ? englishDifficultyMeta[difficulty] : difficultyMeta[difficulty];
  difficultyName.textContent = `${displayMeta.cefr} · ${displayMeta.name}`;

  const historyTitle = historyDialog?.querySelector('.archive-title-row h2');
  const wordsTitle = wordsDialog?.querySelector('.archive-title-row h2');
  if (historyTitle) historyTitle.textContent = `${cfg.name} History`;
  if (wordsTitle) wordsTitle.textContent = `${cfg.name} Words`;
  historyButton.setAttribute('aria-label', `${cfg.name} history`);
  wordsButton.setAttribute('aria-label', `${cfg.name} saved words`);
  if (resetSubtitle) {
    const opening = topicOpening(selectedTopic,targetLanguage);
    lastSubtitlePair = { nl: opening, en: selectedTopic==='open' ? cfg.greetingEn :
      (targetLanguage==='en'?'':topicOpening(selectedTopic,'en')) };
    setSubtitle(lastSubtitlePair.nl, lastSubtitlePair.en);
    if (lastUserPinEn) lastUserPinEn.textContent = '';
  }
}

function languageStoreSuffix(language = targetLanguage) {
  return ['nl', 'fr', 'en'].includes(language) ? language : 'nl';
}

function historyKey(language = targetLanguage) {
  return `${HISTORY_BASE_KEY}.${languageStoreSuffix(language)}`;
}

function wordsKey(language = targetLanguage) {
  return `${WORDS_BASE_KEY}.${languageStoreSuffix(language)}`;
}

function migrateLanguageStores() {
  const dutchHistoryKey = historyKey('nl');
  const dutchWordsKey = wordsKey('nl');

  if (!localStorage.getItem(dutchHistoryKey)) {
    const legacyHistory = loadJson(LEGACY_HISTORY_KEY, []);
    if (Array.isArray(legacyHistory) && legacyHistory.length) {
      saveJson(
        dutchHistoryKey,
        legacyHistory.map(session => ({ ...session, language: 'nl' }))
      );
    }
  }

  if (!localStorage.getItem(dutchWordsKey)) {
    const legacyWords = loadJson(LEGACY_WORDS_KEY, []);
    if (Array.isArray(legacyWords) && legacyWords.length) {
      saveJson(dutchWordsKey, legacyWords);
    }
  }
}

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

function replayLocale() {
  return languageConfig().locale || (targetLanguage === 'fr' ? 'fr-FR' : targetLanguage === 'en' ? 'en-GB' : 'nl-BE');
}

function splitReplaySentences(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  return clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map(part => part.trim()).filter(Boolean) || [clean];
}

function replayWordParts(text) {
  return String(text || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*|[^\p{L}\p{N}'’\-]+/gu) || [String(text || '')];
}

function renderReplayHighlight(element, text, activeWordIndex = -1) {
  if (!element) return;
  const clean = String(text || '');
  const parts = replayWordParts(clean);
  let wordIndex = -1;
  const fragment = document.createDocumentFragment();

  for (const part of parts) {
    if (/^[\p{L}\p{N}]/u.test(part)) {
      wordIndex += 1;
      const span = document.createElement('span');
      span.textContent = part;
      if (wordIndex === activeWordIndex) span.className = 'replay-word-active';
      fragment.appendChild(span);
    } else {
      fragment.appendChild(document.createTextNode(part));
    }
  }

  element.replaceChildren(fragment);
}

function estimateReplayDuration(text) {
  const words = countSpokenWords(text);
  const punctuationPauses = (String(text || '').match(/[,.!?;:]/g) || []).length;
  return Math.max(950, words * 460 + punctuationPauses * 120);
}

function animateReplayHighlight(element, text, duration, runId) {
  if (!element) return Promise.resolve();
  const words = countSpokenWords(text);
  if (!words) return Promise.resolve();

  const step = Math.max(180, duration / words);
  let index = 0;
  renderReplayHighlight(element, text, 0);

  return new Promise(resolve => {
    const tick = () => {
      if (runId !== replaySequence) {
        renderReplayHighlight(element, text, -1);
        resolve();
        return;
      }

      index += 1;
      if (index >= words) {
        renderReplayHighlight(element, text, -1);
        resolve();
        return;
      }

      renderReplayHighlight(element, text, index);
      replayHighlightTimer = window.setTimeout(tick, step);
    };

    replayHighlightTimer = window.setTimeout(tick, step);
  });
}

function pickBrowserVoice(locale) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const normalized = String(locale || '').toLowerCase();
  const base = normalized.split('-')[0];
  return voices.find(voice => voice.lang?.toLowerCase() === normalized)
    || voices.find(voice => voice.lang?.toLowerCase().startsWith(base))
    || null;
}

function browserReplay(text, element, runId) {
  return new Promise(resolve => {
    if (!('speechSynthesis' in window)) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = replayLocale();
    utterance.rate = 0.82;
    utterance.pitch = 1;
    const voice = pickBrowserVoice(utterance.lang);
    if (voice) utterance.voice = voice;

    const duration = estimateReplayDuration(text);
    const highlight = animateReplayHighlight(element, text, duration, runId);

    utterance.onend = async () => {
      await highlight;
      resolve();
    };
    utterance.onerror = async () => {
      await highlight;
      resolve();
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

async function replayText(text, element = null, { useAvatarVoice = false } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return;

  if (isResponding) {
    setStatus('Wait for Emma to finish');
    return;
  }

  const runId = ++replaySequence;
  if (replayHighlightTimer) window.clearTimeout(replayHighlightTimer);
  replayHighlightTimer = null;
  window.speechSynthesis?.cancel?.();
  replayingAudio = true;

  try {
    if (connected && anamClient) {
      try { anamClient.muteInputAudio(); } catch {}
    }

    if (selectedProvider==='voice') {
      if (!connected || !voiceSession) {
        setStatus('Start Voice Only to replay sentences');
        return;
      }
      const duration=estimateReplayDuration(clean);
      const highlight=animateReplayHighlight(element,clean,duration,runId);
      voiceSession.setMuted(true);
      const spoken=await voiceSession.speakTextExactly(clean);
      if(!spoken)throw new Error('OpenAI Realtime could not replay the sentence');
      await highlight;
    } else if (useAvatarVoice && connected && anamClient) {
      const duration = estimateReplayDuration(clean);
      const highlight = animateReplayHighlight(element, clean, duration, runId);
      await anamClient.talk(clean);
      await highlight;
    } else {
      await browserReplay(clean, element, runId);
    }
  } catch (error) {
    console.warn('ECL replay failed:', error);
    if(selectedProvider==='voice')setStatus('OpenAI replay unavailable');
    else if (runId === replaySequence) await browserReplay(clean, element, runId);
  } finally {
    if (runId === replaySequence) {
      if (replayHighlightTimer) window.clearTimeout(replayHighlightTimer);
      replayHighlightTimer = null;
      renderReplayHighlight(element, clean, -1);
      replayingAudio = false;
      applyInteractionAudioState();
      if (connected) setStatus(languageConfig().ready);
    }
  }
}

function createAudioReplayButton(text, element, label = 'Replay audio') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'audio-replay-button';
  button.textContent = '🎧';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.addEventListener('click', event => {
    event.stopPropagation();
    replayText(text, element);
  });
  return button;
}

function setLastUserPin(text, messageId = null, english = null) {
  const clean = String(text || '').trim();

  if (!clean) {
    if (!lastUserPinText.textContent.trim()) lastUserPin.hidden = true;
    return;
  }

  if (messageId && pinnedUserMessageId !== messageId) {
    pinnedUserMessageId = messageId;
    userTranslationSeq += 1;
    lastUserTranslationAt = 0;
    if (lastUserPinEn) lastUserPinEn.textContent = '';
  }

  lastUserPinText.textContent = clean;
  if (english !== null && lastUserPinEn) lastUserPinEn.textContent = english || '';
  lastUserPin.hidden = false;
}

function countSpokenWords(text) {
  return String(text || '').trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu)?.length || 0;
}

function limitCamilleReply(text) {
  const original = String(text || '').trim();
  if (!original) return { text: '', limited: false };

  const words = original.split(/\s+/).filter(Boolean);
  const maxWords = targetLanguage === 'en' ? 28 : 20;
  let limited = words.slice(0, maxWords).join(' ');

  const sentenceEnds = [...limited.matchAll(/[.!?](?=\s|$)/g)];
  if (sentenceEnds.length > 3) {
    limited = limited.slice(0, sentenceEnds[2].index + 1).trim();
  }

  return {
    text: limited,
    limited: words.length > (targetLanguage === 'en' ? 28 : 20) || sentenceEnds.length > 3
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

  const lower = clean.toLocaleLowerCase(languageConfig().locale);
  const target = activeWord.toLocaleLowerCase(languageConfig().locale);
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

// Anam's history updates can omit manually typed answers or arrive before the
// final speech transcript. Keep an additive, ordered transcript for all input modes.
function transcriptText(role, value) {
  const text = String(value || '').trim();
  return normalizedRole(role) === 'persona' ? limitCamilleReply(text).text : text;
}

function findTranscriptMatch(turn, from = 0, matchContent = false) {
  if (turn.id) {
    const byId = currentMessages.findIndex((entry, index) =>
      index >= from && entry.id === turn.id && normalizedRole(entry.role) === turn.role);
    if (byId !== -1) return byId;
  }
  if (!matchContent) return -1;
  return currentMessages.findIndex((entry, index) =>
    index >= from && normalizedRole(entry.role) === turn.role &&
    transcriptText(entry.role, entry.content) === turn.content);
}

function upsertConversationTurn(turn, { from = 0, insertAt = null, matchContent = false } = {}) {
  const role = normalizedRole(turn?.role);
  const content = transcriptText(role, turn?.content);
  if (!content || (role === 'user' && content === 'Listening…')) return -1;

  const id = turn?.id || `transcript-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const normalized = { id, role, content };
  const index = findTranscriptMatch(normalized, from, matchContent);
  if (index !== -1) {
    const existing = currentMessages[index];
    // Don't downgrade complete speech to an earlier partial SDK snapshot.
    if (content.length >= existing.content.trim().length) existing.content = content;
    if (!existing.id) existing.id = id;
    return index;
  }

  const position = insertAt === null
    ? currentMessages.length
    : Math.min(currentMessages.length, Math.max(from, insertAt));
  currentMessages.splice(position, 0, normalized);
  return position;
}

function mergeAnamHistory(messages) {
  if (!Array.isArray(messages)) return;
  const incoming = messages
    .filter(message => message && typeof message.content === 'string' && message.content.trim())
    .map((message, index) => ({
      id: message.id || `anam-snapshot-${index}-${normalizedRole(message.role)}`,
      role: normalizedRole(message.role),
      content: transcriptText(message.role, message.content)
    }))
    .filter(message => message.content);

  let from = 0;
  for (let i = 0; i < incoming.length; i++) {
    const turn = incoming[i];
    let match = findTranscriptMatch(turn, from, true);

    if (match === -1) {
      // When a delayed SDK snapshot supplies an earlier turn, place it before
      // the next existing turn rather than moving it to the end of the talk.
      let nextKnown = null;
      for (let j = i + 1; j < incoming.length; j++) {
        const next = findTranscriptMatch(incoming[j], from, true);
        if (next !== -1) {
          nextKnown = next;
          break;
        }
      }
      match = upsertConversationTurn(turn, { from, insertAt: nextKnown, matchContent: true });
    } else {
      match = upsertConversationTurn(turn, { from, matchContent: true });
    }
    if (match !== -1) from = match + 1;
  }
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
    .slice(-6);

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

async function scheduleUserTranslation(text, messageId) {
  const clean = String(text || '').trim();
  if (!clean || !lastUserPinEn) return;

  const now = Date.now();
  if (now - lastUserTranslationAt < 220) return;
  lastUserTranslationAt = now;

  const seq = ++userTranslationSeq;
  const english = await translateToEnglish(clean);

  if (seq === userTranslationSeq && pinnedUserMessageId === messageId && english) {
    lastUserPinEn.textContent = english;
  }
}

async function finalizeUserTranslation(text, messageId) {
  const clean = String(text || '').trim();
  if (!clean || !lastUserPinEn) return;

  const seq = ++userTranslationSeq;
  const english = await translateToEnglish(clean);

  if (seq === userTranslationSeq && pinnedUserMessageId === messageId) {
    lastUserPinEn.textContent = english || '';
    if (english) {
      translationByMessageId.set(messageId, english);
      saveCurrentHistory();
    }
  }
}

async function translateToEnglish(text) {
  const clean = (text || '').trim();
  if (!clean || targetLanguage === 'en') return '';

  try {
    const response = await fetch('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean, targetLanguage })
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

// iPhone keyboard can shrink visualViewport without changing 100dvh.
// Keep Type in the regular footer while resizing its available workspace.
function updateTypeKeyboardOffset() {
  const vv=window.visualViewport;
  const visible=vv?.height || window.innerHeight;
  document.documentElement.style.setProperty('--ecl-live-visible-height',
    Math.max(350,Math.round(visible))+'px');
  const header=document.querySelector('.topbar')?.getBoundingClientRect().height || 100;
  const themeBar=document.querySelector('.topic-strip')?.getBoundingClientRect().height || 42;
  const providerBar=document.querySelector('.conversation-provider-strip')?.getBoundingClientRect().height || 42;
  const talkToolsBar=document.getElementById('talkToolsStrip')?.getBoundingClientRect().height || 37;
  document.documentElement.style.setProperty('--ecl-visible-workspace-height',Math.max(155,Math.round(visible-header-themeBar-providerBar-talkToolsBar))+'px');
  const covered=window.innerHeight-visible-(vv?.offsetTop||0);
  document.body.classList.toggle('ecl-keyboard-visible',interactionMode==='type'&&covered>100);
}
function captureStableTypeViewport() { updateTypeKeyboardOffset(); }
function updateTypeModeLayout() {
  const active=interactionMode==='type';
  document.body.classList.toggle('type-input-mode',active);
  if(active)updateTypeKeyboardOffset();
  else {
    document.body.classList.remove('ecl-keyboard-visible');
    document.documentElement.style.removeProperty('--ecl-visible-workspace-height');
  }
}
function updateInteractionModeUi() {
  const buttons = [
    [speakModeButton, 'speak'],
    [typeModeButton, 'type'],
    [buttonModeButton, 'button']
  ];

  for (const [button, mode] of buttons) {
    if (!button) continue;
    const active = interactionMode === mode;
    button.classList.toggle('active', active);
    button.classList.toggle('inactive', !active);
    button.setAttribute('aria-pressed', String(active));
  }

  choiceModeEnabled = interactionMode === 'button';
  typeComposer.hidden = interactionMode !== 'type';
  updateTypeModeLayout();

  if (interactionMode !== 'button') clearQuickChoices();
  if (tipButton) tipButton.hidden = false; // Tips help both speaking and button learners.
  hideTip();
  // Populate immediately, including a saved Button selection before Start.
  if (interactionMode === 'button') primeButtonChoices();
}

function applyInteractionAudioState() {
  if (selectedProvider==='voice') {
    voiceSession?.setMuted(interactionMode !== 'speak');
    return;
  }
  if (!anamClient || !connected) return;

  try {
    if (interactionMode === 'speak') {
      anamClient.unmuteInputAudio();
    } else {
      anamClient.muteInputAudio();
    }
  } catch (error) {
    console.warn('Could not change Emma microphone state:', error);
  }
}

function interactionModeInstruction() {
  const pace = ' Keep Emma’s spoken delivery calm, clearly articulated and about 15% slower than ordinary conversational speed.';
  if (interactionMode === 'button') {
    return 'INPUT MODE: BUTTON. The microphone is muted. The user responds through short interface choices. Treat one- or two-word button answers as intentional complete answers and continue naturally.' + pace;
  }
  if (interactionMode === 'type') {
    return 'INPUT MODE: TYPE. The microphone is muted. The user types messages. Continue the same conversation naturally without restarting or changing topic just because the input method changed.' + pace;
  }
  return 'INPUT MODE: SPEAK. The microphone is active. Continue normal spoken conversation.' + pace;
}

function syncRecentConversationContext() {
  if (!anamClient || !connected) return;

  const recent = currentMessages
    .filter(message => message?.content?.trim())
    .slice(-8)
    .map(message => {
      const role = message.role === 'persona' ? personaName().toUpperCase() : 'ULAS';
      return `${role}: ${message.content.trim()}`;
    })
    .join('\n');

  if (!recent) return;

  try {
    anamClient.addContext(
      `CONVERSATION CONTINUITY: The following exchanges are already part of this same live conversation, including typed or button turns. Do not restart the topic. Continue naturally from them.\n${recent}`
    );
  } catch (error) {
    console.warn('Could not sync conversation context:', error);
  }
}

function setInteractionMode(mode) {
  if (!['speak', 'type', 'button'].includes(mode)) return;
  interactionMode = mode;
  choiceModeEnabled = mode === 'button';
  localStorage.setItem(INPUT_MODE_KEY, mode);
  localStorage.setItem(CHOICE_MODE_KEY, String(choiceModeEnabled));

  updateInteractionModeUi();
  applyInteractionAudioState();

  if (connected) {
    syncRecentConversationContext();
    try {
      anamClient?.addContext(interactionModeInstruction());
      anamClient?.addContext(choiceModeInstruction());
    } catch {}
    pushLearningContext();

    if (mode === 'button') primeButtonChoices();
  }
}

// Never display foreign-script or corrupted model output in a Latin-language lesson.
function readablePracticeText(value) {
  const clean = typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
  return Boolean(clean && clean.length <= 180 &&
    /\p{Script=Latin}/u.test(clean) &&
    /^[\p{Script=Latin}\p{Mark}0-9 .,!?;:'’"()\-–—]+$/u.test(clean));
}

function defaultButtonChoices(context='opening') {
  const greeting={
    nl:[{text:'Goed, dank je',english:'Good, thank you'},{text:'Gaat wel',english:'So-so'},{text:'Niet zo goed',english:'Not so good'}],
    fr:[{text:'Très bien',english:'Very well'},{text:'Ça va',english:'I’m okay'},{text:'Pas très bien',english:'Not very well'}],
    en:[{text:'Project updates',english:''},{text:'Planning',english:''},{text:'Meetings',english:''}]
  };
  const general={
    nl:[{text:'Ja',english:'Yes'},{text:'Nee',english:'No'},{text:'Weet ik niet',english:'I don’t know'}],
    fr:[{text:'Oui',english:'Yes'},{text:'Non',english:'No'},{text:'Je ne sais pas',english:'I don’t know'}],
    en:[{text:'Yes',english:''},{text:'No',english:''},{text:'Not sure yet',english:''}]
  };
  if(context==='opening' && selectedTopic!=='open')return topicStarterChoices(selectedTopic,targetLanguage);
  return (context==='opening'?greeting:general)[targetLanguage] || greeting.nl;
}
function primeButtonChoices() {
  if(interactionMode!=='button' || !quickReplyBar || isResponding) return;
  const last=currentMessages[currentMessages.length-1];
  if(last?.role==='user')return;
  if(last?.role==='persona' && connected) {
    requestQuickChoices(last.content);
    return;
  }
  // Show options even before Anam starts or provides the first transcript.
  if(quickReplyBar.hidden || quickReplyBar.children.length!==3) {
    renderQuickChoices(defaultButtonChoices('opening'));
  }
}

function instantTipFor(question) {
  const q=String(question||'').toLocaleLowerCase();
  const examples={
    nl:[
      [/\b(waar|waarheen)\b/,['Hier in de buurt.','Here in the area.']],
      [/\b(wanneer|hoe laat)\b/,['Morgen, als dat kan.','Tomorrow, if possible.']],
      [/\b(waarom)\b/,['Omdat het belangrijk is.','Because it is important.']],
      [/\b(wat|welke)\b/,['Dat vind ik interessant.','I find that interesting.']],
      [/\b(hoe gaat|hoe is|alles goed)\b/,['Goed, dank je!','Good, thank you!']]
    ],
    fr:[
      [/\b(où)\b/,['Près de chez moi.','Near my home.']],
      [/\b(quand|quelle heure)\b/,['Demain, si possible.','Tomorrow, if possible.']],
      [/\b(pourquoi)\b/,['Parce que c’est important.','Because it is important.']],
      [/\b(quoi|que|quel|quelle)\b/,['Ça m’intéresse beaucoup.','I find that interesting.']],
      [/\b(comment ça va|tu vas bien)\b/,['Très bien, merci !','Very well, thank you!']]
    ],
    en:[
      [/\b(where)\b/,['Near my office.','']],
      [/\b(when|what time)\b/,['Tomorrow works for me.','']],
      [/\b(why)\b/,['Because it matters.','']],
      [/\b(what|which)\b/,['That sounds useful.','']],
      [/\b(how are you)\b/,['I’m doing well.','']]
    ]
  };
  const fallback={nl:['Ja, graag.','Yes, please.'],fr:['Oui, volontiers.','Yes, gladly.'],en:['Yes, please.','']}[targetLanguage];
  const found=(examples[targetLanguage]||examples.nl).find(([re])=>re.test(q));
  const [text,english]=found?found[1]:fallback;
  return {text,english};
}
function hideTip() {
  tipRequestSeq += 1;
  if (tipAbortController) tipAbortController.abort();
  tipAbortController = null;
  if (tipPanel) tipPanel.hidden = true;
  if (tipButton) tipButton.setAttribute('aria-expanded', 'false');
}

async function showTip() {
  if (!tipPanel) return;
  if (!tipPanel.hidden) { hideTip(); return; }

  const source = subtitleNl?.textContent?.trim() || lastSubtitlePair.nl || '';
  // The last saved avatar message also works before live subtitles arrive.
  const question=source||[...currentMessages].reverse().find(m=>m.role==='persona')?.content||topicOpening(selectedTopic,targetLanguage)||'';
  const cacheKey = `${targetLanguage}:${question}`;
  const seq = ++tipRequestSeq;
  tipPanel.hidden = false;
  tipButton?.setAttribute('aria-expanded', 'true');
  // Never leave the learner waiting for a remote suggestion.
  const quick=[...quickReplyBar?.querySelectorAll('.quick-reply-button')||[]][0];
  const initial=quick?.querySelector('.quick-reply-target')?.textContent?.trim();
  const initialEn=quick?.querySelector('.quick-reply-english')?.textContent?.trim();
  const fallback=instantTipFor(question);
  tipTarget.textContent=initial||fallback.text;
  tipEnglish.textContent=targetLanguage==='en'?'':(initialEn||fallback.english);

  if (cachedTip?.key === cacheKey) {
    tipTarget.textContent = cachedTip.text;
    tipEnglish.textContent = targetLanguage === 'en' ? '' : cachedTip.english;
    return;
  }

  const controller = new AbortController();
  tipAbortController = controller;
  try {
    const recentMessages = currentMessages
      .filter(message => message?.content?.trim())
      .slice(-6)
      .map(message => ({ role: normalizedRole(message.role), content: message.content.trim() }));
    const timeout=window.setTimeout(()=>controller.abort(),4500);
    const response = await fetch('/tip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ text: question, targetLanguage, persona:selectedPersona, topic:selectedTopic, recentMessages })
    }).finally(()=>window.clearTimeout(timeout));
    if (!response.ok) throw new Error('Tip unavailable');
    const data = await response.json();
    if (seq !== tipRequestSeq || tipPanel.hidden) return;
    if (!data.tip?.text || !readablePracticeText(data.tip.text) ||
        (targetLanguage !== 'en' && !readablePracticeText(data.tip.english))) {
      throw new Error('Invalid or unavailable suggestion');
    }
    cachedTip = { key: cacheKey, text: String(data.tip.text).trim(), english: String(data.tip.english || '').trim() };
    tipTarget.textContent = cachedTip.text;
    tipEnglish.textContent = targetLanguage === 'en' ? '' : cachedTip.english;
  } catch (error) {
    if (error?.name === 'AbortError' || seq !== tipRequestSeq) return;
    // Keep the instant, usable suggestion visible when the API fails.
  } finally {
    if (seq === tipRequestSeq) tipAbortController = null;
  }
}

function clearQuickChoices() {
  choiceGenerationSeq += 1;
  lastChoiceSource = '';
  pendingChoiceSource = '';
  if (!quickReplyBar) return;
  quickReplyBar.innerHTML = '';
  quickReplyBar.hidden = true;
}

function renderQuickChoices(choices) {
  if (!quickReplyBar || interactionMode !== 'button' || !Array.isArray(choices) || choices.length !== 3) {
    clearQuickChoices();
    return;
  }

  quickReplyBar.innerHTML = '';
  for (const choice of choices) {
    const text = String(typeof choice === 'string' ? choice : choice?.text || '').trim();
    const english = String(typeof choice === 'string' ? '' : choice?.english || '').trim();
    if (!readablePracticeText(text) ||
        (targetLanguage !== 'en' && !readablePracticeText(english))) continue;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'quick-reply-button';
    const target = document.createElement('span');
    target.className = 'quick-reply-target';
    target.textContent = text;
    button.appendChild(target);
    if (targetLanguage !== 'en' && english) {
      const translation = document.createElement('span');
      translation.className = 'quick-reply-english';
      translation.textContent = english;
      button.appendChild(translation);
    }
    button.setAttribute('aria-label', targetLanguage !== 'en' && english ? `${text} — ${english}` : text);
    button.addEventListener('click', async () => {
      if(isResponding || connecting) return;
      // Button itself may launch the first Anam conversation.
      if(!connected) {
        await connect();
        if(!connected || interactionMode!=='button') return;
      }
      if(!anamClient || isResponding)return;
      clearQuickChoices();
      void sendTypedTurn(text,'button');
    });
    quickReplyBar.appendChild(button);
  }

  quickReplyBar.hidden = quickReplyBar.children.length !== 3;
}

async function requestQuickChoices(camilleText) {
  const clean = String(camilleText || '').trim();
  if (interactionMode !== 'button' || !connected || !clean) {
    clearQuickChoices();
    return;
  }

  if (clean === pendingChoiceSource ||
      (clean === lastChoiceSource && quickReplyBar && !quickReplyBar.hidden)) return;
  // Asynchronous AI generation must never remove all visible options.
  if(quickReplyBar && (quickReplyBar.hidden || quickReplyBar.children.length!==3)) {
    renderQuickChoices(defaultButtonChoices(clean===topicOpening(selectedTopic,targetLanguage)?'opening':'generic'));
  }
  lastChoiceSource=clean;
  pendingChoiceSource=clean;
  const seq=++choiceGenerationSeq;
  try {
    const recentMessages = currentMessages
      .filter(message => message?.content?.trim())
      .slice(-6)
      .map(message => ({
        role: normalizedRole(message.role),
        content: message.content.trim()
      }));

    const response = await fetch('/choices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: clean,
        targetLanguage,
        persona:selectedPersona,
        topic:selectedTopic,
        recentMessages
      })
    });

    if (!response.ok) throw new Error('Could not generate quick replies.');
    const data = await response.json();

    if(seq!==choiceGenerationSeq || interactionMode!=='button')return;
    // Malformed, empty and unavailable suggestions must leave fallbacks visible.
    if(Array.isArray(data.choices) && data.choices.length===3) {
      const valid=data.choices.every(v=>readablePracticeText(v?.text)&&
        (targetLanguage==='en'||readablePracticeText(v?.english)));
      if(valid)renderQuickChoices(data.choices);
    }
  } catch(error) {
    console.warn('Quick reply generation failed; keeping usable options:',error);
  } finally {
    if (pendingChoiceSource === clean) pendingChoiceSource = '';
  }
}

function choiceModeInstruction() {
  if (interactionMode !== 'button') {
    return 'BUTTON REPLY MODE is off.';
  }

  return 'BUTTON REPLY MODE is ON. End each reply with exactly one short, concrete question that can naturally be answered by three distinct short choices. Do not say or list the choices; the interface will show them. A button answer is already a complete intentional answer. NEVER restate or correct it with formulas like “Tu veux dire”, “Mieux”, “Je bedoelt”, “Beter”, “You mean” or “So you mean”. React to its meaning instead. Vary naturally: agree, disagree politely, show curiosity, make a tiny comment or suggestion, contrast the idea, or go directly to the next question. Do not repeat the same opening pattern.';
}

function buildRuntimeContext() {
  const isFrench = targetLanguage === 'fr';
  const isEnglish = targetLanguage === 'en';
  const meta = isEnglish ? englishDifficultyMeta[difficulty] : difficultyMeta[difficulty];
  const target = isEnglish ? 'English' : isFrench ? 'French' : 'Dutch/Flemish';

  const levelRules = isEnglish
    ? {
        1: 'Use clear B1 professional English. Keep it accessible and practical. Aim for 12–18 words.',
        2: 'Use fluent B2 professional English. Natural business vocabulary, common collocations and concise phrasing. Aim for 16–22 words.',
        3: 'Use strong B2+ professional English. Add nuance, phrasal verbs and polished workplace phrasing. Aim for 18–24 words.',
        4: 'Use C1 professional English. Sound confident, natural and internationally polished. Aim for 20–26 words.',
        5: 'Use rich C1+ professional English. Precise, fluent and executive-ready, but concise. Never exceed 28 words.'
      }
    : isFrench
      ? {
          1: 'Use very easy A1 French. Speak slowly. Aim for 6–10 words total.',
          2: 'Use only very common A1–A2 practical spoken French. Speak slowly. Aim for 8–12 words total.',
          3: 'Use practical B1 French. Speak calmly and clearly. Aim for 12–16 words total.',
          4: 'Use natural B2 French. Speak clearly at a calm natural pace. Aim for 14–18 words total.',
          5: 'Use advanced natural French, but stay concise. Never exceed 20 words total.'
        }
      : {
          1: 'Use very easy A1 Dutch. Speak slowly. Aim for 6–10 words total.',
          2: 'Use only very common A1–A2 practical Flemish. Avoid rare words, idioms and long compounds. Speak slowly. Aim for 8–12 words total.',
          3: 'Use practical B1 Dutch. Speak calmly and clearly. Aim for 12–16 words total.',
          4: 'Use natural B2 Flemish. Speak clearly at a calm natural pace. Aim for 14–18 words total.',
          5: 'Use advanced natural Flemish, but stay concise. Never exceed 20 words total.'
        };

  const styleRule = isEnglish
    ? 'Use polished, fluent international professional English. Improve clarity, confidence, natural rhythm, collocations, softening, stakeholder language and executive-style phrasing. Avoid stiff textbook English and unnecessary jargon.'
    : isFrench
      ? 'Use simple modern spoken French, not schoolbook French. Prefer natural everyday phrasing, common contractions and informal but broadly understandable usage. Avoid heavy regional slang.'
      : 'Use simple modern spoken Belgian Dutch/Flemish, not schoolbook Dutch. Prefer short informal daily phrasing with je/jij, natural omissions and common contractions, but avoid heavy dialect that an A2 learner cannot reuse.';

  const workExamples = isEnglish
    ? 'Useful professional examples to teach naturally: "Have you sent that email yet?", "What’s the current status?", "Are we still on track?", "Are we likely to hit the deadline?", "Is anything blocking progress?", "Could you give me a quick update?", "Do you foresee any changes?"'
    : isFrench
      ? 'Useful work examples to teach naturally: "Tu as envoyé ce mail ?", "Quel est le statut actuel ?", "On est dans les temps ?", "On va tenir la deadline ?", "Tu prévois un changement bientôt ?", "Tu peux me faire un point ?"'
      : 'Useful work examples to teach naturally: "Heb je die mail al gestuurd?", "Wat is de huidige status?", "Liggen we nog op schema?", "Halen we de deadline?", "Plan je binnenkort een wijziging?", "Kun je me even een update geven?"';

  const languageLock = isFrench
    ? 'ABSOLUTE LANGUAGE LOCK: Ulas may speak French OR English. Understand both, but Emma must reply ONLY in French. Never reply in Dutch or English.'
    : isEnglish
      ? 'ABSOLUTE LANGUAGE LOCK: Emma must reply ONLY in English.'
      : 'ABSOLUTE LANGUAGE LOCK: Ulas may speak Dutch/Flemish OR English. Understand both, but Emma must reply ONLY in Belgian Dutch/Flemish. Never reply in French or English.';

  const teachingMode = isEnglish
    ? 'TEACHER MODE: be proactive and professional. Regularly propose a useful workplace topic, upgrade Ulas’s sentence to fluent business English, then ask one short follow-up question.'
    : 'TEACHER MODE: be proactive and natural. Regularly propose a useful everyday situation, teach the way people actually say it, then ask Ulas to use the phrase. Prioritize natural spoken usage over grammar theory.';

  return [
    'SESSION LEARNING CONTEXT — IMPORTANT:',
    languageLock,
    teachingMode,
    interactionModeInstruction(),
    choiceModeInstruction(),
    `You are Emma, Ulas Atilgan’s practical ${target} conversation coach.`,
    isEnglish
      ? 'The goal is fluent, confident, high-quality professional English for international work and real conversations.'
      : `The goal is short, useful, real-life speaking in ${target} — not grammar study.`,
    `Current difficulty is level ${difficulty}/5 (${meta.cefr}, ${meta.name}).`,
    levelRules[difficulty],
    isEnglish
      ? 'HARD LIMIT: maximum 28 spoken words total and maximum 3 short sentences. Prefer one polished correction plus one useful answer.'
      : 'HARD LIMIT: maximum 20 spoken words total and maximum 3 short sentences. Prefer 1–2 sentences.',
    isEnglish
      ? 'Always answer in English. Correct awkward, vague or non-native phrasing into fluent professional English before answering.'
      : `You MUST understand English normally, whether Ulas speaks it or types it. Emma must still answer in ${target} only.`,
    isEnglish
      ? 'Do not simplify English unnaturally. Keep it fluent and richer than the Dutch/French modes, while remaining practical and conversational.'
      : `When Ulas switches to English because he is stuck, understand him and immediately give the short natural ${target} expression.`,
    styleRule,
    'Teach through short examples, prompts and repetition. Be a real teacher, not a passive chatbot. If Ulas gives a short answer or does not lead, immediately choose the next useful topic yourself.',
    isEnglish
      ? 'Every 2–3 turns initiate a practical professional micro-lesson: project update, stakeholder communication, email follow-up, meeting language, deadline, blocker, interview, presentation, negotiation or diplomatic disagreement.'
      : 'Every 2–3 turns initiate a practical everyday micro-lesson: work chat, café, doctor, neighbour, appointment, shopping, transport, phone call, municipality or a common social situation.',
    'Give high priority to work and project-follow-up language: meetings, stakeholder updates, emails, status, progress, blockers, ownership, deadlines, planning, decisions, negotiation, disagreement, clarification and next steps.',
    workExamples,
    isEnglish
      ? 'Also teach professional collocations, phrasal verbs, diplomatic disagreement, concise executive wording, interview answers and presentation language. Say things like “A more professional way to put it is…” and give the complete sentence.'
      : 'Also teach daily-life street language: appointments, doctor, café, neighbours, shopping, transport, phone calls and practical requests. Say the natural everyday version people actually use; avoid textbook alternatives unless asked.',
    isFrench
      ? 'Natural French is the priority: prefer common spoken phrases such as “Ça marche”, “On fait comment ?”, “Tu peux me dire… ?”, “J’ai besoin de…”, “Je peux pas…” when appropriate and understandable.'
      : isEnglish
        ? 'Professional English is the priority: make wording fluent, concise, confident and natural rather than simply grammatically correct.'
        : 'Natural Flemish is the priority: prefer common spoken phrases such as “Is goed”, “Hoe zit het?”, “Kun je even…?”, “Ik heb … nodig”, “Dat lukt niet” when appropriate and understandable.',
    'If he is stuck, give him the beginning of the sentence so he can finish it.',
    'Every few turns, proactively introduce one stronger or more natural alternative and one reusable phrase. Then ask exactly one simple question.',
    `On every user turn, first restate the ENTIRE intended sentence in natural spoken ${target}, not just one word. Then answer immediately.`,
    selectedTopic==='open'
      ? 'When free conversation mode is selected, follow the learner freely and never force Office or any other preset.'
      : 'Do NOT introduce random daily-life or office topics when a specific theme is selected. Practice ONLY the selected theme.',
    topicInstruction(selectedTopic),
    'Use his real life naturally when useful: ING/IT, Hondinn, job interviews, project work, investing, business, cars and renovation, ONLY if relevant to the chosen theme.'
  ].join(' ').replaceAll('Emma',personaName());
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
  const meta = targetLanguage === 'en' ? englishDifficultyMeta[difficulty] : difficultyMeta[difficulty];
  difficultySlider.value = String(difficulty);
  difficultyValue.textContent = String(difficulty);
  if (difficultyToggleValue) difficultyToggleValue.textContent = String(difficulty);
  difficultyName.textContent = `${meta.cefr} · ${meta.name}`;
  if (levelLabel) levelLabel.textContent = languageConfig().level;
  difficultySlider.style.setProperty('--level-progress', `${((difficulty - 1) / 4) * 100}%`);
}

function beginHistorySession() {
  if (currentHistorySessionId) return;

  currentHistorySessionId =
    globalThis.crypto?.randomUUID?.() ||
    `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const history = loadJson(historyKey(), []);
  history.push({
    id: currentHistorySessionId,
    topic: selectedTopic,
    provider: selectedProvider,
    persona: selectedPersona,
    startedAt: new Date().toISOString(),
    endedAt: null,
    difficulty,
    language: targetLanguage,
    messages: []
  });

  saveJson(historyKey(), history.slice(-180));
}

function saveCurrentHistory() {
  if (!currentHistorySessionId) return;

  const history = loadJson(historyKey(), []);
  const session = history.find(item => item.id === currentHistorySessionId);
  if (!session) return;

  session.difficulty = difficulty;
  session.persona = selectedPersona;
  session.topic = selectedTopic;
  session.provider = selectedProvider;
  session.messages = currentMessages
    .filter(message => message?.content?.trim())
    .slice(-200)
    .map(message => ({
      id: message.id,
      role: normalizedRole(message.role),
      content: normalizedRole(message.role) === 'persona'
        ? limitCamilleReply(message.content).text
        : message.content.trim(),
      en: translationByMessageId.get(message.id) || ''
    }));

  saveJson(historyKey(), history.slice(-180));
}

function endHistorySession() {
  if (!currentHistorySessionId) return;

  saveCurrentHistory();
  const history = loadJson(historyKey(), []);
  const session = history.find(item => item.id === currentHistorySessionId);

  if (session) {
    session.endedAt = new Date().toISOString();
    saveJson(historyKey(), history.slice(-180));
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

function getLatestSessionMessages() {
  if (currentMessages.some(message => message?.content?.trim())) {
    return currentMessages
      .filter(message => message?.content?.trim())
      .map(message => ({
        id: message.id,
        role: normalizedRole(message.role),
        content: message.content.trim(),
        en: translationByMessageId.get(message.id) || ''
      }));
  }

  const latest = loadJson(historyKey(), [])
    .filter(session => (!session.language || session.language === targetLanguage))
    .filter(session => (session.persona || 'emma') === selectedPersona)
    .filter(session => Array.isArray(session.messages) && session.messages.length)
    .slice(-1)[0];

  return Array.isArray(latest?.messages) ? latest.messages : [];
}

function renderSessionHistoryDialog() {
  saveCurrentHistory();
  const messages = getLatestSessionMessages();

  sessionHistoryContent.innerHTML = '';
  sessionHistoryCount.textContent = messages.length ? `${messages.length} turns` : '';

  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'session-history-empty';
    empty.textContent = 'No conversation in this session yet.';
    sessionHistoryContent.appendChild(empty);
    return;
  }

  for (const message of messages) {
    const role = normalizedRole(message.role);
    const row = document.createElement('section');
    row.className = `session-history-message ${role === 'user' ? 'user' : 'camille'}`;

    const label = document.createElement('div');
    label.className = 'session-history-role';
    label.textContent = role === 'user' ? 'YOU' : personaName().toUpperCase();

    const body = document.createElement('div');
    body.className = 'session-history-body';

    const sourceText = role === 'user' ? message.content : limitCamilleReply(message.content).text;
    const sentences = splitReplaySentences(sourceText);

    for (const sentence of sentences) {
      const sentenceRow = document.createElement('div');
      sentenceRow.className = 'history-sentence-row';

      const main = document.createElement('div');
      main.className = 'session-history-main replay-text';
      main.textContent = sentence;

      const replay = createAudioReplayButton(sentence, main, 'Replay sentence');
      sentenceRow.append(main, replay);
      body.appendChild(sentenceRow);
    }

    const english = message.en || (message.id ? translationByMessageId.get(message.id) : '');
    if (english) {
      const en = document.createElement('div');
      en.className = 'session-history-en';
      en.textContent = english;
      body.appendChild(en);
    }

    row.append(label, body);
    sessionHistoryContent.appendChild(row);
  }

  requestAnimationFrame(() => {
    sessionHistoryContent.scrollTop = sessionHistoryContent.scrollHeight;
  });
}

function renderHistoryDialog() {
  saveCurrentHistory();
  const history = loadJson(historyKey(), [])
    .filter(session => (!session.language || session.language === targetLanguage))
    .filter(session => Array.isArray(session.messages) && session.messages.length)
    .slice()
    .reverse();

  historyContent.innerHTML = '';
  historyCount.textContent = `${history.length} ${languageConfig().name} sessions`;

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
      meta.textContent = `${formatTime(session.startedAt)}${end} · ${personaName(session.persona || 'emma')} · ${session.provider==='voice'?'Voice':'Video'} · ${ECL_TOPICS[normalizeTopic(session.topic)].label} · Level ${session.difficulty || 2}`;
      card.appendChild(meta);

      for (const message of session.messages) {
        const row = document.createElement('div');
        row.className = `archive-message ${message.role === 'user' ? 'archive-user' : 'archive-camille'}`;

        const role = document.createElement('span');
        role.className = 'archive-role';
        role.textContent = message.role === 'user' ? 'ULAS' : personaName(session.persona || 'emma').toUpperCase();

        const body = document.createElement('div');
        body.className = 'archive-body';

        const sentences = splitReplaySentences(message.content);
        for (const sentence of sentences) {
          const sentenceRow = document.createElement('div');
          sentenceRow.className = 'history-sentence-row';

          const text = document.createElement('div');
          text.className = 'archive-sentence replay-text';
          text.textContent = sentence;

          const replay = createAudioReplayButton(sentence, text, 'Replay sentence');
          sentenceRow.append(text, replay);
          body.appendChild(sentenceRow);
        }

        if (message.en) {
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
    .toLocaleLowerCase(languageConfig().locale)
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
      body: JSON.stringify({ text, knownWords, targetLanguage })
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
      language: targetLanguage,
      addedAt: new Date().toISOString()
    };

    learnedWords.push(learned);
    learnedWords = learnedWords.slice(-800);
    saveJson(wordsKey(), learnedWords);
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
  learnedWords = loadJson(wordsKey(), []).filter(item =>
    item && (!item.language || item.language === targetLanguage)
  );
  wordsContent.innerHTML = '';
  wordsCount.textContent = `${learnedWords.length} ${languageConfig().name} words`;

  if (!learnedWords.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'New words from ECL conversations will appear here.';
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
    nl.className = 'word-list-nl replay-text';
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

    const replay = createAudioReplayButton(item.nl, nl, `Replay ${item.nl}`);
    replay.classList.add('word-audio-button');

    row.append(pair, date, replay);
    wordsContent.appendChild(row);
  }
}

async function sendTypedTurn(text, inputKind = 'type') {
  const clean = String(text || '').trim();
  if(inputKind==='button'&&!clean)return;
  if(selectedProvider==='voice') {
    if(!clean || !voiceSession || !connected || isResponding)return;
    // Text and Button input are sent to the SAME OpenAI Realtime session,
    // not to Anam and not through the separate /chat response engine.
    if(!voiceSession.sendText(clean)){
      setStatus('OpenAI voice is not ready');
      return;
    }
    clearQuickChoices();
    hideTip();
    const itemId='voice-typed-'+Date.now();
    setLastUserPin(clean,itemId);
    finalizeUserTranslation(clean,itemId);
    upsertConversationTurn({id:itemId,role:'user',content:clean});
    isResponding=true;
    if(voiceButtonTimer)window.clearTimeout(voiceButtonTimer);
    voiceButtonTimer=window.setTimeout(()=>{
      voiceButtonTimer=null;
      if(selectedProvider==='voice'&&interactionMode==='button'&&connected&&isResponding){
        isResponding=false;
        setStatus('No voice reply yet · choose again');
        renderQuickChoices(defaultButtonChoices('generic'));
      }
    },17000);
    setStatus(personaName()+' is replying…');
    saveCurrentHistory();
    renderMessages(currentMessages);
    return;
  }
  if (!clean || !anamClient || !connected || isResponding) return;
  const chosenButtonText=clean;
  const epochAtSend=connectionEpoch;

  clearQuickChoices();
  hideTip();
  celebrateUserTurn();

  const userId = `typed-user-${Date.now()}`;
  const personaId = `typed-persona-${Date.now()}`;

  pinnedUserMessageId = userId;
  setLastUserPin(clean, userId);
  finalizeUserTranslation(clean, userId);

  upsertConversationTurn({ id: userId, role: 'user', content: clean });
  saveCurrentHistory();
  renderMessages(currentMessages);

  isResponding = true;
  setStatus(personaName()+' is preparing a reply…');
  activeChatAbort = new AbortController();
  const answerTimeout=window.setTimeout(()=>activeChatAbort?.abort(),18000);
  activeSubtitleMessageId = personaId;

  let full = '';
  let talkStream = null;

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: activeChatAbort.signal,
      body: JSON.stringify({
        messages: currentMessages,
        kickoff: false,
        difficulty,
        correctionLevel: correctionLevel.value || 'medium',
        targetLanguage,
        persona:selectedPersona,
        topic:selectedTopic,
        choiceModeEnabled,
        interactionMode,
        inputKind
      })
    });

    if (!response.ok || !response.body) {
      throw new Error(await response.text());
    }

    if(inputKind==='button'){
      // Button replies arrive as a complete text response; they are NOT SSE.
      // Render immediately, without waiting for Anam's audio stream or translation.
      full=limitCamilleReply(await response.text()).text.trim();
      if(!full)throw new Error('Emma returned an empty answer.');
      if(epochAtSend!==connectionEpoch||!connected)return;
      renderLiveDutch(full);
      setSubtitle(full,'');
      upsertConversationTurn({id:personaId,role:'persona',content:full});
      processVocabularyProgress(personaId,full,true);
      saveCurrentHistory();
      renderMessages(currentMessages);
      isResponding=false;
      setStatus('Emma replied · audio starting');
      // This direct SDK talk path is independent of the microphone and avoids
      // hanging createTalkMessageStream/endMessage calls in muted button mode.
      try{
        const task=anamClient.talk(full);
        Promise.resolve(task).catch(error=>{
          console.warn('Avatar voice unavailable; text reply remains usable:',error);
          if(connected)setStatus('Emma replied · audio unavailable');
        });
      }catch(error){console.warn('Avatar voice unavailable:',error)}
      requestQuickChoices(full);
      void translateToEnglish(full).then(english=>{
        if(english&&connected&&epochAtSend===connectionEpoch){
          translationByMessageId.set(personaId,english);
          setSubtitle(full,english);
        }
      }).catch(()=>{});
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    talkStream = anamClient.createTalkMessageStream();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;

      full += chunk;
      const limited = limitCamilleReply(full);
      renderLiveDutch(limited.text, chunk);
      schedulePartialTranslation(limited.text, personaId);
      await talkStream.streamMessageChunk(chunk, false);
    }

    await talkStream.endMessage();

    full = limitCamilleReply(full).text;
    const english = await translateToEnglish(full);
    if (english) translationByMessageId.set(personaId, english);

    setSubtitle(full, english);

    upsertConversationTurn({ id: personaId, role: 'persona', content: full });

    processVocabularyProgress(personaId, full, true);
    saveCurrentHistory();
    renderMessages(currentMessages);
    syncRecentConversationContext();
    if (interactionMode === 'button') requestQuickChoices(full);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('Typed Emma response error:', error);
      setStatus('Emma reply unavailable · choose again');
      if(inputKind==='button'&&connected&&interactionMode==='button')renderQuickChoices(defaultButtonChoices('generic'));
    }
  } finally {
    window.clearTimeout(answerTimeout);
    activeChatAbort = null;
    isResponding = false;
    if(inputKind==='button'&&connected&&interactionMode==='button'&&quickReplyBar?.hidden)
      primeButtonChoices();
    if (connected) setStatus(languageConfig().ready);
  }
}

async function streamCamilleResponse(messages = currentMessages, kickoff = false) {
  if (!anamClient || !customLlmMode || isResponding) return;

  isResponding = true;
  setStatus(personaName()+' denkt…');
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
        correctionLevel: correctionLevel.value || 'medium',
        targetLanguage,
        persona:selectedPersona,
        topic:selectedTopic,
        choiceModeEnabled,
        interactionMode,
        inputKind: 'speak'
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
      console.error('Emma response error:', error);
      setStatus('Response error');
    }
  } finally {
    activeChatAbort = null;
    activeTalkStream = null;
    isResponding = false;

    if (connected) setStatus(languageConfig().ready);
  }
}

async function handleMessagesUpdated(messages) {
  if (replayingAudio) return;
  mergeAnamHistory(messages);
  saveCurrentHistory();
  renderMessages(currentMessages);

  // Published Anam personas may deliver the first turn via history events,
  // without a matching end-of-speech stream event. Generate Button replies
  // for that first completed Emma turn as well.
  if (interactionMode === 'button' && !isResponding &&
      currentMessages[currentMessages.length - 1]?.role === 'persona') {
    primeButtonChoices();
  }

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
  if (replayingAudio && event.role === 'persona') return;

  const previous = streamBuffers.get(event.id) || '';
  const next = previous + event.content;
  streamBuffers.set(event.id, next);

  if (event.role === 'persona' && lengthInterruptedIds.has(event.id)) {
    if (event.endOfSpeech) {
      streamBuffers.delete(event.id);
      window.setTimeout(() => lengthInterruptedIds.delete(event.id), 12000);
    }
    return;
  }

  if (event.role === 'user') {
    setLastUserPin(next, event.id);
    scheduleUserTranslation(next, event.id);

    // Keep this complete user turn visible while Emma answers.
    renderMessages(currentMessages);

    if (event.endOfSpeech) {
      streamBuffers.delete(event.id);
      upsertConversationTurn({ id: event.id, role: 'user', content: next });
      saveCurrentHistory();
      renderMessages(currentMessages);
      finalizeUserTranslation(next, event.id);
    }
    return;
  }

  if (event.role === 'persona') {
    const isNewMessage = activeSubtitleMessageId !== event.id;
    activeSubtitleMessageId = event.id;

    if (isNewMessage) {
      hideTip();
      // Never clear the initial options on the first avatar word:
      // some published Anam personas never send endOfSpeech.
      if (interactionMode === 'button') {
        primeButtonChoices();
        const startedMessageId=event.id;
        window.setTimeout(()=>{
          if(!connected || interactionMode!=='button' || isResponding ||
             activeSubtitleMessageId!==startedMessageId)return;
          const latest=subtitleNl?.textContent?.trim();
          if(latest)requestQuickChoices(latest);
          else primeButtonChoices();
        },2200);
      }
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
        console.warn('Could not stop overlong Emma reply:', error);
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
      upsertConversationTurn({ id: event.id, role: 'persona', content: limited.text });
      saveCurrentHistory();
      partialTranslationSeq += 1;
      lastPartialTranslationAt = 0;
      finalizeSubtitle(limited.text, event.id);
      if (interactionMode === 'button') requestQuickChoices(limited.text);
    }

    if (event.endOfSpeech) {
      window.setTimeout(() => lengthInterruptedIds.delete(event.id), 12000);
    }
  }
}

function liveLanguageLockInstruction() {
  const pace = ' SPEAKING PACE: speak calmly and about 15% slower than your normal pace, with clear articulation and small natural pauses between phrases.';
  if (targetLanguage === 'fr') {
    return 'CRITICAL: Reply ONLY in French. Ulas may speak English; understand it but answer entirely in French. No Dutch. Use natural everyday French, correct the full sentence, then continue.' + pace;
  }

  if (targetLanguage === 'en') {
    return 'CRITICAL: Reply ONLY in English. Use fluent professional English. Correct the full sentence into a natural polished version, then continue.' + pace;
  }

  return 'CRITICAL: Reply ONLY in Belgian Dutch/Flemish. Ulas may speak English; understand it but answer entirely in Dutch/Flemish. No French. Use natural everyday Flemish, correct the full sentence, then continue.' + pace;
}

function attachAnamListeners(client) {
  client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
    if (client !== anamClient) return;
    connected = true;
    connecting = false;
    try {
      anamClient?.addContext(liveLanguageLockInstruction());
      pushLearningContext();
    } catch {}
    document.body.classList.add('conversation-live');
    document.body.classList.remove('level-expanded');
  difficultyToggle?.setAttribute('aria-expanded', 'false');
    micButton.disabled = false;
    micButton.classList.add('live');
    micLabel.textContent = 'Live';
    endButton.disabled = false;
    setAvatarLive(true);
    applyInteractionAudioState();
    try { anamClient?.addContext(interactionModeInstruction()); } catch {}
    setStatus(languageConfig().ready);
    // Works even when Button was selected before Start was pressed.
    window.setTimeout(primeButtonChoices, 250);
  });

  client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
    if (client !== anamClient) return;
    setAvatarLive(true);
    applyInteractionAudioState();
    try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
    pushLearningContext();
    setTimeout(() => {
      try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
      pushLearningContext();
    }, 160);
    window.setTimeout(primeButtonChoices, 500);
  });

  // A late event from a previous Anam session must never inject French into
  // Dutch, or English into French, after switching the active language.
  client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, event => {
    if (client !== anamClient) return;
    handleStreamEvent(event);
  });
  client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, messages => {
    if (client !== anamClient) return;
    void handleMessagesUpdated(messages);
  });

  client.addListener(AnamEvent.USER_SPEECH_STARTED, () => {
    if (client !== anamClient || interactionMode !== 'speak') return;
    replaySequence += 1;
    window.speechSynthesis?.cancel?.();
    replayingAudio = false;
    clearQuickChoices();
    try {
      anamClient?.addContext(liveLanguageLockInstruction());
      if (choiceModeEnabled) anamClient?.addContext(choiceModeInstruction());
    } catch {}
    setStatus('Listening…');
    voiceRing.classList.add('active');
    successBalloon?.classList.add('listening');

    // Keep Emma's last sentence visible while Ulas speaks.
    // Keep the current user's sentence in the same live exchange card.
    if (!lastUserPinText.textContent.trim()) {
      lastUserPinText.textContent = 'Listening…';
      lastUserPin.hidden = false;
    }
    renderMessages(currentMessages);

    if (isResponding) {
      try { activeChatAbort?.abort(); } catch {}
    }
  });

  client.addListener(AnamEvent.USER_SPEECH_ENDED, () => {
    if (client !== anamClient || interactionMode !== 'speak') return;
    setStatus('Thinking…');
    voiceRing.classList.remove('active');
    successBalloon?.classList.remove('listening');
    celebrateUserTurn();

    // Reinforce the hard brevity rule immediately before Emma's next turn.
    if (connected) {
      try {
        const nextRule = targetLanguage === 'fr'
          ? 'NEXT TURN: ONLY French, even if Ulas spoke English. No Dutch. First give the FULL natural French sentence, then answer. Stay under 20 words. If useful, proactively teach one everyday phrase.'
          : targetLanguage === 'en'
            ? 'NEXT TURN: ONLY English. First give the FULL polished professional sentence, then answer. Stay under 28 words. Proactively improve fluency, business wording or stakeholder phrasing.'
            : 'NEXT TURN: ONLY Belgian Dutch/Flemish, even if Ulas spoke English. No French. First give the FULL natural Flemish sentence, then answer. Stay under 20 words. If useful, proactively teach one everyday phrase.';
        anamClient?.addContext(liveLanguageLockInstruction());
        anamClient?.addContext(nextRule);
        if (choiceModeEnabled) anamClient?.addContext(choiceModeInstruction());
      } catch {}
    }
  });

  client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, () => {
    if (client !== anamClient) return;
    try { activeChatAbort?.abort(); } catch {}
    isResponding = false;
  });

  client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
    if(client !== anamClient) return; // late close from previously chosen persona
    endHistorySession();
    resetUiAfterDisconnect();
  });

  client.addListener(AnamEvent.MIC_PERMISSION_DENIED, () => {
    if (client !== anamClient) return;
    setStatus('Microphone permission needed');
  });
}

// ECL owns the initial spoken sentence. Anam's automatic greeting is
// disabled server-side so it cannot open in English when FR or NL is selected.
async function speakLocalizedOpening(client = anamClient) {
  if (!client || !connected || customLlmMode) return;
  const sequence = ++sessionOpeningSeq;
  const languageAtStart = targetLanguage;
  const personaAtStart = selectedPersona;
  const greeting = languageConfig();
  const phrase = topicOpening(selectedTopic,targetLanguage);
  if (!phrase) return;
  try {
    const stream = client.createTalkMessageStream();
    await stream.streamMessageChunk(phrase, false);
    await stream.endMessage();
    if (sequence !== sessionOpeningSeq || client !== anamClient ||
        languageAtStart !== targetLanguage || personaAtStart !== selectedPersona) return;
    // The first visible / recorded message also obeys the selected language.
    const id = `ecl-greeting-${Date.now()}-${sequence}`;
    upsertConversationTurn({ id, role: 'persona', content: phrase });
    setSubtitle(phrase, selectedTopic==='open' ? greeting.greetingEn || '' : (targetLanguage==='en'?'':topicOpening(selectedTopic,'en')));
    saveCurrentHistory();
    renderMessages(currentMessages);
    if (interactionMode === 'button') requestQuickChoices(phrase);
  } catch (error) {
    console.warn('Localized ECL opening could not be played:', error);
    // Never replace a missing French / Dutch opening with English speech.
  }
}

// Voice Only uses exclusively OpenAI Realtime; no Anam session is requested.
async function connectVoiceOnly() {
  if(connected || connecting)return;
  const epoch=++connectionEpoch;
  connecting=true;
  setTalkImmersive(true);
  updatePersonaUi();
  updateTopicUi();
  languageToggle.disabled=true;
  micButton.disabled=true;
  endButton.disabled=true;
  micLabel.textContent='Connecting…';
  setStatus('Connecting OpenAI voice…');
  setAvatarLive(false);
  avatarBadge.textContent='OPENAI VOICE';
  avatarPlaceholderText.textContent=personaName()+' · AI-generated voice';
  const languageAtStart=targetLanguage;
  const personaAtStart=selectedPersona;
  const themeAtStart=selectedTopic;
  const context=handoffContext;
  try {
    const session=await createVoiceOnlySession({
      persona:selectedPersona,
      targetLanguage, topic:selectedTopic, difficulty,
      inputMode:interactionMode, context,
      onStatus:message=>{
        if(selectedProvider==='voice')setStatus(message);
      },
      onSpeech:listening=>{
        if(selectedProvider!=='voice')return;
        voiceRing.classList.toggle('active',listening);
        if(interactionMode==='speak')setStatus(listening?'Listening…':'Thinking…');
      },
      onUserText:(text,id)=>{
        if(selectedProvider!=='voice'||targetLanguage!==languageAtStart)return;
        const itemId=id||'voice-user-'+Date.now();
        upsertConversationTurn({id:itemId,role:'user',content:text});
        setLastUserPin(text,itemId);
        finalizeUserTranslation(text,itemId);
        saveCurrentHistory();
        renderMessages(currentMessages);
      },
      onAssistantDelta:(text,id)=>{
        if(selectedProvider!=='voice'||targetLanguage!==languageAtStart)return;
        activeSubtitleMessageId=id;
        renderLiveDutch(limitCamilleReply(text).text);
      },
      onAssistantDone:(text,id)=>{
        if(selectedProvider!=='voice'||targetLanguage!==languageAtStart)return;
        const clean=limitCamilleReply(text).text;
        const itemId=id||'voice-persona-'+Date.now();
        isResponding=false;
        if(voiceButtonTimer){window.clearTimeout(voiceButtonTimer);voiceButtonTimer=null;}
        upsertConversationTurn({id:itemId,role:'persona',content:clean});
        saveCurrentHistory();
        renderMessages(currentMessages);
        setStatus(languageConfig().ready);
        void finalizeSubtitle(clean,itemId);
        processVocabularyProgress(itemId,clean,true);
        if(interactionMode==='button')requestQuickChoices(clean);
      },
      onError:message=>{
        if(selectedProvider!=='voice')return;
        isResponding=false;
        if(voiceButtonTimer){window.clearTimeout(voiceButtonTimer);voiceButtonTimer=null;}
        if(interactionMode==='button'&&connected)renderQuickChoices(defaultButtonChoices('generic'));
        console.warn('OpenAI voice error:',message);
        setStatus('Voice error: '+String(message).slice(0,75));
      }
    });
    if(epoch!==connectionEpoch || studyPages?.getPage()!=='talk' ||
      selectedProvider!=='voice'||personaAtStart!==selectedPersona||
      languageAtStart!==targetLanguage||themeAtStart!==selectedTopic){
      await session.close();
      return;
    }
    voiceSession=session;
    connected=true;
    connecting=false;
    handoffContext='';
    languageToggle.disabled=false;
    updatePersonaUi();
    updateTopicUi();
    document.body.classList.add('conversation-live');
    micButton.disabled=false;
    micButton.classList.add('live');
    micLabel.textContent='Live';
    endButton.disabled=false;
    avatarBadge.textContent='OPENAI VOICE';
    avatarPlaceholderText.textContent=personaName()+' · AI voice active';
    beginHistorySession();
    saveCurrentHistory();
    applyInteractionAudioState();
    primeButtonChoices();
    setStatus(languageConfig().ready);
  } catch(error) {
    console.warn('Could not connect ECL OpenAI voice:',error);
    connected=false;
    connecting=false;
    languageToggle.disabled=false;
    micButton.disabled=false;
    endButton.disabled=true;
    micLabel.textContent='Try again';
    avatarBadge.textContent='VOICE OFFLINE';
    setStatus('Voice unavailable');
    setTalkImmersive(false);
    avatarPlaceholderText.textContent=String(error?.message||'OpenAI Realtime could not connect.').slice(0,165);
    updatePersonaUi();
    updateTopicUi();
  }
}

async function connect() {
  if (selectedProvider==='voice') return connectVoiceOnly();
  if (connected || connecting) return;

  const epoch=++connectionEpoch;
  connecting = true;
  setTalkImmersive(true);
  updatePersonaUi();
  languageToggle.disabled = true;
  const requestedLanguage = targetLanguage;
  const requestedPersona = selectedPersona;
  const requestedTopic = selectedTopic;
  updateTopicUi();
  runtimeContextApplied = false;
  micButton.disabled = true;
  endButton.disabled = true;
  micLabel.textContent = 'Connecting…';
  setStatus('Connecting Anam…');
  avatarBadge.textContent = 'CONNECTING';
  avatarPlaceholderText.textContent = 'Connecting '+personaName()+'…';

  try {
    const response = await fetch('/anam-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({persona:requestedPersona, targetLanguage:requestedLanguage, topic:requestedTopic}),
      cache: 'no-store'
    });

    const data = await response.json().catch(() => ({}));
    if(epoch!==connectionEpoch || studyPages?.getPage()!=='talk')return;
    if (!response.ok || !data.sessionToken ||
        data.persona?.toLowerCase() !== requestedPersona ||
        data.language !== requestedLanguage || data.topic !== requestedTopic ||
        requestedLanguage !== targetLanguage || requestedPersona !== selectedPersona ||
        requestedTopic !== selectedTopic) {
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
    languageToggle.disabled = false;
    updateTopicUi();

    if (!connected) {
      connected = true;
      connecting = false;
      updatePersonaUi();
      document.body.classList.add('conversation-live');
      document.body.classList.remove('level-expanded');
      micButton.disabled = false;
      micButton.classList.add('live');
      micLabel.textContent = 'Live';
      endButton.disabled = false;
      setAvatarLive(true);
      applyInteractionAudioState();
      try { anamClient?.addContext(interactionModeInstruction()); } catch {}
      setStatus(languageConfig().ready);
    }

    beginHistorySession();
    saveCurrentHistory();
    // A mode switch preserves only a brief context summary, never an old
    // Anam audio stream or a mixed voice provider session.
    if(handoffContext) {
      try { anamClient?.addContext('Earlier conversation context to continue naturally: '+handoffContext); } catch {}
      handoffContext='';
    }
    window.setTimeout(primeButtonChoices, 350);
    try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
    pushLearningContext();
    setTimeout(pushLearningContext, 180);
    setTimeout(() => {
      try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
    }, 420);

    if (customLlmMode) {
      setTimeout(() => streamCamilleResponse([], true), 450);
    } else {
      // Session has a locked language from its first token and uses the
      // selected Anam voice to speak a deterministic localized greeting.
      void speakLocalizedOpening(anamClient);
    }
  } catch (error) {
    console.error('Anam connection failed:', error);
    languageToggle.disabled = false;
    connecting = false;
    updateTopicUi();
    connected = false;
    customLlmMode = false;
    updatePersonaUi();
    micButton.disabled = false;
    micLabel.textContent = 'Try again';
    endButton.disabled = true;
    avatarBadge.textContent = 'AVATAR OFFLINE';
    const message = String(error?.message || 'Emma could not connect to Anam.').slice(0, 180);
    avatarPlaceholderText.textContent = message;
    setStatus('Could not connect');
    setTalkImmersive(false);
  }
}

function resetUiAfterDisconnect() {
  setTalkImmersive(false);
  if(voiceButtonTimer){window.clearTimeout(voiceButtonTimer);voiceButtonTimer=null;}
  sessionOpeningSeq += 1;
  languageToggle.disabled = false;
  updateTopicUi();
  replaySequence += 1;
  window.speechSynthesis?.cancel?.();
  replayingAudio = false;
  clearQuickChoices();
  hideTip();
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
  if (lastUserPinEn) lastUserPinEn.textContent = '';
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
  micLabel.textContent = 'Start';
  endButton.disabled = true;
  setStatus('Ready');
  setSubtitle(lastSubtitlePair.nl, lastSubtitlePair.en);
  messagesEl.innerHTML = '';
}

async function disconnect() {
  connectionEpoch += 1;
  endHistorySession();

  try { activeChatAbort?.abort(); } catch {}
  if(voiceSession) {
    const active=voiceSession;
    voiceSession=null;
    try { await active.close(); } catch(error) { console.warn('OpenAI voice stop error:',error); }
  }
  try {
    await anamClient?.stopStreaming();
  } catch (error) {
    console.warn('Anam stop error:', error);
  }

  anamClient = null;
  resetUiAfterDisconnect();
}

talkImmersiveClose?.addEventListener('click',async()=>{
  // One close action ends the paid session and restores all main navigation.
  talkImmersiveClose.disabled=true;
  try{await disconnect();}
  finally{setTalkImmersive(false);talkImmersiveClose.disabled=false;}
});
micButton.addEventListener('click', () => {
  primePopAudio();
  if(selectedProvider==='voice' && connected){
    // Safari sometimes requires a second user tap to resume remote audio.
    void voiceSession?.resumeAudio();
    return;
  }
  if (!connected && !connecting) connect();
});

async function choosePersona(key) {
  if(!Object.hasOwn(PERSONA_NAMES,key) || selectedPersona===key || switchingPersona || connecting) return;
  switchingPersona = true;
  // update button states without replacing any current video stream
  for(const b of personaButtons)b.disabled=true;
  const live=connected || Boolean(anamClient) || Boolean(voiceSession);
  try {
    if(live) await disconnect();
    selectedPersona=key;
    localStorage.setItem(PERSONA_KEY,key);
    updateLanguageUi(true);
    updatePersonaUi();
    if(live) await connect();
  } finally {
    switchingPersona=false;
    updatePersonaUi();
  }
}
document.getElementById('conversationProvider')?.addEventListener('click', async event=>{
  const button=event.target.closest('button[data-provider]');
  if(!button)return;
  const next=button.dataset.provider;
  if(!['video','voice'].includes(next) || next===selectedProvider ||
      switchingProvider || connecting || switchingPersona)return;
  switchingProvider=true;
  updateProviderUi();
  const wasLive=connected||Boolean(anamClient)||Boolean(voiceSession);
  const continuity=currentMessages.filter(x=>x?.content?.trim()).slice(-8)
    .map(x=>(normalizedRole(x.role)==='user'?'Learner':personaName())+': '+x.content.trim()).join('\\n');
  try {
    if(wasLive)await disconnect();
    selectedProvider=next;
    localStorage.setItem(PROVIDER_KEY,next);
    handoffContext=continuity.slice(-1800);
    setAvatarLive(false);
    updateProviderUi();
    updatePersonaUi();
    primeButtonChoices();
    if(wasLive)await connect();
  } catch(error) {
    console.warn('Could not switch ECL voice mode',error);
    setStatus('Could not change mode');
  } finally {
    switchingProvider=false;
    updateProviderUi();
  }
});

personaPicker?.addEventListener('click',event=>{
  const button=event.target.closest('button[data-persona]');
  if(button && personaPicker.contains(button)) choosePersona(button.dataset.persona);
});

typeToggle?.addEventListener('click', () => setInteractionMode('type'));
speakModeButton?.addEventListener('click', () => setInteractionMode('speak'));
typeModeButton?.addEventListener('click', () => setInteractionMode('type'));
buttonModeButton?.addEventListener('click', () => setInteractionMode('button'));

typeComposer?.addEventListener('submit', async event => {
  event.preventDefault();
  if (isResponding) return;

  const text = typeInput?.value?.trim() || '';
  if (!text) return;

  if (!connected) {
    setStatus('Start Emma first');
    return;
  }

  typeInput.value = '';
  sendTypedTurn(text, 'type');
});

endButton.addEventListener('click', disconnect);

settingsButton.addEventListener('click', () => {
  settingsDialog.showModal();
});

tipButton?.addEventListener('click', showTip);
tipCloseButton?.addEventListener('click', hideTip);

liveReplayButton?.addEventListener('click', () => {
  const text = subtitleNl?.textContent?.trim() || lastSubtitlePair.nl || '';
  const highlightTarget = captionsToggle.checked ? subtitleNl : null;
  replayText(text, highlightTarget, { useAvatarVoice: true });
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
  difficultyToggle?.setAttribute('aria-expanded', 'false');
});

difficultyToggle?.addEventListener('click', event => {
  event.stopPropagation();
  const open = !document.body.classList.contains('level-expanded');
  document.body.classList.toggle('level-expanded', open);
  difficultyToggle.setAttribute('aria-expanded', String(open));
});

document.addEventListener('click', event => {
  if (!document.body.classList.contains('level-expanded')) return;
  if (event.target.closest('.difficulty-control')) return;
  document.body.classList.remove('level-expanded');
  difficultyToggle?.setAttribute('aria-expanded', 'false');
});

topicSelect?.addEventListener('change', async () => {
  const next=normalizeTopic(topicSelect.value);
  if(next===selectedTopic || switchingTopic || connecting || switchingPersona) {
    updateTopicUi();
    return;
  }
  switchingTopic=true;
  updateTopicUi();
  const wasLive=connected || Boolean(anamClient);
  try {
    // Stop previous-topic audio and store that conversation before starting
    // a new session with the new theme in the original system prompt.
    if(wasLive)await disconnect();
    selectedTopic=next;
    localStorage.setItem(TOPIC_KEY,next);
    clearQuickChoices();
    hideTip();
    cachedTip=null;
    currentMessages=[];
    translationByMessageId.clear();
    streamBuffers.clear();
    vocabProcessedIds.clear();
    vocabSentenceCounts.clear();
    lastProcessedUserMessageId=null;
    pinnedUserMessageId=null;
    activeSubtitleMessageId=null;
    lastUserPin.hidden=true;
    lastUserPinText.textContent='';
    if(lastUserPinEn)lastUserPinEn.textContent='';
    messagesEl.innerHTML='';
    updateLanguageUi(true);
    updateTopicUi();
    renderHistoryDialog();
    renderSessionHistoryDialog();
    primeButtonChoices();
    setStatus(next==='open' ? languageConfig().ready : ECL_TOPICS[next].label+' theme ready');
    if(wasLive)await connect();
  } catch(error) {
    console.error('ECL theme switch failed:',error);
    setStatus('Theme unavailable — try Start');
  } finally {
    switchingTopic=false;
    updateTopicUi();
  }
});

languageToggle?.addEventListener('click', async () => {
  if (languageToggle.disabled || connecting) return;
  // A language change must never leave old-language audio playing.
  // Close the old Anam stream first, update lesson stores, then reconnect
  // immediately under a new language-locked session if we were live.
  languageToggle.disabled = true;
  const wasLive = connected || Boolean(anamClient);
  try {
    if (wasLive) await disconnect();
    if (currentHistorySessionId) endHistorySession();

    targetLanguage = targetLanguage === 'nl' ? 'fr' : targetLanguage === 'fr' ? 'en' : 'nl';
    localStorage.setItem(LANGUAGE_KEY, targetLanguage);

    learnedWords = loadJson(wordsKey(), []);
    clearQuickChoices();
    hideTip();
    cachedTip = null;
    currentMessages = [];
    translationByMessageId.clear();
    streamBuffers.clear();
    vocabProcessedIds.clear();
    vocabSentenceCounts.clear();
    activeSubtitleMessageId = null;
    pinnedUserMessageId = null;
    lastProcessedUserMessageId = null;
    lastUserPin.hidden = true;
    lastUserPinText.textContent = '';
    if (lastUserPinEn) lastUserPinEn.textContent = '';
    messagesEl.innerHTML = '';

    updateLanguageUi(true);
    renderWordsDialog();
    renderHistoryDialog();
    studyPages?.refreshLanguage();
    primeButtonChoices();
    setStatus(languageConfig().ready);
    avatarPlaceholderText.textContent = `Ready for ${languageConfig().name}. Press Start conversation.`;
    if (wasLive) await connect();
  } catch(error) {
    console.error('Could not switch ECL lesson language:',error);
    setStatus('Language switch unavailable');
  } finally {
    languageToggle.disabled = false;
  }
});

sessionHistoryButton?.addEventListener('click', () => {
  renderSessionHistoryDialog();
  sessionHistoryDialog.showModal();
});

closeSessionHistory?.addEventListener('click', () => sessionHistoryDialog.close());

sessionHistoryDialog?.addEventListener('click', event => {
  if (event.target === sessionHistoryDialog) sessionHistoryDialog.close();
});

// These controls belong ONLY to Talk. Slide and News each have their own
// dedicated History / Words controls and never reuse Talk archives.
historyButton.addEventListener('click', () => {
  if(studyPages?.getPage()!=='talk')return;
  renderHistoryDialog();
  historyDialog.showModal();
});

wordsButton.addEventListener('click', () => {
  if(studyPages?.getPage()!=='talk')return;
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

window.visualViewport?.addEventListener('resize', updateTypeKeyboardOffset);
window.visualViewport?.addEventListener('scroll', updateTypeKeyboardOffset);
typeInput?.addEventListener('focus', () => {
  updateTypeKeyboardOffset();
  window.setTimeout(() => {
    updateTypeKeyboardOffset();
    if (conversationPane) conversationPane.scrollTop = conversationPane.scrollHeight;
  }, 170);
});
typeInput?.addEventListener('blur', updateTypeKeyboardOffset);

window.addEventListener('resize', updateTypeKeyboardOffset);

window.addEventListener('beforeunload', () => {
  if (currentHistorySessionId) saveCurrentHistory();
});

window.addEventListener('unhandledrejection', event => {
  console.error('Unhandled error:', event.reason);
});

studyPages = initStudyPages({
  getLanguage:()=>targetLanguage,
  getTalkWords:()=>loadJson(wordsKey(),[]),
  stopTalk:async()=>{
    if(connected||connecting||anamClient||voiceSession)await disconnect();
  }
});
migrateLanguageStores();
updateProviderUi();
learnedWords = loadJson(wordsKey(), []);
updateDifficultyUi();
updateLanguageUi(true);
updateTopicUi();
updateInteractionModeUi();
setAvatarLive(false);
updatePersonaUi();

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
