#!/usr/bin/env python3
"""Generate release notes from git commits between the previous tag and TAG.

Sections: New Features (feat:) and Fixed (fix:). Commits are first deduped by
normalized description (case-insensitive). If ANTHROPIC_API_KEY is set, similar
commits are then fuzzy-merged via Claude (Opus 4.7, adaptive thinking).

Non-conventional commits are skipped — add a feat:/fix: prefix to include them.
"""
import os
import re
import subprocess
import sys
from collections import OrderedDict


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs).strip()


TAG = os.environ.get("TAG") or run("git", "describe", "--tags", "--abbrev=0")

try:
    PREV = run("git", "describe", "--tags", "--abbrev=0", f"{TAG}^", stderr=subprocess.DEVNULL)
except subprocess.CalledProcessError:
    PREV = None  # no previous tag; use all history reachable from TAG

range_spec = f"{PREV}..{TAG}" if PREV else TAG
log = run("git", "log", range_spec, "--pretty=format:%s")

TYPE_RE = re.compile(r"^(feat|fix)(\([^)]+\))?!?:\s*(.+)$", re.IGNORECASE)

feats: "OrderedDict[str, str]" = OrderedDict()
fixes: "OrderedDict[str, str]" = OrderedDict()
for subject in (s.strip() for s in log.splitlines() if s.strip()):
    m = TYPE_RE.match(subject)
    if not m:
        continue
    typ = m.group(1).lower()
    desc = m.group(3).strip()
    key = desc.lower()
    if typ == "feat":
        feats.setdefault(key, desc)
    elif typ == "fix":
        fixes.setdefault(key, desc)


def merge_with_llm(title: str, items: list) -> list:
    """Fuzzy-merge similar commit descriptions via a custom LLM provider. Falls back to input on any failure."""
    base_url = os.environ.get("LLM_BASE_URL")
    api_key = os.environ.get("LLM_API_KEY")
    model = os.environ.get("LLM_MODEL")
    if not (base_url and api_key and model):
        print(f"[{title}] LLM skipped — LLM_BASE_URL/LLM_API_KEY/LLM_MODEL not set; using exact dedup ({len(items)} items)", file=sys.stderr)
        return items
    if len(items) <= 1:
        print(f"[{title}] LLM skipped — {len(items)} item only", file=sys.stderr)
        return items
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key, base_url=base_url)
        numbered = "\n".join(f"{i+1}. {d}" for i, d in enumerate(items))
        prompt = (
            "Merge similar commit subjects for release notes. Group subjects "
            "describing the same logical change into one bullet. Preserve "
            "original wording where possible; combine differing specifics in "
            "parentheses. Output: markdown bullet list only, no preamble.\n\n"
            f"Subjects:\n{numbered}"
        )
        resp = client.messages.create(
            model=model,
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
        bullets = [
            line[2:].strip()
            for line in text.splitlines()
            if line.strip().startswith(("- ", "* "))
        ]
        if bullets:
            print(f"[{title}] LLM merged {len(items)} → {len(bullets)} bullets (model={model})", file=sys.stderr)
            return bullets
        print(f"[{title}] LLM returned no bullets, using exact dedup ({len(items)} items)", file=sys.stderr)
        return items
    except Exception as e:
        print(f"[{title}] LLM merge failed: {e}; falling back to exact dedup ({len(items)} items)", file=sys.stderr)
        return items


def emit(title: str, items: "OrderedDict[str, str]") -> None:
    merged = merge_with_llm(title, list(items.values()))
    print(f"## {title}\n")
    for desc in merged:
        print(f"- {desc}")
    if not merged:
        print("- (none)")
    print()


emit("New Features", feats)
emit("Fixed", fixes)
