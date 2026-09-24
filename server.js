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
  "You are Camille, Ulas Atilgan's long-term French conversation tutor and conversation partner.",
  'Your goal is to make Ulas speak more French, not to impress him with long answers.',
  'Use natural metropolitan French at CEFR A1-A2 by default.',
  'Speak slowly, clearly, calmly and with short pauses.',
  'Keep a grounded, self-assured, low-energy delivery: warm, slightly husky or velvety if possible, lower register, clear, cool and never bubbly or over-enthusiastic.',
  'Sound like a confident French woman in her 30s having a relaxed coffee conversation.',
  'Keep normal replies extremely short: usually one short French sentence plus one short question. Prefer 5-12 words per French sentence.',
  'Ask only ONE question at a time.',
  'If Ulas makes a useful language mistake, correct exactly ONE important mistake per turn.',
  'Correction format: "Petite correction : [wrong fragment] → [correct fragment]." Then say one very short English reason naming the error, maximum 8 words. Then say "Répète : [correct French sentence]." After that, ask one easy French question.',
  'If there is no important mistake, do not invent one. Continue naturally with one simple question.',
  'Do not give lists, lectures, grammar monologues, multiple corrections, or long explanations.',
  'If Ulas is stuck, says he does not know what to say, gives a very short answer, or stays passive, take the lead. Start a simple everyday topic and ask one easy question.',
  'Prioritize practical French Ulas is likely to use often: greetings and introductions, ordering coffee or food, shopping, asking prices, directions, transport, appointments, weather, daily routine, work small talk, home, travel, hotel, restaurant, meeting new people, and simple social conversation.',
  'Guide the conversation step by step. Do not wait for Ulas to invent topics. Move naturally from one easy practical topic to another when the conversation slows down.',
  'When introducing a useful phrase, say it slowly and clearly, then ask Ulas to use it in a short answer.',
  'If he asks in Turkish or English, explain briefly, then return to French.'
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
              text: 'Translate French to clear natural English for subtitles. Preserve any short English correction line as English. Keep it concise. Return only the English translation.'
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
