#!/usr/bin/env bash
set -euo pipefail
cd /workspace/aggroso
export npm_config_cache=/workspace/.npm-cache
npm ci
npm --prefix frontend ci
npm run db:generate
npm --prefix frontend run build
