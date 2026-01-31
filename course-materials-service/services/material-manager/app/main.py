"""
StateX Course Materials Manager Service

Service for managing and serving course materials.
Provides CRUD operations and material serving capabilities.
"""

import os
import sys
import uuid
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
import uvicorn

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

# Import logger
import importlib.util
logger_spec = importlib.util.spec_from_file_location("logger", os.path.join(shared_path, "logger.py"))
logger_module = importlib.util.module_from_spec(logger_spec)
logger_spec.loader.exec_module(logger_module)
logger = logger_module.setup_logger(__name__, service_name="material-manager")

# Initialize FastAPI app
app = FastAPI(
    title="StateX Course Materials Manager",
    description="Service for managing and serving course materials",
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

# In-memory material storage (in production, use database)
materials_db: Dict[str, Dict[str, Any]] = {}

# Request/Response models
class MaterialCreateRequest(BaseModel):
    course_id: str = Field(..., description="Course identifier")
    material_type: str = Field(..., description="Type of material")
    language: str = Field(..., description="Material language")
    title: str = Field(..., description="Material title")
    content: Optional[str] = Field(None, description="Material content")
    metadata: Optional[Dict[str, Any]] = Field(None, description="Additional metadata")

class MaterialUpdateRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

class MaterialResponse(BaseModel):
    material_id: str
    course_id: str
    material_type: str
    language: str
    title: str
    content: Optional[str] = None
    metadata: Dict[str, Any]
    created_at: str
    updated_at: str

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "material-manager",
        "timestamp": datetime.now().isoformat(),
        "materials_count": len(materials_db)
    }

@app.get("/api/materials", response_model=List[MaterialResponse])
async def list_materials(
    course_id: Optional[str] = None,
    material_type: Optional[str] = None,
    language: Optional[str] = None
):
    """List all materials with optional filtering"""
    try:
        materials = list(materials_db.values())
        
        # Apply filters
        if course_id:
            materials = [m for m in materials if m.get("course_id") == course_id]
        if material_type:
            materials = [m for m in materials if m.get("material_type") == material_type]
        if language:
            materials = [m for m in materials if m.get("language") == language]
        
        logger.info(f"Listed {len(materials)} materials", filters={
            "course_id": course_id,
            "material_type": material_type,
            "language": language
        })
        
        return [MaterialResponse(**m) for m in materials]
        
    except Exception as e:
        logger.error(f"Error listing materials: {e}", error=e)
        raise HTTPException(status_code=500, detail=f"Failed to list materials: {str(e)}")

@app.get("/api/materials/{material_id}", response_model=MaterialResponse)
async def get_material(material_id: str):
    """Get material by ID"""
    if material_id not in materials_db:
        raise HTTPException(status_code=404, detail="Material not found")
    
    return MaterialResponse(**materials_db[material_id])

@app.post("/api/materials", response_model=MaterialResponse)
async def create_material(request: MaterialCreateRequest):
    """Create new material"""
    try:
        material_id = f"mat_{uuid.uuid4().hex[:12]}"
        now = datetime.now().isoformat()
        
        material = {
            "material_id": material_id,
            "course_id": request.course_id,
            "material_type": request.material_type,
            "language": request.language,
            "title": request.title,
            "content": request.content,
            "metadata": request.metadata or {},
            "created_at": now,
            "updated_at": now
        }
        
        materials_db[material_id] = material
        
        logger.info(f"Material created: {material_id}", material_id=material_id, course_id=request.course_id)
        
        return MaterialResponse(**material)
        
    except Exception as e:
        logger.error(f"Error creating material: {e}", error=e)
        raise HTTPException(status_code=500, detail=f"Failed to create material: {str(e)}")

@app.put("/api/materials/{material_id}", response_model=MaterialResponse)
async def update_material(material_id: str, request: MaterialUpdateRequest):
    """Update existing material"""
    if material_id not in materials_db:
        raise HTTPException(status_code=404, detail="Material not found")
    
    try:
        material = materials_db[material_id]
        
        if request.title is not None:
            material["title"] = request.title
        if request.content is not None:
            material["content"] = request.content
        if request.metadata is not None:
            material["metadata"].update(request.metadata)
        
        material["updated_at"] = datetime.now().isoformat()
        
        logger.info(f"Material updated: {material_id}", material_id=material_id)
        
        return MaterialResponse(**material)
        
    except Exception as e:
        logger.error(f"Error updating material: {e}", error=e, material_id=material_id)
        raise HTTPException(status_code=500, detail=f"Failed to update material: {str(e)}")

@app.delete("/api/materials/{material_id}")
async def delete_material(material_id: str):
    """Delete material"""
    if material_id not in materials_db:
        raise HTTPException(status_code=404, detail="Material not found")
    
    try:
        del materials_db[material_id]
        logger.info(f"Material deleted: {material_id}", material_id=material_id)
        return {"message": "Material deleted successfully", "material_id": material_id}
        
    except Exception as e:
        logger.error(f"Error deleting material: {e}", error=e, material_id=material_id)
        raise HTTPException(status_code=500, detail=f"Failed to delete material: {str(e)}")

@app.get("/api/materials/{material_id}/download")
async def download_material(material_id: str):
    """Download material content"""
    if material_id not in materials_db:
        raise HTTPException(status_code=404, detail="Material not found")
    
    material = materials_db[material_id]
    content = material.get("content", "")
    
    if not content:
        raise HTTPException(status_code=404, detail="Material content not available")
    
    # Return content as text file
    return StreamingResponse(
        iter([content]),
        media_type="text/plain",
        headers={
            "Content-Disposition": f'attachment; filename="{material["title"]}.txt"'
        }
    )

@app.get("/api/materials/course/{course_id}", response_model=List[MaterialResponse])
async def get_course_materials(course_id: str):
    """Get all materials for a specific course"""
    try:
        course_materials = [
            MaterialResponse(**m) for m in materials_db.values()
            if m.get("course_id") == course_id
        ]
        
        logger.info(f"Retrieved {len(course_materials)} materials for course {course_id}", course_id=course_id)
        
        return course_materials
        
    except Exception as e:
        logger.error(f"Error getting course materials: {e}", error=e, course_id=course_id)
        raise HTTPException(status_code=500, detail=f"Failed to get course materials: {str(e)}")

if __name__ == "__main__":
    port = int(os.getenv("MATERIAL_MANAGER_PORT", "3391"))
    uvicorn.run(app, host="0.0.0.0", port=port)
