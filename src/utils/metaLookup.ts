/**
 * 메타 자동 lookup
 *
 * KOSIS 통계표의 분류값(자치구·연령·성별·항목 등) ITM_ID는 통계표마다 다르다.
 * 같은 「서울특별시 기본통계」시리즈에서도 광진구 코드가:
 *   DT_201004_O110047 → "001005"
 *   DT_201004_O110054 → "13102127569D1.HCD_11050"
 * 식으로 갈린다.
 *
 * 정적 매핑은 불가능하므로 메타 API(getMeta type=ITM)로 OBJ_NM을 가져와
 * 사용자 입력(예: "광진구")에 매칭되는 ITM_ID를 동적으로 찾는다. 캐싱 24h.
 */
import { getKosisClient } from '../api/client.js';
import { getCacheManager } from '../cache/index.js';

export interface MetaItem {
  ITM_ID: string;
  ITM_NM: string;
  OBJ_NM: string;
  OBJ_ID: string;
  /** OBJ_ID_SN — 분류 순서 (1=objL1, 2=objL2, ...). ITEM 항목은 비어있음 */
  OBJ_ID_SN?: string;
  UP_ITM_ID?: string;
}

/**
 * 통계표 분류·항목 메타 조회 (캐싱)
 */
export async function fetchTableMeta(orgId: string, tblId: string): Promise<MetaItem[]> {
  const cache = getCacheManager();
  return cache.getTableMeta(
    { orgId, tblId, type: 'ITM' },
    async () => {
      const client = getKosisClient();
      const rows = await client.getTableMeta(orgId, tblId, 'ITM');
      return rows as unknown as MetaItem[];
    }
  );
}

export interface MetaGroup {
  objNm: string;
  objId: string;
  objIdSn: string;
  items: MetaItem[];
}

/**
 * 메타를 OBJ별로 그룹화
 */
export function groupMetaByObj(meta: MetaItem[]): MetaGroup[] {
  const map = new Map<string, MetaGroup>();
  for (const r of meta) {
    const sn = r.OBJ_ID_SN ?? '0';
    const key = `${sn}|${r.OBJ_ID}`;
    if (!map.has(key)) {
      map.set(key, { objNm: r.OBJ_NM, objId: r.OBJ_ID, objIdSn: sn, items: [] });
    }
    map.get(key)!.items.push(r);
  }
  return [...map.values()].sort((a, b) => a.objIdSn.localeCompare(b.objIdSn));
}

/**
 * 분류명(예: "자치구별", "성별") 매칭 + 항목명(예: "광진구") 매칭으로 ITM_ID를 찾는다.
 * objNmHint가 비면 모든 분류 그룹을 후보로 검사.
 *
 * 매칭 규칙(우선순위):
 *   1) ITM_NM 완전 일치
 *   2) ITM_NM이 itmNameQuery로 시작
 *   3) ITM_NM에 itmNameQuery 포함
 */
export function findItmIdInMeta(
  meta: MetaItem[],
  itmNameQuery: string,
  objNmHint?: string
): { match: MetaItem; group: MetaGroup } | null {
  const q = itmNameQuery.trim();
  if (!q) return null;
  const groups = groupMetaByObj(meta);
  const targets = objNmHint
    ? groups.filter((g) => g.objNm === objNmHint || g.objNm.includes(objNmHint))
    : groups;

  for (const tier of [
    (it: MetaItem) => it.ITM_NM === q,
    (it: MetaItem) => it.ITM_NM.startsWith(q),
    (it: MetaItem) => it.ITM_NM.includes(q),
  ]) {
    for (const g of targets) {
      const hit = g.items.find(tier);
      if (hit) return { match: hit, group: g };
    }
  }
  return null;
}

/**
 * objL1/objL2/itmId 자동 채우기
 *
 * regionName이 있으면 분류 중 "자치구별/시군구별/행정구역별/지역별" 류의 OBJ에서 매칭한다.
 * 나머지 분류값은 "기본값"(첫 번째 항목, 보통 합계/전체)을 사용한다.
 *
 * 반환값에 누락된 필드(undefined)는 호출 측에서 처리.
 */
export interface ResolveResult {
  itmId?: string;
  objL1?: string;
  objL2?: string;
  objL3?: string;
  objL4?: string;
  /** 매칭에 사용된 정보 (디버깅·응답용) */
  resolved: Array<{ objNm: string; itmNm: string; itmId: string; reason: 'region' | 'default' }>;
  /** 매칭 실패시 후보군 */
  candidates?: Record<string, string[]>;
  /** 사용자가 regionName/itemName을 줬는데 어느 OBJ에서도 매칭 못한 경우 */
  unmatched?: { regionName?: string; itemName?: string };
}

const REGION_OBJ_HINTS = ['자치구별', '시군구별', '행정구역별', '지역별', '시도별', '구별', '시·군·구별'];

export async function resolveDimensions(
  orgId: string,
  tblId: string,
  options: {
    regionName?: string;
    itemName?: string;
    /** 추가로 강제할 OBJ_NM → ITM_NM 매핑 (예: { '성별': '여자' }) */
    overrides?: Record<string, string>;
  } = {}
): Promise<ResolveResult> {
  const meta = await fetchTableMeta(orgId, tblId);
  const groups = groupMetaByObj(meta);
  const resolved: ResolveResult['resolved'] = [];
  const out: ResolveResult = { resolved };

  // 항목 (ITEM)
  let itemMatched = !options.itemName; // itemName 미지정시는 매칭 시도 자체가 없으므로 true
  const itemGroup = groups.find((g) => g.objId === 'ITEM' || g.objNm === '항목');
  if (itemGroup) {
    let item = itemGroup.items[0];
    if (options.itemName) {
      const r = findItmIdInMeta(meta, options.itemName, itemGroup.objNm);
      if (r) {
        item = r.match;
        itemMatched = true;
      }
    }
    out.itmId = item.ITM_ID;
    resolved.push({ objNm: itemGroup.objNm, itmNm: item.ITM_NM, itmId: item.ITM_ID, reason: options.itemName && itemMatched ? 'region' : 'default' });
  }

  // 분류 1~4
  let regionMatched = !options.regionName; // regionName 미지정시 true (검사 불필요)
  const dimGroups = groups.filter((g) => g.objIdSn !== '0' && g.objId !== 'ITEM');
  const candidates: Record<string, string[]> = {};
  for (const g of dimGroups) {
    let picked: MetaItem | undefined;
    let reason: 'region' | 'default' = 'default';

    // 명시적 override
    const overrideName = options.overrides?.[g.objNm];
    if (overrideName) {
      const r = findItmIdInMeta(meta, overrideName, g.objNm);
      if (r) {
        picked = r.match;
        reason = 'region';
      }
    }

    // 지역명 매칭 (REGION 힌트 분류에 한해)
    if (!picked && options.regionName && REGION_OBJ_HINTS.some((h) => g.objNm.includes(h.replace('별', '')) || g.objNm === h)) {
      const r = findItmIdInMeta(meta, options.regionName, g.objNm);
      if (r) {
        picked = r.match;
        reason = 'region';
        regionMatched = true;
      }
    }

    // 기본값 (첫 항목 — 보통 합계/전체)
    if (!picked) {
      picked = g.items[0];
    }

    if (picked) {
      resolved.push({ objNm: g.objNm, itmNm: picked.ITM_NM, itmId: picked.ITM_ID, reason });
      const sn = parseInt(g.objIdSn || '0', 10);
      if (sn === 1) out.objL1 = picked.ITM_ID;
      else if (sn === 2) out.objL2 = picked.ITM_ID;
      else if (sn === 3) out.objL3 = picked.ITM_ID;
      else if (sn === 4) out.objL4 = picked.ITM_ID;
    }

    candidates[g.objNm] = g.items.slice(0, 10).map((it) => it.ITM_NM);
  }

  // 매칭 실패 신호
  if (!regionMatched || !itemMatched) {
    out.unmatched = {};
    if (!regionMatched) out.unmatched.regionName = options.regionName;
    if (!itemMatched) out.unmatched.itemName = options.itemName;
  }

  out.candidates = candidates;
  return out;
}

/**
 * 메타 요약 — get_table_info 경량화용
 */
export interface MetaSummary {
  orgId: string;
  tblId: string;
  groups: Array<{
    objNm: string;
    objIdSn: string;
    totalItems: number;
    /** 처음 10개 + 사용자가 자주 찾을 만한 일부 (전국/합계 등) */
    sample: Array<{ ITM_ID: string; ITM_NM: string }>;
  }>;
}

export async function summarizeTableMeta(
  orgId: string,
  tblId: string,
  options: { sampleSize?: number; filter?: string } = {}
): Promise<MetaSummary> {
  const meta = await fetchTableMeta(orgId, tblId);
  const groups = groupMetaByObj(meta);
  const size = options.sampleSize ?? 10;
  const filter = options.filter?.trim();
  return {
    orgId,
    tblId,
    groups: groups.map((g) => {
      const items = filter
        ? g.items.filter((it) => it.ITM_NM.includes(filter))
        : g.items;
      return {
        objNm: g.objNm,
        objIdSn: g.objIdSn,
        totalItems: g.items.length,
        sample: (filter && items.length === 0 ? g.items : items).slice(0, size).map((it) => ({
          ITM_ID: it.ITM_ID,
          ITM_NM: it.ITM_NM,
        })),
      };
    }),
  };
}
