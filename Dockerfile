FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .
EXPOSE 3459
ENV PORT=3459
CMD ["node", "index.js"]
