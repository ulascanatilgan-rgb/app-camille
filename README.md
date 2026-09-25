# Camille — Flemish Agent for Ulas Atilgan

Camille is a practical spoken-Flemish conversation PWA with a six-month goal: help Ulas communicate comfortably with people in Flanders in everyday life, work and business.

## Current architecture

- **Anam** handles microphone input, speech recognition, voice synthesis and the live avatar video.
- **OpenAI** remains Camille's conversation brain when Anam can resolve the published persona's avatar and voice configuration.
- The browser receives only a short-lived Anam session token; the Anam API key stays on Railway.
- Camille streams OpenAI text into Anam's talk stream so the avatar can begin speaking before the whole response is finished.
- Live Dutch subtitles come from Anam's speech events; concise English translation appears underneath.

## Learning approach

- Current level: around A2
- Target: confident practical communication in Flanders within six months
- Spoken Belgian Dutch / Flemish, not textbook-heavy Dutch
- Clear informal je/jij by default, with useful Flemish alternatives only when relevant
- Short, high-frequency phrases and compact ways to get things done
- One question at a time
- One short useful correction when needed
- English is accepted as a temporary bridge when Ulas is stuck, then Camille guides him back to Flemish
- Camille proactively starts conversations and practical scenarios
- Natural personal topics can include ING/IT work, Hondinn, padel, investing, Kapellen/Antwerp, business, cars and renovation

## Conversation modes

- **Practical** — everyday spoken Flemish and useful scenarios
- **Coach** — slightly more correction and natural alternatives
- **Extra slow** — simpler wording and slower, shorter clauses

## Railway environment variables

```text
OPENAI_API_KEY=...
ANAM_API_KEY=...
ANAM_PERSONA_ID=...
```

Optional fallback when the supplied Anam ID is an avatar ID rather than a published persona ID:

```text
ANAM_VOICE_ID=...
```

Do not commit API keys to GitHub.

## Health checks

- `/health` confirms OpenAI and Anam variables are configured.
- `/anam-health` checks whether the published Anam persona can be resolved to an avatar and voice for custom-LLM mode.

## Deployment

Railway redeploys automatically after changes reach `main`.
