let config;
let spokenStory = null;

function setupTheme() {
  const toggle = document.getElementById("theme-toggle");
  toggle.addEventListener("click", () => {
    const dark = document.body.toggleAttribute("data-dark");
    toggle.setAttribute("aria-pressed", String(dark));
    toggle.querySelector("span:last-child").textContent = dark ? "Light mode" : "Dark mode";
  });
}

function showStatus(message, tone = "") {
  const status = document.getElementById("status-message");
  status.textContent = message;
  status.dataset.tone = tone;
}

async function post(path, body) {
  const response = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const payload = await response.json();
      message = payload.errors?.[0] || message;
    } catch (_) {
      // Keep the friendly fallback when a proxy returns a non-JSON error.
    }
    throw new Error(message);
  }
  return response;
}

function renderStory(topic, story) {
  const paragraphs = story.split(/\n+/).map((part) => part.trim()).filter(Boolean);
  const stage = document.getElementById("story-stage");
  stage.replaceChildren();
  const layout = document.createElement("div");
  layout.className = "story-layout";
  const article = document.createElement("article");
  article.className = "story-card";
  article.innerHTML = `<p class="story-kicker">A WonderTale about</p><h2>${escapeHtml(topic)}</h2><div class="story-copy"></div><div class="story-actions"><button class="listen-button" id="listen-button" type="button">◉ <span>Read it aloud</span></button><span class="audio-note" id="audio-note">Your browser will read this story aloud.</span><progress class="media-progress" id="audio-progress" max="100" value="0"></progress></div>`;
  const copy = article.querySelector(".story-copy");
  paragraphs.forEach((paragraph) => {
    const element = document.createElement("p");
    element.textContent = paragraph;
    copy.append(element);
  });
  layout.append(article);
  stage.append(layout);
}

function escapeHtml(value) {
  return value
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split("\"").join("&quot;")
    .split("'").join("&#39;");
}

function setupSpeech(story) {
  const button = document.getElementById("listen-button");
  const note = document.getElementById("audio-note");
  const supported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  button.disabled = !supported;
  note.textContent = supported ? "Ready when you are." : "Speech playback is not supported in this browser.";
  if (supported) {
    button.addEventListener("click", () => {
      if (spokenStory) {
        window.speechSynthesis.cancel();
        spokenStory = null;
        button.querySelector("span").textContent = "Read it aloud";
        note.textContent = "Paused. Press the button to start again.";
        return;
      }
      spokenStory = new SpeechSynthesisUtterance(story);
      spokenStory.rate = 0.95;
      spokenStory.pitch = 1.05;
      spokenStory.onstart = () => {
        button.querySelector("span").textContent = "Stop reading";
        note.textContent = "Reading with your browser's voice...";
      };
      spokenStory.onend = () => {
        spokenStory = null;
        button.querySelector("span").textContent = "Read it aloud";
        note.textContent = "Ready when you are.";
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(spokenStory);
    });
  }
}

async function createStory(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.getElementById("create-button");
  const topic = new FormData(form).get("topic").trim();
  if (!topic) return;
  button.disabled = true;
  button.querySelector("span").textContent = "Writing...";
  showStatus("Finding the first sentence...");
  try {
    const response = await post("/story", { topic });
    const payload = await response.json();
    if (spokenStory) {
      window.speechSynthesis.cancel();
      spokenStory = null;
    }
    renderStory(payload.topic, payload.story);
    setupSpeech(payload.story);
    showStatus("Your story is ready. Your browser can read it aloud.");
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.querySelector("span").textContent = "Make my story";
  }
}

function bootstrap() {
  const runtime = window.GizmoAppRuntime;
  if (!runtime) throw new Error("The shared app runtime did not load.");
  config = runtime.readConfig();
  setupTheme();
  document.getElementById("story-form").addEventListener("submit", createStory);
  runtime.markReady();
}

try { bootstrap(); } catch (error) { window.GizmoAppRuntime?.showFatalError(error); }
