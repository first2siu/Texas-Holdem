FROM node:20-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm build
EXPOSE 3000
CMD ["pnpm","start"]
