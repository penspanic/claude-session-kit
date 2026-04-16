import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, LLMResponse, SummarizePrompt } from "./analyze.js";

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Anthropic-backed LLMClient. Single-shot `messages.create` — batching and
 * concurrency are the caller's responsibility for now.
 *
 * Auth precedence: explicit opts.apiKey > env ANTHROPIC_API_KEY > throw.
 */
export class AnthropicClient implements LLMClient {
  private readonly sdk: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Anthropic API key missing. Set ANTHROPIC_API_KEY or pass apiKey to AnthropicClient.",
      );
    }
    this.sdk = new Anthropic({ apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async summarize(prompt: SummarizePrompt): Promise<LLMResponse> {
    const response = await this.sdk.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });

    // Extract text from the first text block. Claude won't emit tool_use here
    // because we didn't register any tools.
    const first = response.content[0];
    const text = first && first.type === "text" ? first.text : "";
    return {
      text,
      model: response.model,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
