import {escapeHTML, navigate} from './ui.js';
import * as store from './store.js';
import {serverMode} from './data.js';
import {requestStatus, componentBalances} from './request-detail.js';
const e = escapeHTML;
const summaryState = {ownerId: null, data: null, error: '', loading: false, request: 0, recordsKey: '', dirty: true};
let homeContainer = null;
const summaryViews = {
  'today-pickup': {key: 'pickup', title: '오늘 수령', description: '승인된 장비의 수령 예정'},
  'today-return': {key: 'returnDue', title: '오늘 반납 예정', description: '대여 중인 장비의 반납 예정'},
  'today-facilities': {key: 'facilityUse', title: '오늘 시설 이용', description: '오늘과 겹치는 승인·이용 중 예약'},
};

export function campusTimestamp(value) {
  if (!value) return NaN;
  const text = String(value);
  return Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(text) ? `${text}+09:00` : text);
}

function campusDay(value) {
  return new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'}).format(value);
}

export function matchesSummaryView(item, view, basisDate) {
  if (!summaryViews[view] || !/^\d{4}-\d\d-\d\d$/.test(basisDate || '')) return false;
  const today = campusTimestamp(`${basisDate}T00:00`), tomorrow = today + 86400000;
  const start = campusTimestamp(item.condition?.start), end = campusTimestamp(item.condition?.end);
  const status = requestStatus(item).code;
  if (view === 'today-pickup') return item.kind === '장비' && status === 'APPROVED' && start >= today && start < tomorrow;
  if (view === 'today-return') return item.kind === '장비' && status === 'CHECKED_OUT' && end >= today && end < tomorrow;
  return item.kind === '시설' && ['APPROVED', 'IN_USE'].includes(status) && start < tomorrow && end > today;
}

// The independent demo has no server session. Mirror the summary read rules using its own records.
export function demoPersonalSummary(state, now = Date.now()) {
  const basisDate = campusDay(now), counts = {pickup: 0, returnDue: 0, facilityUse: 0};
  const candidates = [], seen = new Set();
  for (const record of state.records.filter(record => String(record.userId) === String(state.user?.id))) {
    for (const item of record.items) {
      if (seen.has(String(item.id))) continue;
      seen.add(String(item.id));
      for (const [view, definition] of Object.entries(summaryViews)) if (matchesSummaryView(item, view, basisDate)) counts[definition.key] += 1;
      const status = requestStatus(item);
      let actionType = '', actionAt = '', priority = 2;
      if (status.code === 'RETURN_HELD') {
        actionType = 'return-held'; priority = 0;
        actionAt = item.inspections?.at(-1)?.at || item.history?.filter(event => requestStatus({...item, status: event.to}).code === 'RETURN_HELD').at(-1)?.at || '';
      } else if (status.code === 'RETURN_REQUESTED') {
        actionType = 'return-requested'; priority = 1;
        actionAt = item.history?.filter(event => requestStatus({...item, status: event.to}).code === 'RETURN_REQUESTED').at(-1)?.at || '';
      } else if (status.code === 'APPROVED') {
        actionType = item.kind === '시설' ? 'facility-start' : 'pickup'; actionAt = item.condition?.start;
      } else if (status.code === 'CHECKED_OUT') {
        actionType = 'return'; actionAt = item.condition?.end;
      } else if (item.kind === '시설' && status.code === 'IN_USE') {
        actionType = 'facility-end'; actionAt = item.condition?.end;
      }
      const at = campusTimestamp(actionAt);
      if (!actionType || (priority === 2 && !(at >= now && at < now + 7 * 86400000))) continue;
      candidates.push({itemId: String(item.id), requestNumber: record.number,
        originalIndex: item.originalIndex || record.items.indexOf(item) + 1, name: item.name,
        kind: item.kind, status: status.label, statusCode: status.code, actionAt: actionAt || '', actionType,
        reason: item.reason || '', missingComponents: status.code === 'RETURN_HELD'
          ? componentBalances(item).filter(component => !component.invalid && component.missing > 0)
            .sort((a, b) => Number(b.required) - Number(a.required)).map(component => ({componentId: component.componentId, name: component.name, quantity: component.missing})) : [],
        priority});
    }
  }
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const at = campusTimestamp(a.actionAt), bt = campusTimestamp(b.actionAt);
    const delta = a.priority === 2 ? at - bt : (Number.isFinite(bt) ? bt : -Infinity) - (Number.isFinite(at) ? at : -Infinity);
    return delta || a.itemId.localeCompare(b.itemId, 'en', {numeric: true});
  });
  return {basisDate, generatedAt: new Date(now).toISOString(), timeZone: 'Asia/Seoul', counts,
    todo: candidates.slice(0, 3).map(({priority, ...item}) => item)};
}

function summaryTime(value, basisDate) {
  const time = campusTimestamp(value);
  if (!Number.isFinite(time)) return '처리 시각 기록 없음';
  const date = campusDay(time), tomorrow = campusDay(campusTimestamp(`${basisDate}T00:00`) + 86400000);
  const clock = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false}).format(time);
  return `${date === basisDate ? '오늘 ' : date === tomorrow ? '내일 ' : ''}${clock} · ${date}`;
}

export function personalSummaryHtml(data) {
  const labels = {pickup: '수령 예정', return: '반납 예정', 'facility-start': '시설 이용 시작 예정', 'facility-end': '시설 이용 종료 예정', 'return-held': '추가 반환 필요', 'return-requested': '관리자 반환 확인 대기'};
  const cards = Object.entries(summaryViews).map(([view, definition]) => `<a class="personal-summary-card" data-link href="/records?view=${view}&date=${e(data.basisDate)}"><span>${definition.title}</span><strong>${e(data.counts[definition.key])}<small>건</small></strong><p>${definition.description}</p><span class="personal-card-link">해당 신청 보기 →</span></a>`).join('');
  return `<p class="small muted personal-summary-basis">${e(data.basisDate)} · 한국 시간 기준 · 개별 신청 항목 수</p><div class="personal-summary-cards">${cards}</div>${Object.values(data.counts).every(count => count === 0) ? '<p class="personal-summary-empty">오늘 예정된 일정이 없습니다. <a data-link href="/equipment">장비</a>나 <a data-link href="/facilities">시설</a>을 찾아보세요.</p>' : ''}<div class="personal-todo-heading"><h3>다음 할 일</h3><a data-link href="/records">신청 현황 전체 보기 →</a></div>${data.todo.length ? `<ol class="personal-todo-list">${data.todo.map(item => {
    const status = requestStatus(item);
    return `<li><div class="personal-todo-top"><p class="small muted">${e(item.kind)} · ${e(item.requestNumber)} · 항목 ${e(item.originalIndex)}</p><span class="${status.className}">${e(status.label)}</span></div><h4>${e(item.name)}</h4><p class="personal-todo-action">${e(labels[item.actionType] || status.next)}</p><p class="small muted">${['return-held', 'return-requested'].includes(item.actionType) ? '기록된 처리 시각 · ' : ''}${e(summaryTime(item.actionAt, data.basisDate))}</p>${item.actionType === 'return-held' && item.missingComponents?.length ? `<p class="small error-text">${item.missingComponents.map(component => `${e(component.name)} ${e(component.quantity)}개`).join(' · ')} 추가 반환 필요</p>` : ''}${item.actionType === 'return-held' && item.reason ? `<p class="small">보류 사유: ${e(item.reason)}</p>` : ''}<a data-link class="btn btn-secondary" href="/records?item=${encodeURIComponent(item.itemId)}" aria-label="${e(item.name)} 신청 상세">신청 상세</a></li>`;
  }).join('')}</ol>` : '<p class="personal-summary-empty">지금 확인할 다음 할 일이 없습니다. 앞으로 7일의 예정 일정과 반환 확인이 필요한 신청을 안내합니다.</p>'}<p class="small muted personal-summary-updated">조회 시각 ${e(summaryTime(data.generatedAt, data.basisDate))}</p>`;
}

function renderPersonalHome() {
  const host = homeContainer?.querySelector('[data-personal-home]');
  if (!host || location.pathname !== '/') return;
  const user = store.getState().user;
  host.hidden = !user;
  if (!user) { host.innerHTML = ''; return; }
  if (user.role === 'admin') {
    host.innerHTML = '<div class="panel personal-admin-entry"><div><h2>관리자 업무</h2><p class="muted">신청 검토와 자원 운영을 관리하세요.</p></div><a class="btn btn-primary" data-link href="/admin">신청 관리</a></div>';
    return;
  }
  const content = summaryState.loading ? '<p class="personal-summary-message" role="status">내 대여·예약 일정을 불러오는 중…</p>'
    : summaryState.error ? `<div class="personal-summary-message"><p role="alert">일정을 불러오지 못했습니다.</p><p class="small muted">${e(summaryState.error)}</p><button class="btn btn-secondary" type="button" data-summary-retry>다시 시도</button></div>`
    : summaryState.data ? personalSummaryHtml(summaryState.data) : '';
  host.innerHTML = `<div class="personal-summary-heading"><div><p class="eyebrow">나의 CampusRent</p><h2>내 대여·예약</h2></div><a data-link href="/records">신청 현황 전체 보기 →</a></div><div data-summary-content aria-live="polite" aria-busy="${summaryState.loading}">${content}</div>`;
  host.querySelector('[data-summary-retry]')?.addEventListener('click', () => loadPersonalSummary());
}

function resetSummary(ownerId) {
  summaryState.ownerId = ownerId; summaryState.request += 1; summaryState.data = null;
  summaryState.error = ''; summaryState.loading = false; summaryState.recordsKey = ''; summaryState.dirty = true;
}

async function loadPersonalSummary() {
  const state = store.getState(), ownerId = state.user?.role === 'student' ? String(state.user.id) : null;
  if (!ownerId) return;
  const request = ++summaryState.request;
  summaryState.loading = true; summaryState.error = ''; summaryState.data = null; summaryState.dirty = false;
  renderPersonalHome();
  try {
    const result = serverMode ? await store.requestApi('/api/me/summary') : demoPersonalSummary(state);
    if (summaryState.request !== request || String(store.getState().user?.id) !== ownerId) return;
    if (!/^\d{4}-\d\d-\d\d$/.test(result.basisDate || '') || result.timeZone !== 'Asia/Seoul' ||
        !['pickup', 'returnDue', 'facilityUse'].every(key => Number.isSafeInteger(result.counts?.[key]) && result.counts[key] >= 0) || !Array.isArray(result.todo)) throw new Error('일정 응답을 확인하지 못했습니다. 다시 조회해주세요.');
    summaryState.data = {...result, todo: result.todo.slice(0, 3)};
  } catch (error) {
    if (summaryState.request === request) summaryState.error = error.message || '잠시 후 다시 조회해주세요.';
  } finally {
    if (summaryState.request === request) { summaryState.loading = false; renderPersonalHome(); }
  }
}

function updatePersonalHome(container) {
  homeContainer = container;
  const state = store.getState(), ownerId = state.user?.role === 'student' ? String(state.user.id) : null;
  if (summaryState.ownerId !== ownerId) resetSummary(ownerId);
  if (!ownerId) { renderPersonalHome(); return; }
  const recordsKey = JSON.stringify(state.records.map(record => [record.number, record.items.map(item => [item.id, item.version, item.status])]));
  if (recordsKey !== summaryState.recordsKey) { summaryState.recordsKey = recordsKey; summaryState.dirty = true; }
  if (summaryState.dirty) loadPersonalSummary(); else renderPersonalHome();
}

store.subscribe(({user}) => {
  const ownerId = user?.role === 'student' ? String(user.id) : null;
  if (summaryState.ownerId !== ownerId) { resetSummary(ownerId); renderPersonalHome(); }
});
for (const eventName of ['campus:navigate', 'popstate']) window.addEventListener(eventName, () => { summaryState.dirty = true; });
const image = name => `<img src="/assets/${name}" alt="">`;
const activities = [
  {title: '인터뷰 촬영 시작하기', activity: '인터뷰 촬영', icon: '054e2.svg', summary: '카메라 세트 + 마이크 세트', description: '영상과 음성을 함께 기록할 때 필요한 구성입니다.'},
  {title: '발표 연습 준비하기', activity: '발표 연습', icon: '1eae3.svg', summary: '회의실 + 필요 시 빔프로젝터', description: '발표 공간을 확인하고, 비치 설비에 따라 필요한 장비를 선택하세요.'},
  {title: '팀 회의 시작하기', activity: '팀 회의', icon: 'b46a5.svg', summary: '스터디룸·회의실', description: '참여 인원과 이용 목적에 맞는 공간을 찾으세요.'}
];
export function renderHome(container, params) {
  const activity = params.get('activity') || '';
  container.className = 'home-page';
  if (container.querySelector('#activity-search')) {
    const field = container.querySelector('#activity');
    if (field.value !== activity) field.value = activity;
    container.querySelectorAll('[data-keyword]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.keyword === activity)));
    const shortcut = container.querySelector('.purpose-shortcut a');
    if (shortcut) shortcut.href = `/purpose${activity ? '?activity=' + encodeURIComponent(activity) : ''}`;
    updatePersonalHome(container);
    return;
  }
  summaryState.dirty = true;
  container.innerHTML = `
    <section class="hero-section" aria-labelledby="hero-title"><div class="hero-heading">
      <p class="eyebrow">교내 시설·장비 이용을 한곳에서</p>
      <h1 id="hero-title">하고 싶은 활동에 맞춰,<br>공간과 장비를 찾아보세요.</h1>
      <p>필요한 것이 정해져 있다면 직접 찾고, 처음이라면 목적에 맞는 추천으로 시작하세요.</p>
    </div><form class="hero-search" id="activity-search"><label for="activity">어떤 활동을 준비하고 계신가요?</label>
      <div class="hero-input-row">${image('8adc4.svg')}<input id="activity" name="activity" value="${escapeHTML(activity)}" placeholder="예: 면접 연습 3명, 독서 모임, 인터뷰 촬영" autocomplete="off"><button class="btn btn-primary" type="submit">목적에 맞게 추천받기</button></div>
      <div class="keyword-row"><span>활동 예시</span><div class="keyword-buttons">${['면접 준비', '인터뷰 촬영', '발표 연습', '팀 회의', '과제 영상 촬영', '기타 직접 입력'].map(keyword => `<button type="button" class="chip" data-keyword="${keyword}" aria-pressed="${activity === keyword}">${keyword}</button>`).join('')}</div></div>
    </form></section>
    <section class="quick-section section-inner" aria-labelledby="quick-title"><h2 id="quick-title">필요한 것이 정해져 있나요?</h2><div class="quick-grid">
      <a class="quick-card" href="/equipment" data-link><span class="quick-content"><span class="quick-icon">${image('ff97a.svg')}</span><span><strong>장비 대여</strong><span>카메라 · 빔프로젝터 · 무선 마이크 등</span></span></span>${image('0272b.svg')}</a>
      <a class="quick-card" href="/facilities" data-link><span class="quick-content"><span class="quick-icon">${image('8f64d.svg')}</span><span><strong>시설 대여</strong><span>스터디룸·회의실</span></span></span>${image('0272b.svg')}</a>
    </div></section>
    <section class="purpose-shortcut section-inner"><a href="/purpose${activity ? '?activity=' + encodeURIComponent(activity) : ''}" data-link><span><h2>목적별 대여</h2><p>무엇을 준비할지 모르겠다면 활동을 설명하고 추천받으세요.</p></span><span class="shortcut-arrow" aria-hidden="true">→</span></a></section>
    <section class="personal-home section-inner" data-personal-home aria-label="내 대여·예약" hidden></section>
    <section class="recommendation-section" aria-labelledby="recommend-title"><div class="section-inner"><div class="section-heading"><h2 id="recommend-title">이런 활동을 준비하고 있나요?</h2><p>활동 목적에 맞는 장비와 공간을 살펴보고, 필요한 항목을 각각 신청하세요.</p></div>
      <div class="activity-grid">${activities.map(item => `<article class="activity-card"><div class="activity-icon">${image(item.icon)}</div><div><h3>${item.title}</h3><p class="activity-description">${item.summary}<br>${item.description}</p></div><p class="activity-note">추천 구성은 예시입니다. 실제 재고와 이용 가능 여부를 확인한 뒤 신청하세요.</p><div class="activity-divider">${image('f70fa.svg')}</div><a href="/purpose?activity=${encodeURIComponent(item.activity)}" data-link class="activity-link">구성 살펴보기 ${image('8ad40.svg')}</a></article>`).join('')}</div>
    </div></section>
    <section class="guide-section section-inner" aria-labelledby="guide-title"><div class="section-heading centered"><h2 id="guide-title">간단한 3단계 예약 절차</h2><p>신청부터 최종 예약 확정까지의 과정입니다.</p></div><div class="steps-grid">${[
      ['시설 및 장비 탐색', '목적별 추천 또는 개별 탐색을 통해 필요한 공간과 장비를 찾습니다.'],
      ['조건 확인 및 개별 신청', '이용 규칙, 구비 품목을 확인하고 날짜와 시간에 맞춰 개별 신청을 작성합니다.'],
      ['관리자 승인 후 이용', '내 신청 현황에서 승인 결과를 확인한 뒤, 안내된 절차에 따라 이용합니다.']
    ].map(([title, description], i) => `<article class="step"><div class="step-number"><span>0${i + 1}</span>${i < 2 ? image('79009.svg') : ''}</div><h3>${title}</h3><p>${description}</p></article>`).join('')}</div><div class="guide-note">${image('cb39c.svg')}<p>시설과 장비는 각각 신청합니다. 신청 시에는 승인 대기이며, 관리자 승인 후 예약이 확정됩니다.</p></div></section>`;
  const field = container.querySelector('#activity');
  container.querySelector('#activity-search').addEventListener('submit', event => { event.preventDefault(); navigate('/purpose?activity=' + encodeURIComponent(field.value.trim())); });
  container.querySelectorAll('[data-keyword]').forEach(button => button.addEventListener('click', () => {
    field.value = button.dataset.keyword === '기타 직접 입력' ? (field.value.trim() === '기타' ? '' : field.value) : button.dataset.keyword;
    if (button.dataset.keyword === '기타 직접 입력') field.placeholder = '원하는 활동을 입력하세요. 예: 취업 면접 연습';
    container.querySelectorAll('[data-keyword]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    history.replaceState({}, '', '/?activity=' + encodeURIComponent(field.value)); field.focus();
  }));
  field.addEventListener('input', () => {
    const url = new URL(location.href);
    if (field.value) url.searchParams.set('activity', field.value); else url.searchParams.delete('activity');
    history.replaceState({}, '', url.pathname + url.search);
    container.querySelectorAll('[data-keyword]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.keyword === field.value)));
  });
  updatePersonalHome(container);
}
