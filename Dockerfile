FROM node:22-alpine
# Vom GitHub-Workflow gesetzt, für die Versionsanzeige
ARG GIT_SHA=""
ARG REPO_URL=""
ENV GIT_SHA=$GIT_SHA REPO_URL=$REPO_URL
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY seed ./seed
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
