//  재구매 쿠폰 1-A 화면 — 고객 CRM 탭 안의 [재구매 쿠폰] (기획 v2: .work/재구매쿠폰/기획.md)
//
//  규칙 목록 · 규칙 편집(실시간 미리보기) · 회차 상세(승인 → CSV → 업로드 확인) · 이력/성과.
//  여기서는 RPC 만 부른다. 발급·문자·메일 없음. 'issued' 는 서버 coupon_run_confirm_manual 만 만든다.
//  BhasApp.prototype 에 섞어 쓴다(Object.assign). 상태는 this.cp 한 곳.
import { mockData } from './mockData.js';
import { PRESETS, RULE_STATUS, RUN_STATUS, EXCLUDE_REASON, WEEKDAYS, DEFAULT_RULE,
    nextRunAt, fmtKST, describeSchedule, describeTarget, validateRule, exportCSV, parseMemberIds, runActions, effectVerdict } from './repurchaseCoupon.js';

const clone = o => JSON.parse(JSON.stringify(o));
const MEMBER_STATUS = { pending: '발송 대기', not_confirmed: '확인 안 됨', issued: '발급 확인', failed: '누락', control: '대조군',
    control_counted: '대조군(집계)', excluded: '제외', cancelled: '중지', unknown: '모름', skipped: '건너뜀' };

export const couponMethods = {
    _cpState() { return (this.cp ||= { tab: 'rules', rules: [], runs: [], results: {}, edit: null, preview: null, run: null, members: [], loadedFor: null, busy: false, err: null }); },
    _cpBrandId(brandName) {
        const b = (mockData.brands || []).find(x => x.name === brandName);
        if (b) return b.id;
        return (this.malls || []).find(m => m.label === brandName)?.brand_id || null;
    },
    _cpIsMaster() { return this.currentUser?.role === 'MASTER'; },
    _cpErr(e) { const s = this._cpState(); s.busy = false; s.err = String(e?.message || e); this.showToast(s.err); this.requestRender(); },

    async cpLoad(brandId, force = false) {
        const s = this._cpState();
        if (!brandId || (!force && s.loadedFor === brandId) || s.loading) return;
        s.loading = true; s.err = null;
        try {
            const { data: rules, error } = await this.supabase.from('coupon_rules').select('*').eq('brand_id', brandId).order('priority');
            if (error) throw error;
            const ids = (rules || []).map(r => r.id);
            let runs = [];
            if (ids.length) {
                const r2 = await this.supabase.from('coupon_runs').select('*').in('rule_id', ids).order('scheduled_for', { ascending: false });
                if (r2.error) throw r2.error;
                runs = r2.data || [];
            }
            Object.assign(s, { rules: rules || [], runs, loadedFor: brandId });
        } catch (e) { s.err = String(e.message || e); }
        s.loading = false; this.requestRender();
    },
    cpTab(t) { const s = this._cpState(); s.tab = t; s.run = t === 'run' ? s.run : null; this.requestRender(); if (t === 'history') this.cpLoadResults(); },

    // -------- 규칙 편집
    cpNew(brandId) { const s = this._cpState(); s.edit = { ...clone(DEFAULT_RULE), brand_id: brandId }; s.preview = null; s.tab = 'rules'; this.requestRender(); this.cpPreview(); },
    cpEdit(id) { const s = this._cpState(); const r = s.rules.find(x => x.id === id); if (!r) return;
        s.edit = { ...clone(DEFAULT_RULE), ...clone(r), schedule: { ...DEFAULT_RULE.schedule, ...(r.schedule || {}) }, coupon: { ...DEFAULT_RULE.coupon, ...(r.coupon || {}) } };
        s.preview = null; this.requestRender(); this.cpPreview(); },
    cpCloseEdit() { const s = this._cpState(); s.edit = null; s.preview = null; this.requestRender(); },
    //  글자 칸은 상태만 바꾸고 안내·미리보기만 고친다(통째로 다시 그리면 입력 중 커서가 날아간다). 고르기 칸은 모양이 바뀌니 다시 그린다.
    cpField(path, raw, kind, redraw) {
        const s = this._cpState(); if (!s.edit) return;
        const v = kind === 'num' ? (raw === '' ? null : Number(raw)) : raw;
        const keys = path.split('.'); let o = s.edit;
        for (const k of keys.slice(0, -1)) o = (o[k] ||= {});
        o[keys.at(-1)] = v;
        if (path === 'target.preset' && v) for (const k of ['gone_min', 'gone_max', 'orders_min', 'orders_max', 'spend_min']) delete s.edit.target[k];
        if (redraw) this.requestRender(); else this._cpPatch();
        clearTimeout(this._cpPrevT); this._cpPrevT = setTimeout(() => this.cpPreview(), 350);
    },
    async cpPreview() {
        const s = this._cpState(); if (!s.edit) return;
        const bad = validateRule({ ...s.edit, name: s.edit.name || '미리보기', coupon: { ...s.edit.coupon, cafe24_coupon_no: s.edit.coupon?.cafe24_coupon_no || '0' } });
        if (bad) { s.preview = { error: bad }; this.requestRender(); return; }
        const seq = (this._cpPrevSeq = (this._cpPrevSeq || 0) + 1);
        const { data, error } = await this.supabase.rpc('coupon_preview', { p_rule: s.edit });
        if (seq !== this._cpPrevSeq) return;
        s.preview = error ? { error: error.message } : data; this._cpPatch();
    },
    _cpPatch() {
        const s = this._cpState(), r = s.edit; if (!r) return;
        const box = document.getElementById('cp-prev-body');
        if (!box) return this.requestRender();
        box.innerHTML = this._cpPreviewHTML();
        const err = validateRule(r), next = nextRunAt(r.schedule || {}, new Date());
        document.getElementById('cp-hint').textContent = this._cpHint(r.schedule || {}, next);
        document.getElementById('cp-err').innerHTML = err ? `<div class="cp-bad">${this._vesc(err)}</div>` : '';
        document.getElementById('cp-save').disabled = !!err || s.busy;
    },
    _cpHint(sc, next) { return `${describeSchedule(sc)} · 다음 ${next ? fmtKST(next, true) : '없음(종료일 지남)'} (KST) · 저장하면 초안 — 운영 시작은 대표만`; },
    async cpSave() {
        const s = this._cpState(); const bad = validateRule(s.edit);
        if (bad) return this._cpErr(bad);
        s.busy = true; this.requestRender();
        const { error } = await this.supabase.rpc('coupon_rule_save', { p: s.edit });
        if (error) return this._cpErr(error);
        s.busy = false; s.edit = null; s.preview = null; this.showToast('규칙을 저장했습니다(운영 시작 전 초안)');
        await this.cpLoad(s.loadedFor, true);
    },
    async cpSetStatus(id, status) {
        const { data, error } = await this.supabase.rpc('coupon_rule_set_status', { p_rule: id, p_status: status });
        if (error) return this._cpErr(error);
        this.showToast(status === 'active' ? `운영 시작 · 다음 회차 ${fmtKST(data)}` : `${RULE_STATUS[status]}(으)로 바꿨습니다`);
        await this.cpLoad(this._cpState().loadedFor, true);
    },

    // -------- 회차
    async cpOpenRun(id) {
        const s = this._cpState(); s.tab = 'run'; s.run = id; s.members = []; this.requestRender();
        const { data, error } = await this.supabase.from('coupon_run_members').select('member_id,name_masked,last_date,gone_days,orders,spend,arm,status,exclude_reason,issued_at,last_error').eq('run_id', id).order('member_id');
        if (error) return this._cpErr(error);
        s.members = data || []; this.requestRender();
    },
    async cpApprove(id) {
        const n = Number(document.getElementById('cp-confirm-n')?.value);
        const { error } = await this.supabase.rpc('coupon_run_approve', { p_run: id, p_confirm_n: n });
        if (error) return this._cpErr(error);
        this.showToast('내보내기 승인 — 아직 발급 아님. CSV를 받아 카페24에 올리세요');
        await this._cpReload(id);
    },
    async cpReject(id, kind = 'reject') {
        const reason = document.getElementById('cp-reason')?.value || '';
        const { error } = await this.supabase.rpc(kind === 'cancel' ? 'coupon_run_cancel' : 'coupon_run_reject', { p_run: id, p_reason: reason });
        if (error) return this._cpErr(error);
        this.showToast(kind === 'cancel' ? '회차를 중지했습니다' : '회차를 거절했습니다');
        await this._cpReload(id);
    },
    async cpExport(id) {
        const { data, error } = await this.supabase.rpc('coupon_run_export', { p_run: id });
        if (error) return this._cpErr(error);
        const ids = (data || []).map(r => r.member_id ?? r);
        const run = this._cpState().runs.find(r => r.id === id);
        const blob = new Blob(['﻿' + exportCSV(ids)], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = `재구매쿠폰_${run?.rule_snapshot?.name || ''}_${run?.as_of_date || ''}.csv`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 0);
        this._cpLastCSV = ids;   // 헤드리스 검수용
        this.showToast(`${ids.length.toLocaleString()}명 CSV를 받았습니다 — 아직 발급 아님`);
        await this._cpReload(id);
    },
    async cpConfirm(id) {
        const g = k => document.getElementById(k);
        const owner = g('cp-owner')?.value?.trim(), at = g('cp-uploaded')?.value, n = Number(g('cp-reported')?.value);
        const ev = g('cp-evidence')?.files?.[0], list = g('cp-list')?.files?.[0];
        if (!owner) return this._cpErr('올린 사람을 적어 주세요');
        if (!at) return this._cpErr('카페24에 올린 시각을 넣어 주세요');
        if (!ev) return this._cpErr('증빙 파일(화면 캡처·결과 파일)을 붙여 주세요');
        const s = this._cpState(); s.busy = true; this.requestRender();
        try {
            const ids = list ? parseMemberIds(await list.text()) : null;
            if (list && !ids.length) throw new Error('결과 파일에서 회원 ID를 찾지 못했습니다');
            const path = `${id}/${Date.now()}_${ev.name.replace(/[^\w.가-힣-]/g, '_')}`;
            const up = await this.supabase.storage.from('coupon_evidence').upload(path, ev, { upsert: false });
            if (up.error) throw up.error;
            const kst = new Date(`${at}:00+09:00`).toISOString();
            const { data, error } = await this.supabase.rpc('coupon_run_confirm_manual', {
                p_run: id, p_owner: owner, p_uploaded_at: kst, p_reported_n: n, p_evidence_path: `coupon_evidence/${path}`, p_member_ids: ids });
            if (error) throw error;
            s.busy = false;
            this.showToast(data?.status === 'done' ? `발급 확인 ${data.issued}명 — 회차 완료` : `발급 확인 ${data?.issued}명 · 누락 ${data?.failed}명 — 일부 완료`);
            await this._cpReload(id);
        } catch (e) { this._cpErr(e); }
    },
    async _cpReload(runId) { const s = this._cpState(); await this.cpLoad(s.loadedFor, true); if (runId) await this.cpOpenRun(runId); },
    async cpLoadResults() {
        const s = this._cpState();
        for (const r of s.rules) {
            const { data, error } = await this.supabase.rpc('coupon_run_results', { p_rule: r.id });
            s.results[r.id] = error ? { error: error.message } : (data || []);
        }
        this.requestRender();
    },

    // ================================================================ 그리기
    renderCoupon(brandName) {
        const s = this._cpState(), esc = v => this._vesc(v), brandId = this._cpBrandId(brandName);
        if (brandId && s.loadedFor !== brandId && !s.loading) setTimeout(() => this.cpLoad(brandId), 0);
        const tabs = [['rules', '규칙'], ['run', '회차'], ['history', '이력·성과']]
            .map(([k, t]) => `<button class="it-pill${s.tab === k ? ' on' : ''}" onclick="app.cpTab('${k}')">${t}</button>`).join('');
        const body = !brandId ? '<div class="crm-empty">브랜드를 고르세요</div>'
            : s.err && !s.rules.length ? `<div class="crm-empty bad">불러오지 못했습니다 · ${esc(s.err)}<button onclick="app.cpLoad('${brandId}', true)">다시 시도</button></div>`
            : s.tab === 'run' ? this._cpRunView() : s.tab === 'history' ? this._cpHistoryView() : (s.edit ? this._cpEditor() : this._cpRuleList(brandId));
        return `<div class="cp">
            <div class="cp-warn"><i class="ph ph-info"></i> 이 화면은 <b>명단 만들기 → 승인 → CSV → 카페24 직접 업로드 확인</b>까지입니다. 쿠폰 발급·문자·메일은 보내지 않습니다.</div>
            <div class="cp-tabs">${tabs}</div>${body}</div>`;
    },
    _cpRuleList(brandId) {
        const s = this._cpState(), esc = v => this._vesc(v), M = this._cpIsMaster();
        const awaiting = s.runs.filter(r => ['awaiting_approval', 'needs_review', 'approved_for_export', 'exported', 'export_expired'].includes(r.status));
        const rows = s.rules.filter(r => r.status !== 'archived').map(r => {
            const last = s.runs.find(x => x.rule_id === r.id);
            const act = !M ? '' : [
                r.status !== 'active' ? `<button class="cp-b pri" onclick="app.cpSetStatus('${r.id}','active')">운영 시작</button>` : `<button class="cp-b" onclick="app.cpSetStatus('${r.id}','paused')">일시중지</button>`,
                `<button class="cp-b" onclick="app.cpSetStatus('${r.id}','archived')">보관</button>`].join('');
            return `<tr><td><b>${esc(r.name)}</b><div class="mu">${esc(describeTarget(r.target))}</div></td>
                <td><span class="cp-st st-${r.status}">${RULE_STATUS[r.status] || r.status}</span></td>
                <td>${esc(describeSchedule(r.schedule))}<div class="mu">다음 ${r.status === 'active' ? fmtKST(r.next_run_at) : '—'}</div></td>
                <td>쿠폰 ${esc(r.coupon?.cafe24_coupon_no || '')}<div class="mu">${esc(r.coupon?.memo || '')}</div></td>
                <td>${last ? `<a href="#" onclick="app.cpOpenRun('${last.id}');return false">${RUN_STATUS[last.status]} · ${last.target_n}명</a>` : '<span class="mu">아직 없음</span>'}</td>
                <td class="cp-act"><button class="cp-b" onclick="app.cpEdit('${r.id}')">편집</button>${act}</td></tr>`;
        }).join('');
        return `${awaiting.length ? `<div class="cp-todo"><b>처리할 회차 ${awaiting.length}개</b>${awaiting.map(r => `<button class="cp-b" onclick="app.cpOpenRun('${r.id}')">${esc(r.rule_snapshot?.name)} · ${RUN_STATUS[r.status]} · ${r.target_n}명</button>`).join('')}</div>` : ''}
            <section class="crm-list"><div class="crm-list-head"><div><b>재구매 쿠폰 규칙</b><span>정해진 시각에 대상 명단을 고정한 회차가 만들어집니다 · 승인 없이는 아무것도 나가지 않음</span></div>
            <button class="crm-csv" onclick="app.cpNew('${brandId}')"><i class="ph ph-plus"></i> 새 규칙</button></div>
            <div class="crm-table-wrap"><table class="crm-table cp-table"><thead><tr><th>규칙</th><th>상태</th><th>주기</th><th>쿠폰</th><th>최근 회차</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="6" class="crm-none">${s.loading ? '불러오는 중…' : '규칙이 없습니다 — [새 규칙]으로 시작하세요'}</td></tr>`}</tbody></table></div></section>`;
    },
    _cpPreviewHTML() {
        const s = this._cpState(), r = s.edit, esc = v => this._vesc(v), p = s.preview;
        return !p ? '<div class="mu">미리보기 계산 중…</div>' : p.error ? `<div class="cp-bad">${esc(p.error)}</div>` : `
            <div class="cp-nums"><div><b>${p.matched}</b><span>묶음 해당</span></div><div><b>${p.treat}</b><span>발송군</span></div>
            <div><b>${p.control}</b><span>대조군(안 보냄)</span></div><div><b>${p.excluded}</b><span>제외</span></div></div>
            ${Object.keys(p.reasons || {}).length ? `<div class="cp-reasons">${Object.entries(p.reasons).map(([k, n]) => `<span>${EXCLUDE_REASON[k] || k} ${n}</span>`).join('')}</div>` : ''}
            ${p.over_limit ? `<div class="cp-bad">발송군이 최대 인원(${r.max_targets})을 넘습니다 — 회차가 '확인 필요'로 멈춥니다</div>` : ''}
            ${p.max_exposure != null ? `<div class="mu">최대 할인 노출 ${this._won ? this._won(p.max_exposure) : p.max_exposure}원</div>` : ''}
            <table class="crm-table"><thead><tr><th>이름</th><th>ID 끝</th><th>경과</th><th>구매</th></tr></thead><tbody>
            ${(p.sample || []).map(x => `<tr><td>${esc(x.name)}</td><td><code>…${esc(x.id_tail)}</code></td><td class="num">${x.gone_days}일</td><td class="num">${x.orders}회</td></tr>`).join('') || '<tr><td colspan="4" class="crm-none">해당 없음</td></tr>'}</tbody></table>
            <div class="mu">기준일 ${esc(p.as_of)} · 표본은 이름·ID 일부만</div>`;
    },
    _cpEditor() {
        const s = this._cpState(), r = s.edit, esc = v => this._vesc(v), sc = r.schedule || {}, t = r.target || {}, c = r.coupon || {};
        const inp = (path, val, kind = '', attrs = '') => `<input ${attrs} value="${esc(val ?? '')}" oninput="app.cpField('${path}', this.value, '${kind}')">`;
        const sel = (path, val, opts, kind = '') => `<select onchange="app.cpField('${path}', this.value, '${kind}', 1)">${opts.map(([v, l]) => `<option value="${v}"${String(val ?? '') === String(v) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
        const next = nextRunAt(sc, new Date()), err = validateRule(r);
        return `<div class="cp-edit"><section class="cp-form">
            <div class="cp-row"><label>규칙 이름</label>${inp('name', r.name, '', 'id="cp-name" placeholder="예) 휴면90 매주 월요일"')}</div>
            <div class="cp-row"><label>대상 묶음</label>${sel('target.preset', t.preset || '', [...PRESETS.map(x => [x[0], x[1]]), ['', '직접 조건']])}</div>
            ${!t.preset ? `<div class="cp-row two"><label>경과일</label>${inp('target.gone_min', t.gone_min, 'num', 'type="number" placeholder="이상"')}${inp('target.gone_max', t.gone_max, 'num', 'type="number" placeholder="이하"')}</div>
            <div class="cp-row two"><label>구매 횟수</label>${inp('target.orders_min', t.orders_min, 'num', 'type="number" placeholder="이상"')}${inp('target.orders_max', t.orders_max, 'num', 'type="number" placeholder="이하"')}</div>
            <div class="cp-row"><label>누적 금액 이상</label>${inp('target.spend_min', t.spend_min, 'num', 'type="number"')}</div>` : ''}
            <div class="cp-row"><label>카페24 쿠폰 번호</label>${inp('coupon.cafe24_coupon_no', c.cafe24_coupon_no, '', 'id="cp-coupon" placeholder="카페24에 미리 만든 쿠폰 번호"')}</div>
            <div class="cp-row"><label>쿠폰 메모</label>${inp('coupon.memo', c.memo, '', 'placeholder="15% · 최대 1만원"')}</div>
            <div class="cp-row two"><label>최대 할인·유효일</label>${inp('coupon.max_discount', c.max_discount, 'num', 'type="number" placeholder="원"')}${inp('coupon.valid_days', c.valid_days, 'num', 'type="number" placeholder="일"')}</div>
            <div class="cp-row"><label>주기</label>${sel('schedule.freq', sc.freq, [['weekly', '매주'], ['monthly', '매월'], ['every_n', 'N일마다']])}
              ${sc.freq === 'weekly' ? sel('schedule.weekday', sc.weekday, WEEKDAYS.slice(1).map((d, i) => [i + 1, d + '요일']), 'num')
                : sc.freq === 'monthly' ? inp('schedule.monthday', sc.monthday, 'num', 'type="number" min="1" max="31"') : inp('schedule.every_days', sc.every_days, 'num', 'type="number" min="1"')}
              ${inp('schedule.time_kst', sc.time_kst, '', 'type="time"')}</div>
            <div class="cp-row two"><label>시작·종료일</label>${inp('schedule.start_date', sc.start_date, '', 'type="date"')}${inp('schedule.end_date', sc.end_date, '', 'type="date"')}</div>
            <div class="cp-row two"><label>대조군 %·쿨다운일</label>${inp('control_pct', r.control_pct, 'num', 'type="number" min="0" max="50"')}${inp('cooldown_days', r.cooldown_days, 'num', 'type="number" min="0"')}</div>
            <div class="cp-row two"><label>최대 인원·우선순위</label>${inp('max_targets', r.max_targets, 'num', 'type="number" min="1"')}${inp('priority', r.priority, 'num', 'type="number"')}</div>
            <div class="cp-hint" id="cp-hint">${esc(this._cpHint(sc, next))}</div>
            <div id="cp-err">${err ? `<div class="cp-bad">${esc(err)}</div>` : ''}</div>
            <div class="cp-act"><button class="cp-b" onclick="app.cpCloseEdit()">닫기</button><button class="cp-b pri" id="cp-save" ${err || s.busy ? 'disabled' : ''} onclick="app.cpSave()">저장</button></div>
          </section><section class="cp-prev"><b>지금 돌리면</b><div id="cp-prev-body">${this._cpPreviewHTML()}</div></section></div>`;
    },
    _cpRunView() {
        const s = this._cpState(), esc = v => this._vesc(v), run = s.runs.find(r => r.id === s.run);
        if (!run) {
            const list = s.runs.map(r => `<tr onclick="app.cpOpenRun('${r.id}')" style="cursor:pointer"><td>${esc(r.rule_snapshot?.name)}</td><td>${fmtKST(r.scheduled_for, true)}</td><td><span class="cp-st rs-${r.status}">${RUN_STATUS[r.status]}</span></td><td class="num">${r.target_n}</td><td class="num">${r.control_n}</td><td class="num">${r.excluded_n}</td></tr>`).join('');
            return `<section class="crm-list"><div class="crm-list-head"><div><b>회차</b><span>회차마다 그 시각 명단이 고정됩니다</span></div></div><div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>규칙</th><th>예정</th><th>상태</th><th>발송군</th><th>대조군</th><th>제외</th></tr></thead><tbody>${list || '<tr><td colspan="6" class="crm-none">아직 회차가 없습니다</td></tr>'}</tbody></table></div></section>`;
        }
        const acts = runActions(run.status, this._cpIsMaster()), m = s.members;
        const by = st => m.filter(x => x.status === st).length;
        const panel = [];
        if (acts.includes('approve')) panel.push(`<div class="cp-step"><b>1. 승인</b><p>발송군 <b>${run.target_n}명</b>이 맞으면 숫자를 다시 적고 승인하세요. 승인해도 발급되지 않습니다.</p>
            <input id="cp-confirm-n" type="number" placeholder="${run.target_n}"><button class="cp-b pri" id="cp-approve" onclick="app.cpApprove('${run.id}')">내보내기 승인</button></div>`);
        if (acts.includes('export')) panel.push(`<div class="cp-step"><b>2. CSV 받기</b><p>회원 ID만 들어 있습니다. 카페24 쿠폰 ${esc(run.rule_snapshot?.coupon?.cafe24_coupon_no)} 의 '회원 지정 발급'에 직접 올리세요.</p>
            <button class="cp-b pri" id="cp-export" onclick="app.cpExport('${run.id}')"><i class="ph ph-download-simple"></i> CSV 받기 (${run.target_n}명)</button></div>`);
        if (acts.includes('confirm')) panel.push(`<div class="cp-step"><b>3. 업로드 확인</b><p>카페24에 올린 뒤 적어 주세요. 이때만 '발급 확인'으로 바뀌고 쿨다운이 걸립니다.${run.status === 'export_expired' ? ' <b>(확인 기한 7일 지남 — 늦은 확인으로 기록)</b>' : ''}</p>
            <div class="cp-row"><label>올린 사람</label><input id="cp-owner" value="${esc(this.currentUser?.name || '')}"></div>
            <div class="cp-row"><label>올린 시각(KST)</label><input id="cp-uploaded" type="datetime-local"></div>
            <div class="cp-row"><label>카페24 발급 인원</label><input id="cp-reported" type="number" placeholder="${run.target_n}"></div>
            <div class="cp-row"><label>증빙(필수)</label><input id="cp-evidence" type="file" accept="image/*,.pdf,.csv,.txt,.xlsx"></div>
            <div class="cp-row"><label>결과 파일(선택)</label><input id="cp-list" type="file" accept=".csv,.txt"><span class="mu">일부만 발급됐으면 발급된 회원 목록을 넣으세요</span></div>
            <button class="cp-b pri" id="cp-confirm" ${s.busy ? 'disabled' : ''} onclick="app.cpConfirm('${run.id}')">업로드 확인</button></div>`);
        if (acts.includes('reject') || acts.includes('cancel')) panel.push(`<div class="cp-step"><b>거절·중지</b><input id="cp-reason" placeholder="사유(필수)">
            ${acts.includes('reject') ? `<button class="cp-b" onclick="app.cpReject('${run.id}','reject')">거절</button>` : ''}${acts.includes('cancel') ? `<button class="cp-b" onclick="app.cpReject('${run.id}','cancel')">중지</button>` : ''}</div>`);
        const info = [['예정', fmtKST(run.scheduled_for, true)], ['기준일', run.as_of_date], ['묶음 해당', run.matched_n], ['발송군', run.target_n], ['대조군', run.control_n], ['제외', run.excluded_n],
            ['발급 확인', by('issued')], ['누락', by('failed')], ['확인 안 됨', by('not_confirmed')]];
        return `<div class="cp-run"><div class="cp-run-head"><button class="cp-b" onclick="app.cpTab('run');app._cpState().run=null;app.requestRender()">← 회차 목록</button>
              <b>${esc(run.rule_snapshot?.name)}</b><span class="cp-st rs-${run.status}" id="cp-run-status">${RUN_STATUS[run.status]}</span></div>
            ${run.status === 'needs_review' ? `<div class="cp-bad">발송군 ${run.target_n}명이 최대 인원(${esc(run.rule_snapshot?.max_targets)})을 넘어 승인할 수 없습니다 — 규칙을 고친 뒤 이 회차는 거절하세요</div>` : ''}
            <div class="cp-nums">${info.map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div>
            ${Object.keys(run.exclude_counts || {}).length ? `<div class="cp-reasons">${Object.entries(run.exclude_counts).map(([k, n]) => `<span>${EXCLUDE_REASON[k] || k} ${n}</span>`).join('')}</div>` : ''}
            ${panel.length ? `<div class="cp-steps">${panel.join('')}</div>` : this._cpIsMaster() ? '' : '<div class="mu">승인·CSV·확인은 대표 계정만 할 수 있습니다</div>'}
            ${run.manual_confirmed_at ? `<div class="mu">확인: ${esc(run.manual_owner)} · 업로드 ${fmtKST(run.manual_uploaded_at, true)} · 보고 ${run.manual_reported_n}명 · 증빙 ${esc(run.manual_evidence_path)}</div>` : ''}
            <section class="crm-list"><div class="crm-table-wrap"><table class="crm-table" id="cp-members"><thead><tr><th>이름</th><th>ID 끝</th><th>군</th><th>상태</th><th>사유</th><th>경과</th></tr></thead><tbody>
            ${m.map(x => `<tr><td>${esc(x.name_masked || '—')}</td><td><code>…${esc(String(x.member_id).slice(-3))}</code></td><td>${x.arm === 'control' ? '대조' : x.arm === 'treat' ? '발송' : '—'}</td><td>${MEMBER_STATUS[x.status] || x.status}</td><td>${esc(EXCLUDE_REASON[x.exclude_reason] || (x.last_error === 'manual_missing' ? '결과 파일에 없음' : x.exclude_reason || ''))}</td><td class="num">${x.gone_days ?? ''}일</td></tr>`).join('') || '<tr><td colspan="6" class="crm-none">불러오는 중…</td></tr>'}
            </tbody></table></div></section></div>`;
    },
    _cpHistoryView() {
        const s = this._cpState(), esc = v => this._vesc(v);
        const blocks = s.rules.map(r => {
            const res = s.results[r.id];
            if (!res) return `<section class="crm-list"><div class="crm-list-head"><b>${esc(r.name)}</b><span class="mu">불러오는 중…</span></div></section>`;
            if (res.error) return `<section class="crm-list"><div class="crm-empty bad">${esc(res.error)}</div></section>`;
            const v = effectVerdict(res);
            const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
            return `<section class="crm-list"><div class="crm-list-head"><div><b>${esc(r.name)}</b><span>${esc(v.label)} · 확정 회차 ${v.rounds}개 (4회 이상부터 판단)</span></div></div>
              <div class="crm-table-wrap"><table class="crm-table"><thead><tr><th>회차</th><th>상태</th><th>발급 확인</th><th>복귀(발송군)</th><th>대조군</th><th>복귀(대조군)</th><th>기간</th></tr></thead><tbody>
              ${res.map(x => `<tr><td>${fmtKST(x.scheduled_for, true)}</td><td>${RUN_STATUS[x.status] || x.status}</td><td class="num">${x.issued_n}</td><td class="num">${x.treat_returned} · ${pct(x.treat_returned, x.issued_n)}</td><td class="num">${x.control_n}</td><td class="num">${x.control_returned} · ${pct(x.control_returned, x.control_n)}</td><td class="num">${x.window_days}일</td></tr>`).join('') || '<tr><td colspan="7" class="crm-none">회차 없음</td></tr>'}
              </tbody></table></div></section>`;
        }).join('');
        return blocks || '<div class="crm-empty">규칙이 없습니다</div>';
    },
};

//  화면 검수(dev-preview=coupon) 전용 가짜 supabase — 메모리 안에서 상태만 바꾼다. 운영 빌드에서는 부르지 않는다.
export function couponPreviewSupabase(brandId) {
    const now = Date.now(), iso = ms => new Date(ms).toISOString();
    const rule = { id: 'r1', brand_id: brandId, name: '휴면90 매주 월', status: 'active', priority: 100, version: 2,
        target: { preset: 'dormant90' }, coupon: { cafe24_coupon_no: '9001', memo: '15% · 최대 1만원', max_discount: 10000, valid_days: 7 },
        schedule: { freq: 'weekly', weekday: 1, time_kst: '10:00' }, control_pct: 10, cooldown_days: 90, max_targets: 500 };
    rule.next_run_at = iso(nextRunAt(rule.schedule, new Date(now)));
    const names = ['김*지', '이*윤', '박*우', '정*린', '최*윤', '윤*봄'];
    const members = names.map((n, i) => ({ member_id: `member_10${i}${i}`, name_masked: n, last_date: '2026-07-20', gone_days: 100 + i, orders: 1 + (i % 2), spend: 59000,
        arm: i === 5 ? 'control' : 'treat', status: i === 5 ? 'control' : i === 4 ? 'excluded' : 'pending', exclude_reason: i === 4 ? 'open_cs' : null, issued_at: null, last_error: null }));
    const run = { id: 'run1', rule_id: 'r1', rule_snapshot: rule, scheduled_for: iso(now - 3600e3), as_of_date: new Date(now).toISOString().slice(0, 10),
        status: 'awaiting_approval', matched_n: 6, target_n: 4, control_n: 1, excluded_n: 1, exclude_counts: { open_cs: 1 } };
    const db = { coupon_rules: [rule], coupon_runs: [run], coupon_run_members: members };
    const query = table => { let rows = db[table] || [], q;
        return (q = { select: () => q, order: () => q, eq: (k, v) => { rows = rows.filter(r => k === 'run_id' ? true : r[k] === v); return q; }, in: (k, v) => { rows = rows.filter(r => v.includes(r[k])); return q; },
            then: (ok, ng) => Promise.resolve({ data: clone(rows), error: null }).then(ok, ng) }); };
    const fail = m => ({ data: null, error: { message: m } });
    const rpcs = {
        coupon_preview: () => ({ data: { as_of: run.as_of_date, matched: 6, treat: 4, control: 1, excluded: 1, reasons: { open_cs: 1 }, max_exposure: 40000, over_limit: false,
            sample: members.slice(0, 4).map(m => ({ name: m.name_masked, id_tail: m.member_id.slice(-3), gone_days: m.gone_days, orders: m.orders })) }, error: null }),
        coupon_rule_save: ({ p }) => { const r = { ...clone(p), id: p.id || `r${db.coupon_rules.length + 1}`, status: p.id ? db.coupon_rules.find(x => x.id === p.id).status : 'draft' };
            db.coupon_rules = [...db.coupon_rules.filter(x => x.id !== r.id), r]; return { data: r.id, error: null }; },
        coupon_rule_set_status: ({ p_rule, p_status }) => { const r = db.coupon_rules.find(x => x.id === p_rule); r.status = p_status; r.next_run_at = p_status === 'active' ? iso(nextRunAt(r.schedule, new Date())) : null; return { data: r.next_run_at, error: null }; },
        coupon_run_approve: ({ p_confirm_n }) => { if (run.status !== 'awaiting_approval') return fail('승인 대기 회차가 아닙니다');
            if (p_confirm_n !== run.target_n) return fail(`인원 숫자가 다릅니다(회차 ${run.target_n}명)`); run.status = 'approved_for_export'; return { data: run.status, error: null }; },
        coupon_run_reject: ({ p_reason }) => (String(p_reason || '').trim() ? (run.status = 'rejected', { data: 'rejected', error: null }) : fail('거절 사유를 적어 주세요')),
        coupon_run_cancel: ({ p_reason }) => (String(p_reason || '').trim() ? (run.status = 'cancelled', { data: 'cancelled', error: null }) : fail('중지 사유를 적어 주세요')),
        coupon_run_export: () => { run.status = 'exported'; run.exported_at = iso(Date.now()); return { data: members.filter(m => m.status === 'pending').map(m => ({ member_id: m.member_id })), error: null }; },
        coupon_run_confirm_manual: ({ p_owner, p_uploaded_at, p_reported_n, p_evidence_path, p_member_ids }) => {
            if (!['exported', 'export_expired'].includes(run.status)) return fail('CSV를 받은 회차만 확인할 수 있습니다');
            if (!p_member_ids && p_reported_n !== run.target_n) return fail(`카페24 발급 인원이 CSV 인원(${run.target_n})과 다릅니다`);
            let issued = 0, failed = 0;
            for (const m of members) {
                if (m.status === 'pending') { const ok = !p_member_ids || p_member_ids.includes(m.member_id);
                    Object.assign(m, ok ? { status: 'issued', issued_at: p_uploaded_at } : { status: 'failed', last_error: 'manual_missing' }); ok ? issued++ : failed++; }
                if (m.status === 'control') Object.assign(m, { status: 'control_counted', issued_at: p_uploaded_at });
            }
            Object.assign(run, { status: failed ? 'partial' : 'done', manual_owner: p_owner, manual_uploaded_at: p_uploaded_at, manual_reported_n: p_reported_n, manual_evidence_path: p_evidence_path, manual_confirmed_at: iso(Date.now()) });
            return { data: { status: run.status, issued, failed }, error: null };
        },
        coupon_run_results: () => ({ data: run.manual_confirmed_at ? [{ run_id: run.id, scheduled_for: run.scheduled_for, status: run.status, treat_n: 4, issued_n: members.filter(m => m.status === 'issued').length, control_n: 1, treat_returned: 1, control_returned: 0, window_days: 14 }] : [], error: null }),
    };
    return {
        from: query,
        rpc: async (name, args) => (rpcs[name] ? rpcs[name](args || {}) : fail(`미리보기에 없는 함수 ${name}`)),
        storage: { from: () => ({ upload: async path => ({ data: { path }, error: null }) }) },
        _db: db,
    };
}
