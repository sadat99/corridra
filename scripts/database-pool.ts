import { Pool as NativePool, type DatabasePool } from '../packages/db/src/index';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { HttpsProxyAgent } from 'https-proxy-agent';
import WebSocket from 'ws';

// Offline tools only. Application pools continue to use native PostgreSQL TLS.
export function databasePool(connectionString: string): DatabasePool {
  if (process.env.MIGRATION_TRANSPORT !== 'neon-websocket')
    return new NativePool({ connectionString, connectionTimeoutMillis: 10000 });
  const url = new URL(connectionString);
  if (
    !url.hostname.endsWith('.eu-central-1.aws.neon.tech') ||
    url.searchParams.get('sslmode') !== 'verify-full'
  )
    throw new Error('WebSocket migration transport requires an approved Frankfurt TLS host');
  const proxy = process.env.HTTPS_PROXY;
  if (!proxy) throw new Error('The managed HTTPS proxy is required for this transport');
  const agent = new HttpsProxyAgent(proxy);
  class ProxySocket extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, { agent });
    }
  }
  neonConfig.webSocketConstructor = ProxySocket;
  neonConfig.useSecureWebSocket = true;
  // WSS verifies the endpoint certificate through the configured proxy and CA trust.
  // The sessionful driver preserves migration locks and transaction-local RLS context.
  return new NeonPool({ connectionString, connectionTimeoutMillis: 10000 });
}
