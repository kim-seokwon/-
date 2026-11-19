//  키디키디(이랜드) 주문 줄 묶기 — 순수 함수(의존성 없음). sync.mjs 와 tests/kidikidi-lines.test.mjs 가 쓴다.
//  설계: .work/개선요청-1118/키디키디-설계.md (코덱스 재검수 통과 11-19)
//  입력: 날짜창별 응답 [[줄…], [줄…]] (창 순서). 평면 배열(창 하나)도 받는다.
//  출력: 주문별 { order_id, pay_amount(줄 금액 합), raw:{ ...첫 줄, items:[…] }, dedupe, windows }
//  줄 중복 키(주문마다 위에서부터 첫 번째로 성립하는 것):
//    1) 모든 줄에 ordDtlNo                         → ordNo|dtl|ordDtlNo
//    2) 모든 줄에 itemNo·uitemNo·줄순번(SEQ_FIELDS) → ordNo|seq|itemNo|uitemNo|순번
//    3) 그 밖(키 없음·일부만 있음)                 → 줄 중복 제거 안 함. 처음 나온 창의 줄만 전부 쓰고, 뒤 창의 같은 주문은 통째 무시.
//    itemNo+uitemNo 만으로 합치지 않는다 — 같은 상품·옵션을 따로 담은 두 줄이 하나로 줄어 금액이 빠진다.
export const SEQ_FIELDS = ['ordDtlSeq', 'ordSeq', 'lineNo', 'ordItemSeq'];
const has = v => v !== undefined && v !== null && String(v).trim() !== '';
const seqOf = l => SEQ_FIELDS.map(f => l[f]).find(has);
const amountOf = l => Number(l.sellAmount ?? l.sellPrice ?? 0) || 0;

function keyMode(lines) {
  if (lines.every(l => has(l.ordDtlNo))) return 'dtl';
  if (lines.every(l => has(l.itemNo) && has(l.uitemNo) && has(seqOf(l)))) return 'seq';
  return 'none';
}
const lineKey = (mode, l) => mode === 'dtl' ? `${l.ordNo}|dtl|${l.ordDtlNo}` : `${l.ordNo}|seq|${l.itemNo}|${l.uitemNo}|${seqOf(l)}`;
const item = l => ({ itemNo: l.itemNo ?? null, itemName: l.itemName ?? null, uitemNo: l.uitemNo ?? null, uitemName: l.uitemName ?? null,
  ordQty: Number(l.ordQty) || 0, sellAmount: amountOf(l), ...(has(l.ordDtlNo) ? { ordDtlNo: l.ordDtlNo } : {}) });

export function groupElandLines(windows) {
  const wins = (windows || []).length && !Array.isArray(windows[0]) ? [windows] : (windows || []);
  const byOrd = new Map();
  wins.forEach((win, wi) => {
    const here = new Map();
    for (const l of win || []) {
      if (!has(l?.ordNo)) continue;
      const k = String(l.ordNo);
      if (!here.has(k)) here.set(k, []);
      here.get(k).push(l);
    }
    for (const [ord, lines] of here) {
      const cur = byOrd.get(ord);
      if (!cur) byOrd.set(ord, { lines: lines.map(l => ({ l, wi })), first: wi, wins: 1 });
      else { cur.wins++; cur.lines.push(...lines.map(l => ({ l, wi }))); }
    }
  });
  const out = [];
  for (const [ord, { lines, first, wins: nw }] of byOrd) {
    const mode = keyMode(lines.map(x => x.l));
    let kept;
    if (mode === 'none') kept = lines.filter(x => x.wi === first).map(x => x.l);
    else { const seen = new Set(); kept = lines.map(x => x.l).filter(l => { const k = lineKey(mode, l); if (seen.has(k)) return false; seen.add(k); return true; }); }
    const items = kept.map(item);
    out.push({ order_id: ord, pay_amount: items.reduce((s, i) => s + i.sellAmount, 0), raw: { ...kept[0], items }, dedupe: mode, windows: nw });
  }
  return out;
}

//  저장 행 나누기: 이미 있는 주문은 수집 값만 갱신(status·수령인 등 사람이 바꾼 칸은 안 건드림), 새 주문만 전체 행.
export const UPDATE_KEYS = ['channel', 'mall_key', 'order_id', 'order_date', 'pay_amount', 'channel_status', 'raw'];
export function splitRows(rows, existingIds) {
  const have = new Set([...existingIds].map(String));
  const fresh = [], update = [];
  for (const r of rows) {
    if (have.has(String(r.order_id))) update.push(Object.fromEntries(UPDATE_KEYS.map(k => [k, r[k]])));
    else fresh.push(r);
  }
  return { fresh, update };
}
