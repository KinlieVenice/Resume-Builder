'use strict';

async function tailorWithOpenRouter({
  apiKey,
  model,
  messages,
  baseUrl = 'https://openrouter.ai/api/v1',
  fetchImpl = fetch,
}) {
  const res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  const raw = await res.text();

  if (!res.ok) {
    throw new Error(`OpenRouter request failed (${res.status}): ${raw}`);
  }

  const content = parseCompletionResponse(raw);

  if (!content) {
    throw new Error('OpenRouter response missing message content');
  }

  return content;
}

// Some OpenAI-compatible gateways stream Server-Sent Events (lines of
// `data: {...}`) even for non-streaming requests. Handle both that shape
// and a plain JSON completion body.
function parseCompletionResponse(raw) {
  const trimmed = raw.trim();

  if (trimmed.startsWith('data:')) {
    let content = '';
    for (const line of trimmed.split('\n')) {
      const text = line.trim();
      if (!text.startsWith('data:')) continue;
      const payload = text.slice('data:'.length).trim();
      if (!payload || payload === '[DONE]') continue;

      const chunk = JSON.parse(payload);
      const choice = chunk.choices && chunk.choices[0];
      const delta = choice && (choice.delta || choice.message);
      if (delta && typeof delta.content === 'string') {
        content += delta.content;
      }
    }
    return content;
  }

  const data = JSON.parse(trimmed);
  return data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : undefined;
}

module.exports = { tailorWithOpenRouter };
