import { defaultSampleConfig, buildTechPackPrintHTML, newPlacement, SAMPLE_COLORS } from './sampleMaker.js';
import { writeFileSync } from 'fs';
let cfg=defaultSampleConfig('sweatshirt');
cfg.color=SAMPLE_COLORS.find(c=>c.name==='네이비');
cfg.styleName='베이직 맨투맨'; cfg.styleNo='HM-2026-001'; cfg.size='110'; cfg.fabric='폴리에스터 60/면 40';
cfg.note='· 시접 1cm\n· 기모 안감\n· 넥 리브 2x1';
cfg.placements=[{...newPlacement('print',cfg,'a'),pos:'centerChest',sizeCm:18},{...newPlacement('logo',cfg,'b'),pos:'leftChest',sizeCm:7}];
writeFileSync('./_tp.html', buildTechPackPrintHTML(cfg));
console.log('html bytes:', buildTechPackPrintHTML(cfg).length);
