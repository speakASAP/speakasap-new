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
    'https://notifications.alfares.cz'
)

# Default timeout in seconds (per request; do not increase - check logs if service hangs)
NOTIFICATION_SERVICE_TIMEOUT = int(os.getenv('NOTIFICATION_SERVICE_TIMEOUT', '10'))

# Retries on timeout/connection (same timeout each time; avoids failing on transient slowness)
NOTIFICATION_SERVICE_SEND_RETRIES = int(os.getenv('NOTIFICATION_SERVICE_SEND_RETRIES', '2'))

# Reuse pooled connections instead of opening a new TCP+TLS connection per call.
#
# Incident 2026-09-15: 14 sends timed out at exactly ~10.0s and then succeeded on the
# very next attempt in under 3s. A request that hangs for the full timeout and then
# completes instantly on a fresh connection is a dead connection, not a slow service
# (/health answered in 0.18-0.30s throughout, 1.5ms in-cluster). The module-level
# requests.post() opened a new connection every send, so any connection dropped by the
# ingress or by Cloudflare surfaced as a full-timeout stall.
#
# Raising the timeout would make this worse, not better: the stalled attempt never
# completes, so a larger timeout only lengthens the stall before the retry that
# actually works. Keep the timeout at 10s (see the note on it above) and fix the
# connection instead.
#
# max_retries=0: urllib3 must not retry underneath us. The loop in send_email() owns
# retrying so each attempt is logged and timed individually.
NOTIFICATION_SERVICE_POOL_SIZE = int(os.getenv('NOTIFICATION_SERVICE_POOL_SIZE', '10'))

# Auth-issued RS256 pair JWT for caller -> notifications-microservice.
# Identity svc-<caller>--notifications-microservice@internal.alfares.cz, role
# internal:notifications-microservice:send. See
# auth-microservice/docs/SERVICE_IDENTITY_CONSUMER_STANDARD.md.
#
# NOT a static shared secret. The receiver rejects anything else with
# "Unsupported token algorithm none; RS256 required" -- which is exactly what
# happened when this held the old 64-char static key: every send 401'd from
# 2026-09-07 17:24 onward and Letter.sent stayed NULL, silently, for a week.
#
# PORTAL_TO_NOTIFICATIONS_TOKEN is the standard-conformant name; the legacy
# NOTIFICATION_SERVICE_AUTH_TOKEN is still read so a deployment that has not
# been migrated keeps working, and is logged once so it does not stay forever.
NOTIFICATION_SERVICE_AUTH_TOKEN = os.getenv('PORTAL_TO_NOTIFICATIONS_TOKEN', '').strip()
if not NOTIFICATION_SERVICE_AUTH_TOKEN:
    NOTIFICATION_SERVICE_AUTH_TOKEN = os.getenv('NOTIFICATION_SERVICE_AUTH_TOKEN', '').strip()
    if NOTIFICATION_SERVICE_AUTH_TOKEN:
        logger.warning(
            'notification client - using legacy NOTIFICATION_SERVICE_AUTH_TOKEN; '
            'rename it to PORTAL_TO_NOTIFICATIONS_TOKEN '
            '(SERVICE_IDENTITY_CONSUMER_STANDARD.md)'
        )

# Fail loud on a credential that cannot possibly work. An unsigned or static
# value is not a degraded mode -- the receiver will 401 every request and the
# caller will mark nothing as sent, so say so at import rather than discovering
# it a week later in an empty inbox.
if NOTIFICATION_SERVICE_AUTH_TOKEN and NOTIFICATION_SERVICE_AUTH_TOKEN.count('.') != 2:
    logger.error(
        'notification client - token is not a JWT (%d chars, %d segments); '
        'notifications-microservice requires an Auth-issued RS256 pair JWT and '
        'will reject every send with 401',
        len(NOTIFICATION_SERVICE_AUTH_TOKEN),
        NOTIFICATION_SERVICE_AUTH_TOKEN.count('.') + 1,
    )


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
        self.session = self._build_session()

    @staticmethod
    def _build_session():
        """
        Build a requests.Session with a connection pool.

        Keeping connections alive removes the per-send TCP+TLS handshake and, more
        importantly, lets a retry reuse a known-good connection. urllib3 retries are
        disabled (max_retries=0) because send_email() does its own retrying and must
        see and log every individual attempt.
        """
        session = requests.Session()
        try:
            adapter = requests.adapters.HTTPAdapter(
                pool_connections=NOTIFICATION_SERVICE_POOL_SIZE,
                pool_maxsize=NOTIFICATION_SERVICE_POOL_SIZE,
                max_retries=0,
            )
            session.mount('https://', adapter)
            session.mount('http://', adapter)
        except Exception as e:
            # A pooling adapter is an optimisation, not a correctness requirement:
            # never let it stop the client from being constructed. Say so loudly
            # rather than silently falling back to unpooled behaviour.
            logger.error('[NotificationClient] Could not mount pooling adapter (%s) - '
                         'falling back to per-request connections', str(e))
        return session

    def _drop_connections(self, request_id, attempt):
        """
        Close pooled connections so the next attempt dials a fresh one.

        Called after a timeout or connection error: the connection we just used is
        suspect, and retrying on the same dead socket reproduces the same stall.
        """
        try:
            self.session.close()
            self.session = self._build_session()
            logger.info('[NotificationClient] Request ID: %s - Dropped pooled connections '
                        'after failed attempt %d; next attempt will use a fresh connection',
                        request_id, attempt)
        except Exception as e:
            logger.error('[NotificationClient] Request ID: %s - Could not reset session '
                         'after attempt %d: %s', request_id, attempt, str(e))

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

        max_attempts = 1 + max(0, NOTIFICATION_SERVICE_SEND_RETRIES)
        last_exc = None

        for attempt in range(1, max_attempts + 1):
            try:
                logger.info('[NotificationClient] send_email() - Request ID: %s - Attempt %d/%d - Sending HTTP POST (timeout=%ss)...',
                           request_id, attempt, max_attempts, self.timeout)
                request_start = time.time()

                headers = {'Content-Type': 'application/json'}
                if NOTIFICATION_SERVICE_AUTH_TOKEN:
                    headers['Authorization'] = 'Bearer {0}'.format(NOTIFICATION_SERVICE_AUTH_TOKEN)

                response = self.session.post(
                    url,
                    json=payload,
                    timeout=self.timeout,
                    headers=headers
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

            except (requests.Timeout, requests.ConnectionError) as e:
                last_exc = e
                total_duration = time.time() - start_time
                err_label = 'TIMEOUT' if isinstance(e, requests.Timeout) else 'CONNECTION ERROR'
                # Severity follows the OUTCOME, not the attempt.
                #
                # This used to log every timeout at ERROR "so connectivity is visible".
                # In practice 12 of 40 sends on 2026-09-15 logged an ERROR and then
                # delivered fine on the next attempt, so the log carried ERRORs for mail
                # that was never lost. That is how 8 days of genuine 401 ERRORs went
                # unnoticed on this same path: an ERROR that routinely resolves itself
                # trains everyone to scroll past ERRORs.
                #
                # A retryable attempt is a WARNING (nothing is lost yet). ERROR is
                # reserved for exhausting every attempt, which is the only case where an
                # email actually fails to send.
                if attempt < max_attempts:
                    logger.warning('[NotificationClient] send_email() - Request ID: %s - %s on attempt %d/%d '
                                   'after %.3fs: %s (timeout=%ss) - retrying on a fresh connection',
                                   request_id, err_label, attempt, max_attempts, total_duration, str(e), self.timeout)
                    self._drop_connections(request_id, attempt)
                    time.sleep(2)
                    continue
                logger.error('[NotificationClient] send_email() - Request ID: %s - %s on FINAL attempt %d/%d after %.3fs: %s (timeout=%ss)',
                             request_id, err_label, attempt, max_attempts, total_duration, str(e), self.timeout)
                logger.error('[NotificationClient] send_email() - Request ID: %s - All %d attempts failed. Last error: %s',
                             request_id, max_attempts, str(e))
                if isinstance(e, requests.Timeout):
                    logger.error('[NotificationClient] Read timeout after %d attempts (timeout=%ss per request). '
                                'Check notifications-microservice logs and health; do not increase timeout (project rule).',
                                max_attempts, self.timeout)
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
            headers = {'Content-Type': 'application/json'}
            if NOTIFICATION_SERVICE_AUTH_TOKEN:
                headers['Authorization'] = 'Bearer {0}'.format(NOTIFICATION_SERVICE_AUTH_TOKEN)

            response = self.session.get(
                url,
                timeout=self.timeout,
                headers=headers
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
            headers = {'Content-Type': 'application/json'}
            if NOTIFICATION_SERVICE_AUTH_TOKEN:
                headers['Authorization'] = 'Bearer {0}'.format(NOTIFICATION_SERVICE_AUTH_TOKEN)

            response = self.session.post(
                url,
                json=payload,
                timeout=self.timeout,
                headers=headers
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
