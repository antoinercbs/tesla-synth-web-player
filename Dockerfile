# Tesla Coil Synterrupter Web Player — single-container image.
# The NestJS backend serves the built Vue front-end and the /api on one port.

# 1) Build the Vue front-end. VITE_BASE_URL is left empty so the bundle calls the
#    API on the same origin (/api), which is exactly where Nest serves it.
FROM node:22-bookworm AS frontend
WORKDIR /front
COPY tesla-player/package*.json ./
RUN npm ci --legacy-peer-deps
COPY tesla-player/ ./
RUN printf 'VITE_BASE_URL=\n' > .env.production
RUN npm run build

# 2) Build the NestJS backend, then drop dev dependencies for the runtime layer.
FROM node:22-bookworm AS backend
WORKDIR /app
COPY nest-backend/package*.json ./
RUN npm ci
COPY nest-backend/ ./
RUN npm run build
RUN npm prune --omit=dev

# 3) Runtime: just Node + the compiled backend, its prod deps, the schema and the
#    front-end bundle. Database + uploads live in the /data volume (DATA_ROOT).
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000 \
    DATA_ROOT=/data
COPY --from=backend /app/dist ./dist
COPY --from=backend /app/node_modules ./node_modules
COPY --from=backend /app/schema.sql ./schema.sql
COPY --from=frontend /front/dist ./public
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
EXPOSE 5000
VOLUME ["/data"]
ENTRYPOINT ["./docker-entrypoint.sh"]
