FROM node:20-alpine AS build
WORKDIR /app
# Alpine's base image ships no system OpenSSL at all (Node vendors its own,
# statically linked into the node binary itself). Prisma's query engine is a
# separate native binary that dynamically links against the system one, so
# without this it's missing regardless of which engine variant gets built.
RUN apk add --no-cache openssl
COPY package.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
EXPOSE 4000
CMD ["node", "dist/index.js"]
