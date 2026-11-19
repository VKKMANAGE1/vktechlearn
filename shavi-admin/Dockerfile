# SHAVI admin panel (M11) — static UI + usage/cost/privacy gateway.
# No build step: the panel is plain HTML/CSS/JS and the service is one ES module.
FROM docker.io/library/node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY service.mjs pricing.json ./
COPY public ./public

# Run unprivileged (the compose file also pins UID/GID to the host user for bind mounts).
USER node
EXPOSE 4127

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4127/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "service.mjs"]
