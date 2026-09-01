FROM node:24-bookworm-slim AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/agent-runtime/package.json packages/agent-runtime/package.json
COPY packages/chalkboard/package.json packages/chalkboard/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages packages
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm --filter @chalk/web build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app/apps/web
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY --from=build /app/package.json /app/pnpm-workspace.yaml /app/
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/web/node_modules ./node_modules
COPY --from=build /app/apps/web/.next ./.next
COPY --from=build /app/apps/web/public ./public
COPY --from=build /app/apps/web/scripts ./scripts
COPY --from=build /app/apps/web/package.json ./package.json
COPY --from=build /app/apps/web/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["node", "scripts/next.mjs", "start"]
