FROM buildkite/puppeteer:10.0.0
WORKDIR /app

# Install
COPY package*.json .
ENV NODE_ENV=production
RUN npm install

# Copy
COPY *.js .

CMD [ "node", "server.js" ]
