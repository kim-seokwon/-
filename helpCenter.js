//  도움말 패널(공지 · 사용설명서 · 불편접수) — 화면 HTML 과 검사만 담는 순수 함수 모음(DB·DOM 안 만짐 → 테스트로 바로 확인).
//  DB 는 092_help_center.sql: notices · notice_reads · feedback_reports · 버킷 feedback(private, 5MB, png/jpeg/webp/gif).
//  누가 무엇을 보나: 관리자(MASTER) 3탭 전부 + 공지 쓰기·불편 상태 바꾸기 / 직원(STAFF) 3탭, 불편은 본인 것만 / 고객사(CLIENT) 사용설명서만.
import { escHTML as esc, tipHTML } from './helpWidget.js';

export const FB_MAX = 2000;
export const FB_IMG_MAX = 5 * 1024 * 1024;
export const FB_MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export const FB_STATUS = ['접수', '처리중', '완료'];
export const NOTICE_TITLE_MAX = 100, NOTICE_BODY_MAX = 5000;

//  역할별로 열 수 있는 탭(순서 = 화면 순서)
export function helpTabs(role) {
    if (role === 'MASTER' || role === 'STAFF') return ['notice', 'manual', 'feedback'];
    return ['manual'];
}

//  안 읽은 공지 수 — 게시된 것 중 내 읽음 표시가 없는 것
export function unreadCount(notices, readIds) {
    const seen = new Set(readIds || []);
    return (notices || []).filter(n => n && n.published !== false && !seen.has(n.id)).length;
}

//  공지 줄 세우기 — 고정 먼저, 그다음 최신
export function sortNotices(list) {
    return (list || []).slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

//  불편접수 입력 검사 — 통과면 null, 아니면 화면에 보일 한 줄
export function validateFeedback(body, file) {
    const t = String(body || '').trim();
    if (!t) return '내용을 적어주세요.';
    if (t.length > FB_MAX) return `내용은 ${FB_MAX.toLocaleString()}자까지입니다(지금 ${t.length.toLocaleString()}자).`;
    if (file) {
        if (!FB_MIME_EXT[file.type]) return '사진은 PNG·JPG·WEBP·GIF 만 올릴 수 있습니다.';
        if (file.size > FB_IMG_MAX) return '사진은 5MB 까지입니다.';
    }
    return null;
}

//  공지 입력 검사
export function validateNotice(title, body) {
    const t = String(title || '').trim();
    if (!t) return '제목을 적어주세요.';
    if (t.length > NOTICE_TITLE_MAX) return `제목은 ${NOTICE_TITLE_MAX}자까지입니다.`;
    if (String(body || '').length > NOTICE_BODY_MAX) return `본문은 ${NOTICE_BODY_MAX.toLocaleString()}자까지입니다.`;
    return null;
}

//  첨부 저장 위치 — 내 이름 폴더/무작위.확장자(확장자는 파일 이름이 아니라 종류에서). DB 정책이 첫 폴더 = 내 이름을 확인한다
export function feedbackPath(username, mime, uuid) {
    const ext = FB_MIME_EXT[mime];
    const u = String(username || '');
    if (!ext || !/^[^/\\]{1,80}$/.test(u) || u === '.' || u === '..') return null;
    const id = String(uuid || '').replace(/[^0-9a-f-]/gi, '');
    if (!id) return null;
    return `${u}/${id}.${ext}`;
}

const when = t => {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const STATUS_CLS = { '접수': 'st-new', '처리중': 'st-doing', '완료': 'st-done' };
const TAB_LABEL = { notice: '공지', manual: '사용설명서', feedback: '불편접수' };

//  패널 전체. s = { role, tab, unread, notices, readIds, q, manual, tips, here, open, icons, feedback, editing, error, busy, screen }
export function helpPanelHTML(s) {
    const tabs = helpTabs(s.role);
    const tab = tabs.includes(s.tab) ? s.tab : tabs[0];
    const head = tabs.length > 1
        ? `<div class="hc-tabs" role="tablist">${tabs.map(t => `<button type="button" role="tab" class="hc-tab${t === tab ? ' on' : ''}" aria-selected="${t === tab}" data-hc="tab" data-tab="${t}">${TAB_LABEL[t]}${t === 'notice' && s.unread ? `<i class="hc-dot" aria-label="안 읽은 공지 ${s.unread}건"></i>` : ''}</button>`).join('')}</div>`
        : '';
    const body = tab === 'notice' ? noticeHTML(s) : tab === 'feedback' ? feedbackHTML(s) : manualHTML(s);
    return `<div class="hc-panel" role="dialog" aria-modal="false" aria-label="도움말">
        <div class="hc-head"><b><i class="ph ph-question"></i> 도움말</b><button type="button" class="hc-x" data-hc="close" aria-label="닫기">×</button></div>
        ${head}
        <div class="hc-body" data-tab="${tab}">${s.error ? `<div class="hc-err">${esc(s.error)}</div>` : ''}${body}</div>
    </div>`;
}

function noticeHTML(s) {
    const admin = s.role === 'MASTER';
    const read = new Set(s.readIds || []);
    const list = sortNotices(s.notices);
    const ed = s.editing;
    const form = admin && ed ? `<div class="hc-form">
        <input class="hc-in" id="hc-n-title" maxlength="${NOTICE_TITLE_MAX}" placeholder="제목" value="${esc(ed.title || '')}">
        <textarea class="hc-in" id="hc-n-body" rows="5" maxlength="${NOTICE_BODY_MAX}" placeholder="내용">${esc(ed.body || '')}</textarea>
        <label class="hc-chk"><input type="checkbox" id="hc-n-pin"${ed.pinned ? ' checked' : ''}> 맨 위 고정</label>
        <label class="hc-chk"><input type="checkbox" id="hc-n-pub"${ed.published === false ? '' : ' checked'}> 직원에게 보이기</label>
        <div class="hc-row"><button type="button" class="hc-btn" data-hc="n-cancel">취소</button><button type="button" class="hc-btn pri" data-hc="n-save"${s.busy ? ' disabled' : ''}>${ed.id ? '고치기' : '올리기'}</button></div>
    </div>` : '';
    const add = admin && !ed ? `<div class="hc-row end"><button type="button" class="hc-btn pri" data-hc="n-new"><i class="ph ph-plus"></i> 공지 쓰기</button></div>` : '';
    const items = list.length ? list.map(n => `<article class="hc-card${read.has(n.id) || n.published === false ? '' : ' unread'}">
        <div class="hc-card-h">${n.pinned ? '<span class="hc-pin">고정</span>' : ''}${n.published === false ? '<span class="hc-hide">숨김</span>' : ''}<b>${esc(n.title)}</b><span class="hc-when">${when(n.created_at)}</span></div>
        ${n.body ? `<div class="hc-text">${esc(n.body)}</div>` : ''}
        ${admin ? `<div class="hc-row end"><button type="button" class="hc-btn sm" data-hc="n-edit" data-id="${esc(n.id)}">고치기</button><button type="button" class="hc-btn sm" data-hc="n-pin" data-id="${esc(n.id)}">${n.pinned ? '고정 풀기' : '고정'}</button></div>` : ''}
    </article>`).join('') : `<div class="hc-empty">${s.notices ? '공지가 없습니다.' : '불러오는 중…'}</div>`;
    return form + add + items;
}

//  사용설명서 — 맨 위 '지금 보는 화면' 카드 + 화면 타일 격자(2열, 누르면 그 자리에서 펼침·한 번에 하나).
//  s.here = 지금 화면의 MANUAL id(없으면 카드 생략) · s.open = 펼친 타일 id · s.icons = { id: 독 아이콘 파일 }
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';
//  문장 속 [버튼이름] → 버튼 모양 칩. 이스케이프한 뒤에 바꾼다(문구는 helpDict 고정값). '[ ]'(빈칸 체크) 는 글자 그대로
export const manualLineHTML = l => esc(l).replace(/\[([^\[\]\s][^\[\]]{0,29})\]/g, '<span class="hc-kbd">$1</span>');
function manualBodyHTML(m, s) {
    const tips = s.tips || {};
    const go = (s.icons || {})[m.id] !== undefined;
    return `<ol class="hc-steps">${m.lines.map((l, i) => `<li><span class="hc-no" aria-hidden="true">${CIRCLED[i] || i + 1}</span><span>${manualLineHTML(l)}</span></li>`).join('')}</ol>
        ${m.tips.length ? `<div class="hc-nums">${m.tips.filter(k => tips[k]).map(k => `<span class="hc-num">${esc(tips[k].title)} ${tipHTML(k, tips)}</span>`).join('')}</div>` : ''}
        ${go ? `<div class="hc-row end"><button type="button" class="hc-btn sm pri" data-hc="m-go" data-id="${esc(m.id)}"><i class="ph ph-arrow-square-out"></i> 이 화면 열기</button></div>` : ''}`;
}
function manualIconHTML(m, s) {
    const f = (s.icons || {})[m.id];
    return f ? `<img class="hc-ico" src="icons/${esc(f)}.png" alt="" draggable="false">` : '<i class="hc-ico ph ph-book-open"></i>';
}
function manualItemsHTML(s) {
    const list = s.manual || [];
    if (!list.length) return `<div class="hc-empty">'${esc(s.q)}' 에 맞는 설명이 없습니다.</div>`;
    const searching = !!String(s.q || '').trim();
    const open = searching && list.length === 1 ? list[0].id : s.open;   // 찾아서 하나만 남으면 바로 펼친다
    const here = !searching && s.here ? list.find(m => m.id === s.here) : null;
    const card = here ? `<article class="hc-card hc-here">
        <div class="hc-sub">지금 보는 화면</div>
        <div class="hc-card-h">${manualIconHTML(here, s)}<b>${esc(here.title)}</b></div>
        ${manualBodyHTML(here, s)}
    </article>` : '';
    const tile = m => {
        const on = m.id === open;
        return `<div class="hc-tile${on ? ' on' : ''}">
            <button type="button" class="hc-tile-b" data-hc="m-tile" data-id="${esc(m.id)}" aria-expanded="${on}">
                ${manualIconHTML(m, s)}<span class="hc-tile-t"><b>${esc(m.title)}</b><small>${esc(m.summary || '')}</small></span>
            </button>
            ${on ? `<div class="hc-tile-d">${manualBodyHTML(m, s)}</div>` : ''}
        </div>`;
    };
    return `${card}${here ? '<div class="hc-sub">전체 화면</div>' : ''}<div class="hc-tiles">${list.map(tile).join('')}</div>`;
}
function manualHTML(s) {
    return `<input class="hc-in" id="hc-q" type="search" placeholder="찾기 — 예: 송장, 환불, 팔로워" value="${esc(s.q || '')}" autocomplete="off">
        <div id="hc-manual-list">${manualItemsHTML(s)}</div>`;
}

//  사용설명서 목록만(찾기 칸에 치는 동안 칸은 두고 목록만 바꾼다 — 글자가 안 날아가게)
export function manualListHTML(s) { return manualItemsHTML(s); }

function feedbackHTML(s) {
    const admin = s.role === 'MASTER';
    const list = s.feedback;
    const form = `<div class="hc-form">
        <textarea class="hc-in" id="hc-fb-body" rows="4" maxlength="${FB_MAX}" placeholder="어디서 무엇이 불편했는지 적어주세요"></textarea>
        <label class="hc-file"><input type="file" id="hc-fb-img" accept="image/png,image/jpeg,image/webp,image/gif"><i class="ph ph-image"></i> <span id="hc-fb-img-name">화면 사진 붙이기(선택 · 5MB 까지)</span></label>
        <div class="hc-meta">지금 화면(${esc(s.screen || '-')})이 함께 남습니다.</div>
        <div class="hc-row end"><button type="button" class="hc-btn pri" data-hc="fb-send"${s.busy ? ' disabled' : ''}><i class="ph ph-paper-plane-tilt"></i> 접수</button></div>
    </div>`;
    const items = !list ? '<div class="hc-empty">불러오는 중…</div>'
        : !list.length ? `<div class="hc-empty">${admin ? '접수된 불편이 없습니다.' : '내가 접수한 불편이 없습니다.'}</div>`
        : list.map(f => `<article class="hc-card">
            <div class="hc-card-h"><span class="hc-st ${STATUS_CLS[f.status] || ''}">${esc(f.status)}</span>${admin ? `<b>${esc(f.username)}</b>` : ''}${f.screen ? `<span class="hc-meta">${esc(f.screen)}</span>` : ''}<span class="hc-when">${when(f.created_at)}</span></div>
            <div class="hc-text">${esc(f.body)}</div>
            ${f.image_path ? `<button type="button" class="hc-btn sm" data-hc="fb-img" data-id="${esc(f.id)}"><i class="ph ph-image"></i> 사진 보기</button>` : ''}
            ${f.admin_note && !admin ? `<div class="hc-note">답: ${esc(f.admin_note)}</div>` : ''}
            ${admin ? `<div class="hc-row">${FB_STATUS.map(st => `<button type="button" class="hc-btn sm${st === f.status ? ' on' : ''}" data-hc="fb-st" data-id="${esc(f.id)}" data-st="${st}"${st === f.status ? ' aria-pressed="true"' : ''}>${st}</button>`).join('')}</div>` : ''}
        </article>`).join('');
    return form + `<div class="hc-sub">${admin ? '전체 접수' : '내 접수'}</div>` + items;
}

//  ? 도움말 버튼(오른쪽 아래) — 안 읽은 공지가 있으면 점
export function helpFabHTML(unread) {
    return `<button type="button" class="help-fab" onclick="app.toggleHelp()" title="도움말·공지·불편접수" aria-label="도움말${unread ? `, 안 읽은 공지 ${unread}건` : ''}"><i class="ph ph-question"></i><span>도움말</span>${unread ? '<i class="hc-dot"></i>' : ''}</button>`;
}

//  패널을 다시 그린 뒤 같은 칸으로 포커스를 돌려놓을 선택자(id 우선, 없으면 data-hc + 구분값). 못 만들면 null
export function helpFocusKey(el) {
    if (!el || !el.getAttribute) return null;
    const q = v => String(v).replace(/["\\]/g, '\\$&');
    if (el.id) return `[id="${q(el.id)}"]`;
    const hc = el.getAttribute('data-hc'); if (!hc) return null;
    return `[data-hc="${q(hc)}"]` + ['data-tab', 'data-id', 'data-st'].map(a => el.getAttribute(a) != null ? `[${a}="${q(el.getAttribute(a))}"]` : '').join('');
}
