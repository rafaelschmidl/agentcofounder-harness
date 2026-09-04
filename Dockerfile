FROM node:22.19.0-bookworm-slim

WORKDIR /challenge
ENV npm_config_cache=/challenge/.npm-cache

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY app-template/package.json app-template/package-lock.json ./app-template/
RUN npm --prefix app-template ci --ignore-scripts

COPY . .
ENV npm_config_offline=true \
    npm_config_audit=false \
    npm_config_fund=false
RUN npm run check \
    && npm run challenge -- --prepare-only \
    && npm --prefix output/app run build \
    && rm -rf output/app \
    && mkdir -p output artifacts \
    && chown -R node:node /challenge

EXPOSE 3000
USER node

ENTRYPOINT ["npm", "run", "challenge", "--"]
