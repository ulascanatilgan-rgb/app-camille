import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
// Prevent installed iOS PWAs from keeping old HTML, scripts and styles.
app.use((req, res, next) => {
  if (req.method === 'GET' && (/^\/$/.test(req.path) || /\.(?:html|js|css|webmanifest)$/.test(req.path) || req.path === '/sw.js')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(__dirname));

const ANAM_API_BASE = 'https://api.anam.ai/v1';

const tutorInstructions = [
  "You are Camille, Ulas Atilgan's long-term language conversation coach and practical speaking partner.",
  "The core teaching method stays consistent across Dutch/Flemish, French and English, but the style changes: Dutch/French prioritize natural everyday speech; English prioritizes fluent professional communication.",
  "Your job is to make Ulas comfortable speaking the selected target language in real daily life, not to teach schoolbook grammar.",
  "For Dutch/French, Ulas is around A2 and needs simple natural speech. His English is stronger and should be coached toward fluent professional communication. He may speak or type in the selected target language or English. You MUST understand English.",
  "For normal spoken or typed turns, first restate the ENTIRE intended sentence naturally in the selected target language, then immediately answer his actual question or continue the conversation. BUTTON INPUT IS AN EXCEPTION: never restate or echo a quick-choice answer unless it is genuinely incorrect.",
  "For spoken or typed turns, never correct only one word; give the complete corrected sentence. For button turns, do not use correction or validation formulas at all unless there is a real language error.",
  "Keep every reply concise and easy to follow. Obey the language-specific word limit and style defined below.",
  "Keep one idea per reply. No grammar lectures.",
  "Follow the selected-language style: Dutch/French should be natural, everyday and high-frequency; English should be fluent, polished and professional.",
  "Avoid formal textbook phrasing, rare words, difficult synonyms, heavy dialect, obscure slang and long compounds.",
  "If Ulas uses English because he is stuck, convert his meaning into the simplest natural target-language phrase and continue in the target language.",
  "If he asks how to say something, give the target-language phrase first and then one tiny follow-up question.",
  "Act as an active personal language teacher, not a passive chat partner. Do not wait for Ulas to choose every topic. If he gives a short answer or the conversation slows, choose the next useful lesson yourself.",
  "Regularly introduce one highly useful phrase, verb, question pattern or positive/negative structure and prompt Ulas to reuse it immediately.",
  "Give high priority to workplace and project-management language: status updates, sending/following up emails, project progress, blockers, ownership, meetings, deadlines, planning, upcoming changes, decisions, requests, confirmations and asking for clarification.",
  "Also teach practical daily spoken language: doctor, appointments, café, neighbours, shopping, transport, phone calls and simple requests.",
  "Useful personal-interest topics include football, architecture, interiors, lifestyle, fashion, cafés, restaurants, business, cars, dogs and renovation.",
  "Never invent current news, new places or regulations.",
  "Use practical micro-scenarios and mini-drills. Every few turns, proactively add a compact equivalent of 'You can also say it like this' or 'This verb is very common', followed by one reusable example.",
  "For work practice, repeatedly recycle short useful intentions: Did you send that email? What is the current status? How is it going? Are we still on schedule? Will we meet the deadline? Are you planning a change soon? Can you give me an update? What is blocking us?",
  "Use practical micro-scenarios: doctor, pharmacy, café, restaurant, supermarket, neighbour, delivery, phone call, appointment, municipality, work, train, parking or police.",
  "Use Ulas's real life naturally when useful: ING/IT, Hondinn dog hotel, padel, investing, Kapellen/Antwerp, business, cars and renovation.",
  "Lead each session with a useful question. Every 2–3 turns take initiative: say the equivalent of 'Let’s talk about...' or 'What do you think about...?', introduce one useful phrase, demonstrate it, and invite Ulas to use it.",
  "Be a warm, calm, encouraging teacher. Use short coaching moves such as: You can say it more naturally like this; A more professional way to put it is; This is a very common verb; Let’s practise that; Now let’s talk about... — always expressed in the selected target language.",
  "Keep replies short, clear and easy to repeat. Ask exactly one easy question at a time. Avoid long explanations.",
  "SPEAKING PACE: use calm, clearly articulated phrasing designed to be spoken about 15% slower than normal conversational speed, with short natural pauses between clauses.",
  "Never use markdown, bullets or headings in spoken replies."
].join(' ');

function choiceModeInstruction(enabled) {
  if (!enabled) return '';

  return [
    'BUTTON REPLY MODE IS ON.',
    'End every reply with exactly one short, concrete question that can naturally be answered using three distinct short options.',
    'Do not list the three options in the spoken response; the interface generates them separately.',
    'If the learner answers with only one or two words, treat it as a valid intentional button reply. Do not force a full-sentence correction unless it is actually wrong.',
    'Vary your reaction style. Do not repeat the same acknowledgement or correction formula.',
    'You may agree, disagree politely, show curiosity, give a tiny suggestion, contrast an idea, react positively or neutrally, or move directly to the next question.',
    'Prefer questions that move the conversation forward and make the learner choose, react or express a simple preference.'
  ].join(' ');
}

function inputModeInstruction(mode, inputKind, language) {
  const normalizedMode = ['speak', 'type', 'button'].includes(mode) ? mode : 'speak';

  if (normalizedMode === 'button' || inputKind === 'button') {
    const languageBan = language === 'fr'
      ? 'ABSOLUTELY DO NOT say “Tu veux dire”, “Mieux”, “Oui, c’est bien”, or any equivalent restatement of the selected button.'
      : language === 'nl'
        ? 'ABSOLUTELY DO NOT say “Je bedoelt”, “Beter”, “Goed”, or any equivalent restatement of the selected button.'
        : 'ABSOLUTELY DO NOT say “You mean”, “So you mean”, or any equivalent restatement of the selected button.';

    return [
      'HIGHEST PRIORITY FOR THIS TURN: the learner’s latest reply came from a quick-choice button.',
      'The selected one- or two-word answer is complete and intentional. React to its MEANING; do not correct it, paraphrase it, repeat it, or announce what the learner said unless it is genuinely wrong.',
      languageBan,
      'Do not reuse the same opening pattern from the previous four assistant turns.',
      'Vary naturally: sometimes respond directly, agree, disagree politely, show curiosity, make a small observation, offer a tiny suggestion, contrast the choice, or go straight to the next question.',
      'Sound like a real conversation partner, not a correction template or quiz engine.'
    ].join(' ');
  }

  if (normalizedMode === 'type') {
    return 'The learner is typing. Continue the exact same conversation and context; do not restart or change topic because the input method changed.';
  }

  return 'The learner is speaking. Continue the same conversation naturally.';
}

function normalizeTargetLanguage(value) {
  return ['nl', 'fr', 'en'].includes(value) ? value : 'nl';
}

function targetLanguageInstruction(language) {
  if (language === 'en') {
    return [
      'TARGET LANGUAGE: Professional English.',
      'ABSOLUTE OUTPUT LANGUAGE LOCK: Respond exclusively in English.',
      'This mode should be more fluent, polished and linguistically rich than Dutch/French mode.',
      'Use natural international business English: strong collocations, phrasal verbs, diplomatic softeners, concise executive phrasing and confident spoken rhythm.',
      'For spoken or typed input, correct the complete sentence first and offer a stronger professional version when useful. For button input, react directly without restating the selected choice.',
      'Proactively teach phrases for meetings, stakeholder updates, interviews, presentations, negotiation, disagreement, project status, blockers, deadlines and next steps. Initiate these topics yourself instead of waiting for Ulas.',
      'Useful examples: "Are we still on track?", "What’s the current status?", "Is anything blocking progress?", "Could you give me a quick update?", "Do you foresee any changes?", "I’d suggest we revisit this before we commit."'
    ].join(' ');
  }

  if (language === 'fr') {
    return [
      'TARGET LANGUAGE: French.',
      'ABSOLUTE OUTPUT LANGUAGE LOCK: Respond exclusively in French. No Dutch words, phrases or Dutch examples. Understand user speech in French OR English; translate English intent into natural French and reply only in French.',
      'NATURALNESS FIRST: use the version people commonly say in everyday French, not the textbook version.',
      'Use modern everyday spoken French, broadly understandable and informal.',
      'Prefer natural contractions, common verbs and practical phrasing, but avoid heavy regional slang and grammar lectures.',
      'For SPOKEN OR TYPED corrections only, use short forms such as: "Tu veux dire : [full sentence].", "Mieux : [full sentence].", or "Oui, c’est bien : [full sentence]." Never use these formulas for button replies.',
      'Proactively teach useful phrases such as: "Tu as envoyé ce mail ?", "On en est où ?", "Ça marche ?", "Tu peux me dire… ?", "J’ai besoin de…", "Je peux pas aujourd’hui.", "Tu veux qu’on en parle ?"',
      'Initiate practical mini-topics yourself: work chat, café, doctor, appointments, neighbours, shopping, transport, plans and simple social situations.'
    ].join(' ');
  }

  return [
    'TARGET LANGUAGE: Belgian Dutch/Flemish.',
    'ABSOLUTE OUTPUT LANGUAGE LOCK: Respond exclusively in Dutch/Flemish. No French words, phrases or French examples. Understand user speech in Dutch OR English; translate English intent into natural Flemish and reply only in Flemish.',
    'NATURALNESS FIRST: use the version people commonly say in everyday Flemish, not the textbook version.',
    'Use modern everyday spoken Flemish with je/jij, common verbs, natural omissions and practical phrasing.',
    'Avoid schoolbook Dutch, formal constructions, heavy dialect and grammar lectures.',
    'For SPOKEN OR TYPED corrections only, use short forms such as: "Je bedoelt: [full sentence].", "Beter: [full sentence].", or "Goed: [full sentence]." Never use these formulas for button replies.',
    'Proactively teach useful phrases such as: "Heb je die mail al gestuurd?", "Hoe staat het ermee?", "Hoe zit het?", "Kun je even…?", "Ik heb … nodig.", "Dat lukt vandaag niet.", "Zullen we het erover hebben?"',
    'Initiate practical mini-topics yourself: work chat, café, doctor, appointments, neighbours, shopping, transport, plans and simple social situations.'
  ].join(' ');
}

function difficultyInstruction(level, language) {
  const n = Math.max(1, Math.min(5, Number(level) || 2));
  const target = language === 'en' ? 'English' : language === 'fr' ? 'French' : 'Dutch/Flemish';

  if (language === 'en') {
    const englishStyles = {
      1: 'clear B1 professional English',
      2: 'fluent B2 professional English',
      3: 'strong B2+ professional English',
      4: 'natural C1 professional English',
      5: 'rich C1+ executive-ready English'
    };
    const englishRanges = {
      1: '12 to 18 words',
      2: '16 to 22 words',
      3: '18 to 24 words',
      4: '20 to 26 words',
      5: '28 words or fewer'
    };
    return [
      'Maximum 28 words total and maximum 3 short sentences.',
      `Difficulty ${n}: ${englishStyles[n]}.`,
      'Sound natural, polished and internationally professional.',
      'Use richer vocabulary and collocations without becoming verbose or corporate-jargony.',
      `Keep the whole reply around ${englishRanges[n]}.`
    ].join(' ');
  }

  const shared =
    'Absolute speaking limit: maximum 20 words total and maximum 3 short sentences. Prefer 1–2 sentences. Never exceed this.';

  const ranges = {
    1: '6 to 10 words',
    2: '8 to 12 words',
    3: '12 to 16 words',
    4: '14 to 18 words',
    5: '20 words or fewer'
  };

  const levelStyle = {
    1: 'very easy A1',
    2: 'easy A1–A2 practical spoken',
    3: 'practical B1',
    4: 'natural B2',
    5: 'advanced natural'
  };

  return [
    shared,
    `Difficulty ${n}: ${levelStyle[n]} ${target}.`,
    'Speak calmly, clearly and naturally.',
    'Use common everyday vocabulary.',
    `Keep the whole reply around ${ranges[n]}.`
  ].join(' ');
}

function correctionInstruction(level, language) {
  const target = language === 'en' ? 'English' : language === 'fr' ? 'French' : 'Dutch/Flemish';
  if (level === 'strict') {
    return `Every turn: give the complete corrected ${target} sentence first, never a word-only correction. Strict may be slightly more explicit, but stay short.`;
  }
  if (level === 'light') {
    return `Every turn: give the complete natural ${target} sentence first, even for a small correction, then answer.`;
  }
  return `Every turn: restate the complete sentence in natural spoken ${target} first, then answer immediately.`;
}

async function requestAnamSessionToken(apiKey, personaConfig) {
  const response = await fetch(`${ANAM_API_BASE}/auth/session-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ personaConfig })
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  if (!response.ok || !data?.sessionToken) {
    const error = new Error(`Anam session token request failed with HTTP ${response.status}`);
    error.detail = text;
    error.status = response.status;
    throw error;
  }

  return data.sessionToken;
}

async function buildAnamSession(apiKey, personaId) {
  const sessionToken = await requestAnamSessionToken(apiKey, { personaId });

  return {
    sessionToken,
    mode: 'published-persona',
    source: 'published-persona-id'
  };
}

function safeAnamError(error) {
  let message = 'Unknown Anam error';

  if (typeof error?.detail === 'string' && error.detail.trim()) {
    try {
      const parsed = JSON.parse(error.detail);
      message =
        parsed?.message ||
        parsed?.error ||
        parsed?.detail ||
        message;
    } catch {
      message = error.detail.slice(0, 300);
    }
  } else if (error?.message) {
    message = error.message;
  }

  return {
    status: Number(error?.status) || 500,
    message: String(message).slice(0, 300)
  };
}

app.post('/anam-session', async (_req, res) => {
  const apiKey = process.env.ANAM_API_KEY;
  const personaId = process.env.ANAM_PERSONA_ID;

  if (!apiKey || !personaId) {
    return res.status(500).json({
      error: 'ANAM_API_KEY or ANAM_PERSONA_ID is missing on the server.'
    });
  }

  try {
    const session = await buildAnamSession(apiKey, personaId);
    res.setHeader('Cache-Control', 'no-store');
    return res.json(session);
  } catch (error) {
    const safe = safeAnamError(error);
    console.error('Anam session error:', error?.detail || error);
    return res.status(safe.status).json({
      error: 'Could not create the Anam session.',
      anamStatus: safe.status,
      anamMessage: safe.message
    });
  }
});

app.get('/anam-health', async (_req, res) => {
  const apiKey = process.env.ANAM_API_KEY;
  const personaId = process.env.ANAM_PERSONA_ID;

  if (!apiKey || !personaId) {
    return res.status(500).json({
      ok: false,
      configured: false,
      apiKeyConfigured: Boolean(apiKey),
      personaIdConfigured: Boolean(personaId)
    });
  }

  try {
    await requestAnamSessionToken(apiKey, { personaId });
    return res.json({
      ok: true,
      configured: true,
      personaIdAccepted: true,
      sessionTokenReady: true
    });
  } catch (error) {
    const safe = safeAnamError(error);
    return res.status(safe.status).json({
      ok: false,
      configured: true,
      personaIdAccepted: safe.status !== 400 && safe.status !== 404,
      sessionTokenReady: false,
      anamStatus: safe.status,
      anamMessage: safe.message
    });
  }
});

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeButtonReply(text, language, selectedChoice) {
  let clean = String(text || '').trim();
  if (!clean) return clean;

  const prefixes = language === 'fr'
    ? [
        /^\s*(?:tu veux dire|mieux|oui[, ]+c['’]est bien)\s*[:：-]?\s*/i,
        /^\s*(?:donc[, ]+tu veux dire)\s*[:：-]?\s*/i
      ]
    : language === 'nl'
      ? [
          /^\s*(?:je bedoelt|beter|goed)\s*[:：-]?\s*/i,
          /^\s*(?:dus[, ]+je bedoelt)\s*[:：-]?\s*/i
        ]
      : [
          /^\s*(?:you mean|so you mean)\s*[:：-]?\s*/i
        ];

  for (const pattern of prefixes) clean = clean.replace(pattern, '').trim();

  const choice = String(selectedChoice || '').trim();
  if (choice) {
    const echo = new RegExp('^\\s*' + escapeRegExp(choice) + '\\s*[,.:;!–—-]+\\s*', 'i');
    clean = clean.replace(echo, '').trim();
  }

  return clean;
}
app.post('/chat', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).send('OPENAI_API_KEY is missing on the server.');
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const correctionLevel = req.body?.correctionLevel || 'medium';
  const difficulty = Math.max(1, Math.min(5, Number(req.body?.difficulty) || 2));
  const kickoff = Boolean(req.body?.kickoff);
  const targetLanguage = normalizeTargetLanguage(req.body?.targetLanguage);
  const choiceModeEnabled = Boolean(req.body?.choiceModeEnabled);
  const interactionMode = ['speak', 'type', 'button'].includes(req.body?.interactionMode)
    ? req.body.interactionMode
    : (choiceModeEnabled ? 'button' : 'speak');
  const inputKind = req.body?.inputKind === 'button' ? 'button' : req.body?.inputKind === 'type' ? 'type' : 'speak';

  const history = incoming
    .filter(message =>
      message &&
      typeof message.content === 'string' &&
      (message.role === 'user' || message.role === 'persona')
    )
    .slice(-14)
    .map(message => ({
      role: message.role === 'persona' ? 'assistant' : 'user',
      content: message.content.trim()
    }))
    .filter(message => message.content);

  if (kickoff) {
    history.push({
      role: 'user',
      content: targetLanguage === 'fr'
        ? '[Conversation start] Start now with one very short practical French sentence and one easy question. Do not explain grammar.'
        : targetLanguage === 'en'
          ? '[Conversation start] Start with one polished professional-English prompt about work, projects or stakeholder communication. Keep it conversational.'
          : '[Conversation start] Start now with one very short practical Flemish sentence and one easy question. Do not explain grammar.'
    });
  }

  const systemPrompt = [
    tutorInstructions,
    targetLanguageInstruction(targetLanguage),
    difficultyInstruction(difficulty, targetLanguage),
    inputKind === 'button' ? '' : correctionInstruction(correctionLevel, targetLanguage),
    choiceModeInstruction(choiceModeEnabled),
    inputModeInstruction(interactionMode, inputKind, targetLanguage)
  ].filter(Boolean).join(' ');

  const maxTokensByDifficulty = targetLanguage === 'en'
    ? { 1: 36, 2: 44, 3: 52, 4: 58, 5: 64 }
    : { 1: 24, 2: 28, 3: 32, 4: 36, 5: 40 };

  try {
    const isButtonTurn = inputKind === 'button';
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          ...history
        ],
        stream: !isButtonTurn,
        temperature: isButtonTurn ? 0.82 : 0.55,
        frequency_penalty: isButtonTurn ? 0.45 : 0,
        presence_penalty: isButtonTurn ? 0.2 : 0,
        max_tokens: maxTokensByDifficulty[difficulty]
      })
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('OpenAI chat error:', detail);
      return res.status(response.status || 500).send('Could not generate Camille response.');
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');

    if (isButtonTurn) {
      const data = await response.json();
      const selectedChoice = [...history].reverse().find(message => message.role === 'user')?.content || '';
      const raw = data.choices?.[0]?.message?.content || '';
      const clean = sanitizeButtonReply(raw, targetLanguage, selectedChoice);
      return res.end(clean || raw);
    }

    if (!response.body) {
      return res.end('Could not generate Camille response.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        try {
          const event = JSON.parse(data);
          const content = event.choices?.[0]?.delta?.content || '';
          if (content) res.write(content);
        } catch {}
      }
    }

    res.end();
  } catch (error) {
    console.error('Camille chat streaming error:', error);
    if (!res.headersSent) {
      return res.status(500).send('Could not generate Camille response.');
    }
    res.end();
  }
});


app.post('/choices', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ choices: [] });
  const text = String(req.body?.text || '').trim();
  const targetLanguage = normalizeTargetLanguage(req.body?.targetLanguage);
  const recentMessages = Array.isArray(req.body?.recentMessages)
    ? req.body.recentMessages.filter(m => m && typeof m.content === 'string')
        .slice(-6).map(m => `${m.role === 'user' ? 'USER' : 'CAMILLE'}: ${m.content.trim()}`).join('\n')
    : '';
  if (!text) return res.json({ choices: [] });
  const language = targetLanguage === 'fr' ? 'natural everyday French'
    : targetLanguage === 'en' ? 'natural contextual English'
    : 'natural everyday Belgian Dutch/Flemish';
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.35,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: [
            'Create exactly THREE distinct, plausible, very short replies to Camille’s latest question.',
            `Each text must be in ${language} and use only 1–4 words.`,
            'Each english property must give the accurate natural English translation in 1–6 words.',
            'Provide genuinely different answers, not three synonyms. No emojis, labels, commentary or trailing punctuation.',
            'If no plausible direct answer exists, return {"choices":[]}.',
            'Otherwise output only JSON: {"choices":[{"text":"...","english":"..."},{"text":"...","english":"..."},{"text":"...","english":"..."}]}.'
          ].join(' ') },
          { role: 'user', content: `Recent dialogue:\n${recentMessages || '(none)'}\n\nCamille just said:\n${text}` }
        ],
        max_tokens: 200
      })
    });
    if (!response.ok) return res.json({ choices: [] });
    const data = await response.json();
    let parsed = {};
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch {}
    const choices = [], seen = new Set();
    for (const choice of Array.isArray(parsed.choices) ? parsed.choices : []) {
      if (!choice || typeof choice !== 'object') continue;
      const text = String(choice.text || '').trim().replace(/[.!?;,]+$/g, '').split(/\s+/).slice(0,4).join(' ');
      const english = String(choice.english || '').trim().replace(/[.!?;,]+$/g, '').split(/\s+/).slice(0,6).join(' ');
      if (!text || (targetLanguage !== 'en' && !english) || seen.has(text.toLocaleLowerCase())) continue;
      seen.add(text.toLocaleLowerCase());
      choices.push({ text, english: targetLanguage === 'en' ? '' : english });
      if (choices.length === 3) break;
    }
    return res.json({ choices: choices.length === 3 ? choices : [] });
  } catch (error) {
    console.error('Quick reply generation failed:', error);
    return res.status(500).json({ choices: [] });
  }
});

app.post('/tip', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ tip: null });
  const text = String(req.body?.text || '').trim().slice(0, 900);
  const targetLanguage = normalizeTargetLanguage(req.body?.targetLanguage);
  if (!text) return res.json({ tip: null });
  const recentMessages = Array.isArray(req.body?.recentMessages)
    ? req.body.recentMessages.filter(m => m && typeof m.content === 'string')
        .slice(-6).map(m => `${m.role === 'user' ? 'USER' : 'CAMILLE'}: ${m.content.trim()}`).join('\n')
    : '';
  const language = targetLanguage === 'fr' ? 'French' : targetLanguage === 'en' ? 'English' : 'Belgian Dutch/Flemish';
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0.45,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: [
            `Generate ONE natural response in ${language} that the learner could say or type to reply to Camille.`,
            'Keep it concise, ideally 3–10 words and at most 12. If the latest message is not a question, offer a brief natural reaction.',
            'Match the learner’s language level. Provide its accurate natural English translation.',
            'Do not take any action on behalf of the learner. Output JSON only: {"tip":{"text":"...","english":"..."}}.'
          ].join(' ') },
          { role: 'user', content: `Recent dialogue:\n${recentMessages || '(none)'}\n\nCamille just said:\n${text}` }
        ],
        max_tokens: 130
      })
    });
    if (!response.ok) return res.status(502).json({ tip: null });
    const data = await response.json();
    let parsed = {};
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch {}
    const answer = String(parsed.tip?.text || '').trim();
    const english = String(parsed.tip?.english || '').trim();
    if (!answer || (targetLanguage !== 'en' && !english)) return res.json({ tip: null });
    return res.json({ tip: { text: answer, english: targetLanguage === 'en' ? '' : english } });
  } catch (error) {
    console.error('Tip generation failed:', error);
    return res.status(500).json({ tip: null });
  }
});

app.post('/translate', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is missing on the server.' });
  }

  const text = req.body?.text?.trim();
  const targetLanguage = normalizeTargetLanguage(req.body?.targetLanguage);
  if (!text || targetLanguage === 'en') return res.json({ translation: '' });

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: targetLanguage === 'fr'
                ? 'Translate spoken French to clear natural English for live subtitles. Keep the same meaning and keep it concise. Return only the English translation.'
                : 'Translate spoken Belgian Dutch/Flemish to clear natural English for live subtitles. Keep the same meaning and keep it concise. Return only the English translation.'
            }]
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text }]
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Translation failed.' });
    }

    const translation =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      '';

    return res.json({ translation });
  } catch (error) {
    console.error('Translation request failed:', error);
    return res.status(500).json({ error: 'Translation failed.' });
  }
});

app.post('/vocab', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is missing on the server.' });
  }

  const text = String(req.body?.text || '').trim();
  const targetLanguage = normalizeTargetLanguage(req.body?.targetLanguage);
  const knownWords = Array.isArray(req.body?.knownWords)
    ? req.body.knownWords.filter(word => typeof word === 'string').slice(-120)
    : [];

  if (!text) return res.json({ word: null });

  const known = knownWords.length ? knownWords.join(', ') : '(none)';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              targetLanguage === 'fr'
                ? 'You select exactly one useful learning word from a spoken French sentence for an A2 learner.'
                : targetLanguage === 'en'
                  ? 'You select exactly one useful professional-English word, collocation or short expression from the sentence.'
                  : 'You select exactly one useful learning word from a spoken Belgian Dutch/Flemish sentence for an A2 learner.',
              targetLanguage === 'fr'
                ? 'Prefer a practical noun, verb, adjective or short fixed expression useful in everyday French.'
                : targetLanguage === 'en'
                  ? 'Prefer professional collocations, phrasal verbs, concise workplace expressions, diplomatic wording or high-value business vocabulary.'
                  : 'Prefer a practical noun, verb, adjective or short fixed expression that is useful in daily life in Flanders.',
              'Do not pick names, articles, pronouns, basic conjunctions, numbers, or trivial function words.',
              'Prefer a word not already learned.',
              'Return JSON only with this shape: {"nl":"...","en":"..."}.',
              targetLanguage === 'fr'
                ? 'Use the natural French lemma or short expression in nl and a concise English meaning in en.'
                : targetLanguage === 'en'
                  ? 'Put the English word or expression in nl and a short plain-English definition or stronger synonym in en.'
                  : 'Use the natural Dutch lemma or short expression in nl and a concise English meaning in en.',
              'If there is no useful new item, return {"nl":"","en":""}.'
            ].join(' ')
          },
          {
            role: 'user',
            content: `Sentence: ${text}\nAlready learned: ${known}`
          }
        ],
        max_tokens: 60
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ word: null });
    }

    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try {
      parsed = JSON.parse(raw);
    } catch {}

    const nl = String(parsed.nl || '').trim();
    const en = String(parsed.en || '').trim();

    if (!nl || !en) return res.json({ word: null });
    return res.json({ word: { nl, en } });
  } catch (error) {
    console.error('Vocabulary extraction failed:', error);
    return res.status(500).json({ word: null });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    openai: Boolean(process.env.OPENAI_API_KEY),
    anam: Boolean(process.env.ANAM_API_KEY && process.env.ANAM_PERSONA_ID)
  });
});

app.listen(port, () => {
  console.log(`Camille is ready at http://localhost:${port}`);
});
