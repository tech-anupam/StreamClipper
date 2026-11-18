FROM node:20-slim AS base

# Install ffmpeg and streamlink
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg=7:6.1.* \
    python3 python3-pip \
    && pip3 install --break-system-packages streamlink==7.1.* yt-dlp==2024.12.* \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Verify installations
RUN ffmpeg -version | head -1 && streamlink --version && yt-dlp --version

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate

# Copy workspace root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @streamclipper/worker...

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/worker/ apps/worker/

# Build
RUN pnpm --filter @streamclipper/shared build
RUN pnpm --filter @streamclipper/worker build

# Create buffer/clip directories
RUN mkdir -p /data/buffers /data/clips /data/tmp

ENV BUFFER_DIR=/data/buffers
ENV CLIPS_DIR=/data/clips
ENV TEMP_DIR=/data/tmp
ENV NODE_ENV=production

EXPOSE 9090

CMD ["node", "apps/worker/dist/index.js"]
