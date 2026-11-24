//  ② 주문·배송 — 출고 목록 정보(옵션·경과일·합배송·분할배송) + 송장 작업 단계(선택→검토→발번→채널 등록) (순수 함수)
//  발번·채널 등록은 건마다 결과가 다르다. 한 번에 '실패'로 뭉치지 않고 주문별로 어디서 멈췄는지 남겨
//  실패한 건만 다시 처리할 수 있게 한다.

const DAY = 86400000;
const ymd = d => (d ? String(d).slice(0, 10) : '');
const digits = s => String(s || '').replace(/[^0-9]/g, '');
export const shipKey = o => `${o?.mall_key || ''}|${o?.order_id}`;

//  경과일 — 주문일(한국 날짜)부터 오늘까지
export function ageDays(orderDate, today) {
    const a = ymd(orderDate), b = ymd(today);
    if (!a || !b) return null;
    return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / DAY);
}
export const ageText = n => n == null ? '-' : n <= 0 ? '오늘' : `${n}일`;

//  옵션·수량 한 줄씩 — '오버핏 맨투맨 · 아이보리 / L × 1'
export function itemLines(o) {
    return (o?.items || []).map(it => {
        const name = it.product_name || it.variant_code || '상품';
        const opt = it.option_name ? ` · ${it.option_name}` : '';
        return `${name}${opt} × ${Number(it.quantity) || 1}`;
    });
}

//  합배송 열쇠 — 같은 받는분·연락처·주소(공백 무시). 셋 중 하나라도 비면 묶지 않는다(잘못 묶으면 오배송)
export function bundleKey(o) {
    const n = String(o?.receiver_name || '').replace(/\s+/g, '');
    const p = digits(o?.receiver_phone);
    const a = String(o?.receiver_address || '').replace(/\s+/g, '');
    return n && p && a ? `${n}|${p}|${a}` : '';
}
//  배송대상 안에서 같은 열쇠가 2건 이상이면 합배송 후보 — { key: [주문키...] }
export function bundleGroups(orders) {
    const g = {};
    (orders || []).forEach(o => { const k = bundleKey(o); if (k) (g[k] = g[k] || []).push(shipKey(o)); });
    Object.keys(g).forEach(k => { if (g[k].length < 2) delete g[k]; });
    return g;
}

//  합배송 판정 원천 — 배송 전 주문 '전체'(페이지·몰·검색 필터와 무관한 서버 목록)를 쓴다.
//  전체 목록을 못 받았으면 지금 화면 줄만으로 센다(scope:'page' — 화면에 '이 화면 기준'으로 표시).
//  화면 줄은 전체 목록보다 새것일 수 있어 합친다(같은 주문은 한 번만).
export function bundleSource(allPre, pageRows) {
    const pre = (pageRows || []);
    if (!Array.isArray(allPre)) return { rows: pre, scope: 'page' };
    const seen = new Set(allPre.map(shipKey));
    return { rows: [...allPre, ...pre.filter(o => !seen.has(shipKey(o)))], scope: 'all' };
}
//  합배송 목록 캐시 — 검색·탭·페이지 이동은 다시 받지 않는다. 무효화(at=0)·60초 지남·목록 없음일 때만 다시.
export const BUNDLE_TTL = 60000;
export function bundleIndexStale(ix, now = Date.now()) {
    if (!ix || ix.loading) return !ix;
    return !Array.isArray(ix.rows) || !ix.at || now - ix.at >= BUNDLE_TTL;
}
//  같이 보낼 다른 주문 키 목록
export function bundleMates(o, groups) {
    const k = bundleKey(o);
    return k && groups && groups[k] ? groups[k].filter(x => x !== shipKey(o)) : [];
}

//  분할배송 — 한 주문 안 품목이 서로 다른 배송 단위(카페24 shipping_code)로 나뉘었거나,
//  일부 품목만 배송이 시작된 경우(품목 상태 N1·N2 와 N3 이상이 섞임)
export function isSplitShip(o) {
    const its = Array.isArray(o?.raw?.items) ? o.raw.items : [];
    if (its.length < 2) return false;
    const codes = new Set(its.map(it => it.shipping_code).filter(Boolean));
    if (codes.size > 1) return true;
    const st = its.map(it => String(it.order_status || it.status || ''));
    const before = st.some(c => /^N[12]/.test(c)), after = st.some(c => /^N[3-5]/.test(c));
    return before && after;
}

//  출고 목록 한 줄 정보
export function shipRowInfo(o, { today, groups } = {}) {
    const mates = bundleMates(o, groups).length;
    return {
        customer: o?.receiver_name || o?.buyer_name || '',
        lines: itemLines(o),
        qty: (o?.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0),
        age: ageDays(o?.order_date, today),
        bundle: mates,              // 같이 보낼 수 있는 다른 주문 수
        split: isSplitShip(o),
    };
}

//  ── 송장 작업 결과 ──────────────────────────────────────────────
//  주문별 단계: excluded(검토에서 뺌) · issue_fail(발번 실패) · issue_unknown(우체국 접수 여부 모름)
//             · reg_fail(채널 등록 실패) · reg_unknown(카페24 접수 여부 모름) · reg_pending(카페24 외 채널 — 등록 대기)
//             · reg_dry(dry-run 몰) · ok(카페24 배송대기)
export const RESULT_LABEL = {
    excluded: '검토에서 제외', issue_fail: '발번 실패', issue_unknown: '발번 확인필요',
    reg_fail: '채널 등록 실패', reg_unknown: '채널 등록 확인필요', reg_pending: '채널 등록 대기(직접 등록)',
    reg_dry: 'dry-run 몰 — 채널 미전송', ok: '완료(채널 배송대기)',
};
//  다시 처리할 수 있는 단계 — 확인필요는 [접수 확인]으로만 푼다(중복 발번 막기)
export const RETRY = { issue_fail: 'issue', reg_fail: 'register' };

//  run = { picked:[주문], excluded:[{o,why}], issue:{key:{ok,regi,unknown,msg}}, reg:{key:{stage,msg}} }
export function shipRunRows(run) {
    const rows = [];
    (run?.excluded || []).forEach(x => rows.push({ key: shipKey(x.o), o: x.o, stage: 'excluded', msg: x.why }));
    (run?.targets || []).forEach(o => {
        const k = shipKey(o), is = (run.issue || {})[k];
        if (!is) { rows.push({ key: k, o, stage: 'issue_fail', msg: '응답 없음' }); return; }
        if (!is.ok) { rows.push({ key: k, o, stage: is.unknown ? 'issue_unknown' : 'issue_fail', msg: is.msg || '실패' }); return; }
        const rg = (run.reg || {})[k] || { stage: 'reg_fail', msg: '등록 결과 없음' };
        rows.push({ key: k, o, regi: is.regi, stage: rg.stage, msg: rg.msg || '' });
    });
    return rows.map(r => ({ ...r, label: RESULT_LABEL[r.stage] || r.stage, retry: RETRY[r.stage] || '' }));
}

//  단계 요약 — 선택 → 검토 → 발번 → 채널 등록
export function shipSteps(run) {
    const rows = shipRunRows(run);
    const n = s => rows.filter(r => r.stage === s).length;
    const issued = rows.filter(r => r.regi).length;
    const tgt = (run?.targets || []).length;
    return [
        { step: '선택', state: 'done', text: `체크 ${(run?.checked ?? rows.length)}건` },
        { step: '검토', state: 'done', text: `발번 대상 ${tgt}건${n('excluded') ? ` · 제외 ${n('excluded')}건` : ''}` },
        { step: '발번', state: !tgt ? 'skip' : (n('issue_fail') || n('issue_unknown')) ? (issued ? 'partial' : 'fail') : 'done',
          text: tgt ? `성공 ${issued}${n('issue_fail') ? ` · 실패 ${n('issue_fail')}` : ''}${n('issue_unknown') ? ` · 확인필요 ${n('issue_unknown')}` : ''}` : '대상 없음' },
        { step: '채널 등록', state: !issued ? 'skip' : (n('reg_fail') || n('reg_unknown')) ? (n('ok') + n('reg_pending') + n('reg_dry') ? 'partial' : 'fail') : 'done',
          text: issued ? `배송대기 ${n('ok')}${n('reg_pending') ? ` · 등록 대기 ${n('reg_pending')}` : ''}${n('reg_dry') ? ` · dry-run ${n('reg_dry')}` : ''}${n('reg_fail') ? ` · 실패 ${n('reg_fail')}` : ''}${n('reg_unknown') ? ` · 확인필요 ${n('reg_unknown')}` : ''}` : '발번된 건 없음' },
    ];
}

//  발번 버튼을 못 누르는 이유 — 화면에 글자로 보인다(마우스 올림 설명만으론 휴대폰에서 안 보임)
export function epostDisabledReason({ checked = 0, filter = 'target', busy = false } = {}) {
    if (busy) return '발번·등록이 진행 중입니다';
    if (filter !== 'target' && filter !== 'all' && !checked) return '배송대상 탭에서 주문을 체크하세요';
    if (!checked) return '발번할 주문을 먼저 체크하세요';
    return '';
}
