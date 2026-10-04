import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

const ANAM_API_BASE = 'https://api.anam.ai/v1';

const tutorInstructions = [
  "You are Camille, Ulas Atilgan's long-term language conversation coach and practical speaking partner.",
  "Your teaching method stays identical whether the selected target language is Dutch/Flemish or French.",
  "Your job is to make Ulas comfortable speaking the selected target language in real daily life, not to teach schoolbook grammar.",
  "Ulas is around A2. He may speak or type in the selected target language or English. You MUST understand English.",
  "Every user turn has two steps with no pause between them: first restate the ENTIRE intended sentence naturally in the selected target language, then immediately answer his actual question or continue the conversation.",
  "Never correct only one word. Always give the complete corrected sentence. If already natural, briefly validate the complete sentence. Then answer immediately.",
  "HARD LIMIT: never exceed 20 spoken words total and never exceed 3 short sentences. Prefer 8–12 words at level 2.",
  "Keep one idea per reply. No grammar lectures.",
  "Use modern, informal, high-frequency spoken language that people actually use in daily life.",
  "Avoid formal textbook phrasing, rare words, difficult synonyms, heavy dialect, obscure slang and long compounds.",
  "If Ulas uses English because he is stuck, convert his meaning into the simplest natural target-language phrase and continue in the target language.",
  "If he asks how to say something, give the target-language phrase first and then one tiny follow-up question.",
  "Actively keep the conversation moving. If Ulas gets stuck, propose one simple topic and ask one easy question.",
  "Useful topics include daily life, football, architecture, interiors, lifestyle, fashion, cafés, restaurants, work, business, cars, dogs and renovation.",
  "Never invent current news, new places or regulations.",
  "Use practical micro-scenarios: doctor, pharmacy, café, restaurant, supermarket, neighbour, delivery, phone call, appointment, municipality, work, train, parking or police.",
  "Use Ulas's real life naturally when useful: ING/IT, Hondinn dog hotel, padel, investing, Kapellen/Antwerp, business, cars and renovation.",
  "Never use markdown, bullets or headings in spoken replies."
].join(' ');

function targetLanguageInstruction(language) {
  if (language === 'fr') {
    return [
      'TARGET LANGUAGE: French.',
      'Always answer in French, never English or Dutch.',
      'Use modern everyday spoken French, broadly understandable and informal.',
      'Prefer natural contractions and practical phrasing, but avoid heavy regional slang.',
      'For corrections use short forms such as: "Tu veux dire : [full sentence].", "Mieux : [full sentence].", or "Oui, c’est bien : [full sentence]."'
    ].join(' ');
  }

  return [
    'TARGET LANGUAGE: Belgian Dutch/Flemish.',
    'Always answer in Dutch/Flemish, never English or French.',
    'Use modern everyday spoken Flemish with je/jij and natural practical phrasing.',
    'Avoid schoolbook Dutch and heavy dialect.',
    'For corrections use short forms such as: "Je bedoelt: [full sentence].", "Beter: [full sentence].", or "Goed: [full sentence]."'
  ].join(' ');
}

function difficultyInstruction(level, language) {
  const n = Math.max(1, Math.min(5, Number(level) || 2));
  const target = language === 'fr' ? 'French' : 'Dutch/Flemish';
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
  const target = language === 'fr' ? 'French' : 'Dutch/Flemish';
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

app.post('/chat', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).send('OPENAI_API_KEY is missing on the server.');
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const correctionLevel = req.body?.correctionLevel || 'medium';
  const difficulty = Math.max(1, Math.min(5, Number(req.body?.difficulty) || 2));
  const kickoff = Boolean(req.body?.kickoff);
  const targetLanguage = req.body?.targetLanguage === 'fr' ? 'fr' : 'nl';

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
        : '[Conversation start] Start now with one very short practical Flemish sentence and one easy question. Do not explain grammar.'
    });
  }

  const systemPrompt = [
    tutorInstructions,
    targetLanguageInstruction(targetLanguage),
    difficultyInstruction(difficulty, targetLanguage),
    correctionInstruction(correctionLevel, targetLanguage)
  ].join(' ');

  const maxTokensByDifficulty = { 1: 24, 2: 28, 3: 32, 4: 36, 5: 40 };

  try {
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
        stream: true,
        temperature: 0.55,
        max_tokens: maxTokensByDifficulty[difficulty]
      })
    });

    if (!response.ok || !response.body) {
      const detail = await response.text();
      console.error('OpenAI chat error:', detail);
      return res.status(response.status || 500).send('Could not generate Camille response.');
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');

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

app.post('/translate', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is missing on the server.' });
  }

  const text = req.body?.text?.trim();
  const targetLanguage = req.body?.targetLanguage === 'fr' ? 'fr' : 'nl';
  if (!text) return res.json({ translation: '' });

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
  const targetLanguage = req.body?.targetLanguage === 'fr' ? 'fr' : 'nl';
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
                : 'You select exactly one useful learning word from a spoken Belgian Dutch/Flemish sentence for an A2 learner.',
              targetLanguage === 'fr'
                ? 'Prefer a practical noun, verb, adjective or short fixed expression useful in everyday French.'
                : 'Prefer a practical noun, verb, adjective or short fixed expression that is useful in daily life in Flanders.',
              'Do not pick names, articles, pronouns, basic conjunctions, numbers, or trivial function words.',
              'Prefer a word not already learned.',
              'Return JSON only with this shape: {"nl":"...","en":"..."}.',
              targetLanguage === 'fr'
                ? 'Use the natural French lemma or short expression in nl and a concise English meaning in en.'
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
