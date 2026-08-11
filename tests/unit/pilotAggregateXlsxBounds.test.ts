import { describe, expect, it } from 'vitest';
import { appendRowsWithinLimit } from '../../src/tools/compareStatistics.js';
import { readResponseBodyWithLimit } from '../../src/tools/fetchKosisExcel.js';

describe('Pilot A comparison aggregate byte budget', () => {
  it('rejects before mutating the target when the byte budget is exceeded', () => {
    const aggregate = [{ DT: '1' }];
    const currentBytes = Buffer.byteLength(JSON.stringify(aggregate), 'utf8');

    expect(() =>
      appendRowsWithinLimit(aggregate, [{ DT: 'x'.repeat(128) }], 10, currentBytes, 64)
    ).toThrow(/aggregate byte limit/i);
    expect(aggregate).toEqual([{ DT: '1' }]);
  });

  it('returns the cumulative byte estimate after appending a bounded chunk', () => {
    const aggregate: Array<{ DT: string }> = [];
    const rows = [{ DT: '1' }, { DT: '2' }];

    const aggregateBytes = appendRowsWithinLimit(aggregate, rows, 10, 0, 1024);

    expect(aggregate).toEqual(rows);
    expect(aggregateBytes).toBe(Buffer.byteLength(JSON.stringify(rows), 'utf8'));
  });
});

describe('Pilot A XLSX declared-size cleanup', () => {
  it('cancels a declared oversized body before rejecting it', async () => {
    let cancelled = false;
    const declared = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-length': '1024' } }
    );

    await expect(readResponseBodyWithLimit(declared, 10)).rejects.toThrow(/size limit/i);
    expect(cancelled).toBe(true);
  });
});
