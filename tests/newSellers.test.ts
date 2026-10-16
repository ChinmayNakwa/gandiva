import { afterEach, describe, expect, it, vi } from "vitest";

const chatMock = vi.fn();
vi.mock("../src/llm.js", () => ({ chat: (...a: unknown[]) => chatMock(...a) }));

const { cityInfo, cityOutput, currencyForCountry } = await import("../src/sellers/city.js");
const { analyseSentiment, parseSentiment, sentimentOutput } = await import("../src/sellers/sentiment.js");
const { validate } = await import("../src/x402/schema.js");
const { ServiceError } = await import("../src/x402/paidRoute.js");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function mockWeather(geo: unknown, forecast: unknown = { timezone: "Asia/Tokyo", current: { time: "2026-10-17T10:00", temperature_2m: 21.4, wind_speed_10m: 8.5, weather_code: 2 } }) {
  const fetchMock = vi.fn(async (url: string) => (String(url).includes("geocoding") ? json(geo) : json(forecast)));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  chatMock.mockReset();
});

describe("city-info", () => {
  const tokyo = { results: [{ name: "Tokyo", latitude: 35.69, longitude: 139.69, country: "Japan", country_code: "JP", timezone: "Asia/Tokyo", population: 8336599 }] };

  it("returns weather, country and the local currency, matching its own output schema", async () => {
    const f = mockWeather(tokyo);
    const out = await cityInfo({ name: " Tokyo " });
    expect(out).toMatchObject({ city: "Tokyo", country_code: "JP", currency: "JPY", temperature_c: 21.4, wind_kmh: 8.5, conditions: "partly cloudy", population: 8336599 });
    expect(validate(cityOutput, out)).toEqual({ ok: true });
    expect(String(f.mock.calls[0][0])).toContain("name=Tokyo");
    expect(String(f.mock.calls[1][0])).toContain("latitude=35.69");
  });

  it("accepts a city with no population on record", async () => {
    mockWeather({ results: [{ ...tokyo.results[0], population: undefined }] });
    const out = await cityInfo({ name: "Tokyo" });
    expect(out.population).toBeNull();
    expect(validate(cityOutput, out).ok).toBe(true);
  });

  it("fails without charging for an unknown city, an unknown currency or a broken weather source", async () => {
    mockWeather({});
    await expect(cityInfo({ name: "Atlantis" })).rejects.toMatchObject({ status: 404 });
    mockWeather({ results: [{ ...tokyo.results[0], country_code: "XX" }] });
    await expect(cityInfo({ name: "Nowhere" })).rejects.toMatchObject({ status: 422 });
    mockWeather(tokyo, { current: {} });
    await expect(cityInfo({ name: "Tokyo" })).rejects.toBeInstanceOf(ServiceError);
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    await expect(cityInfo({ name: "Tokyo" })).rejects.toThrow(/returned 503/);
  });

  it("maps countries to ISO currencies", () => {
    expect([currencyForCountry("in"), currencyForCountry("DE"), currencyForCountry("GB"), currencyForCountry("US"), currencyForCountry("ZZ")]).toEqual(["INR", "EUR", "GBP", "USD", undefined]);
  });
});

describe("sentiment", () => {
  const good = (n: number) => JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ label: i % 2 ? "negative" : "positive", score: 0.8, reason: "because" })) });

  it("returns one labelled result per text and matches its output schema", async () => {
    chatMock.mockResolvedValue(good(2));
    const out = await analyseSentiment({ texts: ["great", "awful"] });
    expect(out.results.map((r) => r.label)).toEqual(["positive", "negative"]);
    expect(validate(sentimentOutput, out)).toEqual({ ok: true });
    expect(chatMock.mock.calls[0][1]).toMatchObject({ json: true, temperature: 0 });
  });

  it("is strict, so malformed model answers are never charged", () => {
    expect(() => parseSentiment("nope", 1)).toThrow(/did not return JSON/);
    expect(() => parseSentiment(good(1), 2)).toThrow(/1 results for 2/);
    expect(() => parseSentiment('{"results":[{"label":"happy","score":0.5,"reason":"x"}]}', 1)).toThrow(/invalid label/);
    expect(() => parseSentiment('{"results":[{"label":"neutral","score":2,"reason":"x"}]}', 1)).toThrow(/invalid score/);
    expect(() => parseSentiment('{"results":[{"label":"neutral","score":0.5,"reason":" "}]}', 1)).toThrow(/no reason/);
    expect(parseSentiment('[{"label":"Positive","score":"0.7","reason":"ok"}]', 1)).toEqual([{ label: "positive", score: 0.7, reason: "ok" }]);
  });

  it("turns an unreachable model into a not-charged service error", async () => {
    chatMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(analyseSentiment({ texts: ["x"] })).rejects.toMatchObject({ status: 502, message: expect.stringContaining("model unavailable") });
  });
});
