FROM node:20

RUN apt-get update && apt-get install -y 

COPY . /app

WORKDIR /app

RUN npm install -g tsx

RUN npm ci

RUN npm run common:prod

CMD ["tsx", "src/index.ts"]