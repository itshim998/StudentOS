FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3101

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY backend ./backend
COPY scripts ./scripts
COPY supabase ./supabase
COPY README.md ./README.md

EXPOSE 3101
CMD ["npm", "start"]
