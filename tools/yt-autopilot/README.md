# YouTube Autopilot — जोड़ो एक बार, फिर यह खुद Shorts बनाकर publish करता है

`youtube/` page का **Channel connect** बटन OAuth पूरा करता है; उसके बाद यह pipeline
सिर्फ़ आपके channel की uploads से क्लिप काटकर Shorts publish करता रहता है.

```
channel connect (एक बार, browser से)
        ↓ refresh token → Shavi Worker (D1)
GitHub Actions, रोज़ 09:10 + 21:10 IST
        ↓ OIDC token → Worker → access token
videos.list  →  captions  →  Shavi model से moments  →  yt-dlp + ffmpeg 1080×1920
        ↓ videos.insert (resumable)
YouTube पर #Shorts  →  worker ledger में हिसाब (वही moment दोबारा नहीं)
```

## क्या-क्या असली है

- **सिर्फ़ अपना content** — source videos `mine=true` से आते हैं, यानी जो channel connect हुआ है
  उसी की uploads. किसी और के video से क्लिप नहीं बनता.
- **असली transcript** — पहले captions API (अपने videos के लिए), न मिले तो yt-dlp auto-subs.
  Transcript न हो तो वह video छोड़ दिया जाता है (बिना पढ़े moment नहीं चुना जाता).
- **असली render** — 9:16 (1080×1920), ऊपर-नीचे blurred bed, बीच में original, जली हुई captions,
  loudness −14 LUFS. `--self-test` इसे बिना Google keys के चला कर दिखाता है.
- **दोहराव नहीं** — हर publish worker के D1 ledger में जाता है; वही video/moment दोबारा नहीं उठता.

## एक बार का setup (3 काम)

1. **Google OAuth client** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   में project बनाइए, *YouTube Data API v3* enable कीजिए, फिर **Create credentials → OAuth client ID →
   Web application**. “Authorized redirect URI” में यही डालिए:

   ```
   https://site-d28594350583452e987524c38e89b7a9.freebuff.page/api/yt/oauth/callback
   ```

   मिली दो values को **Sites → Shavi AI API → Secrets** में `GOOGLE_CLIENT_ID` और
   `GOOGLE_CLIENT_SECRET` नाम से सेव कीजिए (chat में कभी paste नहीं करनी).

2. **D1 database** — उसी Sites project में `DB` नाम से D1 जोड़ा हुआ है (token + history).
   नया environment बनाएँ तो उसे भी जोड़ना होगा.

3. **Connect** — [vktechlearn.site/youtube/](https://vktechlearn.site/youtube/) खोलिए,
   *Channel connect करें* दबाइए, Google से वही channel चुनिए जिस पर post करना है, और सारी
   permissions Allow कीजिए. वापस आकर panel में channel का नाम दिख जाएगा.

उसके बाद कुछ नहीं करना. (“अभी चलाओ” बटन के लिए Worker में `GH_TOKEN` — fine-grained PAT,
Actions: read & write — चाहिए; न हो तो Actions tab → *YouTube autopilot* → *Run workflow*.)

## Settings — `config.json`

| key | matlab |
| --- | --- |
| `enabled` | `false` करने पर कोई run कुछ नहीं करेगा |
| `privacy` | `public` / `unlisted` / `private` (private = आप खुद publish करेंगे) |
| `clips_per_run` | एक run में कितनी Shorts (default 2 — ज़्यादा करने से channel spam दिखता है) |
| `clip_seconds` | `[25, 50]` — clip की न्यूनतम/अधिकतम लंबाई |
| `max_source_age_days` | इतने दिन से पुराने videos नहीं उठाए जाएँगे |
| `min_source_views` | कम views वाले videos छोड़ दिए जाएँगे |
| `caption_langs` | कौन सी caption भाषा पहले आज़माई जाए |
| `burn_captions` | video पर captions जलाना है या नहीं |
| `title_style` | title/hook किस भाषा-अंदाज़ में (default hinglish) |
| `hashtags`, `extra_tags` | हर Shorts के title/description में |

## हाथ से चलाना / जाँचना

```bash
# pipeline की असली जाँच — ffmpeg render, captions, metadata (Google keys नहीं चाहिए)
python3 tools/yt-autopilot/autopilot.py --self-test

# clips बनाओ, publish मत करो
python3 tools/yt-autopilot/autopilot.py --dry-run --out autopilot-out
```

Local machine पर `ffmpeg` (या `pip install imageio-ffmpeg`) और `pip install yt-dlp` चाहिए.

## ईमानदार सीमाएँ

- “Viral” की कोई गारंटी नहीं — यह proven हिस्सों को Shorts में बदलकर लगातार post करता है, चलना
  दर्शकों पर है.
- YouTube की API quota: एक upload ~1600 units, default 10,000/दिन — यानी 4–6 uploads/दिन से
  ज़्यादा नहीं. `clips_per_run` इसीलिए 2 है.
- Auto-captions की quality जैसी होगी, captions वैसे ही जलेंगी; Hindi/Devanagari के लिए workflow
  `fonts-noto-devanagari` install करता है.
- 20 मिनट से लंबे videos source नहीं बनते (Shorts के लिए छोटा हिस्सा ही काफ़ी है).
