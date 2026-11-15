/** @jest-environment node */

import {
  checkSite,
  classifyHttpStatus,
  isCheckStale,
  mapWithLimit,
  SITE_CHECK_STALE_MS,
} from "@/lib/hub/site-check";

function response(status: number, statusText = ""): Response {
  return new Response("body", { status, statusText });
}

describe("classifyHttpStatus", () => {
  it.each([
    [200, "up"],
    [204, "up"],
    [301, "up"],
    [401, "degraded"],
    [404, "degraded"],
    [500, "down"],
    [503, "down"],
  ])("HTTP %i is %s", (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });
});

describe("checkSite", () => {
  it("reports up with the response time", async () => {
    let t = 1000;
    const clock = () => (t += 250);
    const result = await checkSite("https://example.com", async () => response(200), clock);
    expect(result).toMatchObject({ status: "up", httpStatus: 200, responseMs: 250, error: null });
  });

  it("reports an error page as degraded with the status line", async () => {
    const result = await checkSite("https://example.com", async () => response(404, "Not Found"));
    expect(result).toMatchObject({ status: "degraded", httpStatus: 404, error: "HTTP 404 Not Found" });
  });

  it("reports DNS failures in plain words", async () => {
    const err = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const result = await checkSite("https://nope.invalid", async () => {
      throw err;
    });
    expect(result).toMatchObject({ status: "down", httpStatus: null, error: "Address not found (DNS)" });
  });

  it("reports refused connections and passes through other causes", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const r1 = await checkSite("http://127.0.0.1:59999/", async () => {
      throw refused;
    });
    expect(r1.error).toBe("Connection refused");
    const badPort = Object.assign(new TypeError("fetch failed"), { cause: new Error("bad port") });
    const r2 = await checkSite("http://127.0.0.1:9/", async () => {
      throw badPort;
    });
    expect(r2.error).toBe("bad port");
  });

  it("reports timeouts", async () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    const result = await checkSite("https://slow.example.com", async () => {
      throw err;
    });
    expect(result.error).toBe("No answer within 10s");
  });
});

describe("isCheckStale", () => {
  it("treats missing and old checks as stale", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    expect(isCheckStale(null, now)).toBe(true);
    expect(isCheckStale(new Date(now - SITE_CHECK_STALE_MS - 1).toISOString(), now)).toBe(true);
    expect(isCheckStale(new Date(now - 1000).toISOString(), now)).toBe(false);
  });
});

describe("mapWithLimit", () => {
  it("keeps order and never exceeds the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapWithLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });
});
