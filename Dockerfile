FROM node:20

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

COPY . .

RUN useradd -m appuser
USER appuser

EXPOSE 3000

CMD ["node", "--loader", "ts-node/esm", "./src/index.ts"]
