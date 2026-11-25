import { describe, expect, it, vi } from "vitest";
import { isGoogleRedirect, resolveGoogleRedirect, resolveOverviewLinks } from "@/lib/google-redirect";
import type { OverviewReference } from "@/lib/types";

const GOTO_A = "https://google.com/goto?url=CAESbAHEIkXXtokenA";
const GOTO_B = "https://google.com/goto?url=CAESbAHEIkXXtokenB";
const GOTO_DEAD = "https://google.com/goto?url=CAESdead";

/** Google's real chain, as seen in November 2026: google.com 301 -> www.google.com 302 -> the page. */
function fakeGoogle(destinations: Record<string, string>) {
  return vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.hostname === "google.com") {
      return new Response(null, { status: 301, headers: { location: `https://www.google.com${url.pathname}${url.search}` } });
    }
    const token = url.searchParams.get("url") ?? "";
    const target = destinations[token];
    if (url.hostname === "www.google.com" && target) {
      return new Response(null, { status: 302, headers: { location: target } });
    }
    return new Response("<html>unusual traffic</html>", { status: 200 });
  });
}

function ref(url: string, overrides: Partial<OverviewReference> = {}): OverviewReference {
  return { url, domain: "google.com", title: "A page", snippet: null, source: null, element_index: 0, ...overrides };
}

describe("isGoogleRedirect", () => {
  it("spots Google's redirect links only", () => {
    expect(isGoogleRedirect(GOTO_A)).toBe(true);
    expect(isGoogleRedirect("https://www.google.co.uk/url?q=https://example.com")).toBe(true);
    expect(isGoogleRedirect("https://www.google.com/search?q=movers")).toBe(false);
    expect(isGoogleRedirect("https://example.com/goto?url=x")).toBe(false);
    expect(isGoogleRedirect("not a url")).toBe(false);
  });
});

describe("resolveGoogleRedirect", () => {
  it("follows Google's hops to the page without ever requesting the page", async () => {
    const fetchImpl = fakeGoogle({ CAESbAHEIkXXtokenA: "https://www.instagram.com/reel/DU4K4g1Eo6n/?hl=en" });
    await expect(resolveGoogleRedirect(GOTO_A, fetchImpl)).resolves.toBe("https://www.instagram.com/reel/DU4K4g1Eo6n/?hl=en");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url] of fetchImpl.mock.calls) expect(new URL(url).hostname).toMatch(/google\.com$/);
  });

  it("reads an address Google put in the clear without any request", async () => {
    const fetchImpl = vi.fn();
    await expect(
      resolveGoogleRedirect("https://www.google.com/url?q=https://example.com/guide&sa=U", fetchImpl),
    ).resolves.toBe("https://example.com/guide");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives up on a challenge page, a network error or an endless loop", async () => {
    await expect(resolveGoogleRedirect(GOTO_DEAD, fakeGoogle({}))).resolves.toBeNull();
    await expect(resolveGoogleRedirect(GOTO_A, vi.fn(async () => Promise.reject(new Error("offline"))))).resolves.toBeNull();
    const loop = vi.fn(async () => new Response(null, { status: 302, headers: { location: GOTO_A } }));
    await expect(resolveGoogleRedirect(GOTO_A, loop)).resolves.toBeNull();
  });
});

describe("resolveOverviewLinks", () => {
  it("swaps redirect links for their pages, merges citations of the same page and fixes the markdown", async () => {
    const fetchImpl = fakeGoogle({
      CAESbAHEIkXXtokenA: "https://www.angi.com/articles/movers-cost/",
      CAESbAHEIkXXtokenB: "https://www.angi.com/articles/movers-cost/?utm_source=google",
      CAESfootnote: "https://www.hireahelper.com/advice/stairs/",
    });
    const result = await resolveOverviewLinks(
      {
        references: [
          ref(GOTO_A, { title: "Angi guide" }),
          ref(GOTO_B, { title: "Angi guide again" }),
          ref(GOTO_DEAD, { source: "proseocontent.com", title: "Unresolved" }),
          ref("https://collegemovers.us/stairs", { domain: "collegemovers.us" }),
        ],
        inlineLinks: [{ url: GOTO_A, domain: "google.com", title: "Angi" }],
        markdown: `Movers cost more with stairs ([Angi](${GOTO_A})).[[1]](https://google.com/goto?url=CAESfootnote)`,
      },
      fetchImpl,
    );

    expect(result.found).toBe(4);
    expect(result.resolved).toBe(3);
    expect(result.references.map((r) => [r.url, r.domain, r.title])).toEqual([
      ["https://www.angi.com/articles/movers-cost", "angi.com", "Angi guide"],
      [GOTO_DEAD, "proseocontent.com", "Unresolved"],
      ["https://collegemovers.us/stairs", "collegemovers.us", "A page"],
    ]);
    expect(result.inlineLinks).toEqual([{ url: "https://www.angi.com/articles/movers-cost", domain: "angi.com", title: "Angi" }]);
    expect(result.markdown).toBe(
      "Movers cost more with stairs ([Angi](https://www.angi.com/articles/movers-cost)).[[1]](https://www.hireahelper.com/advice/stairs)",
    );
  });

  it("makes no request when there is no redirect link", async () => {
    const fetchImpl = vi.fn();
    const result = await resolveOverviewLinks(
      { references: [ref("https://example.com/a", { domain: "example.com" })], inlineLinks: [], markdown: "text" },
      fetchImpl,
    );
    expect(result.found).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
