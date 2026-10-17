/**
 * KOSIS OpenAPI HTTP 클라이언트
 */

import { config } from '../config/index.js';
import { UpstreamError, toUpstreamError } from '../utils/errorHandler.js';
import type {
  StatisticsListItem,
  StatisticsDataItem,
  SearchResultItem,
  StatisticsListParams,
  StatisticsDataParams,
  SearchStatisticsParams,
} from './types.js';

class KosisApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'KosisApiError';
  }
}

/**
 * 요청을 고쳐도 안 되는 KOSIS 오류 코드 — 업스트림 장애(UpstreamError)로 올린다.
 * KOSIS 공유서비스 개발가이드 1.4.2 오류메시지 유형: 10 인증키 누락, 11 인증키 기간만료,
 * 40 호출가능건수 제한(분당 200건), 41 호출가능ROW수 제한, 42 사용자별 이용 제한, 50 서버오류.
 * 20·21 요청변수 오류, 30 조회결과 없음(0건), 31 조회결과 초과는 요청 문제라 종전처럼 KosisApiError.
 */
const UPSTREAM_KOSIS_ERRORS = new Set(['10', '11', '40', '41', '42', '50']);

/**
 * KOSIS API 클라이언트
 */
export class KosisClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(apiKey?: string) {
    this.baseUrl = config.kosis.baseUrl;
    this.apiKey = apiKey || config.kosis.apiKey;
  }

  /**
   * API 요청 실행 (timeout 15s + 3회 재시도 + 지수 백오프)
   *
   * - KOSIS cold path 일시 abort 대응
   * - KOSIS 응답 에러(err/errMsg 필드)는 영구 실패 → 즉시 throw, retry 안 함
   * - HTTP 4xx도 영구 실패 → 즉시 throw
   * - 네트워크 오류·타임아웃·5xx만 retry (800ms / 1600ms 백오프)
   * - 연결·HTTP 실패와 KOSIS 서버측 오류 코드는 UpstreamError(원인 코드 + 호스트 이름)로 던진다
   */
  private async request<T>(
    endpoint: string,
    params: Record<string, string | number | undefined>
  ): Promise<T[]> {
    const cleanParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        cleanParams[key] = String(value);
      }
    }
    cleanParams.apiKey = this.apiKey;
    cleanParams.format = 'json';
    cleanParams.jsonVD = 'Y';

    const url = new URL(this.baseUrl + endpoint);
    url.search = new URLSearchParams(cleanParams).toString();
    const requestUrl = url.toString();
    // 실패 원인에는 호스트 이름만 남긴다 — requestUrl 쿼리에 apiKey 가 있다
    const host = url.hostname;

    const TIMEOUT_MS = 15000;
    const MAX_ATTEMPTS = 3;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      let isRetryable = false;
      try {
        const response = await fetch(requestUrl, {
          signal: controller.signal,
        });

        if (!response.ok) {
          // 5xx는 일시적 — retry, 4xx는 영구 실패
          isRetryable = response.status >= 500;
          throw new UpstreamError(`HTTP_${response.status}`, host);
        }

        const data = (await response.json()) as Record<string, unknown>;

        // KOSIS 응답 에러 — 영구 실패
        if (data.err || data.errMsg) {
          const err = String(data.err ?? '');
          if (UPSTREAM_KOSIS_ERRORS.has(err)) {
            throw new UpstreamError(`KOSIS_ERR_${err}`, host);
          }
          throw new KosisApiError(
            (data.err as string) || 'API_ERROR',
            (data.errMsg as string) || '알 수 없는 API 오류'
          );
        }

        if (!Array.isArray(data)) {
          if (data.result && Array.isArray(data.result)) {
            return data.result as T[];
          }
          // 단일 객체 응답 (statisticsExplData.do 등) — [obj]로 정규화
          if (data && typeof data === 'object' && Object.keys(data).length > 0) {
            return [data as T];
          }
          return [];
        }

        return data as T[];
      } catch (error) {
        // KOSIS 응답 에러·HTTP 4xx는 즉시 throw (retry 무의미)
        if ((error instanceof KosisApiError || error instanceof UpstreamError) && !isRetryable) {
          throw error;
        }
        // 네트워크/timeout/5xx — retry 가능. 마지막 시도면 원인 코드(undici cause.code 등)만 남긴다
        if (attempt === MAX_ATTEMPTS - 1) {
          throw toUpstreamError(error, host);
        }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      } finally {
        clearTimeout(timeoutId);
      }
    }
    // 도달 불가 (위 loop에서 모두 return 또는 throw)
    throw new KosisApiError('UNEXPECTED', '요청 처리 중 예기치 못한 종료');
  }

  /**
   * 통계목록 조회
   */
  async getStatisticsList(
    vwCd: string,
    parentListId: string = ''
  ): Promise<StatisticsListItem[]> {
    return this.request<StatisticsListItem>(
      config.kosis.endpoints.statisticsList,
      {
        method: 'getList',
        vwCd,
        parentListId,
      }
    );
  }

  /**
   * 통계자료 조회 (통계표 선택 방식)
   */
  async getStatisticsData(params: {
    orgId: string;
    tblId: string;
    objL1?: string;
    objL2?: string;
    objL3?: string;
    objL4?: string;
    itmId?: string;
    prdSe: string;
    startPrdDe?: string;
    endPrdDe?: string;
    newEstPrdCnt?: number;
  }): Promise<StatisticsDataItem[]> {
    return this.request<StatisticsDataItem>(
      config.kosis.endpoints.parameterData,
      {
        method: 'getList',
        ...params,
      }
    );
  }

  /**
   * 통합검색
   * API 문서: https://kosis.kr/openapi/devGuide/devGuide_0701List.do
   */
  async searchStatistics(
    searchNm: string,
    options?: {
      orgId?: string;
      sort?: 'RANK' | 'DATE';
      startCount?: number;
      resultCount?: number;
    }
  ): Promise<SearchResultItem[]> {
    return this.request<SearchResultItem>(
      config.kosis.endpoints.searchStatistics,
      {
        method: 'getList',
        searchNm,
        ...options,
      }
    );
  }

  /**
   * 통계설명 조회 (statisticsExplData.do)
   *
   * 응답은 camelCase 단일 객체(statsNm, writingPurps, examinPd, mainTermExpl 등) —
   * request()가 단일 객체를 [obj]로 감싸 반환한다. metaItm=All 필수.
   */
  async getStatisticsExplain(
    orgId: string,
    tblId: string
  ): Promise<Record<string, string>[]> {
    return this.request(config.kosis.endpoints.statsExplain, {
      method: 'getList',
      orgId,
      tblId,
      metaItm: 'All',
    });
  }

  /**
   * 통계표 메타데이터 조회 (분류/항목 정보)
   * @param orgId 기관 ID
   * @param tblId 통계표 ID
   * @param metaType 메타데이터 유형: TBL(통계표명), ORG(기관명), PRD(수록정보), ITM(분류/항목), UNIT(단위), SOURCE(출처)
   */
  async getTableMeta(
    orgId: string,
    tblId: string,
    metaType: 'TBL' | 'ORG' | 'PRD' | 'ITM' | 'UNIT' | 'SOURCE' = 'ITM'
  ): Promise<Record<string, string>[]> {
    return this.request(config.kosis.endpoints.statisticsData, {
      method: 'getMeta',
      type: metaType,
      orgId,
      tblId,
    });
  }
}

// 싱글톤 인스턴스
let clientInstance: KosisClient | null = null;

export function getKosisClient(): KosisClient {
  if (!clientInstance) {
    clientInstance = new KosisClient();
  }
  return clientInstance;
}

export { KosisApiError };
