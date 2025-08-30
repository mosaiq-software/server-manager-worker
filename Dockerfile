FROM node:20

RUN apt-get update && apt-get install -y 

COPY . /app

WORKDIR /app

RUN npm install -g tsx

RUN npm ci

CMD ["tsx", "src/index.ts"]