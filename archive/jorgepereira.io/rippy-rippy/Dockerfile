# Rippy Rippy — workout tracking for friends.
# Multi-stage: build the client + server, then ship a slim runtime image.
# node:22-slim (Debian) so better-sqlite3 uses its prebuilt glibc binaries.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json default-library.json ./
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
