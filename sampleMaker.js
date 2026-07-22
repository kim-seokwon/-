// ============================================================================
// sampleMaker.js — 의류 샘플 제작 모듈
//  · 의류 종류/색상/상세치수/디테일 선택 → SVG 실사 미리보기 + 도식화 + 작업지시서
//  · main.js(BhasApp)에서 import 하여 'sample_maker' 뷰로 사용. DB 미접근(read-only).
// ============================================================================

// ---------------------------------------------------------------------------
// 색상 팔레트 (아동복 상용 컬러)
// ---------------------------------------------------------------------------
export const SAMPLE_COLORS = [
  { name: '화이트',     hex: '#FFFFFF' },
  { name: '아이보리',   hex: '#F4ECDD' },
  { name: '오트밀',     hex: '#D8C9AE' },
  { name: '베이지',     hex: '#C9B292' },
  { name: '카멜',       hex: '#B5783F' },
  { name: '브라운',     hex: '#6E4B36' },
  { name: '머스타드',   hex: '#E0A93B' },
  { name: '옐로우',     hex: '#F4D03F' },
  { name: '코랄',       hex: '#F0846F' },
  { name: '인디핑크',   hex: '#E5AEBC' },
  { name: '레드',       hex: '#C0392B' },
  { name: '세이지',     hex: '#9DAE8B' },
  { name: '카키',       hex: '#6E7351' },
  { name: '민트',       hex: '#A9D9C9' },
  { name: '스카이블루', hex: '#A9CCE3' },
  { name: '네이비',     hex: '#2A3550' },
  { name: '라벤더',     hex: '#C3B6DD' },
  { name: '그레이멜란지', hex: '#9AA0A6' },
  { name: '차콜',       hex: '#3A3D42' },
  { name: '블랙',       hex: '#1A1A1A' },
];

// ---------------------------------------------------------------------------
// 의류 종류 정의
//   category: 'top' | 'pants'  (SVG 렌더러 분기)
//   measure : 상세치수 (cm). key는 렌더러/작업지시서 공통.
//   details : 디테일 옵션. draw=true면 도식/미리보기 반영, 아니면 지시서에만 기재.
// ---------------------------------------------------------------------------
export const SAMPLE_GARMENTS = [
  {
    id: 'tee', label: '반팔 티셔츠', icon: 'ph-t-shirt', category: 'top',
    measure: [
      { key: 'shoulder',    label: '어깨너비',   def: 34, min: 22, max: 50 },
      { key: 'chest',       label: '가슴단면',   def: 20, min: 12, max: 40 },
      { key: 'length',      label: '총장',       def: 46, min: 30, max: 70 },
      { key: 'sleeve',      label: '소매길이',   def: 16, min: 6,  max: 30 },
      { key: 'cuffOpening', label: '소매부리',   def: 14, min: 6,  max: 26 },
      { key: 'hem',         label: '밑단단면',   def: 21, min: 12, max: 42 },
      { key: 'neck',        label: '목너비',     def: 16, min: 10, max: 26 },
    ],
    details: [
      { key: 'neckRib',    label: '넥 리브',     draw: true,  def: true },
      { key: 'rib',        label: '소매/밑단 리브', draw: true, def: false },
      { key: 'print',      label: '프린트',      draw: true,  def: false },
      { key: 'embroidery', label: '자수 로고',   draw: true,  def: false },
      { key: 'contrast',   label: '소매 배색',   draw: true,  def: false },
      { key: 'pocket',     label: '가슴 포켓',   draw: true,  def: false },
    ],
  },
  {
    id: 'sweatshirt', label: '맨투맨', icon: 'ph-coat-hanger', category: 'top',
    measure: [
      { key: 'shoulder',    label: '어깨너비',   def: 40, min: 26, max: 56 },
      { key: 'chest',       label: '가슴단면',   def: 26, min: 16, max: 46 },
      { key: 'length',      label: '총장',       def: 50, min: 32, max: 74 },
      { key: 'sleeve',      label: '소매길이',   def: 46, min: 20, max: 64 },
      { key: 'cuffOpening', label: '소매부리(리브)', def: 9, min: 5, max: 16 },
      { key: 'hem',         label: '밑단(리브)', def: 25, min: 14, max: 44 },
      { key: 'neck',        label: '목너비',     def: 18, min: 12, max: 28 },
    ],
    details: [
      { key: 'rib',        label: '넥/소매/밑단 리브', draw: true, def: true },
      { key: 'fleece',     label: '기모 안감',   draw: false, def: true },
      { key: 'print',      label: '프린트',      draw: true,  def: false },
      { key: 'embroidery', label: '자수 로고',   draw: true,  def: false },
      { key: 'contrast',   label: '소매 배색',   draw: true,  def: false },
      { key: 'pocket',     label: '캥거루 포켓', draw: true,  def: false },
    ],
  },
  {
    id: 'hoodie', label: '후드티', icon: 'ph-hoodie', category: 'top',
    measure: [
      { key: 'shoulder',    label: '어깨너비',   def: 42, min: 28, max: 58 },
      { key: 'chest',       label: '가슴단면',   def: 28, min: 18, max: 48 },
      { key: 'length',      label: '총장',       def: 52, min: 34, max: 76 },
      { key: 'sleeve',      label: '소매길이',   def: 47, min: 20, max: 66 },
      { key: 'cuffOpening', label: '소매부리(리브)', def: 9, min: 5, max: 16 },
      { key: 'hem',         label: '밑단(리브)', def: 27, min: 14, max: 46 },
      { key: 'neck',        label: '목너비',     def: 18, min: 12, max: 28 },
      { key: 'hood',        label: '후드높이',   def: 26, min: 16, max: 40 },
    ],
    details: [
      { key: 'kangaroo',   label: '캥거루 포켓', draw: true,  def: true },
      { key: 'drawstring', label: '후드끈',      draw: true,  def: true },
      { key: 'rib',        label: '소매/밑단 리브', draw: true, def: true },
      { key: 'fleece',     label: '기모 안감',   draw: false, def: true },
      { key: 'zipup',      label: '집업(지퍼)',  draw: true,  def: false },
      { key: 'print',      label: '프린트',      draw: true,  def: false },
    ],
  },
  {
    id: 'jacket', label: '점퍼/자켓', icon: 'ph-coat-hanger', category: 'top',
    measure: [
      { key: 'shoulder',    label: '어깨너비',   def: 42, min: 28, max: 58 },
      { key: 'chest',       label: '가슴단면',   def: 30, min: 18, max: 50 },
      { key: 'length',      label: '총장',       def: 50, min: 32, max: 74 },
      { key: 'sleeve',      label: '소매길이',   def: 47, min: 20, max: 66 },
      { key: 'cuffOpening', label: '소매부리',   def: 11, min: 6, max: 20 },
      { key: 'hem',         label: '밑단단면',   def: 28, min: 16, max: 48 },
      { key: 'neck',        label: '목너비',     def: 18, min: 12, max: 28 },
    ],
    details: [
      { key: 'zipper',     label: '전체 지퍼',   draw: true,  def: true },
      { key: 'collar',     label: '카라',        draw: true,  def: true },
      { key: 'pocket',     label: '주머니',      draw: true,  def: true },
      { key: 'hood',       label: '탈부착 후드', draw: false, def: false },
      { key: 'rib',        label: '소매/밑단 리브', draw: true, def: false },
      { key: 'contrast',   label: '소매 배색',   draw: true,  def: false },
      { key: 'lining',     label: '안감',        draw: false, def: true },
    ],
  },
  {
    id: 'dress', label: '원피스', icon: 'ph-dress', category: 'top',
    measure: [
      { key: 'shoulder',    label: '어깨너비',   def: 30, min: 20, max: 46 },
      { key: 'chest',       label: '가슴단면',   def: 18, min: 12, max: 36 },
      { key: 'length',      label: '총장',       def: 60, min: 40, max: 90 },
      { key: 'sleeve',      label: '소매길이',   def: 14, min: 4,  max: 60 },
      { key: 'cuffOpening', label: '소매부리',   def: 12, min: 6,  max: 22 },
      { key: 'hem',         label: '밑단단면',   def: 40, min: 18, max: 70 },
      { key: 'neck',        label: '목너비',     def: 15, min: 10, max: 24 },
    ],
    details: [
      { key: 'frill',      label: '프릴 밑단',   draw: true,  def: true },
      { key: 'ribbon',     label: '리본',        draw: true,  def: false },
      { key: 'button',     label: '앞 단추',     draw: true,  def: false },
      { key: 'pocket',     label: '주머니',      draw: true,  def: false },
      { key: 'print',      label: '프린트',      draw: true,  def: false },
      { key: 'shirring',   label: '셔링',        draw: false, def: false },
    ],
  },
  {
    id: 'pants', label: '바지', icon: 'ph-pants', category: 'pants',
    measure: [
      { key: 'waist',  label: '허리단면',  def: 24, min: 14, max: 44 },
      { key: 'hip',    label: '엉덩이단면', def: 32, min: 18, max: 52 },
      { key: 'thigh',  label: '허벅지단면', def: 22, min: 12, max: 38 },
      { key: 'rise',   label: '밑위',      def: 22, min: 12, max: 36 },
      { key: 'length', label: '총장',      def: 64, min: 30, max: 100 },
      { key: 'hem',    label: '밑단부리',  def: 16, min: 8,  max: 30 },
    ],
    details: [
      { key: 'banding',    label: '밴딩 허리',   draw: true,  def: true },
      { key: 'pocket',     label: '옆 주머니',   draw: true,  def: true },
      { key: 'jogger',     label: '조거 밑단(리브)', draw: true, def: false },
      { key: 'cargo',      label: '카고 포켓',   draw: true,  def: false },
      { key: 'drawstring', label: '허리끈',      draw: true,  def: false },
      { key: 'kneePatch',  label: '무릎 보강',   draw: true,  def: false },
    ],
  },
];

// 상의 공통: 암홀(둘레) 치수 추가 (가슴단면 다음)
SAMPLE_GARMENTS.forEach(g => {
  if (g.category === 'top' && !g.measure.some(m => m.key === 'armhole')) {
    const i = g.measure.findIndex(m => m.key === 'chest');
    const ah = { tee: 36, sweatshirt: 42, hoodie: 44, jacket: 44, dress: 34 }[g.id] || 40;
    g.measure.splice(i + 1, 0, { key: 'armhole', label: '암홀(둘레)', def: ah, min: 22, max: 60 });
  }
});

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------
export function garmentDef(typeId) {
  return SAMPLE_GARMENTS.find(g => g.id === typeId) || SAMPLE_GARMENTS[0];
}

function defMeasure(def) {
  const m = {};
  def.measure.forEach(x => { m[x.key] = x.def; });
  return m;
}
function defDetails(def) {
  const d = {};
  def.details.forEach(x => { d[x.key] = !!x.def; });
  return d;
}

export function defaultSampleConfig(typeId = 'tee') {
  const def = garmentDef(typeId);
  const base = SAMPLE_COLORS.find(c => c.name === '아이보리');
  return {
    type: typeId,
    styleNo: '',
    styleName: '',
    size: '110 (5~6세)',
    color: base,
    measure: defMeasure(def),
    details: defDetails(def),
    placements: [], // 로고/프린트/포켓/자수/라벨 자유 배치
    cutlines: [],   // 절개선 [{id,x1,y1,x2,y2}] 자유
    points: [],     // 디자인 포인트 [{id,fx,fy,label}] 자유
    references: [], // 레퍼런스 사진 [{id,dataUrl,note}] — 디테일 메모
    nodes: {},      // 베지어 컨트롤포인트 오프셋 {key:{dx,dy}}
    curve: { side: 0, shoulder: 0, hem: 0 }, // (구) 곡률 보정 — nodes로 대체
    fabric: '면 100%',
    note: '',
    editMode: false, // 핸들 표시 on/off
    activeTab: 'preview', // 'preview' | 'flat'
  };
}

// 종류 변경 시: 치수/디테일을 새 종류 기본값으로 리셋(공통 정보·배치는 유지)
export function configForType(prev, typeId) {
  const def = garmentDef(typeId);
  // 새 종류에 없는 위치의 배치는 첫 위치로 보정
  const positions = (PLACEMENT_POSITIONS[def.category] || []).map(p => p.key);
  const placements = (prev.placements || []).map(p =>
    positions.includes(p.pos) ? p : { ...p, pos: positions[0] });
  return { ...prev, type: typeId, measure: defMeasure(def), details: defDetails(def), placements, cutlines: prev.cutlines || [], points: prev.points || [], references: prev.references || [], nodes: {}, curve: { side: 0, shoulder: 0, hem: 0 } };
}

// 절개선: 여러 점을 지나는 자유곡선 [{id, pts:[{x,y}...], style:'stitch'|'seam'}]
export function newCutline(id) { return { id, pts: [{ x: 200, y: 120 }, { x: 200, y: 410 }], style: 'stitch' }; }
export function newPoint(id) { return { id, fx: 450, fy: 285, label: '포인트' }; }
function _smEsc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
// 점들을 지나는 매끄러운 path (Catmull-Rom → 베지어). 2점이면 직선.
function smoothPath(pts) {
  if (!pts || pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
function renderCutPoints(cfg, interactive) {
  const edit = interactive && cfg.editMode;
  let s = '';
  (cfg.cutlines || []).forEach(c => {
    const pts = c.pts || [];
    if (pts.length < 2) return;
    const d = smoothPath(pts);
    if (c.style === 'seam') {
      // 절개(완성선): 실선 + 나란한 스티치 암시 없이 굵은 실선
      s += `<path d="${d}" fill="none" stroke="#e3000f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
    } else {
      // 스티치(탑스티치): 점선
      s += `<path d="${d}" fill="none" stroke="#e3000f" stroke-width="1.4" stroke-dasharray="7 4" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if (edit) {
      pts.forEach((p, i) => {
        s += `<circle class="sm-cut-end" data-id="${c.id}" data-idx="${i}" cx="${p.x}" cy="${p.y}" r="6" fill="#fff" stroke="#e3000f" stroke-width="2" style="cursor:move"/>`;
      });
    }
  });
  (cfg.points || []).forEach(p => {
    s += `<g ${edit ? `class="sm-point-node" data-id="${p.id}" data-cx="${p.fx}" data-cy="${p.fy}" style="cursor:move"` : ''}>`;
    s += `<circle cx="${p.fx}" cy="${p.fy}" r="4.5" fill="#2563eb"/>`;
    s += `<circle cx="${p.fx}" cy="${p.fy}" r="9" fill="none" stroke="#2563eb" stroke-width="1.3"/>`;
    if (p.label) s += `<text x="${p.fx + 12}" y="${p.fy + 4}" font-size="12" font-weight="700" fill="#2563eb">${_smEsc(p.label)}</text>`;
    s += `</g>`;
  });
  return s;
}

// 새 배치 요소 생성 (id는 호출측에서 부여)
export function newPlacement(kind, cfg, id) {
  const meta = placementKindMeta(kind);
  const cat = garmentDef(cfg.type).category;
  const firstPos = (PLACEMENT_POSITIONS[cat] || [{ key: 'centerChest' }])[0].key;
  return { id, kind, pos: firstPos, sizeCm: meta.size, dataUrl: null, fileName: '' };
}

// hex 음영 조절 (percent: -100~100)
function shade(hex, percent) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  const amt = Math.round(2.55 * percent);
  const clamp = v => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amt);
  const g = clamp(((num >> 8) & 0xff) + amt);
  const b = clamp((num & 0xff) + amt);
  return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
}
// 밝기 → 명도 기반 글자색
function isLight(hex) {
  let h = (hex || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  const r = num >> 16, g = (num >> 8) & 0xff, b = num & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

// 벡터 유틸
const pt = (x, y) => ({ x, y });
function norm(x, y) { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; }
function addv(p, d, len) { return { x: p.x + d.x * len, y: p.y + d.y * len }; }
function midv(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function poly(points) { return points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '); }

// 치수선 (도식화용): 양끝 틱 + 라벨
function dimLine(a, b, label, opts = {}) {
  const off = opts.off || 0;
  const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const dir = horiz ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const A = addv(a, dir, off), B = addv(b, dir, off);
  const tick = 5;
  const tdir = horiz ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const mid = midv(A, B);
  return `
    <g class="sm-dim">
      <line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" />
      <line x1="${A.x - tdir.x * tick}" y1="${A.y - tdir.y * tick}" x2="${A.x + tdir.x * tick}" y2="${A.y + tdir.y * tick}" />
      <line x1="${B.x - tdir.x * tick}" y1="${B.y - tdir.y * tick}" x2="${B.x + tdir.x * tick}" y2="${B.y + tdir.y * tick}" />
      ${off ? `<line class="sm-ext" x1="${a.x}" y1="${a.y}" x2="${A.x}" y2="${A.y}" /><line class="sm-ext" x1="${b.x}" y1="${b.y}" x2="${B.x}" y2="${B.y}" />` : ''}
      <rect x="${mid.x - 22}" y="${mid.y - 8}" width="44" height="16" rx="3" fill="#fff" />
      <text x="${mid.x}" y="${mid.y + 4}" text-anchor="middle">${label}</text>
    </g>`;
}

// ---------------------------------------------------------------------------
// 상의(top) 지오메트리
// ---------------------------------------------------------------------------
function topGeom(cfg) {
  const def = garmentDef(cfg.type);
  const SX = 3.0, SY = 2.7, cx = 200, topY = 78;
  const v = k => {
    const f = def.measure.find(m => m.key === k);
    return Number(cfg.measure[k] ?? (f ? f.def : 0));
  };
  const neckHalf = (v('neck') / 2) * SX;
  const shoulderHalf = (v('shoulder') / 2) * SX;
  const chestHalf = v('chest') * SX;
  const hemHalf = v('hem') * SX;
  const length = v('length') * SY;
  const sleeveLen = v('sleeve') * SY;
  const cuffHalf = ((v('cuffOpening') || 12) / 2) * SX;
  const hood = v('hood') || 0;

  const armhole = v('armhole');
  const shoulderDrop = 15;
  const shoulderY = topY + shoulderDrop;
  const armpitY = shoulderY + (armhole ? (armhole / 2) * SY : Math.max(54, length * 0.30));
  const hemY = topY + length;
  const neckDropF = neckHalf * 0.62 + 10;
  const neckDropB = neckHalf * 0.24 + 5;

  const NL = pt(cx - neckHalf, topY), NR = pt(cx + neckHalf, topY);
  const SL = pt(cx - shoulderHalf, shoulderY), SR = pt(cx + shoulderHalf, shoulderY);
  const AL = pt(cx - chestHalf, armpitY), AR = pt(cx + chestHalf, armpitY);
  const HL = pt(cx - hemHalf, hemY), HR = pt(cx + hemHalf, hemY);

  // 셋인 슬리브 지오메트리
  const mkSleeve = (S, A, sgn) => {
    const dir = norm(sgn * 1, 1.04);
    const perp = norm(-dir.y, dir.x);
    const mid = midv(S, A);
    const cc = addv(mid, dir, sleeveLen);
    let cO = addv(cc, perp, cuffHalf), cI = addv(cc, perp, -cuffHalf);
    if (Math.hypot(cO.x - S.x, cO.y - S.y) > Math.hypot(cI.x - S.x, cI.y - S.y)) { const t = cO; cO = cI; cI = t; }
    const L = Math.hypot(cc.x - mid.x, cc.y - mid.y);
    return { S, A, dir, perp, cc, cO, cI, sgn, L };
  };
  const slL = mkSleeve(SL, AL, -1), slR = mkSleeve(SR, AR, 1);

  return {
    def, SX, SY, cx, topY, shoulderY, armpitY, hemY, neckDropF, neckDropB,
    neckHalf, shoulderHalf, chestHalf, hemHalf, length, sleeveLen, cuffHalf, hood,
    NL, NR, SL, SR, AL, AR, HL, HR, slL, slR,
  };
}

// 우측 몸판 베지어 컨트롤포인트 (기본값) — topBody·핸들 공용
function topBodyControls(g) {
  const { SR, AR, HR, cx, topY, shoulderHalf, hemY } = g;
  return {
    shoulder_c: { x: cx + shoulderHalf * 0.5, y: topY + 1 },  // 어깨(Q)
    armhole_c1: { x: SR.x - 4, y: SR.y + 18 },                // 암홀 상
    armhole_c2: { x: AR.x + 2, y: AR.y - 24 },                // 암홀 하
    side_c1: { x: AR.x + 1, y: AR.y + 46 },                   // 옆선 상
    side_c2: { x: HR.x - 1, y: HR.y - 46 },                   // 옆선 하
    hem_c: { x: cx, y: hemY },                                // 밑단(Q)
  };
}
// 컨트롤포인트에 cfg.nodes 오프셋 적용
function ctrlPt(cfg, key, base) {
  const o = cfg && cfg.nodes && cfg.nodes[key];
  return o ? { x: base.x + (o.dx || 0), y: base.y + (o.dy || 0) } : base;
}

// 곡선 몸판 외곽선 (neckDrop으로 앞/뒤 넥, 좌우대칭, 베지어 핸들 반영)
function topBody(g, neckDrop, cfg) {
  const { NL, NR, SL, SR, AL, AR, HL, HR, cx, topY } = g;
  const bc = topBodyControls(g);
  const sh = ctrlPt(cfg, 'shoulder_c', bc.shoulder_c);
  const a1 = ctrlPt(cfg, 'armhole_c1', bc.armhole_c1);
  const a2 = ctrlPt(cfg, 'armhole_c2', bc.armhole_c2);
  const s1 = ctrlPt(cfg, 'side_c1', bc.side_c1);
  const s2 = ctrlPt(cfg, 'side_c2', bc.side_c2);
  const hm = ctrlPt(cfg, 'hem_c', bc.hem_c);
  const mir = p => ({ x: 2 * cx - p.x, y: p.y });
  const shL = mir(sh), a1L = mir(a1), a2L = mir(a2), s1L = mir(s1), s2L = mir(s2);
  const f = p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  return `M ${f(NL)}
    Q ${f(shL)} ${f(SL)}
    C ${f(a1L)} ${f(a2L)} ${f(AL)}
    C ${f(s1L)} ${f(s2L)} ${f(HL)}
    Q ${f(hm)} ${f(HR)}
    C ${f(s2)} ${f(s1)} ${f(AR)}
    C ${f(a2)} ${f(a1)} ${f(SR)}
    Q ${f(sh)} ${f(NR)}
    Q ${cx} ${topY + neckDrop} ${f(NL)} Z`;
}

// 셋인 슬리브 외곽선 (몸판 암홀과 곡선 일치)
function sleevePath(sl) {
  const { S, A, dir, cO, cI, sgn, L } = sl;
  return `M ${S.x} ${S.y}
    C ${(S.x + dir.x * L * 0.45).toFixed(1)} ${(S.y + dir.y * L * 0.45).toFixed(1)} ${(cO.x - dir.x * 12).toFixed(1)} ${(cO.y - dir.y * 12).toFixed(1)} ${cO.x.toFixed(1)} ${cO.y.toFixed(1)}
    L ${cI.x.toFixed(1)} ${cI.y.toFixed(1)}
    C ${(cI.x - dir.x * 12).toFixed(1)} ${(cI.y - dir.y * 12).toFixed(1)} ${(A.x + dir.x * L * 0.4).toFixed(1)} ${(A.y + dir.y * L * 0.4).toFixed(1)} ${A.x.toFixed(1)} ${A.y.toFixed(1)}
    C ${(A.x + sgn * 2).toFixed(1)} ${(A.y - 24).toFixed(1)} ${(S.x - sgn * 4).toFixed(1)} ${(S.y + 18).toFixed(1)} ${S.x} ${S.y} Z`;
}

// 직선 리브 밴드 (니트 세로 해칭)
function ribStraight(a, b, dx, dy, fill, line) {
  let s = `<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)} L ${(b.x + dx).toFixed(1)} ${(b.y + dy).toFixed(1)} L ${(a.x + dx).toFixed(1)} ${(a.y + dy).toFixed(1)} Z" fill="${fill}" stroke="${line}" stroke-width="1.4"/>`;
  const n = Math.max(4, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 6));
  for (let i = 1; i < n; i++) {
    const t = i / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    s += `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + dx).toFixed(1)}" y2="${(y + dy).toFixed(1)}" stroke="${line}" stroke-width="0.5"/>`;
  }
  return s;
}

// 곡선 넥 리브 (해칭)
function neckRibArc(g, neckDrop, fill, line) {
  const { NL, NR, cx, topY } = g, rh = 8;
  const oY = topY + neckDrop, iY = topY + neckDrop + rh;
  const qx = (t, p0, p1, p2) => (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * p1 + t * t * p2;
  let s = `<path d="M ${NL.x} ${NL.y} Q ${cx} ${oY} ${NR.x} ${NR.y} L ${NR.x - 3} ${NR.y + rh} Q ${cx} ${iY} ${NL.x + 3} ${NL.y + rh} Z" fill="${fill}" stroke="${line}" stroke-width="1.4"/>`;
  const n = 20;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const ox = qx(t, NL.x, cx, NR.x), oy = qx(t, NL.y, oY, NR.y);
    const ix = qx(t, NL.x + 3, cx, NR.x - 3), iy = qx(t, NL.y + rh, iY, NR.y + rh);
    s += `<line x1="${ox.toFixed(1)}" y1="${oy.toFixed(1)}" x2="${ix.toFixed(1)}" y2="${iy.toFixed(1)}" stroke="${line}" stroke-width="0.5"/>`;
  }
  return s;
}

// 오바록/스티치 (점선)
function tstitch(d, col) { return `<path d="${d}" fill="none" stroke="${col}" stroke-width="0.8" stroke-dasharray="4 2.5" stroke-linecap="round"/>`; }

// 콜아웃 (디테일 지시선): 도식 우측에 라벨 + 리더선
function callout(fx, fy, lx, ly, text) {
  return `<g class="sm-callout">
    <line x1="${fx.toFixed(1)}" y1="${fy.toFixed(1)}" x2="${(lx - 3).toFixed(1)}" y2="${ly.toFixed(1)}" stroke="#555" stroke-width="0.6"/>
    <circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="1.6" fill="#555"/>
    <text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="start" font-size="9.5" fill="#222">${text}</text>
  </g>`;
}

// 콜아웃 묶음: 우측 여백에 세로 분산 배치
function calloutColumn(items, labelX, y0, y1) {
  if (!items.length) return '';
  const n = items.length, gap = (y1 - y0) / Math.max(1, n - 1 || 1);
  return items.map((it, i) => callout(it.x, it.y, labelX, n === 1 ? (y0 + y1) / 2 : y0 + gap * i, it.t)).join('');
}

// 상의 한 면(front/back) 그리기
function drawTopView(cfg, mode, view, interactive) {
  const g = topGeom(cfg);
  const d = cfg.details || {};
  const flat = mode === 'flat';
  const back = view === 'back';
  const base = cfg.color ? cfg.color.hex : '#cccccc';
  const fill = flat ? '#ffffff' : base;
  const line = flat ? '#1f1f1f' : shade(base, isLight(base) ? -30 : -18);
  const accent = shade(base, isLight(base) ? -20 : 18);
  const sw = flat ? 1.8 : 1.5;
  const stitchCol = flat ? '#8a8a8a' : shade(base, isLight(base) ? -16 : 14);
  const neckDrop = back ? g.neckDropB : g.neckDropF;
  const hasRib = d.rib || cfg.type === 'sweatshirt' || cfg.type === 'hoodie';
  const ribH = 16, ribC = 13;
  const hasHood = (cfg.type === 'hoodie' || d.hood) && g.hood;
  const hH = hasHood ? g.hood * 2.0 : 0;
  const sleeveFill = (!flat && d.contrast) ? accent : fill;
  let s = '';

  // 후드 (뒤에 먼저) — 둥근 돔 (윗면 넓게)
  const apexY = g.topY - hH;
  const hoodTopW = g.shoulderHalf * 0.88;
  if (hasHood) {
    const hp = `M ${g.SL.x + 14} ${g.shoulderY}
      C ${g.SL.x + 2} ${g.shoulderY - hH * 0.4} ${g.cx - hoodTopW - 8} ${apexY + hH * 0.34} ${g.cx - hoodTopW} ${apexY + 8}
      Q ${g.cx - hoodTopW - 2} ${apexY - 6} ${g.cx - hoodTopW * 0.5} ${apexY - 9}
      Q ${g.cx} ${apexY - 13} ${g.cx + hoodTopW * 0.5} ${apexY - 9}
      Q ${g.cx + hoodTopW + 2} ${apexY - 6} ${g.cx + hoodTopW} ${apexY + 8}
      C ${g.cx + hoodTopW + 8} ${apexY + hH * 0.34} ${g.SR.x - 2} ${g.shoulderY - hH * 0.4} ${g.SR.x - 14} ${g.shoulderY} Z`;
    s += `<path d="${hp}" fill="${flat ? '#fff' : shade(base, -6)}" stroke="${line}" stroke-width="${sw}"/>`;
    if (back) {
      s += tstitch(`M ${g.cx} ${apexY - 6} L ${g.cx} ${g.shoulderY + 2}`, stitchCol);
      // 뒷 후드 밑단(목둘레) 절개선
      s += tstitch(`M ${g.SL.x + 20} ${g.shoulderY + 2} Q ${g.cx} ${g.topY + neckDrop + 8} ${g.SR.x - 20} ${g.shoulderY + 2}`, stitchCol);
    }
  }

  // 소매
  s += `<path d="${sleevePath(g.slL)}" fill="${sleeveFill}" stroke="${line}" stroke-width="${sw}"/>`;
  s += `<path d="${sleevePath(g.slR)}" fill="${sleeveFill}" stroke="${line}" stroke-width="${sw}"/>`;

  // 몸판
  s += `<path d="${topBody(g, neckDrop, cfg)}" fill="${fill}" stroke="${line}" stroke-width="${sw}"/>`;
  if (!flat) s += `<path d="${topBody(g, neckDrop, cfg)}" fill="url(#smShade)" stroke="none"/>`;

  // 암홀 스티치
  s += tstitch(`M ${(g.SL.x + 4).toFixed(1)} ${(g.SL.y + 18).toFixed(1)} C ${g.SL.x + 6} ${g.SL.y + 20} ${g.AL.x} ${g.AL.y - 22} ${(g.AL.x + 3).toFixed(1)} ${(g.AL.y - 2).toFixed(1)}`, stitchCol);
  s += tstitch(`M ${(g.SR.x - 4).toFixed(1)} ${(g.SR.y + 18).toFixed(1)} C ${g.SR.x - 6} ${g.SR.y + 20} ${g.AR.x} ${g.AR.y - 22} ${(g.AR.x - 3).toFixed(1)} ${(g.AR.y - 2).toFixed(1)}`, stitchCol);

  // 소매부리: 리브 또는 접단 스티치
  [g.slL, g.slR].forEach(sl => {
    if (hasRib) {
      s += ribStraight(sl.cO, sl.cI, -sl.dir.x * ribC, -sl.dir.y * ribC, sleeveFill, line);
    } else {
      const o1 = addv(sl.cO, { x: -sl.dir.x, y: -sl.dir.y }, 7), i1 = addv(sl.cI, { x: -sl.dir.x, y: -sl.dir.y }, 7);
      s += tstitch(`M ${o1.x.toFixed(1)} ${o1.y.toFixed(1)} L ${i1.x.toFixed(1)} ${i1.y.toFixed(1)}`, stitchCol);
    }
  });

  // 밑단: 리브 또는 접단 더블 스티치
  if (hasRib) {
    s += ribStraight(g.HL, g.HR, 0, -ribH, fill, line);
  } else {
    s += tstitch(`M ${g.HL.x} ${g.HL.y - 8} L ${g.HR.x} ${g.HR.y - 8}`, stitchCol);
    s += tstitch(`M ${g.HL.x} ${g.HL.y - 11} L ${g.HR.x} ${g.HR.y - 11}`, stitchCol);
  }

  // 넥: 후드 / 카라 / 리브
  if (hasHood) {
    // 후드 개구부 (넥라인 따라 안감 + 바인딩)
    const oY = g.topY + neckDrop;
    if (!back) {
      s += `<path d="M ${g.NL.x} ${g.NL.y} C ${g.cx - g.neckHalf - 12} ${g.topY - hH * 0.48} ${g.cx} ${g.topY - hH * 0.6} ${g.NR.x} ${g.NR.y} Q ${g.cx} ${oY} ${g.NL.x} ${g.NL.y} Z" fill="${flat ? '#fff' : shade(base, -22)}" stroke="${line}" stroke-width="${sw}"/>`;
      // 후드 바인딩 더블 스티치
      s += tstitch(`M ${g.NL.x + 3} ${g.NL.y + 1} C ${g.cx - g.neckHalf - 4} ${g.topY - hH * 0.4} ${g.cx} ${g.topY - hH * 0.5} ${g.NR.x - 3} ${g.NR.y + 1}`, stitchCol);
    }
    // 넥 밴드
    s += `<path d="M ${g.NL.x} ${g.NL.y} Q ${g.cx} ${oY} ${g.NR.x} ${g.NR.y}" fill="none" stroke="${line}" stroke-width="${sw}"/>`;
  } else if (cfg.type === 'jacket' && d.collar) {
    if (back) {
      s += `<path d="M ${g.NL.x} ${g.NL.y} Q ${g.cx} ${g.topY - 9} ${g.NR.x} ${g.NR.y} Q ${g.cx} ${g.topY + neckDrop} ${g.NL.x} ${g.NL.y} Z" fill="${flat ? '#fff' : accent}" stroke="${line}" stroke-width="${sw}"/>`;
    } else {
      const cd = 22;
      s += `<path d="M ${g.NL.x} ${g.NL.y} L ${g.NL.x - 9} ${g.NL.y + cd} L ${g.cx} ${g.topY + neckDrop + 12} L ${g.NR.x + 9} ${g.NR.y + cd} L ${g.NR.x} ${g.NR.y} Q ${g.cx} ${g.topY + neckDrop} ${g.NL.x} ${g.NL.y} Z" fill="${flat ? '#fff' : accent}" stroke="${line}" stroke-width="${sw}"/>`;
      s += tstitch(`M ${g.NL.x - 6} ${g.NL.y + cd - 4} L ${g.cx} ${g.topY + neckDrop + 8} L ${g.NR.x + 6} ${g.NR.y + cd - 4}`, stitchCol);
    }
  } else {
    s += neckRibArc(g, neckDrop, fill, line);
  }

  // 어깨 봉제선 스티치
  s += tstitch(`M ${g.NL.x} ${g.NL.y + 2} Q ${g.cx - g.shoulderHalf * 0.5} ${g.topY + 3} ${g.SL.x} ${g.SL.y}`, stitchCol);
  s += tstitch(`M ${g.NR.x} ${g.NR.y + 2} Q ${g.cx + g.shoulderHalf * 0.5} ${g.topY + 3} ${g.SR.x} ${g.SR.y}`, stitchCol);

  // ===== 앞판 전용 =====
  if (!back) {
    // 지퍼 / 플래킷
    if (d.zipper || d.zipup) {
      const zy0 = g.topY + neckDrop;
      s += `<line x1="${g.cx}" y1="${zy0}" x2="${g.cx}" y2="${g.hemY - (hasRib ? ribH : 4)}" stroke="${line}" stroke-width="${sw}"/>`;
      s += tstitch(`M ${g.cx - 4} ${zy0} L ${g.cx - 4} ${g.hemY - (hasRib ? ribH : 4)}`, stitchCol);
      s += tstitch(`M ${g.cx + 4} ${zy0} L ${g.cx + 4} ${g.hemY - (hasRib ? ribH : 4)}`, stitchCol);
      for (let yy = zy0 + 6; yy < g.hemY - ribH; yy += 6) s += `<line x1="${g.cx - 2.4}" y1="${yy}" x2="${g.cx + 2.4}" y2="${yy}" stroke="${line}" stroke-width="0.7"/>`;
      s += `<rect x="${g.cx - 2.6}" y="${zy0 + 12}" width="5.2" height="9" rx="1.5" fill="${flat ? '#fff' : '#e5e7eb'}" stroke="${line}" stroke-width="0.9"/>`;
    }

    // 캥거루 포켓
    if (d.kangaroo) {
      const py0 = g.hemY - (hasRib ? ribH : 6) - 58, py1 = g.hemY - (hasRib ? ribH : 6) - 6;
      const pw0 = g.chestHalf * 0.92, pw1 = g.chestHalf * 0.52;
      const kp = `M ${g.cx - pw0} ${py0} L ${g.cx + pw0} ${py0} L ${g.cx + pw0} ${py1 - 18} L ${g.cx + pw1} ${py1} L ${g.cx - pw1} ${py1} L ${g.cx - pw0} ${py1 - 18} Z`;
      s += `<path d="${kp}" fill="none" stroke="${line}" stroke-width="${sw}"/>`;
      s += tstitch(`M ${g.cx - pw0 + 3} ${py0 + 3} L ${g.cx - pw1 + 2} ${py1 - 4}`, stitchCol);
      s += tstitch(`M ${g.cx + pw0 - 3} ${py0 + 3} L ${g.cx + pw1 - 2} ${py1 - 4}`, stitchCol);
    } else if (d.pocket && cfg.type === 'tee') {
      const px = g.cx + g.chestHalf * 0.32, py = g.shoulderY + 46, w = 28, h = 32;
      s += `<path d="M ${px} ${py} h ${w} v ${h} l ${-w / 2} 9 l ${-w / 2} -9 Z" fill="none" stroke="${line}" stroke-width="${sw}"/>`;
      s += tstitch(`M ${px + 2} ${py + 2} h ${w - 4} v ${h - 3} l ${-(w - 4) / 2} 7 l ${-(w - 4) / 2} -7 Z`, stitchCol);
    }

    // 단추 플래킷 (원피스/셔츠)
    if (d.button) {
      const y0 = g.topY + neckDrop, y1 = g.hemY - 10;
      s += tstitch(`M ${g.cx - 8} ${y0} L ${g.cx - 8} ${y1}`, stitchCol);
      s += tstitch(`M ${g.cx + 8} ${y0} L ${g.cx + 8} ${y1}`, stitchCol);
      for (let i = 0; i < 5; i++) {
        const y = y0 + 16 + i * ((y1 - y0 - 24) / 4);
        s += `<circle cx="${g.cx}" cy="${y}" r="2.8" fill="${flat ? '#fff' : '#eee'}" stroke="${line}" stroke-width="1"/>`;
      }
    }

    // 후드끈
    if (d.drawstring) {
      [-1, 1].forEach(sgn => {
        const x = g.cx + sgn * g.neckHalf * 0.55;
        s += `<line x1="${x}" y1="${g.topY + neckDrop + 2}" x2="${x}" y2="${g.topY + neckDrop + 50}" stroke="${line}" stroke-width="${sw}"/>`;
        s += `<circle cx="${x}" cy="${g.topY + neckDrop + 53}" r="2.8" fill="${flat ? '#fff' : accent}" stroke="${line}" stroke-width="1"/>`;
      });
    }

    // 리본
    if (d.ribbon) {
      const y = g.armpitY + 8;
      s += `<path d="M ${g.cx} ${y} l -22 -11 v 22 z M ${g.cx} ${y} l 22 -11 v 22 z" fill="${flat ? '#fff' : accent}" stroke="${line}" stroke-width="${sw}"/>`;
      s += `<circle cx="${g.cx}" cy="${y}" r="4.5" fill="${flat ? '#fff' : accent}" stroke="${line}" stroke-width="${sw}"/>`;
    }

    // 배치 요소
    s += renderPlacements(cfg, anchorsForTop(g), mode, line, g.SX, interactive);
    s += renderCutPoints(cfg, interactive);
  } else {
    // ===== 뒷판 전용 =====
    // 뒷목 요크 라인
    s += tstitch(`M ${g.SL.x + 6} ${g.shoulderY + 8} Q ${g.cx} ${g.topY + neckDrop + 14} ${g.SR.x - 6} ${g.shoulderY + 8}`, stitchCol);
    if (cfg.type === 'dress' || d.button) {
      // 뒷중심선
      s += tstitch(`M ${g.cx} ${g.topY + neckDrop} L ${g.cx} ${g.hemY - (hasRib ? ribH : 10)}`, stitchCol);
    }
    // 콜아웃 (디테일 지시) — 우측
    if (flat) {
      const items = [];
      items.push({ x: g.cx + g.neckHalf * 0.5, y: g.topY + neckDrop + 4, t: (cfg.type === 'jacket' && d.collar) ? '카라 2겹' : (hasRib ? '넥 리브 2x1' : '넥 바인딩') });
      items.push({ x: g.cx + g.shoulderHalf * 0.35, y: g.shoulderY + 8, t: '뒷요크 절개' });
      items.push({ x: g.slR.cc.x - 4, y: g.slR.cc.y - 2, t: hasRib ? '소매부리 리브' : '소매 1/4″st' });
      items.push({ x: g.cx + g.hemHalf * 0.45, y: g.hemY - (hasRib ? ribH / 2 : 9), t: hasRib ? '밑단 리브' : '밑단 더블 st' });
      if (cfg.type === 'hoodie' || d.hood) items.push({ x: g.cx, y: g.topY - g.hood * 1.6, t: '후드 2겹' });
      s += calloutColumn(items, 350, g.topY + 14, g.hemY - 10);
    }
  }

  // 프릴 밑단 (원피스) — 양면
  if (d.frill) {
    let fp = `M ${g.HL.x} ${g.hemY}`;
    const steps = 14, w = (g.HR.x - g.HL.x) / steps;
    for (let i = 0; i < steps; i++) fp += ` q ${(w / 2).toFixed(1)} 13 ${w.toFixed(1)} 0`;
    s += `<path d="${fp}" fill="none" stroke="${line}" stroke-width="${sw}"/>`;
  }

  // 도식 치수선 (앞판만)
  if (flat && !back) {
    s += dimLine(g.SL, g.SR, `어깨 ${cfg.measure.shoulder}`, { off: -(g.shoulderY - g.topY) - 22 });
    s += dimLine(g.AL, g.AR, `가슴 ${cfg.measure.chest}`, { off: 0 });
    s += dimLine(g.HL, g.HR, `밑단 ${cfg.measure.hem}`, { off: 36 });
    s += dimLine(pt(g.HR.x, g.topY), pt(g.HR.x, g.hemY), `총장 ${cfg.measure.length}`, { off: 52 });
    s += dimLine(g.slL.S, g.slL.cc, `소매 ${cfg.measure.sleeve}`, { off: 0 });
    if (cfg.measure.armhole != null) s += dimLine(g.SR, g.AR, `암홀 ${cfg.measure.armhole}`, { off: 14 });
  }

  // 편집 핸들 (앞면): 앵커(치수) + 베지어 컨트롤포인트
  if (interactive && cfg.editMode && !back) {
    const def = g.def, SX = g.SX, SY = g.SY, cx = g.cx, topY = g.topY;
    const mm = k => def.measure.find(m => m.key === k) || { min: 0, max: 99 };
    // 앵커(네모) — 드래그 시 치수 변경
    const A = (x, y, key, extra) => `<rect class="sm-h sm-anchor" data-h="size" data-key="${key}" data-min="${mm(key).min}" data-max="${mm(key).max}" ${extra} x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10"/>`;
    s += A(g.SR.x, g.SR.y, 'shoulder', `data-base="${cx}" data-scale="${SX}" data-axis="x" data-mult="2"`);
    s += A(g.AR.x, g.AR.y, 'chest', `data-base="${cx}" data-scale="${SX}" data-axis="x" data-mult="1"`);
    s += A(g.HR.x, g.HR.y, 'hem', `data-base="${cx}" data-scale="${SX}" data-axis="x" data-mult="1"`);
    s += A(g.NR.x, g.NR.y, 'neck', `data-base="${cx}" data-scale="${SX}" data-axis="x" data-mult="2"`);
    s += A(g.cx, g.hemY, 'length', `data-base="${topY}" data-scale="${SY}" data-axis="y" data-mult="1"`);
    s += `<rect class="sm-h sm-anchor" data-h="sleeve" data-key="sleeve" data-sx="${g.slR.S.x.toFixed(1)}" data-sy="${g.slR.S.y.toFixed(1)}" data-scale="${SY}" data-min="${mm('sleeve').min}" data-max="${mm('sleeve').max}" x="${(g.slR.cc.x - 5).toFixed(1)}" y="${(g.slR.cc.y - 5).toFixed(1)}" width="10" height="10"/>`;
    if (def.measure.find(m => m.key === 'armhole')) {
      s += `<rect class="sm-h sm-anchor" data-h="armhole" data-key="armhole" data-base="${g.shoulderY.toFixed(1)}" data-scale="${SY}" data-min="${mm('armhole').min}" data-max="${mm('armhole').max}" x="${(g.AR.x - 5).toFixed(1)}" y="${(g.armpitY - 5).toFixed(1)}" width="10" height="10"/>`;
    }
    // 베지어 컨트롤포인트 핸들 (우측 — 좌측은 대칭 자동)
    const bc = topBodyControls(g);
    const CP = [
      ['shoulder_c', g.SR], ['armhole_c1', g.SR], ['armhole_c2', g.AR],
      ['side_c1', g.AR], ['side_c2', g.HR], ['hem_c', pt(g.HR.x, g.hemY)],
    ];
    CP.forEach(([key, anchor]) => {
      const base = bc[key];
      const p = ctrlPt(cfg, key, base);
      s += `<line class="sm-ctrl-line" x1="${anchor.x.toFixed(1)}" y1="${anchor.y.toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}"/>`;
      s += `<circle class="sm-h sm-h-ctrl" data-h="ctrl" data-key="${key}" data-bx="${base.x.toFixed(1)}" data-by="${base.y.toFixed(1)}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"/>`;
    });
  }

  // 세로 중앙 정렬 (편집모드는 고정 → 드래그 좌표 안정)
  const topEdge = (hasHood ? g.topY - hH - 4 : g.topY) - (flat ? 24 : 6);
  const botEdge = g.hemY + (flat ? 46 : 6);
  const dy = cfg.editMode ? (hasHood ? hH - 30 : 0) : 280 - (topEdge + botEdge) / 2;
  return `<g transform="translate(0 ${dy.toFixed(1)})">${s}</g>`;
}

// 미리보기는 앞면만
function drawTop(cfg, mode) { return drawTopView(cfg, mode, 'front'); }

// ---------------------------------------------------------------------------
// 하의(pants) 그리기 — 곡선 + 리브 + 스티치 + 앞/뒷판
// ---------------------------------------------------------------------------
function drawPantsView(cfg, mode, view, interactive) {
  const def = garmentDef(cfg.type);
  const SX = 3.0, SY = 3.4, cx = 200, topY = 70;
  const v = k => {
    const f = def.measure.find(m => m.key === k);
    return Number(cfg.measure[k] ?? (f ? f.def : 0));
  };
  const waistHalf = v('waist') * SX;
  const hipHalf = v('hip') * SX;
  const riseY = v('rise') * SY;
  const length = v('length') * SY;
  const legHem = v('hem') * SX;
  const centerGap = 4;
  const d = cfg.details || {};
  const flat = mode === 'flat';
  const back = view === 'back';
  const base = cfg.color ? cfg.color.hex : '#cccccc';
  const fill = flat ? '#ffffff' : base;
  const line = flat ? '#1f1f1f' : shade(base, isLight(base) ? -30 : -18);
  const sw = flat ? 1.8 : 1.5;
  const stitchCol = flat ? '#8a8a8a' : shade(base, isLight(base) ? -16 : 14);

  const waistY = topY;
  const hipY = topY + riseY * 0.62;
  const crotchY = topY + riseY;
  const hemY = topY + length;
  const kneeY = crotchY + (hemY - crotchY) * 0.5;
  const bandH = 16;

  const WL = pt(cx - waistHalf, waistY), WR = pt(cx + waistHalf, waistY);
  const HipL = pt(cx - hipHalf, hipY), HipR = pt(cx + hipHalf, hipY);
  const crotch = pt(cx, crotchY);
  const LhemIn = pt(cx - centerGap, hemY), LhemOut = pt(cx - centerGap - legHem, hemY);
  const RhemIn = pt(cx + centerGap, hemY), RhemOut = pt(cx + centerGap + legHem, hemY);
  const legCenterL = (HipL.x + cx) / 2, legCenterR = (HipR.x + cx) / 2;
  const hemCenterL = (LhemOut.x + LhemIn.x) / 2, hemCenterR = (RhemOut.x + RhemIn.x) / 2;

  let s = '';
  const path = `M ${WL.x} ${WL.y}
    Q ${cx - hipHalf - 2} ${(waistY + hipY) / 2} ${HipL.x} ${HipL.y}
    C ${HipL.x} ${crotchY} ${LhemOut.x - 6} ${kneeY} ${LhemOut.x} ${LhemOut.y}
    L ${LhemIn.x} ${LhemIn.y}
    C ${LhemIn.x} ${kneeY} ${cx - 3} ${crotchY + (hemY - crotchY) * 0.22} ${crotch.x} ${crotch.y}
    C ${cx + 3} ${crotchY + (hemY - crotchY) * 0.22} ${RhemIn.x} ${kneeY} ${RhemIn.x} ${RhemIn.y}
    L ${RhemOut.x} ${RhemOut.y}
    C ${RhemOut.x + 6} ${kneeY} ${HipR.x} ${crotchY} ${HipR.x} ${HipR.y}
    Q ${cx + hipHalf + 2} ${(waistY + hipY) / 2} ${WR.x} ${WR.y} Z`;
  s += `<path d="${path}" fill="${fill}" stroke="${line}" stroke-width="${sw}"/>`;
  if (!flat) s += `<path d="${path}" fill="url(#smShade)" stroke="none"/>`;

  // 아웃심/인심 스티치
  s += tstitch(`M ${HipL.x - 0.5} ${HipL.y + 2} C ${HipL.x} ${crotchY} ${LhemOut.x - 5} ${kneeY} ${LhemOut.x + 2} ${LhemOut.y - 3}`, stitchCol);
  s += tstitch(`M ${HipR.x + 0.5} ${HipR.y + 2} C ${HipR.x} ${crotchY} ${RhemOut.x + 5} ${kneeY} ${RhemOut.x - 2} ${RhemOut.y - 3}`, stitchCol);

  // 허리밴드
  s += `<line x1="${WL.x}" y1="${waistY + bandH}" x2="${WR.x}" y2="${waistY + bandH}" stroke="${line}" stroke-width="${sw}"/>`;
  if (d.banding || cfg.type === 'pants') {
    for (let i = 1; i < 22; i++) {
      const x = WL.x + (WR.x - WL.x) * (i / 22);
      s += `<line x1="${x.toFixed(1)}" y1="${waistY + 1}" x2="${x.toFixed(1)}" y2="${waistY + bandH - 1}" stroke="${line}" stroke-width="0.5"/>`;
    }
  } else {
    s += tstitch(`M ${WL.x} ${waistY + 4} L ${WR.x} ${waistY + 4}`, stitchCol);
    s += tstitch(`M ${WL.x} ${waistY + bandH - 4} L ${WR.x} ${waistY + bandH - 4}`, stitchCol);
    // 벨트고리
    [-0.6, 0, 0.6].forEach(f => { const x = cx + f * waistHalf; s += `<rect x="${(x - 2).toFixed(1)}" y="${waistY - 2}" width="4" height="${bandH + 3}" fill="none" stroke="${line}" stroke-width="0.9"/>`; });
  }

  // 다리 주름선
  s += `<line x1="${hemCenterL.toFixed(1)}" y1="${crotchY + 6}" x2="${hemCenterL.toFixed(1)}" y2="${hemY - 4}" stroke="${line}" stroke-width="0.6" stroke-dasharray="2 3" opacity="0.65"/>`;
  s += `<line x1="${hemCenterR.toFixed(1)}" y1="${crotchY + 6}" x2="${hemCenterR.toFixed(1)}" y2="${hemY - 4}" stroke="${line}" stroke-width="0.6" stroke-dasharray="2 3" opacity="0.65"/>`;

  // 허리끈
  if (d.drawstring && !back) {
    s += `<line x1="${cx - 16}" y1="${waistY + bandH}" x2="${cx - 16}" y2="${waistY + bandH + 26}" stroke="${line}" stroke-width="${sw}"/>`;
    s += `<line x1="${cx + 16}" y1="${waistY + bandH}" x2="${cx + 16}" y2="${waistY + bandH + 26}" stroke="${line}" stroke-width="${sw}"/>`;
    s += `<circle cx="${cx - 16}" cy="${waistY + bandH + 29}" r="2.4" fill="${line}"/><circle cx="${cx + 16}" cy="${waistY + bandH + 29}" r="2.4" fill="${line}"/>`;
  }

  if (!back) {
    // 앞 지퍼(플라이) J-스티치
    s += tstitch(`M ${cx} ${waistY + bandH} L ${cx} ${crotchY - 6} Q ${cx} ${crotchY} ${cx - 12} ${crotchY - 2}`, stitchCol);
    s += `<line x1="${cx}" y1="${waistY + bandH}" x2="${cx}" y2="${crotchY}" stroke="${line}" stroke-width="0.8"/>`;
    // 앞 사이드 포켓
    if (d.pocket) {
      [-1, 1].forEach(sgn => {
        s += tstitch(`M ${cx + sgn * (waistHalf - 4)} ${waistY + bandH + 4} q ${sgn * 16} 10 ${sgn * 18} 32`, stitchCol);
      });
    }
  } else {
    // 뒷요크 + 뒷중심
    s += tstitch(`M ${WL.x + 4} ${waistY + bandH + 12} Q ${cx} ${waistY + bandH + 22} ${WR.x - 4} ${waistY + bandH + 12}`, stitchCol);
    s += tstitch(`M ${cx} ${waistY + bandH} L ${cx} ${crotchY}`, stitchCol);
    // 뒷 패치 포켓
    [-1, 1].forEach(sgn => {
      const pw = Math.min(46, hipHalf * 0.62), px = cx + sgn * hipHalf * 0.42, py = waistY + bandH + 26;
      s += `<path d="M ${px - pw / 2} ${py} h ${pw} v ${pw * 0.7} l ${-pw / 2} ${pw * 0.28} l ${-pw / 2} ${-pw * 0.28} Z" fill="none" stroke="${line}" stroke-width="${sw}"/>`;
      s += tstitch(`M ${px - pw / 2 + 2} ${py + 2} h ${pw - 4}`, stitchCol);
    });
    // 콜아웃
    if (flat) {
      const items = [
        { x: cx + waistHalf * 0.5, y: waistY + bandH / 2, t: (d.banding || cfg.type === 'pants') ? '허리 밴딩' : '벨트고리' },
        { x: cx + hipHalf * 0.42, y: waistY + bandH + 40, t: '뒷 패치포켓' },
        { x: cx + hipHalf * 0.8, y: hipY + 30, t: '아웃심 1/4″st' },
        { x: hemCenterR, y: hemY - 8, t: d.jogger ? '조거 리브' : '밑단 더블 st' },
      ];
      s += calloutColumn(items, 350, waistY + 6, hemY - 16);
    }
  }

  // 카고 포켓 (양면 다리)
  if (d.cargo) {
    [legCenterL, legCenterR].forEach(px => {
      const py = crotchY + (hemY - crotchY) * 0.36;
      const w = Math.min(36, legHem * 0.72);
      s += `<rect x="${(px - w / 2).toFixed(1)}" y="${py.toFixed(1)}" width="${w.toFixed(1)}" height="${(w + 6).toFixed(1)}" rx="3" fill="none" stroke="${line}" stroke-width="${sw}"/>`;
      s += `<path d="M ${(px - w / 2).toFixed(1)} ${(py + 9).toFixed(1)} h ${w.toFixed(1)}" stroke="${line}" stroke-width="0.9" fill="none"/>`;
      s += tstitch(`M ${(px - w / 2 + 2).toFixed(1)} ${(py + 12).toFixed(1)} v ${(w - 6).toFixed(1)}`, stitchCol);
    });
  }
  // 무릎 보강
  if (d.kneePatch) {
    [legCenterL, legCenterR].forEach(px => {
      const w = Math.min(42, legHem * 0.84);
      s += `<rect x="${(px - w / 2).toFixed(1)}" y="${(kneeY - 22).toFixed(1)}" width="${w.toFixed(1)}" height="46" rx="4" fill="none" stroke="${line}" stroke-width="0.9" stroke-dasharray="4 3"/>`;
    });
  }
  // 조거 리브 밑단
  if (d.jogger) {
    s += ribStraight(LhemOut, LhemIn, 0, -14, fill, line);
    s += ribStraight(RhemIn, RhemOut, 0, -14, fill, line);
  } else {
    // 밑단 접단 스티치
    s += tstitch(`M ${LhemOut.x} ${hemY - 7} L ${LhemIn.x} ${hemY - 7}`, stitchCol);
    s += tstitch(`M ${RhemIn.x} ${hemY - 7} L ${RhemOut.x} ${hemY - 7}`, stitchCol);
  }

  // 배치 요소 (앞면만)
  if (!back) {
    const pantsAnchors = {
      leftHip: { x: cx - hipHalf * 0.55, y: hipY + 12 }, rightHip: { x: cx + hipHalf * 0.55, y: hipY + 12 },
      leftThigh: { x: legCenterL, y: kneeY - 18 }, rightThigh: { x: legCenterR, y: kneeY - 18 },
      leftAnkle: { x: hemCenterL, y: hemY - 42 }, rightAnkle: { x: hemCenterR, y: hemY - 42 },
    };
    s += renderPlacements(cfg, pantsAnchors, mode, line, SX, interactive);
    s += renderCutPoints(cfg, interactive);
  }

  // 도식 치수선 (앞면만)
  if (flat && !back) {
    s += dimLine(WL, WR, `허리 ${cfg.measure.waist}`, { off: -22 });
    s += dimLine(HipL, HipR, `엉덩이 ${cfg.measure.hip}`, { off: 0 });
    s += dimLine(pt(WR.x + 4, waistY), pt(WR.x + 4, hemY), `총장 ${cfg.measure.length}`, { off: 44 });
    s += dimLine(LhemOut, LhemIn, `밑단 ${cfg.measure.hem}`, { off: 28 });
    s += dimLine(pt(WL.x - 4, waistY), pt(WL.x - 4, crotchY), `밑위 ${cfg.measure.rise}`, { off: -36 });
  }

  // 치수 핸들 (앞면만)
  if (interactive && cfg.editMode && !back) {
    const mm = k => def.measure.find(m => m.key === k) || { min: 0, max: 99 };
    const H = (x, y, key, base, scale, axis, mult) => { const m = mm(key); return `<circle class="sm-h sm-h-size" data-h="size" data-key="${key}" data-base="${base}" data-scale="${scale}" data-axis="${axis}" data-mult="${mult}" data-min="${m.min}" data-max="${m.max}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>`; };
    s += H(WR.x, waistY, 'waist', cx, SX, 'x', 1);
    s += H(HipR.x, hipY, 'hip', cx, SX, 'x', 1);
    s += H(RhemOut.x, hemY, 'hem', cx, SX, 'x', 1);
    s += H(cx, hemY, 'length', topY, SY, 'y', 1);
    s += H(cx + 30, crotchY, 'rise', topY, SY, 'y', 1);
  }

  // 세로 중앙 정렬 (편집모드 고정)
  const dy = cfg.editMode ? 6 : Math.max(10, (560 - (hemY - topY)) / 2 - topY + 10);
  return `<g transform="translate(0 ${dy.toFixed(1)})">${s}</g>`;
}

// ---------------------------------------------------------------------------
// 배치 요소 (로고/프린트/포켓/자수/라벨) — 자유 위치·크기
// ---------------------------------------------------------------------------
export const PLACEMENT_KINDS = [
  { kind: 'logo',       label: '로고',   icon: 'ph-image-square', size: 8,  file: true },
  { kind: 'print',      label: '프린트', icon: 'ph-paint-brush',  size: 16, file: true },
  { kind: 'pocket',     label: '포켓',   icon: 'ph-wallet',       size: 11, file: false },
  { kind: 'embroidery', label: '자수',   icon: 'ph-needle',       size: 6,  file: true },
  { kind: 'label',      label: '라벨',   icon: 'ph-tag',          size: 5,  file: false },
];
export const PLACEMENT_POSITIONS = {
  top: [
    { key: 'leftChest', label: '좌가슴' }, { key: 'rightChest', label: '우가슴' },
    { key: 'centerChest', label: '가슴중앙' }, { key: 'centerBig', label: '중앙(대형)' },
    { key: 'leftHem', label: '좌하단' }, { key: 'rightHem', label: '우하단' }, { key: 'centerHem', label: '중앙하단' },
    { key: 'leftSleeve', label: '좌소매' }, { key: 'rightSleeve', label: '우소매' },
  ],
  pants: [
    { key: 'leftHip', label: '좌힙' }, { key: 'rightHip', label: '우힙' },
    { key: 'leftThigh', label: '좌허벅지' }, { key: 'rightThigh', label: '우허벅지' },
    { key: 'leftAnkle', label: '좌밑단' }, { key: 'rightAnkle', label: '우밑단' },
  ],
};
export function placementKindMeta(kind) { return PLACEMENT_KINDS.find(k => k.kind === kind) || PLACEMENT_KINDS[0]; }
export function placementPosLabel(cfg, posKey) {
  const cat = garmentDef(cfg.type).category;
  const found = (PLACEMENT_POSITIONS[cat] || []).find(p => p.key === posKey);
  return found ? found.label : posKey;
}

function anchorsForTop(g) {
  return {
    leftChest:   { x: g.cx - g.chestHalf * 0.5, y: g.shoulderY + 42 },
    rightChest:  { x: g.cx + g.chestHalf * 0.5, y: g.shoulderY + 42 },
    centerChest: { x: g.cx, y: g.shoulderY + 50 },
    centerBig:   { x: g.cx, y: (g.shoulderY + g.hemY) / 2 - 6 },
    leftHem:     { x: g.cx - g.hemHalf * 0.5, y: g.hemY - 48 },
    rightHem:    { x: g.cx + g.hemHalf * 0.5, y: g.hemY - 48 },
    centerHem:   { x: g.cx, y: g.hemY - 48 },
    leftSleeve:  { x: g.slL.cc.x, y: g.slL.cc.y - 14 },
    rightSleeve: { x: g.slR.cc.x, y: g.slR.cc.y - 14 },
  };
}

// 배치 요소 렌더링. mode: 'preview' | 'flat'
function renderPlacements(cfg, anchors, mode, line, sx, interactive) {
  const flat = mode === 'flat';
  const edit = interactive && cfg.editMode;
  let s = '';
  (cfg.placements || []).forEach(p => {
    const a = anchors[p.pos] || Object.values(anchors)[0];
    if (!a) return;
    const size = Math.max(10, (Number(p.sizeCm) || 8) * sx);
    const meta = placementKindMeta(p.kind);
    // 자유좌표(fx/fy)가 있으면 우선
    const cx = (p.fx != null) ? p.fx : a.x, cy = (p.fy != null) ? p.fy : a.y;
    let b = '';        // 이 배치의 그래픽
    let halfH = size * 0.5;

    if (p.kind === 'pocket') {
      const w = size, h = size * 1.05, x = cx - w / 2, y = cy - h / 2; halfH = h / 2;
      b += `<path d="M ${x} ${y} h ${w} v ${h * 0.74} l ${-w / 2} ${h * 0.26} l ${-w / 2} ${-h * 0.26} Z" fill="${flat ? '#fff' : 'rgba(0,0,0,0.04)'}" stroke="${line}" stroke-width="${flat ? 1.6 : 1.4}"/>`;
      b += `<line x1="${x}" y1="${y + 5}" x2="${x + w}" y2="${y + 5}" stroke="${line}" stroke-width="${flat ? 1.2 : 1}"/>`;
    } else if (p.kind === 'embroidery') {
      const r = size / 2; halfH = r;
      if (p.dataUrl && !flat) {
        b += `<clipPath id="smclip-${p.id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`;
        b += `<image href="${p.dataUrl}" x="${cx - r}" y="${cy - r}" width="${r * 2}" height="${r * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#smclip-${p.id})"/>`;
        b += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${line}" stroke-width="1.2"/>`;
      } else {
        b += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${flat ? '#fff' : 'rgba(0,0,0,0.06)'}" stroke="${line}" stroke-width="1.2" ${flat ? 'stroke-dasharray="3 2"' : ''}/>`;
        if (flat) b += `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="8" fill="#999">자수</text>`;
      }
    } else if (p.kind === 'label') {
      const w = size, h = size * 0.66, x = cx - w / 2, y = cy - h / 2; halfH = h / 2;
      b += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${flat ? '#fff' : 'rgba(0,0,0,0.05)'}" stroke="${line}" stroke-width="1" ${flat ? 'stroke-dasharray="3 2"' : ''}/>`;
      if (flat) b += `<text x="${cx}" y="${cy + 3}" text-anchor="middle" font-size="8" fill="#999">라벨</text>`;
    } else {
      const w = size, h = size * (p.kind === 'print' ? 0.85 : 0.7), x = cx - w / 2, y = cy - h / 2; halfH = h / 2;
      if (p.dataUrl && !flat) {
        b += `<image href="${p.dataUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
      } else {
        const dash = flat ? 'stroke-dasharray="4 3"' : '';
        const bg = flat ? '#fff' : 'rgba(0,0,0,0.06)';
        b += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${bg}" stroke="${line}" stroke-width="1" ${dash}/>`;
        b += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="${flat ? 10 : 12}" fill="${flat ? '#999' : line}">${meta.label}</text>`;
      }
    }
    if (flat) b += `<text x="${cx}" y="${cy + halfH + 12}" text-anchor="middle" font-size="9" fill="#e3000f">${p.sizeCm || 8}cm</text>`;

    if (edit) {
      const half = size / 2;
      s += `<g class="sm-pl-node" data-id="${p.id}" data-sx="${sx}" data-cx="${cx.toFixed(1)}" data-cy="${cy.toFixed(1)}" style="cursor:move">`;
      s += `<rect x="${cx - half}" y="${cy - halfH}" width="${size}" height="${halfH * 2}" fill="transparent"/>`;  // 드래그 히트영역
      s += b;
      s += `<rect x="${cx - half}" y="${cy - halfH}" width="${size}" height="${halfH * 2}" fill="none" stroke="#3b82f6" stroke-width="0.8" stroke-dasharray="3 2" pointer-events="none"/>`;
      s += `<circle class="sm-pl-resize" data-id="${p.id}" data-cx="${cx.toFixed(1)}" data-cy="${cy.toFixed(1)}" data-sx="${sx}" cx="${(cx + half).toFixed(1)}" cy="${(cy + halfH).toFixed(1)}" r="5"/>`;
      s += `</g>`;
    } else {
      s += b;
    }
  });
  return s;
}

// ---------------------------------------------------------------------------
// SVG 래퍼
// ---------------------------------------------------------------------------
const SM_DEFS = `
    <defs>
      <linearGradient id="smShade" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28"/>
        <stop offset="45%" stop-color="#ffffff" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.16"/>
      </linearGradient>
    </defs>`;

function svgWrap(inner, mode) {
  return `<svg viewBox="0 0 400 560" class="sm-svg sm-svg-${mode}" xmlns="http://www.w3.org/2000/svg">${SM_DEFS}${inner}</svg>`;
}

function drawView(cfg, mode, view, interactive) {
  return garmentDef(cfg.type).category === 'pants' ? drawPantsView(cfg, mode, view, interactive) : drawTopView(cfg, mode, view, interactive);
}

// 미리보기: 앞면만 (컬러). interactive=true면 편집 핸들 포함(인쇄 X)
export function garmentPreviewSVG(cfg, interactive) {
  return svgWrap(drawView(cfg, 'preview', 'front', interactive), 'preview');
}

// 도식: FRONT + BACK 나란히
export function garmentFlatSVG(cfg, interactive) {
  const front = drawView(cfg, 'flat', 'front', interactive);
  const back = drawView(cfg, 'flat', 'back', interactive);
  return `<svg viewBox="0 0 900 600" class="sm-svg sm-svg-flat" xmlns="http://www.w3.org/2000/svg">${SM_DEFS}
    <g transform="translate(0,0)">${front}<text x="200" y="588" text-anchor="middle" class="sm-viewlabel">FRONT</text></g>
    <g transform="translate(470,0)">${back}<text x="200" y="588" text-anchor="middle" class="sm-viewlabel">BACK</text></g>
  </svg>`;
}

// ---------------------------------------------------------------------------
// 패턴 피스 생성 (편집된 곡선 반영) — 앞/뒤판 + 소매 / 바지 다리
// ---------------------------------------------------------------------------
function sampQ(p0, c, p1, n) { const a = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; a.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y }); } return a; }
function sampC(p0, c1, c2, p1, n) { const a = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; a.push({ x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y }); } return a; }
function sampL(p0, p1, n) { const a = []; for (let i = 0; i <= n; i++) { const t = i / n; a.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }); } return a; }
function catP(...segs) { const o = []; segs.forEach((s, i) => s.forEach((p, j) => { if (i > 0 && j === 0) return; o.push(p); })); return o; }
function bboxP(pts) { let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9; pts.forEach(p => { mnx = Math.min(mnx, p.x); mny = Math.min(mny, p.y); mxx = Math.max(mxx, p.x); mxy = Math.max(mxy, p.y); }); return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny }; }
function poly2path(pts) { return 'M ' + pts.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ') + ' Z'; }
function offsetPoly(pts, d, foldX) {
  const n = pts.length; let cx = 0, cy = 0; pts.forEach(p => { cx += p.x; cy += p.y; }); cx /= n; cy /= n;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    let tx = b.x - a.x, ty = b.y - a.y; const l = Math.hypot(tx, ty) || 1;
    let nx = -ty / l, ny = tx / l;
    if ((p.x + nx - cx) ** 2 + (p.y + ny - cy) ** 2 < (p.x - cx) ** 2 + (p.y - cy) ** 2) { nx = -nx; ny = -ny; }
    let ox = p.x + nx * d, oy = p.y + ny * d;
    if (foldX != null && Math.abs(p.x - foldX) < 0.8) ox = p.x;  // 골선은 시접 없음
    return { x: ox, y: oy };
  });
}

// ---------------------------------------------------------------------------
// 절개선 기준 패턴 조각 분할 (도식과 동일 좌표계이므로 직접 매핑)
// ---------------------------------------------------------------------------
function cutlinePolyline(pts, perSeg = 14) {
  if (!pts || pts.length < 2) return [];
  if (pts.length === 2) return [{ x: pts[0].x, y: pts[0].y }, { x: pts[1].x, y: pts[1].y }];
  const out = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    for (let j = 1; j <= perSeg; j++) {
      const t = j / perSeg, u = 1 - t;
      out.push({ x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x, y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y });
    }
  }
  return out;
}
function _segX(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y, d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y, t, u };
}
function _pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
// 닫힌 폴리곤 V를 열린 폴리라인 C로 2분할. 경계 교차 정확히 2개일 때만 [poly1, poly2] 반환.
function splitPolyByPolyline(V, C) {
  const n = V.length, cross = [];
  for (let ci = 0; ci < C.length - 1; ci++) {
    for (let vi = 0; vi < n; vi++) {
      const it = _segX(C[ci], C[ci + 1], V[vi], V[(vi + 1) % n]);
      if (it && !cross.some(x => Math.abs(x.x - it.x) < 0.5 && Math.abs(x.y - it.y) < 0.5)) {
        cross.push({ x: it.x, y: it.y, edge: vi, tEdge: it.u, pos: ci + it.t });
      }
    }
  }
  if (cross.length !== 2) return null;
  cross.sort((a, b) => a.pos - b.pos);
  const X0 = cross[0], X1 = cross[1];
  const s0 = Math.floor(X0.pos), s1 = Math.floor(X1.pos);
  const cutMid = C.slice(s0 + 1, s1 + 1);
  let A = X0, B = X1, interior = cutMid.slice();
  if ((X0.edge + X0.tEdge) > (X1.edge + X1.tEdge)) { A = X1; B = X0; interior = cutMid.slice().reverse(); }
  const eA = A.edge, eB = B.edge, arc1 = [], arc2 = [];
  for (let k = eA + 1; k <= eB; k++) arc1.push(V[k % n]);
  for (let k = eB + 1; k <= eA + n; k++) arc2.push(V[k % n]);
  const poly1 = [{ x: A.x, y: A.y }, ...arc1, { x: B.x, y: B.y }, ...interior.slice().reverse()];
  const poly2 = [{ x: B.x, y: B.y }, ...arc2, { x: A.x, y: A.y }, ...interior];
  if (poly1.length < 3 || poly2.length < 3) return null;
  return [poly1, poly2];
}
function _grainFor(poly) { const bb = bboxP(poly), gx = bb.x + bb.w * 0.46; return [{ x: gx, y: bb.y + 16 }, { x: gx, y: bb.y + bb.h - 14 }]; }
// 몸판 조각을 절개선들로 분해 → 시접 포함 개별 조각 배열
function explodePiece(piece) {
  const cuts = (piece.cutlines || []).filter(c => (c.pts || []).length >= 2);
  if (!cuts.length) return [piece];
  let parts = [{ ...piece, cutlines: [] }];
  const failed = [];
  cuts.forEach(c => {
    const poly = cutlinePolyline(c.pts);
    const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
    const minx = Math.min(...xs), maxx = Math.max(...xs), spanY = Math.max(...ys) - Math.min(...ys);
    // 중심(골선) 근처 세로 절개 → 골선재단 해제(중심에 시접 추가, 좌우 2장 재단)
    if (piece.foldX != null && (maxx - minx) < 22 && Math.abs((minx + maxx) / 2 - piece.foldX) < 16 && spanY > 60) {
      parts = parts.map(p => ({ ...p, foldX: null, cut: '2 · 중심절개(좌우 대칭)' }));
      return;
    }
    const next = [];
    let did = false;
    parts.forEach(sp => {
      const r = splitPolyByPolyline(sp.pts, poly);
      if (r) {
        did = true;
        r.forEach(pp => {
          const hasFold = sp.foldX != null && pp.some(v => Math.abs(v.x - sp.foldX) < 1.2);
          next.push({ label: sp.label, cut: hasFold ? '골선재단' : '2', pts: pp, foldX: hasFold ? sp.foldX : null, dims: (sp.dims || []).filter(d => _pointInPoly(d, pp)), grain: _grainFor(pp), cutlines: [] });
        });
      } else next.push(sp);
    });
    if (did) parts = next; else failed.push(c);
  });
  if (failed.length) parts.forEach(p => { p.cutlines = failed; });
  if (parts.length > 1) { const marks = ['①', '②', '③', '④', '⑤', '⑥']; parts.forEach((p, i) => { p.label = `${p.label} ${marks[i] || (i + 1)}`; }); }
  return parts;
}

function topPatternPieces(cfg) {
  const g = topGeom(cfg), bc = topBodyControls(g), cx = g.cx, N = 12;
  const cp = k => ctrlPt(cfg, k, bc[k]);
  const sh = cp('shoulder_c'), a1 = cp('armhole_c1'), a2 = cp('armhole_c2'), s1 = cp('side_c1'), s2 = cp('side_c2'), hm = cp('hem_c');
  const M = cfg.measure;
  const mkBody = (neckDrop, label) => {
    const neckY = g.topY + neckDrop, center = { x: cx, y: neckY };
    const pts = catP(
      sampQ(center, { x: (cx + g.NR.x) / 2, y: neckY }, g.NR, N),       // 넥 (중심→어깨끝)
      sampQ(g.NR, sh, g.SR, N),                                          // 어깨
      sampC(g.SR, a1, a2, g.AR, N),                                      // 암홀
      sampC(g.AR, s1, s2, g.HR, N),                                      // 옆선
      sampQ(g.HR, { x: (g.HR.x + cx) / 2, y: hm.y }, { x: cx, y: g.hemY }, N), // 밑단
      sampL({ x: cx, y: g.hemY }, center, N)                             // 중심(골선)
    );
    const dims = [
      { x: (cx + g.NR.x) / 2, y: neckY + 14, t: `목½ ${(M.neck / 2).toFixed(1)}` },
      { x: (g.NR.x + g.SR.x) / 2 + 8, y: (g.NR.y + g.SR.y) / 2 - 6, t: `어깨½ ${(M.shoulder / 2).toFixed(1)}`, a: 'start' },
      { x: g.AR.x + 6, y: (g.SR.y + g.AR.y) / 2, t: `암홀 ${M.armhole}`, a: 'start' },
      { x: (cx + g.AR.x) / 2, y: g.armpitY - 7, t: `가슴단면 ${M.chest}` },
      { x: cx + 6, y: (neckY + g.hemY) / 2, t: `총장 ${M.length}`, a: 'start' },
      { x: (cx + g.HR.x) / 2, y: g.hemY + 15, t: `밑단 ${M.hem}` },
    ];
    return { label, cut: '1 · 골선재단', pts, foldX: cx, dims, grain: [{ x: cx + (g.HR.x - cx) * 0.42, y: neckY + 18 }, { x: cx + (g.HR.x - cx) * 0.42, y: g.hemY - 16 }], cutlines: (cfg.cutlines || []) };
  };
  const capW = Math.hypot(g.SR.x - g.AR.x, g.SR.y - g.AR.y) * 1.05, half = capW / 2;
  const L = g.slL.L, cuffH = g.cuffHalf, sc = 200, y0 = 40;
  const capL = { x: sc - half, y: y0 }, capR = { x: sc + half, y: y0 };
  const cuffL = { x: sc - cuffH, y: y0 + L }, cuffR = { x: sc + cuffH, y: y0 + L };
  const sleevePts = catP(
    sampQ(capL, { x: sc, y: y0 - half * 0.3 }, capR, N),  // 소매산
    sampL(capR, cuffR, N),
    sampL(cuffR, cuffL, 3),
    sampL(cuffL, capL, N)
  );
  const sleeveDims = [
    { x: sc, y: y0 - half * 0.3 - 4, t: `소매산둘레 ${M.armhole}` },
    { x: capR.x + 6, y: (y0 + y0 + L) / 2, t: `소매 ${M.sleeve}`, a: 'start' },
    { x: sc, y: y0 + L + 15, t: `부리 ${M.cuffOpening}` },
  ];
  const sleeve = { label: '소매 SLEEVE', cut: '2', pts: sleevePts, foldX: null, dims: sleeveDims, grain: [{ x: sc, y: y0 + 22 }, { x: sc, y: y0 + L - 16 }] };
  return [mkBody(g.neckDropF, '앞판 FRONT'), mkBody(g.neckDropB, '뒤판 BACK'), sleeve];
}

function pantsPatternPieces(cfg) {
  const def = garmentDef(cfg.type), SX = 3.0, SY = 3.4, cx = 200, topY = 70, N = 12;
  const v = k => { const f = def.measure.find(m => m.key === k); return Number(cfg.measure[k] ?? (f ? f.def : 0)); };
  const waistHalf = v('waist') * SX, hipHalf = v('hip') * SX, riseY = v('rise') * SY, length = v('length') * SY, legHem = v('hem') * SX, gap = 4;
  const waistY = topY, hipY = topY + riseY * 0.62, crotchY = topY + riseY, hemY = topY + length, kneeY = crotchY + (hemY - crotchY) * 0.5;
  const WR = { x: cx + waistHalf, y: waistY }, HipR = { x: cx + hipHalf, y: hipY };
  const RhemIn = { x: cx + gap, y: hemY }, RhemOut = { x: cx + gap + legHem, y: hemY }, crotch = { x: cx, y: crotchY };
  const leg = label => {
    const pts = catP(
      sampL({ x: cx, y: waistY }, WR, 3),
      sampC(WR, { x: WR.x, y: (waistY + hipY) / 2 }, { x: HipR.x, y: hipY - 4 }, HipR, N),
      sampC(HipR, { x: HipR.x, y: crotchY }, { x: RhemOut.x + 6, y: kneeY }, RhemOut, N),
      sampL(RhemOut, RhemIn, 3),
      sampC(RhemIn, { x: RhemIn.x, y: kneeY }, { x: cx + 3, y: crotchY + (hemY - crotchY) * 0.22 }, crotch, N),
      sampL(crotch, { x: cx, y: waistY }, N)
    );
    const M = cfg.measure, midLeg = (RhemOut.x + RhemIn.x) / 2;
    const dims = [
      { x: (cx + WR.x) / 2, y: waistY - 4, t: `허리단면 ${M.waist}` },
      { x: (cx + HipR.x) / 2, y: hipY - 5, t: `엉덩이 ${M.hip}` },
      { x: cx + 6, y: (waistY + crotchY) / 2, t: `밑위 ${M.rise}`, a: 'start' },
      { x: midLeg + 8, y: (hipY + hemY) / 2, t: `총장 ${M.length}`, a: 'start' },
      { x: midLeg, y: hemY + 15, t: `밑단 ${M.hem}` },
    ];
    return { label, cut: '2', pts, foldX: null, dims, grain: [{ x: midLeg - 8, y: hipY + 14 }, { x: midLeg - 8, y: hemY - 12 }] };
  };
  return [leg('앞판 FRONT'), leg('뒤판 BACK')];
}

// 패턴 한 피스 셀 렌더
function patternCell(piece, ox, oy, cw, ch, sa) {
  const allowance = offsetPoly(piece.pts, sa, piece.foldX);
  const bb = bboxP(allowance);
  const scale = Math.min((cw - 30) / bb.w, (ch - 74) / bb.h);
  const tx = ox + (cw - bb.w * scale) / 2 - bb.x * scale;
  const ty = oy + 16 - bb.y * scale;
  const g = piece.grain;
  let s = `<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) scale(${scale.toFixed(3)})">`;
  s += `<path d="${poly2path(allowance)}" fill="#f8fafc" stroke="#94a3b8" stroke-width="${(1 / scale).toFixed(2)}" stroke-dasharray="${(5 / scale).toFixed(1)} ${(3 / scale).toFixed(1)}"/>`;
  s += `<path d="${poly2path(piece.pts)}" fill="rgba(59,130,246,0.06)" stroke="#1f2937" stroke-width="${(1.6 / scale).toFixed(2)}"/>`;
  if (piece.foldX != null) s += `<line x1="${piece.foldX}" y1="${bb.y}" x2="${piece.foldX}" y2="${bb.y + bb.h}" stroke="#2563eb" stroke-width="${(1 / scale).toFixed(2)}" stroke-dasharray="${(8 / scale).toFixed(1)} ${(4 / scale).toFixed(1)}"/>`;
  // 식서방향 화살표
  const aw = 5 / scale;
  s += `<line x1="${g[0].x}" y1="${g[0].y}" x2="${g[1].x}" y2="${g[1].y}" stroke="#111" stroke-width="${(1.2 / scale).toFixed(2)}"/>`;
  s += `<path d="M ${g[0].x - aw} ${g[0].y + aw} L ${g[0].x} ${g[0].y} L ${g[0].x + aw} ${g[0].y + aw}" fill="none" stroke="#111" stroke-width="${(1.2 / scale).toFixed(2)}"/>`;
  s += `<path d="M ${g[1].x - aw} ${g[1].y - aw} L ${g[1].x} ${g[1].y} L ${g[1].x + aw} ${g[1].y - aw}" fill="none" stroke="#111" stroke-width="${(1.2 / scale).toFixed(2)}"/>`;
  // 부위별 치수 (cm)
  const fs = (10.5 / scale).toFixed(2);
  (piece.dims || []).forEach(dm => {
    s += `<text x="${dm.x.toFixed(1)}" y="${dm.y.toFixed(1)}" font-size="${fs}" fill="#b91c1c" font-weight="700" text-anchor="${dm.a || 'middle'}">${dm.t}</text>`;
  });
  // 절개선 반영 — 도식과 동일 좌표계이므로 패널 위에 정확히 오버레이, 패널 외곽으로 클립
  const cls = (piece.cutlines || []).filter(c => (c.pts || []).length >= 2);
  if (cls.length) {
    const clipId = `cutclip-${Math.round(ox)}-${Math.round(oy)}`;
    s += `<clipPath id="${clipId}"><path d="${poly2path(piece.pts)}"/></clipPath>`;
    s += `<g clip-path="url(#${clipId})">`;
    cls.forEach(c => {
      const dd = smoothPath(c.pts);
      const dash = c.style === 'seam' ? '' : ` stroke-dasharray="${(7 / scale).toFixed(1)} ${(4 / scale).toFixed(1)}"`;
      s += `<path d="${dd}" fill="none" stroke="#e3000f" stroke-width="${(1.7 / scale).toFixed(2)}"${dash} stroke-linecap="round" stroke-linejoin="round"/>`;
    });
    s += `</g>`;
  }
  s += `</g>`;
  s += `<text x="${(ox + cw / 2).toFixed(1)}" y="${(oy + ch - 22).toFixed(1)}" text-anchor="middle" font-size="13" font-weight="700" fill="#111">${piece.label}</text>`;
  s += `<text x="${(ox + cw / 2).toFixed(1)}" y="${(oy + ch - 7).toFixed(1)}" text-anchor="middle" font-size="10" fill="#666">재단 ${piece.cut} · 식서↕ · 시접 1cm 별도${cls.length ? ' · 🔴절개=분리재단' : ''}</text>`;
  s += `<rect x="${ox + 4}" y="${oy + 4}" width="${cw - 8}" height="${ch - 8}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
  return s;
}

export function garmentPatternSVG(cfg) {
  const raw = garmentDef(cfg.type).category === 'pants' ? pantsPatternPieces(cfg) : topPatternPieces(cfg);
  const pieces = raw.flatMap(explodePiece);
  const cols = pieces.length, cw = 300, ch = 460, W = cols * cw, H = ch;
  let s = `<svg viewBox="0 0 ${W} ${H + 30}" class="sm-svg sm-svg-pattern" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H + 30}" fill="#fff"/>`;
  const hasCut = (cfg.cutlines || []).some(c => (c.pts || []).length >= 2);
  s += `<text x="12" y="20" font-size="13" font-weight="700" fill="#111">패턴 (1차 드래프트 · 곡선 반영) — 실선=완성선 / 점선=시접 1cm${hasCut ? ' / <tspan fill="#e3000f">절개선 기준 조각 분리 · 각 조각 시접 1cm 별도</tspan>' : ''}</text>`;
  pieces.forEach((p, i) => { s += patternCell(p, i * cw, 30, cw, ch, 9); });
  s += `</svg>`;
  return s;
}

// ---------------------------------------------------------------------------
// 작업지시서 (요약 + 인쇄용)
// ---------------------------------------------------------------------------
function selectedDetailLabels(cfg) {
  const def = garmentDef(cfg.type);
  return def.details.filter(x => cfg.details[x.key]).map(x => x.label);
}

// 작업지시서 → 출고 검수 체크리스트 항목 (지시서에 있는 걸 검수에서 놓치지 않도록)
export function techPackChecklistItems(cfg) {
  const items = [];
  (cfg.placements || []).forEach(p => {
    const meta = placementKindMeta(p.kind);
    const pos = placementPosLabel(cfg, p.pos);
    items.push(`${meta.label} — ${pos} ${p.sizeCm}cm 위치·색상 확인${p.fileName ? ` (${p.fileName})` : ''}`);
  });
  selectedDetailLabels(cfg).forEach(l => items.push(`${l} 확인`));
  (cfg.cutlines || []).filter(c => (c.pts || []).length >= 2).forEach((c, i) => items.push(`절개선 ${i + 1} (${c.style === 'seam' ? '절개' : '스티치'}) 위치·봉제 확인`));
  return items;
}

function placementRows(cfg) {
  return (cfg.placements || []).map(p => {
    const meta = placementKindMeta(p.kind);
    return { kind: meta.label, pos: placementPosLabel(cfg, p.pos), size: p.sizeCm, file: p.fileName || (p.dataUrl ? '첨부' : '-'), dataUrl: p.dataUrl };
  });
}

export function techPackSummaryHTML(cfg) {
  const def = garmentDef(cfg.type);
  const c = cfg.color || { name: '-', hex: '#ccc' };
  const measureRows = def.measure.map(m => `
    <tr><td>${m.label}</td><td class="sm-tp-num">${cfg.measure[m.key]}</td><td class="sm-tp-num">±${m.key === 'length' ? '1.0' : '0.5'}</td></tr>`).join('');
  const details = selectedDetailLabels(cfg);
  const pls = placementRows(cfg);
  const plBlock = pls.length ? `
        <table class="sm-tp-table"><thead><tr><th>종류</th><th>위치</th><th>크기</th><th>파일</th></tr></thead><tbody>
        ${pls.map(p => `<tr><td>${p.kind}</td><td>${p.pos}</td><td class="sm-tp-num">${p.size}cm</td><td>${p.dataUrl ? `<img src="${p.dataUrl}" class="sm-tp-mini">` : p.file}</td></tr>`).join('')}
        </tbody></table>` : '<span class="sm-tp-note">배치 요소 없음</span>';
  return `
    <div class="sm-tp-head">
      <div>
        <div class="sm-tp-title">작업지시서 <span class="sm-tp-sub">TECH PACK</span></div>
        <div class="sm-tp-meta">
          <span><b>스타일</b> ${cfg.styleName || '-'} ${cfg.styleNo ? `(${cfg.styleNo})` : ''}</span>
          <span><b>품목</b> ${def.label}</span>
          <span><b>사이즈</b> ${cfg.size || '-'}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="sm-save-techpack" class="sm-print-btn" style="background:#10b981"><i class="ph ph-floppy-disk"></i> 작업지시서 저장</button>
        <button id="sm-print-btn" class="sm-print-btn"><i class="ph ph-printer"></i> 인쇄 / PDF</button>
      </div>
    </div>
    <div class="sm-tp-grid">
      <div class="sm-tp-block">
        <h4>색상 / 원단</h4>
        <div class="sm-tp-color"><span class="sm-tp-swatch" style="background:${c.hex}"></span>${c.name} <code>${c.hex}</code></div>
        <div class="sm-tp-note">원단: ${cfg.fabric || '미지정'} · 부자재 견본 별첨</div>
      </div>
      <div class="sm-tp-block">
        <h4>디테일 / 부자재 (${details.length})</h4>
        <div class="sm-tp-chips">${details.length ? details.map(t => `<span class="sm-chip">${t}</span>`).join('') : '<span class="sm-tp-note">선택된 디테일 없음</span>'}</div>
      </div>
      <div class="sm-tp-block">
        <h4>치수 명세 (cm)</h4>
        <table class="sm-tp-table"><thead><tr><th>부위</th><th>치수</th><th>허용</th></tr></thead><tbody>${measureRows}</tbody></table>
      </div>
      <div class="sm-tp-block sm-tp-block-wide">
        <h4>로고 · 배치 (${pls.length})</h4>
        ${plBlock}
      </div>
      ${(cfg.references || []).length ? `<div class="sm-tp-block sm-tp-block-wide">
        <h4>레퍼런스 사진 (${cfg.references.length})</h4>
        <div class="sm-tp-refs">${cfg.references.map(r => `<figure class="sm-tp-ref"><img src="${r.dataUrl}" alt="">${r.note ? `<figcaption>${_smEsc(r.note)}</figcaption>` : ''}</figure>`).join('')}</div>
      </div>` : ''}
    </div>`;
}

// 사이즈 그레이딩 (기준 치수 → 90/100/110/120)
function gradedSizes(cfg) {
  const def = garmentDef(cfg.type);
  const sizes = ['90', '100', '110', '120'], baseIdx = 2;
  const stepFor = key => (key === 'length') ? 3 : (key === 'sleeve') ? 2.5 : (['neck', 'cuffOpening'].includes(key)) ? 1 : (key === 'rise') ? 1.5 : 2;
  const rows = def.measure.map(m => ({
    label: m.label,
    vals: sizes.map((_, i) => +(Number(cfg.measure[m.key]) + (i - baseIdx) * stepFor(m.key)).toFixed(1)),
    tol: (m.key === 'length' || m.key === 'sleeve') ? '1.0' : '0.5',
  }));
  return { sizes, baseIdx, rows };
}

// 원·부자재 산출
function materialsList(cfg) {
  const d = cfg.details || {}, t = cfg.type, list = [];
  list.push({ item: '겉감', spec: cfg.fabric || '면 100%', qty: '요척별' });
  if (d.fleece) list.push({ item: '기모가공', spec: '안기모 처리', qty: '1식' });
  if (d.lining) list.push({ item: '안감', spec: 'T/C 평직', qty: '1식' });
  if (d.rib || t === 'sweatshirt' || t === 'hoodie' || d.jogger) list.push({ item: '리브', spec: '2x1 골지 (넥/소매/밑단)', qty: '1식' });
  if (d.zipper) list.push({ item: '지퍼', spec: '금속 5호 오픈', qty: '1ea' });
  if (d.zipup) list.push({ item: '지퍼', spec: '비슬론 5호 오픈', qty: '1ea' });
  if (d.button) list.push({ item: '단추', spec: '15mm 4holes', qty: '5ea' });
  if (d.drawstring) list.push({ item: '끈+스토퍼', spec: '8mm 면끈', qty: '1식' });
  if (d.collar) list.push({ item: '카라심', spec: '접착심지', qty: '1식' });
  if (d.banding || t === 'pants') list.push({ item: '밴드', spec: '허리 고무밴드 30mm', qty: '1식' });
  if (d.kneePatch) list.push({ item: '무릎보강', spec: '겉감 덧댐', qty: '1식' });
  (cfg.placements || []).forEach(p => {
    const pos = placementPosLabel(cfg, p.pos);
    if (p.kind === 'print') list.push({ item: '전사/프린트', spec: `${pos} ${p.sizeCm}cm`, qty: '1식' });
    else if (p.kind === 'embroidery') list.push({ item: '자수', spec: `${pos} ${p.sizeCm}cm`, qty: '1식' });
    else if (p.kind === 'logo') list.push({ item: '로고(워펜/라벨)', spec: `${pos} ${p.sizeCm}cm`, qty: '1ea' });
    else if (p.kind === 'label') list.push({ item: '데코라벨', spec: pos, qty: '1ea' });
  });
  list.push({ item: '메인라벨', spec: '후넥 중앙', qty: '1ea' });
  list.push({ item: '케어라벨', spec: '좌측 사이드시임', qty: '1ea' });
  list.push({ item: '행택+택끈', spec: '브랜드 기본', qty: '1set' });
  list.push({ item: '폴리백', spec: '사이즈별 규격', qty: '1ea' });
  return list;
}

export function buildTechPackPrintHTML(cfg) {
  const def = garmentDef(cfg.type);
  const c = cfg.color || { name: '-', hex: '#ccc' };
  const flat = garmentFlatSVG(cfg);
  const grade = gradedSizes(cfg);
  const mats = materialsList(cfg);
  const details = selectedDetailLabels(cfg);
  const pls = placementRows(cfg);
  const today = '____ . __ . __';

  const sizeHead = grade.sizes.map((sz, i) => `<th class="${i === grade.baseIdx ? 'base' : ''}">${sz}</th>`).join('');
  const sizeRows = grade.rows.map(r => `<tr><td class="lbl">${r.label}</td>${r.vals.map((v, i) => `<td class="${i === grade.baseIdx ? 'base' : ''}">${v}</td>`).join('')}<td class="tol">±${r.tol}</td></tr>`).join('');
  const matRows = mats.map(m => `<tr><td class="lbl">${m.item}</td><td>${m.spec}</td><td class="qty">${m.qty}</td></tr>`).join('');
  const colorRow = `<tr><td class="lbl">${c.name}</td>${grade.sizes.map(() => '<td></td>').join('')}<td></td></tr>`;
  const plsRows = pls.length ? pls.map(p => `<tr><td>${p.kind}</td><td>${p.pos}</td><td>${p.size}cm</td><td>${p.dataUrl ? `<img src="${p.dataUrl}" class="plimg">` : (p.file || '-')}</td></tr>`).join('') : `<tr><td colspan="4" style="color:#999">배치 요소 없음</td></tr>`;
  const refsPage = (cfg.references || []).length ? `
  <div class="tp" style="margin-top:8px;page-break-before:always;">
    <div class="hd"><div class="hd-logo"><span class="mark"></span><b>이일칠구<br>2179</b></div><div class="hd-title" style="font-size:18px;letter-spacing:8px;">레퍼런스 · REFERENCE</div><div class="approve"><div class="ab"><div class="t">디자이너</div><div class="v"></div></div></div></div>
    <div style="padding:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
      ${cfg.references.map(r => `<figure style="margin:0;border:1px solid #bbb;">
        <img src="${r.dataUrl}" style="width:100%;height:155px;object-fit:contain;background:#f7f7f7;display:block;">
        <figcaption style="padding:4px 6px;font-size:9.5px;border-top:1px solid #bbb;min-height:15px;white-space:pre-wrap;line-height:1.4;">${_smEsc(r.note || '')}</figcaption>
      </figure>`).join('')}
    </div>
  </div>` : '';

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<title>작업지시서 - ${cfg.styleName || def.label}</title>
<style>
  @page { size: A4 landscape; margin: 7mm; }
  * { box-sizing: border-box; }
  body { font-family:'Pretendard','Apple SD Gothic Neo',sans-serif; color:#111; margin:0; font-size:10px; }
  .tp { border:1.5px solid #111; }
  .row { display:flex; }
  .cell { border-right:1px solid #bbb; border-bottom:1px solid #bbb; padding:3px 6px; }
  .lbl-cell { background:#f2f2f2; font-weight:600; color:#333; white-space:nowrap; }
  /* 헤더 */
  .hd { display:flex; align-items:stretch; border-bottom:1.5px solid #111; }
  .hd-logo { width:130px; display:flex; align-items:center; gap:6px; padding:6px 10px; border-right:1px solid #bbb; }
  .hd-logo .mark { width:26px; height:26px; border-radius:50%; background:#111; }
  .hd-logo b { font-size:11px; letter-spacing:1px; }
  .hd-title { flex:1; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:800; letter-spacing:14px; }
  .approve { display:flex; }
  .approve .ab { width:58px; border-left:1px solid #bbb; text-align:center; }
  .approve .ab .t { font-size:9px; background:#f2f2f2; border-bottom:1px solid #bbb; padding:2px 0; }
  .approve .ab .v { height:34px; }
  /* 정보 그리드 */
  .meta { display:flex; border-bottom:1.5px solid #111; }
  .meta .grid { flex:1; display:grid; grid-template-columns: 70px 1fr 70px 1fr 70px 1fr; }
  .meta .grid .cell { font-size:10px; }
  .swatchbox { width:150px; border-left:1px solid #bbb; display:flex; flex-direction:column; }
  .swatchbox .sw { flex:1; min-height:54px; background:${c.hex}; border-bottom:1px solid #bbb; }
  .swatchbox .nm { padding:3px 6px; font-weight:600; font-size:10px; text-align:center; }
  /* 본문 3단 */
  .body { display:flex; min-height:430px; }
  .col { padding:0; }
  .col-left { width:170px; border-right:1px solid #bbb; }
  .col-mid { flex:1; border-right:1px solid #bbb; display:flex; flex-direction:column; }
  .col-right { width:248px; }
  .sechd { background:#111; color:#fff; font-size:10px; font-weight:700; padding:3px 8px; letter-spacing:1px; }
  .flatwrap { flex:1; padding:6px; display:flex; align-items:center; justify-content:center; }
  .flatwrap svg { width:100%; height:auto; max-height:420px; }
  .flatwrap svg .sm-dim line { stroke:#d11; stroke-width:0.7; }
  .flatwrap svg .sm-dim text { fill:#d11; font-size:10px; font-weight:700; }
  .flatwrap svg .sm-ext { stroke:#d11; stroke-width:0.4; stroke-dasharray:2 2; }
  .sm-viewlabel { font-size:13px; font-weight:700; fill:#333; letter-spacing:2px; }
  table { width:100%; border-collapse:collapse; }
  th,td { border:1px solid #bbb; padding:2.5px 4px; font-size:9.5px; text-align:center; }
  th { background:#f2f2f2; font-weight:700; }
  th.base, td.base { background:#fff4e0; }
  td.lbl { background:#f7f7f7; font-weight:600; text-align:left; white-space:nowrap; }
  td.tol, td.qty { color:#666; }
  .note { padding:5px 7px; font-size:9.5px; white-space:pre-wrap; line-height:1.5; min-height:50px; }
  .chips { padding:5px 7px; }
  .chips span { display:inline-block; border:1px solid #ccc; border-radius:10px; padding:1px 7px; font-size:9px; margin:0 3px 3px 0; }
  .plimg { width:26px; height:26px; object-fit:contain; vertical-align:middle; }
  .foot { border-top:1.5px solid #111; padding:5px 8px; font-size:9px; color:#444; line-height:1.6; }
  .foot b { color:#111; }
</style></head><body>
  <div class="tp">
    <!-- 헤더 -->
    <div class="hd">
      <div class="hd-logo"><span class="mark"></span><b>더하임<br>PROMOTION</b></div>
      <div class="hd-title">작 업 지 시 서</div>
      <div class="approve">
        ${['디자이너', 'MD', '대표'].map(r => `<div class="ab"><div class="t">${r}</div><div class="v"></div></div>`).join('')}
      </div>
    </div>
    <!-- 정보 그리드 + 스와치 -->
    <div class="meta">
      <div class="grid">
        <div class="cell lbl-cell">담당</div><div class="cell">디자인팀</div>
        <div class="cell lbl-cell">품번</div><div class="cell">${cfg.styleNo || '-'}</div>
        <div class="cell lbl-cell">아이템</div><div class="cell">${def.label}</div>
        <div class="cell lbl-cell">스타일명</div><div class="cell">${cfg.styleName || '-'}</div>
        <div class="cell lbl-cell">시즌</div><div class="cell">2026 S/S</div>
        <div class="cell lbl-cell">작성일</div><div class="cell">${today}</div>
        <div class="cell lbl-cell">기준사이즈</div><div class="cell">${cfg.size || '110'}</div>
        <div class="cell lbl-cell">원단</div><div class="cell">${cfg.fabric || '면 100%'}</div>
        <div class="cell lbl-cell">발주수량</div><div class="cell" style="border-bottom:none"></div>
      </div>
      <div class="swatchbox">
        <div class="sw"></div>
        <div class="nm">${c.name} <span style="color:#999;font-weight:400">${c.hex}</span></div>
      </div>
    </div>
    <!-- 본문 3단 -->
    <div class="body">
      <!-- 좌: COLOR/수량, 디테일, 비고 -->
      <div class="col col-left">
        <div class="sechd">COLOR / 수량</div>
        <table><thead><tr><th class="lbl" style="text-align:left">컬러</th>${sizeHead}<th>합계</th></tr></thead><tbody>${colorRow}</tbody></table>
        <div class="sechd">디테일</div>
        <div class="chips">${details.length ? details.map(t => `<span>${t}</span>`).join('') : '<span style="color:#999">-</span>'}</div>
        <div class="sechd">비고 / 봉제지시</div>
        <div class="note">${(cfg.note || '').replace(/</g, '&lt;') || '· 시접 1cm\n· 밑단/소매 더블 스티치\n· 넥 리브 2x1'}</div>
      </div>
      <!-- 중: 도식 FRONT/BACK -->
      <div class="col col-mid">
        <div class="sechd">도식화 (FLAT — FRONT / BACK)</div>
        <div class="flatwrap">${flat}</div>
      </div>
      <!-- 우: SIZE SPEC, 원부자재, 배치 -->
      <div class="col col-right">
        <div class="sechd">SIZE SPEC (CM)</div>
        <table><thead><tr><th class="lbl" style="text-align:left">부위</th>${sizeHead}<th class="tol">편차</th></tr></thead><tbody>${sizeRows}</tbody></table>
        <div class="sechd">원 · 부자재</div>
        <table><thead><tr><th class="lbl" style="text-align:left">품목</th><th>내용</th><th>수량</th></tr></thead><tbody>${matRows}</tbody></table>
        <div class="sechd">로고 · 그래픽 배치</div>
        <table><thead><tr><th>종류</th><th>위치</th><th>크기</th><th>아트워크</th></tr></thead><tbody>${plsRows}</tbody></table>
      </div>
    </div>
    <!-- 푸터 -->
    <div class="foot">
      <b>봉제 지시</b> · 본봉 시접 1cm, 오바록 마감 · 밑단·소매부리 더블 스티치(1/4") · 넥 리브 2x1 골지 · 라벨 위치 후넥 중앙 &nbsp;|&nbsp;
      <b>검품</b> 치수 편차 ±0.5~1.0cm 허용 · 컬러 견본 대조 후 진행 &nbsp;|&nbsp; 더하임프로모션 아동복 사업부
    </div>
  </div>
  <div class="tp" style="margin-top:8px;page-break-before:always;">
    <div class="hd"><div class="hd-logo"><span class="mark"></span><b>더하임<br>PROMOTION</b></div><div class="hd-title" style="font-size:18px;letter-spacing:8px;">패 턴 · PATTERN</div><div class="approve"><div class="ab"><div class="t">패턴사</div><div class="v"></div></div></div></div>
    <div style="padding:8px;"><div style="font-size:10px;color:#555;margin-bottom:4px;">※ 1차 드래프트 — 편집된 곡선 반영 · 실선=완성선 · 점선=시접 1cm · 식서방향 ↕ · 다림질/요척 확인 후 본작업</div>
      <div style="width:100%;">${garmentPatternSVG(cfg).replace('<svg ', '<svg style="width:100%;height:auto;max-height:460px;" ')}</div>
    </div>
  </div>
  ${refsPage}
  <script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// 컨트롤 패널 + 스테이지 (뷰 전체 HTML)
// ---------------------------------------------------------------------------
export function renderSampleMaker(cfg) {
  const def = garmentDef(cfg.type);

  const typeBtns = SAMPLE_GARMENTS.map(g => `
    <button class="sm-type ${g.id === cfg.type ? 'active' : ''}" data-type="${g.id}">
      <i class="ph ${g.icon}"></i><span>${g.label}</span>
    </button>`).join('');

  const colorBtns = SAMPLE_COLORS.map(c => `
    <button class="sm-color ${cfg.color && c.hex === cfg.color.hex ? 'active' : ''}" data-hex="${c.hex}" data-name="${c.name}" title="${c.name}">
      <span style="background:${c.hex}"></span>
    </button>`).join('');

  const measureCtrls = def.measure.map(m => {
    const val = cfg.measure[m.key];
    return `
    <div class="sm-measure-row">
      <label>${m.label}</label>
      <input type="range" class="sm-measure" data-key="${m.key}" min="${m.min}" max="${m.max}" step="0.5" value="${val}">
      <div class="sm-measure-val">
        <input type="number" class="sm-measure-num" data-key="${m.key}" min="${m.min}" max="${m.max}" step="0.5" value="${val}">
        <span>cm</span>
      </div>
    </div>`;
  }).join('');

  const detailChks = def.details.map(d => `
    <label class="sm-detail-chk">
      <input type="checkbox" class="sm-detail" data-key="${d.key}" ${cfg.details[d.key] ? 'checked' : ''}>
      <span>${d.label}${d.draw ? '' : ' <em>(지시서)</em>'}</span>
    </label>`).join('');

  // ⑥ 로고·디테일 배치
  const posOpts = (p) => (PLACEMENT_POSITIONS[def.category] || [])
    .map(o => `<option value="${o.key}" ${p.pos === o.key ? 'selected' : ''}>${o.label}</option>`).join('');
  const addBtns = PLACEMENT_KINDS.map(k => `
    <button class="sm-pl-add" data-kind="${k.kind}"><i class="ph ${k.icon}"></i> ${k.label}</button>`).join('');
  const plRows = (cfg.placements || []).map(p => {
    const meta = placementKindMeta(p.kind);
    return `
    <div class="sm-pl-row" data-id="${p.id}">
      <div class="sm-pl-head">
        <span class="sm-pl-kind"><i class="ph ${meta.icon}"></i> ${meta.label}</span>
        <button class="sm-pl-del" data-id="${p.id}" title="삭제"><i class="ph ph-trash"></i></button>
      </div>
      <div class="sm-pl-ctrls">
        <select class="sm-pl-pos" data-id="${p.id}">${posOpts(p)}</select>
        <input type="range" class="sm-pl-size" data-id="${p.id}" min="2" max="40" step="0.5" value="${p.sizeCm}">
        <span class="sm-pl-sizeval">${p.sizeCm}cm</span>
      </div>
      ${meta.file ? `
      <div class="sm-pl-file">
        ${p.dataUrl ? `<img src="${p.dataUrl}" class="sm-pl-thumb" alt="">` : '<span class="sm-pl-noimg">이미지 없음</span>'}
        <label class="sm-pl-upload"><i class="ph ph-upload-simple"></i> ${p.dataUrl ? '변경' : '파일 선택'}
          <input type="file" accept="image/*" class="sm-pl-input" data-id="${p.id}" hidden>
        </label>
      </div>` : ''}
    </div>`;
  }).join('');

  const cutPointRows = [
    ...(cfg.cutlines || []).map((c, i) => `<div class="sm-pl-row"><div class="sm-pl-head"><span class="sm-pl-kind"><i class="ph ph-scissors"></i> 절개선 ${i + 1} <span class="sm-hint">(${(c.pts || []).length}점)</span></span><button class="sm-cut-del" data-id="${c.id}" title="삭제"><i class="ph ph-trash"></i></button></div>
      <div class="sm-cut-ctl">
        <div class="sm-seg">
          <button class="sm-cut-style${c.style !== 'seam' ? ' on' : ''}" data-id="${c.id}" data-style="stitch">╌ 스티치</button>
          <button class="sm-cut-style${c.style === 'seam' ? ' on' : ''}" data-id="${c.id}" data-style="seam">━ 절개</button>
        </div>
        <button class="sm-cut-vadd" data-id="${c.id}" title="점 추가"><i class="ph ph-plus"></i></button>
        <button class="sm-cut-vdel" data-id="${c.id}" title="점 삭제"${(c.pts || []).length <= 2 ? ' disabled' : ''}><i class="ph ph-minus"></i></button>
      </div>
    </div>`),
    ...(cfg.points || []).map(p => `<div class="sm-pl-row"><div class="sm-pl-head"><span class="sm-pl-kind"><i class="ph ph-map-pin"></i> 포인트</span><button class="sm-point-del" data-id="${p.id}" title="삭제"><i class="ph ph-trash"></i></button></div><input type="text" class="sm-point-label" data-id="${p.id}" placeholder="라벨 (예: 단추, 자수)" value="${_smEsc(p.label || '').replace(/"/g, '&quot;')}"></div>`),
  ].join('');

  const refRows = (cfg.references || []).map(r => `<div class="sm-pl-row" data-id="${r.id}">
      <div class="sm-pl-head"><span class="sm-pl-kind"><i class="ph ph-image"></i> 레퍼런스</span><button class="sm-ref-del" data-id="${r.id}" title="삭제"><i class="ph ph-trash"></i></button></div>
      <div class="sm-pl-file"><img src="${r.dataUrl}" class="sm-pl-thumb" alt=""></div>
      <input type="text" class="sm-ref-note" data-id="${r.id}" placeholder="메모 (예: 이런 느낌 절개)" value="${_smEsc(r.note || '').replace(/"/g, '&quot;')}">
    </div>`).join('');

  return `
  <div class="sm-view fade-in">
    <div class="sm-layout">
      <aside class="sm-controls glass">
        <div class="sm-group">
          <h4>① 기본 정보</h4>
          <div class="sm-field"><label>스타일명</label><input type="text" id="sm-styleName" placeholder="예: 베이직 데일리 티" value="${cfg.styleName || ''}"></div>
          <div class="sm-field-row">
            <div class="sm-field"><label>품번</label><input type="text" id="sm-styleNo" placeholder="HM-2026-001" value="${cfg.styleNo || ''}"></div>
            <div class="sm-field"><label>사이즈</label><input type="text" id="sm-size" value="${cfg.size || ''}"></div>
          </div>
        </div>

        <div class="sm-group">
          <h4>② 의류 종류</h4>
          <div class="sm-type-grid">${typeBtns}</div>
        </div>

        <div class="sm-group">
          <h4>③ 색상</h4>
          <div class="sm-color-grid">${colorBtns}</div>
        </div>

        <div class="sm-group">
          <h4>④ 상세 치수</h4>
          <div class="sm-measures">${measureCtrls}</div>
        </div>

        <div class="sm-group">
          <h4>⑤ 디테일</h4>
          <div class="sm-details">${detailChks}</div>
        </div>

        <div class="sm-group">
          <h4>⑥ 로고 · 배치 <span class="sm-hint">(위치·크기 자유)</span></h4>
          <div class="sm-pl-addbar">${addBtns}</div>
          <div class="sm-pl-list">${plRows || '<p class="sm-pl-empty">위 버튼으로 로고·프린트·포켓·자수·라벨을 추가하세요.</p>'}</div>
        </div>

        <div class="sm-group">
          <h4>⑦ 절개선 · 포인트 <span class="sm-hint">(드래그 · Shift=수직/수평 · 패턴에 자동 반영)</span></h4>
          <div class="sm-pl-addbar">
            <button class="sm-cut-add"><i class="ph ph-scissors"></i> 절개선</button>
            <button class="sm-point-add"><i class="ph ph-map-pin"></i> 포인트</button>
          </div>
          <div class="sm-pl-list">${cutPointRows || '<p class="sm-pl-empty">절개선(봉제선·스티치·패널 분할) / 포인트(단추·자수 위치 등). [+점]으로 꺾고 노드를 드래그해 곡선을 만드세요.</p>'}</div>
        </div>

        <div class="sm-group">
          <h4>⑧ 레퍼런스 사진 <span class="sm-hint">(디테일 메모)</span></h4>
          <label class="sm-pl-upload" style="width:100%;justify-content:center;margin-bottom:8px;box-sizing:border-box"><i class="ph ph-image"></i> 사진 추가<input type="file" accept="image/*" class="sm-ref-input" hidden></label>
          <div class="sm-pl-list">${refRows || '<p class="sm-pl-empty">참고 이미지를 올리고 메모를 달아 공장에 전달하세요.</p>'}</div>
        </div>

        <div class="sm-group">
          <h4>⑦ 원단 / 비고</h4>
          <div class="sm-field"><label>원단</label><input type="text" id="sm-fabric" placeholder="면 100% / 폴리혼방 등" value="${cfg.fabric || ''}"></div>
          <textarea id="sm-note" rows="3" placeholder="부자재, 봉제 지시, 특이사항">${cfg.note || ''}</textarea>
        </div>
      </aside>

      <section class="sm-stage">
        <div class="sm-tabs">
          <button class="sm-tab ${cfg.activeTab === 'preview' || !cfg.activeTab ? 'active' : ''}" data-tab="preview"><i class="ph ph-image"></i> 실사</button>
          <button class="sm-tab ${cfg.activeTab === 'flat' ? 'active' : ''}" data-tab="flat"><i class="ph ph-ruler"></i> 도식화</button>
          <button class="sm-tab ${cfg.activeTab === 'pattern' ? 'active' : ''}" data-tab="pattern"><i class="ph ph-scissors"></i> 패턴</button>
          <button class="sm-tab sm-edit-toggle ${cfg.editMode ? 'active' : ''}" id="sm-edit-toggle" title="핸들로 직접 드래그 편집"><i class="ph ph-cursor"></i> 핸들 편집</button>
        </div>
        <div class="sm-canvas${cfg.editMode && cfg.activeTab !== 'pattern' ? ' sm-editing' : ''}">
          <div class="sm-zoom-ctrl">
            <button class="sm-zoom-btn" data-zoom="out"><i class="ph ph-minus"></i></button>
            <button class="sm-zoom-btn" data-zoom="fit" title="맞춤">⊡</button>
            <button class="sm-zoom-btn" data-zoom="in"><i class="ph ph-plus"></i></button>
          </div>
          ${cfg.editMode ? '<div class="sm-edit-hint">네모=치수 · 파란원=곡선 · 박스=배치 드래그 / 휠=확대, 빈곳 드래그=이동 <button id="sm-reset-curve" class="sm-reset-btn">곡선 초기화</button></div>' : ''}
          <div id="sm-preview" class="sm-pane" style="${cfg.activeTab !== 'flat' && cfg.activeTab !== 'pattern' ? '' : 'display:none'}">${garmentPreviewSVG(cfg, true)}</div>
          <div id="sm-flat" class="sm-pane sm-pane-flat" style="${cfg.activeTab === 'flat' ? '' : 'display:none'}">${garmentFlatSVG(cfg, true)}</div>
          <div id="sm-pattern" class="sm-pane sm-pane-flat" style="${cfg.activeTab === 'pattern' ? '' : 'display:none'}">${garmentPatternSVG(cfg)}</div>
          <div id="sm-clean" class="sm-clean-preview" style="${cfg.editMode && cfg.activeTab !== 'pattern' ? '' : 'display:none'}"><span class="sm-clean-label"><i class="ph ph-eye"></i> 기준 미리보기 · 선 없음</span>${garmentPreviewSVG({ ...cfg, cutlines: [], points: [], editMode: false }, false)}</div>
        </div>
        <div id="sm-techpack" class="sm-techpack glass">${techPackSummaryHTML(cfg)}</div>
      </section>
    </div>
  </div>`;
}
