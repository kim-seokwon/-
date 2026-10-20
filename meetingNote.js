// 주간 회의록 1단계 — 화면과 떨어진 순수 함수들 (.work/회의록/기획.md 3-3·4·5)
//  회의록 = notes 1건(folder '회의록'). 메타 줄(<!--p {...}-->)에 kind·week·state·snap 을 담고,
//  본문은 섹션 0~9(숫자, 다시 만들기로 바뀜) + 10~12(사람이 씀, 늘 보존)로 나뉜다.
//  숫자는 weekly_brief(SQL)가 낸다. 여기서는 그리기·나누기·판정만 한다 — DB·화면을 모른다.
//  테스트: tests/weekly-meeting.test.mjs

export const MEETING_FOLDER = '회의록';
//  사람이 쓰는 칸의 첫 줄. 다시 만들기는 이 줄 위만 바꾼다.
export const HUMAN_HEAD = '## 10 결정';
export const HUMAN_TEMPLATE = `${HUMAN_HEAD}\n\n\n## 11 이번 주 할 일\n[ ] \n\n## 12 메모\n`;

const pad = n => String(n).padStart(2, '0');
const ymdUTC = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = ymd => { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

export const kstToday = (now = new Date()) => ymdUTC(new Date(now.getTime() + 9 * 3600e3));
export const addDays = (ymd, n) => { const d = parse(ymd); d.setUTCDate(d.getUTCDate() + n); return ymdUTC(d); };
export const mondayOf = ymd => { const d = parse(ymd); return addDays(ymd, -((d.getUTCDay() + 6) % 7)); };
//  ISO 주 번호 — 그 주 목요일이 속한 해
export function isoWeek(monday) {
    const thu = parse(addDays(monday, 3));
    const y = thu.getUTCFullYear();
    const jan4 = new Date(Date.UTC(y, 0, 4));
    const w1 = parse(mondayOf(ymdUTC(jan4)));
    return `${y}-W${pad(Math.round((thu - w1) / 604800000 - 3 / 7) + 1)}`;
}
//  DB now() 는 UTC 로 온다 → 화면엔 KST 'YYYY-MM-DD HH:mm'
export const kstStamp = iso => { const t = Date.parse(iso || ''); return isNaN(t) ? '' : new Date(t + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' '); };
const md = ymd => { const [, m, d] = ymd.split('-'); return `${Number(m)}/${Number(d)}`; };
export const meetingTitle = monday => `${isoWeek(monday)} 주간회의 (${md(monday)}~${md(addDays(monday, 6))})`;
//  회의하는 주(월요일) → 숫자를 모을 주 = 지난주(다 끝난 7일). 월요일 아침엔 이번 주 숫자가 비어 있다.
export const dataWeekOf = meetingMonday => addDays(meetingMonday, -7);

//  같은 주 회의록 판정 — 제목이 아니라 메타 kind·week
export const isMeeting = meta => !!meta && meta.kind === 'meeting';
export const findMeeting = (notes, week, metaOf) =>
    (notes || []).find(n => { const m = metaOf(n); return isMeeting(m) && m.week === week; }) || null;

export const downMalls = snap => Array.isArray(snap?.health) ? snap.health.filter(h => h.status === 'down') : [];
export const lateMalls = snap => Array.isArray(snap?.health) ? snap.health.filter(h => h.status === 'late') : [];

//  지난주 회의록의 [ ] 줄(_lineTodos 결과) → 완료 · 밀림(기한 지남) · 담당 없음
export function prevTodoSummary(todos, today) {
    const list = todos || [];
    const late = list.filter(t => !t.done && t.due && t.due < today);
    return {
        total: list.length,
        done: list.filter(t => t.done).length,
        late: late.length,
        no_owner: list.filter(t => !t.done && !(t.at && t.at.length)).length,
        open: list.filter(t => !t.done).map(t => ({ title: t.title, due: t.due || '', who: (t.at || []).join(' '), late: !!(t.due && t.due < today) })),
    };
}

const won = v => (v == null || isNaN(Number(v))) ? '-' : `${Math.round(Number(v)).toLocaleString('ko-KR')}원`;
const num = v => (v == null || isNaN(Number(v))) ? '-' : Math.round(Number(v)).toLocaleString('ko-KR');
const pct = (a, b) => (b == null || Number(b) === 0 || a == null) ? '' : ` (${Number(a) >= Number(b) ? '+' : ''}${Math.round((Number(a) / Number(b) - 1) * 100)}%)`;
const sgn = v => v == null ? '-' : `${Number(v) > 0 ? '+' : ''}${num(v)}`;
const failed = v => v == null || (typeof v === 'object' && !Array.isArray(v) && 'error' in v);
const oneLine = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

//  섹션 0~9 — snap 을 사람이 읽는 줄로. 섹션 하나가 실패하면 그 섹션만 '불러오지 못함'.
export function renderSections(snap, prev) {
    const s = snap || {}, L = [];
    const sec = (title, val, fn) => { L.push(`## ${title}`); if (failed(val)) L.push('· 불러오지 못함'); else fn(val); L.push(''); };
    const wk = s.week ? `${md(s.week.start)}~${md(s.week.end)}` : '';
    L.push(`숫자 기준: ${wk} (월~일, 한국시간) · 만든 시각 ${kstStamp(s.made_at)}`, '');

    sec('0 데이터 상태', s.health, h => {
        downMalls(s).forEach(x => L.push(`🔴 ${x.brand || ''} ${x.mall_key} 수집 끊김 — 이 몰 숫자 빠짐`));
        lateMalls(s).forEach(x => L.push(`🟡 ${x.brand || ''} ${x.mall_key} 수집 늦음`));
        if (!downMalls(s).length && !lateMalls(s).length) L.push(`· 몰 ${h.length}곳 모두 정상`);
    });
    sec('1 숫자판', s.sales?.total, t => {
        const r = (k, label, f) => L.push(`· ${label} ${f(t.this?.[k])} · 지난주 ${f(t.prev?.[k])}${pct(t.this?.[k], t.prev?.[k])} · 4주 평균 ${f(t.avg4?.[k])}`);
        r('paid', '매출(실결제)', won); r('order_count', '주문', num); r('refund', '환불', won);
        const b = s.sales?.by_brand;
        if (failed(b)) L.push('· 브랜드별: 불러오지 못함');
        else if (b.length) {
            L.push('· 브랜드별(주문 기준이라 합계와 다를 수 있음):');
            b.forEach(x => L.push(`  · ${x.brand_name || '미지정'} ${won(x.amt)} / ${num(x.cnt)}건 · 지난주 ${won(x.amt_prev)}${pct(x.amt, x.amt_prev)}`));
        }
    });
    sec('2 많이 팔린 상품', s.top_items, a => {
        if (!a.length) L.push('· 없음');
        a.forEach((x, i) => L.push(`· ${i + 1}. ${oneLine(x.name)} ${num(x.qty)}개 · 지난주 ${x.rank_prev ? x.rank_prev + '위' : '순위 밖'}`));
    });
    L.push('## 3 클레임·CS');
    if (failed(s.claims)) L.push('· 클레임: 불러오지 못함');
    else L.push(`· 취소 ${num(s.claims.cancel_count)}건 ${won(s.claims.cancel_amount)} · 반품 ${num(s.claims.return_count)}건 ${won(s.claims.return_amount)} · 반품 대기 ${num(s.claims.return_pending)}건`);
    if (failed(s.cs)) L.push('· CS: 불러오지 못함');
    else {
        L.push(`· CS 신규 ${num(s.cs.new)}건 · 미처리 ${num(s.cs.open)}건 (7일 넘음 ${num(s.cs.open_over7)}건) — CS 탭`);
        if ((s.cs.by_kind || []).length) L.push(`  · 유형: ${s.cs.by_kind.map(k => `${k.kind} ${k.n}`).join(' · ')}`);
    }
    L.push('');
    sec('4 출고', s.shipping, x => L.push(`· 미출고 ${num(x.pre)}건 — 주문 탭 > 미출고 · 송장 실패 ${num(x.failed)}건 (확인필요 ${num(x.unknown)}건)`));
    L.push('## 5 생산·재고');
    if (failed(s.production)) L.push('· 생산: 불러오지 못함');
    else {
        L.push(`· 7일 안 출고예정 ${s.production.due7.length}건 · 지난 납기 ${s.production.overdue.length}건 — 제품 탭`);
        s.production.overdue.forEach(x => L.push(`  · 지남: ${oneLine(x.name)} ${x.ship_date} (${x.status || ''})`));
        s.production.due7.forEach(x => L.push(`  · 예정: ${oneLine(x.name)} ${x.ship_date}`));
    }
    if (failed(s.stock)) L.push('· 재고: 불러오지 못함');
    else L.push(`· 재고 마이너스 ${num(s.stock.negative)} · 안전재고 이하 완제품 ${num(s.stock.low)} · 원부자재 ${num(s.stock.material_low)} — 재고 탭`);
    L.push('');
    sec('6 업계 소식 후보', s.news_candidates, a => {
        if (!a.length) L.push('· 이번 주 들어온 소식 없음');
        L.push('· 이야기할 3개만 남기고 나머지 줄은 지우세요');
        a.forEach(x => L.push(`· [${x.kind}] ${oneLine(x.title)} ${x.url || ''}`.trimEnd()));
    });
    sec('7 인스타', s.insta, a => {
        if (!a.length) L.push('· 스냅샷 없음');
        a.forEach(x => L.push(`· ${x.who === 'ours' ? '' : '(경쟁) '}${x.name} 팔로워 ${num(x.followers)} (${sgn(x.delta)}) · 새 글 ${num(x.posts)}${x.avg_likes != null ? ` · 평균 좋아요 ${num(x.avg_likes)}` : ''}`));
    });
    L.push('## 8 지난주 할 일');
    if (!prev) L.push('· 지난주 회의록 없음');
    else {
        L.push(`· ${prev.total}개 중 완료 ${prev.done} · 밀림 ${prev.late} · 담당 없음 ${prev.no_owner}`);
        prev.open.slice(0, 10).forEach(t => L.push(`  · ${t.late ? '밀림' : '남음'}: ${oneLine(t.title)}${t.due ? ' ' + t.due : ''}${t.who ? ' @' + t.who : ' (담당 없음)'}`));
    }
    L.push('', '## 9 질문 후보', '· (2단계에서 자동으로 채운다 — 지금은 회의 전에 적어 두세요)', '');
    return L.join('\n');
}

//  본문에서 사람이 쓰는 칸(10~12)만 떼어 온다. 제목 줄이 없으면 null — 다시 만들기를 막는다(글을 잃지 않게).
export function humanPart(text) {
    const lines = String(text || '').split('\n');
    const i = lines.findIndex(l => l.trim() === HUMAN_HEAD);
    return i < 0 ? null : lines.slice(i).join('\n');
}
export const buildBody = (snap, prev, human) => renderSections(snap, prev) + '\n' + (human == null ? HUMAN_TEMPLATE : human);
//  다시 만들기: 0~9 는 새 숫자로, 10~12 는 그대로. 10번 제목이 지워졌으면 null.
export function regenerateBody(oldText, snap, prev) {
    const h = humanPart(oldText);
    return h == null ? null : buildBody(snap, prev, h);
}

export const newMeetingMeta = (week, snap, now = new Date()) =>
    ({ kind: 'meeting', week, state: 'draft', made_at: now.toISOString(), snap });
//  확정 — 숫자 고정. 끊긴 몰이 있었으면 그 몰 키를 남긴다. 확정 취소는 없다.
export function confirmMeetingMeta(meta, { by, now = new Date() } = {}) {
    if (!isMeeting(meta) || meta.state === 'confirmed') return null;
    const down = downMalls(meta.snap).map(h => h.mall_key);
    const out = { ...meta, state: 'confirmed', confirmed_at: now.toISOString(), confirmed_by: by || '' };
    if (down.length) out.confirmed_with_down = down;
    return out;
}
export const canRegenerate = meta => isMeeting(meta) && meta.state !== 'confirmed';
