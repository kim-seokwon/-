//  24 회사 정보 — 견적서·세금계산서·홈택스 엑셀에 찍히는 우리 회사(공급자) 정보 한 곳 (순수 함수)
//  원본은 company_profile(139) 한 줄. 표가 없거나(139 전) 못 읽으면 COMPANY_DEFAULT(그동안 코드에 박혀 있던 값)를 쓴다.

export const COMPANY_DEFAULT = {
    corp_name: '주식회사 이일칠구', biz_no: '2798803052', ceo_name: '김석원',
    address: '인천광역시 하늘중앙로 225번길 20, 507-8호', biz_type: '서비스', biz_class: '경영컨설팅',
    contact_name: '방보경', contact_tel: '010-9072-7003', contact_email: '',
    bank_name: '기업은행', bank_account: '988-026117-04-012', bank_holder: '(주)더하임프로모션',
    quote_title: '브하스 의류제작 견적서',
};

//  칸 — 화면 이름·필수·도움말 (설정 화면과 검사가 같은 표를 본다)
export const COMPANY_FIELDS = [
    { k: 'corp_name', t: '상호(법인명)', req: true, g: '사업자' },
    { k: 'biz_no', t: '사업자등록번호', req: true, g: '사업자', hint: '숫자 10자리 — 세금계산서 공급자 번호' },
    { k: 'ceo_name', t: '대표자', req: true, g: '사업자' },
    { k: 'address', t: '사업장 주소', req: true, g: '사업자' },
    { k: 'biz_type', t: '업태', req: true, g: '사업자' },
    { k: 'biz_class', t: '종목', req: true, g: '사업자' },
    { k: 'contact_name', t: '담당자', g: '문서 발행' },
    { k: 'contact_tel', t: '담당자 연락처', g: '문서 발행' },
    { k: 'contact_email', t: '세금계산서 이메일', g: '문서 발행' },
    { k: 'quote_title', t: '견적서 제목', g: '문서 발행' },
    { k: 'bank_name', t: '입금 은행', g: '입금 계좌' },
    { k: 'bank_account', t: '계좌번호', g: '입금 계좌' },
    { k: 'bank_holder', t: '예금주', g: '입금 계좌', hint: '상호와 다르면 견적서를 받는 쪽이 헷갈릴 수 있음' },
];

export const digits = s => String(s || '').replace(/[^0-9]/g, '');
export const fmtBizNo = s => { const d = digits(s); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : String(s || ''); };

//  사업자등록번호 검증번호(국세청 규칙)
export function bizNoValid(s) {
    const d = digits(s); if (d.length !== 10) return false;
    const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
    let sum = 0; for (let i = 0; i < 9; i++) sum += +d[i] * w[i];
    sum += Math.floor((+d[8] * 5) / 10);
    return (10 - (sum % 10)) % 10 === +d[9];
}

//  표에서 읽은 줄 + 기본값 — 빈 칸은 기본값으로 메우지 않는다(지운 건 지운 대로). 줄이 없을 때만 기본값.
export function companyOf(row) {
    if (!row) return { ...COMPANY_DEFAULT, _source: 'default' };
    const out = { _source: 'db' };
    Object.keys(COMPANY_DEFAULT).forEach(k => { out[k] = row[k] == null ? '' : String(row[k]); });
    out.updated_at = row.updated_at || null; out.updated_by = row.updated_by || null;
    return out;
}

//  저장 전 검사 — errors 는 막고, warns 는 알리기만
export function companyProblems(c) {
    const errors = [], warns = [];
    COMPANY_FIELDS.filter(f => f.req).forEach(f => { if (!String(c?.[f.k] || '').trim()) errors.push(`${f.t} 비어 있음`); });
    if (String(c?.biz_no || '').trim() && !bizNoValid(c.biz_no)) errors.push('사업자등록번호가 맞지 않음(10자리·검증번호)');
    if (c?.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.contact_email)) errors.push('세금계산서 이메일 형식');
    const norm = s => String(s || '').replace(/\s|\(주\)|주식회사|㈜/g, '');
    if (c?.bank_holder && c?.corp_name && norm(c.bank_holder) !== norm(c.corp_name)) warns.push(`예금주(${c.bank_holder})가 상호(${c.corp_name})와 다름`);
    if ((c?.bank_name || c?.bank_account) && !(c?.bank_name && c?.bank_account && c?.bank_holder)) warns.push('입금 계좌는 은행·계좌번호·예금주를 모두 채워야 견적서에 찍힘');
    return { errors, warns };
}

//  홈택스 엑셀 공급자 칸
export function toSupplier(c) {
    return { bizNo: digits(c.biz_no), subNo: '', name: c.corp_name || '', ceo: c.ceo_name || '', addr: c.address || '',
        bizType: c.biz_type || '', bizClass: c.biz_class || '', email: c.contact_email || '' };
}
//  견적서 입금 줄 — 셋 다 있을 때만
export const bankLine = c => (c.bank_name && c.bank_account && c.bank_holder) ? `입금계좌: ${c.bank_name} ${c.bank_account} ${c.bank_holder}` : '';
