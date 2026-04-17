import { describe, expect, it } from "vitest";
import { estimateCost, MODEL_PRICES, normalizeModelId, priceFor } from "../src/core/pricing.js";

describe("priceFor", () => {
  it("looks up known models", () => {
    expect(priceFor("claude-haiku-4-5")).toEqual({ input_per_mtok: 1, output_per_mtok: 5 });
    expect(priceFor("claude-opus-4-7")).toEqual({ input_per_mtok: 5, output_per_mtok: 25 });
    expect(priceFor("claude-sonnet-4-6")).toEqual({ input_per_mtok: 3, output_per_mtok: 15 });
  });

  it("strips the date suffix before lookup", () => {
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual({ input_per_mtok: 1, output_per_mtok: 5 });
    expect(priceFor("claude-opus-4-7-20260101")).toEqual({ input_per_mtok: 5, output_per_mtok: 25 });
  });

  it("returns null for unknown models", () => {
    expect(priceFor("claude-future-99")).toBeNull();
  });
});

describe("normalizeModelId", () => {
  it("strips trailing -YYYYMMDD", () => {
    expect(normalizeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });
  it("leaves bare ids alone", () => {
    expect(normalizeModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5");
  });
  it("does not strip a non-date suffix", () => {
    expect(normalizeModelId("claude-haiku-4-5-beta")).toBe("claude-haiku-4-5-beta");
  });
});

describe("estimateCost", () => {
  it("computes cost from rates", () => {
    // 1M in + 1M out @ haiku-4-5 ($1 + $5) = $6
    expect(estimateCost(1_000_000, 1_000_000, "claude-haiku-4-5")).toBeCloseTo(6, 6);
    // half-million @ opus-4-7 (5/2 + 25/2) = 15
    expect(estimateCost(500_000, 500_000, "claude-opus-4-7")).toBeCloseTo(15, 6);
  });

  it("returns null for unknown models", () => {
    expect(estimateCost(1000, 1000, "made-up")).toBeNull();
  });
});

describe("MODEL_PRICES", () => {
  it("only lists positive rates", () => {
    for (const [id, p] of Object.entries(MODEL_PRICES)) {
      expect(p.input_per_mtok, id).toBeGreaterThan(0);
      expect(p.output_per_mtok, id).toBeGreaterThan(0);
    }
  });
});
