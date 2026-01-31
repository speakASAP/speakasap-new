# Course Materials Microservice

Centralized service for generating and managing course materials. Integrates with AI-microservice for intelligent content generation and provides comprehensive material management capabilities.

**Note**: This microservice is part of the content ecosystem and works alongside `speakasap-content-service`. While `speakasap-content-service` handles general learning content (grammar, phonetics, dictionary, songs), this service focuses specifically on course-specific materials that are tied to individual courses and curricula.

## Features

- ✅ **Material Generator** - AI-powered course material generation
- ✅ **Material Manager** - Course material management and serving
- ✅ **AI Integration** - Seamless integration with AI-microservice
- ✅ **Messenger Integration** - Chat, voice, and video calls for education and communication
- ✅ **Shared Database** - All materials data stored in shared database-server
- ✅ **Centralized Logging** - All logs sent to logging-microservice
- ✅ **Blue/Green Deployment** - Zero-downtime deployments

## Technology Stack

- **Framework**: FastAPI (Python)
- **Database**: PostgreSQL (via shared database-server)
- **Cache**: Redis (via shared database-server)
- **Logging**: External centralized logging microservice
- **Network**: nginx-network (shared Docker network)

## Port Configuration

**Port Range**: 339x (course materials microservices)

| Service | Host Port | Container Port | .env Variable | Description |
| ------- | --------- | -------------- | ------------- | ----------- |
| **Material Generator** | `${MATERIAL_GENERATOR_PORT:-3390}` | `${MATERIAL_GENERATOR_PORT:-3390}` | `MATERIAL_GENERATOR_PORT` | AI-powered material generation |
| **Material Manager** | `${MATERIAL_MANAGER_PORT:-3391}` | `${MATERIAL_MANAGER_PORT:-3391}` | `MATERIAL_MANAGER_PORT` | Material management and serving |

**Note**: All ports are configured in `course-materials-microservice/.env`. The values shown are defaults.

## Access Methods

### Production Access (HTTPS)

```bash
# Material Generator
curl https://course-materials.statex.cz/health

# Material Manager
curl https://course-materials.statex.cz/api/materials
```

### Docker Network Access

```bash
# From within a container on nginx-network
curl http://course-materials-microservice:${MATERIAL_GENERATOR_PORT:-3390}/health
curl http://course-materials-microservice:${MATERIAL_MANAGER_PORT:-3391}/health
```

### SSH Access

```bash
# Connect to production server
ssh statex

# Access microservice directory
cd /home/statex/course-materials-microservice
```

## Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Service Domain - Used by nginx-microservice for auto-registry (required for correct domain detection)
DOMAIN=course-materials.statex.cz

# Service Name - Used for logging and service identification
SERVICE_NAME=course-materials-microservice

# Port Configuration
MATERIAL_GENERATOR_PORT=3390
MATERIAL_MANAGER_PORT=3391

# Database (Shared)
DB_HOST=db-server-postgres
DB_PORT=5432
DB_USER=dbadmin
DB_PASSWORD=<password>
DB_NAME=statex_course_materials

# Redis (Shared)
REDIS_HOST=db-server-redis
REDIS_SERVER_PORT=6379

# Logging Service (Shared)
LOGGING_SERVICE_URL=https://logging.statex.cz

# AI Microservice Integration
AI_ORCHESTRATOR_URL=http://ai-microservice:3380
NLP_SERVICE_URL=http://ai-microservice-nlp-service:3381

# Messenger Service Integration
MESSENGER_SERVICE_URL=https://messenger.statex.cz
MESSENGER_MATRIX_SERVER=https://messenger.statex.cz
MESSENGER_LIVEKIT_URL=https://messenger.statex.cz
```

## Quick Start

### Start Services

```bash
cd course-materials-microservice
./scripts/start.sh
```

### Check Status

```bash
./scripts/status.sh
```

### Stop Services

```bash
./scripts/stop.sh
```

### View Logs

```bash
docker compose -f docker-compose.blue.yml logs -f
```

## API Endpoints

### Material Generator

- `POST /api/generate` - Generate course materials using AI
- `POST /api/generate/batch` - Generate multiple materials in batch
- `GET /api/generate/status/{job_id}` - Check generation status
- `GET /api/generate/result/{job_id}` - Get generated material
- `GET /health` - Health check

### Material Manager

- `GET /api/materials` - List all materials
- `GET /api/materials/{material_id}` - Get material details
- `POST /api/materials` - Create/upload material
- `PUT /api/materials/{material_id}` - Update material
- `DELETE /api/materials/{material_id}` - Delete material
- `GET /api/materials/{material_id}/download` - Download material
- `GET /api/materials/course/{course_id}` - Get materials for course
- `GET /health` - Health check

## Integration

Applications use the course materials microservice via HTTP:

```python
# Production
COURSE_MATERIALS_SERVICE_URL=https://course-materials.statex.cz

# Docker Network
COURSE_MATERIALS_SERVICE_URL=http://course-materials-microservice:3390
MATERIAL_MANAGER_URL=http://course-materials-microservice:3391
```

## Shared Services

### Database

All course materials data, generation jobs, and related information are stored in the shared database:

- **Database Server**: `db-server-postgres` (Docker network)
- **Database Name**: `statex_course_materials`
- **Connection**: All services connect to shared `db-server-postgres:5432`

### Logging

All services send logs to the centralized logging microservice:

- **Production URL**: `https://logging.statex.cz`
- **Docker Network URL**: `http://logging-microservice:3367`
- **API Endpoint**: `POST /api/logs`
- **Fallback**: Local log files if logging service unavailable

### AI Microservice Integration

The material generator integrates with AI-microservice for content generation:

- **AI Orchestrator**: `http://ai-microservice:3380`
- **NLP Service**: `http://ai-microservice-nlp-service:3381`
- Used for intelligent content generation, translations, and material enhancement

### Content Service Integration

This microservice complements `speakasap-content-service`:

- **Content Service**: General learning content (grammar, phonetics, dictionary, songs) - reusable across courses
- **Course Materials Service**: Course-specific materials tied to specific courses and curricula
- Both services use AI-microservice for content generation
- Course materials can reference general content from content-service

### Messenger Service Integration

This microservice integrates with `messenger` service for real-time communication:

- **Chat Functionality**: Matrix-based messaging for student-teacher and student-AI communication
- **Voice Calls**: LiveKit-powered voice calls for lessons and support
- **Video Calls**: LiveKit-powered video calls for interactive lessons
- **Education Process**: Real-time communication during course delivery
- **Helpdesk Integration**: Support communication integrated with helpdesk system
- **AI Communication**: Direct communication channels between students and AI assistants

**Use Cases:**
- Student-teacher communication during lessons
- AI assistant chat for course material questions
- Voice/video lessons and tutoring sessions
- Helpdesk support integration
- Group study rooms and collaboration

## Blue/Green Deployment

The microservice supports blue/green deployments:

- **Blue**: `docker-compose.blue.yml`
- **Green**: `docker-compose.green.yml`

Switch between deployments by updating nginx configuration.

## Documentation

- **Main README**: See main `README.md` for ecosystem overview
- **Content Service Integration**: See `docs/CONTENT_SERVICE_INTEGRATION.md`
- **Messenger Service Integration**: See `docs/MESSENGER_SERVICE_INTEGRATION.md`

## Support

For issues or questions:

- Check service logs: `docker compose logs <service-name>`
- Verify network connectivity: `docker network inspect nginx-network`
- Check health endpoints: `curl https://course-materials.statex.cz/health`

---

**Course Materials Microservice** - Intelligent course material generation and management 🎓
