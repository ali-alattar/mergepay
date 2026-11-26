// Turn an MCP tool result into data: structuredContent, else JSON text, else plain text.
export function parseResult(result) {
  if (result.isError) {
    const msg = (result.content || []).map((c) => c.text).filter(Boolean).join('\n') || 'Tool call failed';
    const err = new Error(msg);
    err.toolError = true;
    throw err;
  }
  if (result.structuredContent) return result.structuredContent;
  const text = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
