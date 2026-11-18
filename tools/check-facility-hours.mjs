import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/main/resources/static/js/data.js', import.meta.url), 'utf8');
const code = source.replace(/^export /gm, '') + '\n;globalThis.catalogApi = {resources, catalogState, replaceCatalog, availability};';
function loadMode(server) {
  const context = vm.createContext(server ? {document: {documentElement: {dataset: {backend: 'server'}}}} : {});
  new vm.Script(code, {filename: 'data.js'}).runInContext(context);
  return context.catalogApi;
}
const server = loadMode(true);
const demo = loadMode(false);
let checks = 0;
const check = (name, run) => { run(); checks++; console.log(`PASS ${name}`); };
const facility = (hours = {}, representative = []) => ({id: 'facility:999', name: '운영 시간 검증 시설', kind: '시설', rentable: true, status: '정상', capacity: 12, allowedUses: ['팀 회의'], operatingHours: representative, hoursByWeekday: hours});
const equipment = {id: 'equipment:999', name: '유지되는 장비', kind: '장비', rentable: true, status: '정상'};
const catalog = item => ({resources: [equipment, item], purposes: ['팀 회의'], reservations: [], restrictions: {}});
const condition = (day, start = '10:00', end = '11:00') => ({start: `${day}T${start}`, end: `${day}T${end}`, people: 1, use: '팀 회의'});
const monday = '2030-01-07', tuesday = '2030-01-08', wednesday = '2030-01-09', sunday = '2030-01-13';
check('운영 시간 미설정 시설이 전체 카탈로그를 막지 않는다', () => {
  server.replaceCatalog(catalog(facility()));
  assert.equal(server.catalogState.ready, true);
  assert.equal(server.resources.length, 2);
  assert(server.availability(server.resources[1], condition(monday)).some(reason => reason.includes('운영 시간')));
  assert.equal(server.availability(server.resources[0], condition(monday)).length, 0);
});
const varied = facility({'1': ['09:00', '12:00'], '2': ['13:00', '18:00'], '7': ['10:00', '11:00']}, ['09:00', '12:00']);
check('월요일은 ISO 1번 운영 시간을 사용한다', () => {
  server.replaceCatalog(catalog(varied));
  assert.equal(server.availability(server.resources[1], condition(monday)).length, 0);
});
check('화요일은 대표 월요일 시간이 아니라 자체 운영 시간을 사용한다', () => {
  const room = server.resources[1];
  assert(server.availability(room, condition(tuesday)).some(reason => reason.includes('13:00')));
  assert.equal(server.availability(room, condition(tuesday, '14:00', '15:00')).length, 0);
});
check('설정되지 않은 요일은 대표 시간으로 대체하지 않는다', () => {
  assert(server.availability(server.resources[1], condition(wednesday)).some(reason => reason.includes('설정되지')));
});
check('일요일은 ISO 7번으로 처리하고 종료 경계를 허용한다', () => {
  assert.equal(server.availability(server.resources[1], condition(sunday)).length, 0);
});
check('서버의 요일 정보 누락은 대표 시간으로 신청을 허용하지 않는다', () => {
  const missingDays = {...varied}; delete missingDays.hoursByWeekday;
  server.replaceCatalog(catalog(missingDays));
  assert(server.availability(server.resources[1], condition(monday)).some(reason => reason.includes('설정되지')));
});
check('잘못된 ISO 요일과 시간 형식을 거부한다', () => {
  for (const invalidDays of [null, [], {'0': ['09:00', '18:00']}, {'8': ['09:00', '18:00']}, {'01': ['09:00', '18:00']}, {'mon': ['09:00', '18:00']}, {'1': ['24:00', '25:00']}, {'1': ['09:60', '18:00']}, {'1': ['9:00', '18:00']}, {'1': ['18:00', '09:00']}, {'1': ['09:00']}, {'1': []}, {'1': [9, 18]}])
    assert.throws(() => server.replaceCatalog(catalog(facility(invalidDays))), /운영 시간/);
  assert.throws(() => server.replaceCatalog(catalog(facility({}, ['99:99', '99:99']))), /운영 시간/);
});
check('비서버 시연의 기존 대표 운영 시간은 유지한다', () => {
  const room = demo.resources.find(item => item.kind === '시설');
  const copy = {...room, operatingHours: ['09:00', '18:00']};
  const request = {...condition(monday), use: room.allowedUses[0]};
  assert.equal(demo.availability(copy, request).length, 0);
  assert(demo.availability(copy, {...request, start: `${monday}T19:00`, end: `${monday}T20:00`}).some(reason => reason.includes('운영 시간')));
});
console.log(`${checks} facility-hours regressions passed`);
