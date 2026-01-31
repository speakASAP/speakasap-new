"""
StateX Course Materials HTTP Clients

Shared HTTP clients for course materials services to communicate with other StateX services.
Provides unified interface for service-to-service communication.
Supports both Docker container and localhost environments.
"""

import httpx
import asyncio
import logging
import time
from typing import Dict, Any, List
import os

logger = logging.getLogger(__name__)

class BaseServiceClient:
    """Base class for service HTTP clients"""
    
    def __init__(self, base_url: str, timeout: int = 30, retries: int = 3):
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout
        self.retries = retries
        self.client = None
    
    async def __aenter__(self):
        self.client = httpx.AsyncClient(timeout=self.timeout)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()
    
    async def _make_request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Make HTTP request with retry logic"""
        url = f"{self.base_url}{endpoint}"
        
        for attempt in range(self.retries):
            try:
                response = await self.client.request(method, url, **kwargs)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPError as e:
                logger.warning(f"HTTP request failed (attempt {attempt + 1}/{self.retries}): {e}")
                if attempt == self.retries - 1:
                    raise
                await asyncio.sleep(2 ** attempt)  # Exponential backoff
        
        raise Exception("All retry attempts failed")

class AIServiceClient(BaseServiceClient):
    """Client for communicating with AI Microservice"""
    
    def __init__(self, ai_service_url: str = None):
        # Support both Docker and localhost environments
        base_url = ai_service_url or os.getenv("AI_ORCHESTRATOR_URL", "http://ai-microservice:3380")
        super().__init__(base_url)
    
    async def generate_content(self, prompt: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Generate content using AI service"""
        data = {"text": prompt}
        if context:
            data.update(context)
        return await self._make_request("POST", "/api/analyze", json=data)
    
    async def process_submission(self, submission_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process submission through AI orchestrator"""
        return await self._make_request("POST", "/api/process-submission", json=submission_data)
    
    async def health_check(self) -> Dict[str, Any]:
        """Check AI service health"""
        return await self._make_request("GET", "/health")

class NLPServiceClient(BaseServiceClient):
    """Client for communicating with NLP Service"""
    
    def __init__(self, nlp_service_url: str = None):
        # Support both Docker and localhost environments
        base_url = nlp_service_url or os.getenv("NLP_SERVICE_URL", "http://ai-microservice-nlp-service:3381")
        super().__init__(base_url)
    
    async def analyze_text(self, text: str) -> Dict[str, Any]:
        """Analyze text using NLP service"""
        return await self._make_request("POST", "/api/analyze", json={"text": text})
    
    async def generate_text(self, prompt: str, max_length: int = 500) -> Dict[str, Any]:
        """Generate text using NLP service"""
        return await self._make_request("POST", "/api/generate", json={"prompt": prompt, "max_length": max_length})
    
    async def health_check(self) -> Dict[str, Any]:
        """Check NLP service health"""
        return await self._make_request("GET", "/health")

class ContentServiceClient(BaseServiceClient):
    """Client for communicating with speakasap-content-service"""
    
    def __init__(self, content_service_url: str = None):
        # Support both Docker and localhost environments
        base_url = content_service_url or os.getenv("CONTENT_SERVICE_URL", "http://speakasap-content-service:4201")
        super().__init__(base_url)
    
    async def get_content(self, content_id: str) -> Dict[str, Any]:
        """Get content item from content service"""
        return await self._make_request("GET", f"/api/content/{content_id}")
    
    async def search_content(self, query: str, content_type: str = None) -> Dict[str, Any]:
        """Search content in content service"""
        params = {"q": query}
        if content_type:
            params["type"] = content_type
        return await self._make_request("GET", "/api/search", params=params)
    
    async def get_grammar_lessons(self, language: str = None) -> Dict[str, Any]:
        """Get grammar lessons from content service"""
        params = {}
        if language:
            params["language"] = language
        return await self._make_request("GET", "/api/grammar", params=params)
    
    async def get_phonetics_lessons(self, language: str = None) -> Dict[str, Any]:
        """Get phonetics lessons from content service"""
        params = {}
        if language:
            params["language"] = language
        return await self._make_request("GET", "/api/phonetics", params=params)
    
    async def get_dictionary_entry(self, word: str, source_lang: str, target_lang: str) -> Dict[str, Any]:
        """Get dictionary translation from content service"""
        return await self._make_request("GET", f"/api/dictionary/{word}", params={
            "source": source_lang,
            "target": target_lang
        })
    
    async def health_check(self) -> Dict[str, Any]:
        """Check content service health"""
        return await self._make_request("GET", "/health")

class MessengerServiceClient(BaseServiceClient):
    """Client for communicating with Messenger Service (Matrix + LiveKit)"""
    
    def __init__(self, messenger_service_url: str = None):
        # Support both Docker and localhost environments
        base_url = messenger_service_url or os.getenv("MESSENGER_SERVICE_URL", "https://messenger.statex.cz")
        super().__init__(base_url)
        self.matrix_server = os.getenv("MESSENGER_MATRIX_SERVER", base_url)
        self.livekit_url = os.getenv("MESSENGER_LIVEKIT_URL", base_url)
    
    async def create_room(self, room_name: str, room_type: str = "course", participants: List[str] = None) -> Dict[str, Any]:
        """Create a Matrix room for course communication"""
        # This would integrate with Matrix API to create rooms
        # For course materials: create rooms for student-teacher or student-AI communication
        return await self._make_request("POST", "/_matrix/client/v3/createRoom", json={
            "name": room_name,
            "room_version": "10",
            "preset": "private_chat" if room_type == "chat" else "public_chat",
            "initial_state": [
                {
                    "type": "m.room.topic",
                    "content": {"topic": f"Course communication: {room_name}"}
                }
            ],
            "invite": participants or []
        })
    
    async def send_message(self, room_id: str, message: str, message_type: str = "m.text") -> Dict[str, Any]:
        """Send a message to a Matrix room"""
        txn_id = f"m{int(time.time() * 1000)}"
        return await self._make_request("PUT", f"/_matrix/client/v3/rooms/{room_id}/send/{message_type}/{txn_id}", json={
            "body": message,
            "msgtype": message_type
        })
    
    async def create_voice_call(self, room_id: str, participants: List[str]) -> Dict[str, Any]:
        """Create a LiveKit voice call session"""
        # LiveKit integration for voice calls
        return await self._make_request("POST", "/livekit/api/room", json={
            "name": room_id,
            "empty_timeout": 300,
            "max_participants": len(participants) + 1
        })
    
    async def create_video_call(self, room_id: str, participants: List[str]) -> Dict[str, Any]:
        """Create a LiveKit video call session"""
        # LiveKit integration for video calls
        return await self._make_request("POST", "/livekit/api/room", json={
            "name": room_id,
            "empty_timeout": 300,
            "max_participants": len(participants) + 1,
            "video_codec": "vp8"
        })
    
    async def get_room_messages(self, room_id: str, limit: int = 50) -> Dict[str, Any]:
        """Get messages from a Matrix room"""
        return await self._make_request("GET", f"/_matrix/client/v3/rooms/{room_id}/messages", params={
            "dir": "b",
            "limit": limit
        })
    
    async def health_check(self) -> Dict[str, Any]:
        """Check messenger service health"""
        return await self._make_request("GET", "/_matrix/client/versions")
