import assert from 'node:assert/strict';
import {
  resources, analyzeInput, participantAnalysis, recommendationItems,
  initialConditions, availability, alternateResources, alternateSlots,
  conditionErrors, purposeSubmitTarget,
} from '../src/main/resources/static/js/data.js';

let checks = 0;
const check = (label, run) => { run(); checks += 1; console.log(`PASS ${label}`); };
check('원본의 장비 7개와 시설 5개를 보존', () => {
  assert.equal(resources.filter(resource => resource.kind === '장비').length, 7);
  assert.equal(resources.filter(resource => resource.kind === '시설').length, 5);
});
check('6명 회의의 목적과 인원을 인식', () => {
  const analysis = analyzeInput('학생회 회의 6명');
  assert.equal(analysis.people, 6);
  assert.deepEqual(analysis.candidates, ['팀 회의']);
  assert.equal(analysis.intent, 'recognized');
});
check('6명 회의에 수용 인원 미달 시설을 추천하지 않음', () => {
  const recommendations = recommendationItems('팀 회의', analyzeInput('학생회 회의 6명'), null, null);
  const spaces = recommendations.filter(item => item.resource.kind === '시설');
  assert(spaces.length > 0);
  assert(spaces.every(item => item.resource.capacity >= 6));
});
check('일반 영상 촬영을 인터뷰로 임의 확정하지 않음', () => {
  const analysis = analyzeInput('영상을 촬영하고 싶어요');
  assert.equal(analysis.intent, 'video');
  assert.equal(analysis.candidates.length, 0);
  assert(analysis.confirmations.includes('일반 영상 촬영'));
});
check('자원 이름만 입력하면 직접 검색으로 연결', () => {
  assert.equal(purposeSubmitTarget(analyzeInput('카메라')), 'equipment');
  assert.equal(purposeSubmitTarget(analyzeInput('회의실')), 'facility');
});
check('인원 범위와 잘못된 인원은 확정하지 않음', () => {
  assert.equal(participantAnalysis('회의 4~6명').peopleStatus, 'ambiguous');
  assert.equal(participantAnalysis('회의 0명').peopleStatus, 'invalid');
});
check('촬영 제외 문구를 추천에 반영', () => {
  const analysis = analyzeInput('학생회 회의 촬영 없이');
  assert.deepEqual(analysis.excludedEquipment, ['카메라']);
});
const microphone = resources.find(resource => resource.id === 'mic01');
check('승인된 예약은 해당 기간 사용을 막음', () => {
  assert(availability(microphone, initialConditions).some(reason => reason.includes('겹칩니다')));
});
check('승인 대기 시연 예약은 자원을 확보하지 않음', () => {
  const microphone2 = resources.find(resource => resource.id === 'mic02');
  assert.equal(availability(microphone2, initialConditions).length, 0);
});
check('점검 장비는 신청 가능으로 표시하지 않음', () => {
  const microphone3 = resources.find(resource => resource.id === 'mic03');
  assert(availability(microphone3, initialConditions).some(reason => reason.includes('점검')));
});
check('시설 수용 인원과 이용 목적을 검증', () => {
  const room = resources.find(resource => resource.id === 'room01');
  assert(availability(room, { ...initialConditions, people: 6, use: '팀 회의' }).some(reason => reason.includes('수용')));
  assert(availability(room, { ...initialConditions, use: '인터뷰 촬영' }).some(reason => reason.includes('허용')));
});
check('시설 운영 시간 밖의 이용을 막음', () => {
  const room = resources.find(resource => resource.id === 'room01');
  const day = initialConditions.start.slice(0, 10);
  assert(availability(room, { ...initialConditions, start: `${day}T21:00`, end: `${day}T22:00`, use: '팀 회의' }).some(reason => reason.includes('운영 시간')));
});
check('대체 장비는 지정 관계와 가용성 모두 충족', () => {
  assert.deepEqual(alternateResources(microphone, initialConditions).map(resource => resource.id), ['mic02']);
  const camera2 = resources.find(resource => resource.id === 'cam02');
  assert.equal(alternateResources(camera2, initialConditions).length, 0);
});
check('다른 일정에서도 원래 이용 길이를 유지', () => {
  const day = initialConditions.start.slice(0, 10);
  const slots = alternateSlots(microphone, initialConditions, day, day);
  assert(slots.length > 0);
  assert(slots.every(condition => new Date(condition.end) - new Date(condition.start) === 7_200_000));
});
check('종료가 시작 이전인 조건을 거부', () => {
  assert(conditionErrors({ ...initialConditions, end: initialConditions.start }).length > 0);
});
console.log(`\n${checks} UI data checks passed.`);
