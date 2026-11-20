#!/usr/bin/env python3
"""Shavi YouTube Autopilot — channel एक बार connect, फिर यह खुद Shorts बनाकर publish करता है।

यह script GitHub Actions में चलता है (.github/workflows/yt-autopilot.yml). हमारा कोई server
नहीं चाहिए: OAuth refresh token Shavi Worker के D1 में रहता है (देखें ai-worker/worker.js) और
हर run की शुरुआत में short-lived access token बनकर आता है.

Pipeline
  1. access token   <- worker GET /api/yt/token (Bearer AUTOPILOT_KEY)
  2. uploads        <- YouTube Data API, सिर्फ़ अपने channel के videos
  3. captions       <- captions API (अपने videos), न मिले तो yt-dlp auto-subs
  4. moments        <- Shavi model 25-50s के सबसे मज़बूत हिस्से चुनता है (fallback: heuristic)
  5. render         <- yt-dlp section download + ffmpeg 1080x1920, blurred bed, जली हुई captions
  6. publish        <- videos.insert resumable upload, #Shorts title/description
  7. ledger         <- worker /api/yt/log, ताकि वही moment दोबारा post न हो

कोई "viral guarantee" नहीं है. जो होता है वह यह है: अपने ही सबसे अच्छे चले हिस्सों को
छोटा, vertical, caption वाला बनाकर सही title/description के साथ अपने channel पर डालना.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_WORKER = "https://site-d28594350583452e987524c38e89b7a9.freebuff.page"
WORKER = os.environ.get("SHAVI_WORKER_URL", DEFAULT_WORKER).rstrip("/")
YT_API = "https://www.googleapis.com/youtube/v3"
UA = "ShaviAutopilot/1.0 (+https://vktechlearn.site/youtube/)"


# --------------------------------------------------------------------- helpers

def log(message: str) -> None:
    stamp = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{stamp}] {message}", flush=True)


def step_summary(markdown: str) -> None:
    target = os.environ.get("GITHUB_STEP_SUMMARY")
    if not target:
        return
    try:
        with open(target, "a", encoding="utf-8") as handle:
            handle.write(markdown + "\n")
    except OSError:
        pass


def http(url: str, *, data: bytes | None = None, headers: dict | None = None, method: str | None = None, timeout: int = 120):
    request = urllib.request.Request(url, data=data, method=method, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except urllib.error.URLError as error:
        raise RuntimeError(f"network: {url} — {error.reason}") from error


def json_request(url: str, *, payload=None, headers=None, method=None, timeout: int = 120):
    body = None if payload is None else json.dumps(payload).encode()
    extra = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        extra["Content-Type"] = "application/json"
    status, raw = http(url, data=body, headers=extra, method=method, timeout=timeout)
    text = raw.decode("utf-8", "replace")
    try:
        parsed = json.loads(text) if text.strip() else {}
    except json.JSONDecodeError:
        parsed = {"raw": text[:500]}
    return status, parsed


def run(cmd: list[str], *, timeout: int = 1800, check: bool = True) -> subprocess.CompletedProcess:
    log("$ " + " ".join(cmd[:6] + (["…"] if len(cmd) > 6 else [])))
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip().splitlines()[-6:]
        raise RuntimeError(f"command failed ({result.returncode}): {' | '.join(tail)}")
    return result


def ffmpeg_bin() -> str:
    env = os.environ.get("FFMPEG")
    if env and Path(env).exists():
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:  # dev machines: pip install imageio-ffmpeg
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        raise RuntimeError("ffmpeg नहीं मिला — workflow में apt-get install ffmpeg होता है")


def ytdlp_cmd() -> list[str]:
    try:
        import yt_dlp  # noqa: F401

        return [sys.executable, "-m", "yt_dlp"]
    except Exception:  # noqa: BLE001
        found = shutil.which("yt-dlp")
        if not found:
            raise RuntimeError("yt-dlp नहीं मिला — pip install yt-dlp")
        return [found]


def load_config(path: Path) -> dict:
    config = {
        "enabled": True,
        "privacy": "public",
        "clips_per_run": 2,
        "clip_seconds": [25, 50],
        "max_source_age_days": 120,
        "min_source_views": 150,
        "caption_langs": ["hi", "en"],
        "burn_captions": True,
        "title_style": "hinglish",
        "hashtags": ["#Shorts", "#YouTubeShorts"],
        "extra_tags": [],
        "min_seconds_between_runs": 0,
    }
    if path.exists():
        config.update(json.loads(path.read_text(encoding="utf-8")))
    return config


# ----------------------------------------------------------------------- worker

class Worker:
    """The only stateful piece: channel token + dedupe ledger, in Cloudflare D1.

    पहचान दो तरह से हो सकती है — GitHub OIDC token (default, कोई secret नहीं) या shared
    AUTOPILOT_KEY. दोनों में से जो मिले, worker उसे जाँचता है.
    """

    def __init__(self, base: str, key: str = "", oidc: str = ""):
        self.base = base
        self.key = key
        self.oidc = oidc

    @property
    def auth(self) -> dict:
        headers: dict[str, str] = {}
        if self.key:
            headers["Authorization"] = f"Bearer {self.key}"
        if self.oidc:
            headers["X-Shavi-Oidc"] = self.oidc
        return headers

    def access_token(self) -> dict:
        status, data = json_request(f"{self.base}/api/yt/token", headers=self.auth)
        if status == 409:
            raise RuntimeError("channel फिर से connect करना होगा: " + str(data.get("error")))
        if status != 200 or not data.get("access_token"):
            raise RuntimeError(f"token नहीं मिला (HTTP {status}): {data.get('error') or data}")
        return data

    def ledger(self) -> dict:
        status, data = json_request(f"{self.base}/api/yt/ledger", headers=self.auth)
        if status != 200:
            log(f"ledger पढ़ा नहीं गया (HTTP {status}) — dedupe इस run में कमज़ोर रहेगा")
            return {"sources": [], "clips": []}
        return data

    def log_run(self, run: dict, clips: list[dict]) -> None:
        status, data = json_request(f"{self.base}/api/yt/log", payload={"run": run, "clips": clips}, headers=self.auth)
        if status != 200:
            log(f"run log नहीं हुआ (HTTP {status}): {data}")

    def chat(self, prompt: str) -> str:
        """Streams /api/chat and returns the plain text answer."""
        payload = json.dumps({"messages": [{"role": "user", "content": prompt}]}).encode()
        request = urllib.request.Request(
            f"{self.base}/api/chat",
            data=payload,
            headers={"Content-Type": "application/json", "User-Agent": UA},
            method="POST",
        )
        text = []
        with urllib.request.urlopen(request, timeout=240) as response:
            for raw in response:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                try:
                    event = json.loads(line[5:].strip())
                except json.JSONDecodeError:
                    continue
                if event.get("error"):
                    raise RuntimeError(str(event["error"]))
                if event.get("delta"):
                    text.append(event["delta"])
        return "".join(text).strip()


# -------------------------------------------------------------------- youtube

def yt_get(access: str, path: str, **params) -> dict:
    query = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    status, data = json_request(f"{YT_API}/{path}?{query}", headers={"Authorization": f"Bearer {access}"})
    if status != 200:
        raise RuntimeError(f"{path} ने HTTP {status}: {json.dumps(data)[:300]}")
    return data


def parse_duration(value: str) -> int:
    match = re.fullmatch(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value or "")
    if not match:
        return 0
    days, hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def channel_uploads(access: str) -> tuple[str, str]:
    data = yt_get(access, "channels", part="snippet,contentDetails,statistics", mine="true")
    items = data.get("items") or []
    if not items:
        raise RuntimeError("channel नहीं मिला — token किसी channel से जुड़ा नहीं है")
    channel = items[0]
    return channel["contentDetails"]["relatedPlaylists"]["uploads"], channel["id"]


def list_videos(access: str, uploads: str, limit: int = 50) -> list[dict]:
    data = yt_get(access, "playlistItems", part="contentDetails", playlistId=uploads, maxResults=min(limit, 50))
    ids = [item["contentDetails"]["videoId"] for item in data.get("items") or []]
    if not ids:
        return []
    details = yt_get(access, "videos", part="snippet,statistics,contentDetails", id=",".join(ids))
    videos = []
    for item in details.get("items") or []:
        stats = item.get("statistics") or {}
        snippet = item.get("snippet") or {}
        videos.append(
            {
                "id": item["id"],
                "title": snippet.get("title") or "",
                "published": snippet.get("publishedAt") or "",
                "description": snippet.get("description") or "",
                "tags": snippet.get("tags") or [],
                "views": int(stats.get("viewCount") or 0),
                "likes": int(stats.get("likeCount") or 0),
                "comments": int(stats.get("commentCount") or 0),
                "seconds": parse_duration((item.get("contentDetails") or {}).get("duration", "")),
                "url": f"https://www.youtube.com/watch?v={item['id']}",
            }
        )
    return videos


def pick_source(videos: list[dict], used: set[str], config: dict) -> dict | None:
    newest = datetime.now(timezone.utc) - timedelta(days=int(config["max_source_age_days"]))
    candidates = []
    for video in videos:
        if video["id"] in used:
            continue
        if not (90 <= video["seconds"] <= 20 * 60):
            continue
        if video["views"] < int(config["min_source_views"]):
            continue
        try:
            published = datetime.fromisoformat(video["published"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if published < newest:
            continue
        age_days = max((datetime.now(timezone.utc) - published).total_seconds() / 86400, 0.5)
        # views per day, नरम boost उन videos को जो पहले ही चले हैं
        score = (video["views"] / age_days) + video["views"] / max(video["seconds"] / 60, 1)
        video["score"] = round(score, 2)
        candidates.append(video)
    candidates.sort(key=lambda item: item["score"], reverse=True)
    return candidates[0] if candidates else None


# ------------------------------------------------------------------- captions

TIMESTAMP = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})")


def _stamp(groups) -> float:
    hours, minutes, seconds, millis = (int(value) for value in groups)
    return hours * 3600 + minutes * 60 + seconds + millis / 1000


def parse_subtitles(text: str) -> list[dict]:
    cues = []
    for block in re.split(r"\n\s*\n", text.replace("\r\n", "\n")):
        match = TIMESTAMP.search(block)
        if not match:
            continue
        start = _stamp(match.groups()[:4])
        end = _stamp(match.groups()[4:])
        body = block[match.end():]
        body = re.sub(r"<[^>]+>", "", body)
        body = re.sub(r"\{[^}]*\}", "", body)
        body = " ".join(line.strip() for line in body.strip().splitlines() if line.strip())
        body = re.sub(r"\[[^\]]{0,20}\]", "", body).strip()
        if body and end > start:
            cues.append({"start": round(start, 2), "end": round(end, 2), "text": body})
    # yt-dlp auto-subs में वही line दो बार आती है — जोड़ दो
    merged: list[dict] = []
    for cue in cues:
        if merged and merged[-1]["text"] == cue["text"]:
            merged[-1]["end"] = cue["end"]
        else:
            merged.append(cue)
    return merged


def captions_from_api(access: str, video_id: str, langs: list[str]) -> tuple[list[dict], str]:
    try:
        listing = yt_get(access, "captions", part="snippet", videoId=video_id)
    except RuntimeError as error:
        log(f"captions.list नहीं चला: {error}")
        return [], ""
    items = listing.get("items") or []
    if not items:
        return [], ""
    preferred = [item for lang in langs for item in items if (item["snippet"].get("language") or "").startswith(lang)]
    chosen = (preferred or items)[0]
    caption_id = chosen["id"]
    status, raw = http(
        f"{YT_API}/captions/{caption_id}?tfmt=srt",
        headers={"Authorization": f"Bearer {access}", "Accept": "application/octet-stream"},
    )
    if status != 200:
        log(f"caption download HTTP {status}")
        return [], ""
    return parse_subtitles(raw.decode("utf-8", "replace")), chosen["snippet"].get("language") or ""


def captions_from_ytdlp(url: str, langs: list[str], workdir: Path) -> tuple[list[dict], str]:
    out = workdir / "subs"
    out.mkdir(parents=True, exist_ok=True)
    cmd = ytdlp_cmd() + [
        "--skip-download",
        "--write-subs",
        "--write-auto-subs",
        "--sub-langs", ",".join(langs) + ".*",
        "--sub-format", "vtt",
        "--no-warnings",
        "--no-playlist",
        "-o", str(out / "%(id)s.%(ext)s"),
        url,
    ]
    try:
        run(cmd, check=False, timeout=600)
    except subprocess.TimeoutExpired:
        return [], ""
    files = sorted(out.glob("*.vtt"), key=lambda path: path.stat().st_size, reverse=True)
    for path in files:
        cues = parse_subtitles(path.read_text(encoding="utf-8", errors="replace"))
        if len(cues) >= 8:
            return cues, path.name.split(".")[0]
    return [], ""


# ---------------------------------------------------------------- clip picking

def digest(cues: list[dict], start: float = 0, end: float | None = None, limit: int = 7000) -> str:
    lines = []
    for cue in cues:
        if cue["end"] < start or (end and cue["start"] > end):
            continue
        minutes, seconds = divmod(int(cue["start"]), 60)
        lines.append(f"[{minutes:02d}:{seconds:02d}] {cue['text']}")
    text = "\n".join(lines)
    return text[-limit:] if len(text) > limit else text


def heuristic_moments(cues: list[dict], config: dict, count: int) -> list[dict]:
    low, high = (int(value) for value in config["clip_seconds"])
    power = re.compile(
        r"(kaise|kaisey|secret|asli|sach|galti|mistake|free|paisa|paise|rupaye|₹|\d+\s*%|\d{2,}|"
        r"mat karo|zaroor|sabse|trick|hack|proof|result|पैसा|गलती|सच|कैसे|सबसे|फ्री|ट्रिक)",
        re.IGNORECASE,
    )
    best: list[dict] = []
    for index, cue in enumerate(cues):
        if not cue["text"]:
            continue
        window_end = cue["start"] + high
        chunk = [item for item in cues[index:] if item["start"] < window_end]
        if not chunk:
            continue
        end = min(chunk[-1]["end"], cue["start"] + high)
        if end - cue["start"] < low:
            continue
        text = " ".join(item["text"] for item in chunk)
        words = len(text.split())
        density = words / max(end - cue["start"], 1)
        hits = len(power.findall(text))
        early = 1.35 if cue["start"] < 90 else 1.0
        score = density * (1 + hits * 0.55) * early
        best.append(
            {
                "start": round(cue["start"], 2),
                "end": round(end, 2),
                "score": round(score, 3),
                "text": text,
                "hook": chunk[0]["text"][:120],
            }
        )
    best.sort(key=lambda item: item["score"], reverse=True)
    chosen: list[dict] = []
    for moment in best:
        if any(moment["start"] < other["end"] and other["start"] < moment["end"] for other in chosen):
            continue
        chosen.append(moment)
        if len(chosen) >= count:
            break
    return chosen


def model_moments(worker: Worker, source: dict, cues: list[dict], config: dict) -> list[dict]:
    low, high = (int(value) for value in config["clip_seconds"])
    prompt = f"""तुम YouTube Shorts editor हो. नीचे एक video का timestamped transcript है.
काम: ऐसे {config['clips_per_run']} हिस्से चुनो जो अलग से देखने पर पूरे लगें और रुकने पर मजबूर करें.

नियम:
- हर clip {low}–{high} सेकंड. start और end ठीक transcript के timestamps के अंदर.
- पूरी बात खत्म होनी चाहिए (अधूरा वाक्य नहीं), बीच से शुरू नहीं.
- ऐसा हिस्सा जिसमें कोई ठोस बात, संख्या, गलती, या ट्रिक हो — सिर्फ़ भूमिका नहीं.
- एक ही जगह से दो clips मत दो, वे ओवरलैप न करें.
- title में #{config['hashtags'][0].lstrip('#')} नहीं लिखना; वह हम खुद जोड़ेंगे. title 80 अक्षर से कम, clickable पर झूठा नहीं.
- भाषा: {config['title_style']} (Roman script), जैसे बोलचाल में लिखते हैं.

सिर्फ़ यह JSON लौटाओ, कोई व्याख्या नहीं:
{{"clips":[{{"start":"mm:ss","end":"mm:ss","title":"…","hook":"पहली बोली जाने वाली line","description":"2 lines","tags":["…","…"]}}]}}

VIDEO: {source['title']}
TRANSCRIPT:
{digest(cues)}"""
    try:
        answer = worker.chat(prompt)
    except Exception as error:  # noqa: BLE001
        log(f"model नहीं चला, heuristic पर जा रहे हैं: {error}")
        return []
    match = re.search(r"\{[\s\S]*\}", answer)
    if not match:
        log("model ने JSON नहीं दिया — heuristic")
        return []
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        log("model का JSON टूटा था — heuristic")
        return []
    clips = []
    for item in parsed.get("clips") or []:
        try:
            start = parse_timecode(str(item.get("start")))
            end = parse_timecode(str(item.get("end")))
        except ValueError:
            continue
        if end - start < low - 3 or end - start > high + 8:
            continue
        clips.append(
            {
                "start": start,
                "end": end,
                "title": str(item.get("title") or "").strip(),
                "hook": str(item.get("hook") or "").strip(),
                "description": str(item.get("description") or "").strip(),
                "tags": [str(tag).strip() for tag in (item.get("tags") or []) if str(tag).strip()][:12],
                "text": " ".join(cue["text"] for cue in cues if cue["end"] > start and cue["start"] < end),
                "score": None,
            }
        )
    if len(clips) < 1:
        return []
    clips.sort(key=lambda clip: clip["start"])
    return clips[: int(config["clips_per_run"])]


def parse_timecode(value: str) -> float:
    text = value.strip()
    if re.fullmatch(r"\d+(\.\d+)?", text):
        return float(text)
    parts = [float(part) for part in text.replace(",", ".").split(":")]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    raise ValueError(value)


# ------------------------------------------------------------------- rendering

def prepare_segment(source: dict, start: float, end: float, target: Path, workdir: Path) -> Path:
    """Downloads (or trims a local file to) just the needed seconds."""
    duration = end - start
    local = source.get("local_path")
    if local:
        cmd = [ffmpeg_bin(), "-y", "-ss", f"{start:.2f}", "-i", str(local), "-t", f"{duration:.2f}",
               "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
               "-pix_fmt", "yuv420p", str(target)]
        run(cmd, timeout=900)
        return target

    raw = workdir / "section.mp4"
    cmd = ytdlp_cmd() + [
        "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080]/b",
        "--download-sections", f"*{start:.2f}-{end:.2f}",
        "--force-keyframes-at-cuts",
        "--no-playlist",
        "--no-warnings",
        "--ffmpeg-location", ffmpeg_bin(),
        "-o", str(raw),
        source["url"],
    ]
    run(cmd, timeout=1200)
    if not raw.exists():
        candidates = sorted(workdir.glob("section*.mp4"))
        if not candidates:
            raise RuntimeError("yt-dlp ने section download नहीं किया")
        raw = candidates[0]
    # yt-dlp का cut किनारों पर थोड़ा ढीला होता है — ठीक से काटो
    trim = [ffmpeg_bin(), "-y", "-i", str(raw), "-t", f"{duration:.2f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k",
            "-pix_fmt", "yuv420p", str(target)]
    run(trim, timeout=900)
    return target


def write_srt(cues: list[dict], start: float, end: float, path: Path) -> Path | None:
    rows = []
    index = 0
    for cue in cues:
        if cue["end"] <= start or cue["start"] >= end:
            continue
        index += 1
        first = max(cue["start"], start) - start
        last = min(cue["end"], end) - start
        rows.append(f"{index}\n{_srt_time(first)} --> {_srt_time(last)}\n{cue['text']}\n")
    if not rows:
        return None
    path.write_text("\n".join(rows), encoding="utf-8")
    return path


def _srt_time(seconds: float) -> str:
    millis = int(round(seconds * 1000))
    hours, millis = divmod(millis, 3600000)
    minutes, millis = divmod(millis, 60000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def probe_media(path: Path) -> dict:
    probe = shutil.which("ffprobe")
    if probe:
        out = run([probe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                   "-show_entries", "format=duration", "-of", "json", str(path)], check=False, timeout=120)
        data = json.loads(out.stdout or "{}")
        stream = (data.get("streams") or [{}])[0]
        return {
            "width": stream.get("width"),
            "height": stream.get("height"),
            "duration": float((data.get("format") or {}).get("duration") or 0),
        }
    out = run([ffmpeg_bin(), "-hide_banner", "-i", str(path)], check=False, timeout=120)
    text = out.stderr or ""
    size = re.search(r",\s(\d{2,5})x(\d{2,5})[, ]", text)
    duration = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
    return {
        "width": int(size.group(1)) if size else None,
        "height": int(size.group(2)) if size else None,
        "duration": (int(duration.group(1)) * 3600 + int(duration.group(2)) * 60 + float(duration.group(3))) if duration else 0,
    }


def has_audio(path: Path) -> bool:
    try:
        out = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                   "-of", "csv=p=0", str(path)], check=False, timeout=120)
        return bool((out.stdout or "").strip()) or shutil.which("ffprobe") is None
    except Exception:  # noqa: BLE001
        return True


_ffmpeg_filters: str | None = None


def ffmpeg_has_filter(name: str) -> bool:
    global _ffmpeg_filters
    if _ffmpeg_filters is None:
        _ffmpeg_filters = run([ffmpeg_bin(), "-hide_banner", "-filters"], check=False, timeout=120).stdout or ""
    return re.search(rf"\s{name}\s", _ffmpeg_filters) is not None


def render(source: dict, moment: dict, cues: list[dict], out: Path, workdir: Path, config: dict) -> Path:
    segment = prepare_segment(source, moment["start"], moment["end"], workdir / "segment.mp4", workdir)
    srt = None
    if config.get("burn_captions", True):
        if ffmpeg_has_filter("subtitles"):
            srt = write_srt(cues, moment["start"], moment["end"], workdir / "clip.srt")
        else:
            log("इस ffmpeg build में subtitles filter नहीं है — clip बिना जली captions के बनेगा")

    subs = f",subtitles=filename='{srt}':force_style='FontSize=15,Alignment=2,MarginV=110,Outline=2,Shadow=0,Bold=1,BorderStyle=1'".replace("\\", "/") if srt else ""
    audio = has_audio(segment)
    filtergraph = (
        "[0:v]split=2[bgv][fgv];"
        "[bgv]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=26,"
        "eq=brightness=-0.12:saturation=0.85[bg];"
        "[fgv]scale=1080:-2[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2{subs},format=yuv420p[v]"
    )
    cmd = [ffmpeg_bin(), "-y", "-i", str(segment)]
    if audio:
        filtergraph += ";[0:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]"
    cmd += ["-filter_complex", filtergraph, "-map", "[v]"]
    if audio:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "160k", "-ar", "48000"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-shortest", str(out)]
    result = run(cmd, check=False, timeout=1800)
    if result.returncode != 0 or not out.exists() or out.stat().st_size < 20_000:
        tail = (result.stderr or "").strip().splitlines()[-8:]
        raise RuntimeError("ffmpeg render fail: " + " | ".join(tail))
    if srt and re.search(r"(failed to load fontconfig|could not load font|fontconfig error)", result.stderr or "", re.I):
        log("⚠ इस machine पर font/fontconfig नहीं मिला — clip में captions नहीं जलीं (fonts-noto-* install करें)")
    return out


# -------------------------------------------------------------------- publish

def build_metadata(moment: dict, source: dict, config: dict) -> dict:
    hashtags = [tag if tag.startswith("#") else f"#{tag}" for tag in config.get("hashtags", [])]
    if "#Shorts" not in hashtags:
        hashtags.insert(0, "#Shorts")
    raw_title = re.sub(r"[<>]", "", moment.get("title") or moment.get("hook") or source["title"])
    raw_title = re.sub(r"\s+", " ", raw_title).strip()
    room = 100 - (len(hashtags[0]) + 1)
    title = raw_title[:room].rstrip(" .-—|")
    title = f"{title} {hashtags[0]}"
    hook = (moment.get("hook") or "").strip()
    description = "\n".join(
        part for part in [
            hook,
            (moment.get("description") or "").strip(),
            "",
            f"पूरा video देखें: {source['url']}",
            "",
            " ".join(hashtags + [tag if tag.startswith("#") else f"#{tag}" for tag in config.get("extra_tags", [])]),
        ] if part is not None
    ).strip()
    tags = [tag for tag in (moment.get("tags") or []) if not tag.startswith("#")][:12]
    tags += [tag.lstrip("#") for tag in config.get("extra_tags", [])][:4]
    return {"title": title, "description": description[:4900], "tags": tags}


def upload_video(access: str, path: Path, metadata: dict, config: dict) -> dict:
    body = {
        "snippet": {
            "title": metadata["title"],
            "description": metadata["description"],
            "tags": metadata["tags"],
            "categoryId": str(config.get("category_id", "22")),
        },
        "status": {
            "privacyStatus": config.get("privacy", "public"),
            "selfDeclaredMadeForKids": False,
        },
    }
    size = path.stat().st_size
    status, start = json_request(
        f"https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        payload=body,
        headers={
            "Authorization": f"Bearer {access}",
            "X-Upload-Content-Length": str(size),
            "X-Upload-Content-Type": "video/mp4",
        },
        timeout=120,
    )
    if status not in (200, 201):
        raise RuntimeError(f"upload शुरू नहीं हुआ (HTTP {status}): {json.dumps(start)[:300]}")
    location = start.get("upload_url") or start.get("location")
    if not location:
        raise RuntimeError("upload URL नहीं मिला")
    payload = path.read_bytes()
    status, done = http(
        location,
        data=payload,
        method="PUT",
        headers={"Content-Type": "video/mp4", "Content-Length": str(len(payload))},
        timeout=1800,
    )
    if status not in (200, 201):
        raise RuntimeError(f"upload fail (HTTP {status}): {json.dumps(done)[:300]}")
    video = json.loads(done.decode("utf-8", "replace") or "{}")
    if not video.get("id"):
        raise RuntimeError("upload के बाद video id नहीं मिली")
    return video


# ----------------------------------------------------------------------- modes

def self_test(config: dict) -> int:
    """Google credentials के बिना असली pipeline चेक: ffmpeg render + captions + metadata."""
    workdir = Path(tempfile.mkdtemp(prefix="shavi-selftest-"))
    log(f"self-test workdir: {workdir}")
    source_video = workdir / "source.mp4"
    run([ffmpeg_bin(), "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
         "-f", "lavfi", "-i", "sine=frequency=420", "-t", "40", "-c:v", "libx264",
         "-pix_fmt", "yuv420p", "-c:a", "aac", str(source_video)], timeout=300)
    cues = [
        {"start": 2.0, "end": 6.0, "text": "Aaj main aapko ek aisi trick dikhata hoon jo 90% log nahi jaante."},
        {"start": 6.0, "end": 11.0, "text": "Isse aapka kaam 3 guna tez ho jayega, bina kisi paid tool ke."},
        {"start": 11.0, "end": 16.0, "text": "Bas ek setting badalni hai, aur woh bhi free mein."},
        {"start": 16.0, "end": 22.0, "text": "Pehle main galat tarika dikhata hoon jo sab karte hain."},
        {"start": 22.0, "end": 28.0, "text": "Ab sahi tarika: do click, aur result aapke saamne hai."},
        {"start": 28.0, "end": 34.0, "text": "Yeh cheez 2024 ke baad badal gayi hai, isliye purane tutorials fail hote hain."},
    ]
    moments = model_moments(Worker("http://127.0.0.1:9"), {"title": "self test", "url": ""}, cues, {**config, "clips_per_run": 2})
    if not moments:
        moments = heuristic_moments(cues, config, 2)
    log(f"moments: {[(m['start'], m['end']) for m in moments]}")
    if not moments:
        raise RuntimeError("कोई moment नहीं चुना गया")
    source = {"id": "self", "title": "Self test video", "url": "https://www.youtube.com/watch?v=self", "local_path": source_video}
    results = []
    for index, moment in enumerate(moments):
        out = workdir / f"clip-{index + 1}.mp4"
        render(source, moment, cues, out, workdir, config)
        info = probe_media(out)
        stream = {"width": info["width"], "height": info["height"]}
        duration = info["duration"]
        metadata = build_metadata({**moment, "title": moment.get("title") or "Self test clip"}, source, config)
        results.append({
            "clip": str(out), "size_kb": round(out.stat().st_size / 1024),
            "width": stream.get("width"), "height": stream.get("height"),
            "duration": round(duration, 1), "title": metadata["title"],
        })
        log(f"render ok: {out.name} {stream.get('width')}x{stream.get('height')} {duration:.1f}s")
    for item in results:
        if item["width"] != 1080 or item["height"] != 1920:
            raise RuntimeError(f"aspect गलत: {item}")
        if not (config["clip_seconds"][0] - 4 <= item["duration"] <= config["clip_seconds"][1] + 10):
            raise RuntimeError(f"duration गलत: {item}")
    print(json.dumps({"self_test": "ok", "clips": results}, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Shavi YouTube Autopilot")
    parser.add_argument("--config", default=str(HERE / "config.json"))
    parser.add_argument("--dry-run", action="store_true", help="clips बनाओ, publish मत करो")
    parser.add_argument("--self-test", action="store_true", help="Google keys के बिना pipeline जाँचो")
    parser.add_argument("--out", default="autopilot-out")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    if args.self_test:
        return self_test(config)

    key = os.environ.get("AUTOPILOT_KEY", "").strip()
    oidc = os.environ.get("GITHUB_OIDC_TOKEN", "").strip()
    if not key and not oidc:
        log("कोई पहचान नहीं — GITHUB_OIDC_TOKEN (workflow देता है) या AUTOPILOT_KEY चाहिए.")
        step_summary("### Autopilot बंद\nWorker के लिए कोई token नहीं मिला, इसलिए कुछ नहीं चला।")
        return 0
    if not config.get("enabled", True):
        log("config में enabled=false है — यह run skip.")
        return 0

    worker = Worker(WORKER, key, oidc)
    token = worker.access_token()
    access = token["access_token"]
    log(f"channel: {token.get('channel_title') or token.get('channel_id')}")

    uploads, channel_id = channel_uploads(access)
    videos = list_videos(access, uploads, limit=50)
    log(f"{len(videos)} videos पढ़े")
    ledger = worker.ledger()
    used = set(ledger.get("sources") or [])
    source = pick_source(videos, used, config)
    if not source:
        log("ऐसा कोई video नहीं मिला जिसका clip अभी बनाना बाकी हो.")
        step_summary("### कुछ नहीं बना\nहर eligible video का clip पहले बन चुका है, या कोई video criteria पर खरा नहीं उतरा.")
        worker.log_run({"source_id": None, "status": "skipped", "note": "no eligible source", "clips": 0}, [])
        return 0
    log(f"source: {source['title']} · {source['views']} views · {source['seconds']}s · score {source['score']}")

    workdir = Path(tempfile.mkdtemp(prefix="shavi-autopilot-"))
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    cues, caption_source = captions_from_api(access, source["id"], config.get("caption_langs", ["hi", "en"]))
    if len(cues) < 8:
        log("captions API से नहीं मिलीं — yt-dlp से कोशिश")
        cues, caption_source = captions_from_ytdlp(source["url"], config.get("caption_langs", ["hi", "en"]), workdir)
    if len(cues) < 8:
        log("transcript नहीं मिला — इस video से clip नहीं बन सकता")
        worker.log_run({"source_id": source["id"], "source_title": source["title"], "status": "skipped",
                        "note": "no captions", "clips": 0}, [])
        step_summary(f"### transcript नहीं मिला\n{source['title']} — YouTube पर captions on करें, अगली बार यह चलेगा.")
        return 0
    log(f"{len(cues)} caption lines ({caption_source or 'auto'})")

    moments = model_moments(worker, source, cues, config)
    if not moments:
        log("model से moments नहीं मिले — heuristic")
        moments = heuristic_moments(cues, config, int(config["clips_per_run"]))
    if not moments:
        worker.log_run({"source_id": source["id"], "source_title": source["title"], "status": "skipped",
                        "note": "no moments", "clips": 0}, [])
        return 0

    published = []
    failures = []
    for index, moment in enumerate(moments):
        try:
            clip = render(source, moment, cues, outdir / f"{source['id']}-{int(moment['start'])}s.mp4", workdir, config)
            metadata = build_metadata(moment, source, config)
            log(f"clip तैयार: {clip.name} ({clip.stat().st_size / 1024 / 1024:.1f} MB) — {metadata['title']}")
            if args.dry_run:
                published.append({"dry_run": True, **metadata, "start": moment["start"], "end": moment["end"]})
                continue
            video = upload_video(access, clip, metadata, config)
            url = f"https://youtube.com/shorts/{video['id']}"
            log(f"publish: {url}")
            published.append({"video_id": video["id"], "url": url, **metadata, "start": moment["start"], "end": moment["end"]})
            worker.log_run(
                {"source_id": source["id"], "source_title": source["title"], "status": "published",
                 "note": f"{len(published)} clip(s)", "clips": 1},
                [{"source_id": source["id"], "source_title": source["title"], "start": moment["start"],
                  "end": moment["end"], "video_id": video["id"], "title": metadata["title"]}],
            )
        except Exception as error:  # noqa: BLE001
            log(f"इस clip पर रुक गए: {error}")
            failures.append({"start": moment.get("start"), "error": str(error)[:300]})

    summary = ["### Shavi autopilot run", "", f"Source: **{source['title']}** ({source['url']})", ""]
    for item in published:
        summary.append(f"- {'(dry-run) ' if item.get('dry_run') else ''}{item['title']} — {item.get('url') or 'not uploaded'}")
    for item in failures:
        summary.append(f"- ❌ {item['start']}s — {item['error']}")
    if not published and failures:
        worker.log_run({"source_id": source["id"], "source_title": source["title"], "status": "failed",
                        "note": failures[0]["error"], "clips": 0}, [])
        step_summary("\n".join(summary))
        return 1
    step_summary("\n".join(summary))
    print(json.dumps({"source": source["id"], "published": published, "failures": failures}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
