FROM nginx:1.27.0-bookworm

WORKDIR /app

RUN apt-get update
RUN apt-get install -y net-tools nano
RUN rm -rf /var/lib/apt/lists/*

COPY ./public/ ./public/
COPY ./docker/nginx.conf /etc/nginx/

EXPOSE 8080

CMD nginx -g 'daemon off;'
