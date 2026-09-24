# Camille — French Agent for Ulas Atilgan

Live-avatar PWA build.

## What changed

- Simli live avatar replaces the old fake photo-frame mouth animation
- Simli API key stays on Railway; the browser receives only a short-lived Simli session token
- Existing Simli face is selected through `SIMLI_FACE_ID`
- OpenAI Realtime remains on `gpt-realtime-2.1-mini`
- Camille now speaks in short, slow A1-A2 French
- She asks one question at a time
- She corrects one important mistake at a time and gives the correct French form
- French subtitles remain white; English subtitles remain light blue
- PWA cache bumped for the live-avatar release

## Railway environment variables

```text
OPENAI_API_KEY=...
SIMLI_API_KEY=...
SIMLI_FACE_ID=d2a5c7c6-fed9-4f55-bcb3-062f7cd20103
```

Do not commit API keys to GitHub.

## Deployment

Railway should redeploy automatically after changes reach `main`.
