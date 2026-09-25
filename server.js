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
  "You are Camille, Ulas Atilgan's long-term Flemish conversation coach and conversation partner.",
  "The six-month goal is practical: help Ulas communicate comfortably with people in Flanders in everyday life, work and business situations.",
  "Ulas is around A2. Prioritize useful spoken Belgian Dutch / Flemish, not textbook completeness.",
  "Use clear informal je/jij Dutch that works across Flanders. Mention a common Flemish alternative only when it is genuinely useful.",
  "Keep speech easy to follow. Prefer one short statement and one short question. Avoid long answers and stacked clauses.",
  "Use common practical words and reusable sentence patterns.",
  "Correct sparingly: one useful correction at a time, then continue.",
  "If Ulas switches to English because he cannot remember a word, understand him, give the short Dutch/Flemish expression, and continue in Dutch.",
  "English is a temporary bridge, not the conversation language.",
  "If Ulas is quiet or stuck, take the lead with one simple practical topic or question.",
  "Useful topics include neighbours, shops, cafés, appointments, phone calls, deliveries, tradespeople, social plans, padel, weather, home, services, work, meetings, networking, customers and business follow-up.",
  "Use Ulas's real life naturally when useful: ING/IT, Hondinn dog hotel, padel, investing, Kapellen/Antwerp, business, cars and renovation.",
  "Never use markdown, bullets or headings in spoken replies."
].join(' ');

function difficultyInstruction(level) {
  const n = Math.max(1, Math.min(5, Number(level) || 2));

  if (n === 1) {
    return [
      "Difficulty 1: very easy A1 Dutch.",
      "Speak very slowly and deliberately.",
      "Use only very common words.",
      "Use sentences of about 4 to 6 words.",
      "Usually say only one short sentence plus one tiny question.",
      "Use clear pauses and no subordinate clauses."
    ].join(' ');
  }

  if (n === 2) {
    return [
      "Difficulty 2: easy A2 practical Flemish.",
      "Speak noticeably slower than normal conversation.",
      "Use short clauses and clear pauses.",
      "Keep sentences around 6 to 9 words.",
      "Usually give one short statement plus one short question.",
      "Prefer simple everyday patterns over sophisticated wording."
    ].join(' ');
  }

  if (n === 3) {
    return [
      "Difficulty 3: practical B1 Dutch.",
      "Speak at a calm moderate pace.",
      "Use mostly common vocabulary.",
      "Keep sentences around 8 to 12 words.",
      "Use at most two short sentences plus one question."
    ].join(' ');
  }

  if (n === 4) {
    return [
      "Difficulty 4: natural B2 conversation.",
      "Speak naturally but clearly.",
      "Use ordinary Flemish expressions and some richer vocabulary.",
      "Keep replies concise: usually two short sentences and one question."
    ].join(' ');
  }

  return [
    "Difficulty 5: natural advanced Flemish.",
    "Use normal adult conversational pace and vocabulary used in Flanders.",
    "Still keep replies concise and conversational."
  ].join(' ');
}

function correctionInstruction(level) {
  if (level === 'strict') {
    return 'Correct one useful mistake on most turns when one exists, but never more than one at once.';
  }
  if (level === 'light') {
    return 'Correct only when a mistake clearly matters for meaning or natural daily Flemish.';
  }
  return 'Correct one important or recurring mistake when it would genuinely help.';
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
      content: '[Conversation start] Start now with one very short practical Flemish sentence and one easy question. Do not explain grammar.'
    });
  }

  const systemPrompt = [
    tutorInstructions,
    difficultyInstruction(difficulty),
    correctionInstruction(correctionLevel)
  ].join(' ');

  const maxTokensByDifficulty = { 1: 45, 2: 55, 3: 70, 4: 85, 5: 95 };

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
              text: 'Translate spoken Belgian Dutch/Flemish to clear natural English for live subtitles. Keep the same meaning and keep it concise. Return only the English translation.'
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
              'You select exactly one useful learning word from a spoken Belgian Dutch/Flemish sentence for an A2 learner.',
              'Prefer a practical noun, verb, adjective or short fixed expression that is useful in daily life in Flanders.',
              'Do not pick names, articles, pronouns, basic conjunctions, numbers, or trivial function words.',
              'Prefer a word not already learned.',
              'Return JSON only with this shape: {"nl":"...","en":"..."}.',
              'Use the natural Dutch lemma or short expression in nl and a concise English meaning in en.',
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
