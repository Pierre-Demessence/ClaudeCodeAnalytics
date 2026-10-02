# Always-on dashboard: `vite preview` serves the built app and the `/api`
# plugin, which reads the transcripts and writes the data dir (both mounted).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# `vite preview` loads `vite.config.ts`, which needs Vite, the React plugin and
# the server sources at runtime, so dev dependencies stay in the image.
FROM node:24-alpine
WORKDIR /app
ENV CLAUDE_CONFIG_DIR=/claude \
  CCA_DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json /app/brand.json /app/vite.config.ts ./
COPY --from=build /app/src ./src
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4173/').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# The native config loader runs `vite.config.ts` with Node's type stripping
# instead of bundling it into node_modules, which is read-only at runtime.
CMD ["node", "node_modules/vite/bin/vite.js", "preview", "--host", "0.0.0.0", "--port", "4173", "--strictPort", "--configLoader", "native"]
