import type { AiAutoResult, AiDiagramResult, AiDiagramShape, AiSuggestResult, AiSummarizeResult } from "@collabcanvas/shared";
import type { BoardContext } from "@collabcanvas/yjs-utils";
import type { InferenceClient } from "@huggingface/inference";
import type { GoogleGenAI } from "@google/genai";
import { getEnv } from "../config/env";

export interface AiProvider {
  readonly name: string;
  summarize(context: BoardContext): Promise<AiSummarizeResult>;
  suggest(context: BoardContext): Promise<AiSuggestResult>;
  diagram(prompt: string, context: BoardContext): Promise<AiDiagramResult>;
  /** The server chooses the response type from the prompt + board context. */
  auto(prompt: string, context: BoardContext): Promise<AiAutoResult>;
}

// ---- Prompt builders (pure, unit-testable) ----

export function contextBlock(context: BoardContext): string {
  const counts = Object.entries(context.countsByType)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ");
  const texts = context.texts.length ? context.texts.map((t) => `- ${t}`).join("\n") : "(no text content)";
  return `Board contents: ${context.elementCount} elements (${counts || "empty"}).\nText content:\n${texts}`;
}
export function buildSummarizePrompt(context: BoardContext): string {
  return `${contextBlock(context)}\n\nSummarize this board in one short paragraph, then list up to 5 key points.`;
}
export function buildSuggestPrompt(context: BoardContext): string {
  return `${contextBlock(context)}\n\nSuggest 3-5 concrete next steps for the team based on this board.`;
}
export function buildDiagramPrompt(prompt: string): string {
  return [
    "Convert the following description into a simple diagram made of shapes.",
    "Return JSON: {\"shapes\": [{\"type\": \"rect\"|\"ellipse\"|\"sticky\"|\"text\"|\"arrow\", \"x\": number, \"y\": number, \"width\": number, \"height\": number, \"label\": string}]}",
    "Use arrows (from left/top edge to right/bottom edge via x/y and width/height as direction hints) to connect related items. Lay items out on a clean grid starting at (80, 80) with ~240px spacing.",
    `Description: ${prompt}`,
  ].join("\n");
}

// ---- Auto action: server picks the most useful response from the prompt + board context. ----

const AUTO_SYSTEM =
  'You help a team using a collaborative whiteboard. Read the board contents and the user prompt, then choose ONE of these responses and reply as JSON: {"chosenAction": "summarize"|"suggest"|"diagram", "note": string}. ' +
  'Choose "summarize" when the board has real content and the user wants a quick overview, explanation, or recap. ' +
  'Choose "suggest" when the prompt asks for ideas, next steps, planning, or improvements. ' +
  'Choose "diagram" only when the prompt explicitly asks for a diagram, flowchart, or visual layout (and the board is empty or the user wants new shapes drawn). ' +
  'If unsure, default to "summarize". Keep the note to one short sentence.';

export function buildAutoPrompt(prompt: string, context: BoardContext): string {
  return [
    contextBlock(context),
    "",
    `User request: ${prompt}`,
    "",
    "Decide the single best response type and reply with JSON only: {\"chosenAction\": \"summarize\"|\"suggest\"|\"diagram\", \"note\": string}.",
  ].join("\n");
}

function classifyAutoResult(
  json: Record<string, unknown>,
): "summarize" | "suggest" | "diagram" {
  const chosen = typeof json.chosenAction === "string" ? json.chosenAction : "";
  if (chosen === "summarize" || chosen === "suggest" || chosen === "diagram") return chosen;
  return "summarize";
}

// One system prompt per action, shared by every model-backed provider so all
// providers answer the same contract.
const SUMMARIZE_SYSTEM =
  'You summarize collaborative whiteboards. Reply as JSON: {"summary": string, "keyPoints": string[]}. Keep it under 120 words.';
const SUGGEST_SYSTEM =
  'You coach teams working on whiteboards. Reply as JSON: {"ideas": string[]}. Give 3-5 actionable ideas.';
const DIAGRAM_SYSTEM = "You convert text into simple whiteboard diagrams. Reply only with JSON.";

const MAX_KEY_POINTS = 5;
const MAX_IDEAS = 5;
const MAX_SHAPES = 30;
const MAX_LABEL_LENGTH = 500;
const SHAPE_TYPES = new Set<AiDiagramShape["type"]>(["rect", "ellipse", "sticky", "text", "arrow"]);

// ---- Output parsing + validation (never trust raw model JSON) ----

/** Parse one completion into a plain object; malformed/empty output throws (→ 503 upstream). */
export function parseCompletionJson(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty completion");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("completion was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("completion was not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, max);
}

export function normalizeSummarize(json: Record<string, unknown>): AiSummarizeResult {
  const summary = typeof json.summary === "string" ? json.summary.trim() : "";
  if (!summary) throw new Error("missing summary");
  return { summary, keyPoints: stringList(json.keyPoints, MAX_KEY_POINTS) };
}

export function normalizeSuggest(json: Record<string, unknown>): AiSuggestResult {
  const ideas = stringList(json.ideas, MAX_IDEAS);
  if (ideas.length === 0) throw new Error("missing ideas");
  return { ideas };
}

export function normalizeDiagram(json: Record<string, unknown>): AiDiagramResult {
  const raw = json.shapes;
  if (!Array.isArray(raw)) throw new Error("missing shapes");

  const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  const shapes: AiDiagramShape[] = [];

  for (const item of raw) {
    if (shapes.length >= MAX_SHAPES) break;
    if (!item || typeof item !== "object") continue;
    const shape = item as Record<string, unknown>;
    if (typeof shape.type !== "string" || !SHAPE_TYPES.has(shape.type as AiDiagramShape["type"])) continue;
    if (!finite(shape.x) || !finite(shape.y)) continue;
    shapes.push({
      type: shape.type as AiDiagramShape["type"],
      x: shape.x,
      y: shape.y,
      ...(finite(shape.width) ? { width: shape.width } : {}),
      ...(finite(shape.height) ? { height: shape.height } : {}),
      ...(typeof shape.label === "string" ? { label: shape.label.slice(0, MAX_LABEL_LENGTH) } : {}),
    });
  }

  if (shapes.length === 0) throw new Error("no usable shapes");
  return { shapes };
}

// ---- Deterministic mock provider (tests + demos without API keys) ----

export class MockAiProvider implements AiProvider {
  readonly name = "mock";

  async summarize(context: BoardContext): Promise<AiSummarizeResult> {
    const counts = Object.entries(context.countsByType)
      .map(([type, n]) => `${n} ${type}${n === 1 ? "" : "s"}`)
      .join(", ");
    return {
      summary:
        context.elementCount === 0
          ? "This board is empty — add some sticky notes or shapes to get started."
          : `This board contains ${context.elementCount} elements (${counts || "no content"}).${context.texts.length ? ` The main topics are: ${context.texts.slice(0, 3).join("; ")}.` : ""}`,
      keyPoints: context.texts.slice(0, 5).map((t) => t.slice(0, 120)),
    };
  }

  async suggest(context: BoardContext): Promise<AiSuggestResult> {
    const ideas = context.texts.slice(0, 3).map((t) => `Follow up on "${t.slice(0, 60)}" with an owner and a due date.`);
    while (ideas.length < 4) {
      ideas.push(["Group related stickies into clusters and label them.", "Assign owners to the top 3 items.", "Timebox a 15-minute review of open questions.", "Define a clear next checkpoint for the team."][ideas.length] as string);
    }
    return { ideas: ideas.slice(0, 5) };
  }

  async diagram(prompt: string, _context: BoardContext): Promise<AiDiagramResult> {
    const items = prompt
      .split(/[,\n;]|\band\b/i)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8);
    const shapes: AiDiagramResult["shapes"] = [];
    items.forEach((label, i) => {
      shapes.push({ type: "sticky", x: 80 + i * 240, y: 80, width: 180, height: 140, label });
      if (i > 0) shapes.push({ type: "arrow", x: 80 + (i - 1) * 240 + 180, y: 150, width: 60, height: 0, label: "" });
    });
    return { shapes };
  }

  async auto(prompt: string, context: BoardContext): Promise<AiAutoResult> {
    // Deterministic default for tests/demos when no model key is configured.
    if (context.elementCount === 0 || context.texts.length === 0) {
      return {
        chosenAction: "diagram",
        note: "This board is empty — I generated a starter diagram from your request.",
        shapes: (await this.diagram(prompt, context)).shapes,
      };
    }
    const hasQuestion = /\b(what|explain|why|how|summar|catch me up|overview|what.s|state of)\b/i.test(prompt);
    const hasIdea = /\b(suggest?\s|idea|next step|plan|improve|action|todo|assign|owner)\b/i.test(prompt);
    if (hasIdea && !hasQuestion) {
      return {
        chosenAction: "suggest",
        note: "Here are some next steps based on the board.",
        ideas: context.texts.slice(0, 3).map((t) => `Follow up on the "${t.slice(0, 60)}" item with an owner and deadline.`),
      };
    }
    return {
      chosenAction: "summarize",
      note: "Here is a quick overview of the board.",
      summary:
        `This board has ${context.elementCount} elements (${Object.entries(context.countsByType).map(([t, n]) => `${n} ${t}`).join(", ") || "no content"}).` +
        (context.texts.length ? ` Key topics: ${context.texts.slice(0, 4).join("; ")}.` : ""),
      keyPoints: context.texts.slice(0, 5).map((t) => t.slice(0, 120)),
    };
  }
}

// ---- Shared base for model-backed providers ----

/**
 * Every model provider returns one non-streamed assistant message; this class
 * owns the prompt contract, JSON parsing, and result normalization so all
 * providers behave identically at the API boundary.
 */
abstract class ChatJsonProvider implements AiProvider {
  abstract readonly name: string;

  /** Returns the raw assistant text. Throws on transport, auth, quota, or timeout errors. */
  protected abstract completeText(system: string, user: string): Promise<string>;

  async summarize(context: BoardContext): Promise<AiSummarizeResult> {
    const json = parseCompletionJson(await this.completeText(SUMMARIZE_SYSTEM, buildSummarizePrompt(context)));
    return normalizeSummarize(json);
  }

  async suggest(context: BoardContext): Promise<AiSuggestResult> {
    const json = parseCompletionJson(await this.completeText(SUGGEST_SYSTEM, buildSuggestPrompt(context)));
    return normalizeSuggest(json);
  }

  async diagram(prompt: string, _context: BoardContext): Promise<AiDiagramResult> {
    const json = parseCompletionJson(await this.completeText(DIAGRAM_SYSTEM, buildDiagramPrompt(prompt)));
    return normalizeDiagram(json);
  }

  async auto(prompt: string, context: BoardContext): Promise<AiAutoResult> {
    const json = parseCompletionJson(await this.completeText(AUTO_SYSTEM, buildAutoPrompt(prompt, context)));
    const chosen = classifyAutoResult(json);
    switch (chosen) {
      case "summarize": {
        const s = await this.summarize(context);
        return { chosenAction: "summarize", note: "Here is a quick overview of the board.", summary: s.summary, keyPoints: s.keyPoints };
      }
      case "suggest": {
        const s = await this.suggest(context);
        return { chosenAction: "suggest", note: "Here are some next steps based on the board.", ideas: s.ideas };
      }
      case "diagram":
        return { chosenAction: "diagram", note: "I generated a starter diagram from your request.", shapes: (await this.diagram(prompt, context)).shapes };
    }
  }
}

// ---- OpenAI provider ----

export class OpenAiProvider extends ChatJsonProvider {
  readonly name = "openai";
  private client: import("openai").default | null = null;

  private getClient(): import("openai").default {
    if (!this.client) {
      // Lazy require keeps startup cheap and avoids import cycles in tests.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require("openai") as typeof import("openai").default;
      this.client = new OpenAI({ apiKey: getEnv().OPENAI_API_KEY, timeout: getEnv().AI_TIMEOUT_MS, maxRetries: 1 });
    }
    return this.client;
  }

  protected async completeText(system: string, user: string): Promise<string> {
    const response = await this.getClient().chat.completions.create({
      model: getEnv().OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: 800,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("empty completion");
    return content;
  }
}

// ---- Ollama provider (local models, zero cost) ----

export class OllamaProvider extends ChatJsonProvider {
  readonly name = "ollama";

  protected async completeText(system: string, user: string): Promise<string> {
    const env = getEnv();
    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`ollama error ${response.status}`);
    const json = (await response.json()) as { message?: { content?: string } };
    if (!json.message?.content) throw new Error("empty ollama completion");
    return json.message.content;
  }
}

// ---- Hugging Face provider (Inference Providers or a dedicated Endpoint) ----

type HuggingFaceChatClient = Pick<InferenceClient, "chatCompletion">;

export class HuggingFaceProvider extends ChatJsonProvider {
  readonly name = "huggingface";
  private client: HuggingFaceChatClient | null = null;

  /** Injectable for tests; production resolves the SDK client lazily. */
  constructor(client?: HuggingFaceChatClient) {
    super();
    this.client = client ?? null;
  }

  private getClient(): HuggingFaceChatClient {
    if (!this.client) {
      const env = getEnv();
      // Lazy require keeps the SDK out of the startup path when another provider is selected.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { InferenceClient } = require("@huggingface/inference") as typeof import("@huggingface/inference");
      this.client = env.HF_ENDPOINT_URL
        ? new InferenceClient(env.HF_TOKEN, { endpointUrl: env.HF_ENDPOINT_URL })
        : new InferenceClient(env.HF_TOKEN);
    }
    return this.client;
  }

  protected async completeText(system: string, user: string): Promise<string> {
    const env = getEnv();
    // The SDK retries 503 by default (retry_on_error defaults to true), but it
    // does NOT retry 429 or network-level 502s, and the shared AbortSignal
    // covers the entire (possibly-retried) call. We add a single app-level retry
    // for the most common transient failures so a queued/free-tier model or a
    // brief HF gateway hiccup does not immediately surface as a 502/503 to the
    // board. One retry is a deliberate cost/safety tradeoff (AGENTS.md).
    const budgetMs = env.AI_TIMEOUT_MS;
    try {
      return await this.chatOnce(system, user, budgetMs);
    } catch (first) {
      if (!isTransientHuggingFaceError(first)) throw first;
      // Short backoff so we do not immediately hammer a throttled/overloaded
      // provider; keep it well within the request budget.
      await sleep(Math.min(4000, Math.max(1500, budgetMs - 10000)));
      return await this.chatOnce(system, user, Math.max(5000, budgetMs - 5000));
    }
  }

  private async chatOnce(system: string, user: string, budgetMs: number): Promise<string> {
    const env = getEnv();
    const response = await this.getClient().chatCompletion(
      {
        model: env.HF_MODEL ?? "",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 800,
        // Explicit so the intent is obvious: let the SDK retry 503s for us.
        retry_on_error: true,
        // Pin a specific Inference Provider when configured; otherwise the SDK picks one
        // that serves the model (set HF_PROVIDER to make routing deterministic).
        ...(env.HF_PROVIDER ? { provider: env.HF_PROVIDER as NonNullable<Parameters<HuggingFaceChatClient["chatCompletion"]>[0]["provider"]> } : {}),
      },
      { signal: AbortSignal.timeout(budgetMs) },
    );
    const content = response.choices?.[0]?.message?.content;
    if (!content || !content.trim()) throw new Error("empty huggingface completion");
    return content;
  }
}

function isTransientHuggingFaceError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  // SDK HTTP errors carry the response status.
  const status =
    typeof e.status === "number"
      ? e.status
      : (e as { response?: { status?: number } }).response?.status;
  if (typeof status === "number" && (status === 429 || (status >= 500 && status < 600))) return true;
  // Network / DNS / aborted calls are transient; retry once.
  if (e instanceof TypeError) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Google Gemini provider ----

type GeminiClient = Pick<GoogleGenAI, "models">;
export class GeminiProvider extends ChatJsonProvider {
  readonly name = "gemini";
  private client: GeminiClient | null = null;

  /** Injectable for tests; production resolves the SDK client lazily. */
  constructor(client?: GeminiClient) {
    super();
    this.client = client ?? null;
  }

  private getClient(): GeminiClient {
    if (!this.client) {
      // Lazy require keeps the SDK out of the startup path when another provider is selected.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GoogleGenAI } = require("@google/genai") as typeof import("@google/genai");
      this.client = new GoogleGenAI({ apiKey: getEnv().GEMINI_API_KEY, httpOptions: { timeout: getEnv().AI_TIMEOUT_MS } });
    }
    return this.client;
  }

  protected async completeText(system: string, user: string): Promise<string> {
    const response = await this.getClient().models.generateContent({
      model: getEnv().GEMINI_MODEL,
      contents: user,
      config: {
        systemInstruction: system,
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 800,
      },
    });
    const text = response.text;
    if (!text) throw new Error("empty gemini completion");
    return text;
  }
}

export function createAiProvider(): AiProvider {
  const { AI_PROVIDER } = getEnv();
  switch (AI_PROVIDER) {
    case "openai":
      return new OpenAiProvider();
    case "ollama":
      return new OllamaProvider();
    case "huggingface":
      return new HuggingFaceProvider();
    case "gemini":
      return new GeminiProvider();
    default:
      return new MockAiProvider();
  }
}
