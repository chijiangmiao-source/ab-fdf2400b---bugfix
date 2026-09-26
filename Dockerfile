# syntax=docker/dockerfile:1

# ---- 验证阶段：代码测试 + 构建检查 + HTTP 冒烟（冒烟在容器启动时执行） ----
FROM node:20-alpine AS verify
WORKDIR /work
COPY package.json ./
COPY app ./app
COPY tests ./tests
COPY tools ./tools
# 默认命令：跑完整验证流水线，以退出码报告结果
CMD ["npm", "run", "verify"]

# ---- 应用阶段：nginx 托管静态页面 ----
FROM nginx:1.27-alpine AS app
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY app /usr/share/nginx/html
