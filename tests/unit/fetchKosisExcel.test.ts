/**
 * KOSIS 파일 통계표 다운로드 절차 회귀 (2026-09-23)
 *
 * KOSIS 가 2026-08-05 "웹취약수정"으로 dwldServerFile.do 에 srvcNm(fileItmDownload.do 응답값)을 요구한다.
 * 빠지면 xlsx 대신 eGovFrame 오류 페이지(2,392B)가 와서 fetch_kosis_excel 이 전부 실패했다.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchKosisExcel } from '../../src/tools/fetchKosisExcel.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchKosisExcel 다운로드 절차', () => {
  it('3단계 요청에 2단계 응답의 srvcNm 을 싣는다', async () => {
    const bodies: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('fileStblView.do')) {
        return new Response('<html></html>', { status: 200, headers: { 'set-cookie': 'JSESSIONID=abc; Path=/' } });
      }
      if (u.includes('fileItmDownload.do')) {
        bodies.info = String(init?.body);
        return Response.json({ success: true, resultMap: { dwldFilePath: '/p/', dwldFileNm: 'x^@^1.xlsx', srvcNm: 'Ⅲ. 인구.xlsx', dwldFileSize: 10 } });
      }
      bodies.download = String(init?.body);
      return new Response('not-a-real-xlsx', { status: 200 });
    }));

    await fetchKosisExcel({ orgId: '505', tblId: 'DT_505001_FILE2024', fileSn: 2 });
    expect(new URLSearchParams(bodies.download).get('srvcNm')).toBe('Ⅲ. 인구.xlsx');
  });
});
