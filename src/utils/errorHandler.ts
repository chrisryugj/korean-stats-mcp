/**
 * 에러 처리 유틸리티
 */

export enum ErrorCode {
  INVALID_API_KEY = 'INVALID_API_KEY',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_PARAMETER = 'INVALID_PARAMETER',
  NO_DATA_FOUND = 'NO_DATA_FOUND',
  API_UNAVAILABLE = 'API_UNAVAILABLE',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  [ErrorCode.INVALID_API_KEY]:
    'API 키가 유효하지 않습니다. 환경 설정을 확인해주세요.',
  [ErrorCode.RATE_LIMIT_EXCEEDED]:
    '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.',
  [ErrorCode.INVALID_PARAMETER]:
    '검색 조건이 올바르지 않습니다. 다른 조건으로 시도해주세요.',
  [ErrorCode.NO_DATA_FOUND]:
    '해당 조건에 맞는 데이터가 없습니다.',
  [ErrorCode.API_UNAVAILABLE]:
    'KOSIS 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.',
  [ErrorCode.NETWORK_ERROR]:
    '네트워크 연결을 확인해주세요.',
  [ErrorCode.UNKNOWN_ERROR]:
    '알 수 없는 오류가 발생했습니다.',
};

/**
 * 사용자 친화적 에러 메시지 반환
 */
export function getErrorMessage(code: ErrorCode | string): string {
  return ERROR_MESSAGES[code as ErrorCode] || ERROR_MESSAGES[ErrorCode.UNKNOWN_ERROR];
}

/**
 * 에러를 안전하게 처리하고 결과 반환
 */
export function handleToolError(error: unknown): {
  success: false;
  error: string;
  code: string;
} {
  console.error('Tool error:', error);

  if (error instanceof Error) {
    // KOSIS API 에러
    if ('code' in error) {
      const code = (error as { code: string }).code;
      return {
        success: false,
        error: getErrorMessage(code),
        code,
      };
    }

    return {
      success: false,
      error: error.message,
      code: ErrorCode.UNKNOWN_ERROR,
    };
  }

  return {
    success: false,
    error: getErrorMessage(ErrorCode.UNKNOWN_ERROR),
    code: ErrorCode.UNKNOWN_ERROR,
  };
}

/**
 * 재시도 래퍼 함수
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
  } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 10000 } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // 재시도 불가능한 에러인 경우 즉시 throw
      if (isNonRetryableError(error)) {
        throw error;
      }

      // 마지막 시도가 아니면 대기
      if (attempt < maxRetries - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

function isNonRetryableError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code: string }).code;
    return [
      ErrorCode.INVALID_API_KEY,
      ErrorCode.INVALID_PARAMETER,
    ].includes(code as ErrorCode);
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════
// 업스트림(외부 API) 장애 — MCP 응답에서 isError=true 로 나가는 오류
// ═══════════════════════════════════════════════════════════

/** 마스킹된 장애 원인 — 오류 코드와 대상 호스트 이름만 */
export interface UpstreamCause {
  code: string;
  host: string;
}

/**
 * 외부 API 호출 실패 — 연결 시간 초과·끊김·DNS 실패, HTTP 오류 상태, KOSIS 서버측 오류 코드.
 *
 * 도구는 이 오류를 success:false 응답으로 삼키지 않고 다시 던지고(rethrowIfUpstream),
 * MCP 등록 래퍼(server.ts registerTool)가 isError=true 결과로 바꾼다.
 * 요청 URL 쿼리에 KOSIS API 키가 실려 있으므로 URL·원본 오류 메시지·cause 는 담지 않는다.
 */
export class UpstreamError extends Error {
  constructor(
    readonly code: string,
    readonly host: string
  ) {
    super(`외부 API 호출 실패 — ${host} (${code})`);
    this.name = 'UpstreamError';
  }
}

/** Node·undici 오류 코드 모양(UND_ERR_CONNECT_TIMEOUT, ECONNRESET, ENOTFOUND 등)만 원인 코드로 받는다 */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * fetch 실패 → UpstreamError.
 *
 * undici 는 TypeError('fetch failed') 의 cause 에 원인 코드를 둔다 (Node 26 실측:
 * TCP 무응답 → ConnectTimeoutError UND_ERR_CONNECT_TIMEOUT, DNS → ENOTFOUND,
 * 듀얼스택 연결 거부 → AggregateError ECONNREFUSED). 자체 타임아웃 abort 는 TIMEOUT.
 */
export function toUpstreamError(error: unknown, host: string): UpstreamError {
  if (error instanceof UpstreamError) return error;
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return new UpstreamError('TIMEOUT', host);
  if (error instanceof SyntaxError) return new UpstreamError('INVALID_JSON', host);
  let e: unknown = error;
  for (let depth = 0; e && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && SAFE_CODE.test(code)) return new UpstreamError(code, host);
    e = (e as { cause?: unknown }).cause;
  }
  return new UpstreamError('NETWORK_ERROR', host);
}

/** 도구 catch 블록 첫 줄 — 업스트림 장애는 도구별 실패 응답으로 삼키지 않고 MCP 계층으로 올린다 */
export function rethrowIfUpstream(error: unknown): void {
  if (error instanceof UpstreamError) throw error;
}

/** 체인 도구의 하위 조회 실패 항목에 붙일 마스킹된 원인 (업스트림 장애가 아니면 undefined) */
export function upstreamCause(error: unknown): UpstreamCause | undefined {
  return error instanceof UpstreamError ? { code: error.code, host: error.host } : undefined;
}

/**
 * 체인 도구 — 하위 조회가 하나도 성공하지 못했고 그중 업스트림 장애가 있으면 도구 실패(isError)로 올린다.
 * 하나라도 성공하면 부분 실패 허용 설계대로 결과를 돌려준다 (실패 항목에 upstream 원인 표기).
 */
export function throwIfAllFailedUpstream(
  items: ReadonlyArray<{ success: boolean; upstream?: UpstreamCause }>
): void {
  if (items.some((i) => i.success)) return;
  const cause = items.find((i) => i.upstream)?.upstream;
  if (cause) throw new UpstreamError(cause.code, cause.host);
}
