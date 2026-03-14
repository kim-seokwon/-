// import { mockData, STAGES } from './mockData.js';

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
        
        // 타임라인 관련 상태
        this.timelineYear = new Date().getFullYear();
        this.timelineMonth = new Date().getMonth() + 1;
        
        window.app = this; // 전역 참조 추가 (타임라인 등에서 필요)
        this.supabase = supabase;
        
        // 실시간 연동을 위한 데이터 저장소
        this.products = [];
        this.companies = [];
        
        this.init();
    }

    showToast(message) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<i class="ph ph-bell-ringing" style="font-size: 1.2rem; color: var(--primary);"></i> <span>${message}</span>`;
        container.appendChild(toast);
        
        // Trigger reflow
        toast.offsetHeight;
        toast.classList.add('show');
        
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    init() {
        this.appContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-delete-type]');
            if (!btn) return;
            e.stopPropagation();
            const type = btn.getAttribute('data-delete-type');
            const id = btn.getAttribute('data-id');
            const parentId = btn.getAttribute('data-parent-id');

            if (!confirm('정말로 삭제하시겠습니까?\n(이 작업은 복구할 수 없습니다.)')) return;

            if (type === 'project') {
                mockData.products = mockData.products.filter(p => String(p.id) !== String(id));
                if (this.activeProjectId === String(id)) this.setState({ currentView: 'dashboard', activeProjectId: null });
                else this.render();
                this.showToast('프로젝트가 삭제되었습니다.');
            } else if (type === 'todo') {
                const proj = mockData.products.find(p => String(p.id) === String(parentId));
                if (proj) {
                    proj.todos = proj.todos.filter(t => String(t.id) !== String(id));
                    this.render();
                    this.showToast('할 일이 삭제되었습니다.');
                }
            } else if (type === 'document') {
                const globalDocIdx = mockData.globalDocuments.findIndex(d => String(d.id) === String(id));
                if (globalDocIdx > -1) {
                    mockData.globalDocuments.splice(globalDocIdx, 1);
                } else {
                    const proj = mockData.products.find(p => String(p.id) === String(parentId));
                    if (proj && proj.documents) {
                        proj.documents = proj.documents.filter(d => String(d.id) !== String(id));
                    }
                }
                this.render();
                this.showToast('문서가 삭제되었습니다.');
            } else if (type === 'memo') {
                const proj = mockData.products.find(p => String(p.id) === String(parentId));
                if (proj && proj.memos) {
                    proj.memos = proj.memos.filter(m => String(m.id) !== String(id));
                    this.render();
                    this.showToast('메모가 삭제되었습니다.');
                }
            } else if (type === 'photo') {
                const proj = mockData.products.find(p => String(p.id) === String(parentId));
                if (proj && proj.photos) {
                    proj.photos = proj.photos.filter(ph => {
                        const url = (typeof ph === 'string') ? ph : ph.url;
                        return url !== id;
                    });
                    this.render();
                    this.showToast('사진이 삭제되었습니다.');
                }
            }
        });

        this.syncStagesData();
        this.render();
    }

    syncStagesData() {
        // mockData.products의 stagesData를 history와 schedules 기반으로 자동 동기화
        mockData.products.forEach(product => {
            if (!product.stagesData) product.stagesData = {};

            // 1. history 기반 (완료된 공정)
            if (product.history) {
                product.history.forEach(h => {
                    const stage = STAGES.find(s => s.id === h.stage);
                    const stageId = stage ? stage.id : h.stage;
                    if (stageId && !product.stagesData[stageId]) {
                        product.stagesData[stageId] = {
                            status: 'completed',
                            dueDate: h.date,
                            note: '기록 기반 자동 동기화'
                        };
                    }
                });
            }

            // 2. schedules 기반 (예정 또는 진행 중인 공정)
            const relevantSchedules = (mockData.schedules || []).filter(s => s.productId === product.id);
            relevantSchedules.forEach(s => {
                if (s.stage) {
                    // 이미 완료된 기록이 있다면 덮어쓰지 않음
                    if (!product.stagesData[s.stage] || product.stagesData[s.stage].status !== 'completed') {
                        product.stagesData[s.stage] = {
                            status: 'processing',
                            dueDate: s.end || s.start,
                            note: s.title
                        };
                    }
                }
            });
        });
    }

    setState(newState) {
        Object.assign(this, newState);
        this.render();
    }

    render() {
        this.appContainer.innerHTML = '';
        
        switch (this.currentView) {
            case 'login':
                this.renderLogin();
                break;
            default:
                // dashboard, production_schedule, documents, user_management, detail 모두 renderDashboard에서 처리
                this.renderDashboard();
                break;
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
                            <label for="email">이메일</label>
                            <input type="email" id="email" class="login-input" placeholder="이메일을 입력하세요" required>
                        </div>
                        <div class="input-group">
                            <label for="password">비밀번호</label>
                            <input type="password" id="password" class="login-input" placeholder="비밀번호를 입력하세요" required>
                        </div>
                        <div id="login-error" class="login-error">이메일 또는 비밀번호가 올바르지 않습니다.</div>
                        <button type="submit" class="login-submit-btn" id="login-btn">로그인</button>
                    </form>
                </div>
            </div>
        `;
        this.appContainer.innerHTML = loginHtml;

        const form = document.getElementById('login-form');
        const loginBtn = document.getElementById('login-btn');
        const errorMsg = document.getElementById('login-error');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            loginBtn.disabled = true;
            loginBtn.innerText = '로그인 중...';
            errorMsg.style.display = 'none';

            try {
                const { data, error } = await this.supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (error) throw error;

                // 로그인 성공 시 실제 데이터 로드
                this.currentUser = data.user;
                // 임시: role 설정 (나중에 profiles 테이블에서 가져와야 함)
                this.currentUser.role = data.user.email === 'admin@admin.com' ? 'MASTER' : 'CLIENT';
                this.currentUser.name = data.user.email.split('@')[0];

                await this.loadInitialData();
                this.setState({ currentView: 'dashboard' });
                this.showToast('성공적으로 로그인되었습니다.');
            } catch (error) {
                console.error('Login Error:', error);
                errorMsg.innerText = '이메일 또는 비밀번호를 확인해주세요.';
                errorMsg.style.display = 'block';
                errorMsg.style.animation = 'none';
                errorMsg.offsetHeight;
                errorMsg.style.animation = null;
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
            { id: 'production_schedule', label: '생산 일정', icon: '<i class="ph ph-calendar-blank"></i>', visible: perms.includes('production_schedule') },
            { id: 'documents', label: '문서 관리', icon: '<i class="ph ph-folder-open"></i>', visible: perms.includes('documents') },
            { id: 'all_todos', label: '할일 모아보기', icon: '<i class="ph ph-list-checks"></i>', visible: true },
            { id: 'user_management', label: '권한 관리', icon: '<i class="ph ph-shield-check"></i>', visible: perms.includes('user_management') }
        ];

        let products = mockData.products;
        if (role === 'CLIENT') {
            products = mockData.products.filter(p => p.companyId === this.currentUser.id);
        } else if (this.selectedCompanyId !== 'all') {
            products = mockData.products.filter(p => p.companyId === this.selectedCompanyId);
        }

        const dashboardHtml = `
            <div class="dashboard fade-in">
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
                    <header class="content-header" style="flex-direction: column; align-items: flex-start; gap: 10px;">
                        ${this.currentView !== 'dashboard' ? `
                            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--text-muted); margin-bottom: 5px;">
                                <button class="breadcrumb-back-btn btn-secondary" style="padding: 6px 14px; border-radius: 8px; display: flex; align-items: center; gap: 6px; border: 1px solid var(--primary); background: rgba(37, 99, 235, 0.1); color: var(--text-main); font-weight: 600; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(37, 99, 235, 0.2)'" onmouseout="this.style.background='rgba(37, 99, 235, 0.1)'"><i class="ph ph-arrow-left"></i> 뒤로가기</button>
                                <span>/</span>
                                <span>${this.currentView === 'detail' ? '프로젝트 상세보기' : (menuItems.find(m => m.id === this.currentView)?.label || this.currentView)}</span>
                            </div>
                        ` : ''}
                        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                            <div style="display: flex; align-items: center; gap: 20px;">
                                <h1 style="display: flex; align-items: center; gap: 12px;">
                                    ${this.currentView === 'detail' ? (mockData.products.find(p => p.id === this.activeProjectId)?.name || '상세보기') : (menuItems.find(m => m.id === this.currentView)?.label || '현황')}
                                    ${this.currentView === 'dashboard' ? `
                                        <div class="view-toggles" style="display: flex; gap: 4px; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 8px;">
                                            <button id="view-grid-btn" style="padding: 4px; border: none; background: ${this.dashboardViewType !== 'table' ? 'var(--primary)' : 'transparent'}; color: white; border-radius: 4px; cursor: pointer; display: flex; align-items: center;"><i class="ph ph-squares-four"></i></button>
                                            <button id="view-table-btn" style="padding: 4px; border: none; background: ${this.dashboardViewType === 'table' ? 'var(--primary)' : 'transparent'}; color: white; border-radius: 4px; cursor: pointer; display: flex; align-items: center;"><i class="ph ph-list-dashes"></i></button>
                                        </div>
                                    ` : ''}
                                </h1>
                                ${(role === 'MASTER' || role === 'STAFF') && this.currentView !== 'detail' && this.currentView !== 'user_management' && this.currentView !== 'documents' ? `
                                    <select id="global-company-filter" class="glass" style="padding: 8px 12px; border-radius: 12px; border: 1px solid var(--card-border); background: rgba(255,255,255,0.05); color: white; cursor: pointer;">
                                        <option value="all" ${this.selectedCompanyId === 'all' ? 'selected' : ''}>전체 브랜드 보기</option>
                                        ${mockData.companies.filter(c => c.role === 'CLIENT').map(c => `
                                            <option value="${c.id}" ${this.selectedCompanyId === c.id ? 'selected' : ''}>${c.name}</option>
                                        `).join('')}
                                    </select>
                                ` : ''}
                                ${(() => {
                                    const pendingCount = mockData.products.flatMap(p => p.todos || []).filter(t => !t.completed && t.assignee === this.currentUser.id).length;
                                    
                                    const allTodos = mockData.products.flatMap(p => {
                                        const company = mockData.companies.find(c => c.id === p.companyId);
                                        return (p.todos || []).map(t => ({...t, projectName: p.name, projectId: p.id, companyId: p.companyId, companyName: company ? company.name : ''}));
                                    });
                                    let filteredTodos = allTodos.filter(t => !t.completed);
                                    if (this.currentUser.role === 'CLIENT') {
                                        filteredTodos = filteredTodos.filter(t => t.companyId === this.currentUser.id);
                                    }
                                    const myTodos = filteredTodos.filter(t => t.assignee === this.currentUser.id);
                                    const requestedTodos = filteredTodos.filter(t => t.createdBy === this.currentUser.id);

                                    const renderTodoList = (todos, title, icon) => `
                                        <div style="margin-bottom: 1rem;">
                                            <h4 style="margin-bottom: 0.8rem; display: flex; align-items: center; gap: 6px; font-size: 0.95rem; color: var(--text-main);"><i class="${icon}"></i> ${title}</h4>
                                            <ul style="margin: 0; padding: 0; list-style: none;">
                                                ${todos.map(todo => `
                                                    <li class="noti-todo-item" data-todo-id="${todo.id}" data-project-id="${todo.projectId}" style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.03); margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.05); cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.08)';" onmouseout="this.style.background='rgba(255,255,255,0.03)';">
                                                        <div class="noti-quick-check" data-id="${todo.id}" data-pid="${todo.projectId}" style="width: 16px; height: 16px; border: 2px solid var(--card-border); border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-top: 3px; background: transparent; flex-shrink: 0; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='var(--primary)'; this.style.boxShadow='0 0 5px var(--primary)';" onmouseout="this.style.borderColor='var(--card-border)'; this.style.boxShadow='none';"></div>
                                                        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; overflow: hidden;">
                                                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                                                <span style="font-size: 0.75rem; font-weight: 500; color: var(--primary);"><strong style="color: var(--primary);">[${todo.companyName}]</strong> <span style="color: var(--text-muted);">${todo.projectName}</span></span>
                                                                <span style="font-size: 0.75rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px;">${todo.dueDate ? todo.dueDate.replace(/-/g, '.').slice(2) : '일정'}</span>
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
                                        <div id="notification-popup" class="glass fade-in" style="display: none; position: fixed; top: 100px; right: 40px; width: 380px; max-height: 70vh; overflow-y: auto; border-radius: 20px; z-index: 1001; padding: 1.5rem; box-shadow: 0 10px 40px rgba(0,0,0,0.5); border: 1px solid var(--card-border); text-align: left;">
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
                        <div class="floating-stats" style="position: fixed; bottom: 30px; right: 30px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; pointer-events: none;">
                            ${this.currentView === 'dashboard' ? `
                                <div class="stat-item" style="display: flex; gap: 0.8rem; pointer-events: auto;">
                                    <div class="glass" style="padding: 12px 20px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 100px; background: rgba(17,24,39,0.85); box-shadow: 0 10px 25px rgba(0,0,0,0.4); backdrop-filter: blur(10px);">
                                        <span class="label" style="font-size: 0.75rem;"><i class="ph ph-rocket-launch"></i> 진행 중</span>
                                        <span class="value" style="color: var(--primary); font-size: 1.5rem; margin-top: 4px;">${products.filter(p => p.currentStage !== 'shipping' && (p.stagesData?.contract?.status === 'completed' || p.stagesData?.consulting?.status === 'completed' || p.history.length > 1 || (p.documents && p.documents.length > 0))).length}</span>
                                    </div>
                                    <div class="glass" style="padding: 12px 20px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 100px; background: rgba(17,24,39,0.85); box-shadow: 0 10px 25px rgba(0,0,0,0.4); backdrop-filter: blur(10px);">
                                        <span class="label" style="font-size: 0.75rem;"><i class="ph ph-calendar-blank"></i> 예정</span>
                                        <span class="value" style="color: #f59e0b; font-size: 1.5rem; margin-top: 4px;">${products.filter(p => p.currentStage !== 'shipping' && !(p.stagesData?.contract?.status === 'completed' || p.stagesData?.consulting?.status === 'completed' || p.history.length > 1 || (p.documents && p.documents.length > 0))).length}</span>
                                    </div>
                                    <div class="glass" style="padding: 12px 20px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 100px; background: rgba(17,24,39,0.85); box-shadow: 0 10px 25px rgba(0,0,0,0.4); backdrop-filter: blur(10px);">
                                        <span class="label" style="font-size: 0.75rem;"><i class="ph ph-check-circle"></i> 완료 됨</span>
                                        <span class="value" style="color: #10b981; font-size: 1.5rem; margin-top: 4px;">${products.filter(p => p.currentStage === 'shipping').length}</span>
                                    </div>
                                </div>
                            ` : (this.currentView === 'all_todos' ? (() => {
                                const allTodos = products.flatMap(p => p.todos || []);
                                let filteredTodos = allTodos.filter(t => !t.completed);
                                if (role === 'CLIENT') filteredTodos = filteredTodos.filter(t => t.companyId === this.currentUser.id);
                                const myTodosCount = filteredTodos.filter(t => t.assignee === this.currentUser.id).length;
                                const reqTodosCount = filteredTodos.filter(t => t.createdBy === this.currentUser.id).length;
                                return `
                                <div class="stat-item" style="display: flex; gap: 0.8rem; pointer-events: auto;">
                                    <div class="glass" style="padding: 12px 20px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 100px; background: rgba(17,24,39,0.85); box-shadow: 0 10px 25px rgba(0,0,0,0.4); backdrop-filter: blur(10px);">
                                        <span class="label" style="font-size: 0.75rem;"><i class="ph ph-user-focus"></i> 내가 할 일</span>
                                        <span class="value" style="color: var(--primary); font-size: 1.5rem; margin-top: 4px;">${myTodosCount}</span>
                                    </div>
                                    <div class="glass" style="padding: 12px 20px; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 100px; background: rgba(17,24,39,0.85); box-shadow: 0 10px 25px rgba(0,0,0,0.4); backdrop-filter: blur(10px);">
                                        <span class="label" style="font-size: 0.75rem;"><i class="ph ph-paper-plane-tilt"></i> 요청한 일</span>
                                        <span class="value" style="color: #f59e0b; font-size: 1.5rem; margin-top: 4px;">${reqTodosCount}</span>
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
        const backBtn = this.appContainer.querySelector('.breadcrumb-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.setState({ currentView: 'dashboard' });
            });
        }
        
        if (this.currentView === 'dashboard') {
            this.bindDashboardEvents();
            this.appContainer.querySelectorAll('.project-card').forEach(card => {
                card.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    this.setState({ activeProjectId: card.getAttribute('data-id'), currentView: 'detail' });
                });
            });
            this.appContainer.querySelectorAll('.project-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    this.setState({ activeProjectId: row.getAttribute('data-id'), currentView: 'detail' });
                });
            });

            const addProjectBtn = document.getElementById('add-project-btn');
            if (addProjectBtn) {
                addProjectBtn.addEventListener('click', () => this.showProjectModal());
            }
        }
        
        if (this.currentView === 'all_todos') {
            this.bindAllTodosEvents();
            this.appContainer.querySelectorAll('.todo-project-link').forEach(link => {
                link.addEventListener('click', () => {
                    this.setState({ activeProjectId: link.getAttribute('data-id'), currentView: 'detail' });
                });
            });
        }

        if (this.currentView === 'detail') {
            this.bindDetailEvents();
        }

        if (this.currentView === 'production_schedule') {
            // 연도/월 변경 이벤트
            const yearSelect = document.getElementById('timeline-year-select');
            const monthSelect = document.getElementById('timeline-month-select');
            
            if (yearSelect) {
                yearSelect.addEventListener('change', (e) => {
                    this.timelineYear = parseInt(e.target.value);
                    this.render();
                });
            }
            if (monthSelect) {
                monthSelect.addEventListener('change', (e) => {
                    this.timelineMonth = parseInt(e.target.value);
                    this.render();
                });
            }
        }

        if (this.currentView === 'documents') {
            this.appContainer.querySelectorAll('.filter-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.selectedDocCategory = btn.getAttribute('data-cat');
                    this.render();
                });
            });

            // 문서 클릭 시 프로젝트 이동
            this.appContainer.querySelectorAll('.doc-row').forEach(row => {
                row.addEventListener('click', () => {
                    const productId = row.getAttribute('data-product-id');
                    if (productId) {
                        this.setState({ activeProjectId: productId, currentView: 'detail' });
                    }
                });
            });

            // 메모 수정 이벤트
            this.appContainer.querySelectorAll('.inline-memo-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const docId = input.getAttribute('data-doc-id');
                    const productId = input.getAttribute('data-p-id');
                    const newMemo = e.target.value;
                    
                    // 1. globalDocuments에서 검색
                    const globalDoc = mockData.globalDocuments.find(d => d.id == docId);
                    if (globalDoc) {
                        globalDoc.memo = newMemo;
                    } else {
                        // 2. 프로젝트 내부 문서/사진 메모 시뮬레이션 (수정 사항을 메모하도록 로직 보강 필요 시)
                        // 현재 데모에서는 UI 상에서만 유지되거나 globalDocuments를 확장하는 식의 처리가 필요
                        console.log(`Auto-generated doc ${docId} memo updated to: ${newMemo}`);
                    }
                });
            });
        }

        if (this.currentView === 'user_management') {
            const addAccountBtn = this.appContainer.querySelector('.btn-primary');
            if (addAccountBtn) {
                addAccountBtn.addEventListener('click', () => {
                    alert('새 계정 추가 기능을 시뮬레이션합니다. (ID/Role 입력 폼 필요)');
                });
            }

            this.appContainer.querySelectorAll('.pw-toggle').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.target.getAttribute('data-id');
                    const input = this.appContainer.querySelector('.pw-input-' + id);
                    if(input.type === 'password') {
                        input.type = 'text';
                        e.target.classList.replace('ph-eye', 'ph-eye-slash');
                    } else {
                        input.type = 'password';
                        e.target.classList.replace('ph-eye-slash', 'ph-eye');
                    }
                });
            });
        }

        this.appContainer.querySelectorAll('.nav-links li[data-view]').forEach(li => {
            li.addEventListener('click', () => {
                this.setState({ currentView: li.getAttribute('data-view') });
            });
        });

        const companyFilter = document.getElementById('global-company-filter');
        if (companyFilter) {
            companyFilter.addEventListener('change', (e) => {
                this.setState({ selectedCompanyId: e.target.value });
            });
        }

        document.getElementById('logout-btn').addEventListener('click', () => {
            this.setState({ currentUser: null, currentView: 'login', activeProjectId: null, selectedCompanyId: 'all' });
        });

        // 알림 팝업 이벤트 바인딩
        this.appContainer.querySelectorAll('.noti-quick-check').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const todoId = parseInt(e.currentTarget.getAttribute('data-id'));
                const pid = e.currentTarget.getAttribute('data-pid');
                const project = mockData.products.find(p => p.id === pid);
                if (project && project.todos) {
                    const todo = project.todos.find(t => t.id === todoId);
                    if (todo) {
                        if (confirm('정말 완료 처리하시겠습니까? 완료 시 목록에서 숨겨집니다.')) {
                            todo.completed = !todo.completed;
                            this.showToast('할 일이 완료 처리되었습니다.');
                            this.render();
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
                const todoId = parseInt(item.getAttribute('data-todo-id'));
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
            <div class="glass modal-content fade-in" style="width: 450px; padding: 2.5rem; border-radius: 30px;">
                <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px;"><i class="ph ph-plus-circle"></i> 새 프로젝트 등록</h2>
                <div class="login-field">
                    <label>프로젝트명</label>
                    <input type="text" id="modal-p-name" class="login-input" placeholder="예: 구스다운 패딩">
                </div>
                <div class="login-field">
                    <label>파트너사</label>
                    <select id="modal-p-company" class="login-input" style="background: rgba(0,0,0,0.2);">
                        ${mockData.companies.filter(c => c.role === 'CLIENT').map(c => `
                            <option value="${c.id}">${c.name}</option>
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

        document.getElementById('modal-cancel').onclick = () => { modal.style.display = 'none'; };
        document.getElementById('modal-save').onclick = () => {
            const name = document.getElementById('modal-p-name').value;
            const companyId = document.getElementById('modal-p-company').value;
            const deadline = document.getElementById('modal-p-deadline').value;

            if (!name || !deadline) return alert('모든 항목을 입력해주세요.');

            const newId = 'p' + (mockData.products.length + 1);
            mockData.products.push({
                id: newId,
                companyId: companyId,
                name: name,
                currentStage: 'consulting',
                deadline: deadline.replace(/-/g, '.'),
                notes: '',
                createdBy: this.currentUser.id,
                todos: [],
                photos: [],
                documents: [],
                history: [{ stage: 'consulting', date: new Date().toISOString().split('T')[0].replace(/-/g, '.') }]
            });

            modal.style.display = 'none';
            this.render();
        };
    }

    openStageSidebar(projectId, docType) {
        const project = mockData.products.find(p => p.id === String(projectId));
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
        
        if(!project.stagesData) project.stagesData = {};
        const stageData = project.stagesData[stage.id] || { status: (project.documents.some(doc => doc.type === docType) ? 'completed' : 'before'), dueDate: '', note: '' };

        sidebarContainer.innerHTML = `
            <div class="todo-sidebar glass slide-in-right" style="width: 600px; max-width: 90vw; height: 100vh; background: var(--bg-dark); border-radius: 20px 0 0 20px; padding: 2rem; display: flex; flex-direction: column; overflow-y: auto; border-left: 1px solid var(--card-border);">
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
                    <input type="date" id="stage-date-input" class="login-input" value="${stageData.dueDate ? stageData.dueDate.replace(/\./g, '-') : ''}" max="2099-12-31">
                </div>

                <div class="login-field" style="margin-bottom: 1.5rem; flex: 1; display: flex; flex-direction: column;">
                    <label>세부 내용 / 메모</label>
                    <textarea id="stage-note-input" class="login-input" style="flex: 1; min-height: 200px; resize: none; padding: 1rem;" placeholder="이 공정에 대한 세부 내용이나 특이사항을 기입해주세요...">${stageData.note || ''}</textarea>
                </div>

                <div class="login-field" style="margin-bottom: 1.5rem;">
                    <label>관련 파일(문서) 첨부</label>
                    <div style="display: flex; gap: 10px;">
                        <input type="text" id="stage-doc-name" class="login-input" placeholder="업로드할 파일명 (예: [${stage.label}] 수정본)" style="flex: 1;">
                        <button id="stage-upload-btn" class="btn-primary" style="padding: 0 1.5rem; border-radius: 12px; white-space: nowrap;">첨부</button>
                    </div>
                </div>

                <button id="save-stage-btn" class="btn-primary" style="padding: 1rem; width: 100%; font-size: 1.1rem; border-radius: 12px; margin-top: auto;">세부 내용 저장하기</button>
            </div>
        `;

        sidebarContainer.style.display = 'flex';

        setTimeout(() => {
            const sidebar = sidebarContainer.querySelector('.todo-sidebar');
            if(sidebar) sidebar.classList.add('active');
        }, 10);

        const closeSidebar = () => {
            const sidebar = sidebarContainer.querySelector('.todo-sidebar');
            if(sidebar) sidebar.classList.remove('active');
            setTimeout(() => {
                sidebarContainer.style.display = 'none';
                this.render();
            }, 300);
        };

        sidebarContainer.addEventListener('click', (e) => {
            if (e.target === sidebarContainer) closeSidebar();
        });

        document.getElementById('close-sidebar-btn').addEventListener('click', closeSidebar);

        document.getElementById('stage-upload-btn').addEventListener('click', () => {
            const name = document.getElementById('stage-doc-name').value;
            if (!name) return alert('첨부할 파일명을 입력해주세요.');
            const now = new Date().toISOString().split('T')[0].replace(/-/g, '.');
            
            project.documents.push({
                id: Date.now(),
                name: name,
                type: docType,
                date: now,
                createdBy: this.currentUser.id
            });
            document.getElementById('stage-status-select').value = 'completed';
            
            project.history.push({
                action: `${stage.label} 관련 문서 '${name}' 업로드`,
                date: now,
                user: this.currentUser.name
            });
            this.showToast('문서가 첨부되었습니다.');
            document.getElementById('stage-doc-name').value = '';
        });

        document.getElementById('save-stage-btn').addEventListener('click', () => {
            const status = document.getElementById('stage-status-select').value;
            const dateVal = document.getElementById('stage-date-input').value;
            const note = document.getElementById('stage-note-input').value;
            const dueDate = dateVal ? dateVal.replace(/-/g, '.') : '';
            
            project.stagesData[stage.id] = {
                status: status,
                dueDate: dueDate,
                note: note
            };
            
            // 공정 완료 처리
            if (status === 'completed' && project.currentStage !== 'shipping') {
                project.currentStage = stage.id;
            }

            const now = new Date().toISOString().split('T')[0].replace(/-/g, '.');
            project.history.push({
                action: `${stage.label} 공정 세부 설정 갱신`,
                date: now,
                user: this.currentUser.name
            });

            this.showToast(`${stage.label} 상세 설정이 저장되었습니다.`);
            closeSidebar();
        });
    }

    openTodoModal(projectId, todoId) {
        const project = mockData.products.find(p => p.id === String(projectId));
        if(!project) return;
        const todo = project.todos.find(t => t.id === parseInt(todoId));
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
            <div class="sidebar-content" style="background: var(--bg-dark); width: 600px; padding: 3rem; border-radius: 30px 0 0 30px; border-left: 1px solid var(--card-border); box-shadow: -10px 0 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; height: 100%; box-sizing: border-box; animation: slideInRight 0.3s ease-out forwards;">
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
                        <div style="margin-bottom: 5px;"><strong>마감일:</strong> ${todo.dueDate ? todo.dueDate.replace(/-/g, '.').slice(2) : '일정'}</div>
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
        };
    }

    canDelete(item) {
        if (!this.currentUser) return false;
        if (this.currentUser.role === 'MASTER') return true;
        if (item && item.createdBy === this.currentUser.id) return true;
        return false;
    }

    renderSubView(products) {
        const { role, id: currentUserId, name: currentUserName } = this.currentUser;
        
        // 데이터 정규화 및 상태 판별 헬퍼
        const isStageCompleted = (p, s) => {
            if (p.stagesData && p.stagesData[s.id] && p.stagesData[s.id].status === 'completed') return true;
            if (p.stagesData && p.stagesData[s.docType] && p.stagesData[s.docType].status === 'completed') return true;
            if (p.documents && p.documents.some(d => d.type === s.docType || d.type === s.id)) return true;
            return false;
        };

        const getProgress = (p) => {
            const completedCount = STAGES.filter(s => isStageCompleted(p, s)).length;
            return Math.round((completedCount / STAGES.length) * 100);
        };

        if (this.currentView === 'dashboard') {
            const isActive = (p) => p.currentStage !== 'shipping' && (p.stagesData?.contract?.status === 'completed' || p.stagesData?.consulting?.status === 'completed' || p.history.length > 1 || (p.documents && p.documents.length > 0));
            
            const activeProducts = products.filter(p => isActive(p));
            const scheduledProducts = products.filter(p => p.currentStage !== 'shipping' && !isActive(p));
            const completedProducts = products.filter(p => p.currentStage === 'shipping');

            const renderProjectCard = (product) => {
                const company = mockData.companies.find(c => c.id === product.companyId);
                const progress = getProgress(product);
                
                const lastCompletedStage = STAGES.slice().reverse().find(s => isStageCompleted(product, s));
                const currentStageObj = lastCompletedStage || STAGES[0];
                const statusLabel = lastCompletedStage ? lastCompletedStage.label : (progress === 0 && product.history.length > 1 ? '상담 진행' : '시작 전');
                return `
                    <div class="project-card glass fade-in" data-id="${product.id}" style="cursor: pointer;">
                        <div class="card-header">
                            <span class="company-tag">${company.name}</span>
                            <span class="deadline">~ ${product.deadline}</span>
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
                            <div style="display: flex; align-items: center; gap: 4px;"><i class="ph ph-clock"></i> 마감: ${product.deadline.slice(2)}</div>
                            <div style="display: flex; gap: 6px;">
                                ${this.canDelete(product) ? `<button class="btn-danger" data-delete-type="project" data-id="${product.id}" title="프로젝트 삭제" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'" onclick="event.stopPropagation()"><i class="ph ph-x"></i></button>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            };

            const renderProjectTable = (productList) => {
                if (productList.length === 0) return '';
                
                // 회사별 그룹화
                const grouped = productList.reduce((acc, p) => {
                    const cid = p.companyId;
                    if (!acc[cid]) acc[cid] = [];
                    acc[cid].push(p);
                    return acc;
                }, {});

                return Object.keys(grouped).map(companyId => {
                    const company = mockData.companies.find(c => c.id === companyId);
                    const companyName = company ? company.name : '알 수 없는 브랜드';
                    const brandColor = companyId === 'company_a' ? '#3b82f6' : (companyId === 'company_b' ? '#10b981' : 'var(--primary)');
                    const projects = grouped[companyId].sort((a, b) => a.name.localeCompare(b.name));

                    return `
                        <div class="glass" style="border-radius: 16px; overflow: hidden; margin-bottom: 2rem; border-left: 4px solid ${brandColor};">
                            <div style="background: rgba(255,255,255,0.03); padding: 12px 16px; border-bottom: 1px solid var(--card-border); display: flex; align-items: center; justify-content: space-between;">
                                <h3 style="font-size: 1rem; color: white; display: flex; align-items: center; gap: 8px;">
                                    <span style="background: ${brandColor}; width: 10px; height: 10px; border-radius: 50%;"></span>
                                    ${companyName}
                                </h3>
                                <span style="font-size: 0.75rem; color: var(--text-muted);">${projects.length}개의 프로젝트</span>
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
                                                <td style="padding: 12px 16px; font-size: 0.85rem; color: var(--text-muted);">${product.deadline}</td>
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
                                                        ${this.canDelete(product) ? `<button class="btn-danger" data-delete-type="project" data-id="${product.id}" title="프로젝트 삭제" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'" onclick="event.stopPropagation()"><i class="ph ph-x"></i></button>` : ''}
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
                const company = mockData.companies.find(c => c.id === p.companyId);
                return (p.todos || []).map(t => ({...t, projectName: p.name, projectId: p.id, companyId: p.companyId, companyName: company ? company.name : ''}));
            });
            
            let filteredTodos = allTodos.filter(t => !t.completed); // 숨김 처리
            if (this.currentUser.role === 'CLIENT') {
                filteredTodos = filteredTodos.filter(t => t.companyId === this.currentUser.id);
            }

            const myTodos = filteredTodos.filter(t => t.assignee === this.currentUser.id);
            const requestedTodos = filteredTodos.filter(t => t.createdBy === this.currentUser.id);

            const renderTodoList = (todos, title, icon) => `
                <div class="glass" style="padding: 1.5rem; border-radius: 20px; flex: 1; min-width: 300px;">
                    <h3 style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 8px; font-size: 1.1rem;"><i class="${icon}"></i> ${title}</h3>
                    <ul class="todo-list" style="margin: 0; padding: 0; list-style: none;">
                        ${todos.map(todo => `
                            <li class="todo-item" data-todo-id="${todo.id}" data-project-id="${todo.projectId}" style="display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-radius: 12px; background: rgba(255,255,255,0.03); margin-bottom: 8px; border: 1px solid rgba(255,255,255,0.05); transition: 0.2s; cursor: pointer; position: relative;" onmouseover="this.style.background='rgba(255,255,255,0.08)';" onmouseout="this.style.background='rgba(255,255,255,0.03)';">
                                <div class="todo-quick-check" data-id="${todo.id}" data-pid="${todo.projectId}" style="width: 20px; height: 20px; border: 2px solid var(--card-border); border-radius: 6px; display: flex; align-items: center; justify-content: center; background: transparent; flex-shrink: 0; cursor: pointer; transition: 0.2s;" onmouseover="this.style.borderColor='var(--primary)'; this.style.boxShadow='0 0 5px var(--primary)';" onmouseout="this.style.borderColor='var(--card-border)'; this.style.boxShadow='none';">
                                </div>
                                <div style="flex: 1; display: flex; align-items: center; gap: 12px; overflow: hidden; white-space: nowrap;">
                                    <span style="font-size: 0.85rem; font-weight: 500; flex-shrink: 0;"><strong style="color: var(--primary);">[${todo.companyName}]</strong> <span class="todo-project-link" style="color: var(--text-muted);">${todo.projectName}</span></span>
                                    <span style="color: var(--text-muted); font-size: 0.8rem; flex-shrink: 0;">-</span>
                                    <span style="font-size: 0.95rem; font-weight: 500; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex: 1;">${todo.text}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                                    <span style="font-size: 0.8rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 6px;"><i class="ph ph-calendar-blank"></i> ${todo.dueDate ? todo.dueDate.replace(/-/g, '.').slice(2) : '일정'}</span>
                                    <div style="display: flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 1.1rem; pointer-events: none;">
                                        <i class="ph ph-cursor-click"></i>
                                    </div>
                                    ${this.canDelete(todo) ? `<button data-delete-type="todo" data-parent-id="${todo.projectId}" data-id="${todo.id}" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'" onclick="event.stopPropagation()"><i class="ph ph-x"></i></button>` : ''}
                                </div>
                            </li>
                        `).join('')}
                        ${todos.length === 0 ? '<div style="text-align: center; padding: 2rem 0; color: var(--text-muted); font-size: 0.9rem;">할 일이 없습니다.</div>' : ''}
                    </ul>
                </div>
            `;

            const showAllTodos = this.currentUser.role === 'MASTER' || this.currentUser.role === 'STAFF';

            return `
                <div style="display: flex; flex-direction: column; gap: 1.5rem; align-items: stretch;">
                    ${renderTodoList(myTodos, '내가 할 일', 'ph ph-user-focus')}
                    ${renderTodoList(requestedTodos, '요청한 일', 'ph ph-paper-plane-tilt')}
                    ${showAllTodos ? (() => {
                        const groupedByCompany = filteredTodos.reduce((acc, t) => {
                            if(!acc[t.companyId]) acc[t.companyId] = [];
                            acc[t.companyId].push(t);
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
                                                    <li class="todo-item" data-todo-id="${todo.id}" data-project-id="${todo.projectId}" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; background: rgba(255,255,255,0.02); margin-bottom: 6px; border: 1px solid rgba(255,255,255,0.04); transition: 0.2s; cursor: pointer;" onmouseover="this.style.background='rgba(255,255,255,0.06)';" onmouseout="this.style.background='rgba(255,255,255,0.02)';">
                                                        <div class="todo-quick-check" data-id="${todo.id}" data-pid="${todo.projectId}" style="width: 18px; height: 18px; border: 2px solid var(--card-border); border-radius: 5px; flex-shrink: 0;"></div>
                                                        <div style="flex: 1; display: flex; align-items: center; gap: 10px; overflow: hidden; white-space: nowrap;">
                                                            <span style="font-size: 0.8rem; color: var(--text-muted); flex-shrink: 0; width: 120px; overflow: hidden; text-overflow: ellipsis;">${todo.projectName}</span>
                                                            <span style="font-size: 0.9rem; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis;">${todo.text}</span>
                                                        </div>
                                                        <span style="font-size: 0.75rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 3px 6px; border-radius: 4px;">${todo.dueDate ? todo.dueDate.slice(2) : '-'}</span>
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
        } else if (this.currentView === 'production_schedule') {
            const currentYear = this.timelineYear;
            const currentMonth = this.timelineMonth;
            const lastDay = new Date(currentYear, currentMonth, 0).getDate();
            
            const grouped = products.reduce((acc, p) => {
                const cid = p.companyId;
                if (!acc[cid]) acc[cid] = [];
                acc[cid].push(p);
                return acc;
            }, {});

            return `
                <div class="production-schedule-view" style="display: flex; flex-direction: column; gap: 2rem;">
                    <div class="glass" style="padding: 1.5rem 2rem; border-radius: 20px; display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <h2 style="display: flex; align-items: center; gap: 8px; margin: 0;"><i class="ph ph-chart-bar"></i> 생산 공정 타임라인</h2>
                            <div class="timeline-nav" style="display: flex; gap: 8px; align-items: center;">
                                <select id="timeline-year-select" class="glass" style="padding: 4px 8px; border-radius: 6px; background: rgba(255,255,255,0.05); color: white; border: 1px solid var(--card-border); font-size: 0.85rem;">
                                    ${Array.from({length: 10}, (_, i) => 2024 + i).map(year => `
                                        <option value="${year}" ${year === currentYear ? 'selected' : ''}>${year}년</option>
                                    `).join('')}
                                </select>
                                <select id="timeline-month-select" class="glass" style="padding: 4px 8px; border-radius: 6px; background: rgba(255,255,255,0.05); color: white; border: 1px solid var(--card-border); font-size: 0.85rem;">
                                    ${Array.from({length: 12}, (_, i) => i + 1).map(month => `
                                        <option value="${month}" ${month === currentMonth ? 'selected' : ''}>${month}월</option>
                                    `).join('')}
                                </select>
                            </div>
                        </div>
                    </div>

                    ${Object.keys(grouped).map(companyId => {
                        const company = mockData.companies.find(c => c.id === companyId);
                        const companyName = company ? company.name : companyId;
                        const brandColor = companyId === 'company_a' ? '#3b82f6' : (companyId === 'company_b' ? '#10b981' : 'var(--primary)');
                        const companyProjects = grouped[companyId];

                        return `
                            <div class="brand-timeline-block glass" style="border-radius: 16px; overflow: hidden; border-left: 4px solid ${brandColor}; margin-bottom: 2rem;">
                                <div style="background: rgba(255,255,255,0.03); padding: 12px 16px; border-bottom: 1px solid var(--card-border); display: flex; align-items: center; gap: 10px;">
                                    <i class="ph ph-buildings" style="color: ${brandColor};"></i>
                                    <h3 style="font-size: 1rem; color: white; margin: 0;">${companyName}</h3>
                                </div>
                                <div style="overflow-x: auto; position: relative;">
                                    <div class="timeline-grid" style="min-width: ${lastDay * 40 + 200}px; display: grid; grid-template-columns: 200px repeat(${lastDay}, 1fr);">
                                        <div style="background: rgba(0,0,0,0.2); height: 35px; border-bottom: 1px solid var(--card-border); position: sticky; left: 0; z-index: 20; display: flex; align-items: center; padding: 0 16px; font-size: 0.75rem; color: var(--text-muted);">프로젝트</div>
                                        <div style="display: grid; grid-template-columns: repeat(${lastDay}, 1fr); background: rgba(0,0,0,0.1); height: 35px; border-bottom: 1px solid var(--card-border); grid-column: 2 / span ${lastDay};">
                                            ${Array.from({length: lastDay}, (_, i) => `
                                                <div style="display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--text-muted); border-right: 1px solid rgba(255,255,255,0.03);">${i + 1}</div>
                                            `).join('')}
                                        </div>
                                        ${companyProjects.map(p => {
                                            return `
                                                <div style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.05); border-right: 1px solid var(--card-border); font-size: 0.85rem; position: sticky; left: 0; z-index: 10; background: #1e293b; color: white; font-weight: 600;">${p.name}</div>
                                                <div style="grid-column: 2 / span ${lastDay}; position: relative; border-bottom: 1px solid rgba(255,255,255,0.05); height: 65px; background: repeating-linear-gradient(90deg, transparent, transparent 38px, rgba(255,255,255,0.02) 38px, rgba(255,255,255,0.02) 40px);">
                                                    ${(() => {
                                                        const events = [];
                                                        
                                                        // 1. stagesData 기반 이벤트 수집
                                                        STAGES.forEach(stage => {
                                                            const data = p.stagesData && p.stagesData[stage.id];
                                                            if (data && data.dueDate) {
                                                                const normalizedDate = data.dueDate.replace(/-/g, '.');
                                                                const parts = normalizedDate.split('.');
                                                                if (parts.length === 3 && parseInt(parts[0]) === currentYear && parseInt(parts[1]) === currentMonth) {
                                                                    events.push({ stage, ...data, day: parseInt(parts[2]) });
                                                                }
                                                            }
                                                        });

                                                        // 2. schedules 기반 추가 이벤트 (중복 제외)
                                                        const productSchedules = (mockData.schedules || []).filter(s => s.productId === p.id);
                                                        productSchedules.forEach(s => {
                                                            const stage = STAGES.find(st => st.id === s.stage);
                                                            if (stage && !events.some(e => e.stage.id === stage.id)) {
                                                                const date = s.end || s.start;
                                                                const normalizedDate = date.replace(/-/g, '.');
                                                                const parts = normalizedDate.split('.');
                                                                if (parts.length === 3 && parseInt(parts[0]) === currentYear && parseInt(parts[1]) === currentMonth) {
                                                                    events.push({ 
                                                                        stage, 
                                                                        status: 'processing', 
                                                                        dueDate: date, 
                                                                        day: parseInt(parts[2]),
                                                                        title: s.title
                                                                    });
                                                                }
                                                            }
                                                        });

                                                        return events.map(ev => {
                                                            const isCompleted = ev.status === 'completed';
                                                            const inProgress = ev.status === 'processing' || ev.status === 'progress';
                                                            let bgColor = isCompleted ? '#3b82f6' : (inProgress ? '#f59e0b' : '#64748b');
                                                            return `
                                                                <div style="position: absolute; left: ${(ev.day - 0.5) * 100 / lastDay}%; top: 52%; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 4px; z-index: 5;">
                                                                    <div style="width: 22px; height: 22px; background: ${bgColor}; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"
                                                                         title="${ev.stage.label}: ${ev.title || ev.note || ''} (${ev.dueDate})"
                                                                         onclick="app.openStageSidebar('${p.id}', '${ev.stage.id}')">
                                                                        <span style="font-size: 0.65rem; color: white;">${isCompleted ? '✓' : ''}</span>
                                                                    </div>
                                                                    <span style="font-size: 0.6rem; color: #a1a1aa; white-space: nowrap; font-weight: 500;">${ev.stage.label}</span>
                                                                </div>
                                                            `;
                                                        }).join('');
                                                    })()}
                                                </div>
                                            `;
                                        }).join('')}
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    
                    <div class="timeline-legend" style="margin-top: 2rem; display: flex; flex-wrap: wrap; gap: 15px; font-size: 0.8rem; color: var(--text-muted);">
                        ${STAGES.map(s => `
                            <div style="display: flex; align-items: center; gap: 5px;">
                                <span class="legend-color stage-${s.id}" style="width: 12px; height: 12px; border-radius: 3px; display: inline-block;"></span>
                                ${s.label}
                            </div>
                        `).join('')}
                    </div>
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
                    aggregatedDocs.push({
                        id: `auto-photo-${p.id}-${idx}`,
                        date: p.history[0]?.date || '2024.03.01',
                        name: `${p.name} 제작 사진 ${idx + 1}`,
                        category: '참고이미지',
                        productId: p.id,
                        memo: '프로젝트 상세에서 등록된 사진'
                    });
                });
                
                // 프로젝트별 문서 -> 기존 카테고리 유지 혹은 기본값
                (p.documents || []).forEach((doc, idx) => {
                    aggregatedDocs.push({
                        id: `auto-doc-${p.id}-${idx}`,
                        date: doc.date,
                        name: doc.name,
                        category: doc.category || '기타자료',
                        productId: p.id,
                        memo: '프로젝트 내 관련 문서'
                    });
                });
            });

            let filteredDocs = aggregatedDocs;
            if (this.selectedDocCategory !== '전체') {
                filteredDocs = aggregatedDocs.filter(d => d.category === this.selectedDocCategory);
            }

            return `
                <div class="glass" style="padding: 2rem; border-radius: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <h2 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-folder-open"></i> 통합 문서 관리</h2>
                            ${(role === 'MASTER' || role === 'STAFF') ? `
                                <select id="doc-global-company-filter" class="glass" style="padding: 6px 10px; border-radius: 8px; border: 1px solid var(--card-border); background: rgba(255,255,255,0.05); color: white; cursor: pointer; font-size: 0.85rem;">
                                    <option value="all" ${this.selectedCompanyId === 'all' ? 'selected' : ''}>전체 브랜드 보기</option>
                                    ${mockData.companies.filter(c => c.role === 'CLIENT').map(c => `
                                        <option value="${c.id}" ${this.selectedCompanyId === c.id ? 'selected' : ''}>${c.name}</option>
                                    `).join('')}
                                </select>
                            ` : ''}
                        </div>
                        <div class="category-filters" style="display: flex; gap: 8px;">
                            ${categories.map(cat => `
                                <button class="filter-btn glass ${this.selectedDocCategory === cat ? 'active' : ''}" 
                                        data-cat="${cat}" 
                                        style="padding: 6px 14px; border-radius: 20px; font-size: 0.8rem; cursor: pointer; transition: 0.3s;
                                               background: ${this.selectedDocCategory === cat ? 'var(--primary)' : 'rgba(255,255,255,0.05)'};">
                                    ${cat}
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    
                    <div class="table-container fade-in">
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
                                    const company = product ? mockData.companies.find(c => c.id === product.companyId) : null;
                                    return `
                                        <tr class="table-row doc-row" style="border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem; cursor: pointer;" data-product-id="${doc.productId || ''}">
                                            <td style="padding: 12px; color: var(--text-muted);">${doc.date || '-'}</td>
                                            <td style="padding: 12px;">${company ? company.name : '-'}</td>
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
                                                    ${this.canDelete(doc) ? `<button data-delete-type="document" data-parent-id="${doc.productId || ''}" data-id="${doc.id}" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'" onclick="event.stopPropagation()"><i class="ph ph-x"></i></button>` : ''}
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).reverse().join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        } else if (this.currentView === 'detail') {
            const product = mockData.products.find(p => p.id === this.activeProjectId);
            const company = mockData.companies.find(c => c.id === product.companyId);
            
            const progressPercent = getProgress(product);

            return `
                <div class="detail-view fade-in">
                    <div class="detail-header" style="padding: 1rem 0; margin-bottom: 2rem;">
                        <div style="margin-bottom: 2rem;">
                            <h1 style="font-size: 1.5rem; margin-bottom: 1rem; display: flex; align-items: center; gap: 12px;"><i class="ph ph-factory" style="color: var(--primary);"></i> 실시간 생산 공정률</h1>
                            <div style="width: 100%; height: 12px; background: rgba(0,0,0,0.3); border-radius: 6px; overflow: hidden; margin-bottom: 1.5rem; box-shadow: inset 0 1px 3px rgba(0,0,0,0.5);">
                                <div style="width: ${progressPercent}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); transition: width 0.5s ease; border-radius: 6px;"></div>
                            </div>
                            <div class="progress-checklist" style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 10px;">
                                ${STAGES.map((stage, idx) => {
                                    const stageData = (product.stagesData && (product.stagesData[stage.id] || product.stagesData[stage.docType])) 
                                        ? (product.stagesData[stage.id] || product.stagesData[stage.docType]) 
                                        : { status: (product.documents.some(doc => doc.type === stage.docType) ? 'completed' : 'before'), dueDate: '', note: '' };
                                    const isCompleted = isStageCompleted(product, stage);
                                    const inProgress = stageData.status === 'progress' || stageData.status === 'processing';
                                    
                                    let iconColor = isCompleted ? 'var(--primary)' : (inProgress ? '#f59e0b' : 'var(--text-muted)');
                                    let bg = isCompleted ? 'rgba(37, 99, 235, 0.1)' : (inProgress ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.02)');
                                    let border = isCompleted ? 'var(--primary)' : (inProgress ? '#f59e0b' : 'rgba(255,255,255,0.05)');
                                    let filter = (isCompleted || inProgress) ? 'none' : 'grayscale(100%) opacity(0.5)';

                                    return `
                                        <div style="flex: 1; min-width: 100px; display: flex; flex-direction: column; gap: 8px;">
                                            <div class="check-item stage-item-trigger" data-type="${stage.docType}" style="display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 12px 5px; border-radius: 12px; background: ${bg}; border: 1px solid ${border}; transition: 0.3s; position: relative; cursor: pointer;" onmouseover="this.style.filter='brightness(1.2)';" onmouseout="this.style.filter='none';">
                                                <div style="font-size: 1.2rem; color: ${iconColor}; filter: ${filter}; transition: 0.3s;">
                                                    ${stage.icon}
                                                </div>
                                                <div style="font-size: 0.8rem; font-weight: 700; color: ${(isCompleted || inProgress) ? 'var(--text-main)' : 'var(--text-muted)'}; transition: 0.3s; text-align: center;">${stage.label}</div>
                                                <div style="font-size: 0.65rem; color: var(--text-muted); min-height: 14px; line-height: 14px;">${stageData.dueDate ? stageData.dueDate.slice(2) : '&nbsp;'}</div>
                                                ${isCompleted ? `
                                                    <div style="position: absolute; top: -5px; right: -5px; width: 16px; height: 16px; background: var(--accent-danger, #ef4444); border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 5px rgba(239, 68, 68, 0.5);">
                                                        <i class="ph ph-check" style="color: white; font-size: 0.6rem;"></i>
                                                    </div>
                                                ` : ''}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    </div>

                    <div class="detail-grid">
                        <div class="notepad-card glass" style="display: flex; flex-direction: column;">
                            <h3 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-chats-circle"></i> 대화형 메모장</h3>
                            <div class="notepad-content" style="flex: 1; display: flex; flex-direction: column; background: rgba(255,255,255,0.02); border-radius: 12px; padding: 10px; overflow: hidden; height: 300px;">
                                <div id="memo-feed" style="flex: 1; overflow-y: auto; padding-right: 5px; margin-bottom: 10px; display: flex; flex-direction: column; gap: 10px;">
                                    ${(product.memos || (product.notes ? [{id:0, text: product.notes, author: '시스템', date: ''}] : [])).map(m => `
                                        <div style="display: flex; flex-direction: column; align-items: ${m.author === this.currentUser.name ? 'flex-end' : 'flex-start'};">
                                            <div style="font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">${m.author} ${m.date ? `· ${m.date}` : ''}</div>
                                            <div style="display: flex; align-items: center; gap: 6px;">
                                                ${m.author === this.currentUser.name && this.canDelete(m) ? `<button data-delete-type="memo" data-parent-id="${product.id}" data-id="${m.id}" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; padding: 0;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                                <div style="background: ${m.author === this.currentUser.name ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}; color: white; padding: 8px 12px; border-radius: 12px; font-size: 0.9rem; max-width: 80%; word-break: break-all; white-space: pre-wrap;">${m.text}</div>
                                                ${m.author !== this.currentUser.name && this.canDelete(m) ? `<button data-delete-type="memo" data-parent-id="${product.id}" data-id="${m.id}" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s; padding: 0;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'"><i class="ph ph-x"></i></button>` : ''}
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                                <div style="display: flex; gap: 8px; align-items:flex-end;">
                                    <textarea id="new-memo-input" placeholder="메모나 피드백을 남겨주세요..." style="flex: 1; height: 40px; min-height: 40px; max-height: 80px; background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); color: white; border-radius: 8px; padding: 8px 12px; resize: none; font-size: 0.9rem;" onkeydown="if(event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.getElementById('add-memo-btn').click(); }"></textarea>
                                    <button id="add-memo-btn" class="btn-primary" style="padding: 0 16px; height: 40px; border-radius: 8px;"><i class="ph ph-paper-plane-right"></i></button>
                                </div>
                            </div>
                        </div>

                        <div class="notepad-card glass">
                            <h3 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-check-square"></i> 상세 할 일 목록</h3>
                            <div class="notepad-content">
                                <ul class="todo-list">
                                    ${(product.todos || []).map(todo => `
                                        <li class="todo-item ${todo.completed ? 'completed' : ''}" data-todo-id="${todo.id}" style="display: flex; align-items: center; gap: 10px; cursor: pointer; transition: 0.2s; position: relative;" onmouseover="this.style.background='rgba(255,255,255,0.05)';" onmouseout="this.style.background='transparent';">
                                            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start; min-width: 90px;">
                                                <select class="todo-assignee-select glass" data-id="${todo.id}" style="padding: 2px 4px; border-radius: 4px; font-size: 0.7rem; background: rgba(0,0,0,0.2); color: white; border: 1px solid var(--card-border); width: 100px;" onclick="event.stopPropagation()">
                                                    <option value="">담당자 지정</option>
                                                    ${mockData.companies.filter(c => c.role === 'MASTER' || c.role === 'STAFF' || c.id === product.companyId).map(c => `
                                                        <option value="${c.id}" ${todo.assignee === c.id ? 'selected' : ''}>${c.name}</option>
                                                    `).join('')}
                                                </select>
                                                <div style="font-size: 0.7rem; color: var(--text-muted); border: 1px solid var(--card-border); border-radius: 4px; padding: 2px 6px; background: rgba(0,0,0,0.2); cursor: pointer; display: flex; align-items: center; gap: 4px; position: relative; width: 100px; box-sizing: border-box;" onclick="event.stopPropagation(); this.querySelector('input').showPicker();">
                                                    <i class="ph ph-calendar-blank"></i> <span class="date-display-${todo.id}">${todo.dueDate ? todo.dueDate.replace(/-/g, '.').slice(2) : '일정'}</span>
                                                    <input type="date" class="todo-date-input" data-id="${todo.id}" value="${todo.dueDate ? todo.dueDate.replace(/\./g, '-') : ''}" max="2099-12-31" style="position: absolute; opacity: 0; width: 1px; height: 1px; top: 0; left: 0; border: none; padding: 0;">
                                                </div>
                                            </div>
                                            <input type="checkbox" class="todo-checkbox-left" ${todo.completed ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer; flex-shrink: 0; margin-left: 5px;">
                                            <span class="todo-text" style="flex: 1; font-weight: 500;">${todo.text}</span>
                                            <div style="color: var(--text-muted); font-size: 1.1rem; pointer-events: none;">
                                                <i class="ph ph-cursor-click"></i>
                                            </div>
                                            ${this.canDelete(todo) ? `<button data-delete-type="todo" data-parent-id="${product.id}" data-id="${todo.id}" style="width: 20px; height: 20px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-muted); font-size: 0.85rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.color='white'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'; this.style.color='var(--text-muted)'; this.style.borderColor='rgba(255,255,255,0.1)'" onclick="event.stopPropagation()"><i class="ph ph-x"></i></button>` : ''}
                                        </li>
                                    `).join('')}
                                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                                        <div class="todo-item" id="add-todo-trigger" style="flex: 1; background: transparent; border: 1px dashed var(--card-border); cursor: pointer; justify-content: center; transition: 0.2s;" onmouseover="this.style.borderColor='var(--primary)'; this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--card-border)'; this.style.color='var(--text-muted)'">
                                            <span class="todo-text" style="color: inherit; text-align: center; width: 100%;">+ 할 일 추가</span>
                                        </div>
                                        <div class="todo-item" id="request-todo-trigger" style="flex: 1; background: transparent; border: 1px dashed var(--card-border); cursor: pointer; justify-content: center; transition: 0.2s;" onmouseover="this.style.borderColor='var(--primary)'; this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--card-border)'; this.style.color='var(--text-muted)'">
                                            <span class="todo-text" style="color: inherit; text-align: center; width: 100%;">+ 업무 요청</span>
                                        </div>
                                    </div>
                                </ul>
                            </div>
                        </div>

                        <div class="bottom-panels" style="grid-column: span 2; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                            <div class="notepad-card glass">
                                <h3 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-image"></i> 사진</h3>
                                <div class="notepad-content">
                                    <div class="photo-grid">
                                        ${(product.photos || []).map(photo => {
                                            const photoObj = typeof photo === 'string' ? {url: photo} : photo;
                                            return `
                                            <div class="photo-item" style="position: relative;">
                                                <img src="${photoObj.url}" alt="제작 사진">
                                                ${this.canDelete(photoObj) ? `<button data-delete-type="photo" data-parent-id="${product.id}" data-id="${photoObj.url}" style="position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; border-radius: 4px; background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.2); color: white; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 10; transition: 0.2s;" onmouseover="this.style.background='rgba(239,68,68,0.8)'; this.style.borderColor='rgba(239,68,68,1)'" onmouseout="this.style.background='rgba(0,0,0,0.5)'; this.style.borderColor='rgba(255,255,255,0.2)'"><i class="ph ph-x"></i></button>` : ''}
                                            </div>
                                        `}).join('')}
                                        <div class="add-photo-btn" id="add-photo-btn">
                                            <span>+</span>
                                            <span style="font-size: 0.7rem;">사진 추가</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div class="history-card glass" style="padding: 1.5rem;">
                                <h3 style="margin-bottom: 1rem; font-size: 1.1rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px;"><i class="ph ph-clock"></i> 타임라인 (활동 기록)</h3>
                                <ul class="history-list" style="max-height: 250px; overflow-y: auto; padding-right: 10px;">
                                    ${product.history.map(item => `
                                        <li style="display: flex; gap: 12px; margin-bottom: 1rem;">
                                            <span class="dot" style="width: 8px; height: 8px; background: var(--primary); border-radius: 50%; margin-top: 6px; flex-shrink: 0;"></span>
                                            <div class="hist-content">
                                                <span class="hist-stage" style="display: block; font-size: 0.9rem; font-weight: 500;">${item.action || (STAGES.find(s => s.id === item.stage)?.label + ' 완료')} <span style="font-size: 0.75rem; color: var(--primary); font-weight: 400; margin-left: 5px;">${item.user || ''}</span></span>
                                                <span class="hist-date" style="display: block; font-size: 0.8rem; color: var(--text-muted);">${item.date}</span>
                                            </div>
                                        </li>
                                    `).reverse().join('')}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (this.currentView === 'user_management') {
            return `
                <div class="glass" style="padding: 2rem; border-radius: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
                        <h2 style="display: flex; align-items: center; gap: 8px;"><i class="ph ph-shield-check"></i> 권한 관리 및 계정</h2>
                        <button class="btn-primary" style="padding: 0.5rem 1rem; font-size: 0.8rem;">+ 계정 추가</button>
                    </div>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="text-align: left; border-bottom: 1px solid var(--card-border); color: var(--text-muted); font-size: 0.8rem;">
                                <th style="padding: 1rem;">사용자/기업</th>
                                <th style="padding: 1rem;">ID</th>
                                <th style="padding: 1rem;">비밀번호</th>
                                <th style="padding: 1rem;">권한</th>
                                <th style="padding: 1rem;">상태</th>
                                <th style="padding: 1rem; text-align: center;">관리</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${mockData.companies.map(c => `
                                <tr style="border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.85rem;">
                                    <td style="padding: 1rem; font-weight: 500;">${c.name}</td>
                                    <td style="padding: 1rem; color: var(--text-muted);">${c.username}</td>
                                    <td style="padding: 1rem; color: var(--text-muted);">
                                        <div style="display: flex; align-items: center; gap: 6px;">
                                            <input type="password" value="${c.password}" readonly style="background: transparent; border: none; color: var(--text-muted); width: 60px;" class="pw-input-${c.id}">
                                            <i class="ph ph-eye pw-toggle" data-id="${c.id}" style="cursor: pointer;"></i>
                                        </div>
                                    </td>
                                    <td style="padding: 1rem;">
                                        <span style="background: ${c.role === 'MASTER' ? 'rgba(37,99,235,0.2)' : (c.role === 'STAFF' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.05)')}; 
                                              color: ${c.role === 'MASTER' ? 'var(--primary)' : (c.role === 'STAFF' ? '#10b981' : '#ccc')}; 
                                              padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700;">
                                            ${c.role}
                                        </span>
                                    </td>
                                    <td style="padding: 1rem; color: #10b981;">● Online</td>
                                    <td style="padding: 1rem; text-align: center;">
                                        <button class="btn-secondary" style="padding: 4px 10px; font-size: 0.75rem; border-radius: 6px;" onclick="alert('${c.name} 계정 정보를 수정합니다.')">수정</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }
    }

    bindDashboardEvents() {
        const viewGridBtn = document.getElementById('view-grid-btn');
        if (viewGridBtn) viewGridBtn.addEventListener('click', () => { this.dashboardViewType = 'grid'; this.render(); });
        const viewTableBtn = document.getElementById('view-table-btn');
        if (viewTableBtn) viewTableBtn.addEventListener('click', () => { this.dashboardViewType = 'table'; this.render(); });

        const toggleBtn = document.getElementById('toggle-completed-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                this.completedExpanded = !this.completedExpanded;
                this.render();
            });
        }
        
        const scheduledToggleBtn = document.getElementById('toggle-scheduled-btn');
        if (scheduledToggleBtn) {
            scheduledToggleBtn.addEventListener('click', () => {
                this.scheduledExpanded = this.scheduledExpanded === false ? true : false;
                this.render();
            });
        }
    }

    bindAllTodosEvents() {
        this.appContainer.querySelectorAll('.todo-project-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.stopPropagation();
                const projectId = e.target.closest('.todo-item').getAttribute('data-project-id');
                this.setState({ currentView: 'detail', activeProjectId: projectId });
            });
        });

        // 체크 버튼 클릭
        this.appContainer.querySelectorAll('.todo-quick-check').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const todoId = parseInt(e.currentTarget.getAttribute('data-id'));
                const pid = e.currentTarget.getAttribute('data-pid');
                const project = mockData.products.find(p => p.id === pid);
                if (project && project.todos) {
                    const todo = project.todos.find(t => t.id === todoId);
                    if (todo) {
                        if (confirm('정말 완료 처리하시겠습니까? 완료 시 목록에서 숨겨집니다.')) {
                            todo.completed = !todo.completed;
                            this.showToast('할 일이 완료 처리되었습니다.');
                            this.render();
                        }
                    }
                }
            });
        });

        // 팝업 모달 클릭
        this.appContainer.querySelectorAll('.todo-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const todoId = parseInt(item.getAttribute('data-todo-id'));
                const pid = item.getAttribute('data-project-id');
                this.openTodoModal(pid, todoId);
            });
        });
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

        // Chat Memo Add
        const memoBtn = document.getElementById('add-memo-btn');
        const memoInput = document.getElementById('new-memo-input');
        if (memoBtn && memoInput) {
            memoBtn.addEventListener('click', () => {
                const text = memoInput.value.trim();
                if (!text) return;

                if (!product.memos) {
                    product.memos = product.notes ? [{id:0, text: product.notes, author: '시스템', date: ''}] : [];
                }

                const now = new Date();
                const timeStr = `${now.getMonth()+1}/${now.getDate()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

                product.memos.push({
                    id: Date.now(),
                    text: text,
                    author: this.currentUser.name,
                    date: timeStr,
                    createdBy: this.currentUser.id
                });

                product.history.push({
                    action: '메모 추가',
                    date: now.toISOString().split('T')[0].replace(/-/g, '.'),
                    user: this.currentUser.name
                });

                this.render();
                // 렌더링 후 스크롤 아래로 고정
                setTimeout(() => {
                    const feed = document.getElementById('memo-feed');
                    if(feed) feed.scrollTop = feed.scrollHeight;
                }, 10);
            });
        }

        this.appContainer.querySelectorAll('.todo-item input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const todoItem = e.target.closest('.todo-item');
                const todoId = parseInt(todoItem.getAttribute('data-todo-id'));
                const todo = product.todos.find(t => t.id === todoId);
                if (todo) {
                    todo.completed = e.target.checked;
                    todoItem.classList.toggle('completed', todo.completed);
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
                const todoId = parseInt(item.getAttribute('data-todo-id'));
                this.openTodoModal(this.activeProjectId, todoId);
            });
        });

        this.appContainer.querySelectorAll('.todo-assignee-select').forEach(select => {
            select.addEventListener('change', (e) => {
                const todoId = parseInt(e.target.getAttribute('data-id'));
                const todo = product.todos.find(t => t.id === todoId);
                if (todo) {
                    const assigneeId = e.target.value;
                    todo.assignee = assigneeId;
                    if (assigneeId) {
                        const companyName = mockData.companies.find(c => c.id === assigneeId)?.name || '담당자';
                        this.showToast(`${companyName}님에게 업무가 할당되었습니다.`);
                    }
                }
            });
        });

        this.appContainer.querySelectorAll('.todo-date-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const todoId = parseInt(e.target.getAttribute('data-id'));
                const todo = product.todos.find(t => t.id === todoId);
                if (todo) {
                    const val = e.target.value;
                    todo.dueDate = val ? val.replace(/-/g, '.') : '';
                }
            });
        });

        const handleNewTodoProcess = (isRequest) => {
            const triggerElement = document.getElementById('add-todo-trigger');
            if(!triggerElement) return;
            const triggerContainer = triggerElement.parentElement;
            const parent = triggerContainer.parentElement;
            const inputWrapper = document.createElement('li');
            inputWrapper.className = 'todo-item';
            inputWrapper.style.border = '1px solid var(--primary)';
            inputWrapper.innerHTML = `
                <input type="text" id="new-todo-input" class="login-input" style="padding: 0.5rem; margin: 0; flex: 1; height: 30px; font-size: 0.9rem;" placeholder="${isRequest ? '요청할 내용을 입력 후 Enter' : '할 일을 입력 후 Enter'}">
            `;
            parent.insertBefore(inputWrapper, triggerContainer);
            triggerContainer.style.display = 'none';
            
            const input = document.getElementById('new-todo-input');
            input.focus();
            
            const handleAdd = () => {
                const text = input.value.trim();
                if (text) {
                    const newId = product.todos.length > 0 ? Math.max(...product.todos.map(t => t.id)) + 1 : 1;
                    product.todos.push({ 
                        id: newId, 
                        text: text, 
                        completed: false, 
                        assignee: isRequest ? '' : this.currentUser.id,
                        dueDate: '',
                        createdBy: this.currentUser.id 
                    });
                    this.render();
                    if(isRequest) this.showToast('요청이 추가되었습니다. 우측 드롭다운에서 담당자를 지정해주세요.');
                } else {
                    this.render();
                }
            };

            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') handleAdd();
            });

            input.addEventListener('blur', () => {
               if (!input.value.trim()) this.render();
            });
        };

        const addTodoBtn = document.getElementById('add-todo-trigger');
        if (addTodoBtn) addTodoBtn.addEventListener('click', () => handleNewTodoProcess(false));
        const requestTodoBtn = document.getElementById('request-todo-trigger');
        if (requestTodoBtn) requestTodoBtn.addEventListener('click', () => handleNewTodoProcess(true));

        this.appContainer.querySelectorAll('.stage-quick-upload-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const type = e.target.getAttribute('data-type');
                const stage = STAGES.find(s => s.docType === type);
                
                const modal = document.getElementById('modal-container');
                modal.style.display = 'flex';
                modal.innerHTML = `
                    <div class="glass modal-content fade-in" style="width: 400px; padding: 2.5rem; border-radius: 30px;">
                        <h2 style="margin-bottom: 2rem; display: flex; align-items: center; gap: 8px; font-size: 1.3rem;">${stage.icon} ${stage.label} 공정 업로드</h2>
                        <div class="login-field" style="margin-top: 1rem;">
                            <label>파일명</label>
                            <input type="text" id="upload-doc-name" class="login-input" placeholder="예: [${stage.label}] 업로드 파일명">
                        </div>
                        <div style="display: flex; gap: 1rem; margin-top: 2.5rem;">
                            <button id="upload-cancel" class="btn-secondary" style="flex: 1; padding: 1rem; border-radius: 12px; border: 1px solid var(--card-border);">취소</button>
                            <button id="upload-save" class="btn-primary" style="flex: 1; padding: 1rem; border-radius: 12px;">업로드 및 상태 갱신</button>
                        </div>
                    </div>
                `;

                document.getElementById('upload-cancel').onclick = () => { modal.style.display = 'none'; };
                document.getElementById('upload-save').onclick = () => {
                    const name = document.getElementById('upload-doc-name').value;
                    if (!name) return alert('파일명을 입력해주세요.');

                    const now = new Date().toISOString().split('T')[0].replace(/-/g, '.');
                    
                    product.documents.push({
                        name: name,
                        type: type,
                        date: now
                    });

                    product.history.push({
                        stage: stage.id,
                        date: now,
                        user: this.currentUser.name
                    });

                    product.currentStage = stage.id;

                    modal.style.display = 'none';
                    this.showToast(`${stage.label} 공정 완료 처리되었습니다.`);
                    this.render();
                };
            });
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new BhasApp();
});
