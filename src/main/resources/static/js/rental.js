import {
  resources, purposes, initialConditions, analyzeInput, conditionErrors,
  recommendationItems, recommendations, alternateResources, alternateSlots,
} from './data.js';
import * as store from './store.js';
import { escapeHTML as e, formatDate, formatSchedule, openDialog, notify, navigate } from './ui.js';

// These drafts belong to the screen, not to a submitted application. Navigating,
// signing in, or changing a different kind of resource must not overwrite them.
const drafts = new Map();
const completed = new Set(['반납 완료', '이용 완료', '거절', '신청 취소 완료']);
let mounted = null;
let recordKind = '전체';

function screen(path, params) {
  if (!drafts.has(path)) drafts.set(path, {
    query: '', category: '전체', activity: '', chosen: '', error: '', applied: null,
    condition: { ...initialConditions }, equipment: { ...initialConditions },
    equipmentApplied: null, results: null, peopleEdited: false, peopleActivity: '',
    params: null,
  });
  const value = drafts.get(path);
  const key = params.toString();
  if (value.params !== key) {
    if (params.has('q')) value.query = params.get('q') || '';
    if (params.has('category')) value.category = params.get('category') || '전체';
    if (params.has('activity') && value.activity !== params.get('activity')) {
      value.activity = params.get('activity') || '';
      value.chosen = '';
      value.results = null;
      value.peopleEdited = false;
      const analysis = analyzeInput(value.activity);
      if (analysis.people) value.condition.people = analysis.people;
      value.peopleActivity = value.activity;
    }
    value.params = key;
  }
  return value;
}

function redraw() {
  if (mounted) renderRentalPage(mounted.container, mounted.path, mounted.params);
}

function button(label, attributes = '', primary = false) {
  return `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-secondary'}" ${attributes}>${e(label)}</button>`;
}

function fieldHtml(condition, kind, prefix) {
  const facility = kind === '시설';
  return `<div class="field-grid condition-fields" data-condition-prefix="${e(prefix)}">
    <label class="field">${facility ? '이용 시작 날짜·시간' : '수령 예정일·시간'}
      <input class="input" name="${e(prefix)}-start" type="datetime-local" value="${e(condition.start || '')}"></label>
    ${!facility ? `<div class="field"><span>얼마나 대여하시나요?</span><div class="button-row duration-buttons">${[24, 72].map(hours => button(`${hours / 24}일`, `data-duration="${hours}" data-prefix="${e(prefix)}"`)).join('')}${button('직접 입력', `data-duration="0" data-prefix="${e(prefix)}"`)}</div><span class="small muted">수령 시점부터 계산하는 간편 시연 입력입니다.</span></div>` : ''}
    <label class="field">${facility ? '이용 종료 날짜·시간' : '반납 예정일·시간'}
      <input class="input" name="${e(prefix)}-end" type="datetime-local" value="${e(condition.end || '')}"></label>
    ${facility ? `<label class="field">이용 인원<input class="input" name="${e(prefix)}-people" type="number" min="1" step="1" value="${e(Number.isFinite(condition.people) ? condition.people : '')}"></label>
      <label class="field">시설의 실제 이용 목적<select class="input" name="${e(prefix)}-use"><option value="">목적 선택</option>${purposes.map(use => `<option ${condition.use === use ? 'selected' : ''}>${e(use)}</option>`).join('')}</select></label>` : ''}
    ${!facility ? `<div class="condition-summary small muted" data-duration-summary="${e(prefix)}">${e(formatSchedule(condition, kind))}</div>` : ''}
  </div>`;
}

function localValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function bindFields(scope, prefix, condition, onChange = () => {}) {
  const inputs = ['start', 'end', 'people', 'use'];
  const sync = (changed) => {
    for (const key of inputs) {
      const input = scope.querySelector(`[name="${prefix}-${key}"]`);
      if (input) condition[key] = key === 'people' ? Number(input.value) : input.value;
    }
    const summary = scope.querySelector(`[data-duration-summary="${prefix}"]`);
    if (summary) summary.textContent = formatSchedule(condition, '장비');
    onChange(changed);
  };
  for (const key of inputs) scope.querySelector(`[name="${prefix}-${key}"]`)?.addEventListener('input', () => sync(key));
  scope.querySelectorAll(`[data-duration][data-prefix="${prefix}"]`).forEach(el => el.addEventListener('click', () => {
    const hours = Number(el.dataset.duration);
    const start = new Date(condition.start);
    if (hours && Number.isFinite(start.getTime())) {
      condition.end = localValue(new Date(start.getTime() + hours * 3600000));
      scope.querySelector(`[name="${prefix}-end"]`).value = condition.end;
    }
    scope.querySelectorAll(`[data-duration][data-prefix="${prefix}"]`).forEach(item => {
      item.setAttribute('aria-pressed', String(item === el));
      item.classList.toggle('btn-primary', item === el);
      item.classList.toggle('btn-secondary', item !== el);
    });
    if (!hours) scope.querySelector(`[name="${prefix}-end"]`)?.focus();
    sync('duration');
  }));
}

function selectionFor(resourceId) {
  return store.getState().selection.find(item => item.resourceId === resourceId);
}

function information(resource) {
  const rows = [
    ['식별 정보', `${resource.code} · ${resource.model}`],
    ['위치 / 보관 장소', resource.location],
    ['주요 사양', resource.specs.join(' · ')],
    [resource.kind === '시설' ? '비치 설비' : '기본 구성품', resource.components ? resource.components.map(item => `${item.name} ${item.requiredQuantity}개${item.required ? ' (필수)' : ''}`).join(' · ') : resource.contents.join(' · ')],
    ...(resource.kind === '시설' ? [['운영 시간', resource.operatingHours?.join('–')], ['허용 용도', resource.allowedUses?.join(' · ')]] : []),
    ['이용 조건 (시연)', `${resource.kind === '시설' ? '수용 인원·운영 시간·허용 용도 확인 후 공간 전체 신청' : '고정 세트 전체 대여 · 구성품 단독 대여 불가'} · 관리자 승인 필요`],
  ];
  return `<dl class="resource-information">${rows.map(([title, text]) => `<div><dt>${e(title)}</dt><dd>${e(text || '')}</dd></div>`).join('')}</dl>`;
}

function resourceCard(resource, condition, role = '') {
  const selected = Boolean(selectionFor(resource.id));
  const reasons = store.availability(resource, condition);
  const incomplete = !condition || (resource.kind === '시설' && (!condition.use || conditionErrors(condition, true).length));
  const status = reasons.length ? (incomplete ? '조건 확인 필요' : '이용 불가') : '이용 가능';
  return `<article class="resource-card ${selected ? 'is-selected' : ''}" data-resource="${e(resource.id)}">
    <div class="card-top"><span class="resource-icon"><img src="/assets/${e(resource.icon)}" alt=""></span>
      <label class="selection-checkbox"><input type="checkbox" data-select="${e(resource.id)}" aria-label="${e(resource.name)} 선택" ${selected ? 'checked' : ''} ${reasons.length && !selected ? 'disabled' : ''}> 선택</label></div>
    <p class="small muted">${e(resource.kind)} · ${e(resource.category)}</p><h3>${e(resource.name)}</h3>
    ${role ? `<p class="recommendation-role">${e(role)}</p>` : ''}
    <p class="resource-code">${e(resource.code)} · ${e(resource.model)}</p>
    ${resource.kind === '시설' ? `<p class="capacity">수용 ${e(resource.capacity)}명</p><p class="small">${e(resource.location)}</p><p class="small muted">운영 ${e(resource.operatingHours?.join('–') || '')} · 공간 전체 예약</p><p class="small">허용: ${e(resource.allowedUses?.join(' · ') || '')}</p>` : `<p class="resource-specs">${e(resource.specs.join(' · '))}</p>`}
    <p class="small muted resource-contents">${resource.kind === '시설' ? '비치 설비' : '구성품'}: ${e(resource.contents.join(' · '))}</p>
    ${condition ? `<p class="small muted resource-schedule">${e(formatSchedule(condition, resource.kind))}</p>` : ''}
    <div class="resource-availability"><span class="status ${!reasons.length ? 'status-success' : incomplete ? 'status-muted' : 'status-warning'}">${status}</span>${reasons.map(reason => `<p class="small muted">${e(reason)}</p>`).join('')}</div>
    <div class="button-row">${button('상세보기', `data-detail="${e(resource.id)}"`)}${reasons.length && condition && !incomplete ? button(`대체 ${resource.kind} 추천`, `data-alternative="${e(resource.id)}"`) : ''}</div>
  </article>`;
}

function selectionHtml() {
  const state = store.getState();
  if (state.user?.role === 'admin') return '';
  const items = state.selection.map(item => ({ ...item, resource: resources.find(resource => resource.id === item.resourceId) })).filter(item => item.resource);
  return `<aside class="selection-panel" aria-label="공통 선택 목록"><div class="selection-heading"><h2>선택 목록 <span>${items.length}개</span></h2><button type="button" class="btn-quiet small" data-clear-selection ${items.length ? '' : 'disabled'}>전체 비우기</button></div>
    <p class="small muted">장비·시설의 일정은 개별 보존됩니다.</p><div class="selection-list">
    ${items.length ? items.map(item => `<div class="selection-item"><div class="selection-item-heading"><strong>${e(item.resource.name)}</strong><button type="button" class="icon-button" data-remove="${e(item.id)}" aria-label="${e(item.resource.name)} 제거">×</button></div><p class="small muted">${e(item.resource.kind)} · ${e(item.resource.code)}</p><p class="small">${item.condition ? e(formatSchedule(item.condition, item.resource.kind)) : '이용 조건을 확인해주세요.'}</p>${store.availability(item.resource, item.condition).map(reason => `<p class="small error-text">${e(reason)}</p>`).join('')}<button type="button" class="btn-quiet small" data-edit="${e(item.id)}">이용 조건 수정</button></div>`).join('') : '<p class="selection-empty muted small">카드의 체크박스로 선택한 항목이 여기에 모입니다.</p>'}
    </div><div class="selection-footer"><p class="small muted">장비 ${items.filter(item => item.resource.kind === '장비').length} · 시설 ${items.filter(item => item.resource.kind === '시설').length}</p>${button('신청하기', `data-request ${items.length ? '' : 'disabled'}`, true)}</div></aside>`;
}

function errorAt(scope, message) {
  const node = scope.querySelector('[data-error]');
  if (node) { node.textContent = message; node.hidden = !message; }
  else notify(message);
}

function editCondition(selection) {
  const resource = resources.find(item => item.id === selection.resourceId);
  if (!resource) return;
  const draft = { ...(selection.condition || initialConditions) };
  openDialog('선택 항목 이용 조건 수정', `<form data-edit-form novalidate><p class="modal-section"><strong>${e(resource.name)}</strong></p>${fieldHtml(draft, resource.kind, 'edit')}<p data-error class="error-text" role="alert" hidden></p><div class="modal-actions">${button('취소', 'data-close-dialog')}<button class="btn btn-primary" type="submit">조건 확인 후 적용</button></div></form>`, dialog => {
    bindFields(dialog, 'edit', draft);
    dialog.querySelector('[data-edit-form]').addEventListener('submit', async event => {
      event.preventDefault();
      const errors = store.availability(resource, draft);
      if (errors.length) return errorAt(dialog, errors.join(' '));
      try { await store.updateSelection(selection.id, { ...draft }); dialog.close(); notify('선택 항목의 이용 조건을 수정했습니다.'); } catch (error) { errorAt(dialog, error.message); }
    });
  });
}

function detail(resource, condition) {
  const errors = store.availability(resource, condition);
  openDialog(resource.name, `<div class="modal-section"><span class="resource-icon"><img src="/assets/${e(resource.icon)}" alt=""></span><p class="small muted">시연용 가상 ${e(resource.kind)} 정보입니다.</p></div>${information(resource)}${condition ? `<p class="notice small">${e(formatSchedule(condition, resource.kind))}</p>` : ''}<div class="modal-actions">${button('닫기', 'data-close-dialog')}${button(selectionFor(resource.id) ? '선택 목록에서 제거' : '선택 목록에 담기', `data-detail-select ${errors.length && !selectionFor(resource.id) ? 'disabled' : ''}`, true)}</div>`, dialog => {
    dialog.querySelector('[data-detail-select]').addEventListener('click', async () => {
      try { await store.toggleSelection(resource.id, condition ? { ...condition } : null); dialog.close(); } catch (error) { notify(error.message); }
    });
  });
}

function reservationInputs() {
  return store.getReservations();
}

function alternatives(resource, condition, tab = 'resource', range = null) {
  if (!condition) return notify('먼저 이용 조건을 적용해주세요.');
  const from = range?.from || condition.start.slice(0, 10);
  const until = range?.until || localValue(new Date(new Date(`${from}T12:00`).getTime() + 7 * 86400000)).slice(0, 10);
  const selected = store.getState().selection;
  const candidates = alternateResources(resource, condition, reservationInputs(), store.getRestrictions()).filter(item => !selected.some(choice => choice.resourceId === item.id) && !store.availability(item, condition).length);
  const periodLabel = resource.kind === '장비' ? '다른 대여 기간 조회' : '다른 이용 시간대 조회';
  openDialog(`대체 ${resource.kind}·일정 조회`, `<p><strong>원래 항목: ${e(resource.name)}</strong></p><p class="small muted">${e(formatSchedule(condition, resource.kind))}</p><div class="tabs modal-section">${button(`대체 ${resource.kind}`, `data-alt-tab="resource" ${tab === 'resource' ? 'aria-current="page"' : ''}`, tab === 'resource')}${button(periodLabel, `data-alt-tab="period" ${tab === 'period' ? 'aria-current="page"' : ''}`, tab === 'period')}</div>
    ${tab === 'resource' ? (candidates.length ? candidates.map(item => `<article class="panel modal-section"><h3>${e(item.name)}</h3><p class="small recommendation-role">${resource.kind === '장비' ? '등록된 동일 용도 대체 관계 · 사양·구성품 비교' : '요청 인원·용도·시간을 충족하는 공간'}</p><p class="small muted">원래 항목: ${e(resource.specs.join(' · '))} / ${e(resource.contents.join(' · '))}</p>${information(item)}${button('이 항목으로 변경·선택', `data-replace="${e(item.id)}"`, true)}</article>`).join('') : `<div class="empty-state"><p>현재 조건에 맞는 대체 ${e(resource.kind)}가 없습니다.</p><p class="small muted">인원·용도·기간을 수정하거나 다른 시간대를 조회해주세요.</p></div>`) : `<h3>${periodLabel}</h3><p class="small muted">동일한 ${e(resource.kind)}와 이용 길이를 유지합니다. 최대 31일 범위를 30분 간격으로 조회하며 빠른 후보 8개를 표시하는 시연 설정입니다.</p><form data-slot-form class="modal-section" novalidate><div class="field-grid"><label class="field">검색 시작일<input class="input" type="date" name="from" value="${e(from)}"></label><label class="field">검색 종료일<input class="input" type="date" name="until" value="${e(until)}"></label></div><button type="submit" class="btn btn-primary">가능한 기간 조회</button></form><div data-slots></div>`}
    <p data-error role="alert" class="error-text" hidden></p><div class="modal-actions">${button('닫기', 'data-close-dialog')}</div>`, dialog => {
    dialog.querySelectorAll('[data-alt-tab]').forEach(el => el.addEventListener('click', () => { dialog.close(); alternatives(resource, condition, el.dataset.altTab, { from, until }); }));
    dialog.querySelectorAll('[data-replace]').forEach(el => el.addEventListener('click', async () => {
      try {
        // Changing one item never changes other resources or their schedules.
        const old = selectionFor(resource.id);
        if (old) await store.removeSelection(old.id);
        await store.toggleSelection(el.dataset.replace, { ...condition });
        dialog.close(); notify('기존 일정을 유지하여 대체 항목을 선택했습니다. 신청은 별도로 진행해주세요.');
      } catch (error) { errorAt(dialog, error.message); }
    }));
    dialog.querySelector('[data-slot-form]')?.addEventListener('submit', event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      const first = String(fields.get('from'));
      const last = String(fields.get('until'));
      const length = new Date(last).getTime() - new Date(first).getTime();
      if (!Number.isFinite(length) || length < 0 || length > 30 * 86400000) return errorAt(dialog, '시작일 이후, 31일 이내의 검색 범위를 입력해주세요.');
      errorAt(dialog, '');
      const slots = alternateSlots(resource, condition, first, last, reservationInputs(), store.getRestrictions()).filter(item => !store.availability(resource, item).length);
      const target = dialog.querySelector('[data-slots]');
      target.innerHTML = slots.length ? slots.map((slot, index) => `<button type="button" class="panel slot-option" data-slot="${index}">${e(formatSchedule(slot, resource.kind))}<span class="small">이 항목의 일정으로 선택 →</span></button>`).join('') : '<p class="empty-state">선택한 범위에 이용 가능한 일정이 없습니다. 검색 범위나 조건을 변경해주세요.</p>';
      target.querySelectorAll('[data-slot]').forEach(el => el.addEventListener('click', async () => {
        try {
          const slot = slots[Number(el.dataset.slot)];
          const old = selectionFor(resource.id);
          if (old) await store.updateSelection(old.id, { ...slot });
          else await store.toggleSelection(resource.id, { ...slot });
          dialog.close(); notify('같은 자원과 이용 길이를 유지하여 해당 항목의 일정을 변경했습니다.');
        } catch (error) { errorAt(dialog, error.message); }
      }));
    });
  });
}

function request() {
  const state = store.getState();
  if (!state.selection.length) return;
  if (!state.user) {
    notify('신청하려면 로그인해주세요. 로그인 후 선택 목록에서 신청을 다시 확인해주세요.');
    window.dispatchEvent(new Event('campus:auth'));
    return;
  }
  if (state.user.role !== 'student') return notify('학생 계정으로 신청해주세요.');
  const invalid = state.selection.flatMap(item => {
    const resource = resources.find(candidate => candidate.id === item.resourceId);
    return resource ? store.availability(resource, item.condition).map(error => `${resource.name}: ${error}`) : ['선택한 자원을 찾을 수 없습니다.'];
  });
  if (invalid.length) return openDialog('선택 항목의 조건을 확인해주세요', `<div class="notice">${invalid.map(message => `<p>${e(message)}</p>`).join('')}</div><p class="small muted">선택 목록에서 이용 조건을 수정하거나 대체 항목을 조회해주세요.</p><div class="modal-actions">${button('확인', 'data-close-dialog', true)}</div>`);
  openDialog('선택 항목 예약 신청 확인', `<p class="small muted">아래 각 항목의 실제 신청 일정을 확인해주세요. 최종 제출 시 항목별 승인 대기 신청을 저장하며, 아직 예약이 확보되는 것은 아닙니다.</p>${state.selection.map(item => { const resource = resources.find(candidate => candidate.id === item.resourceId); return `<article class="panel modal-section"><strong>${e(resource.name)}</strong><p class="small">${e(formatSchedule(item.condition, resource.kind))}</p><span class="status status-muted">관리자 승인 필요</span></article>`; }).join('')}<p data-error role="alert" class="error-text" hidden></p><div class="modal-actions">${button('돌아가기', 'data-close-dialog')}${button('확인 후 시연 신청', 'data-final-submit', true)}</div>`, dialog => {
    const submit = dialog.querySelector('[data-final-submit]');
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.textContent = '최종 조건 검사 중…';
      dialog.dataset.busy = 'true';
      dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = true; });
      try {
        await store.submitSelection();
        dialog.close(); notify('신청을 저장했습니다. 관리자 승인 전에는 이용이 확정되지 않습니다.'); navigate('/records');
      } catch (error) { errorAt(dialog, error.message); submit.disabled = false; submit.textContent = '확인 후 시연 신청'; }
      finally { dialog.dataset.busy = 'false'; dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = false; }); }
    });
  });
}

function bindCards(scope, conditionFor, exclusiveFacility = false) {
  scope.querySelectorAll('[data-select]').forEach(input => input.addEventListener('change', async () => {
    const resource = resources.find(item => item.id === input.dataset.select);
    try {
      if (exclusiveFacility && resource.kind === '시설' && !selectionFor(resource.id)) {
        const otherFacilities = store.getState().selection.filter(item => resources.find(candidate => candidate.id === item.resourceId)?.kind === '시설');
        for (const item of otherFacilities) await store.removeSelection(item.id);
      }
      await store.toggleSelection(resource.id, conditionFor(resource));
    } catch (error) { input.checked = Boolean(selectionFor(resource.id)); notify(error.message); }
  }));
  scope.querySelectorAll('[data-detail]').forEach(el => el.addEventListener('click', () => { const resource = resources.find(item => item.id === el.dataset.detail); detail(resource, conditionFor(resource)); }));
  scope.querySelectorAll('[data-alternative]').forEach(el => el.addEventListener('click', () => { const resource = resources.find(item => item.id === el.dataset.alternative); alternatives(resource, conditionFor(resource)); }));
}

function bindSelection(scope) {
  scope.querySelector('[data-request]')?.addEventListener('click', request);
  scope.querySelector('[data-clear-selection]')?.addEventListener('click', async () => { try { await store.clearSelection(); } catch (error) { notify(error.message); } });
  scope.querySelectorAll('[data-remove]').forEach(el => el.addEventListener('click', async () => { try { await store.removeSelection(el.dataset.remove); } catch (error) { notify(error.message); } }));
  scope.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => { const selection = store.getState().selection.find(item => item.id === el.dataset.edit); if (selection) editCondition(selection); }));
}

function filterForm(path, value) {
  const facility = path === '/facilities';
  const categories = facility ? ['전체', '스터디룸', '회의실', '촬영실'] : ['전체', '카메라', '프로젝터', '마이크'];
  return `<form class="panel rental-search" data-search-form novalidate><div class="${facility ? 'field-grid' : ''}"><label class="field">${facility ? '시설명 검색' : '장비명·품목·모델 검색'}<input class="input" name="query" aria-label="${facility ? '시설' : '장비'} 검색" placeholder="${facility ? '회의실, 스터디룸, 촬영실' : '카메라, 프로젝터, 마이크 또는 모델명'}" value="${e(value.query)}"></label>${facility ? `<label class="field">시설 유형<select class="input" name="category">${categories.map(category => `<option ${category === value.category ? 'selected' : ''}>${e(category)}</option>`).join('')}</select></label>` : ''}</div><div class="button-row">${button(facility ? '시설명·유형 검색' : '장비 검색', 'data-search')}</div>${!facility ? `<div class="filters" role="group" aria-label="장비 분류">${categories.map(category => `<button type="button" class="chip ${value.category === category ? 'chip-active' : ''}" aria-pressed="${value.category === category}" data-category="${e(category)}">${e(category)}</button>`).join('')}</div>` : '<hr>'}${fieldHtml(value.condition, facility ? '시설' : '장비', 'search-condition')}<div class="button-row"><button class="btn btn-primary" type="submit">${facility ? '예약 가능한 시설 조회' : '대여 가능 장비 조회'}</button>${!facility ? button('대여·수령 안내', 'data-guide') : ''}</div><p class="error-text" role="alert" data-error ${value.error ? '' : 'hidden'}>${e(value.error)}</p></form>`;
}

function bindFilterForm(container, path, value, params) {
  const form = container.querySelector('[data-search-form]');
  bindFields(form, 'search-condition', value.condition, () => {
    const notice = container.querySelector('[data-draft-notice]');
    if (notice) notice.hidden = !value.applied || JSON.stringify(value.applied) === JSON.stringify(value.condition);
  });
  form.querySelector('[name="query"]').addEventListener('input', event => { value.query = event.target.value; });
  form.querySelector('[name="category"]')?.addEventListener('change', event => { value.category = event.target.value; applySearch(); });
  function applySearch() {
    const next = new URLSearchParams(params);
    next.set('q', value.query); next.set('category', value.category);
    value.params = next.toString(); mounted.params = next;
    window.history.replaceState({}, '', `${path}?${next}`);
    redraw();
  }
  form.querySelector('[data-search]').addEventListener('click', applySearch);
  form.querySelectorAll('[data-category]').forEach(el => el.addEventListener('click', () => { value.category = el.dataset.category; applySearch(); }));
  form.addEventListener('submit', event => {
    event.preventDefault();
    const errors = conditionErrors(value.condition, path === '/facilities');
    if (path === '/facilities' && !value.condition.use) errors.push('시설 이용 목적을 선택해주세요.');
    value.error = errors.join(' ');
    if (!errors.length) { value.applied = { ...value.condition }; notify('조건을 적용했습니다. 기존 선택 항목의 일정은 개별 보존됩니다.'); }
    applySearch();
  });
  form.querySelector('[data-guide]')?.addEventListener('click', () => openDialog('대여·수령 안내', '<div class="modal-section"><h3>수령·반납 예정일을 확인해주세요.</h3><p>시연 계산은 1일 24시간, 3일 72시간입니다. 실제 대여 허용 기간과 학교 운영 규칙은 확인이 필요합니다.</p><p>승인 전에는 이용이 확정되지 않습니다. 신청 현황에서 승인 결과를 확인하고 안내된 수령 절차를 따라주세요.</p><p>거절 사유는 과거 신청 내역에서 확인할 수 있습니다.</p></div><div class="modal-actions"><button type="button" class="btn btn-primary" data-close-dialog>확인</button></div>'));
}

function purposeHtml(value) {
  const analysis = analyzeInput(value.activity);
  return `<form class="panel purpose-form" data-purpose-form novalidate><label class="field purpose-label">어떤 활동을 준비하시나요?<textarea class="input" name="activity" aria-label="준비하는 활동" placeholder="팀 과제 영상을 촬영하려고 해요.">${e(value.activity)}</textarea></label><div class="filters">${purposes.map(purpose => `<button type="button" class="chip ${analysis.candidates.includes(purpose) ? 'chip-active' : ''}" aria-pressed="${analysis.candidates.includes(purpose)}" data-purpose="${e(purpose)}">${e(purpose)}</button>`).join('')}</div><details class="panel equipment-schedule"><summary>장비 대여 일정</summary>${fieldHtml(value.equipment, '장비', 'purpose-equipment')}${button('장비 일정 적용', 'data-equipment-apply', true)}</details><h3 class="field-heading">시설 이용 조건</h3>${fieldHtml(value.condition, '시설', 'purpose-facility')}<div class="button-row"><button class="btn btn-primary" type="submit">추천 구성 보기</button></div><p class="small muted">일정 없이도 인원·용도에 맞는 구성을 안내합니다. 예약 가능 여부는 조건을 적용한 뒤 확인해주세요.</p><p class="error-text" data-error role="alert" ${value.error ? '' : 'hidden'}>${e(value.error)}</p></form><div data-purpose-results>${purposeResults(value)}</div>`;
}

function purposeResults(value) {
  if (!value.results) return '<section class="empty-state purpose-placeholder"><h2>활동과 조건을 적용하면 추천 구성을 보여드립니다.</h2><p class="muted small">인터뷰 촬영, 과제 영상 촬영, 발표 연습 또는 팀 회의를 선택해보세요. 추천은 등록된 시연 규칙을 기준으로 합니다.</p></section>';
  const basis = value.results;
  if (basis.activity !== value.activity || (basis.facilityCondition && JSON.stringify(basis.facilityCondition) !== JSON.stringify(value.condition)) || JSON.stringify(basis.equipmentCondition) !== JSON.stringify(value.equipmentApplied)) return '<section class="notice modal-section"><h2>이용 조건이 변경되었습니다.</h2><p>추천 구성을 다시 조회해주세요. 기존 선택 목록은 유지됩니다.</p></section>';
  const analysis = basis.analysis;
  const purpose = basis.purpose;
  if (!purpose) {
    const choices = analysis.candidates.length > 1 ? analysis.candidates : analysis.confirmations.length ? analysis.confirmations : purposes;
    return `<section class="panel modal-section"><h2>${analysis.candidates.length > 1 ? '여러 활동이 포함되어 있습니다. 이번에 준비할 목적을 선택해주세요.' : analysis.intent === 'video' ? '어떤 영상을 준비하는지 선택해주세요.' : '활동을 조금 더 알려주세요.'}</h2><p class="muted small">입력한 내용: ${e(basis.activity)}<br>활동 선택지를 고르거나 필요한 장비·시설을 직접 찾아보세요. 입력 문장은 그대로 유지됩니다.</p><div class="button-row">${choices.map(choice => choice === '일반 영상 촬영' ? `<a data-link class="btn btn-secondary" href="/equipment?q=${encodeURIComponent('카메라')}">일반 영상 촬영 장비 찾기</a>` : button(choice, `data-confirm-purpose="${e(choice)}"`)).join('')}</div><div class="button-row"><a data-link class="btn btn-secondary" href="/equipment">장비 직접 찾기</a><a data-link class="btn btn-secondary" href="/facilities">시설 직접 찾기</a></div></section>`;
  }
  const cards = recommendationItems(purpose, analysis, basis.facilityCondition, basis.equipmentCondition, reservationInputs(), store.getRestrictions(), basis.people);
  const facilities = cards.filter(item => item.resource.kind === '시설');
  const equipment = cards.filter(item => item.resource.kind === '장비');
  return `<p class="small muted applied-activity">현재 적용된 활동: ${e(basis.activity)}</p><section class="notice recommendation-summary"><h2>${e(purpose)} 추천 구성</h2><p>${e(recommendations[purpose].reason)}</p>${!basis.facilityCondition && !basis.equipmentCondition ? '<p class="small">일정 미적용 · 아래 구성은 준비 안내이며 예약 가능 확정이 아닙니다.</p>' : ''}</section><div class="recommendation-sections">${facilities.length ? `<section><h2 class="section-title">${purpose === '팀 회의' ? '인원에 맞는 회의 공간 후보' : '활동에 맞는 공간'}</h2><p class="small muted">${basis.people ? `${e(basis.people)}명 기준 · ` : ''}수용 인원·비치 설비를 비교하고 공간 한 곳을 선택하세요.</p><div class="resource-grid facility-results">${facilities.map(item => resourceCard(item.resource, basis.facilityCondition, item.role)).join('')}</div></section>` : '<section class="panel"><h2>현재 인원·용도에 맞는 공간이 없습니다.</h2><p class="small muted">참여 인원이나 목적을 확인하고 시설을 직접 찾아보세요.</p></section>'}${equipment.length ? `<section><h2 class="section-title">추가로 필요한 장비</h2><p class="small muted">필요·선택 구분과 시설 비치 설비를 확인한 뒤 필요한 항목만 선택하세요.</p><div class="resource-grid">${equipment.map(item => resourceCard(item.resource, basis.equipmentCondition, item.role)).join('')}</div></section>` : ''}</div>`;
}

function bindPurpose(container, value) {
  const form = container.querySelector('[data-purpose-form]');
  const markStale = () => {
    if (!value.results) return;
    container.querySelector('[data-purpose-results]').innerHTML = '<section class="notice modal-section"><h2>이용 조건이 변경되었습니다.</h2><p>추천 구성을 다시 조회해주세요. 기존 선택 목록은 유지됩니다.</p></section>';
  };
  bindFields(form, 'purpose-equipment', value.equipment, markStale);
  bindFields(form, 'purpose-facility', value.condition, key => { if (key === 'people') value.peopleEdited = true; markStale(); });
  form.querySelector('[name="activity"]').addEventListener('input', event => {
    value.activity = event.target.value;
    if (value.activity !== value.peopleActivity) {
      value.peopleEdited = false;
      value.peopleActivity = value.activity;
      const analysis = analyzeInput(value.activity);
      if (analysis.people) {
        value.condition.people = analysis.people;
        form.querySelector('[name="purpose-facility-people"]').value = analysis.people;
      }
    }
    value.chosen = '';
    markStale();
  });
  form.querySelectorAll('[data-purpose]').forEach(el => el.addEventListener('click', () => {
    value.activity = el.dataset.purpose; value.chosen = el.dataset.purpose; value.condition.use = el.dataset.purpose; value.peopleEdited = false; value.results = null; redraw();
  }));
  form.querySelector('[data-equipment-apply]').addEventListener('click', () => {
    const errors = conditionErrors(value.equipment);
    value.error = errors.join(' ');
    if (!errors.length) { value.equipmentApplied = { ...value.equipment }; notify('장비 일정을 적용했습니다. 추천 구성을 다시 조회해주세요.'); }
    redraw();
  });
  function recommend(chosen = '') {
    if (!value.activity.trim()) { errorAt(form, '준비하는 활동을 입력하거나 목적 칩을 선택해주세요.'); return; }
    const analysis = analyzeInput(value.activity);
    if (analysis.intent === 'direct') {
      const path = analysis.equipmentQuery ? '/equipment' : '/facilities';
      navigate(`${path}?q=${encodeURIComponent(analysis.equipmentQuery || analysis.facilityQuery || '')}&activity=${encodeURIComponent(value.activity)}`);
      return;
    }
    if (['ambiguous', 'invalid'].includes(analysis.peopleStatus) && !value.peopleEdited) { errorAt(form, '문장의 참여 인원을 자동으로 정하지 않았습니다. 시설 이용 인원을 직접 확인한 뒤 다시 눌러주세요.'); return; }
    const purpose = chosen || value.chosen || (analysis.candidates.length === 1 ? analysis.candidates[0] : '');
    const condition = { ...value.condition, use: purpose || value.condition.use };
    value.condition.use = condition.use;
    value.error = '';
    value.results = { activity: value.activity, analysis, purpose, people: condition.people, facilityCondition: !conditionErrors(condition, true).length && condition.use ? condition : null, equipmentCondition: value.equipmentApplied ? { ...value.equipmentApplied } : null };
    redraw();
  }
  form.addEventListener('submit', event => { event.preventDefault(); recommend(); });
  container.querySelectorAll('[data-confirm-purpose]').forEach(el => el.addEventListener('click', () => { value.chosen = el.dataset.confirmPurpose; recommend(value.chosen); }));
}

export function renderRentalPage(container, path, params = new URLSearchParams()) {
  params = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  mounted = { container, path, params };
  const value = screen(path, params);
  const purpose = path === '/purpose';
  const kind = path === '/facilities' ? '시설' : '장비';
  const title = purpose ? '목적별 대여' : kind === '시설' ? '시설 대여' : '장비 대여';
  const description = purpose ? '무엇을 준비해야 할지 모르겠다면, 활동을 설명하고 필요한 구성을 찾아보세요.' : kind === '시설' ? '이용 시간과 인원에 맞는 공간을 찾아보세요.' : '필요한 장비를 검색하고 대여 조건을 확인하세요.';
  const normalizedQuery = value.query.replace(/빔프로젝터/g, '프로젝터').replace(/\s/g, '').toLowerCase();
  const matches = resources.filter(resource => resource.kind === kind && (value.category === '전체' || resource.category === value.category) && `${resource.name}${resource.category}${resource.model}`.replace(/\s/g, '').toLowerCase().includes(normalizedQuery));
  container.innerHTML = `<section class="page-shell rental-layout"><p class="info-banner">시연용 가상 자산·시설·예약·운영 기준입니다. 실제 학교 정책이나 재고를 의미하지 않으며, 관리자 승인 전에는 이용이 확정되지 않습니다.</p><div class="rental-content"><header class="page-heading"><p class="breadcrumb"><a data-link href="/">홈</a> / ${title}</p><h1>${title}</h1><p class="muted">${description}</p></header>${purpose ? purposeHtml(value) : `${filterForm(path, value)}${value.applied ? `<p class="notice small applied-conditions">${e(formatSchedule(value.applied, kind))}</p>` : '<p class="small muted applied-conditions">이용 조건을 적용하면 각 항목의 가능 여부를 확인할 수 있습니다.</p>'}<p class="notice small" data-draft-notice ${!value.applied || JSON.stringify(value.applied) === JSON.stringify(value.condition) ? 'hidden' : ''}>작성 중인 조건이 조회 기준과 다릅니다. 조건을 적용하고 다시 조회해주세요. 기존 선택 항목의 일정은 유지됩니다.</p><p class="results-count">${kind === '시설' ? '공간' : '장비'} ${matches.length}개${kind === '시설' ? ' · 비치 설비는 별도 대여 재고가 아닙니다.' : ''}</p>${matches.length ? `<div class="resource-grid ${kind === '시설' ? 'facility-results' : ''}">${matches.map(resource => resourceCard(resource, value.applied)).join('')}</div>` : `<section class="empty-state panel"><h2>검색 결과가 없습니다.</h2><p class="muted small">검색어·분류·인원·기간을 수정하고 다시 조회해주세요.</p>${button('검색어·분류 초기화', 'data-reset-search')}</section>`}`}</div>${selectionHtml()}</section>`;
  if (purpose) bindPurpose(container, value); else bindFilterForm(container, path, value, params);
  const conditionFor = resource => {
    const own = selectionFor(resource.id);
    if (own?.condition) return { ...own.condition };
    if (purpose) return value.results ? (resource.kind === '장비' ? value.results.equipmentCondition : value.results.facilityCondition) : null;
    return value.applied;
  };
  bindCards(container, conditionFor, purpose);
  bindSelection(container);
  container.querySelector('[data-reset-search]')?.addEventListener('click', () => { value.query = ''; value.category = '전체'; mounted.params = new URLSearchParams(); value.params = ''; window.history.replaceState({}, '', path); redraw(); });
}

function recordAction(record, item, action) {
  const cancel = action === 'cancel';
  const title = cancel ? '신청 취소 확인' : '장비 반납 신청 확인';
  openDialog(title, `<p><strong>${e(item.name)}</strong></p><p class="small muted">${e(record.number)} · ${e(formatSchedule(item.condition, item.kind))}</p><p class="modal-section">${cancel ? '이 항목의 신청을 취소할까요? 같은 묶음의 다른 신청은 유지됩니다.' : '반납 신청은 반환 완료가 아닙니다. 관리자의 실제 반환 확인 후 반납이 완료됩니다.'}</p><p data-error role="alert" class="error-text" hidden></p><div class="modal-actions">${button('돌아가기', 'data-close-dialog')}${button(cancel ? '확인 후 신청 취소' : '확인 후 반납 신청', 'data-record-confirm', true)}</div>`, dialog => {
    const submit = dialog.querySelector('[data-record-confirm]');
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      dialog.dataset.busy = 'true';
      dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = true; });
      try {
        if (cancel) await store.cancelItem(record.number, item.id, item.version);
        else await store.requestReturn(record.number, item.id, item.version);
        dialog.close(); notify(cancel ? '해당 항목의 신청을 취소했습니다.' : '반납 신청을 저장했습니다. 관리자 확인을 기다려주세요.');
      } catch (error) { errorAt(dialog, error.message); submit.disabled = false; }
      finally { dialog.dataset.busy = 'false'; dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = false; }); }
    });
  });
}

export function renderRecords(container, history = false) {
  mounted = null;
  const state = store.getState();
  const title = history ? '과거 신청 내역' : '신청 현황';
  if (!state.user || state.user.role !== 'student') {
    container.innerHTML = `<section class="page-shell"><header class="page-heading"><p class="breadcrumb"><a data-link href="/">홈</a> / ${title}</p><h1>${title}</h1></header><section class="panel empty-state"><h2>학생 계정으로 로그인해주세요.</h2><p class="muted">본인의 신청 현황과 과거 내역을 확인할 수 있습니다.</p>${button('로그인', 'data-record-login', true)}</section></section>`;
    container.querySelector('[data-record-login]').addEventListener('click', () => window.dispatchEvent(new Event('campus:auth')));
    return;
  }
  const ownRecords = state.records.filter(record => record.userId === state.user.id);
  const visible = ownRecords.map(record => ({ ...record, items: record.items.filter(item => completed.has(item.status) === history && (recordKind === '전체' || item.kind === recordKind)) })).filter(record => record.items.length);
  container.innerHTML = `<section class="page-shell records-page"><header class="page-heading"><p class="breadcrumb"><a data-link href="/">홈</a> / ${title}</p><h1>${title}</h1><p class="muted">나의 신청과 처리 결과를 확인하세요. 아래 기록은 화면 시연용입니다.</p></header><nav class="tabs" aria-label="신청 내역 구분"><a data-link href="/records" class="btn ${!history ? 'btn-primary' : 'btn-secondary'}" ${!history ? 'aria-current="page"' : ''}>신청 현황</a><a data-link href="/history" class="btn ${history ? 'btn-primary' : 'btn-secondary'}" ${history ? 'aria-current="page"' : ''}>과거 신청 내역</a></nav><div class="filters" role="group" aria-label="신청 자원 종류">${['전체', '장비', '시설'].map(kind => `<button type="button" class="chip ${recordKind === kind ? 'chip-active' : ''}" aria-pressed="${recordKind === kind}" data-record-kind="${kind}">${kind}</button>`).join('')}</div>${visible.length ? visible.map(record => `<section class="record-card panel"><header class="record-heading"><strong>${e(record.number)}</strong><span class="small muted">${e(formatDate(record.createdAt))}</span></header>${record.items.map(item => `<article class="record-item"><div class="record-item-heading"><div><p class="small muted">항목 ${e(item.originalIndex || item.order || item.sequence || record.items.indexOf(item) + 1)} · ${e(item.kind)}</p><h3>${e(item.name)}</h3></div><span class="status ${completed.has(item.status) ? 'status-muted' : item.status === '반납 보류' ? 'status-warning' : item.status === '승인 대기' ? '' : 'status-success'}">${e(item.status)}</span></div><p class="small">${e(formatSchedule(item.condition, item.kind))}</p>${item.status === '승인 대기' ? '<p class="small muted">승인 대기 · 아직 자원이 확보되지 않았습니다.</p>' : ''}${item.reason ? `<p class="notice small">${item.status === '거절' ? '거절 사유' : '처리 사유'}: ${e(item.reason)}</p>` : ''}${item.status === '반납 보류' ? '<p class="small error-text">구성품·수량과 보류 사유를 확인하고 관리자에게 추가 반환해주세요.</p>' : ''}<div class="button-row">${item.status === '승인 대기' ? button('신청 취소', `data-record-action="cancel" data-record="${e(record.number)}" data-item="${e(item.id)}"`) : ''}${item.kind === '장비' && item.status === '대여 중' ? button('반납 신청', `data-record-action="return" data-record="${e(record.number)}" data-item="${e(item.id)}"`, true) : ''}${button('상세 정보', `data-record-detail="${e(item.resourceId)}" data-record="${e(record.number)}" data-item="${e(item.id)}"`)}</div></article>`).join('')}</section>`).join('') : `<section class="panel empty-state"><h2>${history ? '과거 신청 내역이 없습니다.' : '진행 중인 신청이 없습니다.'}</h2><p class="muted small">${recordKind === '전체' ? '필요한 장비나 시설을 찾아 선택 목록에서 신청해보세요.' : `${recordKind} 필터에 해당하는 항목이 없습니다.`}</p><a data-link class="btn btn-primary" href="/equipment">장비·시설 둘러보기</a></section>`}</section>`;
  container.querySelectorAll('[data-record-kind]').forEach(el => el.addEventListener('click', () => { recordKind = el.dataset.recordKind; renderRecords(container, history); }));
  container.querySelectorAll('[data-record-action]').forEach(el => el.addEventListener('click', () => {
    const record = ownRecords.find(entry => entry.number === el.dataset.record);
    const item = record?.items.find(entry => entry.id === el.dataset.item);
    if (item) recordAction(record, item, el.dataset.recordAction);
  }));
  container.querySelectorAll('[data-record-detail]').forEach(el => el.addEventListener('click', () => {
    const resource = resources.find(entry => entry.id === el.dataset.recordDetail);
    const record = ownRecords.find(entry => entry.number === el.dataset.record);
    const item = record?.items.find(entry => entry.id === el.dataset.item);
    if (resource && item) detail(resource, item.condition);
  }));
}
