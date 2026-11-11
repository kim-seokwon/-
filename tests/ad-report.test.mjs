//  광고리포트 판정·업로드 경보 (지시서 §7 테스트 2·3·4·6·7 + 1일차 조기중단). 합산(5)은 ad-report-db.test.mjs(PGlite).
import test from 'node:test';
import assert from 'node:assert/strict';
import { judge, kstDay, uploadAlerts, uploadLevel, buildCards, filterCards, stateBand, reportHtml, detailHtml, esc } from '../adReport.js';

//  2026-11-11 10:00 KST
const NOW = Date.parse('2026-11-11T01:00:00Z');
const STATE = { last_ok_at: '2026-11-11T00:30:00Z', result: 'ok', auth_error: false };
const HHH = { test_daily_budget: 20000, min_days: 2, min_spend: 20000, up_max: 800, stop_over: 1300, early_mult: 2 };
const LOHI = { test_daily_budget: 10000, min_days: 2, min_spend: 10000, up_max: 1000, stop_over: 1600, early_mult: 2 };
const card = (o = {}) => ({ media_id: 'M', brand_id: 'b', currencies: ['KRW'], any_active: true, any_failed: false,
    first_day: '2026-11-08', last_day: '2026-11-11', done_until: '2026-11-10', done_days: 2, ...o });
const J = (c, r = HHH, st = STATE) => judge(card(c), r, { state: st, now: NOW });
//  CPF 를 정확히 맞추는 지출/팔로우
const at = (cpf, f = 100) => ({ done_spend: cpf * f, done_follows: f });

test('테스트2 경계값 — 하이헤이호 800/801/1300/1301', () => {
    assert.equal(J(at(800)).kind, 'up');
    assert.equal(J(at(801)).kind, 'keep');
    assert.equal(J(at(1300)).kind, 'keep');
    assert.equal(J(at(1301)).kind, 'stop');
    assert.match(J(at(800)).reason, /÷ 팔로우 100 = 800원 ≤ 800원 → 증액 추천/);
});
test('테스트2 경계값 — 로하이·토비 1000/1001/1600/1601', () => {
    assert.deepEqual([1000, 1001, 1600, 1601].map(c => J(at(c, 50), LOHI).kind), ['up', 'keep', 'keep', 'stop']);
});
test('테스트3 기준 미달은 대기 — 1일 / 지출 부족', () => {
    const a = J({ ...at(500, 10), done_days: 1 });          // 5,000원 · 1일
    assert.equal(a.kind, 'wait'); assert.match(a.reason, /완결 1\/2일 · 지출 5,000\/20,000원/);
    assert.equal(J({ done_spend: 19999, done_follows: 30 }).kind, 'wait');
    assert.equal(J({ done_spend: 9999, done_follows: 30 }, LOHI).kind, 'wait');
    assert.equal(J({ done_days: 0, done_spend: 0, done_follows: 0 }).kind, 'wait');
});
test('테스트4 팔로우 0 → 중단 · 1명당 —', () => {
    const v = J({ done_spend: 40000, done_follows: 0 });
    assert.equal(v.kind, 'stop'); assert.equal(v.cpf, null); assert.match(v.reason, /팔로우 0 → 중단 추천/);
    assert.match(reportHtml({ list: buildCards([card({ done_spend: 40000, done_follows: 0, brand_id: 'b' })], { b: HHH }, { state: STATE, now: NOW }), state: STATE, now: NOW }), /<div class="ar-cpf">—<\/div>/);
});
test('1일차 조기중단 — 하루 예산 소진 + (팔로우 0 또는 종료선 2배 초과), 표시만', () => {
    assert.equal(J({ done_days: 1, done_spend: 20000, done_follows: 0 }).label, '중단 추천 · 1일차');
    const v = J({ done_days: 1, done_spend: 20000, done_follows: 7 });   // 2,857 > 2,600
    assert.equal(v.kind, 'stop'); assert.ok(v.early);
    assert.equal(J({ done_days: 1, done_spend: 20000, done_follows: 8 }).kind, 'wait');   // 2,500 ≤ 2,600
    assert.equal(J({ done_days: 1, done_spend: 19000, done_follows: 0 }).kind, 'wait');   // 예산 못 씀
    assert.equal(J({ done_days: 1, done_spend: 10000, done_follows: 3 }, LOHI).kind, 'stop'); // 3,333 > 3,200
});
test('보류 — 권한오류 · 6시간 지연 · 갱신실패 · 통화 · 판정선 없음', () => {
    assert.equal(J(at(500), HHH, { ...STATE, auth_error: true }).label, '보류 · 권한오류');
    assert.equal(J(at(500), HHH, { ...STATE, last_ok_at: '2026-11-10T18:59:00Z' }).label, '보류 · 데이터 지연');
    assert.equal(J(at(500), HHH, { ...STATE, last_ok_at: '2026-11-10T19:01:00Z' }).kind, 'up');   // 5:59 전 = 아직 OK
    assert.equal(J({ ...at(500), any_failed: true }).label, '보류 · 갱신 실패');
    assert.equal(J({ ...at(500), currencies: ['USD'] }).label, '보류 · 통화 다름');
    assert.equal(J(at(500), null).kind, 'none');
});
test('종료 카드 → 최종 1명당 (전체 합) · 팔로우 0 은 —', () => {
    const v = J({ any_active: false, total_spend: 102777, total_follows: 135 });
    assert.equal(v.kind, 'final'); assert.equal(v.label, '최종 1명당 761원');
    assert.equal(J({ any_active: false, total_spend: 5000, total_follows: 0 }).label, '최종 팔로우 0');
});
test('잠정 표시 — 완결 끝이 최근 7일이면 꼬리말', () => {
    assert.match(J(at(500)).reason, /Meta가 고칠 수 있음/);
    assert.doesNotMatch(J({ ...at(500), done_until: '2026-11-01' }).reason, /Meta가 고칠/);
});

test('테스트6 KST 날짜 — UTC 15:00 이후는 다음날', () => {
    assert.equal(kstDay('2026-11-07T16:30:00+0000'), '2026-11-08');
    assert.equal(kstDay('2026-11-07T14:59:59+0000'), '2026-11-07');
    assert.equal(kstDay('2026-11-07T15:00:00Z'), '2026-11-08');
    assert.equal(kstDay(Date.parse('2026-11-10T15:00:00Z')), '2026-11-11');
    assert.equal(kstDay(null), null); assert.equal(kstDay('엉터리'), null);
});
test('테스트7 업로드 경보 — 3일 정상 / 4·6일 알림 / 7일 경고 / 스냅샷 대체(대략)', () => {
    assert.deepEqual([0, 3, 4, 6, 7, 20, null].map(uploadLevel), ['ok', 'ok', 'alert', 'alert', 'warn', 'warn', 'none']);
    const accounts = [{ id: 'a1', brand_id: 'b1' }, { id: 'a2', brand_id: 'b2' }, { id: 'a3', brand_id: 'b3' }, { id: 'a4', brand_id: 'b4' }];
    const media = [{ account_id: 'a1', posted_day: '2026-11-08' }, { account_id: 'a1', posted_day: '2026-11-01' },
        { account_id: 'a2', posted_at: '2026-11-06T16:00:00+0000' }];                 // KST 11-07 → 4일
    const snapshots = [{ account_id: 'a3', snap_date: '2026-11-04', posts_delta: 1 }, { account_id: 'a3', snap_date: '2026-11-09', posts_delta: 0 }];
    const r = uploadAlerts({ accounts, media, snapshots, brandName: id => id.toUpperCase(), now: NOW });
    assert.deepEqual(r.map(x => [x.name, x.n, x.level, x.approx]), [['B1', 3, 'ok', false], ['B2', 4, 'alert', false], ['B3', 7, 'warn', true], ['B4', null, 'none', false]]);
});

test('목록 — 진행중 먼저, 중단이 위, 기간·브랜드 칩', () => {
    const list = buildCards([card({ media_id: 'E', any_active: false, total_spend: 1, total_follows: 1, last_day: '2026-11-01' }),
        card({ media_id: 'U', ...at(500) }), card({ media_id: 'S', ...at(2000), brand_id: 'c' }), card({ media_id: 'W', done_days: 1, done_spend: 1 })],
        { b: HHH, c: HHH }, { state: STATE, now: NOW });
    assert.deepEqual(list.map(x => x.card.media_id), ['S', 'U', 'W', 'E']);
    assert.equal(filterCards(list, { now: NOW }).length, 3);
    assert.equal(filterCards(list, { period: '30', now: NOW }).length, 4);
    assert.deepEqual(filterCards(list, { brand: 'c', period: 'all', now: NOW }).map(x => x.card.media_id), ['S']);
});
test('상태 띠 · 상세 · 이스케이프', () => {
    assert.equal(stateBand({ ...STATE, auth_error: true }, { now: NOW }).kind, 'auth');
    assert.equal(stateBand({ ...STATE, result: 'partial', failed_ads: ['x'] }, { now: NOW }).kind, 'partial');
    assert.equal(stateBand(null).kind, 'none');
    assert.equal(stateBand(STATE, { now: NOW }).kind, 'ok');
    const x = { card: card({ ad_ids: ['1', '2'], ad_accounts: ['act_919'], ad_names: ['<b>x</b>'] }), v: J(at(500)) };
    const h = detailHtml(x, [{ day: '2026-11-11', spend: 3000, follows: 2 }, { day: '2026-11-10', spend: 10000, follows: 10 }], { now: NOW });
    assert.match(h, /11-11 <span[^>]*>진행 중/); assert.match(h, /selected_ad_ids=1%2C2/); assert.ok(!h.includes('<b>x</b>'));
    assert.equal(esc('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
