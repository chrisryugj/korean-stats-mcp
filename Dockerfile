# Korean Stats MCP — Fly.io 배포용
#
# 자치구 .xlsx 파일 파싱(kordoc)이 핵심 기능이라 Vercel 250MB 한도가 부족 → Fly.io 컨테이너.
# Multi-stage build: builder에서 tsc → runtime은 dist + production deps만 복사.

# --- Build stage ---
FROM node:20-alpine AS builder

# kordoc → sharp → libvips, onnxruntime-node 빌드에 필요한 도구
RUN apk add --no-cache python3 make g++ vips-dev

WORKDIR /app

# pnpm 활성화
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY package.json pnpm-lock.yaml ./
COPY .npmrc ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN pnpm run build
RUN pnpm prune --prod --ignore-scripts

# --- Runtime stage ---
FROM node:20-alpine

# libvips (sharp 런타임), kordoc/onnxruntime 정적 링크
RUN apk add --no-cache vips libstdc++

RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./

USER app

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "dist/server-http.js"]
