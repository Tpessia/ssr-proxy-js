FROM node:20.12.2-bookworm

WORKDIR /app

RUN apt-get update

RUN apt-get install -y chromium=126.0.6478.182-1~deb12u1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
COPY ./package.json .
COPY ./ssr-proxy-js.config.json .

RUN ls -la .

RUN rm -rf /var/lib/apt/lists/*

EXPOSE 8080

CMD ["npm", "run", "start:npx"]
