import { mockData, STAGES } from './mockData.js';
import {
    defaultSampleConfig, configForType, renderSampleMaker,
    garmentPreviewSVG, garmentFlatSVG, garmentPatternSVG, techPackSummaryHTML, buildTechPackPrintHTML,
    newPlacement, newCutline, newPoint, techPackChecklistItems,
} from './sampleMaker.js';

// 빌드 시각 — 어느 판을 보고 있는지 화면에서 바로 알 수 있게 (vite 가 넣어준다)
const __BUILD__ = (typeof __BUILD_TIME__ !== 'undefined') ? __BUILD_TIME__ : '개발';

// Supabase 설정 (사용자 정보 입력 필요)
const SUPABASE_URL = 'https://czaykmmwzlcisozmbxpl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JfMXgnspGcTtJKncR-l4gQ_XXzopFMk';
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// 운영 기준 시간대는 한국(Asia/Seoul). UTC의 월말/월초 경계 때문에
// 8월 1일 새벽이 7월로 보이지 않도록 모든 화면 기준일을 여기서 만든다.
const KST_DATE = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
});
const kstYMD = (value = new Date()) => {
    const p = Object.fromEntries(KST_DATE.formatToParts(new Date(value)).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
};
const kstYM = (value = new Date()) => kstYMD(value).slice(0, 7);

class BhasApp {
    constructor() {
        this.currentUser = null;
        this.appContainer = document.getElementById('app');
        try { this.docCats = JSON.parse(localStorage.getItem('bhas_doccats') || '[]'); } catch (_e) { this.docCats = []; }
        if (localStorage.getItem('bhas_theme') !== 'dark') document.body.classList.add('light'); // 기본 라이트(토스st)
        this.currentView = 'login'; // 'login', 'dashboard', 'detail'
        this.activeProjectId = null;
        this.selectedDocCategory = '전체';
        this.selectedCompanyId = 'all'; 
        this.completedExpanded = false;
        this.currentTodoFilter = 'all'; // all, my, requested
        this.sampleConfig = defaultSampleConfig(); // 샘플 제작 도구 상태
        // 맥 모드(데스크톱·창·독) — 켜둔 상태를 기억한다
        this.macMode = true;   // 화면은 맥 모드 하나로 통일했다(기본 화면 폐지)
        this.wins = [];
        this._macZ = 10;
        
        // 렌더링 최적화용 변수
        this._renderTimeout = null;
        this._isInitialLoading = true;
        
        // 타임라인 관련 상태
        
        window.app = this; // 전역 참조 추가 (타임라인 등에서 필요)
        // 로컬에서 화면을 확인할 때만 데이터에 손댈 수 있게 열어둔다(배포본에선 안 열린다)
        if (['localhost', '127.0.0.1'].includes(location.hostname)) window.mockData = mockData;
        this.supabase = supabase;
        
        this.products = [];
        this.companies = [];
        this.scheduledExpanded = true;
        this.dashboardViewType = 'grid';
        this.brandClosedExpanded = false;
        
        try {
            this.init();
            // 옛 화면을 붙들고 있는지 — 켤 때 한 번, 그 뒤 30분마다
            setTimeout(() => this.checkNewBuild(), 4000);
            setInterval(() => this.checkNewBuild(), 3 * 60 * 1000);
            //  다른 일 하다 돌아왔을 때 바로 알려준다
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) this.checkNewBuild();
            });
            window.addEventListener('focus', () => {
                if (Date.now() - (this._lastBuildCheck || 0) < 5 * 60 * 1000) return;
                this._lastBuildCheck = Date.now(); this.checkNewBuild();
            });
            window.onerror = (msg, url, lineNo, columnNo, error) => {
                this.showToast('시스템 오류가 발생했습니다. 담당자에게 문의하세요.');
                return false;
            };
        } catch (e) { /* init error */ }
    }

    // 저장해둔 로그인 정보로 들어왔을 때 진짜 Supabase 세션이 살아 있는지 확인한다.
    //  없으면 데이터가 하나도 안 보이므로, 조용히 두지 말고 다시 로그인하게 한다.
    async _verifyAuth(mid) {
        try {
            const { data } = await this.supabase.auth.getSession();
            if (data && data.session) {
                this._authOk = true;
                document.getElementById('auth-bar')?.remove();
                return true;
            }
        } catch (_e) { /* 아래로 */ }
        this._authOk = false;
        if (mid) this._showAuthBar();   // 일하는 중이면 쓰던 걸 날리지 않게 띠만 띄운다
        else this.forceLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.');
        return false;
    }
    // 저장이 안 되는 상태로 화면만 띄워두지 않는다 — 곧장 로그인으로 보낸다
    forceLogin(msg) {
        this._loginNotice = msg || '다시 로그인해 주세요.';
        localStorage.removeItem('bhas_session_user');
        localStorage.removeItem('bhas_auto_login');
        document.querySelectorAll('#auth-bar, .sticky, #calc-pop, #noti-center, #launcher, #sticky-list, #ctx-menu')
            .forEach(el => el.remove());
        this.wins = []; this._stickiesRestored = false;
        this.currentUser = null; this.currentView = 'login'; this._isInitialLoading = false;
        this.render();
    }
    // 세션을 계속 지켜본다 — 로그아웃·토큰 갱신 신호 + 창으로 돌아올 때 + 10분마다
    _watchAuth() {
        if (this._authWatching) return;
        this._authWatching = true;
        try {
            this.supabase.auth.onAuthStateChange((event) => {
                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                    this._authOk = true; document.getElementById('auth-bar')?.remove(); return;
                }
                if (event === 'SIGNED_OUT' && this.currentUser) { this._authOk = false; this._showAuthBar(); }
            });
        } catch (_e) { /* 안 되면 아래 주기 확인만으로 */ }
        setInterval(() => { if (this.currentUser) this._verifyAuth(true); }, 10 * 60 * 1000);
        window.addEventListener('focus', () => {
            if (!this.currentUser) return;
            if (Date.now() - (this._lastAuthCheck || 0) < 60 * 1000) return;
            this._lastAuthCheck = Date.now(); this._verifyAuth(true);
        });
    }
    _showAuthBar() {
        if (document.getElementById('auth-bar')) return;
        const el = document.createElement('div');
        el.id = 'auth-bar'; el.className = 'authbar';
        el.innerHTML = `<i class="ph ph-warning-circle"></i>
            <span>로그인이 풀렸습니다 — 데이터가 안 보이고 저장도 안 됩니다.
                아래 단추로 <b>이 대시보드에</b> 아이디·비번을 다시 넣어주세요.</span>
            <button onclick="app.forceLogin('로그인이 만료되었습니다. 다시 로그인해 주세요.')">지금 로그인</button>`;
        document.body.appendChild(el);
    }
    // 저장 실패가 '로그인 풀림' 때문인지 가려낸다 — 그렇다면 조용히 두지 않는다
    showToast(message) {
        if (/JWT|not authenticated|expired|PGRST301|401/i.test(String(message))) this._showAuthBar();
        // 전역 중복 알림 방지: 동일 메시지가 화면에 활성 상태이면 무시
        if (!window.__BHAS_ACTIVE_TOASTS__) window.__BHAS_ACTIVE_TOASTS__ = new Set();
        const cleanMsg = String(message).trim();
        if (window.__BHAS_ACTIVE_TOASTS__.has(cleanMsg)) return;
        window.__BHAS_ACTIVE_TOASTS__.add(cleanMsg);

        const container = document.getElementById('toast-container');
        if (!container) { window.__BHAS_ACTIVE_TOASTS__.delete(cleanMsg); return; }
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<i class="ph ph-bell-ringing" style="font-size: 1.2rem; color: var(--primary);"></i> <span>${message}</span>`;
        container.appendChild(toast);

        // Trigger reflow
        toast.offsetHeight;
        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => { toast.remove(); window.__BHAS_ACTIVE_TOASTS__.delete(cleanMsg); }, 300);
        }, 3000);
    }

    init() {
        // ===== [임시] 샘플 제작 미리보기용 인증 우회 (Supabase 일시중단 중) =====
        // 원복: 아래 DEV_PREVIEW_SAMPLE = false 로만 바꾸면 됨.
        // Supabase 재가동 완료 → 실제 로그인/데이터 로드 사용(false).
        const DEV_PREVIEW_SAMPLE = false;
        if (DEV_PREVIEW_SAMPLE) {
            this.currentUser = { id: 'dev', name: '미리보기', role: 'MASTER', company_id: 'dev' };
            this.currentView = 'sample_maker';
            this._isInitialLoading = false;
            this.syncStagesData();
            this.requestRender();
            return;
        }
        // ====================================================================
        try {
            // 모든 모달 초기화 (숨김)
            const globalModal = document.getElementById('global-modal-container');
            if (globalModal) globalModal.style.display = 'none';
            const localModal = document.getElementById('modal-container');
            if (localModal) localModal.style.display = 'none';

            // 자동 로그인 로직 확인
            const autoLogin = localStorage.getItem('bhas_auto_login') === 'true';
            const savedSession = localStorage.getItem('bhas_session_user');
            if (autoLogin && savedSession) {
                try {
                    const parsed = JSON.parse(savedSession);
                    if (parsed && parsed.role && parsed.name) {
                        this.currentUser = parsed;
                        this.currentView = 'home';
                        // ★ 여기서 Supabase 세션을 확인하지 않으면, 화면은 로그인한 것처럼 보이는데
                        //   RLS 가 전부 막아 데이터가 0 으로 뜨고 새로 만드는 것도 안 된다.
                        //   (다른 컴퓨터·토큰 만료 때 이런 일이 난다)
                        this._verifyAuth();
                        this._watchAuth();
                    } else {
                        throw new Error('Invalid session data');
                    }
                } catch(e) {
                    // 세션 파싱 실패 - 재로그인 유도
                    this.currentUser = null;
                    localStorage.removeItem('bhas_session_user');
                    localStorage.removeItem('bhas_auto_login');
                }
            } else {
                // 자동 로그인이 아니면 로그인 화면 (signOut 호출하지 않음 - 로그인 세션 보호)
                this.currentUser = null;
                this.currentView = 'login';
                localStorage.removeItem('bhas_session_user');
            }

            this.syncStagesData();

            if (this.currentUser) {
                // 자동 로그인: 로딩 화면 표시 후 데이터 로드 완료 시 대시보드 렌더
                this._isInitialLoading = true;
                this.requestRender();
                this.loadInitialData().then(() => {
                    this._isInitialLoading = false;
                    this.requestRender();
                }).catch(err => {
                    // 데이터 로드 실패
                    this._isInitialLoading = false;
                    this.requestRender();
                });
            } else {
                this._isInitialLoading = false;
                this.requestRender();
            }
        } catch (e) {
            // 초기화 실패
            this.currentView = 'login';
            this.requestRender();
        }
    }

    // 날짜 유틸리티: UI용 (YY.MM.DD)
    formatDateToUI(dateStr) {
        if (!dateStr) return '일정 미정';
        const cleanDate = dateStr.replace(/[^0-9.-]/g, ''); // 숫자, 점, 하이픈 외 제거
        const parts = cleanDate.includes('.') ? cleanDate.split('.') : cleanDate.split('-');
        if (parts.length === 3) {
            const yy = parts[0].length === 2 ? '20' + parts[0] : parts[0];
            const mm = parts[1].padStart(2, '0');
            const dd = parts[2].padStart(2, '0');
            return `${yy}.${mm}.${dd}`;
        }
        return dateStr;
    }

    // 날짜 유틸리티: DB용 (YYYY-MM-DD)
    formatDateToDB(dateStr) {
        if (!dateStr) return null;
        const cleanDate = dateStr.replace(/\./g, '-');
        const parts = cleanDate.split('-');
        if (parts.length === 3) {
            const yyyy = parts[0].length === 2 ? '20' + parts[0] : parts[0];
            const mm = parts[1].padStart(2, '0');
            const dd = parts[2].padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
        return cleanDate;
    }

    // ===================================================================
    // 강화 기능 공용 헬퍼 (읽기 전용 계산 — DB 쓰기/스키마 변경 없음)
    // 타임라인 / 마감·멘션 알림 / 통합 검색 / KPI 위젯이 공유한다.
    // ===================================================================

    // 날짜 문자열 → Date 객체 (자정 기준)
    _parseDate(dateStr) {
        const db = this.formatDateToDB(dateStr); // YYYY-MM-DD
        if (!db) return null;
        const parts = db.split('-');
        if (parts.length !== 3) return null;
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return isNaN(d.getTime()) ? null : d;
    }

    // 오늘 기준 남은 일수 (음수=지연). null이면 날짜 없음
    _daysUntil(dateStr) {
        const d = this._parseDate(dateStr);
        if (!d) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        d.setHours(0, 0, 0, 0);
        return Math.round((d - today) / 86400000);
    }

    // 마감 상태 메타: overdue(지연) / soon(3일내) / normal / none
    _deadlineMeta(dateStr) {
        const days = this._daysUntil(dateStr);
        if (days === null) return { level: 'none', days: null, label: '' };
        if (days < 0) return { level: 'overdue', days, label: `${Math.abs(days)}일 지연` };
        if (days === 0) return { level: 'soon', days, label: '오늘 마감' };
        if (days <= 3) return { level: 'soon', days, label: `D-${days}` };
        return { level: 'normal', days, label: `D-${days}` };
    }

    // 시즌 진행률(%) — renderSubView의 isStageCompleted 로직과 동일
    computeProgress(p) {
        const sd = p.stages_data || {};
        const done = STAGES.filter(s => {
            if (sd[s.id] && sd[s.id].status === 'completed') return true;
            if (sd[s.docType] && sd[s.docType].status === 'completed') return true;
            if (p.documents && p.documents.some(d => d.type === s.docType || d.type === s.id)) return true;
            return false;
        }).length;
        return Math.round((done / STAGES.length) * 100);
    }

    // 현재 사용자 식별자 (todo.assignee / created_by 와 매칭)
    _myId() {
        return this.currentUser ? (this.currentUser.company_id || this.currentUser.id) : null;
    }

    // 시즌별 브랜드명
    _brandName(p) {
        const brand = (mockData.brands || []).find(b => b.id === p.brand_id);
        const company = (mockData.companies || []).find(c => c.id === p.company_id);
        return brand ? brand.name : (company ? company.name : '');
    }

    // 권한 반영된 가시 시즌 목록 (CLIENT는 본인 회사만)
    _visibleProducts() {
        const list = mockData.products || [];
        if (this.currentUser && this.currentUser.role === 'CLIENT') {
            return list.filter(p => p.company_id === this.currentUser.company_id);
        }
        return list;
    }

    // 컨텍스트가 붙은 전체 todo 목록
    getAllTodosWithContext() {
        return this._visibleProducts().flatMap(p => (p.todos || []).map(t => ({
            ...t,
            projectName: p.name,
            product_id: p.id,
            brand_id: p.brand_id,
            company_id: p.company_id,
            brandName: this._brandName(p)
        })));
    }

    // 나에게 배정된 미완료 할일 중 임박/지연 건
    getDeadlineAlerts() {
        const myId = this._myId();
        return this.getAllTodosWithContext()
            .filter(t => !t.completed && t.assignee === myId && t.due_date)
            .map(t => ({ ...t, meta: this._deadlineMeta(t.due_date) }))
            .filter(t => t.meta.level === 'overdue' || t.meta.level === 'soon')
            .sort((a, b) => (a.meta.days ?? 999) - (b.meta.days ?? 999));
    }

    // 나를 @멘션한 항목 (todo 본문 + memo 본문 스캔)
    getMyMentions() {
        const myName = this.currentUser ? this.currentUser.name : '';
        if (!myName) return [];
        const token = '@' + myName;
        const myId = this._myId();
        const results = [];
        this._visibleProducts().forEach(p => {
            (p.todos || []).forEach(t => {
                if (t.text && t.text.includes(token) && t.assignee !== myId) {
                    results.push({ type: 'todo', text: t.text, projectName: p.name, product_id: p.id, id: t.id, due_date: t.due_date });
                }
            });
            (p.memos || []).forEach(m => {
                if (m.text && m.text.includes(token)) {
                    results.push({ type: 'memo', text: m.text, projectName: p.name, product_id: p.id, id: m.id });
                }
            });
        });
        return results;
    }

    // 대시보드 KPI 집계
    getDashboardKPIs(products) {
        const list = products || [];
        const active = list.filter(p => (p.currentStage || 'consulting') !== 'shipping');
        const avgProgress = active.length
            ? Math.round(active.reduce((s, p) => s + this.computeProgress(p), 0) / active.length)
            : 0;
        const delayed = active.filter(p => {
            const days = this._daysUntil(p.deadline);
            return days !== null && days < 0;
        }).length;
        const dueThisWeek = active.filter(p => {
            const days = this._daysUntil(p.deadline);
            return days !== null && days >= 0 && days <= 7;
        }).length;
        const openTodos = list.flatMap(p => p.todos || []).filter(t => !t.completed).length;
        return { activeCount: active.length, avgProgress, delayed, dueThisWeek, openTodos };
    }

    // 통합 검색 — 시즌/할일/문서/메모/브랜드 가로질러 매칭
    runGlobalSearch(query) {
        const q = (query || '').trim().toLowerCase();
        if (!q) return [];
        const results = [];
        this._visibleProducts().forEach(p => {
            const bName = this._brandName(p);
            if ((p.name || '').toLowerCase().includes(q) || (bName || '').toLowerCase().includes(q)) {
                results.push({ kind: '시즌', icon: 'ph-folder', title: p.name, sub: bName, product_id: p.id });
            }
            (p.todos || []).forEach(t => {
                if ((t.text || '').toLowerCase().includes(q)) {
                    results.push({ kind: '할일', icon: 'ph-check-square', title: t.text, sub: `${bName} · ${p.name}`, product_id: p.id, done: t.completed });
                }
            });
            (p.documents || []).forEach(d => {
                if ((d.name || '').toLowerCase().includes(q)) {
                    results.push({ kind: '문서', icon: 'ph-file', title: d.name, sub: `${bName} · ${p.name}`, product_id: p.id });
                }
            });
            (p.memos || []).forEach(m => {
                if ((m.text || '').toLowerCase().includes(q)) {
                    results.push({ kind: '메모', icon: 'ph-note', title: m.text, sub: `${bName} · ${p.name}`, product_id: p.id });
                }
            });
        });
        return results.slice(0, 40);
    }

    // 렌더링 최적화: 디바운싱 적용
    requestRender() {
        if (this._renderTimeout) clearTimeout(this._renderTimeout);
        this._renderTimeout = setTimeout(() => {
            this.render();
        }, 30); // 30ms 내 중복 호출 방지
    }

    showFileModal(url, name = '파일 미리보기') {
        const container = document.getElementById('global-modal-container');
        if (!container) return;

        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url) || url.includes('photos/');
        
        container.innerHTML = `
            <div class="glass modal-content fade-in" style="width: 90%; max-width: 1000px; padding: 2rem; border-radius: 24px; position: relative; max-height: 90vh; display: flex; flex-direction: column;">
                <button onclick="document.getElementById('global-modal-container').style.display='none'" style="position: absolute; top: 1.5rem; right: 1.5rem; background: rgba(var(--tint),0.1); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 100;"><i class="ph ph-x"></i></button>
                <h2 style="margin-bottom: 1.5rem; font-size: 1.2rem; display: flex; align-items: center; gap: 10px;">
                    <i class="${isImage ? 'ph ph-image' : 'ph ph-file-text'}"></i> ${name}
                </h2>
                <div style="flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.2); border-radius: 12px; padding: 10px;">
                    ${isImage ? `
                        <img src="${url}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 8px;">
                    ` : `
                        <iframe src="${url}" style="width: 100%; height: 70vh; border: none; border-radius: 8px; background: white;"></iframe>
                    `}
                </div>
                <div style="margin-top: 1.5rem; display: flex; justify-content: flex-end; gap: 10px;">
                    <a href="${url}" download="${name}" class="btn-primary" style="text-decoration: none; padding: 10px 20px; border-radius: 10px; display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-download-simple"></i> 다운로드
                    </a>
                    <button onclick="document.getElementById('global-modal-container').style.display='none'" class="btn-secondary" style="padding: 10px 20px; border-radius: 10px;">닫기</button>
                </div>
            </div>
        `;
        container.style.display = 'flex';
    }

    //  가운데 뜨는 입력 창 — 브라우저 기본 prompt 는 창 밖(주소창 아래)에 떠서 쓰기 불편하다
    showPrompt(message, value = '', title = '입력') {
        return new Promise((resolve) => {
            const c = document.getElementById('global-modal-container');
            const esc = x => this._vesc(x == null ? '' : String(x));
            const multi = String(message).includes('\n');
            c.innerHTML = `<div class="modal-content vmodal pr" style="width:94%;max-width:400px">
                <div class="hk-top"><b>${esc(title)}</b>
                    <button class="fi-x" id="pr-x">×</button></div>
                <div class="pr-msg">${esc(message).replace(/\n/g, '<br>')}</div>
                ${multi ? `<textarea id="pr-in" class="nw-f" rows="3"></textarea>`
                        : `<input id="pr-in" class="nw-f" type="text">`}
                <div class="fi-act">
                    <button class="mbtn" id="pr-no">취소</button>
                    <button class="mbtn pri" id="pr-ok">확인</button>
                </div>
            </div>`;
            c.style.display = 'flex';
            const el = c.querySelector('#pr-in');
            el.value = value == null ? '' : String(value);
            const done = (v) => { c.style.display = 'none'; c.innerHTML = ''; resolve(v); };
            c.querySelector('#pr-ok').onclick = () => done(el.value);
            c.querySelector('#pr-no').onclick = () => done(null);
            c.querySelector('#pr-x').onclick = () => done(null);
            c.onclick = (e) => { if (e.target === c) done(null); };
            el.onkeydown = (e) => {
                if (e.key === 'Enter' && !multi) { e.preventDefault(); done(el.value); }
                if (e.key === 'Escape') { e.preventDefault(); done(null); }
            };
            setTimeout(() => { el.focus(); el.select?.(); }, 40);
        });
    }

    showConfirm(message, title = '확인 알림') {
        return new Promise((resolve) => {
            const container = document.getElementById('global-modal-container');
            container.innerHTML = `
                <div class="glass confirm-modal-content" onclick="event.stopPropagation()">
                    <div class="confirm-modal-icon"><i class="ph ph-warning-circle"></i></div>
                    <div class="confirm-modal-title">${title}</div>
                    <div class="confirm-modal-message">${message.replace(/\n/g, '<br>')}</div>
                    <div class="confirm-modal-buttons">
                        <button class="confirm-modal-btn confirm-modal-cancel" id="confirm-cancel">취소</button>
                        <button class="confirm-modal-btn confirm-modal-delete" id="confirm-ok" style="${title.includes('삭제') ? '' : 'background: var(--primary); box-shadow: 0 4px 12px rgba(37,99,235,0.3);'}">${title.includes('삭제') ? '삭제' : '확인'}</button>
                    </div>
                </div>
            `;
            container.style.display = 'flex';
            
            const btnCancel = document.getElementById('confirm-cancel');
            const btnOk = document.getElementById('confirm-ok');

            btnCancel.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                container.style.display = 'none';
                resolve(false);
            };
            btnOk.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                container.style.display = 'none';
                resolve(true);
            };
            
            container.onclick = (e) => {
                if (e.target === container) {
                    e.preventDefault();
                    e.stopPropagation();
                    container.style.display = 'none';
                    resolve(false);
                }
            };
        });
    }

    async handleDelete(e, type, id, parentId) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        // 권한 체크: 관리자 전용 삭제 항목
        if ((type === 'user' || type === 'brand') && this.currentUser?.role === 'CLIENT') {
            this.showToast('권한이 없습니다.');
            return;
        }

        // CLIENT: 본인 생성 항목만 삭제 가능
        if (this.currentUser?.role === 'CLIENT') {
            let item = null;
            if (type === 'project') item = mockData.products.find(p => p.id === String(id));
            else if (type === 'todo') item = mockData.products.flatMap(p => p.todos || []).find(t => t.id === id);
            else if (type === 'document') item = mockData.products.flatMap(p => p.documents || []).find(d => d.id === id);
            else if (type === 'memo') item = mockData.products.flatMap(p => p.memos || []).find(m => m.id === id);
            else if (type === 'photo') item = mockData.products.flatMap(p => p.photos || []).find(ph => ph.id === id || ph.url === id);

            if (item && item.created_by !== this.currentUser.id) {
                this.showToast('본인이 생성한 항목만 삭제할 수 있습니다.');
                return;
            }
        }

        let confirmMsg = '정말로 삭제하시겠습니까?\n(이 작업은 복구할 수 없습니다.)';
        if (type === 'project') {
            const project = mockData.products.find(p => p.id === String(id));
            const hasPhotos = project?.photos && project.photos.length > 0;
            const hasDocs = project?.documents && project.documents.length > 0;
            const hasMemos = project?.memos && project.memos.length > 0;

            if (hasPhotos || hasDocs || hasMemos) {
                confirmMsg = `[주의] 이 시즌에는 업로드된 사진, 문서 또는 메모가 포함되어 있습니다.\n삭제 시 연동된 모든 데이터가 함께 영구히 삭제됩니다.\n\n정말 삭제하시겠습니까?`;
            }
        }
        if (type === 'brand') {
            const brand = mockData.brands.find(b => b.id === id);
            const brandProjects = mockData.products.filter(p => p.brand_id === id);
            const brandUsers = mockData.companies.filter(c => c.brand_id === id);
            confirmMsg = `[경고] 브랜드 "${brand?.name || ''}" 삭제 시 다음 데이터가 모두 영구 삭제됩니다:\n\n` +
                `  - 소속 시즌: ${brandProjects.length}개 (사진, 문서, 메모 포함)\n` +
                `  - 소속 계정: ${brandUsers.length}개\n\n` +
                `이 작업은 절대 복구할 수 없습니다.\n정말 삭제하시겠습니까?`;
        }

        if (!await this.showConfirm(confirmMsg, '삭제 확인')) return;

        try {
            let table = '';
            if (type === 'project') table = 'products';
            else if (type === 'todo') table = 'todos';
            else if (type === 'document') table = 'documents';
            else if (type === 'memo') table = 'memos';
            else if (type === 'photo') table = 'photos';
            else if (type === 'user') table = 'companies';
            else if (type === 'brand') table = 'brands';

            if (table) {
                // 유저 삭제 시 Auth 계정도 삭제
                if (type === 'user') {
                    const user = mockData.companies.find(c => c.id === id);
                    if (user?.username) {
                        const email = user.username.includes('@') ? user.username : `${user.username}@bhas.com`;
                        await this.supabase.rpc('delete_auth_user_by_email', { user_email: email });
                    }
                }

                // 브랜드 삭제: DB 서버에서 연쇄 삭제 (RLS 우회)
                if (type === 'brand') {
                    const { error: rpcErr } = await this.supabase.rpc('delete_brand_cascade', { brand_uuid: id });
                    if (rpcErr) {
                        this.showToast(`브랜드 삭제 실패: ${rpcErr.message}`);
                        return;
                    }
                    this.showToast('브랜드와 소속 데이터가 모두 삭제되었습니다.');
                    await this.loadInitialData();
                    this.requestRender();
                    return;
                }

                // 시즌 삭제: DB 서버에서 연쇄 삭제 (RLS 우회)
                if (type === 'project') {
                    const { error: rpcErr } = await this.supabase.rpc('delete_project_cascade', { project_uuid: id });
                    if (rpcErr) {
                        this.showToast(`시즌 삭제 실패: ${rpcErr.message}`);
                        return;
                    }
                    this.showToast('시즌이 삭제되었습니다.');
                    await this.loadInitialData();
                    if (this.activeProjectId === String(id)) {
                        this.setState({ currentView: 'dashboard', activeProjectId: null });
                    } else {
                        this.requestRender();
                    }
                    return;
                }

                let query = this.supabase.from(table).delete();

                // 사진 삭제의 경우 id가 URL일 수 있으므로 처리
                if (type === 'photo' && (typeof id === 'string' && (id.startsWith('http') || id.includes('photos/')))) {
                    query = query.eq('url', id);
                } else {
                    query = query.eq('id', id);
                }

                const { error } = await query;
                if (error) {
                    let userMsg = error.message || '권한이 없거나 서버 오류입니다.';
                    if (error.message && error.message.includes('foreign key')) {
                        userMsg = '연결된 데이터(시즌/계정 등)가 있어 삭제할 수 없습니다. 연결 데이터를 먼저 제거해주세요.';
                    }
                    this.showToast(`삭제 실패: ${userMsg}`);
                    return;
                }
                
                this.showToast('삭제되었습니다.');
                await this.loadInitialData();
                if (type === 'project' && this.activeProjectId === String(id)) {
                    this.setState({ currentView: 'dashboard', activeProjectId: null });
                } else {
                    this.requestRender();
                }
            }
        } catch (error) {
            this.showToast('삭제 중 오류가 발생했습니다.');
        }
    }

    syncStagesData() {
        // Supabase 데이터 구조(snake_case)를 기반으로 동기화
        mockData.products.forEach(product => {
            if (!product.stages_data) product.stages_data = {};

            // 1. history 기반 (완료된 공정)
            if (product.history) {
                product.history.forEach(h => {
                    const stageKey = h.stage_id || h.stage;
                    const stage = STAGES.find(s => s.id === stageKey);
                    const stageId = stage ? stage.id : stageKey;
                    if (stageId && !product.stages_data[stageId]) {
                        product.stages_data[stageId] = {
                            status: 'completed',
                            due_date: h.date,
                            note: '기록 기반 자동 동기화'
                        };
                    }
                });
            }

            // 2. schedules 기반 (예정 또는 진행 중인 공정)
            const relevantSchedules = (mockData.schedules || []).filter(s => s.product_id === product.id);
            relevantSchedules.forEach(s => {
                if (s.stage) {
                    // 이미 완료된 기록이 있다면 덮어쓰지 않음
                    if (!product.stages_data[s.stage] || product.stages_data[s.stage].status !== 'completed') {
                        product.stages_data[s.stage] = {
                            status: 'processing',
                            due_date: s.end || s.start,
                            note: s.title
                        };
                    }
                }
            });
        });
    }

    setState(newState) {
        const viewChanged = 'currentView' in newState && newState.currentView !== this.currentView;
        Object.assign(this, newState);
        // 화면이 바뀌는 setState도 뒤로가기 대상에 넣는다(switchView 안 타는 경로가 있음)
        if (viewChanged && this.currentView !== 'login') this._pushHistory();
        this.requestRender();
    }

    switchView(viewId) {
        // 맥 모드: 바탕화면(홈)의 블록을 누르면 그 화면이 창으로 열린다.
        if (this.macMode && this.currentUser) {
            if (viewId === 'home') { this.macShowDesktop(); return; }
            this.macOpen(viewId);
            return;
        }
        this.currentView = viewId;
        this._pushHistory();
        this.render();
    }
    // 바탕화면 보기 — 열린 창을 전부 내린다(독에 남는다)
    macShowDesktop() {
        (this.wins || []).forEach(w => { w.min = true; });
        this.requestRender();
    }

    // ── 브라우저 뒤로가기 연동 ──
    // 원래 history 연동이 아예 없어서 트랙패드/뒤로가기 제스처가 앱 화면이 아니라 사이트를 떠났음.
    // 화면 전환마다 pushState 하고, popstate 에서 그 상태로 복원한다(렌더만, 다시 push 안 함).
    _historyState() {
        return {
            bhas: true,
            view: this.currentView,
            salesViewBrand: this.salesViewBrand ?? null,
            salesViewYear: this.salesViewYear ?? null,
            salesViewMonth: this.salesViewMonth ?? null,
            activeProjectId: this.activeProjectId ?? null,
        };
    }
    _pushHistory() {
        if (this._restoringHistory) return;   // popstate 복원 중엔 새 항목을 쌓지 않음
        const st = this._historyState();
        const cur = history.state;
        // 같은 상태면 중복으로 쌓지 않음(같은 메뉴 연타 시 뒤로가기가 헛돌지 않게)
        if (cur && cur.bhas && JSON.stringify(cur) === JSON.stringify(st)) return;
        try { history.pushState(st, '', location.pathname + location.search); } catch (e) { /* 무시 */ }
    }
    _initHistory() {
        if (this._historyBound) return;
        this._historyBound = true;
        const url = location.pathname + location.search;
        try {
            // 바닥 항목(floor)을 하나 깔고 그 위에 현재 화면을 쌓는다.
            // → 어느 화면에서 뒤로가기를 하든 최소 한 번은 앱 안(홈)에 남고, 사이트를 통째로 떠나지 않는다.
            history.replaceState({ bhas: true, floor: true, view: 'home' }, '', url);
            history.pushState(this._historyState(), '', url);
        } catch (e) { /* 무시 */ }
        window.addEventListener('popstate', (e) => {
            const st = e.state;
            if (!st || !st.bhas) return;   // 우리 항목이 아니면 브라우저 기본 동작
            this._restoringHistory = true;
            if (st.floor) {
                // 바닥까지 왔다 = 더 돌아갈 앱 화면이 없음 → 홈만 보여주고 머문다(여기서 한 번 더 누르면 이탈).
                this.currentView = 'home';
                this.activeProjectId = null;
                this.render();
                this._restoringHistory = false;
                return;
            }
            this.currentView = st.view || 'home';
            this.salesViewBrand = st.salesViewBrand ?? 'ALL';
            this.salesViewYear = st.salesViewYear ?? undefined;
            this.salesViewMonth = st.salesViewMonth ?? undefined;
            this.activeProjectId = st.activeProjectId ?? null;
            this.render();
            this._restoringHistory = false;
        });
    }

    toggleTheme() {
        const isLight = document.body.classList.toggle('light');
        localStorage.setItem('bhas_theme', isLight ? 'light' : 'dark');
        this.requestRender();
    }
    
    toggleNotifications(e) {
        if(e) e.preventDefault();
        this.switchView('all_todos');
    }

    render() {
        if (this._isRendering) return;
        this._isRendering = true;
        if (this.currentUser) this._initHistory();   // 로그인 후 1회 — 뒤로가기 연동 시작

        try {
            this.appContainer.innerHTML = '';

            // 데이터 로딩 중이면 로딩 화면 표시
            if (this._isInitialLoading && this.currentUser) {
                this.appContainer.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; gap: 1.5rem;">
                        <div style="font-size: 2.5rem; font-weight: 900; color: var(--primary); letter-spacing: 3px;">2179</div>
                        <div style="width: 40px; height: 40px; border: 3px solid rgba(var(--tint),0.1); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                        <span style="color: var(--text-muted); font-size: 0.9rem;">데이터를 불러오는 중...</span>
                        <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
                    </div>
                `;
                return;
            }

            switch (this.currentView) {
                case 'login':
                    this.renderLogin();
                    break;
                default:
                    // currentUser가 없을 경우 상시 login으로 유도
                    if (!this.currentUser && this.currentView !== 'login') {
                        this.currentView = 'login';
                        this.renderLogin();
                    } else {
                        this.renderDashboard();
                    }
                    break;
            }
        } catch (e) {
            this.appContainer.innerHTML = `
                <div style="padding: 2rem; color: white;">
                    <h2 style="color: #ef4444;">오류가 발생했습니다</h2>
                    <p style="color: var(--text-muted);">페이지를 새로고침하거나 다시 로그인해주세요.</p>
                    <button onclick="app.setState({currentView:'login'})" style="margin-top:1rem; padding:8px 16px; background:var(--primary); color:white; border:none; border-radius:8px; cursor:pointer;">로그인으로 돌아가기</button>
                </div>
            `;
        } finally {
            this._isRendering = false;
        }
    }

    async loadInitialData() {
        try {
            // 시즌 데이터 로드
            let query = this.supabase
                .from('products')
                .select('*')
                .order('created_at', { ascending: false });

            // CLIENT 권한인 경우 본인 브랜드 데이터만 필터링
            if (this.currentUser && this.currentUser.role === 'CLIENT') {
                if (this.currentUser.brand_id) {
                    query = query.eq('brand_id', this.currentUser.brand_id);
                } else if (this.currentUser.company_id) {
                    query = query.eq('company_id', this.currentUser.company_id);
                }
            }

            const { data: products, error: pError } = await query;

            if (pError) throw pError;
            
            mockData.products = await Promise.all(products.map(async (p) => {
                const { data: todos } = await this.supabase.from('todos').select('*').eq('product_id', p.id);
                const { data: photos } = await this.supabase.from('photos').select('*').eq('product_id', p.id);
                const { data: documents } = await this.supabase.from('documents').select('*').eq('product_id', p.id);
                const { data: stageEntries } = await this.supabase.from('product_stages').select('*').eq('product_id', p.id);
                const { data: history } = await this.supabase.from('history').select('*').eq('product_id', p.id).order('created_at', { ascending: false });
                
                // memos 테이블이 없는 경우 (404)를 대비해 안전하게 처리
                const { data: memos, error: mError } = await this.supabase.from('memos').select('*').eq('product_id', p.id).order('created_at', { ascending: true });
                // memos 테이블 없으면 무시

                // product_stages 데이터를 UI 형식으로 변환
                const stagesData = {};
                (stageEntries || []).forEach(entry => {
                    stagesData[entry.stage_id] = {
                        status: entry.status,
                        due_date: entry.due_date,
                        note: entry.note
                    };
                });

                return {
                    ...p,
                    currentStage: 'consulting',
                    stages_data: stagesData,
                    todos: (todos || []).map(t => ({ ...t, assignee: t.assignee_id })),
                    photos: photos || [],
                    documents: documents || [],
                    memos: memos || [],
                    history: history || []
                };
            }));

            // 공통 데이터 로드
            let companyQuery = this.supabase.from('companies').select('*');
            if (this.currentUser && this.currentUser.role === 'CLIENT' && this.currentUser.brand_id) {
                companyQuery = companyQuery.eq('brand_id', this.currentUser.brand_id);
            }
            const { data: companies, error: cError } = await companyQuery;
            if (cError) throw cError;
            mockData.companies = companies;

            const { data: brands, error: bError } = await this.supabase.from('brands').select('*');
            if (bError) throw bError;
            mockData.brands = brands || [];

            let globalDocQuery = this.supabase.from('global_documents').select('*');
            if (this.currentUser && this.currentUser.role === 'CLIENT' && this.currentUser.brand_id) {
                globalDocQuery = globalDocQuery.eq('brand_id', this.currentUser.brand_id);
            }
            const { data: globalDocs } = await globalDocQuery;
            mockData.globalDocuments = globalDocs || [];

            this.syncStagesData();
        } catch (error) {
            // 데이터 로드 실패
            this.showToast('데이터를 불러오는 중 오류가 발생했습니다.');
        }
    }

    renderLogin() {
        const loginHtml = `
            <div class="login-container fade-in">
                <div class="glass login-card">
                    <h1>2179</h1>
                    <p style="color: var(--text-muted); margin-bottom: 2rem;">Production Management System</p>
                    
                    <form class="login-form" id="login-form">
                        <div class="input-group">
                            <label for="username">아이디</label>
                            <input type="text" id="username" class="login-input" placeholder="아이디 (예: bokyung)" autocapitalize="off" autocorrect="off" spellcheck="false" required>
                        </div>
                        <div class="input-group">
                            <label for="password">비밀번호</label>
                            <input type="password" id="password" class="login-input" placeholder="비밀번호를 입력하세요" required>
                        </div>
                        ${this._loginNotice ? `<div class="login-notice"><i class="ph ph-info"></i> ${this._vesc(this._loginNotice)}</div>` : ''}
                        <div id="login-error" class="login-error">이메일 또는 비밀번호가 올바르지 않습니다.</div>
                        <div style="display: flex; gap: 15px; margin-bottom: 1.5rem; font-size: 0.85rem; color: var(--text-muted);">
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                <input type="checkbox" id="save-id-chk" style="accent-color: var(--primary);"> 아이디 저장
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                                <input type="checkbox" id="auto-login-chk" style="accent-color: var(--primary);"> 자동 로그인
                            </label>
                        </div>
                        <button type="submit" class="login-submit-btn" id="login-btn">로그인</button>
                    </form>
                </div>
            </div>
        `;
        this.appContainer.innerHTML = loginHtml;

        const form = document.getElementById('login-form');
        const loginBtn = document.getElementById('login-btn');
        const errorMsg = document.getElementById('login-error');
        if (!form || !loginBtn || !errorMsg) return;

        // 저장된 아이디 및 자동 로그인 체크박스 상태 복원
        const saveIdChk = document.getElementById('save-id-chk');
        const autoLoginChk = document.getElementById('auto-login-chk');
        const idInput = document.getElementById('username');
        const savedId = localStorage.getItem('bhas_saved_id');
        
        if (savedId && idInput && saveIdChk) {
            idInput.value = savedId;
            saveIdChk.checked = true;
        }
        if (localStorage.getItem('bhas_auto_login') === 'true' && autoLoginChk) {
            autoLoginChk.checked = true;
        }

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            let identifier = document.getElementById('username').value.trim();
            const password = document.getElementById('password').value.trim();
            const saveIdChecked = document.getElementById('save-id-chk')?.checked;
            const autoLoginChecked = document.getElementById('auto-login-chk')?.checked;

            //  아이디만 쳐도 로그인되게 — 뒤에 붙는 주소는 우리가 찾는다.
            //  계정마다 주소가 달라서(@bhas.com · gmail) 순서대로 해 본다.
            const LOGIN_DOMAINS = ['bhas.com', 'gmail.com'];
            const candidates = identifier.includes('@')
                ? [identifier]
                : LOGIN_DOMAINS.map(d => `${identifier}@${d}`);

            loginBtn.disabled = true;
            loginBtn.innerText = '로그인 중...';
            errorMsg.style.display = 'none';

            try {
                // 1. Supabase Auth 우선 시도 — 주소 후보를 차례로
                let authData = null, authError = null, email = candidates[0];
                for (const cand of candidates) {
                    const r = await this.supabase.auth.signInWithPassword({ email: cand, password });
                    if (!r.error && r.data && r.data.user) { authData = r.data; authError = null; email = cand; break; }
                    authError = r.error;
                    //  비밀번호가 틀린 게 아니라 '그 주소가 없는' 경우에만 다음 후보로 넘어간다
                    if (!/invalid login credentials/i.test(r.error?.message || '')) break;
                }
                authData = authData || { user: null };

                if (!authError && authData.user) {
                    // 로그인 성공 후 기업 프로필 조회
                    const { data: companyProfile } = await this.supabase
                        .from('companies')
                        .select('*')
                        .eq('username', identifier.includes('@') ? identifier.split('@')[0] : identifier)
                        .single();

                    this.currentUser = authData.user;
                    if (companyProfile) {
                        this.currentUser.role = companyProfile.role;
                        this.currentUser.company_id = companyProfile.id;
                        this.currentUser.brand_id = companyProfile.brand_id;
                        this.currentUser.name = companyProfile.name;
                        this.currentUser.menu_access = companyProfile.menu_access || null;
                        this.currentUser.brand_access = companyProfile.brand_access || null;
                    } else {
                        // 프로필이 없는 경우 기본 권한 및 ID 설정
                        const isMasterAccount = ['admin@bhas.com', 'ksw5363@gmail.com'].includes(authData.user.email);
                        this.currentUser.role = isMasterAccount ? 'MASTER' : 'CLIENT';
                        this.currentUser.name = authData.user.email.split('@')[0];
                        this.currentUser.company_id = authData.user.id; // 폴백: 이 경우 RLS 위반 가능성 있음
                    }

                    this._authOk = true; document.getElementById('auth-bar')?.remove();
                    this._loginNotice = null; this._watchAuth();
                    if (saveIdChecked) localStorage.setItem('bhas_saved_id', identifier);
                    else localStorage.removeItem('bhas_saved_id');
                    
                    if (autoLoginChecked) {
                        localStorage.setItem('bhas_auto_login', 'true');
                        localStorage.setItem('bhas_session_user', JSON.stringify(this.currentUser));
                    } else {
                        localStorage.removeItem('bhas_auto_login');
                        localStorage.removeItem('bhas_session_user');
                    }

                    // 먼저 화면 전환 후 데이터 로드 (로드 실패해도 로그인은 유지)
                    this.showToast('성공적으로 로그인되었습니다.');
                    this.currentView = 'dashboard';
                    this.render();
                    try { await this.loadInitialData(); this.render(); } catch(e) {}
                    return;
                }

                if (authError) throw authError;

            } catch (error) {
                // 로그인 실패
                errorMsg.innerText = '아이디 또는 비밀번호를 확인해주세요.';
                errorMsg.style.display = 'block';
            } finally {
                loginBtn.disabled = false;
                loginBtn.innerText = '로그인';
            }
        });
    }

    renderDashboard() {
        const { role, name } = this.currentUser;
        // 지난 스티커 되살리기 — 로그인 후 딱 한 번
        if (!this._stickiesRestored) this.restoreStickies();
        // 메모·할 일은 열고 나서 받으면 매번 기다린다 → 로그인 직후 뒤에서 미리 받아둔다
        if (!this._prefetched) {
            this._prefetched = true;
            setTimeout(() => {
                if (!this._noteLoaded && !this._noteLoading) this.loadNotes();
                if (!this._remLoaded && !this._remLoading) this.loadReminders();
                if (!this._vendorsLoaded && !this._vendorsLoading) this.loadVendors();
            }, 400);
        }
        const perms = mockData.permissions[role] || [];
        
        const menuItems = [
            { id: 'dashboard', label: '시즌', icon: '<i class="ph ph-chart-bar"></i>', group: 'prod', visible: perms.includes('dashboard') },
            { id: 'timeline', label: '타임라인', icon: '<i class="ph ph-calendar-check"></i>', group: 'prod', visible: perms.includes('dashboard') },
            { id: 'sample_maker', label: '샘플', icon: '<i class="ph ph-scissors"></i>', group: 'prod', visible: perms.includes('dashboard') },
            { id: 'tech_packs', label: '작업지시서', icon: '<i class="ph ph-clipboard-text"></i>', group: 'prod', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'vendors', label: '생산현황', icon: '<i class="ph ph-factory"></i>', group: 'prod', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'contacts', label: '연락처', icon: '<i class="ph ph-address-book"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'quotes', label: '견적', icon: '<i class="ph ph-receipt"></i>', group: 'prod', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'orders', label: '주문', icon: '<i class="ph ph-shopping-bag-open"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'cs', label: 'CS', icon: '<i class="ph ph-arrows-counter-clockwise"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'expenses', label: '지출', icon: '<i class="ph ph-credit-card"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'sales', label: '매출', icon: '<i class="ph ph-chart-line-up"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'analysis', label: '분석', icon: '<i class="ph ph-chart-donut"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'inventory', label: '재고', icon: '<i class="ph ph-package"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'integrations', label: '연동', icon: '<i class="ph ph-plugs-connected"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'notes', label: '메모', icon: '<i class="ph ph-note"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'reminders', label: '할 일', icon: '<i class="ph ph-list-checks"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'calendar', label: '캘린더', icon: '<i class="ph ph-calendar-dots"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'table', label: '표', icon: '<i class="ph ph-table"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'sns', label: 'SNS', icon: '<i class="ph ph-instagram-logo"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'documents', label: '문서', icon: '<i class="ph ph-folder-open"></i>', group: 'archive', visible: perms.includes('documents') },
            { id: 'user_management', label: '계정', icon: '<i class="ph ph-user-plus"></i>', group: 'admin', visible: perms.includes('user_management') },
            { id: 'brand_management', label: '브랜드', icon: '<i class="ph ph-shield-check"></i>', group: 'admin', visible: perms.includes('user_management') },
            { id: 'feedback', label: '불편사항', icon: '<i class="ph ph-chat-dots"></i>', group: 'admin', visible: role === 'MASTER' },
            { id: 'settings', label: '설정', icon: '<i class="ph ph-gear"></i>', group: 'admin', visible: true }
        ];
        // 계정별 세분화 권한(menu_access) 반영: 설정돼 있으면 그 목록으로 가시성 결정.
        // 단 계정/브랜드 관리는 항상 MASTER 전용(보안), 할일은 항상 노출. 없으면(null) 역할 기본값 유지.
        const ma = Array.isArray(this.currentUser.menu_access) ? this.currentUser.menu_access : null;
        if (ma) {
            menuItems.forEach(it => {
                if (it.id === 'user_management' || it.id === 'brand_management' || it.id === 'feedback') it.visible = role === 'MASTER';
                // 새로 생긴 메뉴는 기존 menu_access 목록에 없으므로 역할 기본값을 유지한다
                // (안 그러면 권한을 다시 저장하기 전까지 아무에게도 안 보인다).
                else if (['all_todos', 'cs', 'expenses', 'notes', 'reminders', 'settings', 'contacts'].includes(it.id)) it.visible = true;
                else it.visible = ma.includes(it.id);
            });
        }
        const navGroups = [
            { id: 'work', label: '업무' },
            { id: 'stock', label: '판매' },
            { id: 'prod', label: '생산' },
            { id: 'archive', label: '자료실' },
            { id: 'admin', label: '관리' }
        ];
        this.navCollapsed = this.navCollapsed || {};
        const isLight = document.body.classList.contains('light');

        let products = mockData.products;
        if (role === 'CLIENT') {
            products = mockData.products.filter(p => p.company_id === this.currentUser.company_id);
        } else if (this.selectedCompanyId !== 'all') {
            // brand_id 기준 필터링 (브랜드 관리 연동)
            products = mockData.products.filter(p => p.brand_id === this.selectedCompanyId);
        }
        // 계정별 브랜드 접근 권한(brand_access) 추가 게이트 (설정된 경우만 제한)
        const ab = this._allowedBrandIds();
        if (ab) products = products.filter(p => ab.has(p.brand_id));

        // ── 맥 모드: 데스크톱 + 창 + 독 ────────────────────────────────
        //  기존 화면(renderSubView)을 창 안에 그대로 띄운다. 화면 코드를 고치지 않고 껍데기만 바꾼다.
        //  renderDashboard 는 문자열을 돌려주는 게 아니라 직접 DOM 에 넣는 구조라 여기서도 같은 방식으로 넣는다.
        if (this.macMode) {
            this.appContainer.innerHTML = this.renderMacDesktop(products);
            // ★ 여기서 return 하는 바람에 아래쪽 ensureViewData 가 아예 안 불렸다.
            //   창으로 연 화면은 아무도 데이터를 안 받아와서 늦게 뜨거나 빈 채로 있었다.
            this._macEnsureData();
            this._macBind();
            return;
        }
        // ↓ 아래는 옛 기본 화면(사이드바)이다. macMode 를 늘 true 로 두어 더는 닿지 않는다.
        //   지우면 diff 가 너무 커져 되돌리기 어려우므로 남겨둔다. 새 기능은 여기에 넣지 말 것.

        const dashboardHtml = `
            <div class="dashboard fade-in">
                <div class="mobile-top-bar">
                    <div class="top-bar-logo" onclick="app.switchView('home')" style="cursor:pointer" title="홈으로">2179</div>
                    <div class="top-bar-actions">
                        <div class="noti-trigger" onclick="app.openCalc()" title="계산기">
                            <i class="ph ph-calculator"></i>
                        </div>
                        <div class="noti-trigger" onclick="app.openStickyList()" title="스티커 메모">
                            <i class="ph ph-note-blank"></i>
                        </div>
                        <div class="noti-trigger" onclick="app.toggleMacMode()" title="맥 모드(창·독)">
                            <i class="ph ph-squares-four"></i>
                        </div>
                        <div class="noti-trigger" id="mobile-search-btn" title="검색">
                            <i class="ph ph-magnifying-glass"></i>
                        </div>
                        <div class="noti-trigger" onclick="app.toggleNotifications(event)">
                            <i class="ph ph-bell"></i>
                            ${(() => {
                                const allTodos = (mockData.products || []).flatMap(p => p.todos || []);
                                const unreadCount = allTodos.filter(t => t && !t.completed).length; 
                                return unreadCount > 0 ? `<span class="noti-badge">${unreadCount}</span>` : '';
                            })()}
                        </div>
                    </div>
                </div>
                <nav class="glass sidebar${this.navSidebarCollapsed ? ' nav-collapsed' : ''}">
                    <div class="nav-logo" style="display:flex;align-items:center;justify-content:space-between;gap:6px">
                        <span onclick="app.switchView('home')" title="홈으로" style="cursor:pointer" class="${this.currentView === 'home' ? 'logo-home-active' : ''}">2179</span>
                        <button id="sidebar-collapse-btn" title="사이드바 접기/펼치기" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.25rem;padding:0;line-height:1;flex-shrink:0"><i class="ph ph-sidebar-simple"></i></button>
                    </div>
                    <ul class="nav-links">
                        ${navGroups.map(g => {
                            const items = menuItems.filter(i => i.group === g.id && i.visible);
                            if (!items.length) return '';
                            const collapsed = !!this.navCollapsed[g.id];
                            return `
                                <li class="nav-group-header" data-group="${g.id}" style="display:flex; align-items:center; justify-content:space-between; padding:12px 8px 6px; cursor:pointer; color:var(--text-main); font-size:0.92rem; font-weight:700; user-select:none;">
                                    <span style="display:flex; align-items:center; gap:8px;"><i class="ph ${collapsed ? 'ph-folder-simple' : 'ph-folder-open'}" style="font-size:1.15rem; color:var(--primary);"></i> ${g.label}</span>
                                    <i class="ph ph-caret-${collapsed ? 'right' : 'down'}" style="font-size:0.9rem; color:var(--text-muted);"></i>
                                </li>
                                ${collapsed ? '' : items.map(item => `
                                    <li class="${this.currentView === item.id ? 'active' : ''}" data-view="${item.id}" style="padding:7px 14px 7px 24px; margin-bottom:2px;">
                                        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.95rem;">${item.icon} <span style="font-size: 0.86rem;">${item.label}</span></div>
                                    </li>
                                `).join('')}
                            `;
                        }).join('')}
                        <li class="nav-bottom" style="margin-top:auto; display:flex; align-items:center; justify-content:flex-end; padding:12px 14px; margin-bottom:0; cursor:default;">
                            <button id="theme-toggle" title="라이트/다크 전환" style="position:relative; width:50px; height:26px; border-radius:999px; border:none; cursor:pointer; flex-shrink:0; background:${isLight ? '#cbd5e1' : 'var(--primary)'}; transition:background 0.25s;">
                                <span style="position:absolute; top:3px; left:${isLight ? '3px' : '27px'}; width:20px; height:20px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; transition:left 0.25s; box-shadow:0 1px 3px rgba(0,0,0,0.25);">
                                    <i class="ph ${isLight ? 'ph-sun' : 'ph-moon'}" style="font-size:0.72rem; color:${isLight ? '#f59e0b' : '#3b82f6'};"></i>
                                </span>
                            </button>
                        </li>
                    </ul>
                </nav>

                <!-- 모바일 전용 하단바 — 데스크톱 사이드바를 그대로 가로로 눕히면 메뉴 17개가
                     한 줄에 들어가 못 쓴다. 자주 쓰는 4개 + '전체'(시트)로 나눈다. -->
                ${(() => {
                    const quick = [
                        { id: 'home', label: '홈', icon: 'ph-house-line' },
                        { id: 'orders', label: '주문', icon: 'ph-shopping-bag-open' },
                        { id: 'sales', label: '매출', icon: 'ph-chart-line-up' },
                        { id: 'inventory', label: '재고', icon: 'ph-package' },
                    ].filter(q => q.id === 'home' || menuItems.some(m => m.id === q.id && m.visible));
                    const inQuick = quick.some(q => q.id === this.currentView);
                    return `<nav class="mobile-bottom-nav">
                        ${quick.map(q => `<button class="mbn-item ${this.currentView === q.id ? 'active' : ''}" data-view="${q.id}">
                            <i class="ph ${q.icon}"></i><span>${q.label}</span>
                        </button>`).join('')}
                        <button class="mbn-item ${(!inQuick || this.mobileMenuOpen) ? 'active' : ''}" id="mbn-more">
                            <i class="ph ph-dots-three-outline"></i><span>전체</span>
                        </button>
                    </nav>
                    ${this.mobileMenuOpen ? `<div class="mobile-menu-sheet" id="mobile-menu-sheet">
                        <div class="mms-panel">
                            <div class="mms-head">
                                <span>전체 메뉴</span>
                                <button id="mms-close" aria-label="닫기"><i class="ph ph-x"></i></button>
                            </div>
                            <div class="mms-body">
                                ${navGroups.map(g => {
                                    const items = menuItems.filter(i => i.group === g.id && i.visible);
                                    if (!items.length) return '';
                                    return `<div class="mms-group">
                                        <div class="mms-group-label">${g.label}</div>
                                        <div class="mms-grid">
                                            ${items.map(it => `<button class="mms-item ${this.currentView === it.id ? 'active' : ''}" data-view="${it.id}">
                                                ${it.icon}<span>${it.label}</span>
                                            </button>`).join('')}
                                        </div>
                                    </div>`;
                                }).join('')}
                            </div>
                            <div class="mms-foot">
                                <span>${name} · ${role === 'MASTER' ? '마스터 관리자' : (role === 'STAFF' ? '업무 직원' : '파트너사')}</span>
                                <button id="mms-logout"><i class="ph ph-power"></i> 로그아웃</button>
                            </div>
                        </div>
                    </div>` : ''}`;
                })()}

                <div class="top-toolbar">
                    <div class="tt-util">
                        <button onclick="app.openCalc()" title="계산기"><i class="ph ph-calculator"></i></button>
                        <button onclick="app.openStickyList()" title="스티커 메모"><i class="ph ph-note-blank"></i></button>
                        <button onclick="app.toggleMacMode()" title="맥 모드(창·독)"><i class="ph ph-squares-four"></i></button>
                    </div>
                    <div class="tt-search" id="open-search-btn" title="통합 검색 (단축키 /)">
                        <i class="ph ph-magnifying-glass"></i>
                        <span>검색</span>
                        <kbd>/</kbd>
                    </div>
                    <div class="tt-profile" title="${name} · ${role === 'MASTER' ? '마스터 관리자' : (role === 'STAFF' ? '업무 직원' : '파트너사')}">
                        <div class="tt-avatar">${name[0]}</div>
                        <div class="tt-userinfo">
                            <span class="tt-name">${name}</span>
                            <span class="tt-role">${role === 'MASTER' ? '마스터 관리자' : (role === 'STAFF' ? '업무 직원' : '파트너사')}</span>
                        </div>
                    </div>
                    <button id="logout-btn" class="tt-logout" title="로그아웃"><i class="ph ph-power"></i></button>
                </div>

                ${this.navSidebarCollapsed ? `<button id="sidebar-expand-btn" class="sidebar-expand-fab" title="사이드바 펼치기"><i class="ph ph-sidebar-simple"></i></button>` : ''}
                <main class="main-content">
                    <header class="content-header mobile-responsive-header">
                        ${this.currentView === 'detail' ? (() => {
                            const p = mockData.products.find(p => p.id === this.activeProjectId);
                            const b = mockData.brands?.find(b => b.id === p?.brand_id);
                            const bName = b ? b.name : '브랜드';
                            const bColor = b ? (b.brand_color || 'var(--primary)') : 'var(--primary)';
                            return `
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 0.5rem;">
                                    <button class="breadcrumb-back-btn btn-secondary" style="padding: 6px 12px; border-radius: 8px; font-size: 0.85rem;"><i class="ph ph-arrow-left"></i> 뒤로</button>
                                    <h1 style="margin: 0; font-size: 1.4rem; font-weight: 700; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                                        ${p?.name || '상세보기'}
                                        <span class="company-tag" style="border-color: ${bColor}; color: ${this._contrastText(bColor)}; background: ${bColor}; border-width: 1px; font-size: 0.8rem;">
                                            <i class="ph ph-buildings"></i> ${bName}
                                        </span>
                                    </h1>
                                </div>
                            `;
                        })() : this.currentView === 'all_todos' ? `
                            <div style="margin-bottom: 0.25rem;">
                                <button class="breadcrumb-back-btn btn-secondary" style="padding: 6px 12px; border-radius: 8px; font-size: 0.85rem;"><i class="ph ph-arrow-left"></i> 뒤로</button>
                            </div>
                        ` : ''}
                        <!-- '뒤로'는 하위 화면(시즌 상세·할일 전체)에서만. 홈·매출·주문 같은 최상위 메뉴엔 갈 곳이 없어 안 띄운다 -->
                        <div class="header-top-row">
                            <div class="header-title-section" style="display: flex; align-items: center; gap: 10px; flex-wrap: nowrap;">
                                ${(role === 'MASTER' || role === 'STAFF') && this.currentView === 'dashboard' ? `
                                    <select id="global-company-filter" class="glass brand-select" style="color: white; border: 1px solid rgba(var(--tint),0.1); border-radius: 8px; padding: 6px 10px; outline: none; cursor: pointer; font-size: 0.85rem; flex: 1; min-width: 0;">
                                        <option value="all" style="background: #0f172a; color: white;" ${this.selectedCompanyId === 'all' ? 'selected' : ''}>전체 브랜드</option>
                                        ${(mockData.brands || []).map(b => `
                                            <option value="${b.id}" style="background: #0f172a; color: white;" ${this.selectedCompanyId === b.id ? 'selected' : ''}>${b.name}</option>
                                        `).join('')}
                                    </select>
                                ` : ''}
                                ${this.currentView === 'dashboard' ? `
                                    <div class="view-toggles" style="flex-shrink: 0;">
                                        <button id="view-grid-btn" class="${this.dashboardViewType === 'table' ? '' : 'active'}" title="그리드 보기"><i class="ph ph-squares-four"></i></button>
                                        <button id="view-table-btn" class="${this.dashboardViewType === 'table' ? 'active' : ''}" title="리스트 보기"><i class="ph ph-list-dashes"></i></button>
                                    </div>
                                ` : ''}
                                ${(() => {
                                    const userId = this.currentUser.company_id || this.currentUser.id;
                                    const pendingCount = mockData.products.flatMap(p => p.todos || []).filter(t => !t.completed && t.assignee === userId).length;
                                    
                                    const allTodos = mockData.products.flatMap(p => {
                                        const company = mockData.companies.find(c => c.id === p.company_id);
                                        return (p.todos || []).map(t => ({...t, projectName: p.name, product_id: p.id, company_id: p.company_id, companyName: company ? company.name : ''}));
                                    });
                                    let filteredTodos = allTodos.filter(t => !t.completed);
                                    if (this.currentUser.role === 'CLIENT') {
                                        filteredTodos = filteredTodos.filter(t => t.company_id === this.currentUser.company_id);
                                    }
                                    const myTodos = filteredTodos.filter(t => t.assignee === userId);
                                    const requestedTodos = filteredTodos.filter(t => t.created_by === userId && t.assignee !== userId);

                                    // 강화: 마감 임박/지연 + @멘션
                                    const deadlineAlerts = this.getDeadlineAlerts();
                                    const mentions = this.getMyMentions();
                                    const overdueCount = deadlineAlerts.filter(t => t.meta.level === 'overdue').length;
                                    const alertDot = overdueCount > 0 ? '#ef4444' : (deadlineAlerts.length > 0 ? '#f59e0b' : (pendingCount > 0 ? 'var(--primary)' : null));

                                    const renderAlertList = (items) => items.map(t => `
                                        <li class="noti-todo-item" data-todo-id="${t.id}" data-project-id="${t.product_id}" style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-radius:10px; background:rgba(var(--tint),0.03); margin-bottom:6px; border:1px solid ${t.meta.level === 'overdue' ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.3)'}; cursor:pointer;" onmouseover="this.style.background='rgba(var(--tint),0.08)';" onmouseout="this.style.background='rgba(var(--tint),0.03)';">
                                            <i class="ph ${t.meta.level === 'overdue' ? 'ph-warning-circle' : 'ph-clock-countdown'}" style="font-size:1.1rem; margin-top:2px; color:${t.meta.level === 'overdue' ? '#ef4444' : '#f59e0b'};"></i>
                                            <div style="flex:1; display:flex; flex-direction:column; gap:4px; overflow:hidden;">
                                                <div style="display:flex; justify-content:space-between; align-items:center; gap:6px;">
                                                    <span style="font-size:0.75rem; color:var(--primary); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><strong>[${t.brandName}]</strong> <span style="color:var(--text-muted);">${t.projectName}</span></span>
                                                    <span style="font-size:0.72rem; font-weight:700; flex-shrink:0; padding:2px 7px; border-radius:5px; color:#fff; background:${t.meta.level === 'overdue' ? '#ef4444' : '#f59e0b'};">${t.meta.label}</span>
                                                </div>
                                                <span style="font-size:0.9rem; color:#fff; line-height:1.3;">${t.text}</span>
                                            </div>
                                        </li>
                                    `).join('');

                                    const renderMentionList = (items) => items.map(m => `
                                        <li class="noti-todo-item" data-project-id="${m.product_id}" style="display:flex; align-items:flex-start; gap:10px; padding:10px 12px; border-radius:10px; background:rgba(99,102,241,0.06); margin-bottom:6px; border:1px solid rgba(99,102,241,0.25); cursor:pointer;" onmouseover="this.style.background='rgba(99,102,241,0.12)';" onmouseout="this.style.background='rgba(99,102,241,0.06)';">
                                            <i class="ph ph-at" style="font-size:1.1rem; margin-top:2px; color:#818cf8;"></i>
                                            <div style="flex:1; display:flex; flex-direction:column; gap:4px; overflow:hidden;">
                                                <span style="font-size:0.75rem; color:var(--text-muted);">${m.type === 'todo' ? '할일' : '메모'} · ${m.projectName}</span>
                                                <span style="font-size:0.9rem; color:#fff; line-height:1.3;">${m.text}</span>
                                            </div>
                                        </li>
                                    `).join('');

                                    const sectionWrap = (title, icon, color, count, body) => `
                                        <div style="margin-bottom:1rem;">
                                            <h4 style="margin-bottom:0.6rem; display:flex; align-items:center; gap:6px; font-size:0.95rem; color:${color};"><i class="${icon}"></i> ${title} ${count > 0 ? `<span style="font-size:0.72rem; background:${color}; color:#fff; padding:1px 7px; border-radius:10px;">${count}</span>` : ''}</h4>
                                            <ul style="margin:0; padding:0; list-style:none;">${body || '<div style="text-align:center; padding:0.8rem 0; color:var(--text-muted); font-size:0.8rem;">없음</div>'}</ul>
                                        </div>
                                    `;

                                    const renderTodoList = (todos, title, icon) => `
                                        <div style="margin-bottom: 1rem;">
                                            <h4 style="margin-bottom: 0.8rem; display: flex; align-items: center; gap: 6px; font-size: 0.95rem; color: var(--text-main);"><i class="${icon}"></i> ${title}</h4>
                                            <ul style="margin: 0; padding: 0; list-style: none;">
                                                ${todos.map(todo => `
                                                    <li class="noti-todo-item" data-todo-id="${todo.id}" data-project-id="${todo.product_id}" style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(var(--tint),0.03); margin-bottom: 6px; border: 1px solid rgba(var(--tint),0.05); cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(var(--tint),0.08)';" onmouseout="this.style.background='rgba(var(--tint),0.03)';">
                                                        <div class="noti-quick-check" data-id="${todo.id}" data-pid="${todo.product_id}" style="width: 16px; height: 16px; border: 2px solid var(--card-border); border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-top: 3px; background: transparent; flex-shrink: 0; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='var(--primary)'; this.style.boxShadow='0 0 5px var(--primary)';" onmouseout="this.style.borderColor='var(--card-border)'; this.style.boxShadow='none';"></div>
                                                        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; overflow: hidden;">
                                                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                                                <span style="font-size: 0.75rem; font-weight: 500; color: var(--primary);"><strong style="color: var(--primary);">[${todo.companyName}]</strong> <span style="color: var(--text-muted);">${todo.projectName}</span></span>
                                                                <span style="font-size: 0.75rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px;">${todo.due_date ? this.formatDateToUI(todo.due_date) : '일정'}</span>
                                                            </div>
                                                            <span style="font-size: 0.9rem; color: #fff; font-weight: 400; line-height: 1.3;">${todo.text}</span>
                                                        </div>
                                                    </li>
                                                `).join('')}
                                                ${todos.length === 0 ? '<div style="text-align: center; padding: 1rem 0; color: var(--text-muted); font-size: 0.8rem;">할 일이 없습니다.</div>' : ''}
                                            </ul>
                                        </div>
                                    `;

                                    return `
                                        <div class="notification-bell" style="position: fixed; top: 16px; right: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 46px; height: 46px; border-radius: 50%; background: rgba(37,99,235,0.15); box-shadow: 0 0 16px rgba(37,99,235,0.18); transition: 0.3s; z-index: 1200;" onmouseover="this.style.background='rgba(37,99,235,0.25)'; this.style.transform='scale(1.05)';" onmouseout="this.style.background='rgba(37,99,235,0.15)'; this.style.transform='scale(1)';" onclick="const popup = document.getElementById('notification-popup'); popup.style.display = popup.style.display === 'none' ? 'block' : 'none';" title="알림 (할 일)">
                                            <i class="ph ph-bell-ringing" style="font-size: 1.5rem; color: var(--primary);"></i>
                                            ${alertDot ? `<span style="position: absolute; top: 4px; right: 6px; min-width: 15px; height: 15px; padding: 0 4px; display:flex; align-items:center; justify-content:center; font-size:0.62rem; font-weight:700; color:#fff; background: ${alertDot}; border-radius: 8px; border: 2px solid var(--bg-dark); box-shadow: 0 0 8px ${alertDot};">${deadlineAlerts.length > 0 ? deadlineAlerts.length : ''}</span>` : ''}
                                        </div>
                                        <div id="notification-popup" class="glass fade-in" style="display: none; position: fixed; top: 100px; right: 16px; width: calc(100vw - 32px); max-width: 380px; max-height: 70vh; overflow-y: auto; border-radius: 20px; z-index: 1001; padding: 1.5rem; box-shadow: 0 10px 40px rgba(0,0,0,0.5); border: 1px solid var(--card-border); text-align: left; box-sizing: border-box;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                                                <h3 style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 1.1rem; color: white;"><i class="ph ph-bell"></i> 알림 (할 일)</h3>
                                                <button onclick="document.getElementById('notification-popup').style.display='none'" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; transition: 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--text-muted)'"><i class="ph ph-x" style="font-size: 1.2rem;"></i></button>
                                            </div>
                                            ${sectionWrap('마감 임박 · 지연', 'ph ph-alarm', '#ef4444', deadlineAlerts.length, renderAlertList(deadlineAlerts))}
                                            ${mentions.length > 0 ? sectionWrap('나를 멘션', 'ph ph-at', '#818cf8', mentions.length, renderMentionList(mentions)) : ''}
                                            <div style="border-top:1px solid var(--card-border); margin:0.5rem 0 1rem;"></div>
                                            ${renderTodoList(myTodos, '내가 할 일', 'ph ph-user-focus')}
                                            ${renderTodoList(requestedTodos, '요청한 일', 'ph ph-paper-plane-tilt')}
                                        </div>
                                    `;
                                })()}
                            </div>
                        </div>
                        
                        <div class="floating-stats" style="display:none">
                            ${this.currentView === 'dashboard' ? (() => {
                                const isActive = (p) => {
                                    const stage = p.currentStage || 'consulting';
                                    if (stage === 'shipping') return false;
                                    if (stage !== 'consulting') return true;
                                    return (p.stages_data?.consulting?.status === 'completed' || p.history?.length > 0 || (p.documents && p.documents.length > 0));
                                };
                                const activeCount = products.filter(p => isActive(p)).length;
                                const scheduledCount = products.filter(p => {
                                    const stage = p.currentStage || 'consulting';
                                    return stage !== 'shipping' && !isActive(p);
                                }).length;
                                const completedCount = products.filter(p => (p.currentStage || 'consulting') === 'shipping').length;

                                return `
                                <div class="stat-item">
                                    <div class="glass stat-card active">
                                        <span class="label"><i class="ph ph-rocket-launch"></i> 진행 중</span>
                                        <span class="value">${activeCount}</span>
                                    </div>
                                    <div class="glass stat-card scheduled">
                                        <span class="label"><i class="ph ph-calendar-blank"></i> 예정</span>
                                        <span class="value">${scheduledCount}</span>
                                    </div>
                                    <div class="glass stat-card completed">
                                        <span class="label"><i class="ph ph-check-circle"></i> 완료 됨</span>
                                        <span class="value">${completedCount}</span>
                                    </div>
                                </div>
                                `;
                            })() : (this.currentView === 'all_todos' ? (() => {
                                const allTodos = products.flatMap(p => p.todos || []);
                                let filteredTodos = allTodos.filter(t => !t.completed);
                                if (role === 'CLIENT') filteredTodos = filteredTodos.filter(t => t.company_id === this.currentUser.company_id);
                                const myTodosCount = filteredTodos.filter(t => t.assignee === (this.currentUser.company_id || this.currentUser.id)).length;
                                const reqTodosCount = filteredTodos.filter(t => t.created_by === (this.currentUser.company_id || this.currentUser.id)).length;
                                return `
                                <div class="stat-item" style="grid-template-columns: repeat(2, 1fr); gap: 12px;">
                                    <div class="glass stat-card my-todos">
                                        <span class="label"><i class="ph ph-user-focus"></i> 내가 할 일</span>
                                        <span class="value">${myTodosCount}</span>
                                    </div>
                                    <div class="glass stat-card req-todos">
                                        <span class="label"><i class="ph ph-paper-plane-tilt"></i> 요청한 일</span>
                                        <span class="value">${reqTodosCount}</span>
                                    </div>
                                </div>
                                `;
                            })() : '')}
                        </div>
                    </header>
                    
                    ${this.renderSubView(products)}
                </main>
                ${(role === 'MASTER' || role === 'STAFF') ? `<button onclick="app.openFeedbackModal()" class="feedback-fab" title="불편사항 접수"><i class="ph ph-chat-dots"></i><span>불편사항</span></button>` : ''}
            </div>

            <div id="global-search-overlay" class="search-overlay" style="display: none;">
                <div class="search-panel glass">
                    <div class="search-input-row">
                        <i class="ph ph-magnifying-glass"></i>
                        <input id="global-search-input" type="text" placeholder="시즌 · 할일 · 문서 · 메모 검색..." autocomplete="off" />
                        <button id="close-search-btn" title="닫기 (Esc)"><i class="ph ph-x"></i></button>
                    </div>
                    <div id="global-search-results" class="search-results">
                        <div class="search-hint"><i class="ph ph-keyboard"></i> 검색어를 입력하세요. 결과를 클릭하면 해당 시즌로 이동합니다.</div>
                    </div>
                </div>
            </div>

            <div id="modal-container" class="modal-overlay" style="display: none;"></div>
        `;
        this.appContainer.innerHTML = dashboardHtml;

        // 이벤트 바인딩
        this.appContainer.querySelectorAll('.breadcrumb-back-btn').forEach(btn => {
            btn.onclick = () => this.setState({ currentView: 'dashboard', activeProjectId: null });
        });

        // 모바일 하단바 · 전체메뉴 시트
        this.appContainer.querySelectorAll('.mobile-bottom-nav .mbn-item[data-view]').forEach(btn => {
            btn.onclick = () => { this.mobileMenuOpen = false; this.switchView(btn.dataset.view); };
        });
        const moreBtn = this.appContainer.querySelector('#mbn-more');
        if (moreBtn) moreBtn.onclick = () => { this.mobileMenuOpen = !this.mobileMenuOpen; this.render(); };
        const mmsClose = this.appContainer.querySelector('#mms-close');
        if (mmsClose) mmsClose.onclick = () => { this.mobileMenuOpen = false; this.render(); };
        const sheet = this.appContainer.querySelector('#mobile-menu-sheet');
        // 바깥(딤) 클릭으로 닫기 — 패널 안쪽 클릭은 무시
        if (sheet) sheet.onclick = (e) => { if (e.target === sheet) { this.mobileMenuOpen = false; this.render(); } };
        this.appContainer.querySelectorAll('.mms-item[data-view]').forEach(btn => {
            btn.onclick = () => { this.mobileMenuOpen = false; this.switchView(btn.dataset.view); };
        });
        
        this.bindDashboardEvents();
        if (this.currentView === 'detail') this.bindDetailEvents();
        if (this.currentView === 'all_todos') this.bindAllTodosEvents();

        const doLogout = () => this.logout();
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.onclick = doLogout;
        const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
        if (mobileLogoutBtn) mobileLogoutBtn.onclick = doLogout;
        const mmsLogout = document.getElementById('mms-logout');
        if (mmsLogout) mmsLogout.onclick = () => { this.mobileMenuOpen = false; doLogout(); };

        const companyFilter = document.getElementById('global-company-filter');
        if (companyFilter) {
            companyFilter.onchange = (e) => {
                this.setState({ selectedCompanyId: e.target.value });
            };
        }

        // 알림 팝업 이벤트 바인딩 (Consolidated)
        this.appContainer.querySelectorAll('.noti-quick-check').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const todoId = e.currentTarget.getAttribute('data-id');
                const pid = e.currentTarget.getAttribute('data-pid');
                const project = mockData.products.find(p => p.id === pid);
                if (project && project.todos) {
                    const todo = project.todos.find(t => t.id === todoId);
                    if (todo) {
                        if (await this.showConfirm('정말 완료 처리하시겠습니까? 완료 시 목록에서 숨겨집니다.', '완료 확인')) {
                            todo.completed = !todo.completed;
                            this.showToast('할 일이 완료 처리되었습니다.');
                            this.requestRender();
                            setTimeout(() => {
                                const popup = document.getElementById('notification-popup');
                                if(popup) popup.style.display = 'block';
                            }, 10);
                        }
                    }
                }
            });
        });

        this.appContainer.querySelectorAll('.noti-todo-item').forEach(item => {
            item.addEventListener('click', () => {
                const todoId = item.getAttribute('data-todo-id');
                const pid = item.getAttribute('data-project-id');
                const popup = document.getElementById('notification-popup');
                if(popup) popup.style.display = 'none';
                this.setState({ currentView: 'detail', activeProjectId: pid });
                setTimeout(() => {
                    this.openTodoModal(pid, todoId);
                }, 100);
            });
        });
    }

    showProjectModal(brandId) {
        //  셸이 바뀌면서 #modal-container 가 없어졌다. 지금 쓰는 칸을 찾아 쓴다.
        const modal = document.getElementById('modal-container') || document.getElementById('global-modal-container');
        if (!modal) { this.showToast('창을 띄울 자리를 찾지 못했습니다'); return; }
        this._newSeaBrand = brandId || null;     // 브랜드 안에서 눌렀으면 그 브랜드로 고정
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="glass modal-content fade-in" style="width: 90%; max-width: 450px; padding: 2rem; border-radius: 30px;">
                <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px;"><i class="ph ph-plus-circle"></i> 새 시즌 등록</h2>
                <div class="login-field">
                    <label>시즌명</label>
                    <input type="text" id="modal-p-name" class="login-input" placeholder="예: 구스다운 패딩">
                </div>
                <div class="login-field" style="${this.currentUser.role === 'CLIENT' ? 'display: none;' : ''}">
                    <label>파트너사 (브랜드)</label>
                    <select id="modal-p-brand" class="login-input" style="background: rgba(0,0,0,0.8); color: white; -webkit-appearance: listbox;">
                        <option value="">브랜드 선택</option>
                        ${mockData.brands.map(b => `
                            <option value="${b.id}"${String(this._newSeaBrand || '') === String(b.id) ? ' selected' : ''}>${b.name}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="login-field">
                    <label>마감 기한</label>
                    <input type="date" id="modal-p-deadline" class="login-input" max="2099-12-31">
                </div>
                <div style="display: flex; gap: 1rem; margin-top: 2.5rem;">
                    <button id="modal-cancel" class="btn-secondary" style="flex: 1; padding: 1rem; border-radius: 12px; border: 1px solid var(--card-border);">취소</button>
                    <button id="modal-save" class="btn-primary" style="flex: 1; padding: 1rem; border-radius: 12px;">저장하기</button>
                </div>
            </div>
        `;

        document.getElementById('modal-cancel').onclick = (e) => { 
            e.preventDefault();
            modal.style.display = 'none'; 
        };
        
        const saveBtn = document.getElementById('modal-save');
        saveBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            
            const nameInput = document.getElementById('modal-p-name');
            const deadlineInput = document.getElementById('modal-p-deadline');
            const brandSelect = document.getElementById('modal-p-brand');

            const name = nameInput ? nameInput.value.trim() : '';
            const deadline = deadlineInput ? deadlineInput.value : '';
            const brandId = brandSelect ? brandSelect.value : null;

            if (!name || !deadline || (!brandId && this.currentUser.role !== 'CLIENT')) {
                return this.showConfirm('모든 필수 항목을 입력해주세요.', '입력 확인');
            }

            saveBtn.disabled = true;
            const originalBtnText = saveBtn.innerText;
            saveBtn.innerText = '저장 중...';

            let company_id = this.currentUser.company_id;
            if (this.currentUser.role !== 'CLIENT') {
                const representativeCompany = mockData.companies.find(c => c.brand_id === brandId);
                company_id = representativeCompany ? representativeCompany.id : this.currentUser.company_id;
            }

            // UUID 형식 유효성 검사 (강화)
            const isUuid = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
            if (brandId && !isUuid(brandId)) {
                 saveBtn.disabled = false;
                 saveBtn.innerText = originalBtnText;
                 return this.showConfirm(`선택된 브랜드 ID(${brandId})가 유효한 UUID 형식이 아닙니다.\n데이터베이스 설정을 확인해주세요.`, '데이터 형식 오류');
            }

            try {
                const { data: newId, error } = await this.supabase.rpc('create_product', {
                    p_company_id: company_id,
                    p_brand_id: brandId,
                    p_name: name,
                    p_deadline: this.formatDateToUI(deadline) || null
                });

                if (error) throw error;

                // 히스토리 기록 시도 (비차단형)
                try {
                    await this.supabase.from('history').insert([{
                        product_id: newId,
                        stage_id: 'consulting',
                        status: '등록',
                        note: '시즌 생성: ' + name
                    }]);
                } catch (hError) {}

                await this.loadInitialData();
                modal.style.display = 'none';
                this.showToast('새 시즌이 등록되었습니다.');
                if (!this._noteLoaded) await this.loadNotes();
                await this.askSeasonSteps(newId);      // 바로 단계를 깔지 묻는다
                this.requestRender();
            } catch (error) {
                let errorMsg = error.message || '알 수 없는 오류';
                if (error.code === '42501') errorMsg = '데이터베이스 권한(RLS)이 없습니다.';
                if (error.code === '22P02') errorMsg = '데이터 형식(UUID 등)이 맞지 않습니다.';
                if (error.code === '42703') errorMsg = `데이터베이스 컬럼 오류: ${error.details || '필드가 존재하지 않습니다.'}`;
                
                await this.showConfirm(`시즌 등록 중 오류가 발생했습니다.\n\n오류 코드: ${error.code || 'N/A'}\n메시지: ${errorMsg}`, '등록 실패');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerText = originalBtnText;
            }
        });
    }

    showQuickAddTodoModal(isRequest = false) {
        const modal = document.getElementById('modal-container');
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="glass modal-content fade-in" style="width: 90%; max-width: 450px; padding: 2rem; border-radius: 30px;">
                <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px;"><i class="ph ph-list-plus"></i> ${isRequest ? '새 업무 요청 바로 등록' : '새 할 일 바로 등록'}</h2>
                <div class="login-field">
                    <label>시즌 선택</label>
                    <select id="quick-todo-pid" class="login-input" style="background: rgba(0,0,0,0.8); color: white;">
                        <option value="">시즌 선택</option>
                        ${mockData.products.filter(p => this.currentUser.role !== 'CLIENT' || p.company_id === this.currentUser.company_id).map(p => `
                            <option value="${p.id}" ${this.activeProjectId === String(p.id) ? 'selected' : ''}>${p.name}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="login-field">
                    <label>${isRequest ? '요청 내용' : '할 일 내용'}</label>
                    <input type="text" id="quick-todo-text" class="login-input" placeholder="${isRequest ? '요청할 내용을 입력하세요' : '할 일을 입력하세요'}">
                </div>
                <div class="login-field">
                    <label>마감 기한 (선택)</label>
                    <input type="date" id="quick-todo-date" class="login-input">
                </div>
                ${isRequest ? `
                <div class="login-field">
                    <label>담당자 지정 (@)</label>
                    <select id="quick-todo-assignee" class="login-input" style="background: rgba(0,0,0,0.8); color: white;">
                        <option value="">담당자 선택</option>
                        ${mockData.companies.filter(c => c.role === 'MASTER' || c.role === 'STAFF').map(c => `
                            <option value="${c.id}">@${c.name}</option>
                        `).join('')}
                    </select>
                </div>
                ` : ''}
                <div style="display: flex; gap: 1rem; margin-top: 2.5rem;">
                    <button id="quick-todo-cancel" class="btn-secondary" style="flex: 1; padding: 1rem; border-radius: 12px; border: 1px solid var(--card-border);">취소</button>
                    <button id="quick-todo-save" class="btn-primary" style="flex: 1; padding: 1rem; border-radius: 12px;">${isRequest ? '요청하기' : '저장하기'}</button>
                </div>
            </div>
        `;

        document.getElementById('quick-todo-cancel').onclick = () => { modal.style.display = 'none'; };
        let selectedAssigneeId = null; // 로컬 변수 추가
        const assigneeSelect = document.getElementById('quick-todo-assignee');
        if (assigneeSelect) {
            assigneeSelect.addEventListener('change', (e) => { selectedAssigneeId = e.target.value || null; });
        }
        const saveBtn = document.getElementById('quick-todo-save');
        saveBtn.onclick = async () => {
            const pid = document.getElementById('quick-todo-pid').value;
            const text = document.getElementById('quick-todo-text').value.trim();
            const date = document.getElementById('quick-todo-date').value;
            const assigneeSelect = document.getElementById('quick-todo-assignee');
            const assigneeId = assigneeSelect ? assigneeSelect.value : null;

            if (!pid || !text) { this.showToast('시즌와 내용을 입력해주세요.'); return; }

            saveBtn.disabled = true;
            try {
                // handleNewTodoProcess를 사용하도록 리팩토링
                const success = await this.handleNewTodoProcess(pid, text, isRequest, assigneeId, date);
                
                if (success) {
                    modal.style.display = 'none';
                }
            } catch (err) {
                this.showToast('저장 중 오류가 발생했습니다.');
            } finally {
                saveBtn.disabled = false;
            }
        };
    }

    showQuickAddDocModal() {
        const modal = document.getElementById('modal-container');
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="glass modal-content fade-in" style="width: 90%; max-width: 450px; padding: 2rem; border-radius: 30px;">
                <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px;"><i class="ph ph-file-plus"></i> 새 문서 바로 등록</h2>
                <div class="login-field">
                    <label>시즌 선택</label>
                    <select id="quick-doc-pid" class="login-input" style="background: rgba(0,0,0,0.8); color: white;">
                        <option value="">시즌 선택</option>
                        ${mockData.products.filter(p => this.currentUser.role !== 'CLIENT' || p.company_id === this.currentUser.company_id).map(p => `
                            <option value="${p.id}">${p.name}</option>
                        `).join('')}
                    </select>
                </div>
                <div class="login-field">
                    <label>문서 분류</label>
                    <select id="quick-doc-type" class="login-input" style="background: rgba(0,0,0,0.8); color: white;">
                        ${STAGES.map(s => `<option value="${s.docType}">${s.label}</option>`).join('')}
                    </select>
                </div>
                <div class="login-field">
                    <label>문서 이름</label>
                    <input type="text" id="quick-doc-name" class="login-input" placeholder="문서명을 입력하세요">
                </div>
                <div class="login-field">
                    <label>파일 선택</label>
                    <input type="file" id="quick-doc-file" class="login-input" style="padding-top: 0.8rem;">
                </div>
                <div style="display: flex; gap: 1rem; margin-top: 2.5rem;">
                    <button id="quick-doc-cancel" class="btn-secondary" style="flex: 1; padding: 1rem; border-radius: 12px; border: 1px solid var(--card-border);">취소</button>
                    <button id="quick-doc-save" class="btn-primary" style="flex: 1; padding: 1rem; border-radius: 12px;">업로드</button>
                </div>
            </div>
        `;

        document.getElementById('quick-doc-cancel').onclick = () => { modal.style.display = 'none'; };
        const saveBtn = document.getElementById('quick-doc-save');
        saveBtn.onclick = async () => {
            const pid = document.getElementById('quick-doc-pid').value;
            const type = document.getElementById('quick-doc-type').value;
            const name = document.getElementById('quick-doc-name').value.trim();
            const file = document.getElementById('quick-doc-file').files[0];

            if (!pid || !name || !file) { this.showToast('모든 항목을 입력하고 파일을 선택해주세요.'); return; }

            saveBtn.disabled = true;
            saveBtn.innerText = '업로드 중...';
            try {
                await this.handleFileUpload(pid, file, type, name);
                this.showToast('새 문서가 등록되었습니다.');
                modal.style.display = 'none';
                await this.loadInitialData();
                this.requestRender();
            } catch (err) {
                this.showToast('업로드 중 오류가 발생했습니다.');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerText = '업로드';
            }
        };
    }

    openStageSidebar(product_id, docType, readOnly = false) {
        const project = mockData.products.find(p => p.id === String(product_id));
        if(!project) return;
        const stage = STAGES.find(s => s.docType === docType);
        if(!stage) return;

        let sidebarContainer = document.getElementById('sidebar-container');
        if (!sidebarContainer) {
            sidebarContainer = document.createElement('div');
            sidebarContainer.id = 'sidebar-container';
            sidebarContainer.className = 'modal-overlay';
            sidebarContainer.style.justifyContent = 'flex-end';
            sidebarContainer.style.alignItems = 'stretch';
            sidebarContainer.style.background = 'rgba(0, 0, 0, 0.2)';
            sidebarContainer.style.backdropFilter = 'blur(2px)';
            sidebarContainer.style.webkitBackdropFilter = 'blur(2px)';
            document.body.appendChild(sidebarContainer);
        }
        
        if(!project.stages_data) project.stages_data = {};
        const stageData = project.stages_data[stage.id] || { status: (project.documents.some(doc => doc.type === docType) ? 'completed' : 'before'), due_date: '', note: '' };

        sidebarContainer.innerHTML = `
            <div class="todo-sidebar glass slide-in-right" style="width: 600px; max-width: 100vw; height: 100vh; background: var(--bg-dark); border-radius: 20px 0 0 20px; padding: 1.5rem; display: flex; flex-direction: column; overflow-y: auto; border-left: 1px solid var(--card-border); box-sizing: border-box;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem;">
                    <div>
                        <h2 style="font-size: 1.5rem; display: flex; align-items: center; gap: 10px; margin-bottom: 0.5rem; color: var(--text-main);">${stage.icon} ${stage.label} 상세 설정</h2>
                        <span style="font-size: 0.9rem; color: var(--text-muted);">${project.name}</span>
                    </div>
                     <button id="close-sidebar-btn" style="background: transparent; border: none; font-size: 1.5rem; color: var(--text-muted); cursor: pointer; transition: 0.2s;" onmouseover="this.style.color='white';" onmouseout="this.style.color='var(--text-muted)';"><i class="ph ph-x"></i></button>
                </div>

                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>진행 상태</label>
                    <select id="stage-status-select" class="glass" style="width: 100%; padding: 12px; border-radius: 12px; background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--card-border);">
                        <option value="before" ${stageData.status === 'before' ? 'selected' : ''}>시작 전 (대기)</option>
                        <option value="progress" ${stageData.status === 'progress' ? 'selected' : ''}>진행 중</option>
                        <option value="completed" ${stageData.status === 'completed' ? 'selected' : ''}>완료됨</option>
                    </select>
                </div>

                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>목표 기한 표기</label>
                    <input type="date" id="stage-date-input" class="login-input" value="${stageData.due_date ? stageData.due_date.replace(/\./g, '-') : ''}" max="2099-12-31">
                </div>

                <div class="login-field" style="margin-bottom: 1.5rem; flex: 1; display: flex; flex-direction: column;">
                    <label>세부 내용 / 메모</label>
                    <textarea id="stage-note-input" class="login-input" style="flex: 1; min-height: 200px; resize: none; padding: 1rem;" placeholder="이 공정에 대한 세부 내용이나 특이사항을 기입해주세요..." ${readOnly ? 'disabled' : ''}>${stageData.note || ''}</textarea>
                </div>

                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>관련 파일(문서) 첨부</label>
                    <div style="display: flex; gap: 10px; flex-direction: column;">
                        ${readOnly ? '' : `
                        <input type="text" id="stage-doc-name" class="login-input" placeholder="업로드할 파일명 (입력 안하면 자동)" style="width: 100%;">
                        <div style="display: flex; gap: 10px;">
                            <input type="file" id="stage-file-input" style="display: none;">
                            <button id="stage-file-select-btn" class="btn-primary" style="flex: 1; padding: 0.8rem; border-radius: 12px; font-size: 0.9rem;"><i class="ph ph-file-plus"></i> 클릭하여 파일 선택 및 즉시 업로드</button>
                        </div>
                        `}
                        <div id="selected-file-info" style="font-size: 0.75rem; color: var(--primary); margin-top: 4px; display: none;"></div>
                        
                        <!-- 연동된 문서 목록 노출 및 팝업 연동 -->
                        <div id="stage-linked-docs" style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">
                            ${project.documents.filter(d => d.type === docType).map(doc => `
                                <div class="glass" style="padding: 8px 12px; border-radius: 8px; font-size: 0.85rem; cursor: pointer; display: flex; justify-content: space-between; align-items: center;" onclick="app.showFileModal('${doc.url}', '${doc.name}')">
                                    <span><i class="ph ph-file-text"></i> ${doc.name}</span>
                                    <i class="ph ph-magnifying-glass" style="color: var(--primary);"></i>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                ${readOnly ? '' : `<button id="save-stage-btn" class="btn-primary" style="padding: 1rem; width: 100%; font-size: 1.1rem; border-radius: 12px; margin-top: auto;">세부 내용 저장하기</button>`}
            </div>
        `;

        sidebarContainer.style.display = 'flex';

        setTimeout(() => {
            const sidebar = sidebarContainer.querySelector('.todo-sidebar');
            if(sidebar) sidebar.classList.add('active');
        }, 10);

        const closeSidebar = async () => {
            const sidebar = sidebarContainer.querySelector('.todo-sidebar');
            if(sidebar) sidebar.classList.remove('active');
            setTimeout(async () => {
                sidebarContainer.style.display = 'none';
                await this.loadInitialData();
                this.requestRender();
            }, 300);
        };

        sidebarContainer.addEventListener('click', (e) => {
            if (e.target === sidebarContainer) closeSidebar();
        });

        document.getElementById('close-sidebar-btn').addEventListener('click', closeSidebar);

        const fileInput = document.getElementById('stage-file-input');
        const fileSelectBtn = document.getElementById('stage-file-select-btn');

        if (fileSelectBtn && fileInput) {
            fileSelectBtn.onclick = () => fileInput.click();
            fileInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) {
                    const nameInput = document.getElementById('stage-doc-name');
                    const customName = nameInput.value || file.name.split('.')[0];

                    // handleFileUpload 내부에서 토스트를 처리하므로 여기서는 호출하지 않음
                    await this.handleFileUpload(project.id, file, docType, customName);

                    fileInput.value = '';
                    nameInput.value = '';
                    document.getElementById('stage-status-select').value = 'completed';
                }
            };
        }

        document.getElementById('save-stage-btn').addEventListener('click', async () => {
            const status = document.getElementById('stage-status-select').value;
            const dateVal = document.getElementById('stage-date-input').value;
            const note = document.getElementById('stage-note-input').value;
            const due_date = this.formatDateToDB(dateVal);
            
            try {
                // 1. product_stages 테이블에 upsert
                const { error: stageError } = await this.supabase
                    .from('product_stages')
                    .upsert({
                        product_id: project.id,
                        stage_id: stage.id,
                        status: status,
                        due_date: due_date,
                        note: note,
                        updated_at: new Date().toISOString()
                    }, { onConflict: 'product_id,stage_id' });

                if (stageError) throw stageError;

                if (status === 'completed') {
                    // products 테이블에 stage 컬럼이 없으므로 업데이트 생략
                    // 대신 product_stages를 통해 상태가 관리됨
                }

                const now = new Date().toISOString().split('T')[0];
                const { error: historyError } = await this.supabase.from('history').insert([{
                    product_id: String(project.id),
                    action: `${stage.label} 공정 세부 설정 갱신`,
                    date: now,
                    user: this.currentUser.name
                }]);
                // history insert 실패는 무시

                await this.loadInitialData();
                this.showToast(`${stage.label} 상세 설정이 저장되었습니다.`);
                await closeSidebar();
            } catch (error) {
                this.showToast('설정 저장 중 오류가 발생했습니다.');
            }
        });
    }

    openTodoModal(product_id, todoId) {
        const project = mockData.products.find(p => p.id === String(product_id));
        if(!project) return;
        const todo = project.todos.find(t => t.id === todoId);
        if(!todo) return;

        let sidebarContainer = document.getElementById('sidebar-container');
        if (!sidebarContainer) {
            sidebarContainer = document.createElement('div');
            sidebarContainer.id = 'sidebar-container';
            sidebarContainer.className = 'modal-overlay';
            sidebarContainer.style.justifyContent = 'flex-end';
            sidebarContainer.style.alignItems = 'stretch';
            sidebarContainer.style.background = 'rgba(0, 0, 0, 0.2)';
            sidebarContainer.style.backdropFilter = 'blur(2px)';
            sidebarContainer.style.webkitBackdropFilter = 'blur(2px)';
            document.body.appendChild(sidebarContainer);
        }

        sidebarContainer.style.display = 'flex';
        // Add minimal slide-in animation directly in style
        sidebarContainer.innerHTML = `
            <div class="sidebar-content" style="background: var(--bg-dark); width: 600px; max-width: 100vw; padding: 1.5rem; border-radius: 30px 0 0 30px; border-left: 1px solid var(--card-border); box-shadow: -10px 0 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; height: 100%; box-sizing: border-box; animation: slideInRight 0.3s ease-out forwards;">
                <style>
                    @keyframes slideInRight {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                </style>
                <div style="flex: 1; overflow-y: auto;">
                    <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px;"><i class="ph ph-note-pencil"></i> 할 일 기록</h2>
                    <div style="margin-bottom: 1.5rem; font-size: 0.9rem; color: var(--text-muted); padding-bottom: 1rem; border-bottom: 1px dashed rgba(var(--tint),0.1);">
                        <div style="margin-bottom: 5px;"><strong>시즌:</strong> ${project.name}</div>
                        <div style="margin-bottom: 5px;"><strong>할 일:</strong> <span style="color: white;">${todo.text}</span></div>
                        <div style="margin-bottom: 5px;"><strong>마감일:</strong> ${todo.due_date ? this.formatDateToUI(todo.due_date) : '일정'}</div>
                    </div>
                    <div class="login-field" style="margin-top: 1rem;">
                        <label>메모/피드백</label>
                        <textarea id="todo-memo-text" class="login-input" placeholder="이 할 일에 대한 메모나 진행 상황을 우측 화면에서 넓게 확인하고 기입하세요." style="min-height: 300px; resize: vertical; line-height: 1.6; font-size: 0.95rem;">${todo.memo || ''}</textarea>
                    </div>
                </div>
                <div style="display: flex; gap: 1rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(var(--tint),0.1);">
                    <button id="todo-cancel" class="btn-secondary" style="flex: 1; padding: 1rem; border-radius: 12px; border: 1px solid var(--card-border);">닫기</button>
                    <button id="todo-save" class="btn-primary" style="flex: 1; padding: 1rem; border-radius: 12px;">저장</button>
                </div>
            </div>
        `;

        document.getElementById('todo-cancel').onclick = () => { sidebarContainer.style.display = 'none'; };
        document.getElementById('todo-save').onclick = () => {
            todo.memo = document.getElementById('todo-memo-text').value;
            sidebarContainer.style.display = 'none';
            this.showToast('할 일 메모가 저장되었습니다.');
            this.requestRender();
        };
    }

    canDelete(item) {
        if (!this.currentUser) return false;
        if (this.currentUser.role === 'MASTER' || this.currentUser.role === 'STAFF') return true;
        if (this.currentUser.role === 'CLIENT' && item && item.created_by === this.currentUser.id) return true;
        return false;
    }

    // 매출 집계 (홈·매출뷰 공용)
    //  · 판매 브랜드(malls→brand_id 로 매핑된 브랜드): 몰 주문 pay_amount
    //  · 브하스(컨설팅): 발행된 세금계산서(견적 tax_status='issued') 기준
    // 채널이 제공하는 상태값을 그대로 취합해 주문 상태 판정(추론 X)
    // 반환: 'pre'(배송전) | 'shipping'(배송중) | 'done'(배송완료) | 'cancel'(취소) | 'return'(반품) | 'exchange'(교환)
    _orderState(o) {
        const raw = o.raw || {};
        const isCafe24 = (o.channel || 'cafe24') === 'cafe24';
        if (isCafe24) {
            // 아이템 상태코드 우선(클레임): C=취소 R=반품 E=교환
            const codes = (raw.items || []).map(it => String(it.status || it.order_status || ''));
            if (codes.some(c => /^C/i.test(c))) return 'cancel';
            if (codes.some(c => /^R/i.test(c))) return 'return';
            if (codes.some(c => /^E/i.test(c))) return 'exchange';
            // 배송상태 F/M/T
            const ss = raw.shipping_status;
            if (ss === 'T') return 'done';
            if (ss === 'M') return 'shipping';
            if (ss === 'F') return 'pre';
            // 폴백: 아이템 N코드
            if (codes.some(c => /^N(4|5)/.test(c))) return 'done';
            if (codes.some(c => /^N3/.test(c))) return 'shipping';
            return 'pre';
        }
        // eland/키디키디 등 숫자코드: 2취소·3반품·4교환·1정상
        const cs = String(o.channel_status || '');
        if (/^2/.test(cs)) return 'cancel';
        if (/^3/.test(cs)) return 'return';
        if (/^4/.test(cs)) return 'exchange';
        return 'done';  // 정상건(세부 배송상태 미제공 → 완료 처리)
    }
    // 취소/반품만 매출에서 제외. 교환은 결제금액이 유지되므로 매출을 제거하면 안 된다.
    _isCancelled(o) { const s = this._orderState(o); return s === 'cancel' || s === 'return'; }
    // 환불(취소+반품 = 금액 환급)
    _isRefund(o) { const s = this._orderState(o); return s === 'cancel' || s === 'return'; }
    // 교환(금액 환급 없음)
    _isExchange(o) { return this._orderState(o) === 'exchange'; }

    // 매출 집계 — 서버(sales_monthly 뷰)에서 이미 집계된 결과로 구성.
    //  주문 전량(12,000건·6MB)을 내려받아 JS에서 돌리던 걸 대체. 집계본은 ~18KB.
    //  집계본이 아직 없으면(로딩 전·실패) 기존 클라이언트 집계로 폴백해서 화면이 비지 않게 한다.
    _salesAgg(limitMonths = 12) {
        const agg = this.salesAggData;
        if (agg && agg.monthly) return this._salesAggFromServer(limitMonths);
        return this._salesAggFromOrders(limitMonths);
    }

    _salesAggFromServer(limitMonths = 12) {
        const CANCELLED = new Set(['cancel', 'return']);
        const rows = this.salesAggData.monthly;
        // 브하스 컨설팅은 몰 주문이 아니라 견적/세금계산서 → 클라이언트에서 합류(견적은 건수가 적어 부담 없음)
        const quotes = (this.quotes || []).filter(q => q.total_amount);
        const anyIssued = quotes.some(q => q.tax_status === 'issued');
        const consulting = [];
        quotes.forEach(q => {
            if (anyIssued && q.tax_status !== 'issued') return;
            const d = q.tax_supply_date || q.quote_date; if (!d) return;
            consulting.push({ ym: kstYM(d), amt: Number(q.total_amount) || 0 });
        });

        // 매출이 아직 0원이어도 현재 월을 반드시 표시한다.
        let months = [...new Set([...rows.map(r => r.ym), ...consulting.map(c => c.ym), kstYM()])].sort();
        if (months.length > limitMonths) months = months.slice(-limitMonths);
        const monthIdx = Object.fromEntries(months.map((m, i) => [m, i]));

        const byBrand = {};
        const mk = (name, kind) => byBrand[name] || (byBrand[name] = {
            name, kind, cells: months.map(() => ({ amt: 0, cnt: 0 })), total: 0, cnt: 0,
        });
        rows.forEach(r => {
            if (!(r.ym in monthIdx) || CANCELLED.has(r.state)) return;   // 매출은 취소·반품·교환 제외
            const rec = mk(r.brand_name, 'order');
            const c = rec.cells[monthIdx[r.ym]];
            c.amt += Number(r.amt) || 0; c.cnt += r.cnt || 0;
            rec.total += Number(r.amt) || 0; rec.cnt += r.cnt || 0;
        });
        consulting.forEach(c => {
            if (!(c.ym in monthIdx)) return;
            const rec = mk('브하스 (컨설팅)', 'consulting');
            const cell = rec.cells[monthIdx[c.ym]];
            cell.amt += c.amt; cell.cnt += 1; rec.total += c.amt; rec.cnt += 1;
        });

        const brands = Object.values(byBrand).sort((a, b) => b.total - a.total);
        const monthTotals = months.map((_, i) => brands.reduce((s, b) => s + b.cells[i].amt, 0));
        const grand = monthTotals.reduce((s, x) => s + x, 0);
        const thisM = monthTotals[monthTotals.length - 1] || 0, prevM = monthTotals[monthTotals.length - 2] || 0;
        // orders/cancelledOrders 는 '선택 기간+브랜드'만 따로 받아온 슬라이스(상세 카드 전용). 없으면 빈 배열.
        const scoped = this.salesScoped || { orders: [], cancelled: [] };
        return {
            orders: scoped.orders, cancelledOrders: scoped.cancelled, events: [],
            months, monthIdx, brands, monthTotals, grand, thisM, prevM,
            mom: prevM ? Math.round((thisM - prevM) / prevM * 100) : null,
            consultingFromQuote: !anyIssued, hasSales: grand > 0, fromServer: true,
        };
    }

    _salesAggFromOrders(limitMonths = 12) {
        const ym = d => kstYM(d);
        const mallBrand = (o) => {
            const mall = (this.malls || []).find(m => m.mall_key === o.mall_key);
            if (mall) { const b = (mockData.brands || []).find(x => x.id === mall.brand_id); return b ? b.name : (mall.label || '기타'); }
            return o.mall_key || o.channel || '기타';
        };
        const srcOrders = (this.salesOrders && this.salesOrders.length) ? this.salesOrders : (this.orders || []);
        const allOrders = srcOrders.filter(o => o.order_date && o.pay_amount != null);
        // 교환은 결제금액이 유지되는 정상 매출이다.
        const orders = allOrders.filter(o => !this._isCancelled(o));
        const cancelledOrders = allOrders.filter(o => this._isCancelled(o));
        const events = [];
        orders.forEach(o => events.push({ m: ym(o.order_date), brand: mallBrand(o), amt: Number(o.pay_amount) || 0, kind: 'order' }));
        // 브하스 컨설팅 = 실현 매출(세금계산서 발행분). 발행 데이터 없으면 견적 총액으로 폴백.
        const quotes = (this.quotes || []).filter(q => q.total_amount);
        const anyIssued = quotes.some(q => q.tax_status === 'issued');
        quotes.forEach(q => {
            if (anyIssued && q.tax_status !== 'issued') return;
            const d = q.tax_supply_date || q.quote_date; if (!d) return;
            events.push({ m: ym(d), brand: '브하스 (컨설팅)', amt: Number(q.total_amount) || 0, kind: 'consulting' });
        });

        let months = [...new Set([...events.map(e => e.m), kstYM()])].sort();
        if (months.length > limitMonths) months = months.slice(-limitMonths);
        const monthIdx = Object.fromEntries(months.map((m, i) => [m, i]));
        const byBrand = {};
        events.forEach(e => {
            if (!(e.m in monthIdx)) return;
            const rec = byBrand[e.brand] || (byBrand[e.brand] = { name: e.brand, kind: e.kind, cells: months.map(() => ({ amt: 0, cnt: 0 })), total: 0, cnt: 0 });
            rec.cells[monthIdx[e.m]].amt += e.amt; rec.cells[monthIdx[e.m]].cnt += 1; rec.total += e.amt; rec.cnt += 1;
        });
        const brands = Object.values(byBrand).sort((a, b) => b.total - a.total);
        const monthTotals = months.map((_, i) => brands.reduce((s, b) => s + b.cells[i].amt, 0));
        const grand = monthTotals.reduce((s, x) => s + x, 0);
        const thisM = monthTotals[monthTotals.length - 1] || 0, prevM = monthTotals[monthTotals.length - 2] || 0;
        const mom = prevM ? Math.round((thisM - prevM) / prevM * 100) : null;
        return { orders, cancelledOrders, events, months, monthIdx, brands, monthTotals, grand, thisM, prevM, mom, consultingFromQuote: !anyIssued, hasSales: orders.length > 0, fromServer: false };
    }

    // 홈 대시보드 클릭 팝오버 — 카드/박스/행을 누르면 간략 세부를 말풍선으로.
    //  각 요소는 onclick="app._pop(event,'KEY')"; 내용은 renderHome에서 this._homePops에 미리 채운다.
    _pop(evt, key, reg) {
        try { evt.stopPropagation(); } catch (_e) {}
        const data = (reg || this._homePops || {})[key];
        if (!data) return;
        document.getElementById('_hpop')?.remove();
        const el = document.createElement('div');
        el.id = '_hpop';
        el.className = 'glass';
        el.style.cssText = 'position:fixed;z-index:99999;max-width:300px;min-width:210px;padding:13px 15px;border-radius:13px;box-shadow:0 10px 40px rgba(0,0,0,0.28);border:1px solid var(--card-border)';
        el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px"><span style="font-weight:800;font-size:0.9rem">${data.title}</span><span id="_hpopx" style="cursor:pointer;color:var(--text-muted);font-size:1.1rem;line-height:1">×</span></div><div style="font-size:0.8rem">${data.rows}</div>${data.link ? `<div style="margin-top:9px;text-align:right"><span style="font-size:0.76rem;color:var(--primary);cursor:pointer" onclick="${data.link.action}">${data.link.label} →</span></div>` : ''}`;
        document.body.appendChild(el);
        const px = (typeof evt.clientX === 'number' ? evt.clientX : window.innerWidth / 2);
        const py = (typeof evt.clientY === 'number' ? evt.clientY : window.innerHeight / 2);
        const w = el.offsetWidth, h = el.offsetHeight;
        el.style.left = Math.max(12, Math.min(px - w / 2, window.innerWidth - w - 12)) + 'px';
        el.style.top = Math.max(12, Math.min(py + 14, window.innerHeight - h - 12)) + 'px';
        const close = (e) => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); } };
        const esc = (e) => { if (e.key === 'Escape') { el.remove(); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); } };
        el.querySelector('#_hpopx').onclick = () => { el.remove(); document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
        setTimeout(() => { document.addEventListener('mousedown', close); document.addEventListener('keydown', esc); }, 0);
    }

    // 채널 "수집 실태" 팩트 판정 — malls.connected(인증 플래그)가 아니라
    //  실제 최근 주문일 / last_order_synced_at(수집기 heartbeat) 중 더 최근 신호로 판정.
    //  반환: { color, label, sub } · 없으면 null.
    _channelStatus(mall) {
        if (!mall) return null;
        // 두 축을 분리한다: (1) 수집기 건강 = last_order_synced_at(sync_log heartbeat)  (2) 주문 유무 = 마지막 주문일.
        //  주문이 없는 것과 수집이 끊긴 것은 별개 — 배지는 (1) 수집기 건강을 우선 판정하고, 주문 정보는 부가표기.
        const hb = mall.last_order_synced_at ? new Date(mall.last_order_synced_at).getTime() : 0;
        let lastOrder = 0;
        (this.orders || []).forEach(o => { if (o.mall_key === mall.mall_key && o.order_date) { const d = new Date(o.order_date).getTime(); if (d > lastOrder) lastOrder = d; } });
        const orderSub = lastOrder
            ? (() => { const ms = Date.now() - lastOrder, h = Math.floor(ms / 3600000), d = Math.floor(ms / 86400000); return h < 1 ? '주문 방금' : h < 24 ? `최근주문 ${h}시간 전` : `최근주문 ${d}일 전`; })()
            : '주문 없음';
        if (hb) {
            const ms = Date.now() - hb, hours = ms / 3600000, days = Math.floor(ms / 86400000);
            if (hours <= 2) return { color: '#22c55e', label: '수집중', sub: orderSub };          // 수집기 정상(방금 돌음) — 주문 유무만 부가표기
            if (days <= 2) return { color: '#f59e0b', label: '수집 지연', sub: `수집기 ${days || 1}일째 멈춤` };
            return { color: '#ef4444', label: '수집 중단', sub: `수집기 ${days}일 전 마지막` };      // 진짜 수집 끊김
        }
        // heartbeat 정보 없음(수집 이력 자체가 없음) → 주문 기준 폴백
        if (!lastOrder) return { color: '#94a3b8', label: '수집 없음', sub: '수집 이력 없음' };
        return { color: '#94a3b8', label: '수집 이력 없음', sub: orderSub };
    }

    renderHome(products) {
        products = products || mockData.products || [];
        this._homePops = {};   // 클릭 팝오버 내용 레지스트리(요소별 KEY→{title,rows,link})
        const name = this.currentUser?.name || '';
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dday = d => { if (!d) return null; const dt = new Date(d); dt.setHours(0, 0, 0, 0); return Math.round((dt - today) / 86400000); };
        const activeProjects = products.filter(p => (p.currentStage || 'consulting') !== 'shipping').length;
        const orders = this.orders || [];
        const shipTargets = orders.filter(o => o.status === 'new' || o.status === 'ready').length;
        const recentOrders = orders.slice(0, 5);
        const vendors = this.vendors || [];
        const vjobs = vendors.flatMap(v => (v.jobs || []).map(j => ({ ...j, _v: v.name })));
        const activeJobs = vjobs.filter(j => j.status !== 'done');
        const quotes = this.quotes || [];
        const thisMonth = kstYM();
        const monthTotal = quotes.filter(q => (q.quote_date || '').startsWith(thisMonth)).reduce((s, q) => s + (q.total_amount || 0), 0);
        const recentQuotes = quotes.slice(0, 5);
        const malls = (this.malls || []).filter(m => (m.channel || 'cafe24') === 'cafe24');
        const mallsConn = malls.filter(m => m.connected).length;

        const kpi = (icon, num, label, color) => `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:16px;display:flex;align-items:center;gap:14px">
            <div style="width:46px;height:46px;border-radius:13px;display:grid;place-items:center;font-size:1.5rem;color:${color};background:${color}22;flex-shrink:0"><i class="ph ${icon}"></i></div>
            <div style="min-width:0"><div style="font-size:1.6rem;font-weight:800;line-height:1;color:var(--text-main)">${num}</div><div style="font-size:0.8rem;color:var(--text-muted);margin-top:3px">${label}</div></div>
        </div>`;
        const listCard = (title, icon, rows, empty) => `<div class="glass" style="padding:1.3rem 1.4rem;border-radius:16px">
            <div style="font-size:0.95rem;font-weight:700;margin-bottom:0.9rem;display:flex;align-items:center;gap:7px"><i class="ph ${icon}" style="color:var(--primary)"></i> ${title}</div>
            ${rows || `<div style="color:var(--text-muted);font-size:0.85rem;padding:0.5rem 0">${empty}</div>`}
        </div>`;
        // 주문의 채널·브랜드 라벨
        const CHCOL = { '카페24': '#3b82f6', '키디키디': '#f59e0b', '스마트스토어': '#10b981', '무신사': '#111827', '29CM': '#6b7280' };
        const channelOf = (o) => {
            const mk = (o.mall_key || '').toLowerCase();
            if (mk === '29cm') return '29CM';
            if (mk === 'kidikidi') return '키디키디';
            if (mk === 'smartstore') return '스마트스토어';
            if (mk === 'musinsa') return '무신사';
            const ch = (o.channel || 'cafe24').toLowerCase();
            return ({ cafe24: '카페24', eland: '키디키디', naver: '스마트스토어', musinsa: '무신사' })[ch] || (ch || '카페24');
        };
        const brandOf = (o) => {
            const mall = (this.malls || []).find(m => m.mall_key === o.mall_key);
            if (mall) { const b = (mockData.brands || []).find(x => x.id === mall.brand_id); return b ? b.name : (mall.label || null); }
            return null;
        };
        const chip = (txt, color) => `<span style="font-size:0.66rem;font-weight:700;padding:1px 7px;border-radius:8px;background:${color}22;color:${color};white-space:nowrap">${txt}</span>`;
        const orderRows = recentOrders.map(o => {
            const ch = channelOf(o), br = brandOf(o), col = CHCOL[ch] || '#6366f1';
            const d = o.order_date ? new Date(o.order_date).toLocaleDateString('ko-KR') : '';
            return `<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--card-border);font-size:0.85rem">
                <div style="min-width:0;display:flex;flex-direction:column;gap:4px">
                    <div style="display:flex;align-items:center;gap:6px">${chip(ch, col)}${br ? `<span style="font-size:0.72rem;color:var(--text-muted)">${this._vesc(br)}</span>` : ''}</div>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(o.receiver_name || o.buyer_name || '-')} · ${this._vesc(this._orderItemsSummary(o))}</span>
                </div>
                <span style="color:var(--text-muted);white-space:nowrap;align-self:flex-end">${d}</span>
            </div>`;
        }).join('');
        const quoteRows = recentQuotes.map(q => `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--card-border);font-size:0.85rem"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(q.client_name)}</span><span style="font-weight:700;white-space:nowrap">${this._won(q.total_amount)}원</span></div>`).join('');
        const jobRows = activeJobs.filter(j => j.due_date).sort((a, b) => new Date(a.due_date) - new Date(b.due_date)).slice(0, 5).map(j => { const dd = dday(j.due_date); const col = dd < 0 ? '#ef4444' : (dd <= 3 ? '#f59e0b' : 'var(--text-muted)'); return `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--card-border);font-size:0.85rem"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(j.title)} · ${this._vesc(j._v)}</span><span style="color:${col};font-weight:700;white-space:nowrap">${dd < 0 ? `지연${-dd}` : (dd === 0 ? '오늘' : `D-${dd}`)}</span></div>`; }).join('');

        // 매출 위젯 (홈)
        const sa = this._salesAgg(6);
        const maxM = Math.max(1, ...sa.monthTotals);
        // 집계본 기반이면 orders는 비어 있으므로 hasSales(총 매출>0)로 판단
        const salesCard = (sa.hasSales ?? sa.orders.length) ? `
            <div class="glass" style="padding:1.3rem 1.4rem;border-radius:16px;margin-bottom:1.5rem;cursor:pointer" onclick="app.switchView('sales')">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
                    <div style="font-size:0.95rem;font-weight:700;display:flex;align-items:center;gap:7px"><i class="ph ph-chart-line-up" style="color:var(--primary)"></i> 매출 현황</div>
                    <span style="font-size:0.8rem;color:var(--primary);font-weight:600">브랜드별 상세 →</span>
                </div>
                <div style="display:flex;gap:1.6rem;flex-wrap:wrap;align-items:flex-end">
                    <div style="min-width:130px">
                        <div style="font-size:0.76rem;color:var(--text-muted)">이번 달 매출</div>
                        <div style="font-size:1.5rem;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1">${this._won(sa.thisM)}<span style="font-size:0.9rem;font-weight:600">원</span></div>
                        ${sa.mom != null ? `<div style="font-size:0.75rem;font-weight:600;color:${sa.mom >= 0 ? '#10b981' : '#ef4444'}">전월 대비 ${sa.mom >= 0 ? '+' : ''}${sa.mom}%</div>` : ''}
                    </div>
                    <div style="flex:1;min-width:210px;display:flex;align-items:flex-end;gap:6px;height:72px">
                        ${sa.months.map((m, i) => { const h = Math.round(sa.monthTotals[i] / maxM * 60); const cur = i === sa.months.length - 1; return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:0"><div style="width:100%;max-width:34px;height:${Math.max(2, h)}px;background:${cur ? 'var(--primary)' : 'rgba(99,102,241,0.4)'};border-radius:4px 4px 0 0"></div><div style="font-size:0.66rem;color:var(--text-muted)">${+m.split('-')[1]}월</div></div>`; }).join('')}
                    </div>
                    <div style="min-width:160px">
                        <div style="font-size:0.76rem;color:var(--text-muted);margin-bottom:5px">브랜드 TOP</div>
                        ${sa.brands.slice(0, 3).map((b, i) => `<div style="display:flex;justify-content:space-between;gap:8px;font-size:0.8rem;padding:2px 0"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${['🥇', '🥈', '🥉'][i]} ${this._vesc(b.name)}</span><span style="font-weight:700;font-variant-numeric:tabular-nums">${this._won(b.total)}</span></div>`).join('') || '<span style="color:var(--text-muted);font-size:0.8rem">-</span>'}
                    </div>
                </div>
            </div>` : '';

        // ============================================================
        //  대시보드 — 블록1 매출·주문 / 블록2 생산 업무(캘린더)
        // ============================================================
        const won = n => this._won(n);
        const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
        const notCancelled = o => !this._isCancelled(o);
        const localYMD = d => { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`; };
        const todayStr = localYMD(today);
        const monthKey = todayStr.slice(0, 7);
        const mm = today.getMonth() + 1;

        // ── 마지막 동기화 시각(몰 수집기 last_order_synced_at 최신값) ──
        const syncTimes = (this.malls || []).map(m => m.last_order_synced_at).filter(Boolean).map(t => new Date(t).getTime());
        const lastSync = syncTimes.length ? Math.max(...syncTimes) : null;
        const syncMins = lastSync != null ? Math.floor((Date.now() - lastSync) / 60000) : null;
        const syncAgoTxt = syncMins == null ? '동기화 정보 없음'
            : syncMins < 1 ? '방금 동기화'
                : syncMins < 60 ? `${syncMins}분 전 동기화`
                    : `${Math.floor(syncMins / 60)}시간 ${syncMins % 60}분 전 동기화`;
        const syncColor = syncMins == null ? 'var(--text-muted)' : (syncMins <= 15 ? '#10b981' : (syncMins <= 70 ? '#f59e0b' : '#ef4444'));
        const syncBadge = `<span style="font-size:0.72rem;color:${syncColor};font-weight:600"><i class="ph ph-arrows-clockwise"></i> ${syncAgoTxt}</span>`;

        // ── 금액: 서버 재무집계 우선. 주문/실결제/환불/순매출을 한 금액으로 섞지 않는다. ──
        const financialDaily = this.salesAggData?.financialDaily || [];
        const financialFor = (from, to) => financialDaily.filter(r => r.d >= from && r.d <= to).reduce((a, r) => ({
            order: a.order + (Number(r.order_amount) || 0),
            paid: a.paid + (Number(r.actual_paid_amount) || 0),
            refund: a.refund + (Number(r.refund_amount) || 0),
            net: a.net + (Number(r.net_sales_amount) || 0),
            count: a.count + (Number(r.order_count) || 0),
        }), { order: 0, paid: 0, refund: 0, net: 0, count: 0 });
        const revOrders = (this.orders || []).filter(o => o.order_date && o.pay_amount != null && notCancelled(o));
        const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6);
        const sumBetween = (from, to) => revOrders.filter(o => { const d = localYMD(o.order_date); return d >= from && d <= to; }).reduce((s, o) => s + Number(o.pay_amount || 0), 0);
        const hasFinancial = financialDaily.length > 0;
        const todayFinancial = financialFor(todayStr, todayStr);
        const weekFinancial = financialFor(localYMD(weekAgo), todayStr);
        const monthFinancial = financialFor(monthKey + '-01', todayStr);
        const todaySales = hasFinancial ? todayFinancial.net : sumBetween(todayStr, todayStr);
        const weekSales = hasFinancial ? weekFinancial.net : sumBetween(localYMD(weekAgo), todayStr);
        const monthSales = hasFinancial ? monthFinancial.net : sumBetween(monthKey + '-01', todayStr);

        // ── 브랜드별 / 채널별 (이번달) ──
        const monthRev = revOrders.filter(o => localYMD(o.order_date).startsWith(monthKey));
        const groupSum = keyFn => { const m = {}; monthRev.forEach(o => { const k = keyFn(o) || '기타'; m[k] = (m[k] || 0) + Number(o.pay_amount || 0); }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
        // ⚠️ 브랜드별 매출은 this.orders(최신 500건)가 아니라 서버 집계(sa.brands, 전량)에서 뽑는다.
        //   하이헤이호가 하루 수백 건씩 들어와 최신 500건을 독점하면 로하이·토비가 500위 밖으로 밀려 사라졌었다.
        const _miB = (sa && sa.monthIdx) ? sa.monthIdx[monthKey] : undefined;
        const brandArr = (sa && sa.fromServer && Array.isArray(sa.brands) && _miB != null)
            ? sa.brands.filter(b => b.kind === 'order').map(b => [b.name, (b.cells[_miB] && b.cells[_miB].amt) || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1])
            : groupSum(o => brandOf(o) || o.channel);
        const brandColor = {}; brandArr.forEach(([b], i) => brandColor[b] = palette[i % palette.length]);
        // 채널별은 항상 5개 고정 표시(0원도) — 카페24·키디키디·29CM·스마트스토어·기타
        const CHAN_FIXED = ['카페24', '키디키디', '29CM', '스마트스토어', '기타'];
        const _platDisp = p => ({ cafe24: '카페24', kidikidi: '키디키디', '29cm': '29CM', smartstore: '스마트스토어' })[String(p || '').toLowerCase()] || '기타';
        // 채널×브랜드 이번달 매출도 서버 집계(brandChannel, 전량)에서. this.orders(500건)면 로하이·토비가 사라진다.
        const chanBrand = {}; CHAN_FIXED.forEach(c => chanBrand[c] = {});
        const _useAggCh = this.salesAggData && Array.isArray(this.salesAggData.brandChannel) && this.salesAggData.brandChannel.length > 0;
        if (_useAggCh) {
            this.salesAggData.brandChannel.filter(r => r.ym === monthKey && r.state !== 'cancel' && r.state !== 'return')
                .forEach(r => { const c = _platDisp(r.platform), b = r.brand_name || '기타'; chanBrand[c][b] = (chanBrand[c][b] || 0) + Number(r.amt || 0); });
        } else {
            monthRev.forEach(o => { let c = channelOf(o); if (!CHAN_FIXED.includes(c)) c = '기타'; const b = brandOf(o) || '기타'; chanBrand[c][b] = (chanBrand[c][b] || 0) + Number(o.pay_amount || 0); });
        }
        const chanFixed = Object.fromEntries(CHAN_FIXED.map(c => [c, Object.values(chanBrand[c]).reduce((s, v) => s + v, 0)]));
        const chanArr = CHAN_FIXED.map(c => [c, chanFixed[c]]);
        const brandMax = Math.max(1, ...brandArr.map(x => x[1]));
        const chanMax = Math.max(1, ...chanArr.map(x => x[1]));
        const barBlock = (arr, max, colorFn) => arr.length ? arr.map(([l, amt], i) => { const on = amt > 0; const c = on ? colorFn(i, l) : 'rgba(148,163,184,0.4)'; return `<div style="margin-bottom:0.55rem">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:0.81rem;margin-bottom:3px"><span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${on ? 'var(--text-main)' : 'var(--text-muted)'}">${this._vesc(l)}</span><span style="font-weight:800;font-variant-numeric:tabular-nums;color:${on ? 'var(--text-main)' : 'var(--text-muted)'}">${on ? won(amt) + '원' : '—'}</span></div>
            <div style="height:8px;border-radius:5px;background:rgba(148,163,184,0.14)"><div style="height:100%;width:${on ? Math.max(3, amt / max * 100) : 0}%;background:${c};border-radius:5px"></div></div>
        </div>`; }).join('') : '<div style="color:var(--text-muted);font-size:0.8rem;padding:0.6rem 0">이번달 매출 없음</div>';

        // ── 주문 상태: 주문(배송 시작 전) / 배송중 / 교환 / 환불 (전체 기간 기준) ──
        // 채널 제공 상태 그대로 집계. 배송전/배송중=실제 미출고(전체 운영), 교환/환불=이번달.
        // 서버 집계본(order_state_totals: 전체기간 상태별 / sales_monthly: 이번달 교환·환불) 우선.
        // 집계본이 없으면 기존처럼 로드된 주문에서 계산(폴백).
        let stOrder, stShip, stExchange, stRefund, refundTotal;
        const agg = this.salesAggData;
        if (agg?.stateTotals && agg?.monthly) {
            const sum = (st) => agg.stateTotals.filter(r => r.state === st).reduce((s, r) => s + (r.cnt || 0), 0);
            stOrder = sum('pre'); stShip = sum('shipping');
            const mo = agg.monthly.filter(r => r.ym === monthKey);
            stExchange = mo.filter(r => r.state === 'exchange').reduce((s, r) => s + (r.cnt || 0), 0);
            const ref = mo.filter(r => r.state === 'cancel' || r.state === 'return');
            stRefund = ref.reduce((s, r) => s + (r.cnt || 0), 0);
            refundTotal = hasFinancial ? monthFinancial.refund : ref.reduce((s, r) => s + (Number(r.refund_amount) || 0), 0);
        } else {
            const allO = (this.salesOrders && this.salesOrders.length) ? this.salesOrders : (this.orders || []);
            const inThisMonth = o => localYMD(o.order_date).startsWith(monthKey);
            const stateOf = new Map();
            const st = o => { let s = stateOf.get(o); if (s === undefined) { s = this._orderState(o); stateOf.set(o, s); } return s; };
            stOrder = allO.filter(o => st(o) === 'pre').length;
            stShip = allO.filter(o => st(o) === 'shipping').length;
            const monthO = allO.filter(inThisMonth);
            stExchange = monthO.filter(o => st(o) === 'exchange').length;
            const refundO = monthO.filter(o => st(o) === 'cancel' || st(o) === 'return');
            stRefund = refundO.length;
            refundTotal = refundO.reduce((s, o) => s + (Number(o.refund_amount) || 0), 0);
        }

        // ── 최근 주문 표 (브랜드·주문내용·가격·채널·고객명) ──
        const stateLabel = { pre: '배송전', shipping: '배송중', done: '배송완료', cancel: '취소', return: '반품', exchange: '교환' };
        const recentCompact = (this.orders || []).slice(0, 40).map((o, _oi) => {
            const ch = channelOf(o), br = brandOf(o) || '-', bcol = brandColor[br] || CHCOL[ch] || '#6366f1', ccol = CHCOL[ch] || '#6366f1';
            const stt = this._orderState(o);
            const _od = o.order_date ? new Date(o.order_date) : null;
            const dtStr = _od ? `${_od.getMonth() + 1}/${_od.getDate()} ${String(_od.getHours()).padStart(2, '0')}:${String(_od.getMinutes()).padStart(2, '0')}` : '';
            this._homePops['ord_' + _oi] = { title: this._vesc(br) + ' · 주문', rows:
                `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0"><span style="color:var(--text-muted)">채널</span><b>${ch}</b></div>` +
                `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0"><span style="color:var(--text-muted)">주문일</span><b>${o.order_date ? localYMD(o.order_date) : '-'}</b></div>` +
                `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0"><span style="color:var(--text-muted)">고객</span><b>${this._vesc(o.receiver_name || o.buyer_name || '-')}</b></div>` +
                `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0"><span style="color:var(--text-muted)">결제</span><b>${won(o.pay_amount || 0)}원</b></div>` +
                `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0"><span style="color:var(--text-muted)">상태</span><b>${stateLabel[stt] || stt || '-'}</b></div>` +
                `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--card-border);color:var(--text-muted)">${this._vesc(this._orderItemsSummary(o))}</div>`,
                link: { label: '주문 전체', action: "app.switchView('orders')" } };
            return `<div onclick="app._pop(event,'ord_${_oi}')" style="padding:7px 0 7px 10px;border-top:1px solid var(--card-border);border-left:3px solid ${bcol};margin-left:1px;cursor:pointer">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:3px">
                    <span style="display:flex;align-items:baseline;gap:6px;min-width:0;flex:1">
                        <span style="font-size:0.77rem;font-weight:700;color:${bcol};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(br)}</span>
                        <span style="font-size:0.64rem;color:var(--text-muted);font-weight:500;white-space:nowrap">${dtStr}</span>
                    </span>
                    ${chip(ch, ccol)}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-size:0.78rem">
                    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)">${this._vesc(this._orderItemsSummary(o))}</span>
                    <span style="font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap">${won(o.pay_amount || 0)}원</span>
                    <span style="color:var(--text-muted);white-space:nowrap;max-width:60px;overflow:hidden;text-overflow:ellipsis">${this._vesc(o.receiver_name || o.buyer_name || '-')}</span>
                </div>
            </div>`;
        }).join('') || '<div style="color:var(--text-muted);font-size:0.8rem;padding:10px 0">주문 없음</div>';

        // ── 모든 일정 한 벌 — 할 일·메모 체크·생산 작업·시즌 마감 ──
        const allDue = this._allDated();
        // ── 이번달 캘린더 ──
        const yy = today.getFullYear(), moIdx = today.getMonth();
        const daysIn = new Date(yy, moIdx + 1, 0).getDate();
        const firstDow = new Date(yy, moIdx, 1).getDay();
        const jobsByDay = {};
        allDue.forEach(x => {
            if (!x.date) return;
            const d = new Date(x.date);
            if (d.getFullYear() === yy && d.getMonth() === moIdx) (jobsByDay[d.getDate()] ||= []).push(x);
        });
        const remList = (() => {
            const t = new Date().toISOString().slice(0, 10);
            //  할 일은 '체크해서 끝내는 것' 만. 생산 작업·시즌 마감은 캘린더에만 둔다.
            const open = allDue.filter(x => !x.done && ['rem', 'todo', 'note', 'step'].includes(x.kind)).sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')));
            const soon = open.filter(x => x.date && x.date <= t).concat(open.filter(x => !x.date || x.date > t)).slice(0, 12);
            if (!soon.length) return '<div style="color:var(--text-muted);font-size:0.82rem;padding:1rem 0;text-align:center">할 일을 넣으면 여기 모입니다</div>';
            return soon.map(x => {
                const dd = dday(x.date);
                const col = dd == null ? 'var(--text-muted)' : (dd < 0 ? '#ef4444' : (dd === 0 ? '#0a84ff' : (dd <= 3 ? '#f59e0b' : 'var(--text-muted)')));
                const go = x.go || `app.switchView('${x.view || 'reminders'}')`;
                return `<div class="due-row" onclick="${go}" title="눌러서 열기">
                    <span class="due-dot" style="background:${x.color}"></span>
                    ${x.kind === 'rem' ? '' : `<span class="due-tag" style="color:${x.color};background:${x.color}1f">${this._vesc(x.tag || '')}</span>`}
                    <span class="due-t">${this._vesc(x.title)}${x.sub ? ` · <span style="color:var(--text-muted)">${this._vesc(x.sub)}</span>` : ''}</span>
                    ${x.date ? `<span style="color:${col};font-weight:700;white-space:nowrap">${dd < 0 ? `지연${-dd}` : (dd === 0 ? '오늘' : `D-${dd}`)}</span>`
                             : `<span style="color:var(--text-muted);font-size:.72rem;white-space:nowrap">날짜 없음</span>`}
                </div>`;
            }).join('');
        })();
        const dow = ['일', '월', '화', '수', '목', '금', '토'];
        let calCells = '';
        for (let i = 0; i < firstDow; i++) calCells += '<div></div>';
        for (let d = 1; d <= daysIn; d++) {
            const jobs = jobsByDay[d] || [];
            const isToday = d === today.getDate();
            calCells += `<div style="min-height:54px;border:1px solid var(--card-border);border-radius:8px;padding:3px 4px;${isToday ? 'background:rgba(99,102,241,0.09);border-color:var(--primary)' : ''}">
                <div style="font-size:0.68rem;font-weight:${isToday ? '800' : '500'};color:${isToday ? 'var(--primary)' : 'var(--text-muted)'}">${d}</div>
                ${jobs.slice(0, 2).map(x => `<div title="${this._vesc(x.title)}" style="font-size:0.6rem;background:${x.color};color:#fff;border-radius:4px;padding:1px 4px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(x.title)}</div>`).join('')}
                ${jobs.length > 2 ? `<div style="font-size:0.58rem;color:var(--text-muted);margin-top:1px">+${jobs.length - 2}</div>` : ''}
            </div>`;
        }
        const calendar = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">
            ${dow.map((n, i) => `<div style="text-align:center;font-size:0.68rem;font-weight:700;padding-bottom:3px;color:${i === 0 ? '#ef4444' : 'var(--text-muted)'}">${n}</div>`).join('')}
            ${calCells}
        </div>`;

        // 헬퍼: 큰 숫자 타일 / 상태 타일 / 패널
        const bigStat = (label, val, unit, accent, onclick) => `<div class="glass" style="padding:1rem 1.2rem;border-radius:14px;border-top:3px solid ${accent};${onclick ? 'cursor:pointer' : ''}"${onclick ? ` onclick="${onclick}"` : ''}>
            <div style="font-size:0.76rem;color:var(--text-muted);font-weight:600">${label}</div>
            <div style="font-size:1.65rem;font-weight:800;line-height:1.2;font-variant-numeric:tabular-nums;margin-top:2px">${val}<span style="font-size:0.8rem;font-weight:600">${unit}</span></div>
        </div>`;
        const statTile = (label, n, color) => `<div class="glass" style="padding:1rem 1.2rem;border-radius:14px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="app.switchView('orders')">
            <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
            <div><div style="font-size:1.5rem;font-weight:800;line-height:1;font-variant-numeric:tabular-nums">${n.toLocaleString()}<span style="font-size:0.78rem;font-weight:600">건</span></div><div style="font-size:0.76rem;color:var(--text-muted);margin-top:3px">${label}</div></div>
        </div>`;
        const sectionHead = (icon, title, sub) => `<div style="display:flex;align-items:baseline;gap:10px;margin:1.6rem 0 0.85rem">
            <h2 style="margin:0;font-size:1.1rem;display:flex;align-items:center;gap:8px"><i class="ph ${icon}" style="color:var(--primary)"></i>${title}</h2>
            ${sub ? `<span style="font-size:0.78rem;color:var(--text-muted)">${sub}</span>` : ''}</div>`;
        const panel = (title, bodyHTML, right, fill) => `<div class="glass${fill ? ' pfill' : ''}" style="padding:1.1rem 1.25rem;border-radius:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0.55rem;margin-bottom:0.85rem;border-bottom:2px solid var(--card-border)"><span style="font-size:0.94rem;font-weight:800;color:var(--text-main)">${title}</span>${right || ''}</div>${fill ? `<div class="pfill-b">${bodyHTML}</div>` : bodyHTML}</div>`;

        // ── BI 스타일: 스파크라인 · KPI카드 · 도넛 · 일별차트 ──
        const daysBackSeries = fn => { const a = []; for (let i = 13; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); a.push(fn(localYMD(d))); } return a; };
        const salesSpark = daysBackSeries(ds => sumBetween(ds, ds));
        const orderSpark = daysBackSeries(ds => revOrders.filter(o => localYMD(o.order_date) === ds).length);
        const yStr = localYMD(new Date(today.getTime() - 864e5));
        const ydaySales = sumBetween(yStr, yStr);
        const todayDelta = ydaySales ? Math.round((todaySales - ydaySales) / ydaySales * 100) : null;
        const pwFrom = new Date(today); pwFrom.setDate(pwFrom.getDate() - 13);
        const pwTo = new Date(today); pwTo.setDate(pwTo.getDate() - 7);
        const prevWeekSales = sumBetween(localYMD(pwFrom), localYMD(pwTo));
        const weekDelta = prevWeekSales ? Math.round((weekSales - prevWeekSales) / prevWeekSales * 100) : null;
        const monthOrdersCnt = monthRev.length;
        const monthDaily = Array(daysIn).fill(0);
        monthRev.forEach(o => { const dt = new Date(o.order_date); if (dt.getMonth() === moIdx) monthDaily[dt.getDate() - 1] += Number(o.pay_amount || 0); });
        const mdMax = Math.max(1, ...monthDaily);
        const spark = (vals, color) => { const w = 130, h = 36; if (!vals.some(v => v > 0)) return `<svg width="${w}" height="${h}" style="width:100%;max-width:${w}px"></svg>`; const max = Math.max(...vals, 1), n = vals.length; const X = i => (n <= 1 ? w : i / (n - 1) * w); const Y = v => h - 4 - (v / max) * (h - 9); const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(''); const gid = 'sg' + color.replace('#', ''); return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;width:100%;max-width:${w}px"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.3"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${line}L${w},${h}L0,${h}Z" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`; };
        const deltaBadge = (pct, ref) => pct == null ? `<span style="font-size:0.68rem;color:var(--text-muted)">${ref} 기준 없음</span>` : `<span style="font-size:0.68rem;font-weight:700;color:${pct >= 0 ? '#16a34a' : '#dc2626'};background:${pct >= 0 ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)'};padding:2px 7px;border-radius:6px;white-space:nowrap">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% ${ref}</span>`;
        const kpiCard = (label, big, unit, badge, color, nav) => `<div class="glass" style="padding:1rem 1.15rem;border-radius:16px${nav ? ';cursor:pointer' : ''}"${nav ? ` onclick="app.switchView('${nav}')"` : ''}>
            <div style="font-size:0.76rem;color:var(--text-muted);font-weight:600">${label}</div>
            <div style="font-size:1.5rem;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.15;margin-top:4px;white-space:nowrap">${big}<span style="font-size:0.72rem;font-weight:600">${unit}</span></div>
            <div style="margin-top:6px">${badge}</div>
        </div>`;
        const donut = (entries, colors) => { const size = 116, r = size / 2 - 9, cx = size / 2, cy = size / 2, circ = 2 * Math.PI * r; const total = entries.reduce((s, e) => s + e[1], 0) || 1; let off = 0; const segs = entries.map(([l, v], i) => { const frac = v / total; const s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="15" stroke-dasharray="${Math.max(0, frac * circ - 1.5).toFixed(1)} ${circ.toFixed(1)}" stroke-dashoffset="${(-off * circ).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`; off += frac; return s; }).join(''); return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="flex-shrink:0">${segs}</svg>`; };
        const brandLegend = brandArr.length ? brandArr.map(([l, v], i) => `<div style="display:flex;align-items:center;gap:7px;font-size:0.8rem;padding:3px 0"><span style="width:9px;height:9px;border-radius:2px;background:${palette[i % palette.length]};flex-shrink:0"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(l)}</span><b style="font-variant-numeric:tabular-nums">${won(v)}</b></div>`).join('') : '<span style="color:var(--text-muted);font-size:0.8rem">이번달 매출 없음</span>';
        const barChart = `<div style="display:flex;align-items:flex-end;gap:2px;height:110px">${monthDaily.map((v, i) => { const h = v / mdMax * 100; const isT = (i + 1) === today.getDate(); return `<div style="flex:1;min-width:2px;background:${isT ? '#6366f1' : 'rgba(99,102,241,0.32)'};height:${Math.max(2, h)}%;border-radius:2px 2px 0 0"></div>`; }).join('')}</div><div style="display:flex;justify-content:space-between;font-size:0.66rem;color:var(--text-muted);margin-top:5px"><span>1일</span><span>오늘 ${mm}/${today.getDate()}</span><span>${daysIn}일</span></div>`;

        // 채널별 스택바(브랜드 색상 비율) — chanBrand는 위에서 서버집계로 계산됨
        const chanTot = c => Object.values(chanBrand[c]).reduce((s, v) => s + v, 0);
        const chanMaxT = Math.max(1, ...CHAN_FIXED.map(chanTot));
        const chanStacked = CHAN_FIXED.map(c => { const total = chanTot(c); const on = total > 0; const segs = Object.entries(chanBrand[c]).sort((a, b) => b[1] - a[1]).map(([b, v]) => `<div style="width:${(v / total * 100).toFixed(1)}%;background:${brandColor[b] || '#94a3b8'}" title="${this._vesc(b)} ${won(v)}원"></div>`).join(''); return `<div onclick="app.switchView('sales')" style="margin-bottom:0.55rem;cursor:pointer">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:0.81rem;margin-bottom:3px"><span style="font-weight:600;color:${on ? 'var(--text-main)' : 'var(--text-muted)'}">${c}</span><span style="font-weight:800;font-variant-numeric:tabular-nums;color:${on ? 'var(--text-main)' : 'var(--text-muted)'}">${on ? won(total) + '원' : '—'}</span></div>
            <div style="height:9px;border-radius:5px;background:rgba(148,163,184,0.14);overflow:hidden"><div style="height:100%;width:${on ? Math.max(3, total / chanMaxT * 100) : 0}%;border-radius:5px;overflow:hidden;display:flex">${segs}</div></div>
        </div>`; }).join('');
        // 브랜드 색상 범례(채널 스택바 해설)
        const brandChips = brandArr.map(([b], i) => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:0.7rem;color:var(--text-muted);margin-right:10px"><span style="width:8px;height:8px;border-radius:2px;background:${palette[i % palette.length]}"></span>${this._vesc(b)}</span>`).join('');
        // 주문상태 3개 개별 블록
        const statBlocks = [
            ['배송전', stOrder, '#6366f1', '미출고', 'st_pre'],
            ['배송중', stShip, '#06b6d4', '', 'st_ship'],
            ['교환', stExchange, '#f59e0b', '', 'st_exchange'],
            ['환불', stRefund, '#a855f7', refundTotal, 'st_refund']
        ].map(([l, n, c, sub, pk]) => {
            const isRefund = l === '환불';
            return `<div class="glass" onclick="app._pop(event,'${pk}')" style="padding:0.95rem 1.1rem;border-radius:16px;display:flex;align-items:center;gap:11px;cursor:pointer">
                <span style="width:11px;height:11px;border-radius:50%;background:${c};flex-shrink:0"></span>
                ${isRefund
                    ? `<div style="min-width:0;display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%"><div><div style="font-size:1.5rem;font-weight:800;line-height:1;font-variant-numeric:tabular-nums">${n.toLocaleString()}<span style="font-size:0.72rem;font-weight:600">건</span></div><div style="font-size:0.76rem;color:var(--text-muted);margin-top:3px">환불</div></div><div style="text-align:right;min-width:0"><div style="font-size:0.67rem;color:var(--text-muted);white-space:nowrap">환불총액</div><div style="font-size:0.9rem;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap">${sub ? `${won(sub)}원` : '—'}</div></div></div>`
                    : `<div style="min-width:0"><div style="font-size:1.5rem;font-weight:800;line-height:1;font-variant-numeric:tabular-nums">${n.toLocaleString()}<span style="font-size:0.72rem;font-weight:600">건</span></div><div style="font-size:0.76rem;color:var(--text-muted);margin-top:3px">${l}</div>${sub ? `<div style="font-size:0.66rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sub}</div>` : ''}</div>`}
            </div>`;
        }).join('');
        // 브랜드별 매출 합계 + 비율(%)
        const brandGrand = brandArr.reduce((s, [, v]) => s + v, 0) || 1;
        const brandTotals = brandArr.length ? brandArr.map(([b, v], i) => `<div onclick="app.switchView('sales')" style="display:flex;align-items:center;gap:7px;padding:6px 0;border-top:1px solid var(--card-border);font-size:0.82rem;cursor:pointer"><span style="width:9px;height:9px;border-radius:2px;background:${palette[i % palette.length]};flex-shrink:0"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(b)}</span><b style="font-variant-numeric:tabular-nums">${won(v)}</b><span style="font-size:0.72rem;font-weight:700;color:var(--text-muted);min-width:34px;text-align:right;font-variant-numeric:tabular-nums">${Math.round(v / brandGrand * 100)}%</span></div>`).join('') : '<div style="color:var(--text-muted);font-size:0.8rem;padding:8px 0">이번달 매출 없음</div>';
        const brandPanel = panel('브랜드별 매출 <span style="font-size:0.72rem;color:var(--text-muted)">(이번달)</span>', `<div style="display:flex;justify-content:center;margin-bottom:0.4rem">${donut(brandArr, palette)}</div>${brandTotals}`);
        // 최근주문 — 전체폭 그리드(2줄 카드)
        const recentGrid = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:0 1.4rem">${recentCompact}</div>`;

        // ── 클릭 팝오버 내용 구성(KPI·채널·브랜드·상태) ──
        const rowsOf = (arr) => arr.map(([l, v]) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0"><span style="color:var(--text-muted)">${l}</span><b style="font-variant-numeric:tabular-nums">${v}</b></div>`).join('');
        const acup = won(monthOrdersCnt ? Math.round(monthSales / monthOrdersCnt) : 0);
        const salesLink = { label: '매출 상세', action: "app.switchView('sales')" };
        const ordersLink = { label: '주문에서 보기', action: "app.switchView('orders')" };
        this._homePops.k_today = { title: '오늘 매출', rows: rowsOf([['오늘', won(todaySales) + '원'], ['어제', won(ydaySales) + '원'], ['이번주(7일)', won(weekSales) + '원'], [`${mm}월 누적`, won(monthSales) + '원']]) + (todayDelta != null ? `<div style="margin-top:7px;font-size:0.76rem;font-weight:700;color:${todayDelta >= 0 ? '#16a34a' : '#dc2626'}">어제 대비 ${todayDelta >= 0 ? '▲' : '▼'} ${Math.abs(todayDelta)}%</div>` : ''), link: salesLink };
        this._homePops.k_order = { title: '주문금액', rows: rowsOf([[`${mm}월 주문금액`, won(hasFinancial ? monthFinancial.order : monthSales) + '원'], ['오늘 주문금액', won(todayFinancial.order) + '원'], [`${mm}월 주문건수`, monthOrdersCnt.toLocaleString() + '건']]) + '<div style="margin-top:6px;color:var(--text-muted);font-size:0.73rem">결제 전 주문 접수 금액 기준</div>' };
        this._homePops.k_paid = { title: '실결제금액', rows: rowsOf([[`${mm}월 실결제`, won(hasFinancial ? monthFinancial.paid : monthSales) + '원'], ['오늘 실결제', won(todayFinancial.paid) + '원']]) };
        this._homePops.k_refund = { title: '환불금액', rows: rowsOf([[`${mm}월 환불`, won(hasFinancial ? monthFinancial.refund : refundTotal) + '원'], ['환불 건수', stRefund.toLocaleString() + '건']]), link: ordersLink };
        this._homePops.k_net = { title: `${mm}월 순매출`, rows: rowsOf([['순매출', won(monthSales) + '원'], ['전월 대비', sa.mom != null ? `${sa.mom >= 0 ? '▲' : '▼'} ${Math.abs(sa.mom)}%` : '기준 없음'], ['객단가', acup + '원'], ['주문건수', monthOrdersCnt.toLocaleString() + '건']]), link: salesLink };
        this._homePops.k_cnt = { title: `${mm}월 주문건수`, rows: rowsOf([['주문건수', monthOrdersCnt.toLocaleString() + '건'], ['객단가', acup + '원'], ['순매출', won(monthSales) + '원']]) };
        CHAN_FIXED.forEach(c => {
            const total = chanTot(c);
            const brs = Object.entries(chanBrand[c]).sort((a, b) => b[1] - a[1]);
            this._homePops['ch_' + c] = { title: `${c} · ${mm}월`, rows: (total > 0 ? rowsOf([['채널 매출', won(total) + '원'], ...brs.map(([b, v]) => [this._vesc(b), `${won(v)}원 · ${Math.round(v / total * 100)}%`])]) : '<div style="color:var(--text-muted)">이번달 매출 없음</div>'), link: salesLink };
        });
        brandArr.forEach(([b, v]) => {
            const chOfBrand = {};
            monthRev.forEach(o => { if ((brandOf(o) || o.channel) === b) { let c = channelOf(o); if (!CHAN_FIXED.includes(c)) c = '기타'; chOfBrand[c] = (chOfBrand[c] || 0) + Number(o.pay_amount || 0); } });
            const chs = Object.entries(chOfBrand).sort((a, b2) => b2[1] - a[1]);
            this._homePops['br_' + this._vesc(b)] = { title: `${this._vesc(b)} · ${mm}월`, rows: rowsOf([['브랜드 매출', won(v) + '원'], ['전체 비중', Math.round(v / brandGrand * 100) + '%'], ...chs.map(([c, cv]) => [c, won(cv) + '원'])]), link: salesLink };
        });
        // 상태 팝업은 건수뿐 아니라 실제 주문 목록(브랜드·품목·고객·금액)을 보여준다.
        const statOrders = (this.salesOrders && this.salesOrders.length) ? this.salesOrders : (this.orders || []);
        const oLine = (o) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-top:1px solid var(--card-border);font-size:0.78rem"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(brandOf(o) || '-')} · ${this._vesc(this._orderItemsSummary(o))}${(o.receiver_name || o.buyer_name) ? ` <span style="color:var(--text-muted)">${this._vesc(o.receiver_name || o.buyer_name)}</span>` : ''}</span><b style="white-space:nowrap">${won(o.pay_amount || 0)}원</b></div>`;
        const listPop = (title, cnt, pred, note, max = 12) => {
            const arr = statOrders.filter(pred);
            const shown = arr.slice(0, max).map(oLine).join('');
            const more = arr.length > max ? `<div style="padding:4px 0;color:var(--text-muted);font-size:0.74rem">외 ${arr.length - max}건</div>` : '';
            const miss = (arr.length < cnt) ? `<div style="color:var(--text-muted);padding:4px 0;font-size:0.73rem">표시 ${arr.length}건 / 전체 ${cnt}건 · 나머지는 주문 페이지에서</div>` : '';
            return { title, rows: rowsOf([['건수', cnt.toLocaleString() + '건']]) + (note ? `<div style="margin:4px 0 2px;color:var(--text-muted);font-size:0.73rem">${note}</div>` : '') + shown + more + miss, link: ordersLink };
        };
        this._homePops.st_pre = listPop('배송전 (미출고)', stOrder, o => this._orderState(o) === 'pre', '아직 출고 전 · 송장 발번 대상');
        this._homePops.st_ship = listPop('배송중', stShip, o => this._orderState(o) === 'shipping', '송장 등록 후 배송 진행 중');
        this._homePops.st_exchange = listPop(`교환 · ${mm}월`, stExchange, o => this._orderState(o) === 'exchange' && localYMD(o.order_date).startsWith(monthKey), '');
        this._homePops.st_refund = listPop(`환불 · ${mm}월`, stRefund, o => { const s = this._orderState(o); return (s === 'cancel' || s === 'return') && localYMD(o.order_date).startsWith(monthKey); }, `환불총액 ${won(refundTotal)}원`);

        return `
        <div class="fade-in" style="padding:1.3rem 1.5rem;max-width:1240px;margin:0 auto">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:0.6rem">
                <h1 style="margin:0;font-size:1.35rem">👋 ${this._vesc(name)}님</h1>
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                    <span style="font-size:0.82rem;color:var(--text-muted)">2179 운영 현황 · ${todayStr}${this._dataLoadedAt ? ` · 업데이트 ${new Date(this._dataLoadedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                    <button onclick="app.refreshData()" ${this._refreshing ? 'disabled' : ''} title="최신 주문·매출로 동기화" style="display:inline-flex;align-items:center;gap:6px;padding:6px 13px;border-radius:9px;border:1px solid var(--primary);background:rgba(99,102,241,0.1);color:var(--primary);font-size:0.8rem;font-weight:700;cursor:${this._refreshing ? 'wait' : 'pointer'}"><i class="ph ph-arrows-clockwise" style="${this._refreshing ? 'animation:spin 0.8s linear infinite' : ''}"></i> ${this._refreshing ? '동기화 중…' : '동기화'}</button>
                </div>
            </div>

            <!-- ═══ 블록 1: 매출 개요 ═══ -->
            ${sectionHead('ph-chart-line-up', '매출 개요', `${mm}월 실적 · ${syncBadge}`)}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.7rem;margin-bottom:0.9rem">
                ${kpiCard('오늘 매출', won(todaySales), '원', deltaBadge(todayDelta, 'vs 어제'), '#f59e0b', 'sales')}
                ${kpiCard('실결제금액', won(hasFinancial ? monthFinancial.paid : monthSales), '원', `${mm}월 결제 기준`, '#3b82f6', 'sales')}
                ${kpiCard('환불금액', won(hasFinancial ? monthFinancial.refund : 0), '원', `${mm}월 환불 기준`, '#a855f7', 'orders')}
                ${kpiCard(`${mm}월 순매출`, won(monthSales), '원', deltaBadge((sa.prevM >= sa.thisM * 0.05 && sa.prevM > 0) ? sa.mom : null, 'vs 전월'), '#8b5cf6', 'sales')}
                ${kpiCard(`${mm}월 주문`, monthOrdersCnt.toLocaleString(), '건', `<span style="font-size:0.68rem;color:var(--text-muted)">객단가 ${won(monthOrdersCnt ? Math.round(monthSales / monthOrdersCnt) : 0)}원</span>`, '#10b981', 'orders')}
            </div>
            <div class="home-split" style="display:grid;grid-template-columns:7fr 3fr;gap:0.9rem;align-items:stretch">
                <div style="display:flex;flex-direction:column;gap:0.9rem;min-width:0">
                    ${panel('채널·브랜드별 매출 <span style="font-size:0.72rem;color:var(--text-muted)">(이번달 · 막대 색상 = 브랜드 비율)</span>', `<div style="display:flex;gap:1.5rem;flex-wrap:wrap;align-items:flex-start">
                        <div style="flex:1;min-width:240px">${chanStacked}<div style="margin-top:0.8rem;padding-top:0.7rem;border-top:1px solid var(--card-border)">${brandChips}</div></div>
                        <div style="width:200px;flex-shrink:0"><div style="position:relative;display:flex;justify-content:center;margin-bottom:0.5rem">${donut(brandArr, palette)}${brandArr.length ? `<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none"><div style="font-size:1.05rem;font-weight:800;line-height:1;color:${palette[0]}">${Math.round(brandArr[0][1] / brandGrand * 100)}%</div><div style="font-size:0.58rem;color:var(--text-muted);max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(brandArr[0][0])}</div></div>` : ''}</div>${brandTotals}</div>
                    </div>`)}
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0.9rem">${statBlocks}</div>
                </div>
                <div class="recent-orders-cell">
                    <div class="glass recent-orders-panel" style="padding:1.1rem 1.25rem;border-radius:16px;min-width:0">
                        <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:0.55rem;margin-bottom:0.3rem;border-bottom:2px solid var(--card-border);flex-shrink:0"><span style="font-size:0.94rem;font-weight:800">최근 주문</span><span style="font-size:0.76rem;color:var(--primary);cursor:pointer" onclick="app.switchView('orders')">전체 →</span></div>
                        <div class="ro-scroll" style="margin-right:-6px;padding-right:6px">${recentCompact}</div>
                    </div>
                </div>
            </div>

            <!-- ═══ 블록 2: 할 일 · 통합 캘린더 ═══ -->
            ${sectionHead('ph-list-checks', '할 일 · 통합 캘린더', '메모 체크 · 시즌 할 일 · 생산 작업 · 시즌 마감까지 한데')}
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0.9rem;align-items:stretch">
                ${panel('할 일', remList,
                    `<span style="font-size:0.76rem;color:var(--primary);cursor:pointer" onclick="app.switchView('reminders')">전체 →</span>`, true)}
                ${panel(`${mm}월 통합 캘린더`, calendar,
                    `<span style="font-size:0.76rem;color:var(--primary);cursor:pointer" onclick="app.switchView('calendar')">캘린더 →</span>`)}
            </div>

            <!-- ═══ 블록 3: SNS ═══ -->
            ${sectionHead('ph-instagram-logo', 'SNS 현황', `브랜드별 팔로워·게시물 · <span style="color:var(--primary);cursor:pointer" onclick="app.switchView('sns')">SNS 탭 →</span>`)}
            ${this._igHomeSummary()}
        </div>`;
    }

    async logout() {
        try { await this.supabase.auth.signOut(); } catch (_e) {}
        localStorage.removeItem('bhas_session_user');
        localStorage.removeItem('bhas_auto_login');
        document.querySelectorAll('.sticky').forEach(el => el.remove());
        document.getElementById('calc-pop')?.remove();
        this.wins = []; this._stickiesRestored = false;
        this.setState({ currentUser: null, currentView: 'login', activeProjectId: null, selectedCompanyId: 'all' });
    }
    // ── 업데이트 확인 ────────────────────────────────────────
    //  브라우저가 옛 index.html 을 붙들고 있으면 아무리 배포해도 옛 화면이 뜬다.
    //  지금 돌고 있는 번들 이름과 서버의 index.html 이 가리키는 번들을 대본다.
    _myBundle() {
        try {
            const el = [...document.scripts].find(x => /assets\/index-.*\.js/.test(x.src || ''));
            return el ? (el.src.match(/assets\/index-[^/]+\.js/) || [])[0] : null;
        } catch (_e) { return null; }
    }
    async checkNewBuild(loud) {
        const mine = this._myBundle();
        if (!mine) return;                      // 개발 중에는 건너뛴다
        try {
            const r = await fetch('/?v=' + Date.now(), { cache: 'no-store' });
            const html = await r.text();
            const live = (html.match(/assets\/index-[^"']+\.js/) || [])[0];
            if (!live || live === mine) { if (loud) this.showToast('이미 최신입니다'); return; }
            this._showUpdateBar();
        } catch (_e) { /* 못 물어봐도 그냥 둔다 */ }
    }
    //  맥 알림 — 오른쪽 위에서 밀려 나왔다가 접히고, 알림 센터에 남는다
    notify({ id, kind, title, sub, icon = 'ph-bell', col = '#0a84ff', actions = [], sticky = false }) {
        let box = document.getElementById('noti-stack');
        if (!box) {
            box = document.createElement('div');
            box.id = 'noti-stack'; box.className = 'nstack';
            document.body.appendChild(box);
        }
        if (id && box.querySelector(`[data-n="${id}"]`)) return;
        const esc = s2 => this._vesc(s2);
        const el = document.createElement('div');
        el.className = 'ntoast'; if (id) el.dataset.n = id;
        el.innerHTML = `<span class="nt-ic" style="background:${col}"><i class="ph ${icon}"></i></span>
            <div class="nt-tx">
                <div class="nt-k">${esc(kind || '알림')}</div>
                <div class="nt-ti">${esc(title || '')}</div>
                ${sub ? `<div class="nt-sb">${esc(sub)}</div>` : ''}
                ${actions.length ? `<div class="nt-ac">${actions.map((a, i) =>
                    `<button class="${i === 0 ? 'pri' : ''}" data-i="${i}">${esc(a.t)}</button>`).join('')}</div>` : ''}
            </div>
            <button class="nt-x" title="닫기">✕</button>`;
        const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 180); };
        el.querySelector('.nt-x').onclick = (e) => { e.stopPropagation(); close(); };
        actions.forEach((a, i) => {
            const b = el.querySelector(`.nt-ac button[data-i="${i}"]`);
            if (b) b.onclick = (e) => { e.stopPropagation(); close(); a.run && a.run(); };
        });
        box.appendChild(el);
        if (!sticky) setTimeout(close, 6000);
        return el;
    }
    //  쓰던 중에 화면이 갑자기 바뀌면 안 된다. 알리기만 하고, 누를 때 바뀐다.
    _showUpdateBar() {
        if (this._updSnoozeUntil && Date.now() < this._updSnoozeUntil) return;
        this._updReady = true;                      // 알림 센터에도 남는다
        this.notify({
            id: 'upd', kind: '업데이트', icon: 'ph-arrow-circle-down', col: '#0a84ff', sticky: true,
            title: '새 버전이 나왔습니다',
            sub: '지금 쓰던 건 그대로 둬도 됩니다. 눌러야 바뀝니다.',
            actions: [{ t: '업데이트', run: () => this.applyUpdate() },
                      { t: '나중에', run: () => this.snoozeUpdate() }],
        });
        this.requestRender();                        // 종 아이콘 숫자 갱신
    }
    applyUpdate() { location.reload(true); }
    snoozeUpdate() {
        this._updSnoozeUntil = Date.now() + 30 * 60 * 1000;   // 30분 뒤 다시 묻는다
        document.querySelector('#noti-stack [data-n="upd"]')?.remove();
    }
    // 지금 쓰는 버전이 무엇인지 — 주소가 여럿일 때 헷갈리지 않게 화면에 박아둔다
    _buildTag() {
        try {
            const h = location.hostname.replace('.vercel.app', '');
            return `${h} · ${__BUILD__}`;
        } catch (_e) { return __BUILD__; }
    }
    // ── 설정 ─────────────────────────────────────────────────
    //  바탕화면 · 화면 모드 · 화면 방식, 그리고 관리 화면 바로가기.
    renderSettings() {
        const esc = s => this._vesc(s);
        const role = this.currentUser?.role;
        const isLight = document.body.classList.contains('light');
        const wall = this.wallpaper;
        const row = (title, desc, right) => `
            <div class="set-row">
                <div><b>${esc(title)}</b>${desc ? `<span>${esc(desc)}</span>` : ''}</div>
                <div class="set-right">${right}</div>
            </div>`;
        const links = [
            { id: 'user_management', label: '계정 관리', need: 'MASTER' },
            { id: 'brand_management', label: '브랜드 관리', need: 'MASTER' },
            { id: 'integrations', label: '채널 연동', need: 'STAFF' },
            { id: 'feedback', label: '불편사항', need: 'MASTER' },
        ].filter(l => l.need === 'STAFF' ? (role === 'MASTER' || role === 'STAFF') : role === 'MASTER');

        const sec = this.setSec || 'look';
        const SIDE = [
            { k: 'look', t: '바탕화면·화면', i: 'ph-desktop' },
            { k: 'tools', t: '도구', i: 'ph-wrench' },
            ...(role === 'MASTER' ? [{ k: 'admin', t: '관리', i: 'ph-shield-check' }] : []),
            { k: 'account', t: '계정', i: 'ph-user-circle' },
            { k: 'build', t: '버전', i: 'ph-info' },
        ];
        const side = `<aside class="appside"><div class="m3-h">설정</div>
            ${SIDE.map(x => `<div class="m3-s${sec === x.k ? ' on' : ''}" onclick="app.setSetSec('${x.k}')">
                <i class="ph ${x.i}" style="color:#0a84ff"></i><span>${esc(x.t)}</span></div>`).join('')}</aside>`;
        return `<div class="appwrap">${side}<div class="appmain">
        <div class="settings-pane" data-sec="${esc(sec)}">
            <div class="set-card" data-s="look">
                <div class="set-head">바탕화면</div>
                <div class="wall-pick">
                    ${this.MAC_WALLS.map(w => `
                        <button class="wall-opt${wall === w.id ? ' on' : ''}" onclick="app.setWallpaper('${w.id}')" title="${esc(w.label)}">
                            <span class="wall-thumb" data-wall="${w.id}"></span>
                            <em>${esc(w.label)}</em>
                        </button>`).join('')}
                </div>
            </div>
            <div class="set-card" data-s="look">
                <div class="set-head">화면</div>
                ${row('밝은 화면 · 어두운 화면', isLight ? '지금은 밝은 화면입니다' : '지금은 어두운 화면입니다',
                    `<button class="set-btn" onclick="app.toggleTheme()">${isLight ? '어둡게' : '밝게'}</button>`)}

            </div>
            <div class="set-card" data-s="tools">
                <div class="set-head">도구</div>
                ${row('계산기 · 스티커', '독 오른쪽 끝에 있습니다',
                    `<button class="set-btn" onclick="app.openCalc()">계산기</button>
                     <button class="set-btn" onclick="app.addSticky()">스티커</button>`)}
            </div>
            ${links.length ? `<div class="set-card" data-s="admin">
                <div class="set-head">관리</div>
                ${links.map(l => row(l.label, '', `<button class="set-btn" onclick="${this.macMode ? `app.macOpen('${l.id}')` : `app.switchView('${l.id}')`}">열기</button>`)).join('')}
            </div>` : ''}
            <div class="set-card" data-s="build">
                <div class="set-head">버전</div>
                ${row('지금 쓰는 버전', this._buildTag(), `<button class="set-btn" onclick="app.checkNewBuild(true)">업데이트 확인</button>
                    <button class="set-btn" onclick="location.reload(true)">새로고침</button>`)}
            </div>
            <div class="set-card" data-s="account">
                <div class="set-head">계정</div>
                ${row(this.currentUser?.name || '-', role === 'MASTER' ? '마스터 관리자' : (role === 'STAFF' ? '업무 직원' : '파트너사'),
                    `<button class="set-btn danger" onclick="app.logout()">로그아웃</button>`)}
                ${row('아이디', this.currentUser?.username || (this.currentUser?.email || '').split('@')[0] || '-', '')}
                ${row('비밀번호', '처음 받은 비밀번호는 바꿔서 쓰세요',
                    `<button class="set-btn" onclick="app.changeMyPassword()">비밀번호 바꾸기</button>`)}
            </div>
        </div></div></div>`;
    }
    setSetSec(k) { this.setSec = k; this.requestRender(); }
    // ── 묶음 앱 ──────────────────────────────────────────────
    //  따로 떨어져 있던 화면 중 같이 쓰는 것들을 한 앱의 탭으로 묶는다.
    //   · 주문 ↔ CS   : 주문을 찾아 그 자리에서 교환·반품을 접수한다
    //   · 매출 ↔ 지출 : 둘 다 돈. '정산' 하나로
    //   · 생산현황 ↔ 재고 : 만든 것과 쌓인 것
    APP_GROUPS = [
        // 파는 쪽 — 주문이 들어오고, 탈나면 CS, 물건은 재고, 돈은 정산·지출
        //  지출은 판매가 아니다 — 매출의 짝이라 '정산' 안에서 전환한다(숨은 탭).
        { head: 'orders', label: '판매', tabs: [
            { k: 'orders', t: '주문' }, { k: 'cs', t: 'CS' }, { k: 'inventory', t: '재고' },
            { k: 'sales', t: '정산' }, { k: 'analysis', t: '고객 분석' },
            { k: 'expenses', t: '지출', hidden: true },
        ] },
        // 만드는 쪽 — 견적 내고, 샘플 뜨고, 작업지시서 쓰고, 생산처가 만든다
        { head: 'items', label: '생산', tabs: [
            { k: 'items', t: '제품리스트' }, { k: 'vendors', t: '생산현황' },
            { k: 'dashboard', t: '시즌', hidden: true },
            { k: 'tech_packs', t: '작업지시서' }, { k: 'sample_maker', t: '샘플·디자인' },
            { k: 'quotes', t: '견적' },
        ] },
    ];
    _groupOf(view) { return this.APP_GROUPS.find(g => g.tabs.some(t => t.k === view)); }
    // 묶음 앱의 첫 칸 — 가로 탭 대신 세로 분류 목록(메모·자료실과 같은 결)
    APP_ICONS = {
        orders: 'ph-shopping-bag-open', cs: 'ph-arrows-counter-clockwise', inventory: 'ph-package',
        sales: 'ph-chart-line-up', expenses: 'ph-credit-card', analysis: 'ph-crown-simple',
        items: 'ph-t-shirt', dashboard: 'ph-calendar-blank', vendors: 'ph-factory', tech_packs: 'ph-clipboard-text',
        sample_maker: 'ph-scissors', quotes: 'ph-receipt',
    };
    // ── 모든 표에 쓰는 줄 세우기 · 거르기 ──────────────────────
    //  화면마다 따로 짜지 않는다. 머리글을 누르면 정렬, 깔때기를 누르면 그 칸 값으로 거른다.
    _tblState(view) {
        this.tblSort = this.tblSort || {};
        this.tblFilt = this.tblFilt || {};
        return { srt: this.tblSort[view] || { k: '', dir: 1 }, flt: this.tblFilt[view] || {} };
    }
    sortTbl(view, k) {
        this.tblSort = this.tblSort || {};
        const cur = this.tblSort[view] || { k: '', dir: 1 };
        this.tblSort[view] = cur.k === k ? (cur.dir > 0 ? { k, dir: -1 } : { k: '', dir: 1 }) : { k, dir: 1 };
        this.requestRender();
    }
    clearTblFilters(view) {
        this.tblFilt = this.tblFilt || {}; this.tblFilt[view] = {};
        document.getElementById('colf')?.remove();
        this.requestRender();
    }
    //  머리글 한 줄 — cols: [[키, 이름, 칸모양]]
    _thead(view, cols) {
        const esc = s => this._vesc(s);
        const { srt, flt } = this._tblState(view);
        return cols.map(([k, label, cls]) => `<th class="${cls || ''}${srt.k === k ? ' srt' : ''}${flt[k] ? ' flt' : ''}"
            onclick="app.sortTbl('${view}','${k}')" title="눌러서 줄 세우기 · 깔때기로 거르기">${esc(label)}${srt.k === k ? `<i class="ph ph-caret-${srt.dir > 0 ? 'up' : 'down'}"></i>` : ''}<button class="th-f"
            onclick="app.openTblFilter(event,'${view}','${k}','${esc(label)}')" title="${esc(label)} 거르기"><i class="ph ph-funnel${flt[k] ? '-fill' : ''}"></i></button></th>`).join('');
    }
    //  거르고 줄 세운 결과 — val(row, key) 가 그 칸의 값을 돌려준다
    _applyTbl(view, rows, val, base) {
        const { srt, flt } = this._tblState(view);
        this._tblVal = this._tblVal || {};
        this._tblVal[view] = val;
        this._tblBase = this._tblBase || {};
        this._tblBase[view] = base || rows;
        let out = rows;
        Object.keys(flt).forEach(k => {
            const keep = new Set(flt[k]);
            out = out.filter(r => keep.has(String(val(r, k) ?? '')));
        });
        if (srt.k) {
            out = [...out].sort((a, b) => {
                const A = val(a, srt.k), B = val(b, srt.k);
                if (typeof A === 'number' && typeof B === 'number') return (A - B) * srt.dir;
                return String(A ?? '').localeCompare(String(B ?? ''), 'ko', { numeric: true }) * srt.dir;
            });
        }
        return out;
    }
    openTblFilter(ev, view, k, label) {
        ev && ev.stopPropagation();
        document.getElementById('colf')?.remove();
        const esc = x => this._vesc(x);
        const val = (this._tblVal || {})[view];
        const base = (this._tblBase || {})[view] || [];
        if (!val) return;
        const counts = new Map();
        base.forEach(r => { const v = String(val(r, k) ?? ''); counts.set(v, (counts.get(v) || 0) + 1); });
        const vals = [...counts.keys()].sort((a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true }));
        const cur = (this.tblFilt || {})[view]?.[k];
        const sel = new Set(cur || vals);
        const el = document.createElement('div');
        el.id = 'colf'; el.className = 'colf';
        el.innerHTML = `<div class="colf-h">${esc(label)} 거르기
                <button onclick="app.clearTblFilters('${view}')">모두</button></div>
            <div class="colf-b">${vals.map(v => `<label class="pa-m colf-m">
                <input type="checkbox" value="${esc(v)}" ${sel.has(v) ? 'checked' : ''}>
                <span>${esc(v) || '<em>(빈칸)</em>'}<em>${counts.get(v)}</em></span></label>`).join('')}</div>
            <div class="colf-a"><button class="mbtn" id="colf-x">취소</button>
                <button class="mbtn pri" id="colf-ok">적용</button></div>`;
        document.body.appendChild(el);
        const th = ev && ev.target.closest('th');
        if (th) { const r = th.getBoundingClientRect();
            el.style.left = Math.min(r.left, innerWidth - el.offsetWidth - 10) + 'px';
            el.style.top = (r.bottom + 4) + 'px'; }
        el.querySelector('#colf-x').onclick = () => el.remove();
        el.querySelector('#colf-ok').onclick = () => {
            const picked = [...el.querySelectorAll('input:checked')].map(i => i.value);
            this.tblFilt = this.tblFilt || {}; this.tblFilt[view] = this.tblFilt[view] || {};
            if (picked.length === vals.length) delete this.tblFilt[view][k]; else this.tblFilt[view][k] = picked;
            el.remove(); this.requestRender();
        };
        this._colfOff = (e) => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('mousedown', this._colfOff); } };
        setTimeout(() => document.addEventListener('mousedown', this._colfOff), 0);
    }
    //  거르는 중 표시 — 머리막대에 붙인다
    _fltBadge(view) {
        const n = Object.keys((this.tblFilt || {})[view] || {}).length;
        return n ? `<button class="flt-off" onclick="app.clearTblFilters('${view}')" title="거르기 모두 풀기"><i class="ph ph-funnel-fill"></i> ${n}칸 거르는 중 ✕</button>` : '';
    }

    // ── 1단 '보기' 트리 — 화면마다 묶어 보는 방식 ──────────────
    //  2단(표)에서 깔때기로 더 좁히면 되니, 여기는 큰 갈래만 둔다.
    _navRow(on, label, count, click, depth, color) {
        const esc = s => this._vesc(s);
        return `<div class="m3-s nav${on ? ' on' : ''}${depth ? ' d1' : ''}" onclick="${click}">
            ${depth ? `<i class="ph-fill ph-circle" style="font-size:7px;color:${color || '#8e8e93'}"></i>`
                    : `<i class="ph ${color || 'ph-squares-four'}" style="color:#0a84ff"></i>`}
            <span>${esc(label)}</span><em>${count == null ? '' : count}</em></div>`;
    }
    _navSec(name, key, inner) {
        const open = (this.navOpen || {})[key] !== false;
        return `<div class="m3-h tog${open ? ' on' : ''}" onclick="app.toggleNav('${key}')">
            <i class="ph ph-caret-right"></i>${this._vesc(name)}</div>${open ? inner : ''}`;
    }
    toggleNav(k) {
        this.navOpen = this.navOpen || {};
        this.navOpen[k] = this.navOpen[k] === false;
        this.requestRender();
    }
    navPick(view, kind, id) {
        const R = this._navRow;
        if (view === 'orders') {
            if (kind === 'st') { this.orderFilter = id; this.orderMall = 'ALL'; }
            else { this.orderMall = id; this.orderFilter = 'all'; }
        } else if (view === 'cs') {
            if (kind === 'st') { this.csFilter = id; this.csKind = 'ALL'; this.csBrand = 'ALL'; }
            else if (kind === 'kind') { this.csKind = id; this.csFilter = '전체'; this.csBrand = 'ALL'; }
            else { this.csBrand = id; this.csFilter = '전체'; this.csKind = 'ALL'; }
        } else if (view === 'inventory') {
            if (kind === 'low') { this.invLow = true; this.invSelectedBrand = 'all'; }
            else { this.invSelectedBrand = id; this.invLow = false; }
        } else if (view === 'expenses') {
            if (kind === 'co') { this.expCoFilter = id; }
            else { this.expMonth = id; this.expCoFilter = 'ALL'; }
        } else if (view === 'vendors') {
            this.venCat = id; this.venSel = null; this.venEdit = false;
        } else if (view === 'quotes') {
            if (kind === 'st') { this.quoteStatus = id; this.quoteClient = 'ALL'; }
            else { this.quoteClient = id; this.quoteStatus = 'ALL'; }
        }
        this.requestRender();
    }
    _viewNav(view) {
        const R = (...a) => this._navRow(...a);
        const S = (...a) => this._navSec(...a);
        const esc = s => this._vesc(s);
        const brands = (mockData.brands || []);

        if (view === 'items') return this._itemNav();

        if (view === 'vendors') {
            const all = this.vendors || [];
            const cur = this.venCat || 'ALL';
            const CATS = ['봉제', '원단', '부자재', '프린트', '기타'];
            const n = c2 => all.filter(v => (v.category || '기타') === c2).length;
            return `<div class="m3-h">보기</div>
                ${R(cur === 'ALL', '전체', all.length, `app.navPick('vendors','cat','ALL')`, 0, 'ph-tray')}
                ${S('분류별', 'vcat', CATS.filter(c2 => n(c2)).map(c2 => R(cur === c2, c2, n(c2),
                    `app.navPick('vendors','cat','${esc(c2)}')`, 1)).join(''))}`;
        }
        if (view === 'orders') {
            const all = this.orders || [];
            const f = this.orderFilter || 'target', m = this.orderMall || 'ALL';
            const n = (fn) => all.filter(fn).length;
            const malls = [...new Set(all.map(o => o.mall_key).filter(Boolean))];
            const mallName = k => ((this._mallBrand(k) || {}).name) || k;
            return `<div class="m3-h">보기</div>
                ${R(m === 'ALL' && f === 'target', '배송대상', n(o => o.status === 'new' || o.status === 'ready'), `app.navPick('orders','st','target')`, 0, 'ph-package')}
                ${R(m === 'ALL' && f === 'shipping', '배송중', n(o => o.status === 'shipping'), `app.navPick('orders','st','shipping')`, 0, 'ph-truck')}
                ${R(m === 'ALL' && f === 'done', '완료', n(o => o.status === 'done'), `app.navPick('orders','st','done')`, 0, 'ph-check-circle')}
                ${R(m === 'ALL' && f === 'all', '전체', all.length, `app.navPick('orders','st','all')`, 0, 'ph-tray')}
                ${S('몰별', 'omall', malls.map(k => R(String(m) === String(k), mallName(k),
                    n(o => o.mall_key === k), `app.navPick('orders','mall','${esc(k)}')`, 1)).join(''))}`;
        }

        if (view === 'cs') {
            const all = this.csList || [];
            const f = this.csFilter || '진행중', k2 = this.csKind || 'ALL', b2 = this.csBrand || 'ALL';
            const n = (fn) => all.filter(fn).length;
            return `<div class="m3-h">보기</div>
                ${R(f === '진행중' && k2 === 'ALL' && b2 === 'ALL', '진행 중', n(t => t.status !== '완료'), `app.navPick('cs','st','진행중')`, 0, 'ph-hourglass')}
                ${R(f === '전체' && k2 === 'ALL' && b2 === 'ALL', '전체', all.length, `app.navPick('cs','st','전체')`, 0, 'ph-tray')}
                ${S('유형별', 'cskind', this.CS_KINDS.map(x => R(k2 === x, x,
                    n(t => t.kind === x), `app.navPick('cs','kind','${esc(x)}')`, 1)).join(''))}
                ${S('브랜드별', 'csbrd', brands.map(b => R(String(b2) === String(b.id), b.name,
                    n(t => String(t.brand_id) === String(b.id)), `app.navPick('cs','brd','${b.id}')`, 1, b.brand_color)).join(''))}`;
        }

        if (view === 'inventory') {
            const inv = (this.inventory && this.inventory.items) || [];
            const cur = this.invSelectedBrand || 'all', low = !!this.invLow;
            const n = (fn) => inv.filter(fn).length;
            return `<div class="m3-h">보기</div>
                ${R(!low && cur === 'all', '전체', inv.length, `app.navPick('inventory','brd','all')`, 0, 'ph-tray')}
                ${R(low, '재발주 필요', n(i => i.on_hand <= i.safety_stock), `app.navPick('inventory','low')`, 0, 'ph-warning-diamond')}
                ${S('브랜드별', 'invbrd', brands.map(b => R(!low && String(cur) === String(b.id), b.name,
                    n(i => String(i.brand_id) === String(b.id)), `app.navPick('inventory','brd','${b.id}')`, 1, b.brand_color)).join(''))}`;
        }

        if (view === 'expenses') {
            const all = this.expList || [];
            const months = [...new Set(all.map(e => (e.spent_on || '').slice(0, 7)).filter(Boolean))].sort().reverse();
            const cm = this.expMonth || months[0] || '';
            const co = this.expCoFilter || 'ALL';
            const inM = all.filter(e => (e.spent_on || '').startsWith(cm));
            const cos = [...new Set(inM.map(e => e.company || '미지정'))];
            return `<div class="m3-h">보기</div>
                ${R(co === 'ALL', `${cm} 전체`, inM.length, `app.navPick('expenses','co','ALL')`, 0, 'ph-tray')}
                ${S('회사별', 'expco', cos.map(c => R(co === c, c,
                    inM.filter(e => (e.company || '미지정') === c).length, `app.navPick('expenses','co','${esc(c)}')`, 1)).join(''))}
                ${S('달별', 'expm', months.slice(0, 18).map(m => R(cm === m, m,
                    all.filter(e => (e.spent_on || '').startsWith(m)).length, `app.navPick('expenses','m','${m}')`, 1)).join(''))}`;
        }

        if (view === 'quotes') {
            const all = this.quotes || [];
            const st = this.quoteStatus || 'ALL', cl = this.quoteClient || 'ALL';
            const n = (fn) => all.filter(fn).length;
            const clients = [...new Set(all.map(q => q.client_name).filter(Boolean))];
            const STS = [['draft', '작성중'], ['sent', '발송'], ['confirmed', '확정']];
            return `<div class="m3-h">보기</div>
                ${R(st === 'ALL' && cl === 'ALL', '전체', all.length, `app.navPick('quotes','st','ALL')`, 0, 'ph-tray')}
                ${S('상태별', 'qst', STS.map(([v, t]) => R(st === v, t,
                    n(q => (q.status || 'draft') === v), `app.navPick('quotes','st','${v}')`, 1)).join(''))}
                ${S('고객사별', 'qcl', clients.slice(0, 40).map(c => R(cl === c, c,
                    n(q => q.client_name === c), `app.navPick('quotes','cl','${esc(c)}')`, 1)).join(''))}`;
        }
        return '';
    }

    //  제품리스트 1단 — 보는 방식(전체 · 시즌별 · 브랜드별)
    _itemNav() {
        const esc = s => this._vesc(s);
        const items = this.pItems || [];
        const sea = this._seasons();
        const brands = (mockData.brands || []);
        const curS = this.itemSeason || 'ALL', curB = this.itemBrand || 'ALL';
        const n = (f) => items.filter(f).length;
        const row = (on, label, count, click, depth, color) =>
            `<div class="m3-s nav${on ? ' on' : ''}${depth ? ' d1' : ''}" onclick="${click}">
                ${depth ? `<i class="ph-fill ph-circle" style="font-size:7px;color:${color || '#8e8e93'}"></i>`
                        : `<i class="ph ph-squares-four" style="color:#0a84ff"></i>`}
                <span>${esc(label)}</span><em>${count}</em></div>`;
        const sec = (name, key, inner, add) => {
            const open = (this.itemNavOpen || {})[key] !== false;
            return `<div class="m3-h tog${open ? ' on' : ''}" onclick="app.toggleItemNav('${key}')">
                <i class="ph ph-caret-right"></i>${esc(name)}
                ${add ? `<button class="nav-add" title="${esc(add.t)}" onclick="event.stopPropagation();${add.run}">＋</button>` : ''}
            </div>${open ? inner : ''}`;
        };
        return `<div class="m3-h">보기</div>
            ${row(curS === 'ALL' && curB === 'ALL', '전체', items.length, "app.itemNavPick('all')")}
            ${sec('시즌별', 'sea', sea.map(p => row(String(curS) === String(p.id), p.name,
                n(i => String(i.product_id) === String(p.id)), `app.itemNavPick('sea','${p.id}')`, 1,
                (brands.find(b => b.id === p.brand_id) || {}).brand_color)).join('')
                + (n(i => !i.product_id) ? row(curS === 'NONE', '시즌 없음', n(i => !i.product_id), "app.itemNavPick('sea','NONE')", 1) : ''),
                { t: '새 시즌', run: 'app.showProjectModal()' })}
            ${sec('브랜드별', 'brd', brands.map(b => row(String(curB) === String(b.id), b.name,
                n(i => String(i.brand_id) === String(b.id)), `app.itemNavPick('brd','${b.id}')`, 1, b.brand_color)).join('')
                + (n(i => !i.brand_id) ? row(curB === 'NONE', '브랜드 없음', n(i => !i.brand_id), "app.itemNavPick('brd','NONE')", 1) : ''))}`;
    }
    toggleItemNav(k) {
        this.itemNavOpen = this.itemNavOpen || {};
        this.itemNavOpen[k] = this.itemNavOpen[k] === false;
        this.requestRender();
    }
    itemNavPick(kind, id) {
        if (kind === 'all') { this.itemSeason = 'ALL'; this.itemBrand = 'ALL'; }
        else if (kind === 'sea') { this.itemSeason = id; this.itemBrand = 'ALL'; }
        else { this.itemBrand = id; this.itemSeason = 'ALL'; }
        this.requestRender();
    }
    _appTabBar(view) {
        const g = this._groupOf(view); if (!g) return '';
        const esc = s => this._vesc(s);
        const win = this._renderingWin || '';
        return `<aside class="appside">
            <div class="m3-h">${esc(g.label)}</div>
            ${g.tabs.filter(t => !t.hidden).map(t => {
                const on = t.k === view || (t.k === 'sales' && view === 'expenses');
                return `<div class="m3-s${on ? ' on' : ''}" onclick="app.switchAppTab('${win}','${t.k}')">
                <i class="ph ${this.APP_ICONS[t.k] || 'ph-dot'}" style="color:#0a84ff"></i><span>${esc(t.t)}</span></div>`;
            }).join('')}
            ${this._viewNav(view)}
        </aside>`;
    }
    // 분류 칸 + 본문을 한 틀에 담는다
    // SNS 첫 칸 — 계정 목록
    _snsShell(inner) {
        const esc = s => this._vesc(s);
        const accs = this.igAccounts || [];
        const cur = this.snsAcc || '전체';
        const row = (k, label, icon) => `<div class="m3-s${String(cur) === String(k) ? ' on' : ''}"
            onclick="app.setSnsAcc('${k}')"><i class="ph ${icon}" style="color:#c13584"></i><span>${esc(label)}</span></div>`;
        return `<div class="appwrap"><aside class="appside">
            <div class="m3-h">SNS</div>
            ${row('전체', '모든 계정', 'ph-instagram-logo')}
            ${accs.map(a => row(a.id, a.username || a.name || '계정', 'ph-user-circle')).join('')
              || '<div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">연결된 계정 없음</div>'}
        </aside><div class="appmain">${inner}</div></div>`;
    }
    setSnsAcc(k) { this.snsAcc = k; this.requestRender(); }
    // 생산현황 지도 아래에 붙는 타임라인 — 공정이 어디까지 갔는지 한눈에
    _vendorTimeline(products) {
        const esc = s => this._vesc(s);
        const prev = this.currentView;
        this.currentView = 'timeline';
        let tl = '';
        try { tl = this.renderSubView(products) || ''; } catch (_e) { tl = ''; }
        this.currentView = prev;
        if (!tl) return '';
        return `<div class="vtl">
            <div class="vtl-h"><i class="ph ph-chart-bar-horizontal"></i> 공정 타임라인
                <em>시즌별 단계와 마감</em></div>
            ${tl}
        </div>`;
    }
    // 시즌 카드 우클릭 — 이름·브랜드(분류)·마감을 그 자리에서 고친다
    projectMenu(ev, id) {
        const p = (mockData.products || []).find(x => String(x.id) === String(id)); if (!p) return;
        this.ctxMenu(ev, [
            { t: '열기', icon: 'ph-arrow-square-out', run: () => this.openSeasonItems(id) },
            { t: '속성 · 접근 권한…', icon: 'ph-info', run: () => this.folderInfo(id) },
            { t: '단계 만들기…', icon: 'ph-list-checks', run: () => this.askSeasonSteps(id) },
            { sep: true },
            { t: '이름 바꾸기', icon: 'ph-textbox', run: () => this.renameProject(id) },
            { t: '브랜드 바꾸기…', icon: 'ph-shield-check', run: () => this.moveProjectBrand(id) },
            { t: '마감일 바꾸기', icon: 'ph-calendar-blank', run: () => this.setProjectDue(id) },
            { sep: true },
            { t: '삭제', icon: 'ph-trash', danger: true, run: () => this.handleDelete(ev, 'product', id) },
        ]);
    }
    // 내가 이 시즌를 볼 수 있나 (화면에서 거르는 용도 — 진짜 차단은 040 SQL 이 한다)
    _canSeeProject(p) {
        if (!p) return true;
        if (this.currentUser?.role === 'MASTER') return true;
        if ((p.access || 'all') === 'all') return true;
        return (p.members || []).includes(this._me());
    }
    // 시즌 담당자·권한 고치기
    //  시즌 할 일 — 그 시즌에 붙은 메모 한 장에 담는다.
    //  따로 만들지 않고 메모를 쓰는 이유: [ ] → 할 일 흐름이 이미 메모에 붙어 있다.
    _seasonTodoNote(pid) {
        return (this.noteList || []).find(n => String(n.product_id) === String(pid) && n.is_season_todo)
            || (this.noteList || []).find(n => String(n.product_id) === String(pid)
                && (n.title || '').endsWith(' 할 일'));
    }
    _seasonTodoText(pid) {
        const n = this._seasonTodoNote(pid);
        return n ? this._noteText(n) : '';
    }
    async _saveSeasonTodo(pid, text) {
        const t = (text || '').trim();
        const p = (mockData.products || []).find(x => String(x.id) === String(pid));
        let n = this._seasonTodoNote(pid);
        if (!t && !n) return;
        const body = this._joinNote(n ? this._noteMeta(n) : {}, t);
        if (n) {
            n.body = body; n.updated_at = new Date().toISOString();
            const { error } = await this.supabase.from('notes').update({ body }).eq('id', n.id);
            if (error) this.showToast('할 일 저장 실패: ' + error.message);
            return;
        }
        const row = {
            title: `${(p && p.name) || '시즌'} 할 일`, body,
            folder: (p && p.name) || '시즌', product_id: pid,
            brand_id: (p && p.brand_id) || null, scope: 'project', created_by: this._actor(),
        };
        const { data, error } = await this.supabase.from('notes').insert([row]).select().single();
        if (error) { this.showToast('할 일 저장 실패: ' + error.message); return; }
        this.noteList = [data, ...(this.noteList || [])];
    }

    //  메모 폴더 정보 — 마스터가 '이 폴더는 누구누구만' 을 정한다
    noteFolderInfo(name) {
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const esc = s => this._vesc(s);
        const isMaster = this.currentUser?.role === 'MASTER';
        const inF = (this.noteList || []).filter(n => (n.folder || '공용') === name);
        const accs = (mockData.companies || []).filter(a => a.username);
        const f = (this.noteFolders || []).find(x => x.name === name) || { access: 'all', members: [] };
        const mem = new Set(f.members || []);
        const who = f.access === 'all' ? '워크스페이스 모두'
            : (mem.size ? [...mem].map(u => (accs.find(a => a.username === u) || {}).name || u).join(' · ') : '아무도 없음 — 아래에서 고르세요');
        const last = inF.map(n => n.updated_at).filter(Boolean).sort().slice(-1)[0];

        c.innerHTML = `<div class="modal-content vmodal fi" style="width:94%;max-width:410px">
            <div class="fi-top">
                <i class="ph-fill ph-folder" style="color:#e0a800"></i>
                <div><b>${esc(name)}</b><em>메모 ${inF.length}개${last ? ' · 마지막 ' + esc(String(last).slice(0, 10)) : ''}</em></div>
                <button class="fi-x" onclick="app.closeGlobalModal()">×</button>
            </div>

            <div class="fi-sec">이 폴더를 볼 수 있는 사람</div>
            ${isMaster ? `
            <label class="pa-opt"><input type="radio" name="nf-acc" value="all" ${f.access === 'all' ? 'checked' : ''}>
                <span><b>모두</b><em>워크스페이스의 모든 계정</em></span></label>
            <label class="pa-opt"><input type="radio" name="nf-acc" value="members" ${f.access === 'members' ? 'checked' : ''}>
                <span><b>지정한 사람만</b><em>아래에서 고른 계정만 이 폴더를 본다</em></span></label>
            <div class="pa-list" id="nf-list">
                ${accs.map(a => `<label class="pa-m"><input type="checkbox" value="${esc(a.username)}" ${mem.has(a.username) ? 'checked' : ''}>
                    <span class="mrow-face" style="width:24px;height:24px;font-size:11px">${esc((a.name || '?')[0])}</span>
                    <span>${esc(a.name)}<em>${esc(a.username)} · ${a.role === 'MASTER' ? '마스터' : (a.role === 'STAFF' ? '직원' : '파트너')}</em></span></label>`).join('')}
            </div>
            <p class="fi-note">마스터는 늘 전부 봅니다. 폴더를 잠그면 그 안의 메모도 같이 가려집니다.</p>
            ` : `
            <div class="fi-r ro"><span>${f.access === 'all' ? '모두' : '지정한 사람만'}</span><b>${esc(who)}</b></div>
            <p class="fi-note">폴더 권한은 마스터만 바꿀 수 있습니다.</p>`}

            <div class="fi-act" style="justify-content:space-between">
                <button class="mbtn" onclick="app.renameNoteFolder('${esc(name)}')">이름 바꾸기</button>
                <span style="display:flex;gap:7px">
                    <button class="mbtn" onclick="app.closeGlobalModal()">닫기</button>
                    ${isMaster ? `<button class="mbtn pri" id="nf-save">저장</button>` : ''}
                </span>
            </div>
        </div>`;
        c.style.display = 'flex';
        if (!isMaster) return;
        const sync = () => {
            const v = c.querySelector('input[name=nf-acc]:checked')?.value;
            const list = c.querySelector('#nf-list');
            list.style.opacity = v === 'members' ? '1' : '.4';
            list.style.pointerEvents = v === 'members' ? 'auto' : 'none';
        };
        c.querySelectorAll('input[name=nf-acc]').forEach(r => r.onchange = sync);
        sync();
        c.querySelector('#nf-save').onclick = async () => {
            const btn = c.querySelector('#nf-save');
            const row = {
                name,
                access: c.querySelector('input[name=nf-acc]:checked')?.value || 'all',
                members: [...c.querySelectorAll('#nf-list input:checked')].map(x => x.value),
            };
            btn.disabled = true; btn.textContent = '저장 중...';
            const { error } = await this.supabase.from('note_folders').upsert(row, { onConflict: 'name' });
            btn.disabled = false; btn.textContent = '저장';
            if (error) { this.showToast('저장 실패 (045 SQL 필요): ' + error.message); return; }
            this.noteFolders = [...(this.noteFolders || []).filter(x => x.name !== name), row];
            this.closeGlobalModal(); this.requestRender();
            this.showToast(row.access === 'all'
                ? `'${name}' 는 모두가 봅니다`
                : `'${name}' 는 ${row.members.length}명만 봅니다`);
        };
    }

    // ── 폴더 속성 (맥 '정보 가져오기' 결) ───────────────────
    //  이름·브랜드·마감·담긴 것, 그리고 **접근 권한을 그 자리에서** 고친다.
    //  권한을 고치는 건 마스터만. 나머지는 누가 볼 수 있는지 읽기만 한다.
    folderInfo(id) {
        const p = (mockData.products || []).find(x => String(x.id) === String(id)); if (!p) return;
        const esc = s => this._vesc(s);
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const isMaster = this.currentUser?.role === 'MASTER';
        const accs = (mockData.companies || []).filter(a => a.username);
        const mem = new Set(p.members || []);
        const acc = p.access || 'all';
        const nItems = (this.pItems || []).filter(i => String(i.product_id) === String(id)).length;
        const nNotes = (this.noteList || []).filter(n => String(n.product_id) === String(id)).length;
        const nDocs = (mockData.globalDocuments || []).filter(d => String(d.productId) === String(id)).length;
        const who = acc === 'all' ? '브랜드에 접근할 수 있는 사람 모두'
            : (mem.size ? [...mem].map(u => (accs.find(a => a.username === u) || {}).name || u).join(' · ') : '아무도 없음 — 담당자를 고르세요');

        c.innerHTML = `<div class="modal-content vmodal fi" style="width:94%;max-width:430px">
            <div class="fi-top">
                <i class="ph-fill ph-folder" style="color:${((mockData.brands || []).find(b => b.id === p.brand_id) || {}).brand_color || '#5ac8fa'}"></i>
                <div><b>${esc(p.name)}</b><em>시즌 · 제품 ${nItems} · 메모 ${nNotes} · 자료 ${nDocs}</em></div>
                <button class="fi-x" onclick="app.closeGlobalModal()">×</button>
            </div>

            <div class="fi-sec">이름과 일정</div>
            <div class="fi-r"><span>이름</span><input id="fi-name" class="nw-f" value="${esc(p.name || '')}" ${isMaster ? '' : 'disabled'}></div>
            <div class="fi-r"><span>브랜드</span>
                <select id="fi-brand" class="nw-f" ${isMaster ? '' : 'disabled'}>
                    <option value="">브랜드 없음</option>
                    ${(mockData.brands || []).map(b => `<option value="${b.id}"${String(p.brand_id) === String(b.id) ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
                </select></div>
            <div class="fi-r"><span>마감</span><input id="fi-due" type="date" class="nw-f" value="${esc((p.deadline || p.due_date || '').slice(0, 10))}" ${isMaster ? '' : 'disabled'}></div>

            <div class="fi-sec">할 일 <em class="fi-hint">[ ] 로 쓰면 할 일 화면에 올라갑니다 · 날짜·@담당자도 같이</em></div>
            <textarea id="fi-todo" class="nw-f fi-todo" rows="5"
                placeholder="[ ] 원단 확정 2026-03-05&#10;[ ] 샘플 확인 @조영신&#10;[x] 끝낸 일">${esc(this._seasonTodoText(id))}</textarea>
            <div class="fi-sec">누가 볼 수 있나</div>
            ${isMaster ? `
            <label class="pa-opt"><input type="radio" name="fi-acc" value="all" ${acc === 'all' ? 'checked' : ''}>
                <span><b>전체 권한</b><em>브랜드에 접근할 수 있는 사람 모두</em></span></label>
            <label class="pa-opt"><input type="radio" name="fi-acc" value="members" ${acc === 'members' ? 'checked' : ''}>
                <span><b>담당자만</b><em>아래에서 고른 사람만</em></span></label>
            <div class="pa-list" id="fi-list">
                ${accs.map(a => `<label class="pa-m"><input type="checkbox" value="${esc(a.username)}" ${mem.has(a.username) ? 'checked' : ''}>
                    <span class="mrow-face" style="width:24px;height:24px;font-size:11px">${esc((a.name || '?')[0])}</span>
                    <span>${esc(a.name)}<em>${esc(a.username)} · ${a.role === 'MASTER' ? '마스터' : (a.role === 'STAFF' ? '직원' : '파트너')}</em></span></label>`).join('')}
            </div>
            <p class="fi-note">이 시즌의 <b>메모·할 일</b>에 적용됩니다. 제품·자료는 브랜드 권한을 따릅니다.</p>
            ` : `
            <div class="fi-r ro"><span>${acc === 'all' ? '전체 권한' : '담당자만'}</span><b>${esc(who)}</b></div>
            <p class="fi-note">권한은 마스터만 바꿀 수 있습니다.</p>`}

            <div class="fi-act">
                <button class="mbtn" onclick="app.closeGlobalModal()">닫기</button>
                ${isMaster ? `<button class="mbtn pri" id="fi-save">저장</button>` : ''}
            </div>
        </div>`;
        c.style.display = 'flex';

        if (!isMaster) return;
        const sync = () => {
            const v = c.querySelector('input[name=fi-acc]:checked')?.value;
            const list = c.querySelector('#fi-list');
            list.style.opacity = v === 'members' ? '1' : '.4';
            list.style.pointerEvents = v === 'members' ? 'auto' : 'none';
        };
        c.querySelectorAll('input[name=fi-acc]').forEach(r => r.onchange = sync);
        sync();
        c.querySelector('#fi-save').onclick = async () => {
            const btn = c.querySelector('#fi-save');
            const name = c.querySelector('#fi-name').value.trim();
            if (!name) { this.showToast('이름은 비울 수 없습니다.'); return; }
            const patch = {
                name,
                brand_id: c.querySelector('#fi-brand').value || null,
                deadline: c.querySelector('#fi-due').value || null,
                access: c.querySelector('input[name=fi-acc]:checked')?.value || 'all',
                members: [...c.querySelectorAll('#fi-list input:checked')].map(x => x.value),
            };
            btn.disabled = true; btn.textContent = '저장 중...';
            const { error } = await this.supabase.from('products').update(patch).eq('id', id);
            if (!error) await this._saveSeasonTodo(id, c.querySelector('#fi-todo').value);
            btn.disabled = false; btn.textContent = '저장';
            if (error) { this.showToast('저장 실패: ' + error.message); return; }
            Object.assign(p, patch);
            this.closeGlobalModal();
            this.requestRender();
            this.showToast(`'${name}' 속성을 저장했습니다`);
        };
    }

    projectAccess(id) {
        const p = (mockData.products || []).find(x => String(x.id) === String(id)); if (!p) return;
        const esc = s => this._vesc(s);
        const accs = (mockData.companies || []).filter(c => c.username);
        const mem = new Set(p.members || []);
        const c = document.getElementById('global-modal-container'); if (!c) return;
        c.innerHTML = `
        <div class="glass modal-content fade-in" style="width:92%;max-width:420px;padding:1.6rem;border-radius:18px">
            <h2 style="margin:0 0 .3rem;font-size:1.1rem">${esc(p.name)} · 접근 권한</h2>
            <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:1.1rem">
                누가 이 시즌의 메모·할 일을 볼 수 있는지 정합니다.
            </div>
            <label class="pa-opt"><input type="radio" name="pa" value="all" ${(p.access || 'all') === 'all' ? 'checked' : ''}>
                <span><b>전체 권한</b><em>브랜드에 접근할 수 있는 사람 모두</em></span></label>
            <label class="pa-opt"><input type="radio" name="pa" value="members" ${p.access === 'members' ? 'checked' : ''}>
                <span><b>담당자만</b><em>아래에서 고른 사람만</em></span></label>
            <div class="pa-list" id="pa-list">
                ${accs.map(a => `<label class="pa-m"><input type="checkbox" value="${esc(a.username)}" ${mem.has(a.username) ? 'checked' : ''}>
                    <span class="mrow-face" style="width:24px;height:24px;font-size:11px">${esc((a.name || '?')[0])}</span>
                    <span>${esc(a.name)}<em>${esc(a.username)}</em></span></label>`).join('')}
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:1.3rem">
                <button onclick="app.closeGlobalModal()" class="mbtn">취소</button>
                <button class="mbtn pri" onclick="app.saveProjectAccess('${id}')">저장</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        const sync = () => {
            const v = c.querySelector('input[name=pa]:checked')?.value;
            c.querySelector('#pa-list').style.opacity = v === 'members' ? '1' : '.45';
            c.querySelector('#pa-list').style.pointerEvents = v === 'members' ? 'auto' : 'none';
        };
        c.querySelectorAll('input[name=pa]').forEach(r => r.onchange = sync);
        sync();
    }
    async saveProjectAccess(id) {
        const c = document.getElementById('global-modal-container');
        const access = c.querySelector('input[name=pa]:checked')?.value || 'all';
        const members = [...c.querySelectorAll('#pa-list input:checked')].map(x => x.value);
        const p = (mockData.products || []).find(x => String(x.id) === String(id));
        if (p) { p.access = access; p.members = members; }
        this.closeGlobalModal(); this.requestRender();
        try {
            const { error } = await this.supabase.from('products').update({ access, members }).eq('id', id);
            if (error) throw error;
            this.showToast(access === 'members' ? `담당자 ${members.length}명만 보게 했습니다` : '전체 권한으로 바꿨습니다');
        } catch (e) { this.showToast('저장 실패 (040 SQL 실행 필요): ' + (e.message || e)); }
    }
    async renameProject(id) {
        const p = (mockData.products || []).find(x => String(x.id) === String(id)); if (!p) return;
        const v = await this.showPrompt('시즌 이름', p.name || ''); if (v === null || !v.trim()) return;
        p.name = v.trim(); this.requestRender();
        try {
            const { error } = await this.supabase.from('products').update({ name: p.name }).eq('id', id);
            if (error) throw error;
        } catch (e) { this.showToast('이름 바꾸기 실패: ' + (e.message || e)); }
    }
    async moveProjectBrand(id) {
        const p = (mockData.products || []).find(x => String(x.id) === String(id)); if (!p) return;
        const brands = (mockData.brands || []).filter(b => b.status !== 'closed');
        if (!brands.length) { this.showToast('브랜드가 없습니다'); return; }
        const cur = brands.findIndex(b => b.id === p.brand_id);
        const msg = brands.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
        const v = await this.showPrompt(`옮길 브랜드 번호\n${msg}`, String(cur >= 0 ? cur + 1 : 1));
        const i = Number(v) - 1;
        if (!brands[i]) return;
        p.brand_id = brands[i].id; this.requestRender();
        try {
            const { error } = await this.supabase.from('products').update({ brand_id: p.brand_id }).eq('id', id);
            if (error) throw error;
        } catch (e) { this.showToast('브랜드 바꾸기 실패: ' + (e.message || e)); }
    }
    async setProjectDue(id) {
        const p = (mockData.products || []).find(x => String(x.id) === String(id)); if (!p) return;
        const v = await this.showPrompt('마감일 (YYYY-MM-DD, 비우면 없앰)', p.due_date || '');
        if (v === null) return;
        const due = v.trim() || null;
        if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) { this.showToast('날짜는 2026-10-05 처럼 적어주세요'); return; }
        p.due_date = due; this.requestRender();
        try {
            const { error } = await this.supabase.from('products').update({ due_date: due }).eq('id', id);
            if (error) throw error;
        } catch (e) { this.showToast('마감일 바꾸기 실패: ' + (e.message || e)); }
    }
    // ── 알림 센터 (오른쪽에서 밀려나온다) ─────────────────────
    //  담당자로 지정된 할일, 나에게 온 요청, 오늘·지난 기한을 한 곳에 모은다.
    //  안 읽은 게 있으면 메뉴바 종에 빨간 점이 깜빡인다.
    _notifs() {
        const me = this._myId();
        const myName = this.currentUser?.name || '';
        const today = new Date().toISOString().slice(0, 10);
        const nameOf = id => (mockData.companies || []).find(c => c.id === id)?.name || '';
        const out = [];
        // 0) 새 버전 — 누를 때까지 남는다
        if (this._updReady) out.push({ id: 'upd:' + __BUILD__, kind: '업데이트', icon: 'ph-arrow-circle-down',
            col: '#0a84ff', title: '새 버전이 나왔습니다', sub: '눌러서 업데이트', when: '', view: '__update' });
        // 1) 나에게 배정된 할일
        (mockData.products || []).forEach(p => (p.todos || []).forEach(t => {
            if (t.completed) return;
            if (t.assignee === me && t.created_by !== me) {
                out.push({ id: 'todo:' + t.id, kind: '담당 지정', icon: 'ph-user-check', col: '#0a84ff',
                    title: t.text, sub: `${p.name} · ${nameOf(t.created_by) || '요청'}님이 맡겼습니다`,
                    when: t.due_date, view: 'reminders' });
            } else if (t.created_by === me && t.assignee && t.assignee !== me) {
                out.push({ id: 'req:' + t.id, kind: '내가 요청', icon: 'ph-paper-plane-tilt', col: '#30d158',
                    title: t.text, sub: `${p.name} · ${nameOf(t.assignee)}님이 맡는 중`,
                    when: t.due_date, view: 'reminders' });
            }
        }));
        // 2) 메모에서 나를 부른 줄
        this._allNoteTodos().forEach(t => {
            if (t.done || !t.at.includes(myName)) return;
            out.push({ id: 'note:' + t.id, kind: '메모에서 호출', icon: 'ph-at', col: '#bf5af2',
                title: t.title, sub: t.from, when: t.due, view: 'notes' });
        });
        // 3) 오늘까지인 할 일 · 지난 것
        (this.remList || []).forEach(r => {
            if (r.done || !r.due_date || r.due_date > today) return;
            out.push({ id: 'rem:' + r.id, kind: r.due_date < today ? '기한 지남' : '오늘까지',
                icon: 'ph-bell-ringing', col: r.due_date < today ? '#ff453a' : '#ff9f0a',
                title: r.title, sub: r.list_name || '', when: r.due_date, view: 'reminders' });
        });
        out.sort((a, b) => String(a.when || '9999').localeCompare(String(b.when || '9999')));
        return out;
    }
    _readSet() {
        try { return new Set(JSON.parse(localStorage.getItem('bhas_read:' + this._me()) || '[]')); }
        catch (_e) { return new Set(); }
    }
    _saveRead(set) {
        try { localStorage.setItem('bhas_read:' + this._me(), JSON.stringify([...set].slice(-400))); } catch (_e) {}
    }
    unreadCount() {
        const read = this._readSet();
        return this._notifs().filter(n => !read.has(n.id)).length;
    }
    openNotifCenter() {
        if (document.getElementById('noti-center')) { this.closeNotifCenter(); return; }
        const esc = s => this._vesc(s);
        const read = this._readSet();
        const list = this._notifs();
        const el = document.createElement('div');
        el.id = 'noti-center'; el.className = 'notic';
        el.innerHTML = `
            <div class="nc-top"><b>알림 센터</b>
                ${list.length ? `<button class="nc-all" onclick="app.readAllNotifs()">모두 읽음</button>` : ''}
                <button class="nc-x" onclick="app.closeNotifCenter()" title="닫기">✕</button></div>
            <div class="nc-body">
                ${list.length ? list.map(n => `
                <div class="nc-card${read.has(n.id) ? ' read' : ''}" onclick="app.openNotif('${esc(n.id)}','${n.view}')">
                    <span class="nc-ic" style="background:${n.col}"><i class="ph ${n.icon}"></i></span>
                    <div class="nc-tx">
                        <div class="nc-h"><b>${esc(n.kind)}</b><span>${esc(n.when || '')}</span></div>
                        <div class="nc-t">${esc(n.title)}</div>
                        <div class="nc-s">${esc(n.sub || '')}</div>
                    </div>
                </div>`).join('') : `<div class="nc-none">새 알림이 없습니다</div>`}
            </div>`;
        document.body.appendChild(el);
        this._ncOff = (ev) => {
            if (el.contains(ev.target) || ev.target.closest('.mac-bell')) return;
            this.closeNotifCenter();
        };
        setTimeout(() => document.addEventListener('mousedown', this._ncOff), 0);
    }
    closeNotifCenter() {
        document.removeEventListener('mousedown', this._ncOff || (() => {}));
        const el = document.getElementById('noti-center');
        if (!el) return;
        el.classList.add('out');
        setTimeout(() => el.remove(), 160);
        setTimeout(() => this.requestRender(), 200);
    }
    openNotif(id, view) {
        if (view === '__update') { this.applyUpdate(); return; }
        const read = this._readSet(); read.add(id); this._saveRead(read);
        this.closeNotifCenter();
        if (view) this.macOpen(view);
    }
    readAllNotifs() {
        const read = this._readSet();
        this._notifs().forEach(n => { if (n.view !== '__update') read.add(n.id); });
        this._saveRead(read);
        this.closeNotifCenter();
    }
    // ── 전체 메뉴 (독 맨 왼쪽) ────────────────────────────────
    //  대시보드의 모든 화면을 한 판에 펼친다. 글자를 치면 걸러지고 Enter 로 첫 번째를 연다.
    LAUNCH = [
        { g: '판매', items: [['orders', '주문', 'ph-shopping-bag-open'], ['cs', 'CS', 'ph-arrows-counter-clockwise'],
            ['inventory', '재고', 'ph-package'], ['sales', '정산', 'ph-chart-line-up'],
            ['expenses', '지출', 'ph-credit-card'], ['analysis', '분석', 'ph-chart-donut'],
            ['integrations', '연동', 'ph-plugs-connected']] },
        { g: '생산', items: [['items', '제품리스트', 'ph-t-shirt'], ['dashboard', '시즌', 'ph-calendar-blank'], ['vendors', '생산현황', 'ph-factory'],
            ['tech_packs', '작업지시서', 'ph-clipboard-text'], ['sample_maker', '샘플·디자인', 'ph-scissors'],
            ['quotes', '견적', 'ph-receipt']] },
        { g: '업무', items: [['news', '뉴스', 'ph-newspaper'], ['notes', '메모', 'ph-note'], ['reminders', '할 일', 'ph-list-checks'],
            ['calendar', '캘린더', 'ph-calendar-dots'], ['table', '표', 'ph-table'],
            ['contacts', '연락처', 'ph-address-book'], ['sns', 'SNS', 'ph-instagram-logo'],
            ['documents', '자료실', 'ph-folder-open']] },
        { g: '관리', items: [['settings', '설정', 'ph-gear-six'], ['user_management', '계정', 'ph-users-three'],
            ['brand_management', '브랜드', 'ph-shield-check'], ['feedback', '불편사항', 'ph-chat-dots']] },
    ];
    // ============================================================
    //  모두 찾기 — 어디서든 ⌘K. 한 칸에서 전부 뒤진다.
    //   제품 · 시즌 · 주문 · CS · 메모 · 할 일 · 자료 · 공장 · 고객사 · 화면
    // ============================================================
    openFind(preset) {
        if (document.getElementById('spot')) { this.closeFind(); return; }
        const el = document.createElement('div');
        el.id = 'spot'; el.className = 'spot';
        el.innerHTML = `<div class="spot-box">
            <div class="spot-f"><i class="ph ph-magnifying-glass"></i>
                <input id="spot-q" placeholder="무엇이든 찾기 — 제품 · 시즌 · 주문 · CS · 메모 · 자료" autocomplete="off"
                    autocapitalize="off" autocorrect="off" spellcheck="false">
                <kbd>esc</kbd></div>
            <div class="spot-body" id="spot-body"></div>
        </div>`;
        document.body.appendChild(el);
        //  찾는 동안 자료가 없으면 못 찾는다 — 한 번씩 받아둔다
        this._findWarm();
        const q = el.querySelector('#spot-q');
        q.value = preset || '';
        this._drawFind(q.value);
        q.oninput = () => { clearTimeout(this._spotT); this._spotT = setTimeout(() => this._drawFind(q.value), 110); };
        q.onkeydown = (e) => {
            const items = [...el.querySelectorAll('.spot-i')];
            const cur = items.findIndex(x => x.classList.contains('on'));
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!items.length) return;
                const n = e.key === 'ArrowDown' ? Math.min(cur + 1, items.length - 1) : Math.max(cur - 1, 0);
                items.forEach(x => x.classList.remove('on'));
                items[n].classList.add('on');
                items[n].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                (items[cur < 0 ? 0 : cur] || {}).click?.();
            }
        };
        el.onmousedown = (e) => { if (!e.target.closest('.spot-box')) this.closeFind(); };
        this._spotKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closeFind(); } };
        document.addEventListener('keydown', this._spotKey, true);
        setTimeout(() => { q.focus(); q.select(); }, 30);
    }
    closeFind() {
        document.removeEventListener('keydown', this._spotKey || (() => {}), true);
        document.getElementById('spot')?.remove();
    }
    _findWarm() {
        const w = (f, loaded, loading) => { if (!this[loaded] && !this[loading]) this[f](); };
        w('loadItems', '_itemsLoaded', '_itemsLoading');
        w('loadOrders', '_ordersLoaded', '_ordersLoading');
        w('loadCS', '_csLoaded', '_csLoading');
        w('loadNotes', '_noteLoaded', '_noteLoading');
        w('loadReminders', '_remLoaded', '_remLoading');
        w('loadVendors', '_vendorsLoaded', '_vendorsLoading');
        w('loadQuotes', '_quotesLoaded', '_quotesLoading');
        this.ensureTechPacks();
    }
    //  한 줄이 뭘 뜻하는지 · 누르면 어디로 가는지
    _findAll(q) {
        const k = (q || '').trim().toLowerCase();
        if (!k) return [];
        const hit = (...vals) => vals.some(v => String(v == null ? '' : v).toLowerCase().includes(k));
        const out = [];
        const add = (kind, icon, color, title, sub, go) => out.push({ kind, icon, color, title, sub, go });
        const seasonName = id => (this._seasons().find(p => String(p.id) === String(id)) || {}).name || '';

        (this.pItems || []).forEach(i => {
            if (hit(i.name, i.pattern_no, i.memo, i.status)) {
                add('제품', 'ph-t-shirt', '#0a84ff', i.name || '이름 없는 제품',
                    [this._brandNameById(i.brand_id), seasonName(i.product_id), i.status].filter(x => x && x !== '-').join(' · '),
                    `app.findGo('items','${i.id}')`);
            }
        });
        this._seasons().forEach(p => {
            if (hit(p.name)) add('시즌', 'ph-folder', '#5ac8fa', p.name,
                `제품 ${(this.pItems || []).filter(i => String(i.product_id) === String(p.id)).length}개`,
                `app.findGo('season','${p.id}')`);
        });
        (this.orders || []).forEach(o => {
            if (hit(o.order_id, o.receiver_name, o.buyer_name, (o.items || []).map(x => x.product_name).join(' '))) {
                add('주문', 'ph-shopping-bag-open', '#30d158', o.receiver_name || o.buyer_name || o.order_id,
                    [o.order_id, o.order_date].filter(Boolean).join(' · '), `app.findGo('orders','${o.order_id}')`);
            }
        });
        (this.csList || []).forEach(t => {
            if (hit(t.customer_name, t.order_no, t.product_name, t.memo)) {
                add('CS', 'ph-arrows-counter-clockwise', '#ff9f0a', `${t.customer_name || ''} · ${t.kind || ''}`,
                    [t.product_name, t.status].filter(Boolean).join(' · '), `app.findGo('cs','${t.id}')`);
            }
        });
        (this.noteList || []).forEach(n => {
            if (hit(n.title, n.body)) add('메모', 'ph-note', '#e0a800', n.title || '새 메모',
                (this._noteText(n) || '').replace(/\s+/g, ' ').trim().slice(0, 40), `app.findGo('notes','${n.id}')`);
        });
        (this.reminders || []).forEach(r => {
            if (hit(r.title, r.memo)) add('할 일', 'ph-list-checks', '#ff453a', r.title,
                [r.list_name, r.due_date].filter(Boolean).join(' · '), `app.findGo('reminders','${r.id}')`);
        });
        (this._techPacks || []).forEach(t => {
            if (hit(t.style_name, t.style_no)) add('작업지시서', 'ph-clipboard-text', '#5e5ce6',
                t.style_name || '무제', t.style_no || '', `app.findGo('tech_packs','${t.id}')`);
        });
        (this.quotes || []).forEach(x => {
            if (hit(x.quote_no, x.client_name)) add('견적', 'ph-receipt', '#30d158',
                x.client_name || '견적서', [x.quote_no, x.quote_date].filter(Boolean).join(' · '),
                `app.findGo('quotes','${x.id}')`);
        });
        (this.vendors || []).forEach(v => {
            if (hit(v.name, v.address, v.phone)) add('거래처', 'ph-factory', '#a2845e', v.name,
                [v.category, v.address].filter(Boolean).join(' · '), `app.findGo('vendors','${v.id}')`);
        });
        (this.clients || []).forEach(c => {
            if (hit(c.name, c.contact, c.tel)) add('고객사', 'ph-address-book', '#bf5af2', c.name,
                [c.contact, c.tel].filter(Boolean).join(' · '), `app.findGo('clients','${c.id}')`);
        });
        (mockData.globalDocuments || []).forEach(d => {
            if (hit(d.name)) add('자료', 'ph-file', '#8e8e93', d.name, d.category || '',
                `app.findGo('documents','${d.id}')`);
        });
        //  화면 이름도 — '재고' 라고 치면 재고 화면이 뜬다
        this.LAUNCH.forEach(sec => sec.items.forEach(([id, label, icon]) => {
            if (hit(label)) add('화면', icon, '#8e8e93', label, sec.g, `app.findGo('view','${id}')`);
        }));
        return out;
    }
    _drawFind(q) {
        const body = document.getElementById('spot-body'); if (!body) return;
        const esc = s => this._vesc(s);
        const k = (q || '').trim();
        if (!k) {
            body.innerHTML = `<div class="spot-hint">제품 이름 · 패턴명 · 주문번호 · 고객 이름 · 메모 내용 · 화면 이름<br>
                <kbd>↑</kbd><kbd>↓</kbd> 고르고 <kbd>⏎</kbd> 로 엽니다</div>`;
            return;
        }
        const all = this._findAll(k);
        if (!all.length) { body.innerHTML = `<div class="spot-hint">'${esc(k)}' 로 찾은 게 없습니다</div>`; return; }
        const order = ['제품', '시즌', '주문', 'CS', '메모', '할 일', '작업지시서', '견적', '거래처', '고객사', '자료', '화면'];
        const by = {};
        all.forEach(r => (by[r.kind] = by[r.kind] || []).push(r));
        let html = '', n = 0;
        order.filter(g => by[g]).forEach(g => {
            html += `<div class="spot-g">${esc(g)} <em>${by[g].length}</em></div>`;
            by[g].slice(0, 8).forEach(r => {
                html += `<button class="spot-i${n === 0 ? ' on' : ''}" onclick="${r.go}">
                    <span class="spot-ic"><i class="ph ${r.icon}" style="color:${r.color}"></i></span>
                    <span class="spot-t"><b>${esc(r.title)}</b>${r.sub ? `<em>${esc(r.sub)}</em>` : ''}</span>
                </button>`;
                n++;
            });
            if (by[g].length > 8) html += `<div class="spot-more">외 ${by[g].length - 8}건</div>`;
        });
        body.innerHTML = html;
    }
    //  찾은 줄을 누르면 그 화면을 열고 그 줄을 골라 놓는다
    findGo(what, id) {
        this.closeFind();
        const open = (v) => { if (this.macMode) this.macOpen(v); else this.switchView(v); };
        if (what === 'view') { open(id); return; }
        if (what === 'season') { this.openSeasonItems(id); return; }
        const pick = {
            items: () => { this.itemSel = id; this.itemSeason = 'ALL'; this.itemStatus = 'ALL'; this.itemQ = ''; open('items'); },
            orders: () => { this.orderSel = id; open('orders'); },
            cs: () => { this.csSel = id; this.csFilter = '전체'; this.csQuery = ''; open('cs'); },
            notes: () => { this.noteSel = id; this.noteFolder = 'all'; this.noteSea = 'ALL'; open('notes'); },
            reminders: () => open('reminders'),
            tech_packs: () => { this.tpSel = id; open('tech_packs'); },
            quotes: () => { open('quotes'); setTimeout(() => this.showQuoteModal(id), 350); },
            vendors: () => open('vendors'),
            clients: () => open('quotes'),
            documents: () => { this.docSel = id; open('documents'); },
        };
        (pick[what] || (() => open('home')))();
        this.requestRender();
    }

    openLauncher() {
        if (document.getElementById('launcher')) { this.closeLauncher(); return; }
        const el = document.createElement('div');
        el.id = 'launcher'; el.className = 'launcher';
        el.innerHTML = `
            <button class="lc-x" onclick="app.closeLauncher()" title="닫기 (Esc)"><i class="ph ph-x"></i></button>
            <div class="lc-find"><i class="ph ph-magnifying-glass"></i>
                <input id="lc-q" placeholder="찾기" autocomplete="off"></div>
            <div class="lc-body" id="lc-body"></div>
            <div class="lc-hint">아무 데나 누르거나 Esc 로 닫습니다</div>`;
        document.body.appendChild(el);
        this._drawLauncher('');
        const q = el.querySelector('#lc-q');
        q.oninput = () => this._drawLauncher(q.value);
        q.onkeydown = (e) => {
            if (e.key === 'Enter') { const f = el.querySelector('.lc-i'); if (f) f.click(); }
        };
        // 앱 타일·검색칸·닫기 말고 아무 데나 누르면 닫힌다
        el.onmousedown = (e) => {
            if (e.target.closest('.lc-i, .lc-find, .lc-x')) return;
            this.closeLauncher();
        };
        // Esc 는 커서가 어디 있든 먹어야 한다 (전에는 검색칸에 있을 때만 먹었다)
        this._lcKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closeLauncher(); } };
        document.addEventListener('keydown', this._lcKey, true);
        setTimeout(() => q.focus(), 40);
    }
    closeLauncher() {
        document.removeEventListener('keydown', this._lcKey || (() => {}), true);
        document.getElementById('launcher')?.remove();
    }
    _drawLauncher(q) {
        const body = document.getElementById('lc-body'); if (!body) return;
        const esc = s => this._vesc(s);
        const k = (q || '').trim().toLowerCase();
        const role = this.currentUser?.role;
        let html = '';
        this.LAUNCH.forEach(sec => {
            let items = sec.items;
            if (sec.g === '관리' && role !== 'MASTER') items = items.filter(i => i[0] === 'settings');
            if (k) items = items.filter(i => i[1].toLowerCase().includes(k));
            if (!items.length) return;
            html += `<div class="lc-g">${esc(sec.g)}</div><div class="lc-grid">` + items.map(([id, label, icon]) =>
                `<button class="lc-i" onclick="app.launch('${id}')">
                    <span class="lc-ic"><i class="ph ${icon}"></i></span><em>${esc(label)}</em></button>`).join('') + '</div>';
        });
        body.innerHTML = html || `<div class="m3-none">찾는 화면이 없습니다</div>`;
    }
    launch(view) {
        this.closeLauncher();
        if (this.macMode) this.macOpen(view); else this.switchView(view);
    }
    //  모든 화면이 같은 머리를 쓴다 — 제목 · 한 줄 설명 · 오른쪽 단추 (제품리스트와 같은 결)
    _mpTop(title, sub, right) {
        return `<div class="mp-top"><div class="mp-tl"><b>${this._vesc(title)}</b>${sub ? `<span>${this._vesc(sub)}</span>` : ''}</div>
            ${right ? `<div class="mp-sp">${right}</div>` : ''}</div>`;
    }
    _mpPage(title, sub, right, body) {
        return `<div class="mp">${this._mpTop(title, sub, right)}<div class="mp-body">${body}</div></div>`;
    }
    _mpNone(msg) { return `<div class="mnone">${this._vesc(msg)}</div>`; }

    _appShell(view, inner) {
        const side = this._appTabBar(view);
        if (!side) return inner;
        const detail = this._detailPane(view);
        return `<div class="appwrap${detail ? ' three' : ''}">${side}<div class="appmain">${inner}</div>${detail || ''}</div>`;
    }
    // 세 번째 칸 — 고른 줄의 상세. 주문·CS·재고에 붙는다.
    _detailPane(view) {
        const esc = s => this._vesc(s);
        const f = (k, v) => v || v === 0 ? `<div class="dt-f"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>` : '';
        const wrap = (title, sub, body, acts) => `<aside class="appdet">
            <div class="dt-h"><div class="dt-ht"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>
                <button class="dt-close" title="접기" onclick="app.closeDetail('${view}')"><i class="ph ph-sidebar-simple"></i></button></div>
            <div class="dt-b">${body}</div>${acts ? `<div class="dt-a">${acts}</div>` : ''}</aside>`;
        //  고른 게 없으면 칸을 비워 두지 않고 아예 접는다 — 자리만 먹는다
        const empty = () => '';

        if (view === 'vendors') {
            const isNew = this.venSel === '__new';
            const v = isNew ? {} : (this.vendors || []).find(x => String(x.id) === String(this.venSel));
            if (!v) return empty();
            const CATS = ['봉제', '원단', '부자재', '프린트', '기타'];
            const jobs = (v.jobs || []);
            const act = jobs.filter(j => j.status !== 'done');
            if (this.venEdit || isNew) {
                return wrap(isNew ? '새 생산처' : (v.name || '생산처'), isNew ? '' : '고치는 중', `
                    <div class="fi-r"><span>상호</span><input id="vd-name" class="nw-f" value="${esc(v.name || '')}" placeholder="예: 성수봉제"></div>
                    <div class="fi-r"><span>분류</span><select id="vd-cat" class="nw-f">
                        ${CATS.map(k => `<option value="${k}"${v.category === k ? ' selected' : ''}>${k}</option>`).join('')}</select></div>
                    <div class="fi-r"><span>주소</span><input id="vd-addr" class="nw-f" value="${esc(v.address || '')}"></div>
                    <div class="fi-r"><span>전화</span><input id="vd-phone" class="nw-f" value="${esc(v.phone || '')}"></div>
                    <div class="fi-r"><span>사업자</span><input id="vd-biz" class="nw-f" value="${esc(v.biz_no || '')}"></div>
                    <div class="dt-sec">위치 <em style="font-style:normal;font-weight:600;opacity:.6">지도를 눌러 찍으세요</em></div>
                    <div id="vd-pickmap" class="vd-pick"></div>
                    <div class="dt-sec">메모</div>
                    <textarea id="vd-memo" class="dt-ta" style="min-height:70px">${esc(v.memo || '')}</textarea>
                `, `<button class="mbtn pri" onclick="app.saveVendor('${isNew ? '' : v.id}')">저장</button>
                    <button class="mbtn" onclick="app.selectVendor(${isNew ? 'null' : `'${v.id}'`})">취소</button>
                    ${isNew ? '' : `<button class="mbtn danger" onclick="app.deleteVendor('${v.id}')">삭제</button>`}`);
            }
            return wrap(v.name || '생산처', [v.category, act.length ? `진행 ${act.length}` : ''].filter(Boolean).join(' · '), `
                ${f('주소', v.address)}
                ${f('전화', v.phone)}
                ${f('사업자', v.biz_no)}
                ${v.memo ? `<div class="dt-sec">메모</div><div class="dt-memo">${esc(v.memo)}</div>` : ''}
                <div class="dt-sec">물품 ${jobs.length ? `${act.length}/${jobs.length}` : ''}
                    <span class="dt-tools"><button class="vjob-add" data-id="${v.id}" title="물품 추가"><i class="ph ph-plus"></i></button></span></div>
                ${jobs.length ? jobs.map(j => {
                    const done = j.status === 'done';
                    return `<div class="dt-li job${done ? ' done' : ''}">
                        <button class="vjob-toggle dt-ck${done ? ' on' : ''}" data-id="${j.id}" title="완료 토글">${done ? '✓' : ''}</button>
                        <span>${esc(j.title || '작업')}${j.qty ? ` · ${j.qty}장` : ''}</span>
                        <b>${esc(j.due_date || '')}</b>
                        <button class="dt-x vjob-del" data-id="${j.id}" title="삭제">×</button></div>`;
                  }).join('') : '<div class="dt-none sm">아직 물품이 없습니다</div>'}
            `, `<button class="mbtn pri" onclick="app.toggleVenEdit()">고치기</button>`);
        }
        if (view === 'tech_packs') {
            const t = (this._techPacks || []).find(x => String(x.id) === String(this.tpSel));
            if (!t) return empty();
            const it = (this.pItems || []).find(i => String(i.id) === String(t.item_id) || String(i.tech_pack_id) === String(t.id));
            const sea = it ? this._seasons().find(p => String(p.id) === String(it.product_id)) : null;
            let thumb = ''; try { thumb = garmentPreviewSVG(t.config, false); } catch (_e) {}
            return wrap(t.style_name || '무제', t.style_no || '', `
                ${thumb ? `<div class="dt-thumb">${thumb}</div>` : ''}
                ${f('만든 날', (t.created_at || '').slice(0, 10))}
                ${f('제품', it ? it.name : '')}
                ${f('시즌', sea ? sea.name : '')}
            `, `<button class="mbtn pri" onclick="app.openTechPack('${t.id}')">열기</button>
                <button class="mbtn" onclick="app.downloadTechPack('${t.id}')">다운로드</button>
                <button class="mbtn" onclick="app.printTechPack('${t.id}')">인쇄</button>
                <button class="mbtn danger" onclick="app.deleteTechPack('${t.id}','${esc(t.style_name || '')}')">삭제</button>`);
        }
        if (view === 'items') {
            const it = (this.pItems || []).find(x => String(x.id) === String(this.itemSel));
            if (!it) return empty();
            const season = this._seasons().find(p => String(p.id) === String(it.product_id));
            const vendor = (this.vendors || []).find(v => String(v.id) === String(it.vendor_id));
            const tp = (this._techPacks || []).find(t => String(t.id) === String(it.tech_pack_id));
            const qt = (this.quotes || []).find(q => String(q.id) === String(it.quote_id));
            const jobs = (this.vendors || []).flatMap(v => (v.jobs || []).map(j => ({ ...j, vname: v.name })))
                .filter(j => String(j.item_id) === String(it.id));
            const link = (label, has, text, onHas, onNone) => `<div class="dt-li">
                <span>${esc(label)}</span>
                ${has ? `<b class="pa-ok" style="cursor:pointer" onclick="${onHas}">${esc(text)}</b>`
                      : `<b style="cursor:pointer;color:#0a84ff" onclick="${onNone}">만들기</b>`}</div>`;
            return wrap(it.name || '이름 없는 제품',
                [((mockData.brands || []).find(b2 => b2.id === it.brand_id) || {}).name, it.pattern_no].filter(Boolean).join(' · '), `
                ${f('제작현황', it.status)}
                ${f('시즌', season ? season.name : '')}
                ${f('공장', vendor ? vendor.name : '')}
                ${f('출고예정일', it.ship_date)}
                ${f('오픈일', it.open_date)}
                ${f('부자재', it.trims ? '준비됨' : '아직')}
                <div class="dt-sec">판매명 <em style="font-style:normal;font-weight:600;opacity:.6">카페24 최종 상품명</em></div>
                ${(it.sale_names || []).length
                    ? (it.sale_names || []).map(n2 => `<div class="dt-li sale">
                        <span>${esc(n2)}</span>
                        <button class="dt-x" title="떼기" onclick="app.itemDelSale('${it.id}','${esc(n2).replace(/'/g, "\\'")}')">×</button></div>`).join('')
                    : '<div class="dt-li"><span>아직 안 붙였습니다</span><b></b></div>'}
                ${(() => { const sold = this._itemSold(it);
                    return sold ? `<div class="dt-f"><span>팔린 수량</span><b>${sold.qty}개 · 주문 ${sold.n}건</b></div>` : ''; })()}
                <div class="dt-li"><span></span><b style="cursor:pointer;color:#0a84ff"
                    onclick="app.pickSaleName('${it.id}')">판매명 고르기</b></div>
                <div class="dt-sec">연동</div>
                ${link('작업지시서·샘플', !!tp, tp ? (tp.style_name || '열기') : '', `app.openTechPack('${tp ? tp.id : ''}')`, `app.itemNewTechPack('${it.id}')`)}
                ${link('견적', !!qt, qt ? (qt.quote_no || qt.client_name || '열기') : '', `app.itemOpenQuote('${it.id}')`, `app.itemNewQuote('${it.id}')`)}
                <div class="dt-li"><span>생산 투입</span><b>${jobs.length ? jobs.length + '건' : '없음'}</b></div>
                ${jobs.map(j => `<div class="dt-li"><span>${esc(j.vname || '')} · ${esc(j.stage || '')}</span><b>${esc(j.due_date || '')}</b></div>`).join('')}
                ${it.memo ? `<div class="dt-sec">한 줄 메모</div><div class="dt-memo">${esc(it.memo)}</div>` : ''}
                <div class="dt-sec">제품 메모
                    <span class="dt-tools">
                        <button onclick="app.itemNoteInsert('todo')" title="할 일 [ ]"><i class="ph ph-check-square"></i></button>
                        <button onclick="app.pickItemPhoto('${it.id}')" title="사진 넣기"><i class="ph ph-image"></i></button>
                        <button class="${this.ipPreview ? 'on' : ''}" onclick="app.toggleItemPreview()"
                            title="${this.ipPreview ? '고치기' : '보기'}"><i class="ph ${this.ipPreview ? 'ph-pencil-simple' : 'ph-eye'}"></i></button>
                        <em id="ip-sv-d"></em>
                    </span></div>
                ${(() => {
                    const note = this._itemNoteOf(it.id);
                    return this.ipPreview
                        ? `<div class="dt-doc nb">${note ? this._noteBodyHTML(note) : '<div class="dt-none sm">아직 적은 게 없습니다</div>'}</div>`
                        : `<textarea id="item-note-d" class="dt-ta" placeholder="여기에 적으세요 · [ ] 로 할 일"
                            oninput="app.itemNoteTyping()" onblur="app.saveItemNote('${it.id}')">${esc(note ? this._noteText(note) : '')}</textarea>`;
                })()}
            `, `${tp ? `<button class="mbtn pri" onclick="app.openTechPack('${tp.id}')">작업지시서 열기</button>`
                     : `<button class="mbtn pri" onclick="app.itemNewTechPack('${it.id}')">작업지시서 만들기</button>`}
                <button class="mbtn" onclick="app.itemToVendor('${it.id}')">생산 투입</button>
                <button class="mbtn" onclick="app.delItem('${it.id}')">삭제</button>`);
        }
        if (view === 'orders') {
            const o = (this.orders || []).find(x => String(x.order_id) === String(this.orderSel));
            if (!o) return empty();
            const items = o.items || [];
            const cs = (this.csList || []).filter(t => String(t.order_no) === String(o.order_id));
            return wrap(o.receiver_name || o.buyer_name || '주문', o.order_id, `
                ${f('주문일', o.order_date)}
                ${f('채널', o.mall_key || o.channel)}
                ${f('상태', ({ new: '신규', ready: '배송대기', shipping: '배송중', done: '완료' })[o.status] || o.status)}
                ${f('받는분', o.receiver_name)}
                ${f('연락처', o.receiver_phone)}
                ${f('주소', o.receiver_addr || o.address)}
                ${f('송장', o.invoice_no ? `${o.courier || ''} ${o.invoice_no}` : '')}
                ${items.length ? `<div class="dt-sec">상품 ${items.length}</div>
                    ${items.map(i => `<div class="dt-li"><span>${esc(i.product_name || '-')}</span><b>${esc(String(i.qty || 1))}</b></div>`).join('')}` : ''}
                ${cs.length ? `<div class="dt-sec">CS ${cs.length}건</div>
                    ${cs.map(t => `<div class="dt-li"><span>${esc(t.kind)}</span><b>${esc(t.status)}</b></div>`).join('')}` : ''}
            `, `<button class="mbtn pri" onclick="app.csFromOrder('${esc(String(o.order_id))}')">CS 접수</button>`);
        }
        if (view === 'cs') {
            const t = (this.csList || []).find(x => String(x.id) === String(this.csSel));
            if (!t) return empty();
            return wrap(t.customer_name || '고객', `${t.kind} · ${t.status}`, `
                ${f('주문번호', t.order_no)}
                ${f('상품', t.product_name)}
                ${f('구매처', t.purchase_from)}
                ${f('접수 경로', t.contact_channel)}
                ${f('접수일', (t.occurred_on || t.created_at || '').slice(0, 10))}
                ${f('담당', t.created_by)}
                ${t.memo ? `<div class="dt-sec">메모</div><div class="dt-memo">${esc(t.memo)}</div>` : ''}
            `, `${this.CS_STATUSES.map(st => `<button class="mbtn${t.status === st ? ' pri' : ''}"
                    onclick="app.setCSStatus('${t.id}','${st}')">${st}</button>`).join('')}
                <button class="mbtn" onclick="app.editCSMemo('${t.id}')">메모</button>`);
        }
        if (view === 'inventory') {
            const data = this.inventory || { items: [], listings: [], ledger: [] };
            const it = (data.items || []).find(x => String(x.id) === String(this.invSel));
            if (!it) return empty();
            const map = (data.listings || []).find(l => l.channel === 'cafe24' && l.inventory_item_id === it.id);
            const RL = { initial: '초기', restock: '입고', cafe24_order: '카페24판매', manual: '수동', adjust: '보정', return: '반품' };
            const log = (data.ledger || []).filter(l => l.inventory_item_id === it.id).slice(0, 25);
            const low = it.on_hand <= it.safety_stock;
            return wrap(it.name || '품목', [it.sku, it.option_name].filter(Boolean).join(' · '), `
                <div class="dt-stock">
                    <button class="mbtn inv-dec" data-id="${it.id}">−</button>
                    <b style="${low ? 'color:#ff453a' : ''}">${it.on_hand}</b>
                    <button class="mbtn inv-inc" data-id="${it.id}">＋</button>
                    ${low ? '<em>안전재고 이하</em>' : ''}
                </div>
                ${f('안전재고', it.safety_stock)}
                ${f('브랜드', this._brandNameById(it.brand_id))}
                ${f('카페24', map && map.channel_variant_code
                    ? `${map.channel_product_no || ''}/${map.channel_variant_code}` + (map.allocated > 0 ? ` · 배정 ${map.allocated}` : '')
                    : '미매핑')}
                <div class="dt-sec">변동 내역 ${log.length ? log.length : ''}</div>
                ${log.length ? log.map(l => `<div class="dt-li">
                    <span>${esc((l.created_at || '').slice(5, 10))} ${esc(RL[l.reason] || l.reason || '')}</span>
                    <b style="color:${l.delta >= 0 ? '#30d158' : '#ff453a'}">${l.delta >= 0 ? '+' : ''}${l.delta}</b></div>`).join('')
                  : '<div class="dt-li"><span>기록 없음</span><b></b></div>'}
            `, `<button class="mbtn pri inv-adjust" data-id="${it.id}">조정</button>
                <button class="mbtn inv-map" data-id="${it.id}">매핑</button>`);
        }
        return '';
    }
    selectOrder(id) { this.orderSel = id; this.requestRender(); }
    selectCS(id) { if (String(this.csSel) === String(id)) return; this.csSel = id; this.requestRender(); }
    selectInv(id) { if (String(this.invSel) === String(id)) return; this.invSel = id; this.requestRender(); }
    // 탭을 누르면 그 창의 화면만 바뀐다(새 창을 열지 않는다)
    switchAppTab(winId, view) {
        const w = (this.wins || []).find(x => x.id === winId);
        if (w) { w.view = view; this.requestRender(); return; }
        this.switchView(view);
    }
    renderSubView(products) {
        const { role, id: currentUserId, name: currentUserName } = this.currentUser;
        if (this.currentView === 'home') return this.renderHome(products);
        if (this.currentView === 'settings') return this.renderSettings();
        if (this.currentView === 'contacts') return this.renderContacts();
        if (this.currentView === 'news') return this.renderNews();

        // 데이터 정규화 및 상태 판별 헬퍼
        const isStageCompleted = (p, s) => {
            if (p.stages_data && p.stages_data[s.id] && p.stages_data[s.id].status === 'completed') return true;
            if (p.stages_data && p.stages_data[s.docType] && p.stages_data[s.docType].status === 'completed') return true;
            if (p.documents && p.documents.some(d => d.type === s.docType || d.type === s.id)) return true;
            return false;
        };

        const getProgress = (p) => {
            const completedCount = STAGES.filter(s => isStageCompleted(p, s)).length;
            return Math.round((completedCount / STAGES.length) * 100);
        };

        if (this.currentView === 'dashboard') {
            const isActive = (p) => {
                const stage = p.currentStage || 'consulting';
                if (stage === 'shipping') return false; 
                // 신규 시즌도 '진행 중'으로 표시하여 즉각적인 연동 확인이 가능하도록 수정
                return true; 
            };
            
            const activeProducts = products.filter(p => isActive(p));
            const scheduledProducts = products.filter(p => {
                const stage = p.currentStage || 'consulting';
                return stage !== 'shipping' && !isActive(p);
            });
            const completedProducts = products.filter(p => (p.currentStage || 'consulting') === 'shipping');

            //  맥 '파인더' 결 — 시즌 한 칸이 폴더다. 열면 그 시즌의 제품리스트로 간다.
            const esc = x => this._vesc(x);
            const view = this.seasonView || 'list';   // 기본은 목록
            const sq = (this.seasonQ || '').trim().toLowerCase();
            const brandOf = p => (mockData.brands || []).find(b => b.id === p.brand_id);
            const itemsOf = p => (this.pItems || []).filter(i => String(i.product_id) === String(p.id)).length;
            const dueOf = p => p.deadline || p.due_date || '';
            const stageOf = p => {
                const last = STAGES.slice().reverse().find(x => isStageCompleted(p, x));
                return last ? last.label : '시작 전';
            };
            const match = p => !sq || [p.name, (brandOf(p) || {}).name].some(v => String(v || '').toLowerCase().includes(sq));

            const tile = p => {
                const b = brandOf(p), col = (b && b.brand_color) || '#0a84ff', n = itemsOf(p);
                const lock = (p.access === 'members');
                return `<span class="fd-wrap">
                    <button class="fd-it" onclick="app.openSeasonItems('${p.id}')"
                        oncontextmenu="app.projectMenu(event,'${p.id}')" title="${esc(p.name)}">
                        <span class="fd-th"><i class="ph-fill ph-folder" style="color:${col}"></i>${n ? `<em class="fd-badge">${n}</em>` : ''}${lock ? `<em class="fd-lock" title="담당자만"><i class="ph-fill ph-lock-simple"></i></em>` : ''}</span>
                        <span class="fd-nm">${esc(p.name)}</span>
                        <span class="fd-sub">${b ? esc(b.name) : '브랜드 없음'}</span>
                    </button>
                    <button class="fd-i" title="속성 · 접근 권한" onclick="app.folderInfo('${p.id}')"><i class="ph ph-info"></i></button>
                </span>`;
            };
            const row = p => {
                const b = brandOf(p), col = (b && b.brand_color) || '#0a84ff';
                return `<div class="fd-r se" onclick="app.openSeasonItems('${p.id}')"
                    oncontextmenu="app.projectMenu(event,'${p.id}')">
                    <span class="fd-rn"><i class="ph-fill ph-folder" style="color:${col}"></i>${esc(p.name)}</span>
                    <span>${b ? esc(b.name) : '—'}</span>
                    <span style="text-align:right">${itemsOf(p) || '—'}</span>
                    <span>${esc(dueOf(p) || '—')}</span>
                    <span>${esc(stageOf(p))}${p.access === 'members' ? ' <i class="ph-fill ph-lock-simple" title="담당자만"></i>' : ''}
                        <button class="fd-i row" title="속성 · 접근 권한"
                            onclick="event.stopPropagation();app.folderInfo('${p.id}')"><i class="ph ph-info"></i></button></span>
                </div>`;
            };
            const group = (label, list) => {
                const l = list.filter(match);
                if (!l.length) return '';
                return `<div class="fd-gh">${esc(label)} <em>${l.length}</em></div>` +
                    (view === 'grid' ? `<div class="fd-grid">${l.map(tile).join('')}</div>`
                                     : `<div class="fd-list">${l.map(row).join('')}</div>`);
            };
            const head = view === 'list'
                ? `<div class="fd-r se head"><span>이름</span><span>브랜드</span><span style="text-align:right">제품</span><span>마감</span><span>진행</span></div>`
                : '';
            const body = [['진행 중', activeProducts], ['예정', scheduledProducts], ['완료', completedProducts]]
                .map(([k, v]) => group(k, v)).join('');

            const kpi = this.getDashboardKPIs(products);
            const canAdd = this.currentUser.role === 'MASTER' || this.currentUser.role === 'STAFF';
            const seg = (k, icon, t) => `<button class="${view === k ? 'on' : ''}" onclick="app.setSeasonView('${k}')" title="${t}"><i class="ph ${icon}"></i></button>`;

            return this._appShell('dashboard', `<div class="mp">
                ${this._mpTop('시즌', `${products.length}개`, `
                    <div class="fd-seg">${seg('grid', 'ph-squares-four', '아이콘 보기')}${seg('list', 'ph-list-dashes', '목록 보기')}</div>
                    <div class="mp-find"><i class="ph ph-magnifying-glass"></i>
                        <input value="${esc(this.seasonQ || '')}" placeholder="시즌 찾기" oninput="app.seasonFind(this.value)"></div>
                    ${canAdd ? `<button id="add-project-btn" class="mbtn pri"><i class="ph ph-plus"></i> 새 시즌</button>` : ''}`)}
                <div class="fd-body">
                    ${head}
                    ${body || `<div class="fd-none">${sq ? '찾는 시즌이 없습니다' : '시즌이 없습니다 — 위 [새 시즌]으로 만드세요'}</div>`}
                </div>
                <div class="fd-path">
                    <i class="ph ph-folder"></i><span>시즌 ${products.length}개</span>
                    <span class="fd-cnt">평균 진행 ${kpi.avgProgress}%${kpi.delayed ? ` · 지연 ${kpi.delayed}` : ''}${kpi.dueThisWeek ? ` · 7일내 마감 ${kpi.dueThisWeek}` : ''}${kpi.openTodos ? ` · 미완료 할일 ${kpi.openTodos}` : ''}</span>
                </div>
            </div>`);
        } else if (this.currentView === 'all_todos') {
            const allTodos = mockData.products.flatMap(p => {
                const projectCompany = mockData.companies.find(c => c.id === p.company_id);
                return (p.todos || []).map(t => {
                    const assigneeCompany = mockData.companies.find(c => c.id === t.assignee_id);
                    const creatorCompany = mockData.companies.find(c => c.id === t.created_by);
                    return {
                        ...t, 
                        projectName: p.name, 
                        product_id: p.id, 
                        company_id: p.company_id, 
                        companyName: projectCompany ? projectCompany.name : '',
                        assigneeName: assigneeCompany ? assigneeCompany.name : '미지정',
                        creatorName: creatorCompany ? creatorCompany.name : (t.created_by ? '알 수 없음' : '자동 생성')
                    };
                });
            });
            
            let filteredTodos = allTodos.filter(t => !t.completed); // 숨김 처리
            if (this.currentUser.role === 'CLIENT') {
                filteredTodos = filteredTodos.filter(t => t.company_id === this.currentUser.company_id);
            }

            const userId = this.currentUser.company_id || this.currentUser.id;
            const myTodos = filteredTodos.filter(t => t.assignee === userId);
            const requestedTodos = filteredTodos.filter(t => t.created_by === userId && t.assignee !== userId);

            const renderTodoList = (todos, title, icon) => `
                <div class="glass" style="padding: 1.5rem; border-radius: 20px; flex: 1; min-width: 0;">
                    <h3 style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 8px; font-size: 1.1rem;"><i class="${icon}"></i> ${title}</h3>
                    <ul class="todo-list" style="margin: 0; padding: 0; list-style: none;">
                        ${todos.map(todo => `
                            <li class="todo-item" data-todo-id="${todo.id}" data-project-id="${todo.product_id}" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; background: rgba(var(--tint),0.03); margin-bottom: 8px; border: 1px solid rgba(var(--tint),0.05); transition: 0.2s; cursor: pointer; position: relative;" onmouseover="this.style.background='rgba(var(--tint),0.08)';" onmouseout="this.style.background='rgba(var(--tint),0.03)';">
                                <div class="todo-quick-check" data-id="${todo.id}" data-pid="${todo.product_id}" style="width: 20px; height: 20px; border: 2px solid var(--card-border); border-radius: 6px; display: flex; align-items: center; justify-content: center; background: transparent; flex-shrink: 0; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='var(--primary)'; this.style.boxShadow='0 0 5px var(--primary)';" onmouseout="this.style.borderColor='var(--card-border)'; this.style.boxShadow='none';">
                                </div>
                                <div style="flex: 1; display: flex; flex-direction: column; gap: 6px; overflow: hidden; min-width: 0;">
                                    <div style="font-size: 0.95rem; font-weight: 500; color: var(--text-main); line-height: 1.4; white-space: normal; word-break: break-all;">${todo.text}</div>
                                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                        <span style="font-size: 0.8rem; font-weight: 600; color: var(--primary);">[${todo.companyName}]</span>
                                        <span class="todo-project-link" style="color: var(--text-muted); font-size: 0.75rem;">${todo.projectName}</span>
                                        ${title === '요청한 일' ? `<span style="font-size: 0.75rem; color: #10b981; background: rgba(16,185,129,0.1); padding: 2px 6px; border-radius: 4px;"><i class="ph ph-user"></i> 담당: ${todo.assigneeName}</span>` : ''}
                                        ${title === '내가 할 일' && todo.created_by !== userId ? `<span style="font-size: 0.75rem; color: #f59e0b; background: rgba(245,158,11,0.1); padding: 2px 6px; border-radius: 4px;"><i class="ph ph-paper-plane-tilt"></i> 요청자: ${todo.creatorName}</span>` : ''}
                                    </div>
                                </div>
                                <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                                    <span style="font-size: 0.8rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 6px;"><i class="ph ph-calendar-blank"></i> ${todo.due_date ? this.formatDateToUI(todo.due_date) : '일정'}</span>
                                    <div style="display: flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 1.1rem; pointer-events: none;">
                                        <i class="ph ph-cursor-click"></i>
                                    </div>
                                    ${this.canDelete(todo) ? `<button onclick="app.handleDelete(event, 'todo', '${todo.id}', '${todo.product_id}')" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(var(--tint),0.05); border: 1px solid rgba(var(--tint),0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(var(--tint),0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(var(--tint),0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                </div>
                            </li>
                        `).join('')}
                        ${todos.length === 0 ? '<div style="text-align: center; padding: 2rem 0; color: var(--text-muted); font-size: 0.9rem;">할 일이 없습니다.</div>' : ''}
                    </ul>
                </div>
            `;

            const showAllTodos = this.currentUser.role === 'MASTER' || this.currentUser.role === 'STAFF';

            return `
                <div class="glass" style="padding: 2rem; border-radius: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.5rem; gap: 1rem; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <h2 style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 1.5rem; white-space: nowrap;"><i class="ph ph-list-checks"></i> 통합 할 일 관리</h2>
                            ${(this.currentUser.role === 'MASTER' || this.currentUser.role === 'STAFF') ? `
                                <select id="todo-brand-filter" class="glass brand-select" style="color: white; border: 1px solid rgba(var(--tint),0.1); border-radius: 8px; padding: 6px 12px; outline: none; cursor: pointer; box-sizing: border-box;">
                                    <option value="all" style="background: #0f172a; color: white;" ${this.selectedCompanyId === 'all' ? 'selected' : ''}>전체 브랜드</option>
                                    ${(mockData.brands || []).map(b => `
                                        <option value="${b.id}" style="background: #0f172a; color: white;" ${this.selectedCompanyId === b.id ? 'selected' : ''}>${b.name}</option>
                                    `).join('')}
                                </select>
                            ` : ''}
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn-secondary" id="quick-request-todo-btn" style="padding: 0.5rem 1rem; font-size: 0.8rem; border-radius: 20px;">요청하기</button>
                            <button class="btn-primary" id="quick-add-todo-btn" style="padding: 0.5rem 1rem; font-size: 0.8rem; border-radius: 20px;">+ 새 할 일</button>
                        </div>
                    </div>
                    ${renderTodoList(myTodos, '내가 할 일', 'ph ph-user-focus')}
                    ${renderTodoList(requestedTodos, '요청한 일', 'ph ph-paper-plane-tilt')}
                    ${showAllTodos ? (() => {
                        const groupedByCompany = filteredTodos.reduce((acc, t) => {
                            if(!acc[t.company_id]) acc[t.company_id] = [];
                            acc[t.company_id].push(t);
                            return acc;
                        }, {});

                        return `
                            <div class="all-todos-section">
                                <h3 style="margin: 2rem 0 1rem; display: flex; align-items: center; gap: 8px; font-size: 1.1rem; color: var(--text-muted);"><i class="ph ph-list-dashes"></i> 전체 할 일 (브랜드별)</h3>
                                ${Object.keys(groupedByCompany).map(cid => {
                                    const company = mockData.companies.find(c => c.id === cid);
                                    const brandColor = cid === 'company_a' ? '#3b82f6' : (cid === 'company_b' ? '#10b981' : 'var(--primary)');
                                    return `
                                        <div class="glass" style="padding: 1rem; border-radius: 16px; margin-bottom: 1rem; border-left: 4px solid ${brandColor};">
                                            <div style="font-size: 0.85rem; font-weight: 600; color: ${brandColor}; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                                                <i class="ph ph-buildings"></i> ${company ? company.name : cid}
                                            </div>
                                            <ul class="todo-list" style="margin: 0; padding: 0; list-style: none;">
                                                ${groupedByCompany[cid].map(todo => `
                                                    <li class="todo-item" data-todo-id="${todo.id}" data-project-id="${todo.product_id}" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; background: rgba(var(--tint),0.02); margin-bottom: 6px; border: 1px solid rgba(var(--tint),0.04); transition: 0.2s; cursor: pointer;" onmouseover="this.style.background='rgba(var(--tint),0.06)';" onmouseout="this.style.background='rgba(var(--tint),0.02)';">
                                                        <div class="todo-quick-check" data-id="${todo.id}" data-pid="${todo.product_id}" style="width: 18px; height: 18px; border: 2px solid var(--card-border); border-radius: 5px; flex-shrink: 0;"></div>
                                                        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; overflow: hidden; min-width: 0;">
                                                            <div style="font-size: 0.9rem; font-weight: 500; color: var(--text-main); line-height: 1.4; white-space: normal; word-break: break-all;">${todo.text}</div>
                                                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                                                <span style="font-size: 0.75rem; color: var(--text-muted);">${todo.projectName}</span>
                                                                <span style="font-size: 0.7rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px;">${todo.due_date ? this.formatDateToUI(todo.due_date) : '-'}</span>
                                                            </div>
                                                        </div>
                                                    </li>
                                                `).join('')}
                                            </ul>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    })() : ''}
                </div>
            `;
        } else if (this.currentView === 'documents') {
            // ── 자료실 = 파인더 ────────────────────────────────────────
            //  왼쪽 즐겨찾기(분류·시즌) · 위 도구막대(보기 전환·검색) ·
            //  가운데 아이콘 격자 또는 목록 · 아래 경로막대(개수). 맥 파인더 그대로.
            const BASE_CATS = ['작업지시서', '견적서', '회의록', '참고이미지', '기타자료', '세금계산서'];
            //  내가 더한 분류까지 합친다
            const categories = [...new Set([...BASE_CATS, ...(this.docCats || [])])];
            const filteredProjectIds = products.map(p => p.id);
            let aggregatedDocs = (mockData.globalDocuments || []).filter(d => filteredProjectIds.includes(d.productId));
            products.forEach(p => {
                (p.photos || []).forEach((photo, idx) => {
                    const photoUrl = typeof photo === 'string' ? photo : photo.url;
                    aggregatedDocs.push({
                        id: typeof photo === 'object' ? photo.id : `auto-photo-${p.id}-${idx}`,
                        date: (p.history || [])[0]?.date || '',
                        name: `${p.name} 제작 사진 ${idx + 1}`,
                        category: '참고이미지', productId: p.id, url: photoUrl, memo: '',
                    });
                });
                (p.documents || []).forEach((doc, idx) => {
                    aggregatedDocs.push({
                        id: doc.id || `auto-doc-${p.id}-${idx}`,
                        date: doc.date, name: doc.name,
                        category: doc.category || '기타자료', productId: p.id, url: doc.url, memo: '',
                    });
                });
            });
            //  다른 화면에 흩어진 것도 자료실 한 곳에서 — 작업지시서·견적
            (this._techPacks || []).forEach(t => {
                const it = (this.pItems || []).find(i => String(i.id) === String(t.item_id) || String(i.tech_pack_id) === String(t.id));
                aggregatedDocs.push({
                    id: 'tp:' + t.id, name: (t.style_name || '무제') + (t.style_no ? ` (${t.style_no})` : ''),
                    category: '작업지시서', productId: it ? it.product_id : null, url: '',
                    date: (t.created_at || '').slice(0, 10), memo: '', open: `app.openTechPack('${t.id}')`,
                    icon: 'ph-clipboard-text', iconColor: '#5e5ce6', kindText: '작업지시서',
                });
            });
            (this.quotes || []).forEach(qt => {
                const it = (this.pItems || []).find(i => String(i.id) === String(qt.item_id) || String(i.quote_id) === String(qt.id));
                aggregatedDocs.push({
                    id: 'q:' + qt.id, name: (qt.quote_no ? qt.quote_no + ' ' : '') + (qt.client_name || '견적서'),
                    category: '견적서', productId: it ? it.product_id : null, url: '',
                    date: qt.quote_date || (qt.created_at || '').slice(0, 10), memo: '',
                    open: `app.showQuoteModal('${qt.id}')`, icon: 'ph-receipt', iconColor: '#30d158', kindText: '견적서',
                });
            });
            const cur = this.selectedDocCategory || '전체';
            const q = (this.docQ || '').trim().toLowerCase();
            let docs = aggregatedDocs;
            if (cur.startsWith('p:')) {
                const [pid, cat] = cur.slice(2).split('/');
                docs = docs.filter(d => d.productId === pid && (!cat || d.category === cat));
            } else if (cur !== '전체') docs = docs.filter(d => d.category === cur);
            if (q) docs = docs.filter(d => (d.name || '').toLowerCase().includes(q));
            const view = this.docView || 'list';   // 파인더 기본은 목록
            const esc = s => this._vesc(s);
            const isImg = u => /\.(jpe?g|png|gif|webp|heic|avif)$/i.test(u || '') || (u || '').includes('photos/');
            const kindOf = (d) => {
                if (d.icon) return { i: d.icon, c: d.iconColor || '#8e8e93', t: d.kindText || '파일' };
                const u = d.url || '';
                if (isImg(u)) return { i: 'ph-image', c: '#34c759', t: '이미지' };
                if (/\.pdf$/i.test(u)) return { i: 'ph-file-pdf', c: '#ff3b30', t: 'PDF' };
                if (/\.(xlsx?|csv)$/i.test(u)) return { i: 'ph-file-xls', c: '#1d9e4b', t: '스프레드시트' };
                if (/\.(docx?|hwp)$/i.test(u)) return { i: 'ph-file-doc', c: '#2b7de9', t: '문서' };
                if (/\.(zip|rar|7z)$/i.test(u)) return { i: 'ph-file-zip', c: '#a2845e', t: '압축' };
                return { i: 'ph-file', c: '#8e8e93', t: '파일' };
            };
            const nameOfP = id => (mockData.products.find(p => p.id === id) || {}).name || '';
            const brandOfP = id => {
                const p = (mockData.products || []).find(x => x.id === id);
                const b = p && (mockData.brands || []).find(x => x.id === p.brand_id);
                return b ? { n: b.name, c: b.brand_color || '#8e8e93' } : null;
            };
            //  pid 를 주면 왼쪽에 펼침 삼각형이 붙는다(대분류). depth 1 은 그 아래 중분류.
            const side = (key, label, icon, n, color, depth, pid, open) => `<div class="fd-s${cur === key ? ' on' : ''}${depth ? ' d1' : ''}"
                onclick="app.setDocCategory('${key}')" oncontextmenu="app.docFolderMenu(event,'${key}')">
                ${pid ? `<button class="fd-tw${open ? ' on' : ''}" onclick="event.stopPropagation();app.toggleDocSeason('${pid}')"><i class="ph ph-caret-right"></i></button>` : ''}
                <i class="ph ${icon}" style="color:${color || '#0a84ff'}"></i><span>${esc(label)}</span><em>${n}</em></div>`;
            //  접히는 구역 머리
            const sec = (name, inner, defOpen, add) => {
                const v = (this.docOpenSec || {})[name];
                const open = v === undefined ? defOpen !== false : v;
                return `<div class="fd-sh tog${open ? ' on' : ''}" onclick="app.toggleDocSec('${name}')">
                    <i class="ph ph-caret-right"></i>${esc(name)}
                    ${add ? `<button class="nav-add" title="${esc(add.t)}" onclick="event.stopPropagation();${add.run}">＋</button>` : ''}
                </div>${open ? inner : ''}`;
            };
            const grid = docs.map(d => {
                const k = kindOf(d);
                return `<button class="fd-it${String(this.docSel) === String(d.id) ? ' on' : ''}"
                        ondblclick="${d.open || `app.showFileModal('${esc(d.url)}','${esc(d.name)}')`}"
                        onclick="app.selectDoc('${esc(String(d.id))}')"
                        oncontextmenu="app.docMenu(event,'${esc(String(d.id))}','${esc(d.url)}','${esc(d.name)}')" title="${esc(d.name)}">
                    <span class="fd-th">${isImg(d.url) ? `<img src="${esc(d.url)}" alt="" loading="lazy">`
                        : `<i class="ph ${k.i}" style="color:${k.c}"></i>`}</span>
                    <span class="fd-nm">${esc(d.name)}</span>
                </button>`;
            }).join('');
            //  자료실 표 — 머리글로 줄 세우고 깔때기로 거른다
            const docVal = (d, k2) => ({
                name: d.name || '', brand: (brandOfP(d.productId) || {}).n || '',
                season: nameOfP(d.productId), kind: kindOf(d).t, date: d.date || '',
            })[k2] ?? '';
            docs = this._applyTbl('documents', docs, docVal, aggregatedDocs);
            const rows = docs.map(d => {
                const k = kindOf(d);
                return `<div class="fd-r${String(this.docSel) === String(d.id) ? ' on' : ''}"
                        onclick="app.selectDoc('${esc(String(d.id))}')"
                        ondblclick="${d.open || `app.showFileModal('${esc(d.url)}','${esc(d.name)}')`}"
                        oncontextmenu="app.docMenu(event,'${esc(String(d.id))}','${esc(d.url)}','${esc(d.name)}')">
                    <span class="fd-rn"><i class="ph ${k.i}" style="color:${k.c}"></i>${esc(d.name)}</span>
                    <span>${(() => { const b = brandOfP(d.productId);
                        return b ? `<i class="ph-fill ph-circle" style="font-size:7px;color:${b.c};margin-right:5px;vertical-align:1px"></i>${esc(b.n)}` : ''; })()}</span>
                    <span>${esc(nameOfP(d.productId))}</span>
                    <span>${esc(k.t)}</span>
                    <span>${esc(d.date || '')}</span>
                </div>`;
            }).join('');
            const where = cur === '전체' ? '자료실'
                : (cur.startsWith('p:')
                    ? (([pid, cat]) => nameOfP(pid) + (cat ? ' › ' + cat : ''))(cur.slice(2).split('/'))
                    : cur);
            return `
            <div class="fd">
                <aside class="fd-side">
                    <div class="fd-sh">즐겨찾기</div>
                    ${side('전체', '모든 자료', 'ph-clock-counter-clockwise', aggregatedDocs.length, '#0a84ff')}
                    ${sec('분류', categories.map(c =>
                        side(c, c, 'ph-folder-simple', aggregatedDocs.filter(d => d.category === c).length, '#5ac8fa')).join(''), true,
                        { t: '새 분류', run: 'app.addDocCategory()' })}
                    ${sec('시즌', products.length ? products.map(p => {
                        const n = aggregatedDocs.filter(d => d.productId === p.id).length;
                        const col = ((mockData.brands || []).find(b => b.id === p.brand_id) || {}).brand_color || '#5ac8fa';
                        const open = !!(this.docOpenP || {})[p.id];
                        const kids = !open ? '' : categories.map(c => {
                            const kn = aggregatedDocs.filter(d => d.productId === p.id && d.category === c).length;
                            return side('p:' + p.id + '/' + c, c, 'ph-folder-simple', kn, '#8e8e93', 1);
                        }).join('');
                        return side('p:' + p.id, p.name, 'ph-folder-simple', n, col, 0, p.id, open) + kids;
                    }).join('') : '<div class="fd-none sm">시즌 없음</div>', false,
                        { t: '새 시즌', run: 'app.showProjectModal()' })}
                </aside>
                <section class="fd-main">
                    <div class="fd-bar">
                        <b>${esc(where)}</b>${this._fltBadge('documents')}
                        <div class="fd-seg">
                            <button class="${view === 'grid' ? 'on' : ''}" onclick="app.setDocView('grid')" title="아이콘"><i class="ph ph-squares-four"></i></button>
                            <button class="${view === 'list' ? 'on' : ''}" onclick="app.setDocView('list')" title="목록"><i class="ph ph-list-dashes"></i></button>
                        </div>
                        <div class="fd-find"><i class="ph ph-magnifying-glass"></i>
                            <input placeholder="검색" value="${esc(this.docQ || '')}" oninput="app.docQ=this.value;app.requestRender()"></div>
                        <button class="fd-add" id="quick-add-doc-btn"><i class="ph ph-plus"></i> 올리기</button>
                    </div>
                    <div class="fd-body">
                        ${docs.length
                            ? (view === 'grid' ? `<div class="fd-grid">${grid}</div>`
                               : `<div class="fd-list"><div class="fd-r head">${[['name', '이름'], ['brand', '브랜드'], ['season', '시즌'], ['kind', '종류'], ['date', '날짜']]
                                    .map(([k2, t]) => { const { srt, flt } = this._tblState('documents');
                                        return `<span class="fh${srt.k === k2 ? ' srt' : ''}${flt[k2] ? ' flt' : ''}" onclick="app.sortTbl('documents','${k2}')">${esc(t)}${srt.k === k2 ? `<i class="ph ph-caret-${srt.dir > 0 ? 'up' : 'down'}"></i>` : ''}<button class="th-f" onclick="app.openTblFilter(event,'documents','${k2}','${esc(t)}')"><i class="ph ph-funnel${flt[k2] ? '-fill' : ''}"></i></button></span>`; }).join('')}</div>${rows}</div>`)
                            : `<div class="fd-none">${q ? '찾는 자료가 없습니다' : '이 위치에 자료가 없습니다'}</div>`}
                    </div>
                    <div class="fd-path">
                        <i class="ph ph-folder-simple"></i> ${esc(where)}
                        <span class="fd-cnt">항목 ${docs.length}개${cur !== '전체' || q ? ` · 전체 ${aggregatedDocs.length}개` : ''}</span>
                    </div>
                </section>
                <aside class="fd-prev">
                    ${(() => {
                        const d = docs.find(x => String(x.id) === String(this.docSel)) || docs[0];
                        if (!d) return `<div class="m3-none mid">고른 자료가 없습니다</div>`;
                        const k = kindOf(d);
                        return `
                        <div class="fd-pv">${(() => {
                            //  아이콘을 또 크게 띄우느니 내용을 보여준다 — 작업지시서는 도식화
                            if (String(d.id).startsWith('tp:')) {
                                const t = (this._techPacks || []).find(x => 'tp:' + x.id === d.id);
                                try { const svg = t && garmentPreviewSVG(t.config, false); if (svg) return `<div class="fd-pvsvg">${svg}</div>`; } catch (_e) {}
                            }
                            return null;
                        })() || (isImg(d.url) ? `<img src="${esc(d.url)}" alt="">`
                            : `<i class="ph ${k.i}" style="color:${k.c}"></i>`)}</div>
                        <div class="fd-pn">${esc(d.name)}</div>
                        <div class="fd-pk">${esc(k.t)}</div>
                        <div class="fd-pm">
                            <div><span>종류</span><b>${esc(k.t)}</b></div>
                            <div><span>날짜</span><b>${esc(d.date || '-')}</b></div>
                            <div><span>분류</span><b>${esc(d.category || '-')}</b></div>
                            <div><span>시즌</span><b>${esc(nameOfP(d.productId) || '-')}</b></div>
                        </div>
                        <div class="fd-pb">
                            <button class="mbtn pri" onclick="app.showFileModal('${esc(d.url)}','${esc(d.name)}')">열기</button>
                            <a class="mbtn" href="${esc(d.url)}" download style="text-decoration:none">내려받기</a>
                        </div>`;
                    })()}
                </aside>
            </div>`;
        } else if (this.currentView === 'detail') {
            const product = mockData.products.find(p => p.id === this.activeProjectId);
            const brand = mockData.brands?.find(b => b.id === product.brand_id);
            const company = mockData.companies.find(c => c.id === product.company_id);
            const brandName = brand ? brand.name : (company ? company.name : '알 수 없는 브랜드');
            const brandColor = brand ? (brand.brand_color || 'var(--primary)') : 'var(--primary)';
            
            const progressPercent = getProgress(product);

            return `
                <div class="detail-view fade-in">
                    <div style="margin-bottom: 2rem;">
                            <div style="display: flex; align-items: center; justify-content: flex-end; margin-bottom: 1rem;">
                                <!-- 컨텐츠 시작 부분 -->
                            </div>
                            
                            <!-- Production Schedule Summary -->
                            <div class="schedule-summary glass" style="padding: 1.5rem; border-radius: 20px; margin-bottom: 1.5rem; background: rgba(0,0,0,0.2); border: 1px solid rgba(var(--tint),0.05);">
                                <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px;">
                                    <h3 style="margin: 0; font-size: 1.1rem; color: white;"><i class="ph ph-calendar-check" style="color: var(--primary);"></i> 생산 일정 요약</h3>
                                    <span style="font-size: 0.8rem; color: var(--text-muted);">현재 공정: <b style="color: var(--primary);">${product.status || '대기'}</b></span>
                                </div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.75rem;">
                                    ${STAGES.slice(0, 4).map(stage => {
                                        const sData = (product.stages_data && (product.stages_data[stage.id] || product.stages_data[stage.docType])) || {};
                                        const isComp = isStageCompleted(product, stage);
                                        return `
                                            <div style="display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: 12px; background: rgba(var(--tint),0.02); border: 1px solid ${isComp ? 'rgba(37,99,235,0.2)' : 'rgba(var(--tint),0.05)'};">
                                                <span style="font-size: 0.75rem; color: var(--text-muted);">${stage.label}</span>
                                                <span style="font-size: 0.85rem; font-weight: 700; color: ${isComp ? 'var(--primary)' : 'white'};">
                                                    ${sData.due_date || '일정 미정'}
                                                </span>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                            </div>

                            <div style="width: 100%; height: 12px; background: rgba(0,0,0,0.3); border-radius: 6px; overflow: hidden; margin-bottom: 1.5rem; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);">
                                <div style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); transition: width 0.5s ease; border-radius: 6px;"></div>
                            </div>
                            <div class="progress-checklist" style="display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; padding-top: 15px; margin-top: -15px; padding-bottom: 10px;">
                                ${STAGES.map((stage, idx) => {
                                    const stageData = (product.stages_data && (product.stages_data[stage.id] || product.stages_data[stage.docType])) 
                                        ? (product.stages_data[stage.id] || product.stages_data[stage.docType]) 
                                        : { status: (product.documents.some(doc => doc.type === stage.docType) ? 'completed' : 'before'), due_date: '', note: '' };
                                    const isCompleted = isStageCompleted(product, stage);
                                    const inProgress = stageData.status === 'progress' || stageData.status === 'processing';
                                    
                                    let iconColor = isCompleted ? 'var(--primary)' : (inProgress ? '#f59e0b' : 'var(--text-muted)');
                                    let bg = isCompleted ? 'rgba(37, 99, 235, 0.1)' : (inProgress ? 'rgba(245, 158, 11, 0.1)' : 'rgba(var(--tint),0.02)');
                                    let border = isCompleted ? 'var(--primary)' : (inProgress ? '#f59e0b' : 'rgba(var(--tint),0.05)');
                                    let filter = (isCompleted || inProgress) ? 'none' : 'grayscale(100%) opacity(0.5)';

                                    return `
                                        <div style="display: flex; flex-direction: column; gap: 8px; min-width: 0;">
                                            <div class="check-item stage-item-trigger" data-type="${stage.docType}" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 5px; border-radius: 12px; background: ${bg}; border: 1px solid ${border}; transition: 0.3s; position: relative; cursor: pointer;" onmouseover="this.style.filter='brightness(1.2)';" onmouseout="this.style.filter='none';">
                                                <div style="font-size: 1.2rem; color: ${iconColor}; filter: ${filter}; transition: 0.3s;">
                                                    ${stage.icon}
                                                </div>
                                                <div style="font-size: 0.8rem; font-weight: 700; color: ${(isCompleted || inProgress) ? 'var(--text-main)' : 'var(--text-muted)'}; transition: 0.3s; text-align: center;">${stage.label}</div>
                                                <div style="font-size: 0.65rem; color: var(--text-muted); min-height: 14px; line-height: 14px;">${stageData.due_date ? stageData.due_date.slice(2) : '&nbsp;'}</div>
                                                ${isCompleted ? `
                                                    <div style="position: absolute; top: -5px; right: -5px; width: 16px; height: 16px; background: var(--accent-danger, #ef4444); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 5px rgba(239, 68, 68, 0.5); z-index: 10;">
                                                        <i class="ph ph-check" style="color: white; font-size: 0.6rem;"></i>
                                                    </div>
                                                ` : (inProgress ? `
                                                    <div style="position: absolute; top: -5px; right: -5px; background: #f59e0b; color: white; border-radius: 10px; padding: 1px 5px; font-size: 0.55rem; font-weight: 800; box-shadow: 0 0 8px rgba(245, 158, 11, 0.6); z-index: 10; animation: pulse 2s infinite;">
                                                        진행 중
                                                    </div>
                                                ` : '')}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    </div>

                    <div class="detail-grid">
                        <div class="notepad-card glass" style="display: flex; flex-direction: column;">
                            <h3 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-notepad"></i> 메모장</h3>
                            <div class="notepad-content" style="flex: 1; display: flex; flex-direction: column; background: rgba(var(--tint),0.02); border-radius: 12px; padding: 10px; overflow: visible; min-height: 300px;">
                                <div id="memo-feed" style="flex: 1; overflow-y: auto; padding-right: 5px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 10px;">
                                    ${(product.memos || (product.notes ? [{id:0, text: product.notes, created_by: null, created_at: ''}] : [])).map(m => {
                                        // text에서 [작성자] 형식 파싱
                                        const authorMatch = m.text ? m.text.match(/^\[(.+?)\]\s*(.*)$/s) : null;
                                        const memoAuthor = m.author || (authorMatch ? authorMatch[1] : '알 수 없음');
                                        const memoText = authorMatch ? authorMatch[2] : (m.text || '');
                                        const memoDate = m.date || (m.created_at ? new Date(m.created_at).toLocaleString('ko-KR', {month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '');
                                        const isMine = memoAuthor === this.currentUser.name;
                                        return `
                                        <div style="display: flex; flex-direction: column; align-items: ${isMine ? 'flex-end' : 'flex-start'}; width: 100%;">
                                            <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 4px; padding: 0 4px;">${memoAuthor} ${memoDate ? `· ${memoDate}` : ''}</div>
                                            <div style="display: flex; align-items: flex-end; gap: 6px; max-width: 90%;">
                                                ${isMine && this.canDelete(m) ? `<button onclick="app.handleDelete(event, 'memo', '${m.id}', '${product.id}')" style="width: 20px; height: 20px; border-radius: 6px; background: rgba(var(--tint),0.05); border: 1px solid rgba(var(--tint),0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; padding: 0; flex-shrink: 0;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(var(--tint),0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(var(--tint),0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                                <div style="background: ${isMine ? 'var(--primary)' : 'rgba(var(--tint),0.1)'}; color: white; padding: 10px 14px; border-radius: 16px; font-size: 0.95rem; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.5; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">${memoText}</div>
                                                ${!isMine && this.canDelete(m) ? `<button onclick="app.handleDelete(event, 'memo', '${m.id}', '${product.id}')" style="width: 20px; height: 20px; border-radius: 6px; background: rgba(var(--tint),0.05); border: 1px solid rgba(var(--tint),0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; padding: 0; flex-shrink: 0;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(var(--tint),0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(var(--tint),0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                            </div>
                                        </div>
                                    `; }).join('')}
                                </div>
                                <div style="display: flex; gap: 8px; align-items:flex-end;">
                                    <textarea id="new-memo-input" placeholder="메모나 피드백을 남겨주세요..." style="flex: 1; height: 40px; min-height: 40px; max-height: 80px; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); color: white; border-radius: 8px; padding: 8px 12px; resize: none; font-size: 0.9rem;" onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.getElementById('add-memo-btn').click(); }"></textarea>
                                    <button id="add-memo-btn" class="btn-primary" style="padding: 0 16px; height: 40px; border-radius: 8px;"><i class="ph ph-paper-plane-right"></i></button>
                                </div>
                            </div>
                        </div>

                        <div class="notepad-card glass">
                            <h3 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-check-square"></i> 상세 할 일 목록</h3>
                            <div class="notepad-content" style="overflow: visible;">
                                    <ul class="todo-list">
                                        ${(product.todos || []).map(todo => `
                                            <li class="todo-item ${todo.completed ? 'completed' : ''}" data-todo-id="${todo.id}" style="display: flex; align-items: center; gap: 12px; cursor: pointer; transition: 0.2s; position: relative; padding: 8px 12px; border-radius: 12px;" onmouseover="this.style.background='rgba(var(--tint),0.05)';" onmouseout="this.style.background='transparent';">
                                                <input type="checkbox" class="todo-checkbox-left" ${todo.completed ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0;">
                                                <div style="flex: 1; display: flex; align-items: center; gap: 10px; overflow: hidden;">
                                                    <span class="todo-text" style="flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${todo.text}</span>
                                                    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                                                        <select class="todo-assignee-select glass" data-id="${todo.id}" style="padding: 2px 4px; border-radius: 4px; font-size: 0.7rem; background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--card-border); max-width: 85px; width: auto;" onclick="event.stopPropagation()">
                                                            <option value="">미지정</option>
                                                            ${mockData.companies.filter(c => c.role === 'MASTER' || c.role === 'STAFF' || c.id === product.company_id).map(c => `
                                                                <option value="${c.id}" ${todo.assignee === c.id ? 'selected' : ''}>${c.name}</option>
                                                            `).join('')}
                                                        </select>
                                                        <div style="font-size: 0.7rem; color: var(--text-muted); border: 1px solid var(--card-border); border-radius: 4px; padding: 2px 6px; background: rgba(0,0,0,0.2); cursor: pointer; display: flex; align-items: center; gap: 4px; position: relative; min-width: 60px; box-sizing: border-box;" onclick="event.stopPropagation(); this.querySelector('input').showPicker();">
                                                            <span class="date-display-${todo.id}">${todo.due_date ? this.formatDateToUI(todo.due_date) : '일정'}</span>
                                                            <input type="date" class="todo-date-input" data-id="${todo.id}" value="${todo.due_date ? todo.due_date.replace(/\./g, '-') : ''}" max="2099-12-31" style="position: absolute; opacity: 0; width: 1px; height: 1px; top: 0; left: 0; border: none; padding: 0;">
                                                        </div>
                                                    </div>
                                                </div>
                                                ${this.canDelete(todo) ? `<button onclick="app.handleDelete(event, 'todo', '${todo.id}', '${product.id}')" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(var(--tint),0.05); border: 1px solid rgba(var(--tint),0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(var(--tint),0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(var(--tint),0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                            </li>
                                        `).join('')}
                                        <li class="todo-item inline-add-row" style="margin-top: 15px; background: rgba(var(--tint),0.03); border: 1px dashed var(--card-border); border-radius: 12px; padding: 8px 12px; position: relative; display: flex; align-items: center; gap: 10px;">
                                            <i class="ph ph-plus" style="color: var(--text-muted); font-size: 1.1rem;"></i>
                                            <input type="text" id="inline-todo-input" placeholder="새 할 일 입력 (@이름으로 담당자 지정)..." style="flex: 1; background: transparent; border: none; color: white; outline: none; font-size: 0.9rem;">
                                            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                                <button id="inline-add-todo-btn" class="btn-primary" style="padding: 6px 10px; border-radius: 8px; font-size: 0.75rem; border: none; display: flex; align-items: center; gap: 4px;"><i class="ph ph-plus-circle"></i> 할 일</button>
                                                <button id="inline-add-request-btn" class="btn-secondary" style="padding: 6px 10px; border-radius: 8px; font-size: 0.75rem; background: rgba(var(--tint),0.1); border: 1px solid rgba(var(--tint),0.2); color: white; cursor: pointer; display: flex; align-items: center; gap: 4px;"><i class="ph ph-paper-plane-tilt"></i> 요청</button>
                                            </div>
                                            <div id="mention-list" class="mention-popup glass" style="display: none; position: absolute; bottom: 100%; left: 0; width: 100%; max-height: 150px; overflow-y: auto; z-index: 1000; margin-bottom: 5px; border-radius: 8px; border: 1px solid var(--primary); background: #1a1a1a;"></div>
                                        </li>
                                    </ul>
                            </div>
                        </div>

                        <div class="bottom-panels">
                            <div class="notepad-card glass">
                                <h3 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-image"></i> 사진</h3>
                                <div class="notepad-content">
                                    <div class="photo-grid">
                                        ${(product.photos || []).map(photo => {
                                            const photoObj = typeof photo === 'string' ? {url: photo} : photo;
                                            return `
                                            <div class="photo-item" style="position: relative; cursor: pointer;" onclick="app.showFileModal('${photoObj.url}', '제작 사진')">
                                                <img src="${photoObj.url}" alt="제작 사진">
                                                ${this.canDelete(photoObj) ? `<button onclick="event.stopPropagation(); app.handleDelete(event, 'photo', '${photoObj.id || photoObj.url}', '${product.id}')" style="position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 4px; background: rgba(0,0,0,0.5); border: 1px solid rgba(var(--tint),0.2); color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(0,0,0,0.5)'; this.style.borderColor='rgba(var(--tint),0.2)'"><i class="ph ph-x"></i></button>` : ''}
                                            </div>
                                        `}).join('')}
                                        <div class="add-photo-btn" id="add-photo-btn">
                                            <span>+</span>
                                            <span style="font-size: 0.7rem;">사진 추가</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="notepad-card glass">
                                <h3 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-files"></i> 문서</h3>
                                <div class="notepad-content">
                                    <div class="doc-list" style="display: flex; flex-direction: column; gap: 10px;">
                                        ${(product.documents || []).length === 0 ? '<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 20px;">첨부된 문서가 없습니다.</div>' : ''}
                                        ${(product.documents || []).map(doc => `
                                            <div class="doc-item glass" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-radius: 12px; border: 1px solid var(--card-border); background: rgba(var(--tint),0.02);">
                                                <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; flex: 1;">
                                                    <i class="ph ph-file-text" style="font-size: 1.2rem; color: var(--primary);"></i>
                                                    <span style="font-size: 0.9rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${doc.name}</span>
                                                </div>
                                                <div style="display: flex; gap: 8px; align-items: center;">
                                                    <a href="${doc.url}" target="_blank" style="padding: 4px 8px; border-radius: 6px; background: rgba(37,99,235,0.1); color: var(--primary); font-size: 0.75rem; text-decoration: none;" onmouseover="this.style.background='rgba(37,99,235,0.2)'" onmouseout="this.style.background='rgba(37,99,235,0.1)'">열기</a>
                                                    ${this.canDelete(doc) ? `<button onclick="app.handleDelete(event, 'document', '${doc.id}', '${product.id}')" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(var(--tint),0.05); border: 1px solid rgba(var(--tint),0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(var(--tint),0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(var(--tint),0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (this.currentView === 'user_management') {
            // 맥 시스템 설정의 '사용자' 처럼 — 둥근 카드 안에 줄을 쌓는다
            const esc = s => this._vesc(s);
            const accs = (mockData.companies || []).filter(c => c.username);
            const roleP = r => r === 'MASTER' ? 'blue' : (r === 'STAFF' ? 'green' : 'gray');
            const scopeOf = (c) => {
                const brand = (mockData.brands || []).find(b => b.id === c.brand_id);
                return c.role === 'CLIENT' ? (brand ? brand.name : '브랜드 미지정')
                     : (c.role === 'MASTER' ? '전체 관리' : '운영 관리');
            };
            return `
            <div class="mpane">
                <div class="mpane-top"><h2><i class="ph ph-users-three"></i> 계정</h2></div>
                <div class="mcard">
                    <div class="mcard-h">이 회사를 쓰는 사람 ${accs.length}명</div>
                    ${accs.map(c => `
                    <div class="mrow">
                        <span class="mrow-face">${esc((c.name || '?').trim()[0] || '?')}</span>
                        <div class="mrow-main">
                            <div class="mrow-t">${esc(c.name)}</div>
                            <div class="mrow-s">${esc(c.username)} · ${esc(scopeOf(c))}</div>
                        </div>
                        <div class="mrow-r">
                            <span class="mpill ${roleP(c.role)}">${esc(c.role)}</span>
                            <button class="mbtn edit-user-btn" data-id="${c.id}">수정</button>
                            <button class="mbtn" onclick="app.changeAccountPassword('${c.id}','${esc(c.username)}')">비번</button>
                            <button class="mbtn danger icon" title="삭제" onclick="app.deleteAccount('${c.id}','${esc(c.name)}')"><i class="ph ph-trash"></i></button>
                        </div>
                    </div>`).join('') || '<div class="mnone">계정이 없습니다</div>'}
                    <div class="mrow-add" id="add-account-btn"><i class="ph ph-plus-circle"></i> 계정 추가</div>
                </div>
            </div>`;
        } else if (this.currentView === 'brand_management') {
            const esc = s => this._vesc(s);
            const allBrands = mockData.brands || [];
            const activeBrands = allBrands.filter(b => b.status !== 'closed');
            const closedBrands = allBrands.filter(b => b.status === 'closed');
            const brandRow = (b) => {
                const projectCount = (mockData.products || []).filter(p => p.brand_id === b.id).length;
                const userCount = (mockData.companies || []).filter(u => u.brand_id === b.id).length;
                const isClosed = b.status === 'closed';
                return `
                <div class="mrow"${isClosed ? ' style="opacity:.55"' : ''}>
                    <span class="mrow-sq" style="background:${esc(b.brand_color || '#3b82f6')}"></span>
                    <div class="mrow-main">
                        <div class="mrow-t">${esc(b.name)}</div>
                        <div class="mrow-s">시즌 ${projectCount}개 · 소속 계정 ${userCount}명</div>
                    </div>
                    <div class="mrow-r">
                        <span class="mpill ${isClosed ? 'gray' : 'green'}">${isClosed ? '종료' : '진행 중'}</span>
                        <button class="mbtn edit-brand-btn" data-id="${b.id}">수정</button>
                        <button class="mbtn danger icon" title="삭제" onclick="app.handleDelete(event,'brand','${b.id}')"><i class="ph ph-trash"></i></button>
                    </div>
                </div>`;
            };
            return `
            <div class="mpane">
                <div class="mpane-top"><h2><i class="ph ph-shield-check"></i> 브랜드</h2></div>
                <div class="mcard">
                    <div class="mcard-h">진행 중 ${activeBrands.length}개</div>
                    ${activeBrands.map(brandRow).join('') || '<div class="mnone">진행 중인 브랜드가 없습니다</div>'}
                    <div class="mrow-add" id="add-brand-btn"><i class="ph ph-plus-circle"></i> 브랜드 만들기</div>
                </div>
                ${closedBrands.length ? `
                <div class="mcard">
                    <div class="mcard-h">종료됨 ${closedBrands.length}개
                        <button class="mbtn" id="toggle-closed-brands-btn">${this.brandClosedExpanded ? '접기' : '펼치기'}</button></div>
                    ${this.brandClosedExpanded ? closedBrands.map(brandRow).join('') : ''}
                </div>` : ''}
            </div>`;
        } else if (this.currentView === 'timeline') {
            // 생산 타임라인: 시즌별 8단계 공정을 마감순으로 한눈에
            const stageState = (p, s) => {
                const sd = (p.stages_data && (p.stages_data[s.id] || p.stages_data[s.docType])) || null;
                const docMatch = p.documents && p.documents.some(d => d.type === s.docType || d.type === s.id);
                const due = sd ? sd.due_date : null;
                if ((sd && sd.status === 'completed') || docMatch) return { state: 'done', due };
                if (sd && sd.status && sd.status !== 'not_started') return { state: 'doing', due };
                return { state: 'todo', due };
            };

            const sorted = [...products].sort((a, b) => {
                const da = this._daysUntil(a.deadline);
                const db = this._daysUntil(b.deadline);
                if (da === null && db === null) return 0;
                if (da === null) return 1;
                if (db === null) return -1;
                return da - db;
            });

            const rows = sorted.map(p => {
                const meta = this._deadlineMeta(p.deadline);
                const progress = this.computeProgress(p);
                const isDone = (p.currentStage || 'consulting') === 'shipping';
                const brand = (mockData.brands || []).find(b => b.id === p.brand_id);
                const bColor = brand ? (brand.brand_color || 'var(--primary)') : 'var(--primary)';

                const track = STAGES.map(s => {
                    const st = stageState(p, s);
                    const dueLabel = st.due ? this.formatDateToUI(st.due).slice(2) : '';
                    return `
                        <div class="tl-stage tl-${st.state}" title="${s.label}${st.due ? ' · ' + this.formatDateToUI(st.due) : ''}">
                            <span class="tl-stage-ico">${s.icon}</span>
                            <span class="tl-stage-name">${s.label}</span>
                            ${dueLabel ? `<span class="tl-stage-due">${dueLabel}</span>` : ''}
                        </div>
                    `;
                }).join('<div class="tl-connector"></div>');

                const deadlineChip = isDone
                    ? `<span class="tl-deadline tl-dl-done"><i class="ph ph-check-circle"></i> 출고 완료</span>`
                    : (meta.level === 'overdue' || meta.level === 'soon')
                        ? `<span class="tl-deadline tl-dl-${meta.level}"><i class="ph ph-flag"></i> ${this.formatDateToUI(p.deadline)} · ${meta.label}</span>`
                        : (p.deadline
                            ? `<span class="tl-deadline"><i class="ph ph-flag"></i> ${this.formatDateToUI(p.deadline)} · ${meta.label}</span>`
                            : `<span class="tl-deadline tl-dl-none"><i class="ph ph-flag"></i> 마감 미정</span>`);

                return `
                    <div class="tl-row ${isDone ? 'tl-row-done' : ''}" data-id="${p.id}">
                        <div class="tl-row-head">
                            <div class="tl-row-title">
                                <span class="tl-pname">${p.name}</span>
                                <span class="company-tag tl-brand" style="border-color:${bColor}; color:${this._contrastText(bColor)}; background:${bColor};"><i class="ph ph-buildings"></i> ${this._brandName(p)}</span>
                            </div>
                            <div class="tl-row-meta">
                                ${deadlineChip}
                                <span class="tl-progress"><span class="tl-progress-bar" style="width:${progress}%"></span><span class="tl-progress-num">${progress}%</span></span>
                            </div>
                        </div>
                        <div class="tl-track">${track}</div>
                    </div>
                `;
            }).join('');

            const overdue = sorted.filter(p => { const d = this._daysUntil(p.deadline); return d !== null && d < 0 && (p.currentStage || 'consulting') !== 'shipping'; }).length;
            const soon = sorted.filter(p => { const d = this._daysUntil(p.deadline); return d !== null && d >= 0 && d <= 7 && (p.currentStage || 'consulting') !== 'shipping'; }).length;

            return `
                <div class="timeline-view fade-in">
                    <div class="tl-legend glass">
                        <span class="tl-legend-item"><span class="tl-dot tl-done"></span> 완료</span>
                        <span class="tl-legend-item"><span class="tl-dot tl-doing"></span> 진행중</span>
                        <span class="tl-legend-item"><span class="tl-dot tl-todo"></span> 예정</span>
                        <span class="tl-legend-sep"></span>
                        <span class="tl-legend-item" style="color:#ef4444;"><i class="ph ph-warning-circle"></i> 지연 ${overdue}건</span>
                        <span class="tl-legend-item" style="color:#f59e0b;"><i class="ph ph-clock-countdown"></i> 7일내 마감 ${soon}건</span>
                    </div>
                    ${rows || '<p style="color: var(--text-muted); padding: 2rem 0;">표시할 시즌이 없습니다.</p>'}
                </div>
            `;
        } else if (this.currentView === 'items') {
            return this._appShell('items', this.renderItems());
        } else if (this.currentView === 'tech_packs') {
            return this._appShell('tech_packs', this.renderTechPacks());
        } else if (this.currentView === 'sample_maker') {
            return this._appShell('sample_maker', renderSampleMaker(this.sampleConfig));
        } else if (this.currentView === 'orders') {
            return this._appShell('orders', this.renderOrders());
        } else if (this.currentView === 'inventory') {
            return this._appShell('inventory', this.renderInventory());
        } else if (this.currentView === 'pages') {
            return this.renderPagesView();
        } else if (this.currentView === 'kanban') {
            return this.renderKanban();
        } else if (this.currentView === 'calendar') {
            return this.renderCalendar();
        } else if (this.currentView === 'table') {
            return this.renderTableView();
        } else if (this.currentView === 'vendors') {
            return this._appShell('vendors', this.renderVendors() + this._vendorTimeline(products));
        } else if (this.currentView === 'integrations') {
            return this.renderIntegrations();
        } else if (this.currentView === 'quotes') {
            return this._appShell('quotes', this.renderQuotes());
        } else if (this.currentView === 'sales') {
            return this._appShell('sales', this.renderSales());
        } else if (this.currentView === 'analysis') {
            return this._appShell('analysis', this.renderAnalysis());
        } else if (this.currentView === 'notes') {
            return this.renderNotes();
        } else if (this.currentView === 'reminders') {
            return this.renderReminders();
        } else if (this.currentView === 'cs') {
            return this._appShell('cs', this.renderCS());
        } else if (this.currentView === 'expenses') {
            return this._appShell('expenses', this.renderExpenses());
        } else if (this.currentView === 'feedback') {
            return this.renderFeedback();
        } else if (this.currentView === 'sns') {
            return this._snsShell(this.renderSNS());
        }
    }

    // ============================================================
    //  매출 — 브랜드별 · 월별 집계 (channel_orders × malls→brand)
    // ============================================================
    setSalesYear(y) { this.salesViewYear = y; this.switchView('sales'); }
    setSalesMonth(m) { this.salesViewMonth = m; this.switchView('sales'); }
    setSalesBrand(b) { this.salesViewBrand = b; this.switchView('sales'); }
    setSalesMatrixYear(y) { this.salesMatrixYear = y; this.switchView('sales'); }
    // 현재 매출 화면이 보고 있는 기간 → 슬라이스 조회 범위(KST 기준 [from, to))
    _salesScopeRange() {
        const agg = this.salesAggData?.monthly;
        const months = agg ? [...new Set(agg.map(r => r.ym))].sort() : [];
        const latest = months[months.length - 1] || kstYM();
        const years = [...new Set(months.map(m => m.slice(0, 4)))];
        const y = years.includes(this.salesViewYear) ? this.salesViewYear : latest.slice(0, 4);
        const monthsOfY = months.filter(m => m.startsWith(y));
        const validM = monthsOfY.map(m => +m.slice(5));
        const m = (this.salesViewMonth === 'ALL' || validM.includes(+this.salesViewMonth))
            ? this.salesViewMonth : (+(monthsOfY[monthsOfY.length - 1] || latest).slice(5));
        // KST(+09:00) 경계로 잘라야 서버 집계(Asia/Seoul)와 같은 구간을 본다
        if (m === 'ALL') return { from: `${y}-01-01T00:00:00+09:00`, to: `${+y + 1}-01-01T00:00:00+09:00` };
        const mm = String(+m).padStart(2, '0');
        const ny = +m === 12 ? +y + 1 : +y, nm = String(+m === 12 ? 1 : +m + 1).padStart(2, '0');
        return { from: `${y}-${mm}-01T00:00:00+09:00`, to: `${ny}-${nm}-01T00:00:00+09:00` };
    }

    // 주문 → 브랜드명 매핑(_salesAgg의 mallBrand와 동일 규칙)
    _orderBrandName(o) {
        const mall = (this.malls || []).find(m => m.mall_key === o.mall_key);
        if (mall) { const b = (mockData.brands || []).find(x => x.id === mall.brand_id); return b ? b.name : (mall.label || '기타'); }
        return o.mall_key || o.channel || '기타';
    }

    renderSales() {
        if (!this._ordersLoaded || !this._mallsLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">매출 데이터를 불러오는 중...</div>`;
        let { orders, cancelledOrders, months, brands, monthTotals, grand, consultingFromQuote } = this._salesAgg(12);
        const won = n => this._won(Math.round(n));
        // 계정 브랜드 접근 제한(brand_access) — 설정된 경우 매출도 허용 브랜드로만 집계
        const _allowedNames = this._allowedBrandIds() ? new Set(this._visibleBrands().map(b => b.name)) : null;
        if (_allowedNames) {
            brands = brands.filter(b => _allowedNames.has(b.name));
            orders = orders.filter(o => _allowedNames.has(this._orderBrandName(o)));
            cancelledOrders = cancelledOrders.filter(o => _allowedNames.has(this._orderBrandName(o)));
            monthTotals = months.map((_, i) => brands.reduce((s, b) => s + (b.cells[i]?.amt || 0), 0));
            grand = monthTotals.reduce((s, v) => s + v, 0);
        }
        // 브랜드 필터(통합=ALL / 특정 브랜드) — 선택 시 orders/취소/월합계를 그 브랜드로 좁힘
        const brandNames = brands.map(b => b.name);
        const bf = brandNames.includes(this.salesViewBrand) ? this.salesViewBrand : 'ALL';
        const brandRec = bf === 'ALL' ? null : brands.find(b => b.name === bf);
        const monthTotalsView = bf === 'ALL' ? monthTotals : (brandRec ? brandRec.cells.map(c => c.amt) : months.map(() => 0));
        if (bf !== 'ALL') {
            orders = orders.filter(o => this._orderBrandName(o) === bf);
            cancelledOrders = cancelledOrders.filter(o => this._orderBrandName(o) === bf);
            this._salesNeedScope = bf;   // 렌더 후 이 브랜드+기간 슬라이스를 받아온다(아래 ensureViewData)
        }
        const monthLabel = m => { const [y, mm] = m.split('-'); return `${+mm}월<span style="color:var(--text-muted);font-size:0.7rem">'${y.slice(2)}</span>`; };

        // 빈 화면 판정은 브랜드 집계 유무로. (events 는 서버 집계 경로에서 안 쓰므로 항상 빈 배열이다)
        if (!brands.length) {
            // 브랜드명을 문장에 박아두면 브랜드가 바뀔 때마다 안내문이 거짓이 된다 → 등록된 브랜드에서 그때그때 뽑는다
            const names = (mockData.brands || []).map(b => b.name).filter(Boolean);
            const shown = names.slice(0, 3).map(n => this._vesc(n)).join(' · ');
            const salesWord = names.length ? `판매 브랜드(${shown}${names.length > 3 ? ` 외 ${names.length - 3}개` : ''})` : '판매 브랜드';
            return `<div class="mp">
                ${this._mpTop('정산', '매출', this._moneyTabs('sales'))}
                <div class="mp-body"><div class="mnone">매출 자료가 없습니다.<br>${salesWord}는 몰 주문이 수집되면, 컨설팅은 세금계산서(견적)가 등록되면 저절로 쌓입니다.</div></div>
            </div>`;
        }

        const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
        const wonMan = n => (Math.abs(n) >= 10000 ? this._won(Math.round(n / 10000)) + '만' : this._won(Math.round(n)));
        // 기간 선택: 연도 + 월(전체/1~12)
        const yearsAvail = [...new Set(months.map(m => m.slice(0, 4)))].sort();
        const latest = months[months.length - 1] || '2026-01';
        const selY = yearsAvail.includes(this.salesViewYear) ? this.salesViewYear : latest.slice(0, 4);
        const monthsOfY = months.filter(m => m.startsWith(selY));
        const validM = monthsOfY.map(m => +m.slice(5));
        const selM = (this.salesViewMonth === 'ALL' || validM.includes(+this.salesViewMonth)) ? this.salesViewMonth : (+(monthsOfY[monthsOfY.length - 1] || latest).slice(5));
        const yearMode = selM === 'ALL';
        const cy = +selY, cmo = yearMode ? null : +selM;
        const scopeMonths = yearMode ? monthsOfY : [`${selY}-${String(cmo).padStart(2, '0')}`];
        const idxOf = k => months.indexOf(k);
        const curKey = scopeMonths[scopeMonths.length - 1] || latest;
        const li = idxOf(curKey);
        const thisM = scopeMonths.reduce((s, k) => s + (idxOf(k) >= 0 ? monthTotalsView[idxOf(k)] : 0), 0);
        const prevM = yearMode ? 0 : (monthTotalsView[li - 1] || 0);
        const daysInMonth = yearMode ? 12 : new Date(cy, cmo, 0).getDate();
        const inScope = d => { const dt = new Date(d); if (dt.getFullYear() !== cy) return false; return yearMode ? true : (dt.getMonth() + 1 === cmo); };
        const inCur = inScope;
        const shortLabel = yearMode ? `${cy}년 연간` : `${cmo}월`;
        const periodLabel = yearMode ? `${cy}년 전체` : `${cy}년 ${cmo}월`;
        const cancelThis = (cancelledOrders || []).filter(o => inScope(o.order_date));
        // 취소·반품·교환 건수/금액도 서버 집계본에서(슬라이스가 없어도 정확)
        let cancelThisCnt = cancelThis.length;
        let cancelThisAmt = cancelThis.reduce((s, o) => s + (Number(o.pay_amount) || 0), 0);
        if (this.salesAggData?.monthly) {
            const CANCELLED = new Set(['cancel', 'return', 'exchange']);
            cancelThisCnt = 0; cancelThisAmt = 0;
            this.salesAggData.monthly.forEach(r => {
                if (!CANCELLED.has(r.state)) return;
                if (!scopeMonths.includes(r.ym)) return;
                if (_allowedNames && !_allowedNames.has(r.brand_name)) return;
                if (bf !== 'ALL' && r.brand_name !== bf) return;
                cancelThisCnt += r.cnt || 0;
                cancelThisAmt += Number(r.amt) || 0;
            });
        }

        // 브랜드 색상은 이름 기준으로 고정(차트·카드·매트릭스가 항상 같은 색을 쓰게)
        const colorOf = (name) => { const i = brands.findIndex(b => b.name === name); return palette[(i < 0 ? 0 : i) % palette.length]; };

        // 선택 기간 집계 + 브랜드별 일자 시리즈
        //  일별/건수는 서버 집계본(sales_daily)에서. 인기상품은 원본 아이템이 필요해 브랜드 상세 슬라이스에서.
        const daily = Array(31).fill(0);
        const dailyByBrand = {};   // 브랜드명 → 일별(31) 매출
        const cntByBrand = {};     // 브랜드명 → 주문건수
        const prodQty = {};
        let ordersThisMonth = 0;
        const aggDaily = this.salesAggData?.daily;
        if (aggDaily) {
            aggDaily.forEach(r => {
                const [y, m, dd] = r.d.split('-').map(Number);
                if (y !== cy || (!yearMode && m !== cmo)) return;
                if (_allowedNames && !_allowedNames.has(r.brand_name)) return;
                if (bf !== 'ALL' && r.brand_name !== bf) return;
                const amt = Number(r.amt) || 0;
                daily[dd - 1] += amt;
                (dailyByBrand[r.brand_name] = dailyByBrand[r.brand_name] || Array(31).fill(0))[dd - 1] += amt;
                cntByBrand[r.brand_name] = (cntByBrand[r.brand_name] || 0) + (r.cnt || 0);
                ordersThisMonth += r.cnt || 0;
            });
        } else {
            orders.forEach(o => {
                if (!inScope(o.order_date)) return;
                ordersThisMonth++;
                const amt = Number(o.pay_amount) || 0;
                const d = new Date(o.order_date);
                daily[d.getDate() - 1] += amt;
                const bn = this._orderBrandName(o) || '기타';
                (dailyByBrand[bn] = dailyByBrand[bn] || Array(31).fill(0))[d.getDate() - 1] += amt;
                cntByBrand[bn] = (cntByBrand[bn] || 0) + 1;
            });
        }
        // 인기상품은 항상 슬라이스(orders)에서 — 브랜드 상세에서만 쓰인다
        orders.forEach(o => {
            if (!inScope(o.order_date)) return;
            (o.items || []).forEach(it => { const n = it.product_name || it.variant_code || '상품'; prodQty[n] = (prodQty[n] || 0) + (Number(it.quantity) || 1); });
        });
        // 차트 시리즈: 단일월=일별, 연간전체=월별(1~12)
        const chartSeries = yearMode
            ? Array.from({ length: 12 }, (_, i) => { const k = `${selY}-${String(i + 1).padStart(2, '0')}`; const idx = idxOf(k); return idx >= 0 ? monthTotalsView[idx] : 0; })
            : daily.slice(0, daysInMonth);
        const topProducts = Object.entries(prodQty).sort((a, b) => b[1] - a[1]).slice(0, 6);
        const topQtyMax = Math.max(1, ...topProducts.map(p => p[1]));
        const aov = ordersThisMonth ? thisM / ordersThisMonth : 0;

        // 브랜드 선택기간 (점유율)
        const brandNow = brands.map((b) => ({ name: b.name, kind: b.kind, amt: scopeMonths.reduce((s, k) => s + (idxOf(k) >= 0 ? b.cells[idxOf(k)].amt : 0), 0), color: colorOf(b.name) }))
            .filter(b => b.amt > 0 && (bf === 'ALL' || b.name === bf)).sort((a, b) => b.amt - a.amt);
        const brandNowMax = Math.max(1, ...brandNow.map(b => b.amt));

        // 차트를 브랜드별로 쌓기 위한 시리즈(개요 화면에서만 분리, 브랜드 상세는 단색 1개)
        //  연간모드는 브랜드×월 셀에서, 단일월은 위에서 만든 일별 집계에서 가져온다.
        const stackSeries = brandNow.map(b => {
            const rec = brands.find(x => x.name === b.name);
            const values = yearMode
                ? Array.from({ length: 12 }, (_, i) => { const ix = idxOf(`${selY}-${String(i + 1).padStart(2, '0')}`); return ix >= 0 ? (rec?.cells[ix]?.amt || 0) : 0; })
                : (dailyByBrand[b.name] || Array(31).fill(0)).slice(0, daysInMonth);
            return { name: b.name, color: b.color, values, total: b.amt };
        // 값이 전부 0인 시리즈는 범례만 지저분해짐(예: 컨설팅은 몰 주문이 아니라 일별 분포가 없음)
        }).filter(s => s.values.some(v => v > 0));

        // KPI (전월대비는 지난달이 유의미할 때만 %, 아니면 절대금액 델타)
        const delta = thisM - prevM;
        const momSane = prevM >= thisM * 0.05 && prevM > 0;
        const kpi = (label, val, sub, subColor) => `<div class="glass" style="padding:1.1rem 1.2rem;border-radius:16px">
            <div style="font-size:0.76rem;color:var(--text-muted)">${label}</div>
            <div style="font-size:1.55rem;font-weight:800;margin-top:5px;font-variant-numeric:tabular-nums;line-height:1.1">${val}</div>
            ${sub ? `<div style="font-size:0.75rem;margin-top:3px;color:${subColor || 'var(--text-muted)'};font-weight:600">${sub}</div>` : ''}
        </div>`;
        const cards = `<div class="kpi-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:1.3rem">
            ${kpi(`${shortLabel} 매출`, `${won(thisM)}<span style="font-size:1rem;font-weight:600">원</span>`,
                (momSane ? `전월 대비 ${delta >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(delta / prevM * 100))}%` : (prevM > 0 ? `지난달 ${wonMan(prevM)}원` : '집계 시작')) + (cancelThisCnt ? ` · 취소 ${cancelThisCnt}건 제외` : ''),
                momSane ? (delta >= 0 ? '#10b981' : '#ef4444') : 'var(--text-muted)')}
            ${kpi(`${shortLabel} 주문`, `${ordersThisMonth.toLocaleString()}<span style="font-size:1rem;font-weight:600">건</span>`, (() => {
                //  누적은 서버 집계본(sales_monthly)에서 센다.
                //  orders 는 '고른 브랜드+기간' 만 따로 받아온 조각이라 전체가 아니다(전체 통합일 땐 비어 있다).
                const mon = this.salesAggData?.monthly;
                if (!mon) return '';
                let n = 0;
                mon.forEach(r => {
                    if (r.state === 'cancel' || r.state === 'return') return;
                    if (_allowedNames && !_allowedNames.has(r.brand_name)) return;
                    if (bf !== 'ALL' && r.brand_name !== bf) return;
                    n += Number(r.cnt) || 0;
                });
                return n ? `누적 ${n.toLocaleString()}건` : '';
            })())}
            ${kpi('객단가', `${won(aov)}<span style="font-size:1rem;font-weight:600">원</span>`, '주문 1건당 평균')}
            ${bf === 'ALL'
                ? kpi('판매 브랜드', `${brandNow.length}<span style="font-size:1rem;font-weight:600">개</span>`, brandNow.slice(0, 2).map(b => b.name).join(' · ') || '—')
                // 브랜드 상세에선 '브랜드 개수'가 무의미 → 반품·교환률로 대체
                : kpi('반품·교환률', `${(ordersThisMonth + cancelThisCnt) ? Math.round(cancelThisCnt / (ordersThisMonth + cancelThisCnt) * 100) : 0}<span style="font-size:1rem;font-weight:600">%</span>`,
                    `${cancelThisCnt}건 · 환불 ${wonMan(cancelThisAmt)}원`,
                    (ordersThisMonth + cancelThisCnt) && cancelThisCnt / (ordersThisMonth + cancelThisCnt) >= 0.15 ? '#ef4444' : undefined)}
        </div>`;

        // SVG 차트 (단일월=일별 / 연간전체=월별)
        //  브랜드가 2개 이상이면 브랜드별 선(색만 다르게, 면 채움 없음) — 브랜드끼리 바로 비교.
        //  이때 y축은 '브랜드 개별 최대값'으로 잡아야 선이 바닥에 눌리지 않는다(합계 기준이면 다 깔림).
        const cs = chartSeries, N = cs.length;
        const multi = stackSeries.length > 1;
        const maxDaily = multi
            ? Math.max(1, ...stackSeries.flatMap(s => s.values))
            : Math.max(1, ...cs);
        const W = 760, H = 168, padX = 8, padTop = 20, padBot = 8;
        const xAt = i => padX + (W - 2 * padX) * (N > 1 ? i / (N - 1) : 0.5);
        const yAt = v => padTop + (H - padTop - padBot) * (1 - v / maxDaily);
        const linePts = cs.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
        const line = 'M ' + linePts.join(' L ');
        const area = `${line} L ${xAt(N - 1).toFixed(1)},${(H - padBot).toFixed(1)} L ${xAt(0).toFixed(1)},${(H - padBot).toFixed(1)} Z`;
        const brandLines = multi ? stackSeries.map(s => {
            const pts = s.values.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' L ');
            return `<path d="M ${pts}" fill="none" stroke="${s.color}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"><title>${this._vesc(s.name)}</title></path>`;
        }).join('') : '';
        // 최고점: 브랜드별 모드면 '어느 브랜드의 어느 날'이 최고인지
        let peakI, peakLabel, peakBrand = null;
        if (multi) {
            let best = { v: -1, i: 0, s: null };
            stackSeries.forEach(s => s.values.forEach((v, i) => { if (v > best.v) best = { v, i, s }; }));
            peakI = best.i; peakBrand = best.s;
        } else {
            peakI = cs.indexOf(maxDaily);
        }
        peakLabel = yearMode ? `${peakI + 1}월` : `${peakI + 1}일`;
        const gid = 'sg' + Math.floor(cy * 100 + (cmo || 0));
        // x축 라벨: 전 구간(일별=1~말일 / 연간=1~12월)을 데이터 포인트 위치에 정확히 맞춰 SVG 안에 그림.
        //  좁은 화면에서 겹치지 않게 5·10일 단위만 진하게, 나머지는 흐리게.
        const AXIS = 17;
        const axisLabels = cs.map((_, i) => {
            const n = i + 1;
            const strong = yearMode || n === 1 || n === N || n % 5 === 0;
            // 연간(12개)은 자리가 넉넉해 '월'까지, 일별(최대 31개)은 숫자만(첫·마지막만 '일')
            const txt = yearMode ? `${n}월` : (n === 1 || n === N ? `${n}일` : `${n}`);
            return `<text x="${xAt(i).toFixed(1)}" y="${H + 11}" text-anchor="middle"
                font-size="9" font-weight="${strong ? 700 : 400}"
                fill="${i === peakI ? 'var(--primary)' : 'var(--text-muted)'}"
                opacity="${strong || i === peakI ? 1 : 0.45}">${txt}</text>`;
        }).join('');
        const axisTicks = cs.map((_, i) => `<line x1="${xAt(i).toFixed(1)}" y1="${H - padBot}" x2="${xAt(i).toFixed(1)}" y2="${H - padBot + 3}" stroke="var(--card-border)" stroke-width="1" opacity="0.6"/>`).join('');
        const chart = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px;margin-bottom:1.3rem">
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.6rem">
                <div style="font-size:0.92rem;font-weight:700"><i class="ph ph-chart-line-up" style="color:var(--primary)"></i> ${yearMode ? `${cy}년 월별 매출` : `${shortLabel} 일별 매출`}${multi ? ' <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500">브랜드별</span>' : ''}</div>
                <div style="font-size:0.78rem;color:var(--text-muted)">최고 ${peakBrand ? `<b style="color:${peakBrand.color}">${this._vesc(peakBrand.name)}</b> ` : ''}<b style="color:var(--text-main)">${peakLabel}</b> · ${wonMan(maxDaily)}원</div>
            </div>
            <svg viewBox="0 0 ${W} ${H + AXIS}" style="width:100%;height:${H + AXIS}px;display:block">
                <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity="0.32"/><stop offset="1" stop-color="var(--primary)" stop-opacity="0.02"/></linearGradient></defs>
                ${[0.33, 0.66].map(f => `<line x1="${padX}" y1="${(padTop + (H - padTop - padBot) * f).toFixed(1)}" x2="${W - padX}" y2="${(padTop + (H - padTop - padBot) * f).toFixed(1)}" stroke="var(--card-border)" stroke-width="1" stroke-dasharray="2 5" opacity="0.55"/>`).join('')}
                ${multi ? brandLines : `<path d="${area}" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`}
                <circle cx="${xAt(peakI).toFixed(1)}" cy="${yAt(maxDaily).toFixed(1)}" r="4" fill="${peakBrand ? peakBrand.color : 'var(--primary)'}" stroke="#fff" stroke-width="1.5"/>
                <line x1="${padX}" y1="${H - padBot}" x2="${W - padX}" y2="${H - padBot}" stroke="var(--card-border)" stroke-width="1" opacity="0.8"/>
                ${axisTicks}${axisLabels}
            </svg>
            ${multi ? `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:0.6rem">${stackSeries.map(s => `<span style="font-size:0.74rem;color:var(--text-muted);display:flex;align-items:center;gap:5px"><span style="width:9px;height:9px;border-radius:3px;background:${s.color}"></span>${this._vesc(s.name)}</span>`).join('')}</div>` : ''}
        </div>`;

        // ── 브랜드 카드 (개요 화면의 본체) — 클릭하면 그 브랜드 상세로 들어감 ──
        //  전체 합산 지표는 작전 짜는 데 쓸모가 없으니, 개요는 "얼마·어디서"만 보여주고
        //  상품·사이즈·재구매 같은 디테일은 전부 브랜드 안으로 넣는다.
        const spark = (vals, color) => {
            const n = vals.length, mx = Math.max(1, ...vals);
            const w = 200, h = 34;
            const px = i => (n > 1 ? (w * i / (n - 1)) : w / 2);
            const py = v => h - (h - 3) * (v / mx);
            const pts = vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' L ');
            return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;display:block">
                <path d="M ${pts} L ${w},${h} L 0,${h} Z" fill="${color}" fill-opacity="0.16"/>
                <path d="M ${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/>
            </svg>`;
        };
        const brandCards = brandNow.map(b => {
            const rec = brands.find(x => x.name === b.name);
            const prevAmt = (!yearMode && rec && li > 0) ? (rec.cells[li - 1]?.amt || 0) : 0;
            const d = b.amt - prevAmt;
            const sane = prevAmt > 0 && prevAmt >= b.amt * 0.05;
            const cnt = cntByBrand[b.name] || 0;
            const bAov = cnt ? b.amt / cnt : 0;
            const vals = yearMode
                ? Array.from({ length: 12 }, (_, i) => { const ix = idxOf(`${selY}-${String(i + 1).padStart(2, '0')}`); return ix >= 0 ? (rec?.cells[ix]?.amt || 0) : 0; })
                : (dailyByBrand[b.name] || Array(31).fill(0)).slice(0, daysInMonth);
            return `<div class="glass" onclick="app.setSalesBrand('${this._vesc(b.name).replace(/'/g, "\\'")}')"
                style="padding:1.15rem 1.25rem;border-radius:18px;cursor:pointer;border-left:4px solid ${b.color};transition:transform .12s"
                onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:0.7rem">
                    <span style="font-size:0.95rem;font-weight:800">${this._vesc(b.name)}${b.kind === 'consulting' ? ' <span style="font-size:0.62rem;font-weight:700;color:#8b5cf6;background:rgba(139,92,246,0.14);padding:1px 6px;border-radius:6px">컨설팅</span>' : ''}</span>
                    <span style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap">자세히 <i class="ph ph-arrow-right"></i></span>
                </div>
                <div style="font-size:1.5rem;font-weight:800;line-height:1;font-variant-numeric:tabular-nums">${won(b.amt)}<span style="font-size:0.9rem;font-weight:600">원</span></div>
                <div style="display:flex;gap:10px;align-items:baseline;margin-top:5px;font-size:0.75rem;color:var(--text-muted);font-weight:600">
                    <span>점유율 ${thisM ? Math.round(b.amt / thisM * 100) : 0}%</span>
                    ${sane ? `<span style="color:${d >= 0 ? '#10b981' : '#ef4444'}">전월 ${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d / prevAmt * 100))}%</span>` : ''}
                </div>
                <div style="margin:0.7rem 0 0.4rem">${spark(vals, b.color)}</div>
                <div style="display:flex;justify-content:space-between;font-size:0.74rem;color:var(--text-muted);border-top:1px solid var(--card-border);padding-top:7px">
                    <span>주문 <b style="color:var(--text-main)">${cnt.toLocaleString()}</b>건</span>
                    <span>객단가 <b style="color:var(--text-main)">${won(bAov)}</b>원</span>
                </div>
            </div>`;
        }).join('');
        const brandGrid = `<div style="margin-top:1.3rem">
            <div style="font-size:0.92rem;font-weight:700;margin-bottom:0.8rem"><i class="ph ph-squares-four" style="color:var(--primary)"></i> 브랜드별 지표 <span style="font-size:0.74rem;color:var(--text-muted);font-weight:500">— 카드를 누르면 상품·사이즈·재구매까지 상세히 봐요</span></div>
            ${brandNow.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.1rem">${brandCards}</div>`
                : `<div class="glass" style="padding:2rem;border-radius:18px;text-align:center;color:var(--text-muted);font-size:0.85rem">${periodLabel}에 매출이 있는 브랜드가 없습니다.</div>`}
        </div>`;

        // 인기 상품 TOP (이번 달, 수량 기준)
        const topCard = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
            <div style="font-size:0.92rem;font-weight:700;margin-bottom:1rem"><i class="ph ph-fire" style="color:#f59e0b"></i> ${shortLabel} 인기 상품 <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500">(판매수량)</span></div>
            ${topProducts.length ? `<div style="display:flex;flex-direction:column;gap:0.75rem">${topProducts.map(([n, q], i) => `<div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                    <span style="font-size:0.83rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:75%">${['🥇', '🥈', '🥉'][i] || `${i + 1}.`} ${this._vesc(n)}</span>
                    <span style="font-size:0.82rem;font-weight:800;font-variant-numeric:tabular-nums">${q}개</span>
                </div>
                <div style="height:6px;border-radius:4px;background:rgba(148,163,184,0.12);overflow:hidden"><div style="height:100%;width:${Math.max(4, q / topQtyMax * 100)}%;background:linear-gradient(90deg,#f59e0b,#fbbf24);border-radius:4px"></div></div>
            </div>`).join('')}</div>` : '<div style="color:var(--text-muted);font-size:0.83rem;padding:0.5rem 0">상품 데이터 없음</div>'}
        </div>`;

        // 채널별 매출 (이번 달) — 멀티채널 프레임 (현재 카페24만 연동)
        const CHANNELS = [
            { key: 'cafe24', label: '카페24 자사몰', color: '#3b82f6' },
            { key: 'musinsa', label: '무신사', color: '#111827' },
            { key: '29cm', label: '29CM', color: '#6b7280' },
            { key: 'kidikidi', label: '키디키디', color: '#f59e0b' },
            { key: 'smartstore', label: '스마트스토어', color: '#10b981' },
        ];
        // 채널 정규화: 카페24 여러 몰은 'cafe24'로 롤업, 나머지는 mall_key/channel로 플랫폼 식별
        const platformKey = (o) => {
            if ((o.channel || 'cafe24') === 'cafe24') return 'cafe24';
            const mk = (o.mall_key || '').toLowerCase();
            if (['kidikidi', 'musinsa', '29cm', 'smartstore'].includes(mk)) return mk;
            const ch = (o.channel || '').toLowerCase();
            if (ch === 'eland') return 'kidikidi';
            if (ch === 'naver') return 'smartstore';
            return mk || ch || 'cafe24';
        };
        const chanSum = {}, chanCnt = {};
        if (this.salesAggData?.channel && bf === 'ALL' && !_allowedNames) {
            // 개요 화면은 서버 집계본(플랫폼×월)에서 — 주문 원본 없이도 채널 구성이 나온다
            const CANCELLED = new Set(['cancel', 'return', 'exchange']);
            this.salesAggData.channel.forEach(r => {
                if (CANCELLED.has(r.state) || !scopeMonths.includes(r.ym)) return;
                chanSum[r.platform] = (chanSum[r.platform] || 0) + (Number(r.amt) || 0);
                chanCnt[r.platform] = (chanCnt[r.platform] || 0) + (r.cnt || 0);
            });
        } else {
            // 브랜드 상세(또는 브랜드 접근제한)는 그 브랜드 슬라이스에서 계산해야 정확
            orders.forEach(o => { if (!inCur(o.order_date)) return; const c = platformKey(o); chanSum[c] = (chanSum[c] || 0) + (Number(o.pay_amount) || 0); chanCnt[c] = (chanCnt[c] || 0) + 1; });
        }
        // 채널 → 몰 매핑 + 실제 수집 실태(팩트) 판정. connected 정적 플래그 대신 최근 주문/동기화로.
        const chanMalls = { cafe24: [], kidikidi: [], '29cm': [], musinsa: [], smartstore: [] };
        (this.malls || []).forEach(m => {
            const ch = (m.channel || 'cafe24'), mk = (m.mall_key || '').toLowerCase();
            if (ch === 'cafe24') chanMalls.cafe24.push(m);
            else if (mk === 'kidikidi' || ch === 'eland') chanMalls.kidikidi.push(m);
            else if (mk === '29cm') chanMalls['29cm'].push(m);
            else if (mk === 'musinsa') chanMalls.musinsa.push(m);
            else if (mk === 'smartstore' || ch === 'naver') chanMalls.smartstore.push(m);
        });
        const _rank = { '수집중': 3, '지연': 2, '중단': 1, '수집 없음': 0 };
        const chanStatusOf = (key) => { const ms = chanMalls[key] || []; if (!ms.length) return null; let best = null; ms.forEach(m => { const s = this._channelStatus(m); if (s && (!best || (_rank[s.label] || 0) > (_rank[best.label] || 0))) best = s; }); return best; };
        const connectedSet = new Set(Object.keys(chanMalls).filter(k => chanMalls[k].length));
        const chanCard = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
            <div style="font-size:0.92rem;font-weight:700;margin-bottom:1rem"><i class="ph ph-broadcast" style="color:var(--primary)"></i> ${shortLabel} 채널별 매출</div>
            <div style="display:flex;flex-direction:column;gap:0.75rem">
            ${CHANNELS.map(ch => { const amt = chanSum[ch.key] || 0; const cnt = chanCnt[ch.key] || 0; const on = amt > 0 || cnt > 0; const st = chanStatusOf(ch.key); const conn = connectedSet.has(ch.key); const active = on || (st && st.color === '#22c55e'); const stBadge = st ? `<span style="font-size:0.64rem;font-weight:700;color:${st.color}">● ${st.label}</span> <span style="font-size:0.6rem;color:var(--text-muted)">${st.sub}</span>` : '<span style="font-size:0.66rem;background:rgba(148,163,184,0.15);padding:1px 6px;border-radius:6px">연동 예정</span>'; return `<div style="display:flex;align-items:center;gap:10px">
                <span style="width:9px;height:9px;border-radius:3px;background:${active ? ch.color : 'rgba(148,163,184,0.4)'};flex-shrink:0"></span>
                <span style="font-size:0.84rem;font-weight:${active ? '600' : '400'};color:${active ? 'var(--text-main)' : 'var(--text-muted)'};flex:1">${ch.label} ${on ? `<span style="font-size:0.68rem;color:var(--text-muted);font-weight:500">${cnt}건</span> ` : ''}${stBadge}</span>
                <span style="font-size:0.84rem;font-weight:${on ? '800' : '400'};font-variant-numeric:tabular-nums;color:${on ? 'var(--text-main)' : 'var(--text-muted)'}">${on ? won(amt) + '원' : '—'}</span>
            </div>`; }).join('')}
            </div>
            <p style="margin:0.9rem 0 0;font-size:0.72rem;color:var(--text-muted)">이번 달 기준 · 배지는 실제 수집 실태(최근 주문·동기화)로 판정 — 수집중/지연/중단</p>
        </div>`;

        // 주문 처리 현황 (이번 달)
        const STATUS = [{ k: 'new', l: '신규', c: '#6366f1' }, { k: 'ready', l: '배송준비', c: '#f59e0b' }, { k: 'shipping', l: '배송중', c: '#06b6d4' }, { k: 'done', l: '완료', c: '#10b981' }, { k: 'hold', l: '보류', c: '#ef4444' }];
        const statCnt = {};
        orders.forEach(o => { if (!inCur(o.order_date)) return; const s = o.status || 'new'; statCnt[s] = (statCnt[s] || 0) + 1; });
        const statMax = Math.max(1, ...STATUS.map(s => statCnt[s.k] || 0));
        const statCard = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
            <div style="font-size:0.92rem;font-weight:700;margin-bottom:1rem"><i class="ph ph-package" style="color:var(--primary)"></i> 주문 처리 현황 <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500">(${shortLabel})</span></div>
            <div style="display:flex;flex-direction:column;gap:0.8rem">
            ${STATUS.map(s => { const n = statCnt[s.k] || 0; return `<div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:0.83rem;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.c};margin-right:7px"></span>${s.l}</span><span style="font-size:0.83rem;font-weight:800;font-variant-numeric:tabular-nums">${n.toLocaleString()}건</span></div>
                <div style="height:6px;border-radius:4px;background:rgba(148,163,184,0.12);overflow:hidden"><div style="height:100%;width:${Math.max(2, n / statMax * 100)}%;background:${s.c};border-radius:4px"></div></div>
            </div>`; }).join('')}
            </div>
        </div>`;

        // 반품·교환 분석 (급증 감지 + 반복 반품 고객)
        const retThis = (cancelledOrders || []).filter(o => inScope(o.order_date));
        const reasonCnt = {};
        retThis.forEach(o => { const r = o.return_reason || (o.raw && (o.raw.return_reason || o.raw.cancelReason)) || null; if (r) reasonCnt[r] = (reasonCnt[r] || 0) + 1; });
        const reasonArr = Object.entries(reasonCnt).sort((a, b) => b[1] - a[1]);
        const retPrevKey = yearMode ? null : months[li - 1];
        const retPrev = retPrevKey ? (cancelledOrders || []).filter(o => (o.order_date || '').startsWith(retPrevKey)) : [];
        const totalInScope = ordersThisMonth + retThis.length;
        const retRate = totalInScope ? Math.round(retThis.length / totalInScope * 100) : 0;
        const spike = retPrev.length >= 2 && retThis.length >= retPrev.length * 1.8;
        const byBuyer = {};
        retThis.forEach(o => { const n = o.buyer_name || o.receiver_name || '미상'; (byBuyer[n] = byBuyer[n] || []).push(o); });
        const repeat = Object.entries(byBuyer).filter(([, arr]) => arr.length >= 2).sort((a, b) => b[1].length - a[1].length);
        const returnCard = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px;margin-top:1.3rem;${spike ? 'border:1.5px solid rgba(239,68,68,0.45)' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:1rem">
                <div style="font-size:0.92rem;font-weight:700"><i class="ph ph-arrow-u-up-left" style="color:#a855f7"></i> 반품·교환 분석 <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500">(${shortLabel})</span></div>
                ${spike ? `<span style="font-size:0.74rem;font-weight:700;color:#ef4444;background:rgba(239,68,68,0.12);padding:3px 10px;border-radius:7px">⚠ 급증 — 직전 ${retPrev.length}건 → ${retThis.length}건</span>` : (retPrevKey ? `<span style="font-size:0.72rem;color:var(--text-muted)">직전 ${+retPrevKey.slice(5)}월 ${retPrev.length}건 → ${retThis.length}건</span>` : '')}
            </div>
            <div style="display:flex;gap:2.4rem;flex-wrap:wrap;margin-bottom:1.1rem">
                <div><div style="font-size:1.6rem;font-weight:800;color:#a855f7;line-height:1">${retThis.length}<span style="font-size:0.8rem;font-weight:600">건</span></div><div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px">반품·교환</div></div>
                <div><div style="font-size:1.6rem;font-weight:800;line-height:1;color:${retRate >= 15 ? '#ef4444' : 'var(--text-main)'}">${retRate}<span style="font-size:0.8rem;font-weight:600">%</span></div><div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px">반품률</div></div>
                <div><div style="font-size:1.6rem;font-weight:800;line-height:1;color:${repeat.length ? '#ef4444' : 'var(--text-main)'}">${repeat.length}<span style="font-size:0.8rem;font-weight:600">명</span></div><div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px">반복 반품 고객</div></div>
            </div>
            <div style="font-size:0.82rem;font-weight:700;margin-bottom:6px">반품 사유</div>
            <div style="margin-bottom:1rem">${reasonArr.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${reasonArr.map(([r, c]) => `<span style="font-size:0.78rem;background:rgba(168,85,247,0.12);color:#a855f7;padding:3px 10px;border-radius:8px;font-weight:600">${this._vesc(r)} ${c}</span>`).join('')}</div>` : '<div style="font-size:0.76rem;color:var(--text-muted)">사유 미태깅 — 반품 처리 시 사유(사이즈/품질/변심)를 입력하면 여기 집계돼요</div>'}</div>
            <div style="font-size:0.82rem;font-weight:700;margin-bottom:6px">반복 반품 고객 <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500">(2회 이상 — 어뷰징·품질 이슈 신호)</span></div>
            ${repeat.length ? repeat.slice(0, 8).map(([n, arr]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-top:1px solid var(--card-border);font-size:0.83rem"><span>${this._vesc(n)}</span><span style="font-weight:700;color:${arr.length >= 3 ? '#ef4444' : '#f59e0b'}">${arr.length}회</span></div>`).join('') : '<div style="font-size:0.8rem;color:var(--text-muted);padding:6px 0">반복 반품 고객 없음 (정상)</div>'}
        </div>`;

        // ── 운영 인사이트: 채널 순이익(수수료 반영) · 재구매율 · 옵션(사이즈/컬러) 분포 ──
        const CH_FEE = { cafe24: 0.03, musinsa: 0.30, '29cm': 0.32, kidikidi: 0.35, smartstore: 0.06 };
        const CH_LABEL = { cafe24: '카페24', musinsa: '무신사', '29cm': '29CM', kidikidi: '키디키디', smartstore: '스마트스토어' };
        const netByChan = {};
        orders.forEach(o => { if (!inScope(o.order_date)) return; const c = platformKey(o); const g = Number(o.pay_amount) || 0; (netByChan[c] = netByChan[c] || { g: 0, n: 0 }).g += g; netByChan[c].n += g * (1 - (CH_FEE[c] ?? 0.05)); });
        const netArr = Object.entries(netByChan).sort((a, b) => b[1].n - a[1].n);
        const netMax = Math.max(1, ...netArr.map(([, v]) => v.g));
        const grossTot = netArr.reduce((s, [, v]) => s + v.g, 0), netTot = netArr.reduce((s, [, v]) => s + v.n, 0);
        const buyerCnt = {};
        orders.forEach(o => { if (!inScope(o.order_date)) return; const n = o.buyer_name || o.receiver_name; if (n) buyerCnt[n] = (buyerCnt[n] || 0) + 1; });
        const bvals = Object.values(buyerCnt), totBuyers = bvals.length, repBuyers = bvals.filter(c => c >= 2).length;
        const repeatRate = totBuyers ? Math.round(repBuyers / totBuyers * 100) : 0;
        const repeatOrders = bvals.filter(c => c >= 2).reduce((s, c) => s + c, 0), totOrdersB = bvals.reduce((s, c) => s + c, 0);
        const optCnt = {};
        const isDeliveryOpt = t => /배송|택배|무료|delivery|shipping|수령|방법/i.test(t); // 사이즈·컬러 아닌 배송옵션 제외
        orders.forEach(o => {
            if (!inScope(o.order_date)) return;
            (o.items || []).forEach(it => { (it.option_name || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean).filter(t => !isDeliveryOpt(t)).forEach(t => optCnt[t] = (optCnt[t] || 0) + (Number(it.quantity) || 1)); });
            (((o.raw || {}).items) || []).forEach(it => { (it.uitem || '').split(/[\/,]/).map(s => s.trim()).filter(Boolean).filter(t => !isDeliveryOpt(t)).forEach(t => optCnt[t] = (optCnt[t] || 0) + (Number(it.qty) || 1)); });
        });
        const optArr = Object.entries(optCnt).sort((a, b) => b[1] - a[1]).slice(0, 8);
        const optMax = Math.max(1, ...optArr.map(x => x[1]));
        const netCard = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
            <div style="font-size:0.92rem;font-weight:700;margin-bottom:0.3rem"><i class="ph ph-coins" style="color:#10b981"></i> 채널 순이익 <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500">(수수료 차감)</span></div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.9rem">총매출 ${won(grossTot)} → 순매출 <b style="color:#10b981">${won(netTot)}</b></div>
            ${netArr.length ? netArr.map(([c, v]) => `<div style="margin-bottom:0.6rem">
                <div style="display:flex;justify-content:space-between;font-size:0.81rem;margin-bottom:3px"><span style="font-weight:600">${CH_LABEL[c] || c} <span style="font-size:0.68rem;color:var(--text-muted)">수수료 ${Math.round((CH_FEE[c] ?? 0.05) * 100)}%</span></span><span style="font-weight:800;font-variant-numeric:tabular-nums">${won(v.n)}</span></div>
                <div style="height:8px;border-radius:5px;background:rgba(148,163,184,0.14);overflow:hidden"><div style="height:100%;width:${Math.max(3, v.g / netMax * 100)}%;background:#10b981;border-radius:5px;opacity:0.9"></div></div>
            </div>`).join('') : '<div style="color:var(--text-muted);font-size:0.8rem">기간 내 매출 없음</div>'}
            <p style="margin:0.6rem 0 0;font-size:0.68rem;color:var(--text-muted)">* 수수료율은 추정치 — 설정에서 조정 예정</p>
        </div>`;
        const repeatCard = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
            <div style="font-size:0.92rem;font-weight:700;margin-bottom:1rem"><i class="ph ph-arrows-clockwise" style="color:#6366f1"></i> 재구매 <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500">(${shortLabel})</span></div>
            <div style="display:flex;align-items:baseline;gap:6px;margin-bottom:0.4rem"><span style="font-size:2rem;font-weight:800;color:#6366f1;line-height:1">${repeatRate}%</span><span style="font-size:0.8rem;color:var(--text-muted)">고객 재구매율</span></div>
            <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.9rem">전체 고객 ${totBuyers}명 중 <b style="color:var(--text-main)">${repBuyers}명</b> 재구매</div>
            <div style="height:10px;border-radius:5px;background:rgba(148,163,184,0.14);overflow:hidden;display:flex">
                <div style="width:${totOrdersB ? (totOrdersB - repeatOrders) / totOrdersB * 100 : 100}%;background:#94a3b8" title="신규"></div>
                <div style="width:${totOrdersB ? repeatOrders / totOrdersB * 100 : 0}%;background:#6366f1" title="재구매"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-muted);margin-top:5px"><span>신규 주문 ${totOrdersB - repeatOrders}</span><span>재구매 주문 ${repeatOrders}</span></div>
        </div>`;
        const optCard = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
            <div style="font-size:0.92rem;font-weight:700;margin-bottom:1rem"><i class="ph ph-squares-four" style="color:#f59e0b"></i> 옵션(사이즈·컬러) 판매 <span style="font-size:0.72rem;color:var(--text-muted);font-weight:500">(수량)</span></div>
            ${optArr.length ? `<div style="display:flex;flex-direction:column;gap:0.6rem">${optArr.map(([t, q]) => `<div>
                <div style="display:flex;justify-content:space-between;font-size:0.81rem;margin-bottom:3px"><span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(t)}</span><span style="font-weight:800;font-variant-numeric:tabular-nums">${q}개</span></div>
                <div style="height:7px;border-radius:4px;background:rgba(148,163,184,0.14);overflow:hidden"><div style="height:100%;width:${Math.max(4, q / optMax * 100)}%;background:linear-gradient(90deg,#f59e0b,#fbbf24);border-radius:4px"></div></div>
            </div>`).join('')}</div>` : '<div style="color:var(--text-muted);font-size:0.8rem;padding:0.5rem 0">옵션 데이터 부족 — 주문 상품 옵션이 수집되면 사이즈·컬러 분포가 여기 떠요</div>'}
        </div>`;
        // 운영 품질·이익 골격 (출고 리드타임 + QC + 원가마진 — 데이터 쌓이면 자동)
        const leads = orders.filter(o => inScope(o.order_date) && o.shipped_at && o.order_date).map(o => (new Date(o.shipped_at) - new Date(o.order_date)) / 864e5).filter(x => x >= 0);
        const avgLead = leads.length ? (leads.reduce((s, x) => s + x, 0) / leads.length) : null;
        const hasCost = orders.some(o => (o.items || []).some(it => it.cost != null));
        const qRow = (label, val) => `<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:0.83rem;color:var(--text-muted)">${label}</span><span style="font-weight:800;font-size:0.9rem">${val}</span></div>`;
        const pend = t => `<span style="font-size:0.74rem;color:var(--text-muted);font-weight:500">${t}</span>`;
        const qualityCard = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
            <div style="font-size:0.92rem;font-weight:700;margin-bottom:1rem"><i class="ph ph-gauge" style="color:#06b6d4"></i> 운영 품질 · 이익</div>
            <div style="display:flex;flex-direction:column;gap:0.9rem">
                ${qRow('평균 출고 리드타임', avgLead != null ? `${avgLead.toFixed(1)}일` : pend('출고 처리 시 집계'))}
                ${qRow('QC 검수 통과율', pend('QC 기록 시 집계'))}
                ${qRow('상품 원가 마진', hasCost ? '—' : pend('SKU 원가 입력 시'))}
            </div>
            <p style="margin:0.9rem 0 0;font-size:0.68rem;color:var(--text-muted)">* 출고일·QC·원가가 쌓이면 자동으로 채워져요</p>
        </div>`;

        // 브랜드 × 월 매트릭스 — 연도 선택해서 1년치(1~12월)씩 보기
        const mtxYear = yearsAvail.includes(this.salesMatrixYear) ? this.salesMatrixYear : selY;
        const mtxMonths = Array.from({ length: 12 }, (_, i) => `${mtxYear}-${String(i + 1).padStart(2, '0')}`);
        const mIdx = k => months.indexOf(k);
        // 해당 연도에 매출 있는 브랜드만 표시
        const mtxBrands = brands.map((b, bi) => {
            const cells = mtxMonths.map(k => { const ix = mIdx(k); return ix >= 0 ? b.cells[ix].amt : 0; });
            return { name: b.name, color: palette[bi % palette.length], cells, total: cells.reduce((s, v) => s + v, 0) };
        }).filter(b => b.total > 0);
        const mtxColTotals = mtxMonths.map((k) => { const ix = mIdx(k); return ix >= 0 ? monthTotals[ix] : 0; });
        const mtxGrand = mtxColTotals.reduce((s, v) => s + v, 0);
        const matrix = `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px;overflow-x:auto;margin-top:1.3rem">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:0.9rem;flex-wrap:wrap">
                <div style="font-size:0.92rem;font-weight:700"><i class="ph ph-table" style="color:var(--primary)"></i> 브랜드 × 월 매출 <span style="color:var(--text-muted);font-weight:600;font-size:0.82rem">· ${mtxYear}년</span></div>
                <select onchange="app.setSalesMatrixYear(this.value)" style="padding:6px 11px;border-radius:9px;border:1px solid var(--card-border);background:transparent;color:var(--text-main);font-size:0.82rem;font-weight:700;cursor:pointer">
                    ${yearsAvail.map(y => `<option value="${y}" ${y === mtxYear ? 'selected' : ''}>${y}년</option>`).join('')}
                </select>
            </div>
            ${mtxBrands.length ? `<table class="mtbl" style="width:100%;border-collapse:collapse;font-size:0.82rem;white-space:nowrap">
                <thead><tr><th style="text-align:left">브랜드</th>${mtxMonths.map(m => `<th style="text-align:right">${+m.slice(5)}월</th>`).join('')}<th style="text-align:right;border-left:1px solid var(--card-border)">합계</th></tr></thead>
                <tbody>${mtxBrands.map(b => `<tr style="border-bottom:1px solid var(--card-border)"><td style="text-align:left;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${b.color};margin-right:6px"></span>${this._vesc(b.name)}</td>${b.cells.map(c => `<td style="text-align:right;font-variant-numeric:tabular-nums;color:${c ? 'var(--text-main)' : 'var(--text-muted)'}">${c ? won(c) : '·'}</td>`).join('')}<td style="text-align:right;font-weight:800;font-variant-numeric:tabular-nums;border-left:1px solid var(--card-border)">${won(b.total)}</td></tr>`).join('')}</tbody>
                <tfoot><tr style="border-top:2px solid var(--card-border);font-weight:800"><td style="text-align:left">합계</td>${mtxColTotals.map(t => `<td style="text-align:right;font-variant-numeric:tabular-nums">${t ? won(t) : '·'}</td>`).join('')}<td style="text-align:right;font-variant-numeric:tabular-nums;border-left:1px solid var(--card-border)">${won(mtxGrand)}</td></tr></tfoot>
            </table>` : `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:0.85rem">${mtxYear}년 매출 데이터가 없습니다.</div>`}
        </div>`;

        return `<div class="mp">
            ${this._mpTop(bf === 'ALL' ? '정산' : bf, bf === 'ALL' ? `전체 브랜드 통합 · ${periodLabel} 기준` : `브랜드 상세 · ${periodLabel} 기준`, `
                    ${this._moneyTabs('sales')}
                    <select onchange="app.setSalesYear(this.value)" style="padding:7px 11px;border-radius:9px;border:1px solid var(--card-border);background:transparent;color:var(--text-main);font-size:0.85rem;font-weight:700;cursor:pointer">
                        ${yearsAvail.map(y => `<option value="${y}" ${y === selY ? 'selected' : ''}>${y}년</option>`).join('')}
                    </select>
                    <select onchange="app.setSalesMonth(this.value)" style="padding:7px 11px;border-radius:9px;border:1px solid var(--card-border);background:transparent;color:var(--text-main);font-size:0.85rem;font-weight:700;cursor:pointer">
                        <option value="ALL" ${yearMode ? 'selected' : ''}>전체(연간)</option>
                        ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => { const has = validM.includes(m); return `<option value="${m}" ${(!yearMode && cmo === m) ? 'selected' : ''} ${has ? '' : 'disabled'}>${m}월${has ? '' : ' (없음)'}</option>`; }).join('')}
                    </select>`)}
            <div class="mp-body">
            <div class="analysis-layout" style="display:flex;gap:1.3rem;align-items:flex-start">
                ${this._brandRail([{ value: 'ALL', label: '전체 통합', active: bf === 'ALL', onclick: "app.setSalesBrand('ALL')" }].concat(brands.map(b => ({ value: b.name, label: this._vesc(b.name), active: bf === b.name, color: colorOf(b.name), onclick: `app.setSalesBrand('${this._vesc(b.name).replace(/'/g, "\\'")}')` }))))}
                <div class="analysis-content" style="flex:1;min-width:0">
                    ${cards}
                    ${chart}
                    ${bf === 'ALL'
                // 개요: 전체가 얼마고 어느 채널에서 나오는지 + 브랜드 카드(여기서 브랜드로 들어감)
                ? `${chanCard}
                   ${brandGrid}
                   ${matrix}`
                // 브랜드 상세: 작전 짜는 지표 전부
                : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:1.3rem">${topCard}${optCard}</div>
                   <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.3rem;margin-top:1.3rem">${repeatCard}${netCard}${chanCard}${statCard}</div>
                   ${returnCard}
                   <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.3rem;margin-top:1.3rem">${qualityCard}</div>`}
                    <p style="margin:1rem 2px 0;font-size:0.74rem;color:var(--text-muted)">* 판매 브랜드 = 몰 주문 결제금액 · 컨설팅 = ${consultingFromQuote ? '견적 총액(세금계산서 미발행)' : '발행 세금계산서'} · 취소·반품·교환은 집계에서 제외</p>
                </div>
            </div>
        </div></div>`;
    }

    // ============================================================
    //  분석 탭 — 브랜드별 고객군(사이즈·색상). 브랜드마다 고객이 달라 통합 안 함.
    // ============================================================
    _analysisBrandNames() {
        return [...new Set((this.malls || []).map(m => { const b = (mockData.brands || []).find(x => x.id === m.brand_id); return b ? b.name : (m.label || null); }).filter(Boolean))];
    }
    setAnalysisBrand(b) { this.analysisBrand = b; this._analysisScopeKey = null; this._analysisRepeatKey = null; this.requestRender(); this.ensureViewData(); }
    setAnalysisPeriod(p) { this.analysisPeriod = p; this._analysisScopeKey = null; this._analysisRepeatKey = null; this.requestRender(); this.ensureViewData(); }
    // 분석 기간 프리셋 → {from,to,label}. all=전체, 3m/6m/12m=최근 N개월, yYYYY=연도.
    _analysisRange() {
        const p = this.analysisPeriod || 'all';
        const iso = d => d.toISOString().slice(0, 10);
        const pad = n => String(n).padStart(2, '0');
        if (p === 'month') { const now = new Date(); const y = now.getFullYear(), m = now.getMonth(); const ny = m === 11 ? y + 1 : y, nm = m === 11 ? 0 : m + 1; return { from: `${y}-${pad(m + 1)}-01`, to: `${ny}-${pad(nm + 1)}-01`, label: `${m + 1}월(당월)` }; }
        if (/^y\d{4}$/.test(p)) { const y = +p.slice(1); return { from: `${y}-01-01`, to: `${y + 1}-01-01`, label: `${y}년` }; }
        const mm = { '3m': 3, '6m': 6, '12m': 12 }[p];
        if (mm) { const f = new Date(); f.setMonth(f.getMonth() - mm); return { from: iso(f), to: null, label: `최근 ${mm}개월` }; }
        return { from: null, to: null, label: '전체기간' };
    }

    // 공통 브랜드 사이드바(분석·매출·재고 통일). entries:[{value,label,active,color,onclick}]
    _brandRail(entries) {
        return `<div class="analysis-brandbar" style="width:154px;flex-shrink:0;display:flex;flex-direction:column;gap:6px">
            <div style="font-size:0.7rem;color:var(--text-muted);font-weight:700;padding:0 4px 2px">브랜드</div>
            ${entries.map(e => `<button onclick="${e.onclick}" style="text-align:left;padding:10px 12px;border-radius:11px;border:1px solid ${e.active ? 'var(--primary)' : 'var(--card-border)'};background:${e.active ? 'rgba(99,102,241,0.12)' : 'transparent'};color:${e.active ? 'var(--primary)' : 'var(--text-main)'};font-size:0.86rem;font-weight:${e.active ? '800' : '600'};cursor:pointer;display:flex;align-items:center;gap:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${e.active ? '<i class="ph ph-caret-right" style="flex-shrink:0"></i>' : (e.color ? `<span style="width:8px;height:8px;border-radius:2px;background:${e.color};flex-shrink:0"></span>` : '')}${e.label}</button>`).join('')}
        </div>`;
    }
    async _loadAnalysisScope(brandName, fromISO, toISO) {
        const key = `${brandName}|${fromISO}|${toISO}`;
        if (this._analysisScopeKey === key || this._analysisScopeLoading) return;
        this._analysisScopeLoading = true; this.requestRender();
        try {
            const mallKeys = (this.malls || []).filter(m => { const b = (mockData.brands || []).find(x => x.id === m.brand_id); return (b ? b.name : (m.label || m.mall_key)) === brandName; }).map(m => m.mall_key);
            let q = this.supabase.from('channel_orders_slim').select('*').gte('order_date', fromISO).lt('order_date', toISO);
            if (mallKeys.length) q = q.in('mall_key', mallKeys);
            const { data, error } = await q.order('order_date', { ascending: false });
            if (error) throw error;
            const rows = data || [];
            const items = await this._itemsFor(rows.map(o => o.id));
            const byOrder = {};
            items.forEach(it => { (byOrder[it.channel_order_id] = byOrder[it.channel_order_id] || []).push(it); });
            const withItems = rows.map(o => ({ ...o, items: byOrder[o.id] || [] }));
            this.analysisScoped = { orders: withItems.filter(o => o.pay_amount != null && !this._isCancelled(o)) };
            this._analysisScopeKey = key;
        } catch (e) { this.analysisScoped = { orders: [] }; this._analysisScopeKey = key; }
        this._analysisScopeLoading = false; this.requestRender();
    }
    // 재구매율·누적금액 — 서버 RPC(전체기간, 전화번호 기준)
    async _loadAnalysisRepeat(brand, fromISO, toISO) {
        const key = `${brand}|${fromISO}|${toISO}`;
        if (!brand || this._analysisRepeatKey === key || this._analysisRepeatLoading) return;
        this._analysisRepeatLoading = true; this.requestRender();
        try {
            const [rep, ot] = await Promise.all([
                this.supabase.rpc('brand_repurchase', { p_brand: brand, p_from: fromISO, p_to: toISO }),
                this.supabase.rpc('brand_order_types', { p_brand: brand, p_from: fromISO, p_to: toISO }),
            ]);
            if (rep.error) throw rep.error;
            this.analysisRepeat = { [brand]: rep.data };
            this.analysisOrderTypes = { [brand]: ot.error ? null : ot.data };
            this._analysisRepeatKey = key;
        } catch (e) { this.analysisRepeat = { [brand]: null }; this.analysisOrderTypes = { [brand]: null }; this._analysisRepeatKey = key; }
        this._analysisRepeatLoading = false; this.requestRender();
    }
    // 사이즈·색상 고객군 HTML (items 배열 → 분포)
    _customerAnalysisHTML(items, loading) {
        const pick = (re, s) => { const m = String(s || '').toLowerCase().match(re); return m ? m[1].trim() : null; };
        // 값 정제: [pre-order] 태그·안내문구 괄호 제거 → 순수 색상/사이즈만 집계
        const cleanCol = v => { if (!v) return v; v = v.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*(?:공지|필독|필수|주의|참고|안내|잡사)[^)]*\)/g, '').replace(/\s+/g, ' ').trim(); return v || null; };
        const cleanSz = v => { if (!v) return v; v = v.replace(/\[[^\]]*\]/g, '').replace(/\([^)]*(?:발송|배송|공지|필독|안내)[^)]*\)/g, '').replace(/\s+/g, ' ').trim(); return v || null; };
        const szMap = {}, colMap = {}, comboMap = {};
        (items || []).forEach(it => {
            const q = Number(it.quantity || 1);
            const sz = cleanSz(pick(/size=([^,]+)/, it.option_name)), col = cleanCol(pick(/color=([^,]+)/, it.option_name));
            if (sz) szMap[sz] = (szMap[sz] || 0) + q;
            if (col) colMap[col] = (colMap[col] || 0) + q;
            if (sz && col) { const k = `${col} · ${sz}`; comboMap[k] = (comboMap[k] || 0) + q; }
        });
        const rank = (m, n) => { const t = Object.values(m).reduce((s, v) => s + v, 0) || 1; const arr = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n); let cum = 0; return arr.map(([l, v]) => { cum += v; const g = cum / t <= 0.6 ? '주요' : (cum / t <= 0.85 ? '서브' : '약한'); return { l, v, share: Math.round(v / t * 100), g }; }); };
        const gCol = g => g === '주요' ? '#16a34a' : g === '서브' ? '#f59e0b' : '#94a3b8';
        const rowsH = (arr, color) => arr.length ? arr.map(x => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:0.83rem;margin-bottom:3px"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(x.l)} <span style="font-size:0.64rem;font-weight:700;color:${gCol(x.g)}">${x.g}</span></span><span style="white-space:nowrap;flex-shrink:0"><b style="font-variant-numeric:tabular-nums">${x.v.toLocaleString()}</b><span style="display:inline-block;min-width:40px;text-align:right;margin-left:12px;font-size:0.72rem;color:var(--text-muted);font-weight:500;font-variant-numeric:tabular-nums">${x.share}%</span></span></div><div style="height:8px;border-radius:5px;background:rgba(148,163,184,0.15)"><div style="height:100%;width:${Math.max(3, x.share)}%;background:${color};border-radius:5px"></div></div></div>`).join('') : '<span style="color:var(--text-muted);font-size:0.82rem">데이터 없음</span>';
        const sizes = rank(szMap, 10), colors = rank(colMap, 10), combos = Object.entries(comboMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
        if (!(sizes.length || colors.length)) return `<div class="glass" style="padding:1.6rem;border-radius:18px;color:var(--text-muted);font-size:0.86rem">${loading ? '불러오는 중…' : '이 브랜드·기간에 옵션(사이즈/색상) 데이터가 없어요.'}</div>`;
        return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.3rem">
            <div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px"><div style="font-size:0.9rem;font-weight:700;margin-bottom:0.9rem"><i class="ph ph-ruler" style="color:#6366f1"></i> 사이즈 고객군</div>${rowsH(sizes, '#6366f1')}</div>
            <div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px"><div style="font-size:0.9rem;font-weight:700;margin-bottom:0.9rem"><i class="ph ph-palette" style="color:#818cf8"></i> 색상 고객군</div>${rowsH(colors, '#818cf8')}</div>
        </div>
        ${combos.length ? `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px;margin-top:1.3rem"><div style="font-size:0.9rem;font-weight:700;margin-bottom:0.8rem"><i class="ph ph-user-focus" style="color:#4338ca"></i> 대표 고객 프로필 <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600">색상×사이즈 조합 TOP</span></div><div style="display:flex;flex-wrap:wrap;gap:8px">${combos.map(([l, v], i) => `<span style="font-size:0.83rem;padding:6px 13px;border-radius:20px;background:${i === 0 ? 'rgba(99,102,241,0.12)' : 'rgba(148,163,184,0.1)'};font-weight:${i === 0 ? '700' : '500'}">${this._vesc(l)} <b style="color:#4338ca">${v.toLocaleString()}</b></span>`).join('')}</div></div>` : ''}
        <p style="margin:1rem 2px 0;font-size:0.72rem;color:var(--text-muted)">* 판매수량 기준 · 주문 옵션(color/size)에서 추출 · 취소·환불 제외 · 주요(누적 60%)/서브(~85%)/약한</p>`;
    }

    // 재구매 횟수 분포(1~10회+) · 단골 = 10회 이상
    _repeatDistHTML(rep) {
        const bmap = {}; (rep.dist || []).forEach(d => { bmap[d.bucket] = d.c; });
        const buckets = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10+'];
        const vals = buckets.map(b => bmap[b] || 0);
        const maxV = Math.max(1, ...vals);
        const loyal = rep.loyal || bmap['10+'] || 0;
        const cust = rep.customers || 1;
        const barH = v => Math.max(2, Math.round(Math.sqrt(v / maxV) * 66));
        const bars = buckets.map((b, i) => {
            const v = vals[i], isLoyal = b === '10+';
            const col = isLoyal ? '#4338ca' : (i === 0 ? '#cbd5e1' : '#6366f1');
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" title="${b}회 구매 · ${v.toLocaleString()}명">
                <span style="font-size:0.58rem;color:var(--text-muted);line-height:1;margin-bottom:2px">${v ? v.toLocaleString() : ''}</span>
                <div style="width:100%;max-width:20px;background:${col};height:${barH(v)}px;border-radius:3px 3px 0 0"></div>
            </div>`;
        }).join('');
        const labels = buckets.map(b => `<span style="flex:1;text-align:center;font-size:0.56rem;color:${b === '10+' ? '#4338ca' : 'var(--text-muted)'};font-weight:${b === '10+' ? '700' : '400'}">${b}</span>`).join('');
        return `<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:5px;font-weight:600">구매 횟수 분포 <span style="font-weight:400">(회당 고객수)</span></div>
            <div style="display:flex;align-items:flex-end;gap:3px;height:80px">${bars}</div>
            <div style="display:flex;gap:3px;margin-top:3px">${labels}</div>
            <div style="margin-top:9px;padding-top:9px;border-top:1px solid var(--card-border);display:flex;justify-content:space-between;align-items:baseline;font-size:0.8rem">
                <span style="color:#4338ca;font-weight:800"><i class="ph ph-heart"></i> 단골고객 ${loyal.toLocaleString()}명</span>
                <span style="color:var(--text-muted);font-size:0.72rem">10회 이상 · 전체의 ${Math.round(loyal / cust * 100)}%</span>
            </div>`;
    }

    // 주문타입 분석 — 정식/프리오더/이벤트 주문 구성 + 고객 세그먼트(타입별 구매 성향)
    _orderTypesHTML(ot, periodLabel) {
        if (!ot) return '';
        const pl = periodLabel || '전체기간';
        const T = ot.orders_total || 1, C = ot.customers || 1;
        const pct = (v, t) => Math.round((v || 0) / (t || 1) * 100);
        // 인디고 단일계열 램프(정식 진함 → 이벤트 옅음) — 알록달록 방지
        const parts = [['정식', ot.orders_regular || 0, '#4338ca'], ['프리오더', ot.orders_preorder || 0, '#818cf8'], ['이벤트', ot.orders_event || 0, '#c7d2fe']];
        const bar = `<div style="display:flex;height:15px;border-radius:8px;overflow:hidden;background:rgba(148,163,184,0.15)">${parts.map(([l, v, c]) => v ? `<div style="width:${(v / T * 100).toFixed(1)}%;background:${c}" title="${l} ${v.toLocaleString()}건"></div>` : '').join('')}</div>`;
        const legend = parts.map(([l, v, c]) => `<span style="display:inline-flex;align-items:center;gap:5px;font-size:0.78rem;margin-right:18px;white-space:nowrap"><span style="width:9px;height:9px;border-radius:2px;background:${c}"></span>${l} <b style="font-variant-numeric:tabular-nums">${v.toLocaleString()}</b><span style="color:var(--text-muted);font-size:0.7rem;margin-left:5px">${pct(v, T)}%</span></span>`).join('');
        const segTile = (label, v, dot, desc) => `<div style="flex:1;min-width:120px;text-align:center;padding:12px 8px;background:rgba(148,163,184,0.07);border:1px solid var(--card-border);border-radius:12px"><div style="font-size:1.5rem;font-weight:900;color:var(--text-main);line-height:1;font-variant-numeric:tabular-nums">${(v || 0).toLocaleString()}<span style="font-size:0.68rem;font-weight:600;color:var(--text-muted)">명</span></div><div style="font-size:0.78rem;font-weight:700;margin-top:5px;display:flex;align-items:center;justify-content:center;gap:5px"><span style="width:7px;height:7px;border-radius:2px;background:${dot};flex-shrink:0"></span>${label}</div><div style="font-size:0.62rem;color:var(--text-muted);margin-top:2px">${desc} · ${pct(v, C)}%</div></div>`;
        return `<div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px;margin-top:1.3rem">
            <div style="font-size:0.9rem;font-weight:700;margin-bottom:0.9rem"><i class="ph ph-tag" style="color:#6366f1"></i> 주문타입 <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600">${pl} · 이벤트=상품명 특가/기획/세일</span></div>
            <div style="margin-bottom:0.55rem">${bar}</div>
            <div style="margin-bottom:1.15rem">${legend}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:7px;font-weight:600">고객 세그먼트 <span style="font-weight:400">(이 브랜드에서 산 타입 기준 · ${pl})</span></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${segTile('정식만', ot.seg_regular_only, '#4338ca', '정식만 구매')}
                ${segTile('프리오더만', ot.seg_preorder_only, '#818cf8', '프리오더만')}
                ${segTile('이벤트만', ot.seg_event_only, '#c7d2fe', '이벤트만')}
                ${segTile('복합', ot.seg_mixed, '#6366f1', '여러 타입')}
            </div>
            <p style="margin:0.85rem 2px 0;font-size:0.68rem;color:var(--text-muted)">* 주문타입 우선순위 이벤트&gt;프리오더&gt;정식 · 취소·환불 제외 · 전화번호 기준 고객</p>
        </div>`;
    }

    renderAnalysis() {
        const names = this._analysisBrandNames();
        const bf = (this.analysisBrand && names.includes(this.analysisBrand)) ? this.analysisBrand : (names[0] || null);
        const range = this._analysisRange();
        const curP = this.analysisPeriod || 'all';
        const periods = [['all', '전체기간'], ['month', '당월'], ['3m', '최근 3개월'], ['6m', '최근 6개월'], ['12m', '최근 12개월'], ['y2026', '2026년'], ['y2025', '2025년'], ['y2024', '2024년']];
        const items = ((this.analysisScoped && this.analysisScoped.orders) || []).flatMap(o => o.items || []);
        const orderCnt = ((this.analysisScoped && this.analysisScoped.orders) || []).length;
        const won = n => this._won(n);
        // 재구매율·누적금액(전체기간, RPC)
        const rep = (this.analysisRepeat && this.analysisRepeat[bf]) || null;
        const repLoading = this._analysisRepeatLoading && this._analysisRepeatKey !== bf;
        const distBar = (label, v, tot, color) => { const pct = tot ? Math.round(v / tot * 100) : 0; return `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:2px"><span>${label}</span><b>${v.toLocaleString()}명 <span style="color:var(--text-muted);font-weight:500;font-size:0.68rem">${pct}%</span></b></div><div style="height:7px;border-radius:4px;background:rgba(148,163,184,0.15)"><div style="height:100%;width:${Math.max(2, pct)}%;background:${color};border-radius:4px"></div></div></div>`; };
        const repeatCard = bf ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.3rem">
            <div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
                <div style="font-size:0.9rem;font-weight:700;margin-bottom:0.6rem"><i class="ph ph-repeat" style="color:#6366f1"></i> 재구매율 <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600">${range.label} · 전화번호 기준</span></div>
                ${!rep ? `<div style="color:var(--text-muted);font-size:0.84rem;padding:0.8rem 0">${repLoading ? '불러오는 중…' : '데이터 없음'}</div>` : `
                <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:0.7rem"><span style="font-size:2rem;font-weight:900;color:#6366f1;line-height:1">${rep.rate ?? 0}%</span><span style="font-size:0.78rem;color:var(--text-muted)">고객 ${(rep.customers || 0).toLocaleString()}명 중 ${(rep.repeat_customers || 0).toLocaleString()}명 재구매</span></div>
                <div style="display:flex;gap:14px;font-size:0.76rem;color:var(--text-muted);margin-bottom:0.8rem"><span>평균 <b style="color:var(--text-main)">${rep.avg_orders ?? 0}회</b></span><span>평균 누적구매 <b style="color:var(--text-main)">${won(rep.avg_spend || 0)}원</b></span><span>최다 <b style="color:var(--text-main)">${rep.max_orders ?? 0}회</b></span></div>
                ${this._repeatDistHTML(rep)}`}
            </div>
            <div class="glass" style="padding:1.2rem 1.3rem;border-radius:18px">
                <div style="font-size:0.9rem;font-weight:700;margin-bottom:0.7rem"><i class="ph ph-crown-simple" style="color:#6366f1"></i> VIP 고객 <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600">누적 구매액 TOP</span></div>
                ${!rep || !(rep.top && rep.top.length) ? `<div style="color:var(--text-muted);font-size:0.84rem;padding:0.8rem 0">${repLoading ? '불러오는 중…' : '데이터 없음'}</div>` : rep.top.map((t, i) => { const last = t.last ? new Date(t.last).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' }) : '—'; return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:${i ? '1px solid var(--card-border)' : '0'};font-size:0.82rem"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0"><b style="color:${i < 3 ? '#4338ca' : 'var(--text-muted)'};margin-right:6px">${i + 1}</b>${this._vesc(t.nm || '-')} <span style="color:var(--text-muted);font-size:0.72rem">${t.n}회</span></span><span style="text-align:right;white-space:nowrap;flex-shrink:0"><b style="font-variant-numeric:tabular-nums">${won(t.spend || 0)}원</b><div style="font-size:0.66rem;color:var(--text-muted)">마지막 ${last}</div></span></div>`; }).join('')}
            </div>
        </div>` : '';
        return `<div class="mp">
            ${this._mpTop('고객 분석', bf ? `${this._vesc(bf)} · ${range.label} · 주문 ${orderCnt.toLocaleString()}건` : '브랜드를 고르세요', `
                    <select class="it-sel it-season" onchange="app.setAnalysisPeriod(this.value)">
                        ${periods.map(([v, l]) => `<option value="${v}" ${curP === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>`)}
            <div class="it-pills">
                ${names.length ? names.map(n => `<button class="it-pill${bf === n ? ' on' : ''}"
                    onclick="app.setAnalysisBrand('${this._vesc(n).replace(/'/g, "\\'")}')">${this._vesc(n)}</button>`).join('')
                  : '<span class="mu" style="font-size:11.5px;color:var(--text-muted)">연동된 판매 브랜드가 없습니다</span>'}
                <span class="pill-sp"></span>
                <span class="sync-b">브랜드마다 고객이 달라 통합하지 않습니다</span>
            </div>
            <div class="mp-body">
            <div class="analysis-layout" style="display:block">
                <div class="analysis-content" style="min-width:0">
                    ${bf ? `${repeatCard}${this._orderTypesHTML((this.analysisOrderTypes && this.analysisOrderTypes[bf]) || null, range.label)}<div style="margin-top:1.3rem">${this._customerAnalysisHTML(items, this._analysisScopeLoading)}</div>` : '<div class="glass" style="padding:2rem;border-radius:18px;color:var(--text-muted)">연동된 판매 브랜드가 없습니다.</div>'}
                </div>
            </div>
        </div></div>`;
    }

    // ============================================================
    //  SNS(인스타그램) 운영현황 — 팔로워 추이 · 주간 게시물 · 주간 스토리
    //  ig_accounts(브랜드별 계정) × ig_snapshots(일/주 스냅샷).
    //  수동 입력(source='manual')과 메타 자동수집(source='meta')을 같은 표로 본다.
    //  posts_delta/stories_delta = 직전 기록 이후 올린 개수 → ISO주 합산 = 주간 지표.
    // ============================================================
    async loadIG() {
        this._igLoading = true;
        try {
            const [accRes, snapRes, adRes] = await Promise.all([
                this.supabase.from('ig_accounts').select('*'),
                this.supabase.from('ig_snapshots').select('*').order('snap_date', { ascending: true }),
                this.supabase.from('ad_status').select('*'),
            ]);
            this.igAccounts = accRes.data || [];
            this.igSnapshots = snapRes.data || [];
            this.adStatus = adRes.data || [];
            this._igLoaded = true;
        } catch (e) { this.igAccounts = []; this.igSnapshots = []; this.adStatus = []; this._igLoaded = true; }
        this._igLoading = false;
        this.requestRender();
    }

    // 스냅샷 날짜(YYYY-MM-DD)가 속한 주의 월요일 키
    _igWeekKey(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        const back = (d.getDay() + 6) % 7;   // 월=0
        d.setDate(d.getDate() - back);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // 증감 표기 — 한국식: 상승=빨강 ▲, 하락=파랑 ▼, 숫자는 검정(절대값).
    _igDelta(v) {
        if (v == null) return '<span style="color:var(--text-muted)">—</span>';
        if (v === 0) return '<span style="color:var(--text-muted)">0</span>';
        const up = v > 0;
        const col = up ? '#dc2626' : '#2563eb';
        // 이쁜 라운드 삼각형(SVG), 글자 크기의 약 50%로. 상승=빨강▲ 하락=파랑▼.
        const path = up ? 'M6 1.2 L11 9.8 L1 9.8 Z' : 'M1 1.2 L11 1.2 L6 9.8 Z';
        const tri = `<svg viewBox="0 0 12 11" aria-hidden="true" style="width:0.5em;height:0.5em;vertical-align:baseline;margin-right:2px"><path d="${path}" fill="${col}" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
        return `${tri}<span style="color:var(--text-main)">${Math.abs(v).toLocaleString()}</span>`;
    }

    // 작은 선그래프(팔로워 추이)
    _igSpark(points, color, w = 300, h = 66) {
        if (!points.length) return `<div style="color:var(--text-muted);font-size:0.78rem;padding:14px 0">아직 기록이 없어요</div>`;
        const ys = points.map(p => p.v);
        const minY = Math.min(...ys), maxY = Math.max(...ys), spanY = Math.max(1, maxY - minY), n = points.length;
        const px = i => (n === 1 ? w / 2 : (i / (n - 1)) * (w - 8) + 4);
        const py = v => h - 6 - ((v - minY) / spanY) * (h - 16);
        const d = points.map((p, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ');
        return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="overflow:visible">
            <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
            ${points.map((p, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="2.2" fill="${color}"/>`).join('')}
        </svg>`;
    }

    // 최근 30일 팔로워 그래프 — 작은 스파크라인으로는 며칠에 몇 명 늘었는지가 안 보여서 따로 그린다.
    //  수집이 빠진 날(2026-09-03~14 공백)은 선을 잇되 점을 찍지 않아 "측정 안 함"이 드러나게 한다.
    _igFollowerChart(points, color = '#3b82f6', days = 30) {
        const today = new Date();
        const from = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
        const pts = points.filter(p => p.t >= from);
        if (pts.length < 2) return `<div style="color:var(--text-muted);font-size:0.78rem;padding:14px 0">30일치 기록이 아직 부족해요</div>`;
        const w = 320, h = 108, padL = 4, padR = 4, padT = 10, padB = 18;
        const ys = pts.map(p => p.v);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const spanY = Math.max(1, maxY - minY);
        const t0 = new Date(pts[0].t).getTime(), t1 = new Date(pts[pts.length - 1].t).getTime();
        const spanT = Math.max(1, t1 - t0);
        const px = t => padL + ((new Date(t).getTime() - t0) / spanT) * (w - padL - padR);
        const py = v => padT + (1 - (v - minY) / spanY) * (h - padT - padB);
        const line = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.t).toFixed(1)},${py(p.v).toFixed(1)}`).join(' ');
        const area = `${line} L${px(pts[pts.length - 1].t).toFixed(1)},${h - padB} L${px(pts[0].t).toFixed(1)},${h - padB} Z`;
        const gid = 'igg' + Math.random().toString(36).slice(2, 8);
        const md = s => { const p = s.split('-'); return `${+p[1]}/${+p[2]}`; };
        const net = pts[pts.length - 1].v - pts[0].v;
        const last = pts[pts.length - 1];
        return `<div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px">
                <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600">최근 30일 팔로워</span>
                <span style="font-size:0.78rem;font-weight:800">${this._igDelta(net)} <span style="font-weight:500;color:var(--text-muted);font-size:0.68rem">/ ${md(pts[0].t)}~${md(last.t)}</span></span>
            </div>
            <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" style="overflow:visible;display:block">
                <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/>
                </linearGradient></defs>
                <line x1="${padL}" y1="${(h - padB).toFixed(1)}" x2="${w - padR}" y2="${(h - padB).toFixed(1)}" stroke="var(--card-border)" stroke-width="1"/>
                <path d="${area}" fill="url(#${gid})"/>
                <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
                ${pts.map(p => `<circle cx="${px(p.t).toFixed(1)}" cy="${py(p.v).toFixed(1)}" r="1.9" fill="${color}"><title>${p.t} · ${p.v.toLocaleString()}명</title></circle>`).join('')}
                <circle cx="${px(last.t).toFixed(1)}" cy="${py(last.v).toFixed(1)}" r="4" fill="${color}" stroke="var(--bg-card, #fff)" stroke-width="1.6"/>
            </svg>
            <div style="display:flex;justify-content:space-between;font-size:0.63rem;color:var(--text-muted);margin-top:-12px">
                <span>${md(pts[0].t)} · ${pts[0].v.toLocaleString()}</span>
                <span>최고 ${maxY.toLocaleString()} / 최저 ${minY.toLocaleString()}</span>
                <span>${md(last.t)} · <b style="color:var(--text-main)">${last.v.toLocaleString()}</b></span>
            </div>
        </div>`;
    }

    // 주간 막대(게시물/스토리)
    _igBars(weeks, color) {
        if (!weeks.length) return `<div style="color:var(--text-muted);font-size:0.76rem;padding:10px 0">기록 없음</div>`;
        const max = Math.max(1, ...weeks.map(w => w.v));
        return `<div style="display:flex;align-items:flex-end;gap:6px;height:74px">${weeks.map(w => `
            <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;justify-content:flex-end;height:100%">
                <span style="font-size:0.66rem;font-weight:700;color:var(--text-main)">${w.v}</span>
                <div style="width:100%;background:${color};border-radius:4px 4px 0 0;height:${Math.max(4, w.v / max * 46).toFixed(0)}px"></div>
                <span style="font-size:0.6rem;color:var(--text-muted);white-space:nowrap">${w.label}</span>
            </div>`).join('')}</div>`;
    }

    // 메타 광고 운영현황 — 채널(브랜드)별 현재 돌아가는 광고 수. ad_status 테이블 기반(수동 갱신 시드).
    _adsBlock() {
        const rows = (this.adStatus || []).slice().sort((a, b) => (b.active_ads || 0) - (a.active_ads || 0));
        const esc = s => this._vesc ? this._vesc(s) : String(s ?? '');
        const totalActive = rows.reduce((s, r) => s + (r.active_ads || 0), 0);
        const updated = rows.length ? rows.map(r => r.updated_at).sort().slice(-1)[0] : null;
        const upTxt = updated ? new Date(updated).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
        this._adPops = this._adPops || {};
        const tiles = rows.map((r, i) => {
            const on = (r.active_ads || 0) > 0;
            const key = 'ad' + i;
            const names = Array.isArray(r.detail) ? r.detail : [];
            this._adPops[key] = { title: esc(r.brand) + ' 광고', rows: on
                ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">계정 ${esc(r.ad_account || '—')}</div>` + names.map(n => `<div style="padding:4px 0;border-top:1px solid var(--card-border);font-size:0.82rem"><span style="color:#dc2626">●</span> ${esc(n)}</div>`).join('')
                : `<div style="font-size:0.82rem;color:var(--text-muted)">현재 활성 광고 없음 (전부 일시중지 또는 미집행)</div>` };
            return `<div onclick="app._pop(event,'${key}',app._adPops)" style="flex:1;min-width:130px;cursor:pointer;text-align:center;padding:13px 8px;background:${on ? 'rgba(220,38,38,0.07)' : 'rgba(148,163,184,0.07)'};border:1px solid ${on ? 'rgba(220,38,38,0.25)' : 'var(--card-border)'};border-radius:12px">
                <div style="font-size:1.7rem;font-weight:900;line-height:1;color:${on ? '#dc2626' : 'var(--text-muted)'}">${r.active_ads || 0}</div>
                <div style="font-size:0.8rem;font-weight:700;margin-top:5px">${esc(r.brand)}</div>
                <div style="font-size:0.66rem;color:var(--text-muted);margin-top:2px">${on ? '광고 집행중' : '중지'}</div>
            </div>`;
        }).join('');
        return `<div class="glass" style="padding:1.3rem 1.4rem;border-radius:18px;margin-bottom:1.3rem">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:0.9rem">
                <div style="font-size:1.02rem;font-weight:800"><i class="ph ph-megaphone-simple"></i> 메타 광고 운영현황 <span style="font-size:0.82rem;color:var(--text-muted);font-weight:600">· 총 ${totalActive}개 집행중</span></div>
                <div style="font-size:0.7rem;color:var(--text-muted)">기준 ${upTxt}</div>
            </div>
            ${rows.length ? `<div style="display:flex;gap:10px;flex-wrap:wrap">${tiles}</div>` : `<div style="color:var(--text-muted);font-size:0.82rem">광고 데이터 없음</div>`}
            <p style="margin:0.85rem 2px 0;font-size:0.68rem;color:var(--text-muted)">* 채널(브랜드)별 현재 활성 광고 수. 카드를 누르면 광고 목록이 보여요. 수치는 요청 시 갱신됩니다.</p>
        </div>`;
    }

    renderSNS() {
        if (!this._igLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">SNS 데이터를 불러오는 중...</div>`;
        const allAccounts = this.igAccounts || [];
        const accSel = this.snsAcc || '전체';
        const accounts = accSel === '전체' ? allAccounts : allAccounts.filter(a => String(a.id) === String(accSel));
        const palette = ['#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'];
        const esc = s => this._vesc ? this._vesc(s) : String(s ?? '');
        const cards = accounts.map((a, idx) => {
            const color = palette[idx % palette.length];
            const snaps = (this.igSnapshots || []).filter(s => s.account_id === a.id).slice().sort((x, y) => (x.snap_date < y.snap_date ? -1 : 1));
            const followerPts = snaps.filter(s => s.followers != null).map(s => ({ t: s.snap_date, v: Number(s.followers) }));
            const cur = followerPts.length ? followerPts[followerPts.length - 1].v : null;
            const first = followerPts.length ? followerPts[0].v : null;
            const byWeek = {};
            snaps.forEach(s => { const k = this._igWeekKey(s.snap_date); (byWeek[k] || (byWeek[k] = { posts: 0, stories: 0 })); byWeek[k].posts += Number(s.posts_delta || 0); byWeek[k].stories += Number(s.stories_delta || 0); });
            const wlabel = k => { const [, m, d] = k.split('-'); return `${+m}/${+d}`; };
            const weekKeys = Object.keys(byWeek).sort().slice(-8);
            const postWeeks = weekKeys.map(k => ({ label: wlabel(k), v: byWeek[k].posts }));
            const storyWeeks = weekKeys.map(k => ({ label: wlabel(k), v: byWeek[k].stories }));
            // 주별 팔로워 순증감 = 그 주 마지막 팔로워값 - 직전 주 마지막값
            const weekFol = {}; snaps.forEach(s => { if (s.followers != null) weekFol[this._igWeekKey(s.snap_date)] = Number(s.followers); });
            const folAll = Object.keys(weekFol).sort();
            const folDeltaOf = k => { const i = folAll.indexOf(k); return i > 0 ? weekFol[k] - weekFol[folAll[i - 1]] : null; };
            const thisWk = this._igWeekKey(new Date().toISOString().slice(0, 10));
            const wkFol = folDeltaOf(thisWk), wkPosts = byWeek[thisWk] ? byWeek[thisWk].posts : 0;
            // 댓글·좋아요는 누적 합계(comments_total/likes_total)를 팔로워처럼 "그 주 마지막값 − 직전 주 마지막값"으로 증감 계산
            const wkEndVal = (field) => { const m = {}; snaps.forEach(s => { if (s[field] != null) m[this._igWeekKey(s.snap_date)] = Number(s[field]); }); const ks = Object.keys(m).sort(); const i = ks.indexOf(thisWk); return i > 0 ? m[thisWk] - m[ks[i - 1]] : null; };
            const wkComments = wkEndVal('comments_total'), wkLikes = wkEndVal('likes_total');
            // 주간 댓글·좋아요 증감 시리즈(누적값의 주별 차이) — 게시물 막대와 동일한 주간 관점
            const weekDeltaSeries = (field) => { const m = {}; snaps.forEach(s => { if (s[field] != null) m[this._igWeekKey(s.snap_date)] = Number(s[field]); }); const ks = Object.keys(m).sort(); return ks.map((k, i) => ({ label: wlabel(k), v: i > 0 ? m[k] - m[ks[i - 1]] : 0 })).slice(-8); };
            const commentWeeks = weekDeltaSeries('comments_total'), likeWeeks = weekDeltaSeries('likes_total');
            // 일별 증감(최근 7일): 연속 스냅샷 차이(팔로워·댓글·좋아요)
            const dailyRows = [];
            for (let i = snaps.length - 1; i >= 1 && dailyRows.length < 30; i--) {
                const cu = snaps[i], pv = snaps[i - 1];
                const d = (a, b) => (a != null && b != null) ? Number(a) - Number(b) : null;
                // 수집이 빠진 구간(예: 2026-09-03~14 시즌 차단)은 며칠치가 한 줄에 합쳐진다.
                // 그걸 하루치처럼 보여주면 수치를 오해하므로 며칠분인지 같이 표시한다.
                const gap = Math.round((new Date(cu.snap_date) - new Date(pv.snap_date)) / 86400000);
                dailyRows.push({ date: cu.snap_date, gap, from: pv.snap_date, f: d(cu.followers, pv.followers), c: d(cu.comments_total, pv.comments_total), l: d(cu.likes_total, pv.likes_total) });
            }
            const handle = a.username ? '@' + esc(String(a.username).replace(/^@/, '')) : '<span style="color:var(--text-muted)">핸들 미설정</span>';
            const wkTile = (label, v, signed) => { const inner = (v == null) ? '<span style="color:var(--text-muted)">—</span>' : signed ? this._igDelta(v) : `<span style="color:var(--text-main)">${v.toLocaleString()}</span>`; return `<div style="flex:1;text-align:center;padding:9px 4px;background:rgba(148,163,184,0.08);border-radius:10px"><div style="font-size:1.4rem;font-weight:900;line-height:1.05">${inner}</div><div style="font-size:0.64rem;color:var(--text-muted);margin-top:3px">${label}</div></div>`; };
            return `<div class="glass" style="padding:1.3rem 1.4rem;border-radius:18px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:0.9rem">
                    <div style="min-width:0;flex:1">
                        <div style="font-size:1.05rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(this._brandNameById(a.brand_id))}</div>
                        <div style="font-size:0.78rem;color:var(--text-muted)">${handle}</div>
                    </div>
                    <div style="display:flex;gap:6px;flex-shrink:0">
                        ${a.ig_business_id ? `<button onclick="app.igFeedPreview('${a.ig_business_id}','${esc(this._brandNameById(a.brand_id))}','${a.id}')" style="font-size:0.72rem;padding:6px 10px;border-radius:8px;border:1px solid var(--primary);background:rgba(99,102,241,0.1);color:var(--primary);cursor:pointer;font-weight:600;white-space:nowrap"><i class="ph ph-images-square"></i> 피드 미리보기</button>` : ''}
                        <button onclick="app.igSetHandle('${a.id}')" aria-label="계정 설정" title="계정(핸들) 설정" style="font-size:0.85rem;width:32px;height:32px;padding:0;border-radius:8px;border:1px solid var(--card-border);background:transparent;color:var(--text-muted);cursor:pointer;flex-shrink:0"><i class="ph ph-gear"></i></button>
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 14px;background:rgba(59,130,246,0.06);border-radius:12px;margin-bottom:0.9rem">
                    <div style="display:flex;align-items:baseline;gap:8px">
                        <span style="font-size:0.74rem;color:var(--text-muted);font-weight:600">팔로워</span>
                        <span style="font-size:1.55rem;font-weight:900;color:#3b82f6;line-height:1;font-variant-numeric:tabular-nums">${cur != null ? cur.toLocaleString() : '—'}</span>
                    </div>
                    <div style="text-align:right">
                        <div style="font-size:1.1rem;font-weight:900;line-height:1">${(dailyRows[0] && dailyRows[0].f != null) ? this._igDelta(dailyRows[0].f) : '<span style="color:var(--text-muted);font-size:0.9rem">—</span>'}</div>
                        <div style="font-size:0.6rem;color:var(--text-muted);margin-top:3px">전일 대비</div>
                    </div>
                </div>
                <div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:5px;font-weight:600">이번주 증감</div>
                <div style="display:flex;gap:8px;margin-bottom:0.9rem">
                    ${wkTile('팔로워 순증감', wkFol, true)}${wkTile('게시물', wkPosts, false)}${wkTile('댓글', wkComments, true)}${wkTile('좋아요', wkLikes, true)}
                </div>
                ${this._igFollowerChart(followerPts, '#3b82f6', 30)}
                <div style="margin-top:0.9rem">
                    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:5px;font-weight:600">일별 증감 <span style="font-weight:400">(최근 ${dailyRows.length}일)</span></div>
                    <div style="max-height:236px;overflow-y:auto;scrollbar-width:thin">
                    <table class="mtbl" style="width:100%;border-collapse:collapse;font-size:0.75rem">
                        <thead><tr style="color:var(--text-muted)"><th style="text-align:left;font-weight:600">날짜</th><th style="text-align:right;font-weight:600">팔로워</th><th style="text-align:right;font-weight:600">댓글</th><th style="text-align:right;font-weight:600">좋아요</th></tr></thead>
                        <tbody>${dailyRows.length ? dailyRows.map(r => {
                            const cell = v => this._igDelta(v);
                            const p = r.date.split('-');
                            const fp = (r.from || '').split('-');
                            const label = r.gap > 1
                                ? `${+fp[1]}/${+fp[2]}~${+p[1]}/${+p[2]} <span style="font-size:0.62rem;color:#f59e0b">${r.gap}일치</span>`
                                : `${+p[1]}/${+p[2]}`;
                            return `<tr style="border-top:1px solid var(--card-border)"><td style="color:var(--text-muted);white-space:nowrap">${label}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${cell(r.f)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${cell(r.c)}</td><td style="text-align:right;font-variant-numeric:tabular-nums">${cell(r.l)}</td></tr>`;
                        }).join('') : '<tr><td colspan="4" style="color:var(--text-muted);text-align:center">데이터 쌓이는 중 (내일부터 일별 증감 표시)</td></tr>'}</tbody>
                    </table>
                    </div>
                </div>
            </div>`;
        }).join('');
        return `<div class="mp">
            ${this._mpTop('SNS 운영현황', '브랜드별 팔로워 추이 · 주간 게시물 · 댓글/좋아요')}
            <div class="mp-body">
            ${this._adsBlock()}
            ${accounts.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1.3rem">${cards}</div>` : `<div class="glass" style="padding:2rem;border-radius:16px;color:var(--text-muted)">등록된 인스타 계정이 없습니다.</div>`}
            <p style="margin:1.1rem 2px 0;font-size:0.72rem;color:var(--text-muted)">* 팔로워·게시물·댓글·좋아요는 메타 API로 매일 자동수집됩니다. 주간 증감은 2주치가 쌓이면 표시돼요. (스토리는 API로 소급 불가라 보류)</p>
        </div></div>`;
    }

    // 인스타 피드 톤앤매너 미리보기 — 실제 인스타 프로필 화면 그대로.
    //  프로필(이름·소개·프로필사진·팔로워/팔로잉/게시물)은 Graph API 실값을 쓴다(지어내지 않는다).
    //  격자는 인스타 현행과 같은 4:5 세로 비율, 간격 2px. 대시보드 테마에 맞춰 라이트/다크 둘 다.
    async igFeedPreview(igId, brand, accountId) {
        if (!igId) { this.showToast('먼저 계정 연동이 필요해요'); return; }
        const c = document.getElementById('global-modal-container'); if (!c) return;
        this._feedCoverUrl = null; this._feedItems = []; this._feedProfile = null; this._feedError = null;
        const acc = (this.igAccounts || []).find(x => x.id === accountId) || {};
        this._feedFallback = { username: (acc.username || '').replace(/^@/, ''), brand };
        this._renderFeedModal();
        c.style.display = 'flex';
        try {
            const { data, error } = await this.supabase.functions.invoke('ig-feed', { body: { ig_business_id: igId, limit: 17 } });
            if (error) throw error;
            if (!data?.ok) throw new Error(data?.error || '불러오기 실패');
            this._feedItems = data.items || [];
            this._feedProfile = data.profile || null;
            this._renderFeedModal();
        } catch (e) {
            this._feedError = String(e?.message || e);
            this._renderFeedModal();
        }
    }
    _igTheme() {
        const light = document.body.classList.contains('light');
        return light
            ? { bg: '#fff', fg: '#000', sub: '#737373', line: '#dbdbdb', btn: '#efefef', ph: '#efefef', link: '#0095f6' }
            : { bg: '#000', fg: '#fff', sub: '#a8a8a8', line: '#262626', btn: '#363636', ph: '#1a1a1a', link: '#0095f6' };
    }
    _renderFeedModal() {
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const t = this._igTheme(), esc = s => this._vesc(s);
        const p = this._feedProfile || {};
        const fb = this._feedFallback || {};
        const handle = (p.username || fb.username || '').replace(/^@/, '');
        const nf = n => (n == null ? '—' : (n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '만' : Number(n).toLocaleString()));
        const bio = (p.biography || '').split('\n').map(l => esc(l)).join('<br>');
        c.innerHTML = `<div class="fade-in" style="width:94%;max-width:430px;max-height:92vh;overflow-y:auto;background:${t.bg};color:${t.fg};border-radius:16px;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;box-shadow:0 24px 64px rgba(0,0,0,.45)">
            <div style="display:flex;align-items:center;gap:14px;padding:12px 14px;border-bottom:1px solid ${t.line};position:sticky;top:0;background:${t.bg};z-index:2">
                <button onclick="app.closeGlobalModal()" style="border:0;background:transparent;font-size:1.15rem;cursor:pointer;color:${t.fg};line-height:1;padding:0">←</button>
                <b style="font-size:1rem;flex:1">${esc(handle) || '계정'}</b>
                <label style="font-size:.78rem;font-weight:700;color:${t.link};cursor:pointer">커버 올리기<input type="file" accept="image/*" onchange="app._feedSetCover(event)" style="display:none"></label>
            </div>
            <div style="padding:16px 16px 0">
                <div style="display:flex;align-items:center;gap:22px">
                    <div style="width:80px;height:80px;border-radius:50%;flex:0 0 auto;background:linear-gradient(45deg,#f09433,#dc2743,#bc1888);padding:2.5px">
                        <div style="width:100%;height:100%;border-radius:50%;background:${t.bg};padding:2px;box-sizing:border-box">
                            <div style="width:100%;height:100%;border-radius:50%;background:${t.ph} ${p.profile_picture_url ? `url('${p.profile_picture_url}') center/cover no-repeat` : ''}"></div>
                        </div>
                    </div>
                    <div style="display:flex;flex:1;text-align:center">
                        <div style="flex:1"><div style="font-weight:700;font-size:1rem">${nf(p.media_count)}</div><div style="font-size:.82rem">게시물</div></div>
                        <div style="flex:1"><div style="font-weight:700;font-size:1rem">${nf(p.followers_count)}</div><div style="font-size:.82rem">팔로워</div></div>
                        <div style="flex:1"><div style="font-weight:700;font-size:1rem">${nf(p.follows_count)}</div><div style="font-size:.82rem">팔로잉</div></div>
                    </div>
                </div>
                ${p.name ? `<div style="margin-top:12px;font-size:.86rem;font-weight:600">${esc(p.name)}</div>` : ''}
                ${bio ? `<div style="font-size:.86rem;line-height:1.45;margin-top:2px">${bio}</div>` : ''}
                ${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noreferrer" style="font-size:.86rem;color:${t.link};text-decoration:none">${esc(String(p.website).replace(/^https?:\/\//, ''))}</a>` : ''}
                <div style="display:flex;gap:6px;margin:14px 0 4px">
                    <button style="flex:1;border:0;background:${t.btn};border-radius:8px;padding:7px 0;font-size:.82rem;font-weight:700;color:${t.fg};cursor:default">프로필 편집</button>
                    <button style="flex:1;border:0;background:${t.btn};border-radius:8px;padding:7px 0;font-size:.82rem;font-weight:700;color:${t.fg};cursor:default">프로필 공유</button>
                </div>
            </div>
            <div style="display:flex;border-top:1px solid ${t.line};margin-top:12px">
                <div style="flex:1;text-align:center;padding:11px 0;border-bottom:1.5px solid ${t.fg};font-size:1.05rem">▦</div>
                <div style="flex:1;text-align:center;padding:11px 0;color:${t.sub};font-size:1.05rem">▷</div>
                <div style="flex:1;text-align:center;padding:11px 0;color:${t.sub};font-size:1.05rem">☺</div>
            </div>
            <div id="ig-feed-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;background:${t.bg}"></div>
            <p style="margin:0;padding:12px 16px 16px;font-size:.7rem;color:${t.sub};line-height:1.5">
                실제 계정의 최근 게시물 위에 새 커버를 얹어 봅니다. 미리보기 전용이라 인스타엔 올라가지 않아요.
            </p>
        </div>`;
        this._renderFeedGrid();
    }
    _renderFeedGrid() {
        const g = document.getElementById('ig-feed-grid'); if (!g) return;
        const t = this._igTheme();
        if (this._feedError) { g.innerHTML = `<div style="grid-column:1/-1;padding:1.5rem;text-align:center;color:#ed4956;font-size:.82rem">피드 로드 실패: ${this._vesc(this._feedError)}</div>`; return; }
        if (!this._feedItems.length && !this._feedCoverUrl) { g.innerHTML = `<div style="grid-column:1/-1;padding:2.5rem;text-align:center;color:${t.sub};font-size:.85rem">피드 불러오는 중…</div>`; return; }
        // 인스타 프로필 격자는 4:5 세로 비율(정사각형 아님) — 실제로 잘리는 범위가 그대로 보이게 맞춘다.
        const cell = (src, isCover) => `<div style="position:relative;aspect-ratio:4/5;background:${t.ph};overflow:hidden">
            ${src ? `<img src="${src}" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;display:block">`
                : (isCover ? `<div style="width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:${t.sub};font-size:.72rem;gap:4px"><span style="font-size:1.3rem">＋</span>커버 올리기</div>` : '')}
            ${isCover && src ? '<div style="position:absolute;top:5px;left:5px;background:rgba(0,0,0,.72);color:#fff;font-size:.56rem;font-weight:700;padding:2px 6px;border-radius:4px">새 커버</div>' : ''}
        </div>`;
        g.innerHTML = cell(this._feedCoverUrl, true) + (this._feedItems || []).map(it => cell(it.thumb, false)).join('');
    }
    _feedSetCover(ev) {
        const f = ev.target.files && ev.target.files[0]; if (!f) return;
        if (this._feedCoverUrl) { try { URL.revokeObjectURL(this._feedCoverUrl); } catch (_e) {} }
        this._feedCoverUrl = URL.createObjectURL(f);
        this._renderFeedGrid();
    }

    async igSetHandle(accountId) {
        const a = (this.igAccounts || []).find(x => x.id === accountId); if (!a) return;
        const v = await this.showPrompt('인스타 핸들(@아이디)을 입력하세요', a.username || '');
        if (v === null) return;
        this.supabase.from('ig_accounts').update({ username: v.trim().replace(/^@/, '') || null, updated_at: new Date().toISOString() }).eq('id', accountId)
            .then(({ error }) => { if (error) this.showToast('저장 실패: ' + error.message); else { this._igLoaded = false; this.loadIG(); } });
    }

    async igAddSnapshot(accountId) {
        const ymd = new Date().toISOString().slice(0, 10);
        const dateStr = await this.showPrompt('기록 날짜 (YYYY-MM-DD)', ymd); if (dateStr === null) return;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) { this.showToast('날짜 형식은 YYYY-MM-DD 예: ' + ymd); return; }
        const f = await this.showPrompt('현재 팔로워 수', ''); if (f === null) return;
        const p = await this.showPrompt('직전 기록 이후 올린 게시물 수', '0'); if (p === null) return;
        const s = await this.showPrompt('직전 기록 이후 올린 스토리 수', '0'); if (s === null) return;
        const row = {
            account_id: accountId,
            snap_date: dateStr.trim(),
            followers: f.trim() === '' ? null : (parseInt(f, 10) || 0),
            posts_delta: parseInt(p, 10) || 0,
            stories_delta: parseInt(s, 10) || 0,
            source: 'manual',
        };
        this.supabase.from('ig_snapshots').upsert(row, { onConflict: 'account_id,snap_date' })
            .then(({ error }) => { if (error) this.showToast('저장 실패: ' + error.message); else { this._igLoaded = false; this.loadIG(); this.showToast('기록됨'); } });
    }

    // 홈 대시보드용 컴팩트 인스타 요약 (브랜드별 팔로워 + 미니 추이 + 이번주 게시물)
    _igHomeSummary() {
        if (!this._igLoaded) return `<div style="color:var(--text-muted);font-size:0.82rem;padding:0.6rem 0.2rem">SNS 불러오는 중...</div>`;
        const accounts = this.igAccounts || [];
        if (!accounts.length) return `<div style="color:var(--text-muted);font-size:0.82rem;padding:0.6rem 0.2rem">등록된 인스타 계정이 없습니다.</div>`;
        const palette = ['#ec4899', '#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'];
        const esc = s => this._vesc ? this._vesc(s) : String(s ?? '');
        const todayWk = this._igWeekKey(new Date().toISOString().slice(0, 10));
        const cards = accounts.map((a, idx) => {
            const color = palette[idx % palette.length];
            const snaps = (this.igSnapshots || []).filter(s => s.account_id === a.id).slice().sort((x, y) => (x.snap_date < y.snap_date ? -1 : 1));
            const fpts = snaps.filter(s => s.followers != null).map(s => ({ t: s.snap_date, v: Number(s.followers) }));
            const cur = fpts.length ? fpts[fpts.length - 1].v : null;
            // 이번주 팔로워 순증감 = 이번주 마지막 팔로워값 - 지난주 마지막값
            const weekFol = {}; snaps.forEach(s => { if (s.followers != null) weekFol[this._igWeekKey(s.snap_date)] = Number(s.followers); });
            const folWks = Object.keys(weekFol).sort();
            const wi = folWks.indexOf(todayWk);
            const wkFol = wi > 0 ? weekFol[todayWk] - weekFol[folWks[wi - 1]] : null;
            const thisWkSnaps = snaps.filter(s => this._igWeekKey(s.snap_date) === todayWk);
            const wkPosts = thisWkSnaps.reduce((n, s) => n + Number(s.posts_delta || 0), 0);
            const wkEndVal = (field) => { const m = {}; snaps.forEach(s => { if (s[field] != null) m[this._igWeekKey(s.snap_date)] = Number(s[field]); }); const ks = Object.keys(m).sort(); const i = ks.indexOf(todayWk); return i > 0 ? m[todayWk] - m[ks[i - 1]] : null; };
            const wkComments = wkEndVal('comments_total'), wkLikes = wkEndVal('likes_total');
            const sgn = (v) => v == null ? '—' : (v > 0 ? '+' : '') + v.toLocaleString();
            const folTxt = wkFol == null ? '—' : (wkFol > 0 ? '+' : '') + wkFol.toLocaleString();
            const folCol = wkFol == null ? 'var(--text-muted)' : wkFol > 0 ? '#10b981' : wkFol < 0 ? '#ef4444' : 'var(--text-main)';
            const snsKey = 'sns_' + idx;
            const bname = esc(this._brandNameById(a.brand_id));
            const rowP = (l, v) => `<div style="display:flex;justify-content:space-between;gap:16px;padding:3px 0"><span style="color:var(--text-muted)">${l}</span><b style="font-variant-numeric:tabular-nums">${v}</b></div>`;
            (this._homePops = this._homePops || {})[snsKey] = { title: bname + ' · 인스타', rows:
                rowP('핸들', a.username ? '@' + esc(String(a.username).replace(/^@/, '')) : '미설정') +
                rowP('팔로워', cur != null ? cur.toLocaleString() : '—') +
                rowP('이번주 순증감', folTxt) +
                rowP('이번주 게시물', wkPosts) +
                rowP('이번주 댓글', sgn(wkComments)) +
                rowP('이번주 좋아요', sgn(wkLikes)),
                link: { label: 'SNS 탭', action: "app.switchView('sns')" } };
            return `<div class="glass" style="padding:0.9rem 1rem;border-radius:14px;cursor:pointer" onclick="app.switchView('sns')">
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:6px">
                    <span style="font-size:0.85rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(this._brandNameById(a.brand_id))}</span>
                    <span style="font-size:0.62rem;color:var(--text-muted)">팔로워 ${cur != null ? cur.toLocaleString() : '—'}</span>
                </div>
                <div style="display:flex;align-items:baseline;gap:6px;margin:5px 0 4px">
                    <span style="font-size:1.35rem;font-weight:900">${this._igDelta(wkFol)}</span>
                    <span style="font-size:0.64rem;color:var(--text-muted)">이번주 팔로워</span>
                </div>
                <div style="display:flex;gap:10px;font-size:0.66rem;color:var(--text-muted);flex-wrap:wrap">
                    <span>게시물 <b style="color:var(--text-main)">${wkPosts}</b></span>
                    <span>댓글 <b>${this._igDelta(wkComments)}</b></span>
                    <span>좋아요 <b>${this._igDelta(wkLikes)}</b></span>
                </div>
                ${this._igSpark(fpts, '#3b82f6', 220, 30)}
            </div>`;
        }).join('');
        return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:0.9rem">${cards}</div>`;
    }

    // ============================================================
    //  공용: 뷰 진입 시 데이터 lazy-load 디스패처
    // ============================================================
    ensureViewData() {
        const v = this.currentView;
        if ((v === 'orders' || v === 'inventory' || v === 'integrations' || v === 'sales' || v === 'analysis') && !this._mallsLoaded && !this._mallsLoading) this.loadMalls();
        // 분석 탭: 선택 브랜드+연도의 주문 아이템(옵션) 로드 → 고객군 집계
        if (v === 'analysis' && this._mallsLoaded) {
            const names = this._analysisBrandNames();
            const bf = (this.analysisBrand && names.includes(this.analysisBrand)) ? this.analysisBrand : (names[0] || null);
            const r = this._analysisRange();
            const from = r.from || '2000-01-01';
            const to = r.to || new Date(Date.now() + 864e5).toISOString().slice(0, 10);
            if (bf) { this._loadAnalysisScope(bf, from, to); this._loadAnalysisRepeat(bf, from, to); }
        }
        if (v === 'feedback' && !this._fbLoaded && !this._fbLoading) this.loadFeedback();
        if ((v === 'cs' || v === 'orders') && !this._csLoaded && !this._csLoading) this.loadCS();
        if (v === 'reminders' && !this._noteLoaded && !this._noteLoading) this.loadNotes();
        if (v === 'notes' && !this._noteLoaded && !this._noteLoading) this.loadNotes();
        if (v === 'reminders' && !this._remLoaded && !this._remLoading) this.loadReminders();
        if ((v === 'expenses' || v === 'sales') && !this._expLoaded && !this._expLoading) this.loadExpenses();
        if (v === 'tech_packs') this.ensureTechPacks();
        // 자료실은 작업지시서·견적까지 한 곳에 모아 보여준다
        if (v === 'documents') {
            this.ensureTechPacks();
            if (!this._quotesLoaded && !this._quotesLoading) this.loadQuotes();
            if (!this._itemsLoaded && !this._itemsLoading) this.loadItems();
        }
        if ((v === 'tech_packs' || v === 'vendors' || v === 'dashboard') && !this._itemsLoaded && !this._itemsLoading) this.loadItems();
        if (v === 'items') {
            if (!this._itemsLoaded && !this._itemsLoading) this.loadItems();
            if (!this._ordersLoaded && !this._ordersLoading) this.loadOrders();
            if (!this._vendorsLoaded && !this._vendorsLoading) this.loadVendors();
            if (!this._quotesLoaded && !this._quotesLoading) this.loadQuotes();
            this.ensureTechPacks();
        }
        if (v === 'sales' && !this._ordersLoaded && !this._ordersLoading) this.loadOrders();
        if (v === 'sales' && !this._quotesLoaded && !this._quotesLoading) this.loadQuotes();
        // 브랜드 상세는 상품·옵션·재구매·반품 카드용으로 그 브랜드+기간 주문만 따로 받아온다
        if (v === 'sales' && this._ordersLoaded && this._mallsLoaded && this.salesViewBrand && this.salesViewBrand !== 'ALL') {
            const r = this._salesScopeRange();
            if (r) this._loadSalesScope(this.salesViewBrand, r.from, r.to);
        }
        if (v === 'integrations' && !this._bsLoaded && !this._bsLoading) this.loadBrandSettings();
        if (v === 'integrations' && !this._ordersLoaded && !this._ordersLoading) this.loadOrders();  // 채널 수집 실태 팩트 판정용
        if (v === 'orders' && !this._ordersLoaded && !this._ordersLoading) this.loadOrders();
        if (v === 'inventory' && !this._invLoaded && !this._invLoading) this.loadInventory();
        if (v === 'inventory' && (this.inventoryTab || 'finished') === 'materials' && !this._materialsLoaded && !this._materialsLoading) this.loadMaterials();
        if (v === 'inventory' && !this._ordersLoaded && !this._ordersLoading) this.loadOrders();
        if (v === 'pages' && !this._pagesLoaded && !this._pagesLoading) this.loadPages();
        if ((v === 'kanban' || v === 'table' || v === 'calendar') && !this._cardsLoaded && !this._cardsLoading) this.loadCards();
        if ((v === 'vendors' || v === 'contacts' || v === 'inventory') && !this._vendorsLoaded && !this._vendorsLoading) this.loadVendors();
        if (v === 'news' && !this._newsLoaded && !this._newsLoading) this.loadNews();
        if (v === 'vendors' && !this._invLoaded && !this._invLoading) this.loadInventory();
        if (v === 'sns' && !this._igLoaded && !this._igLoading) this.loadIG();
        if ((v === 'quotes' || v === 'vendors') && !this._quotesLoaded && !this._quotesLoading) this.loadQuotes();
        if (v === 'quotes' && !this._itemsLoaded && !this._itemsLoading) this.loadItems();
        if (v === 'home') {
            if (!this._ordersLoaded && !this._ordersLoading) this.loadOrders();
            if (!this._quotesLoaded && !this._quotesLoading) this.loadQuotes();
            if (!this._vendorsLoaded && !this._vendorsLoading) this.loadVendors();
            if (!this._mallsLoaded && !this._mallsLoading) this.loadMalls();
            if (!this._igLoaded && !this._igLoading) this.loadIG();
        }
    }

    _actor() { return this.currentUser?.username || this.currentUser?.name || 'system'; }
    _brandNameById(id) { const b = (mockData.brands || []).find(b => b.id === id); return b ? b.name : '-'; }
    _brandOptions(selected) {
        return `<option value="" style="background:#0f172a">브랜드 없음</option>` +
            (mockData.brands || []).map(b => `<option value="${b.id}" style="background:#0f172a" ${b.id === selected ? 'selected' : ''}>${b.name}</option>`).join('');
    }
    closeGlobalModal() { const c = document.getElementById('global-modal-container'); if (c) { c.style.display = 'none'; c.innerHTML = ''; } }

    // ── 불편사항 접수(직원용) ──────────────────────────────────
    openFeedbackModal() {
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const cats = ['버그', '개선요청', '불편', '기타'];
        this._fbCat = '버그';
        c.innerHTML = `<div class="glass modal-content fade-in vmodal" style="width:94%;max-width:460px;padding:1.6rem;border-radius:20px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:0.3rem">
                <div><h2 style="margin:0;font-size:1.2rem"><i class="ph ph-chat-dots"></i> 불편사항 접수</h2><p style="margin:5px 0 0;color:var(--text-muted);font-size:0.82rem">불편한 점·버그·개선 아이디어를 남겨주세요. 대표가 확인합니다.</p></div>
                <button onclick="app.closeGlobalModal()" style="border:0;background:transparent;color:var(--text-muted);font-size:1.4rem;cursor:pointer;line-height:1">×</button>
            </div>
            <div style="margin:1.1rem 0 0.4rem;font-size:0.78rem;color:var(--text-muted);font-weight:600">종류</div>
            <div id="fb-cats" style="display:flex;gap:6px;flex-wrap:wrap">
                ${cats.map((c2, i) => `<button type="button" class="fb-cat" data-cat="${c2}" style="padding:7px 14px;border-radius:9px;border:1px solid ${i === 0 ? 'var(--primary)' : 'var(--card-border)'};background:${i === 0 ? 'rgba(99,102,241,0.12)' : 'transparent'};color:${i === 0 ? 'var(--primary)' : 'var(--text-main)'};font-size:0.82rem;font-weight:700;cursor:pointer">${c2}</button>`).join('')}
            </div>
            <div style="margin:1.1rem 0 0.4rem;font-size:0.78rem;color:var(--text-muted);font-weight:600">내용</div>
            <textarea id="fb-message" rows="5" placeholder="어디서 무엇이 불편했는지 구체적으로 적어주세요" style="width:100%;box-sizing:border-box;padding:11px 13px;border-radius:11px;border:1px solid var(--card-border);background:transparent;color:var(--text-main);font-size:0.9rem;resize:vertical"></textarea>
            <div id="fb-error" style="color:#ef4444;font-size:0.78rem;margin-top:6px;display:none"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:1.1rem">
                <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 16px;border-radius:10px">취소</button>
                <button onclick="app.submitFeedback()" class="btn-primary" style="padding:9px 18px;border-radius:10px"><i class="ph ph-paper-plane-tilt"></i> 접수</button>
            </div>
            <p style="margin:0.8rem 2px 0;font-size:0.68rem;color:var(--text-muted)">* 현재 화면(${this._vesc(this.currentView || '')})과 작성자(${this._vesc(this.currentUser?.name || '')})가 함께 기록됩니다.</p>
        </div>`;
        c.style.display = 'flex';
        c.querySelectorAll('.fb-cat').forEach(btn => btn.onclick = () => {
            this._fbCat = btn.dataset.cat;
            c.querySelectorAll('.fb-cat').forEach(b => { const on = b === btn; b.style.borderColor = on ? 'var(--primary)' : 'var(--card-border)'; b.style.background = on ? 'rgba(99,102,241,0.12)' : 'transparent'; b.style.color = on ? 'var(--primary)' : 'var(--text-main)'; });
        });
    }
    async submitFeedback() {
        const ta = document.getElementById('fb-message'), err = document.getElementById('fb-error');
        const msg = (ta?.value || '').trim();
        if (!msg) { if (err) { err.textContent = '내용을 입력해주세요'; err.style.display = 'block'; } return; }
        try {
            const { error } = await this.supabase.from('feedback').insert([{
                author_email: this.currentUser?.email || null,
                author_name: this.currentUser?.name || null,
                category: this._fbCat || '기타',
                page: this.currentView || null,
                message: msg,
            }]);
            if (error) throw error;
            this.closeGlobalModal();
            this.showToast('불편사항이 접수되었습니다. 감사합니다!');
        } catch (e) { if (err) { err.textContent = '접수 실패: ' + (e.message || e); err.style.display = 'block'; } }
    }



    // ── 계산기 (맥 계산기) — 어느 화면에서든 띄우는 창 ─────────
    openCalc() {
        if (document.getElementById('calc-pop')) { document.getElementById('calc-pop').remove(); return; }
        const el = document.createElement('div');
        el.className = 'calcpop lg'; el.id = 'calc-pop';
        el.style.left = Math.max(8, Math.min(window.innerWidth - 256, window.innerWidth - 300)) + 'px';
        el.style.top = Math.max(8, Math.min(96, window.innerHeight - 360)) + 'px';
        const keys = [['AC','fn','ac'],['+/−','fn','neg'],['%','fn','pct'],['÷','op','/'],
                      ['7','','7'],['8','','8'],['9','','9'],['×','op','*'],
                      ['4','','4'],['5','','5'],['6','','6'],['−','op','-'],
                      ['1','','1'],['2','','2'],['3','','3'],['+','op','+'],
                      ['0','zero','0'],['.','','.'],['=','op','=']];
        el.innerHTML = `<div class="cp-bar"><button class="cp-l" title="닫기"></button><span class="cp-t">계산기</span><span style="width:11px"></span></div>
            <div class="cp-disp" id="cp-disp">0</div>
            <div class="cp-keys">${keys.map(([t,c,k]) => `<button class="${c}" data-k="${k}">${t}</button>`).join('')}</div>`;
        document.body.appendChild(el);
        el.querySelector('.cp-l').onclick = () => { document.removeEventListener('keydown', onKey); el.remove(); };
        this._dragWin(el, el.querySelector('.cp-bar'));
        const st = { cur: '0', prev: null, op: null, fresh: true };
        const disp = el.querySelector('#cp-disp');
        const show = () => { const n = Number(st.cur); disp.textContent = isFinite(n) ? n.toLocaleString('ko-KR', { maximumFractionDigits: 8 }) : st.cur; };
        const calc = () => {
            const a = Number(st.prev), b = Number(st.cur);
            const r = st.op === '+' ? a + b : st.op === '-' ? a - b : st.op === '*' ? a * b : (b === 0 ? NaN : a / b);
            st.cur = String(r); st.prev = null; st.op = null; st.fresh = true;
        };
        el.querySelectorAll('.cp-keys button').forEach(b => b.onclick = () => {
            const k = b.dataset.k;
            el.querySelectorAll('.op').forEach(o => o.classList.remove('sel'));
            if (/^[0-9]$/.test(k)) { st.cur = (st.fresh || st.cur === '0') ? k : st.cur + k; st.fresh = false; }
            else if (k === '.') { if (!st.cur.includes('.')) { st.cur = st.fresh ? '0.' : st.cur + '.'; st.fresh = false; } }
            else if (k === 'ac') { st.cur = '0'; st.prev = null; st.op = null; st.fresh = true; }
            else if (k === 'neg') st.cur = String(-Number(st.cur));
            else if (k === 'pct') st.cur = String(Number(st.cur) / 100);
            else if (k === '=') { if (st.op != null && st.prev != null) calc(); }
            else { if (st.op != null && st.prev != null && !st.fresh) calc(); st.prev = st.cur; st.op = k; st.fresh = true; b.classList.add('sel'); }
            show();
        });
        // 키보드로도 두드린다 — 숫자·연산자·Enter(=)·Esc(닫기)·Backspace(한 글자 지우기)
        const onKey = (e) => {
            if (!document.body.contains(el)) { document.removeEventListener('keydown', onKey); return; }
            const tag = (document.activeElement && document.activeElement.tagName) || '';
            if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
            const map = { Enter: '=', '=': '=', Escape: 'ac', Delete: 'ac', '*': '*', 'x': '*', '/': '/', '+': '+', '-': '-', '.': '.', '%': 'pct' };
            let k = /^[0-9]$/.test(e.key) ? e.key : map[e.key];
            if (e.key === 'Backspace') {
                e.preventDefault();
                st.cur = st.cur.length > 1 ? st.cur.slice(0, -1) : '0';
                if (st.cur === '-' || st.cur === '') st.cur = '0';
                show(); return;
            }
            if (!k) return;
            e.preventDefault();
            const btn = el.querySelector(`.cp-keys button[data-k="${k === '=' ? '=' : k}"]`);
            if (btn) btn.click();
        };
        document.addEventListener('keydown', onKey);
        show();
    }
    // ── 스티커 메모 (맥 Stickies) — notes 테이블 '스티커' 폴더에 저장 ──
    //  DB가 막혀도(권한·네트워크) 스티커는 바로 뜬다. 저장만 이 기기(localStorage)로 내려간다.
    // 로그인한 계정 — DB의 current_username() 과 같은 규칙(이메일 @ 앞부분)
    _me() {
        const em = this.currentUser?.email || '';
        return em.includes('@') ? em.split('@')[0] : (this.currentUser?.username || this.currentUser?.name || '');
    }
    // 기기 저장분도 계정별로 나눈다 — 한 컴퓨터를 같이 써도 남의 스티커가 안 보이게
    _stickyKey() { return 'bhas_stickies:' + (this._me() || 'anon'); }
    _localStickies(next) {
        const k = this._stickyKey();
        if (next !== undefined) { try { localStorage.setItem(k, JSON.stringify(next)); } catch (_e) {} return next; }
        try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (_e) { return []; }
    }
    _saveLocalSticky(rec) {
        const list = this._localStickies().filter(x => String(x.id) !== String(rec.id));
        list.push(rec); this._localStickies(list.slice(-20));
    }
    _dropLocalSticky(id) {
        this._localStickies(this._localStickies().filter(x => String(x.id) !== String(id)));
    }
    // 스티커 색 = 누가 보나. 따뜻한 3색은 나만, 시원한 3색은 모두가 본다.
    ST_COLORS = {
        private: ['#fff5a5', '#ffd8e4', '#e7dcff'],
        shared:  ['#d3f2ff', '#d9f7d0', '#ccf5ec'],
    };
    _rgb(hex) {
        const h = hex.replace('#', '');
        return `rgb(${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)})`;
    }
    _scopeOfColor(c) {
        if (!c) return 'private';
        const v = String(c).trim();
        const hit = (arr) => arr.some(h => h === v || this._rgb(h) === v);
        return hit(this.ST_COLORS.shared) ? 'shared' : 'private';
    }
    addSticky(row) {
        const colors = [...this.ST_COLORS.private, ...this.ST_COLORS.shared];
        const rec = row || {};
        const idx = document.querySelectorAll('.sticky').length;
        if (rec.id && document.querySelector(`.sticky[data-id="${rec.id}"]`)) return null; // 두 번 띄우지 않는다
        const el = document.createElement('div');
        el.className = 'sticky';
        el.dataset.id = rec.id || '';
        el.dataset.local = rec.local ? '1' : '';
        el.dataset.owner = rec.owner || '';
        const startColor = rec.color || this.ST_COLORS.private[idx % 3];
        el.dataset.scope = rec.scope || this._scopeOfColor(startColor);
        el.style.background = startColor;
        el.style.left = (rec.x != null ? rec.x : Math.min(140 + idx * 26, Math.max(8, window.innerWidth - 250))) + 'px';
        el.style.top = (rec.y != null ? rec.y : 130 + idx * 24) + 'px';
        el.style.width = (rec.w || 230) + 'px';
        el.style.height = (rec.h || 200) + 'px';
        el.innerHTML = `<div class="st-bar">
                <button class="st-x" title="치우기 — 기록은 남습니다"></button>
                <button class="st-plus" title="새 스티커"></button>
                <span class="st-title"></span>
                <button class="st-swatch" title="색 고르기"></button>
            </div>
            <textarea placeholder="메모를 적어주세요">${this._vesc(rec.body || '')}</textarea>
            <div class="st-ft">자동 저장됨</div>
            <span class="st-grip" title="크기 조절"></span>`;
        document.body.appendChild(el);
        this._dragWin(el, el.querySelector('.st-bar'));
        const ft = el.querySelector('.st-ft');
        const ta = el.querySelector('textarea');
        const title = el.querySelector('.st-title');
        const sw = el.querySelector('.st-swatch');
        const label = (tail) => {
            const shared = el.dataset.scope === 'shared';
            const nm = this._labelOf(el.dataset.color || el.style.background);
            title.textContent = nm ? `${nm} · ${shared ? '공용' : '개인'}` : (shared ? '공용' : '개인');
            el.classList.toggle('shared', shared);
            sw.style.background = el.dataset.color || el.style.background;
            if (tail) ft.dataset.tail = tail;
            ft.textContent = ft.dataset.tail || '자동 저장됨';
        };
        // X 는 화면에서 치울 뿐이다. 기록은 남아서 목록(독의 스티커)에서 다시 꺼낼 수 있다.
        el.querySelector('.st-x').onclick = () => { el.remove(); this._syncStickyList(); };
        el.querySelector('.st-plus').onclick = () => this.addSticky();
        let t = null;
        el.querySelector('.st-grip').onmousedown = (ev) => this._stickyResize(ev, el, () => save());
        const save = () => { clearTimeout(t); t = setTimeout(() => this._persistSticky(el), 600); };
        el.dataset.color = this.ST_COLORS.private.concat(this.ST_COLORS.shared)
            .find(c => c === startColor || this._rgb(c) === String(startColor).trim()) || '';
        sw.onclick = (ev) => {
            ev.stopPropagation();
            this._openColorPop(sw, el.dataset.color, (c, sc) => {
                el.style.background = c; el.dataset.color = c; el.dataset.scope = sc;
                label(); save();
            });
        };
        ta.oninput = save;
        // 옮긴 자리도 기억한다(기기 저장분)
        el.addEventListener('mouseup', () => { if (el.dataset.local === '1') save(); });
        if (!rec.id) {
            // 새 스티커: 화면엔 이미 떠 있고, 저장 자리만 뒤에서 만든다. 실패해도 스티커는 사라지지 않는다.
            label('저장 준비 중…');
            this._createStickyRow(el.dataset.scope).then(id => {
                if (id) { el.dataset.id = id; el.dataset.owner = this._me(); label('자동 저장됨'); }
                else { el.dataset.local = '1'; el.dataset.id = 'L' + Date.now() + idx; label('이 기기에만 저장됨'); this._persistSticky(el); }
            });
        } else { label(); }
        if (!this._stLabels) this._loadStickyLabels().then(() => { if (document.body.contains(el)) label(); });
        setTimeout(() => ta.focus(), 50);
        return el;
    }
    // ── 색 이름 ──────────────────────────────────────────────
    //  색마다 뜻을 붙여 쓴다(예: 노랑=급한 일). 회사 공용 한 벌이라 모두가 같은 이름을 본다.
    //  notes 에 folder='스티커라벨' 한 줄로 두고, DB 가 막히면 이 기기에 남긴다.
    ST_LABEL_DEFAULT = {
        '#fff5a5': '노랑', '#ffd8e4': '분홍', '#e7dcff': '라벤더',
        '#d3f2ff': '하늘', '#d9f7d0': '연두', '#ccf5ec': '민트',
    };
    _labelsLocal(next) {
        if (next !== undefined) { try { localStorage.setItem('bhas_sticky_labels', JSON.stringify(next)); } catch (_e) {} return next; }
        try { return JSON.parse(localStorage.getItem('bhas_sticky_labels') || 'null'); } catch (_e) { return null; }
    }
    async _loadStickyLabels() {
        if (this._stLabels) return this._stLabels;
        let m = null;
        try {
            const { data } = await this.supabase.from('notes').select('id,body')
                .eq('folder', '스티커라벨').limit(1);
            if (data && data[0]) { this._stLabelRow = data[0].id; m = JSON.parse(data[0].body || '{}'); }
        } catch (_e) { /* 막히면 이 기기 것으로 */ }
        this._stLabels = { ...this.ST_LABEL_DEFAULT, ...(m || this._labelsLocal() || {}) };
        return this._stLabels;
    }
    _labelOf(color) {
        const c = String(color || '').trim();
        const m = this._stLabels || this.ST_LABEL_DEFAULT;
        if (m[c]) return m[c];
        const hit = Object.keys(this.ST_LABEL_DEFAULT).find(h => this._rgb(h) === c);
        return hit ? (m[hit] || this.ST_LABEL_DEFAULT[hit]) : '';
    }
    // 떠 있는 스티커의 제목줄을 지금 이름으로 다시 쓴다
    _refreshStickyTitles() {
        document.querySelectorAll('.sticky').forEach(el => {
            const t = el.querySelector('.st-title'); if (!t) return;
            const shared = el.dataset.scope === 'shared';
            const nm = this._labelOf(el.dataset.color || el.style.background);
            t.textContent = nm ? `${nm} · ${shared ? '공용' : '개인'}` : (shared ? '공용' : '개인');
        });
    }
    async _saveStickyLabels() {
        const m = this._stLabels || {};
        this._labelsLocal(m);
        const body = JSON.stringify(m);
        try {
            if (this._stLabelRow) {
                const { error } = await this.supabase.from('notes').update({ body }).eq('id', this._stLabelRow);
                if (error) throw error;
            } else {
                const { data, error } = await this.supabase.from('notes')
                    .insert([{ title: '스티커 색 이름', body, folder: '스티커라벨', scope: 'shared',
                               created_by: this.currentUser?.name || null }]).select('id').single();
                if (error) throw error;
                this._stLabelRow = data && data.id;
            }
        } catch (_e) { this.showToast('색 이름은 이 기기에만 저장됐습니다.'); }
    }
    // ── 스티커 메뉴 (맥 독 메뉴 모양) ─────────────────────────
    //  독의 스티커를 누르면 아이콘 위로 뜬다. 새로 만들기 · 색으로 바로 만들기 · 지난 스티커.
    openStickyList() {
        const cur = document.getElementById('sticky-list');
        if (cur) { this._closeStickyMenu(); return; }
        const esc = s => this._vesc(s);
        const el = document.createElement('div');
        el.className = 'stmenu lg'; el.id = 'sticky-list';
        el.innerHTML = `
            <button class="stm-item stm-new"><i class="ph ph-plus"></i><span>새 스티커</span></button>
            <div class="stm-sep"></div>
            <div class="stm-cap">색</div>
            <div class="stm-pal">불러오는 중…</div>
            <div class="stm-sep"></div>
            <div class="stm-cap">지난 스티커</div>
            <div class="stm-list"></div>
            <span class="stm-caret"></span>`;
        document.body.appendChild(el);
        this._placeStickyMenu(el);
        el.querySelector('.stm-new').onclick = () => { this.addSticky(); this._closeStickyMenu(); };
        this._renderPalette();
        // 맥 메뉴처럼 바깥을 누르거나 Esc 를 누르면 닫힌다
        this._stmOutside = (ev) => {
            if (el.contains(ev.target) || ev.target.closest('.mac-dock .mdi')) return;
            this._closeStickyMenu();
        };
        this._stmKey = (ev) => { if (ev.key === 'Escape') this._closeStickyMenu(); };
        setTimeout(() => {
            document.addEventListener('mousedown', this._stmOutside);
            document.addEventListener('keydown', this._stmKey);
        }, 0);
        this._syncStickyList();
        return el;
    }
    // 색 줄 한 벌 — 독 메뉴와 스티커의 색 고르기가 같은 모양을 쓴다
    _paletteHTML(sel, rename) {
        const esc = s => this._vesc(s);
        const row = (c, sc) => `<div class="stm-prow${c === sel ? ' on' : ''}" data-c="${c}" data-s="${sc}">
                <span class="stm-tick">${c === sel ? '✓' : ''}</span>
                <span class="stm-chip" style="background:${c}"></span>
                <span class="stm-name">${esc(this._labelOf(c))}</span>
                <span class="stm-side">${sc === 'shared' ? '공용' : '개인'}</span>
                ${rename ? '<button class="stm-edit" title="이름 바꾸기"><i class="ph ph-pencil-simple"></i></button>' : ''}
            </div>`;
        return this.ST_COLORS.private.map(c => row(c, 'private')).join('')
             + this.ST_COLORS.shared.map(c => row(c, 'shared')).join('');
    }
    _bindPalette(pal, onPick, rename) {
        pal.querySelectorAll('.stm-prow').forEach(r => {
            r.onclick = (ev) => {
                if (ev.target.closest('.stm-edit') || r.classList.contains('editing')) return;
                onPick(r.dataset.c, r.dataset.s);
            };
            const e = r.querySelector('.stm-edit');
            if (e) e.onclick = (ev) => { ev.stopPropagation(); this._renameColor(r); };
        });
    }
    async _renderPalette() {
        const el = document.getElementById('sticky-list'); if (!el) return;
        const pal = el.querySelector('.stm-pal'); if (!pal) return;
        await this._loadStickyLabels();
        if (!document.getElementById('sticky-list')) return;
        pal.innerHTML = this._paletteHTML(null, true);
        this._bindPalette(pal, (c, sc) => { this.addSticky({ color: c, scope: sc }); this._closeStickyMenu(); }, true);
    }
    // 스티커의 색 점을 누르면 뜨는 작은 색 메뉴
    async _openColorPop(anchor, sel, onPick) {
        document.getElementById('sticky-colorpop')?.remove();
        await this._loadStickyLabels();
        const pop = document.createElement('div');
        pop.className = 'stmenu stpop lg'; pop.id = 'sticky-colorpop';
        pop.innerHTML = `<div class="stm-pal">${this._paletteHTML(sel, false)}</div>`;
        document.body.appendChild(pop);
        const r = anchor.getBoundingClientRect(), w = 200;
        pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
        pop.style.top = (r.bottom + 6) + 'px';
        this._bindPalette(pop.querySelector('.stm-pal'), (c, sc) => { onPick(c, sc); pop.remove(); }, false);
        const off = (ev) => {
            if (pop.contains(ev.target) || ev.target === anchor) return;
            pop.remove(); document.removeEventListener('mousedown', off);
        };
        setTimeout(() => document.addEventListener('mousedown', off), 0);
    }
    _renameColor(r) {
        if (r.classList.contains('editing')) return;
        r.classList.add('editing');
        const name = r.querySelector('.stm-name');
        const old = name.textContent;
        const inp = document.createElement('input');
        inp.className = 'stm-input'; inp.value = old; inp.maxLength = 12;
        name.replaceWith(inp);
        inp.focus(); inp.select();
        const done = async (ok) => {
            const v = (inp.value || '').trim().slice(0, 12);
            const span = document.createElement('span');
            span.className = 'stm-name';
            span.textContent = (ok && v) ? v : old;
            inp.replaceWith(span);
            r.classList.remove('editing');
            if (ok && v && v !== old) {
                this._stLabels = { ...(this._stLabels || {}), [r.dataset.c]: v };
                await this._saveStickyLabels();
                this._syncStickyList();
                this._refreshStickyTitles();   // 이미 떠 있는 스티커의 제목줄도 새 이름으로
            }
        };
        inp.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
        };
        inp.onblur = () => done(true);
    }
    _closeStickyMenu() {
        document.removeEventListener('mousedown', this._stmOutside || (() => {}));
        document.removeEventListener('keydown', this._stmKey || (() => {}));
        const el = document.getElementById('sticky-list');
        if (!el) return;
        el.classList.add('out');
        setTimeout(() => el.remove(), 110);
        setTimeout(() => this.requestRender(), 140);
    }
    // 독의 스티커 아이콘 바로 위에 붙인다. 독이 없으면(기본 화면) 오른쪽 위에.
    _placeStickyMenu(el) {
        const btn = [...document.querySelectorAll('.mac-dock .mdi')].find(b => b.title === '스티커');
        const w = 268;
        if (btn) {
            const r = btn.getBoundingClientRect();
            const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
            el.style.left = left + 'px';
            el.style.bottom = (window.innerHeight - r.top + 14) + 'px';
            el.style.setProperty('--caret', (r.left + r.width / 2 - left) + 'px');
        } else {
            el.style.left = Math.max(8, window.innerWidth - w - 16) + 'px';
            el.style.top = '72px';
            el.classList.add('nocaret');
        }
    }
    // 목록 내용 채우기 — DB(내 개인칸 + 모두의 공용) + 이 기기 저장분
    async _syncStickyList() {
        const el = document.getElementById('sticky-list'); if (!el) return;
        const body = el.querySelector('.stm-list');
        const esc = s => this._vesc(s);
        let rows = [];
        try {
            const me = this._me(), nm = this.currentUser?.name || '';
            const parts = ['scope.eq.shared'];
            if (me) parts.push(`owner.eq.${me}`);
            if (nm && !/[,()"]/.test(nm)) parts.push(`and(owner.is.null,created_by.eq.${nm})`);
            const { data } = await this.supabase.from('notes').select('*').eq('folder', '스티커')
                .or(parts.join(',')).order('updated_at', { ascending: false }).limit(60);
            rows = (data || []).map(r => ({ ...r, local: false }));
        } catch (_e) { /* DB 가 막혀도 기기 저장분은 보여준다 */ }
        rows = rows.concat(this._localStickies().slice().reverse());
        if (!rows.length) { body.innerHTML = `<div class="stm-empty">없음</div>`; return; }
        body.innerHTML = rows.map(r => {
            const shared = (r.scope || 'private') === 'shared';
            const txt = (r.body || '').trim().split('\n')[0].slice(0, 26) || '빈 스티커';
            const up = !!document.querySelector(`.sticky[data-id="${r.id}"]`);
            const lab = this._labelOf(r.color || (shared ? '#d3f2ff' : '#fff5a5'));
            return `<button class="stm-item stm-row${up ? ' up' : ''}" data-id="${esc(String(r.id))}" title="${esc(lab)}">
                <span class="stm-chip" style="background:${esc(r.color || (shared ? '#d3f2ff' : '#fff5a5'))}"></span>
                <span class="stm-txt">${esc(txt)}</span>
                ${lab ? `<span class="stm-side">${esc(lab)}</span>` : ''}
                <span class="stm-del" title="지우기">✕</span>
            </button>`;
        }).join('');
        const byId = Object.fromEntries(rows.map(r => [String(r.id), r]));
        body.querySelectorAll('.stm-row').forEach(row => {
            const rec = byId[row.dataset.id];
            row.onclick = (ev) => {
                if (ev.target.closest('.stm-del')) return;
                const up = document.querySelector(`.sticky[data-id="${row.dataset.id}"]`);
                if (up) { up.style.zIndex = 1394; up.querySelector('textarea').focus(); }
                else this.addSticky(rec);
                this._closeStickyMenu();
            };
            row.querySelector('.stm-del').onclick = async (ev) => {
                ev.stopPropagation(); ev.preventDefault();
                await this._deleteSticky(rec);
                this._syncStickyList();
            };
        });
    }
    async _deleteSticky(rec) {
        document.querySelector(`.sticky[data-id="${rec.id}"]`)?.remove();
        if (rec.local) { this._dropLocalSticky(rec.id); return; }
        try {
            const { error } = await this.supabase.from('notes').delete().eq('id', rec.id);
            if (error) throw error;
        } catch (_e) {
            this.showToast('이 스티커는 지울 권한이 없습니다 (공용은 마스터만).');
        }
    }
    // 스티커 크기 조절 — 오른쪽 아래 모서리를 잡아 끈다. 왼쪽 위는 그대로 있는다.
    _stickyResize(ev, el, onDone) {
        ev.preventDefault(); ev.stopPropagation();
        const r = el.getBoundingClientRect();
        const sx = ev.clientX, sy = ev.clientY, ow = r.width, oh = r.height;
        const move = (e) => {
            el.style.width = Math.max(150, Math.min(window.innerWidth - r.left - 8, ow + e.clientX - sx)) + 'px';
            el.style.height = Math.max(110, Math.min(window.innerHeight - r.top - 8, oh + e.clientY - sy)) + 'px';
        };
        const up = () => {
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
            if (onDone) onDone();
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }
    async _createStickyRow(scope = 'private') {
        try {
            const { data, error } = await this.supabase.from('notes')
                .insert([{ title: '스티커', body: '', folder: '스티커', scope, owner: this._me() || null,
                           created_by: this.currentUser?.name || null }])
                .select('id').single();
            if (error) throw error;
            return data && data.id;
        } catch (_e) { return null; }
    }
    async _persistSticky(el) {
        if (!document.body.contains(el)) return;
        const ft = el.querySelector('.st-ft');
        const body = el.querySelector('textarea').value;
        const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
        const local = () => {
            this._saveLocalSticky({ id: el.dataset.id, body, color: el.dataset.color || el.style.background,
                scope: el.dataset.scope, owner: el.dataset.owner || this._me(),
                x: parseInt(el.style.left, 10) || 0, y: parseInt(el.style.top, 10) || 0,
                w: parseInt(el.style.width, 10) || 230, h: parseInt(el.style.height, 10) || 200, local: true });
            ft.textContent = '이 기기에만 저장됨 · ' + now;
        };
        if (el.dataset.local === '1' || !el.dataset.id) { local(); return; }
        const patch = { title: body.split('\n')[0].slice(0, 60) || '스티커', body, scope: el.dataset.scope };
        // 주인이 안 찍힌 옛 스티커만 내 것으로 표시한다. 남의 공용 스티커를 가로채면 안 된다.
        if (!el.dataset.owner) { patch.owner = this._me() || null; }
        try {
            const { error } = await this.supabase.from('notes').update(patch).eq('id', el.dataset.id);
            if (error) throw error;
            if (!el.dataset.owner) el.dataset.owner = this._me();
            ft.textContent = '자동 저장됨 · ' + now;
            this._syncStickyList();
        } catch (_e) { el.dataset.local = '1'; local(); }
    }
    // 로그인 후 한 번: 지난 스티커를 도로 띄운다 (DB 것 먼저, 이 기기 것도 같이)
    async restoreStickies() {
        if (this._stickiesRestored) return;
        this._stickiesRestored = true;
        await this._loadStickyLabels();   // 색 이름부터 받아야 제목줄이 제대로 뜬다
        try {
            const me = this._me(), nm = this.currentUser?.name || '';
            // 내 개인칸 + 모두의 공용. 주인이 안 찍힌 옛 스티커는 만든 사람 이름으로 골라낸다.
            const parts = ['scope.eq.shared'];
            if (me) parts.push(`owner.eq.${me}`);
            if (nm && !/[,()"]/.test(nm)) parts.push(`and(owner.is.null,created_by.eq.${nm})`);
            const { data } = await this.supabase.from('notes').select('*').eq('folder', '스티커')
                .or(parts.join(','))
                .order('updated_at', { ascending: false }).limit(10);
            (data || []).forEach(r => this.addSticky(r));
        } catch (_e) { /* 없으면 그만 */ }
        this._localStickies().forEach(r => this.addSticky(r));
    }
    // 공통: 막대를 잡고 끄는 이동
    _dragWin(el, handle) {
        handle.onmousedown = (ev) => {
            if (ev.target.closest('button') || ev.target.closest('i')) return;
            ev.preventDefault(); handle.classList.add('drag');
            const r = el.getBoundingClientRect();
            const sx = ev.clientX, sy = ev.clientY, ox = r.left, oy = r.top;
            const move = (e) => {
                el.style.left = Math.max(0, Math.min(window.innerWidth - 80, ox + e.clientX - sx)) + 'px';
                el.style.top = Math.max(0, Math.min(window.innerHeight - 60, oy + e.clientY - sy)) + 'px';
            };
            const up = () => { handle.classList.remove('drag'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
        };
    }

    // ══════════════════════════════════════════════════════════════
    //  맥 모드 — 데스크톱 · 창 관리자 · 독
    //   · 창은 가운데에서 열리고, 제목막대에서 휠을 굴리면 커졌다 작아진다
    //   · 신호등으로 닫기/내리기(독으로)/키우기, 가장자리로 끌면 화면 반쪽에 붙는다(분할)
    //   · 창 내용은 기존 renderSubView 를 그대로 재사용 → 기능이 전부 그대로 살아 있다
    // ══════════════════════════════════════════════════════════════
    //  아이콘: 맥 기본앱과 뜻이 그대로 맞는 것만 그림 파일(png)을 쓰고,
    //  우리 업무 앱(주문·CS·매출·재고·SNS·지출·생산현황)은 각자 다른 색·기호로 그린다.
    //  전에는 prod.png 가 CS·재고·생산현황 셋에, settle.png 가 매출·지출 둘에 겹쳐 있었다.
    //  아이콘은 맥 그림 그대로. 앱을 세 묶음으로 합치면서 겹치던 게 풀려
    //  이제 하나씩 제 아이콘을 쓴다(전엔 prod/settle 가 겹쳤다).
    //  아이콘은 전부 맥 순정 그림. 순정에 없는 것은 맥에 있는 다른 앱 아이콘을 쓴다
    //  (전체 메뉴=Apps · 뉴스=News · 스티커=Stickies — 모두 맥 기본 앱이다).
    MAC_DOCK = [
        { id: '__menu', label: '전체 메뉴', launcher: true, icon: 'apps' },
        { id: 'home', label: '바탕화면', icon: 'home', desktop: true },
        { id: 'orders', label: '판매', icon: 'sales' },
        { id: 'items', label: '생산', icon: 'prod' },
        { id: 'sns', label: 'SNS', icon: 'mkt' },
        { id: 'news', label: '뉴스', icon: 'news' },
        { id: 'documents', label: '자료실', icon: 'finder' },
        { id: 'calendar', label: '캘린더', icon: 'cal' },
        { id: 'reminders', label: '할 일', icon: 'rem' },
        { id: 'notes', label: '메모', icon: 'notes' },
        { id: 'contacts', label: '연락처', icon: 'contacts' },
        { id: 'settings', label: '설정', icon: 'set' },
        // 창이 아니라 그 자리에서 뜨는 도구 — 독 오른쪽 끝에 따로 둔다
        { id: 'calc', label: '계산기', icon: 'calc', tool: true },
        { id: 'sticky', label: '스티커', icon: 'sticky', tool: true },
    ];
    _dockFace(d) {
        if (d && d.icon) return `<img src="icons/${d.icon}.png" alt="${this._vesc(d.label || '')}" draggable="false">`;
        return `<img src="icons/finder.png" alt="" draggable="false">`;
    }
    _dockFace(d) {
        if (d && d.draw && this[d.draw]) return this[d.draw]();
        if (d && d.icon) return `<img src="icons/${d.icon}.png" alt="${this._vesc(d.label || '')}" draggable="false">`;
        return this._g('<rect x="4" y="4" width="16" height="16" rx="3.4"/>', '#8e8e93');
    }
    MAC_WALLS = [
        { id: 'dawn',   label: '새벽' },
        { id: 'ocean',  label: '바다' },
        { id: 'desert', label: '사막' },
        { id: 'mono',   label: '단색' },
    ];
    get wallpaper() {
        try { return localStorage.getItem('macWall') || 'dawn'; } catch (_e) { return 'dawn'; }
    }
    setWallpaper(id) {
        try { localStorage.setItem('macWall', id); } catch (_e) {}
        const d = document.querySelector('.mac-desktop');
        if (d) d.dataset.wall = id;
        this.requestRender();
    }
    _macTitle(view) {
        const m = (this.MAC_DOCK.find(d => d.id === view));
        if (m) return m.label;
        return ({ settings: '설정', contacts: '연락처', cs: 'CS', expenses: '지출', inventory: '재고', news: '뉴스',
                  sales: '정산', sample_maker: '샘플·디자인',
                  vendors: '생산현황', dashboard: '시즌', analysis: '분석', tech_packs: '작업지시서', quotes: '견적',
                  integrations: '연동', user_management: '계정', brand_management: '브랜드',
                  feedback: '불편사항', pages: '페이지', kanban: '보드', table: '표',
                  all_todos: '할일', timeline: '타임라인', sample_maker: '샘플' })[view] || view;
    }
    macOpen(view) {
        if (view === 'home') { this.macShowDesktop(); return; }   // 홈은 바탕화면 자체다
        this.wins = this.wins || [];
        const found = this.wins.find(w => w.view === view);
        if (found) {
            const wasMin = found.min;
            found.min = false;
            this.macFocus(found.id);
            if (wasMin) this.requestRender();   // 내려둔 창은 다시 그려야 올라온다
            return;
        }
        const n = this.wins.length;
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = Math.min(1180, Math.round(vw * 0.74)), h = Math.min(760, Math.round(vh * 0.74));
        // 맨 앞 창이 '고정'(키우기·반쪽)이면 새 창도 같은 크기로 그 위에 띄운다.
        //  작은 창이 큰 창에 파묻혀 "다른 걸로 넘어간 것처럼" 보이는 걸 막는다. 좁은 화면(폰)도 항상 꽉 채운다.
        const front = this.wins.filter(x => !x.min).sort((a, b) => (b.z || 0) - (a.z || 0))[0];
        const fixed = vw < 900 || !!(front && (front.max || front.snap));
        this.wins.push({
            id: 'w' + Date.now() + n, view,
            x: Math.round((vw - w) / 2) + (n % 5) * 26, y: Math.round((vh - h) / 2) - 30 + (n % 5) * 22,
            w, h, min: false, max: fixed, snap: null, z: ++this._macZ,
        });
        this.requestRender();
    }
    // 독의 도구 — 계산기는 켜고 끄기, 스티커는 한 장 더 붙이기
    macTool(id) {
        if (id === 'calc') this.openCalc();
        else this.openStickyList();
        setTimeout(() => this.requestRender(), 60);   // 독의 켜짐 표시 갱신
    }
    macFocus(id) {
        const w = (this.wins || []).find(x => x.id === id); if (!w) return;
        const el = document.getElementById(id);
        const top = Math.max(...(this.wins || []).filter(x => !x.min).map(x => x.z || 0));
        if (el && w.z === top) return;        // 이미 맨 앞이면 그대로 — 쓸데없는 재렌더가 클릭을 삼킨다
        w.z = ++this._macZ;
        if (el) { el.style.zIndex = w.z; return; }   // 순서만 바꾸면 되니 다시 그리지 않는다
        this.requestRender();
    }
    macClose(id, ev) { if (ev) ev.stopPropagation(); this.wins = (this.wins || []).filter(w => w.id !== id); this.requestRender(); }
    macMin(id, ev) { if (ev) ev.stopPropagation(); const w = this.wins.find(x => x.id === id); if (w) { w.min = true; this.requestRender(); } }
    macZoom(id, ev) {
        if (ev) ev.stopPropagation();
        const w = this.wins.find(x => x.id === id); if (!w) return;
        if (w.max) { Object.assign(w, w._prev || {}); w.max = false; w.snap = null; }
        else { w._prev = { x: w.x, y: w.y, w: w.w, h: w.h }; w.max = true; w.snap = null; }
        this.requestRender();
    }
    macSnap(id, side) {
        const w = this.wins.find(x => x.id === id); if (!w) return;
        if (!w.max && !w.snap) w._prev = { x: w.x, y: w.y, w: w.w, h: w.h };
        w.snap = side; w.max = false; this.requestRender();
    }
    // 제목막대에서 휠 → 창 크기 조절(가운데 기준)
    macWheel(ev, id) {
        const w = (this.wins || []).find(x => x.id === id); if (!w || w.max || w.snap) return;
        ev.preventDefault();
        const k = ev.deltaY > 0 ? 0.94 : 1.06;
        const min = this._macMin();
        const nw = Math.max(min.w, Math.min(window.innerWidth - 40, Math.round(w.w * k)));
        const nh = Math.max(min.h, Math.min(window.innerHeight - 120, Math.round(w.h * k)));
        // 왼쪽 위를 고정하고 오른쪽·아래로만 늘고 준다(가운데 기준이면 창이 제자리에서 흔들린다)
        w.w = nw; w.h = nh;
        const el = document.getElementById(id);
        if (el) { el.style.width = nw + 'px'; el.style.height = nh + 'px'; el.style.left = w.x + 'px'; el.style.top = w.y + 'px'; }
    }
    // 제목막대 드래그(이동) + 화면 좌우 끝으로 끌면 분할
    macDragStart(ev, id) {
        if (ev.button !== 0) return;
        // 신호등·반쪽 버튼 위에서 시작한 건 드래그가 아니다. 여기서 재렌더하면
        // click 이 오기 전에 버튼이 지워져 "눌러도 안 먹는" 상태가 된다.
        if (ev.target.closest('button')) return;
        const w = (this.wins || []).find(x => x.id === id); if (!w) return;
        this.macFocus(id);
        const el = document.getElementById(id); if (!el) return;
        if (w.snap || w.max) { Object.assign(w, w._prev || {}); w.snap = null; w.max = false; this.requestRender(); return; }
        const sx = ev.clientX, sy = ev.clientY, ox = w.x, oy = w.y;
        const hint = document.getElementById('mac-snap-hint');
        const move = (e) => {
            w.x = Math.max(-60, Math.min(window.innerWidth - 160, ox + e.clientX - sx));
            w.y = Math.max(0, Math.min(window.innerHeight - 90, oy + e.clientY - sy));
            el.style.left = w.x + 'px'; el.style.top = w.y + 'px';
            if (hint) {
                const near = e.clientX < 24 ? 'left' : (e.clientX > window.innerWidth - 24 ? 'right' : null);
                hint.style.display = near ? 'block' : 'none';
                if (near) { hint.style.left = near === 'left' ? '0' : '50%'; }
                el.dataset.snap = near || '';
            }
        };
        const up = () => {
            document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
            if (hint) hint.style.display = 'none';
            const near = el.dataset.snap;
            if (near) this.macSnap(id, near); else this.requestRender();
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }
    // 창이 작아질 수 있는 한계 (좁은 화면에서는 더 작게 줄 수 있어야 한다)
    _macMin() {
        return { w: Math.min(320, window.innerWidth - 16), h: Math.min(220, window.innerHeight - 60) };
    }
    // 여덟 방향(네 변 + 네 모서리) 자유 크기 조절 — 잡은 쪽만 움직이고 반대쪽은 그대로 있는다
    macResizeStart(ev, id, dir = 'se') {
        ev.stopPropagation(); ev.preventDefault();
        const w = (this.wins || []).find(x => x.id === id); if (!w) return;
        const el = document.getElementById(id); if (!el) return;
        this.macFocus(id);
        // 키우기·반쪽 상태에서 잡으면 지금 보이는 크기를 그대로 받아 자유 창으로 푼다
        if (w.max || w.snap) {
            const r = el.getBoundingClientRect();
            w.x = Math.round(r.left); w.y = Math.round(r.top); w.w = Math.round(r.width); w.h = Math.round(r.height);
            w.max = false; w.snap = null;
            el.style.left = w.x + 'px'; el.style.top = w.y + 'px';
            el.style.width = w.w + 'px'; el.style.height = w.h + 'px';
        }
        const min = this._macMin();
        const sx = ev.clientX, sy = ev.clientY;
        const ox = w.x, oy = w.y, ow = w.w, oh = w.h;
        const right = ox + ow, bottom = oy + oh;
        const move = (e) => {
            const dx = e.clientX - sx, dy = e.clientY - sy;
            if (dir.includes('e')) w.w = Math.max(min.w, ow + dx);
            if (dir.includes('s')) w.h = Math.max(min.h, oh + dy);
            if (dir.includes('w')) { w.x = Math.min(right - min.w, ox + dx); w.w = right - w.x; }
            if (dir.includes('n')) { w.y = Math.max(0, Math.min(bottom - min.h, oy + dy)); w.h = bottom - w.y; }
            el.style.left = w.x + 'px'; el.style.top = w.y + 'px';
            el.style.width = w.w + 'px'; el.style.height = w.h + 'px';
        };
        const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); this.requestRender(); };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    }
    _macWinStyle(w) {
        if (w.max) return 'left:8px;top:8px;width:calc(100vw - 16px);height:calc(100vh - 128px)';
        if (w.snap === 'left') return 'left:8px;top:8px;width:calc(50vw - 12px);height:calc(100vh - 128px)';
        if (w.snap === 'right') return 'left:calc(50vw + 4px);top:8px;width:calc(50vw - 12px);height:calc(100vh - 128px)';
        return `left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px`;
    }
    renderMacDesktop(products) {
        const esc = s => this._vesc(s);
        this.wins = this.wins || []; this._macZ = this._macZ || 10;
        const prevView = this.currentView;
        const winsHtml = this.wins.filter(w => !w.min).map(w => {
            this.currentView = w.view;
            this._renderingWin = w.id;
            let body = '';
            try { body = this.renderSubView(products) || ''; }
            catch (e) { body = `<div style="padding:2rem;color:#ef4444">화면을 그리지 못했습니다: ${esc(String(e && e.message || e))}</div>`; }
            return `<section class="macwin lg" id="${w.id}" style="${this._macWinStyle(w)};z-index:${w.z}" onmousedown="app.macFocus('${w.id}')">
                <header class="macwin-bar" onmousedown="app.macDragStart(event,'${w.id}')"
                        ondblclick="app.macZoom('${w.id}',event)" onwheel="app.macWheel(event,'${w.id}')">
                    <span class="mw-lights">
                        <button class="mw-l red" data-g="✕" title="닫기" onclick="app.macClose('${w.id}',event)"></button>
                        <button class="mw-l yellow" data-g="−" title="독으로 내리기" onclick="app.macMin('${w.id}',event)"></button>
                        <button class="mw-l green" data-g="${w.max ? '⤡' : '⤢'}" title="${w.max ? '원래 크기로' : '꽉 채우기'}" onclick="app.macZoom('${w.id}',event)"></button>
                    </span>
                    <b>${esc(this._macTitle(w.view))}</b>
                    <span class="mw-snap">
                        <button title="왼쪽 반" onclick="event.stopPropagation();app.macSnap('${w.id}','left')">◧</button>
                        <button title="오른쪽 반" onclick="event.stopPropagation();app.macSnap('${w.id}','right')">◨</button>
                    </span>
                </header>
                <div class="macwin-body">${body}</div>
                ${['n','s','e','w','ne','nw','se','sw'].map(d =>
                    `<span class="mwr mwr-${d}" onmousedown="app.macResizeStart(event,'${w.id}','${d}')"></span>`).join('')}
            </section>`;
        }).join('');
        this._renderingWin = null;
        this.currentView = prevView;
        // 바탕화면 = 홈 대시보드. 여기 블록을 누르면 switchView 를 타고 창이 열린다.
        let deskboard = '';
        try { deskboard = this.renderHome(products) || ''; }
        catch (e) { deskboard = `<div style="padding:2rem;color:#ef4444">바탕화면을 그리지 못했습니다: ${esc(String(e && e.message || e))}</div>`; }
        const dock = this.MAC_DOCK.filter(d => !d.tool).map(d => {
            const open = d.launcher ? false : (d.desktop ? !this.wins.some(w => !w.min) : this.wins.find(w => w.view === d.id));
            const act = d.launcher ? 'app.openLauncher()' : `app.macOpen('${d.id}')`;
            return `<button class="mdi${open ? ' open' : ''}" onclick="${act}" title="${esc(d.label)}">
                ${this._dockFace(d)}<em>${esc(d.label)}</em></button>`;
        }).join('');
        const tools = this.MAC_DOCK.filter(d => d.tool).map(d => {
            const on = d.id === 'calc' ? !!document.getElementById('calc-pop')
                : !!(document.querySelector('.sticky') || document.getElementById('sticky-list'));
            const face = this._dockFace(d);
            return `<button class="mdi${on ? ' open' : ''}" onclick="app.macTool('${d.id}')" title="${esc(d.label)}">
                ${face}<em>${esc(d.label)}</em></button>`;
        }).join('');
        const mins = this.wins.filter(w => w.min).map(w =>
            `<button class="mdi min" onclick="app.macOpen('${w.view}')" title="${esc(this._macTitle(w.view))}">
                ${this._dockFace(this.MAC_DOCK.find(d => d.id === w.view))}<em>${esc(this._macTitle(w.view))}</em></button>`).join('');
        return `<div class="mac-desktop" data-wall="${esc(this.wallpaper)}">
            <div class="mac-menubar">
                <b>2179</b>
                <span>${esc(this.currentUser?.name || '')}</span>
                <span class="mac-mb-right">
                    <button class="mac-find" onclick="app.openFind()" title="모두 찾기 (⌘K)"><i class="ph ph-magnifying-glass"></i></button>
                    <span class="mac-ver" title="지금 쓰는 버전">${esc(this._buildTag())}</span>
                    ${(() => { const n = this.unreadCount(); return `<button class="mac-bell${n ? ' has' : ''}"
                        onclick="app.openNotifCenter()" title="알림 센터${n ? ` · 안 읽음 ${n}` : ''}">
                        <i class="ph ph-bell"></i>${n ? '<i class="dot"></i>' : ''}</button>`; })()}

                </span>
            </div>
            <div id="mac-snap-hint" class="mac-snap-hint"></div>
            <div class="mac-deskboard">
                <div class="desk-find" onclick="app.openFind()">
                    <i class="ph ph-magnifying-glass"></i>
                    <span>무엇이든 찾기</span>
                    <kbd>⌘K</kbd>
                </div>
                ${deskboard}
            </div>
            ${winsHtml}
            <nav class="mac-dock lg">${dock}<span class="mdsep"></span>${tools}${mins ? '<span class="mdsep"></span>' + mins : ''}</nav>
        </div>`;
    }
    // 맥 모드 전용 — 바탕화면(홈)과 열려 있는 창마다 ensureViewData 를 한 번씩 돌린다.
    //  currentView 는 창을 그리는 동안만 바뀌므로 여기서 직접 갈아끼워 부른다.
    // ★ 맥 모드에선 renderDashboard 가 일찍 return 해서 버튼 연결(bind)이 통째로 안 돌았다.
    //   창으로 연 화면의 단추·입력이 전부 먹통이었다 — 창마다 한 번씩 연결해준다.
    _macBind() {
        const prev = this.currentView;
        const views = [...new Set(['home', ...(this.wins || []).filter(w => !w.min).map(w => w.view)])];
        const per = {
            orders: 'bindOrdersEvents', inventory: 'bindInventoryEvents', pages: 'bindPagesEvents',
            kanban: 'bindKanbanEvents', table: 'bindTableEvents', calendar: 'bindCalendarEvents',
            vendors: 'bindVendorsEvents', integrations: 'bindIntegrationsEvents', quotes: 'bindQuotesEvents',
            detail: 'bindDetailEvents', all_todos: 'bindAllTodosEvents',
        };
        views.forEach(v => {
            this.currentView = v;
            try { this.bindDashboardEvents(); } catch (_e) {}
            this._bindFindKey();
            try { this._mountGrips(); } catch (_e) {}
            try { this._restoreCell(); } catch (_e) {}
            try { this._mountPickMap(); } catch (_e) {}
            const fn = per[v];
            if (fn && typeof this[fn] === 'function') { try { this[fn](); } catch (_e) {} }
        });
        this.currentView = prev;
    }
    _macEnsureData() {
        const prev = this.currentView;
        const views = [...new Set(['home', ...(this.wins || []).filter(w => !w.min).map(w => w.view)])];
        views.forEach(v => { this.currentView = v; try { this.ensureViewData(); } catch (_e) {} });
        this.currentView = prev;
    }
    // 기본 화면은 없앴다. 남은 호출은 바탕화면 보기로 넘긴다.
    toggleMacMode() { this.macMode = true; this.macShowDesktop(); }

    // ── 메모 (맥 '메모' 앱 형태) ─────────────────────────────
    //  시즌 댓글(memos)·노션 노트를 한 곳에서. 폴더 = 맥 메모의 폴더, 시즌에 붙이면 그 시즌의 기록이 된다.
    // 받아오는 동안 보여줄 뼈대 — 빈 화면보다 덜 답답하다
    _loadingSkeleton(what) {
        const bar = (w) => `<div class="skel" style="width:${w}"></div>`;
        return `<div class="skel-wrap">
            <div class="skel-head">${this._vesc(what)} 불러오는 중…</div>
            ${[92, 74, 86, 62, 80, 70].map(w => `<div class="skel-row">${bar('14px')}${bar(w + '%')}</div>`).join('')}
        </div>`;
    }
    async loadNotes() {
        this._noteLoading = true;
        try {
            // 스티커·색이름 줄은 메모 앱에 낄 게 아니다. 빼면 줄 수도 준다.
            const { data, error } = await this.supabase.from('notes').select('*')
                .not('folder', 'in', '("스티커","스티커라벨")')
                .order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(200);
            if (error) throw error;
            this.noteList = data || []; this._noteLoaded = true;
            if (!this.noteSel && this.noteList.length) this.noteSel = this.noteList[0].id;
            //  폴더 권한 (045 를 안 돌렸으면 조용히 비워 둔다 — 화면은 그대로 돈다)
            try {
                const { data: fd } = await this.supabase.from('note_folders').select('*');
                this.noteFolders = fd || [];
            } catch (_e) { this.noteFolders = this.noteFolders || []; }
            //  시즌 단계 모듈 (048 을 안 돌렸으면 조용히 비워 둔다)
            try {
                const { data: st } = await this.supabase.from('season_steps').select('*')
                    .eq('active', true).order('sort');
                this.seasonSteps = st || [];
            } catch (_e) { this.seasonSteps = this.seasonSteps || []; }
        } catch (e) { this.noteList = []; this._noteLoaded = true; this.showToast('메모를 불러오지 못했습니다: ' + (e.message || e)); }
        this._noteLoading = false; this.requestRender();
    }
    _noteScopeOf(folderKey) {
        if (folderKey === 'private') return { scope: 'private', owner: this._me(), folder: '개인', product_id: null };
        if ((folderKey || '').startsWith('pf:'))
            return { scope: 'private', owner: this._me(), folder: folderKey.slice(3), product_id: null };
        if ((folderKey || '').startsWith('p:')) {
            const pid = folderKey.slice(2);
            const pr = (mockData.products || []).find(x => x.id === pid);
            return { scope: 'project', owner: null, folder: pr ? pr.name : '시즌', product_id: pid, brand_id: pr?.brand_id || null };
        }
        return { scope: 'shared', owner: null, folder: '공용', product_id: null };
    }
    _me() { return (this.currentUser?.email || '').split('@')[0] || this.currentUser?.name || null; }
    async addNote(folderName) {
        const meta = this._noteScopeOf(this.noteFolder);
        if (folderName) meta.folder = folderName;
        try {
            const { data, error } = await this.supabase.from('notes')
                .insert([{ title: '새 메모', body: '', created_by: this.currentUser?.name || null, ...meta }]).select('*').single();
            if (error) throw error;
            this.noteList = [data, ...(this.noteList || [])]; this.noteSel = data.id;
            this.notePreview = false;            // 새 메모는 바로 쓸 수 있게 편집 상태로
            this.requestRender();
            setTimeout(() => document.getElementById('note-title')?.focus(), 60);
        } catch (e) { this.showToast('메모 추가 실패: ' + (e.message || e)); }
    }
    async saveNote() {
        const n = this._curNote(); if (!n) return;
        const t = document.getElementById('note-title')?.value ?? n.title;
        const typed = this._noteTyped();
        const b = typed == null ? n.body : this._joinNote(this._noteMeta(n), typed);
        if (t === n.title && b === n.body) return;
        n.title = t; n.body = b; n.updated_at = new Date().toISOString();
        try {
            const { error } = await this.supabase.from('notes').update({ title: t, body: b }).eq('id', n.id);
            if (error) throw error;
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    toggleNotePreview() { this.saveNote(); this.notePreview = !this.notePreview; this._nbDrop(); this.requestRender(); }
    // ── 우클릭 메뉴 ───────────────────────────────────────────
    //  맥처럼 그 자리에 뜬다. 바깥을 누르거나 Esc 면 닫힌다.
    ctxMenu(ev, items) {
        ev.preventDefault(); ev.stopPropagation();
        document.getElementById('ctx-menu')?.remove();
        const esc = s => this._vesc(s);
        const el = document.createElement('div');
        el.className = 'stmenu ctxm lg'; el.id = 'ctx-menu';
        el.innerHTML = items.map((it, i) => it.sep
            ? '<div class="stm-sep"></div>'
            : `<button class="stm-item${it.danger ? ' danger' : ''}" data-i="${i}">
                 <i class="ph ${it.icon || 'ph-dot'}"></i><span class="stm-txt">${esc(it.t)}</span></button>`).join('');
        document.body.appendChild(el);
        const w = 210, h = el.offsetHeight || 200;
        el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, ev.clientX)) + 'px';
        el.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, ev.clientY)) + 'px';
        el.classList.add('nocaret');
        el.querySelectorAll('.stm-item').forEach(b => b.onclick = () => {
            const it = items[Number(b.dataset.i)];
            el.remove();
            if (it && it.run) it.run();
        });
        const off = (e) => { if (el.contains(e.target)) return; el.remove(); document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key); };
        const key = (e) => { if (e.key === 'Escape') { el.remove(); document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key); } };
        setTimeout(() => { document.addEventListener('mousedown', off); document.addEventListener('keydown', key); }, 0);
    }
    noteMenu(ev, id) {
        const n = (this.noteList || []).find(x => String(x.id) === String(id)); if (!n) return;
        this.ctxMenu(ev, [
            { t: '열기', icon: 'ph-arrow-square-out', run: () => this.selectNote(id) },
            { t: '이름 바꾸기', icon: 'ph-textbox', run: () => this.renameNote(id) },
            { t: '복제', icon: 'ph-copy', run: () => this.duplicateNote(id) },
            { sep: true },
            { t: '폴더로 옮기기…', icon: 'ph-folder-simple', run: () => this.moveNote(id) },
            { t: n.scope === 'shared' ? '개인으로' : '공용으로', icon: 'ph-users-three', run: () => this.toggleNoteScope(id) },
            { sep: true },
            { t: '삭제', icon: 'ph-trash', danger: true, run: () => { this.noteSel = id; this.deleteNote(); } },
        ]);
    }
    folderMenu(ev, key) {
        const pid = String(key || '').startsWith('p:') ? String(key).slice(2) : null;
        const fname = String(key || '').startsWith('f:') ? String(key).slice(2) : null;
        this.ctxMenu(ev, [
            ...(pid ? [{ t: '속성 · 접근 권한…', icon: 'ph-info', run: () => this.folderInfo(pid) }, { sep: true }] : []),
            ...(fname ? [{ t: '폴더 정보…', icon: 'ph-info', run: () => this.noteFolderInfo(fname) }, { sep: true }] : []),
            { t: '새 폴더', icon: 'ph-folder-plus', run: () => this.addNoteFolder() },
            { t: '이 폴더에 새 메모', icon: 'ph-note-pencil', run: () => { this.noteFolder = key; this.addNote(); } },
            ...(key.startsWith('f:') ? [{ sep: true },
                { t: '폴더 이름 바꾸기', icon: 'ph-textbox', run: () => this.renameNoteFolder(key.slice(2)) }] : []),
        ]);
    }
    async renameNote(id) {
        const n = (this.noteList || []).find(x => String(x.id) === String(id)); if (!n) return;
        const v = await this.showPrompt('메모 이름', n.title || ''); if (v === null) return;
        n.title = v.trim(); this.requestRender();
        try { await this.supabase.from('notes').update({ title: n.title }).eq('id', n.id); }
        catch (e) { this.showToast('이름 바꾸기 실패: ' + (e.message || e)); }
    }
    async duplicateNote(id) {
        const n = (this.noteList || []).find(x => String(x.id) === String(id)); if (!n) return;
        try {
            const { data, error } = await this.supabase.from('notes').insert([{
                title: (n.title || '메모') + ' 사본', body: n.body, folder: n.folder,
                scope: n.scope, owner: n.owner, product_id: n.product_id, brand_id: n.brand_id,
                created_by: this.currentUser?.name || null,
            }]).select('*').single();
            if (error) throw error;
            this.noteList = [data, ...(this.noteList || [])]; this.noteSel = data.id; this.requestRender();
        } catch (e) { this.showToast('복제 실패: ' + (e.message || e)); }
    }
    async moveNote(id) {
        const n = (this.noteList || []).find(x => String(x.id) === String(id)); if (!n) return;
        const folders = [...new Set((this.noteList || []).map(x => x.folder || '메모'))];
        const v = await this.showPrompt(`옮길 폴더 이름\n(있는 폴더: ${folders.join(', ')})`, n.folder || '메모');
        if (v === null || !v.trim()) return;
        n.folder = v.trim(); this.requestRender();
        try { await this.supabase.from('notes').update({ folder: n.folder }).eq('id', n.id); }
        catch (e) { this.showToast('옮기기 실패: ' + (e.message || e)); }
    }
    async toggleNoteScope(id) {
        const n = (this.noteList || []).find(x => String(x.id) === String(id)); if (!n) return;
        const next = n.scope === 'shared' ? 'private' : 'shared';
        n.scope = next; if (next === 'private' && !n.owner) n.owner = this._me();
        this.requestRender();
        try { await this.supabase.from('notes').update({ scope: next, owner: n.owner || null }).eq('id', n.id); }
        catch (e) { this.showToast('바꾸기 실패: ' + (e.message || e)); }
    }
    //  개인 폴더 — 나만 보는 것이라 권한을 물을 게 없다
    async addPrivateFolder() {
        const v = await this.showPrompt('새 개인 폴더 이름', '', '개인 폴더 만들기');
        const name = (v || '').trim(); if (!name) return;
        this.noteFolder = 'pf:' + name;
        await this.addNote(name);
    }
    //  워크스페이스 폴더 — 만들 때 '누가 볼 수 있나' 부터 정한다
    addNoteFolder() {
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const esc = s2 => this._vesc(s2);
        const isMaster = this.currentUser?.role === 'MASTER';
        const accs = (mockData.companies || []).filter(a => a.username);
        c.innerHTML = `<div class="modal-content vmodal fi" style="width:94%;max-width:410px">
            <div class="hk-top"><b>새 폴더</b><button class="fi-x" onclick="app.closeGlobalModal()">×</button></div>
            <div class="fi-r" style="margin-top:12px"><span>이름</span>
                <input id="nfn" class="nw-f" placeholder="예: 팝업 준비" autocomplete="off"></div>
            <div class="fi-sec">누가 볼 수 있나</div>
            ${isMaster ? `
            <label class="pa-opt"><input type="radio" name="nfa" value="all" checked>
                <span><b>모두</b><em>워크스페이스의 모든 계정</em></span></label>
            <label class="pa-opt"><input type="radio" name="nfa" value="members">
                <span><b>지정한 사람만</b><em>아래에서 고른 계정만 이 폴더를 본다</em></span></label>
            <div class="pa-list" id="nfl">
                ${accs.map(a => `<label class="pa-m"><input type="checkbox" value="${esc(a.username)}" ${a.username === this._me() ? 'checked' : ''}>
                    <span class="mrow-face" style="width:24px;height:24px;font-size:11px">${esc((a.name || '?')[0])}</span>
                    <span>${esc(a.name)}<em>${esc(a.username)} · ${a.role === 'MASTER' ? '마스터' : (a.role === 'STAFF' ? '직원' : '파트너')}</em></span></label>`).join('')}
            </div>
            <p class="fi-note">나중에 폴더 우클릭 → 폴더 정보에서 바꿀 수 있습니다. 마스터는 늘 전부 봅니다.</p>
            ` : `<p class="fi-note">만든 폴더는 워크스페이스 모두가 봅니다. 범위를 좁히려면 마스터에게 말씀하세요.</p>`}
            <div class="fi-act">
                <button class="mbtn" onclick="app.closeGlobalModal()">취소</button>
                <button class="mbtn pri" id="nfok">만들기</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        const nm = c.querySelector('#nfn');
        if (isMaster) {
            const sync = () => {
                const v = c.querySelector('input[name=nfa]:checked')?.value;
                const l = c.querySelector('#nfl');
                l.style.opacity = v === 'members' ? '1' : '.4';
                l.style.pointerEvents = v === 'members' ? 'auto' : 'none';
            };
            c.querySelectorAll('input[name=nfa]').forEach(r => r.onchange = sync);
            sync();
        }
        const go = c.querySelector('#nfok');
        nm.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go.click(); } };
        setTimeout(() => nm.focus(), 40);
        go.onclick = async () => {
            const name = nm.value.trim();
            if (!name) { nm.focus(); return; }
            go.disabled = true; go.textContent = '만드는 중...';
            if (isMaster) {
                const access = c.querySelector('input[name=nfa]:checked')?.value || 'all';
                const members = [...c.querySelectorAll('#nfl input:checked')].map(x => x.value);
                if (access === 'members') {
                    const row = { name, access, members };
                    const { error } = await this.supabase.from('note_folders').upsert(row, { onConflict: 'name' });
                    if (error) { go.disabled = false; go.textContent = '만들기'; this.showToast('권한 저장 실패: ' + error.message); return; }
                    this.noteFolders = [...(this.noteFolders || []).filter(x => x.name !== name), row];
                }
            }
            this.closeGlobalModal();
            this.noteFolder = 'f:' + name;
            await this.addNote(name);
        };
    }
    async renameNoteFolder(oldName) {
        const v = await this.showPrompt('폴더 이름', oldName); if (v === null || !v.trim() || v.trim() === oldName) return;
        const hit = (this.noteList || []).filter(n => (n.folder || '') === oldName);
        hit.forEach(n => { n.folder = v.trim(); });
        if (this.noteFolder === 'f:' + oldName) this.noteFolder = 'f:' + v.trim();
        this.requestRender();
        try { await this.supabase.from('notes').update({ folder: v.trim() }).eq('folder', oldName); }
        catch (e) { this.showToast('이름 바꾸기 실패: ' + (e.message || e)); }
    }
    selectNote(id) { this.saveNote(); this._nbDrop(); this.noteSel = id; this.notePreview = false; this.requestRender(); }
    togglePrivFolders() { this.notePrivOpen = this.notePrivOpen === false; this.requestRender(); }
    toggleNoteSeasons() { this.noteSeaOpen = !this.noteSeaOpen; this.requestRender(); }
    setNoteSea(v) { this.noteSea = v; this.noteSel = null; this.requestRender(); }
    //  폴더가 브랜드면 그 브랜드 시즌만 보여준다 — 브랜드와 시즌은 늘 붙어 다닌다.
    //  브랜드를 아직 안 정한 시즌은 어디서나 보인다(다 정해지면 저절로 사라진다).
    _seasonsFor(folderKey) {
        const all = this._seasons();
        const name = String(folderKey || '').replace(/^(f:|pf:)/, '');
        const b = (mockData.brands || []).find(x => x.name === name);
        if (!b) return all;
        return all.filter(p => !p.brand_id || String(p.brand_id) === String(b.id));
    }
    setNoteFolder(f) { this.saveNote(); this._nbDrop(); this.noteFolder = f; this.noteSel = null; this.requestRender(); }
    async deleteNote() {
        const n = this._curNote(); if (!n) return;
        if (!await this.showConfirm(`"${n.title || '제목 없음'}" 메모를 삭제할까요?`, '삭제')) return;
        try {
            const { error } = await this.supabase.from('notes').delete().eq('id', n.id);
            if (error) throw error;
            this.noteList = this.noteList.filter(x => x.id !== n.id); this.noteSel = this.noteList[0]?.id || null;
            this.requestRender();
        } catch (e) { this.showToast('삭제 실패(개인 메모 또는 마스터만 가능): ' + (e.message || e)); }
    }
    // ── 메모 속성 (노션식) ────────────────────────────────────
    //  상태 · 날짜 · 담당자 · 시즌 · 연결된 메모 · 고정하기.
    //  notes 테이블에 컬럼을 더 만들지 않고 본문 첫 줄의 숨은 표시에 담는다
    //  (스키마를 못 건드리는 상황에서도 오늘 바로 쓰려고). 화면엔 안 보인다.
    NOTE_META_RE = /^<!--p (.*?)-->\n?/;
    NOTE_STATUS = [
        { k: '없음', c: '#8e8e93' }, { k: '요청', c: '#a1887f' }, { k: '진행', c: '#0a84ff' },
        { k: '검토', c: '#ff9f0a' }, { k: '완료', c: '#30d158' }, { k: '보류', c: '#ff453a' },
    ];
    _noteMeta(n) {
        const m = (n.body || '').match(this.NOTE_META_RE);
        let meta = {};
        if (m) { try { meta = JSON.parse(m[1]) || {}; } catch (_e) { meta = {}; } }
        return { status: '없음', due: '', who: '', proj: '', links: [], ...meta };
    }
    _noteText(n) { return (n.body || '').replace(this.NOTE_META_RE, ''); }
    _joinNote(meta, text) {
        const bare = { ...meta };
        Object.keys(bare).forEach(k => { if (bare[k] === '' || bare[k] === '없음' || (Array.isArray(bare[k]) && !bare[k].length)) delete bare[k]; });
        return (Object.keys(bare).length ? `<!--p ${JSON.stringify(bare)}-->\n` : '') + text;
    }
    async setNoteProp(key, value) {
        const n = this._curNote(); if (!n) return;
        await this.saveNote();                 // 쓰던 글을 먼저 담는다
        const meta = this._noteMeta(n);
        meta[key] = value;
        n.body = this._joinNote(meta, this._noteText(n));
        n.updated_at = new Date().toISOString();
        this.requestRender();
        try {
            const patch = { body: n.body };
            if (key === 'proj') { patch.product_id = value || null; n.product_id = value || null; }
            const { error } = await this.supabase.from('notes').update(patch).eq('id', n.id);
            if (error) throw error;
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    async toggleNotePin() {
        const n = this._curNote(); if (!n) return;
        n.pinned = !n.pinned; this.requestRender();
        try { await this.supabase.from('notes').update({ pinned: n.pinned }).eq('id', n.id); }
        catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    toggleNoteProps() { this.noteProps = !this.noteProps; this.requestRender(); }
    //  속성은 접혀 있는 게 기본이다 — 본문이 가려지면 메모가 아니다.
    //  접힌 상태에서도 상태·날짜·담당자·시즌은 한 줄로 보인다.
    _notePropsBar(n) {
        const esc = s => this._vesc(s);
        const meta = this._noteMeta(n);
        const open = !!this.noteProps;
        const st = this.NOTE_STATUS.find(x => x.k === (meta.status || '없음')) || this.NOTE_STATUS[0];
        const pr = (mockData.products || []).find(p => String(p.id) === String(meta.proj || n.product_id));
        const bits = [];
        if (meta.status && meta.status !== '없음')
            bits.push(`<em class="np-chip" style="--c:${st.c}">${esc(meta.status)}</em>`);
        if (meta.due) bits.push(`<em class="np-chip"><i class="ph ph-calendar-blank"></i>${esc(meta.due)}</em>`);
        if (meta.who) bits.push(`<em class="np-chip"><i class="ph ph-user"></i>${esc(meta.who)}</em>`);
        if (pr) bits.push(`<em class="np-chip"><i class="ph ph-folder-simple"></i>${esc(pr.name)}</em>`);
        if (n.pinned) bits.push(`<em class="np-chip"><i class="ph-fill ph-push-pin"></i>고정</em>`);
        return `<div class="np-bar${open ? ' on' : ''}" onclick="app.toggleNoteProps()">
            <i class="ph ph-caret-right"></i><b>속성</b>
            ${bits.length ? bits.join('') : '<em class="np-chip none">비어 있음</em>'}
        </div>${open ? this._notePropsHTML(n) : ''}`;
    }
    // 속성 판 — 노션의 페이지 속성 그대로
    _notePropsHTML(n) {
        const esc = s => this._vesc(s);
        const meta = this._noteMeta(n);
        const st = this.NOTE_STATUS.find(x => x.k === (meta.status || '없음')) || this.NOTE_STATUS[0];
        const accs = (mockData.companies || []).filter(c => c.username);
        const projs = this._seasonsFor(n.scope === 'shared' ? (n.folder || '공용') : '');
        const who = accs.find(c => c.name === meta.who);
        const links = (meta.links || []).map(id => (this.noteList || []).find(x => String(x.id) === String(id))).filter(Boolean);
        const row = (icon, label, body) => `<div class="np-r"><span class="np-k"><i class="ph ${icon}"></i>${esc(label)}</span>
            <span class="np-v">${body}</span></div>`;
        return `<div class="npanel">
            ${row('ph-circle-dashed', '상태', `
                <select class="np-sel pill" style="--c:${st.c}" onchange="app.setNoteProp('status',this.value)">
                    ${this.NOTE_STATUS.map(x => `<option value="${x.k}"${x.k === st.k ? ' selected' : ''}>${x.k}</option>`).join('')}
                </select>`)}
            ${row('ph-calendar-blank', '날짜', `
                <input type="date" class="np-in" value="${esc(meta.due || '')}" onchange="app.setNoteProp('due',this.value)">
                ${meta.due ? `<button class="np-x" title="지우기" onclick="app.setNoteProp('due','')">✕</button>` : ''}`)}
            ${row('ph-users', '담당자', `
                <span class="np-who">${who ? `<i class="np-face">${esc((who.name || '?')[0])}</i>` : ''}
                <select class="np-sel" onchange="app.setNoteProp('who',this.value)">
                    <option value="">비어 있음</option>
                    ${accs.map(c => `<option value="${esc(c.name)}"${c.name === meta.who ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
                </select></span>`)}
            ${row('ph-folder-simple', '시즌', `
                <select class="np-sel" onchange="app.setNoteProp('proj',this.value)">
                    <option value="">비어 있음</option>
                    ${projs.map(pr => `<option value="${pr.id}"${String(meta.proj) === String(pr.id) ? ' selected' : ''}>${esc(pr.name)}</option>`).join('')}
                </select>`)}
            ${row('ph-link-simple', '연결된 메모', `
                ${links.map(l => `<button class="np-chip" onclick="app.selectNote('${l.id}')">${esc(l.title || '메모')}
                    <i onclick="event.stopPropagation();app.unlinkNote('${l.id}')">✕</i></button>`).join('')}
                <span class="np-find">
                    <input class="np-in find" id="np-link-q" placeholder="메모 이름으로 찾기" autocomplete="off"
                        oninput="app.linkFind(this.value)" onfocus="app.linkFind(this.value)" onblur="app.linkFindClose()">
                    <div class="np-hits" id="np-link-hits"></div>
                </span>`)}
            ${row('ph-lock-simple', '공개 범위', `
                <select class="np-sel pill" style="--c:${n.scope === 'private' ? '#ff9f0a' : '#30d158'}"
                    onchange="app.setNoteOpen(this.value)">
                    <option value="shared"${n.scope !== 'private' ? ' selected' : ''}>공개</option>
                    <option value="private"${n.scope === 'private' ? ' selected' : ''}>비공개</option>
                </select>
                <span class="np-hint">${n.scope === 'private'
                    ? '만든 사람과 이 시즌 담당자만' : '폴더·시즌 권한이 있는 사람 모두'}</span>`)}
            ${row('ph-push-pin', '고정하기', `
                <button class="np-ck${n.pinned ? ' on' : ''}" onclick="app.toggleNotePin()"></button>`)}
        </div>`;
    }
    async setNoteOpen(v) {
        const n = this._curNote(); if (!n) return;
        n.scope = v; if (v === 'private' && !n.owner) n.owner = this._me();
        this.requestRender();
        try {
            const { error } = await this.supabase.from('notes')
                .update({ scope: v, owner: n.owner || null }).eq('id', n.id);
            if (error) throw error;
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    // ── 메모 사진 첨부 ────────────────────────────────────────
    //  스토리지(bhas 버킷)에 올리고 본문에 ![](주소) 로 끼워 넣는다. 보기 상태에서 사진으로 뜬다.
    // ── 메모 옆 제품리스트 사이드뷰 ──────────────────────────
    //  메모를 쓰면서 제품을 보고 바로 연동한다. 왼쪽에서 밀려 나온다.
    toggleNoteProducts() {
        this.noteProd = !this.noteProd;
        if (this.noteProd && !this._itemsLoaded && !this._itemsLoading) this.loadItems();
        this.requestRender();
    }
    noteProdFind(v) { this.noteProdQ = v; clearTimeout(this._npT); this._npT = setTimeout(() => this.requestRender(), 150); }
    _noteProductsHTML() {
        if (!this.noteProd) return '';
        const esc = s => this._vesc(s);
        const seasons = this._seasons();
        const items = this.pItems || [];
        const back = (to, label) => `<button class="npv-back" onclick="${to}"><i class="ph ph-caret-left"></i>${esc(label)}</button>`;

        //  ③ 제품 페이지 — 사이드바 자리까지 덮고 넓게. 사진 붙이고 글도 쓴다.
        if (this.npItem) {
            const it = items.find(x => String(x.id) === String(this.npItem));
            if (it) {
                const sea = seasons.find(p => String(p.id) === String(it.product_id));
                const ven = (this.vendors || []).find(v => String(v.id) === String(it.vendor_id));
                const tp = (this._techPacks || []).find(t => String(t.id) === String(it.tech_pack_id));
                const col = this.ITEM_SC[it.status] || '#8e8e93';
                const note = this._itemNoteOf(it.id);
                const text = note ? this._noteText(note) : '';
                const f = (k, v) => v ? `<span class="ip-f"><em>${esc(k)}</em>${esc(String(v))}</span>` : '';
                return `<aside class="npv wide">
                    <div class="npv-top">${back(`app.npOpen('${it.product_id || ''}')`, sea ? sea.name : '제품')}
                        <button class="fi-x" onclick="app.toggleNoteProducts()">×</button></div>
                    <div class="npv-b ip">
                        <div class="ip-h">
                            <b>${esc(it.name || '이름 없는 제품')}</b>
                            <em class="it-tag" style="--c:${col}">${esc(it.status || '')}</em>
                        </div>
                        <div class="ip-fs">
                            ${f('브랜드', this._brandNameById(it.brand_id))}${f('패턴명', it.pattern_no)}
                            ${f('시즌', sea ? sea.name : '')}${f('공장', ven ? ven.name : '')}
                            ${f('출고예정', it.ship_date)}${f('오픈', it.open_date)}
                            ${(it.sale_names || []).length ? f('판매명', (it.sale_names || []).join(' · ')) : ''}
                        </div>
                        <div class="ip-tools">
                            <button onclick="app.itemNoteInsert('todo')" title="할 일 [ ]"><i class="ph ph-check-square"></i></button>
                            <button onclick="app.pickItemPhoto('${it.id}')" title="사진 넣기"><i class="ph ph-image"></i></button>
                            <span class="nt-div"></span>
                            <button class="${this.ipPreview ? 'on' : ''}" onclick="app.toggleItemPreview()"
                                title="${this.ipPreview ? '고치기' : '보기'}"><i class="ph ${this.ipPreview ? 'ph-pencil-simple' : 'ph-eye'}"></i></button>
                            ${tp ? `<button onclick="app.openTechPack('${tp.id}')" title="작업지시서"><i class="ph ph-clipboard-text"></i></button>` : ''}
                            <span class="ip-sv" id="ip-sv"></span>
                        </div>
                        ${this.ipPreview
                            ? `<div class="ip-doc nb">${note ? this._noteBodyHTML(note) : '<div class="np-none">아직 적은 게 없습니다</div>'}</div>`
                            : `<textarea id="item-note" class="ip-ta" placeholder="여기에 적으세요 · [ ] 로 할 일 · 사진은 위 아이콘으로"
                                oninput="app.itemNoteTyping()" onblur="app.saveItemNote('${it.id}')">${esc(text)}</textarea>`}
                    </div>
                    <div class="npv-act">
                        <button class="mbtn pri" onclick="app.quoteProduct('${it.id}')"><i class="ph ph-quotes"></i> 메모에 인용</button>
                        <button class="mbtn" onclick="app.npOpen('${it.product_id || ''}')">목록으로</button>
                    </div>
                </aside>`;
            }
        }

        //  ② 한 시즌의 제품
        if (this.npSea !== undefined && this.npSea !== null) {
            const sea = seasons.find(p => String(p.id) === String(this.npSea));
            const list = items.filter(i => String(i.product_id || '') === String(this.npSea));
            return `<aside class="npv">
                <div class="npv-top">${back('app.npOpen(null)', '시즌')}
                    <button class="fi-x" onclick="app.toggleNoteProducts()">×</button></div>
                <div class="npv-sub">${esc(sea ? sea.name : '시즌 없음')} · 제품 ${list.length}</div>
                <div class="npv-b">${list.length ? list.map(i => {
                    const col = this.ITEM_SC[i.status] || '#8e8e93';
                    return `<div class="npv-i">
                        <span class="npv-t2"><b>${esc(i.name || '이름 없는 제품')}</b>
                            <em>${esc([i.pattern_no, i.status].filter(Boolean).join(' · '))}</em></span>
                        <span class="npv-d" style="background:${col}"></span>
                        <span class="npv-bs">
                            <button class="npv-b1" title="메모에 인용" onclick="app.quoteProduct('${i.id}')">인용</button>
                            <button class="npv-b2" title="제품 자세히" onclick="app.npItemOpen('${i.id}')">보기</button>
                        </span>
                    </div>`;
                }).join('') : '<div class="np-none">이 시즌에 제품이 없습니다</div>'}</div>
            </aside>`;
        }

        //  ① 시즌 폴더
        const cnt = pid => items.filter(i => String(i.product_id || '') === String(pid)).length;
        const noSea = items.filter(i => !i.product_id).length;
        return `<aside class="npv">
            <div class="npv-top"><b>제품리스트</b>
                <button class="fi-x" onclick="app.toggleNoteProducts()">×</button></div>
            <div class="npv-b">
                ${!this._itemsLoaded ? '<div class="np-none">제품을 불러오는 중…</div>' : `
                ${seasons.map(p => `<div class="npv-fdw">
                    <button class="npv-fd" onclick="app.npOpen('${p.id}')">
                        <i class="ph-fill ph-folder" style="color:${((mockData.brands || []).find(b => b.id === p.brand_id) || {}).brand_color || '#5ac8fa'}"></i>
                        <span>${esc(p.name)}${p.access === 'members' ? ' <i class="ph-fill ph-lock-simple" title="담당자만"></i>' : ''}</span><em>${cnt(p.id)}</em>
                        <i class="ph ph-caret-right npv-c"></i></button>
                    <button class="npv-fi" title="속성 · 접근 권한"
                        onclick="event.stopPropagation();app.folderInfo('${p.id}')"><i class="ph ph-info"></i></button>
                </div>`).join('')}
                ${noSea ? `<button class="npv-fd" onclick="app.npOpen('')">
                    <i class="ph-fill ph-folder" style="color:#8e8e93"></i>
                    <span>시즌 없음</span><em>${noSea}</em>
                    <i class="ph ph-caret-right npv-c"></i></button>` : ''}
                ${!seasons.length && !noSea ? '<div class="np-none">제품이 없습니다</div>' : ''}`}
            </div>
            <div class="npv-hint">시즌을 열어 제품을 고르세요 · <b>인용</b> 은 메모에 넣고 <b>보기</b> 는 자세히 봅니다</div>
        </aside>`;
    }
    npOpen(pid) { this.npSea = (pid === null ? null : pid); this.npItem = null; this._itemPhotoFor = null; this.requestRender(); }
    //  제품 페이지의 글은 그 제품에 붙은 메모 한 장에 담는다
    //  (새 표를 만들지 않는다 — 메모엔 사진·[ ] 할 일이 이미 붙어 있다)
    _itemNoteOf(id) { return (this.noteList || []).find(n => String(n.item_id) === String(id)); }
    toggleItemPreview() { this.ipPreview = !this.ipPreview; this.requestRender(); }
    itemNoteTyping() {
        clearTimeout(this._ipT);
        const sv = document.getElementById('ip-sv') || document.getElementById('ip-sv-d');
        if (sv) sv.textContent = '쓰는 중…';
        const who = document.getElementById('item-note') ? this.npItem : this.itemSel;
        this._ipT = setTimeout(() => this.saveItemNote(who), 900);
    }
    _ipTa() { return document.getElementById('item-note') || document.getElementById('item-note-d'); }
    itemNoteInsert(kind) {
        const ta = this._ipTa(); if (!ta) return;
        const ins = kind === 'todo' ? '[ ] ' : '';
        const p = ta.selectionStart;
        const pre = (p === 0 || ta.value[p - 1] === '\n') ? '' : '\n';
        ta.value = ta.value.slice(0, p) + pre + ins + ta.value.slice(p);
        const np = p + pre.length + ins.length;
        ta.focus(); ta.setSelectionRange(np, np);
        this.itemNoteTyping();
    }
    async saveItemNote(id, textOverride) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return null;
        const ta = this._ipTa();
        const text = textOverride != null ? textOverride : (ta ? ta.value : null);
        if (text == null) return this._itemNoteOf(id);
        let n = this._itemNoteOf(id);
        const sv = document.getElementById('ip-sv') || document.getElementById('ip-sv-d');
        if (n) {
            const body = this._joinNote(this._noteMeta(n), text);
            if (body === n.body) { if (sv) sv.textContent = ''; return n; }
            n.body = body; n.updated_at = new Date().toISOString();
            const { error } = await this.supabase.from('notes').update({ body }).eq('id', n.id);
            if (sv) sv.textContent = error ? '저장 못 함' : '저장됨';
            if (error) this.showToast('저장 실패: ' + error.message);
            setTimeout(() => { const s2 = document.getElementById('ip-sv') || document.getElementById('ip-sv-d');
                if (s2) s2.textContent = ''; }, 1400);
            return n;
        }
        if (!text.trim()) return null;
        const sea = this._seasons().find(p => String(p.id) === String(it.product_id));
        const row = {
            title: it.name || '제품', body: text, item_id: it.id,
            product_id: it.product_id || null, brand_id: it.brand_id || null,
            folder: sea ? sea.name : '제품', scope: it.product_id ? 'project' : 'shared',
            created_by: this._actor(),
        };
        const { data, error } = await this.supabase.from('notes').insert([row]).select().single();
        if (error) { this.showToast('저장 실패 (047 SQL 필요): ' + error.message); return null; }
        this.noteList = [data, ...(this.noteList || [])];
        if (sv) sv.textContent = '저장됨';
        return data;
    }
    //  사진은 그 제품 메모에 붙인다
    async pickItemPhoto(id) {
        let n = this._itemNoteOf(id);
        if (!n) n = await this.saveItemNote(id, (this._ipTa() || {}).value || ' ');
        if (!n) { this.showToast('먼저 한 글자라도 적어주세요'); return; }
        this.noteSel = n.id; this._noteShown = n.id;
        const ta2 = this._ipTa();
        this._notePhotoAt = ta2 ? ta2.selectionStart : null;
        this._itemPhotoFor = id;
        this.pickNotePhoto();
    }
    npItemOpen(id) { this.npItem = id; this.requestRender(); }
    //  인용 — 쓰던 자리에 제품 이름을 넣고, 이 메모를 그 시즌에 붙인다
    async quoteProduct(id) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        this.insertProduct(id);
        if (it.product_id) await this.linkNoteSeason(it.product_id);
        else this.showToast(`'${it.name || '제품'}' 을 넣었습니다`);
    }

    //  제품 이름을 쓰던 자리에 넣는다
    insertProduct(id) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        const ta = this._nbTA();
        if (!ta) { this.showToast('메모를 열고 눌러주세요'); return; }
        const p = ta.selectionStart;
        const name = it.name || '제품';
        ta.value = ta.value.slice(0, p) + name + ta.value.slice(p);
        const np = p + name.length;
        ta.focus(); ta.setSelectionRange(np, np);
        this.saveNote();
    }
    //  이 메모를 그 시즌에 붙인다
    async linkNoteSeason(pid) {
        const n = this._curNote(); if (!n) { this.showToast('메모를 먼저 여세요'); return; }
        const sea = this._seasons().find(p => String(p.id) === String(pid));
        n.product_id = pid;
        const meta = this._noteMeta(n); meta.proj = pid;
        n.body = this._joinNote(meta, this._noteText(n));
        const { error } = await this.supabase.from('notes')
            .update({ product_id: pid, body: n.body }).eq('id', n.id);
        if (error) { this.showToast('붙이지 못했습니다: ' + error.message); return; }
        this.requestRender();
        this.showToast(`'${(sea && sea.name) || '시즌'}' 에 붙였습니다`);
    }

    //  지금 화면에 떠 있는 메모 (고르지 않았어도 첫 메모가 떠 있다)
    _curNote() {
        return (this.noteList || []).find(x => x.id === this.noteSel)
            || (this.noteList || []).find(x => x.id === this._noteShown)
            || null;
    }
    pickNotePhoto() {
        const n = this._curNote(); if (!n) { this.showToast('메모가 없습니다. 먼저 하나 만드세요.'); return; }
        //  고르기 창이 뜨면 커서 자리를 잃는다 — 지금 자리를 적어 둔다
        this._notePhotoAt = this._nbAbs();
        let el = document.getElementById('note-photo-input');
        if (!el) {
            el = document.createElement('input');
            el.type = 'file'; el.id = 'note-photo-input'; el.accept = 'image/*'; el.multiple = true;
            el.style.display = 'none'; document.body.appendChild(el);
        }
        el.onchange = async (e) => {
            const files = [...(e.target.files || [])]; e.target.value = '';
            for (const f of files) await this.attachNotePhoto(f);
        };
        el.click();
    }
    async attachNotePhoto(file) {
        const n = this._curNote(); if (!n) return;
        this.showToast('사진 올리는 중…');
        try {
            const blob = await this.resizeImage(file);
            const safe = (file.name || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `notes/${n.id}/${Date.now()}_${safe}`;
            const { error: upErr } = await this.supabase.storage.from('bhas')
                .upload(path, blob, { contentType: file.type || 'image/jpeg', upsert: false });
            if (upErr) throw upErr;
            const { data } = this.supabase.storage.from('bhas').getPublicUrl(path);
            const url = data.publicUrl;
            const ta = document.getElementById('note-raw');
            //  글을 쓰던 중이면 화면의 글을 믿는다(아직 저장 안 된 글자가 있을 수 있다)
            const text = this._noteTyped() ?? this._noteText(n);
            let at = this._notePhotoAt;
            if (at == null || at > text.length) at = text.length;
            const before = text.slice(0, at), after = text.slice(at);
            const pre = (before && !before.endsWith('\n')) ? '\n' : '';
            const post = (after && !after.startsWith('\n')) ? '\n' : '';
            const mark = `![사진](${url})`;
            const next = before + pre + mark + post + after;
            this._notePhotoAt = at + pre.length + mark.length + post.length;   // 여러 장이면 뒤로 이어 붙는다

            n.body = this._joinNote(this._noteMeta(n), next);
            n.updated_at = new Date().toISOString();
            const { error } = await this.supabase.from('notes').update({ body: n.body }).eq('id', n.id);
            if (error) throw error;
            //  제품 페이지에서 넣은 사진은 그쪽 글칸에 꽂는다
            const ipTa = this._ipTa();
            if (this._itemPhotoFor && ipTa) {
                const at2 = Math.min(this._notePhotoAt ?? ipTa.value.length, ipTa.value.length);
                const b2 = ipTa.value.slice(0, at2), a2 = ipTa.value.slice(at2);
                const p2 = (b2 && !b2.endsWith('\n')) ? '\n' : '';
                const q2 = (a2 && !a2.startsWith('\n')) ? '\n' : '';
                ipTa.value = b2 + p2 + mark + q2 + a2;
                this._notePhotoAt = at2 + p2.length + mark.length + q2.length;
                ipTa.focus(); ipTa.setSelectionRange(this._notePhotoAt, this._notePhotoAt);
                await this.saveItemNote(this._itemPhotoFor);
                this.showToast('사진을 넣었습니다');
                return;
            }
            //  보기 모드로 튕기지 않는다 — 쓰던 자리에 그대로 있게
            if (ta) {
                ta.value = next;
                ta.focus();
                ta.setSelectionRange(this._notePhotoAt, this._notePhotoAt);
            } else { this._nbDrop(); this.requestRender(); }
            this.showToast('커서 자리에 사진을 넣었습니다');
        } catch (e) { this.showToast('사진 올리기 실패: ' + (e.message || e)); }
    }
    linkNote(id) {
        if (!id) return;
        const n = this._curNote(); if (!n) return;
        const meta = this._noteMeta(n);
        const links = [...new Set([...(meta.links || []), id])];
        this.setNoteProp('links', links);
    }
    unlinkNote(id) {
        const n = this._curNote(); if (!n) return;
        const meta = this._noteMeta(n);
        this.setNoteProp('links', (meta.links || []).filter(x => String(x) !== String(id)));
    }
    // ── 메모 안의 할 일 · 태그 ────────────────────────────────
    //  본문 줄머리에 [] / [x] 를 쓰면 할 일이 된다(노션의 to-do 블록).
    //  @이름 을 쓰면 담당자, #말머리 는 꼬리표. 체크한 것은 할 일에도 뜬다.
    NOTE_TODO_RE = /^(\s*)\[( |x|X)?\]\s?(.*)$/;
    _noteTodos(n) {
        const out = [];
        this._noteText(n).split('\n').forEach((line, i) => {
            const m = line.match(this.NOTE_TODO_RE);
            if (!m) return;
            const raw = (m[3] || '').trim();
            if (!raw) return;             // 아직 아무것도 안 적은 줄은 할 일이 아니다
            //  날짜는 한 군데(_splitDue)에서만 떼어낸다 — '까지' 같은 꼬리말도 같이 떨어진다
            const sp = this._splitDue(raw);
            out.push({
                src: 'note', id: `${n.id}#${i}`, noteId: n.id, line: i,
                title: sp.text.replace(/[@#][^\s]+/g, '').replace(/\s{2,}/g, ' ').trim() || '(내용 없음)',
                done: (m[2] || ' ').toLowerCase() === 'x',
                at: (raw.match(/@([^\s]+)/g) || []).map(x => x.slice(1)),
                tags: (raw.match(/#([^\s]+)/g) || []).map(x => x.slice(1)),
                due: sp.due || n.due_date || null,
                from: n.title || '메모',
            });
        });
        return out;
    }
    _allNoteTodos() { return (this.noteList || []).flatMap(n => this._noteTodos(n)); }
    // 날짜가 붙은 모든 것 한 벌 — 홈의 할 일 칸과 통합 캘린더가 같이 쓴다
    _allDated() {
        const out = [];
        (this.remList || []).forEach(r => out.push({
            //  기본 분류면 이름을 또 적지 않는다 — 칸 이름이 이미 '할 일' 이다
            date: r.due_date, title: r.title, sub: /^(기본|미리\s*알림)$/.test(r.list_name || '') ? '' : (r.list_name || ''),
            done: !!r.done, color: '#ff9f0a', kind: 'rem', view: 'reminders', tag: '할 일',
        }));
        (mockData.products || []).forEach(p => {
            (p.todos || []).forEach(t => out.push({
                date: t.due_date, title: t.text, sub: p.name,
                done: !!t.completed, color: '#0a84ff', kind: 'todo', view: 'reminders', tag: '시즌',
            }));
            if (p.due_date) out.push({
                date: p.due_date, title: p.name, sub: '시즌 마감',
                done: (p.currentStage || '') === 'shipping', color: '#bf5af2', kind: 'proj', view: 'dashboard',
                tag: '시즌', go: `app.openSeasonItems('${p.id}')`,
            });
        });
        //  날짜가 붙은 메모는 그 자체로 한 건이다 — 시즌 단계(촬영·오픈…)가 여기 해당한다
        (this.noteList || []).forEach(n => {
            const due = this._noteMeta(n).due;
            if (!due) return;
            const td = this._noteTodos(n);
            out.push({
                date: due, title: n.title || '메모', sub: '',
                done: td.length ? td.every(x => x.done) : (this._noteMeta(n).status === '완료'),
                color: '#bf5af2', kind: 'step', view: 'notes', tag: '단계',
                go: `app.findGo('notes','${n.id}')`,
            });
        });
        //  단계 메모는 위에서 한 줄로 넣었다 — 그 안의 세부까지 또 늘어놓지 않는다
        const stepNotes = new Set((this.noteList || []).filter(n => this._noteMeta(n).due).map(n => String(n.id)));
        this._allNoteTodos().forEach(t => {
            if (stepNotes.has(String(t.noteId))) return;
            out.push({
                date: t.due, title: t.title, sub: t.from,
                done: t.done, color: '#30d158', kind: 'note', view: 'notes', tag: '메모',
                go: `app.findGo('notes','${t.noteId}')`,
            });
        });
        (this.vendors || []).forEach(v => (v.jobs || []).forEach(j => out.push({
            date: j.due_date, title: j.title || '작업', sub: v.name,
            done: j.status === 'done', color: '#6366f1', kind: 'job', view: 'vendors', tag: '생산',
            go: `app.goVendorJob('${v.id}')`,
        })));
        return out;
    }
    // 메모 본문의 그 줄만 [ ] ↔ [x] 로 뒤집고 저장한다
    async toggleNoteTodo(noteId, line) {
        const n = (this.noteList || []).find(x => String(x.id) === String(noteId)); if (!n) return;
        const lines = this._noteText(n).split('\n');
        const m = (lines[line] || '').match(this.NOTE_TODO_RE); if (!m) return;
        const now = (m[2] || ' ').toLowerCase() === 'x';
        lines[line] = `${m[1]}[${now ? ' ' : 'x'}] ${m[3]}`;
        n.body = this._joinNote(this._noteMeta(n), lines.join('\n'));
        this.requestRender();
        try {
            const { error } = await this.supabase.from('notes').update({ body: n.body }).eq('id', n.id);
            if (error) throw error;
        } catch (e) { this.showToast('메모 저장 실패: ' + (e.message || e)); }
    }
    // 본문을 읽기 좋게 — 할 일은 체크박스로, @는 담당자, #는 꼬리표로 칠한다
    _noteBodyHTML(n) {
        const esc = s => this._vesc(s);
        return this._noteText(n).split('\n').map((line, i) => {
            const m = line.match(this.NOTE_TODO_RE);
            if (m) {
                const done = (m[2] || ' ').toLowerCase() === 'x';
                const body = esc(m[3]).replace(/@([^\s]+)/g, '<b class="nb-at">@$1</b>')
                                      .replace(/#([^\s]+)/g, '<b class="nb-tag">#$1</b>');
                return `<div class="nb-todo${done ? ' done' : ''}">
                    <button class="nb-ck${done ? ' on' : ''}" onclick="app.toggleNoteTodo('${n.id}',${i})"></button>
                    <span>${body}</span></div>`;
            }
            const img = line.match(/^!\[[^\]]*\]\((.+?)\)\s*$/);
            if (img) return `<span class="nb-ph">
                <img class="nb-img" src="${esc(img[1])}" alt="" onclick="app.showFileModal('${esc(img[1])}','사진')">
                <button class="nb-ph-x" title="사진 지우기" onclick="event.stopPropagation();app.removeNotePhoto(${i})"><i class="ph ph-x"></i></button>
            </span>`;
            if (!line.trim()) return '<div class="nb-sp"></div>';
            const body = esc(line).replace(/@([^\s]+)/g, '<b class="nb-at">@$1</b>')
                                  .replace(/#([^\s]+)/g, '<b class="nb-tag">#$1</b>');
            return `<div class="nb-l">${body}</div>`;
        }).join('');
    }
    //  사진 지우기 — 그 줄만 들어낸다
    async removeNotePhoto(lineNo) {
        const n = this._curNote(); if (!n) return;
        await this.saveNote();                 // 줄 번호가 어긋나지 않게 먼저 담는다
        const lines = this._noteText(n).split('\n');
        const line = lines[lineNo] || '';
        if (!/^!\[[^\]]*\]\(.+?\)\s*$/.test(line)) return;
        const ok = await this.showConfirm('이 사진을 지울까요?', '사진 삭제');
        if (!ok) return;
        lines.splice(lineNo, 1);
        const next = lines.join('\n');
        n.body = this._joinNote(this._noteMeta(n), next);
        n.updated_at = new Date().toISOString();
        const { error } = await this.supabase.from('notes').update({ body: n.body }).eq('id', n.id);
        if (error) { this.showToast('지우지 못했습니다: ' + error.message); return; }
        this._nbDrop(); this.requestRender();
        this.showToast('사진을 지웠습니다');
    }


    // ── 메모 본문 live 편집 ───────────────────────────────────
    //  맥 '메모' 처럼 체크박스가 보이는 채로 고친다. 한 줄만 글칸이고
    //  나머지는 그려진 상태다. 줄머리에 [ ] 를 치면 그 자리에서 네모가 된다.
    _nbTA() { return document.getElementById('note-body') || document.getElementById('note-raw'); }
    _nbLoad(n) {
        if (this._nbFor !== n.id || !this._nbLines) {
            this._nbFor = n.id;
            this._nbLines = this._noteText(n).split('\n');
            if (!this._nbLines.length) this._nbLines = [''];
            this.nbLine = null;
        }
        return this._nbLines;
    }
    _nbDrop() { this._nbFor = null; this._nbLines = null; this.nbLine = null; this._nbPre = ''; }
    _nbPreOf(line) {
        const m = String(line).match(this.NOTE_TODO_RE);
        return m ? `${m[1]}[${(m[2] || ' ').toLowerCase() === 'x' ? 'x' : ' '}] ` : '';
    }
    //  글칸의 글자를 줄 꾸러미에 되돌린다
    _nbSync() {
        const ta = document.getElementById('note-body');
        if (!ta || this.nbLine == null || !this._nbLines) return;
        if (Number(ta.dataset.i) !== this.nbLine) return;   // 아직 다시 그리기 전 — 덮어쓰면 줄이 어긋난다
        this._nbLines[this.nbLine] = (this._nbPre || '') + ta.value;
    }
    //  지금 화면에 쓰여 있는 본문 전체 (원문칸이면 그 값, live 면 줄을 이어서)
    _noteTyped() {
        const raw = document.getElementById('note-raw');
        if (raw) return raw.value;
        const cur = this._curNote();
        if (this._nbLines && cur && this._nbFor === cur.id) { this._nbSync(); return this._nbLines.join('\n'); }
        return null;
    }
    //  본문 전체에서 커서가 몇 번째 글자인지 (사진 넣을 자리 계산용)
    _nbAbs() {
        const raw = document.getElementById('note-raw');
        if (raw) return raw.selectionStart;
        const ta = document.getElementById('note-body');
        if (!ta || this.nbLine == null || !this._nbLines) return null;
        let at = 0;
        for (let i = 0; i < this.nbLine; i++) at += this._nbLines[i].length + 1;
        return at + (this._nbPre || '').length + ta.selectionStart;
    }
    _nbGrow(ta) { if (ta) { ta.style.height = 'auto'; ta.style.height = Math.max(24, ta.scrollHeight) + 'px'; } }
    _nbFocus() {
        requestAnimationFrame(() => {
            const ta = document.getElementById('note-body'); if (!ta) return;
            const c = this._nbCaret;
            const at = (c == null || c < 0) ? ta.value.length : Math.min(c, ta.value.length);
            ta.focus(); ta.setSelectionRange(at, at); this._nbGrow(ta);
            this._nbCaret = null;
        });
    }
    _nbSave() { clearTimeout(this._nbT); this._nbT = setTimeout(() => this.saveNote(), 700); }
    nbPick(i, toStart) {
        if (this.nbLine === i) return;              // 이미 그 줄이면 그대로 둔다
        this._nbSync();
        if (this.nbLine != null) this._fixWhenInLine(this.nbLine);   // '내일' 을 실제 날짜로
        this.nbLine = i; this._nbCaret = toStart ? 0 : -1;
        this._nbPaint();
    }
    //  빈 바닥을 누르면 마지막 줄로 간다 (없으면 한 줄 만든다)
    nbBlank(ev) {
        if (ev.target.closest('.nb-row,.nb-in,.nb-ck')) return;
        const L = this._nbLines; if (!L) return;
        if (L.length && L[L.length - 1].trim() !== '') L.push('');
        this.nbPick(L.length - 1);
    }
    nbToggle(i) {
        this._nbSync();
        const L = this._nbLines; if (!L) return;
        const m = (L[i] || '').match(this.NOTE_TODO_RE); if (!m) return;
        const now = (m[2] || ' ').toLowerCase() === 'x';
        L[i] = `${m[1]}[${now ? ' ' : 'x'}] ${m[3]}`;
        if (i === this.nbLine) this._nbPre = this._nbPreOf(L[i]);
        this.saveNote(); this._nbPaint();
    }
    nbInput(ev) {
        const ta = ev.target;
        //  [] · [ ] · [x] 를 치면 그 줄이 할 일 줄이 된다 — 네모가 바로 생긴다
        if (!this._nbPre) {
            const m = ta.value.match(/^(\s*)\[( |x|X)?\]\s?/);
            if (m) {
                const pre = `${m[1]}[${(m[2] || ' ').toLowerCase() === 'x' ? 'x' : ' '}] `;
                const rest = ta.value.slice(m[0].length);
                this._nbLines[this.nbLine] = pre + rest;
                this._nbPre = pre; ta.value = rest;        // 머리표는 네모가 맡는다
                this._nbCaret = 0;
                this.saveNote(); this._nbPaint();
                return;
            }
            //  '- ' 는 글머리로
            if (ta.value === '- ') { ta.value = '· '; ta.setSelectionRange(2, 2); }
        }
        this._nbSync(); this._nbGrow(ta); this.noteTyping(); this._nbSave();
    }
    nbKey(ev) {
        //  @ 목록이 떠 있으면 Enter·Tab 은 '고르기' 다. 줄을 넘기지 않는다.
        //  한글은 조합 중에 Enter 가 오기도 해서 _atHits 말고 화면에 뜬 목록으로 본다.
        if (document.getElementById('at-pop') && this._atHits && this._atHits.length) {
            if (ev.key === 'Enter' || ev.key === 'Tab') {
                ev.preventDefault(); ev.stopPropagation();
                this.pickAt(this._atSel || 0);
                return;
            }
            if (['ArrowDown', 'ArrowUp', 'Escape'].includes(ev.key)) { this.noteKey(ev); return; }
        }
        //  한글을 조합하는 중의 Enter 는 '글자 확정' 이다 — 줄을 넘기면 안 된다
        if (ev.isComposing || ev.keyCode === 229) return;
        const ta = ev.target, i = this.nbLine, L = this._nbLines;
        if (i == null || !L) return;
        if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            const pre = this._nbPre || '', at = ta.selectionStart;
            if (pre && !ta.value.trim()) { L[i] = ''; this._nbPre = ''; this._nbCaret = 0; }   // 빈 할 일에서 Enter → 네모를 뗀다
            else {
                L[i] = pre + ta.value.slice(0, at);
                L.splice(i + 1, 0, pre + ta.value.slice(at));
                this._fixWhenInLine(i);                     // '내일' 을 실제 날짜로
                this.nbLine = i + 1; this._nbCaret = 0;
            }
            this.saveNote(); this._nbPaint();
            return;
        }
        if (ev.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
            ev.preventDefault();
            if (this._nbPre) { L[i] = ta.value; this._nbPre = ''; this._nbCaret = 0; }   // 네모만 뗀다
            else if (i > 0) {
                const prev = L[i - 1];
                if (/^!\[[^\]]*\]\(.+?\)\s*$/.test(prev)) { L.splice(i - 1, 1); this.nbLine = i - 1; this._nbCaret = 0; }
                else {
                    const p2 = this._nbPreOf(prev), t2 = prev.slice(p2.length);
                    L[i - 1] = p2 + t2 + ta.value; L.splice(i, 1);
                    this.nbLine = i - 1; this._nbCaret = t2.length;
                }
            } else return;
            this.saveNote(); this._nbPaint();
            return;
        }
        if ((ev.key === 'ArrowUp' && ta.selectionStart === 0 && i > 0)
         || (ev.key === 'ArrowDown' && ta.selectionStart === ta.value.length && i < L.length - 1)) {
            ev.preventDefault(); this._nbSync();
            this._fixWhenInLine(i);
            this.nbLine = i + (ev.key === 'ArrowUp' ? -1 : 1); this._nbCaret = -1;
            this._nbPaint();
            return;
        }
        this.noteKey(ev);
    }
    nbBlur() { setTimeout(() => this.closeAtPop(), 120); this._nbSync(); this.saveNote(); }
    //  본문을 그린다 — 고르는 줄만 글칸, 나머지는 읽기 좋은 모습
    _noteLiveHTML(n) {
        const esc = s => this._vesc(s);
        const paint = t => esc(t).replace(/@([^\s]+)/g, '<b class="nb-at">@$1</b>')
                                 .replace(/#([^\s]+)/g, '<b class="nb-tag">#$1</b>');
        const lines = this._nbLoad(n);
        const body = lines.map((line, i) => {
            const img = line.match(/^!\[[^\]]*\]\((.+?)\)\s*$/);
            if (img) return `<div class="nb-row"><span class="nb-ph">
                <img class="nb-img" src="${esc(img[1])}" alt="" onclick="app.showFileModal('${esc(img[1])}','사진')">
                <button class="nb-ph-x" title="사진 지우기" onclick="event.stopPropagation();app.removeNotePhoto(${i})"><i class="ph ph-x"></i></button>
            </span></div>`;
            const m = line.match(this.NOTE_TODO_RE);
            const done = !!m && (m[2] || ' ').toLowerCase() === 'x';
            const raw = m ? m[3] : line;
            const live = i === this.nbLine;
            if (live) this._nbPre = m ? `${m[1]}[${done ? 'x' : ' '}] ` : '';
            //  고치는 줄은 날것 그대로, 아닌 줄은 날짜를 떼어 칩으로 보여준다
            const sp = m && !live ? this._splitDue(raw) : { text: raw, due: '' };
            const inner = live
                ? `<textarea id="note-body" class="nb-in" rows="1" spellcheck="false" data-i="${i}"
                     oninput="app.nbInput(event)" onkeydown="app.nbKey(event)" onblur="app.nbBlur()">${esc(raw)}</textarea>`
                : `<span class="nb-t">${sp.text.trim() ? paint(sp.text) : '<i class="nb-e"></i>'}</span>`;
            if (m) return `<div class="nb-row nb-todo${done ? ' done' : ''}" onclick="app.nbPick(${i})">
                <button class="nb-ck${done ? ' on' : ''}" onclick="event.stopPropagation();app.nbToggle(${i})"></button>${inner}
                ${this._dueChip(i, sp.due, live)}</div>`;
            return `<div class="nb-row nb-l" onclick="app.nbPick(${i})">${inner}</div>`;
        }).join('');
        return `<div class="nt-live" onclick="app.nbBlank(event)">${body}
            ${lines.length === 1 && !lines[0] && this.nbLine == null ? '<div class="nb-hint">내용을 적어주세요 · [ ] 를 치면 할 일이 됩니다</div>' : ''}</div>`;
    }

    //  .nt-live 만 다시 그린다 — 줄 하나 옮길 때마다 화면 전체를 그리면 손이 느려진다
    _nbPaint() {
        const n = this._curNote(); if (!n) { this.requestRender(); return; }
        const el = document.querySelector('.nt-live');
        if (!el) { this.requestRender(); return; }
        el.outerHTML = this._noteLiveHTML(n);
        const mt = document.querySelector('.nt-meta-slot');
        if (mt) mt.innerHTML = this._noteMetaChips(n);
        this._nbFocusNow();
    }
    _nbFocusNow() {
        const ta = document.getElementById('note-body'); if (!ta) return;
        const c = this._nbCaret;
        const at = (c == null || c < 0) ? ta.value.length : Math.min(c, ta.value.length);
        ta.focus(); ta.setSelectionRange(at, at); this._nbGrow(ta);
        this._nbCaret = null;
    }
    // ── 날짜 — '내일까지' 라고 써도 알아듣는다 ──────────────────
    _ymd(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    _plusDays(k) { const d = new Date(); d.setDate(d.getDate() + k); return this._ymd(d); }
    //  요일 이름으로 다음 그 요일을 찾는다 (이번주/다음주)
    _nextDow(dow, nextWeek) {
        const d = new Date();
        if (nextWeek) {
            //  '다음주 월요일' 은 다음 주(월~일)의 그 요일이다 — 돌아오는 요일이 아니다
            const mon = new Date(d);
            mon.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7);
            mon.setDate(mon.getDate() + ((dow + 6) % 7));
            return this._ymd(mon);
        }
        let add = (dow - d.getDay() + 7) % 7;
        if (add === 0) add = 7;
        d.setDate(d.getDate() + add);
        return this._ymd(d);
    }
    DOW_KO = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
    //  글에서 날짜를 찾아낸다. 돌려주는 건 { at, len, date } — 없으면 null
    _findWhen(text) {
        const t = String(text || '');
        let m;
        if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)))
            return { at: m.index, len: m[0].length, date: m[0] };
        //  긴 말부터 본다 — '내일모레' 에서 '내일' 을 집으면 하루가 어긋난다
        if ((m = t.match(/(내일\s*모레|낼\s*모레|그저께|그제|어제|오늘|내일|낼|모레|모래|글피|다음\s*날|담날|익일|명일)/))) {
            const w = m[1].replace(/\s+/g, '');
            const k = { '내일모레': 2, '낼모레': 2, '그저께': -2, '그제': -2, '어제': -1, '오늘': 0,
                        '내일': 1, '낼': 1, '모레': 2, '모래': 2, '글피': 3,
                        '다음날': 1, '담날': 1, '익일': 1, '명일': 1 }[w];
            return { at: m.index, len: m[0].length, date: this._plusDays(k) };
        }
        if ((m = t.match(/(이번\s*주|다음\s*주|담\s*주)\s*([일월화수목금토])요?일?/)))
            return { at: m.index, len: m[0].length, date: this._nextDow(this.DOW_KO[m[2]], !/이번/.test(m[1])) };
        if ((m = t.match(/(다음\s*주|담\s*주)(?!\s*[일월화수목금토])/)))
            return { at: m.index, len: m[0].length, date: this._nextDow(1, true) };     // 그냥 '다음주' 면 다음주 월요일
        if ((m = t.match(/(이번\s*)?주말/)))
            return { at: m.index, len: m[0].length, date: this._nextDow(6, false) };    // 돌아오는 토요일
        if ((m = t.match(/(이번\s*달\s*말|이달\s*말|월말|이번\s*달까지)/))) {
            const d = new Date(); d.setMonth(d.getMonth() + 1, 0);
            return { at: m.index, len: m[0].length, date: this._ymd(d) };
        }
        if ((m = t.match(/(다음\s*달|담\s*달)\s*(\d{1,2})\s*일/))) {
            const d = new Date(); d.setMonth(d.getMonth() + 1, Number(m[2]));
            return { at: m.index, len: m[0].length, date: this._ymd(d) };
        }
        if ((m = t.match(/(\d{1,2})\s*주\s*(뒤|후)/)))
            return { at: m.index, len: m[0].length, date: this._plusDays(Number(m[1]) * 7) };
        if ((m = t.match(/(\d{1,2})\s*일\s*(뒤|후)/)))
            return { at: m.index, len: m[0].length, date: this._plusDays(Number(m[1])) };
        if ((m = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) {
            const y = new Date().getFullYear();
            return { at: m.index, len: m[0].length, date: `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` };
        }
        if ((m = t.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$|까지|쯤|에)/))) {
            const y = new Date().getFullYear();
            const off = m[0].length - (m[1].length + m[2].length + 1);
            return { at: m.index + off, len: m[0].length - off, date: `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}` };
        }
        return null;
    }
    //  할 일 줄에서 날짜 글자를 떼어낸다 — 글은 글대로, 날짜는 칩으로 보여주려고
    _splitDue(raw) {
        const w = this._findWhen(raw);
        if (!w) return { text: raw, due: '' };
        const rest = (raw.slice(0, w.at) + raw.slice(w.at + w.len))
            .replace(/\s*(까지|쯤|에)\s*/, ' ').replace(/\s{2,}/g, ' ').trim();
        return { text: rest, due: w.date };
    }
    //  '내일' 처럼 적은 말을 실제 날짜로 박아 넣는다. 보는 날이 달라져도 안 흔들리게.
    _fixWhenInLine(i) {
        const L = this._nbLines; if (!L || !L[i]) return false;
        const m = L[i].match(this.NOTE_TODO_RE); if (!m) return false;
        const w = this._findWhen(m[3]);
        if (!w || /^\d{4}-\d{2}-\d{2}$/.test(m[3].slice(w.at, w.at + w.len))) return false;
        const fixed = m[3].slice(0, w.at) + w.date + m[3].slice(w.at + w.len);
        L[i] = this._nbPreOf(L[i]) + fixed;
        return true;
    }
    //  날짜 칩을 눌렀을 때 — 오늘·내일·이번주 금요일 … 그 자리에서 고른다
    pickDue(ev, i) {
        ev.stopPropagation();
        const L = this._nbLines; if (!L) return;
        const put = (date) => {
            const m = (L[i] || '').match(this.NOTE_TODO_RE); if (!m) return;
            const { text } = this._splitDue(m[3]);
            L[i] = this._nbPreOf(L[i]) + (date ? `${text} ${date}`.trim() : text);
            if (i === this.nbLine) this._nbCaret = -1;
            this.saveNote(); this._nbPaint();
        };
        this.ctxMenu(ev, [
            { t: '오늘', run: () => put(this._plusDays(0)) },
            { t: '내일', run: () => put(this._plusDays(1)) },
            { t: '모레', run: () => put(this._plusDays(2)) },
            { sep: true },
            { t: '이번주 금요일', run: () => put(this._nextDow(5, false)) },
            { t: '다음주 월요일', run: () => put(this._nextDow(1, true)) },
            { t: '일주일 뒤', run: () => put(this._plusDays(7)) },
            { sep: true },
            { t: '직접 고르기…', run: async () => {
                const v = await this.showPrompt('날짜 (2026-10-05)', this._plusDays(1), '날짜 정하기');
                if (v && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) put(v.trim());
            } },
            { t: '날짜 지우기', danger: true, run: () => put('') },
        ]);
    }
    //  제목 앞 진행 도넛 — 줄을 하나 더 쓰지 않고 한눈에 보이게
    _donut(td) {
        if (!td || !td.length) return '';
        const done = td.filter(x => x.done).length;
        const p = done / td.length;
        const C = 2 * Math.PI * 7;       // r=7
        return `<svg class="nt-dn" viewBox="0 0 20 20" title="${done}/${td.length}">
            <circle cx="10" cy="10" r="7" fill="none" stroke="rgba(127,127,127,.25)" stroke-width="4"/>
            ${p > 0 ? `<circle cx="10" cy="10" r="7" fill="none" stroke="#30d158" stroke-width="4"
                stroke-dasharray="${(C * p).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 10 10)"/>` : ''}
        </svg>`;
    }
    //  제목 밑 요약 칩 — 할 일 개수 · 가장 가까운 날짜 · 담당자 · 꼬리표
    _noteMetaChips(n) {
        const esc = s => this._vesc(s);
        const td = this._noteTodos(n);
        const ats = [...new Set(td.flatMap(x => x.at))];
        const tags = [...new Set(td.flatMap(x => x.tags))];
        const due = td.filter(x => !x.done).map(x => x.due).filter(Boolean).sort()[0];
        if (!td.length && !ats.length && !tags.length) return '';
        return `<div class="nt-meta">
            ${td.length ? `<span class="nt-chip"><i class="ph ph-check-square"></i> 할 일 ${td.filter(x => x.done).length}/${td.length}</span>` : ''}
            ${due ? `<span class="nt-chip"><i class="ph ph-calendar-blank"></i> ${esc(due)}</span>` : ''}
            ${ats.map(a => `<span class="nt-chip at">@${esc(a)}</span>`).join('')}
            ${tags.map(t => `<span class="nt-chip tag">#${esc(t)}</span>`).join('')}
        </div>`;
    }
    //  할 일 줄 오른쪽 날짜 — 없으면 흐린 '날짜', 누르면 그 자리에서 고른다
    _dueChip(i, due, live) {
        if (live) return '';
        if (!due) return `<button class="nb-due none" title="날짜 정하기" onclick="app.pickDue(event,${i})">날짜</button>`;
        const dd = Math.round((new Date(due) - new Date(this._ymd(new Date()))) / 86400000);
        const cls = dd < 0 ? 'late' : (dd === 0 ? 'today' : (dd <= 3 ? 'soon' : ''));
        const lbl = dd < 0 ? `지남 ${-dd}일` : (dd === 0 ? '오늘' : (dd === 1 ? '내일' : due.slice(5).replace('-', '/')));
        return `<button class="nb-due ${cls}" title="${due}" onclick="app.pickDue(event,${i})">${lbl}</button>`;
    }
    // ── 연결된 메모 찾기 — 메모가 수백 개라 목록으로는 못 고른다 ──
    linkFind(q) {
        const esc = s => this._vesc(s);
        const n = this._curNote(); if (!n) return;
        const box = document.getElementById('np-link-hits'); if (!box) return;
        const has = (this._noteMeta(n).links || []).map(String);
        const s2 = String(q || '').trim().toLowerCase();
        let pool = (this.noteList || []).filter(x => x.id !== n.id && !has.includes(String(x.id)));
        if (s2) pool = pool.filter(x => ((x.title || '') + ' ' + this._noteText(x)).toLowerCase().includes(s2));
        const hits = pool.slice(0, 8);
        box.innerHTML = hits.length
            ? hits.map(o => `<button class="np-hit" data-id="${o.id}"><b>${esc(o.title || '새 메모')}</b>
                <span>${esc(this._noteText(o).replace(/\s+/g, ' ').trim().slice(0, 26) || '내용 없음')}</span></button>`).join('')
            : `<div class="np-hit none">${s2 ? '찾는 메모가 없습니다' : '이름을 적어 찾으세요'}</div>`;
        box.classList.add('on');
        box.querySelectorAll('.np-hit[data-id]').forEach(b => b.onmousedown = (e) => {
            e.preventDefault(); this.linkNote(b.dataset.id);
        });
    }
    linkFindClose() { setTimeout(() => document.getElementById('np-link-hits')?.classList.remove('on'), 150); }


    // ── 시즌 단계 모듈 ────────────────────────────────────────
    //  시즌을 만들면 샘플 → 제작 → 촬영 → 마케팅 → 오픈 → 출고 → 행사 가
    //  오픈일 기준으로 날짜까지 잡힌 메모로 깔린다. 놓치는 걸 줄이려는 장치다.
    _stepsFor(brandId) {
        const all = (this.seasonSteps || []).filter(x => x.active !== false);
        const mine = all.filter(x => String(x.brand_id || '') === String(brandId || ''));
        //  그 브랜드만의 차례가 있으면 그걸 쓰고, 없으면 공통을 쓴다
        return (mine.length ? mine : all.filter(x => !x.brand_id)).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    }
    //  '2026.11.20' · '2026/11/20' · '2026-11-20' 을 모두 2026-11-20 으로
    _toYmd(v) {
        const t = String(v || '').trim(); if (!t) return '';
        const m = t.match(/(\d{4})[.\-/\s]+(\d{1,2})[.\-/\s]+(\d{1,2})/);
        return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : '';
    }
    //  시즌을 만든 직후 부르면 '어떤 단계를 깔까' 를 묻는다
    async askSeasonSteps(seasonId) {
        const sea = this._seasons().find(p => String(p.id) === String(seasonId));
        if (!sea) { this.showToast('시즌을 찾지 못했습니다'); return; }
        if (!this.seasonSteps) {
            try {
                const { data } = await this.supabase.from('season_steps').select('*').eq('active', true).order('sort');
                this.seasonSteps = data || [];
            } catch (_e) { this.seasonSteps = []; }
        }
        const steps = this._stepsFor(sea.brand_id);
        if (!steps.length) { this.showToast('단계 모듈이 없습니다 (048_season_steps.sql)'); return; }
        //  제품리스트(product_items) 에서 이 브랜드 것을 불러와 함께 고르게 한다
        if (!this.seasonItems) {
            try {
                const { data } = await this.supabase.from('product_items')
                    .select('id,name,brand_id,status,open_date,ship_date').order('created_at', { ascending: false }).limit(400);
                this.seasonItems = data || [];
            } catch (_e) { this.seasonItems = []; }
        }
        this.stepPick = {
            id: seasonId,
            on: new Set(steps.filter(x => x.on_default !== false).map(x => x.id)),
            //  마감일은 '2026.11.20' 처럼 점으로 저장돼 있다. 날짜 칸은 2026-11-20 만 받으므로 맞춰 준다.
            open: this._toYmd(sea.deadline),
            dates: {},                 // 단계별로 날짜를 직접 고치면 여기 담긴다
            items: new Set(),          // 이 시즌에 넣을 제품
            itemQ: '',
        };
        this._paintStepPick();
    }
    toggleStepPick(id) {
        if (!this.stepPick) return;
        this.stepPick.on.has(id) ? this.stepPick.on.delete(id) : this.stepPick.on.add(id);
        this._paintStepPick();
    }
    setStepOpen(v) { if (this.stepPick) { this.stepPick.open = v; this.stepPick.dates = {}; this._paintStepPick(); } }
    //  단계 한 줄의 날짜를 직접 고친다(오픈일 계산값을 덮어쓴다)
    setStepDate(id, v) { if (this.stepPick) { this.stepPick.dates[id] = v || null; this._paintStepPick(); } }
    toggleSeasonItem(id) {
        const pk = this.stepPick; if (!pk) return;
        pk.items.has(id) ? pk.items.delete(id) : pk.items.add(id);
        this._paintStepPick();
    }
    setSeasonItemQ(v) { if (this.stepPick) { this.stepPick.itemQ = v; this._paintStepPick(); } }
    //  단계의 최종 날짜 — 직접 고친 값이 있으면 그걸, 없으면 오픈일 기준 계산값
    _stepDueOf(st) {
        const pk = this.stepPick;
        const own = pk && pk.dates ? pk.dates[st.id] : null;
        return own !== undefined && own !== null ? own : this._stepDate(pk ? pk.open : null, st.offset_days);
    }
    closeStepPick() {
        this.stepPick = null;
        const c = document.getElementById('global-modal-container');
        if (c) { c.style.display = 'none'; c.innerHTML = ''; }
    }
    _paintStepPick() {
        const c = document.getElementById('global-modal-container'); if (!c) return;
        c.innerHTML = this._stepPickHTML();
        c.style.display = 'flex';
        c.onclick = (e) => { if (e.target === c) this.closeStepPick(); };
    }
    _stepDate(openYmd, off) {
        if (!openYmd) return null;
        const d = new Date(openYmd); if (isNaN(d)) return null;
        d.setDate(d.getDate() + Number(off || 0));
        return this._ymd(d);
    }
    //  고른 단계를 메모로 깐다 — 폴더는 브랜드, 시즌 속성이 붙고, 본문엔 할 일이 들어간다
    async makeSeasonSteps() {
        const pk = this.stepPick; if (!pk) return;
        const sea = this._seasons().find(p => String(p.id) === String(pk.id)); if (!sea) return;
        const brand = (mockData.brands || []).find(b => String(b.id) === String(sea.brand_id));
        const steps = this._stepsFor(sea.brand_id).filter(x => pk.on.has(x.id));
        if (!steps.length) { this.showToast('고른 단계가 없습니다'); return; }
        const folder = brand ? brand.name : '공용';
        const me = this.currentUser?.name || null;
        const rows = steps.map(st => {
            const due = this._stepDueOf(st);
            const meta = { proj: String(sea.id), status: '요청' };
            if (due) meta.due = due;
            const body = (st.checklist || []).map(c => `[ ] ${c}`).join('\n');
            return {
                title: `${sea.name} · ${st.name}`,
                body: this._joinNote(meta, body),
                folder, scope: 'shared', product_id: sea.id,
                owner: this._me(), created_by: me,
            };
        });
        //  고른 제품은 '제품 페이지' 로 같이 깔린다 — 사진·기록·[ ] 할 일을 제품별로 남기는 자리
        const picked = [...(pk.items || [])];
        const itemRows = picked.map(iid => {
            const it = (this.seasonItems || []).find(x => String(x.id) === String(iid));
            const meta = { proj: String(sea.id), status: '요청' };
            const due = this._stepDueOf({ id: '__item', offset_days: 0 }) || pk.open;
            if (due) meta.due = due;
            return {
                title: `${sea.name} · ${it ? it.name : '제품'}`,
                body: this._joinNote(meta, ['[ ] 원단·부자재 확정', '[ ] 샘플 확인', '[ ] 촬영 컷 확정', '[ ] 상세페이지', '[ ] 가격·재고 등록'].join('\n')),
                folder, scope: 'shared', product_id: sea.id, item_id: iid,
                owner: this._me(), created_by: me,
            };
        });
        try {
            const { data, error } = await this.supabase.from('notes').insert([...rows, ...itemRows]).select();
            if (error) throw error;
            this.noteList = [...(data || []), ...(this.noteList || [])];
            this.stepPick = null;
            this.noteFolder = 'f:' + folder; this.noteSea = String(sea.id);
            this.closeStepPick();
            this.showToast(`${sea.name} · 단계 ${rows.length}개${itemRows.length ? ` · 제품 ${itemRows.length}개` : ''} 만들었습니다`);
            this.switchView('notes');
        } catch (e) { this.showToast('만들지 못했습니다: ' + (e.message || e)); }
    }
    //  단계 고르기 판
    _stepPickHTML() {
        const pk = this.stepPick; if (!pk) return '';
        const esc = s => this._vesc(s);
        const sea = this._seasons().find(p => String(p.id) === String(pk.id));
        if (!sea) return '';
        const brand = (mockData.brands || []).find(b => String(b.id) === String(sea.brand_id));
        const steps = this._stepsFor(sea.brand_id);
        const row = (st) => {
            const on = pk.on.has(st.id);
            const due = this._stepDueOf(st);
            const off = Number(st.offset_days || 0);
            //  날짜는 오픈일 기준으로 자동으로 잡히되, 칸을 눌러 직접 고칠 수 있다
            return `<div class="sp-row${on ? ' on' : ''}">
                <button class="sp-hit" onclick="app.toggleStepPick('${st.id}')">
                    <span class="sp-ck${on ? ' on' : ''}"></span>
                    <i class="ph ${st.icon || 'ph-circle'}" style="color:${st.color || '#8e8e93'}"></i>
                    <b>${esc(st.name)}</b>
                    <em class="sp-off">${off === 0 ? '오픈일' : (off < 0 ? `오픈 ${-off}일 전` : `오픈 ${off}일 뒤`)}</em>
                    <span class="sp-n">할 일 ${(st.checklist || []).length}</span>
                </button>
                <input class="sp-date" type="date" value="${esc(due || '')}"
                       onchange="app.setStepDate('${st.id}', this.value)" onclick="event.stopPropagation()">
            </div>`;
        };
        //  제품리스트에서 이 시즌에 넣을 제품 고르기
        const q = (pk.itemQ || '').trim();
        const pool = (this.seasonItems || []).filter(it => !sea.brand_id || !it.brand_id || String(it.brand_id) === String(sea.brand_id));
        const hits = (q ? pool.filter(it => (it.name || '').toLowerCase().includes(q.toLowerCase())) : pool).slice(0, 60);
        const itemHtml = `<div class="sp-items">
            <div class="sp-ih"><b>제품</b><span>${pk.items.size}개 선택 · 고른 제품마다 기록 페이지가 생깁니다</span>
                <input class="sp-q" placeholder="제품 검색" value="${esc(q)}" oninput="app.setSeasonItemQ(this.value)"></div>
            <div class="sp-ilist">${hits.map(it => `<button class="sp-chip${pk.items.has(it.id) ? ' on' : ''}"
                onclick="app.toggleSeasonItem('${it.id}')">${esc(it.name || '이름 없음')}</button>`).join('')
                || '<span class="sp-none">제품리스트가 비어 있습니다</span>'}</div>
        </div>`;
        return `<div class="modal-content vmodal sp-box" style="width:94%;max-width:620px">
                <div class="hk-top"><b>${esc(brand ? brand.name + ' · ' : '')}${esc(sea.name)} 단계 만들기</b>
                    <button class="fi-x" onclick="app.closeStepPick()">×</button></div>
                <div class="sp-when">
                    <label>오픈일</label>
                    <input type="date" value="${esc(pk.open || '')}" onchange="app.setStepOpen(this.value)">
                    <span>이 날을 기준으로 앞뒤 날짜가 잡힙니다</span>
                </div>
                <div class="sp-list">${steps.map(row).join('')}</div>
                ${itemHtml}
                <div class="sp-f">
                    <span>단계 ${pk.on.size}개${pk.items.size ? ` · 제품 ${pk.items.size}개` : ''} 를 메모로 만듭니다 · 각 메모 안에 [ ] 할 일이 들어갑니다</span>
                    <button class="mbtn pri" onclick="app.makeSeasonSteps()">만들기</button>
                </div>
        </div>`;
    }
    // ── 메모 여러 개 고르기 — 끌어서 훑고, 한번에 옮기거나 지운다 ──
    _picked() { if (!(this.noteMulti instanceof Set)) this.noteMulti = new Set(); return this.noteMulti; }
    clearNotePick() { this.noteMulti = new Set(); this.requestRender(); }
    //  목록에서 마우스를 끌면 지나간 메모가 다 골라진다
    nbBandStart(ev) {
        if (ev.button !== 0) return;
        const box = ev.currentTarget;
        const startRow = ev.target.closest('.nt-row');
        const picked = this._picked();
        //  이미 고른 것을 끌면 '폴더로 옮기기' 다 — 훑기로 가로채지 않는다
        if (startRow && picked.has(startRow.dataset.id)) return;
        const rows = [...box.querySelectorAll('.nt-row')];
        const base = (ev.shiftKey || ev.metaKey || ev.ctrlKey) ? new Set(picked) : new Set();
        const x0 = ev.clientX, y0 = ev.clientY;
        let band = null, moved = false;
        const move = (e) => {
            if (!moved && Math.abs(e.clientY - y0) + Math.abs(e.clientX - x0) < 6) return;
            if (!moved) {
                moved = true;
                rows.forEach(r => { r.draggable = false; });
                band = document.createElement('div'); band.className = 'nt-band';
                document.body.appendChild(band);
            }
            const l = Math.min(x0, e.clientX), t = Math.min(y0, e.clientY);
            const w = Math.abs(e.clientX - x0), h = Math.abs(e.clientY - y0);
            band.style.cssText = `left:${l}px;top:${t}px;width:${w}px;height:${h}px`;
            const sel = new Set(base);
            rows.forEach(r => {
                const b = r.getBoundingClientRect();
                if (b.bottom > t && b.top < t + h) sel.add(r.dataset.id);
            });
            this.noteMulti = sel;
            rows.forEach(r => r.classList.toggle('pick', sel.has(r.dataset.id)));
            const n = document.querySelector('.nt-bulk b');
            if (n) n.textContent = `${sel.size}개 고름`;
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            if (band) band.remove();
            rows.forEach(r => { r.draggable = true; });
            if (moved) { this._bandJust = Date.now(); this.requestRender(); }
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }
    //  ⌘ 누르고 누르면 하나씩, Shift 면 사이를 다, 그냥 누르면 그 메모를 연다
    noteClick(ev, id) {
        if (this._bandJust && Date.now() - this._bandJust < 250) return;   // 방금 훑었으면 클릭은 무시
        const picked = this._picked();
        if (ev.metaKey || ev.ctrlKey) {
            picked.has(id) ? picked.delete(id) : picked.add(id);
            this.requestRender(); return;
        }
        if (ev.shiftKey) {
            const ids = [...document.querySelectorAll('.nt-row')].map(r => r.dataset.id);
            const from = ids.indexOf(String(this.noteSel ?? this._noteShown));
            const to = ids.indexOf(String(id));
            if (from >= 0 && to >= 0) {
                for (let i = Math.min(from, to); i <= Math.max(from, to); i++) picked.add(ids[i]);
                this.requestRender(); return;
            }
        }
        this.noteMulti = new Set();
        this.selectNote(id);
    }
    async bulkDeleteNotes() {
        const ids = [...this._picked()]; if (!ids.length) return;
        if (!await this.showConfirm(`메모 ${ids.length}개를 지울까요? 되돌릴 수 없습니다.`, '삭제')) return;
        try {
            const { error } = await this.supabase.from('notes').delete().in('id', ids);
            if (error) throw error;
            this.noteList = (this.noteList || []).filter(n => !ids.includes(String(n.id)));
            if (ids.includes(String(this.noteSel))) { this.noteSel = null; this._nbDrop(); }
            this.noteMulti = new Set();
            this.requestRender();
            this.showToast(`메모 ${ids.length}개를 지웠습니다`);
        } catch (e) { this.showToast('지우지 못했습니다: ' + (e.message || e)); }
    }
    async bulkMoveNotes() {
        const ids = [...this._picked()]; if (!ids.length) return;
        const me = this._me();
        const shared = [...new Set((this.noteList || []).filter(n => n.scope === 'shared').map(n => n.folder || '공용'))];
        const priv = [...new Set((this.noteList || []).filter(n => n.scope === 'private' && n.owner === me).map(n => n.folder || '개인'))];
        const opts = [...shared.map(f => ['f:' + f, f]), ...priv.map(f => ['pf:' + f, f + ' (개인)'])];
        if (!opts.length) { this.showToast('옮길 폴더가 없습니다'); return; }
        this.ctxMenu(window.event || { preventDefault() {}, stopPropagation() {}, clientX: 200, clientY: 200 },
            opts.map(([k, label]) => ({ t: label, icon: 'ph-folder-simple', run: async () => {
                for (const id of ids) await this.moveNoteTo(id, k);
                this.noteMulti = new Set(); this.requestRender();
            } })));
    }
    // ── 메모를 끌어다 폴더에 넣기 ─────────────────────────────
    nbDragStart(ev, id) {
        this._nbDragId = id;
        try { ev.dataTransfer.setData('text/plain', String(id)); ev.dataTransfer.effectAllowed = 'move'; } catch (_e) { }
    }
    nbDragOver(ev, key) {
        if (!this._nbDragId || key === 'all') return;
        ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
        ev.currentTarget.classList.add('drop');
    }
    nbDragOut(ev) { ev.currentTarget.classList.remove('drop'); }
    async nbDrop(ev, key) {
        ev.preventDefault(); ev.currentTarget.classList.remove('drop');
        const id = this._nbDragId || (ev.dataTransfer && ev.dataTransfer.getData('text/plain'));
        this._nbDragId = null;
        if (!id || key === 'all') return;
        const picked = this._picked();
        const ids = picked.has(String(id)) ? [...picked] : [id];      // 고른 게 있으면 통째로
        for (const x of ids) await this.moveNoteTo(x, key);
        if (ids.length > 1) { this.noteMulti = new Set(); this.requestRender(); }
    }
    async moveNoteTo(id, key) {
        const n = (this.noteList || []).find(x => String(x.id) === String(id)); if (!n) return;
        let patch = null, where = '';
        if (key === 'private') { patch = { scope: 'private', folder: '개인', owner: n.owner || this._me() }; where = '개인 메모'; }
        else if (key.startsWith('pf:')) { patch = { scope: 'private', folder: key.slice(3), owner: n.owner || this._me() }; where = key.slice(3); }
        else if (key.startsWith('f:')) { patch = { scope: 'shared', folder: key.slice(2) }; where = key.slice(2); }
        if (!patch) return;
        if (n.scope === patch.scope && (n.folder || '') === patch.folder) return;
        const back = { scope: n.scope, folder: n.folder, owner: n.owner };
        Object.assign(n, patch); this.requestRender();
        try {
            const { error } = await this.supabase.from('notes').update(patch).eq('id', n.id);
            if (error) throw error;
            this.showToast(`'${n.title || '메모'}' 을 ${where} 로 옮겼습니다`);
        } catch (e) {
            Object.assign(n, back); this.requestRender();
            this.showToast('옮기지 못했습니다: ' + (e.message || e));
        }
    }
    // ── @ 자동완성 ────────────────────────────────────────────
    //  본문에서 @ 를 치면 계정 목록이 뜬다. ↑↓ 로 고르고 Enter·Tab 으로 넣는다.
    _atPool() {
        return (mockData.companies || []).filter(c => c.username).map(c => ({ n: c.name, u: c.username }));
    }
    noteTyping() {
        const ta = this._nbTA(); if (!ta) return;
        const upto = ta.value.slice(0, ta.selectionStart);
        const m = upto.match(/@([^\s@]*)$/);
        if (!m) { this.closeAtPop(); return; }
        const q = (m[1] || '').toLowerCase();
        const hits = this._atPool().filter(x => !q || x.n.toLowerCase().includes(q) || x.u.toLowerCase().includes(q)).slice(0, 6);
        if (!hits.length) { this.closeAtPop(); return; }
        this._atHits = hits; this._atSel = 0; this._atStart = ta.selectionStart - m[0].length;
        this.showAtPop(ta);
    }
    showAtPop(ta) {
        const esc = s => this._vesc(s);
        let el = document.getElementById('at-pop');
        if (!el) { el = document.createElement('div'); el.className = 'stmenu atpop lg nocaret'; el.id = 'at-pop'; document.body.appendChild(el); }
        el.innerHTML = this._atHits.map((h, i) => `<button class="stm-item${i === this._atSel ? ' sel' : ''}" data-i="${i}">
            <span class="at-face">${esc((h.n || '?')[0])}</span><span class="stm-txt">${esc(h.n)}</span>
            <span class="stm-side">${esc(h.u)}</span></button>`).join('');
        el.querySelectorAll('.stm-item').forEach(b => b.onmousedown = (e) => { e.preventDefault(); this.pickAt(Number(b.dataset.i)); });
        // 글자 자리 근처에 띄운다(대략치 — 줄 높이로 계산)
        const r = ta.getBoundingClientRect();
        const before = ta.value.slice(0, this._atStart);
        const line = before.split('\n').length;
        const top = Math.min(r.bottom - 8, r.top + 8 + line * 24 - ta.scrollTop);
        el.style.left = Math.max(8, Math.min(window.innerWidth - 230, r.left + 18)) + 'px';
        el.style.top = Math.max(8, Math.min(window.innerHeight - 200, top)) + 'px';
    }
    closeAtPop() { document.getElementById('at-pop')?.remove(); this._atHits = null; }
    pickAt(i) {
        const ta = this._nbTA(); if (!ta || !this._atHits) return;
        const h = this._atHits[i] || this._atHits[0]; if (!h) return;
        const end = ta.selectionStart;
        ta.value = ta.value.slice(0, this._atStart) + '@' + h.n + ' ' + ta.value.slice(end);
        const np = this._atStart + h.n.length + 2;
        ta.focus(); ta.setSelectionRange(np, np);
        this.closeAtPop(); this.saveNote();
    }
    noteKey(ev) {
        if (!this._atHits) {
            //  백스페이스 한 번에 사진 하나 — ![사진](주소) 를 글자 단위로 지우게 두면 괴롭다
            if (ev.key === 'Backspace') {
                const ta = ev.target;
                if (ta.selectionStart === ta.selectionEnd) {
                    const upto = ta.value.slice(0, ta.selectionStart);
                    const m = upto.match(/!\[[^\]]*\]\([^)]*\)\n?$/);
                    if (m) {
                        ev.preventDefault();
                        const from = ta.selectionStart - m[0].length;
                        this.showConfirm('이 사진을 지울까요?', '사진 삭제').then(ok => {
                            if (!ok) { ta.focus(); ta.setSelectionRange(ta.selectionStart, ta.selectionStart); return; }
                            ta.value = ta.value.slice(0, from) + ta.value.slice(ta.selectionStart);
                            ta.focus(); ta.setSelectionRange(from, from);
                            this.saveNote();
                            this.showToast('사진을 지웠습니다');
                        });
                        return;
                    }
                }
            }
            // 할 일 줄에서 Enter 를 치면 다음 줄도 할 일로 시작한다(노션처럼)
            if (ev.key === 'Enter') {
                const ta = ev.target;
                const upto = ta.value.slice(0, ta.selectionStart);
                const curLine = upto.slice(upto.lastIndexOf('\n') + 1);
                if (this.NOTE_TODO_RE.test(curLine) && curLine.replace(this.NOTE_TODO_RE, '$3').trim()) {
                    ev.preventDefault();
                    const p = ta.selectionStart;
                    ta.value = ta.value.slice(0, p) + '\n[ ] ' + ta.value.slice(p);
                    ta.setSelectionRange(p + 5, p + 5);
                }
            }
            return;
        }
        if (ev.key === 'ArrowDown') { ev.preventDefault(); this._atSel = (this._atSel + 1) % this._atHits.length; this.showAtPop(ev.target); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); this._atSel = (this._atSel - 1 + this._atHits.length) % this._atHits.length; this.showAtPop(ev.target); }
        else if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); this.pickAt(this._atSel); }
        else if (ev.key === 'Escape') { ev.preventDefault(); this.closeAtPop(); }
    }
    noteBlur() { setTimeout(() => this.closeAtPop(), 120); this.saveNote(); }
    // 커서 자리에 넣기 — 노션의 '/' 블록처럼
    noteInsert(kind) {
        const ta = this._nbTA(); if (!ta) return;
        //  live 편집 중이면 '지금 줄' 을 할 일 · 글머리 줄로 바꾼다
        if (ta.id === 'note-body' && this._nbLines && this.nbLine != null && (kind === 'todo' || kind === 'bullet')) {
            this._nbSync();
            const i = this.nbLine;
            const bare = this._nbLines[i].slice(this._nbPreOf(this._nbLines[i]).length).replace(/^·\s*/, '');
            this._nbLines[i] = (kind === 'todo' ? '[ ] ' : '· ') + bare;
            this._nbCaret = -1;
            this.saveNote(); this._nbPaint();
            return;
        }
        const map = { todo: '[ ] ', at: '@', tag: '#', date: new Date().toISOString().slice(0, 10) + ' ', bullet: '· ' };
        const ins = map[kind] || '';
        const p = ta.selectionStart;
        const atLineStart = p === 0 || ta.value[p - 1] === '\n';
        const pre = (kind === 'todo' || kind === 'bullet') && !atLineStart ? '\n' : '';
        ta.value = ta.value.slice(0, p) + pre + ins + ta.value.slice(p);
        const np = p + pre.length + ins.length;
        ta.focus(); ta.setSelectionRange(np, np);
        this.saveNote();
    }
    // ── 메모 (맥 '메모' 앱 그대로) ────────────────────────────
    //  왼쪽 폴더 · 가운데 목록(날짜 묶음) · 오른쪽 본문. 세 칸 구조와 치수를 맥에 맞췄다.
    renderNotes() {
        if (!this._noteLoaded) return this._loadingSkeleton('메모');
        const esc = s => this._vesc(s);
        const all = this.noteList || [];
        const me = this._me();
        const cur = this.noteFolder || 'private';
        const projects = this._seasonsFor(this.noteFolder || 'public');
        const inFolder = (n) => {
            if (n.item_id) return false;   // 제품 기록장은 제품 페이지에서 본다
            if (cur === 'all') return true;
            if (cur === 'private') return n.scope === 'private' && n.owner === me;
            if (cur.startsWith('pf:')) return n.scope === 'private' && n.owner === me && (n.folder || '개인') === cur.slice(3);
            if (cur === 'shared') return n.scope === 'shared';
            if (cur.startsWith('p:')) return n.product_id === cur.slice(2);
            if (cur.startsWith('f:')) return (n.folder || '') === cur.slice(2);
            return true;
        };
        let list = all.filter(inFolder);
        //  시즌 모아보기 — 폴더와 상관없이 그 시즌에 붙은 메모만
        const seaF = this.noteSea || 'ALL';
        if (seaF === 'NONE') list = list.filter(n => !n.product_id);
        else if (seaF !== 'ALL') list = list.filter(n => String(n.product_id) === String(seaF));
        const sel = list.find(n => n.id === this.noteSel) || list[0];
        this._noteShown = sel ? sel.id : null;   // 지금 화면에 떠 있는 메모
        const cnt = (fn) => all.filter(fn).length;
        // 맥 메모의 날짜 묶음: 오늘 · 어제 · 이전 7일 · 이전 30일 · 월 · 연도
        const bucket = (t) => {
            if (!t) return '이전 항목';
            const now = new Date(), d = new Date(t);
            const day = Math.floor((new Date(now.getFullYear(), now.getMonth(), now.getDate())
                        - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
            if (day <= 0) return '오늘';
            if (day === 1) return '어제';
            if (day < 7) return '이전 7일';
            if (day < 30) return '이전 30일';
            if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '월';
            return d.getFullYear() + '년';
        };
        const when = t => t ? new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '';
        const longWhen = t => t ? new Date(t).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
        let items = '', last = null;
        const pick = this._picked();
        //  그릴 때마다 다시 정렬한다. 메모를 고치거나 새로 만들면 목록(this.noteList)의 순서가
        //  DB 순서와 어긋나서, 날짜 머리말이 '어제 → 오늘 → 어제' 처럼 두 번 찍히는 일이 있었다.
        list = list.slice().sort((a, b) =>
            (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
            String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
        //  고정한 메모는 맨 위 '고정됨' 묶음으로 따로 뺀다.
        //  안 그러면 날짜 묶음(어제/오늘) 사이에 끼어들어 '어제 → 오늘 → 어제' 처럼 같은 머리말이 두 번 찍힌다.
        list.forEach(n => {
            const b = n.pinned ? '고정됨' : bucket(n.updated_at);
            if (b !== last) { last = b; items += `<div class="nt-grp">${esc(b)}</div>`; }
            const prev = this._noteText(n)
                .split('\n').filter(l => !/^\s*\[( |x|X)?\]\s*$/.test(l)).join('\n')   // 빈 할 일 줄은 뺀다
                .replace(/!\[[^\]]*\]\([^)]*\)/g, '[사진]')
                .replace(/^\s*\[( |x|X)?\]\s?/gm, (_m, c) => (String(c || '').toLowerCase() === 'x' ? '☑ ' : '☐ '))
                .replace(/\s+/g, ' ').trim().slice(0, 30);
            const td = this._noteTodos(n);
            items += `<div class="nt-row${sel && n.id === sel.id ? ' on' : ''}${pick.has(String(n.id)) ? ' pick' : ''}"
                    data-id="${n.id}" oncontextmenu="app.noteMenu(event,'${n.id}')"
                    draggable="true" ondragstart="app.nbDragStart(event,'${n.id}')" title="끌어서 훑으면 여러 개를 고를 수 있습니다"
                    onclick="app.noteClick(event,'${n.id}')">
                <b>${this._donut(td)}${esc(n.title || '새 메모')}</b>
                <div class="nt-sub"><span class="nt-d">${esc(when(n.updated_at))}</span>
                    <span class="nt-p">${esc(prev) || '추가 텍스트 없음'}</span></div>
            </div>`;
        });
        if (!items) items = `<div class="nt-none">메모 없음</div>`;
        const fold = (key, icon, label, n, color, brand) => {
            //  브랜드 폴더면 그 브랜드의 시즌을 아래에 펼치고, 줄 끝 ＋ 로 그 브랜드에 시즌을 추가한다
            const seas = brand ? (this._seasons() || []).filter(p => String(p.brand_id) === String(brand.id)) : [];
            const open = brand && (this.noteBrandOpen || {})[brand.id];
            const head = `<div class="nt-f${cur === key ? ' on' : ''}" onclick="app.setNoteFolder('${key}')"
                ondragover="app.nbDragOver(event,'${key}')" ondragleave="app.nbDragOut(event)" ondrop="app.nbDrop(event,'${key}')"
                oncontextmenu="app.folderMenu(event,'${key}')">
                ${brand && seas.length ? `<button class="nt-car${open ? ' on' : ''}" onclick="event.stopPropagation();app.toggleBrandSeasons('${brand.id}')" title="시즌 펼치기"><i class="ph ph-caret-right"></i></button>` : '<span class="nt-car sp"></span>'}
                <i class="ph ${icon}" style="color:${color || '#e0a800'}"></i><span>${esc(label)}</span><em>${n}</em>
                ${brand ? `<button class="nt-addsea" title="${esc(label)}에 새 시즌" onclick="event.stopPropagation();app.newSeasonIn('${brand.id}')"><i class="ph ph-plus"></i></button>` : ''}</div>`;
            const kids = (brand && open) ? seas.map(p => `<div class="nt-sea2${this.noteSea === String(p.id) ? ' on' : ''}"
                onclick="app.pickBrandSeason('${key}','${p.id}')" oncontextmenu="app.projectMenu(event,'${p.id}')">
                <i class="ph ph-calendar-blank"></i><span>${esc(p.name)}</span>
                <em>${all.filter(n2 => String(n2.product_id) === String(p.id)).length}</em></div>`).join('') : '';
            return head + kids;
        };
        //  브랜드 폴더 + 공용은 메모가 없어도 늘 자리를 지킨다
        const brandNames = (mockData.brands || []).filter(b => b.status !== 'closed').map(b => b.name);
        const otherFolders = [...new Set([...brandNames, '공용',
            ...all.filter(n => n.scope === 'shared').map(n => n.folder || '공용')])];
        //  개인 메모도 폴더로 나눈다 — '개인' 은 기본 칸이라 목록에서 뺀다
        const privFolders = [...new Set(all.filter(n => n.scope === 'private' && n.owner === me)
            .map(n => n.folder || '개인'))].filter(f => f !== '개인');
        return `
        <div class="nt">
            <aside class="nt-side">
                <div class="nt-shead tog${this.notePrivOpen !== false ? ' on' : ''}" onclick="app.togglePrivFolders()">
                    <i class="ph ph-caret-right"></i>개인
                    <button class="nt-add" title="새 개인 폴더" onclick="event.stopPropagation();app.addPrivateFolder()">＋</button></div>
                ${fold('private', 'ph-note', '개인 메모', cnt(n => n.scope === 'private' && n.owner === me))}
                ${this.notePrivOpen === false ? '' : privFolders.map(f =>
                    fold('pf:' + f, 'ph-folder-simple', f, cnt(n => n.scope === 'private' && n.owner === me && (n.folder || '개인') === f), '#ffb340')).join('')}
                <div class="nt-shead">워크스페이스
                    <button class="nt-add" title="새 폴더" onclick="app.addNoteFolder()">＋</button></div>
                ${fold('all', 'ph-tray', '모든 메모', all.length, '#8e8e93')}
                ${otherFolders.map(f => {
                    const fx = (this.noteFolders || []).find(x => x.name === f);
                    const locked = fx && fx.access === 'members';
                    const br = (mockData.brands || []).find(b => b.name === f);
                    return fold('f:' + f, locked ? 'ph-folder-simple-lock' : (br ? 'ph-tag' : 'ph-folder-simple'), f,
                        cnt(n => (n.folder || '공용') === f && n.scope === 'shared'),
                        br ? (br.brand_color || '#0a84ff') : '#8e8e93', br || null);
                }).join('')}
                <button class="nt-prod${this.noteProd ? ' on' : ''}" onclick="app.toggleNoteProducts()"
                    title="제품을 보면서 쓰기">
                    <i class="ph ph-t-shirt"></i><span>제품리스트</span>
                    <i class="ph ${this.noteProd ? 'ph-caret-left' : 'ph-caret-right'} nt-prod-c"></i></button>
            </aside>
            ${this._noteProductsHTML()}
            <section class="nt-list">
                <div class="nt-lbar">
                    <div><b>${esc(cur === 'private' ? '개인 메모' : (cur.startsWith('pf:') ? cur.slice(3) : (cur === 'all' ? '모든 메모' : (cur.startsWith('p:') ? (projects.find(x => 'p:' + x.id === cur)?.name || '메모') : cur.slice(2)))))}</b>
                        <span>${list.length}개의 메모</span></div>
                    <select class="nt-sea" onchange="app.setNoteSea(this.value)" title="시즌으로 거르기">
                        <option value="ALL"${seaF === 'ALL' ? ' selected' : ''}>모든 시즌</option>
                        ${projects.map(pr => `<option value="${pr.id}"${String(seaF) === String(pr.id) ? ' selected' : ''}>${esc(pr.name)}</option>`).join('')}
                        <option value="NONE"${seaF === 'NONE' ? ' selected' : ''}>시즌 없음</option>
                    </select>
                    <button class="nt-new" onclick="app.addNote()" title="새 메모"><i class="ph ph-note-pencil"></i></button>
                </div>
                ${pick.size > 1 ? `<div class="nt-bulk"><b>${pick.size}개 고름</b>
                    <button onclick="app.bulkMoveNotes()"><i class="ph ph-folder-simple"></i>폴더 옮기기</button>
                    <button class="danger" onclick="app.bulkDeleteNotes()"><i class="ph ph-trash"></i>삭제</button>
                    <button class="plain" onclick="app.clearNotePick()">해제</button></div>` : ''}
                <div class="nt-rows" onmousedown="app.nbBandStart(event)">${items}</div>
            </section>
            <section class="nt-doc">
                ${sel ? `
                <div class="nt-tools">
                    <button onclick="app.noteInsert('todo')" title="할 일 [ ]"><i class="ph ph-check-square"></i></button>
                    <button onclick="app.noteInsert('bullet')" title="글머리"><i class="ph ph-list-bullets"></i></button>
                    <button onclick="app.noteInsert('at')" title="담당자 @"><i class="ph ph-at"></i></button>
                    <button onclick="app.noteInsert('tag')" title="꼬리표 #"><i class="ph ph-hash"></i></button>
                    <button onclick="app.noteInsert('date')" title="오늘 날짜"><i class="ph ph-calendar-blank"></i></button>
                    <button onclick="app.pickNotePhoto()" title="사진 넣기"><i class="ph ph-image"></i></button>
                    <span class="nt-div"></span>
                    <button class="${this.notePreview ? 'on' : ''}" onclick="app.toggleNotePreview()" title="${this.notePreview ? '원래대로' : '원문 고치기'}">
                        <i class="ph ${this.notePreview ? 'ph-check-square' : 'ph-code'}"></i></button>
                    <button onclick="app.deleteNote()" title="삭제"><i class="ph ph-trash"></i></button>
                    <span class="nt-scope">${sel.scope === 'private' ? '개인' : (sel.scope === 'project' ? '시즌' : '공용')}</span>
                    <button class="${this.noteProps ? 'on' : ''}" onclick="app.toggleNoteProps()" title="속성 펼치기"><i class="ph ph-sliders-horizontal"></i></button>
                    <button class="nt-help" onclick="app.showHelp()" title="빠른 단축키"><i class="ph ph-question"></i></button>
                </div>
                <div class="nt-page">
                    <div class="nt-when">${esc(longWhen(sel.updated_at))}${sel.created_by ? ' · ' + esc(sel.created_by) : ''}</div>
                    <input id="note-title" class="nt-title" value="${esc(sel.title || '')}" placeholder="제목" onblur="app.saveNote()">
                    ${this._notePropsBar(sel)}
                    <div class="nt-meta-slot">${this._noteMetaChips(sel)}</div>
                    ${this.notePreview
                        ? `<textarea id="note-raw" class="nt-body" placeholder="내용을 적어주세요"
                              oninput="app.noteTyping(event)" onkeydown="app.noteKey(event)"
                              onblur="app.noteBlur()">${esc(this._noteText(sel))}</textarea>`
                        : this._noteLiveHTML(sel)}
                </div>` : `<div class="nt-none big">메모를 선택하세요</div>`}
            </section>
        </div>`;
    }

    // ── 할 일 (맥 '미리알림' 앱 형태) ─────────────────────────
    async loadReminders() {
        this._remLoading = true;
        try {
            const { data, error } = await this.supabase.from('reminders').select('*')
                .order('done', { ascending: true }).order('due_date', { ascending: true, nullsFirst: false }).limit(300);
            if (error) throw error;
            this.remList = data || []; this._remLoaded = true;
        } catch (e) { this.remList = []; this._remLoaded = true; this.showToast('할 일을 불러오지 못했습니다: ' + (e.message || e)); }
        this._remLoading = false; this.requestRender();
    }
    async addReminder() {
        const el = document.getElementById('rem-new');
        const title = (el?.value || '').trim(); if (!title) { el?.focus(); return; }
        const due = (document.getElementById('rem-due')?.value || '') || null;
        const cur = this.remList2 || '';
        const list_name = cur.startsWith('l:') && !['시즌', '메모'].includes(cur.slice(2)) ? cur.slice(2) : '기본';
        try {
            const { data, error } = await this.supabase.from('reminders')
                .insert([{ title, due_date: due, list_name, created_by: this.currentUser?.name || null }]).select('*').single();
            if (error) throw error;
            this.remList = [data, ...(this.remList || [])];
            if (el) el.value = '';
            this.requestRender(); setTimeout(() => document.getElementById('rem-new')?.focus(), 50);
        } catch (e) { this.showToast('추가 실패: ' + (e.message || e)); }
    }
    async toggleReminder(id) {
        const r = (this.remList || []).find(x => x.id === id); if (!r) return;
        const done = !r.done; r.done = done; r.done_at = done ? new Date().toISOString() : null;
        this.requestRender();
        try {
            const { error } = await this.supabase.from('reminders').update({ done, done_at: r.done_at }).eq('id', id);
            if (error) throw error;
        } catch (e) { r.done = !done; this.showToast('변경 실패: ' + (e.message || e)); this.requestRender(); }
    }
    setRemList(l) { this.remList2 = l; this.requestRender(); }
    setRemGroup(g) { this.remGroup = g; this.remList2 = 'all'; this.requestRender(); }
    // ── 할 일 (맥 '미리알림' 앱 그대로) ────────────────────────
    //  왼쪽에 색 타일 6개 + 나의 목록, 오른쪽에 목록별 색 제목 + 동그란 체크.
    //  우리 '할일(todos)'도 한 목록으로 같이 얹어서 담당자까지 보이게 했다.
    renderReminders() {
        if (!this._remLoaded) return this._loadingSkeleton('할 일');
        const esc = s => this._vesc(s);
        const today = new Date().toISOString().slice(0, 10);
        const me = this._myId();
        const nameOf = id => (mockData.companies || []).find(c => c.id === id)?.name || '';
        // 직접 적은 할 일 + 기존 todos을 한 줄 모양으로 합친다
        const rems = (this.remList || []).map(r => ({
            src: 'rem', id: r.id, title: r.title, memo: r.memo, due: r.due_date,
            done: !!r.done, list: (this.remGroup || 'list') === 'project' ? '시즌 없음' : (r.list_name || '기본'),
        }));
        const byProj = (this.remGroup || 'list') === 'project';
        const todos = (mockData.products || []).flatMap(p => (p.todos || []).map(t => ({
            src: 'todo', id: t.id, title: t.text, due: t.due_date, done: !!t.completed,
            list: byProj ? (p.name || '시즌 없음') : '시즌',
            project: p.name, assignee: t.assignee, createdBy: t.created_by,
        })));
        // 메모 본문의 [ ] 도 할 일이다 — 대시보드 안의 할 일을 한 군데로 모은다
        const projOfNote = (nid) => {
            const n = (this.noteList || []).find(x => String(x.id) === String(nid));
            const pid = n ? this._noteMeta(n).proj : null;
            return (mockData.products || []).find(p => String(p.id) === String(pid))?.name || null;
        };
        const noteTodos = this._allNoteTodos().map(t => ({
            src: 'note', id: t.id, noteId: t.noteId, line: t.line, title: t.title,
            due: t.due, done: t.done,
            list: byProj ? (projOfNote(t.noteId) || '시즌 없음') : '메모', from: t.from,
            assignee: (mockData.companies || []).find(c => c.name === t.at[0])?.id || null,
            atName: t.at[0] || null, tags: t.tags,
        }));
        const all = [...rems, ...todos, ...noteTodos];
        const open = all.filter(x => !x.done);
        const F = {
            today: x => !x.done && x.due && x.due <= today,
            plan:  x => !x.done && x.due && x.due > today,
            all:   x => !x.done,
            late:  x => !x.done && x.due && x.due < today,
            mine:  x => !x.done && x.src === 'todo' && x.assignee === me,
            nodate: x => !x.done && !x.due,
            done:  x => x.done,
        };
        const cur = this.remList2 || 'today';
        const TILES = [
            { k: 'today', label: '오늘',  icon: 'ph-calendar-blank', cls: 'blue' },
            { k: 'plan',  label: '예정',  icon: 'ph-calendar-dots',  cls: 'red' },
            { k: 'all',   label: '전체',  icon: 'ph-tray',           cls: 'dark' },
            { k: 'late',  label: '지연',  icon: 'ph-flag',           cls: 'orange' },
            { k: 'nodate', label: '날짜 없음', icon: 'ph-calendar-x', cls: 'pink' },
            { k: 'mine',  label: '내 할 일', icon: 'ph-user',        cls: 'pink' },
            { k: 'done',  label: '완료됨', icon: 'ph-check',         cls: 'gray' },
        ];
        const listNames = [...new Set(all.map(x => x.list))];
        const LCOL = { '시즌': '#0a84ff', '기본': '#ff9f0a', '메모': '#30d158' };
        const colorOf = (l, i) => LCOL[l] || ['#ff9f0a', '#0a84ff', '#30d158', '#bf5af2', '#ff453a'][i % 5];
        let shown = cur.startsWith('l:') ? all.filter(x => x.list === cur.slice(2) && !x.done)
                                         : all.filter(F[cur] || F.all);
        const title = cur.startsWith('l:') ? cur.slice(2) : (TILES.find(t => t.k === cur) || {}).label || '전체';
        const doneCnt = all.filter(x => x.done).length;
        // 목록별로 묶어 색 제목을 얹는다
        const groups = {};
        shown.forEach(x => { (groups[x.list] = groups[x.list] || []).push(x); });
        const sections = Object.keys(groups).map((l, i) => {
            const col = colorOf(l, listNames.indexOf(l));
            return `<div class="rm-sec" style="color:${col}">${esc(l)}</div>
            ${groups[l].map(x => `
                <div class="rm-item${x.done ? ' done' : ''}" data-src="${x.src}" data-id="${esc(String(x.id))}">
                    <button class="rm-ck${x.done ? ' on' : ''}" style="--c:${col}"
                        onclick="app.toggleRemItem('${x.src}','${x.id}')" aria-label="완료"></button>
                    <div class="rm-tx">
                        <div class="rm-tt" onclick="app.editRemTitle(event,'${x.src}','${x.id}')" title="눌러서 고치기">${esc(x.title)}</div>
                        ${(x.memo || x.project || x.assignee || x.from || x.atName || (x.tags || []).length) ? `<div class="rm-meta">
                            ${x.project ? `<span class="rm-tag"><i class="ph ph-folder"></i>${esc(x.project)}</span>` : ''}
                            ${x.from ? `<span class="rm-tag"><i class="ph ph-note"></i>${esc(x.from)}</span>` : ''}
                            ${(x.assignee || x.atName) ? `<span class="rm-tag"><i class="ph ph-user"></i>${esc(nameOf(x.assignee) || x.atName || '담당')}</span>` : ''}
                            ${(x.tags || []).map(t => `<span class="rm-tag">#${esc(t)}</span>`).join('')}
                            ${x.memo ? `<span>${esc(x.memo)}</span>` : ''}
                        </div>` : ''}
                    </div>
                    <input type="date" class="rm-date${x.due ? '' : ' empty'}${x.due && x.due < today ? ' over' : (x.due === today ? ' now' : '')}"
                        value="${esc(x.due || '')}" onchange="app.setRemDue('${x.src}','${x.id}',this.value)" title="기한">
                    <button class="rm-x" title="지우기" onclick="app.delRemItem('${x.src}','${x.id}')">✕</button>
                </div>`).join('')}`;
        }).join('') || `<div class="rm-none">항목 없음</div>`;

        return `
        <div class="rm">
            <aside class="rm-side">
                <div class="rm-tiles">
                    ${TILES.map(t => `<button class="rm-tile ${t.cls}${cur === t.k ? ' on' : ''}" onclick="app.setRemList('${t.k}')">
                        <span class="rm-ti"><i class="ph ${t.icon}"></i></span>
                        <b>${all.filter(F[t.k]).length}</b>
                        <em>${t.label}</em>
                    </button>`).join('')}
                </div>
                <div class="rm-seg">
                    <button class="${(this.remGroup || 'list') === 'list' ? 'on' : ''}" onclick="app.setRemGroup('list')">목록별</button>
                    <button class="${this.remGroup === 'project' ? 'on' : ''}" onclick="app.setRemGroup('project')">시즌별</button>
                </div>
                <div class="rm-lhead">${(this.remGroup || 'list') === 'project' ? '시즌' : '나의 목록'}
                    ${(this.remGroup || 'list') === 'list' ? `<button class="rm-plus" title="목록 추가" onclick="app.addRemList()">＋</button>` : ''}</div>
                ${listNames.map((l, i) => `<div class="rm-l${cur === 'l:' + l ? ' on' : ''}" onclick="app.setRemList('l:${esc(l)}')">
                    <span class="rm-lic" style="background:${colorOf(l, i)}"><i class="ph ph-list-bullets"></i></span>
                    <span class="rm-ln">${esc(l)}</span>
                    <em>${all.filter(x => x.list === l && !x.done).length}</em></div>`).join('')}
            </aside>
            <section class="rm-main">
                <div class="rm-top">
                    <button class="rm-add" onclick="app.focusNewReminder()" title="새 할 일"><i class="ph ph-plus"></i></button>
                    <div class="rm-search"><i class="ph ph-magnifying-glass"></i><input placeholder="검색"
                        value="${esc(this.remQ || '')}" oninput="app.remQ=this.value;app.requestRender()"></div>
                </div>
                <h1 class="rm-h1">${esc(title)}</h1>
                <div class="rm-sub">${doneCnt}개 완료됨${doneCnt ? ` · <a onclick="app.clearDoneReminders()">지우기</a>` : ''}</div>
                <div class="rm-new">
                    <button class="rm-ck ghost"></button>
                    <input id="rem-new" placeholder="새 할 일" onkeydown="if(event.key==='Enter')app.addReminder()">
                    <input id="rem-due" type="date">
                </div>
                <div class="rm-body">${sections}</div>
            </section>
        </div>`;
    }
    focusNewReminder() { setTimeout(() => document.getElementById('rem-new')?.focus(), 30); }
    // 줄을 눌러 글자 고치기 — 그 자리에서 입력칸으로 바뀐다
    editRemTitle(ev, src, id) {
        const el = ev.currentTarget;
        if (el.querySelector('input')) return;
        const old = el.textContent.trim();
        el.innerHTML = `<input class="rm-edit" value="${this._vesc(old)}">`;
        const inp = el.querySelector('input');
        inp.focus(); inp.select();
        const done = (ok) => {
            const v = (inp.value || '').trim();
            el.textContent = (ok && v) ? v : old;
            if (ok && v && v !== old) this.setRemTitle(src, id, v);
        };
        inp.onkeydown = (e) => {
            if (e.key === 'Enter') { e.preventDefault(); done(true); }
            else if (e.key === 'Escape') { e.preventDefault(); done(false); }
        };
        inp.onblur = () => done(true);
    }
    async setRemTitle(src, id, title) {
        try {
            if (src === 'rem') {
                const r = (this.remList || []).find(x => String(x.id) === String(id)); if (r) r.title = title;
                const { error } = await this.supabase.from('reminders').update({ title }).eq('id', id);
                if (error) throw error;
            } else if (src === 'todo') {
                (mockData.products || []).forEach(p => (p.todos || []).forEach(t => { if (String(t.id) === String(id)) t.text = title; }));
                const { error } = await this.supabase.from('todos').update({ text: title }).eq('id', id);
                if (error) throw error;
            } else {
                // 글자만 바꾸고 @담당자·#꼬리표·날짜는 그대로 붙여둔다
                const [nid, line] = String(id).split('#');
                await this._replaceNoteLine(nid, Number(line), (m) => {
                    const keep = ((m[3] || '').match(/[@#][^\s]+|\b\d{4}-\d{2}-\d{2}\b/g) || []).join(' ');
                    return `${m[1]}[${m[2]}] ${title}${keep ? ' ' + keep : ''}`;
                });
            }
            this.requestRender();
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    async setRemDue(src, id, due) {
        const v = due || null;
        try {
            if (src === 'rem') {
                const r = (this.remList || []).find(x => String(x.id) === String(id)); if (r) r.due_date = v;
                const { error } = await this.supabase.from('reminders').update({ due_date: v }).eq('id', id);
                if (error) throw error;
            } else if (src === 'todo') {
                (mockData.products || []).forEach(p => (p.todos || []).forEach(t => { if (String(t.id) === String(id)) t.due_date = v; }));
                const { error } = await this.supabase.from('todos').update({ due_date: v }).eq('id', id);
                if (error) throw error;
            } else {
                // 메모 줄의 날짜를 바꿔 끼운다
                const [nid, line] = String(id).split('#');
                await this._replaceNoteLine(nid, Number(line), (m) => {
                    let t = (m[3] || '').replace(/\b\d{4}-\d{2}-\d{2}\b/g, '').replace(/\s{2,}/g, ' ').trim();
                    if (v) t += ' ' + v;
                    return `${m[1]}[${m[2]}] ${t}`;
                });
            }
            this.requestRender();
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    async delRemItem(src, id) {
        try {
            if (src === 'rem') {
                if (!await this.showConfirm('이 할 일을 지울까요?', '삭제')) return;
                const { error } = await this.supabase.from('reminders').delete().eq('id', id);
                if (error) throw error;
                this.remList = (this.remList || []).filter(x => String(x.id) !== String(id));
            } else if (src === 'todo') {
                if (!await this.showConfirm('이 할일을 지울까요?', '삭제')) return;
                const { error } = await this.supabase.from('todos').delete().eq('id', id);
                if (error) throw error;
                (mockData.products || []).forEach(p => { if (p.todos) p.todos = p.todos.filter(t => String(t.id) !== String(id)); });
            } else {
                if (!await this.showConfirm('메모에서 이 줄을 지울까요?', '삭제')) return;
                const [nid, line] = String(id).split('#');
                await this._replaceNoteLine(nid, Number(line), null);
            }
            this.requestRender();
        } catch (e) { this.showToast('삭제 실패: ' + (e.message || e)); }
    }
    // 메모 본문의 한 줄을 바꾸거나(fn) 지운다(fn=null)
    async _replaceNoteLine(noteId, line, fn) {
        const n = (this.noteList || []).find(x => String(x.id) === String(noteId)); if (!n) return;
        const lines = this._noteText(n).split('\n');
        const m = (lines[line] || '').match(this.NOTE_TODO_RE); if (!m) return;
        if (fn) lines[line] = fn(m); else lines.splice(line, 1);
        n.body = this._joinNote(this._noteMeta(n), lines.join('\n'));
        const { error } = await this.supabase.from('notes').update({ body: n.body }).eq('id', n.id);
        if (error) throw error;
    }
    // 나의 목록에 새 분류 만들기 — 그 목록의 첫 줄을 하나 넣어 자리를 만든다
    async addRemList() {
        const name = await this.showPrompt('새 목록 이름'); if (!name || !name.trim()) return;
        const list_name = name.trim();
        try {
            const { data, error } = await this.supabase.from('reminders')
                .insert([{ title: '첫 할 일', list_name, created_by: this.currentUser?.name || null }]).select('*').single();
            if (error) throw error;
            this.remList = [data, ...(this.remList || [])];
            this.remList2 = 'l:' + list_name;
            this.requestRender();
        } catch (e) { this.showToast('목록 추가 실패: ' + (e.message || e)); }
    }
    toggleRemItem(src, id) {
        if (src === 'rem') return this.toggleReminder(id);
        if (src === 'note') { const [nid, line] = String(id).split('#'); return this.toggleNoteTodo(nid, Number(line)); }
        return this.toggleTodoFromReminders(id);
    }
    // 할 일 화면에서 기존 할일을 끄고 켠다 — todos 테이블을 그대로 쓴다
    async toggleTodoFromReminders(id) {
        let hit = null;
        (mockData.products || []).forEach(p => (p.todos || []).forEach(t => { if (t.id === id) hit = t; }));
        if (!hit) return;
        const next = !hit.completed;
        hit.completed = next; this.requestRender();
        try {
            const { error } = await this.supabase.from('todos').update({ completed: next }).eq('id', id);
            if (error) throw error;
        } catch (e) { hit.completed = !next; this.requestRender(); this.showToast('할일 저장 실패: ' + (e.message || e)); }
    }
    async clearDoneReminders() {
        const ids = (this.remList || []).filter(r => r.done).map(r => r.id);
        if (!ids.length) { this.showToast('지울 완료 항목이 없습니다.'); return; }
        if (!await this.showConfirm(`완료된 할 일 ${ids.length}건을 지울까요?`, '삭제')) return;
        try {
            const { error } = await this.supabase.from('reminders').delete().in('id', ids);
            if (error) throw error;
            this.remList = (this.remList || []).filter(r => !r.done);
            this.requestRender();
        } catch (e) { this.showToast('삭제 실패: ' + (e.message || e)); }
    }

    // ── CS(교환·반품) ─────────────────────────────────────────
    //  노션 실사용 기준으로 설계: 교환·반품이 86%, 유입은 카톡채널 85%, 구매처는 공홈 90%.
    //  상태는 314/323이 '완료'라 단계 관리를 안 썼다 → 기본값을 '완료'로 두고 진행 중인 것만 단계를 올린다.
    //  손으로 채우던 상품명·구매처는 주문번호로 자동으로 끌어온다.
    CS_KINDS = ['교환', '반품', '오배송', '불량', '수선', '기타'];
    CS_STATUSES = ['접수', '수거접수', '수거완료', '완료'];
    CS_CHANNELS = ['카톡채널', '카톡오픈채팅', '게시판', 'DM', '전화'];
    CS_SOURCES = ['공홈', '키디키디', '29cm', '팝업', '기타'];

    async loadCS() {
        this._csLoading = true;
        try {
            const { data, error } = await this.supabase.from('cs_tickets').select('*')
                .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000);
            if (error) throw error;
            this.csList = data || []; this._csLoaded = true;
        } catch (e) { this.csList = []; this._csLoaded = true; this.showToast('CS를 불러오지 못했습니다: ' + (e.message || e)); }
        this._csLoading = false; this.requestRender();
    }
    // 주문번호로 기존 주문을 찾아 상품명·구매처·브랜드를 자동으로 채운다.
    async _csLookupOrder(orderNo) {
        const no = (orderNo || '').trim();
        if (!no) return null;
        try {
            const { data } = await this.supabase.from('channel_orders')
                .select('id, mall_key, channel, receiver_name, buyer_name').eq('order_id', no).limit(1);
            const o = (data || [])[0];
            if (!o) return null;
            const mall = (this.malls || []).find(m => m.mall_key === o.mall_key);
            const { data: items } = await this.supabase.from('channel_order_items')
                .select('product_name').eq('channel_order_id', o.id).limit(3);
            return {
                channel_order_id: o.id,
                brand_id: mall?.brand_id || null,
                purchase_from: o.channel === 'eland' ? '키디키디' : (o.channel === '29cm' ? '29cm' : '공홈'),
                product_name: (items || []).map(i => i.product_name).filter(Boolean).join(', ') || null,
                customer_name: o.receiver_name || o.buyer_name || null,
            };
        } catch (e) { return null; }
    }
    // 주문 화면에서 그 주문으로 바로 교환·반품을 올린다
    csFromOrder(orderNo) {
        const esc = s => this._vesc(s);
        const c = document.getElementById('global-modal-container'); if (!c) return;
        c.innerHTML = `
        <div class="glass modal-content fade-in" style="width:92%;max-width:400px;padding:1.6rem;border-radius:18px">
            <h2 style="margin:0 0 .4rem;font-size:1.1rem">CS 접수</h2>
            <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:1.1rem">
                주문번호 <b style="font-family:monospace;color:var(--text-main)">${esc(orderNo)}</b><br>
                고객·상품·구매처는 주문에서 자동으로 끌어옵니다.
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
                ${this.CS_KINDS.map(k => `<button class="btn-secondary cs-kind" style="padding:9px 16px;border-radius:10px"
                    onclick="app.addCSForOrder('${esc(orderNo)}','${k}')">${k}</button>`).join('')}
            </div>
            <div style="text-align:right;margin-top:1.3rem">
                <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:8px 16px;border-radius:10px">취소</button>
            </div>
        </div>`;
        c.style.display = 'flex';
    }
    async addCSForOrder(orderNo, kind) {
        this.closeGlobalModal();
        const found = await this._csLookupOrder(orderNo);
        try {
            const { error } = await this.supabase.from('cs_tickets').insert([{
                customer_name: found?.customer_name || '(이름없음)',
                kind, status: '접수',
                order_no: orderNo,
                channel_order_id: found?.channel_order_id || null,
                brand_id: found?.brand_id || null,
                purchase_from: found?.purchase_from || '공홈',
                contact_channel: '카톡채널',
                product_name: found?.product_name || null,
                created_by: this.currentUser?.name || null,
            }]);
            if (error) throw error;
            this._csLoaded = false; await this.loadCS();
            this.csQuery = orderNo;
            // CS 탭으로 넘겨서 방금 올린 건을 보여준다
            const w = (this.wins || []).find(x => x.view === 'orders');
            if (w) { w.view = 'cs'; } else if (!this.macMode) { this.currentView = 'cs'; }
            this.requestRender();
            this.showToast(`${kind} 접수됐습니다 · ${orderNo}`);
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    async addCS(kind) {
        const nameEl = document.getElementById('cs-name'), orderEl = document.getElementById('cs-order');
        const name = (nameEl?.value || '').trim(), orderNo = (orderEl?.value || '').trim();
        if (!name && !orderNo) { this.showToast('고객 이름이나 주문번호 중 하나는 입력해주세요'); return; }
        const found = orderNo ? await this._csLookupOrder(orderNo) : null;
        if (orderNo && !found) this.showToast('주문번호를 못 찾아 수동으로 저장합니다');
        try {
            const { error } = await this.supabase.from('cs_tickets').insert([{
                customer_name: name || found?.customer_name || '(이름없음)',
                kind, status: '접수',
                order_no: orderNo || null,
                channel_order_id: found?.channel_order_id || null,
                brand_id: found?.brand_id || null,
                purchase_from: found?.purchase_from || '공홈',
                contact_channel: '카톡채널',
                product_name: found?.product_name || null,
                created_by: this.currentUser?.name || null,
            }]);
            if (error) throw error;
            if (nameEl) nameEl.value = ''; if (orderEl) orderEl.value = '';
            this._csLoaded = false; this.loadCS();
            this.showToast(`${kind} 접수됐습니다`);
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    async setCSStatus(id, status) {
        try {
            const { error } = await this.supabase.from('cs_tickets')
                .update({ status, resolved_at: status === '완료' ? new Date().toISOString() : null }).eq('id', id);
            if (error) throw error;
            const t = (this.csList || []).find(x => x.id === id);
            if (t) { t.status = status; }
            this.requestRender();
        } catch (e) { this.showToast('변경 실패: ' + (e.message || e)); }
    }
    async setCSMemo(id, memo) {
        const t = (this.csList || []).find(x => String(x.id) === String(id)); if (!t) return;
        const v = (memo || '').trim() || null;
        const old = t.memo; t.memo = v;
        const { error } = await this.supabase.from('cs_tickets').update({ memo: v }).eq('id', id);
        if (error) { t.memo = old; this.showToast('저장 실패: ' + error.message); this.requestRender(); }
    }
    async editCSMemo(id) {
        const t = (this.csList || []).find(x => x.id === id); if (!t) return;
        const memo = await this.showPrompt('메모', t.memo || ''); if (memo === null) return;
        try {
            const { error } = await this.supabase.from('cs_tickets').update({ memo: memo || null }).eq('id', id);
            if (error) throw error;
            t.memo = memo || null; this.requestRender();
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    setCSFilter(f) { this.csFilter = f; this.requestRender(); }
    setDocCategory(c) { this.selectedDocCategory = c; this.docSel = null; this.requestRender(); }
    //  새 분류 — 이름을 만들어 두고, 그 분류로 자료를 올리면 자리를 잡는다
    async addDocCategory() {
        const v = await this.showPrompt('새 분류 이름', '', '자료 분류 만들기');
        const name = (v || '').trim(); if (!name) return;
        this.docCats = [...new Set([...(this.docCats || []), name])];
        try { localStorage.setItem('bhas_doccats', JSON.stringify(this.docCats)); } catch (_e) {}
        this.selectedDocCategory = name;
        this.docOpenSec = { ...(this.docOpenSec || {}), '분류': true };
        this.requestRender();
        this.showToast(`'${name}' 분류를 만들었습니다 — 자료를 올리면 자리를 잡습니다`);
    }
    toggleDocSec(name) {
        this.docOpenSec = this.docOpenSec || {};
        const cur = this.docOpenSec[name] === undefined ? (name !== '시즌') : this.docOpenSec[name];
        this.docOpenSec[name] = !cur;
        this.requestRender();
    }
    toggleDocSeason(pid) {
        this.docOpenP = this.docOpenP || {};
        this.docOpenP[pid] = !this.docOpenP[pid];
        this.requestRender();
    }
    selectDoc(id) { this.docSel = id; this.requestRender(); }
    docMenu(ev, id, url, name) {
        this.ctxMenu(ev, [
            { t: '열기', icon: 'ph-arrow-square-out', run: () => this.showFileModal(url, name) },
            { t: '이름 바꾸기', icon: 'ph-textbox', run: () => this.renameDoc(id, name) },
            { t: '링크 복사', icon: 'ph-link', run: () => { navigator.clipboard?.writeText(url); this.showToast('링크를 복사했습니다'); } },
            { sep: true },
            { t: '내려받기', icon: 'ph-download-simple', run: () => { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); } },
        ]);
    }
    docFolderMenu(ev, key) {
        const pid = String(key || '').startsWith('p:') ? String(key).slice(2).split('/')[0] : null;
        this.ctxMenu(ev, [
            ...(pid ? [{ t: '속성 · 접근 권한…', icon: 'ph-info', run: () => this.folderInfo(pid) }, { sep: true }] : []),
            { t: '새 자료 올리기', icon: 'ph-upload-simple', run: () => document.getElementById('quick-add-doc-btn')?.click() },
            { t: '아이콘 보기', icon: 'ph-squares-four', run: () => this.setDocView('grid') },
            { t: '목록 보기', icon: 'ph-list-dashes', run: () => this.setDocView('list') },
        ]);
    }
    async renameDoc(id, old) {
        const v = await this.showPrompt('자료 이름', old || ''); if (v === null || !v.trim()) return;
        try {
            const { error } = await this.supabase.from('documents').update({ name: v.trim() }).eq('id', id);
            if (error) throw error;
            (mockData.products || []).forEach(p => (p.documents || []).forEach(d => { if (String(d.id) === String(id)) d.name = v.trim(); }));
            this.requestRender(); this.showToast('이름을 바꿨습니다');
        } catch (e) { this.showToast('이름 바꾸기 실패: ' + (e.message || e)); }
    }
    setDocView(v) { this.docView = v; this.requestRender(); }
    renderCS() {
        if (!this._csLoaded) return this._loadingSkeleton('CS');
        const esc = s => this._vesc(s);
        const all = this.csList || [];
        const filter = this.csFilter || '진행중';
        const q = (this.csQuery || '').trim();
        const isOpen = t => t.status !== '완료';
        let list = all;
        if (filter === '진행중') list = all.filter(isOpen);
        else if (filter === '교환') list = all.filter(t => t.kind === '교환');
        else if (filter === '반품') list = all.filter(t => t.kind === '반품');
        if ((this.csKind || 'ALL') !== 'ALL') list = list.filter(t => t.kind === this.csKind);
        if ((this.csBrand || 'ALL') !== 'ALL') list = list.filter(t => String(t.brand_id) === String(this.csBrand));
        if (q) list = list.filter(t => [t.customer_name, t.order_no, t.product_name, t.memo].some(v => (v || '').includes(q)));

        const ym = new Date().toISOString().slice(0, 7);
        const thisMonth = all.filter(t => (t.occurred_on || '').startsWith(ym));
        const openCnt = all.filter(isOpen).length;
        const kindColor = k => k === '교환' ? '#6366f1' : k === '반품' ? '#ef4444' : k === '불량' ? '#f59e0b' : '#94a3b8';
        const stColor = s => s === '완료' ? '#16a34a' : s === '수거완료' ? '#0ea5e9' : '#f59e0b';
        const tab = (id, label, n) => `<button onclick="app.setCSFilter('${id}')" style="padding:7px 15px;border-radius:999px;border:1px solid ${filter === id ? 'var(--primary)' : 'var(--card-border)'};background:${filter === id ? 'rgba(99,102,241,0.12)' : 'transparent'};color:${filter === id ? 'var(--primary)' : 'var(--text-main)'};font-size:0.82rem;font-weight:700;cursor:pointer">${label}${n != null ? ` <span style="opacity:0.7">${n}</span>` : ''}</button>`;

        const stOf = t => this.CS_STATUSES.includes(t.status) ? this.CS_STATUSES : [t.status, ...this.CS_STATUSES];
        const row = t => {
            const sc = stColor(t.status), kc = kindColor(t.kind);
            return `<tr class="it-row${String(this.csSel) === String(t.id) ? ' on' : ''}" data-id="${t.id}"
                onclick="app.rowPick(event,'${t.id}','cs')"${t.status === '완료' ? ' style="opacity:.62"' : ''}>
                <td class="nw">${esc((t.occurred_on || '').slice(2))}</td>
                <td><span class="it-tag" style="--c:${kc}">${esc(t.kind)}</span></td>
                <td class="bd">${esc(t.customer_name || '')}</td>
                <td>${esc(this._brandNameById(t.brand_id) === '-' ? '' : this._brandNameById(t.brand_id))}</td>
                <td>${esc(t.purchase_from || '')}</td>
                <td class="nw">${t.order_no ? `${esc(t.order_no)}${t.channel_order_id ? ' <i class="ph ph-link" title="주문 연결됨" style="color:#0a84ff"></i>' : ''}` : ''}</td>
                <td>${esc(t.product_name || '')}${t.exchange_product ? ` <span class="mu">→</span> ${esc(t.exchange_product)}` : ''}</td>
                <td><select class="it-sel it-st" style="color:${sc};border-color:${sc}44;background:${sc}1a"
                        onclick="event.stopPropagation()" onchange="app.setCSStatus('${t.id}',this.value)">
                    ${stOf(t).map(x => `<option value="${esc(x)}"${t.status === x ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></td>
                <td><input class="it-in" value="${esc(t.memo || '')}" placeholder="메모"
                        onclick="event.stopPropagation()" onchange="app.setCSMemo('${t.id}',this.value)"></td>
            </tr>`;
        };
        list = this._applyTbl('cs', list, (t, k2) => ({
            occurred_on: t.occurred_on || '', kind: t.kind || '', customer_name: t.customer_name || '',
            brand: this._brandNameById(t.brand_id) === '-' ? '' : this._brandNameById(t.brand_id),
            purchase_from: t.purchase_from || '', order_no: t.order_no || '',
            product_name: t.product_name || '', status: t.status || '', memo: t.memo || '',
        })[k2] ?? '', all);
        const cnt = k => all.filter(t => t.kind === k).length;
        const pill = (k, label, n) => `<button class="it-pill${filter === k ? ' on' : ''}" onclick="app.setCSFilter('${k}')"
            ${k === '교환' ? 'style="--pc:#6366f1"' : (k === '반품' ? 'style="--pc:#ef4444"' : '')}>${esc(label)}<em>${n}</em></button>`;

        return `<div class="mp">
            ${this._mpTop('CS · 교환/반품', `이번 달 ${thisMonth.length}건 · 진행 중 ${openCnt}건 · 전체 ${all.length}건`, `
                <div class="mp-find"><i class="ph ph-magnifying-glass"></i>
                    <input value="${esc(q)}" placeholder="이름·주문번호·상품"
                        oninput="app.csQuery=this.value;clearTimeout(app._csT);app._csT=setTimeout(()=>app.requestRender(),250)"></div>`)}
            <div class="it-pills">
                ${pill('진행중', '진행 중', openCnt)}${pill('전체', '전체', all.length)}${pill('교환', '교환', cnt('교환'))}${pill('반품', '반품', cnt('반품'))}
            </div>
            <div class="nw-bar">
                <input id="cs-name" class="nw-f" placeholder="고객 이름" style="max-width:130px">
                <input id="cs-order" class="nw-f" placeholder="주문번호 — 넣으면 상품·구매처가 따라온다" style="flex:1">
                <button class="mbtn pri" onclick="app.addCS('교환')">교환 접수</button>
                <button class="mbtn" style="color:#ef4444" onclick="app.addCS('반품')">반품 접수</button>
                ${['오배송', '불량', '수선', '기타'].map(k => `<button class="mbtn" onclick="app.addCS('${k}')">+ ${k}</button>`).join('')}
            </div>
            <div class="it-scroll">
                <table class="it-tbl"><thead><tr>${this._thead('cs', [
                    ['occurred_on', '접수일'], ['kind', '유형'], ['customer_name', '고객'], ['brand', '브랜드'],
                    ['purchase_from', '구매처'], ['order_no', '주문번호'], ['product_name', '상품'],
                    ['status', '상태'], ['memo', '메모']])}
                </tr></thead>
                <tbody>${list.length ? list.slice(0, 300).map(row).join('')
                    : `<tr><td colspan="9" class="it-none">해당하는 건이 없습니다</td></tr>`}</tbody></table>
                ${list.length > 300 ? `<div class="it-more">최근 300건만 보입니다 · 전체 ${list.length}건</div>` : ''}
            </div>
        </div>`;
    }

    // ── 법인카드 지출 ─────────────────────────────────────────
    //  노션 448건 분석: 사용자·요청·계산서 칼럼은 전부 빈칸이라 만들지 않았다.
    //  실제로 쓴 것은 사용처·금액·사용회사·완료 체크 네 개뿐.
    EXP_COMPANIES = ['하이헤이호', '모마레', '로하이스튜디오', '토비', '브하스', '더하임프로모션'];
    async loadExpenses() {
        this._expLoading = true;
        try {
            const { data, error } = await this.supabase.from('expenses').select('*')
                .order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(1000);
            if (error) throw error;
            this.expList = data || []; this._expLoaded = true;
        } catch (e) { this.expList = []; this._expLoaded = true; this.showToast('지출을 불러오지 못했습니다: ' + (e.message || e)); }
        this._expLoading = false; this.requestRender();
    }
    async addExpense() {
        const v = document.getElementById('exp-vendor'), a = document.getElementById('exp-amount'), d = document.getElementById('exp-date');
        const vendor = (v?.value || '').trim();
        const amount = Number((a?.value || '').replace(/[^0-9.-]/g, ''));
        if (!vendor) { this.showToast('사용처를 입력해주세요'); return; }
        if (!amount) { this.showToast('금액을 입력해주세요'); return; }
        try {
            const { error } = await this.supabase.from('expenses').insert([{
                vendor, amount,
                company: this.expCompany || '하이헤이호',
                spent_on: (d?.value || new Date().toISOString().slice(0, 10)),
                created_by: this.currentUser?.name || null,
            }]);
            if (error) throw error;
            if (v) v.value = ''; if (a) a.value = '';
            this._expLoaded = false; this.loadExpenses();
            this.showToast('지출이 기록됐습니다');
        } catch (e) { this.showToast('저장 실패: ' + (e.message || e)); }
    }
    async setExpField(id, field, value) {
        const e = (this.expList || []).find(x => String(x.id) === String(id)); if (!e) return;
        const v = (value || '').trim() || null;
        const old = e[field]; e[field] = v;
        const { error } = await this.supabase.from('expenses').update({ [field]: v }).eq('id', id);
        if (error) { e[field] = old; this.showToast('저장 실패: ' + error.message); this.requestRender(); }
    }
    async toggleExpenseDone(id) {
        const e0 = (this.expList || []).find(x => x.id === id); if (!e0) return;
        try {
            const { error } = await this.supabase.from('expenses').update({ done: !e0.done }).eq('id', id);
            if (error) throw error;
            e0.done = !e0.done; this.requestRender();
        } catch (e) { this.showToast('변경 실패: ' + (e.message || e)); }
    }
    setExpCompany(c) { this.expCompany = c; this.requestRender(); }
    setExpMonth(m) { this.expMonth = m; this.requestRender(); }
    renderExpenses() {
        if (!this._expLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">지출을 불러오는 중...</div>`;
        const esc = s => this._vesc(s);
        const won = n => (Number(n) || 0).toLocaleString('ko-KR');
        const all = this.expList || [];
        const months = [...new Set(all.map(e => (e.spent_on || '').slice(0, 7)).filter(Boolean))].sort().reverse();
        const month = this.expMonth || months[0] || new Date().toISOString().slice(0, 7);
        let list = all.filter(e => (e.spent_on || '').startsWith(month));
        if ((this.expCoFilter || 'ALL') !== 'ALL') list = list.filter(e => (e.company || '미지정') === this.expCoFilter);
        const total = list.reduce((s, e) => s + Number(e.amount || 0), 0);
        const byCo = {};
        list.forEach(e => { const k = e.company || '미지정'; byCo[k] = (byCo[k] || 0) + Number(e.amount || 0); });
        const sel = this.expCompany || '하이헤이호';

        const esc2 = esc;
        const row = e => `<tr class="it-row" data-id="${e.id}">
            <td class="nw">${esc(e.spent_on || '')}</td>
            <td class="bd">${esc(e.vendor || '')}</td>
            <td>${esc(e.company || '')}</td>
            <td><input class="it-in" value="${esc(e.memo || '')}" placeholder="메모"
                    onchange="app.setExpField('${e.id}','memo',this.value)"></td>
            <td class="num">${won(e.amount)}</td>
            <td class="it-c"><button class="it-ib${e.done ? ' on' : ''}" title="${e.done ? '처리됨' : '미처리'}"
                onclick="app.toggleExpenseDone('${e.id}')"><i class="ph ${e.done ? 'ph-check-circle' : 'ph-circle'}"></i></button></td>
        </tr>`;
        list = this._applyTbl('expenses', list, (e, k2) => ({
            spent_on: e.spent_on || '', vendor: e.vendor || '', company: e.company || '미지정',
            memo: e.memo || '', amount: Number(e.amount) || 0, done: e.done ? '처리됨' : '미처리',
        })[k2] ?? '', all);
        const coBits = Object.entries(byCo).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `<span class="sum-b"><em>${esc(k)}</em>${won(v)}원</span>`).join('');

        return `<div class="mp">
            ${this._mpTop('정산', `지출 · ${esc(month)} 합계 ${won(total)}원 · ${list.length}건`, `
                ${this._moneyTabs('expenses')}
                <select class="it-sel it-season" onchange="app.setExpMonth(this.value)">
                    ${months.slice(0, 24).map(m => `<option value="${m}"${m === month ? ' selected' : ''}>${m}</option>`).join('')}
                </select>`)}
            <div class="nw-bar">
                <input id="exp-vendor" class="nw-f" placeholder="사용처 (예: 119퀵화물)" style="flex:1.4;min-width:130px">
                <input id="exp-amount" class="nw-f" inputmode="numeric" placeholder="금액" style="width:96px">
                <input id="exp-date" class="nw-f" type="date" value="${new Date().toISOString().slice(0, 10)}">
                <select class="it-sel" onchange="app.setExpCompany(this.value)" style="max-width:120px">
                    ${this.EXP_COMPANIES.map(c => `<option value="${esc(c)}"${sel === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}
                </select>
                <button class="mbtn pri" onclick="app.addExpense()">기록</button>
            </div>
            ${coBits ? `<div class="sum-bar">${coBits}</div>` : ''}
            <div class="it-scroll">
                <table class="it-tbl"><thead><tr>
                    ${this._thead('expenses', [['spent_on', '지출일'], ['vendor', '사용처'], ['company', '회사'],
                        ['memo', '메모'], ['amount', '금액', 'num'], ['done', '처리', 'it-c']])}
                </tr></thead>
                <tbody>${list.length ? list.map(row).join('')
                    : `<tr><td colspan="6" class="it-none">이 달 기록이 없습니다</td></tr>`}</tbody>
                ${list.length ? `<tfoot><tr><td colspan="4">합계</td><td class="num">${won(total)}</td><td></td></tr></tfoot>` : ''}
                </table>
            </div>
        </div>`;
    }
    async loadFeedback() {
        this._fbLoading = true;
        try {
            const { data, error } = await this.supabase.from('feedback').select('*').order('created_at', { ascending: false });
            if (error) throw error;
            this.feedbackList = data || []; this._fbLoaded = true;
        } catch (e) { this.feedbackList = []; this._fbLoaded = true; }
        this._fbLoading = false; this.requestRender();
    }
    async resolveFeedback(id, resolve) {
        try {
            const { error } = await this.supabase.from('feedback').update({
                status: resolve ? 'resolved' : 'open',
                resolved_at: resolve ? new Date().toISOString() : null,
                resolved_by: resolve ? (this.currentUser?.name || null) : null,
            }).eq('id', id);
            if (error) throw error;
            this._fbLoaded = false; this.loadFeedback();
        } catch (e) { this.showToast('처리 실패: ' + (e.message || e)); }
    }
    renderFeedback() {
        if (!this._fbLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">불편사항을 불러오는 중...</div>`;
        const list = this.feedbackList || [];
        const open = list.filter(f => f.status !== 'resolved'), done = list.filter(f => f.status === 'resolved');
        const catColor = c => c === '버그' ? '#ef4444' : c === '개선요청' ? '#6366f1' : c === '불편' ? '#f59e0b' : '#94a3b8';
        const esc = s => this._vesc(s);
        const when = t => t ? new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        const card = f => `<div class="glass" style="padding:1.1rem 1.25rem;border-radius:16px;margin-bottom:0.8rem;${f.status === 'resolved' ? 'opacity:0.6' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="font-size:0.7rem;font-weight:800;color:#fff;background:${catColor(f.category)};padding:2px 9px;border-radius:20px">${esc(f.category || '기타')}</span>
                    <span style="font-size:0.82rem;font-weight:700">${esc(f.author_name || '익명')}</span>
                    ${f.page ? `<span style="font-size:0.68rem;color:var(--text-muted)">· ${esc(f.page)} 화면</span>` : ''}
                </div>
                <span style="font-size:0.7rem;color:var(--text-muted);white-space:nowrap">${when(f.created_at)}</span>
            </div>
            <div style="font-size:0.9rem;line-height:1.5;white-space:pre-wrap;margin-bottom:9px">${esc(f.message || '')}</div>
            <div style="display:flex;justify-content:flex-end;gap:8px">
                ${f.status === 'resolved'
                ? `<span style="font-size:0.72rem;color:#16a34a;font-weight:700">✓ 해결됨${f.resolved_by ? ' · ' + esc(f.resolved_by) : ''}</span><button onclick="app.resolveFeedback('${f.id}',false)" style="font-size:0.72rem;padding:5px 11px;border-radius:8px;border:1px solid var(--card-border);background:transparent;color:var(--text-muted);cursor:pointer">되돌리기</button>`
                : `<button onclick="app.resolveFeedback('${f.id}',true)" class="btn-primary" style="font-size:0.74rem;padding:6px 13px;border-radius:9px"><i class="ph ph-check"></i> 해결 처리</button>`}
            </div>
        </div>`;
        return `<div class="mp">
            ${this._mpTop('불편사항', `직원 접수 ${list.length}건 · 미처리 ${open.length}건`)}
            <div class="mp-body">
            ${open.length ? open.map(card).join('') : '<div class="glass" style="padding:2rem;border-radius:16px;color:var(--text-muted);text-align:center">미처리 불편사항이 없습니다 👍</div>'}
            ${done.length ? `<div style="font-size:0.8rem;color:var(--text-muted);font-weight:700;margin:1.6rem 2px 0.7rem">해결됨 (${done.length})</div>${done.map(card).join('')}` : ''}
        </div></div>`;
    }

    // ============================================================
    //  멀티몰 (브랜드별 카페24몰)
    // ============================================================
    async loadMalls() {
        this._mallsLoading = true;
        try {
            // 동기화 원본 테이블에는 토큰이 있어 직접 읽지 않는다.
            // 상태값만 반환하는 관리자 전용 RPC로 합류한다.
            const [mallsRes, statusRes] = await Promise.all([
                this.supabase.from('malls').select('*').order('created_at', { ascending: true }),
                this.supabase.rpc('get_channel_operational_status'),
            ]);
            const status = statusRes.data || {};
            const syncRes = { data: status.sync || [] };
            const connectionRes = { data: status.connections || [] };
            const syncBy = {};
            (syncRes.data || []).forEach(s => { syncBy[s.mall_key] = s; });
            this.malls = (mallsRes.data || []).map(m => ({ ...m, ...(syncBy[m.mall_key] || {}) }));
            this.channelConnections = connectionRes.data || [];
            this._mallsLoaded = true;
        } catch (e) { this.malls = []; this._mallsLoaded = true; }
        this._mallsLoading = false;
        this.requestRender();
    }
    _mallLabel(key) { const m = (this.malls || []).find(m => m.mall_key === key); return m ? m.label : (key || '-'); }
    _mallBrand(key) { const m = (this.malls || []).find(m => m.mall_key === key); if (!m) return null; return (mockData.brands || []).find(b => b.id === m.brand_id) || null; }
    _mallChannel(key) { const m = (this.malls || []).find(m => m.mall_key === key); return String(m?.channel || '').toLowerCase(); }
    _isCafe24Order(o) { return String(o?.channel || this._mallChannel(o?.mall_key) || '').toLowerCase() === 'cafe24'; }
    // 배경색 명도로 읽기 좋은 글자색(흰/검) 자동 선택
    _contrastText(hex) {
        if (typeof hex !== 'string' || hex[0] !== '#') return '#ffffff';
        let c = hex.slice(1);
        if (c.length === 3) c = c.split('').map(x => x + x).join('');
        if (c.length < 6) return '#ffffff';
        const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return lum > 0.6 ? '#1a1a1a' : '#ffffff';
    }
    _mallOptions(selected) {
        return `<option value="" style="background:#0f172a">몰 선택 안 함</option>` +
            (this.malls || []).map(m => `<option value="${m.mall_key}" style="background:#0f172a" ${m.mall_key === selected ? 'selected' : ''}>${m.label}</option>`).join('');
    }
    _oauthUrl(mallKey) { return `${SUPABASE_URL}/functions/v1/cafe24-oauth?mall=${encodeURIComponent(mallKey)}`; }

    // ============================================================
    //  주문/배송 통합관리 (OMS) — 카페24
    // ============================================================
    // 수동 동기화 — 최신 주문·매출·채널상태를 다시 불러온다(대시보드가 로드시점 값이라 안 갱신되던 문제 해소)
    async refreshData() {
        if (this._refreshing) return;
        this._refreshing = true; this.requestRender();
        try {
            this._ordersLoaded = false; this._ordersLoading = false;
            this._mallsLoaded = false; this._mallsLoading = false;
            await Promise.all([this.loadOrders(), this.loadMalls()]);
            this.showToast('최신 데이터로 동기화됐어요');
        } catch (e) { this.showToast('동기화 실패: ' + (e?.message || e)); }
        this._refreshing = false; this.requestRender();
    }
    async loadOrders() {
        this._ordersLoading = true;
        try {
            const { data: ordersData, error } = await this.supabase.from('channel_orders')
                .select('*').order('order_date', { ascending: false }).limit(500);
            if (error) throw error;
            const list = ordersData || [];
            const [items] = await Promise.all([
                this._itemsFor(list.map(o => o.id)),   // 전량(24,000행) 대신 이 500건 것만
                this._loadSalesAgg(),                  // 매출은 서버 집계본만(주문 원본 안 받음)
            ]);
            const byOrder = {};
            items.forEach(it => { (byOrder[it.channel_order_id] = byOrder[it.channel_order_id] || []).push(it); });
            this.orders = list.map(o => ({ ...o, items: byOrder[o.id] || [] }));
            this._ordersLoaded = true;
            this._dataLoadedAt = Date.now();
        } catch (e) {
            this.showToast('주문을 불러오지 못했습니다. (스키마 설치 필요할 수 있음)');
            this.orders = []; this._ordersLoaded = true;
        }
        this._ordersLoading = false;
        this.requestRender();
    }

    // 주문 id 목록에 해당하는 아이템만. URL 길이 제한이 있어 100개씩 끊어서 요청.
    async _itemsFor(ids) {
        if (!ids || !ids.length) return [];
        const out = [];
        for (let i = 0; i < ids.length; i += 100) {
            const { data } = await this.supabase.from('channel_order_items').select('*')
                .in('channel_order_id', ids.slice(i, i + 100));
            out.push(...(data || []));
        }
        return out;
    }

    // 매출 집계본 — 서버(021 뷰)에서 이미 집계된 결과. 주문 12,000건(6MB) 대신 ~115KB.
    async _loadSalesAgg() {
        const pageAll = async (table) => {
            const PAGE = 1000, acc = [];
            for (let from = 0; ; from += PAGE) {
                const { data, error } = await this.supabase.from(table).select('*').range(from, from + PAGE - 1);
                if (error) throw error;
                const rows = data || [];
                acc.push(...rows);
                if (rows.length < PAGE) break;
            }
            return acc;
        };
        // 각 뷰를 독립적으로 로드 — 한 뷰가 (일시적 오류·권한 등으로) 실패해도 매출 전체가 날아가지 않게.
        //  한 번 실패 시 1회 재시도. 핵심(sales_monthly)이 끝내 실패할 때만 전체 폴백(_salesAggFromOrders).
        const safe = async (table) => {
            for (let attempt = 0; attempt < 2; attempt++) {
                try { return await pageAll(table); }
                catch (e) { if (attempt === 1) { console.warn('[salesAgg] load fail:', table, e?.message || e); return null; } }
            }
            return null;
        };
        const [monthly, daily, channel, stateTotals, financialDaily, brandChannel] = await Promise.all([
            safe('sales_monthly'), safe('sales_daily'),
            safe('sales_channel_monthly'), safe('order_state_totals'),
            safe('dashboard_financial_daily'), safe('sales_brand_channel_monthly'),
        ]);
        if (!monthly) { this.salesAggData = null; return; }   // 브랜드 월매출의 근간이 없으면 클라 집계 폴백
        this.salesAggData = {
            monthly, daily: daily || [], channel: channel || [],
            stateTotals: stateTotals || [], financialDaily: financialDaily || [], brandChannel: brandChannel || [],
        };
    }

    // 브랜드 상세용 주문 슬라이스 — 인기상품·옵션·재구매·반품 카드는 원본 주문이 필요하다.
    // 전체가 아니라 '선택 브랜드 + 선택 기간'만 받으므로 수백 건이면 끝난다.
    async _loadSalesScope(brandName, fromISO, toISO) {
        const key = `${brandName}|${fromISO}|${toISO}`;
        if (this._salesScopeKey === key || this._salesScopeLoading) return;
        this._salesScopeLoading = true;
        try {
            const mallKeys = (this.malls || [])
                .filter(m => {
                    const b = (mockData.brands || []).find(x => x.id === m.brand_id);
                    return (b ? b.name : (m.label || m.mall_key)) === brandName;
                })
                .map(m => m.mall_key);
            let q = this.supabase.from('channel_orders_slim').select('*')
                .gte('order_date', fromISO).lt('order_date', toISO);
            if (mallKeys.length) q = q.in('mall_key', mallKeys);
            const { data, error } = await q.order('order_date', { ascending: false });
            if (error) throw error;
            const rows = data || [];
            const items = await this._itemsFor(rows.map(o => o.id));
            const byOrder = {};
            items.forEach(it => { (byOrder[it.channel_order_id] = byOrder[it.channel_order_id] || []).push(it); });
            const withItems = rows.map(o => ({ ...o, items: byOrder[o.id] || [] }));
            this.salesScoped = {
                orders: withItems.filter(o => o.pay_amount != null && !this._isCancelled(o)),
                cancelled: withItems.filter(o => this._isCancelled(o)),
            };
            this._salesScopeKey = key;
        } catch (e) {
            this.salesScoped = { orders: [], cancelled: [] };
            this._salesScopeKey = key;
        }
        this._salesScopeLoading = false;
        this.requestRender();
    }

    _orderStatusLabel(s) { return ({ new: '신규', ready: '채널등록대기', shipping: '배송중', done: '완료', hold: '보류' })[s] || s; }
    _orderItemsSummary(o) {
        const its = o.items || [];
        if (!its.length) return '-';
        const first = its[0].product_name || its[0].variant_code || '상품';
        return its.length > 1 ? `${first} 외 ${its.length - 1}건` : first;
    }
    _orderQtySum(o) { return (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0); }

    renderOrders() {
        if (!this._ordersLoaded) return this._loadingSkeleton('주문');
        const filter = this.orderFilter || 'target';
        let all = this.orders || [];
        const mallF = this.orderMall || 'ALL';
        if (mallF !== 'ALL') all = all.filter(o => o.mall_key === mallF);
        const counts = {
            target: all.filter(o => o.status === 'new' || o.status === 'ready').length,
            shipping: all.filter(o => o.status === 'shipping').length,
            done: all.filter(o => o.status === 'done').length,
            all: all.length
        };
        let rows = all;
        if (filter === 'target') rows = all.filter(o => o.status === 'new' || o.status === 'ready');
        else if (filter === 'shipping') rows = all.filter(o => o.status === 'shipping');
        else if (filter === 'done') rows = all.filter(o => o.status === 'done');

        const ls = (this.inventory && this.inventory.lastSync) || null;
        const tab = (id, label, n) => `<button class="oms-tab ${filter === id ? 'on active' : ''}" data-f="${id}">${label} ${n}</button>`;

        const body = rows.map(o => {
            const items = o.items || [];
            const multi = items.length > 1;
            const prodCell = multi
                ? `<button class="oms-expand" data-id="${o.order_id}" style="background:none;border:none;color:var(--text-main);cursor:pointer;text-align:left;font-size:0.88rem;display:inline-flex;align-items:center;gap:6px;padding:0"><i class="ph ph-caret-right oms-caret" style="font-size:0.9rem;color:var(--primary);transition:transform .2s"></i>${this._orderItemsSummary(o)}</button>`
                : this._orderItemsSummary(o);
            const detail = multi ? `<tr class="oms-detail" data-for="${o.order_id}" style="display:none"><td colspan="9" style="padding:2px 10px 12px 42px;background:rgba(var(--tint),0.04)"><div style="display:flex;flex-direction:column;gap:5px;padding:6px 0">${items.map(it => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:0.83rem"><span style="color:var(--text-muted)">${this._vesc(it.product_name || it.variant_code || '상품')}${it.option_name ? ` · ${this._vesc(it.option_name)}` : ''}</span><span style="color:var(--text-main);font-weight:600;white-space:nowrap">${it.quantity || 1}개</span></div>`).join('')}</div></td></tr>` : '';
            return `
            <tr class="ordrow${String(this.orderSel) === String(o.order_id) ? ' on' : ''}"
                onclick="app.selectOrder('${o.order_id}')" style="border-bottom:1px solid var(--card-border)">
                <td style="padding:10px;text-align:center"><input type="checkbox" class="oms-chk" data-id="${o.order_id}" style="accent-color:var(--primary)" onclick="event.stopPropagation()"></td>
                <td style="padding:10px;font-family:monospace;font-size:0.82rem">${o.order_id}
                    <button class="ord-cs" title="이 주문으로 CS 접수" onclick="event.stopPropagation();app.csFromOrder('${o.order_id}')">CS</button></td>
                <td style="padding:10px">${(() => { const _mc = this._mallBrand(o.mall_key)?.brand_color || '#6366f1'; return `<span style="font-size:0.72rem;padding:2px 9px;border-radius:10px;background:${_mc}22;color:var(--text-main);display:inline-flex;align-items:center;gap:5px;white-space:nowrap"><span style="width:7px;height:7px;border-radius:50%;background:${_mc};flex-shrink:0"></span>${this._mallLabel(o.mall_key)}</span>`; })()}</td>
                <td style="padding:10px;color:var(--text-muted);font-size:0.82rem">${o.order_date ? new Date(o.order_date).toLocaleDateString('ko-KR') : '-'}</td>
                <td style="padding:10px">${o.receiver_name || o.buyer_name || '-'}</td>
                <td style="padding:10px;font-size:0.88rem">${prodCell}</td>
                <td style="padding:10px;text-align:center">${this._orderQtySum(o)}</td>
                <td style="padding:10px;text-align:center"><span style="font-size:0.72rem;padding:2px 10px;border-radius:10px;background:${o.status === 'shipping' ? 'rgba(34,197,94,0.18)' : (o.status === 'done' ? 'rgba(148,163,184,0.18)' : 'rgba(245,158,11,0.18)')};color:${o.status === 'shipping' ? '#22c55e' : (o.status === 'done' ? '#94a3b8' : '#f59e0b')}">${this._orderStatusLabel(o.status)}</span></td>
                <td style="padding:10px;font-size:0.8rem;color:var(--text-muted)">${o.invoice_no ? `${o.courier || ''} ${o.invoice_no}` : '-'}</td>
            </tr>${detail}`;
        }).join('') || `<tr><td colspan="9" style="padding:2rem;text-align:center;color:var(--text-muted)">주문이 없습니다. 카페24 동기화가 돌면 여기로 모입니다.</td></tr>`;

        return `
        <div class="mp">
            ${this._mpTop('주문 · 배송', `배송대상 ${counts.target} · 배송중 ${counts.shipping} · 완료 ${counts.done}`, `
                <button class="mbtn" id="oms-sync-btn"><i class="ph ph-arrows-clockwise"></i> 주문 수집</button>
                <button class="mbtn" id="oms-export-btn"><i class="ph ph-download-simple"></i> 송장양식</button>
                <button class="mbtn pri" id="oms-epost-btn"><i class="ph ph-package"></i> 우체국 발번+등록</button>
                <button class="mbtn" id="oms-upload-btn"><i class="ph ph-upload-simple"></i> 송장 업로드</button>
                <input type="file" id="oms-invoice-file" accept=".csv,text/csv" style="display:none">`)}
            <div class="mp-body">
            <div class="mp-seg" style="margin-bottom:12px">
                ${tab('target', '배송대상', counts.target)}${tab('shipping', '배송중', counts.shipping)}${tab('done', '완료', counts.done)}${tab('all', '전체', counts.all)}
            </div>
            <div class="table-container" style="overflow-x:auto">
                <table class="mtbl" style="width:100%;border-collapse:collapse;min-width:720px">
                    <thead><tr style="color:var(--text-muted);font-size:0.8rem;text-align:left">
                        <th style="text-align:center"><input type="checkbox" id="oms-chk-all" style="accent-color:var(--primary)"></th>
                        <th>주문번호</th><th>몰</th><th>주문일</th><th>받는분</th>
                        <th>상품</th><th style="text-align:center">수량</th><th style="text-align:center">상태</th><th>송장</th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
            <div style="margin-top:1rem;padding:1rem;background:rgba(var(--tint),0.03);border-radius:12px;font-size:0.82rem;color:var(--text-muted);line-height:1.7">
                <b style="color:#e2e8f0">송장 처리 흐름</b><br>
                <b style="color:#fb7185">■ 자동(권장):</b> 주문 체크(또는 배송대상 전체) → <b>우체국 발번+송장등록</b> 한 번이면 → 우체국 계약택배 발번(운송장번호) → 카페24 등 채널에 배송중+송장 자동 입력까지 끝.<br>
                <b style="color:#94a3b8">■ 수동(택배사 직접):</b> ① 송장양식 다운로드 → 택배사 프로그램 출력 → ② 송장번호 업로드(CSV) → ③ 카페24 자동 등록 ${ls && ls.result === 'dry_run' ? '<span style="color:#f59e0b">(현재 dry-run)</span>' : ''}
            </div>
        </div></div>`;
    }

    bindOrdersEvents() {
        this.appContainer.querySelectorAll('.oms-tab').forEach(t => t.onclick = () => this.setState({ orderFilter: t.dataset.f }));
        this.appContainer.querySelectorAll('.oms-expand').forEach(b => b.onclick = () => {
            const dr = this.appContainer.querySelector(`.oms-detail[data-for="${b.dataset.id}"]`);
            const caret = b.querySelector('.oms-caret');
            if (dr) { const show = dr.style.display === 'none'; dr.style.display = show ? 'table-row' : 'none'; if (caret) caret.style.transform = show ? 'rotate(90deg)' : ''; }
        });
        const chkAll = document.getElementById('oms-chk-all');
        if (chkAll) chkAll.onclick = () => this.appContainer.querySelectorAll('.oms-chk').forEach(c => { c.checked = chkAll.checked; });
        const syncBtn = document.getElementById('oms-sync-btn');
        if (syncBtn) syncBtn.onclick = () => this.runCafe24Sync();
        const exportBtn = document.getElementById('oms-export-btn');
        if (exportBtn) exportBtn.onclick = () => this.exportInvoiceTemplate();
        const epostBtn = document.getElementById('oms-epost-btn');
        if (epostBtn) epostBtn.onclick = () => this.issueEpostWaybills();
        const upBtn = document.getElementById('oms-upload-btn');
        const fileEl = document.getElementById('oms-invoice-file');
        if (upBtn && fileEl) {
            upBtn.onclick = () => fileEl.click();
            fileEl.onchange = (e) => { const f = e.target.files[0]; if (f) this.handleInvoiceUpload(f); e.target.value = ''; };
        }
    }

    _csvCell(v) { const s = (v == null ? '' : String(v)).replace(/"/g, '""'); return `"${s}"`; }

    exportInvoiceTemplate() {
        const targets = (this.orders || []).filter(o => o.status === 'new' || o.status === 'ready');
        if (!targets.length) { this.showToast('배송대상 주문이 없습니다.'); return; }
        const header = ['주문번호', '받는분', '전화번호', '우편번호', '주소', '상품명', '수량', '메모'];
        const lines = [header.map(this._csvCell).join(',')];
        targets.forEach(o => {
            lines.push([
                o.order_id, o.receiver_name || o.buyer_name || '', o.receiver_phone || '',
                o.receiver_zipcode || '', o.receiver_address || '',
                this._orderItemsSummary(o), this._orderQtySum(o), o.memo || ''
            ].map(v => this._csvCell(v)).join(','));
        });
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        const today = kstYMD();
        a.href = URL.createObjectURL(blob);
        a.download = `송장양식_${today}_${targets.length}건.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        this.showToast(`${targets.length}건 송장양식을 내려받았습니다.`);
    }

    async issueEpostWaybills() {
        // 선택된 주문(체크) 없으면 배송대상 전체, 이미 송장 있는 건 제외
        const checked = [...this.appContainer.querySelectorAll('.oms-chk:checked')].map(c => String(c.dataset.id));
        let targets = (this.orders || []).filter(o => o.status === 'new' || o.status === 'ready');
        if (checked.length) targets = targets.filter(o => checked.includes(String(o.order_id)));
        targets = targets.filter(o => !o.invoice_no);
        if (!targets.length) { this.showToast('발번할 배송대상 주문이 없습니다. (체크 없으면 배송대상 전체 대상)'); return; }

        const ok = await this.showConfirm(`${targets.length}건을 우체국 계약택배로 <b>실제 발번</b>하고, 받은 운송장번호를 채널(카페24 등)에 자동 등록합니다. 계속할까요?`, '우체국 발번 + 송장등록');
        if (!ok) return;
        this.showToast(`${targets.length}건 우체국 발번 중...`);

        const digits = s => String(s || '').replace(/[^0-9]/g, '');
        const orders = targets.map(o => ({
            mallKey: String(o.mall_key || ''),
            orderNo: String(o.order_id),
            ordCompNm: this._mallLabel(o.mall_key) || '브하스',
            recNm: o.receiver_name || o.buyer_name || '수취인',
            recZip: digits(o.receiver_zipcode),
            recAddr1: o.receiver_address || '', recAddr2: o.receiver_address_detail || '.',
            recMob: digits(o.receiver_phone),
            goodsNm: this._orderItemsSummary(o) || '상품',
            qty: this._orderQtySum(o) || 1, weight: 1, volume: 60, contCd: '021',
        }));

        let results = [];
        try {
            const { data, error } = await this.supabase.functions.invoke('courier-issue', { body: { test: false, orders } });
            if (error) throw error;
            results = data?.results || [];
        } catch (e) { this.showToast('발번 실패: ' + (e.message || e)); return; }

        const issued = {}; const fails = [];
        results.forEach(r => { if (r.ok && r.regiNo) issued[String(r.orderNo)] = r.regiNo; else fails.push(`${r.orderNo}: ${r.message || '실패'}`); });
        const issuedIds = Object.keys(issued);
        if (!issuedIds.length) { this.showToast(`발번 0건. ${fails[0] || ''}`); return; }
        this.showToast(`${issuedIds.length}건 발번 완료 → 채널에 송장 등록 중...`);

        // 채널 write-back: 카페24만 API 등록. 다른 채널은 송장번호를 보존하되
        // 실제 채널 반영 전이므로 배송중으로 속이지 않고 '채널등록대기'로 둔다.
        const byCafe = {}; const others = [];
        targets.forEach(o => {
            const regi = issued[String(o.order_id)]; if (!regi) return;
            const isCafe = this._isCafe24Order(o);
            if (isCafe) (byCafe[o.mall_key] = byCafe[o.mall_key] || []).push({ order_id: o.order_id, invoice_no: regi, courier_name: '우체국택배' });
            else others.push({ mall_key: o.mall_key, order_id: o.order_id, regi });
        });
        let backOk = 0, pending = 0;
        for (const mk of Object.keys(byCafe)) {
            try { const { data, error } = await this.supabase.functions.invoke('cafe24-shipping', { body: { mall: mk, orders: byCafe[mk] } }); if (error) throw error; backOk += (data?.success || 0); }
            catch (e) { this.showToast(`[${this._mallLabel(mk)}] 송장등록 실패: ${e.message || e}`); }
        }
        for (const x of others) {
            try {
                const { error } = await this.supabase.from('channel_orders')
                    .update({ invoice_no: x.regi, courier: '우체국택배', status: 'ready' })
                    .eq('mall_key', x.mall_key).eq('order_id', String(x.order_id));
                if (error) throw error;
                pending++;
            } catch (e) { this.showToast(`[${this._mallLabel(x.mall_key)}] 송장 저장 실패: ${e.message || e}`); }
        }
        this.showToast(`발번 ${issuedIds.length}건 / 채널등록 ${backOk}건${pending ? ` / 등록대기 ${pending}건` : ''}${fails.length ? ` · 발번실패 ${fails.length}건` : ''}`);
        this._ordersLoaded = false;
        await this.loadOrders();
    }

    _parseCsv(text) {
        // 간단 CSV 파서 (따옴표/콤마 처리)
        const rows = [];
        const lines = text.replace(/\r\n/g, '\n').replace(/^﻿/, '').split('\n').filter(l => l.trim());
        for (const line of lines) {
            const cells = []; let cur = '', inQ = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (inQ) {
                    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                    else if (ch === '"') inQ = false;
                    else cur += ch;
                } else {
                    if (ch === '"') inQ = true;
                    else if (ch === ',') { cells.push(cur); cur = ''; }
                    else cur += ch;
                }
            }
            cells.push(cur);
            rows.push(cells.map(c => c.trim()));
        }
        return rows;
    }

    async handleInvoiceUpload(file) {
        const text = await file.text();
        const rows = this._parseCsv(text);
        if (rows.length < 2) { this.showToast('업로드할 데이터가 없습니다.'); return; }
        // 헤더 매핑: 주문번호 / 택배사 / 송장번호 (순서·헤더명 유연 처리)
        const head = rows[0].map(h => h.replace(/\s/g, ''));
        const idxOrder = head.findIndex(h => /주문(번호)?|order/i.test(h));
        const idxCourier = head.findIndex(h => /택배사|courier|배송사/i.test(h));
        const idxInv = head.findIndex(h => /송장|운송장|invoice|tracking/i.test(h));
        if (idxOrder < 0 || idxInv < 0) { this.showToast('헤더에 "주문번호"와 "송장번호" 열이 필요합니다.'); return; }

        const orders = [];
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const oid = r[idxOrder]; const inv = r[idxInv];
            if (!oid || !inv) continue;
            orders.push({ order_id: oid, invoice_no: inv, courier_name: idxCourier >= 0 ? r[idxCourier] : '' });
        }
        if (!orders.length) { this.showToast('유효한 행이 없습니다.'); return; }

        // 주문번호로 몰 매칭 후 몰별로 그룹
        const byMall = {}; const localOnly = [];
        let unmatched = 0;
        orders.forEach(o => {
            const found = (this.orders || []).find(x => String(x.order_id) === String(o.order_id));
            const mk = found?.mall_key;
            if (!mk) { unmatched++; return; }
            if (this._isCafe24Order(found)) (byMall[mk] = byMall[mk] || []).push(o);
            else localOnly.push({ ...o, mall_key: mk });
        });
        const mallKeys = Object.keys(byMall);
        if (!mallKeys.length && !localOnly.length) { this.showToast('업로드한 주문번호가 수집된 주문과 매칭되지 않습니다. (먼저 주문 수집)'); return; }

        const ok = await this.showConfirm(`${orders.length - unmatched}건의 운송장을 카페24에 배송중으로 등록합니다.${unmatched ? ` (미매칭 ${unmatched}건 제외)` : ''} 계속할까요?`, '송장 일괄 등록');
        if (!ok) return;
        this.showToast(`${mallKeys.length}개 몰 / 총 ${orders.length - unmatched}건 등록 중...`);
        let totalOk = 0, dry = false;
        for (const mk of mallKeys) {
            try {
                const { data, error } = await this.supabase.functions.invoke('cafe24-shipping', { body: { mall: mk, orders: byMall[mk] } });
                if (error) throw error;
                totalOk += (data?.success || 0);
                dry = dry || !!data?.dry_run;
            } catch (e) {
                this.showToast(`[${this._mallLabel(mk)}] 등록 실패: ` + (e.message || e));
            }
        }
        let pending = 0;
        for (const o of localOnly) {
            const { error } = await this.supabase.from('channel_orders').update({
                invoice_no: o.invoice_no, courier: o.courier_name || '', status: 'ready',
            }).eq('mall_key', o.mall_key).eq('order_id', String(o.order_id));
            if (!error) pending++;
        }
        this.showToast(dry
            ? `${totalOk}건 미리보기 완료(카페24·2179 데이터 변경 없음)`
            : `${totalOk}건 배송중 등록${pending ? ` / 비카페24 채널등록대기 ${pending}건` : ''}`);
        this._ordersLoaded = false;
        await this.loadOrders();
    }

    async runCafe24Sync() {
        this.showToast('카페24 주문 수집 중...');
        try {
            const { data, error } = await this.supabase.functions.invoke('cafe24-sync', { body: {} });
            if (error) throw error;
            this.showToast(`수집 완료: 신규 ${data?.orders_stored ?? 0}건 / 차감 ${data?.deducted ?? 0}건`);
        } catch (e) {
            this.showToast('수집 실패: ' + (e.message || e) + ' (연동 설정 확인)');
        }
        this._ordersLoaded = false;
        await this.loadOrders();
    }

    async pullCafe24Inventory() {
        if (!await this.showConfirm('카페24 수량을 총재고 기준으로 가져옵니다.\n매핑된 품목의 브하스 재고가 카페24 수량으로 보정됩니다.', '확인')) return;
        this.showToast('카페24 재고를 확인 중...');
        try {
            const { data, error } = await this.supabase.functions.invoke('cafe24-sync', { body: { mode: 'inventory-pull' } });
            if (error) throw error;
            const total = (data?.malls || []).reduce((n, r) => n + Number(r.adjusted || 0), 0);
            this.showToast(`카페24 재고 반영 완료: ${total}개 품목 보정`);
            this._invLoaded = false;
            await this.loadInventory();
        } catch (e) {
            this.showToast('카페24 재고 불러오기 실패: ' + (e.message || e));
        }
    }

    // ============================================================
    //  재고 관리 (카페24 연동 대상)
    // ============================================================
    async loadInventory() {
        this._invLoading = true;
        try {
            const [items, listings, ledger, slog] = await Promise.all([
                this.supabase.from('inventory_items').select('*').order('created_at', { ascending: true }),
                this.supabase.from('channel_listings').select('*'),
                this.supabase.from('inventory_ledger').select('*').order('created_at', { ascending: false }).limit(300),
                this.supabase.from('sync_log').select('*').order('run_at', { ascending: false }).limit(1)
            ]);
            this.inventory = {
                items: items.data || [], listings: listings.data || [],
                ledger: ledger.data || [], lastSync: (slog.data || [])[0] || null
            };
            this._invLoaded = true;
        } catch (e) {
            this.showToast('재고 데이터를 불러오지 못했습니다. (스키마 설치 필요할 수 있음)');
            this.inventory = { items: [], listings: [], ledger: [], lastSync: null };
            this._invLoaded = true;
        }
        this._invLoading = false;
        this.requestRender();
    }

    async loadMaterials() {
        this._materialsLoading = true;
        try {
            const [items, ledger, vendors] = await Promise.all([
                this.supabase.from('material_items').select('*').eq('active', true).order('created_at', { ascending: true }),
                this.supabase.from('material_ledger').select('*').order('created_at', { ascending: false }).limit(300),
                this.supabase.from('vendors').select('id,name,category').order('name')
            ]);
            const error = items.error || ledger.error || vendors.error;
            if (error) throw error;
            this.materialInventory = { items: items.data || [], ledger: ledger.data || [], vendors: vendors.data || [], schemaMissing: false };
        } catch (e) {
            this.materialInventory = { items: [], ledger: [], vendors: [], schemaMissing: true, error: e.message || String(e) };
        }
        this._materialsLoaded = true;
        this._materialsLoading = false;
        this.requestRender();
    }

    setInventoryTab(tab) {
        this.inventoryTab = tab;
        if (tab === 'materials' && !this._materialsLoaded && !this._materialsLoading) this.loadMaterials();
        this.requestRender();
    }

    setInvBrand(v) { this.setState({ invSelectedBrand: v }); }
    renderInventory() {
        const tab = this.inventoryTab || 'finished';
        return tab === 'materials' ? this.renderMaterialInventory() : this.renderFinishedGoodsInventory();
    }
    //  완제품 ↔ 원·부자재 — 머리막대 안의 분절 컨트롤
    //  정산 — 돈이 들어온 쪽(매출)과 나간 쪽(지출)
    _moneyTabs(cur) {
        const win = this._renderingWin || '';
        const b = (k, label) => `<button class="${cur === k ? 'on' : ''}" onclick="app.switchAppTab('${win}','${k}')">${label}</button>`;
        return `<div class="mp-seg">${b('sales', '매출')}${b('expenses', '지출')}</div>`;
    }
    _invTabs() {
        const tab = this.inventoryTab || 'finished';
        const b = (id, label) => `<button class="${tab === id ? 'on' : ''}" data-inventory-tab="${id}">${label}</button>`;
        return `<div class="mp-seg">${b('finished', '완제품')}${b('materials', '원·부자재')}</div>`;
    }

    renderFinishedGoodsInventory() {
        const inv = this.inventory || { items: [], listings: [], ledger: [], lastSync: null };
        if (!this._invLoaded) {
            return `<div class="glass" style="padding:3rem; border-radius:20px; text-align:center; color:var(--text-muted)">재고 데이터를 불러오는 중...</div>`;
        }
        const listingOf = (itemId) => (inv.listings || []).find(l => l.channel === 'cafe24' && l.inventory_item_id === itemId);
        let items = inv.items;
        if (this.invSelectedBrand && this.invSelectedBrand !== 'all') items = items.filter(i => i.brand_id === this.invSelectedBrand);
        if (this.invLow) items = items.filter(i => i.on_hand <= i.safety_stock);

        const ls = inv.lastSync;
        const syncBadge = ls
            ? `<span class="glass" style="padding:6px 12px; border-radius:20px; font-size:0.8rem; color:${ls.result === 'error' ? '#ef4444' : (ls.result === 'dry_run' ? '#f59e0b' : '#22c55e')}">
                 <i class="ph ph-arrows-clockwise"></i> 마지막 동기화: ${new Date(ls.run_at).toLocaleString('ko-KR')} · ${ls.result}</span>`
            : `<span class="glass" style="padding:6px 12px; border-radius:20px; font-size:0.8rem; color:var(--text-muted)"><i class="ph ph-plug"></i> 카페24 미연동</span>`;

        items = this._applyTbl('inventory', items, (i, k2) => ({
            sku: i.sku || '', name: i.name || '', option_name: i.option_name || '',
            brand: this._brandNameById(i.brand_id) === '-' ? '' : this._brandNameById(i.brand_id),
            on_hand: Number(i.on_hand) || 0, safety_stock: Number(i.safety_stock) || 0,
            map: listingOf(i.id)?.channel_variant_code ? '연결됨' : '미매핑',
        })[k2] ?? '', inv.items || []);
        const rows = items.map(i => {
            const map = listingOf(i.id);
            const low = i.on_hand <= i.safety_stock;
            return `<tr class="it-row inv-row${String(this.invSel) === String(i.id) ? ' on' : ''}" data-id="${i.id}"
                onclick="app.rowPick(event,'${i.id}','inv')">
                <td class="mono">${this._vesc(i.sku || '')}</td>
                <td class="bd">${this._vesc(i.name || '')}</td>
                <td>${this._vesc(i.option_name || '')}</td>
                <td>${this._vesc(this._brandNameById(i.brand_id))}</td>
                <td class="num"><b style="${low ? 'color:#ff453a' : ''}">${i.on_hand}</b></td>
                <td class="num mu">${i.safety_stock}</td>
                <td class="it-c">${map && map.channel_variant_code
                    ? `<span class="it-tag" style="--c:#30d158">연결됨</span>`
                    : `<span class="it-tag" style="--c:#8e8e93">미매핑</span>`}</td>
            </tr>`;
        }).join('');

        // 품절 예측 · 재발주 (최근 30일 판매속도 × 현재고 × 리드타임)
        const LEAD_DAYS = 14;
        const now = Date.now(), WIN = 30;
        const nameQty = {};
        (this.orders || []).forEach(o => { if (!o.order_date) return; if ((now - new Date(o.order_date).getTime()) / 864e5 > WIN) return; (o.items || []).forEach(it => { const n = (it.product_name || '').trim(); if (n) nameQty[n] = (nameQty[n] || 0) + (Number(it.quantity) || 1); }); });
        const velOf = (item) => { const nm = (item.name || '').trim(); if (!nm) return 0; let q = nameQty[nm] || 0; if (!q) for (const k in nameQty) { if (k.includes(nm) || nm.includes(k)) q += nameQty[k]; } return q / WIN; };
        const reorder = (inv.items || []).map(i => { const v = velOf(i); const days = v > 0 ? Math.floor(i.on_hand / v) : null; return { i, v, days }; })
            .filter(r => (r.days !== null && r.days <= LEAD_DAYS) || r.i.on_hand <= r.i.safety_stock)
            .sort((a, b) => (a.days ?? 999) - (b.days ?? 999));

        const brandPill = (v, label, color) => `<button class="it-pill${(this.invSelectedBrand || 'all') === v ? ' on' : ''}"
            onclick="app.setInvBrand('${v}')"${color ? ` style="--pc:${color}"` : ''}>${this._vesc(label)}</button>`;

        return `
        <div class="mp">
            ${this._mpTop('재고', `완제품 ${items.length}품목`, `
                ${this._invTabs()}
                <button class="mbtn" id="inv-cafe24-pull-btn"><i class="ph ph-download-simple"></i> 재고 불러오기</button>
                <button class="mbtn" id="inv-cafe24-btn"><i class="ph ph-plug-charging"></i> 카페24 설정</button>
                <button class="mbtn pri" id="inv-add-btn"><i class="ph ph-plus"></i> 품목 추가</button>`)}
            <div class="it-pills">
                ${brandPill('all', '전체')}
                ${(mockData.brands || []).map(b => brandPill(b.id, b.name, b.brand_color || '#0a84ff')).join('')}
                <span class="pill-sp"></span>
                <span class="sync-b">${syncBadge}</span>
            </div>
            ${reorder.length ? `<div class="warn-bar"><i class="ph ph-warning-diamond"></i>
                <b>재발주 ${reorder.length}품목</b>
                ${reorder.slice(0, 4).map(({ i, days }) => `<span>${this._vesc(i.name || i.sku || '-')}<em>${days !== null ? `${days}일 후 품절` : '안전재고 이하'}</em></span>`).join('')}
                ${reorder.length > 4 ? `<span class="mu">외 ${reorder.length - 4}</span>` : ''}
            </div>` : ''}
            <div class="it-scroll">
                <table class="it-tbl"><thead><tr>
                    ${this._thead('inventory', [['sku', 'SKU'], ['name', '품목명'], ['option_name', '옵션'],
                        ['brand', '브랜드'], ['on_hand', '현재고', 'num'], ['safety_stock', '안전재고', 'num'],
                        ['map', '카페24', 'it-c']])}
                </tr></thead>
                <tbody>${rows || `<tr><td colspan="7" class="it-none">등록된 품목이 없습니다 — 위 [품목 추가]로 시작하세요</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
    }

    renderMaterialInventory() {
        if (!this._materialsLoaded) {
            return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">원·부자재 재고를 불러오는 중...</div>`;
        }
        const data = this.materialInventory || { items: [], ledger: [], vendors: [] };
        if (data.schemaMissing) {
            return `<div class="glass" style="padding:2.4rem;border-radius:20px;text-align:center">
                <i class="ph ph-database" style="font-size:2rem;color:#f59e0b"></i>
                <h2 style="margin:.7rem 0 .4rem;font-size:1.2rem">원·부자재 DB 설치가 필요합니다</h2>
                <p style="margin:0;color:var(--text-muted);font-size:.86rem"><code>034_material_inventory.sql</code> 마이그레이션을 적용하면 바로 사용할 수 있습니다.</p>
            </div>`;
        }
        const catLabel = { fabric: '원단', accessory: '부자재', packaging: '포장자재', other: '기타' };
        const reasonLabel = { initial: '초기', purchase: '입고', production_use: '생산사용', sample_use: '샘플사용', waste: '폐기·불량', return: '반품', adjust: '실사보정' };
        const vendorName = id => (data.vendors.find(v => v.id === id) || {}).name || '-';
        const qty = n => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
        const selectedCat = this.materialCategory || 'all';
        const query = (this.materialSearch || '').trim().toLowerCase();
        let items = data.items || [];
        if (selectedCat !== 'all') items = items.filter(i => i.category === selectedCat);
        if (query) items = items.filter(i => [i.material_code, i.name, i.color, i.spec, i.location, vendorName(i.vendor_id)].some(v => String(v || '').toLowerCase().includes(query)));
        const lowItems = (data.items || []).filter(i => Number(i.on_hand) <= Number(i.safety_stock));
        const stockValue = (data.items || []).reduce((sum, i) => sum + Number(i.on_hand || 0) * Number(i.unit_cost || 0), 0);
        const rows = items.map(i => {
            const low = Number(i.on_hand) <= Number(i.safety_stock);
            return `<tr style="border-bottom:1px solid var(--card-border)">
                <td style="padding:11px;font-family:monospace;color:var(--text-muted)">${this._vesc(i.material_code)}</td>
                <td style="padding:11px"><span style="font-size:.7rem;padding:3px 7px;border-radius:9px;background:rgba(99,102,241,.1);color:#818cf8">${catLabel[i.category] || '기타'}</span></td>
                <td style="padding:11px"><b>${this._vesc(i.name)}</b><div style="font-size:.74rem;color:var(--text-muted);margin-top:3px">${this._vesc([i.color, i.spec].filter(Boolean).join(' · ') || '-')}</div></td>
                <td style="padding:11px;color:var(--text-muted)">${this._vesc(vendorName(i.vendor_id))}</td>
                <td style="padding:11px;color:var(--text-muted)">${this._vesc(i.location || '-')}</td>
                <td style="padding:11px;text-align:right"><strong style="color:${low ? '#ef4444' : 'var(--text-main)'}">${qty(i.on_hand)} ${this._vesc(i.unit)}</strong>${low ? '<div style="font-size:.68rem;color:#ef4444">안전재고 이하</div>' : ''}</td>
                <td style="padding:11px;text-align:right;color:var(--text-muted)">${qty(i.safety_stock)} ${this._vesc(i.unit)}</td>
                <td style="padding:11px;text-align:right;white-space:nowrap">
                    <button class="mat-move btn-primary" data-id="${i.id}" style="padding:5px 10px;border-radius:8px;font-size:.76rem">입·출고</button>
                    <button class="mat-edit btn-secondary" data-id="${i.id}" style="padding:5px 10px;border-radius:8px;font-size:.76rem">수정</button>
                    <button class="mat-log btn-secondary" data-id="${i.id}" style="padding:5px 10px;border-radius:8px;font-size:.76rem">내역</button>
                </td>
            </tr>`;
        }).join('');
        const ledger = this.materialLedgerItemId ? data.ledger.filter(l => l.material_item_id === this.materialLedgerItemId) : data.ledger;
        const ledgerRows = ledger.slice(0, 80).map(l => {
            const item = data.items.find(i => i.id === l.material_item_id);
            const delta = Number(l.delta || 0);
            return `<tr style="border-bottom:1px solid var(--card-border)">
                <td style="padding:8px;color:var(--text-muted);font-size:.78rem">${this._vesc(l.movement_date || String(l.created_at || '').slice(0,10))}</td>
                <td style="padding:8px;font-size:.84rem">${this._vesc(item?.name || '?')}</td>
                <td style="padding:8px;text-align:center"><span style="font-size:.71rem;padding:2px 8px;border-radius:10px;background:rgba(var(--tint),.08)">${reasonLabel[l.reason] || this._vesc(l.reason)}</span></td>
                <td style="padding:8px;text-align:right;font-weight:800;color:${delta > 0 ? '#22c55e' : '#ef4444'}">${delta > 0 ? '+' : ''}${qty(delta)} ${this._vesc(item?.unit || '')}</td>
                <td style="padding:8px;color:var(--text-muted);font-size:.78rem">${this._vesc([l.ref, l.note].filter(Boolean).join(' · '))}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" style="padding:1.4rem;text-align:center;color:var(--text-muted)">변동 내역이 없습니다.</td></tr>`;

        return `<div class="mp">
            ${this._mpTop('재고', '원단·부자재·포장자재의 입고와 사용을 원장으로', `
                ${this._invTabs()}
                <button id="mat-add" class="mbtn pri"><i class="ph ph-plus"></i> 품목 추가</button>`)}
            <div class="mp-body">
            <div class="material-kpis">
                <div class="material-kpi"><span>등록 품목</span><strong>${data.items.length}개</strong></div>
                <div class="material-kpi"><span>재발주 필요</span><strong style="color:${lowItems.length ? '#ef4444' : '#22c55e'}">${lowItems.length}개</strong></div>
                <div class="material-kpi"><span>재고 평가액</span><strong>${Math.round(stockValue).toLocaleString('ko-KR')}원</strong></div>
            </div>
            ${lowItems.length ? `<div style="padding:11px 14px;margin-bottom:14px;border:1px solid rgba(239,68,68,.25);border-radius:12px;background:rgba(239,68,68,.05);font-size:.82rem"><i class="ph ph-warning-diamond" style="color:#ef4444"></i> <b>${lowItems.length}개 품목</b>이 안전재고 이하입니다: ${lowItems.slice(0,5).map(i => this._vesc(i.name)).join(', ')}${lowItems.length > 5 ? ' 외' : ''}</div>` : ''}
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
                <select id="mat-category" class="login-input" style="width:auto;min-width:130px">
                    <option value="all">전체 분류</option>${Object.entries(catLabel).map(([v,l]) => `<option value="${v}" ${selectedCat === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
                <input id="mat-search" class="login-input" style="flex:1;min-width:180px" placeholder="코드·품목·컬러·거래처 검색" value="${this._vesc(this.materialSearch || '')}">
                <button id="mat-search-btn" class="btn-secondary" style="padding:8px 14px;border-radius:10px">검색</button>
            </div>
            <div class="table-container" style="overflow-x:auto">
                <table class="mtbl" style="width:100%;border-collapse:collapse;min-width:920px"><thead><tr style="color:var(--text-muted);font-size:.79rem;text-align:left">
                    <th>코드</th><th>분류</th><th>품목</th><th>거래처</th><th>보관위치</th><th style="text-align:right">현재고</th><th style="text-align:right">안전재고</th><th style="text-align:right">작업</th>
                </tr></thead><tbody>${rows || `<tr><td colspan="8" style="text-align:center;color:var(--text-muted)">${query || selectedCat !== 'all' ? '검색 조건에 맞는 품목이 없습니다.' : '등록된 원·부자재가 없습니다.'}</td></tr>`}</tbody></table>
            </div>
            <div style="margin-top:2rem">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.7rem"><h3 style="margin:0;font-size:1.02rem"><i class="ph ph-clock-counter-clockwise"></i> 입·출고 내역 ${this.materialLedgerItemId ? '(필터됨)' : ''}</h3>${this.materialLedgerItemId ? '<button id="mat-log-clear" class="btn-secondary" style="padding:5px 11px;border-radius:8px;font-size:.78rem">전체 보기</button>' : ''}</div>
                <div class="table-container" style="overflow:auto;max-height:330px"><table class="mtbl" style="width:100%;border-collapse:collapse;min-width:600px"><thead><tr style="border-bottom:1px solid var(--card-border);color:var(--text-muted);font-size:.76rem;text-align:left"><th>일자</th><th>품목</th><th style="text-align:center">구분</th><th style="text-align:right">증감</th><th>참조·비고</th></tr></thead><tbody>${ledgerRows}</tbody></table></div>
            </div>
        </div></div>`;
    }

    bindMaterialEvents() {
        const add = document.getElementById('mat-add');
        if (add) add.onclick = () => this.showMaterialItemModal();
        const cat = document.getElementById('mat-category');
        if (cat) cat.onchange = () => { this.materialCategory = cat.value; this.requestRender(); };
        const search = document.getElementById('mat-search');
        const runSearch = () => { this.materialSearch = search?.value || ''; this.requestRender(); };
        const searchBtn = document.getElementById('mat-search-btn');
        if (searchBtn) searchBtn.onclick = runSearch;
        if (search) search.onkeydown = e => { if (e.key === 'Enter') runSearch(); };
        const clear = document.getElementById('mat-log-clear');
        if (clear) clear.onclick = () => { this.materialLedgerItemId = null; this.requestRender(); };
        this.appContainer.querySelectorAll('.mat-move').forEach(b => b.onclick = () => this.showMaterialMoveModal(b.dataset.id));
        this.appContainer.querySelectorAll('.mat-edit').forEach(b => b.onclick = () => this.showMaterialItemModal(b.dataset.id));
        this.appContainer.querySelectorAll('.mat-log').forEach(b => b.onclick = () => { this.materialLedgerItemId = b.dataset.id; this.requestRender(); });
    }

    showMaterialItemModal(itemId = null) {
        const data = this.materialInventory || { items: [], vendors: [] };
        const item = itemId ? data.items.find(i => i.id === itemId) : null;
        const esc = v => this._vesc(v == null ? '' : String(v));
        const vendorOptions = `<option value="">거래처 미지정</option>` + data.vendors.map(v => `<option value="${v.id}" ${item?.vendor_id === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
        const c = document.getElementById('global-modal-container');
        c.innerHTML = `<div class="glass modal-content fade-in vmodal" style="width:94%;max-width:580px;padding:1.7rem;border-radius:20px;max-height:90vh;overflow:auto">
            <h2 style="margin:0 0 1rem;font-size:1.18rem"><i class="ph ph-swatches"></i> ${item ? '원·부자재 수정' : '새 원·부자재'}</h2>
            <div class="material-form-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                <input id="mat-code" class="login-input" placeholder="관리코드 * (예: FAB-COT-001)" value="${esc(item?.material_code)}">
                <select id="mat-cat" class="login-input"><option value="fabric" ${item?.category === 'fabric' ? 'selected' : ''}>원단</option><option value="accessory" ${item?.category === 'accessory' ? 'selected' : ''}>부자재</option><option value="packaging" ${item?.category === 'packaging' ? 'selected' : ''}>포장자재</option><option value="other" ${item?.category === 'other' ? 'selected' : ''}>기타</option></select>
                <input id="mat-name" class="login-input" placeholder="품목명 * (예: 20수 싱글 다이마루)" value="${esc(item?.name)}" style="grid-column:1/-1">
                <input id="mat-color" class="login-input" placeholder="컬러 / 컬러코드" value="${esc(item?.color)}">
                <input id="mat-spec" class="login-input" placeholder="규격·혼용률·폭" value="${esc(item?.spec)}">
                <select id="mat-unit" class="login-input">${['yd','m','개','롤','kg','세트','장'].map(u => `<option value="${u}" ${(item?.unit || 'yd') === u ? 'selected' : ''}>${u}</option>`).join('')}</select>
                <select id="mat-vendor" class="login-input">${vendorOptions}</select>
                <select id="mat-brand" class="login-input">${this._brandOptions(item?.brand_id || '')}</select>
                <input id="mat-location" class="login-input" placeholder="보관위치 (예: 창고 A-03)" value="${esc(item?.location)}">
                ${item ? '' : '<input id="mat-initial" type="number" min="0" step="0.001" class="login-input" placeholder="초기재고" value="0">'}
                <input id="mat-safety" type="number" min="0" step="0.001" class="login-input" placeholder="안전재고" value="${esc(item?.safety_stock || 0)}">
                <input id="mat-cost" type="number" min="0" step="1" class="login-input" placeholder="단위당 원가" value="${esc(item?.unit_cost || 0)}">
                <textarea id="mat-memo" class="login-input" placeholder="비고" style="grid-column:1/-1;min-height:70px;resize:vertical">${esc(item?.memo)}</textarea>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:1.2rem"><button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 17px;border-radius:10px">취소</button><button id="mat-save" class="btn-primary" style="padding:9px 17px;border-radius:10px">저장</button></div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('mat-save').onclick = () => this.saveMaterialItem(itemId);
    }

    async saveMaterialItem(itemId = null) {
        const val = id => document.getElementById(id)?.value.trim() || '';
        const code = val('mat-code'), name = val('mat-name');
        if (!code || !name) { this.showToast('관리코드와 품목명은 필수입니다.'); return; }
        const payload = {
            material_code: code, category: val('mat-cat'), name, color: val('mat-color') || null, spec: val('mat-spec') || null,
            unit: val('mat-unit') || '개', safety_stock: Math.max(Number(val('mat-safety')) || 0, 0), unit_cost: Math.max(Number(val('mat-cost')) || 0, 0),
            vendor_id: val('mat-vendor') || null, brand_id: val('mat-brand') || null, location: val('mat-location') || null, memo: val('mat-memo') || null
        };
        let error;
        if (itemId) {
            ({ error } = await this.supabase.from('material_items').update(payload).eq('id', itemId));
        } else {
            const args = {
                p_material_code: payload.material_code, p_category: payload.category, p_name: payload.name, p_color: payload.color,
                p_spec: payload.spec, p_unit: payload.unit, p_initial_qty: Math.max(Number(val('mat-initial')) || 0, 0),
                p_safety_stock: payload.safety_stock, p_unit_cost: payload.unit_cost, p_vendor_id: payload.vendor_id,
                p_brand_id: payload.brand_id, p_location: payload.location, p_memo: payload.memo, p_created_by: this._actor()
            };
            ({ error } = await this.supabase.rpc('create_material_item', args));
        }
        if (error) { this.showToast('저장 실패: ' + error.message); return; }
        this.closeGlobalModal();
        await this.loadMaterials();
        this.showToast(itemId ? '품목 정보를 수정했습니다.' : '원·부자재를 등록했습니다.');
    }

    showMaterialMoveModal(itemId) {
        const item = (this.materialInventory?.items || []).find(i => i.id === itemId);
        if (!item) return;
        const c = document.getElementById('global-modal-container');
        c.innerHTML = `<div class="glass modal-content fade-in" style="width:92%;max-width:450px;padding:1.7rem;border-radius:20px">
            <h2 style="margin:0 0 .4rem;font-size:1.16rem"><i class="ph ph-arrows-left-right"></i> 원·부자재 입·출고</h2>
            <p style="margin:0 0 1rem;color:var(--text-muted);font-size:.82rem">${this._vesc(item.name)} · 현재 ${Number(item.on_hand).toLocaleString('ko-KR', { maximumFractionDigits: 3 })}${this._vesc(item.unit)}</p>
            <div style="display:flex;flex-direction:column;gap:10px">
                <select id="mat-move-reason" class="login-input"><option value="purchase">입고 (+)</option><option value="return">반품·회수 (+)</option><option value="production_use">생산 사용 (-)</option><option value="sample_use">샘플 사용 (-)</option><option value="waste">폐기·불량 (-)</option><option value="adjust">실사 보정 (+/-)</option></select>
                <input id="mat-move-qty" type="number" step="0.001" class="login-input" placeholder="수량 (실사 보정만 +/- 입력)">
                <input id="mat-move-date" type="date" class="login-input" value="${kstYMD()}">
                <input id="mat-move-ref" class="login-input" placeholder="생산번호·발주번호 (선택)">
                <input id="mat-move-note" class="login-input" placeholder="비고 (예: 로하이 2차 생산)">
                <p style="margin:0;color:var(--text-muted);font-size:.75rem">입고·반품·사용·폐기는 양수로 입력하면 부호가 자동 반영됩니다. 실사 보정만 +/- 증감량을 입력하세요.</p>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:1.2rem"><button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 17px;border-radius:10px">취소</button><button id="mat-move-save" class="btn-primary" style="padding:9px 17px;border-radius:10px">반영</button></div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('mat-move-save').onclick = () => this.saveMaterialMove(itemId);
    }

    async saveMaterialMove(itemId) {
        const reason = document.getElementById('mat-move-reason').value;
        const rawQty = Number(document.getElementById('mat-move-qty').value || 0);
        if (!rawQty || (reason !== 'adjust' && rawQty < 0)) { this.showToast(reason === 'adjust' ? '0이 아닌 증감량을 입력하세요.' : '수량을 0보다 크게 입력하세요.'); return; }
        const positive = reason === 'purchase' || reason === 'return';
        const delta = reason === 'adjust' ? rawQty : (positive ? rawQty : -rawQty);
        const item = (this.materialInventory?.items || []).find(i => i.id === itemId);
        if (item && Number(item.on_hand) + delta < 0) { this.showToast('보유 재고보다 많이 출고할 수 없습니다.'); return; }
        const { error } = await this.supabase.from('material_ledger').insert([{
            material_item_id: itemId, delta, reason,
            movement_date: document.getElementById('mat-move-date').value || kstYMD(),
            ref: document.getElementById('mat-move-ref').value.trim() || null,
            note: document.getElementById('mat-move-note').value.trim() || null,
            created_by: this._actor()
        }]);
        if (error) { this.showToast('반영 실패: ' + error.message); return; }
        this.closeGlobalModal();
        await this.loadMaterials();
        this.showToast('재고 변동을 반영했습니다.');
    }

    bindInventoryEvents() {
        this.appContainer.querySelectorAll('[data-inventory-tab]').forEach(b => b.onclick = () => this.setInventoryTab(b.dataset.inventoryTab));
        if ((this.inventoryTab || 'finished') === 'materials') {
            this.bindMaterialEvents();
            return;
        }
        const bf = document.getElementById('inv-brand-filter');
        if (bf) bf.onchange = () => this.setState({ invSelectedBrand: bf.value });
        const addBtn = document.getElementById('inv-add-btn');
        if (addBtn) addBtn.onclick = () => this.showInventoryItemModal();
        const cafeBtn = document.getElementById('inv-cafe24-btn');
        if (cafeBtn) cafeBtn.onclick = () => this.showCafe24Modal();
        const cafePullBtn = document.getElementById('inv-cafe24-pull-btn');
        if (cafePullBtn) cafePullBtn.onclick = () => this.pullCafe24Inventory();
        const logClear = document.getElementById('inv-log-clear');
        if (logClear) logClear.onclick = () => this.setState({ invLedgerItemId: null });

        this.appContainer.querySelectorAll('.inv-inc').forEach(b => b.onclick = () => this.quickAdjust(b.dataset.id, 1));
        this.appContainer.querySelectorAll('.inv-dec').forEach(b => b.onclick = () => this.quickAdjust(b.dataset.id, -1));
        this.appContainer.querySelectorAll('.inv-adjust').forEach(b => b.onclick = () => this.showAdjustModal(b.dataset.id));
        this.appContainer.querySelectorAll('.inv-map').forEach(b => b.onclick = () => this.showMappingModal(b.dataset.id));
        this.appContainer.querySelectorAll('.inv-log').forEach(b => b.onclick = () => this.setState({ invLedgerItemId: b.dataset.id }));
    }

    async quickAdjust(itemId, delta) {
        const it = (this.inventory.items || []).find(i => i.id === itemId);
        if (it && it.on_hand + delta < 0) { this.showToast('재고는 0 미만이 될 수 없습니다.'); return; }
        const { error } = await this.supabase.from('inventory_ledger').insert([{
            inventory_item_id: itemId, delta, reason: 'manual', note: '빠른 조정', created_by: this._actor()
        }]);
        if (error) { this.showToast('조정 실패: ' + error.message); return; }
        await this.loadInventory();
    }

    showInventoryItemModal() {
        const c = document.getElementById('global-modal-container');
        if (!c) return;
        c.innerHTML = `
        <div class="glass modal-content fade-in" style="width:90%;max-width:480px;padding:2rem;border-radius:20px;position:relative">
            <h2 style="margin:0 0 1.5rem;font-size:1.2rem"><i class="ph ph-package"></i> 새 재고 품목</h2>
            <div style="display:flex;flex-direction:column;gap:12px">
                <input id="ii-sku" class="login-input" placeholder="SKU (예: BNAP-TOP-RED-90)">
                <input id="ii-name" class="login-input" placeholder="품목명 (예: 베이비 우주복)">
                <input id="ii-opt" class="login-input" placeholder="옵션 (예: 레드 / 90)">
                <select id="ii-mall" class="login-input">${this._mallOptions('')}</select>
                <select id="ii-brand" class="login-input">${this._brandOptions('')}</select>
                <div style="display:flex;gap:10px">
                    <input id="ii-qty" type="number" class="login-input" placeholder="초기 재고" value="0">
                    <input id="ii-safe" type="number" class="login-input" placeholder="안전재고" value="0">
                </div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:1.5rem">
                <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:10px 20px;border-radius:10px">취소</button>
                <button id="ii-save" class="btn-primary" style="padding:10px 20px;border-radius:10px">저장</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('ii-save').onclick = () => this.saveInventoryItem();
    }

    async saveInventoryItem() {
        const sku = document.getElementById('ii-sku').value.trim();
        const name = document.getElementById('ii-name').value.trim();
        if (!sku || !name) { this.showToast('SKU와 품목명은 필수입니다.'); return; }
        const qty = parseInt(document.getElementById('ii-qty').value || '0', 10);
        const safe = parseInt(document.getElementById('ii-safe').value || '0', 10);
        const brand = document.getElementById('ii-brand').value || null;
        const mall = document.getElementById('ii-mall').value || null;
        const opt = document.getElementById('ii-opt').value.trim() || null;
        const { data, error } = await this.supabase.from('inventory_items')
            .insert([{ sku, name, option_name: opt, brand_id: brand, mall_key: mall, safety_stock: safe, on_hand: 0 }]).select().single();
        if (error) { this.showToast('저장 실패: ' + error.message); return; }
        if (qty !== 0 && data) {
            await this.supabase.from('inventory_ledger').insert([{
                inventory_item_id: data.id, delta: qty, reason: 'initial', note: '초기 등록', created_by: this._actor()
            }]);
        }
        this.closeGlobalModal();
        await this.loadInventory();
        this.showToast('품목이 추가되었습니다.');
    }

    showAdjustModal(itemId) {
        const it = (this.inventory.items || []).find(i => i.id === itemId);
        if (!it) return;
        const c = document.getElementById('global-modal-container');
        c.innerHTML = `
        <div class="glass modal-content fade-in" style="width:90%;max-width:420px;padding:2rem;border-radius:20px">
            <h2 style="margin:0 0 0.5rem;font-size:1.15rem"><i class="ph ph-sliders"></i> 재고 조정</h2>
            <p style="color:var(--text-muted);margin:0 0 1.2rem;font-size:0.85rem">${it.name} · 현재 ${it.on_hand}개</p>
            <div style="display:flex;flex-direction:column;gap:12px">
                <select id="adj-reason" class="login-input">
                    <option value="restock" style="background:#0f172a">입고 (+)</option>
                    <option value="return" style="background:#0f172a">반품 입고 (+)</option>
                    <option value="manual" style="background:#0f172a">수동 조정</option>
                    <option value="adjust" style="background:#0f172a">실사 보정</option>
                </select>
                <input id="adj-delta" type="number" class="login-input" placeholder="증감 수량 (예: +10 또는 -3)">
                <input id="adj-note" class="login-input" placeholder="비고 (예: 29CM 판매분 차감)">
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:1.5rem">
                <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:10px 20px;border-radius:10px">취소</button>
                <button id="adj-save" class="btn-primary" style="padding:10px 20px;border-radius:10px">적용</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('adj-save').onclick = () => this.saveAdjust(itemId);
    }

    async saveAdjust(itemId) {
        const delta = parseInt(document.getElementById('adj-delta').value || '0', 10);
        if (!delta) { this.showToast('증감 수량을 입력하세요.'); return; }
        const reason = document.getElementById('adj-reason').value;
        const note = document.getElementById('adj-note').value.trim() || null;
        const it = (this.inventory.items || []).find(i => i.id === itemId);
        if (it && it.on_hand + delta < 0) { this.showToast('재고는 0 미만이 될 수 없습니다.'); return; }
        const { error } = await this.supabase.from('inventory_ledger').insert([{
            inventory_item_id: itemId, delta, reason, note, created_by: this._actor()
        }]);
        if (error) { this.showToast('조정 실패: ' + error.message); return; }
        this.closeGlobalModal();
        await this.loadInventory();
    }

    showMappingModal(itemId) {
        const it = (this.inventory.items || []).find(i => i.id === itemId);
        const map = (this.inventory.listings || []).find(l => l.channel === 'cafe24' && l.inventory_item_id === itemId);
        const c = document.getElementById('global-modal-container');
        c.innerHTML = `
        <div class="glass modal-content fade-in" style="width:90%;max-width:460px;padding:2rem;border-radius:20px">
            <h2 style="margin:0 0 0.5rem;font-size:1.15rem"><i class="ph ph-link"></i> 카페24 품목 매핑</h2>
            <p style="color:var(--text-muted);margin:0 0 1.2rem;font-size:0.85rem">${it ? it.name : ''} ↔ 카페24 상품/품목</p>
            <div style="display:flex;flex-direction:column;gap:12px">
                <select id="map-mall" class="login-input">${this._mallOptions(map?.mall_key || it?.mall_key || '')}</select>
                <input id="map-pno" class="login-input" placeholder="카페24 product_no (상품번호)" value="${map?.channel_product_no || ''}">
                <input id="map-vcode" class="login-input" placeholder="카페24 variant_code (품목코드)" value="${map?.channel_variant_code || ''}">
                <input id="map-alloc" type="number" class="login-input" placeholder="이 채널 배정 수량 (비우면 전량 배분)" value="${map?.allocated || ''}">
                <p style="color:var(--text-muted);font-size:0.78rem;margin:0">몰·상품번호·품목코드를 입력. <b>배정 수량</b>을 넣으면 그만큼만 이 채널에 뿌려요(오버셀 방지). 비우면 전량. 카페24 관리자 → 상품관리에서 코드 확인.</p>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:1.5rem">
                <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:10px 20px;border-radius:10px">취소</button>
                <button id="map-save" class="btn-primary" style="padding:10px 20px;border-radius:10px">저장</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('map-save').onclick = () => this.saveMapping(itemId);
    }

    async saveMapping(itemId) {
        const pno = document.getElementById('map-pno').value.trim() || null;
        const vcode = document.getElementById('map-vcode').value.trim() || null;
        const mall = document.getElementById('map-mall').value || null;
        const allocRaw = document.getElementById('map-alloc').value.trim();
        const allocated = allocRaw === '' ? 0 : Math.max(parseInt(allocRaw, 10) || 0, 0);
        if (!mall) { this.showToast('몰을 선택하세요. (없으면 "카페24 연동"에서 몰 등록)'); return; }
        const existing = (this.inventory.listings || []).find(l => l.channel === 'cafe24' && l.inventory_item_id === itemId);
        let error;
        if (existing) {
            ({ error } = await this.supabase.from('channel_listings').update({ mall_key: mall, channel_product_no: pno, channel_variant_code: vcode, allocated }).eq('id', existing.id));
        } else {
            ({ error } = await this.supabase.from('channel_listings').insert([{ inventory_item_id: itemId, channel: 'cafe24', mall_key: mall, channel_product_no: pno, channel_variant_code: vcode, allocated }]));
        }
        if (error) { this.showToast('매핑 저장 실패: ' + error.message); return; }
        this.closeGlobalModal();
        await this.loadInventory();
        this.showToast('카페24 매핑이 저장되었습니다.');
    }

    showCafe24Modal(preBrand) {
        const c = document.getElementById('global-modal-container');
        const malls = this.malls || [];
        const mallRows = malls.map(m => `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px;border:1px solid var(--card-border);border-radius:10px;margin-bottom:8px">
                <div>
                    <div style="font-weight:600">${m.label} <span style="font-size:0.72rem;color:var(--text-muted)">${m.cafe24_mall_id || ''}.cafe24.com</span></div>
                    <div style="font-size:0.75rem;color:${m.connected ? '#22c55e' : '#f59e0b'}">${m.connected ? '● 연동됨' : '○ 미인증'}</div>
                </div>
                <div style="display:flex;gap:6px">
                    <button class="c24-auth btn-primary" data-key="${m.mall_key}" style="padding:6px 12px;border-radius:8px;font-size:0.78rem">${m.connected ? '재인증' : '인증'}</button>
                </div>
            </div>`).join('') || '<p style="color:var(--text-muted);font-size:0.85rem;margin:0 0 8px">아직 등록된 몰이 없습니다. 아래에서 추가하세요.</p>';

        c.innerHTML = `
        <div class="glass modal-content fade-in vmodal" style="width:90%;max-width:560px;padding:2rem;border-radius:20px;max-height:88vh;overflow-y:auto">
            <h2 style="margin:0 0 1rem;font-size:1.2rem"><i class="ph ph-plug-charging"></i> 카페24 몰 연동</h2>

            <div style="margin-bottom:1.25rem">${mallRows}</div>

            <details style="margin-bottom:1rem">
                <summary style="cursor:pointer;font-weight:600;font-size:0.9rem;margin-bottom:8px"><i class="ph ph-plus-circle"></i> 새 몰 등록</summary>
                <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
                    <input id="c24-key" class="login-input" placeholder="몰 식별자 영문 (예: hiheiho)">
                    <input id="c24-label" class="login-input" placeholder="표시명 (예: 하이헤이호)">
                    <input id="c24-mallid" class="login-input" placeholder="카페24 몰아이디 (xxx.cafe24.com 의 xxx)">
                    <input id="c24-cid" class="login-input" placeholder="Client ID">
                    <input id="c24-secret" class="login-input" placeholder="Client Secret" type="password">
                    <select id="c24-brand" class="login-input">${this._brandOptions(preBrand || '')}</select>
                    <button id="c24-register" class="btn-primary" style="padding:10px;border-radius:10px">몰 등록</button>
                </div>
            </details>

            <ol style="color:var(--text-muted);font-size:0.82rem;line-height:1.8;padding-left:1.2rem;margin:0 0 0.5rem">
                <li>각 브랜드 카페24 개발자센터에서 앱 생성 → Client ID/Secret 발급 (Redirect URL = <code>${this._oauthUrl('KEY').replace('?mall=KEY', '')}</code>)</li>
                <li>Edge Functions(cafe24-oauth/sync/shipping) 배포돼 있어야 인증 버튼이 작동합니다</li>
                <li>등록 → 인증 → 기본 dry-run으로 검증 후 실연동</li>
            </ol>
            <div style="display:flex;justify-content:flex-end;margin-top:1rem">
                <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:10px 20px;border-radius:10px">닫기</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        const reg = document.getElementById('c24-register');
        if (reg) reg.onclick = () => this.registerMall();
        c.querySelectorAll('.c24-auth').forEach(b => b.onclick = () => this.authMall(b.dataset.key));
    }

    async registerMall() {
        const key = (document.getElementById('c24-key').value || '').trim().toLowerCase();
        const label = (document.getElementById('c24-label').value || '').trim();
        const mallId = (document.getElementById('c24-mallid').value || '').trim();
        const cid = (document.getElementById('c24-cid').value || '').trim();
        const secret = (document.getElementById('c24-secret').value || '').trim();
        const brand = document.getElementById('c24-brand').value || null;
        if (!key || !label || !mallId || !cid || !secret) { this.showToast('식별자·표시명·몰아이디·Client ID/Secret 모두 필요합니다.'); return; }
        if (!/^[a-z0-9_]+$/.test(key)) { this.showToast('식별자는 영문 소문자/숫자/밑줄만 가능합니다.'); return; }

        const { error: mErr } = await this.supabase.from('malls')
            .insert([{ mall_key: key, label, cafe24_mall_id: mallId, brand_id: brand, channel: 'cafe24' }]);
        if (mErr) { this.showToast('몰 등록 실패: ' + mErr.message); return; }
        const { error: sErr } = await this.supabase.from('channel_sync_state')
            .insert([{ mall_key: key, channel: 'cafe24', cafe24_mall_id: mallId, client_id: cid, client_secret: secret, dry_run: true }]);
        if (sErr) { this.showToast('자격증명 저장 실패: ' + sErr.message + ' (몰은 등록됨)'); }
        this._mallsLoaded = false;
        await this.loadMalls();
        this.showToast(`${label} 몰 등록됨. "인증" 버튼으로 카페24 로그인하세요.`);
        this.showCafe24Modal();
    }

    authMall(key) {
        const url = this._oauthUrl(key);
        window.open(url, '_blank');
        this.showToast('새 탭에서 카페24 인증을 완료하세요. 완료 후 이 창을 새로고침하면 "연동됨"으로 바뀝니다.');
    }

    // ============================================================
    //  노션식: 페이지 / 위키
    // ============================================================
    async loadPages() {
        this._pagesLoading = true;
        try {
            const { data } = await this.supabase.from('pages').select('*').order('sort_order', { ascending: true });
            this.pages = data || [];
            this._pagesLoaded = true;
        } catch (e) { this.showToast('페이지를 불러오지 못했습니다.'); this.pages = []; this._pagesLoaded = true; }
        this._pagesLoading = false;
        this.requestRender();
    }

    _renderPageTree(parentId, depth) {
        const children = (this.pages || []).filter(p => (p.parent_id || null) === parentId);
        return children.map(p => `
            <div>
                <div class="page-tree-item ${this.activePageId === p.id ? 'active' : ''}" data-pid="${p.id}"
                     style="display:flex;align-items:center;gap:6px;padding:6px 8px;padding-left:${10 + depth * 14}px;border-radius:8px;cursor:pointer;font-size:0.88rem;${this.activePageId === p.id ? 'background:rgba(99,102,241,0.18)' : ''}">
                    <span>${p.icon || '📄'}</span>
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title || '제목 없음'}</span>
                    <button class="page-add-child" data-pid="${p.id}" title="하위 페이지" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.9rem">+</button>
                </div>
                ${this._renderPageTree(p.id, depth + 1)}
            </div>`).join('');
    }

    renderPagesView() {
        if (!this._pagesLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">페이지를 불러오는 중...</div>`;
        const active = (this.pages || []).find(p => p.id === this.activePageId);
        const editing = this._pageEditing;
        return `
        <div style="display:flex;gap:1rem;height:calc(100vh - 160px);min-height:480px">
            <div class="glass" style="width:260px;flex-shrink:0;padding:1rem;border-radius:16px;overflow-y:auto">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
                    <h3 style="margin:0;font-size:1rem"><i class="ph ph-note-pencil"></i> 페이지</h3>
                    <button id="page-new-root" class="btn-secondary" style="padding:4px 10px;border-radius:8px;font-size:0.8rem">+ 새</button>
                </div>
                ${this._renderPageTree(null, 0) || '<p style="color:var(--text-muted);font-size:0.82rem;padding:8px">아직 페이지가 없습니다.</p>'}
            </div>
            <div class="glass" style="flex:1;padding:2rem;border-radius:16px;overflow-y:auto">
                ${!active ? `<div style="color:var(--text-muted);text-align:center;margin-top:4rem"><i class="ph ph-file-dashed" style="font-size:2.5rem"></i><p>왼쪽에서 페이지를 선택하거나 새로 만드세요.</p></div>` : `
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;gap:1rem">
                        <input id="page-title" value="${(active.title || '').replace(/"/g, '&quot;')}" style="flex:1;background:none;border:none;color:white;font-size:1.6rem;font-weight:700;outline:none">
                        <div style="display:flex;gap:8px">
                            <button id="page-toggle-edit" class="btn-secondary" style="padding:6px 14px;border-radius:8px;font-size:0.82rem">${editing ? '미리보기' : '편집'}</button>
                            <button id="page-delete" class="btn-secondary" style="padding:6px 12px;border-radius:8px;font-size:0.82rem;color:#ef4444">삭제</button>
                        </div>
                    </div>
                    ${editing
                        ? `<textarea id="page-content" style="width:100%;height:calc(100% - 90px);min-height:340px;background:rgba(0,0,0,0.2);border:1px solid var(--card-border);border-radius:12px;color:white;padding:1rem;font-size:0.95rem;line-height:1.7;resize:vertical;outline:none;font-family:inherit" placeholder="# 제목\n마크다운으로 작성하세요. **굵게**, *기울임*, - 목록, \`코드\`">${(active.content || '').replace(/</g, '&lt;')}</textarea>
                           <p style="color:var(--text-muted);font-size:0.78rem;margin-top:8px">자동 저장됩니다 (편집창 벗어날 때).</p>`
                        : `<div class="page-render" style="line-height:1.8;color:#e2e8f0">${this._mdToHtml(active.content)}</div>`}
                `}
            </div>
        </div>`;
    }

    _mdToHtml(md) {
        if (!md || !md.trim()) return '<p style="color:var(--text-muted)">내용이 없습니다. "편집"을 눌러 작성하세요.</p>';
        let h = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/^### (.*)$/gm, '<h3 style="margin:1rem 0 .4rem">$1</h3>')
            .replace(/^## (.*)$/gm, '<h2 style="margin:1.2rem 0 .5rem">$1</h2>')
            .replace(/^# (.*)$/gm, '<h1 style="margin:1.2rem 0 .6rem">$1</h1>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code style="background:rgba(var(--tint),0.1);padding:2px 6px;border-radius:4px">$1</code>')
            .replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>');
        h = h.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul style="padding-left:1.4rem;margin:.5rem 0">$1</ul>');
        h = h.split(/\n{2,}/).map(b => b.match(/^<(h\d|ul|li)/) ? b : `<p style="margin:.5rem 0">${b.replace(/\n/g, '<br>')}</p>`).join('');
        return h;
    }

    bindPagesEvents() {
        const newRoot = document.getElementById('page-new-root');
        if (newRoot) newRoot.onclick = () => this.createPage(null);
        this.appContainer.querySelectorAll('.page-tree-item').forEach(el => {
            el.onclick = (e) => { if (e.target.closest('.page-add-child')) return; this.setState({ activePageId: el.dataset.pid, _pageEditing: false }); };
        });
        this.appContainer.querySelectorAll('.page-add-child').forEach(b => b.onclick = (e) => { e.stopPropagation(); this.createPage(b.dataset.pid); });

        const titleEl = document.getElementById('page-title');
        if (titleEl) titleEl.onblur = () => this.savePageField('title', titleEl.value);
        const toggle = document.getElementById('page-toggle-edit');
        if (toggle) toggle.onclick = () => {
            const ta = document.getElementById('page-content');
            if (ta && this._pageEditing) this.savePageField('content', ta.value, true);
            else this.setState({ _pageEditing: true });
        };
        const ta = document.getElementById('page-content');
        if (ta) ta.onblur = () => this.savePageField('content', ta.value);
        const del = document.getElementById('page-delete');
        if (del) del.onclick = () => this.deletePage(this.activePageId);
    }

    async createPage(parentId) {
        const { data, error } = await this.supabase.from('pages')
            .insert([{ title: '제목 없음', parent_id: parentId, sort_order: (this.pages || []).length, created_by: this._actor() }]).select().single();
        if (error) { this.showToast('페이지 생성 실패: ' + error.message); return; }
        this._pagesLoaded = false;
        await this.loadPages();
        this.setState({ activePageId: data.id, _pageEditing: true });
    }

    async savePageField(field, value, togglePreview) {
        if (!this.activePageId) return;
        const p = (this.pages || []).find(x => x.id === this.activePageId);
        if (p && p[field] === value && !togglePreview) return;
        const { error } = await this.supabase.from('pages').update({ [field]: value }).eq('id', this.activePageId);
        if (error) { this.showToast('저장 실패: ' + error.message); return; }
        if (p) p[field] = value;
        if (togglePreview) this.setState({ _pageEditing: false });
    }

    async deletePage(pageId) {
        const ok = await this.showConfirm('이 페이지와 하위 페이지가 모두 삭제됩니다. 계속할까요?', '페이지 삭제');
        if (!ok) return;
        const { error } = await this.supabase.from('pages').delete().eq('id', pageId);
        if (error) { this.showToast('삭제 실패: ' + error.message); return; }
        this._pagesLoaded = false;
        this.activePageId = null;
        await this.loadPages();
    }

    // ============================================================
    //  노션식: 보드(칸반) + 표 — board_cards 공유
    // ============================================================
    async loadCards() {
        this._cardsLoading = true;
        try {
            const { data } = await this.supabase.from('board_cards').select('*').order('sort_order', { ascending: true });
            this.cards = data || [];
            this._cardsLoaded = true;
        } catch (e) { this.showToast('보드를 불러오지 못했습니다.'); this.cards = []; this._cardsLoaded = true; }
        this._cardsLoading = false;
        this.requestRender();
    }

    _kanbanColumns() { return [{ id: 'todo', label: '할 일' }, { id: 'doing', label: '진행 중' }, { id: 'done', label: '완료' }]; }

    renderKanban() {
        if (!this._cardsLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">보드를 불러오는 중...</div>`;
        const cols = this._kanbanColumns();
        return `
        <div class="glass" style="padding:1.5rem;border-radius:20px">
            <h2 style="margin:0 0 1.25rem;font-size:1.5rem"><i class="ph ph-kanban"></i> 보드</h2>
            <div style="display:flex;gap:1rem;overflow-x:auto;padding-bottom:8px">
                ${cols.map(col => {
                    const cards = (this.cards || []).filter(c => c.status === col.id);
                    return `
                    <div class="kanban-col" data-status="${col.id}" style="flex:1;min-width:260px;background:rgba(var(--tint),0.03);border:1px solid var(--card-border);border-radius:14px;padding:12px">
                        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
                            <span style="font-weight:600;font-size:0.92rem">${col.label} <span style="color:var(--text-muted)">${cards.length}</span></span>
                            <button class="kanban-add" data-status="${col.id}" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem">+</button>
                        </div>
                        <div class="kanban-dropzone" data-status="${col.id}" style="min-height:60px;display:flex;flex-direction:column;gap:8px">
                            ${cards.map(c => `
                                <div class="kanban-card" draggable="true" data-id="${c.id}" style="background:var(--card-bg,rgba(var(--tint),0.06));border:1px solid var(--card-border);border-radius:10px;padding:10px;cursor:grab">
                                    <div style="font-size:0.9rem;font-weight:600;margin-bottom:4px">${c.title}</div>
                                    ${c.body ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">${c.body}</div>` : ''}
                                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                                        ${c.brand_id ? `<span style="font-size:0.68rem;padding:2px 8px;border-radius:10px;background:rgba(99,102,241,0.2)">${this._brandNameById(c.brand_id)}</span>` : ''}
                                        ${c.assignee ? `<span style="font-size:0.68rem;color:var(--text-muted)">@${c.assignee}</span>` : ''}
                                        ${c.due_date ? `<span style="font-size:0.68rem;color:var(--text-muted)">📅 ${c.due_date}</span>` : ''}
                                        <button class="kanban-del" data-id="${c.id}" style="margin-left:auto;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.8rem">✕</button>
                                    </div>
                                </div>`).join('')}
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }

    bindKanbanEvents() {
        this.appContainer.querySelectorAll('.kanban-add').forEach(b => b.onclick = () => this.createCard(b.dataset.status));
        this.appContainer.querySelectorAll('.kanban-del').forEach(b => b.onclick = (e) => { e.stopPropagation(); this.deleteCard(b.dataset.id); });
        this.appContainer.querySelectorAll('.kanban-card').forEach(card => {
            card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', card.dataset.id); card.style.opacity = '0.4'; });
            card.addEventListener('dragend', () => { card.style.opacity = '1'; });
        });
        this.appContainer.querySelectorAll('.kanban-dropzone').forEach(zone => {
            zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.style.background = 'rgba(99,102,241,0.08)'; });
            zone.addEventListener('dragleave', () => { zone.style.background = 'none'; });
            zone.addEventListener('drop', (e) => {
                e.preventDefault(); zone.style.background = 'none';
                const id = e.dataTransfer.getData('text/plain');
                this.moveCard(id, zone.dataset.status);
            });
        });
    }

    async createCard(status) {
        const title = (await this.showPrompt('카드 제목')) || '';
        if (!title.trim()) return;
        const { error } = await this.supabase.from('board_cards')
            .insert([{ title: title.trim(), status, sort_order: (this.cards || []).length, created_by: this._actor() }]);
        if (error) { this.showToast('카드 생성 실패: ' + error.message); return; }
        this._cardsLoaded = false; await this.loadCards();
    }

    async moveCard(id, status) {
        const card = (this.cards || []).find(c => c.id === id);
        if (!card || card.status === status) return;
        card.status = status;
        const { error } = await this.supabase.from('board_cards').update({ status }).eq('id', id);
        if (error) { this.showToast('이동 실패: ' + error.message); this._cardsLoaded = false; await this.loadCards(); return; }
        this.requestRender();
    }

    async deleteCard(id) {
        const { error } = await this.supabase.from('board_cards').delete().eq('id', id);
        if (error) { this.showToast('삭제 실패: ' + error.message); return; }
        this._cardsLoaded = false; await this.loadCards();
    }

    async updateCardField(id, field, value) {
        const card = (this.cards || []).find(c => c.id === id);
        if (card) card[field] = value;
        const { error } = await this.supabase.from('board_cards').update({ [field]: value || null }).eq('id', id);
        if (error) this.showToast('수정 실패: ' + error.message);
    }

    renderTableView() {
        if (!this._cardsLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">표를 불러오는 중...</div>`;
        const statusOpt = { todo: '할 일', doing: '진행 중', done: '완료' };
        let rows = [...(this.cards || [])];
        const f = this.tableFilter || 'all';
        if (f !== 'all') rows = rows.filter(c => c.status === f);
        const sortKey = this.tableSort || 'created_at';
        rows.sort((a, b) => String(a[sortKey] || '').localeCompare(String(b[sortKey] || '')));
        return `
        <div class="glass" style="padding:2rem;border-radius:20px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;flex-wrap:wrap;gap:1rem">
                <h2 style="margin:0;font-size:1.5rem"><i class="ph ph-table"></i> 표</h2>
                <div style="display:flex;gap:10px;align-items:center">
                    <select id="table-filter" class="glass brand-select" style="color:white;border:1px solid rgba(var(--tint),0.1);border-radius:8px;padding:6px 12px">
                        <option value="all" style="background:#0f172a" ${f === 'all' ? 'selected' : ''}>전체 상태</option>
                        ${Object.entries(statusOpt).map(([k, v]) => `<option value="${k}" style="background:#0f172a" ${f === k ? 'selected' : ''}>${v}</option>`).join('')}
                    </select>
                    <button class="btn-primary" id="table-add" style="padding:8px 16px;border-radius:10px">+ 행 추가</button>
                </div>
            </div>
            <div class="table-container" style="overflow-x:auto">
                <table class="mtbl" style="width:100%;border-collapse:collapse;min-width:680px">
                    <thead><tr style="color:var(--text-muted);font-size:0.82rem;text-align:left">
                        <th class="tbl-sort" data-k="title" style="cursor:pointer">제목 ⇅</th>
                        <th class="tbl-sort" data-k="status" style="cursor:pointer">상태 ⇅</th>
                        <th class="tbl-sort" data-k="assignee" style="cursor:pointer">담당 ⇅</th>
                        <th class="tbl-sort" data-k="due_date" style="cursor:pointer">마감 ⇅</th>
                        <th>브랜드</th><th style="text-align:right">작업</th>
                    </tr></thead>
                    <tbody>
                        ${rows.map(c => `
                        <tr style="border-bottom:1px solid var(--card-border)">
                            <td><input class="tbl-edit" data-id="${c.id}" data-f="title" value="${(c.title || '').replace(/"/g, '&quot;')}" style="background:none;border:none;color:white;width:100%;outline:none;font-size:0.9rem"></td>
                            <td>
                                <select class="tbl-edit" data-id="${c.id}" data-f="status" style="background:rgba(var(--tint),0.05);border:1px solid var(--card-border);border-radius:6px;color:white;padding:4px 8px">
                                    ${Object.entries(statusOpt).map(([k, v]) => `<option value="${k}" style="background:#0f172a" ${c.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                                </select>
                            </td>
                            <td><input class="tbl-edit" data-id="${c.id}" data-f="assignee" value="${(c.assignee || '').replace(/"/g, '&quot;')}" placeholder="-" style="background:none;border:none;color:white;width:90px;outline:none;font-size:0.9rem"></td>
                            <td><input type="date" class="tbl-edit" data-id="${c.id}" data-f="due_date" value="${c.due_date || ''}" style="background:none;border:none;color:white;outline:none;font-size:0.85rem"></td>
                            <td style="color:var(--text-muted)">${this._brandNameById(c.brand_id)}</td>
                            <td style="text-align:right"><button class="tbl-del btn-secondary" data-id="${c.id}" style="padding:4px 10px;border-radius:8px;font-size:0.78rem">삭제</button></td>
                        </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">행이 없습니다. "+ 행 추가"로 시작하세요.</td></tr>`}
                    </tbody>
                </table>
            </div>
            <p style="color:var(--text-muted);font-size:0.78rem;margin-top:10px">셀을 직접 편집하면 자동 저장됩니다. 보드(칸반)와 같은 데이터를 공유합니다.</p>
        </div>`;
    }

    bindTableEvents() {
        const filter = document.getElementById('table-filter');
        if (filter) filter.onchange = () => this.setState({ tableFilter: filter.value });
        const add = document.getElementById('table-add');
        if (add) add.onclick = () => this.createCard('todo');
        this.appContainer.querySelectorAll('.tbl-sort').forEach(th => th.onclick = () => this.setState({ tableSort: th.dataset.k }));
        this.appContainer.querySelectorAll('.tbl-del').forEach(b => b.onclick = () => this.deleteCard(b.dataset.id));
        this.appContainer.querySelectorAll('.tbl-edit').forEach(el => {
            const ev = el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'blur';
            el.addEventListener(ev, () => this.updateCardField(el.dataset.id, el.dataset.f, el.value));
        });
    }

    // ============================================================
    //  노션식: 캘린더 (할일·일정·카드 마감 집계)
    // ============================================================
    _calItems() {
        const items = [];
        (this.cards || []).forEach(c => { if (c.due_date) items.push({ date: c.due_date, label: c.title, type: 'card', color: '#6366f1' }); });
        (mockData.products || []).forEach(p => (p.todos || []).forEach(t => {
            const d = t.due_date || t.date || t.dueDate;
            if (d) items.push({ date: String(d).slice(0, 10).replace(/\./g, '-'), label: t.title || t.content || t.text || '할일', type: 'todo', color: '#22c55e' });
        }));
        (mockData.schedules || []).forEach(s => { const d = s.date || s.due_date; if (d) items.push({ date: String(d).slice(0, 10), label: s.title || s.name || '일정', type: 'schedule', color: '#f59e0b' }); });
        return items;
    }

    // ── 캘린더 (맥 캘린더 그대로 · 분류 / 달력 / 그날 일정) ─────
    CAL_SRC = [
        { k: 'rem',  t: '할 일',      c: '#ff9f0a' },
        { k: 'step', t: '시즌 단계',   c: '#bf5af2' },
        { k: 'todo', t: '시즌 할 일',  c: '#0a84ff' },
        { k: 'note', t: '메모 체크',   c: '#30d158' },
        { k: 'job',  t: '생산 작업',   c: '#6366f1' },
        { k: 'proj', t: '시즌 마감', c: '#bf5af2' },
    ];
    _calOn(k) { const off = this.calOff || {}; return !off[k]; }
    toggleCalSrc(k) { this.calOff = { ...(this.calOff || {}) }; this.calOff[k] = this._calOn(k); this.requestRender(); }
    calMove(n) {
        const d = this._calCursor ? new Date(this._calCursor) : new Date();
        if ((this.calView || 'month') === 'month') d.setMonth(d.getMonth() + n);
        else if (this.calView === 'week') d.setDate(d.getDate() + n * 7);
        else d.setDate(d.getDate() + n);
        this._calCursor = d.toISOString().slice(0, 10); this.requestRender();
    }
    calToday() { this._calCursor = new Date().toISOString().slice(0, 10); this.calDay = this._calCursor; this.requestRender(); }
    setCalView(v) { this.calView = v; this.requestRender(); }
    selectCalDay(d) { this.calDay = d; this.requestRender(); }
    renderCalendar() {
        const esc = s => this._vesc(s);
        const todayS = new Date().toISOString().slice(0, 10);
        const cur = new Date(this._calCursor || todayS);
        const yy = cur.getFullYear(), mo = cur.getMonth();
        const view = this.calView || 'month';
        const items = this._allDated().filter(x => x.date && this._calOn(x.kind));
        const byDate = {};
        items.forEach(x => { (byDate[x.date] ||= []).push(x); });
        const ymd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dow = ['일', '월', '화', '수', '목', '금', '토'];
        const sel = this.calDay || todayS;

        // 가운데 — 달/주/일
        let grid = '';
        if (view === 'month') {
            const first = new Date(yy, mo, 1).getDay();
            const days = new Date(yy, mo + 1, 0).getDate();
            const prevDays = new Date(yy, mo, 0).getDate();
            const cells = [];
            for (let i = first - 1; i >= 0; i--) cells.push({ d: prevDays - i, out: true, key: ymd(mo === 0 ? yy - 1 : yy, mo === 0 ? 11 : mo - 1, prevDays - i) });
            for (let d = 1; d <= days; d++) cells.push({ d, key: ymd(yy, mo, d) });
            while (cells.length % 7) { const d = cells.length - first - days + 1; cells.push({ d, out: true, key: ymd(mo === 11 ? yy + 1 : yy, mo === 11 ? 0 : mo + 1, d) }); }
            grid = `<div class="cal-dow">${dow.map((n, i) => `<span class="${i === 0 ? 'sun' : (i === 6 ? 'sat' : '')}">${n}</span>`).join('')}</div>
                <div class="cal-grid">${cells.map(c => {
                    const list = byDate[c.key] || [];
                    return `<div class="cal-cell${c.out ? ' out' : ''}${c.key === todayS ? ' today' : ''}${c.key === sel ? ' on' : ''}"
                            onclick="app.selectCalDay('${c.key}')">
                        <span class="cal-d">${c.key === todayS ? `<i>${c.d}</i>` : c.d}${c.d === 1 && !c.out ? `<em>${mo + 1}월</em>` : ''}</span>
                        ${list.slice(0, 3).map(x => `<span class="cal-chip" style="background:${x.color}" title="${esc(x.title)}">${esc(x.title)}</span>`).join('')}
                        ${list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : ''}
                    </div>`;
                }).join('')}</div>`;
        } else {
            const base = new Date(cur);
            const n = view === 'week' ? 7 : 1;
            if (view === 'week') base.setDate(base.getDate() - base.getDay());
            const days = [...Array(n)].map((_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return d.toISOString().slice(0, 10); });
            grid = `<div class="cal-cols" style="grid-template-columns:repeat(${n},1fr)">
                ${days.map(k => {
                    const list = byDate[k] || [];
                    const d = new Date(k);
                    return `<div class="cal-col${k === todayS ? ' today' : ''}" onclick="app.selectCalDay('${k}')">
                        <div class="cal-colh">${dow[d.getDay()]} <b>${d.getDate()}</b></div>
                        ${list.map(x => `<div class="cal-ev" style="border-left-color:${x.color}">
                            <b>${esc(x.title)}</b><span>${esc(x.sub || '')}</span></div>`).join('')
                          || '<div class="cal-empty">없음</div>'}
                    </div>`;
                }).join('')}</div>`;
        }

        // 왼쪽 아래 작은 달력
        const mFirst = new Date(yy, mo, 1).getDay(), mDays = new Date(yy, mo + 1, 0).getDate();
        let mini = '';
        for (let i = 0; i < mFirst; i++) mini += '<i></i>';
        for (let d = 1; d <= mDays; d++) {
            const k = ymd(yy, mo, d);
            mini += `<i class="${k === todayS ? 'today' : ''}${k === sel ? ' on' : ''}${(byDate[k] || []).length ? ' has' : ''}"
                onclick="app.selectCalDay('${k}')">${d}</i>`;
        }

        const selList = (byDate[sel] || []).slice().sort((a, b) => a.kind.localeCompare(b.kind));
        return `
        <div class="cal">
            <aside class="cal-side">
                <div class="m3-h">이 대시보드</div>
                ${this.CAL_SRC.map(s2 => `<div class="cal-src" onclick="app.toggleCalSrc('${s2.k}')">
                    <span class="cal-ck${this._calOn(s2.k) ? ' on' : ''}" style="--c:${s2.c}"></span>
                    <span>${esc(s2.t)}</span>
                    <em>${items.filter(x => x.kind === s2.k).length}</em></div>`).join('')}
                <div class="cal-mini">
                    <div class="cal-mh"><button onclick="app.calMove(-1)">‹</button>
                        <b>${yy}년 ${mo + 1}월</b><button onclick="app.calMove(1)">›</button></div>
                    <div class="cal-mdow">${dow.map(x => `<span>${x}</span>`).join('')}</div>
                    <div class="cal-mgrid">${mini}</div>
                </div>
            </aside>
            <section class="cal-main">
                <div class="cal-top">
                    <button class="cal-add" onclick="app.quickAddFromCalendar()" title="새 할 일"><i class="ph ph-plus"></i></button>
                    <div class="cal-seg">
                        ${[['day', '일'], ['week', '주'], ['month', '월']].map(([k, t]) =>
                            `<button class="${view === k ? 'on' : ''}" onclick="app.setCalView('${k}')">${t}</button>`).join('')}
                    </div>
                    <div class="cal-nav"><button onclick="app.calMove(-1)">‹</button>
                        <button class="t" onclick="app.calToday()">오늘</button>
                        <button onclick="app.calMove(1)">›</button></div>
                </div>
                <h1 class="cal-h1">${yy}년 ${mo + 1}월</h1>
                ${grid}
            </section>
            <aside class="cal-day">
                <div class="dt-h"><b>${esc(new Date(sel).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' }))}</b>
                    <span>${selList.length}건</span></div>
                <div class="dt-b">
                    ${selList.length ? selList.map(x => `<div class="cal-ev" style="border-left-color:${x.color}"
                            onclick="app.macOpen('${x.view}')">
                        <b${x.done ? ' class="done"' : ''}>${esc(x.title)}</b><span>${esc(x.sub || '')}</span></div>`).join('')
                      : `<div class="m3-none">이 날은 비어 있습니다</div>`}
                </div>
                <div class="dt-a"><button class="mbtn pri" onclick="app.quickAddFromCalendar()">이 날에 추가</button></div>
            </aside>
        </div>`;
    }
    //  캘린더에서 더하기 — 할 일 목록에 넣거나, 메모 폴더에 [ ] 로 적는다.
    //  메모에 적으면 그 메모에서도 보이고 체크하면 여기서도 지워진다(양방향).
    quickAddFromCalendar() {
        const day = this.calDay || new Date().toISOString().slice(0, 10);
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const esc = x => this._vesc(x);
        const lists = [...new Set((this.remList || []).map(r => r.list_name || '기본'))];
        if (!lists.length) lists.push('기본');
        const folders = [...new Set((this.noteList || []).filter(n => !n.item_id).map(n => n.folder || '공용'))];
        c.innerHTML = `<div class="modal-content vmodal fi" style="width:94%;max-width:400px">
            <div class="hk-top"><b>${esc(day)} 에 더하기</b>
                <button class="fi-x" onclick="app.closeGlobalModal()">×</button></div>
            <div class="fi-r" style="margin-top:12px"><span>내용</span>
                <input id="qa-t" class="nw-f" placeholder="할 일 또는 일정" autocomplete="off"></div>
            <div class="fi-r"><span>어디에</span>
                <select id="qa-w" class="nw-f">
                    <optgroup label="할 일 목록">
                        ${lists.map(l => `<option value="r:${esc(l)}">${esc(l)}</option>`).join('')}
                    </optgroup>
                    ${folders.length ? `<optgroup label="메모 폴더 — [ ] 로 적힙니다">
                        ${folders.map(f => `<option value="f:${esc(f)}">${esc(f)}</option>`).join('')}
                    </optgroup>` : ''}
                </select></div>
            <p class="fi-note">메모 폴더를 고르면 그 폴더의 <b>${esc(day)}</b> 메모에 <b>[ ] 내용 ${esc(day)}</b> 로 적힙니다.
                메모에서 체크하면 여기서도 지워집니다.</p>
            <div class="fi-act">
                <button class="mbtn" onclick="app.closeGlobalModal()">취소</button>
                <button class="mbtn pri" id="qa-ok">더하기</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        const ti = c.querySelector('#qa-t');
        ti.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); c.querySelector('#qa-ok').click(); } };
        setTimeout(() => ti.focus(), 40);
        c.querySelector('#qa-ok').onclick = async () => {
            const title = ti.value.trim(); if (!title) { ti.focus(); return; }
            const w = c.querySelector('#qa-w').value;
            this.closeGlobalModal();
            if (w.startsWith('r:')) return this._addRemOn(day, title, w.slice(2));
            return this._addNoteTodoOn(day, title, w.slice(2));
        };
    }
    async _addRemOn(day, title, list) {
        try {
            const { data, error } = await this.supabase.from('reminders')
                .insert([{ title, due_date: day, list_name: list || '기본', created_by: this.currentUser?.name || null }])
                .select('*').single();
            if (error) throw error;
            this.remList = [data, ...(this.remList || [])];
            this.requestRender();
            this.showToast(`'${list}' 에 넣었습니다`);
        } catch (e) { this.showToast('추가 실패: ' + (e.message || e)); }
    }
    //  그 폴더의 그 날짜 메모를 찾거나 만들어 [ ] 한 줄을 붙인다
    async _addNoteTodoOn(day, title, folder) {
        const line = `[ ] ${title} ${day}`;
        let n = (this.noteList || []).find(x => (x.folder || '공용') === folder && x.title === day);
        try {
            if (n) {
                const text = this._noteText(n);
                const body = this._joinNote(this._noteMeta(n), (text ? text + '\n' : '') + line);
                const { error } = await this.supabase.from('notes').update({ body }).eq('id', n.id);
                if (error) throw error;
                n.body = body; n.updated_at = new Date().toISOString();
            } else {
                const row = { title: day, body: line, folder, scope: 'shared', created_by: this._actor() };
                const { data, error } = await this.supabase.from('notes').insert([row]).select().single();
                if (error) throw error;
                this.noteList = [data, ...(this.noteList || [])];
            }
            this.requestRender();
            this.showToast(`'${folder}' 메모에 [ ] 로 적었습니다`);
        } catch (e) { this.showToast('추가 실패: ' + (e.message || e)); }
    }
    bindCalendarEvents() {
        const prev = document.getElementById('cal-prev');
        const next = document.getElementById('cal-next');
        const today = document.getElementById('cal-today');
        if (prev) prev.onclick = () => { let m = this.calMonth - 1, y = this.calYear; if (m < 0) { m = 11; y--; } this.setState({ calMonth: m, calYear: y }); };
        if (next) next.onclick = () => { let m = this.calMonth + 1, y = this.calYear; if (m > 11) { m = 0; y++; } this.setState({ calMonth: m, calYear: y }); };
        if (today) today.onclick = () => { const n = new Date(); this.setState({ calMonth: n.getMonth(), calYear: n.getFullYear() }); };
    }

    bindSampleMakerEvents() {
        const cfg = this.sampleConfig;

        if (!this._smZoom) this._smZoom = { preview: { s: 1, x: 0, y: 0 }, flat: { s: 1, x: 0, y: 0 }, pattern: { s: 1, x: 0, y: 0 } };
        const paneKey = id => id === 'sm-preview' ? 'preview' : id === 'sm-flat' ? 'flat' : 'pattern';
        const applyZoom = id => {
            const pane = document.getElementById(id); const svg = pane && pane.querySelector('svg');
            if (!svg) return; const z = this._smZoom[paneKey(id)];
            svg.style.transformOrigin = '0 0';
            svg.style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
        };

        // 미리보기/도식/패턴/지시서 부분 갱신 (컨트롤 패널 포커스 유지)
        const refreshCanvas = () => {
            const pv = document.getElementById('sm-preview');
            const fl = document.getElementById('sm-flat');
            const pt2 = document.getElementById('sm-pattern');
            const tp = document.getElementById('sm-techpack');
            if (pv) pv.innerHTML = garmentPreviewSVG(this.sampleConfig, true);
            if (fl) fl.innerHTML = garmentFlatSVG(this.sampleConfig, true);
            if (pt2) pt2.innerHTML = garmentPatternSVG(this.sampleConfig);
            if (tp) { tp.innerHTML = techPackSummaryHTML(this.sampleConfig); bindPrint(); }
            ['sm-preview', 'sm-flat', 'sm-pattern'].forEach(applyZoom);
            bindCanvasHandles();
            syncMeasureInputs();
            updateCleanPreview();
        };

        // 편집 중 우측 클린 미리보기(핸들·절개선 없는 기준 옷)
        const updateCleanPreview = () => {
            const clean = document.getElementById('sm-clean');
            const canvasEl = this.appContainer.querySelector('.sm-canvas');
            const em = !!this.sampleConfig.editMode;
            const show = em && this.sampleConfig.activeTab !== 'pattern';
            if (canvasEl) canvasEl.classList.toggle('sm-editing', show);
            if (!clean) return;
            if (show) {
                const cc = { ...this.sampleConfig, cutlines: [], points: [], editMode: false };
                clean.innerHTML = '<span class="sm-clean-label"><i class="ph ph-eye"></i> 기준 미리보기 · 선 없음</span>' +
                    (this.sampleConfig.activeTab === 'flat' ? garmentFlatSVG(cc, false) : garmentPreviewSVG(cc, false));
                clean.style.display = '';
            } else {
                clean.style.display = 'none';
            }
        };

        // 컨트롤 패널의 치수 입력값을 현재 config로 동기화 (핸들 드래그 후)
        const syncMeasureInputs = () => {
            const c = this.sampleConfig;
            this.appContainer.querySelectorAll('.sm-measure, .sm-measure-num').forEach(el => {
                const k = el.getAttribute('data-key');
                if (c.measure[k] != null && el.value != c.measure[k]) el.value = c.measure[k];
            });
        };

        const bindPrint = () => {
            const btn = document.getElementById('sm-print-btn');
            if (btn) btn.onclick = () => {
                const html = buildTechPackPrintHTML(this.sampleConfig);
                const w = window.open('', '_blank');
                if (!w) { this.showToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
                w.document.write(html);
                w.document.close();
            };
            const saveBtn = document.getElementById('sm-save-techpack');
            if (saveBtn) saveBtn.onclick = () => this.saveTechPack();
        };

        // ===== 캔버스 핸들 드래그 (배치 이동/리사이즈, 치수, 곡선) =====
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        const round05 = v => Math.round(v * 2) / 2;
        const findPlById = id => (this.sampleConfig.placements || []).find(p => p.id === id);

        const bindCanvasHandles = () => {
            ['sm-preview', 'sm-flat'].forEach(id => {
                const pane = document.getElementById(id);
                const svg = pane && pane.querySelector('svg');
                if (!svg) return;
                svg.querySelectorAll('.sm-pl-node, .sm-pl-resize, .sm-anchor, .sm-h-size, .sm-h-ctrl, .sm-point-node, .sm-cut-end').forEach(el => {
                    el.style.touchAction = 'none';
                    el.addEventListener('pointerdown', ev => startHandleDrag(ev, el, svg));
                });
            });
        };

        const startHandleDrag = (e, el, svg) => {
            e.preventDefault();
            e.stopPropagation();
            const ctm = el.getScreenCTM();
            if (!ctm) return;
            const inv = ctm.inverse();
            const toLocal = ev => {
                const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
                const l = p.matrixTransform(inv); return { x: l.x, y: l.y };
            };
            const ds = el.dataset;
            const cfg = this.sampleConfig;
            let kind;
            if (el.classList.contains('sm-pl-resize')) kind = 'resize';
            else if (el.classList.contains('sm-pl-node')) kind = 'move';
            else if (el.classList.contains('sm-point-node')) kind = 'point';
            else if (el.classList.contains('sm-cut-end')) kind = 'cutend';
            else if (el.classList.contains('sm-h-ctrl')) kind = 'ctrl';
            else kind = 'size';

            const startL = toLocal(e);
            let grab = { x: 0, y: 0 };
            if (kind === 'move' || kind === 'point') {
                const ccx = parseFloat(ds.cx), ccy = parseFloat(ds.cy);
                grab = { x: ccx - startL.x, y: ccy - startL.y };
            }

            const tip = document.getElementById('sm-drag-tip') || (() => {
                const d = document.createElement('div'); d.id = 'sm-drag-tip'; d.className = 'sm-drag-tip'; document.body.appendChild(d); return d;
            })();
            const labelMap = { shoulder: '어깨', chest: '가슴', hem: '밑단', neck: '목', length: '총장', sleeve: '소매', armhole: '암홀', waist: '허리', hip: '엉덩이', rise: '밑위', thigh: '허벅지' };

            const apply = ev => {
                const L = toLocal(ev);
                let tipText = '';
                if (kind === 'move') {
                    const p = findPlById(ds.id); if (!p) return;
                    p.fx = clamp(L.x + grab.x, 6, 894);
                    p.fy = clamp(L.y + grab.y, 6, 554);
                    tipText = '위치 이동';
                } else if (kind === 'resize') {
                    const sx = parseFloat(ds.sx), ccx = parseFloat(ds.cx);
                    const p = findPlById(ds.id); if (!p) return;
                    const half = Math.abs(L.x - ccx);
                    p.sizeCm = clamp(round05((2 * half) / sx), 2, 40);
                    tipText = `크기 ${p.sizeCm}cm`;
                } else if (kind === 'point') {
                    const pt = (cfg.points || []).find(x => x.id === ds.id); if (!pt) return;
                    pt.fx = clamp(L.x + grab.x, 6, 894); pt.fy = clamp(L.y + grab.y, 6, 554);
                    tipText = '포인트 이동';
                } else if (kind === 'cutend') {
                    const cl = (cfg.cutlines || []).find(x => x.id === ds.id); if (!cl || !cl.pts) return;
                    const idx = parseInt(ds.idx, 10);
                    let nx = clamp(L.x, 6, 894), ny = clamp(L.y, 6, 554);
                    if (ev.shiftKey && cl.pts.length > 1) {
                        const anchor = cl.pts[idx - 1] || cl.pts[idx + 1];
                        if (anchor) {
                            if (Math.abs(nx - anchor.x) < Math.abs(ny - anchor.y)) nx = anchor.x; // 수직 고정
                            else ny = anchor.y;                                                     // 수평 고정
                        }
                    }
                    if (cl.pts[idx]) { cl.pts[idx].x = nx; cl.pts[idx].y = ny; }
                    tipText = ev.shiftKey ? '절개선 · 수직/수평 고정' : '절개선';
                } else if (kind === 'ctrl') {
                    if (!cfg.nodes) cfg.nodes = {};
                    const bx = parseFloat(ds.bx), by = parseFloat(ds.by);
                    cfg.nodes[ds.key] = { dx: clamp(L.x - bx, -120, 120), dy: clamp(L.y - by, -120, 120) };
                    tipText = '곡선 조절';
                } else { // size
                    const base = parseFloat(ds.base), scale = parseFloat(ds.scale);
                    const m = { min: parseFloat(ds.min), max: parseFloat(ds.max) };
                    let val;
                    if (ds.h === 'sleeve') val = Math.hypot(L.x - parseFloat(ds.sx), L.y - parseFloat(ds.sy)) / scale;
                    else if (ds.h === 'armhole') val = 2 * (L.y - base) / scale;
                    else if (ds.axis === 'y') val = (L.y - base) / scale;
                    else val = (parseFloat(ds.mult) || 1) * (L.x - base) / scale;
                    val = clamp(round05(Math.abs(val)), m.min, m.max);
                    cfg.measure[ds.key] = val;
                    tipText = `${labelMap[ds.key] || ds.key} ${val}cm`;
                }
                tip.textContent = tipText;
                tip.style.display = 'block';
                tip.style.left = (ev.clientX + 14) + 'px';
                tip.style.top = (ev.clientY - 10) + 'px';
                refreshCanvas();
            };
            const up = () => {
                tip.style.display = 'none';
                window.removeEventListener('pointermove', apply);
                window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', apply);
            window.addEventListener('pointerup', up);
        };

        // 편집(핸들) 토글
        const editToggle = document.getElementById('sm-edit-toggle');
        if (editToggle) editToggle.onclick = () => {
            this.sampleConfig.editMode = !this.sampleConfig.editMode;
            editToggle.classList.toggle('active', this.sampleConfig.editMode);
            refreshCanvas();
        };

        // ② 의류 종류 (치수/디테일 리셋 → 컨트롤 패널까지 전체 재렌더)
        this.appContainer.querySelectorAll('.sm-type').forEach(btn => {
            btn.onclick = () => {
                const type = btn.getAttribute('data-type');
                if (type === this.sampleConfig.type) return;
                this.sampleConfig = configForType(this.sampleConfig, type);
                this.requestRender();
            };
        });

        // ③ 색상
        this.appContainer.querySelectorAll('.sm-color').forEach(btn => {
            btn.onclick = () => {
                this.sampleConfig.color = { name: btn.getAttribute('data-name'), hex: btn.getAttribute('data-hex') };
                this.appContainer.querySelectorAll('.sm-color').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                refreshCanvas();
            };
        });

        // ④ 상세 치수 (range ↔ number 동기화)
        const syncMeasure = (key, value) => {
            const v = Math.max(0, Number(value) || 0);
            this.sampleConfig.measure[key] = v;
            this.appContainer.querySelectorAll(`.sm-measure[data-key="${key}"], .sm-measure-num[data-key="${key}"]`)
                .forEach(el => { if (el.value != v) el.value = v; });
            refreshCanvas();
        };
        this.appContainer.querySelectorAll('.sm-measure, .sm-measure-num').forEach(el => {
            el.addEventListener('input', () => syncMeasure(el.getAttribute('data-key'), el.value));
        });

        // ⑤ 디테일
        this.appContainer.querySelectorAll('.sm-detail').forEach(chk => {
            chk.addEventListener('change', () => {
                this.sampleConfig.details[chk.getAttribute('data-key')] = chk.checked;
                refreshCanvas();
            });
        });

        // ⑥ 로고·배치 추가/삭제/수정
        this.appContainer.querySelectorAll('.sm-pl-add').forEach(btn => {
            btn.onclick = () => {
                const kind = btn.getAttribute('data-kind');
                const id = 'pl' + Date.now() + Math.floor((this._plSeq = (this._plSeq || 0) + 1));
                if (!this.sampleConfig.placements) this.sampleConfig.placements = [];
                this.sampleConfig.placements.push(newPlacement(kind, this.sampleConfig, id));
                this.requestRender();
            };
        });
        // ⑦ 절개선·포인트
        const cutAdd = this.appContainer.querySelector('.sm-cut-add');
        if (cutAdd) cutAdd.onclick = () => { if (!this.sampleConfig.cutlines) this.sampleConfig.cutlines = []; this.sampleConfig.cutlines.push(newCutline('cl' + Date.now())); this.sampleConfig.editMode = true; this.requestRender(); };
        const pointAdd = this.appContainer.querySelector('.sm-point-add');
        if (pointAdd) pointAdd.onclick = () => { if (!this.sampleConfig.points) this.sampleConfig.points = []; this.sampleConfig.points.push(newPoint('pt' + Date.now())); this.sampleConfig.editMode = true; this.requestRender(); };
        this.appContainer.querySelectorAll('.sm-cut-del').forEach(b => b.onclick = () => { this.sampleConfig.cutlines = (this.sampleConfig.cutlines || []).filter(c => c.id !== b.getAttribute('data-id')); this.requestRender(); });
        this.appContainer.querySelectorAll('.sm-cut-style').forEach(b => b.onclick = () => { const cl = (this.sampleConfig.cutlines || []).find(c => c.id === b.getAttribute('data-id')); if (cl) { cl.style = b.getAttribute('data-style'); this.sampleConfig.editMode = true; this.requestRender(); } });
        this.appContainer.querySelectorAll('.sm-cut-vadd').forEach(b => b.onclick = () => {
            const cl = (this.sampleConfig.cutlines || []).find(c => c.id === b.getAttribute('data-id'));
            if (!cl || !cl.pts || !cl.pts.length) return;
            const last = cl.pts[cl.pts.length - 1], prev = cl.pts[cl.pts.length - 2] || last;
            const nx = Math.max(20, Math.min(880, last.x + (last.x - prev.x) * 0.5 + 24));
            const ny = Math.max(20, Math.min(540, last.y + (last.y - prev.y) * 0.5 + 24));
            cl.pts.push({ x: nx, y: ny });
            this.sampleConfig.editMode = true; this.requestRender();
        });
        this.appContainer.querySelectorAll('.sm-cut-vdel').forEach(b => b.onclick = () => { const cl = (this.sampleConfig.cutlines || []).find(c => c.id === b.getAttribute('data-id')); if (cl && cl.pts && cl.pts.length > 2) { cl.pts.pop(); this.sampleConfig.editMode = true; this.requestRender(); } });
        this.appContainer.querySelectorAll('.sm-point-del').forEach(b => b.onclick = () => { this.sampleConfig.points = (this.sampleConfig.points || []).filter(p => p.id !== b.getAttribute('data-id')); this.requestRender(); });
        this.appContainer.querySelectorAll('.sm-point-label').forEach(inp => inp.addEventListener('input', () => { const p = (this.sampleConfig.points || []).find(x => x.id === inp.getAttribute('data-id')); if (p) { p.label = inp.value; refreshCanvas(); } }));
        this.appContainer.querySelectorAll('.sm-pl-del').forEach(btn => {
            btn.onclick = () => {
                const id = btn.getAttribute('data-id');
                this.sampleConfig.placements = (this.sampleConfig.placements || []).filter(p => p.id !== id);
                this.requestRender();
            };
        });
        const findPl = id => (this.sampleConfig.placements || []).find(p => p.id === id);
        this.appContainer.querySelectorAll('.sm-pl-pos').forEach(sel => {
            sel.addEventListener('change', () => {
                const p = findPl(sel.getAttribute('data-id'));
                if (p) { p.pos = sel.value; p.fx = null; p.fy = null; refreshCanvas(); }
            });
        });
        this.appContainer.querySelectorAll('.sm-pl-size').forEach(rng => {
            rng.addEventListener('input', () => {
                const p = findPl(rng.getAttribute('data-id'));
                if (!p) return;
                p.sizeCm = Number(rng.value);
                const lbl = rng.parentElement.querySelector('.sm-pl-sizeval');
                if (lbl) lbl.textContent = p.sizeCm + 'cm';
                refreshCanvas();
            });
        });
        this.appContainer.querySelectorAll('.sm-pl-input').forEach(inp => {
            inp.addEventListener('change', () => {
                const p = findPl(inp.getAttribute('data-id'));
                const file = inp.files && inp.files[0];
                if (!p || !file) return;
                if (file.size > 4 * 1024 * 1024) { this.showToast('이미지가 너무 큽니다 (4MB 이하).'); return; }
                const reader = new FileReader();
                reader.onload = e => {
                    p.dataUrl = e.target.result;
                    p.fileName = file.name;
                    this.requestRender(); // 썸네일 패널 반영
                };
                reader.readAsDataURL(file);
            });
        });

        // 레퍼런스 사진 (디테일 메모)
        this.appContainer.querySelectorAll('.sm-ref-input').forEach(inp => {
            inp.addEventListener('change', () => {
                const file = inp.files && inp.files[0];
                if (!file) return;
                if (file.size > 4 * 1024 * 1024) { this.showToast('이미지가 너무 큽니다 (4MB 이하).'); return; }
                const reader = new FileReader();
                reader.onload = e => {
                    if (!Array.isArray(this.sampleConfig.references)) this.sampleConfig.references = [];
                    this.sampleConfig.references.push({ id: 'ref' + Date.now().toString(36), dataUrl: e.target.result, note: '' });
                    this.requestRender();
                };
                reader.readAsDataURL(file);
            });
        });
        this.appContainer.querySelectorAll('.sm-ref-note').forEach(inp => {
            inp.addEventListener('input', () => {
                const r = (this.sampleConfig.references || []).find(x => x.id === inp.getAttribute('data-id'));
                if (r) r.note = inp.value;
            });
        });
        this.appContainer.querySelectorAll('.sm-ref-del').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                this.sampleConfig.references = (this.sampleConfig.references || []).filter(x => x.id !== id);
                this.requestRender();
            });
        });

        // ① 기본 정보 / ⑦ 원단·비고
        const textMap = { 'sm-styleName': 'styleName', 'sm-styleNo': 'styleNo', 'sm-size': 'size', 'sm-fabric': 'fabric', 'sm-note': 'note' };
        Object.entries(textMap).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => {
                this.sampleConfig[key] = el.value;
                const tp = document.getElementById('sm-techpack');
                if (tp) { tp.innerHTML = techPackSummaryHTML(this.sampleConfig); bindPrint(); }
            });
        });

        // 탭 전환 (실사 / 도식 / 패턴)
        this.appContainer.querySelectorAll('.sm-tab[data-tab]').forEach(tab => {
            tab.onclick = () => {
                const t = tab.getAttribute('data-tab');
                this.sampleConfig.activeTab = t;
                this.appContainer.querySelectorAll('.sm-tab[data-tab]').forEach(b => b.classList.toggle('active', b === tab));
                const map = { preview: 'sm-preview', flat: 'sm-flat', pattern: 'sm-pattern' };
                Object.entries(map).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.style.display = (k === t) ? '' : 'none'; });
                updateCleanPreview();
            };
        });

        // ===== 줌/팬 (돋보기) =====
        const activePaneId = () => {
            const t = this.sampleConfig.activeTab || 'preview';
            return t === 'flat' ? 'sm-flat' : t === 'pattern' ? 'sm-pattern' : 'sm-preview';
        };
        this.appContainer.querySelectorAll('.sm-zoom-btn').forEach(btn => {
            btn.onclick = () => {
                const id = activePaneId(), z = this._smZoom[id === 'sm-flat' ? 'flat' : id === 'sm-pattern' ? 'pattern' : 'preview'];
                const act = btn.getAttribute('data-zoom');
                if (act === 'in') z.s = clamp(z.s * 1.25, 0.4, 6);
                else if (act === 'out') z.s = clamp(z.s / 1.25, 0.4, 6);
                else { z.s = 1; z.x = 0; z.y = 0; }
                applyZoom(id);
            };
        });
        // 휠 줌 + 빈곳 드래그 팬
        ['sm-preview', 'sm-flat', 'sm-pattern'].forEach(id => {
            const pane = document.getElementById(id);
            if (!pane) return;
            const zk = id === 'sm-flat' ? 'flat' : id === 'sm-pattern' ? 'pattern' : 'preview';
            pane.onwheel = e => {
                e.preventDefault();
                const z = this._smZoom[zk];
                const r = pane.getBoundingClientRect();
                const mx = e.clientX - r.left, my = e.clientY - r.top;
                const old = z.s, ns = clamp(z.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.4, 6);
                // 커서 기준 확대
                z.x = mx - (mx - z.x) * (ns / old);
                z.y = my - (my - z.y) * (ns / old);
                z.s = ns;
                applyZoom(id);
            };
            pane.addEventListener('pointerdown', e => {
                if (e.target.closest('.sm-pl-node, .sm-pl-resize, .sm-anchor, .sm-h-size, .sm-h-ctrl')) return; // 핸들이면 팬 X
                const z = this._smZoom[zk];
                const sx = e.clientX, sy = e.clientY, ox = z.x, oy = z.y;
                pane.style.cursor = 'grabbing';
                const mv = ev => { z.x = ox + (ev.clientX - sx); z.y = oy + (ev.clientY - sy); applyZoom(id); };
                const up = () => { pane.style.cursor = ''; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
                window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
            });
        });

        // 곡선 초기화 버튼
        const resetCurveBtn = document.getElementById('sm-reset-curve');
        if (resetCurveBtn) resetCurveBtn.onclick = () => { this.sampleConfig.nodes = {}; refreshCanvas(); };

        bindPrint();
        bindCanvasHandles();
        ['sm-preview', 'sm-flat', 'sm-pattern'].forEach(applyZoom);
    }

    bindGlobalSearch() {
        const overlay = document.getElementById('global-search-overlay');
        const input = document.getElementById('global-search-input');
        const resultsEl = document.getElementById('global-search-results');
        if (!overlay || !input || !resultsEl) return;

        const openBtn = document.getElementById('open-search-btn');
        const mobileBtn = document.getElementById('mobile-search-btn');
        const closeBtn = document.getElementById('close-search-btn');
        const hint = '<div class="search-hint"><i class="ph ph-keyboard"></i> 검색어를 입력하세요. 결과 클릭 시 해당 시즌로 이동합니다.</div>';

        const open = () => {
            overlay.style.display = 'flex';
            input.value = '';
            resultsEl.innerHTML = hint;
            setTimeout(() => input.focus(), 30);
        };
        const close = () => { overlay.style.display = 'none'; };

        if (openBtn) openBtn.onclick = open;
        if (mobileBtn) mobileBtn.onclick = open;
        if (closeBtn) closeBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };

        const kindColor = { '시즌': '#3b82f6', '할일': '#22c55e', '문서': '#f59e0b', '메모': '#a855f7' };
        const renderResults = (q) => {
            if (!q.trim()) { resultsEl.innerHTML = hint; return; }
            const items = this.runGlobalSearch(q);
            if (items.length === 0) {
                resultsEl.innerHTML = `<div class="search-hint"><i class="ph ph-magnifying-glass"></i> "${q}" 검색 결과가 없습니다.</div>`;
                return;
            }
            resultsEl.innerHTML = `<div class="search-count">${items.length}건</div>` + items.map(r => `
                <div class="search-result-item" data-pid="${r.product_id}">
                    <span class="search-kind" style="background:${(kindColor[r.kind] || '#3b82f6')}22; color:${kindColor[r.kind] || '#3b82f6'};"><i class="ph ${r.icon}"></i> ${r.kind}</span>
                    <div class="search-result-body">
                        <span class="search-result-title ${r.done ? 'done' : ''}">${r.title}</span>
                        ${r.sub ? `<span class="search-result-sub">${r.sub}</span>` : ''}
                    </div>
                    <i class="ph ph-arrow-right search-result-go"></i>
                </div>
            `).join('');
            resultsEl.querySelectorAll('.search-result-item').forEach(el => {
                el.onclick = () => {
                    const pid = el.getAttribute('data-pid');
                    close();
                    this.setState({ currentView: 'detail', activeProjectId: pid });
                };
            });
        };

        let debounce = null;
        input.oninput = () => { clearTimeout(debounce); const v = input.value; debounce = setTimeout(() => renderResults(v), 120); };
        input.onkeydown = (e) => { if (e.key === 'Escape') close(); };

        // '/' 단축키로 검색 열기 (리스너 1회만 등록)
        if (!window.__BHAS_SEARCH_HOTKEY__) {
            window.__BHAS_SEARCH_HOTKEY__ = true;
            document.addEventListener('keydown', (e) => {
                const tag = (document.activeElement && document.activeElement.tagName) || '';
                if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
                    const ov = document.getElementById('global-search-overlay');
                    const ob = document.getElementById('open-search-btn');
                    if (ov && ov.style.display !== 'flex' && ob) { e.preventDefault(); ob.click(); }
                }
            });
        }
    }

    // ============================================================
    //  거래처 물품 현황 (동대문 공장 등) + 지도(Leaflet)
    // ============================================================
    _vesc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
    _vendorCatColor(c){ return ({ '봉제':'#3b82f6','원단':'#8b5cf6','부자재':'#f59e0b','프린트':'#10b981' })[c] || '#64748b'; }

    async loadVendors() {
        this._vendorsLoading = true;
        try {
            // 작업은 진행 중 + 최근 끝난 것만. 전부 긁으면 몇 천 줄이 온다.
            const since = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
            const [vRes, jRes] = await Promise.all([
                this.supabase.from('vendors').select('*').order('name', { ascending: true }).limit(300),
                this.supabase.from('vendor_jobs').select('*')
                    .or(`status.neq.done,due_date.gte.${since},due_date.is.null`)
                    .order('due_date', { ascending: true }).limit(600)
            ]);
            const byVendor = {};
            (jRes.data || []).forEach(j => { (byVendor[j.vendor_id] = byVendor[j.vendor_id] || []).push(j); });
            this.vendors = (vRes.data || []).map(v => ({ ...v, jobs: byVendor[v.id] || [] }));
            this._vendorsLoaded = true;
        } catch (e) {
            this.showToast('생산처를 불러오지 못했습니다. (007_vendors.sql 설치 필요)');
            this.vendors = []; this._vendorsLoaded = true;
        }
        this._vendorsLoading = false;
        this.requestRender();
    }

    renderVendors() {
        if (!this._vendorsLoaded) return this._loadingSkeleton('생산처');
        const esc = s => this._vesc(s);
        const all = this.vendors || [];
        const cat = this.venCat || 'ALL';
        const q = (this.venQ || '').trim().toLowerCase();
        let list = all;
        if (cat !== 'ALL') list = list.filter(v => (v.category || '기타') === cat);
        if (q) list = list.filter(v => [v.name, v.address, v.phone].some(x => String(x || '').toLowerCase().includes(q)));

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dday = d => { if (!d) return null; const t = new Date(d); t.setHours(0, 0, 0, 0); return Math.round((t - today) / 86400000); };
        const actOf = v => (v.jobs || []).filter(j => j.status !== 'done');
        const soonOf = v => actOf(v).map(j => dday(j.due_date)).filter(x => x !== null).sort((a, b) => a - b)[0];

        list = this._applyTbl('vendors', list, (v, k2) => ({
            name: v.name || '', address: v.address || '', phone: v.phone || '',
            act: actOf(v).length, soon: (soonOf(v) === undefined ? '' : String(soonOf(v))),
        })[k2] ?? '', all);
        const row = v => {
            const act = actOf(v), s2 = soonOf(v);
            const late = s2 !== undefined && s2 < 0;
            return `<tr class="it-row${String(this.venSel) === String(v.id) ? ' on' : ''}" data-id="${v.id}"
                onclick="app.selectVendor('${v.id}')">
                <td class="bd">${esc(v.name || '')}</td>
                <td>${esc(v.address || '')}</td>
                <td class="nw">${esc(v.phone || '')}</td>
                <td class="num">${act.length || ''}</td>
                <td class="nw">${s2 === undefined ? '' : `<span style="color:${late ? '#ff453a' : (s2 <= 3 ? '#ff9f0a' : 'var(--text-muted)')};font-weight:${late ? 800 : 600}">${late ? `지연 ${-s2}일` : (s2 === 0 ? '오늘' : `D-${s2}`)}</span>`}</td>
            </tr>`;
        };

        return `<div class="mp">
            ${this._mpTop(cat === 'ALL' ? '생산현황' : cat, `생산처 ${list.length} · 진행중 물품 ${list.reduce((n, v) => n + actOf(v).length, 0)}`, `
                <div class="mp-find"><i class="ph ph-magnifying-glass"></i>
                    <input value="${esc(this.venQ || '')}" placeholder="상호·주소·전화" oninput="app.venFind(this.value)"></div>
                <button class="mbtn" onclick="app.toggleVenMap()">${this.venMap ? '지도 접기' : '지도 보기'}</button>
                <button class="mbtn pri" onclick="app.selectVendor(null,1)"><i class="ph ph-plus"></i> 생산처 등록</button>`)}
            ${this.venMap ? `<div id="vendor-map" class="ven-map"></div>` : ''}
            <div class="it-scroll">
                <table class="it-tbl"><thead><tr>
                    ${this._thead('vendors', [['name', '상호'], ['address', '주소'], ['phone', '전화'],
                        ['act', '진행', 'num'], ['soon', '가장 가까운 납기']])}
                </tr></thead>
                <tbody>${list.length ? list.map(row).join('')
                    : `<tr><td colspan="5" class="it-none">${all.length ? '조건에 맞는 생산처가 없습니다' : '등록된 생산처가 없습니다 — 위 [생산처 등록]'}</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
    }
    venFind(v) { this.venQ = v; clearTimeout(this._venT); this._venT = setTimeout(() => this.requestRender(), 180); }
    toggleVenMap() { this.venMap = !this.venMap; this.requestRender(); }
    //  바탕화면 할 일에서 생산 작업을 누르면 그 생산처를 골라서 연다
    goVendorJob(vid) {
        this.venCat = 'ALL'; this.venQ = ''; this.venSel = vid; this.venEdit = false;
        if (this.macMode) this.macOpen('vendors'); else this.switchView('vendors');
        this.requestRender();
    }
    //  고르면 오른쪽 칸에서 바로 고친다 — 팝업을 띄우지 않는다
    selectVendor(id, isNew) {
        this.venSel = isNew ? '__new' : id;
        this.venEdit = !!isNew;
        this._vendorPick = null;
        if (id) { const v = (this.vendors || []).find(x => String(x.id) === String(id));
            if (v && v.lat && v.lng) this._vendorPick = { lat: v.lat, lng: v.lng }; }
        this.requestRender();
    }
    toggleVenEdit() { this.venEdit = !this.venEdit; this.requestRender(); }

    bindVendorsEvents() {
        const addBtn = document.getElementById('vendor-add-btn');
        if (addBtn) addBtn.onclick = () => this.showVendorModal();
        this.appContainer.querySelectorAll('.vendor-edit').forEach(b => b.onclick = () => this.showVendorModal(b.dataset.id));
        this.appContainer.querySelectorAll('.vjob-add').forEach(b => b.onclick = () => this.showJobModal(b.dataset.id));
        this.appContainer.querySelectorAll('.vjob-toggle').forEach(b => b.onclick = () => this.toggleJob(b.dataset.id));
        this.appContainer.querySelectorAll('.vjob-qc').forEach(b => b.onclick = () => this.showQcModal(b.dataset.id));
        this.appContainer.querySelectorAll('.vjob-del').forEach(b => b.onclick = () => this.deleteJob(b.dataset.id));
        this.initVendorMap();
    }

    initVendorMap() {
        if (typeof L === 'undefined') return;
        const el = document.getElementById('vendor-map');
        if (!el || el._leaflet_id) return;
        const DONGDAEMUN = [37.5686, 127.0093];
        const pts = (this.vendors||[]).filter(v => v.lat && v.lng);
        const map = L.map(el, { scrollWheelZoom: false }).setView(pts.length ? [pts[0].lat, pts[0].lng] : DONGDAEMUN, pts.length ? 14 : 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
        const group = [];
        pts.forEach(v => {
            const actN = (v.jobs||[]).filter(j=>j.status!=='done').length;
            const m = L.marker([v.lat, v.lng]).addTo(map);
            m.bindPopup(`<b>${this._vesc(v.name)}</b><br>${this._vesc(v.category)} · 진행 ${actN}건<br>${this._vesc(v.address||'')}`);
            group.push([v.lat, v.lng]);
        });
        if (group.length > 1) { try { map.fitBounds(group, { padding: [40,40], maxZoom: 16 }); } catch(e){} }
        this._vendorMap = map;
        setTimeout(() => { try { map.invalidateSize(); } catch(e){} }, 120);
    }

    // ── 뉴스 (분류 / 목록 / 상세) ─────────────────────────────
    //  바깥에서 보는 기준을 모은다. 수집은 서버(Actions)가 하고 여기선 읽기만 한다.
    async loadNews() {
        this._newsLoading = true;
        try {
            const [items, comps, snaps] = await Promise.all([
                this.supabase.from('news_items').select('*').order('published_at', { ascending: false, nullsFirst: false }).limit(400),
                this.supabase.from('competitors').select('*').order('name'),
                this.supabase.from('competitor_snapshots').select('*').order('snap_date', { ascending: false }).limit(600),
            ]);
            this.newsItems = items.data || [];
            this.competitors = comps.data || [];
            this.compSnaps = snaps.data || [];
            this._newsLoaded = true;
        } catch (e) {
            this.newsItems = []; this.competitors = []; this.compSnaps = []; this._newsLoaded = true;
            this.showToast('뉴스를 불러오지 못했습니다 (039_news.sql 실행 필요)');
        }
        this._newsLoading = false; this.requestRender();
    }
    renderNews() {
        if (!this._newsLoaded) return this._loadingSkeleton('뉴스');
        const esc = s => this._vesc(s);
        const items = this.newsItems || [];
        const comps = this.competitors || [];
        const n_ = (k) => items.filter(i => k === 'trend' ? (i.kind === 'trend' || i.kind === 'news') : i.kind === (k === 'competitor' ? 'competitor_post' : 'review')).length;
        //  빈 칸을 먼저 보여주지 않는다 — 들어온 게 있는 칸으로 연다
        const cur = this.newsTab || ['competitor', 'review', 'trend'].find(k => n_(k)) || 'competitor';
        const q = (this.newsQ || '').trim().toLowerCase();
        const SRC = { naver_blog: '네이버 블로그', naver_cafe: '네이버 카페', naver_news: '네이버 뉴스',
                      google: '구글', google_news: '구글 뉴스', instagram: '인스타그램', datalab: '데이터랩' };
        const when = t => t ? new Date(t).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '';
        const brandOf = id => (mockData.brands || []).find(b => b.id === id)?.name || '';

        let list;
        if (cur === 'competitor') list = items.filter(i => i.kind === 'competitor_post');
        else if (cur === 'review') list = items.filter(i => i.kind === 'review');
        else list = items.filter(i => i.kind === 'trend' || i.kind === 'news');
        if (q) list = list.filter(i => [i.title, i.snippet, i.author].some(x => String(x || '').toLowerCase().includes(q)));
        const sel = list.find(i => i.id === this.newsSel) || list[0];

        // 경쟁사 요약 (오늘·어제 스냅샷 견주기)
        const snapOf = (cid) => (this.compSnaps || []).filter(s => s.competitor_id === cid);
        const compCard = (c) => {
            const sn = snapOf(c.id);
            const now = sn[0], prev = sn[1];
            const d = (now && prev && now.followers != null && prev.followers != null) ? now.followers - prev.followers : null;
            return `<div class="nw-comp">
                <div class="nw-cn">${esc(c.name)}<em>@${esc(c.handle)}</em></div>
                <div class="nw-cs">
                    <span>팔로워 <b>${now?.followers != null ? now.followers.toLocaleString('ko-KR') : '-'}</b>
                        ${d != null ? `<i class="${d >= 0 ? 'up' : 'dn'}">${d >= 0 ? '+' : ''}${d}</i>` : ''}</span>
                    <span>글 <b>${now?.media_count ?? '-'}</b>${now?.posts_delta ? ` <i class="up">+${now.posts_delta}</i>` : ''}</span>
                    <span>평균 ♥ <b>${now?.avg_likes != null ? Math.round(now.avg_likes) : '-'}</b></span>
                </div></div>`;
        };

        const side = (k, label, icon, n) => `<div class="m3-s${cur === k ? ' on' : ''}" onclick="app.setNewsTab('${k}')">
            <i class="ph ${icon}" style="color:#e0294f"></i><span>${esc(label)}</span><em>${n}</em></div>`;

        return `
        <div class="m3 wide">
            <aside class="m3-side">
                <div class="m3-h">뉴스</div>
                ${side('competitor', '경쟁사 소식', 'ph-users-three', n_('competitor'))}
                ${side('review', '우리 후기', 'ph-chat-circle-text', n_('review'))}
                ${side('trend', '업계 뉴스', 'ph-trend-up', n_('trend'))}
                <div class="m3-h">지켜보는 곳
                    <button class="nt-add" title="경쟁사 추가" onclick="app.addCompetitor()">＋</button></div>
                ${comps.length ? comps.map(c => `<div class="m3-s" oncontextmenu="app.compMenu(event,'${c.id}')">
                    <i class="ph ph-instagram-logo" style="color:#c13584"></i><span>${esc(c.name)}</span></div>`).join('')
                  : '<div style="padding:6px 10px;font-size:12px;color:var(--text-muted)">＋로 경쟁사를 넣으세요</div>'}
            </aside>
            <section class="m3-list">
                <div class="m3-lbar"><div><b>${cur === 'competitor' ? '경쟁사 소식' : (cur === 'review' ? '우리 후기' : '업계 뉴스')}</b>
                    <span>${list.length}건</span></div></div>
                <div class="m3-find"><i class="ph ph-magnifying-glass"></i>
                    <input placeholder="찾기" value="${esc(this.newsQ || '')}" oninput="app.newsQ=this.value;app.requestRender()"></div>
                <div class="m3-rows">
                    ${cur === 'competitor' && comps.length ? `<div class="nw-comps">${comps.map(compCard).join('')}</div>` : ''}
                    ${list.map(i => `<div class="m3-r${sel && i.id === sel.id ? ' on' : ''}" onclick="app.selectNews('${i.id}')">
                        <b>${esc(i.title || '제목 없음')}</b>
                        <div class="sub"><span>${esc(SRC[i.source] || i.source)}</span>
                            <span>${esc(when(i.published_at))}</span>
                            ${i.brand_id ? `<span>${esc(brandOf(i.brand_id))}</span>` : ''}</div>
                    </div>`).join('') || `<div class="m3-none">${q ? '찾는 글이 없습니다' : '아직 모인 게 없습니다 · 수집이 돌면 채워집니다'}</div>`}
                </div>
            </section>
            <section class="m3-doc">
                ${sel ? `
                <div class="m3-tools">
                    ${sel.url && !String(sel.url).startsWith('datalab:')
                        ? `<a class="mbtn pri" href="${esc(sel.url)}" target="_blank" rel="noopener" style="text-decoration:none">원문 열기</a>` : ''}
                    <span class="sp"></span>
                    <span class="nt-scope">${esc(SRC[sel.source] || sel.source)}</span>
                </div>
                <div class="m3-page">
                    ${sel.thumb ? `<img class="nw-th" src="${esc(sel.thumb)}" alt="">` : ''}
                    <h2 class="m3-big">${esc(sel.title || '제목 없음')}</h2>
                    <div class="m3-sub">${esc(sel.author || '')}${sel.published_at ? ' · ' + esc(new Date(sel.published_at).toLocaleDateString('ko-KR')) : ''}</div>
                    ${sel.score != null ? `<div class="nw-score">지수 <b>${esc(String(sel.score))}</b>${sel.snippet ? ` · ${esc(sel.snippet)}` : ''}</div>` : ''}
                    ${sel.kind === 'trend' && sel.meta && sel.meta.series ? `<div class="nw-spark">
                        ${(() => { const d = sel.meta.series, mx = Math.max(1, ...d.map(x => x.ratio));
                            return d.map(x => `<i style="height:${Math.max(3, x.ratio / mx * 60)}px" title="${esc(x.period)} · ${x.ratio}"></i>`).join(''); })()}
                    </div>` : ''}
                    ${sel.snippet && sel.score == null ? `<p class="nw-body">${esc(sel.snippet)}</p>` : ''}
                    ${sel.meta && sel.meta.likes != null ? `<div class="m3-f"><i class="ph ph-heart"></i><span class="k">반응</span>
                        <span class="v">♥ ${esc(String(sel.meta.likes))} · 댓글 ${esc(String(sel.meta.comments ?? 0))}</span></div>` : ''}
                </div>` : `<div class="m3-none mid">왼쪽에서 글을 고르세요</div>`}
            </section>
        </div>`;
    }
    setNewsTab(k) { this.newsTab = k; this.newsSel = null; this.requestRender(); }
    selectNews(id) { this.newsSel = id; this.requestRender(); }
    async addCompetitor() {
        const handle = await this.showPrompt('인스타 핸들 (@ 없이)'); if (!handle || !handle.trim()) return;
        const name = await this.showPrompt('보여줄 이름', handle.trim()) || handle.trim();
        try {
            const { data, error } = await this.supabase.from('competitors')
                .insert([{ handle: handle.trim().replace(/^@/, ''), name: name.trim() }]).select('*').single();
            if (error) throw error;
            this.competitors = [...(this.competitors || []), data];
            this.requestRender();
            this.showToast('넣었습니다 · 다음 수집(매일 07:30)부터 지표가 쌓입니다');
        } catch (e) { this.showToast('추가 실패: ' + (e.message || e)); }
    }
    compMenu(ev, id) {
        const c = (this.competitors || []).find(x => x.id === id); if (!c) return;
        this.ctxMenu(ev, [
            { t: '인스타 열기', icon: 'ph-instagram-logo', run: () => window.open(`https://instagram.com/${c.handle}`, '_blank') },
            { t: '이름 바꾸기', icon: 'ph-textbox', run: () => this.renameCompetitor(id) },
            { sep: true },
            { t: '빼기', icon: 'ph-trash', danger: true, run: () => this.delCompetitor(id) },
        ]);
    }
    async renameCompetitor(id) {
        const c = (this.competitors || []).find(x => x.id === id); if (!c) return;
        const v = await this.showPrompt('이름', c.name); if (v === null || !v.trim()) return;
        c.name = v.trim(); this.requestRender();
        try { await this.supabase.from('competitors').update({ name: c.name }).eq('id', id); }
        catch (e) { this.showToast('실패: ' + (e.message || e)); }
    }
    async delCompetitor(id) {
        if (!await this.showConfirm('이 경쟁사를 뺄까요? 쌓인 지표도 같이 지워집니다.', '삭제')) return;
        try {
            const { error } = await this.supabase.from('competitors').delete().eq('id', id);
            if (error) throw error;
            this.competitors = (this.competitors || []).filter(x => x.id !== id);
            this.requestRender();
        } catch (e) { this.showToast('삭제 실패: ' + (e.message || e)); }
    }
    // ── 연락처 (분류 / 리스트 / 페이지) ───────────────────────
    renderContacts() {
        const esc = s => this._vesc(s);
        if (!this._vendorsLoaded) return this._loadingSkeleton('연락처');
        const q = (this.contactQ || '').trim().toLowerCase();
        const cats = ['봉제', '원단', '부자재', '프린트', '기타'];
        const cur = this.contactCat || '전체';
        const all = (this.vendors || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
        let list = all;
        if (cur !== '전체') list = list.filter(v => (v.category || '기타') === cur);
        if (q) list = list.filter(v => [v.name, v.phone, v.address, v.ceo_name, v.biz_no, v.memo]
            .some(x => String(x || '').toLowerCase().includes(q)));
        const sel = list.find(v => v.id === this.contactSel) || list[0];
        const cnt = c => all.filter(v => (v.category || '기타') === c).length;
        const tel = p => String(p || '').replace(/[^0-9+]/g, '');
        const initial = n => (String(n || '?').trim()[0] || '?');
        const side = (key, label, icon, n) => `<div class="m3-s${cur === key ? ' on' : ''}"
            onclick="app.setContactCat('${key}')"><i class="ph ${icon}" style="color:#0a84ff"></i><span>${esc(label)}</span><em>${n}</em></div>`;
        const f = (icon, k, v, href) => v ? `<div class="m3-f"><i class="ph ${icon}"></i><span class="k">${esc(k)}</span>
            <span class="v">${href ? `<a href="${esc(href)}" style="color:var(--primary);text-decoration:none">${esc(v)}</a>` : esc(v)}</span></div>` : '';
        return `
        <div class="m3">
            <aside class="m3-side">
                <div class="m3-h">분류</div>
                ${side('전체', '모든 연락처', 'ph-address-book', all.length)}
                ${cats.map(c => side(c, c, 'ph-folder-simple', cnt(c))).join('')}
            </aside>
            <section class="m3-list">
                <div class="m3-lbar"><div><b>${esc(cur === '전체' ? '모든 연락처' : cur)}</b><span>${list.length}곳</span></div>
                    <button class="m3-new" onclick="app.newContact()" title="새 연락처"><i class="ph ph-plus"></i></button></div>
                <div class="m3-find"><i class="ph ph-magnifying-glass"></i>
                    <input placeholder="상호·전화·주소" value="${esc(this.contactQ || '')}" oninput="app.contactQ=this.value;app.requestRender()"></div>
                <div class="m3-rows">
                    ${list.map(v => `<div class="m3-r${sel && v.id === sel.id ? ' on' : ''}" onclick="app.selectContact('${v.id}')"
                            oncontextmenu="app.contactMenu(event,'${v.id}')">
                        <b><span class="ct-face" style="width:22px;height:22px;font-size:11px">${esc(initial(v.name))}</span>${esc(v.name)}</b>
                        <div class="sub">${cur === '전체' ? `<span>${esc(v.category || '기타')}</span>` : ''}<span>${esc(v.phone || v.address || '')}</span></div>
                    </div>`).join('') || `<div class="m3-none">${q || cur !== '전체' ? '찾는 연락처가 없습니다' : '등록된 연락처가 없습니다'}</div>`}
                </div>
            </section>
            <section class="m3-doc">
                ${sel ? `
                <div class="m3-tools">
                    ${sel.phone ? `<a class="mbtn" href="tel:${esc(tel(sel.phone))}" style="text-decoration:none"><i class="ph ph-phone"></i> 전화</a>` : ''}
                    ${sel.email ? `<a class="mbtn" href="mailto:${esc(sel.email)}" style="text-decoration:none"><i class="ph ph-envelope-simple"></i> 메일</a>` : ''}
                    <span class="sp"></span>
                    <button class="${this.contactEdit ? 'on' : ''}" onclick="app.toggleContactEdit()" title="고치기"><i class="ph ph-pencil-simple"></i></button>
                </div>
                <div class="m3-page">
                    ${(this.contactEdit || this.contactNew) ? `
                    <h2 class="m3-big">${this.contactNew ? '새 연락처' : esc(sel.name)}</h2>
                    <div class="m3-sub">${this.contactNew ? '빈칸은 비워 둬도 됩니다' : '고치는 중'}</div>
                    <div class="fi-r"><span>상호</span><input id="vd-name" class="nw-f" value="${this.contactNew ? '' : esc(sel.name || '')}"></div>
                    <div class="fi-r"><span>분류</span><select id="vd-cat" class="nw-f">
                        ${cats.map(k => `<option value="${k}"${(!this.contactNew && sel.category === k) ? ' selected' : ''}>${k}</option>`).join('')}</select></div>
                    <div class="fi-r"><span>전화</span><input id="vd-phone" class="nw-f" value="${this.contactNew ? '' : esc(sel.phone || '')}"></div>
                    <div class="fi-r"><span>주소</span><input id="vd-addr" class="nw-f" value="${this.contactNew ? '' : esc(sel.address || '')}"></div>
                    <div class="fi-r"><span>사업자</span><input id="vd-biz" class="nw-f" value="${this.contactNew ? '' : esc(sel.biz_no || '')}"></div>
                    <div class="m3-f" style="flex-direction:column;align-items:stretch">
                        <span class="k" style="width:auto;margin-bottom:5px">메모</span>
                        <textarea id="vd-memo" class="dt-ta">${this.contactNew ? '' : esc(sel.memo || '')}</textarea></div>
                    <div class="fi-act">
                        <button class="mbtn" onclick="app.cancelContactEdit()">취소</button>
                        <button class="mbtn pri" onclick="app.saveVendor('${this.contactNew ? '' : sel.id}')">저장</button>
                    </div>` : `
                    <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
                        <span class="ct-face" style="width:54px;height:54px;font-size:22px">${esc(initial(sel.name))}</span>
                        <div><h2 class="m3-big">${esc(sel.name)}</h2>
                            <div class="m3-sub" style="margin:0">${esc(sel.category || '기타')}</div></div>
                    </div>
                    ${f('ph-phone', '전화', sel.phone, sel.phone ? 'tel:' + tel(sel.phone) : null)}
                    ${f('ph-envelope-simple', '메일', sel.email, sel.email ? 'mailto:' + sel.email : null)}
                    ${f('ph-map-pin', '주소', sel.address)}
                    ${f('ph-user', '대표자', sel.ceo_name)}
                    ${f('ph-identification-card', '사업자번호', sel.biz_no)}
                    ${f('ph-note', '메모', sel.memo)}
                    ${(() => {
                        const jobs = (sel.jobs || []).filter(j => j.status !== 'done');
                        return jobs.length ? `<div class="m3-f" style="flex-direction:column;align-items:stretch">
                            <div style="font-size:11.5px;font-weight:700;color:var(--text-muted);margin-bottom:6px">진행 중 ${jobs.length}건</div>
                            ${jobs.slice(0, 6).map(j => `<div style="display:flex;justify-content:space-between;gap:10px;padding:3px 0">
                                <span>${esc(j.title)}</span><span style="color:var(--text-muted)">${esc(j.due_date || '')}</span></div>`).join('')}
                        </div>` : '';
                    })()}`}
                </div>` : `<div class="m3-none mid">왼쪽에서 연락처를 고르세요</div>`}
            </section>
        </div>`;
    }
    // 메모 사이드바의 시즌 ＋ — 기존 시즌 만들기 창을 그대로 띄운다
    newProjectFromNotes() { this.showProjectModal(); }
    //  브랜드 줄의 ＋ — 그 브랜드로 시즌을 만든다
    newSeasonIn(brandId) { this.showProjectModal(brandId); }
    toggleBrandSeasons(brandId) {
        this.noteBrandOpen = this.noteBrandOpen || {};
        this.noteBrandOpen[brandId] = !this.noteBrandOpen[brandId];
        this.requestRender();
    }
    //  브랜드 아래 시즌을 고르면 그 폴더 + 그 시즌으로 걸러 본다
    pickBrandSeason(folderKey, seaId) {
        this.noteFolder = folderKey; this.noteSea = String(seaId); this.noteSel = null; this.requestRender();
    }
    toggleContactEdit() { this.contactEdit = !this.contactEdit; this.contactNew = false; this.requestRender(); }
    newContact() { this.contactNew = true; this.contactEdit = false; this._vendorPick = null; this.requestRender(); }
    cancelContactEdit() { this.contactEdit = false; this.contactNew = false; this.requestRender(); }
    setContactCat(c) { this.contactCat = c; this.contactSel = null; this.requestRender(); }
    selectContact(id) { this.contactSel = id; this.requestRender(); }
    contactMenu(ev, id) {
        const v = (this.vendors || []).find(x => x.id === id); if (!v) return;
        this.ctxMenu(ev, [
            { t: '보기', icon: 'ph-arrow-square-out', run: () => this.selectContact(id) },
            { t: '이름 바꾸기', icon: 'ph-textbox', run: () => this.renameVendor(id) },
            { t: '고치기', icon: 'ph-pencil-simple', run: () => { this.selectContact(id); this.contactEdit = true; this.contactNew = false; this.requestRender(); } },
            ...(v.phone ? [{ t: '전화 걸기', icon: 'ph-phone', run: () => { location.href = 'tel:' + String(v.phone).replace(/[^0-9+]/g, ''); } }] : []),
            ...(v.phone ? [{ t: '번호 복사', icon: 'ph-copy', run: () => { navigator.clipboard?.writeText(v.phone); this.showToast('번호를 복사했습니다'); } }] : []),
            { sep: true },
            { t: '삭제', icon: 'ph-trash', danger: true, run: () => this.deleteVendor(id) },
        ]);
    }
    async renameVendor(id) {
        const v = (this.vendors || []).find(x => x.id === id); if (!v) return;
        const nv = await this.showPrompt('상호', v.name || ''); if (nv === null || !nv.trim()) return;
        v.name = nv.trim(); this.requestRender();
        try {
            const { error } = await this.supabase.from('vendors').update({ name: v.name }).eq('id', id);
            if (error) throw error;
        } catch (e) { this.showToast('이름 바꾸기 실패: ' + (e.message || e)); }
    }
    showVendorModal(id) {
        const v = id ? (this.vendors||[]).find(x=>x.id===id) : null;
        this._vendorPick = (v && v.lat && v.lng) ? { lat:v.lat, lng:v.lng } : null;
        const cats = ['봉제','원단','부자재','프린트','기타'];
        const c = document.getElementById('global-modal-container');
        if (!c) return;
        c.innerHTML = `
        <div class="glass modal-content fade-in vmodal" style="width:92%;max-width:520px;padding:1.8rem;border-radius:20px;position:relative;max-height:90vh;overflow-y:auto">
            <h2 style="margin:0 0 1.3rem;font-size:1.2rem"><i class="ph ph-storefront"></i> ${v?'생산처 수정':'생산처 등록'}</h2>
            <div style="display:flex;flex-direction:column;gap:10px">
                <input id="vd-name" class="login-input" placeholder="상호 (예: 성수봉제)" value="${v?this._vesc(v.name):''}">
                <select id="vd-cat" class="login-input">${cats.map(k=>`<option value="${k}" ${v&&v.category===k?'selected':''}>${k}</option>`).join('')}</select>
                <input id="vd-addr" class="login-input" placeholder="주소" value="${v?this._vesc(v.address||''):''}">
                <div style="display:flex;gap:8px">
                    <input id="vd-phone" class="login-input" placeholder="전화번호" value="${v?this._vesc(v.phone||''):''}">
                    <input id="vd-biz" class="login-input" placeholder="사업자등록번호" value="${v?this._vesc(v.biz_no||''):''}">
                </div>
                <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px"><i class="ph ph-hand-tap"></i> 지도를 클릭해 위치를 찍으세요</div>
                <div id="vd-pickmap" style="height:200px;border-radius:12px;overflow:hidden;background:rgba(148,163,184,0.1);z-index:0"></div>
                <textarea id="vd-memo" class="login-input" placeholder="메모" style="min-height:52px;resize:vertical">${v?this._vesc(v.memo||''):''}</textarea>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1.4rem">
                <div>${v?`<button id="vd-delete" class="btn-secondary" style="padding:9px 14px;border-radius:10px;color:#ef4444">삭제</button>`:''}</div>
                <div style="display:flex;gap:8px">
                    <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 18px;border-radius:10px">취소</button>
                    <button id="vd-save" class="btn-primary" style="padding:9px 18px;border-radius:10px">저장</button>
                </div>
            </div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('vd-save').onclick = () => this.saveVendor(id);
        const delBtn = document.getElementById('vd-delete');
        if (delBtn) delBtn.onclick = () => this.deleteVendor(id);
        setTimeout(() => this._mountPickMap(), 60);
    }
    //  위치 찍는 지도 — 팝업이든 오른쪽 칸이든 #vd-pickmap 만 있으면 붙는다
    _mountPickMap() {
        if (typeof L === 'undefined') return;
        const el = document.getElementById('vd-pickmap');
        if (!el) return;
        //  한 번 붙다 만 자국이 남으면 다시 못 붙는다 — 지도가 실제로 없으면 자국을 지운다
        if (el._leaflet_id && !el.classList.contains('leaflet-container')) { delete el._leaflet_id; }
        if (el._leaflet_id) return;
        if (!el.offsetHeight) { setTimeout(() => this._mountPickMap(), 120); return; }
        const start = this._vendorPick ? [this._vendorPick.lat, this._vendorPick.lng] : [37.5686, 127.0093];
        const map = L.map(el).setView(start, 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
        let marker = this._vendorPick ? L.marker(start).addTo(map) : null;
        map.on('click', (e) => {
            this._vendorPick = { lat: e.latlng.lat, lng: e.latlng.lng };
            if (marker) marker.setLatLng(e.latlng); else marker = L.marker(e.latlng).addTo(map);
        });
        setTimeout(() => { try { map.invalidateSize(); } catch (_e) {} }, 80);
    }

    async saveVendor(id) {
        const name = (document.getElementById('vd-name') || {}).value?.trim();
        if (!name) { this.showToast('상호는 필수입니다.'); return; }
        const row = {
            name,
            category: document.getElementById('vd-cat').value,
            address: document.getElementById('vd-addr').value.trim() || null,
            phone: document.getElementById('vd-phone').value.trim() || null,
            biz_no: document.getElementById('vd-biz').value.trim() || null,
            memo: document.getElementById('vd-memo').value.trim() || null,
            lat: this._vendorPick ? this._vendorPick.lat : null,
            lng: this._vendorPick ? this._vendorPick.lng : null,
        };
        let error;
        if (id) ({ error } = await this.supabase.from('vendors').update(row).eq('id', id));
        else ({ error } = await this.supabase.from('vendors').insert([row]));
        if (error) { this.showToast('저장 실패: ' + error.message); return; }
        this.closeGlobalModal();
        this.venEdit = false; this.contactEdit = false; this.contactNew = false;
        await this.loadVendors();
        if (!id) { const made = (this.vendors || []).find(x => x.name === name); if (made) this.venSel = made.id; }
        this.showToast('저장되었습니다.');
    }

    async deleteVendor(id) {
        if (!await this.showConfirm('이 생산처와 물품 현황을 모두 삭제할까요?', '삭제')) return;
        const { error } = await this.supabase.from('vendors').delete().eq('id', id);
        if (error) { this.showToast('삭제 실패: ' + error.message); return; }
        this.closeGlobalModal();
        await this.loadVendors();
    }

    async showJobModal(vendorId) {
        await this.ensureTechPacks();
        const c = document.getElementById('global-modal-container');
        if (!c) return;
        c.innerHTML = `
        <div class="glass modal-content fade-in vmodal" style="width:92%;max-width:440px;padding:1.8rem;border-radius:20px;position:relative">
            <h2 style="margin:0 0 1.3rem;font-size:1.15rem"><i class="ph ph-package"></i> 물품 추가</h2>
            <div style="display:flex;flex-direction:column;gap:10px">
                <input id="vj-title" class="login-input" placeholder="품목/작업명 (예: 여름 로고 티)">
                <div style="display:flex;gap:8px">
                    <input id="vj-stage" class="login-input" placeholder="단계 (예: 봉제)" value="진행중">
                    <input id="vj-qty" type="number" class="login-input" placeholder="수량">
                </div>
                <label style="font-size:0.8rem;color:var(--text-muted)">작업지시서 연결 <span style="color:#ef4444">*필수</span> <span style="color:var(--primary)">(검수 체크리스트 자동생성)</span></label>
                <select id="vj-pack" class="login-input"><option value="">— 작업지시서를 선택하세요 —</option>${(this._techPacks || []).map(t => `<option value="${t.id}">${this._vesc(t.style_name)}${t.style_no ? ` (${t.style_no})` : ''}</option>`).join('')}</select>
                <label style="font-size:0.8rem;color:var(--text-muted)">마감(스케줄)</label>
                <input id="vj-due" type="date" class="login-input">
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:1.4rem">
                <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 18px;border-radius:10px">취소</button>
                <button id="vj-save" class="btn-primary" style="padding:9px 18px;border-radius:10px">추가</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('vj-save').onclick = () => this.saveJob(vendorId);
    }

    async saveJob(vendorId) {
        const title = document.getElementById('vj-title').value.trim();
        if (!title) { this.showToast('품목명은 필수입니다.'); return; }
        const qtyRaw = document.getElementById('vj-qty').value;
        const packId = (document.getElementById('vj-pack') && document.getElementById('vj-pack').value) || null;
        if (!packId) { this.showToast('작업지시서를 반드시 연결해야 생산 물품을 등록할 수 있습니다.'); return; }
        const row = {
            vendor_id: vendorId,
            title,
            stage: document.getElementById('vj-stage').value.trim() || '진행중',
            qty: qtyRaw ? parseInt(qtyRaw,10) : null,
            due_date: document.getElementById('vj-due').value || null,
            tech_pack_id: packId,
        };
        const { error } = await this.supabase.from('vendor_jobs').insert([row]);
        if (error) { this.showToast('추가 실패: ' + error.message); return; }
        this.closeGlobalModal();
        await this.loadVendors();
    }

    async toggleJob(id) {
        const job = (this.vendors||[]).flatMap(v=>v.jobs||[]).find(j=>j.id===id);
        if (!job) return;
        const { error } = await this.supabase.from('vendor_jobs').update({ status: job.status==='done'?'active':'done' }).eq('id', id);
        if (error) { this.showToast('변경 실패: ' + error.message); return; }
        await this.loadVendors();
    }

    async deleteJob(id) {
        const { error } = await this.supabase.from('vendor_jobs').delete().eq('id', id);
        if (error) { this.showToast('삭제 실패: ' + error.message); return; }
        await this.loadVendors();
    }

    // ============================================================
    //  출고 검수(QC) + 카카오퀵 게이트  — 완성 사진 + 작업지시서 대조 후에만 퀵 호출
    // ============================================================
    _defaultQcChecklist(job) {
        return [
            { label: '자수 — 위치·색상·크기 작업지시서 대조', checked: false },
            { label: '프린트/전사 — 위치·색상 확인', checked: false },
            { label: '절개·배색 — 지시서와 동일', checked: false },
            { label: '라벨(메인/케어) 부착', checked: false },
            { label: `수량 확인${job.qty ? ` (${job.qty}장)` : ''}`, checked: false },
            { label: '오염·봉제 불량 검수', checked: false },
            { label: '포장 상태', checked: false },
        ];
    }

    _readImageCompressed(file, maxW = 1200, q = 0.75) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const scale = Math.min(1, maxW / img.width);
                    const cv = document.createElement('canvas');
                    cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
                    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
                    try { resolve(cv.toDataURL('image/jpeg', q)); } catch (e) { resolve(reader.result); }
                };
                img.onerror = () => resolve(reader.result);
                img.src = reader.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async showQcModal(jobId) {
        await this.ensureTechPacks();
        const job = (this.vendors || []).flatMap(v => v.jobs || []).find(j => j.id === jobId);
        if (!job) return;
        const vendor = (this.vendors || []).find(v => (v.jobs || []).some(j => j.id === jobId));
        const pack = job.tech_pack_id ? (this._techPacks || []).find(t => t.id === job.tech_pack_id) : null;
        const saved = (Array.isArray(job.qc_checklist) && job.qc_checklist.length) ? job.qc_checklist.map(x => ({ ...x })) : null;
        this._qcDraft = {
            jobId,
            packId: job.tech_pack_id || null,
            checklist: saved || (pack && pack.config ? this._qcFromConfig(pack.config, job) : this._defaultQcChecklist(job)),
            photos: Array.isArray(job.qc_photos) ? job.qc_photos.slice() : [],
            quick: job.quick_status || null,
            vendorName: vendor ? vendor.name : '',
            title: job.title, qty: job.qty,
            showSpec: false,
        };
        const c = document.getElementById('global-modal-container');
        if (!c) return;
        c.style.display = 'flex';
        this._renderQcModal();
    }

    _renderQcModal() {
        const d = this._qcDraft; if (!d) return;
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const allChecked = d.checklist.every(x => x.checked);
        const hasPhoto = d.photos.length >= 1;
        const hasPack = !!d.packId;
        const passed = hasPack && allChecked && hasPhoto;
        c.innerHTML = `
        <div class="glass modal-content fade-in vmodal" style="width:94%;max-width:560px;padding:1.6rem;border-radius:20px;position:relative;max-height:92vh;overflow-y:auto">
            <h2 style="margin:0 0 0.3rem;font-size:1.15rem"><i class="ph ph-clipboard-text"></i> 출고 검수 · 카카오퀵</h2>
            <p style="margin:0 0 1.1rem;color:var(--text-muted);font-size:0.85rem">${this._vesc(d.vendorName)} · ${this._vesc(d.title)}${d.qty ? ` · ${d.qty}장` : ''}</p>

            <div style="font-size:0.82rem;font-weight:700;margin-bottom:6px">작업지시서 연결 <span style="font-weight:400;color:var(--text-muted)">— 연결하면 지시서 항목이 아래 체크리스트로 자동 반영</span></div>
            <div style="display:flex;gap:6px;margin-bottom:0.7rem;align-items:center">
                <select id="qc-pack" class="login-input" style="flex:1">
                    <option value="">— 연결 안 됨 (기본 체크리스트) —</option>
                    ${(this._techPacks || []).map(t => `<option value="${t.id}" ${d.packId === t.id ? 'selected' : ''}>${this._vesc(t.style_name)}${t.style_no ? ` (${t.style_no})` : ''}</option>`).join('')}
                </select>
                ${d.packId ? `<button id="qc-spec-toggle" class="btn-secondary" style="padding:8px 12px;border-radius:9px;white-space:nowrap">${d.showSpec ? '지시서 접기' : '지시서 보기'}</button>` : ''}
            </div>
            ${d.showSpec && d.packId ? `<div style="background:#fff;border-radius:12px;padding:10px;margin-bottom:1rem;max-height:300px;overflow:auto">${this._qcSpecHTML(d.packId)}</div>` : ''}

            <div style="font-size:0.82rem;font-weight:700;margin-bottom:6px">① 작업지시서 대조 체크리스트</div>
            <div style="display:flex;flex-direction:column;gap:2px;margin-bottom:0.8rem">
                ${d.checklist.map((x, i) => `
                    <label style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;background:rgba(148,163,184,0.07);cursor:pointer">
                        <input type="checkbox" class="qc-chk" data-i="${i}" ${x.checked ? 'checked' : ''} style="width:17px;height:17px;flex:0 0 auto;accent-color:#10b981">
                        <span style="font-size:0.86rem;${x.checked ? 'color:var(--text-muted)' : ''}">${this._vesc(x.label)}</span>
                    </label>`).join('')}
            </div>
            <div style="display:flex;gap:6px;margin-bottom:1.2rem">
                <input id="qc-add" class="login-input" placeholder="항목 추가 (예: 지퍼 확인)" style="flex:1">
                <button id="qc-add-btn" class="btn-secondary" style="padding:8px 14px;border-radius:9px">추가</button>
            </div>

            <div style="font-size:0.82rem;font-weight:700;margin-bottom:6px">② 완성 사진 <span style="color:#ef4444">*필수</span></div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                ${d.photos.map((p, i) => `<div style="position:relative;width:84px;height:84px;border-radius:10px;overflow:hidden;border:1px solid var(--card-border)"><img src="${p}" style="width:100%;height:100%;object-fit:cover"><button class="qc-photo-del" data-i="${i}" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);border:none;color:#fff;border-radius:6px;width:20px;height:20px;cursor:pointer;line-height:1;padding:0">×</button></div>`).join('')}
                <label style="width:84px;height:84px;border-radius:10px;border:1.5px dashed var(--card-border);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted)"><i class="ph ph-camera" style="font-size:1.4rem"></i><input type="file" accept="image/*" multiple class="qc-photo-input" hidden></label>
            </div>
            <p style="margin:0 0 1.2rem;font-size:0.78rem;color:var(--text-muted)">완성품 사진을 올리고 위 지시서 항목과 하나씩 대조하세요. 자수·프린트 누락이 여기서 걸립니다.</p>

            <div style="padding:12px 14px;border-radius:12px;background:${passed ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)'};border:1px solid ${passed ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)'};margin-bottom:1rem;font-size:0.85rem;color:${passed ? '#10b981' : '#ef4444'};font-weight:600">
                ${passed ? '<i class="ph ph-check-circle"></i> 검수 통과 — 출고 가능' : `<i class="ph ph-warning"></i> ${!hasPack ? '작업지시서 미연결' : ''}${(!hasPack && !allChecked) ? ' · ' : ''}${!allChecked ? '미확인 항목 있음' : ''}${((!hasPack || !allChecked) && !hasPhoto) ? ' · ' : ''}${!hasPhoto ? '완성 사진 없음' : ''}`}
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <button id="qc-save" class="btn-secondary" style="padding:9px 16px;border-radius:10px"><i class="ph ph-floppy-disk"></i> 검수 저장</button>
                <div style="display:flex;gap:8px">
                    <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 16px;border-radius:10px">닫기</button>
                    ${this.currentUser?.role === 'MASTER'
                    ? `<button id="qc-quick" ${passed ? '' : 'disabled'} style="padding:9px 18px;border-radius:10px;border:none;font-weight:700;${passed ? 'background:#FEE500;color:#191600;cursor:pointer' : 'background:rgba(148,163,184,0.2);color:var(--text-muted);cursor:not-allowed'}"><i class="ph ph-scooter"></i> 카카오퀵 호출</button>`
                    : `<button disabled title="퀵 예약은 실배송비가 발생해 대표 전용입니다" style="padding:9px 18px;border-radius:10px;border:none;font-weight:700;background:rgba(148,163,184,0.2);color:var(--text-muted);cursor:not-allowed"><i class="ph ph-lock-simple"></i> 카카오퀵 (대표 전용)</button>`}
                </div>
            </div>
            ${d.quick?.ok === true ? `<p style="margin:0.8rem 0 0;font-size:0.8rem;color:#10b981"><i class="ph ph-check"></i> 퀵 예약됨${d.quick.trackingNo ? ` · ${this._vesc(d.quick.trackingNo)}` : ''}</p>` : ''}
        </div>`;

        const packSel = document.getElementById('qc-pack');
        if (packSel) packSel.onchange = () => {
            d.packId = packSel.value || null;
            const pack = d.packId ? (this._techPacks || []).find(t => t.id === d.packId) : null;
            d.checklist = pack && pack.config ? this._qcFromConfig(pack.config, { qty: d.qty }) : this._defaultQcChecklist({ qty: d.qty });
            d.showSpec = !!d.packId;
            this._renderQcModal();
        };
        const specToggle = document.getElementById('qc-spec-toggle');
        if (specToggle) specToggle.onclick = () => { d.showSpec = !d.showSpec; this._renderQcModal(); };
        c.querySelectorAll('.qc-chk').forEach(cb => cb.onchange = () => { d.checklist[+cb.dataset.i].checked = cb.checked; this._renderQcModal(); });
        const addBtn = document.getElementById('qc-add-btn');
        if (addBtn) addBtn.onclick = () => { const inp = document.getElementById('qc-add'); const v = (inp.value || '').trim(); if (v) { d.checklist.push({ label: v, checked: false }); this._renderQcModal(); } };
        c.querySelectorAll('.qc-photo-del').forEach(b => b.onclick = () => { d.photos.splice(+b.dataset.i, 1); this._renderQcModal(); });
        const pin = c.querySelector('.qc-photo-input');
        if (pin) pin.onchange = async () => {
            const files = Array.from(pin.files || []);
            for (const f of files) { if (f.size > 12 * 1024 * 1024) { this.showToast('사진이 너무 큽니다.'); continue; } try { d.photos.push(await this._readImageCompressed(f)); } catch (e) { } }
            this._renderQcModal();
        };
        const saveB = document.getElementById('qc-save');
        if (saveB) saveB.onclick = () => this.saveQc();
        const quickB = document.getElementById('qc-quick');
        if (quickB && passed) quickB.onclick = () => this.callKakaoQuick();
    }

    async saveQc() {
        const d = this._qcDraft; if (!d) return;
        const passed = !!d.packId && d.checklist.every(x => x.checked) && d.photos.length >= 1;
        const patch = { qc_checklist: d.checklist, qc_photos: d.photos, qc_status: passed ? 'passed' : 'pending', tech_pack_id: d.packId || null };
        const { error } = await this.supabase.from('vendor_jobs').update(patch).eq('id', d.jobId);
        if (error) { this.showToast('검수 저장 실패: ' + error.message); return false; }
        const job = (this.vendors || []).flatMap(v => v.jobs || []).find(j => j.id === d.jobId);
        if (job) Object.assign(job, patch);
        this.showToast('검수 저장됨');
        return true;
    }

    async callKakaoQuick() {
        const d = this._qcDraft; if (!d) return;
        if (!await this.saveQc()) return;
        this.showToast('카카오퀵 픽업 요청 중...');
        try {
            const { data, error } = await this.supabase.functions.invoke('kakao-quick', {
                body: { jobId: d.jobId },
            });
            if (error) throw error;
            if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '응답 오류');
            d.quick = data;
            const job = (this.vendors || []).flatMap(v => v.jobs || []).find(j => j.id === d.jobId);
            if (job) job.quick_status = data;
            this.showToast('카카오퀵 픽업 예약 완료');
            this._renderQcModal();
        } catch (e) {
            this.showToast('카카오퀵 호출 실패 — 비즈니스 API 키/kakao-quick 함수 설정 필요');
        }
    }

    // ----- 작업지시서(tech_packs) 저장/로드 + 검수 연결 -----
    async ensureTechPacks(force) {
        if (this._techPacksLoaded && !force) return;
        try {
            const { data } = await this.supabase.from('tech_packs').select('id, style_name, style_no, config, created_at, item_id').order('created_at', { ascending: false });
            this._techPacks = data || [];
        } catch (e) { this._techPacks = this._techPacks || []; }
        this._techPacksLoaded = true;
        this.requestRender();
    }

    async saveTechPack() {
        const cfg = this.sampleConfig;
        const name = (cfg.styleName || '').trim() || '무제 작업지시서';
        const editId = this._editingTechPackId || null;
        try {
            if (editId) {
                const { error } = await this.supabase.from('tech_packs').update({ style_name: name, style_no: cfg.styleNo || null, config: cfg }).eq('id', editId);
                if (error) throw error;
            } else {
                const { error } = await this.supabase.from('tech_packs').insert([{ style_name: name, style_no: cfg.styleNo || null, config: cfg }]);
                if (error) throw error;
            }
        } catch (e) {
            this.showToast('작업지시서 저장 실패 (013_tech_packs.sql 설치 필요): ' + (e.message || e));
            return;
        }
        await this.ensureTechPacks(true);
        this.showToast(editId ? ('작업지시서 수정됨: ' + name) : ('작업지시서 저장됨: ' + name + ' — 생산현황 물품에 연결 가능'));
    }

    // ----- 작업지시서 목록 화면 -----
    newTechPack() { this.sampleConfig = defaultSampleConfig(); this._editingTechPackId = null; this.switchView('sample_maker'); }
    openTechPack(id) {
        const t = (this._techPacks || []).find(x => x.id === id);
        if (!t || !t.config) { this.showToast('설정을 불러올 수 없습니다'); return; }
        this.sampleConfig = JSON.parse(JSON.stringify(t.config));
        this._editingTechPackId = id;
        this.switchView('sample_maker');
    }
    printTechPack(id) {
        const t = (this._techPacks || []).find(x => x.id === id);
        if (!t) return;
        const w = window.open('', '_blank');
        if (!w) { this.showToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
        w.document.write(buildTechPackPrintHTML(t.config)); w.document.close();
    }
    downloadTechPack(id) {
        const t = (this._techPacks || []).find(x => x.id === id);
        if (!t) return;
        try {
            const html = buildTechPackPrintHTML(t.config);
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const safe = (t.style_name || '작업지시서').replace(/[\\/:*?"<>|]+/g, '_').trim();
            const a = document.createElement('a');
            a.href = url; a.download = `작업지시서_${safe}${t.style_no ? '_' + t.style_no : ''}.html`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            this.showToast('다운로드됨 — 파일 열고 인쇄(⌘P)하면 PDF로도 저장돼요');
        } catch (e) { this.showToast('다운로드 실패: ' + (e.message || e)); }
    }
    async deleteTechPack(id, name) {
        if (!await this.showConfirm(`작업지시서 "${name || ''}" 를 삭제할까요? 되돌릴 수 없어요.`, '삭제')) return;
        try {
            const { error } = await this.supabase.from('tech_packs').delete().eq('id', id);
            if (error) throw error;
            if (this._editingTechPackId === id) this._editingTechPackId = null;
            this.showToast('삭제됨');
            await this.ensureTechPacks(true);
        } catch (e) { this.showToast('삭제 실패: ' + (e.message || e)); }
    }
    // ============================================================
    //  제품리스트 — 생산의 중심 표
    //   한 줄 = 제품 하나. 그 줄이 시즌·공장·작업지시서·샘플·견적을 다 물고 있다.
    //   (예전 '프로젝트'는 이제 '시즌'이다 — products 테이블 그대로, 이름만 바꿨다)
    // ============================================================
    ITEM_STATUSES = ['시작전', '요청하기', '그레이딩', '샘플 중', '원단/부자재 발주', '메인투입', '보류', '출고완료'];
    ITEM_SC = { '시작전': '#8e8e93', '요청하기': '#5e5ce6', '그레이딩': '#64d2ff', '샘플 중': '#0a84ff',
        '원단/부자재 발주': '#bf5af2', '메인투입': '#ff9f0a', '보류': '#ff453a', '출고완료': '#30d158' };

    async loadItems() {
        this._itemsLoading = true;
        try {
            const { data, error } = await this.supabase.from('product_items').select('*')
                .order('sort', { ascending: true }).order('created_at', { ascending: false });
            if (error) throw error;
            this.pItems = data || [];
        } catch (e) {
            this.showToast('제품리스트를 불러오지 못했습니다. (041_product_items.sql 설치 필요)');
            this.pItems = [];
        }
        this._itemsLoaded = true; this._itemsLoading = false;
        this.requestRender();
    }

    _seasons() { return (mockData.products || []).filter(p => this._canSeeProject(p)); }

    // 표의 칸을 고치면 바로 저장한다. redraw=1 은 색·집계가 바뀌는 칸(상태·체크·날짜·고르기)만.
    async setItem(id, field, value, redraw) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        const v = (value === '' ? null : value);
        const old = it[field]; it[field] = v;
        const { error } = await this.supabase.from('product_items').update({ [field]: v }).eq('id', id);
        if (error) { it[field] = old; this.showToast('저장 실패: ' + error.message); this.requestRender(); return; }
        // 시즌을 고르면 그 시즌의 브랜드를 따라간다 (비어 있을 때만)
        if (field === 'product_id' && v && !it.brand_id) {
            const s = this._seasons().find(p => String(p.id) === String(v));
            if (s && s.brand_id) { it.brand_id = s.brand_id; await this.supabase.from('product_items').update({ brand_id: s.brand_id }).eq('id', id); }
        }
        if (redraw) this.requestRender();
    }

    // ── 판매명 ──────────────────────────────────────────────
    //  제품리스트 이름은 약식(ST하렘팬츠), 손님이 보는 최종 이름은 카페24에 올라간 이름.
    //  한 제품이 여러 이름으로 팔리기도 한다(선주문판·일반판) → 여러 개를 붙인다.
    _saleNamePool() {
        if (this._salePoolCache && this._salePoolAt === (this.orders || []).length) return this._salePoolCache;
        const m = new Map();
        (this.orders || []).forEach(o => (o.items || []).forEach(it => {
            const n = (it.product_name || '').trim();
            if (!n) return;
            const cur = m.get(n) || { name: n, n: 0, qty: 0, last: '' };
            cur.n += 1; cur.qty += Number(it.qty || it.quantity || 1) || 1;
            if ((o.order_date || '') > cur.last) cur.last = o.order_date || '';
            m.set(n, cur);
        }));
        this._salePoolCache = [...m.values()].sort((a, b) => b.n - a.n);
        this._salePoolAt = (this.orders || []).length;
        return this._salePoolCache;
    }
    //  그 제품이 실제로 몇 개 팔렸나 — 붙인 판매명들을 합쳐서
    _itemSold(it) {
        const names = new Set(it.sale_names || []);
        if (!names.size) return null;
        let n = 0, qty = 0;
        this._saleNamePool().forEach(p => { if (names.has(p.name)) { n += p.n; qty += p.qty; } });
        return { n, qty };
    }
    async setItemSales(id, names) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        const old = it.sale_names || [];
        it.sale_names = names;
        const { error } = await this.supabase.from('product_items').update({ sale_names: names }).eq('id', id);
        if (error) { it.sale_names = old; this.showToast('저장 실패 (046 SQL 필요): ' + error.message); }
        this.requestRender();
    }
    itemDelSale(id, name) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        this.setItemSales(id, (it.sale_names || []).filter(x => x !== name));
    }
    //  주문에 나온 이름에서 고른다 — 직접 적을 수도 있다
    pickSaleName(id) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const esc = s => this._vesc(s);
        this._salePick = new Set(it.sale_names || []);
        const draw = () => {
            const q = (this._saleQ || '').trim().toLowerCase();
            let pool = this._saleNamePool();
            //  약식 이름과 글자가 겹치는 것을 위로 올려 준다
            const key = (it.name || '').toLowerCase().replace(/\s/g, '');
            if (!q && key) pool = [...pool].sort((a, b) => {
                const A = a.name.toLowerCase().replace(/\s/g, '').includes(key) ? 1 : 0;
                const B = b.name.toLowerCase().replace(/\s/g, '').includes(key) ? 1 : 0;
                return B - A || b.n - a.n;
            });
            if (q) pool = pool.filter(p => p.name.toLowerCase().includes(q));
            const list = c.querySelector('#sn-list'); if (!list) return;
            list.innerHTML = pool.slice(0, 120).map(p => `<label class="pa-m sn-m">
                <input type="checkbox" value="${esc(p.name)}" ${this._salePick.has(p.name) ? 'checked' : ''}>
                <span>${esc(p.name)}<em>주문 ${p.n}건 · ${p.qty}개${p.last ? ' · 최근 ' + esc(p.last) : ''}</em></span>
            </label>`).join('') || '<div class="np-none">찾는 이름이 없습니다</div>';
            list.querySelectorAll('input').forEach(i => i.onchange = () => {
                if (i.checked) this._salePick.add(i.value); else this._salePick.delete(i.value);
                const cnt = c.querySelector('#sn-cnt'); if (cnt) cnt.textContent = this._salePick.size;
            });
        };
        c.innerHTML = `<div class="modal-content vmodal fi" style="width:94%;max-width:460px">
            <div class="hk-top"><b>판매명 고르기</b><button class="fi-x" onclick="app.closeGlobalModal()">×</button></div>
            <p class="fi-note" style="margin:8px 0 10px">제품리스트 이름은 <b>${esc(it.name || '')}</b> 입니다.
                손님이 보는 최종 상품명(카페24에 올라간 이름)을 골라 붙이세요. 여러 개 고를 수 있습니다.
                <span id="sn-cnt">${(it.sale_names || []).length}</span>개 골랐습니다.</p>
            <div class="mp-find" style="margin-bottom:8px"><i class="ph ph-magnifying-glass"></i>
                <input id="sn-q" placeholder="상품명 찾기" autocomplete="off"></div>
            <div class="pa-list sn-list" id="sn-list"></div>
            <div class="fi-r" style="margin-top:10px"><span>직접 적기</span>
                <input id="sn-manual" class="nw-f" placeholder="목록에 없으면 여기에"></div>
            <div class="fi-act">
                <button class="mbtn" onclick="app.closeGlobalModal()">취소</button>
                <button class="mbtn pri" id="sn-ok">저장</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        draw();
        const qi = c.querySelector('#sn-q');
        qi.oninput = () => { this._saleQ = qi.value; draw(); };
        c.querySelector('#sn-ok').onclick = async () => {
            const manual = c.querySelector('#sn-manual').value.trim();
            if (manual) this._salePick.add(manual);
            await this.setItemSales(id, [...this._salePick]);
            this.closeGlobalModal();
            this.showToast(`판매명 ${this._salePick.size}개를 붙였습니다`);
        };
        setTimeout(() => qi.focus(), 40);
    }

    async addItem() {
        const row = { name: '', status: '요청하기', created_by: this._actor() };
        if (this.itemSeason && this.itemSeason !== 'ALL') {
            row.product_id = this.itemSeason;
            const s = this._seasons().find(p => String(p.id) === String(this.itemSeason));
            if (s && s.brand_id) row.brand_id = s.brand_id;
        }
        const { data, error } = await this.supabase.from('product_items').insert([row]).select().single();
        if (error) { this.showToast('추가 실패: ' + error.message); return; }
        this.pItems = [data, ...(this.pItems || [])];
        this.itemSel = data.id;
        this.requestRender();
        setTimeout(() => { const el = this.appContainer.querySelector(`.it-row[data-id="${data.id}"] .it-name`); if (el) el.focus(); }, 60);
    }

    async delItem(id) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        if (!await this.showConfirm(`'${it.name || '이름 없는 제품'}' 을 제품리스트에서 지웁니다.`, '삭제')) return;
        const { error } = await this.supabase.from('product_items').delete().eq('id', id);
        if (error) { this.showToast('삭제 실패: ' + error.message); return; }
        this.pItems = (this.pItems || []).filter(x => String(x.id) !== String(id));
        if (String(this.itemSel) === String(id)) this.itemSel = null;
        this.requestRender();
    }

    selItem(id) { if (String(this.itemSel) === String(id)) return; this.itemSel = id; this.requestRender(); }
    //  상세 칸 접기 — 고른 걸 놓으면 칸이 사라진다
    closeDetail(view) {
        ({ items: () => this.itemSel = null, cs: () => this.csSel = null,
           inventory: () => this.invSel = null, tech_packs: () => this.tpSel = null,
           orders: () => this.orderSel = null })[view]?.();
        this.requestRender();
    }
    //  칸 안의 입력칸·선택칸을 누른 것은 '줄 고르기' 가 아니다.
    //  이걸 안 가리면 드롭다운을 여는 순간 다시 그려서 0.2초 만에 닫힌다.
    rowPick(ev, id, what) {
        const t = ev && ev.target;
        const ctl = t && t.closest('input,select,textarea,button,label,a');
        //  펼친 드롭다운은 다시 그리면 닫힌다 — 고르기만 하고 그리지 않는다
        if (ctl && ctl.tagName === 'SELECT') {
            if (what === 'cs') this.csSel = id; else if (what === 'inv') this.invSel = id; else this.itemSel = id;
            return;
        }
        //  글자 칸·날짜 칸은 눌러도 줄이 골라져야 한다. 그린 뒤 커서를 제자리에 돌려놓는다.
        if (ctl && (ctl.tagName === 'INPUT' || ctl.tagName === 'TEXTAREA')) {
            if (ctl.type === 'checkbox' || ctl.type === 'radio') return;
            this._cellBack = { row: id, f: ctl.dataset.f || '', at: ctl.selectionStart };
        } else if (ctl) return;   // 단추는 제 할 일만
        if (what === 'cs') { if (String(this.csSel) !== String(id)) { this.csSel = id; this.requestRender(); } return; }
        if (what === 'inv') { this.selectInv(id); return; }
        this.selItem(id);
    }
    //  다시 그린 뒤, 누르고 있던 칸으로 커서를 돌려놓는다
    _restoreCell() {
        const c = this._cellBack; if (!c) return;
        this._cellBack = null;
        const el = this.appContainer?.querySelector(`.it-row[data-id="${c.row}"] [data-f="${c.f}"]`);
        if (!el) return;
        el.focus();
        try { if (c.at != null && el.setSelectionRange) el.setSelectionRange(c.at, c.at); } catch (_e) {}
    }
    selectTechPack(id) { this.tpSel = id; this.requestRender(); }
    setSeasonView(v) { this.seasonView = v; this.requestRender(); }
    seasonFind(v) { this.seasonQ = v; clearTimeout(this._seaQT); this._seaQT = setTimeout(() => this.requestRender(), 200); }
    //  시즌 카드 → 그 시즌만 걸러진 제품리스트
    openSeasonItems(pid) {
        this.itemSeason = pid; this.itemBrand = 'ALL'; this.itemStatus = 'ALL'; this.itemQ = '';
        const w = (this.wins || []).find(x => this._groupOf(x.view) === this._groupOf('items'));
        if (this.macMode && w) { w.view = 'items'; w.min = false; this.macFocus(w.id); this.requestRender(); return; }
        this.switchView('items');
    }
    setItemSeason(v) { this.itemSeason = v; this.requestRender(); }
    setItemStatus(v) { this.itemStatus = v; this.requestRender(); }
    pickRow(id, on) {
        this._itemPicked = this._itemPicked || new Set();
        if (on) this._itemPicked.add(id); else this._itemPicked.delete(id);
        this.requestRender();
    }
    pickAllRows(on) {
        this._itemPicked = new Set();
        if (on) (this._lastItemRows || []).forEach(i => this._itemPicked.add(i.id));
        this.requestRender();
    }
    //  고른 줄을 한꺼번에 — 제작현황 · 시즌 · 공장
    async bulkItems(field, value) {
        const ids = [...(this._itemPicked || [])];
        if (!ids.length) return;
        const v = value === '' ? null : value;
        const label = { status: '제작현황', product_id: '시즌', vendor_id: '공장' }[field] || field;
        const { error } = await this.supabase.from('product_items').update({ [field]: v }).in('id', ids);
        if (error) { this.showToast('바꾸지 못했습니다: ' + error.message); return; }
        (this.pItems || []).forEach(i => { if (ids.includes(i.id)) i[field] = v; });
        this.showToast(`${ids.length}개의 ${label}을 바꿨습니다`);
        this.requestRender();
    }
    async bulkDeleteItems() {
        const ids = [...(this._itemPicked || [])];
        if (!ids.length) return;
        if (!await this.showConfirm(`고른 제품 ${ids.length}개를 지웁니다.`, '삭제')) return;
        const { error } = await this.supabase.from('product_items').delete().in('id', ids);
        if (error) { this.showToast('삭제 실패: ' + error.message); return; }
        this.pItems = (this.pItems || []).filter(i => !ids.includes(i.id));
        this._itemPicked = new Set();
        this.showToast(`${ids.length}개를 지웠습니다`);
        this.requestRender();
    }
    //  칸 거르기 — 그 칸에 실제로 있는 값만 모아 고르게 한다(엑셀 결)
    _itemColVal(i, k) {
        const B = id => this._brandNameById(id);
        const V = id => ((this.vendors || []).find(v => String(v.id) === String(id)) || {}).name || '';
        const S = id => (this._seasons().find(p => String(p.id) === String(id)) || {}).name || '';
        return ({
            brand_id: B(i.brand_id), name: i.name || '', sale: (i.sale_names || [])[0] || '',
            pattern_no: i.pattern_no || '', status: i.status || '', memo: i.memo || '',
            trims: i.trims ? '예' : '아니오', checked: i.checked ? '예' : '아니오',
            vendor_id: V(i.vendor_id), product_id: S(i.product_id),
            ship_date: i.ship_date || '', open_date: i.open_date || '',
        })[k] ?? '';
    }
    openColFilter(ev, k, label) {
        ev && ev.stopPropagation();
        document.getElementById('colf')?.remove();
        const esc = x => this._vesc(x);
        const base = (this.pItems || []);
        const vals = [...new Set(base.map(i => this._itemColVal(i, k)))]
            .sort((a, b) => String(a).localeCompare(String(b), 'ko'));
        const cur = (this.itemColF || {})[k];
        const sel = new Set(cur || vals);
        const el = document.createElement('div');
        el.id = 'colf'; el.className = 'colf';
        el.innerHTML = `<div class="colf-h">${esc(label)} 거르기
                <button onclick="app.clearColFilter('${k}')">모두</button></div>
            <div class="colf-b">${vals.map((v, i) => `<label class="pa-m colf-m">
                <input type="checkbox" value="${esc(v)}" ${sel.has(v) ? 'checked' : ''}>
                <span>${esc(v) || '<em>(빈칸)</em>'}<em>${base.filter(x => this._itemColVal(x, k) === v).length}</em></span>
            </label>`).join('')}</div>
            <div class="colf-a"><button class="mbtn" id="colf-x">취소</button>
                <button class="mbtn pri" id="colf-ok">적용</button></div>`;
        document.body.appendChild(el);
        const th = ev && ev.target.closest('th');
        if (th) { const r = th.getBoundingClientRect();
            el.style.left = Math.min(r.left, innerWidth - el.offsetWidth - 10) + 'px';
            el.style.top = (r.bottom + 4) + 'px'; }
        el.querySelector('#colf-x').onclick = () => el.remove();
        el.querySelector('#colf-ok').onclick = () => {
            const picked = [...el.querySelectorAll('input:checked')].map(i => i.value);
            this.itemColF = this.itemColF || {};
            if (picked.length === vals.length) delete this.itemColF[k]; else this.itemColF[k] = picked;
            el.remove(); this.requestRender();
        };
        this._colfOff = (e) => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('mousedown', this._colfOff); } };
        setTimeout(() => document.addEventListener('mousedown', this._colfOff), 0);
    }
    clearColFilter(k) {
        if (this.itemColF) delete this.itemColF[k];
        document.getElementById('colf')?.remove();
        this.requestRender();
    }
    clearAllColFilters() { this.itemColF = {}; this.requestRender(); }
    sortItems(k) {
        const cur = this.itemSort || { k: '', dir: 1 };
        this.itemSort = cur.k === k ? (cur.dir > 0 ? { k, dir: -1 } : { k: '', dir: 1 }) : { k, dir: 1 };
        this.requestRender();
    }
    itemFind(v) { this.itemQ = v; clearTimeout(this._itemQT); this._itemQT = setTimeout(() => this.requestRender(), 200); }

    // ── 연동 ────────────────────────────────────────────────
    //  작업지시서·샘플디자인은 한 몸(tech_packs.config)이다. 제품 줄에서 만들면 양쪽에 이름이 박힌다.
    async itemNewTechPack(id) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        const cfg = defaultSampleConfig();
        cfg.styleName = it.name || '무제';
        cfg.styleNo = it.pattern_no || '';
        const { data, error } = await this.supabase.from('tech_packs')
            .insert([{ style_name: cfg.styleName, style_no: cfg.styleNo || null, config: cfg, item_id: it.id }]).select().single();
        if (error) { this.showToast('작업지시서 만들기 실패 (013·041 SQL 필요): ' + error.message); return; }
        await this.setItem(id, 'tech_pack_id', data.id);
        await this.ensureTechPacks(true);
        this.sampleConfig = JSON.parse(JSON.stringify(cfg));
        this._editingTechPackId = data.id;
        this.showToast(`'${cfg.styleName}' 작업지시서를 만들었습니다 — 샘플·디자인에서 이어서 그리세요`);
        this.switchView('sample_maker');
    }

    async itemLinkTechPack(id, tpId) {
        await this.setItem(id, 'tech_pack_id', tpId, 1);
        if (tpId) await this.supabase.from('tech_packs').update({ item_id: id }).eq('id', tpId);
    }

    async itemNewQuote(id) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        const s = this._seasons().find(p => String(p.id) === String(it.product_id));
        const row = {
            client_name: ((mockData.brands || []).find(b => b.id === it.brand_id) || {}).name || (s && s.name) || '미정',
            items: [{ name: it.name || '', spec: it.pattern_no || '', qty: 0, price: 0, amount: 0 }],
            quote_date: new Date().toISOString().slice(0, 10),
            status: 'draft', item_id: it.id,
            memo: s ? `시즌: ${s.name}` : null,
        };
        const { data, error } = await this.supabase.from('quotes').insert([row]).select().single();
        if (error) { this.showToast('견적 만들기 실패 (008·041 SQL 필요): ' + error.message); return; }
        await this.setItem(id, 'quote_id', data.id, 1);
        this._quotesLoaded = false; await this.loadQuotes();
        this.showQuoteModal(data.id);
    }
    itemOpenQuote(id) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id));
        if (it && it.quote_id) this.showQuoteModal(it.quote_id);
    }

    //  생산 투입 — 공장과 작업지시서가 정해져 있어야 넣는다(생산현황 규칙과 같다)
    async itemToVendor(id) {
        const it = (this.pItems || []).find(x => String(x.id) === String(id)); if (!it) return;
        if (!it.vendor_id) { this.showToast('먼저 표에서 공장을 고르세요'); return; }
        if (!it.tech_pack_id) { this.showToast('작업지시서를 먼저 만들어야 생산에 투입됩니다'); return; }
        const row = {
            vendor_id: it.vendor_id, title: it.name || '무제', stage: '진행중',
            due_date: it.ship_date || null, tech_pack_id: it.tech_pack_id, item_id: it.id,
        };
        const { error } = await this.supabase.from('vendor_jobs').insert([row]);
        if (error) { this.showToast('투입 실패: ' + error.message); return; }
        if ((it.status || '') !== '메인투입') await this.setItem(id, 'status', '메인투입');
        await this.loadVendors();
        this.showToast(`생산현황에 올렸습니다 — ${row.title}`);
    }

    // ── 노션에서 옮겨오기 ─────────────────────────────────
    //  노션 데이터베이스 → ··· → Export → CSV 를 받아 그대로 떨어뜨리면 된다.
    //  열 이름이 조금 달라도 뜻이 같으면 알아서 맞춘다. 없는 시즌·공장·브랜드는 만들어 붙인다.
    NOTION_MAP = {
        brand:   ['브랜드', 'brand'],
        name:    ['이름', '제품명', '품명', 'name', 'title'],
        pattern: ['패턴명', '패턴', '스타일', 'pattern', 'style'],
        status:  ['제작현황', '상태', '진행', 'status'],
        memo:    ['메모', '비고', 'memo', 'note', 'notes'],
        trims:   ['부자재', 'trims'],
        checked: ['체크박스', '체크', 'check', 'done'],
        vendor:  ['공장', '생산처', '거래처', 'vendor', 'factory'],
        season:  ['시즌', '프로젝트', 'season', 'project'],
        ship:    ['출고예정일', '출고일', '출고', 'ship'],
        open:    ['오픈일', '오픈', 'open', '발매일'],
    };
    pickNotionCSV() {
        const el = document.createElement('input');
        el.type = 'file'; el.accept = '.csv,text/csv';
        el.onchange = () => { const f = el.files && el.files[0]; if (f) this.importNotionCSV(f); };
        el.click();
    }
    //  따옴표 안의 쉼표·줄바꿈까지 제대로 끊는다 (노션 CSV 는 메모에 줄바꿈이 흔하다)
    _csvRows(text) {
        const rows = []; let row = [], cell = '', q = false;
        const t = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
        for (let i = 0; i < t.length; i++) {
            const c = t[i];
            if (q) {
                if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
                else cell += c;
            } else if (c === '"') q = true;
            else if (c === ',') { row.push(cell); cell = ''; }
            else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
            else cell += c;
        }
        if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
        return rows.filter(r => r.some(v => String(v).trim() !== ''));
    }
    _notionDate(v) {
        const t = String(v || '').trim(); if (!t) return null;
        const m = t.match(/(\d{4})[-./\s년]+(\d{1,2})[-./\s월]+(\d{1,2})/);
        if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
        const d = new Date(t); return isNaN(d) ? null : d.toISOString().slice(0, 10);
    }
    _notionBool(v) { return /^(y|yes|true|o|v|예|완료|체크|done|✓|☑|1)$/i.test(String(v || '').trim()); }

    async importNotionCSV(file) {
        let rows;
        try { rows = this._csvRows(await file.text()); }
        catch (e) { this.showToast('CSV 를 읽지 못했습니다'); return; }
        if (rows.length < 2) { this.showToast('내용이 없는 CSV 입니다'); return; }

        const head = rows[0].map(h => String(h).trim());
        const col = {};
        Object.entries(this.NOTION_MAP).forEach(([k, names]) => {
            const i = head.findIndex(h => names.some(n => h.toLowerCase().replace(/\s/g, '') === n.toLowerCase()));
            const j = i < 0 ? head.findIndex(h => names.some(n => h.toLowerCase().includes(n.toLowerCase()))) : i;
            if (j >= 0) col[k] = j;
        });
        if (col.name === undefined) {
            this.showToast(`'이름' 열을 못 찾았습니다. 찾은 열: ${head.join(' / ')}`);
            return;
        }
        const body = rows.slice(1);
        if (!await this.showConfirm(`${body.length}줄을 제품리스트로 가져옵니다.\n없는 시즌·공장·브랜드는 이름 그대로 새로 만듭니다.`, '확인')) return;

        const get = (r, k) => col[k] === undefined ? '' : String(r[col[k]] ?? '').trim();
        const brands = mockData.brands || [];
        const seasons = this._seasons();
        const vendors = this.vendors || [];
        const byName = (list, n) => list.find(x => String(x.name || '').trim() === n);
        let made = { season: 0, vendor: 0 }, fail = 0;
        const out = [];

        for (const r of body) {
            const name = get(r, 'name'); if (!name) continue;
            const row = { name, created_by: this._actor() };

            const bn = get(r, 'brand');
            const b = bn ? byName(brands, bn) : null;
            if (b) row.brand_id = b.id;

            const sn = get(r, 'season');
            if (sn) {
                let sea = byName(seasons, sn);
                if (!sea) {
                    const { data, error } = await this.supabase.from('products')
                        .insert([{ name: sn, brand_id: row.brand_id || null }]).select().single();
                    if (!error && data) { sea = data; seasons.push(data); mockData.products.push(data); made.season++; }
                }
                if (sea) { row.product_id = sea.id; if (!row.brand_id && sea.brand_id) row.brand_id = sea.brand_id; }
            }

            const vn = get(r, 'vendor');
            if (vn) {
                let ven = byName(vendors, vn);
                if (!ven) {
                    const { data, error } = await this.supabase.from('vendors')
                        .insert([{ name: vn, category: '봉제' }]).select().single();
                    if (!error && data) { ven = { ...data, jobs: [] }; vendors.push(ven); made.vendor++; }
                }
                if (ven) row.vendor_id = ven.id;
            }

            const st = get(r, 'status');
            row.status = this.ITEM_STATUSES.find(x => x === st)
                || this.ITEM_STATUSES.find(x => st && x.replace(/[^가-힣]/g, '').includes(st.replace(/[^가-힣]/g, '')))
                || (st || '요청하기');
            row.pattern_no = get(r, 'pattern') || null;
            row.memo = get(r, 'memo') || null;
            row.trims = this._notionBool(get(r, 'trims'));
            row.checked = this._notionBool(get(r, 'checked'));
            row.ship_date = this._notionDate(get(r, 'ship'));
            row.open_date = this._notionDate(get(r, 'open'));
            out.push(row);
        }

        // 한 번에 100줄씩
        const made2 = [];
        for (let i = 0; i < out.length; i += 100) {
            const { data, error } = await this.supabase.from('product_items').insert(out.slice(i, i + 100)).select();
            if (error) { fail += Math.min(100, out.length - i); continue; }
            made2.push(...(data || []));
        }
        this.pItems = [...made2, ...(this.pItems || [])];
        this._vendorsLoaded = false; this.loadVendors();
        this.requestRender();
        this.showToast(`제품 ${made2.length}줄 가져옴` +
            (made.season ? ` · 시즌 ${made.season}개 새로 만듦` : '') +
            (made.vendor ? ` · 공장 ${made.vendor}곳 새로 만듦` : '') +
            (fail ? ` · ${fail}줄 실패` : ''));
    }

    renderItems() {
        if (!this._itemsLoaded) return this._loadingSkeleton('제품리스트');
        const esc = s => this._vesc(s);
        const seasons = this._seasons();
        const brands = mockData.brands || [];
        const vendors = (this.vendors || []).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
        const packs = this._techPacks || [];
        const all = this.pItems || [];

        const sKey = this.itemSeason || 'ALL', stKey = this.itemStatus || 'ALL';
        const q = (this.itemQ || '').trim().toLowerCase();
        let rows = all;
        if (sKey !== 'ALL') rows = rows.filter(i => sKey === 'NONE' ? !i.product_id : String(i.product_id) === String(sKey));
        const bKey = this.itemBrand || 'ALL';
        if (bKey !== 'ALL') rows = rows.filter(i => bKey === 'NONE' ? !i.brand_id : String(i.brand_id) === String(bKey));
        if (stKey !== 'ALL') rows = rows.filter(i => (i.status || '') === stKey);
        if (q) rows = rows.filter(i => [i.name, i.pattern_no, i.memo].some(v => String(v || '').toLowerCase().includes(q)));
        //  칸마다 걸어 둔 거르기
        const colF = this.itemColF || {};
        Object.keys(colF).forEach(k => {
            const keep = new Set(colF[k]);
            rows = rows.filter(i => keep.has(this._itemColVal(i, k)));
        });

        //  줄 세우기 — 머리글을 누르면 그 칸 기준. 한 번 더 누르면 거꾸로.
        const srt = this.itemSort || { k: '', dir: 1 };
        if (srt.k) {
            const nameOfB = id => (brands.find(b => b.id === id) || {}).name || '';
            const nameOfV = id => (vendors.find(v => v.id === id) || {}).name || '';
            const nameOfS = id => (seasons.find(p => String(p.id) === String(id)) || {}).name || '';
            const val = (i) => ({
                checked: i.checked ? 1 : 0, brand_id: nameOfB(i.brand_id), name: i.name || '',
                sale: (i.sale_names || [])[0] || '', pattern_no: i.pattern_no || '',
                status: this.ITEM_STATUSES.indexOf(i.status) + 1 || 99, memo: i.memo || '',
                trims: i.trims ? 1 : 0, vendor_id: nameOfV(i.vendor_id), product_id: nameOfS(i.product_id),
                ship_date: i.ship_date || '', open_date: i.open_date || '',
            })[srt.k];
            rows = [...rows].sort((a, b) => {
                const A = val(a), B = val(b);
                if (typeof A === 'number' && typeof B === 'number') return (A - B) * srt.dir;
                return String(A).localeCompare(String(B), 'ko') * srt.dir;
            });
        }

        const opt = (v, t, cur) => `<option value="${esc(String(v))}"${String(cur || '') === String(v) ? ' selected' : ''}>${esc(t)}</option>`;
        const txt = (it, f, ph, cls) => `<input class="it-in ${cls || ''}" data-f="${f}" value="${esc(it[f] || '')}" placeholder="${esc(ph || '')}"
            onchange="app.setItem('${it.id}','${f}',this.value)">`;
        const dat = (it, f) => `<input class="it-in it-dt${it[f] ? '' : ' empty'}" data-f="${f}" type="date" value="${it[f] || ''}" onchange="app.setItem('${it.id}','${f}',this.value,1)">`;
        const chk = (it, f) => `<input class="it-ck" type="checkbox"${it[f] ? ' checked' : ''} onchange="app.setItem('${it.id}','${f}',this.checked,1)">`;
        const pick = (it, f, list, ph) => `<select class="it-sel" onchange="app.setItem('${it.id}','${f}',this.value,1)">
            ${opt('', ph, it[f] ? 'x' : '')}${list.map(o => opt(o.v, o.t, it[f])).join('')}</select>`;

        const tr = it => {
            const sc = this.ITEM_SC[it.status] || '#8e8e93';
            const tp = packs.find(p => String(p.id) === String(it.tech_pack_id));
            return `<tr class="it-row${String(this.itemSel) === String(it.id) ? ' on' : ''}" data-id="${it.id}"
                onclick="app.rowPick(event,'${it.id}')">
                <td class="it-c"><input class="it-ck" type="checkbox" ${this._itemPicked?.has(it.id) ? 'checked' : ''}
                    onclick="event.stopPropagation()" onchange="app.pickRow('${it.id}',this.checked)"></td>
                <td>${pick(it, 'brand_id', brands.map(b => ({ v: b.id, t: b.name })), '브랜드')}</td>
                <td>${txt(it, 'name', '제품 이름', 'it-name')}</td>
                <td>${(() => {
                    const sn = it.sale_names || [];
                    const sold = this._itemSold(it);
                    return `<button class="it-sale${sn.length ? ' on' : ''}" onclick="event.stopPropagation();app.pickSaleName('${it.id}')"
                        title="${sn.length ? esc(sn.join(' · ')) : '카페24 상품명 붙이기'}">
                        ${sn.length ? `${esc(sn[0])}${sn.length > 1 ? ` <em>+${sn.length - 1}</em>` : ''}${sold ? ` <b>${sold.qty}</b>` : ''}`
                                    : '<i class="ph ph-link-simple"></i> 붙이기'}</button>`;
                })()}</td>
                <td>${txt(it, 'pattern_no', '패턴명')}</td>
                <td><select class="it-sel it-st" style="color:${sc};border-color:${sc}44;background:${sc}1a"
                        onchange="app.setItem('${it.id}','status',this.value,1)">
                    ${(this.ITEM_STATUSES.includes(it.status) || !it.status ? this.ITEM_STATUSES : [it.status, ...this.ITEM_STATUSES])
                        .map(s => opt(s, s, it.status)).join('')}</select></td>
                <td>${txt(it, 'memo', '메모')}</td>
                <td class="it-c">${chk(it, 'trims')}</td>
                <td class="it-c">${chk(it, 'checked')}</td>
                <td>${pick(it, 'vendor_id', vendors.map(v => ({ v: v.id, t: v.name })), '공장')}</td>
                <td>${pick(it, 'product_id', seasons.map(s => ({ v: s.id, t: s.name })), '시즌')}</td>
                <td>${dat(it, 'ship_date')}</td>
                <td>${dat(it, 'open_date')}</td>
                <td class="it-lk">
                    ${tp ? `<button class="it-ib on" title="작업지시서: ${esc(tp.style_name || '')}" onclick="event.stopPropagation();app.openTechPack('${tp.id}')"><i class="ph ph-clipboard-text"></i></button>`
                         : `<button class="it-ib" title="작업지시서 만들기" onclick="event.stopPropagation();app.itemNewTechPack('${it.id}')"><i class="ph ph-clipboard-text"></i></button>`}
                    ${it.quote_id ? `<button class="it-ib on" title="견적 보기" onclick="event.stopPropagation();app.itemOpenQuote('${it.id}')"><i class="ph ph-receipt"></i></button>`
                         : `<button class="it-ib" title="견적 만들기" onclick="event.stopPropagation();app.itemNewQuote('${it.id}')"><i class="ph ph-receipt"></i></button>`}
                    <button class="it-ib" title="생산 투입" onclick="event.stopPropagation();app.itemToVendor('${it.id}')"><i class="ph ph-factory"></i></button>
                    <button class="it-ib del" title="삭제" onclick="event.stopPropagation();app.delItem('${it.id}')"><i class="ph ph-trash"></i></button>
                </td>
            </tr>`;
        };

        this._lastItemRows = rows;
        const cnt = s => all.filter(i => (i.status || '') === s).length;
        const pill = (k, label, n) => `<button class="it-pill${stKey === k ? ' on' : ''}" onclick="app.setItemStatus('${k}')"
            ${k !== 'ALL' ? `style="--pc:${this.ITEM_SC[k] || '#8e8e93'}"` : ''}>${esc(label)}<em>${n}</em></button>`;

        return `<div class="mp it-wrap">
            <div class="mp-top">
                <div class="mp-tl"><b>${esc(sKey !== 'ALL'
                    ? ((seasons.find(p => String(p.id) === String(sKey)) || {}).name || '시즌 없음')
                    : (bKey !== 'ALL' ? (this._brandNameById(bKey) !== '-' ? this._brandNameById(bKey) : '브랜드 없음') : '제품리스트'))}</b><span>${rows.length}/${all.length}</span>
                    ${Object.keys(this.itemColF || {}).length ? `<button class="flt-off" onclick="app.clearAllColFilters()"
                        title="거르기 모두 풀기"><i class="ph ph-funnel-fill"></i> ${Object.keys(this.itemColF).length}칸 거르는 중 ✕</button>` : ''}</div>

                <div class="it-find"><i class="ph ph-magnifying-glass"></i>
                    <input value="${esc(this.itemQ || '')}" placeholder="이름·패턴·메모" oninput="app.itemFind(this.value)"></div>
                <button class="mbtn" onclick="app.pickNotionCSV()" title="노션 데이터베이스 → ··· → Export → CSV"><i class="ph ph-download-simple"></i> 노션 CSV</button>
                <button class="it-add" onclick="app.addItem()"><i class="ph ph-plus"></i> 제품 추가</button>
            </div>
            <div class="it-pills">${pill('ALL', '전체', all.length)}${this.ITEM_STATUSES.map(s => pill(s, s, cnt(s))).join('')}</div>
            ${(this._itemPicked && this._itemPicked.size) ? `<div class="bulk-bar">
                <b>${this._itemPicked.size}개 골랐습니다</b>
                <select class="it-sel" onchange="app.bulkItems('status',this.value);this.selectedIndex=0">
                    <option value="">제작현황 바꾸기…</option>
                    ${this.ITEM_STATUSES.map(s2 => `<option value="${esc(s2)}">${esc(s2)}</option>`).join('')}</select>
                <select class="it-sel" onchange="app.bulkItems('product_id',this.value);this.selectedIndex=0">
                    <option value="">시즌 옮기기…</option>
                    ${seasons.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
                <select class="it-sel" onchange="app.bulkItems('vendor_id',this.value);this.selectedIndex=0">
                    <option value="">공장 정하기…</option>
                    ${vendors.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
                <span class="pill-sp"></span>
                <button class="mbtn danger" onclick="app.bulkDeleteItems()">지우기</button>
                <button class="mbtn" onclick="app.pickAllRows(false)">고르기 풀기</button>
            </div>` : ''}
            <div class="it-scroll">
                <table class="it-tbl"><thead><tr>
                    <th class="it-c" title="골라서 한꺼번에 바꾸기"><input type="checkbox" class="it-ck"
                        ${rows.length && rows.every(i => this._itemPicked?.has(i.id)) ? 'checked' : ''}
                        onchange="app.pickAllRows(this.checked)"></th>
                    ${[['brand_id', '브랜드'], ['name', '이름'], ['sale', '판매명'],
                       ['pattern_no', '패턴명'], ['status', '제작현황'], ['memo', '메모'], ['trims', '부자재', 'it-c'],
                       ['checked', '확인', 'it-c'],
                       ['vendor_id', '공장'], ['product_id', '시즌'], ['ship_date', '출고예정일'], ['open_date', '오픈일']]
                      .map(([k, label, cls]) => `<th class="${cls || ''}${srt.k === k ? ' srt' : ''}${(this.itemColF || {})[k] ? ' flt' : ''}"
                        onclick="app.sortItems('${k}')" title="눌러서 줄 세우기 · 깔때기로 거르기">${esc(label)}${srt.k === k ? `<i class="ph ph-caret-${srt.dir > 0 ? 'up' : 'down'}"></i>` : ''}<button class="th-f"
                        onclick="app.openColFilter(event,'${k}','${esc(label)}')" title="${esc(label)} 거르기"><i class="ph ph-funnel${(this.itemColF || {})[k] ? '-fill' : ''}"></i></button></th>`).join('')}
                    <th>연동</th>
                </tr></thead>
                <tbody>${rows.length ? rows.map(tr).join('')
                    : `<tr><td colspan="14" class="it-none">${all.length ? '조건에 맞는 제품이 없습니다' : '제품이 없습니다 — 위 <b>제품 추가</b>로 한 줄 만드세요'}</td></tr>`}</tbody>
                </table>
            </div>
        </div>`;
    }

    renderTechPacks() {
        const list = this._techPacks || [];
        const esc = s => this._vesc(s);
        const when = t => t ? new Date(t).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' }) : '';
        //  제품리스트에서 만든 지시서는 그 제품 이름을 달고 다닌다
        const itemOf = t => (this.pItems || []).find(i => String(i.id) === String(t.item_id) || String(i.tech_pack_id) === String(t.id));
        const tile = t => {
            let thumb = '';
            try { thumb = garmentPreviewSVG(t.config, false); } catch (_e) { thumb = ''; }
            const it = itemOf(t);
            return `<button class="fd-it tp${String(this.tpSel) === String(t.id) ? ' on' : ''}"
                    onclick="app.selectTechPack('${t.id}')" ondblclick="app.openTechPack('${t.id}')"
                    title="${esc(t.style_name || '무제')}">
                <span class="fd-th tp">${thumb || '<i class="ph ph-clipboard-text" style="color:#5e5ce6"></i>'}</span>
                <span class="fd-nm">${esc(t.style_name || '무제')}</span>
                <span class="fd-sub">${t.style_no ? esc(t.style_no) : when(t.created_at)}</span>
                ${it ? `<em class="fd-badge tp"><i class="ph ph-t-shirt"></i></em>` : ''}
            </button>`;
        };
        return `<div class="mp">
            ${this._mpTop('작업지시서', `${list.length}건 · 두 번 누르면 열린다 · ⌘P로 PDF`,
                `<button onclick="app.newTechPack()" class="mbtn pri"><i class="ph ph-plus"></i> 새 작업지시서</button>`)}
            <div class="fd-body">
                ${!this._techPacksLoaded ? this._loadingSkeleton('작업지시서')
                    : (list.length ? `<div class="fd-grid tp">${list.map(tile).join('')}</div>`
                        : `<div class="fd-none">저장된 작업지시서가 없습니다 — <b>샘플·디자인</b>에서 만들어 저장하거나 위 [새 작업지시서]로 시작하세요</div>`)}
            </div>
            <div class="fd-path"><i class="ph ph-clipboard-text"></i><span>작업지시서 ${list.length}건</span></div>
        </div>`;
    }

    _qcFromConfig(cfg, job) {
        const items = (techPackChecklistItems(cfg) || []).map(l => ({ label: l, checked: false }));
        items.push({ label: `수량 확인${job && job.qty ? ` (${job.qty}장)` : ''}`, checked: false });
        items.push({ label: '라벨(메인/케어) 부착', checked: false });
        items.push({ label: '오염·봉제 불량 검수', checked: false });
        items.push({ label: '포장 상태', checked: false });
        return items;
    }

    _qcSpecHTML(packId) {
        const pack = (this._techPacks || []).find(t => t.id === packId);
        if (!pack || !pack.config) return '<p style="color:#888;font-size:0.8rem">지시서를 찾을 수 없음</p>';
        const items = techPackChecklistItems(pack.config);
        return `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">
            <div style="flex:1;min-width:170px">${garmentFlatSVG({ ...pack.config, editMode: false }, false)}</div>
            <div style="flex:1;min-width:150px"><div style="font-weight:700;font-size:0.83rem;margin-bottom:5px;color:#111">지시서 항목</div>${items.map(i => `<div style="font-size:0.79rem;color:#333;padding:3px 0;border-bottom:1px solid #eee">• ${this._vesc(i)}</div>`).join('') || '<span style="color:#888;font-size:0.8rem">항목 없음</span>'}</div>
        </div>`;
    }

    // ============================================================
    //  채널 연동 현황 (몰별 카페24 + 기타 채널)
    // ============================================================
    renderIntegrations() {
        if (!this._mallsLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">연동 정보를 불러오는 중...</div>`;
        const brands = mockData.brands || [];
        const malls = this.malls || [];
        const channels = [
            { key: 'cafe24', label: '카페24', active: true },
            { key: 'musinsa', label: '무신사', active: false },
            { key: '29cm', label: '29CM', active: false },
            { key: 'kidikidi', label: '키디키디', active: false },
            { key: 'smartstore', label: '스마트스토어', active: false },
        ];
        const couriers = ['우체국', 'CJ대한통운', '한진택배', '롯데택배', '로젠택배', '기타'];
        const courierCell = (b) => {
            const cur = (this.brandCouriers || {})[b.id] || '우체국';
            return `<select class="integ-courier" data-brand="${b.id}" style="padding:6px 8px;font-size:0.78rem;border-radius:8px;border:1px solid var(--card-border);background:rgba(148,163,184,0.12);color:var(--text-main);min-width:96px">${couriers.map(c => `<option value="${c}" ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select>`;
        };
        // 브랜드+채널 → 몰 매칭 (cafe24=채널, 봇채널=mall_key/eland)
        const mallFor = (brand, chKey) => malls.find(m => m.brand_id === brand.id && (
            chKey === 'cafe24' ? (m.channel || 'cafe24') === 'cafe24'
                : (m.mall_key === chKey || (chKey === 'kidikidi' && m.channel === 'eland'))
        ));
        // 채널별 실제 연동에 필요한 준비물 — 미연동 셀에 '필요: ...'로 표기.
        const chReq = {
            cafe24: ['몰 아이디', '앱 Client ID', 'Client Secret', 'OAuth 인증'],
            musinsa: ['파트너 계정', '비밀번호', 'OTP 수신 Gmail'],
            '29cm': ['29Connect 계정', '비밀번호', 'OTP 수신 Gmail'],
            kidikidi: ['파트너 계정', '비밀번호', 'OTP 설정키'],
            smartstore: ['커머스API Client ID', 'Client Secret'],
        };
        const reqHint = (chKey) => { const r = chReq[chKey]; return r ? `<div style="font-size:0.6rem;color:var(--text-muted);margin-top:5px;line-height:1.35;max-width:128px">필요: ${r.join(' · ')}</div>` : ''; };
        // 팩트 배지: malls.connected(인증 플래그) 대신 실제 수집 실태(수집중/지연/중단)
        const factBadge = (mall) => { const s = this._channelStatus(mall); return s ? `<span style="font-size:0.72rem;font-weight:700;color:${s.color}">● ${s.label}</span><div style="font-size:0.58rem;color:var(--text-muted);margin-top:1px">${s.sub}</div>` : `<span style="font-size:0.72rem;font-weight:700;color:#22c55e">● 연동됨</span>`;
        };
        const cell = (brand, ch) => {
            const mall = mallFor(brand, ch.key);
            if (ch.key === 'cafe24') {
                if (mall && mall.connected) return `<div style="display:inline-flex;flex-direction:column;gap:3px;align-items:center">${factBadge(mall)}<button class="integ-auth" data-key="${mall.mall_key}" style="font-size:0.68rem;padding:2px 8px;border-radius:7px;border:1px solid var(--card-border);background:transparent;color:var(--text-muted);cursor:pointer;margin-top:3px">재인증</button></div>`;
                if (mall) return `<div style="display:inline-flex;flex-direction:column;gap:5px;align-items:center"><span style="font-size:0.72rem;font-weight:700;color:#f59e0b">○ 미인증</span><button class="integ-auth btn-primary" data-key="${mall.mall_key}" style="font-size:0.7rem;padding:3px 10px;border-radius:7px">인증</button>${reqHint('cafe24')}</div>`;
                return `<div style="display:inline-flex;flex-direction:column;align-items:center"><button class="integ-channel-connect" data-brand="${brand.id}" data-channel="cafe24" style="font-size:0.74rem;padding:5px 11px;border-radius:8px;border:1px dashed rgba(148,163,184,0.5);background:transparent;color:var(--primary);cursor:pointer;font-weight:600"><i class="ph ph-plus"></i> 연동</button>${reqHint('cafe24')}</div>`;
            }
            const connection = (this.channelConnections || []).find(x => x.brand_id === brand.id && x.channel === ch.key);
            if (mall?.connected || connection?.status === 'connected') return `<div style="display:inline-flex;flex-direction:column;gap:3px;align-items:center">${factBadge(mall)}<button class="integ-channel-connect" data-brand="${brand.id}" data-channel="${ch.key}" style="font-size:0.66rem;border:0;background:transparent;color:var(--text-muted);cursor:pointer;margin-top:2px">설정</button></div>`;
            const pending = connection?.status === 'credentials_saved' || connection?.status === 'auth_required';
            const failed = connection?.status === 'error';
            if (pending || failed) return `<div style="display:inline-flex;flex-direction:column;gap:4px;align-items:center"><span style="font-size:0.7rem;font-weight:700;color:${failed ? '#ef4444' : '#f59e0b'}">${failed ? '● 오류' : '○ 인증 필요'}</span><button class="integ-channel-connect" data-brand="${brand.id}" data-channel="${ch.key}" style="font-size:0.7rem;padding:4px 9px;border-radius:7px;border:1px solid var(--card-border);background:transparent;color:var(--primary);cursor:pointer">다시 연동</button>${reqHint(ch.key)}</div>`;
            return `<div style="display:inline-flex;flex-direction:column;align-items:center"><button class="integ-channel-connect" data-brand="${brand.id}" data-channel="${ch.key}" style="font-size:0.74rem;padding:5px 11px;border-radius:8px;border:1px dashed rgba(59,130,246,0.45);background:transparent;color:var(--primary);cursor:pointer;font-weight:600"><i class="ph ph-plus"></i> 연동</button>${reqHint(ch.key)}</div>`;
        };
        const rows = brands.length ? brands.map(b => `<tr style="border-bottom:1px solid var(--card-border)">
            <td style="padding:14px 10px;font-weight:600">${this._vesc(b.name)}</td>
            ${channels.map(ch => `<td style="padding:14px 10px;text-align:center">${cell(b, ch)}</td>`).join('')}
            <td style="padding:14px 10px;text-align:center">${courierCell(b)}</td>
        </tr>`).join('') : `<tr><td colspan="${channels.length + 2}" style="padding:2.5rem;text-align:center;color:var(--text-muted)">브랜드가 없습니다. [브랜드 추가]로 시작하세요.</td></tr>`;
        const ep = this._epostHealth;
        const epColor = ep?.ok ? '#22c55e' : (ep?.error ? '#ef4444' : '#f59e0b');
        const epText = ep?.ok ? `계약 연결 정상${ep.postNm ? ` · ${this._vesc(ep.postNm)}` : ''}` : (ep?.error ? `연결 오류 · ${this._vesc(ep.error)}` : '실제 계약 API 확인 필요');
        return `
        <div class="mp">
            ${this._mpTop('채널 연동', '브랜드별로 판매 채널을 연동하세요',
                `<button id="integ-addbrand-btn" class="mbtn pri"><i class="ph ph-plus"></i> 브랜드 추가</button>`)}
            <div class="mp-body">
            <div class="glass" style="padding:1rem 1.2rem;border-radius:14px;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
                <div><div style="font-size:0.9rem;font-weight:700"><i class="ph ph-package" style="color:#e11d48"></i> 우체국 계약택배</div><div style="font-size:0.78rem;color:${epColor};margin-top:3px">● ${epText}</div></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap"><button id="integ-epost-test" class="btn-secondary" style="padding:8px 14px;border-radius:9px" ${ep?.loading ? 'disabled' : ''}><i class="ph ph-plugs-connected"></i> ${ep?.loading ? '확인 중...' : '연결 테스트'}</button><button id="integ-epost-safe-test" class="btn-primary" style="padding:8px 14px;border-radius:9px" ${ep?.safeLoading ? 'disabled' : ''}><i class="ph ph-shield-check"></i> ${ep?.safeLoading ? '테스트 중...' : '안전 테스트 발번'}</button></div>
            </div>
            <div class="glass" style="padding:1.2rem;border-radius:16px;overflow-x:auto">
                <table class="mtbl" style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:760px">
                    <colgroup><col style="width:16%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:13%"><col style="width:14%"></colgroup>
                    <thead><tr style="color:var(--text-muted);font-size:0.82rem;text-align:left">
                        <th>브랜드</th>${channels.map(ch => `<th style="text-align:center">${ch.label}</th>`).join('')}<th style="text-align:center">택배사</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p style="margin:1rem 0 0;color:var(--text-muted);font-size:0.8rem"><i class="ph ph-shield-check"></i> + 연동에서 채널별 필수 정보만 입력하세요. 비밀번호와 API 키는 화면에 다시 노출되지 않습니다.</p>
        </div></div>`;
    }

    bindIntegrationsEvents() {
        const add = document.getElementById('integ-addbrand-btn');
        if (add) add.onclick = () => this.showAddBrandModal();
        this.appContainer.querySelectorAll('.integ-auth').forEach(x => x.onclick = () => this.authMall(x.dataset.key));
        this.appContainer.querySelectorAll('.integ-channel-connect').forEach(x => x.onclick = () => this.showChannelConnectModal(x.dataset.brand, x.dataset.channel));
        this.appContainer.querySelectorAll('.integ-courier').forEach(s => s.onchange = () => this.saveBrandCourier(s.dataset.brand, s.value));
        const epostTest = document.getElementById('integ-epost-test');
        if (epostTest) epostTest.onclick = () => this.testEpostConnection();
        const epostSafeTest = document.getElementById('integ-epost-safe-test');
        if (epostSafeTest) epostSafeTest.onclick = () => this.runEpostSafeTest();
    }
    showChannelConnectModal(brandId, channel) {
        const brand = (mockData.brands || []).find(b => b.id === brandId);
        const specs = {
            cafe24: { label: '카페24', fields: [['mall_id','카페24 몰 아이디 (주소의 xxx.cafe24.com 중 xxx)','text'],['client_id','앱 Client ID','text'],['client_secret','앱 Client Secret','password']] },
            musinsa: { label: '무신사', fields: [['account_id','계정 아이디','text'],['password','비밀번호','password']] },
            '29cm': { label: '29CM', fields: [['account_id','29Connect 아이디','text'],['password','비밀번호','password'],['otp_email','인증번호 수신 이메일 (선택)','email']] },
            kidikidi: { label: '키디키디', fields: [['account_id','파트너 계정 아이디','text'],['password','비밀번호','password'],['totp_secret','OTP 설정키 (사용 중인 경우)','password']] },
            smartstore: { label: '스마트스토어', fields: [['client_id','API Client ID','text'],['client_secret','API Client Secret','password']] },
        };
        const spec = specs[channel];
        if (!spec) { this.showToast('지원하지 않는 채널입니다.'); return; }
        const c = document.getElementById('global-modal-container');
        c.innerHTML = `<div class="glass modal-content fade-in vmodal" style="width:90%;max-width:480px;padding:2rem;border-radius:20px">
            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:1.2rem"><div><h2 style="margin:0;font-size:1.2rem">${this._vesc(brand?.name || '')} · ${spec.label}</h2><p style="margin:5px 0 0;color:var(--text-muted);font-size:.8rem">필요한 정보만 입력하면 안전하게 저장하고 연결을 준비합니다.</p></div><button onclick="app.closeGlobalModal()" style="border:0;background:transparent;color:var(--text-muted);font-size:1.3rem;cursor:pointer">×</button></div>
            <div style="display:flex;flex-direction:column;gap:10px">${spec.fields.map(([key,label,type]) => `<label style="font-size:.78rem;color:var(--text-muted)">${label}<input class="login-input channel-credential" data-key="${key}" type="${type}" autocomplete="off" style="margin-top:5px;width:100%"></label>`).join('')}</div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:1.3rem"><button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 16px;border-radius:9px">취소</button><button id="channel-connect-save" class="btn-primary" style="padding:9px 18px;border-radius:9px">저장하고 연결</button></div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('channel-connect-save').onclick = () => this.saveChannelConnection(brandId, channel);
    }
    async saveChannelConnection(brandId, channel) {
        const button = document.getElementById('channel-connect-save');
        const authWindow = channel === 'cafe24' ? window.open('', '_blank') : null;
        const credentials = {};
        document.querySelectorAll('.channel-credential').forEach(x => { if (x.value.trim()) credentials[x.dataset.key] = x.value.trim(); });
        if (button) { button.disabled = true; button.textContent = '연결 중...'; }
        try {
            const { data, error } = await this.supabase.functions.invoke('channel-connect', { body: { brand_id: brandId, channel, credentials } });
            if (error) throw error;
            if (!data?.ok) throw new Error(data?.error || '연결 정보를 저장하지 못했습니다.');
            if (authWindow && data.mall_key) authWindow.location.href = this._oauthUrl(data.mall_key);
            this.closeGlobalModal();
            this._mallsLoaded = false;
            await this.loadMalls();
            this.showToast(channel === 'cafe24' ? '정보 저장 완료 · 새 탭에서 카페24 로그인만 완료하세요.' : '정보 저장 완료 · 채널 인증을 준비했습니다.');
        } catch (e) {
            if (authWindow) authWindow.close();
            this.showToast('연동 실패: ' + (e?.message || String(e)));
            if (button) { button.disabled = false; button.textContent = '저장하고 연결'; }
        }
    }
    async testEpostConnection() {
        this._epostHealth = { loading: true };
        this.requestRender();
        try {
            const { data, error } = await this.supabase.functions.invoke('courier-issue', { body: { action: 'appr-no' } });
            if (error) throw error;
            if (!data?.apprNo) throw new Error(data?.message || data?.error || '승인번호 응답 없음');
            this._epostHealth = { ok: true, postNm: data.postNm || '', payTypeNm: data.payTypeNm || '' };
            this.showToast('우체국 계약택배 연결 정상');
        } catch (e) {
            this._epostHealth = { ok: false, error: e?.message || String(e) };
            this.showToast('우체국 연결 오류: ' + this._epostHealth.error);
        }
        this.requestRender();
    }
    async runEpostSafeTest() {
        this._epostHealth = { ...(this._epostHealth || {}), safeLoading: true };
        this.requestRender();
        try {
            // 먼저 등록 공급지를 읽은 뒤 전화번호를 숫자로 정규화한다.
            // 서버 safe-test가 구버전이어도 기존 testYn=Y 경로로 안전하게 검증 가능하다.
            const { data: office, error: officeError } = await this.supabase.functions.invoke('courier-issue', { body: { action: 'get-office' } });
            if (officeError) throw officeError;
            if (!office?.officeZip || !office?.officeAddr) throw new Error(office?.message || '공급지 정보 없음');
            const phone = String(office.officeTelno || '01000000000').replace(/\D/g, '') || '01000000000';
            const orderNo = `BHAS-TEST-${Date.now()}`;
            const order = {
                mallKey: 'epost_test', orderNo, ordCompNm: 'BHAS API TEST', inqTelCn: phone,
                ordNm: office.contactNm || 'BHAS 테스트', ordZip: office.officeZip,
                ordAddr1: office.officeAddr, ordAddr2: '테스트 접수', ordTel: phone,
                recNm: office.contactNm || 'BHAS 테스트', recZip: office.officeZip,
                recAddr1: office.officeAddr, recAddr2: '테스트 접수', recTel: phone,
                goodsNm: '의류 API 테스트', qty: 1, weight: 1, volume: 60, printYn: 'N',
            };
            const { data, error } = await this.supabase.functions.invoke('courier-issue', { body: { test: true, orders: [order] } });
            if (error) throw error;
            const result = data?.results?.[0];
            if (!data?.ok || data?.testYn !== 'Y' || !result?.ok) throw new Error(result?.message || data?.error || '테스트 응답 없음');
            this._epostHealth = { ...(this._epostHealth || {}), safeLoading: false, safeOk: true };
            this.showToast('우체국 안전 테스트 성공 · 실접수/요금/배송 변경 없음');
        } catch (e) {
            this._epostHealth = { ...(this._epostHealth || {}), safeLoading: false, safeOk: false };
            this.showToast('우체국 안전 테스트 실패: ' + (e?.message || String(e)));
        }
        this.requestRender();
    }
    async loadBrandSettings() {
        this._bsLoading = true;
        try {
            const { data } = await this.supabase.from('brand_settings').select('*');
            this.brandCouriers = {};
            (data || []).forEach(r => { this.brandCouriers[r.brand_id] = r.courier; });
            this._bsLoaded = true;
        } catch (e) { this.brandCouriers = {}; this._bsLoaded = true; }
        this._bsLoading = false;
        this.requestRender();
    }
    async saveBrandCourier(brandId, courier) {
        this.brandCouriers = this.brandCouriers || {}; this.brandCouriers[brandId] = courier;
        const { error } = await this.supabase.from('brand_settings').upsert({ brand_id: brandId, courier }, { onConflict: 'brand_id' });
        if (error) { this.showToast('택배사 저장 실패: ' + error.message); return; }
        this.showToast('택배사: ' + courier);
    }

    // ============================================================
    //  견적 시스템 (사업자 고객 대상, 세금계산서 소스)
    // ============================================================
    _won(n) { return (Number(n) || 0).toLocaleString('ko-KR'); }
    _quoteStatusLabel(s) { return ({ draft: '작성중', sent: '발송', confirmed: '확정' })[s] || s; }
    _addDays(dateStr, n) { if (!dateStr) return ''; const d = new Date(dateStr); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
    _defaultQuoteTerms() {
        return [
            '브하스는 의뢰인의 제품 제작을 위한 제작 대행 업무를 수행합니다. 제품의 디자인, 사이즈 스펙, 원단 선택 및 최종 사양에 대한 결정 및 책임은 의뢰인에게 있으며, 의뢰인이 최종 승인한 내용에 따라 제작이 진행됩니다. 승인 이후 발생하는 결과물에 대한 책임은 의뢰인에게 귀속됩니다.',
            '대량 생산의 특성상 ±1~3cm의 사이즈 오차가 발생할 수 있습니다. 염색 및 워싱 제품의 경우 동일 컬러 내에서도 탕 차이(미세한 색상 차이)가 발생할 수 있으며, 이는 원단 생산 및 가공 과정에서 발생하는 특성으로 브하스의 책임에 해당하지 않습니다. 또한 공장 기준상 정상 범위로 판단되는 사항은 불량으로 간주하지 않습니다.',
            '불량 판정은 생산 공장의 A급 기준을 따르며, 기능상 문제가 없는 미세한 실밥, 잡사, 초크 자국, 미세 오염 등은 불량에 해당하지 않습니다. 명확한 제작상 하자가 확인된 경우에 한하여 보완 또는 재작업 여부를 상호 협의합니다.',
            '의뢰인의 디자인 및 제작 관련 정보는 외부에 공유하지 않습니다. 단, 브하스의 포트폴리오 활용 여부는 사전 협의 후 결정합니다. 또한 브하스는 제작 대행 업무를 수행하며, 완성된 제품의 판매 결과, 재고 부담, 마케팅 성과 및 수익에 대해서는 책임을 지지 않습니다.',
            '모든 원·부자재가 공장에 입고 완료된 이후 제품 완성까지는 최소 2주에서 최대 4주가 소요됩니다. 다만, 공장 상황, 원단 수급, 생산 물량 등에 따라 일정은 변동될 수 있습니다.',
            '본 계약에서 청구되는 제작 대행 비용은 핸들링비용이 포함되며, 원·부자재 비용, 그레이딩 패턴 비용, 운송비 등을 제외한 금액일 수 있습니다. 이 경우 해당 비용은 실제 발생 금액에 따라 별도로 청구됩니다.',
        ].map((t, i) => `${i + 1}. ${t}`).join('\n');
    }
    async loadQuotes() {
        this._quotesLoading = true;
        try {
            const [qRes, cRes] = await Promise.all([
                this.supabase.from('quotes').select('*').order('created_at', { ascending: false }),
                this.supabase.from('clients').select('*').order('name', { ascending: true }),
            ]);
            this.quotes = qRes.data || [];
            this.clients = cRes.data || [];
            this._quotesLoaded = true;
        } catch (e) { this.showToast('견적을 불러오지 못했습니다. (008/010 SQL 설치 필요)'); this.quotes = []; this.clients = this.clients || []; this._quotesLoaded = true; }
        this._quotesLoading = false;
        this.requestRender();
    }
    renderQuotes() {
        if (!this._quotesLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">견적을 불러오는 중...</div>`;
        let qs = this.quotes || [];
        if ((this.quoteStatus || 'ALL') !== 'ALL') qs = qs.filter(q => (q.status || 'draft') === this.quoteStatus);
        if ((this.quoteClient || 'ALL') !== 'ALL') qs = qs.filter(q => q.client_name === this.quoteClient);
        const stc = st => st === 'confirmed' ? '#30d158' : (st === 'sent' ? '#0a84ff' : '#ff9f0a');
        qs = this._applyTbl('quotes', qs, (q, k2) => ({
            quote_date: q.quote_date || '', client_name: q.client_name || '',
            item: ((this.pItems || []).find(i => String(i.id) === String(q.item_id) || String(i.quote_id) === String(q.id)) || {}).name || '',
            n: (q.items || []).length, total_amount: Number(q.total_amount) || 0,
            status: this._quoteStatusLabel(q.status || 'draft'),
        })[k2] ?? '', this.quotes || []);
        const rows = qs.map(q => {
            const it = (this.pItems || []).find(i => String(i.id) === String(q.item_id) || String(i.quote_id) === String(q.id));
            return `<tr class="it-row q-row" data-id="${q.id}">
                <td class="nw">${this._vesc(q.quote_date || '')}</td>
                <td class="bd">${this._vesc(q.client_name || '')}</td>
                <td>${it ? `<span class="it-tag" style="--c:#0a84ff">${this._vesc(it.name || '제품')}</span>` : ''}</td>
                <td>${(q.items || []).length}개 품목</td>
                <td class="num">${this._won(q.total_amount)}</td>
                <td><span class="it-tag" style="--c:${stc(q.status)}">${this._quoteStatusLabel(q.status)}</span>${q.tax_status === 'issued' ? ' <span class="it-tag" style="--c:#30d158">계산서</span>' : ''}</td>
                <td class="it-c"><button class="it-ib q-print" data-id="${q.id}" title="인쇄"><i class="ph ph-printer"></i></button></td>
            </tr>`;
        }).join('') || `<tr><td colspan="7" class="it-none">견적서가 없습니다 — 위 [새 견적]으로 시작하세요</td></tr>`;
        return `
        <div class="mp">
            ${this._mpTop('견적서', `${qs.length}건 · 엑셀 대체`,
                `<button id="q-new-btn" class="mbtn pri"><i class="ph ph-plus"></i> 새 견적</button>`)}
            <div class="it-scroll">
                <table class="it-tbl"><thead><tr>
                    ${this._thead('quotes', [['quote_date', '견적일'], ['client_name', '고객사'], ['item', '제품'],
                        ['n', '품목', 'num'], ['total_amount', '합계', 'num'], ['status', '상태']])}<th class="it-c">인쇄</th>
                </tr></thead><tbody>${rows}</tbody></table>
            </div>
        </div>`;
    }
    bindQuotesEvents() {
        const n = document.getElementById('q-new-btn'); if (n) n.onclick = () => this.showQuoteModal();
        this.appContainer.querySelectorAll('.q-row').forEach(r => r.onclick = (e) => { if (e.target.closest('.q-print')) return; this.showQuoteModal(r.dataset.id); });
        this.appContainer.querySelectorAll('.q-print').forEach(b => b.onclick = (e) => { e.stopPropagation(); const q = (this.quotes || []).find(x => x.id === b.dataset.id); if (q) this.printQuote(q); });
    }
    _quoteItemRow(it = {}) {
        const supply = (Number(it.qty) || 0) * (Number(it.price) || 0);
        return `<div class="q-item" style="display:grid;grid-template-columns:1.25fr 52px 48px 72px 82px 72px 1fr 22px;gap:5px;align-items:center;margin-bottom:6px">
            <input class="q-name login-input" placeholder="품목명" value="${it.name ? this._vesc(it.name) : ''}" style="padding:7px 8px">
            <input class="q-spec login-input" placeholder="규격" value="${it.spec ? this._vesc(it.spec) : ''}" style="padding:7px 8px">
            <input class="q-qty login-input" type="number" placeholder="수량" value="${it.qty ?? ''}" style="padding:7px 8px;text-align:right">
            <input class="q-price login-input" type="number" placeholder="단가" value="${it.price ?? ''}" style="padding:7px 8px;text-align:right">
            <span class="q-amt" style="text-align:right;font-size:0.8rem;font-variant-numeric:tabular-nums">${this._won(supply)}</span>
            <input class="q-tax login-input" type="number" placeholder="세액" value="${it.tax ?? ''}" style="padding:7px 8px;text-align:right">
            <input class="q-note login-input" placeholder="비고" value="${it.note ? this._vesc(it.note) : ''}" style="padding:7px 8px">
            <button class="q-del" style="background:none;border:none;color:var(--text-muted);cursor:pointer"><i class="ph ph-x"></i></button>
        </div>`;
    }
    showQuoteModal(id) {
        const q = id ? (this.quotes || []).find(x => x.id === id) : null;
        const items = q && Array.isArray(q.items) && q.items.length ? q.items : [{}];
        const c = document.getElementById('global-modal-container'); if (!c) return;
        c.innerHTML = `
        <div class="glass modal-content fade-in vmodal" style="width:94%;max-width:720px;padding:1.8rem;border-radius:20px;max-height:92vh;overflow-y:auto">
            <h2 style="margin:0 0 1.2rem;font-size:1.2rem"><i class="ph ph-receipt"></i> ${q ? '견적서 수정' : '새 견적서'}</h2>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;align-items:end">
                <div><label style="font-size:0.74rem;color:var(--text-muted)">견적일</label><input id="q-date" type="date" class="login-input" value="${q?.quote_date || kstYMD()}"></div>
                <div style="font-size:0.82rem;color:var(--text-muted);padding-bottom:11px">유효기간 <b id="q-valid-lbl" style="color:var(--text-main)">견적일 +7일</b></div>
            </div>
            <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin:8px 0 6px">고객사 (거래처)</div>
            <div style="display:flex;gap:8px;margin-bottom:8px">
                <select id="q-clientsel" class="login-input" style="flex:1"><option value="">거래처 선택…</option>${(this.clients || []).map(cl => `<option value="${cl.id}">${this._vesc(cl.name)}${cl.biz_no ? ' (' + this._vesc(cl.biz_no) + ')' : ''}</option>`).join('')}</select>
                <button id="q-addclient" type="button" class="btn-secondary" style="padding:8px 12px;border-radius:9px;white-space:nowrap"><i class="ph ph-plus"></i> 거래처 추가</button>
            </div>
            <div id="q-addclient-form" style="display:none;flex-direction:column;gap:8px;padding:12px;background:rgba(148,163,184,0.1);border-radius:10px;margin-bottom:8px">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input id="ac-name" class="login-input" placeholder="상호 *"><input id="ac-biz" class="login-input" placeholder="사업자등록번호"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px"><input id="ac-ceo" class="login-input" placeholder="대표자"><input id="ac-contact" class="login-input" placeholder="담당자"><input id="ac-tel" class="login-input" placeholder="연락처"></div>
                <button id="ac-save" type="button" class="btn-primary" style="padding:8px;border-radius:9px">거래처 저장</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px">
                <input id="q-client" class="login-input" placeholder="상호 *" value="${q ? this._vesc(q.client_name) : ''}">
                <input id="q-biz" class="login-input" placeholder="사업자등록번호" value="${q ? this._vesc(q.client_biz_no || '') : ''}">
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px">
                <input id="q-ceo" class="login-input" placeholder="대표자" value="${q ? this._vesc(q.client_ceo || '') : ''}">
                <input id="q-contact" class="login-input" placeholder="담당자" value="${q ? this._vesc(q.client_contact || '') : ''}">
                <input id="q-tel" class="login-input" placeholder="연락처" value="${q ? this._vesc(q.client_tel || '') : ''}">
            </div>
            <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin:8px 0 6px">품목</div>
            <div style="display:grid;grid-template-columns:1.25fr 52px 48px 72px 82px 72px 1fr 22px;gap:5px;font-size:0.66rem;color:var(--text-muted);margin-bottom:4px;padding:0 2px">
                <span>품목명</span><span>규격</span><span style="text-align:right">수량</span><span style="text-align:right">단가</span><span style="text-align:right">공급가액</span><span style="text-align:right">세액</span><span>비고</span><span></span>
            </div>
            <div id="q-items">${items.map(it => this._quoteItemRow(it)).join('')}</div>
            <button id="q-additem" style="margin-top:6px;background:none;border:1px dashed rgba(148,163,184,0.4);color:var(--text-muted);padding:6px 12px;border-radius:8px;cursor:pointer;font-size:0.8rem"><i class="ph ph-plus"></i> 품목 추가</button>
            <div style="margin-top:14px;padding:12px 14px;background:rgba(148,163,184,0.1);border-radius:10px;display:flex;flex-direction:column;gap:5px;font-size:0.9rem">
                <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">공급가액</span><span id="q-supply" style="font-variant-numeric:tabular-nums">0</span></div>
                <div style="display:flex;justify-content:space-between"><span style="color:var(--text-muted)">세액 (10%)</span><span id="q-tax" style="font-variant-numeric:tabular-nums">0</span></div>
                <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.05rem;border-top:1px solid var(--card-border);padding-top:6px;margin-top:2px"><span>합계</span><span id="q-total" style="font-variant-numeric:tabular-nums">0</span></div>
            </div>
            <details style="margin-top:12px" ${q && q.terms ? '' : ''}>
                <summary style="cursor:pointer;font-size:0.82rem;font-weight:700;color:var(--text-muted);padding:4px 0"><i class="ph ph-note-pencil"></i> 특약사항 (자세히 보기 / 수정)</summary>
                <textarea id="q-terms" class="login-input" style="margin-top:8px;min-height:180px;resize:vertical;font-size:0.8rem;line-height:1.6">${this._vesc((q && q.terms) || this._defaultQuoteTerms())}</textarea>
            </details>
            <textarea id="q-memo" class="login-input" placeholder="비고/메모" style="margin-top:10px;min-height:46px;resize:vertical">${q ? this._vesc(q.memo || '') : ''}</textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:1.3rem;gap:8px;flex-wrap:wrap">
                <div style="display:flex;gap:8px;flex-wrap:wrap">${q ? `<button id="q-delete" class="btn-secondary" style="padding:9px 12px;border-radius:10px;color:#ef4444">삭제</button><button id="q-print2" class="btn-secondary" style="padding:9px 12px;border-radius:10px"><i class="ph ph-printer"></i> 인쇄</button><button id="q-image2" class="btn-secondary" style="padding:9px 12px;border-radius:10px"><i class="ph ph-image"></i> 이미지</button><button id="q-tax" class="btn-secondary" style="padding:9px 12px;border-radius:10px;color:${q.tax_status === 'issued' ? '#22c55e' : '#3b82f6'}">${q.tax_status === 'issued' ? '<i class="ph ph-check-circle"></i> 계산서 발행됨' : '<i class="ph ph-file-text"></i> 세금계산서'}</button>` : ''}</div>
                <div style="display:flex;gap:8px">
                    <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 18px;border-radius:10px">취소</button>
                    <button id="q-save" class="btn-primary" style="padding:9px 18px;border-radius:10px">저장</button>
                </div>
            </div>
        </div>`;
        c.style.display = 'flex';
        const cont = document.getElementById('q-items');
        const bindRow = (row) => {
            row.querySelectorAll('.q-qty,.q-price,.q-tax').forEach(inp => inp.oninput = () => this.recalcQuote());
            const del = row.querySelector('.q-del'); if (del) del.onclick = () => { if (cont.querySelectorAll('.q-item').length > 1) { row.remove(); this.recalcQuote(); } };
        };
        cont.querySelectorAll('.q-item').forEach(bindRow);
        document.getElementById('q-additem').onclick = () => { cont.insertAdjacentHTML('beforeend', this._quoteItemRow({})); bindRow(cont.lastElementChild); };
        document.getElementById('q-save').onclick = () => this.saveQuote(id);
        const dl = document.getElementById('q-delete'); if (dl) dl.onclick = () => this.deleteQuote(id);
        const p2 = document.getElementById('q-print2'); if (p2) p2.onclick = () => { const qq = (this.quotes || []).find(x => x.id === id); if (qq) this.printQuote(qq); };
        const im2 = document.getElementById('q-image2'); if (im2) im2.onclick = () => { const qq = (this.quotes || []).find(x => x.id === id); if (qq) this.saveQuoteImage(qq); };
        const tx = document.getElementById('q-tax'); if (tx) tx.onclick = () => { const qq = (this.quotes || []).find(x => x.id === id); if (qq) this.showTaxInvoiceModal(qq); };
        const dateEl = document.getElementById('q-date'); const vlbl = document.getElementById('q-valid-lbl');
        const updValid = () => { if (vlbl) vlbl.textContent = dateEl.value ? this._addDays(dateEl.value, 7) : '견적일 +7일'; };
        if (dateEl) { dateEl.onchange = updValid; updValid(); }
        const sel = document.getElementById('q-clientsel');
        if (sel) sel.onchange = () => { const cl = (this.clients || []).find(x => x.id === sel.value); if (cl) { document.getElementById('q-client').value = cl.name || ''; document.getElementById('q-biz').value = cl.biz_no || ''; document.getElementById('q-ceo').value = cl.ceo || ''; document.getElementById('q-contact').value = cl.contact || ''; document.getElementById('q-tel').value = cl.tel || ''; } };
        const ac = document.getElementById('q-addclient'); if (ac) ac.onclick = () => { const f = document.getElementById('q-addclient-form'); f.style.display = f.style.display === 'none' ? 'flex' : 'none'; };
        const acs = document.getElementById('ac-save'); if (acs) acs.onclick = () => this.saveClientInline();
        this.recalcQuote();
    }
    async saveClientInline() {
        const name = document.getElementById('ac-name').value.trim();
        if (!name) { this.showToast('상호는 필수입니다.'); return; }
        const row = { name, biz_no: document.getElementById('ac-biz').value.trim() || null, ceo: document.getElementById('ac-ceo').value.trim() || null, contact: document.getElementById('ac-contact').value.trim() || null, tel: document.getElementById('ac-tel').value.trim() || null };
        const { data, error } = await this.supabase.from('clients').insert([row]).select().single();
        if (error) { this.showToast('거래처 저장 실패: ' + error.message); return; }
        this.clients = this.clients || []; this.clients.push(data); this.clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const sel = document.getElementById('q-clientsel');
        const opt = document.createElement('option'); opt.value = data.id; opt.textContent = data.name + (data.biz_no ? ' (' + data.biz_no + ')' : ''); sel.appendChild(opt); sel.value = data.id;
        document.getElementById('q-client').value = data.name || ''; document.getElementById('q-biz').value = data.biz_no || '';
        document.getElementById('q-ceo').value = data.ceo || ''; document.getElementById('q-contact').value = data.contact || ''; document.getElementById('q-tel').value = data.tel || '';
        document.getElementById('q-addclient-form').style.display = 'none';
        ['ac-name', 'ac-biz', 'ac-ceo', 'ac-contact', 'ac-tel'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
        this.showToast('거래처 추가됨');
    }
    _readQuoteItems() {
        return [...document.querySelectorAll('#q-items .q-item')].map(r => {
            const qty = Number(r.querySelector('.q-qty').value) || 0;
            const price = Number(r.querySelector('.q-price').value) || 0;
            const tax = Number(r.querySelector('.q-tax').value) || 0;
            return { name: r.querySelector('.q-name').value.trim(), spec: r.querySelector('.q-spec').value.trim(), qty, price, supply: qty * price, tax, note: r.querySelector('.q-note').value.trim() };
        }).filter(it => it.name || it.supply || it.tax);
    }
    recalcQuote() {
        let supply = 0, tax = 0;
        document.querySelectorAll('#q-items .q-item').forEach(r => {
            const s = (Number(r.querySelector('.q-qty').value) || 0) * (Number(r.querySelector('.q-price').value) || 0);
            r.querySelector('.q-amt').textContent = this._won(s);
            supply += s;
            tax += Number(r.querySelector('.q-tax').value) || 0;
        });
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = this._won(v); };
        set('q-supply', supply); set('q-tax', tax); set('q-total', supply + tax);
    }
    async saveQuote(id) {
        const client = document.getElementById('q-client').value.trim();
        if (!client) { this.showToast('고객사 상호는 필수입니다.'); return; }
        const items = this._readQuoteItems();
        const supply = items.reduce((s, it) => s + it.supply, 0);
        const tax = items.reduce((s, it) => s + it.tax, 0);
        const row = {
            client_name: client,
            client_biz_no: document.getElementById('q-biz').value.trim() || null,
            client_ceo: document.getElementById('q-ceo').value.trim() || null,
            client_contact: document.getElementById('q-contact').value.trim() || null,
            client_tel: document.getElementById('q-tel').value.trim() || null,
            items, supply_amount: supply, tax_amount: tax, total_amount: supply + tax,
            quote_date: document.getElementById('q-date').value || null,
            valid_until: this._addDays(document.getElementById('q-date').value, 7) || null,
            terms: document.getElementById('q-terms') ? document.getElementById('q-terms').value : null,
            memo: document.getElementById('q-memo').value.trim() || null,
        };
        let error;
        if (id) ({ error } = await this.supabase.from('quotes').update(row).eq('id', id));
        else ({ error } = await this.supabase.from('quotes').insert([row]));
        if (error) { this.showToast('저장 실패: ' + error.message); return; }
        this.closeGlobalModal();
        this._quotesLoaded = false; await this.loadQuotes();
        this.showToast('견적서 저장됨');
    }
    async deleteQuote(id) {
        if (!await this.showConfirm('이 견적서를 삭제할까요?', '삭제')) return;
        const { error } = await this.supabase.from('quotes').delete().eq('id', id);
        if (error) { this.showToast('삭제 실패: ' + error.message); return; }
        this.closeGlobalModal(); this._quotesLoaded = false; await this.loadQuotes();
    }
    _quoteDoc(q) {
        const esc = (s) => this._vesc(s);
        const rows = (q.items || []).map((it) => `<tr><td>${esc(it.name || '')}</td><td style="text-align:center">${esc(it.spec || '')}</td><td style="text-align:right">${(it.qty || 0).toLocaleString()}</td><td style="text-align:right">${(it.price || 0).toLocaleString()}</td><td style="text-align:right">${((it.qty || 0) * (it.price || 0)).toLocaleString()}</td><td style="text-align:right">${(it.tax || 0).toLocaleString()}</td><td>${esc(it.note || '')}</td></tr>`).join('');
        const termsText = (q.terms && q.terms.trim()) ? q.terms : this._defaultQuoteTerms();
        const terms = termsText.split('\n').filter(l => l.trim()).map(l => `<div style="margin-bottom:7px">${esc(l)}</div>`).join('');
        const css = `
            .qh{width:800px;box-sizing:border-box;padding:34px 40px;background:#fff;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#2b2b2b;font-size:12.5px;margin:0 auto}
            .qh .head{text-align:center;font-size:23px;font-weight:800;color:#8a7a5c;letter-spacing:4px;border-bottom:3px solid #cdbfa3;padding-bottom:13px;margin-bottom:22px}
            .qh .top{display:flex;justify-content:space-between;gap:22px;margin-bottom:20px}
            .qh .recv td{padding:6px 10px}
            .qh .recv .l{font-weight:700;width:64px}
            .qh .sup{border-collapse:collapse}
            .qh .sup td{border:1px solid #b7ac93;padding:5px 10px;font-size:11.5px}
            .qh .sup .l{background:#f3efe4;font-weight:700;text-align:center;width:84px}
            .qh .amt{font-size:19px;font-weight:800;margin:6px 0 15px}
            .qh .items{width:100%;border-collapse:collapse;margin-bottom:6px}
            .qh .items th{background:#f3efe4;border:1px solid #b7ac93;padding:7px;font-size:11.5px}
            .qh .items td{border:1px solid #b7ac93;padding:6px 8px}
            .qh .items tfoot td{background:#faf7f0;font-weight:700}
            .qh .terms{border:1px solid #d8cdb4;border-radius:4px;padding:14px 16px;margin-top:22px;font-size:10.5px;color:#555;line-height:1.55}
            .qh .terms .tt{text-align:center;font-weight:700;color:#333;margin-bottom:9px;font-size:12px}
            .qh .bank{text-align:center;font-weight:700;margin-top:14px;padding:9px;background:#f3efe4;border-radius:4px}`;
        const body = `<div class="qh">
            <div class="head">브하스 의류제작 견적서</div>
            <div class="top">
                <table class="recv"><tr><td class="l">수 신</td><td>${esc(q.client_name || '')} 대표님 귀하</td></tr><tr><td class="l">견 적 일</td><td>${q.quote_date || ''}</td></tr></table>
                <table class="sup">
                    <tr><td class="l">상호</td><td>주식회사 이일칠구</td></tr>
                    <tr><td class="l">사업자번호</td><td>279-88-03052</td></tr>
                    <tr><td class="l">주소</td><td>인천광역시 하늘중앙로 225번길 20, 507-8호</td></tr>
                    <tr><td class="l">대표</td><td>김석원</td></tr>
                    <tr><td class="l">TEL</td><td>담당자 방보경 010-9072-7003</td></tr>
                </table>
            </div>
            <div class="amt">견적금액　${(q.total_amount || 0).toLocaleString()} 원 정</div>
            <table class="items">
                <thead><tr><th>품목명</th><th style="width:8%">규격</th><th style="width:9%">총 수량</th><th style="width:11%">단가</th><th style="width:14%">공급가액</th><th style="width:11%">세액</th><th style="width:18%">비고</th></tr></thead>
                <tbody>${rows}</tbody>
                <tfoot><tr><td colspan="4" style="text-align:center">합 계</td><td style="text-align:right">공급가액 ${(q.supply_amount || 0).toLocaleString()}</td><td style="text-align:right">VAT ${(q.tax_amount || 0).toLocaleString()}</td><td style="text-align:right">합계 ${(q.total_amount || 0).toLocaleString()}</td></tr></tfoot>
            </table>
            ${q.memo ? `<div style="margin-top:10px;font-size:11px;color:#555">비고: ${esc(q.memo)}</div>` : ''}
            <div class="terms"><div class="tt">참고사항</div>${terms}</div>
            <div class="bank">입금계좌: 기업은행 988-026117-04-012 (주)더하임프로모션</div>
        </div>`;
        return { css, body };
    }
    printQuote(q) {
        const { css, body } = this._quoteDoc(q);
        const w = window.open('', '_blank', 'width=900,height=1100');
        if (!w) { this.showToast('팝업이 차단되었습니다. 팝업 허용 후 다시 시도하세요.'); return; }
        w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>브하스 의류제작 견적서 - ${this._vesc(q.client_name || '')}</title><style>${css}</style></head><body>${body}</body></html>`);
        w.document.close(); w.focus();
        setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
    }
    async saveQuoteImage(q) {
        if (typeof html2canvas === 'undefined') { this.showToast('이미지 라이브러리 로딩 중입니다. 잠시 후 다시 시도하세요.'); return; }
        const { css, body } = this._quoteDoc(q);
        const holder = document.createElement('div');
        holder.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff';
        holder.innerHTML = `<style>${css}</style>${body}`;
        document.body.appendChild(holder);
        try {
            const target = holder.querySelector('.qh');
            const canvas = await html2canvas(target, { scale: 2, backgroundColor: '#ffffff' });
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = `견적서_${(q.client_name || '견적').replace(/[^\w가-힣]/g, '')}_${q.quote_date || ''}.png`;
            a.click();
            this.showToast('이미지 저장됨');
        } catch (e) { this.showToast('이미지 생성 실패: ' + (e.message || e)); }
        finally { holder.remove(); }
    }
    showTaxInvoiceModal(q) {
        if (q.tax_status === 'issued') { this.showToast('이미 발행됨 (관리번호 ' + (q.tax_mgtkey || '') + ')'); return; }
        const client = (this.clients || []).find(c => c.name === q.client_name && (c.biz_no || '') === (q.client_biz_no || ''));
        const email = (client && client.email) || '';
        const c = document.getElementById('global-modal-container'); if (!c) return;
        c.innerHTML = `
        <div class="glass modal-content fade-in vmodal" style="width:92%;max-width:460px;padding:1.8rem;border-radius:20px">
            <h2 style="margin:0 0 1rem;font-size:1.15rem"><i class="ph ph-file-text"></i> 세금계산서 발행</h2>
            <div style="font-size:0.85rem;color:var(--text-muted);margin-bottom:14px">${this._vesc(q.client_name)} ${q.client_biz_no ? '(' + this._vesc(q.client_biz_no) + ')' : '<span style="color:#ef4444">사업자번호 없음</span>'} · 합계 <b style="color:var(--text-main)">${this._won(q.total_amount)}원</b></div>
            <div style="display:flex;flex-direction:column;gap:10px">
                <div><label style="font-size:0.74rem;color:var(--text-muted)">작성일자 (= 실제 공급/납품일)</label><input id="tx-date" type="date" class="login-input" value="${kstYMD()}"></div>
                <div><label style="font-size:0.74rem;color:var(--text-muted)">공급받는자 이메일</label><input id="tx-email" class="login-input" placeholder="세금계산서 받을 이메일" value="${this._vesc(email)}"></div>
                <div style="display:flex;gap:14px;padding:2px"><label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer"><input type="radio" name="tx-purpose" value="영수" checked style="accent-color:var(--primary)"> 영수</label><label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer"><input type="radio" name="tx-purpose" value="청구" style="accent-color:var(--primary)"> 청구</label></div>
            </div>
            <div style="font-size:0.78rem;color:#f59e0b;margin-top:10px;line-height:1.5"><i class="ph ph-warning"></i> 작성일자는 실제 납품일 기준. 다음 달 10일 전 발행해야 가산세 없어요.</div>
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:1.3rem">
                <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 18px;border-radius:10px">취소</button>
                <button id="tx-issue" class="btn-primary" style="padding:9px 18px;border-radius:10px">발행</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        document.getElementById('tx-issue').onclick = () => this.issueTaxInvoice(q);
    }
    async issueTaxInvoice(q) {
        const email = document.getElementById('tx-email').value.trim();
        const supplyDate = document.getElementById('tx-date').value;
        const purposeType = (document.querySelector('input[name="tx-purpose"]:checked') || {}).value || '영수';
        if (!q.client_biz_no) { this.showToast('고객사 사업자번호가 없습니다. 견적에서 입력하세요.'); return; }
        if (!email) { this.showToast('공급받는자 이메일을 입력하세요.'); return; }
        this.showToast('발행 중...');
        try {
            const { data, error } = await this.supabase.functions.invoke('taxinvoice-issue', { body: { quote_id: q.id, email, supplyDate, purposeType } });
            if (error || !data || !data.ok) { this.showToast('발행 실패: ' + ((data && data.error) || (error && error.message) || '팝빌 미설정/키 필요')); return; }
            this.closeGlobalModal(); this._quotesLoaded = false; await this.loadQuotes();
            this.showToast('세금계산서 발행 완료');
        } catch (e) { this.showToast('발행 오류: ' + (e.message || e)); }
    }

    // ── 칸 너비 조절 ────────────────────────────────────────
    //  3단 사이 경계를 끌면 늘고 준다. 창마다·화면마다 따로 기억한다.
    PANES = [
        { sel: '.appwrap', vars: ['--c1'], min: [120], max: [360] },
        { sel: '.appwrap.three', vars: ['--c1', '--c3'], min: [120, 180], max: [360, 520] },
        { sel: '.nt', vars: ['--c1', '--c2'], min: [140, 190], max: [380, 520] },
        { sel: '.fd', vars: ['--c1', '--c3'], min: [130, 150], max: [380, 480] },
        { sel: '.m3', vars: ['--c1', '--c2'], min: [140, 190], max: [380, 520] },
    ];
    _paneKey(el, view) { return `pw:${view || this.currentView || ''}:${el.className.split(' ')[0]}`; }
    _mountGrips() {
        const seen = new Set();
        document.querySelectorAll('.macwin .appwrap, .macwin .nt, .macwin .fd, .macwin .m3').forEach(box => {
            if (seen.has(box)) return; seen.add(box);
            const spec = box.classList.contains('appwrap')
                ? (box.classList.contains('three') ? this.PANES[1] : this.PANES[0])
                : this.PANES.find(p => box.classList.contains(p.sel.slice(1)));
            if (!spec) return;
            const win = box.closest('.macwin');
            const view = win ? ((this.wins || []).find(w => w.id === win.id) || {}).view : this.currentView;
            const key = this._paneKey(box, view);

            // 기억해 둔 너비 되살리기
            let saved = {};
            try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch (_e) {}
            spec.vars.forEach(v => { if (saved[v]) box.style.setProperty(v, saved[v] + 'px'); });

            box.querySelectorAll(':scope > .pgrip').forEach(g => g.remove());
            const panes = [...box.children].filter(x => !x.classList.contains('pgrip'));
            //  경계는 '그 칸이 끝나는 자리' — 마지막 칸 뒤에는 안 둔다
            const edges = spec.vars.map((v, i) => (v === '--c3' ? panes.length - 1 : i + 1));
            edges.forEach((edgeIdx, i) => {
                const grip = document.createElement('div');
                grip.className = 'pgrip';
                grip.style.left = panes.slice(0, edgeIdx).reduce((s, p) => s + p.offsetWidth, 0) + 'px';
                grip.title = '끌어서 너비 조절 · 두 번 누르면 처음대로';
                const vr = spec.vars[i], lo = spec.min[i], hi = spec.max[i];
                const fromRight = (vr === '--c3');
                grip.onmousedown = (e) => {
                    e.preventDefault();
                    const startX = e.clientX;
                    const base = panes[fromRight ? panes.length - 1 : i].offsetWidth;
                    grip.classList.add('on'); document.body.classList.add('pgripping');
                    const move = (ev) => {
                        const d = ev.clientX - startX;
                        const w = Math.max(lo, Math.min(hi, base + (fromRight ? -d : d)));
                        box.style.setProperty(vr, w + 'px');
                        grip.style.left = panes.slice(0, edgeIdx).reduce((s, p) => s + p.offsetWidth, 0) + 'px';
                    };
                    const up = () => {
                        document.removeEventListener('mousemove', move);
                        document.removeEventListener('mouseup', up);
                        grip.classList.remove('on'); document.body.classList.remove('pgripping');
                        const out = {};
                        spec.vars.forEach(v => {
                            const px = parseInt(box.style.getPropertyValue(v), 10);
                            if (px) out[v] = px;
                        });
                        try { localStorage.setItem(key, JSON.stringify(out)); } catch (_e) {}
                        this._mountGrips();
                    };
                    document.addEventListener('mousemove', move);
                    document.addEventListener('mouseup', up);
                };
                grip.ondblclick = () => {
                    spec.vars.forEach(v => box.style.removeProperty(v));
                    try { localStorage.removeItem(key); } catch (_e) {}
                    this._mountGrips();
                };
                box.appendChild(grip);
            });
        });
    }

    //  ⌘K · ⌘F 는 어디서든 먹는다. 한 번만 단다.
    _bindFindKey() {
        if (this._findKeyBound) return;
        this._findKeyBound = true;
        document.addEventListener('keydown', (e) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            const k = (e.key || '').toLowerCase();
            if (k !== 'k' && k !== 'f') return;
            if (!this.currentUser) return;
            e.preventDefault();
            //  글 쓰던 중이면 쓰던 말을 그대로 들고 간다
            const sel = String(window.getSelection?.() || '').trim();
            this.openFind(sel.length && sel.length < 40 ? sel : '');
        }, true);
    }
    bindDashboardEvents() {
        this.bindGlobalSearch();
        const collapseBtn = document.getElementById('sidebar-collapse-btn');
        if (collapseBtn) collapseBtn.onclick = () => { this.navSidebarCollapsed = !this.navSidebarCollapsed; this.requestRender(); };
        const expandBtn = document.getElementById('sidebar-expand-btn');
        if (expandBtn) expandBtn.onclick = () => { this.navSidebarCollapsed = false; this.requestRender(); };
        // 사이드바 내비게이션 (onclick으로 중복 방지)
        this.appContainer.querySelectorAll('.nav-links li[data-view]').forEach(li => {
            li.onclick = () => {
                const view = li.getAttribute('data-view');
                this.setState({ currentView: view });
            };
        });

        // 사이드바 그룹 접기/펴기
        this.appContainer.querySelectorAll('.nav-group-header').forEach(h => {
            h.onclick = () => {
                const g = h.getAttribute('data-group');
                this.navCollapsed = this.navCollapsed || {};
                this.navCollapsed[g] = !this.navCollapsed[g];
                this.requestRender();
            };
        });

        // 라이트/다크 테마 토글
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) themeToggle.onclick = () => this.toggleTheme();

        // 노션식 워크스페이스 + 재고 뷰: lazy-load + 이벤트 바인딩
        this.ensureViewData();
        if (this.currentView === 'orders') this.bindOrdersEvents();
        if (this.currentView === 'inventory') this.bindInventoryEvents();
        if (this.currentView === 'pages') this.bindPagesEvents();
        if (this.currentView === 'kanban') this.bindKanbanEvents();
        if (this.currentView === 'table') this.bindTableEvents();
        if (this.currentView === 'calendar') this.bindCalendarEvents();
        if (this.currentView === 'vendors') this.bindVendorsEvents();
        if (this.currentView === 'integrations') this.bindIntegrationsEvents();
        if (this.currentView === 'quotes') this.bindQuotesEvents();

        const viewGridBtn = document.getElementById('view-grid-btn');
        if (viewGridBtn) viewGridBtn.onclick = () => {
            this.dashboardViewType = 'grid';
            this.requestRender();
        };
        const viewTableBtn = document.getElementById('view-table-btn');
        if (viewTableBtn) viewTableBtn.onclick = () => {
            this.dashboardViewType = 'table';
            this.requestRender();
        };

        const toggleBtn = document.getElementById('toggle-completed-btn');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                this.completedExpanded = !this.completedExpanded;
                this.requestRender();
            };
        }

        const scheduledToggleBtn = document.getElementById('toggle-scheduled-btn');
        if (scheduledToggleBtn) {
            scheduledToggleBtn.onclick = () => {
                this.scheduledExpanded = !this.scheduledExpanded;
                this.requestRender();
            };
        }

        if (this.currentView === 'dashboard') {
            const addProjectBtn = document.getElementById('add-project-btn');
            if (addProjectBtn) addProjectBtn.onclick = () => this.showProjectModal();

            this.appContainer.querySelectorAll('.project-card').forEach(card => {
                card.onclick = (e) => {
                    if (e.target.closest('.btn-danger')) return;
                    this.setState({ currentView: 'detail', activeProjectId: card.getAttribute('data-id') });
                };
            });

            this.appContainer.querySelectorAll('.project-row').forEach(row => {
                row.onclick = (e) => {
                    if (e.target.closest('.btn-danger')) return;
                    this.setState({ currentView: 'detail', activeProjectId: row.getAttribute('data-id') });
                };
            });
        }

        if (this.currentView === 'timeline') {
            this.appContainer.querySelectorAll('.tl-row').forEach(row => {
                row.onclick = () => this.setState({ currentView: 'detail', activeProjectId: row.getAttribute('data-id') });
            });
        }

        if (this.currentView === 'sample_maker') {
            this.bindSampleMakerEvents();
        }

        if (this.currentView === 'documents') {
            this.appContainer.querySelectorAll('.filter-btn').forEach(btn => {
                btn.onclick = () => { this.selectedDocCategory = btn.getAttribute('data-cat'); this.requestRender(); };
            });
            this.appContainer.querySelectorAll('.doc-row').forEach(row => {
                row.onclick = () => {
                    const productId = row.getAttribute('data-product-id');
                    if (productId) this.setState({ activeProjectId: productId, currentView: 'detail' });
                };
            });

            const quickAddDocBtn = document.getElementById('quick-add-doc-btn');
            if (quickAddDocBtn) quickAddDocBtn.onclick = () => this.showQuickAddDocModal();

            // 문서 이름 인라인 수정
            this.appContainer.querySelectorAll('.inline-docname-input').forEach(input => {
                const saveDocName = async () => {
                    const docId = input.getAttribute('data-doc-id');
                    const pId = input.getAttribute('data-p-id');
                    const newName = input.value.trim();
                    if (!newName) return;
                    try {
                        const { error } = await this.supabase.from('documents').update({ name: newName }).eq('id', docId);
                        if (error) throw error;
                        const product = mockData.products.find(p => p.id === pId);
                        if (product) {
                            const doc = product.documents.find(d => d.id === docId);
                            if (doc) doc.name = newName;
                        }
                        this.showToast('문서 이름이 수정되었습니다.');
                    } catch (err) {
                        this.showToast('문서 이름 수정 중 오류가 발생했습니다.');
                    }
                };
                input.addEventListener('blur', saveDocName);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
            });

            // 메모 인라인 수정
            this.appContainer.querySelectorAll('.inline-memo-input').forEach(input => {
                const saveMemo = async () => {
                    const docId = input.getAttribute('data-doc-id');
                    const newMemo = input.value.trim();
                    try {
                        const { error } = await this.supabase.from('documents').update({ memo: newMemo }).eq('id', docId);
                        if (error) throw error;
                    } catch (err) {
                        this.showToast('메모 수정 중 오류가 발생했습니다.');
                    }
                };
                input.addEventListener('blur', saveMemo);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
            });
        }
        if (this.currentView === 'all_todos') {
            const quickAddTodoBtn = document.getElementById('quick-add-todo-btn');
            if (quickAddTodoBtn) quickAddTodoBtn.onclick = () => this.showQuickAddTodoModal();
            const quickRequestTodoBtn = document.getElementById('quick-request-todo-btn');
            if (quickRequestTodoBtn) quickRequestTodoBtn.onclick = () => this.showQuickAddTodoModal(true);
        }
        if (this.currentView === 'user_management') {
            const addAccountBtn = this.appContainer.querySelector('#add-account-btn');
            if (addAccountBtn) addAccountBtn.onclick = () => this.showAddUserModal();
            this.appContainer.querySelectorAll('.edit-user-btn').forEach(btn => {
                btn.onclick = (e) => this.showEditUserModal(e.currentTarget.getAttribute('data-id'));
            });
        }

        if (this.currentView === 'brand_management') {
            const addBrandBtn = this.appContainer.querySelector('#add-brand-btn');
            if (addBrandBtn) addBrandBtn.onclick = () => this.showAddBrandModal();
            this.appContainer.querySelectorAll('.edit-brand-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.getAttribute('data-id');
                    this.showEditBrandModal(id);
                };
            });
            const toggleClosedBrandsBtn = document.getElementById('toggle-closed-brands-btn');
            if (toggleClosedBrandsBtn) {
                toggleClosedBrandsBtn.onclick = () => {
                    this.brandClosedExpanded = !this.brandClosedExpanded;
                    this.requestRender();
                };
            }
        }
    }

    showEditUserModal(userId) {
        const user = mockData.companies.find(c => c.id === userId);
        if (!user) return;

        this.showAddUserModal();
        const modal = document.getElementById('add-user-modal');
        modal.querySelector('h2').innerHTML = '<i class="ph ph-user-circle-gear"></i> 계정 정보 수정';
        
        const nameInput = document.getElementById('new-user-name');
        const idInput = document.getElementById('new-user-id');
        const pwInput = document.getElementById('new-user-pw');
        const roleSelect = document.getElementById('new-user-role');
        const saveBtn = document.getElementById('save-user-btn');

        nameInput.value = user.name || '';
        idInput.value = user.username || '';
        idInput.disabled = true; // 아이디 수정 불가 (Auth 연동 이슈 방지)
        pwInput.placeholder = '변경 시에만 입력하세요 · 6자 이상';
        roleSelect.value = user.role || 'CLIENT';

        // 기존 권한 체크박스 복원 (menu_access 없으면 역할 기본값)
        const curMenu = Array.isArray(user.menu_access) && user.menu_access.length ? user.menu_access : this._defaultMenuAccess(user.role || 'CLIENT');
        document.getElementById('perm-menu-container').innerHTML = this._renderPermMenuChecks(curMenu);
        const curBrand = Array.isArray(user.brand_access) && user.brand_access.length ? user.brand_access : (user.brand_id ? [user.brand_id] : []);
        document.querySelectorAll('.perm-brand-check').forEach(c => { c.checked = curBrand.includes(c.value); });
        // 편집 모드에서는 권한 변경 시 자동 리셋하지 않도록 change 핸들러 무력화
        roleSelect.onchange = null;

        saveBtn.innerText = '정보 수정';
        saveBtn.onclick = async () => {
            const newName = nameInput.value.trim();
            const newPw = pwInput.value.trim();
            const newRole = roleSelect.value;
            const { menu_access, brand_access } = this._readPermChecks();
            const newBrandId = newRole === 'CLIENT' ? (brand_access && brand_access[0]) || '' : '';

            if (!newName) { this.showToast('이름을 입력해주세요.'); return; }
            if (newPw && !this._isStrongPassword(newPw)) { this.showToast('비밀번호는 6자 이상이어야 합니다. (숫자만도 됩니다)'); return; }
            if (newRole === 'CLIENT' && !newBrandId) { this.showToast('고객사(CLIENT) 계정은 브랜드 접근에서 최소 1개를 체크해야 합니다.'); return; }
            if (newRole === 'STAFF' && !(brand_access && brand_access.length)) { this.showToast('직원 계정은 접근 가능한 브랜드를 최소 1개 체크해야 합니다.'); return; }

            saveBtn.disabled = true;
            saveBtn.innerText = '수정 중...';

            try {
                // 1. Supabase Auth 비밀번호 업데이트 (입력된 경우만)
                if (newPw) {
                    const pwRes = await this._invokeFn('admin-users', { action: 'set-password', company_id: userId, password: newPw });
                    if (!pwRes.ok) throw new Error(pwRes.error || '비밀번호 변경 실패');
                }

                // 2. DB 업데이트 (기본 정보)
                const { error: dbError } = await this.supabase
                    .from('companies')
                    .update({
                        name: newName,
                        role: newRole,
                        brand_id: newRole === 'CLIENT' ? (newBrandId || null) : null
                    })
                    .eq('id', userId);

                if (dbError) throw dbError;

                // 2-2. 세분화 권한(menu_access/brand_access) — 컬럼 없을 수 있어 best-effort
                const { error: permErr } = await this.supabase
                    .from('companies')
                    .update({ menu_access, brand_access })
                    .eq('id', userId);
                if (permErr) { console.warn('권한 저장 경고:', permErr.message); this.showToast('기본정보는 저장됨. 권한 컬럼 미적용(마이그레이션 필요).'); }

                this.showToast('계정 정보가 수정되었습니다.');
                modal.style.display = 'none';
                await this.loadInitialData();
                this.requestRender();
            } catch (error) {
                this.showToast('계정 수정 중 오류가 발생했습니다.');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerText = '정보 수정';
            }
        };
    }

    showEditBrandModal(brandId) {
        const brand = mockData.brands?.find(b => b.id === brandId);
        if (!brand) return;

        this.showAddBrandModal();
        const modal = document.getElementById('add-brand-modal');
        modal.querySelector('h2').innerHTML = '<i class="ph ph-shield-check"></i> 브랜드 정보 수정';

        const nameInput = document.getElementById('new-brand-name');
        const colorInput = document.getElementById('new-brand-color');
        const statusInput = document.getElementById('new-brand-status');
        const saveBtn = document.getElementById('save-brand-btn');

        nameInput.value = brand.name || '';
        colorInput.value = brand.brand_color || '#3b82f6';
        if (statusInput) statusInput.value = brand.status || 'active';

        saveBtn.innerText = '정보 수정';
        saveBtn.onclick = async () => {
            const newName = nameInput.value.trim();
            const newColor = colorInput.value;
            const newStatus = statusInput?.value || 'active';

            if (!newName) { this.showToast('브랜드 이름을 입력해주세요.'); return; }

            saveBtn.disabled = true;
            saveBtn.innerText = '수정 중...';

            try {
                const { error } = await this.supabase
                    .from('brands')
                    .update({ name: newName, brand_color: newColor, status: newStatus })
                    .eq('id', brandId);

                if (error) throw error;

                this.showToast('브랜드 정보가 수정되었습니다.');
                modal.style.display = 'none';
                await this.loadInitialData();
                this.requestRender();
            } catch (error) {
                this.showToast('브랜드 수정 중 오류가 발생했습니다.');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerText = '정보 수정';
            }
        };
    }

    bindAllTodosEvents() {
        const todoBrandFilter = document.getElementById('todo-brand-filter');
        if (todoBrandFilter) {
            todoBrandFilter.onchange = (e) => {
                this.selectedCompanyId = e.target.value;
                this.requestRender();
            };
        }

        this.appContainer.querySelectorAll('.todo-project-link').forEach(link => {
            link.onclick = (e) => {
                e.stopPropagation();
                const product_id = e.target.closest('.todo-item').getAttribute('data-project-id');
                this.setState({ currentView: 'detail', activeProjectId: product_id });
            };
        });

        // 체크 버튼 클릭
        this.appContainer.querySelectorAll('.todo-quick-check').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation();
                const todoId = e.currentTarget.getAttribute('data-id');
                const pid = e.currentTarget.getAttribute('data-pid');
                const project = mockData.products.find(p => p.id === pid);
                if (project && project.todos) {
                    const todo = project.todos.find(t => t.id === todoId);
                    if (todo) {
                        if (await this.showConfirm('정말 완료 처리하시겠습니까? 완료 시 목록에서 숨겨집니다.', '완료 확인')) {
                            todo.completed = !todo.completed;
                            this.showToast('할 일이 완료 처리되었습니다.');
                            this.requestRender();
                        }
                    }
                }
            };
        });

        // 팝업 모달 클릭
        this.appContainer.querySelectorAll('.todo-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const todoId = item.getAttribute('data-todo-id');
                const pid = item.getAttribute('data-project-id');
                this.openTodoModal(pid, todoId);
            });
        });
    }

    async handleNewTodoProcess(productId, text, isRequest, assigneeId = null, dueDate = null) {
        try {
            if (!this.currentUser) {
                this.showToast('로그인이 필요합니다.');
                return false;
            }

            const { error: insertError } = await this.supabase
                .from('todos')
                .insert([{
                    product_id: productId,
                    text: text,
                    completed: false,
                    assignee_id: isRequest ? (assigneeId || null) : (assigneeId || (this.currentUser.company_id || this.currentUser.id)),
                    due_date: dueDate || this.formatDateToDB(new Date().toISOString().split('T')[0]),
                    created_by: this.currentUser.company_id || this.currentUser.id
                }]);

            if (insertError) {
                let errMsg = '등록 실패';
                if (insertError.code === '42501') errMsg = '권한 부족: 데이터베이스에 쓸 권한이 없습니다.';
                else if (insertError.code === '22P02') errMsg = '데이터 형식 오류: 유효한 ID가 아닙니다.';
                else if (insertError.message && insertError.message.includes('foreign key')) errMsg = '선택한 시즌이 존재하지 않습니다. 페이지를 새로고침 후 다시 시도해주세요.';
                else errMsg = '등록 실패: ' + insertError.message;
                this.showToast(errMsg);
                return false;
            }

            // 히스토리 기록 시도 (비차단형)
            try {
                await this.supabase.from('history').insert([{
                    product_id: productId,
                    stage_id: 'detail',
                    status: isRequest ? '요청' : '추가',
                    note: isRequest ? '업무 요청 추가' : '할 일 추가'
                }]);
            } catch (hError) {
                // 히스토리 실패 무시
            }

            await this.loadInitialData();
            this.requestRender();
            this.showToast(isRequest ? '업무 요청이 등록되었습니다.' : '할 일이 추가되었습니다.');
            return true;
        } catch (error) {
            this.showToast('알 수 없는 오류가 발생했습니다.');
        }
    }

    bindDetailEvents() {
        const product = mockData.products.find(p => p.id === this.activeProjectId);
        if (!product) return;

        this.appContainer.querySelectorAll('.stage-item-trigger').forEach(item => {
            item.addEventListener('click', () => {
                const docType = item.getAttribute('data-type');
                this.openStageSidebar(this.activeProjectId, docType);
            });
        });

        // Inline Todo Input & Mention Logic
        const inlineInput = document.getElementById('inline-todo-input');
        const mentionList = document.getElementById('mention-list');
        if (inlineInput && mentionList) {
            let selectedAssigneeId = null;

            inlineInput.addEventListener('input', (e) => {
                const val = e.target.value;
                const lastAt = val.lastIndexOf('@');
                if (lastAt !== -1 && lastAt >= val.length - 10) {
                    const query = val.slice(lastAt + 1).toLowerCase();
                    const filtered = mockData.companies.filter(c => 
                        (c.role === 'MASTER' || c.role === 'STAFF' || c.id === product.company_id) &&
                        (c.name.toLowerCase().includes(query) || (c.username && c.username.toLowerCase().includes(query)))
                    );

                    if (filtered.length > 0) {
                        mentionList.innerHTML = filtered.map(c => `
                            <div class="mention-item" data-id="${c.id}" data-name="${c.name}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(var(--tint),0.05); font-size: 0.85rem;" onmouseover="this.style.background='rgba(37,99,235,0.2)'" onmouseout="this.style.background='transparent'">
                                <strong>${c.name}</strong> <span style="font-size: 0.7rem; color: var(--text-muted);">(${c.role === 'MASTER' ? '마스터' : '운영진'})</span>
                            </div>
                        `).join('');
                        mentionList.style.display = 'block';

                        mentionList.querySelectorAll('.mention-item').forEach(item => {
                            item.onclick = () => {
                                const name = item.getAttribute('data-name');
                                selectedAssigneeId = item.getAttribute('data-id');
                                inlineInput.value = val.slice(0, lastAt) + `@${name} `;
                                mentionList.style.display = 'none';
                                inlineInput.focus();
                            };
                        });
                    } else {
                        mentionList.style.display = 'none';
                    }
                } else {
                    mentionList.style.display = 'none';
                }
            });

            const handleSubmission = async (forceRequest = false) => {
                const text = inlineInput.value.trim();
                if (!text) return;

                try {
                    let assigneeId = selectedAssigneeId;
                    if (!assigneeId) {
                        const match = text.match(/@([^\s]+)/);
                        if (match) {
                            const matchedUser = mockData.companies.find(c => c.name === match[1]);
                            if (matchedUser) assigneeId = matchedUser.id;
                        }
                    }

                    const isRequest = forceRequest || !!assigneeId;
                    const success = await this.handleNewTodoProcess(product.id, text, isRequest, assigneeId);
                    
                    if (success) {
                        inlineInput.value = '';
                        selectedAssigneeId = null;
                        // handleNewTodoProcess에서 이미 토스트를 띄우므로 중복 제거
                    }
                } catch (err) {
                    this.showToast('처리 중 오류가 발생했습니다.');
                }
            };

            inlineInput.addEventListener('keydown', async (e) => {
                if (e.key === 'Enter' && !e.isComposing) {
                    handleSubmission();
                }
            });

            // 추가 버튼 이벤트 바인딩
            const addTodoBtn = document.getElementById('inline-add-todo-btn');
            const addRequestBtn = document.getElementById('inline-add-request-btn');
            
            if (addTodoBtn) {
                addTodoBtn.onclick = () => handleSubmission(false);
            }
            if (addRequestBtn) {
                addRequestBtn.onclick = () => handleSubmission(true);
            }
        }

        // Chat Memo Add
        const memoBtn = document.getElementById('add-memo-btn');
        const memoInput = document.getElementById('new-memo-input');
        if (memoBtn && memoInput) {
            memoBtn.onclick = async () => {
                const text = memoInput.value.trim();
                if (!text) return;

                memoBtn.disabled = true;
                try {
                    const now = new Date();
                    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '.');
                    const timeStr = `${now.getMonth()+1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

                    const { data: checkMemos } = await this.supabase.from('memos').select('id').limit(1);
                    if (checkMemos === null) {
                        this.showToast('메모 기능은 현재 준비 중입니다.');
                        return;
                    }

                    const { error: memoError } = await this.supabase
                        .from('memos')
                        .insert([{
                            product_id: product.id,
                            text: `[${this.currentUser.name}] ${text}`,
                            created_by: this.currentUser.company_id || this.currentUser.id
                        }]);
                    if (memoError) throw memoError;

                    // 히스토리 기록 (비차단형)
                    try {
                        await this.supabase.from('history').insert([{
                            product_id: product.id,
                            stage_id: 'detail',
                            status: '메모',
                            note: '메모 추가: ' + (text.length > 20 ? text.substring(0, 20) + '...' : text)
                        }]);
                    } catch (hErr) {
                        // 히스토리 실패 무시
                    }

                    await this.loadInitialData();
                    this.requestRender();
                    
                    setTimeout(() => {
                        const feed = document.getElementById('memo-feed');
                        if(feed) feed.scrollTop = feed.scrollHeight;
                    }, 10);
                } catch (error) {
                    this.showToast('메모 저장 중 오류가 발생했습니다.');
                } finally {
                    memoBtn.disabled = false;
                }
            };
        }

        this.appContainer.querySelectorAll('.todo-item input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', async (e) => {
                const todoItem = e.target.closest('.todo-item');
                const todoId = todoItem.getAttribute('data-todo-id');
                const completed = e.target.checked;

                try {
                    const { error } = await this.supabase
                        .from('todos')
                        .update({ completed: completed })
                        .eq('id', todoId);

                    if (error) throw error;

                    const todo = product.todos.find(t => t.id === todoId);
                    if (todo) todo.completed = completed;
                    todoItem.classList.toggle('completed', completed);
                    this.showToast(completed ? '할 일을 완료했습니다.' : '할 일을 취소했습니다.');
                } catch (error) {
                    e.target.checked = !completed;
                    this.showToast('할 일 상태 수정 중 오류가 발생했습니다.');
                }
            });
            // 모달 열기와 충돌 방지
            checkbox.addEventListener('click', (e) => e.stopPropagation());
        });

        // 상세 뷰에서도 팝업 모달 클릭 이벤트 연동
        this.appContainer.querySelectorAll('.todo-item').forEach(item => {
            if(item.id === 'add-todo-trigger') return;
            item.addEventListener('click', (e) => {
                if(e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                const todoId = item.getAttribute('data-todo-id');
                this.openTodoModal(this.activeProjectId, todoId);
            });
        });

        this.appContainer.querySelectorAll('.todo-assignee-select').forEach(select => {
            select.addEventListener('change', async (e) => {
                const todoId = e.target.getAttribute('data-id');
                const assigneeId = e.target.value;

                try {
                    const { error } = await this.supabase
                        .from('todos')
                        .update({ assignee_id: assigneeId ? assigneeId : null })
                        .eq('id', todoId);

                    if (error) throw error;

                    await this.loadInitialData();
                    this.requestRender();
                    this.showToast('담당자가 업데이트되었습니다.');
                } catch (error) {
                    this.showToast('담당자 지정 중 오류가 발생했습니다.');
                }
            });
        });

        this.appContainer.querySelectorAll('.todo-date-input').forEach(input => {
            input.addEventListener('change', async (e) => {
                const todoId = e.target.getAttribute('data-id');
                const due_date = e.target.value || null; // YYYY-MM-DD 형식 그대로 사용

                try {
                    const { error } = await this.supabase
                        .from('todos')
                        .update({ due_date: due_date })
                        .eq('id', todoId);

                    if (error) throw error;

                    const todo = product.todos.find(t => t.id === todoId);
                    if (todo) {
                        todo.due_date = due_date;
                        this.requestRender(); // 날짜 표시 업데이트를 위해 렌더링
                    }
                } catch (error) {
                    this.showToast('마감일 수정 중 오류가 발생했습니다.');
                }
            });
        });

        // 사진 추가 버튼 바인딩 (onclick으로 중복 리스너 방지)
        const addPhotoBtn = document.getElementById('add-photo-btn');
        if (addPhotoBtn) {
            addPhotoBtn.onclick = () => {
                let photoInput = document.getElementById('global-photo-input');
                if (!photoInput) {
                    photoInput = document.createElement('input');
                    photoInput.type = 'file';
                    photoInput.id = 'global-photo-input';
                    photoInput.accept = 'image/*';
                    photoInput.style.display = 'none';
                    document.body.appendChild(photoInput);
                }

                photoInput.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        await this.handlePhotoUpload(this.activeProjectId, file);
                        photoInput.value = '';
                    }
                };

                photoInput.value = '';
                photoInput.click();
            };
        }

        this.appContainer.querySelectorAll('.stage-quick-upload-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = e.target.getAttribute('data-type');
                this.openStageSidebar(this.activeProjectId, type);
            });
        });
    }

    // 계정 권한 체크박스에 노출할 배정 가능한 메뉴 (계정/브랜드 관리는 MASTER 전용이라 제외, 할일은 항상노출이라 제외)
    _assignableMenus() {
        return [
            { g: '생산관리', items: [['dashboard','시즌'],['timeline','타임라인'],['sample_maker','샘플'],['vendors','생산현황'],['quotes','견적']] },
            { g: '재고·판매', items: [['orders','주문'],['sales','매출'],['inventory','재고'],['integrations','연동']] },
            { g: '업무관리', items: [['pages','페이지'],['kanban','보드'],['calendar','캘린더'],['table','표']] },
            { g: '자료실', items: [['documents','문서']] }
        ];
    }
    _defaultMenuAccess(role) {
        const all = this._assignableMenus().flatMap(s => s.items.map(i => i[0]));
        if (role === 'MASTER' || role === 'STAFF') return all;
        return ['dashboard']; // CLIENT 기본: 시즌(대시보드)만
    }
    _renderPermMenuChecks(selected) {
        const sel = new Set(selected || []);
        return this._assignableMenus().map(sec => `
            <div style="margin-bottom: 10px;">
                <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: .04em;">${sec.g}</div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${sec.items.map(([id,label]) => `
                        <label class="perm-chip" style="display:inline-flex; align-items:center; gap:5px; padding:5px 10px; border-radius:9px; background:rgba(var(--tint),0.05); border:1px solid var(--card-border); cursor:pointer; font-size:12px;">
                            <input type="checkbox" class="perm-menu-check" value="${id}" ${sel.has(id)?'checked':''} style="accent-color: var(--accent, #6c8cff);">
                            ${label}
                        </label>`).join('')}
                </div>
            </div>`).join('');
    }
    _renderPermBrandChecks(selected) {
        const sel = new Set(selected || []);
        const brands = mockData.brands || [];
        if (!brands.length) return '<div style="font-size:12px; color:var(--text-muted);">브랜드 없음</div>';
        return `<div style="display:flex; flex-wrap:wrap; gap:6px;">
            ${brands.map(b => `
                <label class="perm-chip" style="display:inline-flex; align-items:center; gap:5px; padding:5px 10px; border-radius:9px; background:rgba(var(--tint),0.05); border:1px solid var(--card-border); cursor:pointer; font-size:12px;">
                    <input type="checkbox" class="perm-brand-check" value="${b.id}" ${sel.has(b.id)?'checked':''} style="accent-color: var(--accent, #6c8cff);">
                    ${b.name}
                </label>`).join('')}
        </div>`;
    }
    // supabase-js 의 functions.invoke 는 4xx/5xx 를 error 로 던지면서 본문을 data 에 안 담는다.
    // 그대로 두면 서버가 보낸 진짜 사유("메모가 있어 못 지움" 등)가 사라지고 "실패했습니다"만 남는다.
    async _invokeFn(name, body) {
        const { data, error } = await this.supabase.functions.invoke(name, { body });
        if (!error) return data || {};
        try {
            const parsed = await error.context.json();   // 서버가 보낸 { ok:false, error:"..." }
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (e) { /* 본문이 JSON 이 아니면 아래 기본 메시지 */ }
        return { ok: false, error: error.message || '요청에 실패했습니다.' };
    }

    //  빠른 단축키 — 화면에 설명을 늘어놓는 대신 ? 안에 모아 둔다
    HELP_KEYS = [
        { g: '어디서든', rows: [
            ['⌘ K', '모두 찾기 — 제품·시즌·주문·CS·메모·자료·화면'],
            ['⌘ ⇧ R', '새로고침 (바뀐 게 안 보일 때)'],
            ['esc', '열린 창 닫기'],
        ] },
        { g: '메모 쓸 때', rows: [
            ['[ ]', '할 일 — 할 일 화면에 저절로 올라간다'],
            ['[x]', '끝낸 할 일'],
            ['@이름', '담당자 — 그 사람 할 일에 뜬다'],
            ['#꼬리표', '말머리 — 같은 꼬리표끼리 모인다'],
            ['⏎', '제목 칸에서 누르면 본문으로'],
        ] },
        { g: '표에서', rows: [
            ['칸 누르기', '그 자리에서 고치고 바로 저장'],
            ['줄 누르기', '오른쪽 칸에 자세히'],
            ['우클릭', '폴더 속성 · 접근 권한'],
        ] },
    ];
    showHelp() {
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const esc = s => this._vesc(s);
        c.innerHTML = `<div class="modal-content vmodal hk" style="width:94%;max-width:420px">
            <div class="hk-top"><b>빠른 단축키</b>
                <button class="fi-x" onclick="app.closeGlobalModal()">×</button></div>
            ${this.HELP_KEYS.map(s2 => `<div class="hk-g">${esc(s2.g)}</div>
                ${s2.rows.map(([k, t]) => `<div class="hk-r"><kbd>${esc(k)}</kbd><span>${esc(t)}</span></div>`).join('')}`).join('')}
        </div>`;
        c.style.display = 'flex';
    }

    //  본인 비밀번호 바꾸기 — 로그인한 사람 스스로. 관리자 손이 필요 없다.
    changeMyPassword() {
        const c = document.getElementById('global-modal-container'); if (!c) return;
        const who = this._vesc(this.currentUser?.name || '');
        c.innerHTML = `<div class="modal-content vmodal" style="width:94%;max-width:380px">
            <h2>비밀번호 바꾸기</h2>
            <p style="margin:-8px 0 14px;color:var(--text-muted);font-size:12px">${who} 계정. 바꾼 뒤에는 새 비밀번호로 들어옵니다.</p>
            <div class="pwf">
                <label>지금 쓰는 비밀번호</label>
                <input type="password" id="pw-now" class="login-input" autocomplete="current-password">
                <label>새 비밀번호</label>
                <input type="password" id="pw-new" class="login-input" autocomplete="new-password"
                    placeholder="6자 이상 (숫자만도 됩니다)">
                <label>새 비밀번호 한 번 더</label>
                <input type="password" id="pw-new2" class="login-input" autocomplete="new-password">
            </div>
            <div id="pw-err" class="pw-err"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
                <button class="mbtn" onclick="app.closeGlobalModal()">취소</button>
                <button class="mbtn pri" id="pw-go">바꾸기</button>
            </div>
        </div>`;
        c.style.display = 'flex';
        const err = (m) => { const e = c.querySelector('#pw-err'); e.textContent = m || ''; e.style.display = m ? 'block' : 'none'; };
        err('');
        const go = c.querySelector('#pw-go');
        c.querySelectorAll('input').forEach(i => i.onkeydown = (e) => { if (e.key === 'Enter') go.click(); });
        setTimeout(() => c.querySelector('#pw-now')?.focus(), 40);
        go.onclick = async () => {
            const now = c.querySelector('#pw-now').value;
            const pw = c.querySelector('#pw-new').value.trim();
            const pw2 = c.querySelector('#pw-new2').value.trim();
            if (!now) return err('지금 쓰는 비밀번호를 넣으세요.');
            if (!this._isStrongPassword(pw)) return err('새 비밀번호는 6자 이상이어야 합니다. (숫자만도 됩니다)');
            if (pw !== pw2) return err('새 비밀번호를 두 번 다르게 넣었습니다.');
            if (pw === now) return err('지금 쓰는 것과 같습니다.');

            const email = this.currentUser?.email
                || (this.currentUser?.username ? `${this.currentUser.username}@bhas.com` : '');
            if (!email) return err('계정 주소를 찾지 못했습니다. 다시 로그인해 주세요.');

            go.disabled = true; go.textContent = '바꾸는 중...';
            //  자리를 비운 사이 남이 바꾸지 못하게, 지금 비밀번호부터 맞는지 본다
            const chk = await this.supabase.auth.signInWithPassword({ email, password: now });
            if (chk.error) { go.disabled = false; go.textContent = '바꾸기'; return err('지금 쓰는 비밀번호가 맞지 않습니다.'); }

            const { error } = await this.supabase.auth.updateUser({ password: pw });
            go.disabled = false; go.textContent = '바꾸기';
            if (error) return err('바꾸지 못했습니다: ' + error.message);
            //  저장해 둔 자동 로그인 정보는 흘려두면 안 된다
            localStorage.removeItem('bhas_auto_login');
            localStorage.removeItem('bhas_session_user');
            this.closeGlobalModal();
            this.showToast('비밀번호를 바꿨습니다. 다음부터 새 비밀번호로 들어오세요.');
        };
    }

    // 비밀번호 변경 — 서버(admin-users)에서 auth.admin.updateUserById 로 처리.
    // 로그인 계정이 아직 없는 프로필(예전 방식으로 만들어진 행)이면 그 자리에서 연결해준다.
    async changeAccountPassword(companyId, username) {
        const pw = await this.showPrompt(`${username} 계정의 새 비밀번호 — 6자 이상(숫자만도 됩니다)`);
        if (pw === null) return;
        if (!this._isStrongPassword(pw.trim())) { this.showToast('비밀번호는 6자 이상이어야 합니다. (숫자만도 됩니다)'); return; }
        this.showToast('비밀번호 변경 중...');
        const call = (action) => this._invokeFn('admin-users', { action, company_id: companyId, password: pw.trim() });
        let res = await call('set-password');
        if (!res.ok && /로그인 계정이 없습니다/.test(res.error || '')) {
            if (!await this.showConfirm(`${username} 은(는) 아직 로그인 계정이 없습니다. 지금 만들까요?`, '확인')) return;
            res = await call('link-auth');
        }
        this.showToast(res.ok ? `완료 — ${res.email} 로 새 비밀번호 사용` : (res.error || '비밀번호 변경에 실패했습니다.'));
    }

    // 계정 삭제 — companies 행과 auth 사용자를 같이 지운다(둘 중 하나만 남으면 유령 계정이 됨)
    async deleteAccount(companyId, name) {
        if (!await this.showConfirm(`'${name}' 계정을 삭제할까요?\n로그인 계정도 같이 삭제됩니다. (사진·문서는 남고 작성자 표시만 사라집니다)`, '삭제')) return;
        const res = await this._invokeFn('admin-users', { action: 'delete', company_id: companyId });
        if (!res.ok) { this.showToast(res.error || '삭제에 실패했습니다.'); return; }
        this.showToast('계정을 삭제했습니다.');
        await this.loadInitialData();
        this.requestRender();
    }

    _readPermChecks() {
        const menu = [...document.querySelectorAll('.perm-menu-check:checked')].map(c => c.value);
        const brand = [...document.querySelectorAll('.perm-brand-check:checked')].map(c => c.value);
        return { menu_access: menu, brand_access: brand.length ? brand : null };
    }
    //  Supabase 가 6자 미만을 받지 않는다(플랫폼 제한). 그 안에서 제일 느슨하게.
    _isStrongPassword(password) {
        return String(password || '').trim().length >= 6;
    }
    _applyRoleDefaultsToPermChecks(role) {
        const def = new Set(this._defaultMenuAccess(role));
        document.querySelectorAll('.perm-menu-check').forEach(c => { c.checked = def.has(c.value); });
    }
    // 현재 로그인 계정이 조회 가능한 브랜드 id 집합.
    // MASTER만 null(전체)이며, STAFF/CLIENT는 반드시 명시적으로 배정된 브랜드만 본다.
    _allowedBrandIds() {
        const u = this.currentUser || {};
        if (Array.isArray(u.brand_access) && u.brand_access.length) return new Set(u.brand_access);
        if (u.role === 'STAFF') return new Set(u.brand_id ? [u.brand_id] : []);
        if (u.role === 'CLIENT') return new Set(u.brand_id ? [u.brand_id] : []);
        return null;
    }
    // 브랜드 선택기/목록에 노출할 브랜드 (brand_access 반영)
    _visibleBrands() {
        const ab = this._allowedBrandIds();
        const brands = mockData.brands || [];
        return ab ? brands.filter(b => ab.has(b.id)) : brands;
    }

    showAddUserModal() {
        let modal = document.getElementById('add-user-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'add-user-modal';
            modal.className = 'modal-overlay';
            modal.style.background = 'rgba(0,0,0,0.5)';
            modal.style.backdropFilter = 'blur(4px)';
            modal.style.webkitBackdropFilter = 'blur(4px)';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="glass" style="width: 90%; max-width: 400px; padding: 2rem; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid var(--card-border);">
                <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px;"><i class="ph ph-user-plus"></i> 새 계정 추가</h2>
                
                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>이름 / 기업명</label>
                    <input type="text" id="new-user-name" class="login-input" placeholder="이름을 입력하세요">
                </div>
                
                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>로그인 아이디</label>
                    <input type="text" id="new-user-id" class="login-input" placeholder="로그인에 사용할 아이디 (@ 없이)">
                </div>
                
                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>비밀번호</label>
                    <input type="password" id="new-user-pw" class="login-input" placeholder="6자 이상 (숫자만도 됩니다)">
                </div>
                
                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>권한 설정</label>
                    <select id="new-user-role" class="glass" style="width: 100%; padding: 12px; border-radius: 12px; background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--card-border);">
                        <option value="CLIENT">CLIENT (고객사 계정)</option>
                        <option value="STAFF">STAFF (직원 계정)</option>
                        <option value="MASTER">MASTER (관리자 계정)</option>
                    </select>
                </div>

                <div class="login-field" style="margin-bottom: 1.25rem;">
                    <label style="display:flex; align-items:center; gap:6px;"><i class="ph ph-squares-four"></i> 메뉴 접근 권한</label>
                    <div style="font-size:11px; color:var(--text-muted); margin:2px 0 10px;">이 계정이 볼 수 있는 메뉴를 체크하세요 · 권한 변경 시 기본값이 자동 체크됨</div>
                    <div id="perm-menu-container">${this._renderPermMenuChecks(this._defaultMenuAccess('CLIENT'))}</div>
                </div>

                <div id="perm-brand-container" class="login-field" style="margin-bottom: 2rem;">
                    <label style="display:flex; align-items:center; gap:6px;"><i class="ph ph-tag"></i> 브랜드 접근 (조회 허용)</label>
                    <div style="font-size:11px; color:var(--text-muted); margin:2px 0 10px;">체크한 브랜드 데이터만 조회 가능 · 직원/고객사 계정은 최소 1개를 반드시 선택</div>
                    ${this._renderPermBrandChecks([])}
                </div>

                <div style="display: flex; gap: 10px;">
                    <button id="cancel-user-btn" style="flex: 1; padding: 12px; border-radius: 12px; background: rgba(var(--tint),0.05); border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer;">취소</button>
                    <button id="save-user-btn" class="btn-primary" style="flex: 1; padding: 12px; border-radius: 12px;">계정 생성</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        const roleSelect = document.getElementById('new-user-role');
        // 기본 CLIENT 선택 상태에 맞춰 메뉴 체크 초기화
        this._applyRoleDefaultsToPermChecks(roleSelect.value);
        roleSelect.addEventListener('change', () => {
            this._applyRoleDefaultsToPermChecks(roleSelect.value);
        });

        document.getElementById('cancel-user-btn').onclick = () => modal.style.display = 'none';
        document.getElementById('save-user-btn').onclick = () => this.handleAddUser();
    }

    showAddBrandModal() {
        let modal = document.getElementById('add-brand-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'add-brand-modal';
            modal.className = 'modal-overlay';
            modal.style.background = 'rgba(0,0,0,0.5)';
            modal.style.backdropFilter = 'blur(4px)';
            modal.style.webkitBackdropFilter = 'blur(4px)';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="glass" style="width: 90%; max-width: 400px; padding: 2rem; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.3); border: 1px solid var(--card-border);">
                <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px;"><i class="ph ph-shield-plus"></i> 새 브랜드(등급) 생성</h2>
                
                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>브랜드 이름</label>
                    <input type="text" id="new-brand-name" class="login-input" placeholder="브랜드명을 입력하세요 (예: Alpha Brand)">
                </div>
                
                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>브랜드 테마 컬러</label>
                    <input type="color" id="new-brand-color" value="#3b82f6" style="width: 100%; height: 40px; border-radius: 8px; border: none; background: transparent; cursor: pointer;">
                </div>

                <div class="login-field" style="margin-bottom: 2rem;">
                    <label>상태</label>
                    <select id="new-brand-status" class="login-input" style="padding: 10px; border-radius: 8px; background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--card-border);">
                        <option value="active">진행 중</option>
                        <option value="closed">종료됨</option>
                    </select>
                </div>

                <div style="display: flex; gap: 10px;">
                    <button id="cancel-brand-btn" style="flex: 1; padding: 12px; border-radius: 12px; background: rgba(var(--tint),0.05); border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer;">취소</button>
                    <button id="save-brand-btn" class="btn-primary" style="flex: 1; padding: 12px; border-radius: 12px;">브랜드 생성</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        document.getElementById('cancel-brand-btn').onclick = () => modal.style.display = 'none';
        document.getElementById('save-brand-btn').onclick = () => this.handleAddBrand();
    }

    async handleAddBrand() {
        const name = document.getElementById('new-brand-name').value.trim();
        const color = document.getElementById('new-brand-color').value;
        const status = document.getElementById('new-brand-status')?.value || 'active';

        if (!name) { this.showToast('브랜드 이름을 입력해주세요.'); return; }

        const saveBtn = document.getElementById('save-brand-btn');
        saveBtn.disabled = true;
        saveBtn.innerText = '브랜드 생성 중...';

        try {
            const { data, error } = await this.supabase
                .from('brands')
                .insert([{ name, brand_color: color, status }])
                .select();

            if (error) throw error;

            this.showToast('새 브랜드가 생성되었습니다.');
            document.getElementById('add-brand-modal').style.display = 'none';
            await this.loadInitialData();
            this.requestRender();
        } catch (error) {
            this.showToast('브랜드 생성 중 오류가 발생했습니다.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = '브랜드 생성';
        }
    }

    async handleAddUser() {
        const name = document.getElementById('new-user-name').value.trim();
        const username = document.getElementById('new-user-id').value.trim();
        const password = document.getElementById('new-user-pw').value.trim();
        const role = document.getElementById('new-user-role').value;

        if (!name || !username || !password) {
            { this.showToast('모든 정보를 입력해주세요.'); return; }
        }

        if (!this._isStrongPassword(password)) {
            { this.showToast('비밀번호는 6자 이상이어야 합니다. (숫자만도 됩니다)'); return; }
        }

        // 메뉴/브랜드 접근 권한 체크박스 수집
        const { menu_access, brand_access } = this._readPermChecks();
        // CLIENT는 브랜드 접근 첫번째를 배정 브랜드(brand_id)로 사용
        const brandId = role === 'CLIENT' ? (brand_access && brand_access[0]) || '' : '';

        if (role === 'CLIENT' && !brandId) {
            { this.showToast('고객사(CLIENT) 계정은 브랜드 접근에서 최소 1개를 체크해야 합니다.'); return; }
        }
        if (role === 'STAFF' && !(brand_access && brand_access.length)) {
            { this.showToast('직원 계정은 접근 가능한 브랜드를 최소 1개 체크해야 합니다.'); return; }
        }

        const email = `${username}@bhas.com`;
        const saveBtn = document.getElementById('save-user-btn');
        saveBtn.disabled = true;
        saveBtn.innerText = '계정 생성 중...';

        try {
            // 계정 생성은 서버(admin-users)에서. 브라우저 signUp()은 만든 사람의 세션을 새 계정으로
            // 바꿔버리고, 이메일 확인이 켜져 있으면 auth 사용자가 아예 안 생겨 로그인이 안 됐음.
            const data = await this._invokeFn('admin-users', {
                action: 'create',
                name, username, password, role,
                brand_id: brandId || null, menu_access, brand_access,
            });
            if (!data.ok) { this.showToast(data.error || '계정 생성에 실패했습니다.'); return; }

            this.showToast(`계정 생성 완료 — ${data.email} 로 바로 로그인됩니다.`);
            document.getElementById('add-user-modal').style.display = 'none';
            await this.loadInitialData();
            this.requestRender();

        } catch (error) {
            this.showToast('계정 생성 중 오류가 발생했습니다.');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerText = '계정 생성';
        }
    }

    async resizeImage(file, maxWidth = 1200, maxHeight = 1200) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (e) => {
                const img = new Image();
                img.src = e.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        resolve(blob);
                    }, file.type, 0.8); // 80% 질로 압축
                };
            };
        });
    }

    async handlePhotoUpload(product_id, file) {
        if (!file) return;
        this.showToast('사진 최적화 및 업로드 중...');

        try {
            // product_id가 유효한지 확인
            const pid = String(product_id);
            if (!pid || pid === 'null' || pid === 'undefined') throw new Error('유효하지 않은 시즌 ID입니다.');

            // 1. 이미지 리사이징
            const optimizedBlob = await this.resizeImage(file);
            const sanitizedPhotoName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const fileName = `${Date.now()}_${sanitizedPhotoName}`;
            const filePath = `photos/${pid}/${fileName}`;

            // 2. Supabase Storage 업로드
            const { error: uploadError } = await this.supabase.storage
                .from('bhas')
                .upload(filePath, optimizedBlob, {
                    contentType: file.type,
                    upsert: false
                });

            if (uploadError) throw uploadError;

            // 3. 퍼블릭 URL 가져오기
            const { data: { publicUrl } } = this.supabase.storage
                .from('bhas')
                .getPublicUrl(filePath);

            // 4. DB insert (photos 테이블)
            const { error: dbError } = await this.supabase
                .from('photos')
                .insert([{
                    product_id: pid,
                    url: publicUrl,
                    created_by: this.currentUser.company_id || this.currentUser.id
                }]);

            if (dbError) throw dbError;

            // 히스토리 기록 시도 (비차단형)
            try {
                await this.supabase.from('history').insert([{
                    product_id: pid,
                    stage_id: 'detail',
                    status: '사진 추가',
                    note: '사진 추가: ' + file.name
                }]);
            } catch (hError) {
                // 히스토리 실패 무시
            }

            await this.loadInitialData();
            this.requestRender();
            this.showToast('사진이 성공적으로 업로드되었습니다.');
        } catch (error) {
            this.showToast('사진 업로드 중 오류가 발생했습니다.');
        }
    }

    async handleFileUpload(product_id, file, docType, customName) {
        if (!file) return;
        this.showToast('문서 업로드 중...');

        try {
            const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const fileName = `${Date.now()}_${sanitizedName}`;
            const filePath = `documents/${product_id}/${fileName}`;

            // 1. Supabase Storage 업로드
            const { data: uploadData, error: uploadError } = await this.supabase.storage
                .from('bhas')
                .upload(filePath, file, {
                    contentType: file.type,
                    upsert: false
                });

            if (uploadError) throw uploadError;

            // 2. 퍼블릭 URL 가져오기
            const { data: { publicUrl } } = this.supabase.storage
                .from('bhas')
                .getPublicUrl(filePath);

            // 3. DB insert (documents 테이블)
            const { error: dbError } = await this.supabase
                .from('documents')
                .insert([{
                    product_id: String(product_id),
                    name: customName || file.name,
                    url: publicUrl,
                    type: docType,
                    status: 'completed',
                    created_by: this.currentUser.company_id || this.currentUser.id
                }]);

            if (dbError) throw dbError;

            // 히스토리 기록 시도 (비차단형)
            try {
                const stageLabel = STAGES.find(s => s.docType === docType)?.label || docType;
                await this.supabase.from('history').insert([{
                    product_id: String(product_id),
                    stage_id: docType,
                    status: '업로드',
                    note: `${stageLabel} 관련 문서 '${customName || file.name}' 업로드`
                }]);
            } catch (hError) {
                // 히스토리 실패 무시
            }

            await this.loadInitialData();
            this.requestRender();
            this.showToast('문서가 성공적으로 업로드되었습니다.');
        } catch (error) {
            if (error.message === 'The resource was not found' || error.statusCode === '404') {
                this.showToast('오류: 스토리지 버킷이 설정되지 않았습니다. 관리자에게 문의하세요.');
            } else {
                this.showToast('문서 업로드 중 오류가 발생했습니다.');
            }
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new BhasApp();
});
