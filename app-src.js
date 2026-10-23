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
const lastUserPinEn = document.getElementById('lastUserPinEn');
const successBalloon = document.getElementById('successBalloon');
const typeToggle = document.getElementById('typeToggle');
const typeComposer = document.getElementById('typeComposer');
const typeInput = document.getElementById('typeInput');
const languageToggle = document.getElementById('languageToggle');
const languageToggleLabel = document.getElementById('languageToggleLabel');
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
let userTranslationSeq = 0;
let lastUserTranslationAt = 0;

const streamBuffers = new Map();
const vocabProcessedIds = new Set();
const vocabSentenceCounts = new Map();
const translationByMessageId = new Map();
const lengthInterruptedIds = new Set();
let vocabQueue = Promise.resolve();

let difficulty = clampLevel(Number(localStorage.getItem(LEVEL_KEY) || 2));
const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
let targetLanguage = ['nl', 'fr', 'en'].includes(savedLanguage) ? savedLanguage : 'nl';
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
    hint: 'Speak or type in Dutch or English. Camille always answers in Dutch.',
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
    hint: 'Speak or type in French or English. Camille always answers in French.',
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
    hint: 'Speak or type in English. Camille improves clarity, fluency and professional impact.',
    placeholder: 'Write in English…',
    greeting: 'Hi Ulas. What are you working on today?',
    greetingEn: '',
    ready: 'Ready — professional English'
  }
};

function languageConfig() {
  return languageUi[targetLanguage] || languageUi.nl;
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
  avatarGoal.textContent = cfg.goal;
  levelLabel.textContent = cfg.level;
  modeHint.textContent = cfg.hint;
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
    lastSubtitlePair = { nl: cfg.greeting, en: cfg.greetingEn };
    setSubtitle(cfg.greeting, cfg.greetingEn);
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
    ? 'ABSOLUTE LANGUAGE LOCK: Ulas may speak French OR English. Understand both, but Camille must reply ONLY in French. Never reply in Dutch or English.'
    : isEnglish
      ? 'ABSOLUTE LANGUAGE LOCK: Camille must reply ONLY in English.'
      : 'ABSOLUTE LANGUAGE LOCK: Ulas may speak Dutch/Flemish OR English. Understand both, but Camille must reply ONLY in Belgian Dutch/Flemish. Never reply in French or English.';

  const teachingMode = isEnglish
    ? 'TEACHER MODE: be proactive and professional. Regularly propose a useful workplace topic, upgrade Ulas’s sentence to fluent business English, then ask one short follow-up question.'
    : 'TEACHER MODE: be proactive and natural. Regularly propose a useful everyday situation, teach the way people actually say it, then ask Ulas to use the phrase. Prioritize natural spoken usage over grammar theory.';

  return [
    'SESSION LEARNING CONTEXT — IMPORTANT:',
    languageLock,
    teachingMode,
    `You are Camille, Ulas Atilgan’s practical ${target} conversation coach.`,
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
      : `You MUST understand English normally, whether Ulas speaks it or types it. Camille must still answer in ${target} only.`,
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
    'Use his real life naturally when useful: ING/IT, Hondinn, job interviews, project work, investing, business, cars and renovation.'
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
  session.messages = currentMessages
    .filter(message => message?.content?.trim())
    .slice(-80)
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

async function sendTypedTurn(text) {
  const clean = String(text || '').trim();
  if (!clean || !anamClient || !connected || isResponding) return;

  celebrateUserTurn();

  const userId = `typed-user-${Date.now()}`;
  const personaId = `typed-persona-${Date.now()}`;

  pinnedUserMessageId = userId;
  setLastUserPin(clean, userId);
  finalizeUserTranslation(clean, userId);

  currentMessages = [
    ...currentMessages.filter(message => message?.content?.trim()),
    { id: userId, role: 'user', content: clean }
  ];

  saveCurrentHistory();
  renderMessages(currentMessages);

  isResponding = true;
  setStatus('Camille denkt…');
  activeChatAbort = new AbortController();
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
        targetLanguage
      })
    });

    if (!response.ok || !response.body) {
      throw new Error(await response.text());
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

    currentMessages = [
      ...currentMessages,
      { id: personaId, role: 'persona', content: full }
    ];

    processVocabularyProgress(personaId, full, true);
    saveCurrentHistory();
    renderMessages(currentMessages);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('Typed Camille response error:', error);
      setStatus('Response error');
    }
  } finally {
    activeChatAbort = null;
    isResponding = false;
    if (connected) setStatus(languageConfig().ready);
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
        correctionLevel: correctionLevel.value || 'medium',
        targetLanguage
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

    if (connected) setStatus(languageConfig().ready);
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

    // Keep this complete user turn visible while Camille answers.
    renderMessages(currentMessages);

    if (event.endOfSpeech) {
      streamBuffers.delete(event.id);
      finalizeUserTranslation(next, event.id);
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

function liveLanguageLockInstruction() {
  if (targetLanguage === 'fr') {
    return 'CRITICAL: Reply ONLY in French. Ulas may speak English; understand it but answer entirely in French. No Dutch. Use natural everyday French, correct the full sentence, then continue.';
  }

  if (targetLanguage === 'en') {
    return 'CRITICAL: Reply ONLY in English. Use fluent professional English. Correct the full sentence into a natural polished version, then continue.';
  }

  return 'CRITICAL: Reply ONLY in Belgian Dutch/Flemish. Ulas may speak English; understand it but answer entirely in Dutch/Flemish. No French. Use natural everyday Flemish, correct the full sentence, then continue.';
}

function attachAnamListeners(client) {
  client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
    connected = true;
    connecting = false;
    try {
      anamClient?.addContext(liveLanguageLockInstruction());
      pushLearningContext();
    } catch {}
    document.body.classList.add('conversation-live');
    document.body.classList.remove('level-expanded');
    micButton.disabled = false;
    micButton.classList.add('live');
    micLabel.textContent = 'Camille connected';
    endButton.disabled = false;
    setAvatarLive(true);
    setStatus(languageConfig().ready);
  });

  client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
    setAvatarLive(true);
    try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
    pushLearningContext();
    setTimeout(() => {
      try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
      pushLearningContext();
    }, 160);
  });

  client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, handleStreamEvent);
  client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, handleMessagesUpdated);

  client.addListener(AnamEvent.USER_SPEECH_STARTED, () => {
    try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
    setStatus('Listening…');
    voiceRing.classList.add('active');
    successBalloon?.classList.add('listening');

    // Keep Camille's last sentence visible while Ulas speaks.
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
    setStatus('Thinking…');
    voiceRing.classList.remove('active');
    successBalloon?.classList.remove('listening');
    celebrateUserTurn();

    // Reinforce the hard brevity rule immediately before Camille's next turn.
    if (connected) {
      try {
        const nextRule = targetLanguage === 'fr'
          ? 'NEXT TURN: ONLY French, even if Ulas spoke English. No Dutch. First give the FULL natural French sentence, then answer. Stay under 20 words. If useful, proactively teach one everyday phrase.'
          : targetLanguage === 'en'
            ? 'NEXT TURN: ONLY English. First give the FULL polished professional sentence, then answer. Stay under 28 words. Proactively improve fluency, business wording or stakeholder phrasing.'
            : 'NEXT TURN: ONLY Belgian Dutch/Flemish, even if Ulas spoke English. No French. First give the FULL natural Flemish sentence, then answer. Stay under 20 words. If useful, proactively teach one everyday phrase.';
        anamClient?.addContext(liveLanguageLockInstruction());
        anamClient?.addContext(nextRule);
      } catch {}
    }
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
      setStatus(languageConfig().ready);
    }

    beginHistorySession();
    saveCurrentHistory();
    try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
    pushLearningContext();
    setTimeout(pushLearningContext, 180);
    setTimeout(() => {
      try { anamClient?.addContext(liveLanguageLockInstruction()); } catch {}
    }, 420);

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

typeToggle?.addEventListener('click', () => {
  const open = typeToggle.getAttribute('aria-expanded') !== 'true';
  typeToggle.setAttribute('aria-expanded', String(open));
  typeComposer.hidden = !open;
  if (open) setTimeout(() => typeInput?.focus(), 0);
});

typeComposer?.addEventListener('submit', async event => {
  event.preventDefault();
  if (isResponding) return;

  const text = typeInput?.value?.trim() || '';
  if (!text) return;

  if (!connected) {
    setStatus('Start Camille first');
    return;
  }

  typeInput.value = '';
  sendTypedTurn(text);
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

languageToggle?.addEventListener('click', async () => {
  // Stop the previous Anam persona session before changing the language.
  // Otherwise the live avatar can keep speaking in its old language.
  languageToggle.disabled = true;
  try {
    if (connected || connecting || anamClient) await disconnect();
    if (currentHistorySessionId) endHistorySession();

  targetLanguage = targetLanguage === 'nl' ? 'fr' : targetLanguage === 'fr' ? 'en' : 'nl';
  localStorage.setItem(LANGUAGE_KEY, targetLanguage);

  learnedWords = loadJson(wordsKey(), []);
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

  // A new session is required for a different language. No context or speech
  // history is reused across Dutch, French and English.
  setStatus(languageConfig().ready);
  avatarPlaceholderText.textContent = `Ready for ${languageConfig().name}. Press Start conversation.`;
  } finally {
    languageToggle.disabled = false;
  }
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

migrateLanguageStores();
learnedWords = loadJson(wordsKey(), []);
updateDifficultyUi();
updateLanguageUi(true);
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
