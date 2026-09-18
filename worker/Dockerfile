# Phase 35.5: SequrAI Security Execution Worker.
#
# A SEPARATE deployable from the Next.js/Vercel application -- built and run
# independently. Bundled via `npm run build:security-worker` (esbuild) into
# a single CJS file; this image only needs Node + the two pinned security
# engine binaries, never the Next.js build toolchain.
#
# Hardening (Phase 35.5 section 42):
#  - non-root user
#  - no --privileged, no host Docker socket, no host filesystem mount, no
#    host network (none requested by this image; enforce at `docker run`/
#    orchestrator level -- this Dockerfile makes no assumption it will be
#    granted any of those)
#  - dropped Linux capabilities left to the orchestrator (`--cap-drop=ALL`
#    is safe for this image: it never binds a privileged port, never needs
#    CAP_NET_RAW, CAP_SYS_ADMIN, or any other capability)
#  - a per-job, single-use temporary workspace under /tmp/sequrai (see
#    server/security-engines/subprocess/safe-exec.ts) -- never a shared or
#    persistent writable volume

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# package.json's "postinstall" runs `prisma generate`, which `npm ci` below
# triggers automatically -- it needs the schema present, so copy it in before
# `npm ci` rather than after (the schema itself changes far less often than
# app source, so this doesn't meaningfully hurt layer-cache reuse).
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npm run build:security-worker

FROM node:22-bookworm-slim
WORKDIR /app

# --- Pinned security engine binaries -----------------------------------
# Versions MUST match server/security-engines/{opengrep,trivy}/engine.ts's
# OPENGREP_VERSION / TRIVY_VERSION constants exactly (section 19: the
# worker's own healthCheck() reports the detected version -- a mismatch
# here is a deployment bug, not silently tolerated).
ARG OPENGREP_VERSION=1.30.0
ARG TRIVY_VERSION=0.74.0

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tar && \
    rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then OG_ARCH=aarch64; else OG_ARCH=x86; fi && \
    curl -sSL -o /tmp/opengrep.tar.gz \
      "https://github.com/opengrep/opengrep/releases/download/v${OPENGREP_VERSION}/opengrep-core_linux_${OG_ARCH}.tar.gz" && \
    tar -xzf /tmp/opengrep.tar.gz -C /usr/local/bin && \
    chmod +x /usr/local/bin/opengrep-core && \
    rm /tmp/opengrep.tar.gz

RUN ARCH=$(dpkg --print-architecture) && \
    curl -sSL -o /tmp/trivy.tar.gz \
      "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" && \
    tar -xzf /tmp/trivy.tar.gz -C /usr/local/bin trivy && \
    chmod +x /usr/local/bin/trivy && \
    rm /tmp/trivy.tar.gz

# --- Non-root ------------------------------------------------------------
RUN groupadd -r sequrai && useradd -r -g sequrai -d /app -s /usr/sbin/nologin sequrai
RUN mkdir -p /tmp/sequrai /home/sequrai/.cache/trivy && \
    chown -R sequrai:sequrai /app /tmp/sequrai /home/sequrai

COPY --from=builder --chown=sequrai:sequrai /app/worker/dist/worker-bundle.cjs /app/worker-bundle.cjs
COPY --from=builder --chown=sequrai:sequrai /app/server/security-engines/opengrep/rules /app/server/security-engines/opengrep/rules

USER sequrai
ENV NODE_ENV=production \
    HOME=/home/sequrai \
    OPENGREP_BINARY_PATH=/usr/local/bin/opengrep-core \
    OPENGREP_RULES_PATH=/app/server/security-engines/opengrep/rules/taint-rules.yaml \
    TRIVY_BINARY_PATH=/usr/local/bin/trivy \
    TRIVY_CACHE_DIR=/home/sequrai/.cache/trivy \
    SECURITY_WORKER_HEALTH_PORT=8080

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

ENTRYPOINT ["node", "/app/worker-bundle.cjs"]
