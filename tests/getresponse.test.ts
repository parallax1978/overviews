import { describe, expect, it, vi } from "vitest";
import { addContact, isTestAddress } from "@/lib/getresponse";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const CONFIG = { apiKey: "key", listId: "O", tagId: "f" };

describe("addContact", () => {
  it("puts the email on the list with the tag, starting the autoresponder at day 0", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    await expect(addContact(CONFIG, "new@user.com", fetchImpl)).resolves.toBe("added");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.getresponse.com/v3/contacts");
    expect((init.headers as Record<string, string>)["X-Auth-Token"]).toBe("api-key key");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "new@user.com",
      campaign: { campaignId: "O" },
      dayOfCycle: 0,
      tags: [{ tagId: "f" }],
    });
  });

  it("tags someone who is already on the list instead of failing", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/contacts")) return new Response("{}", { status: 409 });
      if (url.includes("/campaigns/O/contacts")) return Response.json([{ contactId: "c1" }]);
      return new Response(null, { status: 200 });
    });
    await expect(addContact(CONFIG, "old@user.com", fetchImpl)).resolves.toBe("already_on_list");
    expect(fetchImpl.mock.calls.map(([u]) => String(u))).toEqual([
      "https://api.getresponse.com/v3/contacts",
      "https://api.getresponse.com/v3/campaigns/O/contacts?query[email]=old%40user.com&fields=contactId",
      "https://api.getresponse.com/v3/contacts/c1/tags",
    ]);
  });

  it("reports any other answer as an error", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad key", { status: 401 }));
    await expect(addContact(CONFIG, "x@user.com", fetchImpl)).rejects.toThrow(/401/);
  });

  it("never adds the app's own throwaway test accounts", () => {
    expect(isTestAddress("billing-check-1@example.com")).toBe(true);
    expect(isTestAddress("someone@gmail.com")).toBe(false);
  });
});
