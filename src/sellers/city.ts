import { ServiceError } from "../x402/paidRoute.js";

// ISO 3166 country code -> ISO 4217 currency, so the answer can feed straight into an FX lookup.
const CURRENCY: Record<string, string> = {
  AD: "EUR", AE: "AED", AF: "AFN", AG: "XCD", AL: "ALL", AM: "AMD", AO: "AOA", AR: "ARS", AT: "EUR", AU: "AUD", AZ: "AZN",
  BA: "BAM", BB: "BBD", BD: "BDT", BE: "EUR", BF: "XOF", BG: "BGN", BH: "BHD", BI: "BIF", BJ: "XOF", BN: "BND", BO: "BOB",
  BR: "BRL", BS: "BSD", BT: "BTN", BW: "BWP", BY: "BYN", BZ: "BZD", CA: "CAD", CD: "CDF", CF: "XAF", CG: "XAF", CH: "CHF",
  CI: "XOF", CL: "CLP", CM: "XAF", CN: "CNY", CO: "COP", CR: "CRC", CU: "CUP", CV: "CVE", CY: "EUR", CZ: "CZK", DE: "EUR",
  DJ: "DJF", DK: "DKK", DM: "XCD", DO: "DOP", DZ: "DZD", EC: "USD", EE: "EUR", EG: "EGP", ER: "ERN", ES: "EUR", ET: "ETB",
  FI: "EUR", FJ: "FJD", FR: "EUR", GA: "XAF", GB: "GBP", GD: "XCD", GE: "GEL", GH: "GHS", GM: "GMD", GN: "GNF", GQ: "XAF",
  GR: "EUR", GT: "GTQ", GW: "XOF", GY: "GYD", HK: "HKD", HN: "HNL", HR: "EUR", HT: "HTG", HU: "HUF", ID: "IDR", IE: "EUR",
  IL: "ILS", IN: "INR", IQ: "IQD", IR: "IRR", IS: "ISK", IT: "EUR", JM: "JMD", JO: "JOD", JP: "JPY", KE: "KES", KG: "KGS",
  KH: "KHR", KM: "KMF", KN: "XCD", KP: "KPW", KR: "KRW", KW: "KWD", KZ: "KZT", LA: "LAK", LB: "LBP", LC: "XCD", LI: "CHF",
  LK: "LKR", LR: "LRD", LS: "LSL", LT: "EUR", LU: "EUR", LV: "EUR", LY: "LYD", MA: "MAD", MC: "EUR", MD: "MDL", ME: "EUR",
  MG: "MGA", MK: "MKD", ML: "XOF", MM: "MMK", MN: "MNT", MO: "MOP", MR: "MRU", MT: "EUR", MU: "MUR", MV: "MVR", MW: "MWK",
  MX: "MXN", MY: "MYR", MZ: "MZN", NA: "NAD", NE: "XOF", NG: "NGN", NI: "NIO", NL: "EUR", NO: "NOK", NP: "NPR", NZ: "NZD",
  OM: "OMR", PA: "PAB", PE: "PEN", PG: "PGK", PH: "PHP", PK: "PKR", PL: "PLN", PT: "EUR", PY: "PYG", QA: "QAR", RO: "RON",
  RS: "RSD", RU: "RUB", RW: "RWF", SA: "SAR", SB: "SBD", SC: "SCR", SD: "SDG", SE: "SEK", SG: "SGD", SI: "EUR", SK: "EUR",
  SL: "SLE", SM: "EUR", SN: "XOF", SO: "SOS", SR: "SRD", SS: "SSP", ST: "STN", SV: "USD", SY: "SYP", SZ: "SZL", TD: "XAF",
  TG: "XOF", TH: "THB", TJ: "TJS", TL: "USD", TM: "TMT", TN: "TND", TO: "TOP", TR: "TRY", TT: "TTD", TW: "TWD", TZ: "TZS",
  UA: "UAH", UG: "UGX", US: "USD", UY: "UYU", UZ: "UZS", VA: "EUR", VC: "XCD", VE: "VES", VN: "VND", VU: "VUV", WS: "WST",
  YE: "YER", ZA: "ZAR", ZM: "ZMW", ZW: "ZWL",
};

// WMO weather interpretation codes used by Open-Meteo.
const CONDITIONS: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "rime fog",
  51: "light drizzle", 53: "drizzle", 55: "dense drizzle", 56: "freezing drizzle", 57: "dense freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light rain showers", 81: "rain showers",
  82: "violent rain showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail",
};

export const currencyForCountry = (code: string) => CURRENCY[code.toUpperCase()];

async function getJson(url: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err: any) {
    throw new ServiceError(`weather source unreachable: ${err?.message ?? err}`, 502);
  }
  if (!res.ok) throw new ServiceError(`weather source returned ${res.status}`, 502);
  return res.json();
}

/** Current weather plus country facts for one city (Open-Meteo geocoding + forecast). */
export async function cityInfo(input: { name: string }) {
  const name = String(input.name).trim();
  const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`);
  const hit = geo?.results?.[0];
  if (!hit) throw new ServiceError(`city "${name}" not found`, 404);
  const currency = currencyForCountry(String(hit.country_code ?? ""));
  if (!currency) throw new ServiceError(`no currency known for country ${hit.country_code ?? "?"}`, 422);

  const wx = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto`,
  );
  const cur = wx?.current;
  if (typeof cur?.temperature_2m !== "number" || typeof cur?.wind_speed_10m !== "number") throw new ServiceError("weather source returned no current conditions", 502);

  return {
    city: String(hit.name),
    country: String(hit.country ?? hit.country_code),
    country_code: String(hit.country_code).toUpperCase(),
    currency,
    timezone: String(hit.timezone ?? wx.timezone ?? "UTC"),
    population: typeof hit.population === "number" ? hit.population : null,
    temperature_c: cur.temperature_2m,
    wind_kmh: cur.wind_speed_10m,
    conditions: CONDITIONS[cur.weather_code as number] ?? `weather code ${cur.weather_code}`,
    observed_at: String(cur.time ?? new Date().toISOString()),
    source: "open-meteo.com",
  };
}

export const cityInput = {
  type: "object",
  properties: { name: { type: "string", minLength: 1, maxLength: 80, description: "City name in English, e.g. Tokyo" } },
  required: ["name"],
  additionalProperties: false,
};

export const cityOutput = {
  type: "object",
  required: ["city", "country", "country_code", "currency", "timezone", "temperature_c", "wind_kmh", "conditions", "observed_at"],
  properties: {
    city: { type: "string", minLength: 1 },
    country: { type: "string" },
    country_code: { type: "string", pattern: "^[A-Z]{2}$" },
    currency: { type: "string", pattern: "^[A-Z]{3}$", description: "ISO 4217 code of the local currency; usable as 'to' in fx-rates" },
    timezone: { type: "string" },
    population: { type: ["integer", "null"] },
    temperature_c: { type: "number" },
    wind_kmh: { type: "number" },
    conditions: { type: "string" },
    observed_at: { type: "string" },
    source: { type: "string" },
  },
};
