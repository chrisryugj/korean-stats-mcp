/**
 * 동시성 제한 map — 체인 도구가 N지역 × M지표를 한 번에 풀어놓을 때
 * (최대 17×8=136개) KOSIS 동시 호출을 제한해 쿼터·스로틀 사고를 방지한다.
 *
 * 입력 순서를 보존하여 결과 배열을 반환한다. 개별 실패는 mapper가 처리
 * (체인 도구는 부분 실패 허용 설계 — mapper 내부 try/catch).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

/** 체인 도구 기본 동시성 (KOSIS 호출 기준) */
export const CHAIN_CONCURRENCY = 8;
