FROM node:24-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=node:node . .
RUN npm run build && mkdir -p /app/.local /app/artifacts && chown node:node /app/.local /app/artifacts
USER node
ENV HOST=0.0.0.0 PORT=15190 MODE=demo
EXPOSE 15190
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s CMD node -e "fetch('http://127.0.0.1:15190/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","scripts/bootstrap.mjs"]
