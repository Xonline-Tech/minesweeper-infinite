FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY public ./public

USER node
ENV PORT=8420
EXPOSE 8420

CMD ["node", "server.js"]
