FROM node:20-alpine AS base
WORKDIR /usr/src/app

FROM base AS installer

RUN mkdir /tmp/development
COPY package.json /tmp/development
COPY package-lock.json /tmp/development
RUN cd /tmp/development && npm ci

RUN mkdir /tmp/production
COPY package.json /tmp/production
COPY package-lock.json /tmp/production
RUN cd /tmp/production && npm ci --omit=dev

FROM base AS builder

RUN npm install -g typescript

COPY src ./src
COPY tsconfig.json .
COPY --from=installer /tmp/development/node_modules ./node_modules
RUN tsc

FROM base AS release

COPY --from=builder /usr/src/app/dist .
COPY --from=installer /tmp/production/node_modules ./node_modules

EXPOSE 80
ENV NODE_ENV="production"
CMD [ "node", "index.js" ]