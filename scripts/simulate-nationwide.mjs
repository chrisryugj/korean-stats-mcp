/**
 * 전국 시군구 전수 라우팅 시뮬레이션
 *
 * KOSIS DT_1ES3A03_A01S 메타에서 전국 행정 시군구 전체(231행, 일반구·폐지구역 제외)를
 * 동적 추출 → 각 시군구를 quickStats로 전수 조회.
 *
 * 검증 키워드 (자치구 정밀 라우팅 대상):
 *   인구(DT_1B040A3) · 고용률(DT_1ES3A03_A01S) · 사망률(INH_1B80A18)
 *
 * 합격 기준:
 *   precise  = 자치구 단위 정밀값 (FILE 통계연보 또는 자치구 OpenAPI 라우팅)
 *   fallback = 광역 fallback (KOSIS 자치구 데이터 미수록 — 동명 disambiguate 불가 등)
 *   fail     = success=false / 예외
 *   → precise + fallback = 100% (fail 0건). 단 precise 비율도 함께 측정.
 */
import { quickStats } from '../dist/tools/quickStats.js';
import { getKosisClient } from '../dist/api/client.js';

const METRO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산'];

/**
 * 시 승격·통합으로 폐지된 옛 행정구역 — KOSIS 시계열 메타에 잔존하나 현행 아님.
 * 여주군→여주시(2013), 청원군→청주시 통합(2014), 연기군→세종시(2012).
 */
const DEFUNCT = new Set(['여주군', '청원군', '연기군']);

/**
 * 동명 시군 — 전국에 같은 이름이 둘 이상. 광역시도를 명시해야 disambiguate 가능.
 * 고성군(강원·경남), 광주시(경기 — 광주광역시와 충돌).
 */
const HOMONYM = { '고성군': ['강원', '경남'], '광주시': ['경기'] };

/** DT_1ES3A03_A01S 메타에서 전국 현행 시군구 목록 추출 */
async function loadNationwideDistricts() {
  const client = getKosisClient();
  const meta = await client.getTableMeta('101', 'DT_1ES3A03_A01S', 'ITM');
  const A = meta.filter((r) => r.OBJ_ID === 'A');
  const seen = new Set();
  const districts = [];
  for (const r of A) {
    const nm = (r.ITM_NM ?? '').trim();
    if (!nm) continue;
    const sp = nm.split(/\s+/);
    if (sp.length === 2 && METRO.includes(sp[0])) {
      // 광역시 자치구 — "서울 종로구"
      districts.push({ province: sp[0], name: sp[1], itmId: r.ITM_ID });
    } else if (sp.length === 1 && !METRO.includes(nm)) {
      // 도 시군 — "수원시". 폐지구역 제외, 동명은 광역시도별로 분리.
      if (DEFUNCT.has(nm) || seen.has(nm)) continue;
      seen.add(nm);
      if (HOMONYM[nm]) {
        for (const prov of HOMONYM[nm]) districts.push({ province: prov, name: nm, homonym: true });
      } else {
        districts.push({ province: null, name: nm });
      }
    }
  }
  return districts;
}

function classify(result) {
  if (!result || result.success !== true) return 'fail';
  const note = result.note ?? '';
  const src = result.source?.tableId ?? '';
  if (src.includes('FILE')) return 'precise';
  if (
    note.includes('통계연보(.xlsx) 조회 실패') ||
    note.includes('자치구 매핑이 모호') ||
    note.includes('데이터 미수록') ||
    note.includes('광역시도 데이터로 대체')
  ) {
    return 'fallback';
  }
  // 자치구 query인데 fallback 안내 없음 = 자치구 정밀 라우팅
  return 'precise';
}

const KEYWORDS = ['인구', '고용률', '사망률'];

async function runOne(district, keyword) {
  const query = district.province
    ? `${district.province} ${district.name} ${keyword}`
    : `${district.name} ${keyword}`;
  const start = Date.now();
  try {
    const result = await quickStats({ query });
    return {
      district: district.province ? `${district.province} ${district.name}` : district.name,
      keyword, query, status: classify(result),
      value: result.value ?? null, unit: result.unit ?? null,
      source: result.source?.tableId ?? null,
      noteHead: typeof result.note === 'string' ? result.note.slice(0, 100).replace(/\n/g, ' ') : null,
      ms: Date.now() - start,
    };
  } catch (e) {
    return {
      district: district.province ? `${district.province} ${district.name}` : district.name,
      keyword, query, status: 'fail',
      error: e instanceof Error ? e.message : String(e), ms: Date.now() - start,
    };
  }
}

(async () => {
  console.log('\n전국 시군구 전수 시뮬레이션 — 메타 로드 중...\n');
  const districts = await loadNationwideDistricts();
  console.log(`전국 시군구 ${districts.length}개 × 키워드 ${KEYWORDS.length}종 = ${districts.length * KEYWORDS.length} 케이스\n`);

  const results = [];
  for (const kw of KEYWORDS) {
    for (const d of districts) {
      const r = await runOne(d, kw);
      results.push(r);
    }
  }

  // 키워드별 집계
  const byKw = {};
  for (const r of results) {
    if (!byKw[r.keyword]) byKw[r.keyword] = { precise: 0, fallback: 0, fail: 0, total: 0 };
    byKw[r.keyword][r.status] += 1;
    byKw[r.keyword].total += 1;
  }

  const fails = results.filter((r) => r.status === 'fail');
  const total = results.length;
  const ok = results.filter((r) => r.status !== 'fail').length;
  const precise = results.filter((r) => r.status === 'precise').length;

  console.log('── 키워드별 결과 ──');
  for (const [kw, s] of Object.entries(byKw)) {
    console.log(`  ${kw.padEnd(8)} precise=${s.precise}  fallback=${s.fallback}  fail=${s.fail}  (${s.total})`);
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`커버 (fail 0) : ${ok}/${total} (${((ok / total) * 100).toFixed(1)}%)`);
  console.log(`자치구 정밀값  : ${precise}/${total} (${((precise / total) * 100).toFixed(1)}%)`);

  if (fails.length > 0) {
    console.log(`\n❌ FAIL ${fails.length}건:`);
    for (const r of fails.slice(0, 40)) {
      console.log(`  "${r.query}" → ${r.error ?? r.noteHead ?? '?'}`);
    }
    if (fails.length > 40) console.log(`  ... 외 ${fails.length - 40}건`);
  }

  // fallback 상세 (정밀 라우팅 누락 추적)
  const fallbacks = results.filter((r) => r.status === 'fallback');
  if (fallbacks.length > 0) {
    console.log(`\n⚠️  광역 fallback ${fallbacks.length}건 (키워드별):`);
    const fbByKw = {};
    for (const r of fallbacks) (fbByKw[r.keyword] ??= []).push(r.district);
    for (const [kw, ds] of Object.entries(fbByKw)) {
      console.log(`  [${kw}] ${ds.length}건: ${ds.slice(0, 25).join(', ')}${ds.length > 25 ? ' ...' : ''}`);
    }
  }

  process.exit(fails.length === 0 ? 0 : 1);
})();
