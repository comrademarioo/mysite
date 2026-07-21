// Node's global fetch (undici) ignores HTTPS_PROXY by default. In environments
// that route egress through a proxy (e.g. Claude Code remote runners), import
// this module first so pipeline fetches honor the proxy env vars.
// Pair with NODE_EXTRA_CA_CERTS for the proxy's CA bundle when required.
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

if (process.env.HTTPS_PROXY || process.env.https_proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
