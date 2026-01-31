# Messenger Service Integration

## Overview

The Course Materials Microservice integrates with the Messenger Service to provide real-time communication capabilities for the education process. The messenger service provides chat, voice, and video call functionality using Matrix (Synapse) and LiveKit.

## Messenger Service Features

### Communication Capabilities

1. **Chat (Matrix/Synapse)**
   - Real-time messaging
   - Group chats and rooms
   - File sharing
   - Message history
   - End-to-end encryption support

2. **Voice Calls (LiveKit)**
   - High-quality voice calls
   - Low latency
   - TURN/STUN server support
   - Multiple participants

3. **Video Calls (LiveKit)**
   - HD video calls
   - Screen sharing
   - Multiple participants
   - Recording capabilities

## Integration Use Cases

### 1. Education Process

**Student-Teacher Communication:**
- Real-time chat during lessons
- Voice/video calls for tutoring sessions
- Question-answer sessions
- Homework help and clarification

**Student-AI Communication:**
- AI assistant chat for course material questions
- AI-powered explanations
- Interactive learning sessions
- Material clarification

**Group Learning:**
- Study group rooms
- Collaborative learning sessions
- Peer-to-peer communication
- Group project discussions

### 2. Helpdesk Integration

**Support Communication:**
- Direct chat with support staff
- Voice/video support calls
- Issue tracking and resolution
- Support ticket integration

**Automated Support:**
- AI-powered helpdesk responses
- FAQ integration
- Escalation to human support
- Support history tracking

### 3. Course Material Context

**Material-Based Communication:**
- Chat rooms linked to specific course materials
- Discussion threads for lessons
- Q&A for exercises
- Feedback collection

## API Integration

### Creating Communication Channels

```python
from shared.http_clients import MessengerServiceClient

messenger_client = MessengerServiceClient()

# Create a room for a course lesson
room = await messenger_client.create_room(
    room_name="Course 101 - Lesson 5 Discussion",
    room_type="course",
    participants=["student@example.com", "teacher@example.com"]
)

# Create a voice call for tutoring
voice_call = await messenger_client.create_voice_call(
    room_id=room["room_id"],
    participants=["student@example.com", "teacher@example.com"]
)

# Create a video call for interactive lesson
video_call = await messenger_client.create_video_call(
    room_id=room["room_id"],
    participants=["student@example.com", "teacher@example.com"]
)
```

### Sending Messages

```python
# Send a message about course material
await messenger_client.send_message(
    room_id=room["room_id"],
    message="Here's the link to today's lesson material: [Material Link]",
    message_type="m.text"
)

# Send a message with material reference
await messenger_client.send_message(
    room_id=room["room_id"],
    message=f"Check out the new exercise: /api/materials/{material_id}",
    message_type="m.text"
)
```

### AI Integration

```python
# Create AI assistant chat room
ai_room = await messenger_client.create_room(
    room_name="AI Assistant - Course Materials Help",
    room_type="chat",
    participants=["student@example.com"]
)

# AI can respond to questions about course materials
# Integration with AI-microservice for intelligent responses
```

## Integration Patterns

### Pattern 1: Material-Linked Communication

When course materials are generated or updated, automatically create communication channels:

```python
# After generating course material
material = await generate_material(...)

# Create associated chat room
room = await messenger_client.create_room(
    room_name=f"Discussion: {material['title']}",
    room_type="course",
    participants=get_course_participants(material['course_id'])
)

# Link room to material
material['communication_room_id'] = room['room_id']
```

### Pattern 2: Lesson Communication

For scheduled lessons, create voice/video call sessions:

```python
# Before lesson starts
lesson_call = await messenger_client.create_video_call(
    room_id=f"lesson_{lesson_id}",
    participants=get_lesson_participants(lesson_id)
)

# Send lesson material link
await messenger_client.send_message(
    room_id=lesson_call['room_id'],
    message=f"Lesson materials: /api/materials/course/{course_id}"
)
```

### Pattern 3: Helpdesk Integration

Integrate with helpdesk for support:

```python
# Create helpdesk ticket with communication channel
ticket = create_helpdesk_ticket(...)

# Create support chat room
support_room = await messenger_client.create_room(
    room_name=f"Support Ticket #{ticket['id']}",
    room_type="helpdesk",
    participants=[ticket['user_id'], "support@example.com"]
)

# Link to ticket
ticket['communication_room_id'] = support_room['room_id']
```

## Configuration

### Environment Variables

```bash
# Messenger Service Integration
MESSENGER_SERVICE_URL=https://messenger.statex.cz
MESSENGER_MATRIX_SERVER=https://messenger.statex.cz
MESSENGER_LIVEKIT_URL=https://messenger.statex.cz
```

### Service URLs

- **Matrix Server**: `https://messenger.statex.cz` (Synapse homeserver)
- **LiveKit**: `https://messenger.statex.cz` (LiveKit SFU)
- **Element Client**: `https://messenger.statex.cz` (Web client)

## Architecture

```
┌─────────────────────────┐
│  course-materials-      │
│  microservice           │
│  (Materials)            │
└───────────┬─────────────┘
            │
            │ Creates/Manages
            │
┌───────────▼─────────────┐
│  messenger service     │
│  (Matrix + LiveKit)     │
└───────────┬─────────────┘
            │
            │ Provides
            │
┌───────────▼─────────────┐
│  Communication         │
│  - Chat                │
│  - Voice Calls         │
│  - Video Calls         │
└─────────────────────────┘
```

## Benefits

1. **Enhanced Learning Experience**: Real-time communication during lessons
2. **AI Integration**: Direct communication with AI assistants
3. **Support Integration**: Seamless helpdesk communication
4. **Material Context**: Communication linked to specific course materials
5. **Flexibility**: Multiple communication modes (chat, voice, video)
6. **Scalability**: Matrix federation and LiveKit scalability

## Future Enhancements

- Automated room creation for new course materials
- AI-powered chat responses based on course content
- Integration with lesson scheduling
- Recording and transcription of voice/video sessions
- Analytics on communication patterns
- Mobile app integration
- Push notifications for messages
