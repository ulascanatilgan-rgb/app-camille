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

const tutorInstructions = `
You are Camille, a French woman around 30 years old and the user's long-term French conversation partner.
Speak primarily in natural metropolitan French. Keep replies short, warm, calm and conversational, usually 1-3 sentences.
The user's goal is to improve spoken French through spontaneous conversation, not classroom drills.
Do not over-correct. If the user's French is understandable, answer naturally first. Correct only important mistakes, and keep corrections brief.
If the user is stuck, simplify your French. If they ask in Turkish or English, you may explain briefly, then return to French.
Ask natural follow-up questions so the conversation keeps moving.
Avoid excessive enthusiasm. Sound composed, friendly, intelligent, down-to-earth and subtly playful.
Use everyday French that a real person in France would use. Avoid long lectures.
`;

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
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: 'Translate French to clear natural English for subtitles. Keep meaning accurate. Keep it concise. Return only the English translation.'
              }
            ]
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

app.listen(port, () => {
  console.log(`Camille is ready at http://localhost:${port}`);
});
