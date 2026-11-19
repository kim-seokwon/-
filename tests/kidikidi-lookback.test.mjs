//  H 11-19: 키디키디 2025-07(약 506일 전) 줄 확보 확인용 — 수동 실행에서만 조회 기간을 넓힌다. 예약 실행은 그대로 400일.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const y = readFileSync(new URL('../.github/workflows/kidikidi-sync.yml', import.meta.url), 'utf8');
const s = readFileSync(new URL('../channel-bots/kidikidi/sync.mjs', import.meta.url), 'utf8');

test('수동 실행 입력 lookback_days → LOOKBACK_DAYS, 기본 빈 값(=400)', () => {
    assert.match(y, /lookback_days:\n\s+description: [^\n]+\n\s+type: string\n\s+default: ''/);
    assert.match(y, /LOOKBACK_DAYS: \$\{\{ inputs\.lookback_days \}\}/);
    assert.match(y, /extend:[\s\S]*?default: false/, '계정 연장 확인은 기본 꺼짐 그대로');
});

test('sync.mjs 는 1~800 정수만 받고 나머지는 400', () => {
    assert.match(s, /Number\.isInteger\(lb\) && lb >= 1 && lb <= 800 \? lb : 400/);
    const pick = v => { const lb = Number(v); return Number.isInteger(lb) && lb >= 1 && lb <= 800 ? lb : 400; };
    assert.deepEqual(['', undefined, 'abc', '0', '5000', '520', '400.5'].map(pick), [400, 400, 400, 400, 400, 520, 400]);
});
