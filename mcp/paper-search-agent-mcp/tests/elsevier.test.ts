import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/http.js", () => ({
  fetchWithRetry: vi.fn(),
}));

import { fetchElsevierFulltext } from "../src/adapters/publishers/elsevier.js";
import { parsePaper } from "../src/adapters/parsing/paper-parser.js";
import { fetchWithRetry } from "../src/utils/http.js";

const mockFetchWithRetry = vi.mocked(fetchWithRetry);

describe("Elsevier retrieval", () => {
  beforeEach(() => {
    mockFetchWithRetry.mockReset();
  });

  it("requests FULL view and rejects abstract-only XML as full text", async () => {
    const abstractOnlyXml = `
      <full-text-retrieval-response xmlns:dc="http://purl.org/dc/elements/1.1/">
        <coredata>
          <dc:title>Sample Elsevier Article</dc:title>
          <dc:description>Only an abstract is present here.</dc:description>
        </coredata>
        <originalText><xocs:doc xmlns:xocs="http://www.elsevier.com/xml/xocs/dtd"><xocs:meta /></xocs:doc></originalText>
      </full-text-retrieval-response>
    `;

    mockFetchWithRetry.mockResolvedValue(
      new Response(abstractOnlyXml, {
        status: 200,
        headers: { "content-type": "text/xml" },
      }),
    );

    const result = await fetchElsevierFulltext("10.1016/j.foo.2024.123456", "test-key");

    expect(mockFetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("view=FULL"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-ELS-APIKey": "test-key",
        }),
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("abstract-level XML");
  });
});

describe("Elsevier XML parsing", () => {
  it("falls back to dc:description and dc:creator when only abstract metadata exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "elsevier-xml-"));
    const filePath = join(dir, "sample.xml");
    const xml = `
      <full-text-retrieval-response xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/">
        <coredata>
          <prism:doi>10.1016/j.foo.2024.123456</prism:doi>
          <dc:title>Sample Elsevier Article</dc:title>
          <dc:creator>Alpha, Ada</dc:creator>
          <dc:creator>Beta, Ben</dc:creator>
          <dc:description>
            This is the abstract text that should still be readable by the parser.
          </dc:description>
        </coredata>
        <originalText><xocs:doc xmlns:xocs="http://www.elsevier.com/xml/xocs/dtd"><xocs:meta /></xocs:doc></originalText>
      </full-text-retrieval-response>
    `;

    writeFileSync(filePath, xml, "utf-8");

    try {
      const parsed = parsePaper(filePath, "xml");
      expect(parsed.metadata.title).toBe("Sample Elsevier Article");
      expect(parsed.metadata.authors).toEqual(["Alpha, Ada", "Beta, Ben"]);
      expect(parsed.sections.abstract).toContain("abstract text");
      expect(parsed.extracted_text).toContain("abstract text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
