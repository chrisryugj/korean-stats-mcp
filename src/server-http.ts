/**
 * Streamable HTTP 서버 - stateless 모드
 *
 * Fly.io 배포용 HTTP 엔드포인트. 매 POST 요청마다 fresh server + transport 생성.
 * GET/DELETE 는 405. /health 만 GET 응답.
 *
 * 참고: korean-law-mcp의 server/http-server.ts 패턴
 */

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const BODY_LIMIT = process.env.MCP_BODY_LIMIT || '200kb';
const RATE_LIMIT_RPM = parseInt(process.env.RATE_LIMIT_RPM || '60', 10);
const TRUST_PROXY_RAW = process.env.TRUST_PROXY ?? '1';

function parseTrustProxy(v: string): boolean | number | string {
  if (v === 'true' || v === 'all') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

function scrub(s: string): string {
  // KOSIS API 키가 URL/에러에 노출되지 않도록 마스킹
  return s.replace(/(apiKey|kosis_api_key)=[^&\s]+/gi, '$1=***');
}

async function main() {
  const app = express();
  app.set('trust proxy', parseTrustProxy(TRUST_PROXY_RAW));
  app.use(express.json({ limit: BODY_LIMIT }));

  // Rate limit: per-IP per minute
  if (RATE_LIMIT_RPM > 0) {
    const buckets = new Map<string, { count: number; resetAt: number }>();
    app.use((req, res, next) => {
      if (req.path === '/health' || req.path === '/') return next();
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      let b = buckets.get(ip);
      if (!b || now >= b.resetAt) {
        b = { count: 0, resetAt: now + 60_000 };
        buckets.set(ip, b);
      }
      b.count++;
      if (b.count > RATE_LIMIT_RPM) {
        return res.status(429).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: `Rate limit exceeded (${RATE_LIMIT_RPM} rpm)` },
          id: null,
        });
      }
      next();
    });
  }

  // CORS
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      name: 'korean-stats-mcp',
      version: '1.6.0',
      tools: 12,
    });
  });

  app.get('/', (_req, res) => {
    res.json({
      name: 'korean-stats-mcp',
      version: '1.6.0',
      description: 'KOSIS 91 키워드 + 17 시도 + 자치구 230+ 라우팅 + 3개 체인 MCP',
      endpoint: '/mcp (POST only)',
      tools: 12,
      docs: 'https://github.com/chrisryugj/korean-stats-mcp',
    });
  });

  // MCP endpoint (POST only — stateless)
  app.post('/mcp', async (req, res) => {
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on('close', () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req as any, res as any, req.body);
    } catch (error) {
      if (res.headersSent) return;
      const msg = scrub(error instanceof Error ? error.message : String(error));
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: msg },
        id: null,
      });
    }
  });

  // GET/DELETE on /mcp → 405
  app.get('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Stateless MCP — use POST.' },
      id: null,
    });
  });
  app.delete('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32600, message: 'Stateless MCP — sessions not supported.' },
      id: null,
    });
  });

  app.listen(PORT, () => {
    console.log(`[korean-stats-mcp] HTTP server listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal:', scrub(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
