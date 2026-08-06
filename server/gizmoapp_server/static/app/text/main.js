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
  let story = "";
  let imageUrl = null;
  let audioUrl = null;

  function setStatus(message, error = false) {
    status.textContent = message;
    status.className = `status${error ? " is-error" : ""}`;
    status.hidden = !message;
  }

  function clearMedia() {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    imageUrl = audioUrl = null;
  }

  async function generateMedia(text, topic) {
    // The course media worker is shared by image and speech jobs; do not submit
    // both GPU requests at once or the worker can reject either request.
    try {
      const image = await requestMedia(`${config.apiBase}/media/image`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: `A warm, whimsical children's book illustration about ${topic}. No text.`, }) });
      imageUrl = URL.createObjectURL(image);
      illustration.src = imageUrl;
      illustration.hidden = false;
      placeholder.hidden = true;
    } catch (error) {
      placeholder.querySelector("small").textContent = `Illustration unavailable: ${error.message}`;
    }
    try {
      const audio = await requestMedia(`${config.apiBase}/media/speech`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      audioUrl = URL.createObjectURL(audio);
      narration.src = audioUrl;
      narration.hidden = false;
      listen.disabled = false;
    } catch (error) {
      document.querySelector("#media-note").textContent = `Audio unavailable: ${error.message}`;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const topic = topicInput.value.trim();
    if (!topic) return;
    form.querySelector("button[type=submit]").disabled = true;
    result.hidden = true;
    setStatus("Your storyteller is gathering a little magic...");
    clearMedia();
    try {
      const payload = await requestJson(`${config.apiBase}/story`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic }), timeoutMs: 30000 });
      story = payload.story;
      storyTitle.textContent = topic;
      storyText.innerHTML = story.split(/\n+/).filter(Boolean).map((paragraph) => `<p>${paragraph.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]))}</p>`).join("");
      result.hidden = false;
      setStatus("The story is ready. Your illustration and narration are on their way...");
      listen.disabled = true;
      await generateMedia(story, topic);
      setStatus("");
    } catch (error) {
      setStatus(error.message, true);
    } finally {
      form.querySelector("button[type=submit]").disabled = false;
    }
  });
  document.querySelectorAll("[data-topic]").forEach((button) => button.addEventListener("click", () => { topicInput.value = button.dataset.topic; topicInput.focus(); }));
  document.querySelector("#new-story").addEventListener("click", () => { clearMedia(); result.hidden = true; topicInput.focus(); });
  listen.addEventListener("click", () => { narration.play(); });
  runtime.markReady();
}


try {
  bootstrap();
} catch (error) {
  window.GizmoAppRuntime?.showFatalError(error);
}
