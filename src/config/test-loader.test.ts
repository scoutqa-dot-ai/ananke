import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadTestFile, findTestFiles } from "./test-loader.js";

const examplesDir = fileURLToPath(new URL("../../examples", import.meta.url));

describe("test-loader examples", () => {
  it("loads the checkout example", () => {
    const checkoutExample = fileURLToPath(
      new URL("../../examples/checkout.test.yaml", import.meta.url)
    );

    expect(() => loadTestFile(checkoutExample)).not.toThrow();
  });

  it("loads all shipped example tests", async () => {
    const files = await findTestFiles(["**/*.test.yaml"], examplesDir);

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(() => loadTestFile(file)).not.toThrow();
    }
  });
});
