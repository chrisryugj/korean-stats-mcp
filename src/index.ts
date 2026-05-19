#!/usr/bin/env node
/**
 * Korea Stats MCP - 한국 통계 MCP 서버
 *
 * 통계청 KOSIS OpenAPI를 활용하여 자연어로 통계 데이터를 검색하고 분석합니다.
 *
 * 사용 예:
 *   - "한국 인구는 얼마나 되나요?"
 *   - "최근 10년간 GDP 추이를 보여주세요"
 *   - "서울과 부산의 인구를 비교해주세요"
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main() {
  console.error('🇰🇷 Korea Stats MCP 서버 시작...');

  try {
    // MCP 서버 생성
    const server = createServer();

    // stdio 트랜스포트 생성 및 연결
    const transport = new StdioServerTransport();
    await server.connect(transport);

    console.error('✅ MCP 서버가 성공적으로 시작되었습니다.');
    console.error('📊 사용 가능한 도구 (12개):');
    console.error('   - quick_stats: ⭐ 빠른 조회 (91개 키워드)');
    console.error('   - quick_trend: ⭐ 추세 분석');
    console.error('   - chain_region_brief: ⛓ 지역 종합 브리핑 (speech 옵션)');
    console.error('   - chain_compare_regions: ⛓ N지역×M지표 매트릭스 (전국 17개)');
    console.error('   - chain_policy_indicator: ⛓ 정책 영역 시계열');
    console.error('   - search_statistics: 통계 검색');
    console.error('   - get_statistics_list: 목록 탐색 + 추천 카드');
    console.error('   - get_statistics_data: 데이터 조회');
    console.error('   - compare_statistics: 비교 분석');
    console.error('   - analyze_time_series: 시계열 분석');
    console.error('   - get_table_info: 통계표 메타');
    console.error('   - fetch_kosis_excel: 자치구 엑셀 파싱');
  } catch (error) {
    console.error('❌ 서버 시작 실패:', error);
    process.exit(1);
  }
}

// 프로세스 종료 핸들링
process.on('SIGINT', () => {
  console.error('\n👋 서버를 종료합니다...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('\n👋 서버를 종료합니다...');
  process.exit(0);
});

// 메인 함수 실행
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
