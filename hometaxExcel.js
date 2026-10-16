// 홈택스 전자(세금)계산서 일괄발급용 엑셀 만들기 (견적 → 1행 = 계산서 1건)
// - 홈택스 양식(일반 세금계산서): 데이터는 7행부터, 열 59개(A~BG). 건당 품목 최대 4개.
// - ⚠ 열 순서는 홈택스 '일괄작성 양식' 실물과 1회 대조 전까지 미확인. HOMETAX_COLS 만 고치면 된다.
// - 외부 라이브러리 없이 xlsx(무압축 zip)를 직접 만든다.

export const SUPPLIER = {
    bizNo: '2798803052', subNo: '', name: '주식회사 이일칠구', ceo: '김석원',
    addr: '인천광역시 하늘중앙로 225번길 20, 507-8호', bizType: '서비스', bizClass: '경영컨설팅', email: '',
};

const ITEM_COLS = ['일자', '품목', '규격', '수량', '단가', '공급가액', '세액', '품목비고'];
export const HOMETAX_COLS = [
    '전자(세금)계산서 종류', '작성일자',
    '공급자 등록번호', '공급자 종사업장번호', '공급자 상호', '공급자 성명', '공급자 사업장주소', '공급자 업태', '공급자 종목', '공급자 이메일',
    '공급받는자 등록번호', '공급받는자 종사업장번호', '공급받는자 상호', '공급받는자 성명', '공급받는자 사업장주소', '공급받는자 업태', '공급받는자 종목', '공급받는자 이메일1', '공급받는자 이메일2',
    '공급가액', '세액', '비고',
    ...[1, 2, 3, 4].flatMap(n => ITEM_COLS.map(c => c + n)),
    '현금', '수표', '어음', '외상미수금', '영수(01)/청구(02)',
];
export const DATA_START_ROW = 7;
export const MAX_ITEMS = 4;

const digits = s => String(s || '').replace(/[^0-9]/g, '');
const num = v => Math.round(Number(v) || 0);

// 견적 1건 → { row, errors[] }. errors 가 있으면 그 건은 엑셀에 넣지 않는다.
export function quoteToRow(q, { supplier = SUPPLIER, writeDate, email = '', purpose = '02' } = {}) {
    const errors = [];
    const ymd = digits(writeDate || q.tax_supply_date || q.quote_date);
    if (ymd.length !== 8) errors.push('작성일자 없음');
    const bizNo = digits(q.client_biz_no);
    if (bizNo.length !== 10) errors.push('사업자번호 10자리 아님');
    if (!String(q.client_name || '').trim()) errors.push('상호 없음');
    if (!String(q.client_ceo || '').trim()) errors.push('대표자 없음');
    if (q.tax_status === 'issued') errors.push('이미 발행됨');
    const items = (q.items || []).filter(it => String(it.name || '').trim());
    if (!items.length) errors.push('품목 없음');
    if (items.length > MAX_ITEMS) errors.push(`품목 ${items.length}개 — 홈택스 일괄은 4개까지(건별 발행)`);
    const lines = items.slice(0, MAX_ITEMS).map(it => {
        const supply = num(it.qty) * num(it.price);
        return [ymd.slice(6, 8), it.name || '', it.spec || '', num(it.qty), num(it.price), supply, num(it.tax), it.note || ''];
    });
    const supplySum = lines.reduce((s, l) => s + l[5], 0), taxSum = lines.reduce((s, l) => s + l[6], 0);
    if (items.length && items.length <= MAX_ITEMS) {
        if (supplySum !== num(q.supply_amount)) errors.push(`품목 공급가 합 ${supplySum} ≠ 견적 공급가 ${num(q.supply_amount)}`);
        if (taxSum !== num(q.tax_amount)) errors.push(`품목 세액 합 ${taxSum} ≠ 견적 세액 ${num(q.tax_amount)}`);
    }
    const s = supplier;
    const row = [
        '01', ymd,
        digits(s.bizNo), s.subNo || '', s.name, s.ceo, s.addr, s.bizType, s.bizClass, s.email || '',
        bizNo, '', q.client_name || '', q.client_ceo || '', '', '', '', email || q.client_email || '', '',
        num(q.supply_amount), num(q.tax_amount), '',
        ...[0, 1, 2, 3].flatMap(i => lines[i] || ['', '', '', '', '', '', '', '']),
        '', '', '', '', purpose === '01' ? '01' : '02',
    ];
    return { row, errors };
}

// 견적 여러 건 → { rows, skipped:[{q, errors}] }
export function buildRows(quotes, opt = {}) {
    const rows = [], skipped = [];
    for (const q of quotes) {
        const { row, errors } = quoteToRow(q, { ...opt, email: (opt.emails || {})[q.id] || '' });
        if (errors.length) skipped.push({ q, errors }); else rows.push(row);
    }
    return { rows, skipped };
}

// ---- 최소 xlsx 작성기 (문자 셀 = inlineStr, 숫자 셀 = n). 등록번호·작성일자·일자는 문자로(앞 0 보존) ----
const TEXT_COLS = new Set([0, 1, 2, 3, 10, 11, ...[0, 1, 2, 3].map(i => 22 + i * 8)]);
const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

export function sheetXml(rows, { startRow = DATA_START_ROW, header = HOMETAX_COLS } = {}) {
    const out = [];
    const cell = (r, c, v, forceText) => {
        const ref = colName(c) + r;
        if (v === '' || v == null) return '';
        if (!forceText && typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    };
    out.push(`<row r="1">${cell(1, 0, '홈택스 전자(세금)계산서 일괄발급 — 7행부터 데이터')}</row>`);
    out.push(`<row r="${startRow - 1}">${header.map((h, c) => cell(startRow - 1, c, h, true)).join('')}</row>`);
    rows.forEach((row, i) => {
        const r = startRow + i;
        out.push(`<row r="${r}">${row.map((v, c) => cell(r, c, v, TEXT_COLS.has(c))).join('')}</row>`);
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${out.join('')}</sheetData></worksheet>`;
}

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// files: [[name, string]] → Uint8Array (zip, 무압축)
export function zipStore(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const [name, text] of files) {
        const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
        const h = new DataView(new ArrayBuffer(30));
        h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
        h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
        parts.push(new Uint8Array(h.buffer), nb, data);
        const cd = new DataView(new ArrayBuffer(46));
        cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
        cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nb.length, true); cd.setUint32(42, off, true);
        central.push(new Uint8Array(cd.buffer), nb);
        off += 30 + nb.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
}

export function xlsxBytes(rows, opt = {}) {
    return zipStore([
        ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
        ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
        ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="엑셀업로드양식" sheetId="1" r:id="rId1"/></sheets></workbook>'],
        ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
        ['xl/worksheets/sheet1.xml', sheetXml(rows, opt)],
    ]);
}
