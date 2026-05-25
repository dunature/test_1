FROM node:22-bookworm-slim AS build
WORKDIR /app/agent-core
COPY agent-core/package*.json ./
RUN npm ci
COPY agent-core/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN npm install -g pm2@latest
WORKDIR /app/agent-core
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    STATIC_DIR=/app/agent-core/public \
    AGENT_DATA_DIR=/data
COPY --from=build /app/agent-core/dist ./dist
COPY --from=build /app/agent-core/public ./public
COPY agent-core/package*.json ./
COPY ecosystem.config.cjs /app/ecosystem.config.cjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pm2-runtime", "/app/ecosystem.config.cjs"]
