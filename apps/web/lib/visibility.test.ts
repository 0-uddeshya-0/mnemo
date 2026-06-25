import { describe, it, expect } from "vitest";
import { isVisible, filterVisible, type Visibility } from "@/lib/visibility";

// The visibility choke-point decides what ever reaches an LLM/agent. A regression here is a
// privacy leak, so these invariants are pinned.
describe("isVisible", () => {
  const open: Visibility = { hiddenTypes: [], exposePrivate: true };
  const walled: Visibility = { hiddenTypes: ["memory"], exposePrivate: false };

  it("hides private nodes when private is not exposed (cloud default)", () => {
    expect(isVisible({ type: "note", sensitivity: "private" }, walled)).toBe(false);
  });

  it("shows private nodes when private IS exposed (local model)", () => {
    expect(isVisible({ type: "note", sensitivity: "private" }, open)).toBe(true);
  });

  it("hides owner-hidden node types regardless of sensitivity", () => {
    expect(isVisible({ type: "memory", sensitivity: "normal" }, walled)).toBe(false);
    // even with private exposed, an explicitly hidden type stays hidden
    expect(isVisible({ type: "memory", sensitivity: "normal" }, { hiddenTypes: ["memory"], exposePrivate: true })).toBe(false);
  });

  it("shows ordinary active nodes", () => {
    expect(isVisible({ type: "belief", sensitivity: "normal" }, walled)).toBe(true);
  });

  it("filterVisible strips exactly the hidden/private nodes", () => {
    const nodes = [
      { type: "belief" as const, sensitivity: "normal" },
      { type: "note" as const, sensitivity: "private" },
      { type: "memory" as const, sensitivity: "normal" },
    ];
    expect(filterVisible(nodes, walled)).toEqual([{ type: "belief", sensitivity: "normal" }]);
    expect(filterVisible(nodes, open).length).toBe(3);
  });
});
