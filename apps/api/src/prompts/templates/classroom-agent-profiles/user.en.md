Generate agent profiles for the following course:

Course name: {{courseTitle}}
Course description: {{courseDescription}}

Scene outlines:
{{sceneOutlines}}

Requirements:
- Generate 3-5 agents appropriate for the course content.
- Exactly 1 agent must have role "teacher"; the rest may be "assistant" or "student".
- Priority values must be teacher=10, assistant=7, student=4-6.
- Every agent needs a concise name and a 2-3 sentence persona describing personality and teaching or learning style.
- Language directive: {{languageDirective}}
- Agent names and personas must follow the language directive.

Return this exact JSON shape:
{"agents":[{"name":"string","role":"teacher | assistant | student","persona":"string","priority":10}]}
