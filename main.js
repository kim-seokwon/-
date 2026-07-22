import { mockData, STAGES } from './mockData.js';
import {
    defaultSampleConfig, configForType, renderSampleMaker,
    garmentPreviewSVG, garmentFlatSVG, garmentPatternSVG, techPackSummaryHTML, buildTechPackPrintHTML,
    newPlacement, newCutline, newPoint, techPackChecklistItems,
} from './sampleMaker.js';

// Supabase 설정 (사용자 정보 입력 필요)
const SUPABASE_URL = 'https://czaykmmwzlcisozmbxpl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JfMXgnspGcTtJKncR-l4gQ_XXzopFMk';
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

class BhasApp {
    constructor() {
        this.currentUser = null;
        this.appContainer = document.getElementById('app');
        if (localStorage.getItem('bhas_theme') !== 'dark') document.body.classList.add('light'); // 기본 라이트(토스st)
        this.currentView = 'login'; // 'login', 'dashboard', 'detail'
        this.activeProjectId = null;
        this.selectedDocCategory = '전체';
        this.selectedCompanyId = 'all'; 
        this.completedExpanded = false;
        this.currentTodoFilter = 'all'; // all, my, requested
        this.sampleConfig = defaultSampleConfig(); // 샘플 제작 도구 상태
        
        // 렌더링 최적화용 변수
        this._renderTimeout = null;
        this._isInitialLoading = true;
        
        // 타임라인 관련 상태
        
        window.app = this; // 전역 참조 추가 (타임라인 등에서 필요)
        this.supabase = supabase;
        
        this.products = [];
        this.companies = [];
        this.scheduledExpanded = true;
        this.dashboardViewType = 'grid';
        this.brandClosedExpanded = false;
        
        try {
            this.init();
            window.onerror = (msg, url, lineNo, columnNo, error) => {
                this.showToast('시스템 오류가 발생했습니다. 담당자에게 문의하세요.');
                return false;
            };
        } catch (e) { /* init error */ }
    }

    showToast(message) {
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
        const DEV_PREVIEW_SAMPLE = true;
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

    // 프로젝트 진행률(%) — renderSubView의 isStageCompleted 로직과 동일
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

    // 프로젝트별 브랜드명
    _brandName(p) {
        const brand = (mockData.brands || []).find(b => b.id === p.brand_id);
        const company = (mockData.companies || []).find(c => c.id === p.company_id);
        return brand ? brand.name : (company ? company.name : '');
    }

    // 권한 반영된 가시 프로젝트 목록 (CLIENT는 본인 회사만)
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

    // 통합 검색 — 프로젝트/할일/문서/메모/브랜드 가로질러 매칭
    runGlobalSearch(query) {
        const q = (query || '').trim().toLowerCase();
        if (!q) return [];
        const results = [];
        this._visibleProducts().forEach(p => {
            const bName = this._brandName(p);
            if ((p.name || '').toLowerCase().includes(q) || (bName || '').toLowerCase().includes(q)) {
                results.push({ kind: '프로젝트', icon: 'ph-folder', title: p.name, sub: bName, product_id: p.id });
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
                confirmMsg = `[주의] 이 프로젝트에는 업로드된 사진, 문서 또는 메모가 포함되어 있습니다.\n삭제 시 연동된 모든 데이터가 함께 영구히 삭제됩니다.\n\n정말 삭제하시겠습니까?`;
            }
        }
        if (type === 'brand') {
            const brand = mockData.brands.find(b => b.id === id);
            const brandProjects = mockData.products.filter(p => p.brand_id === id);
            const brandUsers = mockData.companies.filter(c => c.brand_id === id);
            confirmMsg = `[경고] 브랜드 "${brand?.name || ''}" 삭제 시 다음 데이터가 모두 영구 삭제됩니다:\n\n` +
                `  - 소속 프로젝트: ${brandProjects.length}개 (사진, 문서, 메모 포함)\n` +
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

                // 프로젝트 삭제: DB 서버에서 연쇄 삭제 (RLS 우회)
                if (type === 'project') {
                    const { error: rpcErr } = await this.supabase.rpc('delete_project_cascade', { project_uuid: id });
                    if (rpcErr) {
                        this.showToast(`프로젝트 삭제 실패: ${rpcErr.message}`);
                        return;
                    }
                    this.showToast('프로젝트가 삭제되었습니다.');
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
                        userMsg = '연결된 데이터(프로젝트/계정 등)가 있어 삭제할 수 없습니다. 연결 데이터를 먼저 제거해주세요.';
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
        Object.assign(this, newState);
        this.requestRender();
    }

    switchView(viewId) {
        this.currentView = viewId;
        this.render();
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
            // 프로젝트 데이터 로드
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
                            <label for="username">아이디 (또는 이메일)</label>
                            <input type="text" id="username" class="login-input" placeholder="아이디를 입력하세요" required>
                        </div>
                        <div class="input-group">
                            <label for="password">비밀번호</label>
                            <input type="password" id="password" class="login-input" placeholder="비밀번호를 입력하세요" required>
                        </div>
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

            // 아이디 형식인 경우 자동으로 @bhas.com 추가
            const email = identifier.includes('@') ? identifier : `${identifier}@bhas.com`;

            loginBtn.disabled = true;
            loginBtn.innerText = '로그인 중...';
            errorMsg.style.display = 'none';

            try {
                // 1. Supabase Auth 우선 시도
                const { data: authData, error: authError } = await this.supabase.auth.signInWithPassword({
                    email,
                    password,
                });

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
                    } else {
                        // 프로필이 없는 경우 기본 권한 및 ID 설정
                        const isMasterAccount = ['admin@bhas.com', 'ksw5363@gmail.com'].includes(authData.user.email);
                        this.currentUser.role = isMasterAccount ? 'MASTER' : 'CLIENT';
                        this.currentUser.name = authData.user.email.split('@')[0];
                        this.currentUser.company_id = authData.user.id; // 폴백: 이 경우 RLS 위반 가능성 있음
                    }

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
        const perms = mockData.permissions[role] || [];
        
        const menuItems = [
            { id: 'dashboard', label: '프로젝트', icon: '<i class="ph ph-chart-bar"></i>', group: 'prod', visible: perms.includes('dashboard') },
            { id: 'timeline', label: '타임라인', icon: '<i class="ph ph-calendar-check"></i>', group: 'prod', visible: perms.includes('dashboard') },
            { id: 'sample_maker', label: '샘플', icon: '<i class="ph ph-scissors"></i>', group: 'prod', visible: perms.includes('dashboard') },
            { id: 'vendors', label: '생산현황', icon: '<i class="ph ph-storefront"></i>', group: 'prod', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'quotes', label: '견적', icon: '<i class="ph ph-receipt"></i>', group: 'prod', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'orders', label: '주문', icon: '<i class="ph ph-shopping-bag-open"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'sales', label: '매출', icon: '<i class="ph ph-chart-line-up"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'inventory', label: '재고', icon: '<i class="ph ph-package"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'integrations', label: '연동', icon: '<i class="ph ph-plugs-connected"></i>', group: 'stock', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'pages', label: '페이지', icon: '<i class="ph ph-note-pencil"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'kanban', label: '보드', icon: '<i class="ph ph-kanban"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'calendar', label: '캘린더', icon: '<i class="ph ph-calendar-dots"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'table', label: '표', icon: '<i class="ph ph-table"></i>', group: 'work', visible: role === 'MASTER' || role === 'STAFF' },
            { id: 'all_todos', label: '할일', icon: '<i class="ph ph-list-checks"></i>', group: 'work', visible: true },
            { id: 'documents', label: '문서', icon: '<i class="ph ph-folder-open"></i>', group: 'archive', visible: perms.includes('documents') },
            { id: 'user_management', label: '계정', icon: '<i class="ph ph-user-plus"></i>', group: 'admin', visible: perms.includes('user_management') },
            { id: 'brand_management', label: '브랜드', icon: '<i class="ph ph-shield-check"></i>', group: 'admin', visible: perms.includes('user_management') }
        ];
        const navGroups = [
            { id: 'work', label: '업무관리' },
            { id: 'prod', label: '생산관리' },
            { id: 'stock', label: '재고·판매' },
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

        const dashboardHtml = `
            <div class="dashboard fade-in">
                <div class="mobile-top-bar">
                    <div class="top-bar-logo">2179</div>
                    <div class="top-bar-actions">
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
                        <span>2179</span>
                        <button id="sidebar-collapse-btn" title="사이드바 접기/펼치기" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.25rem;padding:0;line-height:1;flex-shrink:0"><i class="ph ph-sidebar-simple"></i></button>
                    </div>
                    <ul class="nav-links">
                        <li class="${this.currentView === 'home' ? 'active' : ''}" data-view="home" style="padding:8px 14px;margin-bottom:6px;border-radius:12px">
                            <div style="display:flex;align-items:center;gap:8px;font-size:0.95rem"><i class="ph ph-house-line"></i> <span style="font-size:0.88rem;font-weight:700">홈</span></div>
                        </li>
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

                <div class="top-toolbar">
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
                                        <span class="company-tag" style="border-color: ${bColor}; color: white; background: ${bColor}20; border-width: 2.5px; font-size: 0.8rem;">
                                            <i class="ph ph-buildings"></i> ${bName}
                                        </span>
                                    </h1>
                                </div>
                            `;
                        })() : this.currentView !== 'dashboard' ? `
                            <div style="margin-bottom: 0.25rem;">
                                <button class="breadcrumb-back-btn btn-secondary" style="padding: 6px 12px; border-radius: 8px; font-size: 0.85rem;"><i class="ph ph-arrow-left"></i> 뒤로</button>
                            </div>
                        ` : ''}
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
            </div>

            <div id="global-search-overlay" class="search-overlay" style="display: none;">
                <div class="search-panel glass">
                    <div class="search-input-row">
                        <i class="ph ph-magnifying-glass"></i>
                        <input id="global-search-input" type="text" placeholder="프로젝트 · 할일 · 문서 · 메모 검색..." autocomplete="off" />
                        <button id="close-search-btn" title="닫기 (Esc)"><i class="ph ph-x"></i></button>
                    </div>
                    <div id="global-search-results" class="search-results">
                        <div class="search-hint"><i class="ph ph-keyboard"></i> 검색어를 입력하세요. 결과를 클릭하면 해당 프로젝트로 이동합니다.</div>
                    </div>
                </div>
            </div>

            <div id="modal-container" class="modal-overlay" style="display: none;"></div>
        `;
        this.appContainer.innerHTML = dashboardHtml;

        // 이벤트 바인딩
        this.appContainer.querySelectorAll('.breadcrumb-back-btn').forEach(btn => {
            btn.onclick = () => this.setState({ currentView: 'dashboard' });
        });
        
        this.bindDashboardEvents();
        if (this.currentView === 'detail') this.bindDetailEvents();
        if (this.currentView === 'all_todos') this.bindAllTodosEvents();

        const doLogout = async () => {
            try { await this.supabase.auth.signOut(); } catch(err) {}
            localStorage.removeItem('bhas_session_user');
            localStorage.removeItem('bhas_auto_login');
            this.setState({ currentUser: null, currentView: 'login', activeProjectId: null, selectedCompanyId: 'all' });
        };
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.onclick = doLogout;
        const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
        if (mobileLogoutBtn) mobileLogoutBtn.onclick = doLogout;

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

    showProjectModal() {
        const modal = document.getElementById('modal-container');
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="glass modal-content fade-in" style="width: 90%; max-width: 450px; padding: 2rem; border-radius: 30px;">
                <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px;"><i class="ph ph-plus-circle"></i> 새 프로젝트 등록</h2>
                <div class="login-field">
                    <label>프로젝트명</label>
                    <input type="text" id="modal-p-name" class="login-input" placeholder="예: 구스다운 패딩">
                </div>
                <div class="login-field" style="${this.currentUser.role === 'CLIENT' ? 'display: none;' : ''}">
                    <label>파트너사 (브랜드)</label>
                    <select id="modal-p-brand" class="login-input" style="background: rgba(0,0,0,0.8); color: white; -webkit-appearance: listbox;">
                        <option value="">브랜드 선택</option>
                        ${mockData.brands.map(b => `
                            <option value="${b.id}">${b.name}</option>
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
                        note: '프로젝트 생성: ' + name
                    }]);
                } catch (hError) {}

                await this.loadInitialData();
                modal.style.display = 'none';
                this.requestRender();
                this.showToast('새 프로젝트가 등록되었습니다.');
            } catch (error) {
                let errorMsg = error.message || '알 수 없는 오류';
                if (error.code === '42501') errorMsg = '데이터베이스 권한(RLS)이 없습니다.';
                if (error.code === '22P02') errorMsg = '데이터 형식(UUID 등)이 맞지 않습니다.';
                if (error.code === '42703') errorMsg = `데이터베이스 컬럼 오류: ${error.details || '필드가 존재하지 않습니다.'}`;
                
                await this.showConfirm(`프로젝트 등록 중 오류가 발생했습니다.\n\n오류 코드: ${error.code || 'N/A'}\n메시지: ${errorMsg}`, '등록 실패');
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
                    <label>프로젝트 선택</label>
                    <select id="quick-todo-pid" class="login-input" style="background: rgba(0,0,0,0.8); color: white;">
                        <option value="">프로젝트 선택</option>
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

            if (!pid || !text) { this.showToast('프로젝트와 내용을 입력해주세요.'); return; }

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
                    <label>프로젝트 선택</label>
                    <select id="quick-doc-pid" class="login-input" style="background: rgba(0,0,0,0.8); color: white;">
                        <option value="">프로젝트 선택</option>
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
                        <div style="margin-bottom: 5px;"><strong>프로젝트:</strong> ${project.name}</div>
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

    renderHome(products) {
        products = products || mockData.products || [];
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
        const thisMonth = new Date().toISOString().slice(0, 7);
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
        const orderRows = recentOrders.map(o => `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--card-border);font-size:0.85rem"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(o.receiver_name || o.buyer_name || '-')} · ${this._vesc(this._orderItemsSummary(o))}</span><span style="color:var(--text-muted);white-space:nowrap">${o.order_date ? new Date(o.order_date).toLocaleDateString('ko-KR') : ''}</span></div>`).join('');
        const quoteRows = recentQuotes.map(q => `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--card-border);font-size:0.85rem"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(q.client_name)}</span><span style="font-weight:700;white-space:nowrap">${this._won(q.total_amount)}원</span></div>`).join('');
        const jobRows = activeJobs.filter(j => j.due_date).sort((a, b) => new Date(a.due_date) - new Date(b.due_date)).slice(0, 5).map(j => { const dd = dday(j.due_date); const col = dd < 0 ? '#ef4444' : (dd <= 3 ? '#f59e0b' : 'var(--text-muted)'); return `<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--card-border);font-size:0.85rem"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._vesc(j.title)} · ${this._vesc(j._v)}</span><span style="color:${col};font-weight:700;white-space:nowrap">${dd < 0 ? `지연${-dd}` : (dd === 0 ? '오늘' : `D-${dd}`)}</span></div>`; }).join('');

        return `
        <div class="fade-in" style="padding:1.5rem;max-width:1200px;margin:0 auto">
            <div style="margin-bottom:1.4rem">
                <h1 style="margin:0;font-size:1.5rem">👋 ${this._vesc(name)}님, 오늘 한눈에</h1>
                <p style="margin:5px 0 0;color:var(--text-muted);font-size:0.88rem">2179 통합 현황</p>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:1.5rem">
                ${kpi('ph-rocket-launch', activeProjects, '진행 중 프로젝트', '#3b82f6')}
                ${kpi('ph-truck', shipTargets, '배송 대상 주문', '#10b981')}
                ${kpi('ph-package', activeJobs.length, '진행중 생산 물품', '#f59e0b')}
                ${kpi('ph-receipt', this._won(monthTotal), '이번달 견적(원)', '#8b5cf6')}
                ${kpi('ph-plugs-connected', `${mallsConn}/${malls.length}`, '카페24 연동', '#ec4899')}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem">
                ${listCard('임박 생산 스케줄', 'ph-calendar-dots', jobRows, '진행중 물품 없음')}
                ${listCard('최근 주문', 'ph-shopping-bag-open', orderRows, '주문 없음')}
                ${listCard('최근 견적', 'ph-receipt', quoteRows, '견적 없음')}
            </div>
        </div>`;
    }

    renderSubView(products) {
        const { role, id: currentUserId, name: currentUserName } = this.currentUser;
        if (this.currentView === 'home') return this.renderHome(products);

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
                // 신규 프로젝트도 '진행 중'으로 표시하여 즉각적인 연동 확인이 가능하도록 수정
                return true; 
            };
            
            const activeProducts = products.filter(p => isActive(p));
            const scheduledProducts = products.filter(p => {
                const stage = p.currentStage || 'consulting';
                return stage !== 'shipping' && !isActive(p);
            });
            const completedProducts = products.filter(p => (p.currentStage || 'consulting') === 'shipping');

            const renderProjectCard = (product) => {
                const brand = mockData.brands?.find(b => b.id === product.brand_id);
                const company = mockData.companies.find(c => c.id === product.company_id);
                const brandName = brand ? brand.name : (company ? company.name : '알 수 없는 브랜드');
                const brandColor = brand ? (brand.brand_color || 'var(--primary)') : 'var(--primary)';
                const progress = getProgress(product);
                
                const lastCompletedStage = STAGES.slice().reverse().find(s => isStageCompleted(product, s));
                const currentStageObj = lastCompletedStage || STAGES[0];
                const statusLabel = lastCompletedStage ? lastCompletedStage.label : (progress === 0 && (product.history || []).length > 1 ? '상담 진행' : '시작 전');
                return `
                    <div class="project-card glass fade-in" data-id="${product.id}" style="cursor: pointer; border: 1px solid ${brandColor}20;">
                        <div class="card-header" style="margin-bottom: 12px;">
                            <span class="company-tag" style="border-color: ${brandColor}; color: white; background: ${brandColor}20; border-width: 2.5px;">
                                <i class="ph ph-buildings"></i> ${brandName}
                            </span>
                            <span class="deadline" style="font-size: 0.75rem; color: var(--text-muted);">~ ${this.formatDateToUI(product.deadline)}</span>
                        </div>
                        <h3>${product.name}</h3>
                        <div class="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${progress}%"></div>
                            </div>
                            <div class="progress-labels" style="justify-content: flex-start; margin-top: 8px;">
                                <span style="font-size: 0.8rem; font-weight: 500;">현재: ${statusLabel}</span>
                            </div>
                        </div>
                        <div class="card-footer" style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                            <div style="display: flex; align-items: center; gap: 4px;"><i class="ph ph-clock"></i> 마감: ${this.formatDateToUI(product.deadline)}</div>
                            <div style="display: flex; gap: 6px;">
                                ${this.canDelete(product) ? `<button class="btn-danger" onclick="app.handleDelete(event, 'project', '${product.id}')" title="프로젝트 삭제" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(var(--tint),0.05); border: 1px solid rgba(var(--tint),0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(var(--tint),0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(var(--tint),0.1)'"><i class="ph ph-x"></i></button>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            };

            const renderProjectTable = (productList) => {
                if (productList.length === 0) return '';
                
                // 브랜드(또는 회사)별 그룹화
                const grouped = productList.reduce((acc, p) => {
                    const groupId = p.brand_id || p.company_id;
                    if (!acc[groupId]) acc[groupId] = [];
                    acc[groupId].push(p);
                    return acc;
                }, {});

                return Object.keys(grouped).map(groupId => {
                    const brand = mockData.brands?.find(b => b.id === groupId);
                    const company = mockData.companies.find(c => c.id === groupId);
                    const groupName = brand ? brand.name : (company ? company.name : '알 수 없는 브랜드');
                    
                    // 브랜드 색상 결정: 브랜드 DB에 정의된 색상 -> 기존 하드코딩된 대행사 색상 -> 기본색
                    let brandColor = 'var(--primary)';
                    if (brand && brand.brand_color) {
                        brandColor = brand.brand_color;
                    } else if (groupId === 'company_a') {
                        brandColor = '#3b82f6';
                    } else if (groupId === 'company_b') {
                        brandColor = '#10b981';
                    }
                    
                    const projects = grouped[groupId].sort((a, b) => a.name.localeCompare(b.name));

                    const isActive = (p) => {
                        const stage = p.currentStage || 'consulting';
                        if (stage === 'shipping') return false;
                        if (stage !== 'consulting') return true;
                        return (p.stages_data?.consulting?.status === 'completed' || p.history?.length > 0 || (p.documents && p.documents.length > 0));
                    };
                    const activeCount = projects.filter(p => isActive(p)).length;
                    const scheduledCount = projects.filter(p => {
                        const stage = p.currentStage || 'consulting';
                        return stage !== 'shipping' && !isActive(p);
                    }).length;
                    const completedCount = projects.filter(p => (p.currentStage || 'consulting') === 'shipping').length;

                    return `
                        <div class="glass" style="border-radius: 16px; overflow: hidden; margin-bottom: 2rem; border: 1px solid ${brandColor}30;">
                            <div style="background: ${brandColor}10; padding: 12px 16px; border-bottom: 1px solid ${brandColor}20; display: flex; align-items: center; justify-content: space-between;">
                                <h3 style="font-size: 1rem; color: white; display: flex; align-items: center; gap: 8px; margin: 0;">
                                    <span class="company-tag" style="border-color: ${brandColor}; color: white; background: ${brandColor}20; border-width: 2.5px; scale: 0.9;">
                                        <i class="ph ph-buildings"></i> ${groupName}
                                    </span>
                                </h3>
                                <div style="display: flex; gap: 1.5rem;">
                                    <div class="stat-item">
                                        <div class="stat-label" style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                            <i class="ph ph-rocket-launch" style="color: var(--primary);"></i> 진행 중
                                        </div>
                                        <div class="stat-value" style="font-size: 2rem; font-weight: 800; color: var(--primary);">${activeCount}</div>
                                    </div>
                                    <div class="stat-item">
                                        <div class="stat-label" style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                            <i class="ph ph-calendar-blank" style="color: #f59e0b;"></i> 예정
                                        </div>
                                        <div class="stat-value" style="font-size: 2rem; font-weight: 800; color: #f59e0b;">${scheduledCount}</div>
                                    </div>
                                    <div class="stat-item">
                                        <div class="stat-label" style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: center; gap: 6px;">
                                            <i class="ph ph-check-circle" style="color: #10b981;"></i> 완료 됨
                                        </div>
                                        <div class="stat-value" style="font-size: 2rem; font-weight: 800; color: #10b981;">${completedCount}</div>
                                    </div>
                                </div>
                            </div>
                            <table style="width: 100%; border-collapse: collapse; text-align: left;">
                                <thead>
                                    <tr style="background: rgba(0,0,0,0.1); border-bottom: 1px solid var(--card-border);">
                                        <th style="padding: 12px 16px; color: var(--text-muted); font-weight: 500; font-size: 0.8rem;">프로젝트 명</th>
                                        <th style="padding: 12px 16px; color: var(--text-muted); font-weight: 500; font-size: 0.8rem;">마감일</th>
                                        <th style="padding: 12px 16px; color: var(--text-muted); font-weight: 500; font-size: 0.8rem;">진행 상황</th>
                                        <th style="padding: 12px 16px; text-align: center; color: var(--text-muted); font-weight: 500; font-size: 0.8rem;">액션</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${projects.map(product => {
                                        const progress = getProgress(product);
                                        const lastCompletedStage = STAGES.slice().reverse().find(s => isStageCompleted(product, s));
                                        const statusLabel = lastCompletedStage ? lastCompletedStage.label : (progress === 0 && (product.history || []).length > 1 ? '상담 진행' : '시작 전');
                                        
                                        return `
                                            <tr class="project-row" data-id="${product.id}" style="border-bottom: 1px solid rgba(var(--tint),0.05); transition: 0.2s; cursor: pointer;" onmouseover="this.style.background='rgba(var(--tint),0.02)'" onmouseout="this.style.background='transparent'">
                                                <td style="padding: 12px 16px; font-weight: 600;">
                                                    <div style="display: flex; align-items: center; gap: 8px;">
                                                        <i class="ph ph-briefcase" style="color: ${brandColor}; opacity: 0.7;"></i>
                                                        ${product.name}
                                                    </div>
                                                </td>
                                                <td style="padding: 12px 16px; font-size: 0.85rem; color: var(--text-muted);">${this.formatDateToUI(product.deadline)}</td>
                                                <td style="padding: 12px 16px;">
                                                    <div style="display: flex; align-items: center; gap: 10px;">
                                                        <div style="flex: 1; height: 6px; background: rgba(var(--tint),0.05); border-radius: 3px; overflow: hidden; max-width: 100px;">
                                                            <div style="width: ${progress}%; height: 100%; background: ${brandColor}; box-shadow: 0 0 10px ${brandColor}44;"></div>
                                                        </div>
                                                        <span style="font-size: 0.75rem; color: ${progress > 0 ? 'white' : 'var(--text-muted)'};">${statusLabel} (${progress}%)</span>
                                                    </div>
                                                </td>
                                                <td style="padding: 12px 16px; text-align: center;">
                                                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                                                        ${this.canDelete(product) ? `<button class="btn-danger" onclick="app.handleDelete(event, 'project', '${product.id}')" title="프로젝트 삭제" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(var(--tint),0.05); border: 1px solid rgba(var(--tint),0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(var(--tint),0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(var(--tint),0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    `;
                }).join('');
            };

            const renderSection = (list, isTable, emptyMsg) => {
                if (list.length === 0) return `<p style="color: var(--text-muted); margin-bottom: 2rem;">${emptyMsg}</p>`;
                return isTable ? renderProjectTable(list) : `<div class="project-grid" style="margin-bottom: 3rem;">${list.map(renderProjectCard).join('')}</div>`;
            };

            const isTable = this.dashboardViewType === 'table';

            const kpi = this.getDashboardKPIs(products);
            const kpiStrip = `
                <div class="kpi-strip">
                    <div class="glass kpi-card">
                        <span class="kpi-ico"><i class="ph ph-rocket-launch"></i></span>
                        <div class="kpi-body"><span class="kpi-num">${kpi.activeCount}</span><span class="kpi-label">진행 프로젝트</span></div>
                    </div>
                    <div class="glass kpi-card">
                        <span class="kpi-ico"><i class="ph ph-chart-line-up"></i></span>
                        <div class="kpi-body"><span class="kpi-num">${kpi.avgProgress}<small>%</small></span><span class="kpi-label">평균 진행률</span></div>
                    </div>
                    <div class="glass kpi-card ${kpi.delayed > 0 ? 'kpi-danger' : ''}">
                        <span class="kpi-ico"><i class="ph ph-warning-circle"></i></span>
                        <div class="kpi-body"><span class="kpi-num">${kpi.delayed}</span><span class="kpi-label">지연 프로젝트</span></div>
                    </div>
                    <div class="glass kpi-card ${kpi.dueThisWeek > 0 ? 'kpi-warn' : ''}">
                        <span class="kpi-ico"><i class="ph ph-clock-countdown"></i></span>
                        <div class="kpi-body"><span class="kpi-num">${kpi.dueThisWeek}</span><span class="kpi-label">7일내 마감</span></div>
                    </div>
                    <div class="glass kpi-card">
                        <span class="kpi-ico"><i class="ph ph-list-checks"></i></span>
                        <div class="kpi-body"><span class="kpi-num">${kpi.openTodos}</span><span class="kpi-label">미완료 할일</span></div>
                    </div>
                </div>
            `;

            return `
                <div class="dashboard-sections">
                    ${kpiStrip}
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                        <h2 style="font-size: 1.2rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px;"><i class="ph ph-rocket-launch"></i> 진행 중인 프로젝트</h2>
                        ${this.currentUser.role === 'MASTER' || this.currentUser.role === 'STAFF' ? `<button id="add-project-btn" class="btn-primary" style="padding: 8px 16px; border-radius: 8px; font-size: 0.9rem;"><i class="ph ph-plus"></i> 새 프로젝트</button>` : ''}
                    </div>
                    ${renderSection(activeProducts, isTable, '진행 중인 프로젝트가 없습니다.')}

                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; border-top: 1px solid var(--card-border); padding-top: 2rem;">
                        <h2 style="font-size: 1.2rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px;"><i class="ph ph-calendar-blank"></i> 예정 프로젝트</h2>
                        <button class="toggle-btn ${this.scheduledExpanded === false ? 'collapsed' : ''}" id="toggle-scheduled-btn" title="토글">
                            <i class="ph ph-caret-down" style="font-size: 1.2rem;"></i>
                        </button>
                    </div>
                    <div class="collapsible-content ${this.scheduledExpanded === false ? 'collapsed' : ''}" id="scheduled-section">
                        ${renderSection(scheduledProducts, isTable, '예정된 프로젝트가 없습니다.')}
                    </div>

                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; border-top: 1px solid var(--card-border); padding-top: 2rem;">
                        <h2 style="font-size: 1.2rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px;"><i class="ph ph-check-circle"></i> 완료된 프로젝트</h2>
                        <button class="toggle-btn ${!this.completedExpanded ? 'collapsed' : ''}" id="toggle-completed-btn" title="토글">
                            <i class="ph ph-caret-down" style="font-size: 1.2rem;"></i>
                        </button>
                    </div>
                    <div class="collapsible-content ${!this.completedExpanded ? 'collapsed' : ''}" id="completed-section">
                        ${renderSection(completedProducts, isTable, '완료된 프로젝트가 없습니다.')}
                    </div>

                    <div class="mobile-logout-area" style="margin-top: 3rem; padding-top: 2rem; border-top: 1px solid var(--card-border); text-align: center;">
                        <button id="mobile-logout-btn" style="padding: 12px 2rem; border-radius: 12px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); color: #ef4444; font-size: 0.9rem; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.2)'" onmouseout="this.style.background='rgba(239,68,68,0.1)'">
                            <i class="ph ph-sign-out" style="font-size: 1.1rem;"></i> 로그아웃
                        </button>
                        <div style="margin-top: 1rem; font-size: 0.7rem; color: var(--text-muted);">${this.currentUser.name} (${this.currentUser.role})</div>
                    </div>
                </div>
            `;
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
            const categories = ['전체', '작업지시서', '회의록', '참고이미지', '기타자료', '세금계산서'];
            
            // 데이터 통합 및 자동 분류 로직
            // 1. 글로벌 문서 필터링 (선택된 브랜드 프로젝트에 해당하는 문서만)
            const filteredProjectIds = products.map(p => p.id);
            let aggregatedDocs = mockData.globalDocuments.filter(d => filteredProjectIds.includes(d.productId));
            
            // 2. 전달받은 필터링된 products에서 사진/문서 수집
            products.forEach(p => {
                // 프로젝트별 사진 -> '참고이미지'로 분류
                (p.photos || []).forEach((photo, idx) => {
                    const photoUrl = typeof photo === 'string' ? photo : photo.url;
                    aggregatedDocs.push({
                        id: typeof photo === 'object' ? photo.id : `auto-photo-${p.id}-${idx}`,
                        date: (p.history || [])[0]?.date || '2024.03.01',
                        name: `${p.name} 제작 사진 ${idx + 1}`,
                        category: '참고이미지',
                        productId: p.id,
                        url: photoUrl,
                        memo: '프로젝트 상세에서 등록된 사진'
                    });
                });
                
                // 프로젝트별 문서 -> 기존 카테고리 유지 혹은 기본값
                (p.documents || []).forEach((doc, idx) => {
                    aggregatedDocs.push({
                        id: doc.id || `auto-doc-${p.id}-${idx}`,
                        date: doc.date,
                        name: doc.name,
                        category: doc.category || '기타자료',
                        productId: p.id,
                        url: doc.url,
                        memo: '프로젝트 내 관련 문서'
                    });
                });
            });

            let filteredDocs = aggregatedDocs;
            if (this.selectedDocCategory !== '전체') {
                filteredDocs = aggregatedDocs.filter(d => d.category === this.selectedDocCategory);
            }

            const isMobile = window.innerWidth <= 768;

            return `
                <div class="glass" style="padding: 2rem; border-radius: 20px;">
                    <div class="mobile-responsive-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2rem; gap: 1.5rem; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 12px; width: ${isMobile ? '100%' : 'auto'}; flex-direction: ${isMobile ? 'column' : 'row'};">
                            <h2 style="display: flex; align-items: center; gap: 8px; font-size: 1.5rem; margin: 0; white-space: nowrap;"><i class="ph ph-folder-open"></i> 통합 문서 관리</h2>
                            ${(role === 'MASTER' || role === 'STAFF') ? `
                                <select id="doc-global-company-filter" class="glass brand-select" style="margin-top: ${isMobile ? '5px' : '0'}; width: ${isMobile ? '100%' : 'auto'}; min-width: ${isMobile ? '0' : '200px'}; max-width: 100%; color: white; border: 1px solid rgba(var(--tint),0.1); border-radius: 8px; padding: 6px 12px; outline: none; cursor: pointer; box-sizing: border-box;">
                                    <option value="all" style="background: #0f172a; color: white;" ${this.selectedCompanyId === 'all' ? 'selected' : ''}>전체 브랜드 보기</option>
                                    ${(mockData.brands || []).map(b => `
                                        <option value="${b.id}" style="background: #0f172a; color: white;" ${this.selectedCompanyId === b.id ? 'selected' : ''}>${b.name}</option>
                                    `).join('')}
                                </select>
                            ` : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 12px; width: ${isMobile ? '100%' : 'auto'}; flex-direction: ${isMobile ? 'column' : 'row'};">
                            <div class="category-filters" style="display: flex; gap: 8px; align-items: center; width: ${isMobile ? '100%' : 'auto'}; flex-wrap: ${isMobile ? 'nowrap' : 'wrap'}; overflow-x: auto;">
                                ${categories.map(cat => `
                                    <button class="filter-btn glass ${this.selectedDocCategory === cat ? 'active' : ''}" 
                                            data-cat="${cat}" 
                                            style="padding: 8px 16px; border-radius: 20px; font-size: 0.85rem; cursor: pointer; transition: 0.3s;
                                                   white-space: nowrap; flex-shrink: 0;
                                                   color: ${this.selectedDocCategory === cat ? 'white' : 'var(--text-muted)'};
                                                   background: ${this.selectedDocCategory === cat ? 'var(--primary)' : 'rgba(var(--tint),0.05)'};">
                                        ${cat}
                                    </button>
                                `).join('')}
                            </div>
                            <button class="btn-primary" id="quick-add-doc-btn" style="padding: 10px 16px; border-radius: 20px; font-size: 0.9rem; width: ${isMobile ? '100%' : 'auto'}; white-space: nowrap;">+ 새 문서 추가</button>
                        </div>
                    </div>
                    
                    <div class="table-container fade-in">
                        ${isMobile ? `
                            <div class="doc-card-grid">
                                ${filteredDocs.map(doc => {
                                    const product = mockData.products.find(p => p.id === doc.productId);
                                    const brand = product ? mockData.brands?.find(b => b.id === product.brand_id) : null;
                                    return `
                                        <div class="doc-mobile-card glass" onclick="app.showFileModal('${doc.url}', '${doc.name}')">
                                            <div class="doc-card-top">
                                                <div class="doc-card-info">
                                                    <span class="doc-card-brand">${brand ? brand.name : '-'}</span>
                                                    <span class="doc-card-project">${product ? product.name : '알 수 없음'}</span>
                                                </div>
                                                <span class="badge badge-${doc.category || '기타'}" style="font-size: 0.7rem;">
                                                    ${doc.category || '기타'}
                                                </span>
                                            </div>
                                            <div class="doc-card-name" style="display: flex; align-items: center; gap: 6px;">
                                                <i class="ph ph-file-text"></i>
                                                <input type="text" class="inline-docname-input"
                                                       data-doc-id="${doc.id}"
                                                       data-p-id="${doc.productId || ''}"
                                                       value="${(doc.name || '').replace(/"/g, '&quot;')}"
                                                       style="background: transparent; border: none; color: white; width: 100%; padding: 4px; border-radius: 4px; border-bottom: 1px dashed rgba(var(--tint),0.1); font-weight: 600; font-size: 0.85rem;"
                                                       onclick="event.stopPropagation()">
                                            </div>
                                            <div style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">
                                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                                    <span><i class="ph ph-calendar"></i> ${doc.date || '-'}</span>
                                                    ${doc.memo ? `<span><i class="ph ph-note"></i> ${doc.memo}</span>` : ''}
                                                </div>
                                                ${this.canDelete(doc) ? `<button class="icon-btn" onclick="event.stopPropagation(); app.handleDelete(event, 'document', '${doc.id}', '${doc.productId || ''}')" style="width: 32px; height: 32px; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; display: flex; align-items: center; justify-content: center;"><i class="ph ph-trash" style="font-size: 1.1rem;"></i></button>` : ''}
                                            </div>
                                        </div>
                                    `;
                                }).reverse().join('')}
                                ${filteredDocs.length === 0 ? '<div style="text-align: center; padding: 3rem 0; color: var(--text-muted);">표시할 문서가 없습니다.</div>' : ''}
                            </div>
                        ` : `
                            <table class="doc-table" style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="text-align: left; border-bottom: 1px solid var(--card-border); color: var(--text-muted); font-size: 0.8rem;">
                                        <th style="padding: 12px;">날짜</th>
                                        <th style="padding: 12px;">브랜드명</th>
                                        <th style="padding: 12px;">프로젝트</th>
                                        <th style="padding: 12px;">문서이름</th>
                                        <th style="padding: 12px;">간단메모 (수정가능)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${filteredDocs.map(doc => {
                                        const product = mockData.products.find(p => p.id === doc.productId);
                                        const brand = product ? mockData.brands?.find(b => b.id === product.brand_id) : null;
                                        return `
                                            <tr class="table-row doc-row" style="border-bottom: 1px solid rgba(var(--tint),0.05); font-size: 0.85rem; cursor: pointer;" 
                                                onclick="app.showFileModal('${doc.url}', '${doc.name}')">
                                                <td style="padding: 12px; color: var(--text-muted);">${doc.date || '-'}</td>
                                                <td style="padding: 12px;">${brand ? brand.name : '-'}</td>
                                                <td style="padding: 12px; color: var(--primary);">${product ? product.name : '알 수 없음'}</td>
                                                <td style="padding: 12px; font-weight: 600;">
                                                    <div style="display: flex; align-items: center; gap: 8px;">
                                                        <span class="badge badge-${doc.category || '기타'}" style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; vertical-align: middle;">
                                                            ${doc.category || '기타'}
                                                        </span>
                                                        <input type="text" class="inline-docname-input"
                                                               data-doc-id="${doc.id}"
                                                               data-p-id="${doc.productId || ''}"
                                                               value="${(doc.name || '').replace(/"/g, '&quot;')}"
                                                               style="background: transparent; border: none; color: white; width: 100%; padding: 4px; border-radius: 4px; border-bottom: 1px dashed rgba(var(--tint),0.1); font-weight: 600;"
                                                               onclick="event.stopPropagation()">
                                                    </div>
                                                </td>
                                                <td style="padding: 12px; font-size: 0.8rem;" class="memo-cell">
                                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                                                        <input type="text" class="inline-memo-input" 
                                                               data-doc-id="${doc.id}" 
                                                               data-p-id="${doc.productId || ''}"
                                                               value="${doc.memo || ''}" 
                                                               style="background: transparent; border: none; color: white; width: 100%; padding: 4px; border-radius: 4px; border-bottom: 1px dashed rgba(var(--tint),0.1);"
                                                               onclick="event.stopPropagation()">
                                                        ${this.canDelete(doc) ? `<button onclick="event.stopPropagation(); app.handleDelete(event, 'document', '${doc.id}', '${doc.productId || ''}')" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(var(--tint),0.05); border: 1px solid rgba(var(--tint),0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(var(--tint),0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(var(--tint),0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                                    </div>
                                                </td>
                                            </tr>
                                        `;
                                    }).reverse().join('')}
                                    ${filteredDocs.length === 0 ? '<tr><td colspan="5" style="text-align: center; padding: 3rem 0; color: var(--text-muted);">표시할 문서가 없습니다.</td></tr>' : ''}
                                </tbody>
                            </table>
                        `}
                    </div>
                </div>
            `;
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
            return `
                <div class="glass" style="padding: 2rem; border-radius: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                        <h2 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-user-plus"></i> 계정 관리</h2>
                        <button class="btn-primary" id="add-account-btn" style="padding: 0.5rem 1rem; font-size: 0.8rem;">+ 계정 추가</button>
                    </div>
                    <div class="table-responsive-container">
                        <table class="responsive-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="text-align: left; border-bottom: 1px solid var(--card-border); color: var(--text-muted); font-size: 0.8rem;">
                                <th style="padding: 1rem;">성함</th>
                                <th style="padding: 1rem;">ID</th>
                                <th style="padding: 1rem;">배정 브랜드(등급)</th>
                                <th style="padding: 1rem;">권한 역할</th>
                                <th style="padding: 1rem; text-align: center;">관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${mockData.companies.filter(c => c.username).map(c => {
                                const brand = mockData.brands?.find(b => b.id === c.brand_id);
                                return `
                                <tr style="border-bottom: 1px solid rgba(var(--tint),0.05); font-size: 0.85rem;">
                                    <td style="padding: 1rem; font-weight: 500;">${c.name}</td>
                                    <td style="padding: 1rem; color: var(--text-muted);">${c.username}</td>
                                    <td style="padding: 1rem;">
                                        <span style="color: var(--primary); font-weight: 600;">
                                            ${c.role === 'CLIENT' ? (brand ? brand.name : '브랜드 미지정') : (c.role === 'MASTER' ? '전체 관리' : '운영 관리')}
                                        </span>
                                    </td>
                                    <td style="padding: 1rem;">
                                        <span style="background: ${c.role === 'MASTER' ? 'rgba(37,99,235,0.2)' : (c.role === 'STAFF' ? 'rgba(16,185,129,0.1)' : 'rgba(var(--tint),0.05)')}; 
                                              color: ${c.role === 'MASTER' ? 'var(--primary)' : (c.role === 'STAFF' ? '#10b981' : '#ccc')}; 
                                              padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700;">
                                            ${c.role}
                                        </span>
                                    </td>
                                    <td style="padding: 1rem; text-align: center;">
                                        <button class="btn-secondary edit-user-btn" data-id="${c.id}" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 6px;">수정</button>
                                        <button class="btn-danger" onclick="app.handleDelete(event, 'user', '${c.id}')" style="padding: 4px; border-radius: 6px; margin-left: 4px;"><i class="ph ph-trash"></i></button>
                                    </td>
                                </tr>
                            `}).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        } else if (this.currentView === 'brand_management') {
            const allBrands = mockData.brands || [];
            const activeBrands = allBrands.filter(b => b.status !== 'closed');
            const closedBrands = allBrands.filter(b => b.status === 'closed');

            const renderBrandTable = (brands, emptyMsg) => {
                if (brands.length === 0) return `<div style="color: var(--text-muted); text-align: center; padding: 2rem; font-size: 0.9rem;">${emptyMsg}</div>`;
                return `
                    <div class="table-responsive-container">
                        <table class="responsive-table" style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="border-bottom: 1px solid var(--card-border);">
                                    <th style="text-align: left; padding: 12px; color: var(--text-muted); font-size: 0.8rem; font-weight: 600;">컬러</th>
                                    <th style="text-align: left; padding: 12px; color: var(--text-muted); font-size: 0.8rem; font-weight: 600;">브랜드명</th>
                                    <th style="text-align: left; padding: 12px; color: var(--text-muted); font-size: 0.8rem; font-weight: 600;">프로젝트</th>
                                    <th style="text-align: left; padding: 12px; color: var(--text-muted); font-size: 0.8rem; font-weight: 600;">소속 계정</th>
                                    <th style="text-align: left; padding: 12px; color: var(--text-muted); font-size: 0.8rem; font-weight: 600;">상태</th>
                                    <th style="text-align: center; padding: 12px; color: var(--text-muted); font-size: 0.8rem; font-weight: 600;">관리</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${brands.map(b => {
                                    const projectCount = mockData.products.filter(p => p.brand_id === b.id).length;
                                    const userCount = mockData.companies.filter(u => u.brand_id === b.id).length;
                                    const isClosed = b.status === 'closed';
                                    return `
                                    <tr style="border-bottom: 1px solid rgba(var(--tint),0.04); transition: 0.2s; ${isClosed ? 'opacity: 0.5;' : ''}" onmouseover="this.style.background='rgba(var(--tint),0.03)'" onmouseout="this.style.background='transparent'">
                                        <td data-label="컬러" style="padding: 14px 12px;">
                                            <div style="width: 28px; height: 28px; border-radius: 8px; background: ${b.brand_color || 'var(--primary)'}; border: 2px solid rgba(var(--tint),0.1);"></div>
                                        </td>
                                        <td data-label="브랜드명" style="padding: 14px 12px; font-weight: 600; font-size: 0.95rem;">${b.name}</td>
                                        <td data-label="프로젝트" style="padding: 14px 12px; color: var(--text-muted); font-size: 0.9rem;">${projectCount}개</td>
                                        <td data-label="소속 계정" style="padding: 14px 12px; color: var(--text-muted); font-size: 0.9rem;">${userCount}명</td>
                                        <td data-label="상태" style="padding: 14px 12px;">
                                            <span style="font-size: 0.75rem; padding: 3px 10px; border-radius: 10px; font-weight: 600; ${isClosed
                                                ? 'background: rgba(148,163,184,0.1); color: #94a3b8;'
                                                : 'background: rgba(16,185,129,0.1); color: #10b981;'
                                            }">${isClosed ? '종료' : '진행 중'}</span>
                                        </td>
                                        <td data-label="관리" style="padding: 14px 12px; text-align: center;">
                                            <button class="btn-secondary edit-brand-btn" data-id="${b.id}" style="padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; margin-right: 4px;">수정</button>
                                            <button class="btn-danger" onclick="app.handleDelete(event, 'brand', '${b.id}')" style="padding: 4px; border-radius: 6px;"><i class="ph ph-trash"></i></button>
                                        </td>
                                    </tr>
                                `}).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            };

            return `
                <div class="glass" style="padding: 2rem; border-radius: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                        <h2 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-shield-check"></i> 브랜드(등급) 관리</h2>
                        <button class="btn-primary" id="add-brand-btn" style="padding: 0.5rem 1rem; font-size: 0.8rem;">+ 브랜드 생성</button>
                    </div>

                    <h3 style="font-size: 1rem; color: var(--text-muted); margin-bottom: 1rem; display: flex; align-items: center; gap: 8px;">
                        <i class="ph ph-rocket-launch"></i> 진행 중 (${activeBrands.length})
                    </h3>
                    ${renderBrandTable(activeBrands, '진행 중인 브랜드가 없습니다.')}

                    ${closedBrands.length > 0 ? `
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 2rem; margin-bottom: 1rem; border-top: 1px solid var(--card-border); padding-top: 1.5rem;">
                            <h3 style="font-size: 1rem; color: var(--text-muted); margin: 0; display: flex; align-items: center; gap: 8px;">
                                <i class="ph ph-archive"></i> 종료됨 (${closedBrands.length})
                            </h3>
                            <button class="toggle-btn ${!this.brandClosedExpanded ? 'collapsed' : ''}" id="toggle-closed-brands-btn" title="토글">
                                <i class="ph ph-caret-down" style="font-size: 1.2rem;"></i>
                            </button>
                        </div>
                        <div class="collapsible-content ${!this.brandClosedExpanded ? 'collapsed' : ''}">
                            ${renderBrandTable(closedBrands, '')}
                        </div>
                    ` : ''}
                </div>
            `;
        } else if (this.currentView === 'timeline') {
            // 생산 타임라인: 프로젝트별 8단계 공정을 마감순으로 한눈에
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
                                <span class="company-tag tl-brand" style="border-color:${bColor}; color:#fff; background:${bColor}22;"><i class="ph ph-buildings"></i> ${this._brandName(p)}</span>
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
                    ${rows || '<p style="color: var(--text-muted); padding: 2rem 0;">표시할 프로젝트가 없습니다.</p>'}
                </div>
            `;
        } else if (this.currentView === 'sample_maker') {
            return renderSampleMaker(this.sampleConfig);
        } else if (this.currentView === 'orders') {
            return this.renderOrders();
        } else if (this.currentView === 'inventory') {
            return this.renderInventory();
        } else if (this.currentView === 'pages') {
            return this.renderPagesView();
        } else if (this.currentView === 'kanban') {
            return this.renderKanban();
        } else if (this.currentView === 'calendar') {
            return this.renderCalendar();
        } else if (this.currentView === 'table') {
            return this.renderTableView();
        } else if (this.currentView === 'vendors') {
            return this.renderVendors();
        } else if (this.currentView === 'integrations') {
            return this.renderIntegrations();
        } else if (this.currentView === 'quotes') {
            return this.renderQuotes();
        } else if (this.currentView === 'sales') {
            return this.renderSales();
        }
    }

    // ============================================================
    //  매출 — 브랜드별 · 월별 집계 (channel_orders × malls→brand)
    // ============================================================
    renderSales() {
        if (!this._ordersLoaded || !this._mallsLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">매출 데이터를 불러오는 중...</div>`;
        const orders = (this.orders || []).filter(o => o.order_date && o.pay_amount != null);
        const brandName = (o) => {
            const mall = (this.malls || []).find(m => m.mall_key === o.mall_key);
            if (mall) { const b = (mockData.brands || []).find(x => x.id === mall.brand_id); return b ? b.name : (mall.label || '기타'); }
            return o.mall_key || o.channel || '기타';
        };
        const ym = (d) => { const dt = new Date(d); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; };
        const won = n => this._won(Math.round(n));
        const monthLabel = m => { const [y, mm] = m.split('-'); return `${+mm}월<span style="color:var(--text-muted);font-size:0.7rem">'${y.slice(2)}</span>`; };

        if (!orders.length) return `<div class="fade-in" style="padding:1.5rem;max-width:1100px;margin:0 auto"><h1 style="font-size:1.4rem"><i class="ph ph-chart-line-up"></i> 매출</h1><div class="glass" style="padding:3rem;border-radius:16px;text-align:center;color:var(--text-muted);margin-top:1rem">주문 데이터가 없습니다. 주문이 수집되면 브랜드별 월 매출이 자동 집계됩니다.</div></div>`;

        let months = [...new Set(orders.map(o => ym(o.order_date)))].sort();
        if (months.length > 12) months = months.slice(-12);
        const monthIdx = Object.fromEntries(months.map((m, i) => [m, i]));

        const byBrand = {};
        orders.forEach(o => {
            const m = ym(o.order_date); if (!(m in monthIdx)) return;
            const bn = brandName(o);
            const rec = byBrand[bn] || (byBrand[bn] = { name: bn, cells: months.map(() => ({ amt: 0, cnt: 0 })), total: 0, cnt: 0 });
            const amt = Number(o.pay_amount) || 0;
            rec.cells[monthIdx[m]].amt += amt; rec.cells[monthIdx[m]].cnt += 1; rec.total += amt; rec.cnt += 1;
        });
        const brands = Object.values(byBrand).sort((a, b) => b.total - a.total);
        const monthTotals = months.map((_, i) => brands.reduce((s, b) => s + b.cells[i].amt, 0));
        const grand = monthTotals.reduce((s, x) => s + x, 0);
        const thisM = monthTotals[monthTotals.length - 1] || 0, prevM = monthTotals[monthTotals.length - 2] || 0;
        const mom = prevM ? Math.round((thisM - prevM) / prevM * 100) : null;
        const maxMonth = Math.max(1, ...monthTotals);
        const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];

        const cards = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:1.2rem">
            ${[
                { l: '이번 달 매출', v: won(thisM) + '원', s: mom == null ? '' : `전월 대비 ${mom >= 0 ? '+' : ''}${mom}%`, c: mom == null ? '' : (mom >= 0 ? '#10b981' : '#ef4444') },
                { l: `기간 합계 (${months.length}개월)`, v: won(grand) + '원', s: `${brands.length}개 브랜드`, c: 'var(--text-muted)' },
                { l: '월 평균', v: won(grand / Math.max(1, months.length)) + '원', s: '', c: 'var(--text-muted)' },
                { l: '총 주문', v: orders.length.toLocaleString() + '건', s: '', c: 'var(--text-muted)' },
            ].map(k => `<div class="glass" style="padding:1rem 1.1rem;border-radius:14px">
                <div style="font-size:0.78rem;color:var(--text-muted)">${k.l}</div>
                <div style="font-size:1.25rem;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums">${k.v}</div>
                ${k.s ? `<div style="font-size:0.75rem;margin-top:2px;color:${k.c};font-weight:600">${k.s}</div>` : ''}
            </div>`).join('')}
        </div>`;

        const bars = `<div class="glass" style="padding:1.1rem 1.2rem;border-radius:16px;margin-bottom:1.2rem">
            <div style="font-size:0.9rem;font-weight:700;margin-bottom:0.9rem"><i class="ph ph-chart-bar"></i> 월별 매출 추이</div>
            <div style="display:flex;align-items:flex-end;gap:8px;height:135px">
                ${months.map((m, i) => { const h = Math.round(monthTotals[i] / maxMonth * 108); return `
                    <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0">
                        <div style="font-size:0.65rem;color:var(--text-muted);white-space:nowrap;font-variant-numeric:tabular-nums">${monthTotals[i] ? won(Math.round(monthTotals[i] / 10000)) + '만' : ''}</div>
                        <div style="width:100%;max-width:40px;height:${Math.max(2, h)}px;background:linear-gradient(180deg,var(--primary),rgba(99,102,241,0.45));border-radius:5px 5px 0 0"></div>
                        <div style="font-size:0.7rem;color:var(--text-main)">${monthLabel(m)}</div>
                    </div>`; }).join('')}
            </div>
        </div>`;

        const table = `<div class="glass" style="padding:1.1rem 1.2rem;border-radius:16px;overflow-x:auto">
            <div style="font-size:0.9rem;font-weight:700;margin-bottom:0.9rem"><i class="ph ph-table"></i> 브랜드별 · 월별 매출</div>
            <table style="width:100%;border-collapse:collapse;font-size:0.82rem;white-space:nowrap">
                <thead><tr style="border-bottom:2px solid var(--card-border)">
                    <th style="text-align:left;padding:8px 10px">브랜드</th>
                    ${months.map(m => `<th style="text-align:right;padding:8px 10px">${monthLabel(m)}</th>`).join('')}
                    <th style="text-align:right;padding:8px 10px;border-left:1px solid var(--card-border)">합계</th>
                </tr></thead>
                <tbody>
                    ${brands.map((b, bi) => `<tr style="border-bottom:1px solid var(--card-border)">
                        <td style="text-align:left;padding:8px 10px;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${palette[bi % palette.length]};margin-right:6px"></span>${this._vesc(b.name)}</td>
                        ${b.cells.map(c => `<td style="text-align:right;padding:8px 10px;font-variant-numeric:tabular-nums;color:${c.amt ? 'var(--text-main)' : 'var(--text-muted)'}">${c.amt ? won(c.amt) : '·'}</td>`).join('')}
                        <td style="text-align:right;padding:8px 10px;font-weight:800;font-variant-numeric:tabular-nums;border-left:1px solid var(--card-border)">${won(b.total)}</td>
                    </tr>`).join('')}
                </tbody>
                <tfoot><tr style="border-top:2px solid var(--card-border);font-weight:800">
                    <td style="text-align:left;padding:8px 10px">합계</td>
                    ${monthTotals.map(t => `<td style="text-align:right;padding:8px 10px;font-variant-numeric:tabular-nums">${won(t)}</td>`).join('')}
                    <td style="text-align:right;padding:8px 10px;font-variant-numeric:tabular-nums;border-left:1px solid var(--card-border)">${won(grand)}</td>
                </tr></tfoot>
            </table>
            <p style="margin:0.8rem 0 0;font-size:0.74rem;color:var(--text-muted)">* 결제금액(pay_amount) 기준 총 주문액. 취소·환불은 채널 상태 연동 후 반영됩니다.</p>
        </div>`;

        return `<div class="fade-in" style="padding:1.5rem;max-width:1100px;margin:0 auto">
            <div style="margin-bottom:1.2rem">
                <h1 style="margin:0;font-size:1.4rem"><i class="ph ph-chart-line-up"></i> 매출</h1>
                <p style="margin:4px 0 0;color:var(--text-muted);font-size:0.85rem">브랜드별 · 월별 매출 집계 (몰→브랜드 자동 매핑)</p>
            </div>
            ${cards}${bars}${table}
        </div>`;
    }

    // ============================================================
    //  공용: 뷰 진입 시 데이터 lazy-load 디스패처
    // ============================================================
    ensureViewData() {
        const v = this.currentView;
        if ((v === 'orders' || v === 'inventory' || v === 'integrations' || v === 'sales') && !this._mallsLoaded && !this._mallsLoading) this.loadMalls();
        if (v === 'sales' && !this._ordersLoaded && !this._ordersLoading) this.loadOrders();
        if (v === 'integrations' && !this._bsLoaded && !this._bsLoading) this.loadBrandSettings();
        if (v === 'orders' && !this._ordersLoaded && !this._ordersLoading) this.loadOrders();
        if (v === 'inventory' && !this._invLoaded && !this._invLoading) this.loadInventory();
        if (v === 'pages' && !this._pagesLoaded && !this._pagesLoading) this.loadPages();
        if ((v === 'kanban' || v === 'table' || v === 'calendar') && !this._cardsLoaded && !this._cardsLoading) this.loadCards();
        if (v === 'vendors' && !this._vendorsLoaded && !this._vendorsLoading) this.loadVendors();
        if (v === 'quotes' && !this._quotesLoaded && !this._quotesLoading) this.loadQuotes();
        if (v === 'home') {
            if (!this._ordersLoaded && !this._ordersLoading) this.loadOrders();
            if (!this._quotesLoaded && !this._quotesLoading) this.loadQuotes();
            if (!this._vendorsLoaded && !this._vendorsLoading) this.loadVendors();
            if (!this._mallsLoaded && !this._mallsLoading) this.loadMalls();
        }
    }

    _actor() { return this.currentUser?.username || this.currentUser?.name || 'system'; }
    _brandNameById(id) { const b = (mockData.brands || []).find(b => b.id === id); return b ? b.name : '-'; }
    _brandOptions(selected) {
        return `<option value="" style="background:#0f172a">브랜드 없음</option>` +
            (mockData.brands || []).map(b => `<option value="${b.id}" style="background:#0f172a" ${b.id === selected ? 'selected' : ''}>${b.name}</option>`).join('');
    }
    closeGlobalModal() { const c = document.getElementById('global-modal-container'); if (c) { c.style.display = 'none'; c.innerHTML = ''; } }

    // ============================================================
    //  멀티몰 (브랜드별 카페24몰)
    // ============================================================
    async loadMalls() {
        this._mallsLoading = true;
        try {
            const { data } = await this.supabase.from('malls').select('*').order('created_at', { ascending: true });
            this.malls = data || [];
            this._mallsLoaded = true;
        } catch (e) { this.malls = []; this._mallsLoaded = true; }
        this._mallsLoading = false;
        this.requestRender();
    }
    _mallLabel(key) { const m = (this.malls || []).find(m => m.mall_key === key); return m ? m.label : (key || '-'); }
    _mallOptions(selected) {
        return `<option value="" style="background:#0f172a">몰 선택 안 함</option>` +
            (this.malls || []).map(m => `<option value="${m.mall_key}" style="background:#0f172a" ${m.mall_key === selected ? 'selected' : ''}>${m.label}</option>`).join('');
    }
    _oauthUrl(mallKey) { return `${SUPABASE_URL}/functions/v1/cafe24-oauth?mall=${encodeURIComponent(mallKey)}`; }

    // ============================================================
    //  주문/배송 통합관리 (OMS) — 카페24
    // ============================================================
    async loadOrders() {
        this._ordersLoading = true;
        try {
            const [ordersRes, itemsRes] = await Promise.all([
                this.supabase.from('channel_orders').select('*').order('order_date', { ascending: false }).limit(500),
                this.supabase.from('channel_order_items').select('*')
            ]);
            const byOrder = {};
            (itemsRes.data || []).forEach(it => { (byOrder[it.channel_order_id] = byOrder[it.channel_order_id] || []).push(it); });
            this.orders = (ordersRes.data || []).map(o => ({ ...o, items: byOrder[o.id] || [] }));
            this._ordersLoaded = true;
        } catch (e) {
            this.showToast('주문을 불러오지 못했습니다. (스키마 설치 필요할 수 있음)');
            this.orders = []; this._ordersLoaded = true;
        }
        this._ordersLoading = false;
        this.requestRender();
    }

    _orderStatusLabel(s) { return ({ new: '신규', ready: '배송준비', shipping: '배송중', done: '완료', hold: '보류' })[s] || s; }
    _orderItemsSummary(o) {
        const its = o.items || [];
        if (!its.length) return '-';
        const first = its[0].product_name || its[0].variant_code || '상품';
        return its.length > 1 ? `${first} 외 ${its.length - 1}건` : first;
    }
    _orderQtySum(o) { return (o.items || []).reduce((s, it) => s + (it.quantity || 0), 0); }

    renderOrders() {
        if (!this._ordersLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">주문을 불러오는 중...</div>`;
        const filter = this.orderFilter || 'target';
        const all = this.orders || [];
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
        const tab = (id, label, n) => `<button class="oms-tab ${filter === id ? 'active' : ''}" data-f="${id}" style="padding:7px 14px;border-radius:20px;font-size:0.85rem;cursor:pointer;border:1px solid var(--card-border);background:${filter === id ? 'var(--primary)' : 'rgba(var(--tint),0.05)'};color:${filter === id ? '#fff' : 'var(--text-muted)'}">${label} ${n}</button>`;

        const body = rows.map(o => {
            const items = o.items || [];
            const multi = items.length > 1;
            const prodCell = multi
                ? `<button class="oms-expand" data-id="${o.order_id}" style="background:none;border:none;color:var(--text-main);cursor:pointer;text-align:left;font-size:0.88rem;display:inline-flex;align-items:center;gap:6px;padding:0"><i class="ph ph-caret-right oms-caret" style="font-size:0.9rem;color:var(--primary);transition:transform .2s"></i>${this._orderItemsSummary(o)}</button>`
                : this._orderItemsSummary(o);
            const detail = multi ? `<tr class="oms-detail" data-for="${o.order_id}" style="display:none"><td colspan="9" style="padding:2px 10px 12px 42px;background:rgba(var(--tint),0.04)"><div style="display:flex;flex-direction:column;gap:5px;padding:6px 0">${items.map(it => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:0.83rem"><span style="color:var(--text-muted)">${this._vesc(it.product_name || it.variant_code || '상품')}${it.option_name ? ` · ${this._vesc(it.option_name)}` : ''}</span><span style="color:var(--text-main);font-weight:600;white-space:nowrap">${it.quantity || 1}개</span></div>`).join('')}</div></td></tr>` : '';
            return `
            <tr style="border-bottom:1px solid var(--card-border)">
                <td style="padding:10px;text-align:center"><input type="checkbox" class="oms-chk" data-id="${o.order_id}" style="accent-color:var(--primary)"></td>
                <td style="padding:10px;font-family:monospace;font-size:0.82rem">${o.order_id}</td>
                <td style="padding:10px"><span style="font-size:0.72rem;padding:2px 8px;border-radius:10px;background:rgba(99,102,241,0.18);color:#a5b4fc">${this._mallLabel(o.mall_key)}</span></td>
                <td style="padding:10px;color:var(--text-muted);font-size:0.82rem">${o.order_date ? new Date(o.order_date).toLocaleDateString('ko-KR') : '-'}</td>
                <td style="padding:10px">${o.receiver_name || o.buyer_name || '-'}</td>
                <td style="padding:10px;font-size:0.88rem">${prodCell}</td>
                <td style="padding:10px;text-align:center">${this._orderQtySum(o)}</td>
                <td style="padding:10px;text-align:center"><span style="font-size:0.72rem;padding:2px 10px;border-radius:10px;background:${o.status === 'shipping' ? 'rgba(34,197,94,0.18)' : (o.status === 'done' ? 'rgba(148,163,184,0.18)' : 'rgba(245,158,11,0.18)')};color:${o.status === 'shipping' ? '#22c55e' : (o.status === 'done' ? '#94a3b8' : '#f59e0b')}">${this._orderStatusLabel(o.status)}</span></td>
                <td style="padding:10px;font-size:0.8rem;color:var(--text-muted)">${o.invoice_no ? `${o.courier || ''} ${o.invoice_no}` : '-'}</td>
            </tr>${detail}`;
        }).join('') || `<tr><td colspan="9" style="padding:2rem;text-align:center;color:var(--text-muted)">주문이 없습니다. 카페24 동기화가 돌면 여기로 모입니다.</td></tr>`;

        return `
        <div class="glass" style="padding:2rem;border-radius:20px">
            <div class="mobile-responsive-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.25rem;gap:1rem;flex-wrap:wrap">
                <h2 style="display:flex;align-items:center;gap:8px;font-size:1.5rem;margin:0"><i class="ph ph-shopping-bag-open"></i> 주문/배송</h2>
                <div style="display:flex;gap:10px;flex-wrap:wrap">
                    <button class="btn-secondary" id="oms-sync-btn" style="padding:8px 14px;border-radius:10px;font-size:0.85rem"><i class="ph ph-arrows-clockwise"></i> 카페24 주문 수집</button>
                    <button class="btn-secondary" id="oms-export-btn" style="padding:8px 14px;border-radius:10px;font-size:0.85rem"><i class="ph ph-download-simple"></i> 송장양식 다운로드</button>
                    <button class="btn-primary" id="oms-upload-btn" style="padding:8px 16px;border-radius:10px;font-size:0.9rem"><i class="ph ph-upload-simple"></i> 송장번호 업로드</button>
                    <input type="file" id="oms-invoice-file" accept=".csv,text/csv" style="display:none">
                </div>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:1rem;flex-wrap:wrap">
                ${tab('target', '배송대상', counts.target)}${tab('shipping', '배송중', counts.shipping)}${tab('done', '완료', counts.done)}${tab('all', '전체', counts.all)}
            </div>
            <div class="table-container" style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;min-width:720px">
                    <thead><tr style="border-bottom:2px solid var(--card-border);color:var(--text-muted);font-size:0.8rem;text-align:left">
                        <th style="padding:10px;text-align:center"><input type="checkbox" id="oms-chk-all" style="accent-color:var(--primary)"></th>
                        <th style="padding:10px">주문번호</th><th style="padding:10px">몰</th><th style="padding:10px">주문일</th><th style="padding:10px">받는분</th>
                        <th style="padding:10px">상품</th><th style="padding:10px;text-align:center">수량</th><th style="padding:10px;text-align:center">상태</th><th style="padding:10px">송장</th>
                    </tr></thead>
                    <tbody>${body}</tbody>
                </table>
            </div>
            <div style="margin-top:1rem;padding:1rem;background:rgba(var(--tint),0.03);border-radius:12px;font-size:0.82rem;color:var(--text-muted);line-height:1.7">
                <b style="color:#e2e8f0">송장 처리 흐름</b><br>
                ① <b>송장양식 다운로드</b> → 택배사 프로그램에서 운송장 출력 →
                ② 운송장번호 받은 파일을 <b>송장번호 업로드</b>(CSV: 주문번호,택배사,송장번호) →
                ③ 카페24에 배송중+운송장 자동 등록 ${ls && ls.result === 'dry_run' ? '<span style="color:#f59e0b">(현재 dry-run: 카페24 전송 없이 2179만 갱신)</span>' : ''}
            </div>
        </div>`;
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
        const today = new Date().toISOString().slice(0, 10);
        a.href = URL.createObjectURL(blob);
        a.download = `송장양식_${today}_${targets.length}건.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        this.showToast(`${targets.length}건 송장양식을 내려받았습니다.`);
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
        const byMall = {};
        let unmatched = 0;
        orders.forEach(o => {
            const found = (this.orders || []).find(x => String(x.order_id) === String(o.order_id));
            const mk = found?.mall_key;
            if (!mk) { unmatched++; return; }
            (byMall[mk] = byMall[mk] || []).push(o);
        });
        const mallKeys = Object.keys(byMall);
        if (!mallKeys.length) { this.showToast('업로드한 주문번호가 수집된 주문과 매칭되지 않습니다. (먼저 주문 수집)'); return; }

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
        this.showToast(dry ? `${totalOk}건 처리(dry-run: 카페24 전송 없이 2179만 갱신)` : `${totalOk}건 배송중 등록 완료`);
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

    renderInventory() {
        const inv = this.inventory || { items: [], listings: [], ledger: [], lastSync: null };
        if (!this._invLoaded) {
            return `<div class="glass" style="padding:3rem; border-radius:20px; text-align:center; color:var(--text-muted)">재고 데이터를 불러오는 중...</div>`;
        }
        const listingOf = (itemId) => (inv.listings || []).find(l => l.channel === 'cafe24' && l.inventory_item_id === itemId);
        let items = inv.items;
        if (this.invSelectedBrand && this.invSelectedBrand !== 'all') items = items.filter(i => i.brand_id === this.invSelectedBrand);

        const ls = inv.lastSync;
        const syncBadge = ls
            ? `<span class="glass" style="padding:6px 12px; border-radius:20px; font-size:0.8rem; color:${ls.result === 'error' ? '#ef4444' : (ls.result === 'dry_run' ? '#f59e0b' : '#22c55e')}">
                 <i class="ph ph-arrows-clockwise"></i> 마지막 동기화: ${new Date(ls.run_at).toLocaleString('ko-KR')} · ${ls.result}</span>`
            : `<span class="glass" style="padding:6px 12px; border-radius:20px; font-size:0.8rem; color:var(--text-muted)"><i class="ph ph-plug"></i> 카페24 미연동</span>`;

        const rows = items.map(i => {
            const map = listingOf(i.id);
            const low = i.on_hand <= i.safety_stock;
            return `
              <tr class="inv-row" style="border-bottom:1px solid var(--card-border)">
                <td style="padding:12px; font-family:monospace; color:var(--text-muted)">${i.sku || '-'}</td>
                <td style="padding:12px; font-weight:600">${i.name || '-'}</td>
                <td style="padding:12px; color:var(--text-muted)">${i.option_name || '-'}</td>
                <td style="padding:12px; color:var(--text-muted)">${this._brandNameById(i.brand_id)}</td>
                <td style="padding:12px; text-align:center">
                    <div style="display:inline-flex; align-items:center; gap:6px">
                        <button class="inv-dec" data-id="${i.id}" style="width:26px;height:26px;border-radius:6px;border:1px solid var(--card-border);background:rgba(var(--tint),0.05);color:white;cursor:pointer">−</button>
                        <span style="min-width:42px; display:inline-block; font-weight:700; font-size:1.05rem; color:${low ? '#ef4444' : 'white'}">${i.on_hand}</span>
                        <button class="inv-inc" data-id="${i.id}" style="width:26px;height:26px;border-radius:6px;border:1px solid var(--card-border);background:rgba(var(--tint),0.05);color:white;cursor:pointer">+</button>
                    </div>
                    ${low ? '<div style="font-size:0.7rem;color:#ef4444;margin-top:2px">안전재고 이하</div>' : ''}
                </td>
                <td style="padding:12px; text-align:center; color:var(--text-muted)">${i.safety_stock}</td>
                <td style="padding:12px; text-align:center">
                    ${map && map.channel_variant_code
                        ? `<span style="color:#22c55e;font-size:0.8rem"><i class="ph ph-check-circle"></i> ${map.channel_product_no || ''}/${map.channel_variant_code}</span>${map.allocated > 0 ? `<div style="font-size:0.72rem;color:#6366f1;margin-top:2px">배정 ${map.allocated}${map.sold ? ` · 판매 ${map.sold}` : ''}</div>` : '<div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px">전량 배분</div>'}`
                        : `<span style="color:var(--text-muted);font-size:0.8rem">미매핑</span>`}
                </td>
                <td style="padding:12px; text-align:right; white-space:nowrap">
                    <button class="inv-adjust btn-secondary" data-id="${i.id}" style="padding:5px 10px;border-radius:8px;font-size:0.78rem">조정</button>
                    <button class="inv-map btn-secondary" data-id="${i.id}" style="padding:5px 10px;border-radius:8px;font-size:0.78rem">매핑</button>
                    <button class="inv-log btn-secondary" data-id="${i.id}" style="padding:5px 10px;border-radius:8px;font-size:0.78rem">내역</button>
                </td>
              </tr>`;
        }).join('');

        const ledgerItems = this.invLedgerItemId
            ? inv.ledger.filter(l => l.inventory_item_id === this.invLedgerItemId)
            : inv.ledger;
        const reasonLabel = { initial: '초기', restock: '입고', cafe24_order: '카페24판매', manual: '수동', adjust: '보정', return: '반품' };
        const ledgerRows = ledgerItems.slice(0, 60).map(l => {
            const it = inv.items.find(x => x.id === l.inventory_item_id);
            return `<tr style="border-bottom:1px solid var(--card-border)">
                <td style="padding:8px;color:var(--text-muted);font-size:0.8rem">${new Date(l.created_at).toLocaleString('ko-KR')}</td>
                <td style="padding:8px;font-size:0.85rem">${it ? it.name : '?'}</td>
                <td style="padding:8px;text-align:center"><span style="font-size:0.72rem;padding:2px 8px;border-radius:10px;background:rgba(var(--tint),0.08)">${reasonLabel[l.reason] || l.reason}</span></td>
                <td style="padding:8px;text-align:right;font-weight:700;color:${l.delta >= 0 ? '#22c55e' : '#ef4444'}">${l.delta >= 0 ? '+' : ''}${l.delta}</td>
                <td style="padding:8px;color:var(--text-muted);font-size:0.8rem">${l.note || l.ref || ''}</td>
            </tr>`;
        }).join('') || `<tr><td colspan="5" style="padding:1.5rem;text-align:center;color:var(--text-muted)">변동 내역이 없습니다.</td></tr>`;

        return `
        <div class="glass" style="padding:2rem; border-radius:20px;">
            <div class="mobile-responsive-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem; gap:1rem; flex-wrap:wrap">
                <h2 style="display:flex; align-items:center; gap:8px; font-size:1.5rem; margin:0"><i class="ph ph-package"></i> 재고 관리</h2>
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap">
                    ${syncBadge}
                    <select id="inv-brand-filter" class="glass brand-select" style="color:white;border:1px solid rgba(var(--tint),0.1);border-radius:8px;padding:6px 12px;cursor:pointer">
                        <option value="all" style="background:#0f172a" ${(this.invSelectedBrand || 'all') === 'all' ? 'selected' : ''}>전체 브랜드</option>
                        ${(mockData.brands || []).map(b => `<option value="${b.id}" style="background:#0f172a" ${this.invSelectedBrand === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}
                    </select>
                    <button class="btn-secondary" id="inv-cafe24-btn" style="padding:8px 14px;border-radius:10px;font-size:0.85rem"><i class="ph ph-plug-charging"></i> 카페24 연동</button>
                    <button class="btn-primary" id="inv-add-btn" style="padding:8px 16px;border-radius:10px;font-size:0.9rem">+ 품목 추가</button>
                </div>
            </div>

            <div class="table-container" style="overflow-x:auto">
                <table style="width:100%; border-collapse:collapse; min-width:780px">
                    <thead><tr style="border-bottom:2px solid var(--card-border); color:var(--text-muted); font-size:0.82rem; text-align:left">
                        <th style="padding:12px">SKU</th><th style="padding:12px">품목명</th><th style="padding:12px">옵션</th>
                        <th style="padding:12px">브랜드</th><th style="padding:12px; text-align:center">현재고</th>
                        <th style="padding:12px; text-align:center">안전재고</th><th style="padding:12px; text-align:center">카페24</th>
                        <th style="padding:12px; text-align:right">작업</th>
                    </tr></thead>
                    <tbody>${rows || `<tr><td colspan="8" style="padding:2rem;text-align:center;color:var(--text-muted)">등록된 품목이 없습니다. "+ 품목 추가"로 시작하세요.</td></tr>`}</tbody>
                </table>
            </div>

            <div style="margin-top:2rem">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
                    <h3 style="margin:0;font-size:1.05rem;display:flex;align-items:center;gap:6px"><i class="ph ph-clock-counter-clockwise"></i> 재고 변동 내역 ${this.invLedgerItemId ? '(필터됨)' : ''}</h3>
                    ${this.invLedgerItemId ? `<button class="btn-secondary" id="inv-log-clear" style="padding:5px 12px;border-radius:8px;font-size:0.8rem">전체 보기</button>` : ''}
                </div>
                <div class="table-container" style="overflow-x:auto; max-height:320px; overflow-y:auto">
                    <table style="width:100%; border-collapse:collapse; min-width:560px">
                        <thead><tr style="border-bottom:1px solid var(--card-border);color:var(--text-muted);font-size:0.78rem;text-align:left">
                            <th style="padding:8px">시각</th><th style="padding:8px">품목</th><th style="padding:8px;text-align:center">사유</th><th style="padding:8px;text-align:right">증감</th><th style="padding:8px">비고</th>
                        </tr></thead>
                        <tbody>${ledgerRows}</tbody>
                    </table>
                </div>
            </div>
        </div>`;
    }

    bindInventoryEvents() {
        const bf = document.getElementById('inv-brand-filter');
        if (bf) bf.onchange = () => this.setState({ invSelectedBrand: bf.value });
        const addBtn = document.getElementById('inv-add-btn');
        if (addBtn) addBtn.onclick = () => this.showInventoryItemModal();
        const cafeBtn = document.getElementById('inv-cafe24-btn');
        if (cafeBtn) cafeBtn.onclick = () => this.showCafe24Modal();
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
        const title = (window.prompt && window.prompt('카드 제목')) || '';
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
                <table style="width:100%;border-collapse:collapse;min-width:680px">
                    <thead><tr style="border-bottom:2px solid var(--card-border);color:var(--text-muted);font-size:0.82rem;text-align:left">
                        <th class="tbl-sort" data-k="title" style="padding:12px;cursor:pointer">제목 ⇅</th>
                        <th class="tbl-sort" data-k="status" style="padding:12px;cursor:pointer">상태 ⇅</th>
                        <th class="tbl-sort" data-k="assignee" style="padding:12px;cursor:pointer">담당 ⇅</th>
                        <th class="tbl-sort" data-k="due_date" style="padding:12px;cursor:pointer">마감 ⇅</th>
                        <th style="padding:12px">브랜드</th><th style="padding:12px;text-align:right">작업</th>
                    </tr></thead>
                    <tbody>
                        ${rows.map(c => `
                        <tr style="border-bottom:1px solid var(--card-border)">
                            <td style="padding:10px"><input class="tbl-edit" data-id="${c.id}" data-f="title" value="${(c.title || '').replace(/"/g, '&quot;')}" style="background:none;border:none;color:white;width:100%;outline:none;font-size:0.9rem"></td>
                            <td style="padding:10px">
                                <select class="tbl-edit" data-id="${c.id}" data-f="status" style="background:rgba(var(--tint),0.05);border:1px solid var(--card-border);border-radius:6px;color:white;padding:4px 8px">
                                    ${Object.entries(statusOpt).map(([k, v]) => `<option value="${k}" style="background:#0f172a" ${c.status === k ? 'selected' : ''}>${v}</option>`).join('')}
                                </select>
                            </td>
                            <td style="padding:10px"><input class="tbl-edit" data-id="${c.id}" data-f="assignee" value="${(c.assignee || '').replace(/"/g, '&quot;')}" placeholder="-" style="background:none;border:none;color:white;width:90px;outline:none;font-size:0.9rem"></td>
                            <td style="padding:10px"><input type="date" class="tbl-edit" data-id="${c.id}" data-f="due_date" value="${c.due_date || ''}" style="background:none;border:none;color:white;outline:none;font-size:0.85rem"></td>
                            <td style="padding:10px;color:var(--text-muted);font-size:0.85rem">${this._brandNameById(c.brand_id)}</td>
                            <td style="padding:10px;text-align:right"><button class="tbl-del btn-secondary" data-id="${c.id}" style="padding:4px 10px;border-radius:8px;font-size:0.78rem">삭제</button></td>
                        </tr>`).join('') || `<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--text-muted)">행이 없습니다. "+ 행 추가"로 시작하세요.</td></tr>`}
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

    renderCalendar() {
        if (!this._cardsLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">캘린더를 불러오는 중...</div>`;
        const now = new Date();
        if (!this.calYear) { this.calYear = now.getFullYear(); this.calMonth = now.getMonth(); }
        const y = this.calYear, m = this.calMonth;
        const first = new Date(y, m, 1);
        const startDay = first.getDay();
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const items = this._calItems();
        const byDate = {};
        items.forEach(it => { (byDate[it.date] = byDate[it.date] || []).push(it); });
        const pad = (n) => String(n).padStart(2, '0');
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

        let cells = '';
        for (let i = 0; i < startDay; i++) cells += `<div style="min-height:96px"></div>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
            const dayItems = byDate[ds] || [];
            const isToday = ds === todayStr;
            cells += `
            <div style="min-height:96px;border:1px solid var(--card-border);border-radius:10px;padding:6px;background:${isToday ? 'rgba(99,102,241,0.12)' : 'rgba(var(--tint),0.02)'}">
                <div style="font-size:0.78rem;color:${isToday ? '#a5b4fc' : 'var(--text-muted)'};font-weight:${isToday ? '700' : '400'};margin-bottom:4px">${d}</div>
                ${dayItems.slice(0, 4).map(it => `<div style="font-size:0.68rem;padding:2px 5px;border-radius:5px;background:${it.color}22;color:${it.color};margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${it.label}</div>`).join('')}
                ${dayItems.length > 4 ? `<div style="font-size:0.65rem;color:var(--text-muted)">+${dayItems.length - 4}</div>` : ''}
            </div>`;
        }
        const week = ['일', '월', '화', '수', '목', '금', '토'];
        return `
        <div class="glass" style="padding:2rem;border-radius:20px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
                <h2 style="margin:0;font-size:1.5rem"><i class="ph ph-calendar-dots"></i> ${y}년 ${m + 1}월</h2>
                <div style="display:flex;gap:8px;align-items:center">
                    <button id="cal-prev" class="btn-secondary" style="padding:6px 12px;border-radius:8px">‹</button>
                    <button id="cal-today" class="btn-secondary" style="padding:6px 14px;border-radius:8px;font-size:0.85rem">오늘</button>
                    <button id="cal-next" class="btn-secondary" style="padding:6px 12px;border-radius:8px">›</button>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px">
                ${week.map((w, i) => `<div style="text-align:center;font-size:0.8rem;color:${i === 0 ? '#ef4444' : (i === 6 ? '#60a5fa' : 'var(--text-muted)')};padding:4px">${w}</div>`).join('')}
            </div>
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px">${cells}</div>
            <div style="display:flex;gap:14px;margin-top:1rem;font-size:0.78rem;color:var(--text-muted)">
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#22c55e"></span> 할일</span>
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#f59e0b"></span> 일정</span>
                <span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#6366f1"></span> 보드카드</span>
            </div>
        </div>`;
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
        const hint = '<div class="search-hint"><i class="ph ph-keyboard"></i> 검색어를 입력하세요. 결과 클릭 시 해당 프로젝트로 이동합니다.</div>';

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

        const kindColor = { '프로젝트': '#3b82f6', '할일': '#22c55e', '문서': '#f59e0b', '메모': '#a855f7' };
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
            const [vRes, jRes] = await Promise.all([
                this.supabase.from('vendors').select('*').order('name', { ascending: true }),
                this.supabase.from('vendor_jobs').select('*').order('due_date', { ascending: true })
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
        if (!this._vendorsLoaded) return `<div class="glass" style="padding:3rem;border-radius:20px;text-align:center;color:var(--text-muted)">생산처를 불러오는 중...</div>`;
        const vendors = this.vendors || [];
        const allJobs = vendors.flatMap(v => (v.jobs||[]).map(j => ({...j, _vendor: v.name })));
        const active = allJobs.filter(j => j.status !== 'done');
        const today = new Date(); today.setHours(0,0,0,0);
        const dday = (d) => { if(!d) return null; const dt=new Date(d); dt.setHours(0,0,0,0); return Math.round((dt-today)/86400000); };
        const upcoming = active.filter(j=>j.due_date).sort((a,b)=> new Date(a.due_date)-new Date(b.due_date)).slice(0,8);

        const scheduleStrip = upcoming.length ? `
            <div class="glass" style="padding:1rem 1.2rem;border-radius:16px;margin-bottom:1rem">
                <div style="font-size:0.9rem;font-weight:700;margin-bottom:0.7rem"><i class="ph ph-calendar-dots"></i> 임박 스케줄</div>
                <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">
                    ${upcoming.map(j=>{ const dd=dday(j.due_date); const col = dd<0?'#ef4444':(dd<=3?'#f59e0b':'var(--text-muted)');
                        return `<div style="flex:0 0 auto;min-width:150px;padding:10px 12px;border-radius:12px;background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.15)">
                            <div style="font-size:0.8rem;color:${col};font-weight:700">${dd<0?`지연 ${-dd}일`:(dd===0?'오늘':`D-${dd}`)}</div>
                            <div style="font-size:0.88rem;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${this._vesc(j.title)}</div>
                            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:1px">${this._vesc(j._vendor)}</div>
                        </div>`; }).join('')}
                </div>
            </div>` : '';

        const cards = vendors.map(v => {
            const jobs = v.jobs || [];
            const act = jobs.filter(j=>j.status!=='done');
            const col = this._vendorCatColor(v.category);
            const jobRows = jobs.length ? jobs.map(j=>{ const dd=dday(j.due_date); const done=j.status==='done';
                const ddText = j.due_date && !done ? (dd<0?`<span style="color:#ef4444">지연${-dd}일</span>`:(dd<=3?`<span style="color:#f59e0b">D-${Math.max(dd,0)}</span>`:`D-${dd}`)) : '';
                return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid rgba(148,163,184,0.12)">
                    <button class="vjob-toggle" data-id="${j.id}" title="완료 토글" style="flex:0 0 auto;width:18px;height:18px;border-radius:5px;border:2px solid ${done?'#10b981':'rgba(148,163,184,0.5)'};background:${done?'#10b981':'transparent'};cursor:pointer;color:#fff;font-size:0.7rem;line-height:1;padding:0">${done?'✓':''}</button>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:0.88rem;font-weight:600;${done?'text-decoration:line-through;color:var(--text-muted)':''}">${this._vesc(j.title)}${j.qty?` <span style="color:var(--text-muted);font-weight:400">·${j.qty}장</span>`:''}${j.qc_status==='passed'?' <span style="font-size:0.66rem;font-weight:700;color:#10b981;background:rgba(16,185,129,0.12);padding:1px 6px;border-radius:6px">검수완료</span>':''}${j.quick_status?' <span style="font-size:0.66rem;font-weight:700;color:#191600;background:#FEE500;padding:1px 6px;border-radius:6px">퀵예약</span>':''}</div>
                        <div style="font-size:0.75rem;color:var(--text-muted)">${this._vesc(j.stage)}${ddText?' · '+ddText:''}</div>
                    </div>
                    ${done?'':`<button class="vjob-qc" data-id="${j.id}" title="출고 검수 · 카카오퀵" style="flex:0 0 auto;background:none;border:none;color:${j.qc_status==='passed'?'#10b981':'var(--primary)'};cursor:pointer;padding:2px 4px;font-size:1.05rem"><i class="ph ph-clipboard-text"></i></button>`}
                    <button class="vjob-del" data-id="${j.id}" title="삭제" style="flex:0 0 auto;background:none;border:none;color:var(--text-muted);cursor:pointer"><i class="ph ph-x"></i></button>
                </div>`; }).join('') : `<div style="padding:10px 0;color:var(--text-muted);font-size:0.83rem">진행중 물품 없음</div>`;

            return `<div class="glass" style="padding:1.1rem 1.2rem;border-radius:16px;display:flex;flex-direction:column;gap:2px">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
                    <div style="min-width:0">
                        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
                            <span style="font-size:1rem;font-weight:700">${this._vesc(v.name)}</span>
                            <span style="font-size:0.7rem;font-weight:700;color:#fff;background:${col};padding:1px 8px;border-radius:20px">${this._vesc(v.category)}</span>
                            ${act.length?`<span style="font-size:0.72rem;color:var(--primary);font-weight:700">진행 ${act.length}</span>`:''}
                        </div>
                        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:3px">${v.address?`<i class="ph ph-map-pin"></i> ${this._vesc(v.address)}`:'<span style="opacity:0.6">주소 없음</span>'}${v.phone?` · ${this._vesc(v.phone)}`:''}</div>
                    </div>
                    <button class="vendor-edit" data-id="${v.id}" title="수정" style="flex:0 0 auto;background:none;border:none;color:var(--text-muted);cursor:pointer;padding:2px"><i class="ph ph-pencil-simple"></i></button>
                </div>
                <div style="margin-top:6px">${jobRows}</div>
                <button class="vjob-add" data-id="${v.id}" style="margin-top:8px;align-self:flex-start;background:none;border:1px dashed rgba(148,163,184,0.4);color:var(--text-muted);padding:5px 12px;border-radius:8px;cursor:pointer;font-size:0.8rem"><i class="ph ph-plus"></i> 물품 추가</button>
            </div>`;
        }).join('');

        return `
        <div class="fade-in" style="padding:1.5rem;max-width:1100px;margin:0 auto">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;gap:10px;flex-wrap:wrap">
                <div>
                    <h1 style="margin:0;font-size:1.4rem"><i class="ph ph-map-pin-line"></i> 생산 현황</h1>
                    <p style="margin:4px 0 0;color:var(--text-muted);font-size:0.85rem">생산처 ${vendors.length} · 진행중 물품 ${active.length}</p>
                </div>
                <button id="vendor-add-btn" class="btn-primary" style="padding:10px 18px;border-radius:10px"><i class="ph ph-plus"></i> 생산처 등록</button>
            </div>
            <div id="vendor-map" style="height:380px;border-radius:16px;overflow:hidden;margin-bottom:1rem;background:rgba(148,163,184,0.1);z-index:0"></div>
            ${scheduleStrip}
            ${vendors.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem">${cards}</div>` : `<div class="glass" style="padding:3rem;border-radius:16px;text-align:center;color:var(--text-muted)">등록된 생산처가 없습니다. 우측 상단 [생산처 등록]으로 시작하세요.</div>`}
        </div>`;
    }

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
        setTimeout(() => {
            if (typeof L === 'undefined') return;
            const el = document.getElementById('vd-pickmap');
            if (!el || el._leaflet_id) return;
            const start = this._vendorPick ? [this._vendorPick.lat, this._vendorPick.lng] : [37.5686, 127.0093];
            const map = L.map(el).setView(start, 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
            let marker = this._vendorPick ? L.marker(start).addTo(map) : null;
            map.on('click', (e) => {
                this._vendorPick = { lat: e.latlng.lat, lng: e.latlng.lng };
                if (marker) marker.setLatLng(e.latlng); else marker = L.marker(e.latlng).addTo(map);
            });
            setTimeout(()=>{ try{ map.invalidateSize(); }catch(e){} }, 80);
        }, 60);
    }

    async saveVendor(id) {
        const name = document.getElementById('vd-name').value.trim();
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
        await this.loadVendors();
        this.showToast('저장되었습니다.');
    }

    async deleteVendor(id) {
        if (!confirm('이 생산처와 물품 현황을 모두 삭제할까요?')) return;
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
                <label style="font-size:0.8rem;color:var(--text-muted)">작업지시서 연결 <span style="color:var(--primary)">(검수 체크리스트 자동생성)</span></label>
                <select id="vj-pack" class="login-input"><option value="">— 없음 —</option>${(this._techPacks || []).map(t => `<option value="${t.id}">${this._vesc(t.style_name)}${t.style_no ? ` (${t.style_no})` : ''}</option>`).join('')}</select>
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
        const row = {
            vendor_id: vendorId,
            title,
            stage: document.getElementById('vj-stage').value.trim() || '진행중',
            qty: qtyRaw ? parseInt(qtyRaw,10) : null,
            due_date: document.getElementById('vj-due').value || null,
            tech_pack_id: (document.getElementById('vj-pack') && document.getElementById('vj-pack').value) || null,
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
        const passed = allChecked && hasPhoto;
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
                ${passed ? '<i class="ph ph-check-circle"></i> 검수 통과 — 퀵 호출 가능' : `<i class="ph ph-warning"></i> ${!allChecked ? '미확인 항목 있음' : ''}${(!allChecked && !hasPhoto) ? ' · ' : ''}${!hasPhoto ? '완성 사진 없음' : ''}`}
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <button id="qc-save" class="btn-secondary" style="padding:9px 16px;border-radius:10px"><i class="ph ph-floppy-disk"></i> 검수 저장</button>
                <div style="display:flex;gap:8px">
                    <button onclick="app.closeGlobalModal()" class="btn-secondary" style="padding:9px 16px;border-radius:10px">닫기</button>
                    <button id="qc-quick" ${passed ? '' : 'disabled'} style="padding:9px 18px;border-radius:10px;border:none;font-weight:700;${passed ? 'background:#FEE500;color:#191600;cursor:pointer' : 'background:rgba(148,163,184,0.2);color:var(--text-muted);cursor:not-allowed'}"><i class="ph ph-scooter"></i> 카카오퀵 호출</button>
                </div>
            </div>
            ${d.quick ? `<p style="margin:0.8rem 0 0;font-size:0.8rem;color:#10b981"><i class="ph ph-check"></i> 퀵 예약됨${d.quick.trackingNo ? ` · ${this._vesc(d.quick.trackingNo)}` : ''}</p>` : ''}
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
        const passed = d.checklist.every(x => x.checked) && d.photos.length >= 1;
        const patch = { qc_checklist: d.checklist, qc_photos: d.photos, qc_status: passed ? 'passed' : 'pending', tech_pack_id: d.packId || null };
        const { error } = await this.supabase.from('vendor_jobs').update(patch).eq('id', d.jobId);
        if (error) { this.showToast('검수 저장 실패 (012_vendor_qc.sql 설치 필요): ' + error.message); return; }
        const job = (this.vendors || []).flatMap(v => v.jobs || []).find(j => j.id === d.jobId);
        if (job) Object.assign(job, patch);
        this.showToast('검수 저장됨');
    }

    async callKakaoQuick() {
        const d = this._qcDraft; if (!d) return;
        await this.saveQc();
        this.showToast('카카오퀵 픽업 요청 중...');
        try {
            const { data, error } = await this.supabase.functions.invoke('kakao-quick', {
                body: { jobId: d.jobId, title: d.title, qty: d.qty, vendor: d.vendorName },
            });
            if (error) throw error;
            if (!data || data.ok === false) throw new Error(data && data.error ? data.error : '응답 오류');
            d.quick = data;
            await this.supabase.from('vendor_jobs').update({ quick_status: data }).eq('id', d.jobId);
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
            const { data } = await this.supabase.from('tech_packs').select('id, style_name, style_no, config, created_at').order('created_at', { ascending: false });
            this._techPacks = data || [];
        } catch (e) { this._techPacks = this._techPacks || []; }
        this._techPacksLoaded = true;
    }

    async saveTechPack() {
        const cfg = this.sampleConfig;
        const name = (cfg.styleName || '').trim() || '무제 작업지시서';
        try {
            const { error } = await this.supabase.from('tech_packs').insert([{ style_name: name, style_no: cfg.styleNo || null, config: cfg }]);
            if (error) throw error;
        } catch (e) {
            this.showToast('작업지시서 저장 실패 (013_tech_packs.sql 설치 필요): ' + (e.message || e));
            return;
        }
        await this.ensureTechPacks(true);
        this.showToast('작업지시서 저장됨: ' + name + ' — 생산현황 물품에 연결 가능');
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
        const cell = (brand, ch) => {
            if (ch.key === 'cafe24') {
                const mall = malls.find(m => m.brand_id === brand.id && (m.channel || 'cafe24') === 'cafe24');
                if (mall && mall.connected) return `<div style="display:inline-flex;flex-direction:column;gap:5px;align-items:center"><span style="font-size:0.72rem;font-weight:700;color:#22c55e">● 연동됨</span><button class="integ-auth" data-key="${mall.mall_key}" style="font-size:0.72rem;padding:3px 9px;border-radius:7px;border:1px solid var(--card-border);background:transparent;color:var(--text-muted);cursor:pointer">재인증</button></div>`;
                if (mall) return `<div style="display:inline-flex;flex-direction:column;gap:5px;align-items:center"><span style="font-size:0.72rem;font-weight:700;color:#f59e0b">○ 미인증</span><button class="integ-auth btn-primary" data-key="${mall.mall_key}" style="font-size:0.72rem;padding:3px 10px;border-radius:7px">인증</button></div>`;
                return `<button class="integ-connect" data-brand="${brand.id}" style="font-size:0.76rem;padding:5px 12px;border-radius:8px;border:1px dashed rgba(148,163,184,0.5);background:transparent;color:var(--primary);cursor:pointer;font-weight:600"><i class="ph ph-plus"></i> 연동</button>`;
            }
            return `<span style="font-size:0.72rem;color:var(--text-muted);opacity:0.5">준비중</span>`;
        };
        const rows = brands.length ? brands.map(b => `<tr style="border-bottom:1px solid var(--card-border)">
            <td style="padding:14px 10px;font-weight:600">${this._vesc(b.name)}</td>
            ${channels.map(ch => `<td style="padding:14px 10px;text-align:center">${cell(b, ch)}</td>`).join('')}
            <td style="padding:14px 10px;text-align:center">${courierCell(b)}</td>
        </tr>`).join('') : `<tr><td colspan="${channels.length + 2}" style="padding:2.5rem;text-align:center;color:var(--text-muted)">브랜드가 없습니다. [브랜드 추가]로 시작하세요.</td></tr>`;
        return `
        <div class="fade-in" style="padding:1.5rem;max-width:900px;margin:0 auto">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.2rem;gap:10px;flex-wrap:wrap">
                <div><h1 style="margin:0;font-size:1.4rem"><i class="ph ph-plugs-connected"></i> 채널 연동</h1><p style="margin:4px 0 0;color:var(--text-muted);font-size:0.85rem">브랜드별로 판매 채널을 연동하세요</p></div>
                <button id="integ-addbrand-btn" class="btn-primary" style="padding:10px 18px;border-radius:10px"><i class="ph ph-plus"></i> 브랜드 추가</button>
            </div>
            <div class="glass" style="padding:1.2rem;border-radius:16px;overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;min-width:820px">
                    <thead><tr style="border-bottom:2px solid var(--card-border);color:var(--text-muted);font-size:0.82rem;text-align:left">
                        <th style="padding:12px 10px">브랜드</th>${channels.map(ch => `<th style="padding:12px 10px;text-align:center">${ch.label}${ch.active ? '' : ' <span style="font-size:0.66rem;opacity:0.6">(준비중)</span>'}</th>`).join('')}<th style="padding:12px 10px;text-align:center">택배사</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p style="margin:1rem 0 0;color:var(--text-muted);font-size:0.8rem"><i class="ph ph-info"></i> 카페24 [연동] → 몰 정보·Client ID/Secret 입력 → 인증(카페24 로그인)하면 연동됩니다. 로하이스튜디오처럼요.</p>
        </div>`;
    }

    bindIntegrationsEvents() {
        const add = document.getElementById('integ-addbrand-btn');
        if (add) add.onclick = () => this.showAddBrandModal();
        this.appContainer.querySelectorAll('.integ-auth').forEach(x => x.onclick = () => this.authMall(x.dataset.key));
        this.appContainer.querySelectorAll('.integ-connect').forEach(x => x.onclick = () => this.showCafe24Modal(x.dataset.brand));
        this.appContainer.querySelectorAll('.integ-courier').forEach(s => s.onchange = () => this.saveBrandCourier(s.dataset.brand, s.value));
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
        const qs = this.quotes || [];
        const rows = qs.map(q => `
            <tr class="q-row" data-id="${q.id}" style="border-bottom:1px solid var(--card-border);cursor:pointer">
                <td style="padding:10px;font-size:0.82rem;color:var(--text-muted)">${q.quote_date || '-'}</td>
                <td style="padding:10px;font-weight:600">${this._vesc(q.client_name)}</td>
                <td style="padding:10px;font-size:0.85rem;color:var(--text-muted)">${(q.items || []).length}개 품목</td>
                <td style="padding:10px;text-align:right;font-weight:700;font-variant-numeric:tabular-nums">${this._won(q.total_amount)}원</td>
                <td style="padding:10px;text-align:center;white-space:nowrap"><span style="font-size:0.72rem;padding:2px 10px;border-radius:10px;background:${q.status === 'confirmed' ? 'rgba(34,197,94,0.18)' : (q.status === 'sent' ? 'rgba(59,130,246,0.18)' : 'rgba(245,158,11,0.18)')};color:${q.status === 'confirmed' ? '#22c55e' : (q.status === 'sent' ? '#60a5fa' : '#f59e0b')}">${this._quoteStatusLabel(q.status)}</span>${q.tax_status === 'issued' ? ' <span style="font-size:0.66rem;padding:2px 7px;border-radius:8px;background:rgba(34,197,94,0.18);color:#22c55e">계산서✓</span>' : ''}</td>
                <td style="padding:10px;text-align:center"><button class="q-print" data-id="${q.id}" title="인쇄" style="background:none;border:none;color:var(--text-muted);cursor:pointer"><i class="ph ph-printer"></i></button></td>
            </tr>`).join('') || `<tr><td colspan="6" style="padding:2rem;text-align:center;color:var(--text-muted)">견적서가 없습니다. [새 견적]으로 시작하세요.</td></tr>`;
        return `
        <div class="fade-in" style="padding:1.5rem;max-width:1000px;margin:0 auto">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.2rem;gap:10px;flex-wrap:wrap">
                <div><h1 style="margin:0;font-size:1.4rem"><i class="ph ph-receipt"></i> 견적서</h1><p style="margin:4px 0 0;color:var(--text-muted);font-size:0.85rem">${qs.length}건 · 엑셀 대체</p></div>
                <button id="q-new-btn" class="btn-primary" style="padding:10px 18px;border-radius:10px"><i class="ph ph-plus"></i> 새 견적</button>
            </div>
            <div class="glass" style="padding:1.2rem;border-radius:16px;overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;min-width:620px">
                    <thead><tr style="border-bottom:2px solid var(--card-border);color:var(--text-muted);font-size:0.8rem;text-align:left">
                        <th style="padding:10px">견적일</th><th style="padding:10px">고객사</th><th style="padding:10px">품목</th><th style="padding:10px;text-align:right">합계</th><th style="padding:10px;text-align:center">상태</th><th style="padding:10px;text-align:center">인쇄</th>
                    </tr></thead><tbody>${rows}</tbody>
                </table>
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
                <div><label style="font-size:0.74rem;color:var(--text-muted)">견적일</label><input id="q-date" type="date" class="login-input" value="${q?.quote_date || new Date().toISOString().slice(0, 10)}"></div>
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
        if (!confirm('이 견적서를 삭제할까요?')) return;
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
                <div><label style="font-size:0.74rem;color:var(--text-muted)">작성일자 (= 실제 공급/납품일)</label><input id="tx-date" type="date" class="login-input" value="${new Date().toISOString().slice(0, 10)}"></div>
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
            const { data, error } = await this.supabase.functions.invoke('taxinvoice-issue', { body: { quote: q, email, supplyDate, purposeType } });
            if (error || !data || !data.ok) { this.showToast('발행 실패: ' + ((data && data.error) || (error && error.message) || '팝빌 미설정/키 필요')); return; }
            await this.supabase.from('quotes').update({ tax_status: 'issued', tax_mgtkey: data.mgtKey, tax_supply_date: supplyDate, tax_issued_at: new Date().toISOString() }).eq('id', q.id);
            this.closeGlobalModal(); this._quotesLoaded = false; await this.loadQuotes();
            this.showToast('세금계산서 발행 완료');
        } catch (e) { this.showToast('발행 오류: ' + (e.message || e)); }
    }

    bindDashboardEvents() {
        this.bindGlobalSearch();
        const collapseBtn = document.getElementById('sidebar-collapse-btn');
        if (collapseBtn) collapseBtn.onclick = () => { this.navSidebarCollapsed = !this.navSidebarCollapsed; this.requestRender(); };
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
        const brandSelect = document.getElementById('new-user-brand');
        const saveBtn = document.getElementById('save-user-btn');

        nameInput.value = user.name || '';
        idInput.value = user.username || '';
        idInput.disabled = true; // 아이디 수정 불가 (Auth 연동 이슈 방지)
        pwInput.placeholder = '비밀번호 변경 시에만 입력하세요 (최소 6자)';
        roleSelect.value = user.role || 'CLIENT';
        brandSelect.value = user.brand_id || '';

        const brandContainer = document.getElementById('brand-selection-container');
        brandContainer.style.display = roleSelect.value === 'CLIENT' ? 'block' : 'none';

        saveBtn.innerText = '정보 수정';
        saveBtn.onclick = async () => {
            const newName = nameInput.value.trim();
            const newPw = pwInput.value.trim();
            const newRole = roleSelect.value;
            const newBrandId = brandSelect.value;

            if (!newName) { this.showToast('이름을 입력해주세요.'); return; }
            if (newPw && newPw.length < 6) { this.showToast('비밀번호는 최소 6자 이상이어야 합니다.'); return; }

            saveBtn.disabled = true;
            saveBtn.innerText = '수정 중...';

            try {
                // 1. Supabase Auth 비밀번호 업데이트 (입력된 경우만)
                if (newPw) {
                    // 참고: 현재 세션이 MASTER이므로 타 사용자 PW 변경은 Admin API 필요할 수 있음. 
                    // 여기서는 단순 DB 정보 업데이트 위주로 처리하거나 알림.
                    const { error: authError } = await this.supabase.auth.updateUser({ password: newPw });
                    // Admin API 필요 시 무시
                }

                // 2. DB 업데이트
                const { error: dbError } = await this.supabase
                    .from('companies')
                    .update({ 
                        name: newName, 
                        role: newRole, 
                        brand_id: newRole === 'CLIENT' ? (newBrandId || null) : null 
                    })
                    .eq('id', userId);

                if (dbError) throw dbError;

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
                else if (insertError.message && insertError.message.includes('foreign key')) errMsg = '선택한 프로젝트가 존재하지 않습니다. 페이지를 새로고침 후 다시 시도해주세요.';
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
                    <input type="password" id="new-user-pw" class="login-input" placeholder="비밀번호 설정 (최소 6자)">
                </div>
                
                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>권한 설정</label>
                    <select id="new-user-role" class="glass" style="width: 100%; padding: 12px; border-radius: 12px; background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--card-border);">
                        <option value="CLIENT">CLIENT (고객사 계정)</option>
                        <option value="STAFF">STAFF (직원 계정)</option>
                        <option value="MASTER">MASTER (관리자 계정)</option>
                    </select>
                </div>

                <div id="brand-selection-container" class="login-field" style="margin-bottom: 2rem;">
                    <label>배정 브랜드 (CLIENT 전용)</label>
                    <select id="new-user-brand" class="glass" style="width: 100%; padding: 12px; border-radius: 12px; background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--card-border);">
                        <option value="">브랜드 선택 안함 (STAFF/MASTER 권장)</option>
                        ${(mockData.brands || []).map(b => `
                            <option value="${b.id}">${b.name}</option>
                        `).join('')}
                    </select>
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button id="cancel-user-btn" style="flex: 1; padding: 12px; border-radius: 12px; background: rgba(var(--tint),0.05); border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer;">취소</button>
                    <button id="save-user-btn" class="btn-primary" style="flex: 1; padding: 12px; border-radius: 12px;">계정 생성</button>
                </div>
            </div>
        `;

        modal.style.display = 'flex';

        const roleSelect = document.getElementById('new-user-role');
        const brandContainer = document.getElementById('brand-selection-container');
        roleSelect.addEventListener('change', () => {
            brandContainer.style.display = roleSelect.value === 'CLIENT' ? 'block' : 'none';
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

        if (password.length < 6) {
            { this.showToast('비밀번호는 최소 6자 이상이어야 합니다.'); return; }
        }

        const brandId = document.getElementById('new-user-brand').value;
        const brand = mockData.brands?.find(b => b.id === brandId);

        if (role === 'CLIENT' && !brandId) {
            { this.showToast('고객사(CLIENT) 계정은 반드시 브랜드를 선택해야 합니다.'); return; }
        }

        const email = `${username}@bhas.com`;
        const saveBtn = document.getElementById('save-user-btn');
        saveBtn.disabled = true;
        saveBtn.innerText = '계정 생성 중...';

        try {
            // 1. Supabase Auth 계정 생성 시도
            const { data: authData, error: authError } = await this.supabase.auth.signUp({
                email,
                password,
            });

            if (authError) {
                if (authError.status === 400 && authError.message.includes('already registered')) {
                    // 이미 가입된 경우 경고 후 중단하거나 로직 선택
                } else {
                    throw authError;
                }
            }

            // 2. companies 테이블에 정보 저장 (RPC로 RLS 우회)
            const { error: dbError } = await this.supabase.rpc('create_company', {
                p_name: name,
                p_role: role,
                p_username: username,
                p_brand_id: brandId || null,
                p_auth_user_id: authData?.user?.id || null
            });

            if (dbError) throw dbError;

            this.showToast('새 계정이 추가되었습니다.');
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
            if (!pid || pid === 'null' || pid === 'undefined') throw new Error('유효하지 않은 프로젝트 ID입니다.');

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
