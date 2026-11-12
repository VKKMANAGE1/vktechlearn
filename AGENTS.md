# VK Tech Learn — project rules

Static site: `index.html` (homepage), `posts/<slug>.html` (89 post pages generated from the
Blogger feed), shared `post.css`, generator `tools/build_posts.py`.
Live domain: https://vktechlearn.site (GitHub Pages, `main` branch → Actions → Pages).
Blogger blog id: 994118461602418597 — posts are written on Blogger, then synced.

## Post writing rules (apply to every new post, unless the user says otherwise)

When the user gives a topic, write the post yourself — title, headings, text, images, meta —
in **Hindi or Hinglish** (match the language of the topic/user request; Hinglish = Hindi
sentence structure with common English tech words, same as existing posts).

1. **Length: 2000+ words minimum.** Explain the topic properly, with context, examples,
   steps, and real-world use — not padding or repeated lines.
2. **Language:** simple, natural Hindi/Hinglish. Technical terms English me, par sentence
   Hindi. No machine-translation tone, no English-only paragraphs.
3. **Structure (SEO):**
   - One `H1` only — the post title (Blogger title, 55–65 characters, main keyword near start).
   - Intro paragraph: keyword in the first 100 words, tells the reader what they will get.
   - 5–9 `H2` sections, each with 1–3 `H3` sub-points where useful.
   - Include a "quick answer / short summary" block near the top (good for featured snippets).
   - End with a conclusion + a short FAQ (3–5 questions as `H3` + 1–2 line answers).
   - Use lists, tables, and step-by-step (`1., 2., 3.`) where they help scanning.
4. **On-page SEO:**
   - Meta description 150–160 characters, contains the main keyword, written as a benefit.
   - Slug: short, English, hyphenated, keyword-first (e.g. `best-free-pdf-tools`).
   - Main keyword used naturally in H1, first paragraph, one or two H2s, and image alt text;
     secondary keywords spread across sections. No keyword stuffing.
   - 2–4 internal links to related posts/tools on this site, 1–2 outbound authority links.
   - Labels/categories: 2–4 relevant labels.
5. **Paragraphs:** every paragraph is `text-align: justify` (both edges aligned) — never
   left-ragged or right-aligned. `post.css` already enforces this for `.post-body p` and `li`.
6. **Typography (already in the site CSS — keep it):**
   - Body/paragraphs: `Rajdhani` for Latin + `Noto Sans Devanagari` for Hindi, 17px, line-height 1.75.
   - Headings and brand: `Orbitron` + `Noto Sans Devanagari`.
   - Body text colour `#dbe6f5` on dark panels, links cyan `#00e5ff`.
   - Short paragraphs (2–4 lines), so justified text has no big gaps.
7. **Images:**
   - One featured/hero image at the top, plus 2–4 in-body images for a 2000-word post.
   - Use free-licence sources (Unsplash/Pexels/Wikimedia) or the site's own branded graphics;
     never copy copyrighted screenshots or other sites' images.
   - Every image needs descriptive `alt` text with the keyword where natural, plus a caption.
   - Keep images compressed (WebP/JPG, under ~200 KB), 16:9 or 4:3, width 100%, responsive.
8. **Finish before publishing:** proofread for spelling, no broken markdown/HTML, tables and
   code blocks render fine on mobile, and the disclaimer/author box stays at the end.

## Publishing flow (important)

- Write/update the post on **Blogger** (source of truth). GitHub Actions `sync.yml` rebuilds
  `posts/*.html` from the Blogger feed every 3 hours (`17 */3 * * *`) and deploys to Pages.
- Never hand-edit a generated `posts/*.html` file — the next sync overwrites it. Change the
  post on Blogger, or change the generator `tools/build_posts.py` for site-wide changes.
- Homepage changes go in `index.html`; the `POSTS` array there is refreshed by
  `python3 tools/build_posts.py --update-index`.
- Commit + push to `main` → workflow "Deploy static site to GitHub Pages" → live in 1–2 minutes.
- `vktechlearn.freebuff.page` is a separate mirror and does not update on push by itself.
