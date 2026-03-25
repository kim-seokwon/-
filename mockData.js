export const STAGES = [
    { id: 'consulting', label: '상담', icon: '<i class="ph ph-phone"></i>', docType: 'consulting_log' },
    { id: 'contract', label: '계약', icon: '<i class="ph ph-file-text"></i>', docType: 'contract_estimate' },
    { id: 'fabric', label: '원단', icon: '<i class="ph ph-swatches"></i>', docType: 'fabric_info' },
    { id: 'pattern', label: '패턴', icon: '<i class="ph ph-ruler"></i>', docType: 'pattern_doc' },
    { id: 'sewing', label: '봉제', icon: '<i class="ph ph-needle"></i>', docType: 'sewing_doc' },
    { id: 'detail', label: '디테일', icon: '<i class="ph ph-sparkle"></i>', docType: 'detail_doc' },
    { id: 'tax', label: '세금계산서', icon: '<i class="ph ph-calculator"></i>', docType: 'tax_invoice' },
    { id: 'shipping', label: '출고', icon: '<i class="ph ph-truck"></i>', docType: 'shipping_info' }
];

export const mockData = {
    brands: [
        { id: '9def20d6-5c05-48bb-89f6-21d6c32a948f', name: '브랜드 알파', brand_color: '#3b82f6' },
        { id: '9d51fbc4-97ef-448f-a8a4-203775ecdf1c', name: '브랜드 베타', brand_color: '#10b981' }
    ],
    companies: [
        { id: 'f93868d6-10ee-40da-837a-965bb42f4e81', name: '브하스 (BHAS)', role: 'MASTER', username: 'admin', password: '1234' },
        { id: '1b2a3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', name: '김철수 팀장', role: 'STAFF', username: 'staff1', password: '1111' },
        { id: '15336bb8-9083-4a86-81c5-cef77e39009b', name: 'A 패션', role: 'CLIENT', username: 'user_a', password: '1111', brand_id: '9def20d6-5c05-48bb-89f6-21d6c32a948f' },
        { id: '2c3d4e5f-6g7h-8i9j-0k1l-2m3n4o5p6q7r', name: 'B 스타일', role: 'CLIENT', username: 'user_b', password: '2222', brand_id: '9d51fbc4-97ef-448f-a8a4-203775ecdf1c' }
    ],
    permissions: {
        MASTER: ['dashboard', 'production_schedule', 'documents', 'user_management', 'brand_management', 'detail'],
        STAFF: ['dashboard', 'production_schedule', 'detail'],
        CLIENT: ['dashboard', 'detail']
    },
    schedules: [], // 실시간 데이터 로드를 위해 비워둠 (Supabase 연동 우선)
    products: [
        {
            id: '6de8a452-9642-4f32-8e10-9f172152a948',
            company_id: '15336bb8-9083-4a86-81c5-cef77e39009b',
            brand_id: '9def20d6-5c05-48bb-89f6-21d6c32a948f',
            name: 'OOO 청바지',
            current_stage: 'pattern',
            deadline: '2026.03.25',
            notes: '워싱 느낌 강조 요청. YKK 지퍼 사용 필수.',
            created_by: 'f93868d6-10ee-40da-837a-965bb42f4e81',
            todos: [],
            photos: [],
            documents: [],
            history: []
        }
    ],
    globalDocuments: []
};
