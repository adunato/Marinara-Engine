import type { BaseLLMProvider } from "./base-provider.js";
import { LocalSidecarProvider } from "./providers/local-sidecar.provider.js";
import { withLlmTransportRetries } from "./transport-retry-provider.js";

export const LOCAL_SIDECAR_MODEL = "local-sidecar";

const localSidecarProvider = withLlmTransportRetries(new LocalSidecarProvider());

export function getLocalSidecarProvider(): BaseLLMProvider {
  return localSidecarProvider;
}
