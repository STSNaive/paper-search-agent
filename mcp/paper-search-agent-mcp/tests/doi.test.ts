import { describe, it, expect } from "vitest";
import { normalizeDoi, publisherFromDoiPrefix, doiToSafePath } from "../src/utils/doi.js";

describe("DOI Utilities", () => {
  describe("normalizeDoi", () => {
    it("should lowercase and trim the DOI", () => {
      expect(normalizeDoi(" 10.1234/ASDF ")).toBe("10.1234/asdf");
    });

    it("should remove common URL prefixes", () => {
      expect(normalizeDoi("https://doi.org/10.1000/182")).toBe("10.1000/182");
      expect(normalizeDoi("http://dx.doi.org/10.1000/182")).toBe("10.1000/182");
    });
  });

  describe("publisherFromDoiPrefix", () => {
    it("should identify known publishers", () => {
      expect(publisherFromDoiPrefix("10.1016/j.foo.2023.01")).toBe("elsevier");
      expect(publisherFromDoiPrefix("10.1038/s41586")).toBe("springer");
      expect(publisherFromDoiPrefix("10.1080/01431161.2023")).toBe("taylor_francis");
      expect(publisherFromDoiPrefix("10.1126/science.123")).toBe("science");
    });

    it("should return null for unknown prefixes", () => {
      expect(publisherFromDoiPrefix("10.9999/unknown")).toBeNull();
    });
  });

  describe("doiToSafePath", () => {
    it("should replace invalid characters with underscores", () => {
      expect(doiToSafePath("10.1000/some/path:here")).toBe("10.1000_some_path_here");
      expect(doiToSafePath("10.1000\\test?*\"<>|")).toBe("10.1000_test______");
    });
  });
});
