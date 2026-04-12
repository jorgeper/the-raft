FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Build playground shell
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts ./
COPY src/ src/
COPY home/ home/
RUN npm run build

# Build valheim-colors (API + frontend)
COPY apps/valheim-colors/package.json apps/valheim-colors/package-lock.json apps/valheim-colors/
RUN cd apps/valheim-colors && npm ci
COPY apps/valheim-colors/ apps/valheim-colors/
RUN cd apps/valheim-colors && npm run build

# Production image
FROM node:22-slim
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Shell
COPY --from=builder /app/dist ./dist

# Sub-apps: hello-world (static)
COPY apps/hello-world/ apps/hello-world/

# Sub-apps: valheim-colors (compiled API + built frontend)
COPY apps/valheim-colors/meta.json apps/valheim-colors/
COPY --from=builder /app/apps/valheim-colors/api/dist/ apps/valheim-colors/api/dist/
COPY --from=builder /app/apps/valheim-colors/dist/ apps/valheim-colors/

COPY identities.json ./
RUN mkdir -p data
EXPOSE 8002
CMD ["node", "dist/server/server.js"]
