//  작업지시서 파일 올리기 — 외부에서 받은 지시서(PDF·사진·엑셀·한글)를 그대로 보관한다.
//  저장: 비공개 버킷 tech_pack_files(093). 경로는 uuid + 확장자, 원래 이름은 tech_packs.file_name 칸.
//  화면(main.js)과 테스트가 같이 쓴다. 버킷 설정(크기·종류)과 값이 같아야 한다 — 093 과 함께 고친다.
export const TP_BUCKET = 'tech_pack_files';
export const TP_FILE_MAX = 20 * 1024 * 1024;   // 20MB

//  확장자 → 보낼 content-type · 종류. 브라우저가 주는 type 은 hwp·xls 에서 비어 있을 때가 많아 확장자로 판정한다.
export const TP_FILE_TYPES = {
    pdf:  { mime: 'application/pdf', kind: 'pdf', label: 'PDF' },
    jpg:  { mime: 'image/jpeg', kind: 'image', label: '사진' },
    jpeg: { mime: 'image/jpeg', kind: 'image', label: '사진' },
    png:  { mime: 'image/png', kind: 'image', label: '사진' },
    webp: { mime: 'image/webp', kind: 'image', label: '사진' },
    xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'sheet', label: '엑셀' },
    xls:  { mime: 'application/vnd.ms-excel', kind: 'sheet', label: '엑셀' },
    hwp:  { mime: 'application/x-hwp', kind: 'hwp', label: '한글' },
};
export const TP_ACCEPT = Object.keys(TP_FILE_TYPES).map(e => '.' + e).join(',');
export const TP_MIMES = [...new Set(Object.values(TP_FILE_TYPES).map(t => t.mime))];

export function tpExt(name) {
    const m = String(name || '').normalize('NFC').match(/\.([A-Za-z0-9]+)$/);
    return m ? m[1].toLowerCase() : '';
}

//  올리기 전 검사 — 통과하면 { ok, ext, mime, kind }, 아니면 { ok:false, error }
export function validateTpFile(file) {
    if (!file || !file.name) return { ok: false, error: '파일을 고르세요' };
    const ext = tpExt(file.name);
    const t = TP_FILE_TYPES[ext];
    if (!t) return { ok: false, error: 'PDF·사진(jpg·png·webp)·엑셀(xlsx·xls)·한글(hwp) 파일만 올릴 수 있습니다' };
    const size = Number(file.size || 0);
    if (!size) return { ok: false, error: '빈 파일입니다' };
    if (size > TP_FILE_MAX) return { ok: false, error: `20MB 이하만 올릴 수 있습니다 (지금 ${(size / 1048576).toFixed(1)}MB)` };
    return { ok: true, ext, mime: t.mime, kind: t.kind };
}

//  버킷 안 경로 — 한글·공백 이름이 경로에 들어가지 않게 uuid 만 쓴다
export function tpFilePath(uuid, ext) {
    const id = String(uuid || '').toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(id) || !TP_FILE_TYPES[ext]) return null;
    return `${id}.${ext}`;
}

//  파일 이름에서 확장자를 뗀 것이 기본 지시서 이름
export function tpDefaultName(fileName) {
    const n = String(fileName || '').normalize('NFC').replace(/\.[A-Za-z0-9]+$/, '').trim();
    return (n || '업로드 작업지시서').slice(0, 120);
}

export const isUploadPack = t => !!t && t.source === 'upload';
//  도식화(config)가 있는 '대시보드 제작' 지시서인가 — 업로드는 config 가 '{}'
export const hasPackConfig = t => !!t && !isUploadPack(t) && !!t.config && Object.keys(t.config).length > 0;
export const tpKind = t => (TP_FILE_TYPES[tpExt(t?.file_name || t?.file_path)] || {}).kind || null;
export const tpKindLabel = t => (TP_FILE_TYPES[tpExt(t?.file_name || t?.file_path)] || {}).label || '파일';
export function tpSizeText(n) {
    n = Number(n || 0);
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB';
    if (n >= 1024) return Math.round(n / 1024) + 'KB';
    return n + 'B';
}
