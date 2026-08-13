# WonderTales

WonderTales is a friendly story-making app for curious children. A reader
chooses a topic and a few story ingredients, then the app uses the course AI
model to write an original, age-appropriate adventure. Each story can also
receive a generated picture and can be read aloud using the browser's built-in
speech engine.

The project was developed as a sample project for [UBC AI 100: Introduction to
Artificial Intelligence](https://www.cs.ubc.ca/~kevinlb/teaching/ai100/).

## What It Does

- Accepts a free-form story idea or a suggested idea.
- Supports age ranges `3-5`, `6-8`, and `9-12`.
- Supports cozy, funny, adventurous, and magical moods.
- Supports short, medium, and long stories.
- Lets the reader provide a main character name.
- Offers a Surprise me setup for quickly creating a combination of choices.
- Generates a complete story through the app's AI route.
- Generates a whimsical, text-free illustration through the course media route.
- Keeps the story available when illustration generation fails and offers a
  retry button.
- Lets the reader request a revision, such as a funnier ending or a new
  character.
- Reads the current story aloud with `window.speechSynthesis`, so no server TTS
  engine or audio file is required.
- Includes light and dark display modes and a responsive mobile layout.

## User Flow

1. Enter a topic or choose a suggested idea.
2. Select the age range, mood, length, and optional character name.
3. Select **Begin story**.
4. Read the generated story while its illustration is prepared.
5. Use **Read it aloud** to start or stop browser speech.
6. Use **Revise story** to ask for a change, or **Start another** to begin
   again.

Story generation is independent from illustration generation. If the hosted
image worker is unavailable, the written story remains usable and the reader
can try the illustration again later.

## Project Structure

```text
server/gizmoapp_server/
  api.py                         Story, revision, and image API routes
  llm.py                         Course AI model helper
  media.py                       Course image-service helper
  templates/index_text.html      WonderTales page structure
  static/app/text/main.js        Story workflow and browser speech
  static/app/text/styles.css     Responsive WonderTales styling
  static/app/api.js              Prefix-aware browser API requests
tests/                           Python and route tests
deploy/app-shell.txt             Hosted shell selection (`text`)
```

The app uses Flask and the existing GizmoApp runtime for serving the page and
assets. It intentionally has no frontend build step or Node dependency.

## Requirements

- Python 3.11 or newer
- Flask dependencies listed in `server/requirements.txt`
- Course AI credentials at runtime for story generation:
  `GIZMO_LLM_API_KEY`, `GIZMO_LLM_BASE_URL`, and `GIZMO_LLM_MODEL`
- Course media credentials at runtime for illustrations:
  `GIZMO_MEDIA_BASE_URL`, `GIZMO_MEDIA_API_KEY`, and
  `GIZMO_MEDIA_OPERATIONS`
- A browser with Web Speech API support for narration

The platform supplies the AI and media credentials. They must never be placed
in HTML, JavaScript, the database, logs, or committed files. Browser narration
does not require media credentials.

## Run Locally

Install the Python dependencies in an approved shell:

```bash
ALLOW_NETWORK_INSTALL=1 make install
```

Initialize the local SQLite data directory:

```bash
make init-db
```

Start the text shell:

```bash
ALLOW_SERVER_RUN=1 make dev-text
```

The default local address is `http://127.0.0.1:8001/`. A path prefix can be
tested with `GIZMOAPP_URL_PREFIX=/wondertales`.

## Validation

Run the repository validation pass before handing the project off:

```bash
make validate
```

This runs the Python test suite and the build-free JavaScript structural checks.
Node is not required.

## API Routes

All routes respect `GIZMOAPP_URL_PREFIX` when one is configured.

- `POST /api/story` creates a story or revises an existing story.
- `POST /api/media/image` requests an illustration for a story topic.
- `GET /healthz` checks process liveness.
- `GET /readyz` checks SQLite readiness.
- `GET /api/bootstrap` returns app runtime metadata.

Story requests include `topic`, `ageRange`, `theme`, `length`, and optional
`characterName`. Revision requests additionally include `existingStory` and
`editRequest`.

## Service Limitations

Story generation depends on the hosted course AI service. Illustration
generation depends on a separate hosted media worker, which can be busy,
unavailable, or absent outside the course platform. The UI treats that as a
recoverable illustration error rather than discarding the story.

Speech playback is intentionally handled by the user's browser. Available
voices, pronunciation, and support vary by browser and operating system.

## Handoff Notes

The public shell is set to `text` in `deploy/app-shell.txt`. The public page
contains only the WonderTales experience; administrative and starter routes are
not part of the reader-facing workflow. The workspace may contain unrelated
local configuration changes, which should be reviewed separately before a
final commit.
