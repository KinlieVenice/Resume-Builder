'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { tailorWithOpenRouter } = require('./openrouterClient');

function fakeFetch({ status = 200, body }) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  fn.calls = calls;
  return fn;
}

test('tailorWithOpenRouter sends model+messages and returns message content', async () => {
  const fetchImpl = fakeFetch({
    body: { choices: [{ message: { content: 'RESUME TEXT' } }] },
  });

  const result = await tailorWithOpenRouter({
    apiKey: 'test-key',
    model: 'anthropic/claude-sonnet-5',
    messages: [{ role: 'user', content: 'hi' }],
    fetchImpl,
  });

  assert.equal(result, 'RESUME TEXT');
  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, options }] = fetchImpl.calls;
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(options.headers.Authorization, 'Bearer test-key');
  const sentBody = JSON.parse(options.body);
  assert.equal(sentBody.model, 'anthropic/claude-sonnet-5');
  assert.deepEqual(sentBody.messages, [{ role: 'user', content: 'hi' }]);
});

test('tailorWithOpenRouter hits a custom baseUrl when given one', async () => {
  const fetchImpl = fakeFetch({
    body: { choices: [{ message: { content: 'RESUME TEXT' } }] },
  });

  await tailorWithOpenRouter({
    apiKey: 'test-key',
    model: 'cx/gpt-5.6-luna',
    messages: [],
    baseUrl: 'http://localhost:20128/v1/',
    fetchImpl,
  });

  assert.equal(fetchImpl.calls[0].url, 'http://localhost:20128/v1/chat/completions');
});

test('tailorWithOpenRouter throws with status on non-ok response', async () => {
  const fetchImpl = fakeFetch({ status: 401, body: { error: 'bad key' } });
  await assert.rejects(
    () =>
      tailorWithOpenRouter({
        apiKey: 'bad',
        model: 'anthropic/claude-sonnet-5',
        messages: [],
        fetchImpl,
      }),
    /OpenRouter request failed \(401\)/,
  );
});

test('tailorWithOpenRouter throws when response has no message content', async () => {
  const fetchImpl = fakeFetch({ body: { choices: [] } });
  await assert.rejects(
    () =>
      tailorWithOpenRouter({
        apiKey: 'test-key',
        model: 'anthropic/claude-sonnet-5',
        messages: [],
        fetchImpl,
      }),
    /missing message content/,
  );
});
