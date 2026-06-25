import { describe, it, expect } from "vitest";
import { photoFsPath } from "@/lib/photos";

// Photos are served by filename from a request param. The guard must reject anything that
// could escape the photos directory (path traversal), and accept only generated names.
describe("photoFsPath traversal guard", () => {
  it("accepts a generated uuid.ext name", () => {
    expect(photoFsPath("40836cac-e38e-42ec-a37d-064d544771cb.png")).not.toBeNull();
    expect(photoFsPath("aabbccdd.jpg")).not.toBeNull();
  });

  it("rejects path traversal and separators", () => {
    for (const bad of [
      "../../etc/passwd",
      "../secret.png",
      "a/b.jpg",
      "..%2f..%2fetc",
      "/etc/hosts",
      "foo.jpg/../bar",
      ".env",
      "name with spaces.jpg",
      "shell$(whoami).png",
    ]) {
      expect(photoFsPath(bad), bad).toBeNull();
    }
  });
});
