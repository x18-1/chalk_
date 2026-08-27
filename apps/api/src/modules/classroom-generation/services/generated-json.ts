export function parseGeneratedJson(text: string, kind: 'object' | 'array') {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = kind === 'array' ? candidate.indexOf('[') : candidate.indexOf('{');
    const end = kind === 'array' ? candidate.lastIndexOf(']') : candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as unknown;
    }
    throw new SyntaxError('The model did not return valid JSON');
  }
}
