//  숫자 옆 ? 툴팁 — 문구는 helpDict.js TIPS 한 곳에서만 온다.
//  열기: 마우스는 올리면 · 키보드는 포커스 · 손가락은 탭(다시 탭/바깥 탭/Esc 로 닫힘).
//  ? 는 카드 안에 있어도 카드 클릭(화면 이동)을 일으키지 않는다 — 캡처 단계에서 클릭을 멈춘다.
//  말풍선은 body 에 하나(#tip-pop)만 두고, 화면 밖으로 안 나가게 자리를 계산한다(placeTip).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escHTML = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

//  ? 버튼 HTML. 사전에 없는 키면 빈 문자열(틀린 키로 빈 말풍선이 뜨지 않게)
export function tipHTML(key, tips) {
    const t = tips && Object.prototype.hasOwnProperty.call(tips, key) ? tips[key] : null;
    if (!t) return '';
    return `<button type="button" class="tip-q" data-tip="${escHTML(key)}" aria-label="${escHTML(t.title)} 설명" aria-describedby="tip-pop">?</button>`;
}

//  말풍선 자리 — 기본은 ? 아래, 아래가 모자라면 위. 좌우는 화면 안(여백 m)으로 붙인다.
//  a = ? 의 getBoundingClientRect, size = 말풍선 {w,h}, vp = 화면 {w,h}
export function placeTip(a, size, vp, m = 8) {
    const gap = 6;
    const w = Math.min(size.w, vp.w - m * 2);
    let left = a.left + a.width / 2 - w / 2;
    left = Math.max(m, Math.min(left, vp.w - w - m));
    const roomBelow = vp.h - a.bottom - gap - m, roomAbove = a.top - gap - m;
    const below = roomBelow >= size.h || roomBelow >= roomAbove;
    let top = below ? a.bottom + gap : a.top - gap - size.h;
    top = Math.max(m, Math.min(top, vp.h - size.h - m));
    return { left: Math.round(left), top: Math.round(top), width: Math.round(w), below };
}

//  한 번만 건다(문서 단위 위임). 다시 불러도 겹쳐 걸리지 않는다
export function initTips(tips, doc = document) {
    if (doc.__tipsOn) return doc.__tipsOn;
    const win = doc.defaultView;
    let cur = null, pinned = false;
    const pop = () => {
        let el = doc.getElementById('tip-pop');
        if (!el) {
            el = doc.createElement('div'); el.id = 'tip-pop'; el.className = 'tip-pop'; el.setAttribute('role', 'tooltip'); el.hidden = true;
            doc.body.appendChild(el);
        }
        return el;
    };
    const hide = () => {
        const el = doc.getElementById('tip-pop'); if (el) el.hidden = true;
        if (cur) cur.setAttribute('aria-expanded', 'false');
        cur = null; pinned = false;
    };
    const show = (btn, pin) => {
        const t = tips[btn.dataset.tip]; if (!t) return;
        const el = pop();
        el.textContent = '';
        const h = doc.createElement('b'); h.textContent = t.title; el.appendChild(h);
        const ul = doc.createElement('ul');
        for (const line of t.lines || []) { const li = doc.createElement('li'); li.textContent = line; ul.appendChild(li); }
        el.appendChild(ul);
        el.hidden = false; el.style.left = '0px'; el.style.top = '0px'; el.style.width = '';
        const r = btn.getBoundingClientRect(), s = el.getBoundingClientRect();
        const p = placeTip(r, { w: s.width, h: s.height }, { w: win.innerWidth, h: win.innerHeight });
        el.style.width = p.width + 'px';
        const s2 = el.getBoundingClientRect();   // 폭이 줄면 높이가 늘 수 있어 한 번 더
        const p2 = placeTip(r, { w: p.width, h: s2.height }, { w: win.innerWidth, h: win.innerHeight });
        el.style.left = p2.left + 'px'; el.style.top = p2.top + 'px';
        if (cur && cur !== btn) cur.setAttribute('aria-expanded', 'false');
        cur = btn; pinned = !!pin; btn.setAttribute('aria-expanded', 'true');
    };
    const q = e => e.target && e.target.closest ? e.target.closest('.tip-q') : null;
    const on = {
        pointerover: e => { const b = q(e); if (b && e.pointerType === 'mouse' && !pinned) show(b, false); },
        pointerout: e => { const b = q(e); if (b && e.pointerType === 'mouse' && !pinned && b === cur && !b.contains(e.relatedTarget)) hide(); },
        focusin: e => { const b = q(e); if (b && !pinned) show(b, false); },
        focusout: e => { const b = q(e); if (b && b === cur && !pinned) hide(); },
        click: e => {
            const b = q(e);
            if (b) {
                e.preventDefault(); e.stopPropagation();   // 카드 onclick(화면 이동) 막기
                if (cur === b && pinned) hide(); else show(b, true);
                return;
            }
            if (cur && !(e.target && e.target.closest && e.target.closest('#tip-pop'))) hide();
        },
        keydown: e => { if (e.key === 'Escape' && cur) { e.stopPropagation(); hide(); } },
        scroll: () => { if (cur) hide(); },
    };
    for (const [k, f] of Object.entries(on)) doc.addEventListener(k, f, true);
    win.addEventListener('resize', on.scroll);
    doc.__tipsOn = { hide, show };
    return doc.__tipsOn;
}
