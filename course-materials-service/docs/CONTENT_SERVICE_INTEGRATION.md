# Content Service Integration

## Overview

The Course Materials Microservice is designed to work alongside `speakasap-content-service` as part of the content ecosystem. This document explains the relationship and integration patterns.

## Service Responsibilities

### speakasap-content-service (Port: 4201)

**General Learning Content** - Reusable across courses:
- Grammar lessons
- Phonetics lessons
- Dictionary/translations
- Songs and media content
- Language definitions
- Content search and discovery

**Characteristics:**
- Content is not tied to specific courses
- Can be reused across multiple courses
- Focused on language learning fundamentals

### course-materials-microservice (Port: 3390-3391)

**Course-Specific Materials** - Tied to courses:
- Course-specific lesson materials
- Course exercises and homework
- Course-specific content generation
- Material management for courses
- Course curriculum materials

**Characteristics:**
- Content is tied to specific courses
- Generated for specific course contexts
- Managed per course and curriculum

## Integration Patterns

### 1. Content Reference

Course materials can reference general content from content-service:

```python
# In material generation
content_client = ContentServiceClient()
grammar_lessons = await content_client.get_grammar_lessons(language="en")
# Use grammar lessons as reference when generating course materials
```

### 2. Content Enhancement

Use content-service content to enhance course materials:

```python
# Get dictionary entries for course material
dictionary_entry = await content_client.get_dictionary_entry(
    word="example",
    source_lang="en",
    target_lang="ru"
)
# Include in course material
```

### 3. AI-Powered Generation

Both services use AI-microservice:
- **Content Service**: Uses AI for translations, content optimization
- **Course Materials Service**: Uses AI for course-specific material generation

### 4. Shared Content Search

Course materials can search and include content from content-service:

```python
# Search for relevant content
search_results = await content_client.search_content(
    query="grammar rules",
    content_type="grammar"
)
# Include in course material generation
```

## Data Flow

```
┌─────────────────────────┐
│  speakasap-content-     │
│  service                │
│  (General Content)      │
└───────────┬─────────────┘
            │
            │ References
            │
┌───────────▼─────────────┐
│  course-materials-      │
│  microservice          │
│  (Course Materials)     │
└───────────┬─────────────┘
            │
            │ Uses
            │
┌───────────▼─────────────┐
│  ai-microservice        │
│  (Content Generation)   │
└─────────────────────────┘
```

## API Integration Examples

### Example 1: Generate Course Material with Grammar Reference

```python
# Get grammar lessons from content-service
grammar_lessons = await content_client.get_grammar_lessons(language="en")

# Generate course material using AI with grammar context
material = await generate_material(
    course_id="course_123",
    material_type="lesson",
    language="en",
    context={
        "grammar_references": grammar_lessons,
        "level": "intermediate"
    }
)
```

### Example 2: Enhance Material with Dictionary

```python
# Generate material content
material_content = await nlp_client.generate_text(prompt)

# Enhance with dictionary entries for key terms
key_terms = extract_key_terms(material_content)
for term in key_terms:
    translation = await content_client.get_dictionary_entry(
        word=term,
        source_lang="en",
        target_lang="ru"
    )
    material_content = enhance_with_translation(material_content, term, translation)
```

## Configuration

Both services should be configured to work together:

```bash
# course-materials-microservice/.env
CONTENT_SERVICE_URL=http://speakasap-content-service:4201
AI_ORCHESTRATOR_URL=http://ai-microservice:3380
NLP_SERVICE_URL=http://ai-microservice-nlp-service:3381
```

## Benefits of Integration

1. **Content Reusability**: General content can be reused across courses
2. **Consistency**: Shared content ensures consistency across courses
3. **Efficiency**: Avoid duplicating general learning content
4. **Enhancement**: Course materials can be enhanced with general content
5. **AI Synergy**: Both services leverage AI-microservice for content generation

## Future Enhancements

- Content caching between services
- Shared content indexing
- Cross-service content recommendations
- Unified content search API
- Content versioning synchronization
