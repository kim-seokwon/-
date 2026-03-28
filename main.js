import { mockData, STAGES } from './mockData.js';

// Supabase 설정 (사용자 정보 입력 필요)
const SUPABASE_URL = 'https://czaykmmwzlcisozmbxpl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JfMXgnspGcTtJKncR-l4gQ_XXzopFMk';
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

class BhasApp {
    constructor() {
        this.currentUser = null;
        this.appContainer = document.getElementById('app');
        this.currentView = 'login'; // 'login', 'dashboard', 'detail'
        this.activeProjectId = null;
        this.selectedDocCategory = '전체';
        this.selectedCompanyId = 'all'; 
        this.completedExpanded = false;
        this.currentTodoFilter = 'all'; // all, my, requested
        
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
                console.error('GLOBAL_ERROR:', msg, error);
                this.showToast('시스템 오류가 발생했습니다. 담당자에게 문의하세요.');
                return false;
            };
        } catch (e) {
            console.error('App Initialization Error:', e);
        }
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
                        this.currentView = 'dashboard';
                    } else {
                        throw new Error('Invalid session data');
                    }
                } catch(e) {
                    console.error('Auto login session parse failed', e);
                    this.currentUser = null;
                    localStorage.removeItem('bhas_session_user');
                    localStorage.removeItem('bhas_auto_login');
                }
            } else {
                // 자동 로그인이 아니면 기존 세션 정리 → 항상 로그인 화면
                this.currentUser = null;
                this.currentView = 'login';
                localStorage.removeItem('bhas_session_user');
                if (this.supabase) {
                    this.supabase.auth.signOut().catch(() => {});
                }
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
                    console.error('Auto-login data load failed:', err);
                    this._isInitialLoading = false;
                    this.requestRender();
                });
            } else {
                this._isInitialLoading = false;
                this.requestRender();
            }
        } catch (e) {
            console.error('Init Error:', e);
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
                <button onclick="document.getElementById('global-modal-container').style.display='none'" style="position: absolute; top: 1.5rem; right: 1.5rem; background: rgba(255,255,255,0.1); border: none; color: white; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 100;"><i class="ph ph-x"></i></button>
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
                // 유저 삭제 시 Auth 계정도 삭제 시도
                if (type === 'user') {
                    const user = mockData.companies.find(c => c.id === id);
                    const authUserId = user?.auth_user_id;

                    if (authUserId) {
                        const { error: rpcError } = await this.supabase.rpc('delete_user_by_id', { user_uuid: authUserId });
                        if (rpcError) console.error('Auth User Delete Error (RPC):', rpcError);
                    } else if (user?.username) {
                        console.warn('Auth ID mismatch, attempting manual check if needed.');
                    }
                }

                let query = this.supabase.from(table).delete();
                
                // 브랜드 삭제 시: 하위 데이터 → 프로젝트 → 계정 → 전역문서 순서로 전부 삭제
                if (type === 'brand') {
                    try {
                        const brandProducts = mockData.products.filter(p => p.brand_id === id);
                        const brandCompanies = mockData.companies.filter(c => c.brand_id === id);

                        // 1단계: 프로젝트별 하위 데이터 삭제
                        for (const p of brandProducts) {
                            await this.supabase.from('todos').delete().eq('product_id', p.id);
                            await this.supabase.from('photos').delete().eq('product_id', p.id);
                            await this.supabase.from('documents').delete().eq('product_id', p.id);
                            await this.supabase.from('memos').delete().eq('product_id', p.id);
                            await this.supabase.from('product_stages').delete().eq('product_id', p.id);
                            await this.supabase.from('history').delete().eq('product_id', p.id);
                        }

                        // 2단계: 소속 프로젝트 삭제
                        if (brandProducts.length > 0) {
                            await this.supabase.from('products').delete().eq('brand_id', id);
                        }

                        // 3단계: 전역 문서 삭제
                        await this.supabase.from('global_documents').delete().eq('brand_id', id);

                        // 4단계: 소속 계정 삭제 (FK 참조 모두 제거된 후)
                        if (brandCompanies.length > 0) {
                            // 계정이 created_by로 참조되는 곳 해제
                            for (const c of brandCompanies) {
                                await this.supabase.from('products').update({ created_by: null }).eq('created_by', c.id);
                                await this.supabase.from('documents').update({ created_by: null }).eq('created_by', c.id);
                                await this.supabase.from('photos').update({ created_by: null }).eq('created_by', c.id);
                                await this.supabase.from('memos').update({ created_by: null }).eq('created_by', c.id);
                            }
                            await this.supabase.from('companies').delete().eq('brand_id', id);
                        }
                    } catch (cascadeErr) {
                        console.error('Brand cascade delete error:', cascadeErr);
                        this.showToast('브랜드 하위 데이터 삭제 중 오류가 발생했습니다.');
                        return;
                    }
                }

                // 사진 삭제의 경우 id가 URL일 수 있으므로 처리
                if (type === 'photo' && (typeof id === 'string' && (id.startsWith('http') || id.includes('photos/')))) {
                    query = query.eq('url', id);
                } else {
                    query = query.eq('id', id);
                }

                const { error } = await query;
                if (error) {
                    console.error('Delete Error details:', error);
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
            console.error('Delete Error:', error);
            alert('삭제 중 오류가 발생했습니다.');
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
    
    toggleNotifications(e) {
        if(e) e.preventDefault();
        this.switchView('todo');
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
                        <div style="font-size: 2.5rem; font-weight: 900; color: var(--primary); letter-spacing: 3px;">BHAS</div>
                        <div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
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
                        console.warn('Redirecting to login: currentUser is missing');
                        this.currentView = 'login';
                        this.renderLogin();
                    } else {
                        this.renderDashboard();
                    }
                    break;
            }
        } catch (e) {
            console.error('Render Error:', e);
            // 최후의 수단으로 로그인 화면 시도
            if (this.currentView !== 'login') {
                this.currentView = 'login';
                this.renderLogin();
            }
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
                
                // memos 테이블이 없는 경우 (404)를 대비해 안전하게 처리
                const { data: memos, error: mError } = await this.supabase.from('memos').select('*').eq('product_id', p.id).order('created_at', { ascending: true });
                if (mError && mError.code === 'PGRST205') console.warn('Memos table not found, skipping memo load');

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
                    todos: (todos || []).map(t => ({ ...t, assignee: t.assignee_id })), // assignee_id를 UI용 assignee로 매핑
                    photos: photos || [],
                    documents: documents || [],
                    memos: memos || []
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
            console.error('Data Loading Error:', error);
            this.showToast('데이터를 불러오는 중 오류가 발생했습니다.');
        }
    }

    renderLogin() {
        const loginHtml = `
            <div class="login-container fade-in">
                <div class="glass login-card">
                    <h1>BHAS</h1>
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

                    await this.loadInitialData();
                    this.setState({ currentView: 'dashboard' });
                    this.showToast('성공적으로 로그인되었습니다.');
                    return;
                }

                if (authError) throw authError;

            } catch (error) {
                console.error('Login Error:', error);
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
            { id: 'dashboard', label: '프로젝트 현황', icon: '<i class="ph ph-chart-bar"></i>', visible: perms.includes('dashboard') },
            { id: 'documents', label: '문서 관리', icon: '<i class="ph ph-folder-open"></i>', visible: perms.includes('documents') },
            { id: 'all_todos', label: '할일 모아보기', icon: '<i class="ph ph-list-checks"></i>', visible: true },
            { id: 'user_management', label: '계정 관리', icon: '<i class="ph ph-user-plus"></i>', visible: perms.includes('user_management') },
            { id: 'brand_management', label: '브랜드 관리', icon: '<i class="ph ph-shield-check"></i>', visible: perms.includes('user_management') }
        ];

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
                    <div class="top-bar-logo">BHAS</div>
                    <div class="top-bar-actions">
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
                <nav class="glass sidebar">
                    <div class="nav-logo">BHAS</div>
                    <div class="nav-user">
                        <div class="avatar">${name[0]}</div>
                        <div class="user-info">
                            <span class="name">${name}</span>
                            <span class="role">${role === 'MASTER' ? '마스터 관리자' : (role === 'STAFF' ? '업무 직원' : '파트너사')}</span>
                        </div>
                    </div>
                    <ul class="nav-links">
                        ${menuItems.filter(item => item.visible).map(item => `
                            <li class="${this.currentView === item.id ? 'active' : ''}" data-view="${item.id}">
                                <div style="display: flex; align-items: center; gap: 8px; font-size: 1.1rem;">${item.icon} <span style="font-size: 1rem;">${item.label}</span></div>
                            </li>
                        `).join('')}
                        <li id="logout-btn" style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-power" style="font-size: 1.2rem;"></i> 로그아웃</li>
                    </ul>
                </nav>
                
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
                            <div class="header-title-section" style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
                                ${this.currentView === 'dashboard' ? `
                                    <div class="view-toggles">
                                        <button id="view-grid-btn" class="${this.dashboardViewType === 'table' ? '' : 'active'}" title="그리드 보기"><i class="ph ph-squares-four"></i></button>
                                        <button id="view-table-btn" class="${this.dashboardViewType === 'table' ? 'active' : ''}" title="리스트 보기"><i class="ph ph-list-dashes"></i></button>
                                    </div>
                                ` : ''}
                                ${(role === 'MASTER' || role === 'STAFF') && this.currentView === 'dashboard' ? `
                                    <select id="global-company-filter" class="glass brand-select" style="color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 12px; outline: none; cursor: pointer;">
                                        <option value="all" style="background: #0f172a; color: white;" ${this.selectedCompanyId === 'all' ? 'selected' : ''}>전체 브랜드</option>
                                        ${(mockData.brands || []).map(b => `
                                            <option value="${b.id}" style="background: #0f172a; color: white;" ${this.selectedCompanyId === b.id ? 'selected' : ''}>${b.name}</option>
                                        `).join('')}
                                    </select>
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

                                    const renderTodoList = (todos, title, icon) => `
                                        <div style="margin-bottom: 1rem;">
                                            <h4 style="margin-bottom: 0.8rem; display: flex; align-items: center; gap: 6px; font-size: 0.95rem; color: var(--text-main);"><i class="${icon}"></i> ${title}</h4>
                                            <ul style="margin: 0; padding: 0; list-style: none;">
                                                ${todos.map(todo => `
                                                    <li class="noti-todo-item" data-todo-id="${todo.id}" data-project-id="${todo.product_id}" style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.03); margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)';" onmouseout="this.style.background='rgba(255,255,255,0.03)';">
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
                                        <div class="notification-bell" style="position: fixed; top: 30px; right: 40px; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; background: rgba(37,99,235,0.15); box-shadow: 0 0 20px rgba(37,99,235,0.2); transition: 0.3s; z-index: 1000;" onmouseover="this.style.background='rgba(37,99,235,0.25)'; this.style.transform='scale(1.05)';" onmouseout="this.style.background='rgba(37,99,235,0.15)'; this.style.transform='scale(1)';" onclick="const popup = document.getElementById('notification-popup'); popup.style.display = popup.style.display === 'none' ? 'block' : 'none';" title="알림 (할 일)">
                                            <i class="ph ph-bell-ringing" style="font-size: 2.5rem; color: var(--primary);"></i>
                                            ${pendingCount > 0 ? `<span style="position: absolute; top: 10px; right: 12px; width: 14px; height: 14px; background: var(--accent-danger, #ef4444); border-radius: 50%; border: 2px solid var(--bg-dark); box-shadow: 0 0 10px var(--accent-danger);"></span>` : ''}
                                        </div>
                                        <div id="notification-popup" class="glass fade-in" style="display: none; position: fixed; top: 100px; right: 16px; width: calc(100vw - 32px); max-width: 380px; max-height: 70vh; overflow-y: auto; border-radius: 20px; z-index: 1001; padding: 1.5rem; box-shadow: 0 10px 40px rgba(0,0,0,0.5); border: 1px solid var(--card-border); text-align: left; box-sizing: border-box;">
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                                                <h3 style="margin: 0; display: flex; align-items: center; gap: 8px; font-size: 1.1rem; color: white;"><i class="ph ph-bell"></i> 알림 (할 일)</h3>
                                                <button onclick="document.getElementById('notification-popup').style.display='none'" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; transition: 0.2s;" onmouseover="this.style.color='white'" onmouseout="this.style.color='var(--text-muted)'"><i class="ph ph-x" style="font-size: 1.2rem;"></i></button>
                                            </div>
                                            ${renderTodoList(myTodos, '내가 할 일', 'ph ph-user-focus')}
                                            ${renderTodoList(requestedTodos, '요청한 일', 'ph ph-paper-plane-tilt')}
                                        </div>
                                    `;
                                })()}
                            </div>
                        </div>
                        
                        <div class="floating-stats">
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

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.onclick = async () => {
                try { await this.supabase.auth.signOut(); } catch(err) {}
                localStorage.removeItem('bhas_session_user');
                localStorage.removeItem('bhas_auto_login');
                this.setState({ currentUser: null, currentView: 'login', activeProjectId: null, selectedCompanyId: 'all' });
            };
        }

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

            const newProject = {
                company_id: company_id,
                brand_id: brandId,
                name: name,
                deadline: this.formatDateToUI(deadline)
                // stage 컬럼은 products 테이블에 존재하지 않으므로 제외
            };

            try {
                const { data, error } = await this.supabase
                    .from('products')
                    .insert([newProject])
                    .select();

                if (error) {
                    console.error('Supabase Insert Error:', error);
                    throw error;
                }
                
                if (!data || data.length === 0) throw new Error('데이터 저장 성공했으나 응답이 없습니다.');

                // 히스토리 기록 시도 (비차단형)
                try {
                    await this.supabase.from('history').insert([{
                        product_id: data[0].id,
                        stage_id: 'consulting',
                        status: '등록',
                        note: '프로젝트 생성: ' + name
                    }]);
                } catch (hError) {
                    console.warn('History recording failed (non-blocking):', hError);
                }

                await this.loadInitialData();
                modal.style.display = 'none';
                this.requestRender();
                this.showToast('새 프로젝트가 등록되었습니다.');
            } catch (error) {
                console.error('Add Project Error Details:', error);
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

            if (!pid || !text) return alert('프로젝트와 내용을 입력해주세요.');

            saveBtn.disabled = true;
            try {
                // handleNewTodoProcess를 사용하도록 리팩토링
                const success = await this.handleNewTodoProcess(pid, text, isRequest, assigneeId, date);
                
                if (success) {
                    modal.style.display = 'none';
                }
            } catch (err) {
                console.error(err);
                alert('저장 중 오류가 발생했습니다: ' + (err.message || '알 수 없는 서버 오류'));
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

            if (!pid || !name || !file) return alert('모든 항목을 입력하고 파일을 선택해주세요.');

            saveBtn.disabled = true;
            saveBtn.innerText = '업로드 중...';
            try {
                await this.handleFileUpload(pid, file, type, name);
                this.showToast('새 문서가 등록되었습니다.');
                modal.style.display = 'none';
                await this.loadInitialData();
                this.requestRender();
            } catch (err) {
                console.error(err);
                alert('업로드 중 오류가 발생했습니다.');
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
                if (historyError) console.error('History Insert Warning:', historyError);

                await this.loadInitialData();
                this.showToast(`${stage.label} 상세 설정이 저장되었습니다.`);
                await closeSidebar();
            } catch (error) {
                console.error('Save Stage Error:', error);
                alert('설정 저장 중 오류가 발생했습니다.');
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
                    <div style="margin-bottom: 1.5rem; font-size: 0.9rem; color: var(--text-muted); padding-bottom: 1rem; border-bottom: 1px dashed rgba(255,255,255,0.1);">
                        <div style="margin-bottom: 5px;"><strong>프로젝트:</strong> ${project.name}</div>
                        <div style="margin-bottom: 5px;"><strong>할 일:</strong> <span style="color: white;">${todo.text}</span></div>
                        <div style="margin-bottom: 5px;"><strong>마감일:</strong> ${todo.due_date ? this.formatDateToUI(todo.due_date) : '일정'}</div>
                    </div>
                    <div class="login-field" style="margin-top: 1rem;">
                        <label>메모/피드백</label>
                        <textarea id="todo-memo-text" class="login-input" placeholder="이 할 일에 대한 메모나 진행 상황을 우측 화면에서 넓게 확인하고 기입하세요." style="min-height: 300px; resize: vertical; line-height: 1.6; font-size: 0.95rem;">${todo.memo || ''}</textarea>
                    </div>
                </div>
                <div style="display: flex; gap: 1rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
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

    renderSubView(products) {
        const { role, id: currentUserId, name: currentUserName } = this.currentUser;
        
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
                const statusLabel = lastCompletedStage ? lastCompletedStage.label : (progress === 0 && product.history.length > 1 ? '상담 진행' : '시작 전');
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
                                ${this.canDelete(product) ? `<button class="btn-danger" onclick="app.handleDelete(event, 'project', '${product.id}')" title="프로젝트 삭제" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
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
                                        const statusLabel = lastCompletedStage ? lastCompletedStage.label : (progress === 0 && product.history.length > 1 ? '상담 진행' : '시작 전');
                                        
                                        return `
                                            <tr class="project-row" data-id="${product.id}" style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: 0.2s; cursor: pointer;" onmouseover="this.style.background='rgba(255,255,255,0.02)'" onmouseout="this.style.background='transparent'">
                                                <td style="padding: 12px 16px; font-weight: 600;">
                                                    <div style="display: flex; align-items: center; gap: 8px;">
                                                        <i class="ph ph-briefcase" style="color: ${brandColor}; opacity: 0.7;"></i>
                                                        ${product.name}
                                                    </div>
                                                </td>
                                                <td style="padding: 12px 16px; font-size: 0.85rem; color: var(--text-muted);">${this.formatDateToUI(product.deadline)}</td>
                                                <td style="padding: 12px 16px;">
                                                    <div style="display: flex; align-items: center; gap: 10px;">
                                                        <div style="flex: 1; height: 6px; background: rgba(255,255,255,0.05); border-radius: 3px; overflow: hidden; max-width: 100px;">
                                                            <div style="width: ${progress}%; height: 100%; background: ${brandColor}; box-shadow: 0 0 10px ${brandColor}44;"></div>
                                                        </div>
                                                        <span style="font-size: 0.75rem; color: ${progress > 0 ? 'white' : 'var(--text-muted)'};">${statusLabel} (${progress}%)</span>
                                                    </div>
                                                </td>
                                                <td style="padding: 12px 16px; text-align: center;">
                                                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                                                        ${this.canDelete(product) ? `<button class="btn-danger" onclick="app.handleDelete(event, 'project', '${product.id}')" title="프로젝트 삭제" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
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

            return `
                <div class="dashboard-sections">
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
                            <li class="todo-item" data-todo-id="${todo.id}" data-project-id="${todo.product_id}" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; background: rgba(255,255,255,0.03); margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.05); transition: 0.2s; cursor: pointer; position: relative;" onmouseover="this.style.background='rgba(255,255,255,0.08)';" onmouseout="this.style.background='rgba(255,255,255,0.03)';">
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
                                    ${this.canDelete(todo) ? `<button onclick="app.handleDelete(event, 'todo', '${todo.id}', '${todo.product_id}')" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
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
                                <select id="todo-brand-filter" class="glass brand-select" style="color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 12px; outline: none; cursor: pointer; box-sizing: border-box;">
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
                                                    <li class="todo-item" data-todo-id="${todo.id}" data-project-id="${todo.product_id}" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.02); margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.04); transition: 0.2s; cursor: pointer;" onmouseover="this.style.background='rgba(255,255,255,0.06)';" onmouseout="this.style.background='rgba(255,255,255,0.02)';">
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
                        date: p.history[0]?.date || '2024.03.01',
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
                                <select id="doc-global-company-filter" class="glass brand-select" style="margin-top: ${isMobile ? '5px' : '0'}; width: ${isMobile ? '100%' : 'auto'}; min-width: ${isMobile ? '0' : '200px'}; max-width: 100%; color: white; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 12px; outline: none; cursor: pointer; box-sizing: border-box;">
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
                                                   background: ${this.selectedDocCategory === cat ? 'var(--primary)' : 'rgba(255,255,255,0.05)'};">
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
                                            <div class="doc-card-name">
                                                <i class="ph ph-file-text"></i>
                                                <span style="font-weight: 600;">${doc.name || '이름 없음'}</span>
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
                                            <tr class="table-row doc-row" style="border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem; cursor: pointer;" 
                                                onclick="app.showFileModal('${doc.url}', '${doc.name}')">
                                                <td style="padding: 12px; color: var(--text-muted);">${doc.date || '-'}</td>
                                                <td style="padding: 12px;">${brand ? brand.name : '-'}</td>
                                                <td style="padding: 12px; color: var(--primary);">${product ? product.name : '알 수 없음'}</td>
                                                <td style="padding: 12px; font-weight: 600;">
                                                    <span class="badge badge-${doc.category || '기타'}" style="padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; margin-right: 8px; vertical-align: middle;">
                                                        ${doc.category || '기타'}
                                                    </span>
                                                    ${doc.name || '이름 없음'}
                                                </td>
                                                <td style="padding: 12px; font-size: 0.8rem;" class="memo-cell">
                                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                                                        <input type="text" class="inline-memo-input" 
                                                               data-doc-id="${doc.id}" 
                                                               data-p-id="${doc.productId || ''}"
                                                               value="${doc.memo || ''}" 
                                                               style="background: transparent; border: none; color: white; width: 100%; padding: 4px; border-radius: 4px; border-bottom: 1px dashed rgba(255,255,255,0.1);"
                                                               onclick="event.stopPropagation()">
                                                        ${this.canDelete(doc) ? `<button onclick="event.stopPropagation(); app.handleDelete(event, 'document', '${doc.id}', '${doc.productId || ''}')" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
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
                            <div class="schedule-summary glass" style="padding: 1.5rem; border-radius: 20px; margin-bottom: 1.5rem; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05);">
                                <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px;">
                                    <h3 style="margin: 0; font-size: 1.1rem; color: white;"><i class="ph ph-calendar-check" style="color: var(--primary);"></i> 생산 일정 요약</h3>
                                    <span style="font-size: 0.8rem; color: var(--text-muted);">현재 공정: <b style="color: var(--primary);">${product.status || '대기'}</b></span>
                                </div>
                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.75rem;">
                                    ${STAGES.slice(0, 4).map(stage => {
                                        const sData = (product.stages_data && (product.stages_data[stage.id] || product.stages_data[stage.docType])) || {};
                                        const isComp = isStageCompleted(product, stage);
                                        return `
                                            <div style="display: flex; flex-direction: column; gap: 4px; padding: 10px; border-radius: 12px; background: rgba(255,255,255,0.02); border: 1px solid ${isComp ? 'rgba(37,99,235,0.2)' : 'rgba(255,255,255,0.05)'};">
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
                                    let bg = isCompleted ? 'rgba(37, 99, 235, 0.1)' : (inProgress ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)');
                                    let border = isCompleted ? 'var(--primary)' : (inProgress ? '#f59e0b' : 'rgba(255,255,255,0.05)');
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
                            <div class="notepad-content" style="flex: 1; display: flex; flex-direction: column; background: rgba(255,255,255,0.02); border-radius: 12px; padding: 10px; overflow: visible; min-height: 300px;">
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
                                                ${isMine && this.canDelete(m) ? `<button onclick="app.handleDelete(event, 'memo', '${m.id}', '${product.id}')" style="width: 20px; height: 20px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; padding: 0; flex-shrink: 0;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                                <div style="background: ${isMine ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}; color: white; padding: 10px 14px; border-radius: 16px; font-size: 0.95rem; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.5; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">${memoText}</div>
                                                ${!isMine && this.canDelete(m) ? `<button onclick="app.handleDelete(event, 'memo', '${m.id}', '${product.id}')" style="width: 20px; height: 20px; border-radius: 6px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; padding: 0; flex-shrink: 0;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
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
                                            <li class="todo-item ${todo.completed ? 'completed' : ''}" data-todo-id="${todo.id}" style="display: flex; align-items: center; gap: 12px; cursor: pointer; transition: 0.2s; position: relative; padding: 8px 12px; border-radius: 12px;" onmouseover="this.style.background='rgba(255,255,255,0.05)';" onmouseout="this.style.background='transparent';">
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
                                                ${this.canDelete(todo) ? `<button onclick="app.handleDelete(event, 'todo', '${todo.id}', '${product.id}')" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                            </li>
                                        `).join('')}
                                        <li class="todo-item inline-add-row" style="margin-top: 15px; background: rgba(255,255,255,0.03); border: 1px dashed var(--card-border); border-radius: 12px; padding: 8px 12px; position: relative; display: flex; align-items: center; gap: 10px;">
                                            <i class="ph ph-plus" style="color: var(--text-muted); font-size: 1.1rem;"></i>
                                            <input type="text" id="inline-todo-input" placeholder="새 할 일 입력 (@이름으로 담당자 지정)..." style="flex: 1; background: transparent; border: none; color: white; outline: none; font-size: 0.9rem;">
                                            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                                <button id="inline-add-todo-btn" class="btn-primary" style="padding: 6px 10px; border-radius: 8px; font-size: 0.75rem; border: none; display: flex; align-items: center; gap: 4px;"><i class="ph ph-plus-circle"></i> 할 일</button>
                                                <button id="inline-add-request-btn" class="btn-secondary" style="padding: 6px 10px; border-radius: 8px; font-size: 0.75rem; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; cursor: pointer; display: flex; align-items: center; gap: 4px;"><i class="ph ph-paper-plane-tilt"></i> 요청</button>
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
                                                ${this.canDelete(photoObj) ? `<button onclick="event.stopPropagation(); app.handleDelete(event, 'photo', '${photoObj.id || photoObj.url}', '${product.id}')" style="position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 4px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(0,0,0,0.5)'; this.style.borderColor='rgba(255,255,255,0.2)'"><i class="ph ph-x"></i></button>` : ''}
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
                                            <div class="doc-item glass" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; border-radius: 12px; border: 1px solid var(--card-border); background: rgba(255,255,255,0.02);">
                                                <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; flex: 1;">
                                                    <i class="ph ph-file-text" style="font-size: 1.2rem; color: var(--primary);"></i>
                                                    <span style="font-size: 0.9rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${doc.name}</span>
                                                </div>
                                                <div style="display: flex; gap: 8px; align-items: center;">
                                                    <a href="${doc.url}" target="_blank" style="padding: 4px 8px; border-radius: 6px; background: rgba(37,99,235,0.1); color: var(--primary); font-size: 0.75rem; text-decoration: none;" onmouseover="this.style.background='rgba(37,99,235,0.2)'" onmouseout="this.style.background='rgba(37,99,235,0.1)'">열기</a>
                                                    ${this.canDelete(doc) ? `<button onclick="app.handleDelete(event, 'document', '${doc.id}', '${product.id}')" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
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
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem;">
                                    <td style="padding: 1rem; font-weight: 500;">${c.name}</td>
                                    <td style="padding: 1rem; color: var(--text-muted);">${c.username}</td>
                                    <td style="padding: 1rem;">
                                        <span style="color: var(--primary); font-weight: 600;">
                                            ${c.role === 'CLIENT' ? (brand ? brand.name : '브랜드 미지정') : (c.role === 'MASTER' ? '전체 관리' : '운영 관리')}
                                        </span>
                                    </td>
                                    <td style="padding: 1rem;">
                                        <span style="background: ${c.role === 'MASTER' ? 'rgba(37,99,235,0.2)' : (c.role === 'STAFF' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)')}; 
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
                                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.04); transition: 0.2s; ${isClosed ? 'opacity: 0.5;' : ''}" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                                        <td data-label="컬러" style="padding: 14px 12px;">
                                            <div style="width: 28px; height: 28px; border-radius: 8px; background: ${b.brand_color || 'var(--primary)'}; border: 2px solid rgba(255,255,255,0.1);"></div>
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
        }
    }

    bindDashboardEvents() {
        // 사이드바 내비게이션 (onclick으로 중복 방지)
        this.appContainer.querySelectorAll('.nav-links li[data-view]').forEach(li => {
            li.onclick = () => {
                const view = li.getAttribute('data-view');
                this.setState({ currentView: view });
            };
        });

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

            if (!newName) return alert('이름을 입력해주세요.');
            if (newPw && newPw.length < 6) return alert('비밀번호는 최소 6자 이상이어야 합니다.');

            saveBtn.disabled = true;
            saveBtn.innerText = '수정 중...';

            try {
                // 1. Supabase Auth 비밀번호 업데이트 (입력된 경우만)
                if (newPw) {
                    // 참고: 현재 세션이 MASTER이므로 타 사용자 PW 변경은 Admin API 필요할 수 있음. 
                    // 여기서는 단순 DB 정보 업데이트 위주로 처리하거나 알림.
                    const { error: authError } = await this.supabase.auth.updateUser({ password: newPw });
                    if (authError) console.warn('Auth PW update requires active session of the user or Admin API');
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
                console.error('Update User Error:', error);
                alert('계정 수정 중 오류가 발생했습니다.');
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

            if (!newName) return alert('브랜드 이름을 입력해주세요.');

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
                console.error('Update Brand Error:', error);
                alert('브랜드 수정 중 오류가 발생했습니다.');
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
                console.error('Add Todo Error:', insertError);
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
                console.warn('History entry failed (non-blocking):', hError);
            }

            await this.loadInitialData();
            this.requestRender();
            this.showToast(isRequest ? '업무 요청이 등록되었습니다.' : '할 일이 추가되었습니다.');
            return true;
        } catch (error) {
            console.error('Add Todo Unexpected Error:', error);
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
                            <div class="mention-item" data-id="${c.id}" data-name="${c.name}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem;" onmouseover="this.style.background='rgba(37,99,235,0.2)'" onmouseout="this.style.background='transparent'">
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
                    console.error('Quick Add Error:', err);
                    alert('처리 중 오류가 발생했습니다.');
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
                        console.warn('History entry failed (non-blocking):', hErr);
                    }

                    await this.loadInitialData();
                    this.requestRender();
                    
                    setTimeout(() => {
                        const feed = document.getElementById('memo-feed');
                        if(feed) feed.scrollTop = feed.scrollHeight;
                    }, 10);
                } catch (error) {
                    console.error('Add Memo Error:', error);
                    alert('메모 저장 중 오류가 발생했습니다.');
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
                    console.error('Update Todo Error:', error);
                    e.target.checked = !completed; // UI 복구
                    alert('할 일 상태 수정 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
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
                    console.error('Update Assignee Error:', error);
                    alert('담당자 지정 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
                }
            });
        });

        this.appContainer.querySelectorAll('.todo-date-input').forEach(input => {
            input.addEventListener('change', async (e) => {
                const todoId = e.target.getAttribute('data-id');
                const due_date = val || null; // YYYY-MM-DD 형식 그대로 사용

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
                    console.error('Update DueDate Error:', error);
                    alert('마감일 수정 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
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
                    <button id="cancel-user-btn" style="flex: 1; padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer;">취소</button>
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
                    <button id="cancel-brand-btn" style="flex: 1; padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.05); border: 1px solid var(--card-border); color: var(--text-muted); cursor: pointer;">취소</button>
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

        if (!name) return alert('브랜드 이름을 입력해주세요.');

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
            console.error('Add Brand Error:', error);
            alert('브랜드 생성 중 오류가 발생했습니다.');
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
            return alert('모든 정보를 입력해주세요.');
        }

        if (password.length < 6) {
            return alert('비밀번호는 최소 6자 이상이어야 합니다.');
        }

        const brandId = document.getElementById('new-user-brand').value;
        const brand = mockData.brands?.find(b => b.id === brandId);

        if (role === 'CLIENT' && !brandId) {
            return alert('고객사(CLIENT) 계정은 반드시 브랜드를 선택해야 합니다.');
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

            // 2. companies 테이블에 정보 저장 (brand_id 및 auth_user_id 포함)
            const { error: dbError } = await this.supabase.from('companies').insert([{
                name,
                username,
                role,
                brand_id: brandId || null,
                auth_user_id: authData?.user?.id || null,
                created_at: new Date().toISOString()
            }]);

            if (dbError) throw dbError;

            this.showToast('새 계정이 추가되었습니다.');
            document.getElementById('add-user-modal').style.display = 'none';
            await this.loadInitialData();
            this.requestRender();

        } catch (error) {
            console.error('Add User Error:', error);
            alert(`계정 생성 중 오류가 발생했습니다: ${error.message}`);
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
                console.warn('History entry failed (non-blocking):', hError);
            }

            await this.loadInitialData();
            this.requestRender();
            this.showToast('사진이 성공적으로 업로드되었습니다.');
        } catch (error) {
            console.error('Photo Upload Error:', error);
            alert(`사진 업로드 중 오류가 발생했습니다: ${error.message || '알 수 없는 오류'}`);
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
                console.warn('History entry failed (non-blocking):', hError);
            }

            await this.loadInitialData();
            this.requestRender();
            this.showToast('문서가 성공적으로 업로드되었습니다.');
        } catch (error) {
            console.error('File Upload Error:', error);
            if (error.message === 'The resource was not found' || error.statusCode === '404') {
                this.showToast('오류: Supabase에 "bhas" 스토리지 버킷이 없습니다.');
                alert('Supabase Dashboard에서 "bhas"라는 이름의 public 버킷을 생성해 주세요.');
            } else {
                this.showToast(`업로드 실패: ${error.message}`);
            }
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.app = new BhasApp();
});
