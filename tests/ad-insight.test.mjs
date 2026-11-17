//  110 광고 인사이트 — 피로도 판정 · 브랜드×속성 표 (순수 함수, DB·네트워크 없음)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    FATIGUE, MIN_SAMPLE, fatigueOf, budgetChangeDays, formatOf, productOf, weekdayOf, firstLineOf,
    creativesOf, attrTable, brandSentences, median,
} from '../supabase/functions/_shared/ad-insight.js';

const D = (i) => { const t = new Date(Date.UTC(2026, 10, 1 + i)); return t.toISOString().slice(0, 10); };
//  하루 지출 30,000원 고정, 팔로우로 단가를 만든다. freq=누적 빈도, lc=링크클릭(노출 10,000 기준)
const day = (i, follows, freq = 1.2, lc = 800) => ({ day: D(i), spend: 30000, follows, impressions: 10000, link_clicks: lc, cum_frequency: freq });
//  처음 3일 기준 cpf = 90000/300 = 300원
const base3 = () => [day(0, 100, 1.20), day(1, 100, 1.22), day(2, 100, 1.24)];

test('보류: 지출 3일 미만 · 팔로우 적어 3일 cpf 없음', () => {
    assert.equal(fatigueOf(base3().slice(0, 2)).state, 'hold');
    assert.equal(fatigueOf([day(0, 2), day(1, 3), day(2, 4)]).state, 'hold', `3일 팔로우 ${FATIGUE.minFollows3}명 미만`);
    assert.equal(fatigueOf(base3()).state, 'fresh');
});

test('경계: 기준보다 정확히 +30% 는 나쁜 날, +29% 는 아니다', () => {
    //  3일 cpf = 90000/f3. 기준 300 → 390 이면 +30% → f3 = 230.77 은 정수가 아니라 지출로 맞춘다
    const rows = base3();
    const at = (pct) => { const r = [...rows, { ...day(3, 100, 1.4, 600) }];
        //  창 [1,2,3] 의 cpf 가 300*(1+pct) 가 되도록 3일째 지출 조정: (60000+x)/300 = 300(1+pct)
        r[3].spend = Math.round(300 * (1 + pct) * 300 - 60000); return fatigueOf(r); };
    assert.equal(at(0.30).current.worse, 0.3); assert.equal(at(0.30).state, 'warn');
    assert.equal(at(0.29).state, 'fresh');
});

test('피로: 나쁜 날 2일 연속 + 누적 빈도↑ + CTR↓ (근거 저장)', () => {
    const rows = [...base3(), day(3, 25, 1.30, 650), day(4, 25, 1.35, 600)];
    const r = fatigueOf(rows);
    assert.equal(r.state, 'tired'); assert.equal(r.run, 2);
    assert.equal(r.baseline.cpf, 300); assert.ok(r.current.cpf >= 390);
    assert.equal(r.freqUp, true); assert.equal(r.ctrDown, true);
    assert.ok(r.reasons.some(s => s.includes('누적 빈도 1.24 → 1.35(상승)')), r.reasons.join('|'));
    assert.ok(r.reasons.some(s => s.startsWith('1명당 300원 →')));
});

test('주의: 2일 연속 나쁘지만 빈도 그대로 · CTR 유지 / 빈도 미확인이면 피로 못 감', () => {
    const flat = [...base3(), day(3, 60, 1.24, 800), day(4, 50, 1.25, 800)];
    assert.equal(fatigueOf(flat).state, 'warn');
    const noFreq = [...base3(), day(3, 60, null, 600), day(4, 50, null, 600)];
    const r = fatigueOf(noFreq);
    assert.equal(r.state, 'warn'); assert.equal(r.freqUp, null);
    assert.ok(r.reasons.includes('누적 빈도 미확인'));
});

test('예산 변경: 바뀐 날·다음날은 판정 제외, 기준은 바뀐 뒤 3일로 다시 잡는다', () => {
    //  0~2 cpf 300, 3일에 예산 3만→6만. 그 뒤 단가가 450 으로 올라 그대로 유지(규모 효과) → 피로 아님
    const rows = [...base3(), day(3, 70, 1.3, 600), day(4, 66, 1.32, 600), day(5, 67, 1.34, 600), day(6, 66, 1.36, 600), day(7, 67, 1.38, 600)];
    const budgets = [{ day: D(2), daily_budget: 30000 }, { day: D(3), daily_budget: 60000 }];
    assert.deepEqual(budgetChangeDays(budgets), [D(3)]);
    const r = fatigueOf(rows, { budgets });
    assert.equal(r.state, 'fresh', r.reasons.join('|'));
    assert.equal(r.baseline.from >= D(3), true, '기준이 변경 뒤로 옮겨졌다');
    //  재기준 없이(예산 기록 없음) 보면 같은 숫자가 피로로 잘못 걸린다 — 재기준이 필요한 이유
    assert.notEqual(fatigueOf(rows).state, 'fresh');
    //  바뀐 날 당일·다음날로 끝나면 '판정 제외' 문구
    const r2 = fatigueOf(rows.slice(0, 5), { budgets });
    assert.equal(r2.state, 'hold');
});

test('예산 변경 제외일은 연속을 끊지 않는다', () => {
    const rows = [...base3(), day(3, 50, 1.3, 600), day(4, 50, 1.35, 600), day(5, 50, 1.4, 550)];
    //  4일째 예산 그대로 다시 적힘(변경 아님) → 변경 없음
    assert.deepEqual(budgetChangeDays([{ day: D(3), daily_budget: 1 }, { day: D(4), daily_budget: 1 }]), []);
    assert.equal(fatigueOf(rows).state, 'tired');
});

test('피로는 나쁜 구간이 이어지는 동안 유지, 단가가 기준+30% 안으로 오면 풀린다', () => {
    const tired = [...base3(), day(3, 25, 1.30, 650), day(4, 25, 1.35, 600)];
    const keep = [...tired, day(5, 30, 1.40, 760)];   // CTR 은 회복됐지만 단가 여전히 나쁨
    const r = fatigueOf(keep);
    assert.equal(r.state, 'tired'); assert.equal(r.tiredSince, D(4));
    const back = [...keep, day(6, 120, 1.42, 800), day(7, 120, 1.44, 800), day(8, 120, 1.46, 800)];
    assert.equal(fatigueOf(back).state, 'fresh');
});

test('실측 hhh_1010(10-11~11-02): 예산 5만→8만(10-15) 재기준 → 10-21 주의, 10-24 피로', () => {
    const f = JSON.parse(readFileSync(new URL('./fixtures/ad-hhh_1010.json', import.meta.url)));
    const upto = (d) => fatigueOf(f.rows.filter(r => r.day <= d), { budgets: f.budgets });
    assert.equal(upto('2026-10-20').state, 'fresh');
    assert.equal(upto('2026-10-21').state, 'warn');
    const t = upto('2026-10-24');
    assert.equal(t.state, 'tired'); assert.equal(t.baseline.cpf, 483);
    assert.equal(upto('2026-11-02').state, 'tired');
    //  재기준이 없으면 예산 올린 직후(10-17)부터 나빠 보인다
    assert.notEqual(fatigueOf(f.rows.filter(r => r.day <= '2026-10-17')).state, 'fresh');
});

test('속성: 형식 · 상품(이름 규칙/수동) · 요일 · 첫 줄', () => {
    assert.equal(formatOf({ media_type: 'VIDEO', media_product_type: 'REELS' }), '릴스');
    assert.equal(formatOf({ media_type: 'CAROUSEL_ALBUM' }), '캐러셀');
    assert.equal(formatOf({ media_type: 'IMAGE' }), '사진');
    assert.equal(formatOf({}), '미상');
    assert.equal(productOf({ adset_name: 'hhh_1113가디건_PV' }), '가디건');
    assert.equal(productOf({ adset_name: 'tovee_1114 니트조끼_PV - 사본' }), '니트조끼');
    assert.equal(productOf({ adset_name: 'hhh_1010' }), '미상');
    assert.equal(productOf({ adset_name: 'hhh_1113가디건_PV', product_tag: '가디건(블랙)' }), '가디건(블랙)');
    assert.equal(weekdayOf('2026-11-17'), '화요일');
    assert.equal(firstLineOf('\n  첫 줄입니다\n둘째'), '첫 줄입니다');
    assert.equal(firstLineOf('가'.repeat(40)).length, 31);
});

test('브랜드×속성: 첫 3일 cpf 중앙값 + 표본, 팔로우 30명 미만은 표본 부족', () => {
    const links = [
        { ad_id: 'a1', media_id: 'm1', brand_id: 'b1', adset_name: 'hhh_1101가디건_PV' },
        { ad_id: 'a2', media_id: 'm2', brand_id: 'b1', adset_name: 'hhh_1102가디건_PV' },
        { ad_id: 'a3', media_id: 'm3', brand_id: 'b1', adset_name: 'hhh_1103니트_PV' },
        { ad_id: 'a4', media_id: 'm3', brand_id: 'b1', adset_name: 'hhh_1103니트_PV' }, // 같은 게시물 → 합친다
        { ad_id: 'a5', media_id: 'm5', brand_id: 'b1', adset_name: 'hhh_1105코트_PV' },  // 2일뿐 → 제외
        { ad_id: 'x', media_id: 'mx', brand_id: 'b1', excluded: true },
    ];
    const d = (ad, i, spend, follows) => ({ ad_id: ad, day: D(i), spend, follows });
    const daily = [
        d('a1', 0, 10000, 10), d('a1', 1, 10000, 10), d('a1', 2, 10000, 10), d('a1', 3, 99999, 1), // 4일째는 안 센다
        d('a2', 0, 10000, 5), d('a2', 1, 10000, 5), d('a2', 2, 10000, 5),
        d('a3', 0, 5000, 2), d('a3', 1, 5000, 2), d('a4', 2, 5000, 2), d('a4', 0, 5000, 2),
        d('a5', 0, 1000, 1), d('a5', 1, 1000, 1), d('x', 0, 1, 1),
    ];
    const media = [
        { media_id: 'm1', media_type: 'VIDEO', media_product_type: 'REELS', posted_day: '2026-11-02', caption: '가디건 하나로\n…' },
        { media_id: 'm2', media_type: 'VIDEO', media_product_type: 'REELS', posted_day: '2026-11-03', caption: '가을 가디건' },
        { media_id: 'm3', media_type: 'CAROUSEL_ALBUM', posted_day: '2026-11-02', caption: '니트' },
    ];
    const cs = creativesOf({ links, daily, media });
    const m3 = cs.find(c => c.media_id === 'm3');
    assert.deepEqual([m3.days, m3.spend3, m3.follows3, m3.cpf3], [3, 20000, 8, 2500], '같은 게시물 광고 합산, 첫 3일만');
    assert.equal(cs.find(c => c.media_id === 'm1').cpf3, 1000);
    assert.ok(!cs.some(c => c.media_id === 'mx'));
    const rows = attrTable(cs);
    const reels = rows.find(r => r.attr === 'format' && r.value === '릴스');
    assert.deepEqual([reels.n, reels.follows, reels.median_cpf, reels.enough], [2, 45, 1500, true]);
    const car = rows.find(r => r.attr === 'format' && r.value === '캐러셀');
    assert.deepEqual([car.n, car.follows, car.enough, car.note], [1, 8, false, '표본 부족']);
    assert.ok(!rows.some(r => r.value === '코트'), '3일 미만은 표에서 뺀다');
    assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 3); assert.equal(median([]), null);

    const s = brandSentences(rows, 'b1', '하이헤이호');
    assert.equal(s.length, 3);
    assert.match(s[0], /릴스'만 표본이 차서/, '캐러셀은 표본 부족이라 비교 상대가 아니다');
    assert.match(s[1], /상품은 '가디건'만/);
    assert.match(s[2], /표본 부족|만 표본/);
    assert.equal(MIN_SAMPLE, 30);
});

test('brandSentences: 표본 충분한 값 2개면 싼 쪽을 말한다', () => {
    const rows = [
        { brand_id: 'b', attr: 'format', value: '릴스', median_cpf: 500, n: 4, follows: 120, enough: true },
        { brand_id: 'b', attr: 'format', value: '사진', median_cpf: 900, n: 3, follows: 40, enough: true },
        { brand_id: 'b', attr: 'format', value: '캐러셀', median_cpf: 100, n: 1, follows: 5, enough: false },
    ];
    const [f, p, w] = brandSentences(rows, 'b', '토비');
    assert.equal(f, "토비 형식은 '릴스'가 1명당 500원(게시물 4개·팔로우 120명)으로 '사진' 900원보다 싸다.");
    assert.match(p, /데이터 없음/); assert.match(w, /데이터 없음/);
    assert.match(brandSentences([...rows, { brand_id: 'b', attr: 'weekday', value: '월요일', median_cpf: 1, n: 1, follows: 3, enough: false }], 'b')[2], /표본 부족/);
});
