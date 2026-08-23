FROM node:22-alpine

WORKDIR /app

# 复制依赖定义并安装
COPY package*.json ./
COPY backend/package*.json ./backend/
RUN npm install --prefix backend && npm install --production

# 复制全部项目文件（含预置数据与静态资源）
COPY . .

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "--experimental-sqlite", "backend/api/server.js"]
