# BUILD

FROM node:20.12.2-bookworm AS build

WORKDIR /app

COPY . .

RUN npm install
RUN npm run build

# RUN

FROM node:20.12.2-bookworm AS run

WORKDIR /app

RUN apt-get update
RUN apt-get install -y chromium=126.0.6478.182-1~deb12u1

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist/ ./dist/
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/bin/cli.js ./bin/
COPY ./test/docker/ssr-proxy-js.config.json .

EXPOSE 8081

CMD node ./bin/cli.js -c ./ssr-proxy-js.config.json
