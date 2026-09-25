import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = process.env.PORT || 3000;

app.use(express.text({ type: ['application/sdp', 'text/plain'] }));
app.use(express.json());
app.use(express.static(__dirname));

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
  "A natural correction can be: 'Kleine correctie: [his phrase] → [better phrase].' Or: 'Je kan ook zeggen: [natural phrase].' Or: 'In Vlaanderen hoor je vaak: [common phrase].'",
  "Only occasionally add a very short English explanation when it genuinely helps. Keep English explanations to one short sentence.",
  "If Ulas says something understandable but unnatural, prefer a useful alternative over a technical grammar explanation.",
  "If he is stuck, quiet, gives a very short answer or has no topic, YOU take the lead. Start a simple conversation, tell him something, ask what he thinks, or propose a topic.",
  "Examples of proactive moves: 'Wat denk jij daarvan?', 'Zullen we het daar eens over hebben?', 'Ik heb een vraag voor jou.', 'Stel dat je morgen ...', or a short everyday scenario.",
  "Prioritize practical Flanders situations: greeting people, neighbours, shops, cafés, restaurants, appointments, phone calls, deliveries, tradespeople, asking for help, directions, transport, small talk, social plans, sports, weather, home, services, administration, work conversations, meetings, colleagues, networking, customers, suppliers and business follow-up.",
  "Use Ulas's real interests and life naturally when useful: he works at ING in IT, runs Hondinn dog hotel, plays padel, invests, lives around Kapellen/Antwerp, and is interested in business, cars and renovation. Do not mention all of these at once; use them as natural conversation topics.",
  "Teach compact communication: how to get things done with a few natural words and phrases, not how to produce perfect formal Dutch.",
  "When a practical phrase is useful, say it once clearly, give at most one easier or more Flemish alternative, then invite Ulas to use it.",
  "If Ulas cannot remember a Dutch word and switches to English, understand him normally. Immediately give the short Dutch/Flemish word or phrase he needs, then continue in Dutch.",
  "If Ulas asks a full question in English, understand it. Use English only for a very short clarification when needed, then steer him back to Flemish/Dutch.",
  "Never punish or stop the conversation because he used English. Treat English as a temporary bridge, not as the conversation language.",
  "Actively encourage him to say the idea again in Flemish when useful: for example, 'In het Vlaams kan je zeggen: ... Probeer eens.' Keep this very short.",
  "If he mixes English into a Dutch sentence, reply to the meaning first, supply the missing natural Dutch expression, and continue the conversation in Dutch.",
  "Avoid formal Netherlands-Dutch phrasing when an ordinary Flemish/Belgian Dutch expression would be more natural in daily life.",
  "Keep the tone relaxed, grounded, adult and natural, like a friendly Flemish woman talking over coffee rather than a teacher running a lesson."
].join(' ');

app.post('/session', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).send('OPENAI_API_KEY is missing on the server.');
  }

  const sessionConfig = JSON.stringify({
    type: 'realtime',
    model: 'gpt-realtime-2.1-mini',
    output_modalities: ['audio'],
    audio: {
      input: { turn_detection: { type: 'semantic_vad' } },
      output: { voice: 'marin' }
    },
    instructions: tutorInstructions
  });

  const fd = new FormData();
  fd.set('sdp', req.body);
  fd.set('session', sessionConfig);

  try {
    const safetyId = crypto.createHash('sha256').update('camille-local-user').digest('hex');
    const r = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
        'OpenAI-Safety-Identifier': safetyId
      },
      body: fd
    });

    const body = await r.text();
    if (!r.ok) {
      console.error(body);
      return res.status(r.status).send(body);
    }

    res.type('application/sdp').send(body);
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to create Realtime session.');
  }
});

app.post('/simli-session', async (_req, res) => {
  const apiKey = process.env.SIMLI_API_KEY;
  const faceId = process.env.SIMLI_FACE_ID;

  if (!apiKey || !faceId) {
    return res.status(500).json({ error: 'SIMLI_API_KEY or SIMLI_FACE_ID is missing on the server.' });
  }

  const config = {
    faceId,
    handleSilence: true,
    maxSessionLength: 3600,
    maxIdleTime: 600,
    model: 'fasttalk'
  };

  try {
    const [tokenResponse, iceResponse] = await Promise.all([
      fetch('https://api.simli.ai/compose/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-simli-api-key': apiKey
        },
        body: JSON.stringify(config)
      }),
      fetch('https://api.simli.ai/compose/ice', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-simli-api-key': apiKey
        }
      })
    ]);

    if (!tokenResponse.ok) {
      const detail = await tokenResponse.text();
      console.error('Simli token error:', detail);
      return res.status(tokenResponse.status).json({ error: 'Could not create Simli session.' });
    }

    const tokenData = await tokenResponse.json();
    let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];

    if (iceResponse.ok) {
      const data = await iceResponse.json();
      if (Array.isArray(data) && data.length) iceServers = data;
    }

    res.json({
      session_token: tokenData.session_token,
      ice_servers: iceServers
    });
  } catch (error) {
    console.error('Simli session error:', error);
    res.status(500).json({ error: 'Failed to create Simli session.' });
  }
});

app.get('/simli-health', async (_req, res) => {
  const apiKey = process.env.SIMLI_API_KEY;
  const faceId = process.env.SIMLI_FACE_ID;

  if (!apiKey || !faceId) {
    return res.status(500).json({
      ok: false,
      configured: false,
      error: 'Simli environment variables are missing.'
    });
  }

  try {
    const r = await fetch('https://api.simli.ai/compose/ice', {
      headers: {
        'Content-Type': 'application/json',
        'x-simli-api-key': apiKey
      }
    });

    return res.status(r.ok ? 200 : 502).json({
      ok: r.ok,
      configured: true,
      faceIdConfigured: Boolean(faceId),
      apiReachable: r.ok
    });
  } catch (error) {
    console.error('Simli health error:', error);
    return res.status(502).json({
      ok: false,
      configured: true,
      faceIdConfigured: Boolean(faceId),
      apiReachable: false
    });
  }
});

app.post('/translate', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is missing on the server.' });
  }

  const text = req.body?.text?.trim();
  if (!text) return res.json({ translation: '' });

  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: 'Translate spoken Belgian Dutch/Flemish to clear natural English for subtitles. Preserve any short English correction line as English. Keep it concise. Return only the English translation.'
            }]
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text }]
          }
        ]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error(data);
      return res.status(r.status).json({ error: 'Translation failed.' });
    }

    const translation = data.output_text || data.output?.[0]?.content?.[0]?.text || '';
    res.json({ translation });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Translation failed.' });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    openai: Boolean(process.env.OPENAI_API_KEY),
    simli: Boolean(process.env.SIMLI_API_KEY && process.env.SIMLI_FACE_ID)
  });
});

app.listen(port, () => {
  console.log('Camille is ready at http://localhost:' + port);
});
