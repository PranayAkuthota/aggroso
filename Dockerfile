FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node prisma ./prisma
RUN npm ci && npx prisma generate
COPY --chown=node:node server ./server
ENV NODE_ENV=production
EXPOSE 8000
USER node
CMD ["npm", "start"]
