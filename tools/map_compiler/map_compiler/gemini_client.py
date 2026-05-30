from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Iterable, Optional

from google import genai
from google.genai import errors


@dataclass
class GeminiConfig:
    model: str = "gemini-1.5-flash"
    api_key_env: str = "GEMINI_API_KEY"
    model_env: str = "GEMINI_MODEL"


class GeminiClient:
    def __init__(self, config: Optional[GeminiConfig] = None):
        self.config = config or GeminiConfig()
        api_key = os.getenv(self.config.api_key_env)
        if not api_key:
            raise RuntimeError(
                f"Missing Gemini API key. Set env var {self.config.api_key_env}."
            )
        self._client = genai.Client(api_key=api_key)

        model_name = os.getenv(self.config.model_env) or self.config.model
        self._model_name = self._resolve_model_name(model_name)

    def _resolve_model_name(self, requested: str) -> str:
        # google-genai model names can vary by project/API version. We list models and
        # pick one that explicitly supports generateContent.
        req_raw = (requested or "").strip()
        req = req_raw.removeprefix("models/")

        try:
            models = list(self._client.models.list())
        except Exception:
            # If we can't list models, fall back to the requested name.
            return req or "gemini-1.5-flash"

        supported: list[str] = []
        for m in models:
            name = getattr(m, "name", None)
            methods = getattr(m, "supported_generation_methods", None)
            if not isinstance(name, str) or not name:
                continue
            if isinstance(methods, (list, tuple)) and "generateContent" in methods:
                supported.append(name.removeprefix("models/"))

        # Never auto-select 2.0 models (your quota is 0); only allow if explicitly requested.
        supported_non2 = [n for n in supported if not n.startswith("gemini-2.")]

        def _is_supported(name: str) -> bool:
            nm = name.removeprefix("models/")
            return nm in supported

        if req and _is_supported(req):
            return req

        # If user explicitly requested a model but it isn't supported, fall back to best available.
        # Prefer flash over pro, and newest variants if present.
        preference_prefixes = [
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        ]
        for pref in preference_prefixes:
            exact = [n for n in supported_non2 if n == pref]
            if exact:
                return exact[0]
            variants = [n for n in supported_non2 if n.startswith(pref)]
            if variants:
                # heuristically pick a "latest" if present, else first variant
                for v in variants:
                    if "latest" in v:
                        return v
                return sorted(variants)[0]

        if supported_non2:
            return supported_non2[0]

        if supported:
            # Only remaining models are 2.0; return something so the error is explicit.
            return supported[0]

        return req or "gemini-1.5-flash"

    def generate_json(self, *, system: str, user: str, images: Optional[Iterable[bytes]] = None) -> str:
        contents: list[Any] = []
        prompt = f"SYSTEM:\n{system}\n\nUSER:\n{user}"
        contents.append(prompt)

        if images:
            for img in images:
                contents.append({"inline_data": {"mime_type": "image/png", "data": img}})

        fallback_models = [
            self._model_name,
            "gemini-1.5-flash",
            "gemini-1.5-pro",
        ]
        tried: set[str] = set()

        last_err: Exception | None = None
        resp = None
        last_model: str | None = None
        for model in fallback_models:
            if not model or model in tried:
                continue
            if model.startswith("gemini-2."):
                continue
            tried.add(model)
            last_model = model
            try:
                resp = self._client.models.generate_content(model=model, contents=contents)
                last_err = None
                break
            except errors.ClientError as e:
                last_err = e
                if getattr(e, "status_code", None) == 429:
                    continue
                raise

        if resp is None:
            if last_err is not None:
                if isinstance(last_err, errors.ClientError) and getattr(last_err, "status_code", None) == 429:
                    raise RuntimeError(
                        f"Gemini quota exhausted (429) for model={last_model}. "
                        "Try waiting and retry, or set GEMINI_MODEL=gemini-1.5-flash."
                    ) from last_err
                raise last_err
            raise RuntimeError("Gemini request failed with no response.")

        text = getattr(resp, "text", None)
        if isinstance(text, str) and text.strip():
            return text

        finish_reason = None
        candidates = getattr(resp, "candidates", None)
        if isinstance(candidates, list) and len(candidates) > 0:
            finish_reason = getattr(candidates[0], "finish_reason", None)

        if str(finish_reason) == "4" or str(finish_reason).lower() in ("safety", "recitation"):
            raise RuntimeError(
                "Gemini output blocked (finish_reason=4). Laborer cannot return verbatim text; "
                "rerun with non-verbatim/stub mode."
            )

        raise RuntimeError(f"Gemini returned no text output (finish_reason={finish_reason}).")
