import { describe, expect, it } from "vitest";
import { clickyUpstreamRequest } from "@/lib/clicky";

function browserRequest(path: string, cookie?: string) {
  const headers = new Headers({
    "user-agent": "Mozilla/5.0 Test",
    "accept-language": "en-US",
    referer: "https://legiitoverviews.com/pricing",
    "x-forwarded-for": "203.0.113.7",
    authorization: "Bearer should-not-leave",
  });
  if (cookie) headers.set("cookie", cookie);
  return { url: `https://legiitoverviews.com${path}`, headers };
}

const SIGN_IN = "sb-jxzeahftdqxevvrussbi-auth-token=base64-secret";

describe("Clicky relay", () => {
  it("fetches the tracker from Clicky with the visitor's IP and browser, and no cookies at all", () => {
    const { url, headers } = clickyUpstreamRequest("script", browserRequest("/f9bb7dcc08c495e.js?v=1", SIGN_IN));
    expect(url).toBe("https://static.getclicky.com/js?in=%2Fdc95495f19525c8");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(headers.get("user-agent")).toBe("Mozilla/5.0 Test");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("passes the beacon's query on and only Clicky's own cookies, never the sign-in cookie", () => {
    const { url, headers } = clickyUpstreamRequest(
      "beacon",
      browserRequest("/dc95495f19525c8?site_id=101515245&href=%2Fpricing", `${SIGN_IN}; _cky_ignore=abc; _cky_osa=1`),
    );
    expect(url).toBe("https://in.getclicky.com/in.php?site_id=101515245&href=%2Fpricing");
    expect(headers.get("cookie")).toBe("_cky_ignore=abc; _cky_osa=1");
    expect(headers.get("x-forwarded-host")).toBe("legiitoverviews.com");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("referer")).toBe("https://legiitoverviews.com/pricing");
  });

  it("sends no cookie on a beacon unless the visitor chose to be ignored", () => {
    const { headers } = clickyUpstreamRequest("beacon", browserRequest("/dc95495f19525c8?site_id=1", SIGN_IN));
    expect(headers.get("cookie")).toBeNull();
  });

  it("points the no-JavaScript beacon at the site's image", () => {
    const { url } = clickyUpstreamRequest("noscript", browserRequest("/e9415f48c064280"));
    expect(url).toBe("https://in.getclicky.com/101515245ns.gif");
  });
});
