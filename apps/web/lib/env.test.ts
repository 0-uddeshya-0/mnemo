import { describe, it, expect } from "vitest";
import { isLocalLLM } from "@/lib/env";

// isLocalLLM is the single switch that decides whether private content may reach the model.
// If it ever wrongly reports a cloud endpoint as local, private data could leak — so pin it.
describe("isLocalLLM", () => {
  it("treats loopback hosts as local", () => {
    expect(isLocalLLM("http://localhost:11434/v1")).toBe(true);
    expect(isLocalLLM("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalLLM("http://[::1]:11434/v1")).toBe(true);
    expect(isLocalLLM("http://0.0.0.0:11434")).toBe(true);
  });

  it("treats real cloud endpoints as NOT local", () => {
    expect(isLocalLLM("https://openrouter.ai/api/v1")).toBe(false);
    expect(isLocalLLM("https://api.openai.com/v1")).toBe(false);
    // a hostname that merely contains 'localhost' must not pass
    expect(isLocalLLM("https://localhost.evil.com/v1")).toBe(false);
  });

  it("fails closed (not local) on malformed input", () => {
    expect(isLocalLLM("not a url")).toBe(false);
    expect(isLocalLLM("")).toBe(false);
  });
});
