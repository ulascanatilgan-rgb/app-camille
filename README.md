# Camille — Flemish Agent for Ulas Atilgan

Camille is a practical spoken-Flemish conversation PWA with a six-month goal: help Ulas communicate comfortably with people in Flanders in everyday life, work and business.

## Current architecture

- **Anam** provides the live avatar, microphone input, speech recognition and voice.
- A published Anam Persona ID is exchanged server-side for a short-lived session token.
- **OpenAI** provides live English subtitle translation, vocabulary extraction, and the custom-LLM path when enabled.
- API keys stay on Railway and are never exposed to the browser.

## Learning experience

- Default difficulty is **Level 2 / A2**.
- A 1–5 horizontal level control changes how short, simple and slow Camille should speak.
- The selected level is injected into the live Anam session with runtime context.
- Level 1–2 strongly favor short clauses, common Flemish patterns, slower pacing and one question at a time.
- English can be used as a temporary bridge when Ulas is stuck.
- The live Dutch subtitle highlights the most recent spoken word/chunk.
- English subtitles update during speech rather than only at the end.
- One useful Dutch word is selected from each completed sentence and shown under the avatar with its English meaning.

## History and vocabulary

- **History** stores conversation sessions by date and displays saved turns.
- **Words** stores learned Dutch → English vocabulary.
- Both are stored locally in the browser with `localStorage`, so they persist across normal app restarts on the same browser/device.
- Stored history is capped to recent sessions and vocabulary to recent learned words to keep browser storage bounded.

## Railway environment variables

```text
OPENAI_API_KEY=...
ANAM_API_KEY=...
ANAM_PERSONA_ID=...
```

Do not commit API keys to GitHub.

## Health checks

- `/health`
- `/anam-health`

## Deployment

Railway redeploys automatically after changes reach `main`.
