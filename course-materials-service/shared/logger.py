"""
Centralized Logger for Course Materials Microservice

Sends logs to external centralized logging microservice.
Falls back to local file logging if service is unavailable.
"""

import logging
import os
import sys
import httpx
import asyncio
import traceback
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone

class CentralizedLogger:
    """
    Logger that sends logs to centralized logging microservice.

    Features:
    - Dual logging: sends logs to external service and writes locally as fallback
    - Non-blocking: HTTP requests don't block application execution
    - Fallback: if the logging service is unavailable, falls back to local files
    - Metadata: includes context and stack traces in log metadata
    - Service identification: all logs tagged with service name
    """
    
    def __init__(self, name: str, service_name: str, log_level: str = "INFO"):
        self.name = name
        self.service_name = service_name
        self.log_level = log_level
        # Get logging service URL from environment
        # Production: https://logging.statex.cz
        # Docker/Development: http://logging-microservice:3367
        self.logging_service_url = os.getenv("LOGGING_SERVICE_URL", "https://logging.statex.cz")
        self.logging_service_api_path = os.getenv("LOGGING_SERVICE_API_PATH", "/api/logs")
        
        # Setup local logger
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, log_level.upper(), logging.INFO))
        
        # Clear existing handlers to avoid duplicates
        self.logger.handlers = []
        
        # Timestamp format
        timestamp_format = os.getenv('LOG_TIMESTAMP_FORMAT', '%Y-%m-%d %H:%M:%S')
        log_format = f'%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        formatter = logging.Formatter(log_format, datefmt=timestamp_format)
        
        # Console handler
        if os.getenv('LOG_TO_CONSOLE', 'true').lower() == 'true':
            console_handler = logging.StreamHandler(sys.stdout)
            console_handler.setFormatter(formatter)
            self.logger.addHandler(console_handler)
        
        # File handler (fallback) - only if directory is writable
        if os.getenv('LOG_TO_FILE', 'true').lower() == 'true':
            log_dir = Path("/app/logs") if Path("/app/logs").exists() else Path("./logs")
            try:
                log_dir.mkdir(exist_ok=True, mode=0o755)
                log_file = log_dir / f'{service_name}.log'
                # Test if we can write to the directory
                test_file = log_dir / '.test_write'
                try:
                    test_file.touch()
                    test_file.unlink()
                    file_handler = logging.FileHandler(log_file)
                    file_handler.setFormatter(formatter)
                    self.logger.addHandler(file_handler)
                except (PermissionError, OSError):
                    # Directory not writable, skip file logging
                    pass
            except (PermissionError, OSError):
                # Cannot create directory, skip file logging
                pass
    
    def _map_log_level(self, level: str) -> str:
        """Map internal log levels to logging-microservice API format"""
        level_map = {
            "DEBUG": "debug",
            "INFO": "info",
            "WARNING": "warn",
            "ERROR": "error",
            "CRITICAL": "error"
        }
        return level_map.get(level.upper(), "info")

    def _send_to_centralized(self, level: str, message: str, **kwargs):
        """Send log to centralized logging service"""
        if not self.logging_service_url:
            return
            
        try:
            # Prepare metadata with all kwargs
            metadata = dict(kwargs)
            
            # Add stack trace to metadata if exception is present
            if "error" in kwargs and isinstance(kwargs["error"], Exception):
                metadata["error"] = str(kwargs["error"])
                metadata["stack"] = "".join(traceback.format_exception(
                    type(kwargs["error"]),
                    kwargs["error"],
                    kwargs["error"].__traceback__
                ))
            elif "exc_info" in kwargs and kwargs["exc_info"]:
                # Handle exc_info tuple from logging
                exc_type, exc_value, exc_traceback = kwargs["exc_info"]
                metadata["error"] = str(exc_value)
                metadata["stack"] = "".join(traceback.format_exception(
                    exc_type, exc_value, exc_traceback
                ))
            
            # Build log data according to logging-microservice API format
            log_data = {
                "level": self._map_log_level(level),
                "message": message,
                "service": self.service_name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "metadata": metadata
            }
            
            # Send asynchronously (fire and forget) if event loop exists
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    asyncio.create_task(self._async_send(log_data))
                else:
                    loop.run_until_complete(self._async_send(log_data))
            except RuntimeError:
                # No event loop, skip centralized logging
                pass
            
        except Exception:
            # Fallback to local logging if centralized fails
            pass
    
    async def _async_send(self, log_data: dict):
        """Asynchronously send log data to centralized service"""
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                await client.post(
                    f"{self.logging_service_url}{self.logging_service_api_path}",
                    json=log_data,
                )
        except Exception:
            # Silent fail - don't spam logs with logging errors
            pass
    
    def debug(self, message: str, **kwargs):
        self.logger.debug(message)
        self._send_to_centralized("DEBUG", message, **kwargs)
    
    def info(self, message: str, **kwargs):
        self.logger.info(message)
        self._send_to_centralized("INFO", message, **kwargs)
    
    def warning(self, message: str, **kwargs):
        self.logger.warning(message)
        self._send_to_centralized("WARNING", message, **kwargs)
    
    def error(self, message: str, **kwargs):
        # Automatically capture stack trace for errors if Exception is provided
        error_kwargs = dict(kwargs)
        if isinstance(message, Exception):
            error_kwargs["error"] = str(message)
            error_kwargs["stack"] = "".join(traceback.format_exception(
                type(message), message, message.__traceback__
            ))
            self.logger.error(str(message), exc_info=True)
            self._send_to_centralized("ERROR", str(message), **error_kwargs)
        elif "error" in kwargs and isinstance(kwargs["error"], Exception):
            error_kwargs["error"] = str(kwargs["error"])
            error_kwargs["stack"] = "".join(traceback.format_exception(
                type(kwargs["error"]),
                kwargs["error"],
                kwargs["error"].__traceback__
            ))
            self.logger.error(message, exc_info=True)
            self._send_to_centralized("ERROR", message, **error_kwargs)
        else:
            self.logger.error(message)
            self._send_to_centralized("ERROR", message, **kwargs)
    
    def critical(self, message: str, **kwargs):
        # Automatically capture stack trace for critical errors if Exception is provided
        error_kwargs = dict(kwargs)
        if isinstance(message, Exception):
            error_kwargs["error"] = str(message)
            error_kwargs["stack"] = "".join(traceback.format_exception(
                type(message), message, message.__traceback__
            ))
            self.logger.critical(str(message), exc_info=True)
            self._send_to_centralized("CRITICAL", str(message), **error_kwargs)
        elif "error" in kwargs and isinstance(kwargs["error"], Exception):
            error_kwargs["error"] = str(kwargs["error"])
            error_kwargs["stack"] = "".join(traceback.format_exception(
                type(kwargs["error"]),
                kwargs["error"],
                kwargs["error"].__traceback__
            ))
            self.logger.critical(message, exc_info=True)
            self._send_to_centralized("CRITICAL", message, **error_kwargs)
        else:
            self.logger.critical(message)
            self._send_to_centralized("CRITICAL", message, **kwargs)

def setup_logger(
    name: str,
    service_name: Optional[str] = None,
    log_level: Optional[str] = None
) -> CentralizedLogger:
    """
    Setup centralized logger with timestamps
    
    Args:
        name: Logger name (usually __name__)
        service_name: Service identifier for log file naming
        log_level: Override log level (defaults to env LOG_LEVEL or INFO)
    
    Returns:
        Configured centralized logger instance
    """
    level = log_level or os.getenv('LOG_LEVEL', 'INFO')
    return CentralizedLogger(name, service_name or "unknown", level)
