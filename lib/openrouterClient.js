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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const content = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : undefined;

  if (!content) {
    throw new Error('OpenRouter response missing message content');
  }

  return content;
}

module.exports = { tailorWithOpenRouter };
