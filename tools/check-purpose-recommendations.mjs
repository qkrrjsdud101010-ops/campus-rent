import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Fresh isolated module evaluations avoid server/demo state and import-cache overlap.
const source = await readFile(new URL('../src/main/resources/static/js/data.js', import.meta.url), 'utf8');
const body = source.replace(/^export /gm, '') + '\n;globalThis.api={resources,purposes,purposeRules,analyzeInput,purposeSubmitTarget,recommendationItems,recommendationDefinition,replaceCatalog};';
function model(server = false) {
  const context = vm.createContext(server ? {document: {documentElement: {dataset: {backend: 'server'}}}} : {});
  new vm.Script(body, {filename: 'data.js'}).runInContext(context);
  return context.api;
}
const demo = model();
const needs = (overrides = {}) => ({space: false, video: false, audio: false, presentation: false, ...overrides});
const condition = {start: '2030-01-07T10:00', end: '2030-01-07T11:00', people: 4, use: '팀 회의'};
const equipment = items => items.filter(item => item.resource.kind === '장비');
const facilities = items => items.filter(item => item.resource.kind === '시설');
const recommend = (api, purpose, text, options, facility = null, people) => api.recommendationItems(purpose, api.analyzeInput(text), facility, condition, [], {}, people, options);
const plain = value => JSON.parse(JSON.stringify(value));
const keyword = (keyword, matchMode = 'CONTAINS', effect = 'INCLUDE', priority = 0) => ({keyword, matchMode, effect, priority});
const rule = (purposeId, name, keywords = [], equipment = []) => ({purposeId, name, keywords, equipment});
const fixture = rules => ({purposes: ['인터뷰 촬영', '과제 영상 촬영', '발표 연습', '팀 회의', '자료 작업'], purposeRules: rules, reservations: [], resources: [
  ...['카메라', '마이크', '프로젝터', '노트북'].map((category, index) => ({id: `equipment:${index + 1}`, kind: '장비', name: category, category, rentable: true, status: '정상'})),
  {id: 'facility:1', kind: '시설', name: '검증 회의 공간', category: '회의실', rentable: true, status: '정상', capacity: 20,
    allowedUses: ['팀 회의', '발표 연습'], operatingHours: ['09:00', '18:00'], hoursByWeekday: {'1': ['09:00', '18:00']}},
]});
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };

check('면접·모의면접·취업 면접은 촬영 목적을 사칭하지 않는 활동으로 인식', () => {
  for (const text of ['면접', '모의면접', '취업 면접 4명']) {
    const analysis = demo.analyzeInput(text);
    assert.equal(analysis.activityLabel, '면접 준비');
    assert.equal(analysis.customActivity, true);
    assert(analysis.candidates.includes('면접 준비'));
    assert(!analysis.candidates.includes('인터뷰 촬영'));
    assert.equal(analysis.proposedNeeds.space, true);
    assert.equal(analysis.proposedNeeds.video, false);
  }
});
check('면접 녹화·녹음 요구는 영상·음성 후보를 제안', () => {
  const analysis = demo.analyzeInput('4명 모의면접 녹화와 녹음');
  assert.equal(analysis.people, 4);
  assert.equal(analysis.proposedNeeds.video, true);
  assert.equal(analysis.proposedNeeds.audio, true);
  const items = recommend(demo, '면접 준비', '모의면접 녹화와 녹음', {needs: analysis.proposedNeeds, facilityUse: ''});
  assert(equipment(items).some(item => item.resource.category === '카메라'));
  assert(equipment(items).some(item => item.resource.category === '마이크'));
});
check('스터디·학습·세미나·워크숍 동의어를 실용적 요구로 분류', () => {
  for (const text of ['스터디', '시험 준비 공부', '독서 학습']) assert.equal(demo.analyzeInput(text).activityLabel, '스터디');
  for (const text of ['세미나', '동아리 행사', '워크숍', '특강']) {
    const analysis = demo.analyzeInput(text);
    assert.equal(analysis.activityLabel, '세미나·행사');
    assert.equal(analysis.proposedNeeds.presentation, true);
    assert.equal(analysis.proposedNeeds.audio, true);
  }
});
check('자원 이름만 입력하면 기존 직접 탐색 경로를 유지', () => {
  assert.equal(demo.purposeSubmitTarget(demo.analyzeInput('카메라')), 'equipment');
  for (const text of ['회의실', '스터디룸', '촬영실']) assert.equal(demo.purposeSubmitTarget(demo.analyzeInput(text)), 'facility');
});
check('일반 영상의 확인 질문과 인원 모호성·촬영 제외를 보존', () => {
  const video = demo.analyzeInput('영상을 촬영하고 싶어요');
  assert.equal(video.intent, 'video'); assert.equal(video.candidates.length, 0);
  assert(video.confirmations.includes('일반 영상 촬영'));
  assert.equal(demo.analyzeInput('회의 4~6명').peopleStatus, 'ambiguous');
  assert.equal(demo.analyzeInput('회의 0명').peopleStatus, 'invalid');
  const excluded = recommend(demo, '인터뷰 촬영', '인터뷰 촬영 없이');
  assert(!equipment(excluded).some(item => item.resource.category === '카메라'));
});
check('미등록 자유 활동도 사용자가 명시한 요구에 맞춰 추천', () => {
  const analysis = demo.analyzeInput('보드게임 모임');
  assert.equal(analysis.intent, 'unknown'); assert.equal(analysis.customActivity, true);
  assert.equal(recommend(demo, '기타 활동', '보드게임 모임').length, 0);
  const items = recommend(demo, '기타 활동', '보드게임 모임', {needs: needs({space: true, audio: true}), facilityUse: ''});
  assert(facilities(items).length > 0);
  assert(equipment(items).every(item => item.resource.category === '마이크'));
});
check('명시한 빈 요구는 기존 활동 기본값과 장비 단어를 모두 덮어쓴다', () => {
  const items = recommend(demo, '인터뷰 촬영', '인터뷰 카메라 촬영', {needs: needs(), facilityUse: '인터뷰 촬영'});
  assert.equal(items.length, 0);
});
check('사용자가 직접 체크한 영상 요구는 문장 내 촬영 제외보다 우선', () => {
  const items = recommend(demo, '면접 준비', '면접 촬영 없이', {needs: needs({video: true}), facilityUse: ''});
  assert.equal(items.length, 1);
  assert.equal(items[0].resource.category, '카메라');
  const unchecked = recommend(demo, '인터뷰 촬영', '인터뷰 카메라 촬영', {needs: needs({audio: true}), facilityUse: ''});
  assert(equipment(unchecked).every(item => item.resource.category === '마이크'));
});
check('활동 라벨은 실제 시설 허용 목적으로 자동 승격하지 않는다', () => {
  const draft = {...condition, use: '면접 준비'};
  const items = recommend(demo, '면접 준비', '면접 준비', {needs: needs({space: true}), facilityUse: ''}, draft);
  assert(facilities(items).length > 0);
  assert(facilities(items).every(item => item.condition === null && item.conditionRequired));
  const invalidUse = recommend(demo, '면접 준비', '면접 준비', {needs: needs({space: true}), facilityUse: '면접 준비'}, draft);
  assert(facilities(invalidUse).every(item => item.condition === null));
});
check('명시한 실제 목적만 허용 시설을 필터하고 신청 조건에 전달', () => {
  const items = recommend(demo, '면접 준비', '면접 준비', {needs: needs({space: true}), facilityUse: '팀 회의'}, condition);
  assert(facilities(items).length > 0);
  assert(facilities(items).every(item => item.resource.allowedUses.includes('팀 회의') && item.condition.use === '팀 회의' && !item.conditionRequired));
});
check('명시 인원으로 공간 후보를 제한하고 작은 시설을 추천하지 않는다', () => {
  const items = recommend(demo, '면접 준비', '면접 4명', {needs: needs({space: true}), facilityUse: ''}, null, 6);
  assert(facilities(items).length > 0);
  assert(facilities(items).every(item => item.resource.capacity >= 6));
});
check('서버 등록 키워드는 CONTAINS·EXACT·EXCLUDE·우선순위를 적용', () => {
  const api = model(true);
  api.replaceCatalog(fixture([
    rule('1', '팀 회의', [keyword('팀 모임'), keyword('개인모임', 'CONTAINS', 'EXCLUDE'), keyword('공동작업', 'CONTAINS', 'INCLUDE', 10)]),
    rule('2', '발표 연습', [keyword('포스터 점검', 'EXACT')]),
    rule('3', '자료 작업', [keyword('공동작업', 'CONTAINS', 'INCLUDE', 40)]),
  ]));
  assert(api.analyzeInput('팀 모임 준비').candidates.includes('팀 회의'));
  assert(!api.analyzeInput('팀 모임 개인모임').candidates.includes('팀 회의'));
  assert(api.analyzeInput('포스터   점검').candidates.includes('발표 연습'));
  assert(!api.analyzeInput('포스터 점검 도와줘').candidates.includes('발표 연습'));
  assert.deepEqual(plain(api.analyzeInput('공동작업').candidates), ['자료 작업', '팀 회의']);
});
check('서버 목적 장비 규칙의 실제 품목·필요 구분·사유를 사용', () => {
  const api = model(true);
  api.replaceCatalog(fixture([rule('1', '자료 작업', [keyword('데이터 정리')], [{typeName: '노트북', needLevel: 'REQUIRED', reason: '등록된 자료 정리 기준'}])]));
  const items = recommend(api, '자료 작업', '데이터 정리');
  assert.equal(equipment(items).length, 1);
  assert.equal(items[0].resource.category, '노트북');
  assert.equal(items[0].optional, false);
  assert.equal(items[0].source, 'catalog-rule');
  assert(items[0].role.includes('등록된 자료 정리 기준'));
});
check('서버의 빈 규칙을 하드코딩 목적 장비로 대체하지 않는다', () => {
  const api = model(true); api.replaceCatalog(fixture([]));
  assert.equal(equipment(recommend(api, '인터뷰 촬영', '인터뷰 촬영')).length, 0);
  const explicit = recommend(api, '인터뷰 촬영', '인터뷰 촬영', {needs: needs({video: true}), facilityUse: ''});
  assert.equal(equipment(explicit).length, 1);
  assert.equal(explicit[0].source, 'user-needs');
});
check('잘못된 목적 규칙 metadata를 거부하고 이전 카탈로그를 보존', () => {
  const api = model(true); api.replaceCatalog(fixture([]));
  for (const invalid of [null, [rule('1', '존재하지 않는 목적')], [rule('1', '팀 회의', [keyword('회의', 'INVALID')])], [rule('1', '팀 회의', [], [{typeName: '마이크', needLevel: 'MUST', reason: '잘못된 규칙'}])]])
    assert.throws(() => api.replaceCatalog(fixture(invalid)), /추천 규칙/);
  assert.equal(api.resources.length, 5); assert.equal(api.purposeRules.length, 0);
});
check('기존 4목적의 demo 구성과 새 활동 설명을 안전하게 제공', () => {
  for (const purpose of ['인터뷰 촬영', '과제 영상 촬영', '발표 연습', '팀 회의']) assert(recommend(demo, purpose, purpose).length > 0);
  for (const purpose of ['면접 준비', '스터디', '세미나·행사', '기타 활동', '알 수 없는 활동']) {
    const definition = demo.recommendationDefinition(purpose, demo.analyzeInput(purpose), {needs: needs({space: true})});
    assert.equal(definition.title, purpose); assert.equal(typeof definition.reason, 'string'); assert(definition.reason.length > 0);
  }
});

console.log(`\n${checks} purpose recommendation semantic checks passed.`);
