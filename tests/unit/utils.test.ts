/**
 * 순수 유틸 단위 테스트 — parseKosisNumber·mapWithConcurrency·CacheManager·extractYearCount
 */
import { describe, it, expect } from 'vitest';
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
