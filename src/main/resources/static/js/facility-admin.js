import {serverMode} from './data.js';
import {getState, requestApi, refreshRecords, subscribe} from './store.js';
import {openAuthDialog} from './account.js';
import {escapeHTML as e, formatDate, openDialog, notify} from './ui.js';

const statusLabels = {NORMAL: '정상', CHECKING: '점검', DISABLED: '사용 중지'};
const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
const management = {ownerId: null, data: null, loading: false, error: '', request: 0};
const filters = {query: '', type: '', status: 'ALL'};
const disabledControls = new WeakMap();
let editor = null;

subscribe(({user}) => {
  if (management.ownerId && (user?.role !== 'admin' || user.id !== management.ownerId)) resetManagement(null);
});

function leaveManagement() {
  if (location.pathname.replace(/\/$/, '') !== '/admin/facilities') resetManagement(management.ownerId);
}

window.addEventListener('popstate', leaveManagement);
window.addEventListener('campus:navigate', leaveManagement);

function authorizedOwner(ownerId) {
  const user = getState().user;
  return user?.role === 'admin' && user.id === ownerId;
}

function visiblePage(container, ownerId = management.ownerId) {
  return container.isConnected && location.pathname.replace(/\/$/, '') === '/admin/facilities' && authorizedOwner(ownerId);
}

function resetManagement(ownerId) {
  management.ownerId = ownerId;
  management.data = null;
  management.loading = false;
  management.error = '';
  management.request += 1;
  editor?.close();
  editor = null;
}

export function renderFacilityAdmin(container) {
  const user = getState().user;
  if (!serverMode || user?.role !== 'admin') {
    resetManagement(null);
    const title = !serverMode ? '개발 서버에서 시설을 관리하세요.' : user ? '관리자 권한이 필요합니다.' : '관리자 로그인이 필요합니다.';
    container.innerHTML = `<section class="page-shell"><div class="panel empty-state"><h1>${title}</h1><p>시설 정보와 운영 조건 수정은 관리자 계정으로 이용할 수 있습니다.</p><div class="button-row">${serverMode && !user ? '<button class="btn btn-primary" data-facility-login>로그인</button>' : ''}<a class="btn btn-secondary" href="/" data-link>홈으로</a></div></div></section>`;
    container.querySelector('[data-facility-login]')?.addEventListener('click', () => openAuthDialog());
    return;
  }
  if (management.ownerId !== user.id) resetManagement(user.id);
  container.innerHTML = `<section class="page-shell facility-management">
    <nav class="tabs" aria-label="관리자 메뉴"><a href="/admin" data-link>신청 관리</a><a href="/admin/equipment" data-link>장비 관리</a><a href="/admin/facilities" data-link aria-current="page">시설 관리</a><a href="/admin/alternatives" data-link>대체 장비 관리</a></nav>
    <header class="facility-management-heading"><div class="page-heading"><p class="eyebrow">CampusRent · 관리자</p><h1>시설 운영 관리</h1><p class="muted">시설 정보, 운영 시간과 허용 목적, 이용 제한 일정을 관리하세요.</p></div><div class="button-row"><button class="btn btn-secondary" data-facility-refresh ${management.loading ? 'disabled' : ''}>새로고침</button><button class="btn btn-primary" data-facility-create ${management.data && !management.loading ? '' : 'disabled'}>시설 등록</button></div></header>
    <section data-facility-content aria-live="polite" aria-busy="${management.loading}"></section>
  </section>`;
  container.querySelector('[data-facility-refresh]').addEventListener('click', () => loadManagement(container));
  container.querySelector('[data-facility-create]').addEventListener('click', () => openFacilityEditor(container));
  const content = container.querySelector('[data-facility-content]');
  if (management.loading) {
    content.innerHTML = '<p class="panel" role="status">시설 정보를 불러오고 있습니다…</p>';
  } else if (management.error) {
    content.innerHTML = `<div class="panel empty-state"><h2>시설 정보를 불러오지 못했습니다.</h2><p>${e(management.error)}</p><button class="btn btn-primary" data-facility-retry>다시 시도</button></div>`;
    content.querySelector('[data-facility-retry]').addEventListener('click', () => loadManagement(container));
  } else if (management.data) {
    renderFilters(container);
  } else {
    loadManagement(container);
  }
}

async function loadManagement(container) {
  const ownerId = management.ownerId;
  if (!authorizedOwner(ownerId)) return;
  const request = ++management.request;
  management.loading = true;
  management.error = '';
  if (visiblePage(container, ownerId)) renderFacilityAdmin(container);
  try {
    const result = await requestApi('/api/admin/facilities');
    if (!Array.isArray(result?.facilities) || !Array.isArray(result?.purposes)) throw new Error('시설 목록 응답을 확인해주세요.');
    if (request !== management.request || !authorizedOwner(ownerId)) return;
    management.data = result;
    if (filters.type && !result.facilities.some(item => item.type === filters.type)) filters.type = '';
  } catch (error) {
    if (request !== management.request || !authorizedOwner(ownerId)) return;
    management.error = error.message || '잠시 후 다시 조회해주세요.';
  } finally {
    if (request === management.request && authorizedOwner(ownerId)) {
      management.loading = false;
      if (visiblePage(container, ownerId)) renderFacilityAdmin(container);
    }
  }
}

function renderFilters(container) {
  const types = [...new Set(management.data.facilities.map(item => item.type))].sort((a, b) => a.localeCompare(b, 'ko'));
  const content = container.querySelector('[data-facility-content]');
  content.innerHTML = `<section class="panel facility-management-filters"><label class="field">시설 검색<input type="search" class="input" name="facility-query" placeholder="시설명, 관리번호, 위치, 비치 설비" value="${e(filters.query)}"></label><label class="field">시설 유형<select class="input" name="facility-type-filter"><option value="">전체 유형</option>${types.map(type => `<option value="${e(type)}" ${filters.type === type ? 'selected' : ''}>${e(type)}</option>`).join('')}</select></label><label class="field">운영 상태<select class="input" name="facility-status-filter"><option value="ALL">전체 상태</option>${Object.entries(statusLabels).map(([code, label]) => `<option value="${code}" ${filters.status === code ? 'selected' : ''}>${label}</option>`).join('')}<option value="NOT_ALLOWED" ${filters.status === 'NOT_ALLOWED' ? 'selected' : ''}>이용 불허</option></select></label></section><div data-facility-list></div>`;
  content.querySelector('[name=facility-query]').addEventListener('input', event => { filters.query = event.target.value; renderList(container); });
  content.querySelector('[name=facility-type-filter]').addEventListener('change', event => { filters.type = event.target.value; renderList(container); });
  content.querySelector('[name=facility-status-filter]').addEventListener('change', event => { filters.status = event.target.value; renderList(container); });
  renderList(container);
}

function hoursSummary(hours = {}) {
  const groups = new Map();
  weekdays.forEach((day, index) => {
    const times = hours[String(index + 1)];
    if (!Array.isArray(times) || times.length !== 2) return;
    const range = `${times[0]} ~ ${times[1]}`;
    if (!groups.has(range)) groups.set(range, []);
    groups.get(range).push(day);
  });
  return groups.size ? `<ul class="facility-hours-summary">${[...groups].map(([range, days]) => `<li>${e(days.join('·'))} ${e(range)}</li>`).join('')}</ul>` : '미설정';
}

function purposeSummary(item) {
  return (item.purposeIds || []).map(id => {
    const purpose = management.data.purposes.find(entry => entry.id === id);
    return purpose ? `${purpose.name}${purpose.enabled ? '' : ' (비활성)'}` : '확인 필요';
  }).join(' · ') || '미설정';
}

function renderList(container) {
  const {facilities} = management.data;
  const query = filters.query.trim().toLocaleLowerCase('ko-KR');
  const visible = facilities.filter(item => {
    const text = `${item.name} ${item.code} ${item.type} ${item.location} ${item.fixedEquipmentInfo || ''}`.toLocaleLowerCase('ko-KR');
    return (!query || text.includes(query)) && (!filters.type || item.type === filters.type) && (filters.status === 'ALL' || (filters.status === 'NOT_ALLOWED' ? !item.useAllowed : item.status === filters.status));
  });
  const list = container.querySelector('[data-facility-list]');
  list.innerHTML = `<p class="facility-management-count small muted">시설 ${visible.length}개 · 전체 ${facilities.length}개</p>${visible.length ? `<div class="facility-management-grid">${visible.map(item => {
    const statusClass = item.status === 'NORMAL' ? 'status-success' : item.status === 'CHECKING' ? 'status-warning' : 'status-muted';
    return `<article class="panel facility-management-card" data-facility-id="${e(item.id)}"><div class="facility-management-card-heading"><div><p class="small muted">${e(item.type)} · ${e(item.code)}</p><h2>${e(item.name)}</h2></div><span class="status ${statusClass}">${e(statusLabels[item.status] || item.status)}</span></div><dl class="facility-management-details"><div><dt>위치</dt><dd>${e(item.location)}</dd></div><div><dt>수용 인원</dt><dd>${e(item.capacity)}명</dd></div><div><dt>운영 시간</dt><dd>${hoursSummary(item.hoursByWeekday)}</dd></div><div><dt>허용 목적</dt><dd>${e(purposeSummary(item))}</dd></div><div><dt>이용</dt><dd>${item.useAllowed ? '허용' : '불허'}</dd></div><div><dt>진행 중 신청</dt><dd>${e(item.activeRequests || 0)}건</dd></div><div><dt>제한 일정</dt><dd>${e(item.blocks?.length || 0)}건</dd></div></dl><p class="small muted">${item.isDemo ? '가상 시설' : '실제 시설'}</p><div class="button-row"><button class="btn btn-secondary" data-edit-facility="${e(item.id)}">시설 수정</button><button class="btn btn-secondary" data-facility-blocks="${e(item.id)}">이용 제한 관리</button></div></article>`;
  }).join('')}</div>` : `<section class="panel empty-state"><h2>${facilities.length ? '검색 조건에 맞는 시설이 없습니다.' : '등록된 시설이 없습니다.'}</h2><p>${facilities.length ? '검색어와 필터를 확인해주세요.' : '첫 시설을 등록하고 운영 조건을 설정하세요.'}</p></section>`}`;
  list.querySelectorAll('[data-edit-facility]').forEach(button => button.addEventListener('click', () => {
    const item = facilities.find(entry => entry.id === button.dataset.editFacility);
    if (item) openFacilityEditor(container, item);
  }));
  list.querySelectorAll('[data-facility-blocks]').forEach(button => button.addEventListener('click', () => {
    const item = facilities.find(entry => entry.id === button.dataset.facilityBlocks);
    if (item) openBlockManager(container, item);
  }));
}

function showEditor(container, title, html, onMount) {
  if (!visiblePage(container)) return;
  const opener = document.activeElement;
  editor?.close();
  const dialog = openDialog(title, html);
  editor = dialog;
  dialog.classList.add('facility-editor');
  dialog.addEventListener('close', () => {
    if (editor === dialog) editor = null;
    if (!opener?.isConnected && visiblePage(container)) container.querySelector('[data-facility-refresh]')?.focus({preventScroll: true});
  }, {once: true});
  onMount?.(dialog);
  return dialog;
}

function errorsMarkup() {
  return '<p class="error-text" role="alert" tabindex="-1" data-facility-error></p><p class="small muted" role="status" data-facility-save-status></p><div data-facility-conflict hidden><p class="form-help">입력 내용은 유지되어 있습니다. 최신 정보를 다시 불러오면 작성 중인 내용이 초기화됩니다.</p><button type="button" class="btn btn-secondary" data-facility-reload>최신 정보 다시 불러오기</button></div>';
}

function actionsMarkup(label, {backToBlocks = false, danger = false} = {}) {
  return `<div class="modal-actions"><button type="button" class="btn btn-secondary" ${backToBlocks ? 'data-facility-back-to-blocks' : 'data-close-dialog'}>${backToBlocks ? '목록으로' : '돌아가기'}</button><button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-facility-save>${label}</button></div>`;
}

function setError(dialog, message) {
  const node = dialog.querySelector('[data-facility-error]');
  node.textContent = message;
  if (message) node.focus();
}

function setBusy(dialog, busy) {
  dialog.dataset.busy = String(busy);
  dialog.setAttribute('aria-busy', String(busy));
  if (busy) {
    const previous = new Map();
    dialog.querySelectorAll('input,select,textarea,button').forEach(control => {
      previous.set(control, control.disabled);
      control.disabled = true;
    });
    disabledControls.set(dialog, previous);
  } else {
    disabledControls.get(dialog)?.forEach((disabled, control) => { control.disabled = disabled; });
    disabledControls.delete(dialog);
  }
}

async function saveForm(container, dialog, path, method, body, message) {
  const ownerId = management.ownerId;
  if (!visiblePage(container, ownerId)) { dialog.close(); return; }
  setError(dialog, '');
  dialog.querySelector('[data-facility-conflict]').hidden = true;
  dialog.querySelector('[data-facility-save-status]').textContent = '저장하고 있습니다…';
  setBusy(dialog, true);
  let saved = false;
  try {
    const result = await requestApi(path, {method, body});
    saved = true;
    if (!authorizedOwner(ownerId)) return;
    if (result?.facility && management.data) {
      const index = management.data.facilities.findIndex(item => item.id === result.facility.id);
      if (index >= 0) management.data.facilities[index] = result.facility;
      else management.data.facilities.push(result.facility);
    }
    if (!visiblePage(container, ownerId)) return;
    dialog.querySelector('[data-facility-save-status]').textContent = '저장했습니다. 최신 목록을 확인하고 있습니다.';
    await loadManagement(container);
    await refreshRecords();
    if (!visiblePage(container, ownerId)) return;
    dialog.close();
    notify(management.error ? `${message} 목록은 새로고침으로 다시 확인해주세요.` : message);
  } catch (error) {
    if (!visiblePage(container, ownerId) || !dialog.isConnected) return;
    if (saved) {
      dialog.close();
      notify(`${message} 최신 조회를 완료하지 못했습니다. 새로고침해 확인해주세요.`);
      return;
    }
    setBusy(dialog, false);
    dialog.querySelector('[data-facility-save-status]').textContent = '';
    setError(dialog, error.message || '저장하지 못했습니다. 입력 내용을 확인해주세요.');
    if (error.status === 409) {
      const reload = dialog.querySelector('[data-facility-reload]');
      dialog.querySelector('[data-facility-conflict]').hidden = false;
      reload.onclick = async () => { dialog.close(); await loadManagement(container); };
    }
  }
}

function hoursMarkup(hours = {}) {
  return weekdays.map((day, index) => {
    const times = hours[String(index + 1)];
    const enabled = Array.isArray(times) && times.length === 2;
    return `<fieldset class="facility-hour-row" data-facility-weekday="${index + 1}"><legend>${day}요일</legend><div class="facility-hour-fields"><label class="facility-hour-option"><input type="checkbox" data-facility-hour-enabled ${enabled ? 'checked' : ''}> 운영 시간 설정</label><label class="field">시작<input class="input" type="time" step="60" data-facility-hour-open value="${e(times?.[0] || '')}" ${enabled ? 'required' : 'disabled'}></label><label class="field">종료<input class="input" type="time" step="60" data-facility-hour-close value="${e(times?.[1] || '')}" ${enabled ? 'required' : 'disabled'}></label></div></fieldset>`;
  }).join('');
}

function readHours(dialog) {
  const result = {};
  dialog.querySelectorAll('[data-facility-weekday]').forEach(row => {
    if (!row.querySelector('[data-facility-hour-enabled]').checked) return;
    const open = row.querySelector('[data-facility-hour-open]').value;
    const close = row.querySelector('[data-facility-hour-close]').value;
    if (!open || !close || close <= open) throw new Error(`${weekdays[Number(row.dataset.facilityWeekday) - 1]}요일 운영 종료 시각은 시작 시각보다 늦어야 합니다.`);
    result[row.dataset.facilityWeekday] = [open, close];
  });
  return result;
}

function openFacilityEditor(container, facility) {
  const existing = Boolean(facility);
  const item = facility || {name: '', code: '', type: '', location: '', capacity: '', fixedEquipmentInfo: '', status: 'NORMAL', useAllowed: true, isDemo: true, hoursByWeekday: {}, purposeIds: []};
  const {purposes} = management.data;
  showEditor(container, existing ? '시설 수정' : '시설 등록', `<form data-facility-form>
    <div class="field-grid"><label class="field">시설명<input class="input" name="name" maxlength="100" value="${e(item.name)}" required></label><label class="field">시설 관리번호<input class="input" name="code" maxlength="30" value="${e(item.code)}" ${existing ? 'readonly' : ''} required><span class="form-help">등록 후 변경할 수 없는 고유 관리번호입니다.</span></label></div>
    <div class="field-grid"><label class="field">시설 유형<input class="input" name="type" maxlength="20" value="${e(item.type)}" placeholder="예: 회의실" required></label><label class="field">수용 인원<input class="input" name="capacity" type="number" min="1" max="999" step="1" value="${e(item.capacity)}" required></label></div>
    <label class="field">위치<input class="input" name="location" maxlength="200" value="${e(item.location)}" required></label>
    <label class="field">비치 설비 안내<textarea class="input" name="fixedEquipmentInfo" maxlength="1000" rows="3">${e(item.fixedEquipmentInfo || '')}</textarea><span class="form-help">시설에 비치된 설비를 안내합니다. 별도 대여 재고와 구분해 입력하세요.</span></label>
    <div class="field-grid"><label class="field">운영 상태<select class="input" name="status">${Object.entries(statusLabels).map(([code, label]) => `<option value="${code}" ${code === item.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div><label class="check-row"><input name="useAllowed" type="checkbox" ${item.useAllowed ? 'checked' : ''}> 이용 허용</label><label class="check-row"><input name="isDemo" type="checkbox" ${item.isDemo ? 'checked' : ''}> 가상 시설</label></div></div>
    <section class="facility-editor-section"><h3>요일별 운영 시간</h3><p class="form-help">운영 시간을 설정하지 않은 요일은 신청할 수 없습니다. 시작과 종료는 같은 날의 시간으로 입력하세요.</p><div class="facility-hours-editor">${hoursMarkup(item.hoursByWeekday)}</div></section>
    <fieldset class="facility-editor-section facility-purpose-fieldset"><legend>허용 목적</legend><p class="form-help">목적을 선택하지 않으면 신청할 수 없습니다. 비활성 목적은 새로 추가할 수 없으며 기존 연결은 유지됩니다.</p><div class="facility-purpose-options">${purposes.length ? purposes.map(purpose => `<label class="check-row"><input type="checkbox" value="${e(purpose.id)}" data-facility-purpose ${item.purposeIds.includes(purpose.id) ? 'checked' : ''} ${purpose.enabled ? '' : 'disabled'}> <span>${e(purpose.name)}${purpose.enabled ? '' : ' (비활성)'}</span></label>`).join('') : '<p class="muted">등록된 이용 목적이 없습니다.</p>'}</div></fieldset>
    <section class="facility-editor-section"><h3>운영 변경 확인</h3>${existing ? `<p class="small muted">현재 진행 중인 신청 ${e(item.activeRequests || 0)}건 · ${item.hasHistory ? '신청 이력 있음' : '신청 이력 없음'}</p>` : ''}<p class="notice small">기존 승인 예약과 이용 중인 신청을 유지할 수 없는 변경은 저장되지 않습니다. 운영 시간·인원·허용 목적도 함께 확인하세요.</p><label class="field">변경 사유<textarea class="input" name="reason" maxlength="500" rows="2" placeholder="운영 상태·이용 허용 여부를 바꿀 때 필수입니다."></textarea></label><label class="check-row"><input type="checkbox" name="confirmed">시설 운영과 기존 신청에 미치는 영향을 확인했습니다.</label><p class="form-help" data-facility-confirmation-note></p></section>
    ${errorsMarkup()}${actionsMarkup(existing ? '변경 저장' : '시설 등록')}
  </form>`, dialog => {
    const form = dialog.querySelector('form');
    const operationChanged = () => existing ? form.elements.status.value !== item.status || form.elements.useAllowed.checked !== item.useAllowed : form.elements.status.value !== 'NORMAL' || !form.elements.useAllowed.checked;
    const updateConfirmation = () => {
      const required = operationChanged();
      form.elements.reason.required = required;
      form.elements.confirmed.required = required;
      dialog.querySelector('[data-facility-confirmation-note]').textContent = required ? '현재 운영 변경에는 사유와 영향 확인이 필요합니다.' : '운영 상태나 이용 허용 여부를 바꾸면 사유와 영향 확인이 필요합니다.';
    };
    form.elements.status.addEventListener('change', updateConfirmation);
    form.elements.useAllowed.addEventListener('change', updateConfirmation);
    updateConfirmation();
    dialog.querySelectorAll('[data-facility-hour-enabled]').forEach(checkbox => checkbox.addEventListener('change', () => {
      checkbox.closest('[data-facility-weekday]').querySelectorAll('input[type=time]').forEach(input => { input.disabled = !checkbox.checked; input.required = checkbox.checked; });
    }));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (dialog.dataset.busy === 'true') return;
      try {
        if (operationChanged() && (!form.elements.reason.value.trim() || !form.elements.confirmed.checked)) throw new Error('운영 상태나 이용 허용 여부를 바꿀 때 변경 사유와 영향 확인을 입력해주세요.');
        const capacity = Number(form.elements.capacity.value);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 999) throw new Error('수용 인원은 1명부터 999명까지의 정수로 입력해주세요.');
        const body = {code: form.elements.code.value.trim(), name: form.elements.name.value.trim(), type: form.elements.type.value.trim(), location: form.elements.location.value.trim(), capacity, fixedEquipmentInfo: form.elements.fixedEquipmentInfo.value.trim(), status: form.elements.status.value, useAllowed: form.elements.useAllowed.checked, isDemo: form.elements.isDemo.checked, hoursByWeekday: readHours(dialog), purposeIds: [...dialog.querySelectorAll('[data-facility-purpose]:checked')].map(input => input.value), reason: form.elements.reason.value.trim(), confirmed: form.elements.confirmed.checked, ...(existing ? {expectedVersion: item.version} : {})};
        saveForm(container, dialog, existing ? `/api/admin/facilities/${encodeURIComponent(item.id)}` : '/api/admin/facilities', existing ? 'PUT' : 'POST', body, existing ? '시설 정보를 저장했습니다.' : '시설을 등록했습니다.');
      } catch (error) { setError(dialog, error.message); }
    });
  });
}

function facilityCaption(item) {
  return `<p class="facility-editor-caption"><strong>${e(item.name)}</strong><span class="small muted">${e(item.code)} · ${e(item.location)}</span></p>`;
}

function openBlockManager(container, item) {
  const blocks = item.blocks || [];
  showEditor(container, '시설 이용 제한 관리', `${facilityCaption(item)}<div class="facility-block-heading"><p class="muted">이용을 제한할 기간과 사유를 관리하세요. 기존 승인 예약과 겹치는 제한은 저장되지 않습니다.</p><button class="btn btn-primary" data-facility-block-add>이용 제한 등록</button></div><p class="small muted">등록된 제한 ${blocks.length}건 · 지난 제한 일정도 함께 표시합니다.</p><div class="facility-block-list">${blocks.length ? blocks.map(block => `<article class="facility-block-card"><h3>${e(formatDate(block.start))} ~ ${e(formatDate(block.end))}</h3><p class="facility-block-reason">${e(block.reason)}</p>${block.createdAt ? `<p class="small muted">등록 ${e(formatDate(block.createdAt))}</p>` : ''}<div class="button-row"><button class="btn btn-secondary" data-facility-block-edit="${e(block.id)}" aria-label="${e(formatDate(block.start))} 제한 수정">수정</button><button class="btn btn-danger" data-facility-block-remove="${e(block.id)}" aria-label="${e(formatDate(block.start))} 제한 해제">제한 해제</button></div></article>`).join('') : '<p class="facility-block-empty muted">등록된 이용 제한이 없습니다.</p>'}</div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-dialog>닫기</button></div>`, dialog => {
    dialog.querySelector('[data-facility-block-add]').addEventListener('click', () => openBlockEditor(container, item));
    dialog.querySelectorAll('[data-facility-block-edit]').forEach(button => button.addEventListener('click', () => {
      const block = blocks.find(entry => entry.id === button.dataset.facilityBlockEdit);
      if (block) openBlockEditor(container, item, block);
    }));
    dialog.querySelectorAll('[data-facility-block-remove]').forEach(button => button.addEventListener('click', () => {
      const block = blocks.find(entry => entry.id === button.dataset.facilityBlockRemove);
      if (block) openBlockRemoval(container, item, block);
    }));
  });
}

function dateInputValue(value) {
  return String(value || '').replace(/\.\d+$/, '');
}

function dateOrder(value) {
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?$/);
  if (!match) throw new Error('제한 시작과 종료 일시를 확인해주세요.');
  return `${match[1]}:${match[2] || '00'}.${(match[3] || '').padEnd(9, '0')}`;
}

function openBlockEditor(container, item, block) {
  const existing = Boolean(block);
  showEditor(container, existing ? '이용 제한 수정' : '이용 제한 등록', `<form data-facility-block-form>${facilityCaption(item)}<div class="field-grid"><label class="field">제한 시작 일시<input class="input" type="datetime-local" step="1" name="start" value="${e(dateInputValue(block?.start))}" required></label><label class="field">제한 종료 일시<input class="input" type="datetime-local" step="1" name="end" value="${e(dateInputValue(block?.end))}" required></label></div><label class="field">제한 사유<textarea class="input" name="reason" maxlength="500" rows="3" required>${e(block?.reason || '')}</textarea></label><p class="notice small">이 기간에는 새로운 시설 이용을 승인할 수 없습니다. 기존 승인 예약이나 이용 중인 신청과 겹치면 저장되지 않습니다.</p><label class="check-row"><input type="checkbox" name="confirmed" required>제한 기간과 기존 신청에 미치는 영향을 확인했습니다.</label>${errorsMarkup()}${actionsMarkup(existing ? '변경 저장' : '이용 제한 등록', {backToBlocks: true})}</form>`, dialog => {
    const form = dialog.querySelector('form');
    const initialStart = form.elements.start.value;
    const initialEnd = form.elements.end.value;
    dialog.querySelector('[data-facility-back-to-blocks]').addEventListener('click', () => openBlockManager(container, item));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (dialog.dataset.busy === 'true') return;
      try {
        // Keep the database precision when only the reason changes.
        const start = existing && form.elements.start.value === initialStart ? block.start : form.elements.start.value;
        const end = existing && form.elements.end.value === initialEnd ? block.end : form.elements.end.value;
        if (dateOrder(end) <= dateOrder(start)) throw new Error('제한 종료 일시는 시작 일시보다 늦어야 합니다.');
        if (!form.elements.reason.value.trim() || !form.elements.confirmed.checked) throw new Error('제한 사유와 영향 확인을 입력해주세요.');
        const body = {start, end, reason: form.elements.reason.value.trim(), confirmed: form.elements.confirmed.checked, expectedVersion: item.version};
        const path = `/api/admin/facilities/${encodeURIComponent(item.id)}/blocks${existing ? `/${encodeURIComponent(block.id)}` : ''}`;
        saveForm(container, dialog, path, existing ? 'PUT' : 'POST', body, existing ? '이용 제한을 수정했습니다.' : '이용 제한을 등록했습니다.');
      } catch (error) { setError(dialog, error.message); }
    });
  });
}

function openBlockRemoval(container, item, block) {
  showEditor(container, '시설 이용 제한 해제', `<form data-facility-block-remove-form>${facilityCaption(item)}<dl class="facility-management-details"><div><dt>제한 기간</dt><dd>${e(formatDate(block.start))} ~ ${e(formatDate(block.end))}</dd></div><div><dt>기존 사유</dt><dd class="facility-block-reason">${e(block.reason)}</dd></div></dl><p class="notice small">이 제한 일정을 해제합니다. 다른 운영 조건을 충족하면 해당 기간의 신청을 승인할 수 있습니다.</p><label class="field">해제 사유<textarea class="input" name="reason" maxlength="500" rows="3" required></textarea></label><label class="check-row"><input type="checkbox" name="confirmed" required>제한 해제가 시설 운영에 미치는 영향을 확인했습니다.</label>${errorsMarkup()}${actionsMarkup('제한 해제', {backToBlocks: true, danger: true})}</form>`, dialog => {
    const form = dialog.querySelector('form');
    dialog.querySelector('[data-facility-back-to-blocks]').addEventListener('click', () => openBlockManager(container, item));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (dialog.dataset.busy === 'true') return;
      if (!form.elements.reason.value.trim() || !form.elements.confirmed.checked) return setError(dialog, '해제 사유와 영향 확인을 입력해주세요.');
      saveForm(container, dialog, `/api/admin/facilities/${encodeURIComponent(item.id)}/blocks/${encodeURIComponent(block.id)}/remove`, 'POST', {expectedVersion: item.version, reason: form.elements.reason.value.trim(), confirmed: form.elements.confirmed.checked}, '이용 제한을 해제했습니다.');
    });
  });
}
