#!/bin/bash
# Content Service Deployment Script
# Deploys the content service using nginx-microservice blue/green system.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Load NODE_ENV from .env file to determine environment
NODE_ENV=""
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$PROJECT_ROOT/.env" 2>/dev/null || true
    set +a
    NODE_ENV="${NODE_ENV:-}"
fi

# Deploy only code from repository: sync with remote (discard local changes on server)
# Only sync if NODE_ENV is set to "production"
if [ -d ".git" ]; then
    if [ "$NODE_ENV" = "production" ]; then
        echo -e "${BLUE}Production environment detected (NODE_ENV=production)${NC}"
        echo -e "${BLUE}Syncing with remote repository (discarding local changes)...${NC}"
        git fetch origin
        BRANCH=$(git rev-parse --abbrev-ref HEAD)
        git reset --hard "origin/$BRANCH"
        echo -e "${GREEN}✓ Repository synced to origin/$BRANCH${NC}"
        echo ""
    else
        echo -e "${YELLOW}Development environment detected (NODE_ENV=${NODE_ENV:-not set})${NC}"
        echo -e "${YELLOW}Skipping git sync - local changes will be preserved${NC}"
        echo ""
    fi
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║      Content Service - Production Deployment              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

SERVICE_NAME="speakasap"
DISPLAY_NAME="$(echo "${SERVICE_NAME:0:1}" | tr 'a-z' 'A-Z')${SERVICE_NAME:1}"

NGINX_MICROSERVICE_PATH="${NGINX_MICROSERVICE_PATH:-}"

if [ -z "$NGINX_MICROSERVICE_PATH" ]; then
    if [ -d "/home/statex/nginx-microservice" ]; then
        NGINX_MICROSERVICE_PATH="/home/statex/nginx-microservice"
    elif [ -d "/home/alfares/nginx-microservice" ]; then
        NGINX_MICROSERVICE_PATH="/home/alfares/nginx-microservice"
    elif [ -d "$HOME/nginx-microservice" ]; then
        NGINX_MICROSERVICE_PATH="$HOME/nginx-microservice"
    elif [ -d "$(dirname "$PROJECT_ROOT")/nginx-microservice" ]; then
        NGINX_MICROSERVICE_PATH="$(dirname "$PROJECT_ROOT")/nginx-microservice"
    elif [ -d "$PROJECT_ROOT/../nginx-microservice" ]; then
        NGINX_MICROSERVICE_PATH="$(cd "$PROJECT_ROOT/../nginx-microservice" && pwd)"
    fi
fi

if [ -z "$NGINX_MICROSERVICE_PATH" ] || [ ! -d "$NGINX_MICROSERVICE_PATH" ]; then
    echo -e "${RED}Error: nginx-microservice not found${NC}"
    echo "Set NGINX_MICROSERVICE_PATH or install nginx-microservice in:"
    echo "  - /home/statex/nginx-microservice"
    echo "  - /home/alfares/nginx-microservice"
    echo "  - $HOME/nginx-microservice"
    echo "  - $(dirname "$PROJECT_ROOT")/nginx-microservice"
    exit 1
fi

DEPLOY_SCRIPT="$NGINX_MICROSERVICE_PATH/scripts/blue-green/deploy-smart.sh"
if [ ! -f "$DEPLOY_SCRIPT" ]; then
    echo -e "${RED}Error: deploy-smart.sh not found at $DEPLOY_SCRIPT${NC}"
    exit 1
fi

if [ ! -x "$DEPLOY_SCRIPT" ]; then
    echo -e "${YELLOW}Making deploy-smart.sh executable...${NC}"
    chmod +x "$DEPLOY_SCRIPT"
fi

echo -e "${GREEN}Found nginx-microservice at: $NGINX_MICROSERVICE_PATH${NC}"
echo -e "${GREEN}Deploying service: $SERVICE_NAME${NC}"
echo ""

echo -e "${BLUE}Validating docker-compose files...${NC}"
if [ ! -f "$PROJECT_ROOT/docker-compose.blue.yml" ]; then
    echo -e "${RED}Error: docker-compose.blue.yml not found in $PROJECT_ROOT${NC}"
    exit 1
fi
if [ ! -f "$PROJECT_ROOT/docker-compose.green.yml" ]; then
    echo -e "${RED}Error: docker-compose.green.yml not found in $PROJECT_ROOT${NC}"
    exit 1
fi

if ! docker compose -f "$PROJECT_ROOT/docker-compose.blue.yml" config --quiet 2>/dev/null; then
    echo -e "${RED}Error: docker-compose.blue.yml is invalid${NC}"
    exit 1
fi
if ! docker compose -f "$PROJECT_ROOT/docker-compose.green.yml" config --quiet 2>/dev/null; then
    echo -e "${RED}Error: docker-compose.green.yml is invalid${NC}"
    exit 1
fi

echo -e "${GREEN}Docker-compose files are valid${NC}"
echo ""

echo -e "${YELLOW}Starting blue/green deployment...${NC}"
echo ""

cd "$NGINX_MICROSERVICE_PATH"

if "$DEPLOY_SCRIPT" "$SERVICE_NAME"; then
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ ${DISPLAY_NAME} deployment completed successfully!               ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Check status with:"
    echo "  cd $NGINX_MICROSERVICE_PATH"
    echo "  ./scripts/status-all-services.sh"
    exit 0
else
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ❌ ${DISPLAY_NAME} deployment failed!                                ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Check logs and service health:"
    echo "  cd $NGINX_MICROSERVICE_PATH"
    echo "  ./scripts/blue-green/health-check.sh $SERVICE_NAME"
    exit 1
fi
