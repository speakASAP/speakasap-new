"""
Notification Client for SpeakASAP

This client provides a Python interface to the notifications-microservice API.
All email communication from speakasap.com goes through notifications-microservice
using AWS SES provider.

Python 3.4+ compatible (no f-strings, use .format() or % formatting).
"""

import os
import requests
import logging

logger = logging.getLogger(__name__)

# Default notification service URL
NOTIFICATION_SERVICE_URL = os.getenv(
    'NOTIFICATION_SERVICE_URL',
    'https://notifications.statex.cz'
)

# Default timeout in seconds
NOTIFICATION_SERVICE_TIMEOUT = int(os.getenv('NOTIFICATION_SERVICE_TIMEOUT', '10'))


class NotificationClient(object):
    """Client for sending notifications via notifications-microservice"""

    def __init__(self, base_url=None, timeout=None):
        """Initialize notification client

        Args:
            base_url: Base URL for notifications-microservice (optional)
            timeout: Request timeout in seconds (optional)
        """
        self.base_url = base_url or NOTIFICATION_SERVICE_URL
        self.timeout = timeout if timeout is not None else NOTIFICATION_SERVICE_TIMEOUT

    def send_email(
        self,
        to,
        subject,
        message,
        template_data=None,
        attachments=None
    ):
        """Send email via notifications-microservice using AWS SES

        Args:
            to: Recipient email address
            subject: Email subject
            message: Email message body (supports {{template}} variables)
            template_data: Optional template variables for message (dict)
            attachments: Optional list of attachment file paths
            Note: contentType parameter removed - notifications-microservice auto-detects content type

        Returns:
            Dict with success status and notification ID

        Raises:
            requests.RequestException: If notification service is unavailable
        """
        import time
        import traceback
        
        start_time = time.time()
        request_id = id(self)  # Use object ID as request identifier
        
        logger.info('[NotificationClient] send_email() called - Request ID: %s, Recipient: %s, Subject: %s, Timeout: %ss',
                   request_id, to, subject, self.timeout)
        logger.info('[NotificationClient] send_email() - Request ID: %s - Stack trace:\n%s',
                   request_id, ''.join(traceback.format_stack()[-8:-1]))
        
        payload = {
            'channel': 'email',
            'type': 'custom',
            'recipient': to,
            'subject': subject,
            'message': message,
            'templateData': template_data or {},
            'emailProvider': 'ses',  # Use AWS SES for SpeakASAP
            'service': 'speakasap-portal',  # For admin dashboard (Notifications Admin)
        }

        if attachments:
            payload['attachments'] = attachments

        # contentType removed - notifications-microservice auto-detects content type from message

        url = '{}/notifications/send'.format(self.base_url)
        logger.info('[NotificationClient] send_email() - Request ID: %s - Preparing HTTP POST request to: %s',
                   request_id, url)
        logger.info('[NotificationClient] send_email() - Request ID: %s - Payload: recipient=%s, subject=%s, message_length=%d, has_template_data=%s',
                   request_id, to, subject, len(message) if message else 0, bool(template_data))

        try:
            logger.info('[NotificationClient] send_email() - Request ID: %s - Sending HTTP POST request (timeout=%ss)...',
                       request_id, self.timeout)
            request_start = time.time()
            
            response = requests.post(
                url,
                json=payload,
                timeout=self.timeout,
                headers={'Content-Type': 'application/json'}
            )
            
            request_duration = time.time() - request_start
            logger.info('[NotificationClient] send_email() - Request ID: %s - HTTP response received in %.3fs - Status: %s, Headers: %s',
                       request_id, request_duration, response.status_code, dict(response.headers))
            
            response.raise_for_status()
            result = response.json()
            
            # Verify we got a proper response with notification ID
            if not result or not result.get('success') or not result.get('data') or not result['data'].get('id'):
                error_msg = 'Invalid response from notifications-microservice: missing notification ID. Response: {}'.format(result)
                logger.error('[NotificationClient] send_email() - Request ID: %s - %s', request_id, error_msg)
                raise Exception(error_msg)
            
            notification_id = result['data']['id']
            total_duration = time.time() - start_time
            logger.info('[NotificationClient] send_email() - Request ID: %s - Email sent successfully to %s via notifications-microservice. Total duration: %.3fs, Notification ID: %s, Status: %s',
                       request_id, to, total_duration, notification_id, result['data'].get('status', 'unknown'))
            return result
        except requests.Timeout as e:
            total_duration = time.time() - start_time
            logger.error('[NotificationClient] send_email() - Request ID: %s - TIMEOUT ERROR after %.3fs: Failed to send email to %s: %s (timeout=%ss)',
                        request_id, total_duration, to, str(e), self.timeout)
            logger.error('[NotificationClient] send_email() - Request ID: %s - Timeout details: url=%s, timeout_setting=%s',
                        request_id, url, self.timeout)
            raise
        except requests.ConnectionError as e:
            total_duration = time.time() - start_time
            logger.error('[NotificationClient] send_email() - Request ID: %s - CONNECTION ERROR after %.3fs: Failed to send email to %s: %s',
                        request_id, total_duration, to, str(e))
            logger.error('[NotificationClient] send_email() - Request ID: %s - Connection error details: url=%s',
                        request_id, url)
            raise
        except requests.RequestException as e:
            total_duration = time.time() - start_time
            logger.error('[NotificationClient] send_email() - Request ID: %s - REQUEST ERROR after %.3fs: Failed to send email to %s: %s',
                        request_id, total_duration, to, str(e))
            if hasattr(e, 'response') and e.response is not None:
                logger.error('[NotificationClient] send_email() - Request ID: %s - Response status: %s, Response body: %s',
                            request_id, e.response.status_code, e.response.text[:500])
            raise
        except Exception as e:
            total_duration = time.time() - start_time
            logger.error('[NotificationClient] send_email() - Request ID: %s - UNEXPECTED ERROR after %.3fs: Failed to send email to %s: %s',
                        request_id, total_duration, to, str(e), exc_info=True)
            raise

    def get_notification_status(self, notification_id):
        """Get status of a notification by ID

        Args:
            notification_id: Notification ID returned from send_email or send_notification

        Returns:
            Dict with notification status, or None if not found

        Raises:
            requests.RequestException: If notification service is unavailable
        """
        import time
        
        url = '{}/notifications/status/{}'.format(self.base_url, notification_id)
        
        try:
            response = requests.get(
                url,
                timeout=self.timeout,
                headers={'Content-Type': 'application/json'}
            )
            response.raise_for_status()
            result = response.json()
            if result.get('success') and result.get('data'):
                return result['data']
            return None
        except requests.RequestException as e:
            logger.error('[NotificationClient] get_notification_status() - Failed to get status for notification {}: {}'.format(notification_id, str(e)))
            raise

    def send_notification(
        self,
        channel,
        recipient,
        message,
        subject=None,
        notification_type='custom',
        template_data=None
    ):
        """Generic notification sender

        Args:
            channel: 'email', 'telegram', 'whatsapp'
            recipient: Recipient address/ID
            message: Message content
            subject: Optional subject (for email)
            notification_type: Type of notification (default: 'custom')
            template_data: Optional template variables (dict)

        Returns:
            Dict with success status and notification ID

        Raises:
            requests.RequestException: If notification service is unavailable
        """
        payload = {
            'channel': channel,
            'type': notification_type,
            'recipient': recipient,
            'message': message,
            'service': 'speakasap-portal',  # For admin dashboard (Notifications Admin)
        }

        if subject:
            payload['subject'] = subject

        if template_data:
            payload['templateData'] = template_data

        if channel == 'email':
            payload['emailProvider'] = 'ses'

        url = '{}/notifications/send'.format(self.base_url)

        try:
            response = requests.post(
                url,
                json=payload,
                timeout=self.timeout,
                headers={'Content-Type': 'application/json'}
            )
            response.raise_for_status()
            result = response.json()
            logger.info('Notification sent successfully via notifications-microservice')
            return result
        except requests.RequestException as e:
            logger.error('Failed to send notification: {}'.format(str(e)))
            raise


# Singleton instance
_notification_client = None


def get_notification_client():
    """Get singleton notification client instance

    Returns:
        NotificationClient: Singleton instance of notification client
    """
    global _notification_client
    if _notification_client is None:
        _notification_client = NotificationClient()
    return _notification_client


def send_email(to, subject, message, **kwargs):
    """Convenience function for sending email

    Args:
        to: Recipient email address
        subject: Email subject
        message: Email message body
        **kwargs: Additional arguments (template_data, attachments, etc.)
                  Note: contentType is ignored - microservice auto-detects content type

    Returns:
        Dict with success status and notification ID
    """
    # Filter out contentType if passed - microservice auto-detects content type
    kwargs.pop('contentType', None)
    client = get_notification_client()
    return client.send_email(to=to, subject=subject, message=message, **kwargs)
