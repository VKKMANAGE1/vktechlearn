# SHAVI YouTube Studio — the eleven youtube-agent-skill skills + their six Python tools.
# The tools are dependency-free Python 3, so python3 is the only extra package.
FROM docker.io/library/node:22-alpine

RUN apk add --no-cache python3

WORKDIR /app
ENV NODE_ENV=production \
    SHAVI_YOUTUBE_PORT=4128 \
    SHAVI_YOUTUBE_HOST=0.0.0.0

COPY service.mjs ./
COPY public ./public
COPY skills ./skills
COPY voice.md LICENSE UPSTREAM-README.md ./

# voice.md is a bind-mount target in production so edits survive image rebuilds.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 4128
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4128/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "service.mjs"]
