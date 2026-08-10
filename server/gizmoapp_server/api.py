from __future__ import annotations

import math
import re
import secrets
import sqlite3
from datetime import UTC, datetime
from typing import Any

from flask import Flask, Response, current_app, g, jsonify, request
from werkzeug.exceptions import BadRequest, HTTPException, RequestEntityTooLarge, UnsupportedMediaType

from .capabilities import capability_payload
from .capabilities.audio import analyze_samples
from .capabilities.mapping import openstreetmap_config
from .capabilities.ml import run_kmeans, sklearn_status
from .capabilities.optimization import nearest_neighbor_route
from .capabilities.search import search_records
from .config import scoped_path
from .db import database_readiness, fetch_sample_nodes, get_db, insert_sample_node
from .llm import CourseLLMError, ask
from .media import CourseMediaError, generate_image

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
SLUG_RE = re.compile(r"^[a-z0-9-]{3,40}$")
MAX_LABEL_LENGTH = 120
MAX_DESCRIPTION_LENGTH = 2_000
MAX_SEARCH_QUERY_LENGTH = 200
MAX_STORY_TOPIC_LENGTH = 160
MAX_STORY_EDIT_LENGTH = 400
MAX_STORY_LENGTH = 20_000
STORY_AGE_RANGES = frozenset({"3-5", "6-8", "9-12"})
STORY_THEMES = frozenset({"cozy", "funny", "adventurous", "magical"})
STORY_LENGTHS = {"short": "3-4 short paragraphs, around 200-300 words", "medium": "5-7 short paragraphs, around 350-500 words", "long": "8-10 short paragraphs, around 600-750 words"}


def _health_payload() -> dict[str, Any]:
    return {
        "status": "ok",
        "serverTime": datetime.now(UTC).isoformat(),
    }


def _bootstrap_payload() -> dict[str, Any]:
    return {
        "app": {
            "name": current_app.config["APP_NAME"],
            "tagline": current_app.config["APP_TAGLINE"],
            "mode": "public",
            "shell": current_app.config["APP_SHELL"],
            "shellLabel": current_app.config["APP_SHELL_LABEL"],
        },
        "health": _health_payload(),
        "availableShells": current_app.config["AVAILABLE_SHELLS"],
    }


def _api_root() -> str:
    return scoped_path(current_app.config["URL_PREFIX"], "api").rstrip("/")


def _is_json_surface() -> bool:
    api_root = _api_root()
    return (
        request.path == api_root
        or request.path.startswith(f"{api_root}/")
        or request.path.endswith("/healthz")
        or request.path.endswith("/readyz")
        or request.path in {"/healthz", "/readyz"}
    )


def _error_response(message: str, status: int):
    return jsonify({"errors": [message], "requestId": getattr(g, "request_id", None)}), status


def _json_object() -> tuple[dict[str, Any] | None, tuple[Any, int] | None]:
    if not request.is_json:
        return None, _error_response("Content-Type must be application/json", 415)
    try:
        payload = request.get_json(silent=False)
    except (BadRequest, UnsupportedMediaType):
        return None, _error_response("Request body must contain valid JSON", 400)
    if not isinstance(payload, dict):
        return None, _error_response("JSON request body must be an object", 400)
    return payload, None


def _finite_number(payload: dict[str, Any], key: str, default: float) -> float:
    value = float(payload.get(key, default))
    if not math.isfinite(value):
        raise ValueError(f"{key} must be finite")
    return value


def _normalize_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    errors: list[str] = []
    raw_slug = payload.get("slug", "")
    raw_label = payload.get("label", "")
    raw_description = payload.get("description", "")
    raw_color = payload.get("accent_color", "#72d1c2")

    for name, value in (
        ("slug", raw_slug),
        ("label", raw_label),
        ("description", raw_description),
        ("accent_color", raw_color),
    ):
        if not isinstance(value, str):
            errors.append(f"{name} must be a string")

    cleaned = {
        "slug": raw_slug.strip() if isinstance(raw_slug, str) else "",
        "label": raw_label.strip() if isinstance(raw_label, str) else "",
        "description": raw_description.strip() if isinstance(raw_description, str) else "",
        "accent_color": raw_color.strip() if isinstance(raw_color, str) else "",
    }
    cleaned["description"] = cleaned["description"] or "Created through the sample API."

    if not SLUG_RE.fullmatch(cleaned["slug"]):
        errors.append("slug must be 3-40 characters of lowercase letters, digits, or hyphens")
    if len(cleaned["label"]) < 2 or len(cleaned["label"]) > MAX_LABEL_LENGTH:
        errors.append(f"label must be 2-{MAX_LABEL_LENGTH} characters")
    if len(cleaned["description"]) > MAX_DESCRIPTION_LENGTH:
        errors.append(f"description must be at most {MAX_DESCRIPTION_LENGTH} characters")
    if not HEX_COLOR_RE.fullmatch(cleaned["accent_color"]):
        errors.append("accent_color must be a 6-digit hex color like #72d1c2")

    try:
        cleaned["x"] = min(0.92, max(0.08, _finite_number(payload, "x", 0.5)))
        cleaned["y"] = min(0.92, max(0.08, _finite_number(payload, "y", 0.5)))
        cleaned["radius"] = min(0.2, max(0.06, _finite_number(payload, "radius", 0.11)))
    except (TypeError, ValueError, OverflowError):
        errors.append("x, y, and radius must be finite numbers")

    return cleaned, errors


def register_api_routes(app: Flask) -> None:
    prefix = app.config["URL_PREFIX"]
    enabled_features = frozenset(app.config["ENABLED_FEATURES"])

    @app.before_request
    def assign_request_id():
        g.request_id = secrets.token_hex(8)

    @app.after_request
    def harden_response(response):
        response.headers.setdefault("X-Request-ID", getattr(g, "request_id", ""))
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        return response

    @app.errorhandler(RequestEntityTooLarge)
    def request_too_large(_: RequestEntityTooLarge):
        if _is_json_surface():
            return _error_response("Request body is too large", 413)
        return "Request body is too large", 413

    @app.errorhandler(HTTPException)
    def http_error(error: HTTPException):
        if _is_json_surface():
            return _error_response(error.description or error.name, error.code or 500)
        return error

    @app.errorhandler(Exception)
    def unexpected_error(error: Exception):
        current_app.logger.exception("Unhandled request error")
        if _is_json_surface():
            return _error_response("The server could not complete the request", 500)
        return "The server could not complete the request", 500

    @app.get(scoped_path(prefix, "healthz"))
    def healthz():
        return jsonify(_health_payload())

    @app.get(scoped_path(prefix, "readyz"))
    def readyz():
        ready, detail = database_readiness(current_app.config)
        return jsonify({"status": "ready" if ready else "not-ready", **detail}), 200 if ready else 503

    @app.get(scoped_path(prefix, "api/bootstrap"))
    def bootstrap():
        return jsonify(_bootstrap_payload())

    @app.get(scoped_path(prefix, "api/capabilities"))
    def capabilities():
        api_base = scoped_path(prefix, "api").rstrip("/")
        return jsonify(capability_payload(api_base, enabled_features))

    @app.post(scoped_path(prefix, "api/story"))
    def story():
        payload, error = _json_object()
        if error:
            return error
        topic = payload.get("topic", "")
        if not isinstance(topic, str) or not topic.strip():
            return _error_response("topic must be non-empty text", 400)
        topic = topic.strip()
        if len(topic) > MAX_STORY_TOPIC_LENGTH:
            return _error_response(
                f"topic must be at most {MAX_STORY_TOPIC_LENGTH} characters", 400
            )
        age_range = payload.get("ageRange", "6-8")
        story_theme = payload.get("theme", "cozy")
        story_length = payload.get("length", "medium")
        character_name = payload.get("characterName", "")
        edit_request = payload.get("editRequest", "")
        existing_story = payload.get("existingStory", "")
        if age_range not in STORY_AGE_RANGES:
            return _error_response("ageRange must be 3-5, 6-8, or 9-12", 400)
        if story_theme not in STORY_THEMES:
            return _error_response("theme must be cozy, funny, adventurous, or magical", 400)
        if story_length not in STORY_LENGTHS:
            return _error_response("length must be short, medium, or long", 400)
        if not isinstance(character_name, str) or len(character_name.strip()) > 60:
            return _error_response("characterName must be at most 60 characters", 400)
        if not isinstance(edit_request, str) or len(edit_request.strip()) > MAX_STORY_EDIT_LENGTH:
            return _error_response(f"editRequest must be at most {MAX_STORY_EDIT_LENGTH} characters", 400)
        if not isinstance(existing_story, str) or len(existing_story) > MAX_STORY_LENGTH:
            return _error_response("existingStory is too long", 400)
        character_name = character_name.strip() or "a character with a fitting name"
        edit_request = edit_request.strip()
        existing_story = existing_story.strip()
        if edit_request and not existing_story:
            return _error_response("existingStory is required when requesting an edit", 400)
        length_guidance = STORY_LENGTHS[story_length]
        edit_guidance = (
            f"Revise the existing story below according to this reader request: {edit_request}\n"
            f"Existing story:\n{existing_story}\n"
            "Return the complete revised story, not commentary about the changes.\n"
            if edit_request else ""
        )
        prompt = (
            "You are a warm, imaginative children's storyteller. Write a gentle, "
            f"original bedtime story for children ages {age_range} about this topic: {topic}.\n"
            f"The story should feel {story_theme}, and its main character should be named {character_name}.\n"
            f"Keep it {length_guidance}, with a hopeful "
            "ending. Use simple, vivid language. Do not include a title, preface, "
            "moral, or notes outside the story. Avoid danger, frightening scenes, "
            f"violence, and unsafe instructions.\n\n{edit_guidance}"
        )
        try:
            text = ask(prompt, max_tokens=1200).strip()
        except CourseLLMError as exc:
            return _error_response(str(exc), 503)
        return jsonify({"topic": topic, "story": text})

    @app.post(scoped_path(prefix, "api/media/image"))
    def media_image():
        payload, error = _json_object()
        if error:
            return error
        prompt = payload.get("prompt", "")
        if not isinstance(prompt, str) or not prompt.strip():
            return _error_response("prompt must be non-empty text", 400)
        try:
            result = generate_image(prompt.strip(), model="lcm-sd15", steps=4)
        except CourseMediaError as exc:
            return _error_response(str(exc), 503)
        return Response(result.data, mimetype=result.content_type)

    if "search" in enabled_features:
        @app.get(scoped_path(prefix, "api/search"))
        def search():
            query = request.args.get("q", "")
            if len(query) > MAX_SEARCH_QUERY_LENGTH:
                return _error_response(f"q must be at most {MAX_SEARCH_QUERY_LENGTH} characters", 400)
            return jsonify(search_records(get_db(), query))

    if "mapping" in enabled_features:
        @app.get(scoped_path(prefix, "api/map/default"))
        def map_default():
            return jsonify(openstreetmap_config())

    if "machine-learning" in enabled_features:
        @app.get(scoped_path(prefix, "api/ml/status"))
        def ml_status():
            return jsonify(sklearn_status())

        @app.post(scoped_path(prefix, "api/ml/kmeans"))
        def ml_kmeans():
            payload, error = _json_object()
            if error:
                return error
            result, errors, status = run_kmeans(payload)
            if errors:
                return jsonify({"errors": errors, "requestId": g.request_id, **result}), status
            return jsonify(result)

    if "optimization" in enabled_features:
        @app.post(scoped_path(prefix, "api/optimize/route"))
        def optimize_route():
            payload, error = _json_object()
            if error:
                return error
            result, errors = nearest_neighbor_route(payload)
            if errors:
                return jsonify({"errors": errors, "requestId": g.request_id}), 400
            return jsonify(result)

    if "audio" in enabled_features:
        @app.post(scoped_path(prefix, "api/audio/analyze"))
        def audio_analyze():
            payload, error = _json_object()
            if error:
                return error
            result, errors = analyze_samples(payload)
            if errors:
                return jsonify({"errors": errors, "requestId": g.request_id}), 400
            return jsonify(result)

    if "sample-nodes" in enabled_features:
        @app.route(scoped_path(prefix, "api/sample-nodes"), methods=["GET", "POST"])
        def sample_nodes():
            connection = get_db()
            if request.method == "GET":
                return jsonify({"sampleNodes": fetch_sample_nodes(connection)})

            payload, error = _json_object()
            if error:
                return error
            cleaned, errors = _normalize_payload(payload)
            if errors:
                return jsonify({"errors": errors, "requestId": g.request_id}), 400

            try:
                record = insert_sample_node(connection, cleaned)
            except sqlite3.IntegrityError:
                return jsonify({"errors": ["slug already exists"], "requestId": g.request_id}), 409
            except sqlite3.OperationalError:
                current_app.logger.exception("Database write remained unavailable after retries")
                return _error_response("Database is temporarily busy; retry shortly", 503)

            return jsonify({"sampleNode": record}), 201

    @app.route(
        scoped_path(prefix, "api/<path:unmatched_path>"),
        methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    )
    def unknown_api_route(unmatched_path: str):
        return _error_response(f"Unknown or disabled API route: {unmatched_path}", 404)
