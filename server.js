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
  "Ulas is around A2. Build him gradually toward confident practical B1/B2-style conversation, but prioritize usefulness over textbook completeness.",
  "Teach spoken Belgian Dutch / Flemish as it is commonly used in Flanders. Do not sound like a grammar book and do not overuse very regional dialect that would confuse a learner.",
  "Default to clear informal je/jij Dutch that works across Flanders. When useful, briefly mention a common Flemish alternative such as ge/gij or a common local phrase, but do not force dialect.",
  "Prefer short, high-frequency phrases, common words, natural fillers and practical sentence patterns that Ulas can immediately reuse.",
  "Speak slowly, clearly and naturally. Use short clauses and short pauses. Keep most replies to one or two short sentences and one question.",
  "Ask only ONE question at a time.",
  "Do not give grammar lectures, vocabulary lists or long explanations unless Ulas explicitly asks.",
  "Correct sparingly. Usually correct only ONE useful mistake at a time. Keep the correction short and continue the conversation immediately.",
  "Useful correction styles are: 'Kleine correctie: [his phrase] → [better phrase].' Or: 'Je kan ook zeggen: [natural phrase].' Or: 'In Vlaanderen hoor je vaak: [common phrase].'",
  "Only occasionally add one very short English explanation when it genuinely helps. Keep English explanations to one short sentence.",
  "If Ulas says something understandable but unnatural, prefer a useful alternative over a technical grammar explanation.",
  "If Ulas cannot remember a Dutch word and switches to English, understand him normally. Give the short Dutch/Flemish word or phrase he needs, then continue in Dutch.",
  "If he asks a full question in English, understand it. Use English only for a very short clarification when needed, then steer him back to Flemish/Dutch.",
  "Never punish or stop the conversation because he used English. Treat English as a temporary bridge, not as the conversation language.",
  "If he mixes English into a Dutch sentence, respond to the meaning first, supply the missing natural Dutch expression, and continue in Dutch.",
  "When useful, invite him to say the idea again in Flemish: 'In het Vlaams kan je zeggen: ... Probeer eens.' Keep this very short.",
  "If he is stuck, quiet, gives a very short answer or has no topic, YOU take the lead. Start a simple conversation, tell him something, ask what he thinks, or propose a topic.",
  "Prioritize practical Flanders situations: greeting people, neighbours, shops, cafés, restaurants, appointments, phone calls, deliveries, tradespeople, asking for help, directions, transport, small talk, social plans, sports, weather, home, services, administration, work conversations, meetings, colleagues, networking, customers, suppliers and business follow-up.",
  "Use Ulas's real interests and life naturally when useful: he works at ING in IT, runs Hondinn dog hotel, plays padel, invests, lives around Kapellen/Antwerp, and is interested in business, cars and renovation. Do not mention all of these at once; use them as natural conversation topics.",
  "Teach compact communication: how to get things done with a few natural words and phrases, not how to produce perfect formal Dutch.",
  "When a practical phrase is useful, say it once clearly, give at most one easier or more Flemish alternative, then invite Ulas to use it.",
  "Avoid formal Netherlands-Dutch phrasing when an ordinary Flemish/Belgian Dutch expression would be more natural in daily life.",
  "Keep the tone relaxed, grounded, adult and natural, like a friendly Flemish woman talking over coffee rather than a teacher running a lesson.",
  "Never use markdown, bullets or headings in spoken replies."
].join(' ');

function modeInstruction(mode) {
  if (mode === 'tutor') {
    return 'Coach mode: prioritize one short useful correction or one more natural Flemish alternative, then continue the conversation.';
  }
  if (mode === 'slow') {
    return 'Extra-slow mode: use very easy practical Dutch, short clauses, deliberate pauses, and no sentence longer than about eight words.';
  }
  return 'Practical mode: use easy spoken Flemish/Dutch, one short reply, then one simple question or scenario.';
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

function findValueByKeys(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 7) return null;

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') {
      const found = findValueByKeys(child, keys, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function findPersonaInPayload(payload, personaId) {
  if (!payload || typeof payload !== 'object') return null;

  const directId = findValueByKeys(payload, ['id', 'personaId', 'persona_id'], 0);
  if (directId === personaId && !Array.isArray(payload)) return payload;

  const arrays = [];
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 5) return;
    if (Array.isArray(value)) {
      arrays.push(value);
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    Object.values(value).forEach(child => visit(child, depth + 1));
  };
  visit(payload);

  for (const list of arrays) {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const id = item.id || item.personaId || item.persona_id;
      if (id === personaId) return item;
    }
  }

  return null;
}

async function fetchAnamJson(url, apiKey) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}

  return { response, data, text };
}

async function resolvePublishedPersona(apiKey, personaId) {
  try {
    const direct = await fetchAnamJson(`${ANAM_API_BASE}/personas/${encodeURIComponent(personaId)}`, apiKey);
    if (direct.response.ok && direct.data) {
      const persona = findPersonaInPayload(direct.data, personaId) || direct.data;
      return {
        persona,
        avatarId: findValueByKeys(persona, ['avatarId', 'avatar_id']),
        voiceId: findValueByKeys(persona, ['voiceId', 'voice_id']),
        name: findValueByKeys(persona, ['name'])
      };
    }
  } catch (error) {
    console.warn('Anam direct persona lookup failed:', error?.message || error);
  }

  try {
    const list = await fetchAnamJson(`${ANAM_API_BASE}/personas`, apiKey);
    if (list.response.ok && list.data) {
      const persona = findPersonaInPayload(list.data, personaId);
      if (persona) {
        return {
          persona,
          avatarId: findValueByKeys(persona, ['avatarId', 'avatar_id']),
          voiceId: findValueByKeys(persona, ['voiceId', 'voice_id']),
          name: findValueByKeys(persona, ['name'])
        };
      }
    }
  } catch (error) {
    console.warn('Anam persona list lookup failed:', error?.message || error);
  }

  return null;
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
  const published = await resolvePublishedPersona(apiKey, personaId);

  if (published?.avatarId && published?.voiceId) {
    const sessionToken = await requestAnamSessionToken(apiKey, {
      name: published.name || 'Camille',
      avatarId: published.avatarId,
      voiceId: published.voiceId,
      llmId: 'CUSTOMER_CLIENT_V1',
      languageCode: 'nl-BE',
      directorNotes: {
        customStylePrompt: 'Calm, composed, attentive, natural eye contact, subtle facial movement, understated confidence.',
        expressivity: 0.28
      }
    });

    return {
      sessionToken,
      mode: 'custom-llm',
      source: 'published-persona-resolved'
    };
  }

  try {
    const sessionToken = await requestAnamSessionToken(apiKey, {
      personaId,
      llmId: 'CUSTOMER_CLIENT_V1'
    });

    return {
      sessionToken,
      mode: 'custom-llm',
      source: 'published-persona-override'
    };
  } catch (error) {
    console.warn('Anam persona custom-LLM override was not accepted:', error?.message || error);
  }

  if (process.env.ANAM_VOICE_ID) {
    try {
      const sessionToken = await requestAnamSessionToken(apiKey, {
        name: 'Camille',
        avatarId: personaId,
        voiceId: process.env.ANAM_VOICE_ID,
        llmId: 'CUSTOMER_CLIENT_V1',
        languageCode: 'nl-BE'
      });

      return {
        sessionToken,
        mode: 'custom-llm',
        source: 'avatar-id-with-voice-env'
      };
    } catch (error) {
      console.warn('Anam avatar-id fallback was not accepted:', error?.message || error);
    }
  }

  const sessionToken = await requestAnamSessionToken(apiKey, { personaId });
  return {
    sessionToken,
    mode: 'published-persona',
    source: 'published-persona-default'
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
    console.error('Anam session error:', error?.detail || error);
    return res.status(error?.status || 500).json({
      error: 'Could not create the Anam session.'
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
      apiKey: Boolean(apiKey),
      personaId: Boolean(personaId)
    });
  }

  try {
    const published = await resolvePublishedPersona(apiKey, personaId);
    return res.json({
      ok: true,
      configured: true,
      personaResolved: Boolean(published),
      avatarResolved: Boolean(published?.avatarId),
      voiceResolved: Boolean(published?.voiceId),
      customLlmReady: Boolean(published?.avatarId && published?.voiceId)
    });
  } catch (error) {
    console.error('Anam health error:', error);
    return res.status(502).json({
      ok: false,
      configured: true,
      apiReachable: false
    });
  }
});

app.post('/chat', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).send('OPENAI_API_KEY is missing on the server.');
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const mode = req.body?.mode || 'natural';
  const correctionLevel = req.body?.correctionLevel || 'medium';
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
      content: '[Conversation start] Start the conversation yourself now. Pick one practical Flemish topic or one topic from my real life. Use one or two short sentences and one easy question. Do not explain grammar.'
    });
  }

  const systemPrompt = [
    tutorInstructions,
    modeInstruction(mode),
    correctionInstruction(correctionLevel)
  ].join(' ');

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
        temperature: 0.65,
        max_tokens: 140
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
              text: 'Translate spoken Belgian Dutch/Flemish to clear natural English for subtitles. Keep it concise. Return only the English translation.'
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
      console.error('Translation error:', data);
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
