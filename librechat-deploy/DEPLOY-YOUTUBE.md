# YouTube Studio को vktechlearn.site पर live करना

अभी studio **सिर्फ़ इस VM पर** चल रहा है (`http://127.0.0.1:3000`, right-side Browser panel) और code
`shavi-youtube/` में है। `vktechlearn.site` GitHub Pages है — वहाँ Node/Python नहीं चल सकता, इसलिए
live करने के लिए एक **Docker host + subdomain** चाहिए। यही रास्ता नीचे है और सारी configuration
इस repo में पहले से जुड़ी हुई है (`docker-compose.yml`, `Caddyfile`, `.env.example`).

## 0. क्या चाहिए

| चीज़ | विवरण |
| --- | --- |
| Docker host | 2 vCPU / 4 GB RAM से ठीक, root या sudo, ports **80 + 443** खुले |
| DNS access | `vktechlearn.site` के DNS provider का login (GitHub Pages के repo से नहीं होता) |
| Repo | यही repo host पर clone, और LibreChat v0.8.9 का patched tree (`librechat/`) — compose उसी से api image बनाता है |

## 1. DNS

DNS provider पर तीन A records (सब एक ही host IP पर):

```
youtube   A   <host-ip>     # YouTube Studio — यह पहले करें
chat      A   <host-ip>     # LibreChat (जब deploy करें)
admin     A   <host-ip>     # admin panel (जब deploy करें)
```

`youtube.vktechlearn.site` resolve होने से पहले deploy न करें — Caddy का ACME challenge fail होगा।

## 2. `.env`

```bash
cd librechat-deploy
cp .env.example .env
# भरें: SHAVI_DOMAIN, SHAVI_ADMIN_DOMAIN, SHAVI_YOUTUBE_DOMAIN, ACME_EMAIL
# secrets: CREDS_KEY=$(openssl rand -hex 32), CREDS_IV=$(openssl rand -hex 16),
#          JWT_SECRET / JWT_REFRESH_SECRET=$(openssl rand -hex 32),
#          MEILI_MASTER_KEY=$(openssl rand -base64 32)
# provider keys: SHAVI_AI_KEY (यही studio के model calls के लिए भी इस्तेमाल होती है)

# basic auth — studio पैसे (credits) खर्च करता है, इसलिए बिना password के नहीं खुलेगा
docker run --rm caddy:2.10-alpine caddy hash-password --plaintext 'आपका-पासवर्ड'
# output को .env में डालें:
#   SHAVI_YOUTUBE_USER=shavi
#   SHAVI_YOUTUBE_HASH=$2a$14$....
```

`youtube-voice.md` पहले से मौजूद है (template)। चाहें तो host पर सीधे edit करें — container उसी फ़ाइल
को mount करता है, rebuild की ज़रूरत नहीं।

## 3. Build + start

```bash
docker compose up -d --build          # 9 services: api admin youtube caddy mongodb backup meili vectordb rag_api
docker compose ps                     # सब healthy/running
docker compose logs -f caddy          # ACME certificate मिलते ही "certificate obtained"
docker compose logs -f youtube        # "SHAVI YouTube Studio on http://0.0.0.0:4128 — 11 skills"
```

## 4. Verify (deploy के बाद यही चलाएँ)

```bash
curl -sI https://youtube.vktechlearn.site/            # 401 (basic auth लागू है)
curl -su shavi:'पासवर्ड' https://youtube.vktechlearn.site/health
#   -> {"status":"ok","skills":11,"key":true,"python":"Python 3.12.3"}
curl -su shavi:'पासवर्ड' -X POST https://youtube.vktechlearn.site/api/tool \
  -H 'Content-Type: application/json' \
  -d '{"skill":"yt-package","text":"AI ne mera thumbnail bana diya","thumb":"AI RAN IT"}'
#   -> title.py का JSON (score, issues, good)
```

Browser में खोलकर एक skill चलाएँ (`yt-package` सबसे तेज़ है) — tool JSON और model का जवाब दोनों आने चाहिए।

## 5. Site पर link (deploy सफल होने के बाद)

`index.html` के Tools dropdown में एक line जोड़ें (nav लगभग line 625):

```html
<li><a class="hot" href="https://youtube.vktechlearn.site" target="_blank" rel="noopener noreferrer"
       data-en="YouTube Studio" data-hi="YouTube Studio">YouTube Studio</a></li>
```

फिर commit + push → GitHub Actions 1–2 मिनट में live। (Link पहले नहीं जोड़ा गया कि live site पर
टूटा हुआ link न दिखे — DNS/deploy के बाद यह line जोड़ना सही क्रम है।)

## 6. रोज़ का काम

| काम | command |
| --- | --- |
| Studio logs | `docker compose logs -f youtube` |
| Restart | `docker compose restart youtube` |
| Image update | `docker compose build youtube && docker compose up -d youtube` |
| Password बदलना | नया hash बनाएँ → `.env` में `SHAVI_YOUTUBE_HASH` बदलें → `docker compose up -d caddy` |
| voice.md backup | `tar czf voice-$(date +%F).tgz librechat-deploy/youtube-voice.md` (Mongo backup में यह नहीं आता) |

## सीमाएँ जो अभी भी रहेंगी

- Studio अपना login नहीं रखता — पूरा access Caddy basic auth से है। LibreChat login चाहिए तो client में
  नया page बनाना होगा (अलग काम है)।
- एक बार में एक ही request; जवाब 30–90 सेकंड लेते हैं (Nemotron)।
- कुछ भी publish नहीं होता — output copy करके आप खुद upload करते हैं, यह pack का इरादा है।
