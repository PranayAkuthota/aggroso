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
