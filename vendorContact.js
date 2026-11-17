//  연락처(vendors) 칸 규칙 — 화면(main.js)과 테스트가 같이 쓴다. 109 마이그레이션과 값이 같아야 한다.
//  업체명 · 담당자 · 휴대폰(mobile) · 전화(phone) · 팩스 · 이메일 · 주소 · 사업자등록증(파일 + biz_no) · 메모 · 구분
export const VF_BUCKET = 'vendor_files';
export const VF_FILE_MAX = 10 * 1024 * 1024;   // 10MB — 109 버킷 file_size_limit 과 같다

export const VF_FILE_TYPES = {
    pdf:  { mime: 'application/pdf', kind: 'pdf' },
    jpg:  { mime: 'image/jpeg', kind: 'image' },
    jpeg: { mime: 'image/jpeg', kind: 'image' },
    png:  { mime: 'image/png', kind: 'image' },
    webp: { mime: 'image/webp', kind: 'image' },
};
export const VF_ACCEPT = Object.keys(VF_FILE_TYPES).map(e => '.' + e).join(',');
export const VF_MIMES = [...new Set(Object.values(VF_FILE_TYPES).map(t => t.mime))];

//  휴대폰 번호 하나뿐인가 — 109 의 update 판정식과 같다(숫자만 남겨 01x 10~11자리 / 821x)
export function isMobileNumber(v) {
    const d = String(v ?? '').replace(/[^0-9]/g, '');
    return /^01[016789][0-9]{7,8}$/.test(d) || /^821[016789][0-9]{7,8}$/.test(d);
}
//  109 전 행(mobile 칸 없음)도 화면에서 같은 모양으로 — phone 이 휴대폰이면 휴대폰 칸으로 보인다
export function phonesOf(v) {
    if (!v) return { mobile: '', phone: '' };
    const mobile = String(v.mobile ?? '').trim(), phone = String(v.phone ?? '').trim();
    if (!mobile && !('mobile' in v) && isMobileNumber(phone)) return { mobile: phone, phone: '' };
    return { mobile, phone };
}
//  전화 걸 번호 — 휴대폰 먼저
export const callNumberOf = v => { const p = phonesOf(v); return p.mobile || p.phone || ''; };
export const telHref = n => 'tel:' + String(n || '').replace(/[^0-9+]/g, '');

export function vfExt(name) {
    const m = String(name || '').normalize('NFC').match(/\.([A-Za-z0-9]+)$/);
    return m ? m[1].toLowerCase() : '';
}
//  올리기 전 검사 — 통과하면 { ok, ext, mime, kind }, 아니면 { ok:false, error }
export function validateBizFile(file) {
    if (!file || !file.name) return { ok: false, error: '파일을 고르세요' };
    const ext = vfExt(file.name), t = VF_FILE_TYPES[ext];
    if (!t) return { ok: false, error: 'PDF·사진(jpg·png·webp)만 올릴 수 있습니다' };
    const size = Number(file.size || 0);
    if (!size) return { ok: false, error: '빈 파일입니다' };
    if (size > VF_FILE_MAX) return { ok: false, error: `10MB 이하만 올릴 수 있습니다 (지금 ${(size / 1048576).toFixed(1)}MB)` };
    return { ok: true, ext, mime: t.mime, kind: t.kind };
}
//  버킷 안 경로 — <업체 id>/<uuid>.<확장자>. 한글 이름은 경로에 넣지 않는다
export function bizFilePath(vendorId, uuid, ext) {
    const v = String(vendorId || '').toLowerCase(), u = String(uuid || '').toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(v) || !/^[0-9a-f-]{36}$/.test(u) || !VF_FILE_TYPES[ext]) return null;
    return `${v}/${u}.${ext}`;
}
export const bizFileKind = v => (VF_FILE_TYPES[vfExt(v?.biz_file_name || v?.biz_file_path)] || {}).kind || null;

//  아무것도 안 골랐을 때 오른쪽 요약 — 상태별 · 구분별 · 빈 칸
export function contactSummary(list, cats = []) {
    const rows = list || [];
    const status = { '거래중': 0, '보류': 0, '거래중단': 0 };
    rows.forEach(v => { const s = v.status || '거래중'; status[s] = (status[s] || 0) + 1; });
    const byCat = {};
    rows.forEach(v => { const c = v.category || '기타'; byCat[c] = (byCat[c] || 0) + 1; });
    const order = cats.map(c => c.name);
    const catRows = Object.entries(byCat).sort((a, b) => {
        const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
        return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || b[1] - a[1];
    });
    const missing = {
        mobile: rows.filter(v => !phonesOf(v).mobile).length,
        email: rows.filter(v => !String(v.email || '').trim()).length,
        contact: rows.filter(v => !String(v.contact_name || '').trim()).length,
        bizFile: rows.filter(v => !v.biz_file_path).length,
    };
    const recent = rows.filter(v => v.updated_at || v.created_at)
        .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))).slice(0, 5);
    return { total: rows.length, status, catRows, missing, recent };
}
