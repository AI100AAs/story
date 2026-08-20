import { requestJson } from "../api.js";

function bootstrap() {
  const runtime = window.GizmoAppRuntime;
  if (!runtime) {
    throw new Error("The shared app runtime did not load.");
  }
  runtime.readConfig();
  const config = runtime.readConfig();
  const form = document.querySelector("#story-form");
  const topicInput = document.querySelector("#topic");
  const status = document.querySelector("#status");
  const result = document.querySelector("#story-result");
  const storyText = document.querySelector("#story-text");
  const storyTitle = document.querySelector("#story-title");
  const listen = document.querySelector("#listen");
  const themeToggle = document.querySelector("#theme-toggle");
  const editForm = document.querySelector("#edit-form");
  const editRequest = document.querySelector("#edit-request");
  const submitButton = form.querySelector("button[type=submit]");
  const editButton = editForm.querySelector("button[type=submit]");
  const surpriseButton = document.querySelector("#surprise-me");
  let story = "";
  let speech = null;

  const storyTemplates = [
    "a tiny whale who is afraid of the ocean",
    "a fox who finds a door in the moon",
    "a shy cloud learning to make rainbows",
    "a garden where the vegetables can sing",
    "a penguin who opens a seaside library",
    "a little robot who collects beautiful sounds",
    "a dragon who only sneezes bubbles",
    "a squirrel who discovers a map inside an acorn",
  ];
  const templateLabels = [
    "a moon-door fox",
    "a shy rainbow cloud",
    "a singing garden",
    "a seaside penguin library",
    "a sound-collecting robot",
    "a bubble-sneezing dragon",
  ];

  themeToggle.addEventListener("click", () => {
    const dark = document.body.toggleAttribute("data-dark");
    themeToggle.setAttribute("aria-pressed", String(dark));
    themeToggle.querySelector("span:last-child").textContent = dark ? "Light mode" : "Dark mode";
  });

  function setStatus(message, error = false) {
    status.textContent = message;
    status.className = `status${error ? " is-error" : ""}`;
    status.hidden = !message;
  }

  function clearMedia() {
    if (speech) window.speechSynthesis?.cancel();
    speech = null;
    document.querySelector("#media-note").textContent = "";
    listen.textContent = "▶ Read it aloud";
  }
  function prepareSpeech() {
    const supported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    listen.disabled = !supported;
    document.querySelector("#media-note").textContent = supported
      ? "Your browser will read the story aloud."
      : "Speech playback is not supported in this browser.";
  }

  function storyOptions() {
    return {
      ageRange: document.querySelector("#age-range").value,
      theme: document.querySelector("#story-theme").value,
      length: document.querySelector("#story-length").value,
      characterName: document.querySelector("#character-name").value.trim(),
    };
  }

  async function generateStory(payload, editing = false) {
    submitButton.disabled = true;
    editButton.disabled = true;
    if (!editing) result.hidden = true;
    setStatus(editing ? "Your storyteller is polishing the story..." : "Your storyteller is gathering a little magic...");
    if (!editing) clearMedia();
    try {
      const response = await requestJson(`${config.apiBase}/story`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), timeoutMs: 30000 });
      clearMedia();
      story = response.story;
      storyTitle.textContent = payload.topic;
      storyText.innerHTML = story.split(/\n+/).filter(Boolean).map((paragraph) => `<p>${paragraph.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]))}</p>`).join("");
      result.hidden = false;
      prepareSpeech();
      setStatus("The story is ready. Your browser can read it aloud.");
      editRequest.value = "";
      setStatus("");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      submitButton.disabled = false;
      editButton.disabled = false;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const topic = topicInput.value.trim();
    if (topic) await generateStory({ topic, ...storyOptions() });
  });

  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const request = editRequest.value.trim();
    if (request && story) await generateStory({ topic: topicInput.value.trim(), existingStory: story, editRequest: request, ...storyOptions() }, true);
  });
  function shuffleTemplates() {
    const shuffled = [...storyTemplates].sort(() => Math.random() - 0.5);
    document.querySelectorAll("[data-topic]").forEach((button, index) => {
      button.dataset.topic = shuffled[index];
      button.textContent = templateLabels[index];
    });
  }

  shuffleTemplates();
  document.querySelectorAll("[data-topic]").forEach((button) => button.addEventListener("click", () => { topicInput.value = button.dataset.topic; topicInput.focus(); }));
  surpriseButton.addEventListener("click", () => {
    topicInput.value = storyTemplates[Math.floor(Math.random() * storyTemplates.length)];
    document.querySelector("#age-range").value = ["3-5", "6-8", "9-12"][Math.floor(Math.random() * 3)];
    document.querySelector("#story-theme").value = ["cozy", "funny", "adventurous", "magical"][Math.floor(Math.random() * 4)];
    document.querySelector("#story-length").value = ["short", "medium", "long"][Math.floor(Math.random() * 3)];
    document.querySelector("#character-name").value = ["Milo", "Luna", "Pip", "Nia", "Sol"][Math.floor(Math.random() * 5)];
    setStatus("A surprise story setup is ready. Change anything you like, then begin.");
    topicInput.focus();
  });
  document.querySelector("#new-story").addEventListener("click", () => { clearMedia(); result.hidden = true; editRequest.value = ""; topicInput.focus(); });
  listen.addEventListener("click", () => {
    if (!("speechSynthesis" in window && "SpeechSynthesisUtterance" in window)) return;
    if (speech) {
      window.speechSynthesis.cancel();
      speech = null;
      listen.textContent = "▶ Read it aloud";
      document.querySelector("#media-note").textContent = "Paused. Press the button to start again.";
      return;
    }
    speech = new SpeechSynthesisUtterance(story);
    speech.rate = 0.95;
    speech.pitch = 1.05;
    speech.onstart = () => {
      listen.textContent = "■ Stop reading";
      document.querySelector("#media-note").textContent = "Reading with your browser's voice...";
    };
     speech.onend = () => {
       speech = null;
       listen.textContent = "▶ Read it aloud";
       document.querySelector("#media-note").textContent = "Ready when you are.";
     };
    speech.onerror = () => {
      speech = null;
      listen.textContent = "▶ Read it aloud";
      document.querySelector("#media-note").textContent = "Speech playback stopped. Press the button to try again.";
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(speech);
  });
  runtime.markReady();
}


try {
  bootstrap();
} catch (error) {
  window.GizmoAppRuntime?.showFatalError(error);
}
