import { describe, expect, it } from "vitest";
import { domainMatches, normalizeDomain, safeNextPath } from "@/lib/utils";

describe("safeNextPath", () => {
  it("accepts same-site paths", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/new?keyword=best%20form%20builder")).toBe("/app/new?keyword=best%20form%20builder");
  });

  it("falls back for anything that could leave the site", () => {
    expect(safeNextPath("//evil.com")).toBe("/app");
    expect(safeNextPath("/\\evil.com")).toBe("/app");
    expect(safeNextPath("https://evil.com")).toBe("/app");
    expect(safeNextPath("/\t/evil.com")).toBe("/app");
    expect(safeNextPath("/\n/evil.com")).toBe("/app");
    expect(safeNextPath("/ /evil.com")).toBe("/app");
    expect(safeNextPath("")).toBe("/app");
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath(undefined, "")).toBe("");
  });
});

describe("domains", () => {
  it("normalizes user-entered websites", () => {
    expect(normalizeDomain("https://www.Example.com/path")).toBe("example.com");
    expect(normalizeDomain("  example.com ")).toBe("example.com");
    expect(normalizeDomain("")).toBeNull();
  });

  it("matches subdomains of the target", () => {
    expect(domainMatches("blog.example.com", "example.com")).toBe(true);
    expect(domainMatches("example.com", "example.com")).toBe(true);
    expect(domainMatches("notexample.com", "example.com")).toBe(false);
  });
});
