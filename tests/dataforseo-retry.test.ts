import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataForSeoError, fetchSerpWithAiOverview, isRetryableTaskError } from "@/lib/dataforseo";

const req = { keyword: "best seo marketplace", location_code: 2840, language_code: "en", device: "desktop" as const };

function reply(taskStatus: number, message = "Ok.") {
  return new Response(
    JSON.stringify({
      status_code: 20000,
      status_message: "Ok.",
      tasks: [{ status_code: taskStatus, status_message: message, cost: taskStatus === 20000 ? 0.004 : 0, result: taskStatus === 20000 ? [{ items: [] }] : null }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("isRetryableTaskError", () => {
  it("retries Google-side and DataForSEO-side failures only", () => {
    expect(isRetryableTaskError(40101)).toBe(true);
    expect(isRetryableTaskError(50000)).toBe(true);
    expect(isRetryableTaskError(40100)).toBe(false); // bad login
    expect(isRetryableTaskError(40501)).toBe(false); // invalid field
    expect(isRetryableTaskError(0)).toBe(false); // network error, already retried at HTTP level
  });
});

describe("fetchSerpWithAiOverview retries", () => {
  beforeEach(() => {
    process.env.DATAFORSEO_LOGIN = "test-login";
    process.env.DATAFORSEO_PASSWORD = "test-password";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("succeeds after two Internal SE Server Errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(40101, "Internal SE Server Error."))
      .mockResolvedValueOnce(reply(40101, "Internal SE Server Error."))
      .mockResolvedValueOnce(reply(20000));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchSerpWithAiOverview(req);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.statusCode).toBe(20000);
    expect(result.cost).toBe(0.004);
  });

  it("gives up after three attempts", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply(40101, "Internal SE Server Error."));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchSerpWithAiOverview(req).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    const err = await pending;
    expect(err).toBeInstanceOf(DataForSeoError);
    expect((err as DataForSeoError).statusCode).toBe(40101);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry a bad login", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply(40100, "You are not authorized"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = fetchSerpWithAiOverview(req).catch((err: unknown) => err);
    await vi.runAllTimersAsync();
    expect(await pending).toBeInstanceOf(DataForSeoError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
