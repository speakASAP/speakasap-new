#!/bin/bash

# Course Materials Microservice Status Script
# Checks the status of all course materials microservice containers

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

echo "=========================================="
echo "Course Materials Microservice Status"
echo "=========================================="

# Load ports from .env if available
if [ -f .env ]; then
  source .env
fi

MATERIAL_GENERATOR_PORT=${MATERIAL_GENERATOR_PORT:-3390}
MATERIAL_MANAGER_PORT=${MATERIAL_MANAGER_PORT:-3391}

# Check if containers are running
echo ""
echo "📋 Container Status:"
if docker ps --format '{{.Names}}' | grep -q "course-materials-microservice"; then
  echo "✅ Course Materials Microservice containers are running"
  docker ps --filter "name=course-materials-microservice" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
else
  echo "❌ No Course Materials Microservice containers are running"
fi

# Check network
echo ""
echo "🌐 Network Status:"
if docker network inspect nginx-network >/dev/null 2>&1; then
  if docker network inspect nginx-network | grep -q "course-materials-microservice"; then
    echo "✅ Connected to nginx-network"
  else
    echo "⚠️  Not connected to nginx-network"
  fi
else
  echo "⚠️  nginx-network not found"
fi

# Check Material Generator health
echo ""
echo "🏥 Material Generator Health Check:"
if docker ps --format '{{.Names}}' | grep -q "course-materials-microservice-generator"; then
  GENERATOR_CONTAINER=$(docker ps --format '{{.Names}}' | grep "course-materials-microservice-generator" | head -1)
  if docker exec "$GENERATOR_CONTAINER" curl -f "http://localhost:${MATERIAL_GENERATOR_PORT}/health" >/dev/null 2>&1; then
    echo "✅ Material Generator health check passed"
    docker exec "$GENERATOR_CONTAINER" curl -s "http://localhost:${MATERIAL_GENERATOR_PORT}/health" | jq . 2>/dev/null || docker exec "$GENERATOR_CONTAINER" curl -s "http://localhost:${MATERIAL_GENERATOR_PORT}/health"
  else
    echo "⚠️  Material Generator health check failed"
  fi
else
  echo "❌ Material Generator container not running"
fi

# Check Material Manager health
echo ""
echo "🏥 Material Manager Health Check:"
if docker ps --format '{{.Names}}' | grep -q "course-materials-microservice-manager"; then
  MANAGER_CONTAINER=$(docker ps --format '{{.Names}}' | grep "course-materials-microservice-manager" | head -1)
  if docker exec "$MANAGER_CONTAINER" curl -f "http://localhost:${MATERIAL_MANAGER_PORT}/health" >/dev/null 2>&1; then
    echo "✅ Material Manager health check passed"
    docker exec "$MANAGER_CONTAINER" curl -s "http://localhost:${MATERIAL_MANAGER_PORT}/health" | jq . 2>/dev/null || docker exec "$MANAGER_CONTAINER" curl -s "http://localhost:${MATERIAL_MANAGER_PORT}/health"
  else
    echo "⚠️  Material Manager health check failed"
  fi
else
  echo "❌ Material Manager container not running"
fi

# Show recent logs
echo ""
echo "📝 Recent Logs (Material Generator, last 20 lines):"
if docker ps --format '{{.Names}}' | grep -q "course-materials-microservice-generator"; then
  GENERATOR_CONTAINER=$(docker ps --format '{{.Names}}' | grep "course-materials-microservice-generator" | head -1)
  docker logs --tail=20 "$GENERATOR_CONTAINER"
else
  echo "No logs available (container not running)"
fi

echo ""
echo "=========================================="
