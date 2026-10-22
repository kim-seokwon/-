// 메모 정리 — 바뀐 게 없으면 저장 안 함 · 시즌 단계 메모 한 줄로 접기 · 단계 메모 중복 생성 막기
import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyWithText, sameBody, changedFields, stageOf, stepsOfBrand, groupRows, planStageRows, once } from '../noteTidy.js';

const META = s => { const m = String(s || '').match(/^<!--p (.*?)-->\n?/); return m ? JSON.parse(m[1]) : {}; };
//  main.js _noteMeta 처럼 기본값을 앞에 깔아 키 순서를 바꾼다 — 이게 '열기만 해도 저장'의 원인이었다
const appMeta = n => ({ status: '없음', due: '', who: '', proj: '', links: [], ...META(n.body) });

const seasons = [
  { id: 's1', name: '26FW 1차', brand_id: 'b1' },
  { id: 's3', name: '26FW 3차', brand_id: 'b1' },
];
const steps = [
  { id: 't1', name: '기획', sort: 1 }, { id: 't2', name: '샘플·제작', sort: 2, kind: 'items' },
  { id: 't3', name: '촬영', sort: 3 }, { id: 't4', name: '상세페이지', sort: 4 },
  { id: 't5', name: '업로드', sort: 5 }, { id: 't6', name: '오픈', sort: 6 },
];
const ctx = { seasons, steps };
const info = n => stageOf(n, appMeta(n), ctx);
const body = (meta, text = '') => `<!--p ${JSON.stringify(meta)}-->\n${text}`;

test('글이 그대로면 본문도 그대로 — 속성 줄은 글자 그대로 남는다', () => {
  const b = body({ proj: 's1', status: '요청', due: '2026-11-01' }, '[ ] 원단 확인');
  assert.equal(bodyWithText(b, '[ ] 원단 확인'), b);
  assert.equal(bodyWithText(b, '새 글'), body({ proj: 's1', status: '요청', due: '2026-11-01' }, '새 글'));
  assert.equal(bodyWithText('속성 없음', '새 글'), '새 글');
});

test('키 순서·빈 값만 다르면 같은 본문으로 본다', () => {
  const a = body({ proj: 's1', status: '요청', due: '2026-11-01' }, 'x');
  const b = body({ status: '요청', due: '2026-11-01', proj: 's1', who: '', links: [] }, 'x');
  assert.ok(sameBody(a, b));
  assert.ok(!sameBody(a, body({ proj: 's1', status: '완료', due: '2026-11-01' }, 'x')));
  assert.ok(!sameBody(a, body({ proj: 's1', status: '요청', due: '2026-11-01' }, 'y')));
});

test('no-op 저장은 update 0회 — 열고 넘어가기·같은 값 다시 고르기', () => {
  const n = { id: 1, title: null, body: body({ proj: 's1', status: '요청' }, '[ ] a') };
  const calls = [];
  const save = (typedTitle, typedText) => {          // main.js saveNote 와 같은 순서
    const patch = changedFields(n, { title: typedTitle, body: bodyWithText(n.body, typedText) });
    if (patch) { calls.push(patch); Object.assign(n, patch); }
  };
  save('', '[ ] a');                 // 제목 칸은 null 을 '' 로 보여준다 → 바뀐 게 아니다
  save('', '[ ] a');
  assert.equal(calls.length, 0);
  save('', '[x] a');
  assert.deepEqual(calls, [{ body: body({ proj: 's1', status: '요청' }, '[x] a') }]);
  assert.equal(changedFields({ pinned: false }, { pinned: false }), null);
  assert.deepEqual(changedFields({ pinned: false }, { pinned: true }), { pinned: true });
  assert.equal(changedFields({ product_id: null }, { product_id: null }), null);
});

test('시즌 단계 메모 판정 — 표시(step·season-home·단계 흔적)로만, 제목만으론 안 고른다', () => {
  assert.deepEqual(info({ product_id: 's1', title: '아무 이름', body: body({ proj: 's1', status: '요청', step: 't3' }) }),
    { seaId: 's1', stepId: 't3', home: false, sort: 3 });
  assert.equal(info({ product_id: 's1', title: '26FW 1차 · 기본 페이지', body: body({ proj: 's1', embed: 'season-home' }) }).home, true);
  //  옛 메모: 단계 만들기 흔적(status + due/embed items) + 정확한 제목
  assert.equal(info({ product_id: 's1', title: '26FW 1차 · 촬영', body: body({ proj: 's1', status: '요청', due: '2026-11-01' }) }).stepId, 't3');
  assert.equal(info({ product_id: 's1', title: '26FW 1차 · 샘플·제작', body: body({ proj: 's1', status: '요청', embed: 'items' }) }).stepId, 't2');
  //  시즌 이름을 바꾼 옛 메모: 제목 앞부분이 옛 이름, due 없음 (운영 스모크테스트 시즌 실제 모양)
  assert.equal(info({ product_id: 's1', title: '스모크 · 오픈', body: body({ status: '요청', proj: 's1' }) }).stepId, 't6');
  //  제목은 같아도 단계 흔적이 없는 일반 메모 → 아님
  assert.equal(info({ product_id: 's1', title: '26FW 1차 · 촬영', body: '촬영 메모' }), null);
  assert.equal(info({ product_id: 's1', title: '26FW 1차 · 촬영', body: body({ proj: 's1', due: '2026-11-01' }) }), null);
  assert.equal(info({ product_id: 's1', title: '26FW 1차 · 촬영', body: body({ proj: 's1', status: '없음', due: '2026-11-01' }) }), null);
  //  '· 기본 페이지' 인데 season-home 표시가 없으면 아님 (운영 8e104f74 — 1차에 붙은 '26FW 3차 · 기본 페이지')
  assert.equal(info({ product_id: 's1', title: '26FW 3차 · 기본 페이지', body: body({ proj: 's1', status: '요청', embed: 'items' }) }), null);
  //  제목이 다르면(사용자가 이름을 바꾼 옛 메모) 아님 · 시즌이 없으면 아님
  assert.equal(info({ product_id: 's1', title: '촬영 준비', body: body({ proj: 's1', status: '요청', due: '2026-11-01' }) }), null);
  assert.equal(info({ product_id: null, title: '26FW 1차 · 촬영', body: body({ status: '요청', due: '2026-11-01' }) }), null);
});

test('브랜드 단계가 있으면 그것, 없으면 공통 단계', () => {
  const st = [{ id: 'c1', sort: 2 }, { id: 'c2', sort: 1 }, { id: 'm1', brand_id: 'b9', sort: 1 }, { id: 'x', active: false }];
  assert.deepEqual(stepsOfBrand(st, 'b1').map(s => s.id), ['c2', 'c1']);
  assert.deepEqual(stepsOfBrand(st, 'b9').map(s => s.id), ['m1']);
});

//  화면과 같은 모양: 두 시즌의 단계 메모 12개가 '오늘'에 섞여 있고 일반 메모 3개
function sample() {
  const at = i => `2026-10-22T0${Math.floor(i / 6)}:${String(10 + i).padStart(2, '0')}:00Z`;
  const list = [];
  let i = 0;
  for (const s of seasons) {
    list.push({ id: `${s.id}-home`, product_id: s.id, title: `${s.name} · 기본 페이지`, body: body({ proj: s.id, status: '요청', embed: 'season-home' }), updated_at: at(i++), created_at: '2026-10-01' });
    for (const st of steps.slice(0, 5)) list.push({ id: `${s.id}-${st.id}`, product_id: s.id, title: `${s.name} · ${st.name}`, body: body({ proj: s.id, status: '요청', step: st.id }), updated_at: at(i++), created_at: '2026-10-01' });
  }
  list.push({ id: 'g1', title: '거래처 메모', body: '연락처', updated_at: '2026-10-22T09:00:00Z' });
  list.push({ id: 'g2', product_id: 's1', title: '26FW 1차 원가표', body: '원가', updated_at: '2026-10-22T00:30:00Z' });
  list.push({ id: 'g3', title: '회의', body: '', updated_at: '2026-10-21T09:00:00Z' });
  return list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

test('단계 메모 12개 → 시즌 2줄, 일반 메모 수·순서 그대로', () => {
  const list = sample();
  const rows = groupRows(list, info);
  const seas = rows.filter(r => r.type === 'season');
  assert.equal(seas.length, 2);
  assert.deepEqual(seas.map(r => r.notes.length), [6, 6]);
  //  펼치면 기본 페이지 → 단계 순서
  assert.deepEqual(seas.find(r => r.seaId === 's1').notes.map(n => n.id), ['s1-home', 's1-t1', 's1-t2', 's1-t3', 's1-t4', 's1-t5']);
  const general = rows.filter(r => r.type === 'note').map(r => r.note.id);
  assert.deepEqual(general, list.filter(n => !info(n)).map(n => n.id));
  assert.deepEqual(general, ['g1', 'g2', 'g3']);
  //  시즌 줄은 그 시즌에서 가장 최근 메모 자리에 선다
  assert.equal(rows.length, 5);
  assert.equal(rows[0].note?.id, 'g1');
  //  모든 메모가 빠짐없이 한 번씩
  const flat = rows.flatMap(r => r.type === 'note' ? [r.note.id] : r.notes.map(n => n.id));
  assert.deepEqual(flat.slice().sort(), list.map(n => n.id).sort());
});

test('고정한 단계 메모와 단계 하나뿐인 시즌은 접지 않는다', () => {
  const list = sample();
  list.find(n => n.id === 's3-t1').pinned = true;
  const one = [{ id: 'x', product_id: 's1', title: 'a', body: body({ proj: 's1', status: '요청', step: 't1' }) }];
  assert.equal(groupRows(one, info)[0].type, 'note');
  const rows = groupRows(list, info);
  assert.ok(rows.some(r => r.type === 'note' && r.note.id === 's3-t1'));
  assert.equal(rows.find(r => r.seaId === 's3').notes.length, 5);
});

test('같은 시즌+단계가 있으면 건너뛴다 — 옛 메모(step 없음)도, 다른 시즌은 따로', () => {
  const have = [
    { product_id: 's1', title: '26FW 1차 · 기획', body: body({ proj: 's1', status: '요청', due: '2026-11-01' }) },
    { product_id: 's1', title: 'x', body: body({ proj: 's1', status: '요청', step: 't3' }) },
    { product_id: 's1', title: '26FW 1차 · 기본 페이지', body: body({ proj: 's1', embed: 'season-home' }) },
    { product_id: 's3', title: 'y', body: body({ proj: 's3', status: '요청', step: 't4' }) },
  ];
  const p = planStageRows(have, 's1', steps.slice(0, 4), info);
  assert.deepEqual(p.make.map(s => s.id), ['t2', 't4']);
  assert.deepEqual(p.skip.map(s => s.id), ['t1', 't3']);
  assert.equal(p.homeExists, true);
  assert.equal(planStageRows(have, 's3', steps.slice(0, 1), info).homeExists, false);
});

test('빠른 2회 클릭·동시 호출 → insert 1회, 끝나면 다시 누를 수 있다', async () => {
  const map = new Map();
  const db = [];
  let inserts = 0;
  const make = () => once(map, 'make', async () => {
    const plan = planStageRows(db, 's1', steps.slice(0, 3), info);
    await new Promise(r => setTimeout(r, 20));     // 네트워크 기다리는 사이 두 번째 클릭
    if (!plan.make.length) return;
    inserts++;
    db.push(...plan.make.map(st => ({ product_id: 's1', title: st.name, body: body({ proj: 's1', status: '요청', step: st.id }) })));
  });
  const a = make(), b = make();
  assert.equal(a, b);
  await Promise.all([a, b, make()]);
  assert.equal(inserts, 1);
  assert.equal(db.length, 3);
  assert.equal(map.size, 0);
  await make();                                     // 끝난 뒤 또 눌러도 이미 있으니 만들지 않는다
  assert.equal(inserts, 1);
  assert.equal(db.length, 3);
});

test('once — 실패해도 잠금이 풀린다', async () => {
  const map = new Map();
  await assert.rejects(once(map, 'k', async () => { throw new Error('x'); }));
  assert.equal(map.size, 0);
  assert.equal(await once(map, 'k', async () => 7), 7);
});
