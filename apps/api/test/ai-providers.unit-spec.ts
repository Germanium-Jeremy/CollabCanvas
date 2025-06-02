import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardContext } from "@collabcanvas/yjs-utils";
import {
  GeminiProvider,
  HuggingFaceProvider,
  MockAiProvider,
  OllamaProvider,
  buildDiagramPrompt,
  buildSuggestPrompt,
  buildSummarizePrompt,
  contextBlock,
  normalizeDiagram,
  normalizeSuggest,
  normalizeSummarize,
  parseCompletionJson,
} from "../src/ai/ai.providers";

const context: BoardContext = {
  elementCount: 3,
  countsByType: { sticky: 2, rect: 1 },
  texts: ["Design the login flow", "Ship the beta"],
};

type HfClient = NonNullable<ConstructorParameters<typeof HuggingFaceProvider>[0]>;
type GeminiModels = NonNullable<ConstructorParameters<typeof GeminiProvider>[0]>;

/** Test double shaped like the Hugging Face SDK client; the cast models the SDK's response type. */
function hfClient(output: unknown, spy: ReturnType<typeof vi.fn> = vi.fn()): HfClient {
  spy.mockResolvedValue(output);
  return { chatCompletion: spy } as unknown as HfClient;
}

function hfFailingClient(error: Error): HfClient {
  return { chatCompletion: vi.fn().mockRejectedValue(error) } as unknown as HfClient;
}

/** Test double shaped like the `@google/genai` client surface we use. */
function geminiClient(text: string | undefined, spy: ReturnType<typeof vi.fn> = vi.fn()): GeminiModels {
  spy.mockResolvedValue({ text });
  return { models: { generateContent: spy } } as unknown as GeminiModels;
}

function geminiFailingClient(error: Error): GeminiModels {
  return { models: { generateContent: vi.fn().mockRejectedValue(error) } } as unknown as GeminiModels;
}

const summarizeText = JSON.stringify({ summary: "A login board.", keyPoints: ["Flow", "Roles"] });

describe("prompt builders", () => {
  it("embeds board content in every prompt", () => {
    expect(contextBlock(context)).toContain("3 elements");
    expect(buildSummarizePrompt(context)).toContain("Design the login flow");
    expect(buildSuggestPrompt(context)).toContain("next steps");
    expect(buildDiagramPrompt("signup, login")).toContain("signup, login");
    expect(buildDiagramPrompt("signup")).toContain('"shapes"');
  });
});

describe("completion parsing and result validation", () => {
  it("rejects malformed, empty, and non-object completions", () => {
    expect(() => parseCompletionJson("")).toThrow("empty completion");
    expect(() => parseCompletionJson("   ")).toThrow("empty completion");
    expect(() => parseCompletionJson("{oops")).toThrow("not valid JSON");
    expect(() => parseCompletionJson("[1,2]")).toThrow("not a JSON object");
    expect(() => parseCompletionJson("null")).toThrow("not a JSON object");
  });

  it("requires a non-empty summary", () => {
    expect(() => normalizeSummarize({ summary: "", keyPoints: [] })).toThrow("missing summary");
    expect(() => normalizeSummarize({ keyPoints: [] })).toThrow("missing summary");
    expect(normalizeSummarize({ summary: "  ok  ", keyPoints: ["a", 42, "b"] })).toEqual({
      summary: "ok",
      keyPoints: ["a", "b"],
    });
  });

  it("caps suggestions at 5 and drops empty entries", () => {
    expect(() => normalizeSuggest({ ideas: [] })).toThrow("missing ideas");
    const ideas = normalizeSuggest({ ideas: ["a", "", "b", "c", "d", "e", "f"] });
    expect(ideas.ideas).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("keeps only valid diagram shapes with finite coordinates", () => {
    const result = normalizeDiagram({
      shapes: [
        { type: "sticky", x: 80, y: 80, width: 180, height: 140, label: "Login" },
        { type: "arrow", x: 260, y: 150, width: 60, height: 0 },
        { type: "bomb", x: 0, y: 0 },
        { type: "rect", x: Number.NaN, y: 10 },
        { type: "text", x: 10, y: Number.POSITIVE_INFINITY },
        "not-an-object",
        null,
      ],
    });
    expect(result.shapes).toHaveLength(2);
    expect(result.shapes[0]).toEqual({ type: "sticky", x: 80, y: 80, width: 180, height: 140, label: "Login" });
    expect(result.shapes[1]).toEqual({ type: "arrow", x: 260, y: 150, width: 60, height: 0 });
  });

  it("caps shape count and label length", () => {
    const shapes = Array.from({ length: 40 }, (_, i) => ({ type: "rect", x: i, y: 0, label: "x".repeat(600) }));
    const result = normalizeDiagram({ shapes });
    expect(result.shapes).toHaveLength(30);
    expect(result.shapes[0]?.label).toHaveLength(500);
  });

  it("rejects a diagram with no usable shape", () => {
    expect(() => normalizeDiagram({ shapes: [{ type: "nope", x: 1, y: 1 }] })).toThrow("no usable shapes");
    expect(() => normalizeDiagram({})).toThrow("missing shapes");
  });
});

describe("MockAiProvider", () => {
  it("stays deterministic and offline", async () => {
    const provider = new MockAiProvider();
    const first = await provider.summarize(context);
    const second = await provider.summarize(context);
    expect(first).toEqual(second);
    expect(first.summary).toContain("3 elements");
    expect((await provider.suggest(context)).ideas.length).toBeGreaterThanOrEqual(3);
    expect((await provider.diagram("signup, login")).shapes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("HuggingFaceProvider", () => {
  it("returns a normalized summarize result and sends the shared prompt contract", async () => {
    const spy = vi.fn();
    const provider = new HuggingFaceProvider(hfClient({ choices: [{ message: { content: summarizeText } }] }, spy));
    const result = await provider.summarize(context);
    expect(result).toEqual({ summary: "A login board.", keyPoints: ["Flow", "Roles"] });

    const [args, options] = spy.mock.calls[0] as [{ messages: { role: string; content: string }[] }, { signal?: AbortSignal }];
    expect(args.messages[0]).toEqual({ role: "system", content: expect.stringContaining("whiteboards") });
    expect(args.messages[1]?.content).toContain("Design the login flow");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it("generates diagram shapes through the same adapter", async () => {
    const provider = new HuggingFaceProvider(
      hfClient({ choices: [{ message: { content: JSON.stringify({ shapes: [{ type: "sticky", x: 80, y: 80, label: "A" }] }) } }] }),
    );
    const result = await provider.diagram("a, b");
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]?.type).toBe("sticky");
  });

  it("throws on malformed or empty output", async () => {
    await expect(new HuggingFaceProvider(hfClient({ choices: [{ message: { content: "not json" } }] })).summarize(context)).rejects.toThrow(
      "not valid JSON",
    );
    await expect(new HuggingFaceProvider(hfClient({ choices: [{ message: { content: "" } }] })).summarize(context)).rejects.toThrow(
      "empty huggingface completion",
    );
    await expect(new HuggingFaceProvider(hfClient({ choices: [] })).summarize(context)).rejects.toThrow("empty huggingface completion");
  });

  it("propagates auth, rate-limit, timeout, and outage failures for the service to map to 503", async () => {
    const failures = [
      new Error("401 Unauthorized: invalid token"),
      new Error("429 Too Many Requests: provider quota exceeded"),
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
      new Error("503 Service Unavailable"),
    ];
    for (const failure of failures) {
      const provider = new HuggingFaceProvider(hfFailingClient(failure));
      await expect(provider.suggest(context)).rejects.toThrow(failure.message);
    }
  });
});

describe("GeminiProvider", () => {
  it("returns a normalized suggest result with system instruction and JSON mime type", async () => {
    const spy = vi.fn();
    const provider = new GeminiProvider(geminiClient(JSON.stringify({ ideas: ["one", "two", "three"] }), spy));
    const result = await provider.suggest(context);
    expect(result.ideas).toEqual(["one", "two", "three"]);

    const [params] = spy.mock.calls[0] as [{ config: Record<string, unknown>; contents: string }];
    expect(params.config.systemInstruction).toContain("whiteboards");
    expect(params.config.responseMimeType).toBe("application/json");
    expect(params.contents).toContain("next steps");
  });

  it("throws on empty, malformed, and structurally invalid output", async () => {
    await expect(new GeminiProvider(geminiClient(undefined)).summarize(context)).rejects.toThrow("empty gemini completion");
    await expect(new GeminiProvider(geminiClient("{nope")).summarize(context)).rejects.toThrow("not valid JSON");
    await expect(new GeminiProvider(geminiClient(JSON.stringify({ shapes: [] }))).diagram("x")).rejects.toThrow(
      "no usable shapes",
    );
  });

  it("propagates auth, rate-limit, timeout, and outage failures for the service to map to 503", async () => {
    const failures = [
      new Error("API key not valid"),
      new Error("429 Resource has been exhausted"),
      Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
      new Error("500 internal error"),
    ];
    for (const failure of failures) {
      const provider = new GeminiProvider(geminiFailingClient(failure));
      await expect(provider.summarize(context)).rejects.toThrow(failure.message);
    }
  });
});

describe("OllamaProvider (fetch-based)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okResponse = (content: string) =>
    new Response(JSON.stringify({ message: { content } }), { status: 200, headers: { "Content-Type": "application/json" } });

  it("parses a non-streamed JSON completion", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse(summarizeText));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await new OllamaProvider().summarize(context);
    expect(result).toEqual({ summary: "A login board.", keyPoints: ["Flow", "Roles"] });

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit & { body: string }];
    expect(url).toContain("/api/chat");
    expect(JSON.parse(init.body)).toMatchObject({ stream: false, format: "json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws on transport errors, empty output, and malformed JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 503 })));
    await expect(new OllamaProvider().summarize(context)).rejects.toThrow("ollama error 503");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: {} }), { status: 200 })));
    await expect(new OllamaProvider().summarize(context)).rejects.toThrow("empty ollama completion");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse("not json")));
    await expect(new OllamaProvider().summarize(context)).rejects.toThrow("not valid JSON");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));
    await expect(new OllamaProvider().diagram("a, b")).rejects.toThrow("connection refused");
  });
});
