#!/bin/bash

# Course Materials Microservice Start Script
# Starts all course materials microservice containers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "🚀 Starting Course Materials Microservice"
echo "=================================="

# Check if .env file exists
if [ ! -f .env ]; then
  echo "⚠️  Warning: .env file not found. Using defaults from .env.example"
  if [ -f .env.example ]; then
    echo "📋 Please copy .env.example to .env and configure it"
  fi
fi

# Start services
echo ""
echo "Starting services..."
docker compose -f docker-compose.blue.yml up -d

echo ""
echo "✅ Course Materials Microservice started"
echo ""
echo "Services:"
docker compose -f docker-compose.blue.yml ps

echo ""
echo "To view logs: docker compose -f docker-compose.blue.yml logs -f"
echo "To check status: ./scripts/status.sh"
