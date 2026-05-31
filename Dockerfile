# --- Stage 1: Dependencies ---
FROM node:20-slim AS deps
# Debian slim already includes glibc, no need for compat packages
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: Builder ---
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Disable telemetry during build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Stage 3: Runner (Production) ---
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Hugging Face Spaces standard port is 7860
ENV PORT=7860
ENV HOSTNAME="0.0.0.0"

# The node image already has a built-in user 'node' with UID 1000.
# Hugging Face Spaces requires running as UID 1000, so we use that directly.

# Set up Next.js standalone output copy
COPY --from=builder /app/public ./public
COPY --from=builder --chown=1000:1000 /app/.next/standalone ./
COPY --from=builder --chown=1000:1000 /app/.next/static ./.next/static

USER 1000

EXPOSE 7860

# Start Next.js server
CMD ["node", "server.js"]
