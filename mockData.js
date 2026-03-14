var STAGES = [
    { id: 'consulting', label: '상담', icon: '<i class="ph ph-phone"></i>', docType: 'consulting_log' },
    { id: 'contract', label: '계약', icon: '<i class="ph ph-file-text"></i>', docType: 'contract_estimate' },
    { id: 'fabric', label: '원단', icon: '<i class="ph ph-swatches"></i>', docType: 'fabric_info' },
    { id: 'pattern', label: '패턴', icon: '<i class="ph ph-ruler"></i>', docType: 'pattern_doc' },
    { id: 'sewing', label: '봉제', icon: '<i class="ph ph-needle"></i>', docType: 'sewing_doc' },
    { id: 'detail', label: '디테일', icon: '<i class="ph ph-sparkle"></i>', docType: 'detail_doc' },
    { id: 'tax', label: '세금계산서', icon: '<i class="ph ph-calculator"></i>', docType: 'tax_invoice' },
    { id: 'shipping', label: '출고', icon: '<i class="ph ph-truck"></i>', docType: 'shipping_info' }
];

var mockData = {
    companies: [
        { id: 'bhas', name: '브하스 (BHAS)', role: 'MASTER', username: 'admin', password: '1234' },
        { id: 'staff_1', name: '김철수 팀장', role: 'STAFF', username: 'staff1', password: '1111' },
        { id: 'company_a', name: 'A 패션', role: 'CLIENT', username: 'user_a', password: '1111' },
        { id: 'company_b', name: 'B 스타일', role: 'CLIENT', username: 'user_b', password: '2222' }
    ],
    // 권한 정의
    permissions: {
        MASTER: ['dashboard', 'production_schedule', 'documents', 'user_management', 'detail'],
        STAFF: ['dashboard', 'production_schedule', 'detail'],
        CLIENT: ['dashboard', 'detail']
    },
    // 생산 일정 데이터 샘플 (간트 차트 시각화용 공정 데이터 보강)
    schedules: [
        { id: 1, productId: 'p1', stage: 'pattern', start: '2026.03.12', end: '2026.03.18', title: '청바지 패턴 수정' },
        { id: 2, productId: 'p1', stage: 'sewing', start: '2026.03.19', end: '2026.03.25', title: '청바지 메인 봉제' },
        { id: 3, productId: 'p2', stage: 'consulting', start: '2026.03.10', end: '2026.03.15', title: '셔츠 원단 상담' },
        { id: 4, productId: 'p3', stage: 'shipping', start: '2026.03.05', end: '2026.03.08', title: '트렌치 코트 출고 검수' }
    ],
    products: [
        {
            id: 'p1',
            companyId: 'company_a',
            name: 'OOO 청바지',
            currentStage: 'pattern',
            deadline: '2026.03.25',
            notes: '워싱 느낌 강조 요청. YKK 지퍼 사용 필수.',
            createdBy: 'bhas',
            todos: [
                { id: 1, text: '원단 샘플 확인', completed: true, assignee: 'staff_1', dueDate: '2026.03.15', createdBy: 'bhas' },
                { id: 2, text: '패턴 수정본 컨펌', completed: false, assignee: 'bhas', dueDate: '2026.03.18', createdBy: 'company_a' },
                { id: 3, text: '지퍼 부자재 발주', completed: false, assignee: 'staff_1', dueDate: '2026.03.20', createdBy: 'staff_1' }
            ],
            photos: [
                { url: 'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=300&q=80', createdBy: 'bhas' },
                { url: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=300&q=80', createdBy: 'staff_1' }
            ],
            documents: [],
            history: [
                { stage: 'consulting', date: '2026.03.01', user: '브하스 팀' },
                { stage: 'contract', date: '2026.03.03', user: '브하스 팀' },
                { stage: 'fabric', date: '2026.03.10', user: '브하스 팀' }
            ]
        },
        {
            id: 'p2',
            companyId: 'company_b',
            name: '데일리 셔츠',
            currentStage: 'consulting',
            deadline: '2026.03.18',
            notes: '실크 혼방 원단 선호. 광택감이 적은 것으로 샘플 요청함.',
            createdBy: 'staff_1',
            todos: [
                { id: 1, text: '원단 업체 미팅', completed: false, assignee: 'staff_1', dueDate: '2026.03.12', createdBy: 'staff_1' }
            ],
            photos: [],
            documents: [],
            history: []
        },
        {
            id: 'p3',
            companyId: 'company_a',
            name: '가을 트렌치 코트',
            currentStage: 'shipping',
            deadline: '2026.03.08',
            notes: '최종 검수 완료. 안감 로고 각인 확인됨.',
            createdBy: 'company_a',
            todos: [
                { id: 1, text: '최종 검수', completed: true, assignee: 'bhas', dueDate: '2026.03.05', createdBy: 'bhas' },
                { id: 2, text: '패킹 및 출고', completed: true, assignee: 'staff_1', dueDate: '2026.03.08', createdBy: 'bhas' }
            ],
            photos: [
                { url: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=300&q=80', createdBy: 'company_a' }
            ],
            documents: [],
            history: [
                { stage: 'consulting', date: '2026.02.15' },
                { stage: 'contract', date: '2026.02.17' },
                { stage: 'fabric', date: '2026.02.20' },
                { stage: 'pattern', date: '2026.02.25' },
                { stage: 'sewing', date: '2026.03.01' },
                { stage: 'detail', date: '2026.03.05' },
                { stage: 'shipping', date: '2026.03.08' }
            ]
        }
    ],
    // 통합 문서 관리 데이터 (사용자 요청 카테고리로 업데이트)
    globalDocuments: [
        { id: 1, date: '2026.03.01', name: '청바지 메인 작업지시서', category: '작업지시서', productId: 'p1', memo: '포켓 디테일 수정본 반영됨', createdBy: 'bhas' },
        { id: 2, date: '2026.03.05', name: '3월 1차 디자인 회의록', category: '회의록', productId: 'p1', memo: '단추 자재 변경 논의', createdBy: 'company_a' },
        { id: 3, date: '2026.03.02', name: '트렌치 코트 샘플 이미지', category: '참고이미지', productId: 'p3', memo: '영국 클래식 스타일 참조', createdBy: 'staff_1' },
        { id: 4, date: '2026.03.10', name: '원단 수입 관세 영수증', category: '기타자료', productId: 'p1', memo: '통관 완료 서류', createdBy: 'bhas' },
        { id: 5, date: '2026.03.08', name: '3월분 전자세금계산서', category: '세금계산서', productId: 'p3', memo: '잔금 처리 완료', createdBy: 'company_a' },
        { id: 6, date: '2026.03.12', name: '셔츠 원단 상담 일지', category: '회의록', productId: 'p2', memo: '실크 혼방율 30%로 조정', createdBy: 'staff_1' }
    ]
};
