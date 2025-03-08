FROM node:22.12-alpine AS builder

COPY src /src
COPY tsconfig.json /tsconfig.json
COPY package.json /package.json
COPY package-lock.json /package-lock.json

WORKDIR /src

RUN --mount=type=cache,target=/root/.npm npm install

RUN --mount=type=cache,target=/root/.npm-production npm ci --ignore-scripts --omit-dev

RUN --mount=type=cache,target=/root/.npm-production npm run build


FROM node:22-alpine AS release

COPY --from=builder /build /app/dist
COPY --from=builder /package.json /app/package.json
COPY --from=builder /package-lock.json /app/package-lock.json

ENV NODE_ENV=production

WORKDIR /app

RUN npm ci --ignore-scripts --omit-dev

ENTRYPOINT ["node", "dist/index.js"]
