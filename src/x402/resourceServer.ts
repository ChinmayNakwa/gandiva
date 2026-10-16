import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { config, NETWORK } from "../config.js";

let ready: Promise<x402ResourceServer> | null = null;

/** One shared x402 resource server backed by the facilitator; initialised once (fetches /supported). */
export function getResourceServer(): Promise<x402ResourceServer> {
  if (!ready) {
    ready = (async () => {
      const facilitator = new HTTPFacilitatorClient({ url: config.facilitatorUrl, timeoutMs: 60_000 });
      const server = new x402ResourceServer(facilitator);
      registerExactEvmScheme(server, { networks: [NETWORK] });
      await server.initialize();
      return server;
    })().catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}
