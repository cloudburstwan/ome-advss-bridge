FROM node:20-alpine AS base
WORKDIR /usr/src/app

FROM base AS installer

RUN mkdir /temp/development
COPY package.json /temp/development
COPY package-lock.json /temp/development
RUN cd /temp/development && npm ci

RUN mkdir /temp/production
COPY package.json /temp/production
COPY package-lock.json /temp/production
RUN cd /temp/production && npm ci --omit=dev

FROM base AS builder

RUN npm install -g typescript

COPY src ./src
COPY tsconfig.json .
COPY --from=installer /temp/development/node_modules ./node_modules
RUN tsc

FROM base AS release

COPY --from=builder /usr/src/app/dist .
COPY --from=installer /temp/production/node_modules ./node_modules

EXPOSE 80
ENV NODE_ENV="production"
CMD [ "node", "index.js" ]