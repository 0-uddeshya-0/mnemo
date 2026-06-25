import { describe, it, expect } from "vitest";
import { encrypt, decrypt, isEncrypted, maybeEncryptBody, maybeDecryptBody } from "@/lib/crypto";

// Encryption-at-rest for private node bodies. A break here either corrupts data or exposes
// plaintext, so the round-trip and the private-only gating are pinned. (MNEMOSYNE_PASSWORD is
// injected by vitest.config so a key can be derived without a real .env.)
describe("crypto at rest", () => {
  it("round-trips through encrypt/decrypt", async () => {
    const plain = "my most private diary entry — 한국어, ☕, line2";
    const ct = await encrypt(plain);
    expect(isEncrypted(ct)).toBe(true);
    expect(ct).not.toContain(plain);
    expect(await decrypt(ct)).toBe(plain);
  });

  it("produces a fresh IV each time (ciphertexts differ, both decrypt)", async () => {
    const a = await encrypt("same input");
    const b = await encrypt("same input");
    expect(a).not.toBe(b);
    expect(await decrypt(a)).toBe("same input");
    expect(await decrypt(b)).toBe("same input");
  });

  it("treats untagged plaintext as not-encrypted and passes it through", async () => {
    expect(isEncrypted("just text")).toBe(false);
    expect(await decrypt("just text")).toBe("just text");
    expect(await maybeDecryptBody("just text")).toBe("just text");
  });

  it("encrypts ONLY private bodies", async () => {
    expect(isEncrypted((await maybeEncryptBody("x", "private")) ?? "")).toBe(true);
    expect(await maybeEncryptBody("x", "normal")).toBe("x");
    expect(await maybeEncryptBody(null, "private")).toBeNull();
  });

  it("fails loudly (throws) when the ciphertext is tampered with", async () => {
    const ct = await encrypt("authentic");
    const tampered = ct.slice(0, -4) + (ct.endsWith("A") ? "B" : "A") + "==";
    await expect(decrypt(tampered)).rejects.toThrow();
  });
});
