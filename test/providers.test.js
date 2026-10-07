import { it, expect, vi } from "vitest";
import {
  MockProvider,
  OpenAIProvider,
  createProvider,
} from "../server/providers.js";
import { seedState, generateCandidates } from "../server/domain.js";
it("MockProvider requires no credential and selects reproducibly", async () => {
  const input = {
    state: seedState(),
    candidates: generateCandidates(seedState()),
    intent: "Plan work",
  };
  const mock = new MockProvider();
  expect(await mock.select(input)).toEqual(await mock.select(input));
  expect((await mock.select(input)).provider).toBe("mock");
  expect(
    (
      await mock.select({
        ...input,
        state: { ...input.state, currentVersion: "v1" },
      })
    ).candidateId,
  ).toBe("continuity");
});
it("OpenAIProvider validates structured output and sends candidates", async () => {
  const output = {
    candidateId: "balanced",
    explanation: "Balance technicians while respecting urgent work.",
    tradeoffs: ["Some appointments may move."],
  };
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(output) } }],
  });
  const provider = new OpenAIProvider({
    client: { chat: { completions: { create } } },
  });
  const result = await provider.select({
    candidates: generateCandidates(seedState()),
    state: seedState(),
    intent: "Plan work",
  });
  expect(result).toMatchObject({
    ...output,
    provider: "openai",
    status: "success",
  });
  expect(create.mock.calls[0][0].messages[0].content).toContain(
    "Do not invent assignments",
  );
});
it.each([
  "not JSON",
  '{"candidateId":"invented","explanation":"x","tradeoffs":[]}',
  '{"candidateId":"priority","explanation":"x","tradeoffs":[],"assignments":[]}',
])("rejects malformed or invented LLM output: %s", async (content) => {
  const provider = new OpenAIProvider({
    client: {
      chat: {
        completions: {
          create: vi
            .fn()
            .mockResolvedValue({ choices: [{ message: { content } }] }),
        },
      },
    },
  });
  await expect(provider.select({})).rejects.toThrow();
});
it("does not silently substitute MockProvider when OpenAI credentials are missing", () => {
  expect(() => createProvider({ AI_PROVIDER: "openai" })).toThrow("secure");
});
it("propagates upstream errors without a fabricated mock success", async () => {
  const provider = new OpenAIProvider({
    client: {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error("Transport unavailable")),
        },
      },
    },
  });
  await expect(provider.select({})).rejects.toThrow("Transport unavailable");
});
it("constructs the configured SDK client without making a network request", () => {
  const provider = createProvider({
    AI_PROVIDER: "openai",
    LLM_API_KEY: "unit-test-placeholder",
    OPENAI_MODEL: "gpt-4o-mini",
  });
  expect(provider).toBeInstanceOf(OpenAIProvider);
  expect(provider.model).toBe("gpt-4o-mini");
});

it("Gemini sends a structured advisory request with the key only in a header", async () => {
  const { GeminiProvider } = await import("../server/providers.js");
  const output = {
    candidateId: "continuity",
    explanation: "Preserve feasible work.",
    tradeoffs: [],
  };
  const fetchImpl = vi
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: JSON.stringify(output) }] },
          },
        ],
      }),
    });
  const input = {
    state: seedState(),
    candidates: generateCandidates(seedState()),
    currentAssignments: [],
    intent: "Replan",
  };
  const result = await new GeminiProvider({
    apiKey: "unit-test-placeholder",
    fetchImpl,
  }).select(input);
  expect(result).toMatchObject({
    ...output,
    provider: "gemini",
    status: "success",
  });
  const [url, options] = fetchImpl.mock.calls[0];
  expect(url).not.toContain("unit-test-placeholder");
  expect(options.headers["x-goog-api-key"]).toBe("unit-test-placeholder");
  expect(options.signal).toBeInstanceOf(AbortSignal);
  const body = JSON.parse(options.body);
  expect(JSON.parse(body.contents[0].parts[0].text)).toEqual(input);
  expect(body.generationConfig.responseMimeType).toBe("application/json");
  expect(body.systemInstruction.parts[0].text).toContain(
    "Do not invent assignments",
  );
});
it.each([
  { candidates: [] },
  { promptFeedback: { blockReason: "SAFETY" } },
  { candidates: [{ finishReason: "MAX_TOKENS" }] },
  {
    candidates: [
      { finishReason: "STOP", content: { parts: [{ text: "not JSON" }] } },
    ],
  },
  {
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: '{"candidateId":"invented","explanation":"x","tradeoffs":[]}',
            },
          ],
        },
      },
    ],
  },
  {
    candidates: [
      {
        finishReason: "STOP",
        content: {
          parts: [
            {
              text: '{"candidateId":"priority","explanation":"x","tradeoffs":[],"assignments":[]}',
            },
          ],
        },
      },
    ],
  },
])("Gemini rejects incomplete or invalid output %#", async (payload) => {
  const { GeminiProvider } = await import("../server/providers.js");
  const provider = new GeminiProvider({
    apiKey: "unit-test-placeholder",
    fetchImpl: async () => ({ ok: true, json: async () => payload }),
  });
  await expect(provider.select({})).rejects.toThrow();
});
it("Gemini reports quota errors without returning upstream secret-bearing content", async () => {
  const { GeminiProvider } = await import("../server/providers.js");
  const json = vi.fn();
  const provider = new GeminiProvider({
    apiKey: "unit-test-placeholder",
    fetchImpl: async () => ({ ok: false, status: 429, json }),
  });
  await expect(provider.select({})).rejects.toThrow("HTTP 429");
  expect(json).not.toHaveBeenCalled();
});
it("Gemini propagates transport failures and requires its own credential", async () => {
  const { GeminiProvider } = await import("../server/providers.js");
  expect(() =>
    createProvider({
      AI_PROVIDER: "gemini",
      LLM_API_KEY: "unit-test-placeholder",
    }),
  ).toThrow("GEMINI_API_KEY");
  expect(
    createProvider({
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "unit-test-placeholder",
      GEMINI_MODEL: "custom-model",
    }).model,
  ).toBe("custom-model");
  const provider = new GeminiProvider({
    apiKey: "unit-test-placeholder",
    fetchImpl: async () => {
      throw new Error("Transport unavailable");
    },
  });
  await expect(provider.select({})).rejects.toThrow("Transport unavailable");
});
