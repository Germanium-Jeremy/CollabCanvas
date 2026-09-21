import { Logger } from "@nestjs/common";
import type { AiDiagramResult, AiSuggestResult, AiSummarizeResult } from "@collabcanvas/shared";
import type { BoardContext } from "@collabcanvas/yjs-utils";
import { getEnv } from "../config/env";

export interface AiProvider {
  readonly name: string;
  summarize(context: BoardContext): Promise<AiSummarizeResult>;
  suggest(context: BoardContext): Promise<AiSuggestResult>;
  diagram(prompt: string, context: BoardContext): Promise<AiDiagramResult>;
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
          : `This board contains ${context.elementCount} elements (${counts || "no content"}).${
              context.texts.length ? ` The main topics are: ${context.texts.slice(0, 3).join("; ")}.` : ""
            }`,
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

  async diagram(prompt: string): Promise<AiDiagramResult> {
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
}

// ---- OpenAI provider ----

export class OpenAiProvider implements AiProvider {
  readonly name = "openai";
  private readonly logger = new Logger(OpenAiProvider.name);
  private client: import("openai").default | null = null;

  private getClient(): import("openai").default {
    if (!this.client) {
      // Lazy require keeps startup cheap and avoids import cycles in tests.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenAI = require("openai") as typeof import("openai").default;
      this.client = new OpenAI({ apiKey: getEnv().OPENAI_API_KEY, timeout: 20_000, maxRetries: 1 });
    }
    return this.client;
  }

  private async completeJson(system: string, user: string): Promise<Record<string, unknown>> {
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
    return JSON.parse(content) as Record<string, unknown>;
  }

  async summarize(context: BoardContext): Promise<AiSummarizeResult> {
    const json = await this.completeJson(
      'You summarize collaborative whiteboards. Reply as JSON: {"summary": string, "keyPoints": string[]}. Keep it under 120 words.',
      buildSummarizePrompt(context),
    );
    return {
      summary: String(json.summary ?? ""),
      keyPoints: Array.isArray(json.keyPoints) ? json.keyPoints.map(String).slice(0, 5) : [],
    };
  }

  async suggest(context: BoardContext): Promise<AiSuggestResult> {
    const json = await this.completeJson(
      'You coach teams working on whiteboards. Reply as JSON: {"ideas": string[]}. Give 3-5 actionable ideas.',
      buildSuggestPrompt(context),
    );
    return { ideas: Array.isArray(json.ideas) ? json.ideas.map(String).slice(0, 5) : [] };
  }

  async diagram(prompt: string): Promise<AiDiagramResult> {
    const json = await this.completeJson(
      "You convert text into simple whiteboard diagrams. Reply only with JSON.",
      buildDiagramPrompt(prompt),
    );
    const shapes = Array.isArray(json.shapes) ? json.shapes : [];
    return { shapes: shapes.slice(0, 30) as AiDiagramResult["shapes"] };
  }
}

// ---- Ollama provider (local models, zero cost) ----

export class OllamaProvider implements AiProvider {
  readonly name = "ollama";

  private async completeJson(system: string, user: string): Promise<Record<string, unknown>> {
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
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ollama error ${response.status}`);
    const json = (await response.json()) as { message?: { content?: string } };
    if (!json.message?.content) throw new Error("empty ollama completion");
    return JSON.parse(json.message.content) as Record<string, unknown>;
  }

  async summarize(context: BoardContext): Promise<AiSummarizeResult> {
    const json = await this.completeJson(
      'You summarize collaborative whiteboards. Reply as JSON: {"summary": string, "keyPoints": string[]}.',
      buildSummarizePrompt(context),
    );
    return {
      summary: String(json.summary ?? ""),
      keyPoints: Array.isArray(json.keyPoints) ? json.keyPoints.map(String).slice(0, 5) : [],
    };
  }

  async suggest(context: BoardContext): Promise<AiSuggestResult> {
    const json = await this.completeJson(
      'You coach teams working on whiteboards. Reply as JSON: {"ideas": string[]}.',
      buildSuggestPrompt(context),
    );
    return { ideas: Array.isArray(json.ideas) ? json.ideas.map(String).slice(0, 5) : [] };
  }

  async diagram(prompt: string): Promise<AiDiagramResult> {
    const json = await this.completeJson(
      "You convert text into simple whiteboard diagrams. Reply only with JSON.",
      buildDiagramPrompt(prompt),
    );
    const shapes = Array.isArray(json.shapes) ? json.shapes : [];
    return { shapes: shapes.slice(0, 30) as AiDiagramResult["shapes"] };
  }
}

export function createAiProvider(): AiProvider {
  const { AI_PROVIDER } = getEnv();
  switch (AI_PROVIDER) {
    case "openai":
      return new OpenAiProvider();
    case "ollama":
      return new OllamaProvider();
    default:
      return new MockAiProvider();
  }
}
