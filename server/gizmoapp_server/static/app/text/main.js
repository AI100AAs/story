import { requestJson, requestMedia } from "../api.js";

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
  const illustration = document.querySelector("#illustration");
  const placeholder = document.querySelector("#image-placeholder");
  const listen = document.querySelector("#listen");
  const narration = document.querySelector("#narration");
  const themeToggle = document.querySelector("#theme-toggle");
  const editForm = document.querySelector("#edit-form");
  const editRequest = document.querySelector("#edit-request");
  const submitButton = form.querySelector("button[type=submit]");
  const editButton = editForm.querySelector("button[type=submit]");
  const surpriseButton = document.querySelector("#surprise-me");
  let story = "";
  let imageUrl = null;
  let audioUrl = null;

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
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    imageUrl = audioUrl = null;
    illustration.hidden = true;
    placeholder.hidden = false;
    placeholder.querySelector("small").textContent = "Your illustration will appear here";
    narration.removeAttribute("src");
    narration.hidden = true;
    document.querySelector("#media-note").textContent = "";
  }

  async function generateMedia(text, topic) {
    let imageReady = false;
    let nextImageUrl = null;
    // The course media worker is shared by image and speech jobs; do not submit
    // both GPU requests at once or the worker can reject either request.
    try {
      setProgress(20, "Painting the illustration...");
      const image = await requestMedia(`${config.apiBase}/media/image`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: `A warm, whimsical children's book illustration about ${topic}. No text.`, }) });
      nextImageUrl = URL.createObjectURL(image);
      await new Promise((resolve, reject) => {
        illustration.onload = resolve;
        illustration.onerror = () => reject(new Error("The illustration could not be displayed."));
        illustration.src = nextImageUrl;
      });
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = nextImageUrl;
      illustration.hidden = false;
      placeholder.hidden = true;
      imageReady = true;
      setProgress(55, "Illustration ready. Recording narration...");
    } catch (error) {
      if (nextImageUrl) URL.revokeObjectURL(nextImageUrl);
      illustration.removeAttribute("src");
      placeholder.querySelector("small").textContent = `Illustration unavailable: ${error.message}`;
    }
    try {
      const audio = await requestMedia(`${config.apiBase}/media/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      audioUrl = URL.createObjectURL(audio);
      narration.src = audioUrl;
      narration.hidden = false;
      listen.disabled = false;
      setProgress(100, "Your story is ready to explore.");
    } catch (error) {
      document.querySelector("#media-note").textContent = `Audio unavailable: ${error.message}`;
      setProgress(100, `${imageReady ? "Illustration ready." : "Illustration unavailable."} Narration unavailable.`);
    }
  }

  function setProgress(value, label) {
    const progress = document.querySelector("#media-progress");
    progress.value = value;
    progress.parentElement.querySelector("span").textContent = label;
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
    result.hidden = true;
    setStatus(editing ? "Your storyteller is polishing the story..." : "Your storyteller is gathering a little magic...");
    clearMedia();
    try {
      const response = await requestJson(`${config.apiBase}/story`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), timeoutMs: 30000 });
      story = response.story;
      storyTitle.textContent = payload.topic;
      storyText.innerHTML = story.split(/\n+/).filter(Boolean).map((paragraph) => `<p>${paragraph.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]))}</p>`).join("");
      result.hidden = false;
      setProgress(10, "Story written. Preparing the media...");
      setStatus("The story is ready. Your illustration and narration are on their way...");
      listen.disabled = true;
      await generateMedia(story, payload.topic);
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
  listen.addEventListener("click", () => { narration.play(); });
  runtime.markReady();
}


try {
  bootstrap();
} catch (error) {
  window.GizmoAppRuntime?.showFatalError(error);
}
