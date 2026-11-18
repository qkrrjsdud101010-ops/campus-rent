import {
  resources, purposes, initialConditions, serverMode, analyzeInput, conditionErrors,
  recommendationItems, recommendations, recommendationDefinition, alternateResources, alternateSlots,
} from './data.js';
import * as store from './store.js';
import { escapeHTML as e, formatDate, formatSchedule, openDialog, notify, navigate } from './ui.js';
import {requestStatus, isCompletedRequest, openRequestDetail, dismissRequestDetail, synchronizeRequestDetailOwner} from './request-detail.js';
import {matchesSummaryView} from './home.js';
import {createSentenceAnalysisState, bindSentenceAnalysis, invalidateSentenceAnalysis} from './sentence-analysis.js';

// These drafts belong to the screen, not to a submitted application. Navigating,
// signing in, or changing a different kind of resource must not overwrite them.
const drafts = new Map();
let mounted = null;
let recordKind = '전체';
let recordScopeKey = '';
const personalDialogs = new Map();
const selectionDialogs = new Set();
let mobileSelection = null;
let pendingSelectionLogin = false;
const mobileMedia = window.matchMedia('(max-width: 767px)');

store.subscribe(state => {
  const {user} = state;
  synchronizeRequestDetailOwner(user);
  for (const [dialog, ownerId] of personalDialogs) {
    if (user?.role !== 'student' || String(user.id) !== ownerId) dialog.close();
  }
  for (const dialog of selectionDialogs) if (dialog.dataset.selectionOwner && dialog.dataset.selectionOwner !== String(user?.id || '')) dialog.close();
  if (mobileSelection && (user?.role === 'admin' || (mobileSelection.ownerId && mobileSelection.ownerId !== String(user?.id || '')))) closeMobileSelection({restoreFocus: false, closeChildren: true});
  if (mobileSelection && user?.role === 'student') mobileSelection.ownerId = String(user.id);
  updateMobileSelection();
});

for (const eventName of ['campus:navigate', 'popstate']) {
  window.addEventListener(eventName, () => {
    for (const dialog of personalDialogs.keys()) dialog.close();
    pendingSelectionLogin = false;
    closeMobileSelection({restoreFocus: false, closeChildren: true});
    for (const dialog of selectionDialogs) dialog.close();
  });
}

mobileMedia.addEventListener('change', event => { if (!event.matches) closeMobileSelection({closeChildren: true}); });
window.addEventListener('campus:authenticated', event => {
  if (!pendingSelectionLogin || event.detail?.reason !== 'request') return;
  pendingSelectionLogin = false;
  if (store.getState().user?.role === 'student' && ['/equipment', '/facilities', '/purpose'].includes(location.pathname)) request();
});

function trackSelectionDialog(dialog) {
  dialog.dataset.selectionOwner = store.getState().user?.id ? String(store.getState().user.id) : '';
  selectionDialogs.add(dialog);
  dialog.addEventListener('close', () => selectionDialogs.delete(dialog), {once: true});
  return dialog;
}

function trackPersonalDialog(dialog, ownerId) {
  personalDialogs.set(dialog, String(ownerId));
  dialog.addEventListener('close', () => personalDialogs.delete(dialog), {once: true});
  return dialog;
}

function screen(path, params) {
  if (!drafts.has(path)) drafts.set(path, {
    query: '', category: '전체', activity: '', chosen: '', error: '', applied: null,
    condition: { ...initialConditions }, equipment: { ...initialConditions },
    equipmentApplied: null, results: null, peopleEdited: false, peopleActivity: '',
    params: null, customNeeds: null, useEdited: false,
    sentenceAnalysis: createSentenceAnalysisState(), sentencePeopleAmbiguous: false,
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
      value.customNeeds = null;
      value.sentencePeopleAmbiguous = false;
      invalidateSentenceAnalysis(value.sentenceAnalysis);
      const analysis = analyzeInput(value.activity);
      if (analysis.people && !value.peopleEdited) value.condition.people = analysis.people;
      if (!value.useEdited) value.condition.use = analysis.candidates.length === 1 && purposes.includes(analysis.candidates[0]) ? analysis.candidates[0] : '';
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

function operatingLabel(resource, condition = null) {
  if (condition?.start && resource.hoursByWeekday) {
    const date = new Date(`${condition.start.slice(0, 10)}T12:00:00+09:00`);
    const day = new Intl.DateTimeFormat('en-US', {timeZone: 'Asia/Seoul', weekday: 'short'}).format(date);
    const key = String(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(day) + 1);
    const hours = resource.hoursByWeekday[key];
    return `${condition.start.slice(0, 10)} 운영 시간: ${hours?.length === 2 ? hours.join('–') : '운영 시간 미설정 · 이용 확인 필요'}`;
  }
  return `대표 운영 시간: ${resource.operatingHours?.length === 2 ? resource.operatingHours.join('–') : '운영 시간 미설정 · 이용 확인 필요'}`;
}

function information(resource) {
  const rows = [
    ['식별 정보', `${resource.code} · ${resource.model}`],
    ['위치 / 보관 장소', resource.location],
    ['주요 사양', resource.specs.join(' · ')],
    [resource.kind === '시설' ? '비치 설비' : '기본 구성품', resource.components ? resource.components.map(item => `${item.name} ${item.requiredQuantity}개${item.required ? ' (필수)' : ''}`).join(' · ') : resource.contents.join(' · ')],
    ...(resource.kind === '시설' ? [['대표 운영 시간', resource.operatingHours?.length === 2 ? resource.operatingHours.join('–') : '운영 시간 미설정 · 이용 확인 필요'], ['허용 용도', resource.allowedUses?.join(' · ')]] : []),
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
    ${resource.kind === '시설' ? `<p class="capacity">수용 ${e(resource.capacity)}명</p><p class="small">${e(resource.location)}</p><p class="small muted">${e(operatingLabel(resource, condition))} · 공간 전체 예약</p><p class="small">허용: ${e(resource.allowedUses?.join(' · ') || '')}</p>` : `<p class="resource-specs">${e(resource.specs.join(' · '))}</p>`}
    <p class="small muted resource-contents">${resource.kind === '시설' ? '비치 설비' : '구성품'}: ${e(resource.contents.join(' · '))}</p>
    ${condition ? `<p class="small muted resource-schedule">${e(formatSchedule(condition, resource.kind))}</p>` : ''}
    <div class="resource-availability"><span class="status ${!reasons.length ? 'status-success' : incomplete ? 'status-muted' : 'status-warning'}">${status}</span>${reasons.map(reason => `<p class="small muted">${e(reason)}</p>`).join('')}</div>
    <div class="button-row">${button('상세보기', `data-detail="${e(resource.id)}"`)}${reasons.length && condition && !incomplete ? button(`대체 ${resource.kind} 추천`, `data-alternative="${e(resource.id)}"`) : ''}</div>
  </article>`;
}

function selectionContent(state = store.getState(), mobile = false) {
  const items = state.selection.map(item => ({...item, resource: resources.find(resource => resource.id === item.resourceId)}));
  return `<div class="selection-heading"><${mobile ? 'h3' : 'h2'}>선택 목록 <span>${items.length}개</span></${mobile ? 'h3' : 'h2'}><button type="button" class="btn-quiet small" data-clear-selection ${items.length ? '' : 'disabled'}>전체 비우기</button></div><p class="small muted">장비·시설의 일정은 개별 보존됩니다.</p><p class="selection-feedback" data-selection-feedback role="status" hidden></p><div class="selection-list" aria-live="polite">${items.length ? items.map(item => {
    const resource = item.resource;
    const name = resource?.name || '자원 정보 확인 필요';
    const incomplete = !item.condition || conditionErrors(item.condition, resource?.kind === '시설').length > 0 || (resource?.kind === '시설' && !item.condition?.use);
    const errors = resource ? store.availability(resource, item.condition) : ['현재 자원 정보를 확인할 수 없습니다. 이 항목을 제거하고 다시 찾아주세요.'];
    return `<article class="selection-item" data-selection-item="${e(item.id)}"><div class="selection-item-heading"><strong>${e(name)}</strong><button type="button" class="icon-button" data-remove="${e(item.id)}" aria-label="${e(name)} 제거">×</button></div><p class="small muted">${resource ? `${e(resource.kind)} · ${e(resource.code)}` : '선택한 자원을 찾을 수 없습니다.'}</p><p class="small">${item.condition ? e(formatSchedule(item.condition, resource?.kind || '장비')) : '조건 입력 필요'}</p>${incomplete && item.condition ? '<p class="small error-text">조건 입력 필요</p>' : ''}${errors.map(reason => `<p class="small error-text">${e(reason)}</p>`).join('')}${resource ? `<button type="button" class="btn-quiet small" data-edit="${e(item.id)}">이용 조건 수정</button>` : ''}</article>`;
  }).join('') : '<div class="selection-empty" tabindex="-1" data-selection-empty><strong>선택한 자원이 없습니다.</strong><p class="small muted">장비·시설 카드의 체크박스로 필요한 자원을 선택하세요.</p></div>'}</div><div class="selection-footer"><p class="small muted">장비 ${items.filter(item => item.resource?.kind === '장비').length} · 시설 ${items.filter(item => item.resource?.kind === '시설').length}${items.some(item => !item.resource) ? ` · 정보 확인 필요 ${items.filter(item => !item.resource).length}` : ''}</p>${items.length ? button('신청 내용 확인', 'data-request', true) : ''}${mobile ? button('탐색으로 돌아가기', 'data-close-dialog') : ''}</div>`;
}

function selectionHtml() {
  const state = store.getState();
  if (state.user?.role === 'admin') return '';
  return `<aside class="selection-panel" aria-label="공통 선택 목록">${selectionContent(state)}</aside><div class="mobile-selection-bar"><button class="btn btn-primary" type="button" data-open-mobile-selection aria-haspopup="dialog" aria-expanded="${Boolean(mobileSelection)}"><span>선택한 자원 <strong>${state.selection.length}개</strong></span><span>목록 보기 ↑</span></button></div>`;
}

function selectionFocus(attribute, id) {
  const scope = mobileSelection?.dialog || mounted?.container;
  return [...(scope?.querySelectorAll(`[${attribute}]`) || [])].find(node => node.getAttribute(attribute) === String(id));
}

function mobileSelectionMessage(message, error = false) {
  const node = mobileSelection?.dialog.querySelector('[data-selection-feedback]');
  if (!node) { notify(message); return; }
  node.textContent = message; node.hidden = false;
  node.classList.toggle('error-text', error);
  node.setAttribute('role', error ? 'alert' : 'status');
}

function closeMobileSelection({restoreFocus = true, closeChildren = false} = {}) {
  if (closeChildren) for (const dialog of selectionDialogs) dialog.close();
  if (!mobileSelection) return;
  const session = mobileSelection;
  mobileSelection = null;
  session.restoreFocus = restoreFocus;
  session.dialog.close();
}

function updateMobileSelection() {
  if (!mobileSelection) return;
  const state = store.getState();
  const signature = JSON.stringify([state.selection, resources, state.equipmentStates, state.storageError]);
  if (signature === mobileSelection.signature) return;
  const dialog = mobileSelection.dialog, body = dialog.querySelector('.dialog-body');
  const focus = document.activeElement;
  const within = body.contains(focus);
  const attribute = focus?.hasAttribute('data-edit') ? 'data-edit' : focus?.hasAttribute('data-remove') ? 'data-remove' : '';
  const id = attribute ? focus.getAttribute(attribute) : '';
  const index = [...body.querySelectorAll('[data-selection-item]')].indexOf(focus?.closest('[data-selection-item]'));
  const scrollTop = dialog.scrollTop;
  body.innerHTML = selectionContent(state, true);
  mobileSelection.signature = signature;
  bindSelection(body);
  dialog.scrollTop = scrollTop;
  if (within) {
    const candidates = [...body.querySelectorAll(attribute ? `[${attribute}]` : '[data-edit],[data-remove]')];
    const target = attribute && selectionFocus(attribute, id) || candidates[Math.min(Math.max(index, 0), candidates.length - 1)] || body.querySelector('[data-selection-empty]') || dialog.querySelector('.dialog-close');
    target?.focus({preventScroll: true});
  }
}

function openMobileSelection() {
  if (mobileSelection?.dialog.open || !mobileMedia.matches || store.getState().user?.role === 'admin') return;
  const dialog = openDialog('선택한 자원', '');
  dialog.classList.add('mobile-selection-dialog');
  const session = {dialog, ownerId: store.getState().user?.id ? String(store.getState().user.id) : null, signature: '', restoreFocus: true};
  mobileSelection = session;
  dialog.addEventListener('close', () => {
    if (mobileSelection === session) mobileSelection = null;
    document.querySelectorAll('[data-open-mobile-selection]').forEach(node => node.setAttribute('aria-expanded', 'false'));
    if (session.restoreFocus) queueMicrotask(() => {
      const target = mobileMedia.matches ? mounted?.container.querySelector('[data-open-mobile-selection]') : mounted?.container.querySelector('.selection-panel [data-request],.selection-panel h2');
      if (target?.isConnected) { if (target.tagName === 'H2') target.tabIndex = -1; target.focus({preventScroll: true}); }
    });
  }, {once: true});
  document.querySelectorAll('[data-open-mobile-selection]').forEach(node => node.setAttribute('aria-expanded', 'true'));
  updateMobileSelection();
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
  const editor = openDialog('선택 항목 이용 조건 수정', `<form data-edit-form novalidate><p class="modal-section"><strong>${e(resource.name)}</strong></p>${fieldHtml(draft, resource.kind, 'edit')}<p data-error class="error-text" role="alert" tabindex="-1" hidden></p><div class="modal-actions">${button('취소', 'data-close-dialog')}<button class="btn btn-primary" type="submit">조건 확인 후 적용</button></div></form>`, dialog => {
    dialog.classList.add('selection-condition-dialog');
    bindFields(dialog, 'edit', draft, () => { errorAt(dialog, ''); dialog.querySelectorAll('[aria-invalid]').forEach(node => node.removeAttribute('aria-invalid')); });
    dialog.querySelector('[data-edit-form]').addEventListener('submit', async event => {
      event.preventDefault();
      const errors = store.availability(resource, draft);
      if (errors.length) { errorAt(dialog, errors.join(' ')); dialog.querySelector('[data-error]').focus(); return; }
      try { await store.updateSelection(selection.id, { ...draft }); dialog.close(); mobileSelectionMessage('선택 항목의 이용 조건을 수정했습니다.'); } catch (error) { errorAt(dialog, error.message); dialog.querySelector('[data-error]').focus(); }
    });
  });
  trackSelectionDialog(editor);
  editor.addEventListener('close', () => queueMicrotask(() => {
    if (mobileSelection) (selectionFocus('data-edit', selection.id) || mobileSelection.dialog.querySelector('.dialog-close'))?.focus({preventScroll: true});
  }), {once: true});
  return editor;
}

function detail(resource, condition) {
  const errors = store.availability(resource, condition);
  return openDialog(resource.name, `<div class="modal-section"><span class="resource-icon"><img src="/assets/${e(resource.icon)}" alt=""></span><p class="small muted">시연용 가상 ${e(resource.kind)} 정보입니다.</p></div>${information(resource)}${condition ? `<p class="notice small">${e(formatSchedule(condition, resource.kind))}</p>` : ''}<div class="modal-actions">${button('닫기', 'data-close-dialog')}${button(selectionFor(resource.id) ? '선택 목록에서 제거' : '선택 목록에 담기', `data-detail-select ${errors.length && !selectionFor(resource.id) ? 'disabled' : ''}`, true)}</div>`, dialog => {
    dialog.querySelector('[data-detail-select]').addEventListener('click', async () => {
      try { await store.toggleSelection(resource.id, condition ? { ...condition } : null); dialog.close(); } catch (error) { notify(error.message); }
    });
  });
}

function reservationInputs() {
  return store.getReservations();
}

function alternativeExplanation(source, candidate) {
  if (source.kind !== '장비') return '<p class="small recommendation-role">요청 인원·용도·시간을 충족하는 공간</p>';
  const relation = source.alternativeDetails?.find(item => item.id === candidate.id);
  return `<p class="small recommendation-role">${e(relation?.reason || '등록된 대체 장비 · 사양·구성품을 비교해주세요.')}</p>${relation?.difference ? `<p class="small"><strong>차이점:</strong> ${e(relation.difference)}</p>` : ''}`;
}

function alternatives(resource, condition, tab = 'resource', range = null) {
  if (!condition) return notify('먼저 이용 조건을 적용해주세요.');
  const from = range?.from || condition.start.slice(0, 10);
  const until = range?.until || localValue(new Date(new Date(`${from}T12:00`).getTime() + 7 * 86400000)).slice(0, 10);
  const selected = store.getState().selection;
  const candidates = alternateResources(resource, condition, reservationInputs(), store.getRestrictions()).filter(item => !selected.some(choice => choice.resourceId === item.id) && !store.availability(item, condition).length);
  const periodLabel = resource.kind === '장비' ? '다른 대여 기간 조회' : '다른 이용 시간대 조회';
  openDialog(`대체 ${resource.kind}·일정 조회`, `<p><strong>원래 항목: ${e(resource.name)}</strong></p><p class="small muted">${e(formatSchedule(condition, resource.kind))}</p><div class="tabs modal-section">${button(`대체 ${resource.kind}`, `data-alt-tab="resource" ${tab === 'resource' ? 'aria-current="page"' : ''}`, tab === 'resource')}${button(periodLabel, `data-alt-tab="period" ${tab === 'period' ? 'aria-current="page"' : ''}`, tab === 'period')}</div>
    ${tab === 'resource' ? (candidates.length ? candidates.map(item => `<article class="panel modal-section"><h3>${e(item.name)}</h3>${alternativeExplanation(resource, item)}<p class="small muted">원래 항목: ${e(resource.specs.join(' · '))} / ${e(resource.contents.join(' · '))}</p>${information(item)}${button('이 항목으로 변경·선택', `data-replace="${e(item.id)}"`, true)}</article>`).join('') : `<div class="empty-state"><p>현재 조건에 맞는 대체 ${e(resource.kind)}가 없습니다.</p><p class="small muted">인원·용도·기간을 수정하거나 다른 시간대를 조회해주세요.</p></div>`) : `<h3>${periodLabel}</h3><p class="small muted">동일한 ${e(resource.kind)}와 이용 길이를 유지합니다. 최대 31일 범위를 30분 간격으로 조회하며 빠른 후보 8개를 표시하는 시연 설정입니다.</p><form data-slot-form class="modal-section" novalidate><div class="field-grid"><label class="field">검색 시작일<input class="input" type="date" name="from" value="${e(from)}"></label><label class="field">검색 종료일<input class="input" type="date" name="until" value="${e(until)}"></label></div><button type="submit" class="btn btn-primary">가능한 기간 조회</button></form><div data-slots></div>`}
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
    pendingSelectionLogin = true;
    mobileSelectionMessage('신청하려면 로그인해주세요. 로그인 후 신청 내용을 확인합니다.');
    window.dispatchEvent(new CustomEvent('campus:auth', {detail: {reason: 'request'}}));
    return;
  }
  if (state.user.role !== 'student') return notify('학생 계정으로 신청해주세요.');
  const invalid = state.selection.flatMap(item => {
    const resource = resources.find(candidate => candidate.id === item.resourceId);
    return resource ? store.availability(resource, item.condition).map(error => `${resource.name}: ${error}`) : ['선택한 자원을 찾을 수 없습니다.'];
  });
  if (invalid.length) {
    if (mobileSelection) {
      mobileSelectionMessage('신청 전 항목별 조건을 확인해주세요. ' + invalid[0], true);
      const first = mobileSelection.dialog.querySelector('.selection-item:has(.error-text)');
      const target = first?.querySelector('[data-edit],[data-remove]') || mobileSelection.dialog.querySelector('[data-selection-feedback]');
      if (target) { target.tabIndex = target.tabIndex < 0 ? -1 : target.tabIndex; target.focus(); }
      return;
    }
    return trackSelectionDialog(openDialog('선택 항목의 조건을 확인해주세요', `<div class="notice">${invalid.map(message => `<p>${e(message)}</p>`).join('')}</div><p class="small muted">선택 목록에서 이용 조건을 수정하거나 대체 항목을 조회해주세요.</p><div class="modal-actions">${button('확인', 'data-close-dialog', true)}</div>`));
  }
  const confirmedSelection = JSON.stringify(state.selection);
  const confirmation = openDialog('선택 항목 예약 신청 확인', `<p class="small muted">아래 각 항목의 실제 신청 일정을 확인해주세요. 최종 제출 시 항목별 승인 대기 신청을 저장하며, 아직 예약이 확보되는 것은 아닙니다.</p>${state.selection.map(item => { const resource = resources.find(candidate => candidate.id === item.resourceId); return `<article class="panel modal-section"><strong>${e(resource.name)}</strong><p class="small">${e(formatSchedule(item.condition, resource.kind))}</p><span class="status status-muted">관리자 승인 필요</span></article>`; }).join('')}<p data-error role="alert" class="error-text" tabindex="-1" hidden></p><div class="modal-actions">${button('돌아가기', 'data-close-dialog')}${button('확인 후 신청', 'data-final-submit', true)}</div>`, dialog => {
    dialog.classList.add('selection-confirmation-dialog');
    const submit = dialog.querySelector('[data-final-submit]');
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.textContent = '최종 조건 검사 중…';
      dialog.dataset.busy = 'true';
      dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = true; });
      try {
        if (JSON.stringify(store.getState().selection) !== confirmedSelection) throw new Error('선택 목록이 변경되었습니다. 돌아가서 최신 신청 내용을 다시 확인해주세요.');
        await store.submitSelection();
        dialog.close(); notify('신청을 저장했습니다. 관리자 승인 전에는 이용이 확정되지 않습니다.'); navigate('/records');
      } catch (error) { errorAt(dialog, error.message); dialog.querySelector('[data-error]').focus(); submit.disabled = false; submit.textContent = '확인 후 신청'; }
      finally { dialog.dataset.busy = 'false'; dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = false; }); }
    });
  });
  trackSelectionDialog(confirmation);
  confirmation.addEventListener('close', () => queueMicrotask(() => {
    if (mobileSelection?.dialog.open) (mobileSelection.dialog.querySelector('[data-request]') || mobileSelection.dialog.querySelector('.dialog-close'))?.focus({preventScroll: true});
  }), {once: true});
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
  scope.querySelector('[data-open-mobile-selection]')?.addEventListener('click', openMobileSelection);
  scope.querySelector('[data-request]')?.addEventListener('click', request);
  scope.querySelector('[data-clear-selection]')?.addEventListener('click', async () => { try { await store.clearSelection(); } catch (error) { mobileSelectionMessage(error.message, true); } });
  scope.querySelectorAll('[data-remove]').forEach(el => el.addEventListener('click', async () => { try { await store.removeSelection(el.dataset.remove); } catch (error) { mobileSelectionMessage(error.message, true); } }));
  scope.querySelectorAll('[data-edit]').forEach(el => el.addEventListener('click', () => { const selection = store.getState().selection.find(item => item.id === el.dataset.edit); if (selection) editCondition(selection); }));
}

function filterForm(path, value) {
  const facility = path === '/facilities';
  const defaultCategories = facility ? ['스터디룸', '회의실', '촬영실'] : ['카메라', '프로젝터', '마이크'];
  const registeredCategories = resources.filter(resource => resource.kind === (facility ? '시설' : '장비')).map(resource => resource.category);
  const categories = ['전체', ...new Set([...defaultCategories, ...registeredCategories])];
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

const preparationChoices = [
  ['space', '공간', '참여 인원과 시설의 허용 목적을 확인합니다.'],
  ['video', '영상 촬영', '카메라와 촬영 구성을 비교합니다.'],
  ['audio', '음성 녹음', '마이크를 비교합니다.'],
  ['presentation', '자료 투사', '프로젝터와 시설 비치 설비를 확인합니다.'],
];

function preparationNeeds(value) {
  return {...(value.customNeeds || analyzeInput(value.activity).proposedNeeds || {})};
}

function purposeFingerprint(value) {
  return JSON.stringify([value.activity, value.chosen, preparationNeeds(value), value.condition, value.equipment, value.equipmentApplied, value.sentencePeopleAmbiguous === true]);
}

function purposeHtml(value) {
  const analysis = analyzeInput(value.activity), needs = preparationNeeds(value);
  const activities = [...new Set([...purposes, '면접 준비', '스터디', '세미나·행사'])];
  return `<form class="panel purpose-form" data-purpose-form novalidate><label class="field purpose-label">어떤 활동을 준비하시나요?<textarea class="input" name="activity" aria-label="준비하는 활동" placeholder="예: 면접 연습 3명, 동아리 독서 모임, 영상 촬영 없이 인터뷰">${e(value.activity)}</textarea></label><div class="sentence-analysis" data-sentence-analysis aria-label="문장 분석"></div><p class="small muted">활동을 자유롭게 입력하세요. 아래 필요한 준비를 바꾸면 입력한 활동에 맞춰 직접 구성할 수 있습니다.</p><div class="filters" aria-label="활동 예시">${activities.map(activity => `<button type="button" class="chip ${analysis.candidates.includes(activity) ? 'chip-active' : ''}" aria-pressed="${analysis.candidates.includes(activity)}" data-purpose="${e(activity)}">${e(activity)}</button>`).join('')}<button type="button" class="chip" data-custom-activity>기타 직접 설정</button></div><fieldset class="preparation-needs"><legend>필요한 공간·장비</legend><p class="small muted">입력에서 제안한 항목입니다. 실제 필요한 준비만 선택해주세요.</p><div class="preparation-grid">${preparationChoices.map(([key, label, description]) => `<label class="preparation-option"><input type="checkbox" name="need-${key}" data-preparation="${key}" ${needs[key] ? 'checked' : ''}><span><strong>${label}</strong><span class="small muted">${description}</span></span></label>`).join('')}</div></fieldset><details class="panel equipment-schedule"><summary>장비 대여 일정</summary>${fieldHtml(value.equipment, '장비', 'purpose-equipment')}${button('장비 일정 적용', 'data-equipment-apply', true)}</details><h3 class="field-heading">시설 이용 조건</h3><p class="small muted">활동 설명과 시설의 허용 목적은 별개입니다. 신청할 목적이 목록에 없으면 시설 관리자에게 확인해주세요.</p>${fieldHtml(value.condition, '시설', 'purpose-facility')}<div class="button-row"><button class="btn btn-primary" type="submit">추천 구성 보기</button></div><p class="small muted">일정 없이도 준비할 자원을 비교할 수 있습니다. 공간을 신청하려면 실제 허용 목적·인원·일정을 입력하고 조건을 확인해야 합니다.</p><p class="error-text" data-error role="alert" tabindex="-1" ${value.error ? '' : 'hidden'}>${e(value.error)}</p></form><div data-purpose-results aria-live="polite">${purposeResults(value)}</div>`;
}

function purposeResults(value) {
  if (!value.results) return '<section class="empty-state purpose-placeholder"><h2>자유롭게 활동을 입력하고 필요한 준비를 선택해보세요.</h2><p class="muted small">면접 준비·스터디처럼 새로운 활동도 공간과 장비를 직접 구성할 수 있습니다.</p></section>';
  const basis = value.results;
  if (basis.fingerprint !== purposeFingerprint(value)) return '<section class="notice modal-section"><h2>활동 또는 이용 조건이 변경되었습니다.</h2><p>추천 구성을 다시 조회해주세요. 기존 선택 목록의 항목과 일정은 유지됩니다.</p></section>';
  const cards = recommendationItems(basis.purpose, basis.analysis, basis.facilityCondition, basis.equipmentCondition, reservationInputs(), store.getRestrictions(), basis.people, basis.options);
  basis.cards = cards;
  const facilities = cards.filter(item => item.resource.kind === '시설'), equipment = cards.filter(item => item.resource.kind === '장비');
  const definition = recommendationDefinition(basis.purpose, basis.analysis, basis.options);
  const facilityMessage = !basis.options.facilityUse
    ? '<p class="notice small">공간 정보 후보입니다. 시설의 실제 허용 목적과 일정을 선택한 뒤 다시 조회해야 신청할 수 있습니다. 활동 이름만으로 시설 이용이 허용되지는 않습니다.</p>'
    : !basis.facilityCondition ? '<p class="notice small">허용 목적에 맞는 공간 후보입니다. 올바른 인원·일정을 적용해야 신청할 수 있습니다.</p>' : '';
  return `<p class="small muted applied-activity">현재 적용한 활동: ${e(basis.activity)}</p><section class="notice recommendation-summary"><h2>${e(definition.title)} 추천 구성</h2><p>${e(definition.reason)}</p><p class="small">필요한 준비: ${preparationChoices.filter(([key]) => basis.options.needs[key]).map(([, label]) => e(label)).join(' · ')} · 조건 확인과 관리자 승인 후 이용 확정</p></section><div class="recommendation-sections">${basis.options.needs.space ? `<section><h2 class="section-title">인원과 허용 목적에 맞는 공간 후보</h2>${facilityMessage}${facilities.length ? `<p class="small muted">${e(basis.people)}명 기준 · 비치 설비를 비교하고 공간 한 곳을 선택하세요.</p><div class="resource-grid facility-results">${facilities.map(item => resourceCard(item.resource, item.condition, item.role)).join('')}</div>` : '<div class="panel"><h3>현재 조건에 맞는 공간이 없습니다.</h3><p class="small muted">참여 인원과 시설의 허용 목적을 확인하거나 시설을 직접 찾아보세요.</p><a data-link class="btn btn-secondary" href="/facilities">시설 직접 찾기</a></div>'}</section>` : ''}${equipment.length ? `<section><h2 class="section-title">필요한 장비 후보</h2><p class="small muted">시설 비치 설비를 확인하고 필요한 항목만 선택하세요.</p><div class="resource-grid">${equipment.map(item => resourceCard(item.resource, item.condition, item.role)).join('')}</div></section>` : ''}${['video', 'audio', 'presentation'].some(key => basis.options.needs[key]) && !equipment.length ? '<section class="panel"><h2>선택한 준비에 맞는 등록 장비가 없습니다.</h2><p class="small muted">필요 항목을 바꾸거나 장비 목록을 확인해주세요.</p><a data-link class="btn btn-secondary" href="/equipment">장비 직접 찾기</a></section>' : ''}</div>`;
}

function bindPurpose(container, value) {
  const form = container.querySelector('[data-purpose-form]');
  const markStale = () => {
    invalidateSentenceAnalysis(value.sentenceAnalysis);
    value.error = '';
    errorAt(form, '');
    if (value.results) container.querySelector('[data-purpose-results]').innerHTML = '<section class="notice modal-section"><h2>활동 또는 이용 조건이 변경되었습니다.</h2><p>추천 구성을 다시 조회해주세요. 기존 선택 목록은 유지됩니다.</p></section>';
  };
  function activityChanged(text, chosen = '') {
    value.activity = text; value.chosen = chosen; value.customNeeds = null;
    value.sentencePeopleAmbiguous = false;
    const analysis = analyzeInput(text);
    if (analysis.people && !value.peopleEdited) value.condition.people = analysis.people;
    if (!value.useEdited) value.condition.use = analysis.candidates.length === 1 && purposes.includes(analysis.candidates[0]) ? analysis.candidates[0] : '';
    form.querySelector('[name="purpose-facility-people"]').value = value.condition.people;
    form.querySelector('[name="purpose-facility-use"]').value = value.condition.use || '';
    form.querySelectorAll('[data-preparation]').forEach(input => { input.checked = Boolean(analysis.proposedNeeds?.[input.dataset.preparation]); });
    form.querySelectorAll('[data-purpose]').forEach(button => {
      const selected = analysis.candidates.includes(button.dataset.purpose);
      button.classList.toggle('chip-active', selected); button.setAttribute('aria-pressed', String(selected));
    });
    markStale();
  }
  bindFields(form, 'purpose-equipment', value.equipment, markStale);
  bindFields(form, 'purpose-facility', value.condition, key => {
    if (key === 'people') { value.peopleEdited = true; value.sentencePeopleAmbiguous = false; }
    if (key === 'use') value.useEdited = true;
    markStale();
  });
  form.querySelector('[name="activity"]').addEventListener('input', event => activityChanged(event.target.value));
  form.querySelectorAll('[data-preparation]').forEach(input => input.addEventListener('change', () => {
    value.customNeeds = Object.fromEntries([...form.querySelectorAll('[data-preparation]')].map(node => [node.dataset.preparation, node.checked]));
    markStale();
  }));
  form.querySelectorAll('[data-purpose]').forEach(button => button.addEventListener('click', () => {
    activityChanged(button.dataset.purpose, button.dataset.purpose);
    form.querySelector('[name="activity"]').value = value.activity;
  }));
  form.querySelector('[data-custom-activity]').addEventListener('click', () => {
    value.chosen = '';
    if (value.activity.trim() === '기타') activityChanged('');
    const field = form.querySelector('[name="activity"]'); field.value = value.activity; field.focus();
    field.placeholder = '예: 취업 면접 연습, 독서 모임, 동아리 행사';
    markStale();
  });
  form.querySelector('[data-equipment-apply]').addEventListener('click', () => {
    const errors = conditionErrors(value.equipment); value.error = errors.join(' ');
    if (!errors.length) { value.equipmentApplied = {...value.equipment}; notify('장비 일정을 적용했습니다. 추천 구성을 다시 조회해주세요.'); }
    redraw();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const fail = message => { value.error = message; errorAt(form, message); form.querySelector('[data-error]').focus(); };
    if (!value.activity.trim()) return fail('준비하는 활동을 자유롭게 입력해주세요.');
    const analysis = analyzeInput(value.activity), needs = preparationNeeds(value);
    if (analysis.intent === 'direct' && !value.customNeeds && !value.chosen) {
      const path = analysis.equipmentQuery ? '/equipment' : '/facilities';
      navigate(`${path}?q=${encodeURIComponent(analysis.equipmentQuery || analysis.facilityQuery || '')}&activity=${encodeURIComponent(value.activity)}`);
      return;
    }
    if (!preparationChoices.some(([key]) => needs[key])) return fail('공간·영상 촬영·음성 녹음·자료 투사 중 필요한 준비를 하나 이상 선택해주세요.');
    if (needs.space && (value.sentencePeopleAmbiguous || ['ambiguous', 'invalid'].includes(analysis.peopleStatus)) && !value.peopleEdited) return fail('참여 인원을 자동으로 정하지 않았습니다. 시설 이용 인원을 직접 확인해주세요.');
    if (needs.space && (!Number.isSafeInteger(value.condition.people) || value.condition.people < 1)) return fail('공간을 이용할 참여 인원을 올바르게 입력해주세요.');
    const purpose = value.chosen || (analysis.candidates.length === 1 ? analysis.candidates[0] : analysis.activityLabel) || value.activity.trim();
    const facilityUse = purposes.includes(value.condition.use) ? value.condition.use : '';
    const condition = {...value.condition, use: facilityUse};
    value.error = '';
    value.results = {activity: value.activity, analysis, purpose, people: condition.people,
      options: {needs: {...needs}, facilityUse},
      facilityCondition: needs.space && facilityUse && !conditionErrors(condition, true).length ? condition : null,
      equipmentCondition: value.equipmentApplied ? {...value.equipmentApplied} : null,
      fingerprint: purposeFingerprint(value)};
    redraw();
  });
  value.sentenceAnalysis ||= createSentenceAnalysisState();
  bindSentenceAnalysis(form.querySelector('[data-sentence-analysis]'), {
    state: value.sentenceAnalysis,
    getSnapshot: () => ({activity: value.activity, people: value.condition.people,
      peopleEdited: value.peopleEdited, needs: preparationNeeds(value),
      needsEdited: value.customNeeds !== null, revision: purposeFingerprint(value)}),
    onApply: changes => {
      const currentNeeds = preparationNeeds(value);
      if (Object.hasOwn(changes, 'activity')) {
        value.activity = changes.activity; value.chosen = '';
        // Applying the activity field must not implicitly change any other confirmed field.
        value.customNeeds = {...currentNeeds};
        form.querySelector('[name="activity"]').value = value.activity;
      }
      if (Object.hasOwn(changes, 'people')) {
        value.condition.people = changes.people; value.peopleEdited = true;
        form.querySelector('[name="purpose-facility-people"]').value = changes.people;
      }
      if (Object.keys(changes.needs).length) value.customNeeds = {...currentNeeds, ...changes.needs};
      value.sentencePeopleAmbiguous = changes.peopleAmbiguous && !value.peopleEdited;
      const appliedNeeds = preparationNeeds(value);
      form.querySelectorAll('[data-preparation]').forEach(input => { input.checked = appliedNeeds[input.dataset.preparation] === true; });
      form.querySelectorAll('[data-purpose]').forEach(button => { button.classList.remove('chip-active'); button.setAttribute('aria-pressed', 'false'); });
      markStale();
    },
  });
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
  container.innerHTML = `<section class="page-shell rental-layout"><p class="info-banner">${serverMode ? '가상 자산·시설로 운영하는 개발 환경입니다. 신청·처리 이력은 서버에 저장됩니다. 실제 학교 재고·정책과 다르며 관리자 승인 전에는 이용이 확정되지 않습니다.' : '시연용 가상 자산·시설·예약·운영 기준입니다. 실제 학교 정책이나 재고를 의미하지 않으며, 관리자 승인 전에는 이용이 확정되지 않습니다.'}</p><div class="rental-content"><header class="page-heading"><p class="breadcrumb"><a data-link href="/">홈</a> / ${title}</p><h1>${title}</h1><p class="muted">${description}</p></header>${purpose ? purposeHtml(value) : `${filterForm(path, value)}${value.applied ? `<p class="notice small applied-conditions">${e(formatSchedule(value.applied, kind))}</p>` : '<p class="small muted applied-conditions">이용 조건을 적용하면 각 항목의 가능 여부를 확인할 수 있습니다.</p>'}<p class="notice small" data-draft-notice ${!value.applied || JSON.stringify(value.applied) === JSON.stringify(value.condition) ? 'hidden' : ''}>작성 중인 조건이 조회 기준과 다릅니다. 조건을 적용하고 다시 조회해주세요. 기존 선택 항목의 일정은 유지됩니다.</p><p class="results-count">${kind === '시설' ? '공간' : '장비'} ${matches.length}개${kind === '시설' ? ' · 비치 설비는 별도 대여 재고가 아닙니다.' : ''}</p>${matches.length ? `<div class="resource-grid ${kind === '시설' ? 'facility-results' : ''}">${matches.map(resource => resourceCard(resource, value.applied)).join('')}</div>` : `<section class="empty-state panel"><h2>검색 결과가 없습니다.</h2><p class="muted small">검색어·분류·인원·기간을 수정하고 다시 조회해주세요.</p>${button('검색어·분류 초기화', 'data-reset-search')}</section>`}`}</div>${selectionHtml()}</section>`;
  if (purpose) bindPurpose(container, value); else bindFilterForm(container, path, value, params);
  const conditionFor = resource => {
    const own = selectionFor(resource.id);
    if (own?.condition) return { ...own.condition };
    if (purpose) return value.results?.cards?.find(item => item.resource.id === resource.id)?.condition || null;
    return value.applied;
  };
  bindCards(container, conditionFor, purpose);
  bindSelection(container);
  container.querySelector('[data-reset-search]')?.addEventListener('click', () => { value.query = ''; value.category = '전체'; mounted.params = new URLSearchParams(); value.params = ''; window.history.replaceState({}, '', path); redraw(); });
}

function recordAction(record, item, action) {
  const cancel = action === 'cancel';
  const title = cancel ? '신청 취소 확인' : '장비 반납 신청 확인';
  const confirmation = openDialog(title, `<p><strong>${e(item.name)}</strong></p><p class="small muted">${e(record.number)} · ${e(formatSchedule(item.condition, item.kind))}</p><p class="modal-section">${cancel ? '이 항목의 신청을 취소할까요? 같은 묶음의 다른 신청은 유지됩니다.' : '반납 신청은 반환 완료가 아닙니다. 관리자의 실제 반환 확인 후 반납이 완료됩니다.'}</p><p data-error role="alert" class="error-text" hidden></p><div class="modal-actions">${button('돌아가기', 'data-close-dialog')}${button(cancel ? '확인 후 신청 취소' : '확인 후 반납 신청', 'data-record-confirm', true)}</div>`, dialog => {
    const submit = dialog.querySelector('[data-record-confirm]');
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      dialog.dataset.busy = 'true';
      dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = true; });
      try {
        if (cancel) await store.cancelItem(record.number, item.id, item.version);
        else await store.requestReturn(record.number, item.id, item.version);
        dialog.close(); notify(cancel ? '해당 항목의 신청을 취소했습니다.' : '반납 신청을 저장했습니다. 관리자 확인을 기다려주세요.');
      } catch (error) {
        if (error.status === 409) {
          try {
            await store.refreshRecords();
            dialog.close();
            notify('신청이 변경되어 최신 내역을 불러왔습니다. 상태를 확인한 뒤 다시 진행해주세요.');
          } catch (refreshError) {
            errorAt(dialog, '최신 내역을 불러오지 못했습니다. 창을 닫고 다시 확인해주세요. ' + refreshError.message);
          }
        } else errorAt(dialog, error.message);
        submit.disabled = false;
      }
      finally { dialog.dataset.busy = 'false'; dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = false; }); }
    });
  });
  trackPersonalDialog(confirmation, record.userId);
  confirmation.addEventListener('close', () => {
    queueMicrotask(() => {
      const requestDialog = document.querySelector('.request-detail-dialog[open]');
      if (requestDialog && (!document.activeElement || document.activeElement === document.body)) requestDialog.querySelector('.dialog-close')?.focus({preventScroll: true});
    });
  }, {once: true});
}

function recordDetailButton(container, id) {
  return [...container.querySelectorAll('[data-record-detail]')].find(node => node.dataset.item === String(id));
}

function showRecordDetail(container, record, item, state) {
  const params = new URLSearchParams(location.search);
  params.set('item', item.id);
  window.history.replaceState({}, '', `${location.pathname}?${params}${location.hash}`);
  const resource = resources.find(entry => entry.id === item.resourceId);
  openRequestDetail(record, item, {
    resource,
    equipmentState: state.equipmentStates?.[item.resourceId],
    onAction: action => recordAction(record, item, action),
    onResource: () => { if (resource) trackPersonalDialog(detail(resource, item.condition), record.userId); },
    onClose: () => {
      const current = new URLSearchParams(location.search);
      if (current.get('item') === String(item.id)) {
        current.delete('item');
        window.history.replaceState({}, '', `${location.pathname}${current.size ? `?${current}` : ''}${location.hash}`);
      }
      queueMicrotask(() => {
        const target = recordDetailButton(container, item.id) || container.querySelector('h1');
        if (target && target.isConnected) {
          if (target.tagName === 'H1') target.tabIndex = -1;
          target.focus({preventScroll: true});
        }
      });
    },
  });
}

export function renderRecords(container, history = false, params = new URLSearchParams(location.search)) {
  params = params instanceof URLSearchParams ? params : new URLSearchParams(params);
  mounted = null;
  const state = store.getState();
  const title = history ? '과거 신청 내역' : '신청 현황';
  if (!state.user || state.user.role !== 'student') {
    dismissRequestDetail({silent: true});
    container.innerHTML = `<section class="page-shell"><header class="page-heading"><p class="breadcrumb"><a data-link href="/">홈</a> / ${title}</p><h1>${title}</h1></header><section class="panel empty-state"><h2>학생 계정으로 로그인해주세요.</h2><p class="muted">본인의 신청 현황과 과거 내역을 확인할 수 있습니다.</p>${button('로그인', 'data-record-login', true)}</section></section>`;
    container.querySelector('[data-record-login]').addEventListener('click', () => window.dispatchEvent(new Event('campus:auth')));
    return;
  }
  const ownRecords = state.records.filter(record => record.userId === state.user.id);
  const view = params.get('view'), basisDate = params.get('date');
  const viewTitles = {'today-pickup': '오늘 수령', 'today-return': '오늘 반납 예정', 'today-facilities': '오늘 시설 이용'};
  const scoped = Boolean(viewTitles[view] && /^\d{4}-\d\d-\d\d$/.test(basisDate || '') && Number.isFinite(Date.parse(`${basisDate}T00:00:00+09:00`)));
  const scopeKey = scoped ? `${view}/${basisDate}` : '';
  if (scopeKey !== recordScopeKey) { recordScopeKey = scopeKey; recordKind = '전체'; }
  const requestedId = params.get('item');
  const requestedRecord = requestedId ? ownRecords.find(record => record.items.some(item => String(item.id) === requestedId)) : null;
  const requestedItem = requestedRecord?.items.find(item => String(item.id) === requestedId);
  if (requestedItem && isCompletedRequest(requestedItem) !== history) {
    const correctHistory = isCompletedRequest(requestedItem);
    window.history.replaceState({}, '', `${correctHistory ? '/history' : '/records'}?${params}${location.hash}`);
    document.title = `${correctHistory ? '과거 신청 내역' : '내 신청 현황'} · CampusRent`;
    renderRecords(container, correctHistory, params);
    return;
  }
  if (requestedItem && recordKind !== '전체' && recordKind !== requestedItem.kind) recordKind = '전체';
  if (!requestedItem) dismissRequestDetail({silent: true});
  // Keep the original item number even when earlier items are in another list or filter.
  const visible = ownRecords.map(record => ({ ...record, items: record.items.map((item, index) => ({...item, originalIndex: item.originalIndex || item.order || item.sequence || index + 1})).filter(item => isCompletedRequest(item) === history && (recordKind === '전체' || item.kind === recordKind) && (!scoped || matchesSummaryView(item, view, basisDate))) })).filter(record => record.items.length);
  const returnParams = new URLSearchParams(params);
  returnParams.delete('item');
  const returnUrl = `${history ? '/history' : '/records'}${returnParams.size ? `?${returnParams}` : ''}`;
  container.innerHTML = `<section class="page-shell records-page"><header class="page-heading"><p class="breadcrumb"><a data-link href="/">홈</a> / ${title}</p><h1>${title}</h1><p class="muted">나의 신청과 처리 결과를 확인하세요.</p></header><nav class="tabs" aria-label="신청 내역 구분"><a data-link href="/records" class="btn ${!history ? 'btn-primary' : 'btn-secondary'}" ${!history ? 'aria-current="page"' : ''}>신청 현황</a><a data-link href="/history" class="btn ${history ? 'btn-primary' : 'btn-secondary'}" ${history ? 'aria-current="page"' : ''}>과거 신청 내역</a></nav>${requestedId && !requestedItem ? `<section class="notice records-detail-error" role="alert"><p>이 신청 항목을 확인할 수 없습니다. 삭제되었거나 현재 계정의 신청이 아닐 수 있습니다.</p><a data-link class="btn btn-secondary" href="${e(returnUrl)}">목록으로 돌아가기</a></section>` : ''}<div class="filters" role="group" aria-label="신청 자원 종류">${['전체', '장비', '시설'].map(kind => `<button type="button" class="chip ${recordKind === kind ? 'chip-active' : ''}" aria-pressed="${recordKind === kind}" data-record-kind="${kind}">${kind}</button>`).join('')}</div>${visible.length ? visible.map(record => `<section class="record-card panel"><header class="record-heading"><strong>${e(record.number)}</strong><span class="small muted">${e(formatDate(record.createdAt))}</span></header>${record.items.map(item => {
    const status = requestStatus(item);
    return `<article class="record-item"><div class="record-item-heading"><div><p class="small muted">항목 ${e(item.originalIndex)} · ${e(item.kind)}</p><h3>${e(item.name)}</h3></div><span class="${status.className}">${e(status.label)}</span></div><p class="small">${e(formatSchedule(item.condition, item.kind))}</p><p class="record-next">${e(status.next)}</p>${item.reason ? `<p class="notice small">${status.code === 'REJECTED' ? '거절 사유' : '처리 사유'}: ${e(item.reason)}</p>` : ''}<div class="button-row">${status.action === 'cancel' ? button('신청 취소', `data-record-action="cancel" data-record="${e(record.number)}" data-item="${e(item.id)}"`) : ''}${status.action === 'return' ? button('반납 신청', `data-record-action="return" data-record="${e(record.number)}" data-item="${e(item.id)}"`, true) : ''}${button('신청 상세', `data-record-detail="${e(item.resourceId)}" data-record="${e(record.number)}" data-item="${e(item.id)}" aria-label="${e(item.name)} 신청 상세"`)}</div></article>`;
  }).join('')}</section>`).join('') : `<section class="panel empty-state"><h2>${history ? '과거 신청 내역이 없습니다.' : '진행 중인 신청이 없습니다.'}</h2><p class="muted small">${recordKind === '전체' ? '필요한 장비나 시설을 찾아 선택 목록에서 신청해보세요.' : `${recordKind} 필터에 해당하는 항목이 없습니다.`}</p><a data-link class="btn btn-primary" href="/equipment">장비·시설 둘러보기</a></section>`}</section>`;
  if (scoped) {
    container.querySelector('.records-page .tabs').insertAdjacentHTML('afterend', `<div class="notice records-summary-scope"><p><strong>${e(viewTitles[view])}</strong> · ${e(basisDate)} 한국 시간 기준 · 현재 상태에 해당하는 항목</p><a data-link href="/records">전체 신청 보기</a></div>`);
    const emptyTitle = container.querySelector('.empty-state h2');
    if (emptyTitle) emptyTitle.textContent = '해당 일정과 현재 상태에 맞는 신청이 없습니다.';
  }
  container.querySelectorAll('[data-record-kind]').forEach(el => el.addEventListener('click', () => { recordKind = el.dataset.recordKind; renderRecords(container, history, new URLSearchParams(location.search)); }));
  container.querySelectorAll('[data-record-action]').forEach(el => el.addEventListener('click', () => {
    const record = ownRecords.find(entry => entry.number === el.dataset.record);
    const item = record?.items.find(entry => entry.id === el.dataset.item);
    if (item) recordAction(record, item, el.dataset.recordAction);
  }));
  container.querySelectorAll('[data-record-detail]').forEach(el => el.addEventListener('click', () => {
    const record = ownRecords.find(entry => entry.number === el.dataset.record);
    const item = record?.items.find(entry => String(entry.id) === el.dataset.item);
    if (item) showRecordDetail(container, record, item, store.getState());
  }));
  if (requestedItem) showRecordDetail(container, requestedRecord, requestedItem, state);
}
