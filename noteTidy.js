// ============================================================
//  메모 정리 — 바뀐 게 없으면 저장하지 않기 · 시즌 단계 메모를 시즌 한 줄로 접기 · 단계 메모 중복 생성 막기
//  (화면·DB 없음 → tests/note-tidy.test.mjs 가 바로 확인)
//
//  왜: notes 는 update 만 해도 트리거(036 trg_note_touch)가 updated_at 을 지금으로 바꾼다.
//  메모를 열었다 다른 메모로 넘어가면 saveNote 가 숨은 속성 줄(<!--p {...}-->)을 키 순서만 바꿔 다시 써서
//  내용이 그대로인 시즌 단계 메모 12~14개가 '오늘' 묶음으로 몰렸다.
// ============================================================

export const NOTE_META_RE = /^<!--p (.*?)-->\n?/;

//  본문의 글 부분만 바꾼다 — 속성 줄은 글자 그대로 둔다(다시 직렬화하면 키 순서가 바뀌어 '바뀐 것'이 된다)
export function bodyWithText(body, text) {
  const m = String(body || '').match(NOTE_META_RE);
  return (m ? m[0] : '') + String(text ?? '');
}

//  속성 비교용 — 키 순서·빈 값('' · '없음' · [])을 무시하고 같은 뜻이면 같은 문자열
function canonMeta(meta) {
  const out = {};
  for (const k of Object.keys(meta || {}).sort()) {
    const v = meta[k];
    if (v === '' || v === '없음' || v == null || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return JSON.stringify(out);
}
function splitBody(body) {
  const b = String(body || '');
  const m = b.match(NOTE_META_RE);
  let meta = {};
  if (m) { try { meta = JSON.parse(m[1]) || {}; } catch (_e) { meta = { _raw: m[1] }; } }
  return { meta, text: m ? b.slice(m[0].length) : b };
}
//  두 본문이 실질적으로 같은가 — 글이 같고 속성 뜻이 같으면 같다
export function sameBody(a, b) {
  if (String(a ?? '') === String(b ?? '')) return true;
  const x = splitBody(a), y = splitBody(b);
  return x.text === y.text && canonMeta(x.meta) === canonMeta(y.meta);
}

//  보낼 update 에서 실제로 바뀐 칸만 남긴다. 하나도 없으면 null → update 를 부르지 않는다
export function changedFields(note, patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    const cur = note ? note[k] : undefined;
    const same = k === 'body' ? sameBody(cur, v)
      : (cur ?? null) === (v ?? null) || String(cur ?? '') === String(v ?? '') && typeof cur !== 'boolean' && typeof v !== 'boolean';
    if (!same) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

//  시즌 단계 메모인가 — 시즌(product_id 또는 속성 proj) + 단계 표시로만 판단한다. 제목만 보고 고르지 않는다.
//   - 속성 embed='season-home' → 그 시즌 기본 페이지
//   - 속성 step(단계 id) → 그 단계 (새로 만드는 메모부터 붙는다)
//   - 옛 메모(step 없음): 단계 만들기가 남긴 표시(status 가 있고, due 또는 embed='items')가 있고
//     제목이 '<그 시즌 이름> · <그 브랜드 단계 이름>' 과 정확히 같을 때만. 시즌 없는 메모·일반 메모는 해당 없음
//  돌려줌 { seaId, stepId, home, sort } | null
export function stageOf(note, meta, { seasons = [], steps = [] } = {}) {
  const seaId = String(note?.product_id || meta?.proj || '');
  if (!seaId) return null;
  if (meta?.embed === 'season-home') return { seaId, stepId: null, home: true, sort: -1 };
  const sea = seasons.find(s => String(s.id) === seaId);
  const brandSteps = sea ? stepsOfBrand(steps, sea.brand_id) : [];
  if (meta?.step) {
    const st = steps.find(s => String(s.id) === String(meta.step));
    return { seaId, stepId: String(meta.step), home: false, sort: st ? Number(st.sort || 0) : 9999 };
  }
  //  옛 단계 메모(step 없음): 단계 만들기가 남긴 status + 제목 끝 ' · <단계명>'.
  //  앞부분은 안 본다 — 시즌 이름을 바꾸면 제목엔 옛 이름이 남는다(운영: 스모크테스트 시즌의 '26FW 1차 · 출고').
  //  due 는 날짜를 안 고르고 만든 옛 메모엔 없어서 조건에서 뺐다.
  if (!sea || !meta || !meta.status || meta.status === '없음') return null;
  const title = String(note.title || '').trim();
  const st = brandSteps.find(s => title.endsWith(` · ${s.name}`));
  return st ? { seaId, stepId: String(st.id), home: false, sort: Number(st.sort || 0) } : null;
}

//  그 브랜드만의 단계가 있으면 그것, 없으면 공통 단계 (main.js _stepsFor 와 같은 규칙)
export function stepsOfBrand(steps, brandId) {
  const all = (steps || []).filter(x => x.active !== false);
  const mine = all.filter(x => String(x.brand_id || '') === String(brandId || ''));
  return (mine.length ? mine : all.filter(x => !x.brand_id)).sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

//  목록 줄 만들기 — 일반 메모는 그대로, 시즌 단계 메모는 시즌마다 한 줄(그룹)로.
//  list 는 이미 정렬된 목록(고정 → updated_at 내림차순). 그룹은 그 시즌 메모 중 가장 먼저 나오는 자리에 선다.
//  고정한 단계 메모는 접지 않는다(사용자가 일부러 위로 올린 것). 단계 메모가 하나뿐인 시즌도 접지 않는다.
//  돌려줌 [{ type:'note', note } | { type:'season', seaId, notes:[...단계 순서], lead }]
export function groupRows(list, infoOf) {
  const info = new Map(), bySea = new Map();
  for (const n of list) {
    const s = n.pinned ? null : infoOf(n);
    if (!s) continue;
    info.set(n, s);
    if (!bySea.has(s.seaId)) bySea.set(s.seaId, []);
    bySea.get(s.seaId).push(n);
  }
  const out = [], placed = new Set();
  for (const n of list) {
    const s = info.get(n);
    const kids = s ? bySea.get(s.seaId) : null;
    if (!kids || kids.length < 2) { out.push({ type: 'note', note: n }); continue; }
    if (placed.has(s.seaId)) continue;
    placed.add(s.seaId);
    const ordered = kids.slice().sort((a, b) => info.get(a).sort - info.get(b).sort
      || String(a.created_at || '').localeCompare(String(b.created_at || '')));
    out.push({ type: 'season', seaId: s.seaId, notes: ordered, lead: n });
  }
  return out;
}

//  단계 메모 만들기 전에 — 같은 시즌+단계가 이미 있으면 건너뛴다(기본 페이지도 시즌당 하나)
//  돌려줌 { make: [단계], skip: [단계] , homeExists }
export function planStageRows(notes, seaId, chosen, infoOf) {
  const have = new Set(), sid = String(seaId);
  let homeExists = false;
  for (const n of notes || []) {
    const s = infoOf(n);
    if (!s || s.seaId !== sid) continue;
    if (s.home) homeExists = true; else have.add(s.stepId);
  }
  const make = [], skip = [];
  for (const st of chosen || []) (have.has(String(st.id)) ? skip : make).push(st);
  return { make, skip, homeExists };
}

//  같은 일을 동시에 두 번 돌리지 않는다 — 돌고 있으면 그 약속을 그대로 돌려준다(버튼 연타·동시 호출)
export function once(map, key, fn) {
  if (map.has(key)) return map.get(key);
  const p = Promise.resolve().then(fn).finally(() => map.delete(key));
  map.set(key, p);
  return p;
}

// ============================================================
//  C-a 메모 화면(21) — 시작 범위 · 범위 표시 · 정리 후보
//  (화면·DB 없음 → tests/note-scope.test.mjs)
// ============================================================

//  시작 폴더 — 예전엔 늘 '개인 메모'로 열려 공용 메모 174장이 첫 화면에서 안 보였다.
//  명시한 폴더(링크·버튼으로 연 것) > 마지막에 고른 폴더(아직 있으면) > '모든 메모'
export function startFolder({ explicit, saved, valid } = {}) {
  if (explicit) return explicit;
  const ok = (k) => {
    if (!k || typeof k !== 'string') return false;
    if (k === 'all' || k === 'private' || k === 'shared') return true;
    return typeof valid === 'function' ? !!valid(k) : false;
  };
  return ok(saved) ? saved : 'all';
}

//  범위 표시 — 누가 보는 메모인가. access 는 그 폴더 note_folders.access
//  문구는 실제 서버 권한 그대로(040 can_see_note · 045 can_see_folder):
//   - private: 작성자 + MASTER, 시즌(product_id)에 붙었으면 그 시즌 담당자(products.members)도 본다 → '나만' 이 아니다
//   - 폴더 access=members: 폴더 멤버 + MASTER
//   - 시즌·브랜드에 붙은 메모는 그 시즌·브랜드를 볼 수 있는 사람만(can_access_project/brand)
export function scopeInfo(note, access) {
  const s = note && note.scope;
  const onSeason = !!(note && note.product_id), onBrand = !!(note && note.brand_id);
  if (s === 'private') return { k: 'private', label: '개인', sub: onSeason ? '나 · 마스터 · 시즌 담당자' : '나 · 마스터', icon: 'ph-lock-simple' };
  if (s === 'project') return { k: 'project', label: '시즌', sub: '시즌을 볼 수 있는 사람', icon: 'ph-calendar-blank' };
  if (access === 'members') return { k: 'members', label: '멤버', sub: '폴더 멤버 · 마스터', icon: 'ph-users' };
  if (onSeason) return { k: 'shared', label: '공용', sub: '시즌을 볼 수 있는 사람', icon: 'ph-users-three' };
  if (onBrand) return { k: 'shared', label: '공용', sub: '브랜드를 볼 수 있는 사람', icon: 'ph-users-three' };
  return { k: 'shared', label: '공용', sub: '워크스페이스 전체', icon: 'ph-users-three' };
}

//  기본 제목 — 정확히 같을 때만. '나염/자수 테스트 도안 전달' 처럼 낱말이 섞인 실업무 메모는 아니다
const DEFAULT_TITLES = new Set(['', '새 메모', '제목 없음', '테스트', '스모크테스트', '스모크 테스트', 'test', 'smoke', 'smoke test']);
export function isDefaultTitle(title) {
  return DEFAULT_TITLES.has(String(title ?? '').trim().toLowerCase());
}
const textOf = (body) => String(body || '').replace(NOTE_META_RE, '').trim();

//  정리 후보 — 지우지 않는다. 이유를 붙여 보여 주고, '고르기' 만 돕는다(삭제는 사람이 확인 후)
//   - default: 기본 제목(빈 제목·새 메모·테스트…) — empty=true 면 글도 비어 있음
//   - dup: 같은 제목이 2장 이상(제품 기록장 item_id 제외). same=true 면 글까지 같음
//  돌려줌 { rows: [{ note, reasons:[{k,label}] }], dupGroups: [{title, notes, same}], pickable: { emptyDefault:[id], sameDup:[id] } }
export function tidyCandidates(notes) {
  const list = (notes || []).filter(n => n && !n.item_id);
  const byTitle = new Map();
  for (const n of list) {
    const t = String(n.title ?? '').trim();
    if (isDefaultTitle(t)) continue;
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(n);
  }
  const reasons = new Map();
  const add = (n, r) => { const k = String(n.id); if (!reasons.has(k)) reasons.set(k, { note: n, reasons: [] }); reasons.get(k).reasons.push(r); };
  const emptyDefault = [];
  for (const n of list) {
    if (!isDefaultTitle(n.title)) continue;
    const empty = !textOf(n.body);
    add(n, { k: 'default', label: empty ? '기본 제목 · 빈 메모' : '기본 제목' });
    if (empty) emptyDefault.push(String(n.id));
  }
  const dupGroups = [], sameDup = [];
  for (const [title, ns] of byTitle) {
    if (ns.length < 2) continue;
    //  최신 것이 맨 앞 — '같은 글 중복 고르기' 는 최신 한 장을 남긴다
    const sorted = ns.slice().sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    const same = sorted.every(n => textOf(n.body) === textOf(sorted[0].body));
    dupGroups.push({ title, notes: sorted, same });
    sorted.forEach((n, i) => {
      add(n, { k: 'dup', label: `같은 제목 ${ns.length}장${same ? ' · 글도 같음' : ''}${i === 0 ? ' · 최신' : ''}` });
      if (same && i > 0) sameDup.push(String(n.id));
    });
  }
  const rows = [...reasons.values()].sort((a, b) =>
    String(a.note.title || '').localeCompare(String(b.note.title || '')) ||
    String(b.note.updated_at || '').localeCompare(String(a.note.updated_at || '')));
  return { rows, dupGroups, pickable: { emptyDefault, sameDup } };
}
