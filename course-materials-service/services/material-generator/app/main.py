"""
StateX Course Materials Generator Service

AI-powered service for generating course materials.
Integrates with AI-microservice for intelligent content generation.
"""

import os
import sys
import uuid
import asyncio
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime
from enum import Enum

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import httpx

# Add the shared directory to Python path
current_dir = Path(__file__).parent.resolve()
possible_paths = [
    current_dir.parent.parent.parent / "shared",  # Development: /app/../shared
    Path("/app") / "shared",  # Container: /app/shared
]

shared_path = None
for path in possible_paths:
    logger_file = path / "logger.py"
    if logger_file.exists():
        shared_path = str(path)
        break

if shared_path is None:
    raise FileNotFoundError("Could not find logger.py in any expected location. Tried: " + str(possible_paths))

if shared_path not in sys.path:
    sys.path.append(shared_path)

# Import logger and HTTP clients
import importlib.util
logger_spec = importlib.util.spec_from_file_location("logger", os.path.join(shared_path, "logger.py"))
logger_module = importlib.util.module_from_spec(logger_spec)
logger_spec.loader.exec_module(logger_module)
logger = logger_module.setup_logger(__name__, service_name="material-generator")

http_clients_spec = importlib.util.spec_from_file_location("http_clients", os.path.join(shared_path, "http_clients.py"))
http_clients_module = importlib.util.module_from_spec(http_clients_spec)
http_clients_spec.loader.exec_module(http_clients_module)
AIServiceClient = http_clients_module.AIServiceClient
NLPServiceClient = http_clients_module.NLPServiceClient
ContentServiceClient = http_clients_module.ContentServiceClient

# Initialize FastAPI app
app = FastAPI(
    title="StateX Course Materials Generator",
    description="AI-powered service for generating course materials",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job storage (in production, use database)
generation_jobs: Dict[str, Dict[str, Any]] = {}

# Request/Response models
class MaterialGenerationRequest(BaseModel):
    course_id: str = Field(..., description="Course identifier")
    material_type: str = Field(..., description="Type of material (lesson, exercise, homework, etc.)")
    language: str = Field(..., description="Target language")
    level: Optional[str] = Field(None, description="Course level")
    topic: Optional[str] = Field(None, description="Topic or theme")
    requirements: Optional[str] = Field(None, description="Specific requirements or instructions")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context")

class BatchGenerationRequest(BaseModel):
    materials: List[MaterialGenerationRequest] = Field(..., description="List of materials to generate")

class GenerationStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"

class GenerationJobResponse(BaseModel):
    job_id: str
    status: GenerationStatus
    created_at: str
    estimated_completion: Optional[str] = None

class MaterialResult(BaseModel):
    job_id: str
    material_id: str
    content: Dict[str, Any]
    metadata: Dict[str, Any]
    generated_at: str

# AI Service clients
ai_client = AIServiceClient()
nlp_client = NLPServiceClient()
content_client = ContentServiceClient()

async def generate_material_async(job_id: str, request: MaterialGenerationRequest):
    """Async material generation using AI services"""
    try:
        generation_jobs[job_id]["status"] = GenerationStatus.PROCESSING
        generation_jobs[job_id]["updated_at"] = datetime.now().isoformat()
        
        logger.info(f"Starting material generation for job {job_id}", job_id=job_id, course_id=request.course_id)
        
        # Build prompt for AI generation
        prompt = f"Generate {request.material_type} material for course {request.course_id}"
        if request.topic:
            prompt += f" on topic: {request.topic}"
        if request.level:
            prompt += f" at level: {request.level}"
        if request.requirements:
            prompt += f". Requirements: {request.requirements}"
        prompt += f" in {request.language} language."
        
        # Use NLP service to generate content
        try:
            nlp_response = await nlp_client.generate_text(prompt, max_length=2000)
            generated_content = nlp_response.get("text", "")
            
            # Create material structure
            material_id = f"mat_{uuid.uuid4().hex[:12]}"
            material = {
                "material_id": material_id,
                "course_id": request.course_id,
                "material_type": request.material_type,
                "language": request.language,
                "content": generated_content,
                "metadata": {
                    "level": request.level,
                    "topic": request.topic,
                    "requirements": request.requirements,
                    "context": request.context or {},
                    "ai_generated": True,
                    "generated_at": datetime.now().isoformat()
                }
            }
            
            generation_jobs[job_id]["status"] = GenerationStatus.COMPLETED
            generation_jobs[job_id]["result"] = material
            generation_jobs[job_id]["updated_at"] = datetime.now().isoformat()
            
            logger.info(f"Material generation completed for job {job_id}", job_id=job_id, material_id=material_id)
            
        except Exception as e:
            logger.error(f"AI service error during generation: {e}", error=e, job_id=job_id)
            generation_jobs[job_id]["status"] = GenerationStatus.FAILED
            generation_jobs[job_id]["error"] = str(e)
            generation_jobs[job_id]["updated_at"] = datetime.now().isoformat()
            
    except Exception as e:
        logger.error(f"Error in material generation: {e}", error=e, job_id=job_id)
        generation_jobs[job_id]["status"] = GenerationStatus.FAILED
        generation_jobs[job_id]["error"] = str(e)
        generation_jobs[job_id]["updated_at"] = datetime.now().isoformat()

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "material-generator",
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/generate", response_model=GenerationJobResponse)
async def generate_material(
    request: MaterialGenerationRequest,
    background_tasks: BackgroundTasks
):
    """Generate course material using AI"""
    try:
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        
        generation_jobs[job_id] = {
            "job_id": job_id,
            "status": GenerationStatus.PENDING,
            "request": request.dict(),
            "created_at": datetime.now().isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        
        # Start background generation
        background_tasks.add_task(generate_material_async, job_id, request)
        
        logger.info(f"Material generation job created: {job_id}", job_id=job_id, course_id=request.course_id)
        
        return GenerationJobResponse(
            job_id=job_id,
            status=GenerationStatus.PENDING,
            created_at=generation_jobs[job_id]["created_at"]
        )
        
    except Exception as e:
        logger.error(f"Error creating generation job: {e}", error=e)
        raise HTTPException(status_code=500, detail=f"Failed to create generation job: {str(e)}")

@app.post("/api/generate/batch", response_model=List[GenerationJobResponse])
async def generate_materials_batch(
    request: BatchGenerationRequest,
    background_tasks: BackgroundTasks
):
    """Generate multiple materials in batch"""
    try:
        jobs = []
        for material_request in request.materials:
            job_id = f"job_{uuid.uuid4().hex[:12]}"
            
            generation_jobs[job_id] = {
                "job_id": job_id,
                "status": GenerationStatus.PENDING,
                "request": material_request.dict(),
                "created_at": datetime.now().isoformat(),
                "updated_at": datetime.now().isoformat()
            }
            
            background_tasks.add_task(generate_material_async, job_id, material_request)
            jobs.append(GenerationJobResponse(
                job_id=job_id,
                status=GenerationStatus.PENDING,
                created_at=generation_jobs[job_id]["created_at"]
            ))
        
        logger.info(f"Batch generation created: {len(jobs)} jobs")
        return jobs
        
    except Exception as e:
        logger.error(f"Error creating batch generation: {e}", error=e)
        raise HTTPException(status_code=500, detail=f"Failed to create batch generation: {str(e)}")

@app.get("/api/generate/status/{job_id}", response_model=Dict[str, Any])
async def get_generation_status(job_id: str):
    """Get generation job status"""
    if job_id not in generation_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = generation_jobs[job_id]
    return {
        "job_id": job_id,
        "status": job["status"],
        "created_at": job["created_at"],
        "updated_at": job["updated_at"],
        "error": job.get("error")
    }

@app.get("/api/generate/result/{job_id}", response_model=MaterialResult)
async def get_generation_result(job_id: str):
    """Get generated material result"""
    if job_id not in generation_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = generation_jobs[job_id]
    
    if job["status"] != GenerationStatus.COMPLETED:
        raise HTTPException(status_code=400, detail=f"Job not completed. Status: {job['status']}")
    
    if "result" not in job:
        raise HTTPException(status_code=404, detail="Result not found")
    
    result = job["result"]
    return MaterialResult(
        job_id=job_id,
        material_id=result["material_id"],
        content=result["content"],
        metadata=result["metadata"],
        generated_at=result["metadata"]["generated_at"]
    )

if __name__ == "__main__":
    port = int(os.getenv("MATERIAL_GENERATOR_PORT", "3390"))
    uvicorn.run(app, host="0.0.0.0", port=port)
