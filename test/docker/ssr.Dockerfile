# BUILD

FROM node:20.12.2-bookworm AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# RUN

FROM node:20.12.2-bookworm AS run

WORKDIR /app

RUN apt-get update
# RUN apt search ^chromium$ && exit 1
RUN apt-get install -y chromium
RUN apt-get install -y gettext-base moreutils
RUN rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# # https://stackoverflow.com/a/71128432
# RUN apt-get update
# RUN apt-get install -y ca-certificates fonts-liberation \
#     libappindicator3-1 libasound2 libatk-bridge2.0-0 libatk1.0-0 \
#     libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 \
#     libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
#     libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 \
#     libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 \
#     libxi6 libxrandr2 libxrender1 libxss1 libxtst6 lsb-release wget xdg-utils
# RUN rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist/ ./dist/
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/bin/cli.js ./bin/
COPY ./test/docker/ssr-proxy-js.config.json .

EXPOSE 8081

CMD node ./bin/cli.js -c ./ssr-proxy-js.config.json
