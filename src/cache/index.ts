/**
 * 캐시 매니저
 * 메모리 캐시를 사용하여 KOSIS API 호출을 최적화
 *
 * 크기 상한이 있는 LRU. node-cache 를 쓰던 시절엔 두 가지가 문제였다.
 *   1) maxKeys 가 차면 set() 이 ECACHEFULL 을 던졌다. KOSIS 응답을 받아 놓고도
 *      그 요청이 실패로 끝나고, 만료로 키가 빠질 때까지 새 요청이 전부 같은 길을 간다.
 *   2) 바이트 상한이 없었다. 통합 호스트(1GB, MCP 5종 동거)에서 stats 한 프로세스가
 *      RSS 434MB(피크 576MB)를 차지했다(2026-09-23 실측). 호스트 가용 메모리 34MB.
 * 지금은 가득 차면 오래 안 쓴 항목부터 내보낸다. 던지지 않는다.
 */

import { config } from '../config/index.js';

// 캐시 TTL 설정 (초 단위)
const TTL = {
  STATISTICS_LIST: 24 * 60 * 60,      // 목록: 24시간
  STATISTICS_DATA: 6 * 60 * 60,        // 데이터: 6시간
  SEARCH_RESULTS: 1 * 60 * 60,         // 검색: 1시간
  EXPLANATION: 7 * 24 * 60 * 60,       // 설명: 7일
  TABLE_META: 24 * 60 * 60,            // 테이블 메타: 24시간
  // 빈 결과: KOSIS 일시 장애로 0건이 왔을 때 6시간 고착되지 않도록 짧게
  EMPTY_RESULT: 60,
} as const;

interface Entry {
  value: unknown;
  expiresAt: number;
  /** JSON 직렬화 길이. 파싱된 KOSIS 행 배열의 힙 점유는 이 값의 약 2배다(실측) */
  size: number;
}

/** 크기 추정: 캐시 미스(네트워크 왕복 뒤)에만 한 번 계산한다 */
function estimateSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY; // 직렬화 불가(순환 참조 등)는 캐시하지 않는다
  }
}

class CacheManager {
  // Map 삽입 순서 = LRU 순서. 조회 적중 시 지웠다 다시 넣어 맨 뒤로 보낸다.
  private cache = new Map<string, Entry>();
  private totalSize = 0;
  private hits = 0;
  private misses = 0;
  // 동일 키 동시 요청 dedup — chain 도구가 같은 (지표×지역)을 병렬 호출할 때
  // 캐시 미스 stampede로 KOSIS 중복 호출되는 것을 방지 (promise 공유)
  private inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly maxKeys: number = config.cache.maxKeys,
    private readonly maxSize: number = config.cache.maxSize
  ) {
    // 만료 항목은 조회 때도 지우지만, 다시 안 불리는 키가 메모리에 남지 않게 10분마다 쓸어낸다
    setInterval(() => this.sweepExpired(), 10 * 60 * 1000).unref();
  }

  /**
   * 캐시 키 생성
   */
  private generateKey(prefix: string, params: Record<string, unknown>): string {
    const sortedParams = Object.keys(params)
      .sort()
      .map((k) => `${k}=${JSON.stringify(params[k])}`)
      .join('&');
    return `${prefix}:${sortedParams}`;
  }

  private remove(key: string, entry: Entry): void {
    this.cache.delete(key);
    this.totalSize -= entry.size;
  }

  private read<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() >= entry.expiresAt) {
      this.remove(key, entry);
      this.misses++;
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry.value as T;
  }

  private write(key: string, value: unknown, ttlSeconds: number): void {
    const size = estimateSize(value);
    // 한 건이 예산의 1/8 을 넘으면 캐시하지 않는다. 큰 표 하나가 나머지를 통째로 밀어내는 것 방지
    if (size > this.maxSize / 8) return;

    const previous = this.cache.get(key);
    if (previous) this.remove(key, previous);

    for (const [oldestKey, oldest] of this.cache) {
      if (this.cache.size < this.maxKeys && this.totalSize + size <= this.maxSize) break;
      this.remove(oldestKey, oldest);
    }

    // TTL 0 은 node-cache 시절처럼 "만료 없음"으로 둔다 (CACHE_TTL_HOURS=0)
    const expiresAt = ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Number.POSITIVE_INFINITY;
    this.cache.set(key, { value, expiresAt, size });
    this.totalSize += size;
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) this.remove(key, entry);
    }
  }

  /**
   * 캐시에서 데이터 조회 또는 fetcher 실행
   */
  async getOrFetch<T>(
    prefix: string,
    params: Record<string, unknown>,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const key = this.generateKey(prefix, params);

    // 캐시에서 조회
    const cached = this.read<T>(key);
    if (cached !== undefined) {
      return cached;
    }

    // 동일 키 in-flight 요청이 있으면 그 promise 공유 (stampede 방지)
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = (async () => {
      try {
        const data = await fetcher();
        // 빈 배열은 일시 장애일 수 있음 — 짧은 TTL로만 캐시 (장기 고착 방지)
        const isEmpty = Array.isArray(data) && data.length === 0;
        this.write(
          key,
          data,
          isEmpty ? TTL.EMPTY_RESULT : (ttl ?? config.cache.ttlHours * 60 * 60)
        );
        return data;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * 통계 목록 캐시
   */
  async getStatisticsList<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('list', params, fetcher, TTL.STATISTICS_LIST);
  }

  /**
   * 통계 데이터 캐시
   */
  async getStatisticsData<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('data', params, fetcher, TTL.STATISTICS_DATA);
  }

  /**
   * 검색 결과 캐시
   */
  async getSearchResults<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('search', params, fetcher, TTL.SEARCH_RESULTS);
  }

  /**
   * 통계 설명 캐시
   */
  async getExplanation<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('explain', params, fetcher, TTL.EXPLANATION);
  }

  /**
   * 테이블 메타데이터 캐시
   */
  async getTableMeta<T>(
    params: Record<string, unknown>,
    fetcher: () => Promise<T>
  ): Promise<T> {
    return this.getOrFetch('meta', params, fetcher, TTL.TABLE_META);
  }

  /**
   * 캐시 통계
   */
  getStats() {
    return { keys: this.cache.size, size: this.totalSize, hits: this.hits, misses: this.misses };
  }

  /**
   * 캐시 초기화
   */
  flush() {
    this.cache.clear();
    this.totalSize = 0;
  }
}

// 싱글톤 인스턴스
let cacheInstance: CacheManager | null = null;

export function getCacheManager(): CacheManager {
  if (!cacheInstance) {
    cacheInstance = new CacheManager();
  }
  return cacheInstance;
}

export { CacheManager, TTL };
