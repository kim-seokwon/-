import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const oneLineMethod = name => {
    const m = new RegExp(`\\n    ${name}\\(([^)]*)\\) \\{([^\\n]*)\\}`).exec(main);
    assert.ok(m, `${name} 메서드 없음`);
    return Function(...m[1].split(',').map(x => x.trim()).filter(Boolean), m[2]);
};

test('할 일은 분류·목록·상세 3단이며 선택 상태를 모바일 상세로 넘긴다', () => {
    for (const token of ['class="rm-side c3-menu"', 'class="rm-main"', 'class="rm-doc"', 'class="rm-detail"', '할 일을 선택하세요']) {
        assert.ok(main.includes(token), token);
    }
    assert.match(css, /\.rm\{display:grid;grid-template-columns:238px 350px minmax\(0,1fr\)/);
    assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.rm\.detail \.rm-main\{display:none\}[\s\S]*?\.rm\.detail \.rm-doc\{display:flex\}/);

    const app = { remPick: null, remMobileDetail: false, renders: 0, requestRender() { this.renders++; } };
    oneLineMethod('selectRemItem').call(app, 'todo', 't1');
    assert.equal(app.remPick, 'todo:t1'); assert.equal(app.remMobileDetail, true);
    oneLineMethod('closeRemDetail').call(app);
    assert.equal(app.remMobileDetail, false); assert.equal(app.renders, 2);
});

test('목록을 바꾸면 이전 선택을 버리고 목록 화면으로 돌아간다', () => {
    const app = { remPick: 'todo:t1', remMobileDetail: true, requestRender() {} };
    oneLineMethod('setRemList').call(app, 'done');
    assert.deepEqual([app.remList2, app.remPick, app.remMobileDetail], ['done', null, false]);
    app.remPick = 'rem:r1'; app.remMobileDetail = true;
    oneLineMethod('setRemGroup').call(app, 'project');
    assert.deepEqual([app.remGroup, app.remList2, app.remPick, app.remMobileDetail], ['project', 'all', null, false]);
});

test('기존 생성·완료·수정·기한·삭제·권한 경로를 새 상세가 그대로 호출한다', () => {
    for (const call of [
        "app.toggleRemItem('${pick.src}'", "app.saveRemDetailTitle(this,'${pick.src}'", "app.setRemDue('${pick.src}'",
        "app.delRemItem('${pick.src}'", "app.openTodoSource('${esc(String(pick.id))}')",
    ]) assert.ok(main.includes(call), call);
    assert.match(main, /from\('reminders'\)[\s\S]*?\.insert\(\[\{ title, due_date: due, list_name/);
    assert.match(main, /from\('reminders'\)\.update\(\{ done, done_at: r\.done_at \}\)/);
    assert.match(main, /from\('todos'\)\.update\(\{ completed: next \}\)/);
    assert.match(main, /if \(this\.currentUser\.role === 'MASTER' \|\| this\.currentUser\.role === 'STAFF'\) return true/);
    assert.match(main, /if \(this\.currentUser\.role === 'CLIENT' && item && item\.created_by === this\.currentUser\.id\) return true/);
});
