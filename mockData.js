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
    brands: [],
    companies: [],
    permissions: {
        MASTER: ['dashboard', 'production_schedule', 'documents', 'user_management', 'brand_management', 'detail'],
        STAFF: ['dashboard', 'production_schedule', 'detail'],
        CLIENT: ['dashboard', 'detail']
    },
    schedules: [],
    products: [],
    globalDocuments: []
};
