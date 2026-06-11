/**
 * extractKeyword — substring 오매칭 가드 (P0-3)
 *
 * 핵심 보장: 한글 수식어가 직접 붙은 복합어("다문화인구", "청년실업률")는
 * 부분 매칭으로 다른 지표를 반환하지 않는다. 지역명·시점 접두는 정상 허용.
 */
import { describe, it, expect } from 'vitest';
import { extractKeyword, extractDistrictName, extractProvinceName } from '../../src/tools/quickStats.js';
import {
  getQuickStatsParam,
  getRegionCode,
  normalizeKeywordKey,
  MISLEADING_KEYWORD_HINTS,
  QUICK_STATS_PARAMS,
} from '../../src/data/quickStatsParams.js';

describe('extractKeyword — 정상 매칭', () => {
  it('키워드 단독', () => {
    expect(extractKeyword('인구')).toBe('인구');
    expect(extractKeyword('GDP')).toBe('GDP');
  });

  it('지역명 접두 허용', () => {
    expect(extractKeyword('서울 인구')).toBe('인구');
    expect(extractKeyword('서울인구')).toBe('인구');
    expect(extractKeyword('광진구 인구')).toBe('인구');
    expect(extractKeyword('강원도 인구')).toBe('인구');
  });

  it('조사·시점 접두 허용', () => {
    expect(extractKeyword('서울의 인구')).toBe('인구');
    expect(extractKeyword('2024년 인구')).toBe('인구');
    expect(extractKeyword('한국 인구')).toBe('인구');
    expect(extractKeyword('전국 실업률')).toBe('실업률');
  });

  it('긴 키 우선 — 복합 키워드는 자기 자신으로', () => {
    expect(extractKeyword('노인인구')).toBe('노인인구');
    expect(extractKeyword('고령인구비율')).toBe('고령인구비율');
    expect(extractKeyword('경기 노인 인구')).toBe('노인인구'); // '노인인구' 자체가 정식 키
  });

  it('오타·별칭 정규화', () => {
    expect(extractKeyword('출산률')).toBe('출산율');
    expect(extractKeyword('저출산')).toBe('출산율');
  });
});

describe('extractKeyword — 수식어 결합 복합어 차단 (P0-3)', () => {
  it.each(['다문화인구', '유소년인구', '외국인 인구 현황', '수도권인구'])(
    '"%s" → 총인구로 오매칭하지 않음',
    (q) => {
      const kw = extractKeyword(q);
      expect(kw).not.toBe('인구');
      expect(kw).not.toBe('총인구');
    }
  );

  it('청년실업률 → 전체 실업률로 치환하지 않음 (P0-2)', () => {
    expect(extractKeyword('청년실업률')).not.toBe('실업률');
    expect(getQuickStatsParam('청년실업률')).toBeUndefined();
    expect(getQuickStatsParam('청년실업')).toBeUndefined();
  });

  it('연봉/소득 → 월급으로 치환하지 않음 (P0-2)', () => {
    expect(getQuickStatsParam('연봉')).toBeUndefined();
    expect(getQuickStatsParam('소득')).toBeUndefined();
    // 월 단위 표현은 유지
    expect(getQuickStatsParam('월소득')).toBeDefined();
  });
});

describe('MISLEADING_KEYWORD_HINTS', () => {
  it('청년실업·연봉·가계소득 질의에 안내 매칭', () => {
    for (const q of ['청년 실업률', '평균 연봉', '가계소득']) {
      const norm = normalizeKeywordKey(q);
      expect(MISLEADING_KEYWORD_HINTS.some((h) => h.pattern.test(norm))).toBe(true);
    }
  });
});

describe('지역 추출', () => {
  it('extractDistrictName', () => {
    expect(extractDistrictName('광진구 인구')).toBe('광진구');
    expect(extractDistrictName('수원시 출산율')).toBe('수원시');
    expect(extractDistrictName('인구')).toBeNull(); // NON_DISTRICT_WORDS
    expect(extractDistrictName('대구 인구')).toBeNull(); // 광역시 약칭
  });

  it('extractProvinceName', () => {
    expect(extractProvinceName('서울 인구', false)).toBe('서울');
    expect(extractProvinceName('전라북도 인구', false)).toBe('전북');
    expect(extractProvinceName('인구', false)).toBeNull();
  });
});

describe('getRegionCode — 정규화 + null (P0-1)', () => {
  const popParam = QUICK_STATS_PARAMS['인구'];

  it('약칭·풀네임 모두 매칭', () => {
    expect(getRegionCode(popParam, '서울')).toBe('11');
    expect(getRegionCode(popParam, '전라북도')).toBe('52');
    expect(getRegionCode(popParam, '강원특별자치도')).toBe('51');
    expect(getRegionCode(popParam, '강원도')).toBe('51');
  });

  it('미인식 지역 → null (전국 fallback 금지)', () => {
    expect(getRegionCode(popParam, '아무지역')).toBeNull();
    expect(getRegionCode(popParam, '경기도청')).toBeNull();
  });
});

describe('노령화지수 라우팅 (P0-4)', () => {
  it('실측표 DT_1IN2030 + 지역 objL2', () => {
    const p = getQuickStatsParam('노령화지수')!;
    expect(p.tableId).toBe('DT_1IN2030');
    expect(p.itemId).toBe('T4');
    expect(p.regionObjLevel).toBe(2);
    expect(p.isProjection).toBeUndefined();
  });

  it('고령인구비율은 별도 키워드 (지수≠비율)', () => {
    const p = getQuickStatsParam('고령인구비율')!;
    expect(p.tableId).toBe('DT_1YL20631');
    expect(p.itemId).toBe('T10');
  });
});
