import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Evaluate real pure helpers with module-side UI dependencies stubbed; no browser is used.
const clean = source => source.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const detailSource = await readFile(new URL('../src/main/resources/static/js/request-detail.js', import.meta.url), 'utf8');
const detailContext = vm.createContext({e: escapeHTML});
new vm.Script(clean(detailSource) + '\n;globalThis.helpers={requestStatus,componentBalances};').runInContext(detailContext);
const homeSource = await readFile(new URL('../src/main/resources/static/js/home.js', import.meta.url), 'utf8');
const context = vm.createContext({escapeHTML, navigate() {}, serverMode: false,
  store: {subscribe() {}}, window: {addEventListener() {}}, ...detailContext.helpers});
new vm.Script(clean(homeSource) + '\n;globalThis.homeApi={campusTimestamp,matchesSummaryView,demoPersonalSummary,personalSummaryHtml};', {filename: 'home.js'}).runInContext(context);
const {campusTimestamp, matchesSummaryView, demoPersonalSummary, personalSummaryHtml} = context.homeApi;
const now = Date.parse('2026-11-17T15:30:00Z'), day = '2026-11-18';
const item = (id, status = 'APPROVED', kind = '장비', start = `${day}T10:00`, end = `${day}T11:00`, rest = {}) => ({id, status, kind, name: `자원 ${id}`, condition: {start, end, people: 1, use: '팀 회의'}, history: [], ...rest});
const state = (items, other = []) => ({user: {id: 'owner', role: 'student'}, records: [
  {number: 'OWN-1', userId: 'owner', items}, {number: 'OTHER-1', userId: 'other', items: other},
]});
const plain = value => JSON.parse(JSON.stringify(value));
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };

check('offset 없는 서버 시각과 UTC 시각을 같은 한국 시각으로 해석', () => {
  assert.equal(campusTimestamp('2026-11-18T00:30'), now);
  assert.equal(campusTimestamp('2026-11-17T15:30:00Z'), now);
  assert.equal(demoPersonalSummary(state([]), now).basisDate, day);
});
check('오늘 수령: 한국 자정 포함, 다음 자정 제외, 승인 장비만', () => {
  assert(matchesSummaryView(item('1', 'APPROVED', '장비', `${day}T00:00`), 'today-pickup', day));
  assert(!matchesSummaryView(item('2', 'APPROVED', '장비', '2026-11-19T00:00'), 'today-pickup', day));
  assert(!matchesSummaryView(item('3', 'APPROVED', '장비', '2026-11-17T23:59'), 'today-pickup', day));
  assert(!matchesSummaryView(item('4', 'PENDING'), 'today-pickup', day));
  assert(!matchesSummaryView(item('5', 'APPROVED', '시설'), 'today-pickup', day));
});
check('오늘 반납: 종료일의 한국 자정 포함/다음 자정 제외, 대여 중만', () => {
  assert(matchesSummaryView(item('1', 'CHECKED_OUT', '장비', '2026-11-17T10:00', `${day}T00:00`), 'today-return', day));
  assert(!matchesSummaryView(item('2', 'CHECKED_OUT', '장비', '2026-11-17T10:00', '2026-11-19T00:00'), 'today-return', day));
  assert(!matchesSummaryView(item('3', 'RETURN_REQUESTED'), 'today-return', day));
  assert(!matchesSummaryView(item('4', 'RETURN_HELD'), 'today-return', day));
});
check('오늘 시설 이용: 반열린 일자 구간과 겹치는 승인/이용 중만', () => {
  assert(!matchesSummaryView(item('1', 'APPROVED', '시설', '2026-11-17T20:00', `${day}T00:00`), 'today-facilities', day));
  assert(matchesSummaryView(item('2', 'APPROVED', '시설', `${day}T23:00`, '2026-11-19T00:00'), 'today-facilities', day));
  assert(matchesSummaryView(item('3', 'IN_USE', '시설', '2026-11-17T23:00', '2026-11-19T01:00'), 'today-facilities', day));
  assert(!matchesSummaryView(item('4', 'COMPLETED', '시설'), 'today-facilities', day));
  assert(!matchesSummaryView(item('5', 'APPROVED', '장비'), 'today-facilities', day));
});
check('타인 기록은 건수와 할 일에서 모두 제외', () => {
  const result = demoPersonalSummary(state([item('own')], [item('other'), item('other-held', 'RETURN_HELD')]), now);
  assert.deepEqual(plain(result.counts), {pickup: 1, returnDue: 0, facilityUse: 0});
  assert.deepEqual(plain(result.todo.map(entry => entry.itemId)), ['own']);
});
check('보류→반납 신청→예정 순서와 최대 3개, 전체 건수는 독립 집계', () => {
  const entries = [item('1'), item('2'), item('3'), item('4'),
    item('5', 'RETURN_REQUESTED', '장비', undefined, undefined, {history: [{to: 'RETURN_REQUESTED', at: `${day}T00:10`}]}),
    item('6', 'RETURN_HELD', '장비', undefined, undefined, {inspections: [{at: `${day}T00:20`, components: []}]}),
    item('7', 'RETURN_HELD', '장비', undefined, undefined, {inspections: [{at: `${day}T00:25`, components: []}]})];
  const result = demoPersonalSummary(state(entries), now);
  assert.equal(result.counts.pickup, 4);
  assert.equal(result.todo.length, 3);
  assert.deepEqual(plain(result.todo.map(entry => entry.itemId)), ['7', '6', '5']);
});
check('앞으로 7일 구간은 현재 포함·7일 후 제외, 지난 예정은 할 일 제외', () => {
  const entries = [item('now', 'APPROVED', '장비', `${day}T00:30`),
    item('inside', 'APPROVED', '장비', '2026-11-25T00:29'),
    item('boundary', 'APPROVED', '장비', '2026-11-25T00:30'),
    item('past', 'APPROVED', '장비', `${day}T00:00`)];
  const result = demoPersonalSummary(state(entries), now);
  assert.deepEqual(plain(result.todo.map(entry => entry.itemId)), ['now', 'inside']);
  assert.equal(result.counts.pickup, 2);
});
check('동일 시각 예정은 숫자 식별값 순서, 중복 항목은 한 번 집계', () => {
  const repeated = item('2');
  const result = demoPersonalSummary(state([item('10'), repeated, repeated]), now);
  assert.equal(result.counts.pickup, 2);
  assert.deepEqual(plain(result.todo.map(entry => entry.itemId)), ['2', '10']);
});
check('보류 부족 수량은 출고 기준과 누적 반환을 사용', () => {
  const held = item('held', 'RETURN_HELD', '장비', undefined, undefined, {
    checkoutComponents: [{componentId: '1', name: '배터리', quantity: 3, required: true}],
    inspections: [{at: `${day}T00:20`, components: [{componentId: '1', quantity: 1}]}], returnedComponents: {'1': 1},
  });
  const result = demoPersonalSummary(state([held]), now);
  assert.equal(result.todo[0].missingComponents[0].quantity, 2);
});
check('요약 HTML은 이름·사유·접수번호·부족품목을 이스케이프', () => {
  const unsafe = '<img src=x onerror=alert(1)>';
  const html = personalSummaryHtml({basisDate: day, generatedAt: '2026-11-17T15:30:00Z', counts: {pickup: 0, returnDue: 0, facilityUse: 0}, todo: [
    {itemId: '\"><script>alert(1)</script>', requestNumber: unsafe, originalIndex: 1, name: unsafe,
      kind: '장비', status: 'RETURN_HELD', actionType: 'return-held', actionAt: `${day}T00:20`, reason: unsafe,
      missingComponents: [{name: unsafe, quantity: 2}]},
  ]});
  assert(!html.includes('<img'));
  assert(!html.includes('<script>'));
  assert(html.includes('&lt;img'));
  assert(html.includes('%3Cscript%3E'));
  assert(html.includes(day));
});
console.log(`${checks} personal-home pure checks passed; browser rendering, focus and layout were not tested.`);
