/**
 * 순수 유틸 단위 테스트 — parseKosisNumber·mapWithConcurrency·CacheManager·extractYearCount
 */
import { describe, it, expect, vi } from 'vitest';
import { parseKosisNumber } from '../../src/utils/dataFormatter.js';
import { mapWithConcurrency } from '../../src/utils/concurrency.js';
import { CacheManager } from '../../src/cache/index.js';
import { extractYearCount } from '../../src/tools/quickTrend.js';
import { normalizeProvinceName } from '../../src/utils/regions.js';

describe('parseKosisNumber', () => {
  it('콤마·부호 처리', () => {
    expect(parseKosisNumber('1,234')).toBe(1234);
    expect(parseKosisNumber('-5.2')).toBe(-5.2);
  });
  it('값 0 보존 (|| null 패턴 회귀 방지 — P1-3)', () => {
    expect(parseKosisNumber('0')).toBe(0);
  });
  it('결측은 null', () => {
    expect(parseKosisNumber('-')).toBeNull();
    expect(parseKosisNumber('...')).toBeNull();
    expect(parseKosisNumber('')).toBeNull();
    expect(parseKosisNumber(undefined)).toBeNull();
  });
});

describe('mapWithConcurrency', () => {
  it('순서 보존', async () => {
    const out = await mapWithConcurrency([3, 1, 2], async (n) => {
      await new Promise((r) => setTimeout(r, n * 5));
      return n * 10;
    }, 2);
    expect(out).toEqual([30, 10, 20]);
  });

  it('동시 실행 상한 준수', async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
    }, 4);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe('CacheManager', () => {
  it('동일 키 동시 호출 dedup — fetcher 1회만 (P1-2)', async () => {
    const cache = new CacheManager();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return [{ v: 1 }];
    };
    const [a, b, c] = await Promise.all([
      cache.getOrFetch('t', { k: 1 }, fetcher),
      cache.getOrFetch('t', { k: 1 }, fetcher),
      cache.getOrFetch('t', { k: 1 }, fetcher),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('비어있지 않은 결과는 캐시 히트', async () => {
    const cache = new CacheManager();
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return [1, 2];
    };
    await cache.getOrFetch('t', { k: 2 }, fetcher);
    await cache.getOrFetch('t', { k: 2 }, fetcher);
    expect(calls).toBe(1);
  });

  // node-cache 시절엔 maxKeys 가 차면 set() 이 ECACHEFULL 을 던져, 받아 온 응답까지 실패로 끝났다
  it('키 상한이 차도 던지지 않고 가장 오래 안 쓴 항목을 내보낸다', async () => {
    const cache = new CacheManager(3, 1_000_000);
    const calls: number[] = [];
    const get = (k: number) => cache.getOrFetch('t', { k }, async () => { calls.push(k); return [k]; });
    for (const k of [1, 2, 3]) await get(k);
    await get(1); // 1 을 최근으로 승격 → 다음 축출 대상은 2
    await expect(get(4)).resolves.toEqual([4]);
    expect(cache.getStats().keys).toBe(3);
    await get(1);
    await get(2); // 축출됐으니 다시 가져온다
    expect(calls).toEqual([1, 2, 3, 4, 2]);
  });

  it('총량 상한을 넘기지 않는다', async () => {
    const cache = new CacheManager(1000, 1000);
    const row = 'x'.repeat(90); // 직렬화 길이 ≈ 94
    for (let k = 0; k < 30; k++) await cache.getOrFetch('t', { k }, async () => [row]);
    expect(cache.getStats().size).toBeLessThanOrEqual(1000);
    expect(cache.getStats().keys).toBe(10);
  });

  it('예산의 1/8 을 넘는 단건은 캐시하지 않는다', async () => {
    const cache = new CacheManager(1000, 800);
    let calls = 0;
    const fetcher = async () => { calls++; return ['y'.repeat(200)]; };
    await cache.getOrFetch('t', { k: 1 }, fetcher);
    await cache.getOrFetch('t', { k: 1 }, fetcher);
    expect(calls).toBe(2);
    expect(cache.getStats().size).toBe(0);
  });

  it('TTL 0 은 만료 없음으로 둔다 (node-cache stdTTL 0 과 같은 뜻)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const cache = new CacheManager();
      let calls = 0;
      const fetcher = async () => { calls++; return [1]; };
      await cache.getOrFetch('t', { k: 1 }, fetcher, 0);
      vi.setSystemTime(Date.now() + 30 * 24 * 3600 * 1000);
      await cache.getOrFetch('t', { k: 1 }, fetcher, 0);
      expect(calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('만료된 항목은 다시 가져온다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const cache = new CacheManager();
      let calls = 0;
      const fetcher = async () => { calls++; return [1]; };
      await cache.getOrFetch('t', { k: 1 }, fetcher, 60);
      vi.setSystemTime(Date.now() + 59_000);
      await cache.getOrFetch('t', { k: 1 }, fetcher, 60);
      vi.setSystemTime(Date.now() + 2_000);
      await cache.getOrFetch('t', { k: 1 }, fetcher, 60);
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('extractYearCount', () => {
  it('자연어 기간 추출', () => {
    expect(extractYearCount('지난 5년 인구')).toBe(5);
    expect(extractYearCount('민선 8기 출산율')).toBe(4);
    expect(extractYearCount('작년 대비 실업률')).toBe(2);
    expect(extractYearCount('역대 GDP')).toBe(20);
    expect(extractYearCount('인구')).toBeNull();
  });
});

describe('normalizeProvinceName', () => {
  it('풀네임·구명칭 → 약칭', () => {
    expect(normalizeProvinceName('전라북도')).toBe('전북');
    expect(normalizeProvinceName('전북특별자치도')).toBe('전북');
    expect(normalizeProvinceName('서울특별시')).toBe('서울');
    expect(normalizeProvinceName('미상지역')).toBe('미상지역');
  });
});
