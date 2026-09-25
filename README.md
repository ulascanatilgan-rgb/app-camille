# Camille — Flemish Agent for Ulas Atilgan

A practical spoken-Flemish conversation PWA with a six-month goal: help Ulas communicate comfortably with people in Flanders in everyday life, work and business.

## Learning approach

- Current level: around A2
- Target: confident practical conversation, progressing toward B1/B2-style speaking
- Focus on Belgian Dutch / Flemish used in real life, not textbook-heavy Dutch
- Clear informal `je/jij` as the default, with common Flemish alternatives introduced only when useful
- Short, high-frequency phrases and compact ways to get things done
- One question at a time
- Short corrections: usually one useful point only
- Occasional very short English explanation when it helps
- Camille proactively starts conversations and introduces scenarios when Ulas is quiet or stuck
- Personal topics can include ING/IT work, Hondinn, padel, investing, Kapellen/Antwerp, business, cars and renovation
- Browser speech recognition uses `nl-BE`
- English subtitles translate spoken Belgian Dutch/Flemish

## Conversation modes

- **Practical** — default; everyday spoken Flemish and useful scenarios
- **Coach** — slightly more correction and natural alternatives
- **Extra slow** — simpler wording and slower, shorter clauses

## Railway environment variables

```text
OPENAI_API_KEY=...
SIMLI_API_KEY=...
SIMLI_FACE_ID=...
```

Do not commit API keys to GitHub.

## Deployment

Railway redeploys automatically after changes reach `main`.
