import {serverMode} from './data.js';
import {getState, requestApi, refreshRecords, subscribe} from './store.js';
import {openAuthDialog} from './account.js';
import {escapeHTML as e, openDialog, notify} from './ui.js';

const statusLabels = {NORMAL: '정상', CHECKING: '점검', DISABLED: '사용 중지'};
const management = {ownerId: null, data: null, loading: false, error: '', request: 0};
const filters = {query: '', status: 'ALL', typeId: 'ALL'};
let editor = null;

subscribe(({user}) => {
  if (management.ownerId && (user?.role !== 'admin' || user.id !== management.ownerId)) resetManagement(null);
});

function closeEditorOnNavigation() {
  if (location.pathname.replace(/\/$/, '') !== '/admin/equipment') editor?.close();
}

window.addEventListener('popstate', closeEditorOnNavigation);
window.addEventListener('campus:navigate', closeEditorOnNavigation);

function authorizedOwner(ownerId) {
  const user = getState().user;
  return user?.role === 'admin' && user.id === ownerId;
}

function visiblePage(container, ownerId) {
  return container.isConnected && location.pathname.replace(/\/$/, '') === '/admin/equipment' && authorizedOwner(ownerId);
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

export function renderEquipmentAdmin(container) {
  const user = getState().user;
  if (!serverMode || user?.role !== 'admin') {
    resetManagement(null);
    const title = !serverMode ? '개발 서버에서 장비를 관리하세요.' : user ? '관리자 권한이 필요합니다.' : '관리자 로그인이 필요합니다.';
    container.innerHTML = `<section class="page-shell"><div class="panel empty-state"><h1>${title}</h1><p>장비 등록과 운영 정보 수정은 관리자 계정으로 이용할 수 있습니다.</p>${serverMode && !user ? '<button class="btn btn-primary" data-equipment-login>로그인</button>' : ''}<a class="btn btn-secondary" href="/" data-link>홈으로</a></div></section>`;
    container.querySelector('[data-equipment-login]')?.addEventListener('click', () => openAuthDialog());
    return;
  }
  if (management.ownerId !== user.id) resetManagement(user.id);
  container.innerHTML = `<section class="page-shell equipment-management">
    <nav class="tabs" aria-label="관리자 메뉴"><a href="/admin" data-link>신청 관리</a><a href="/admin/equipment" data-link aria-current="page">장비 관리</a><a href="/admin/facilities" data-link>시설 운영 관리</a><a href="/admin/alternatives" data-link>대체 장비 관리</a></nav>
    <header class="equipment-management-heading"><div class="page-heading"><p class="eyebrow">CampusRent · 관리자</p><h1>장비 관리</h1><p class="muted">장비 정보와 구성품을 등록하고 대여 가능 여부를 관리하세요.</p></div><div class="button-row"><button class="btn btn-secondary" data-equipment-refresh ${management.loading ? 'disabled' : ''}>새로고침</button><button class="btn btn-primary" data-equipment-create ${management.data ? '' : 'disabled'}>장비 등록</button></div></header>
    <div class="equipment-management-tools"><button class="btn btn-secondary" data-equipment-type-create ${management.data ? '' : 'disabled'}>분류 등록</button><button class="btn btn-secondary" data-equipment-model-create ${management.data?.types.length ? '' : 'disabled'}>모델 등록</button><p class="small muted">같은 모델의 장비는 등록된 모델과 사양을 함께 사용합니다.</p></div>
    <section data-equipment-content aria-live="polite"></section>
  </section>`;
  container.querySelector('[data-equipment-refresh]').addEventListener('click', () => loadManagement(container));
  container.querySelector('[data-equipment-create]').addEventListener('click', () => openEquipmentEditor(container));
  container.querySelector('[data-equipment-type-create]').addEventListener('click', () => openTypeEditor(container));
  container.querySelector('[data-equipment-model-create]').addEventListener('click', () => openModelEditor(container));
  const content = container.querySelector('[data-equipment-content]');
  if (management.loading) {
    content.innerHTML = '<p class="panel" role="status">장비 정보를 불러오고 있습니다…</p>';
  } else if (management.error) {
    content.innerHTML = `<div class="panel empty-state"><h2>장비 정보를 불러오지 못했습니다.</h2><p>${e(management.error)}</p><button class="btn btn-primary" data-equipment-retry>다시 시도</button></div>`;
    content.querySelector('[data-equipment-retry]').addEventListener('click', () => loadManagement(container));
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
  if (visiblePage(container, ownerId)) renderEquipmentAdmin(container);
  try {
    const result = await requestApi('/api/admin/equipment');
    if (!Array.isArray(result?.equipment) || !Array.isArray(result?.types) || !Array.isArray(result?.models)) throw new Error('장비 목록 응답을 확인해주세요.');
    if (request !== management.request || !authorizedOwner(ownerId)) return;
    management.data = result;
  } catch (error) {
    if (request !== management.request || !authorizedOwner(ownerId)) return;
    management.error = error.message || '잠시 후 다시 조회해주세요.';
  } finally {
    if (request === management.request && authorizedOwner(ownerId)) {
      management.loading = false;
      if (visiblePage(container, ownerId)) renderEquipmentAdmin(container);
    }
  }
}

function renderFilters(container) {
  const content = container.querySelector('[data-equipment-content]');
  content.innerHTML = `<section class="panel equipment-management-filters"><label class="field">장비 검색<input class="input" name="equipment-query" placeholder="장비명, 관리번호, 모델, 보관 장소" value="${e(filters.query)}"></label><label class="field">분류<select class="input" name="equipment-type-filter"><option value="ALL">전체 분류</option>${management.data.types.map(type => `<option value="${e(type.id)}" ${filters.typeId === type.id ? 'selected' : ''}>${e(type.name)}</option>`).join('')}</select></label><label class="field">운영 상태<select class="input" name="equipment-status-filter"><option value="ALL">전체 상태</option>${Object.entries(statusLabels).map(([code, label]) => `<option value="${code}" ${filters.status === code ? 'selected' : ''}>${label}</option>`).join('')}<option value="NOT_ALLOWED" ${filters.status === 'NOT_ALLOWED' ? 'selected' : ''}>대여 제한</option></select></label></section><div data-equipment-list></div>`;
  content.querySelector('[name=equipment-query]').addEventListener('input', event => { filters.query = event.target.value; renderList(container); });
  content.querySelector('[name=equipment-type-filter]').addEventListener('change', event => { filters.typeId = event.target.value; renderList(container); });
  content.querySelector('[name=equipment-status-filter]').addEventListener('change', event => { filters.status = event.target.value; renderList(container); });
  renderList(container);
}

function renderList(container) {
  const {equipment, models, types} = management.data;
  const query = filters.query.trim().toLocaleLowerCase('ko-KR');
  const visible = equipment.filter(item => {
    const model = models.find(entry => entry.id === item.modelId);
    const text = `${item.name} ${item.code} ${item.location} ${item.department || ''} ${model?.name || ''} ${model?.code || ''}`.toLocaleLowerCase('ko-KR');
    return (!query || text.includes(query)) && (filters.typeId === 'ALL' || model?.typeId === filters.typeId) && (filters.status === 'ALL' || (filters.status === 'NOT_ALLOWED' ? !item.lendAllowed : item.status === filters.status));
  });
  const list = container.querySelector('[data-equipment-list]');
  list.innerHTML = `<p class="equipment-management-count small muted">장비 ${visible.length}개 · 전체 ${equipment.length}개</p>${visible.length ? `<div class="equipment-management-grid">${visible.map(item => {
    const model = models.find(entry => entry.id === item.modelId);
    const type = types.find(entry => entry.id === model?.typeId);
    const statusClass = item.status === 'NORMAL' ? 'status-success' : item.status === 'CHECKING' ? 'status-warning' : 'status-muted';
    return `<article class="panel equipment-management-card" data-equipment-id="${e(item.id)}"><div class="equipment-management-card-heading"><div><p class="small muted">${e(type?.name || '분류 확인 필요')} · ${e(item.code)}</p><h2>${e(item.name)}</h2></div><span class="status ${statusClass}">${e(statusLabels[item.status] || item.status)}</span></div><dl class="equipment-management-details"><div><dt>모델</dt><dd>${e(model?.name || '')}</dd></div><div><dt>보관 장소</dt><dd>${e(item.location)}</dd></div><div><dt>담당 부서</dt><dd>${e(item.department || '미입력')}</dd></div><div><dt>대여</dt><dd>${item.lendAllowed ? '허용' : '제한'}</dd></div><div><dt>진행 중 신청</dt><dd>${e(item.activeRequests || 0)}건</dd></div></dl><p class="small muted">${item.isDemo ? '가상 자원' : '실제 자원'} · 기본 구성품 ${item.components.length}종</p><button class="btn btn-secondary" data-edit-equipment="${e(item.id)}">장비 수정</button></article>`;
  }).join('')}</div>` : `<section class="panel empty-state"><h2>${equipment.length ? '검색 조건에 맞는 장비가 없습니다.' : '등록된 장비가 없습니다.'}</h2><p>${equipment.length ? '검색어와 필터를 확인해주세요.' : '분류와 모델을 준비한 뒤 첫 장비를 등록하세요.'}</p></section>`}`;
  list.querySelectorAll('[data-edit-equipment]').forEach(button => button.addEventListener('click', () => {
    const item = equipment.find(entry => entry.id === button.dataset.editEquipment);
    if (item) openEquipmentEditor(container, item);
  }));
}

function showEditor(title, html, onMount) {
  editor?.close();
  const dialog = openDialog(title, html);
  editor = dialog;
  dialog.classList.add('equipment-editor');
  dialog.addEventListener('close', () => { if (editor === dialog) editor = null; }, {once: true});
  onMount(dialog);
  return dialog;
}

function errorsMarkup() {
  return '<p class="error-text" role="alert" tabindex="-1" data-equipment-error></p><p class="small muted" role="status" data-equipment-save-status></p><button type="button" class="btn btn-secondary" data-equipment-reload hidden>최신 정보 다시 불러오기</button>';
}

function actionsMarkup(label) {
  return `<div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-dialog>돌아가기</button><button type="submit" class="btn btn-primary" data-equipment-save>${label}</button></div>`;
}

function setError(dialog, message) {
  const node = dialog.querySelector('[data-equipment-error]');
  node.textContent = message;
  node.focus();
}

function setBusy(dialog, busy) {
  dialog.dataset.busy = String(busy);
  dialog.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = busy; });
}

async function saveForm(container, dialog, path, method, body, message) {
  const ownerId = management.ownerId;
  if (!visiblePage(container, ownerId)) {
    dialog.close();
    return;
  }
  setError(dialog, '');
  setBusy(dialog, true);
  let saved = false;
  try {
    await requestApi(path, {method, body});
    saved = true;
    if (!visiblePage(container, ownerId)) return;
    dialog.querySelector('[data-equipment-save-status]').textContent = '저장했습니다. 최신 목록을 확인하고 있습니다.';
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
    setError(dialog, error.message || '저장하지 못했습니다. 입력 내용을 확인해주세요.');
    if (error.status === 409) {
      const reload = dialog.querySelector('[data-equipment-reload]');
      reload.hidden = false;
      reload.onclick = async () => { dialog.close(); await loadManagement(container); };
    }
  }
}

function componentMarkup(component = {}) {
  const key = crypto.randomUUID();
  return `<fieldset class="equipment-component-row" data-component-id="${e(component.id || '')}"><legend>구성품</legend><div class="equipment-component-fields"><label class="field">구성품명<input class="input" data-component-name maxlength="100" value="${e(component.name || '')}" required></label><label class="field">수량<input class="input" data-component-quantity type="number" min="1" max="99999" step="1" value="${e(component.quantity || 1)}" required></label></div><div class="equipment-component-options"><label><input type="radio" name="component-body" value="${key}" data-component-body ${component.body ? 'checked' : ''}> 본체</label><label><input type="checkbox" data-component-required ${component.required !== false ? 'checked' : ''}> 필수 반환</label><button class="btn btn-quiet" type="button" data-component-remove>구성품 제거</button></div></fieldset>`;
}

function bindComponents(dialog) {
  const rows = dialog.querySelector('[data-component-rows]');
  rows.addEventListener('click', event => {
    if (!event.target.closest('[data-component-remove]')) return;
    if (rows.children.length <= 1) return setError(dialog, '본체를 포함한 구성품을 한 개 이상 입력해주세요.');
    event.target.closest('.equipment-component-row').remove();
  });
  rows.addEventListener('change', event => {
    if (event.target.matches('[data-component-body]')) event.target.closest('.equipment-component-row').querySelector('[data-component-required]').checked = true;
  });
  dialog.querySelector('[data-component-add]').addEventListener('click', () => {
    rows.insertAdjacentHTML('beforeend', componentMarkup());
    rows.lastElementChild.querySelector('input').focus();
  });
}

function readComponents(dialog) {
  const components = [...dialog.querySelectorAll('.equipment-component-row')].map(row => ({
    ...(row.dataset.componentId ? {id: row.dataset.componentId} : {}),
    name: row.querySelector('[data-component-name]').value.trim(),
    quantity: Number(row.querySelector('[data-component-quantity]').value),
    body: row.querySelector('[data-component-body]').checked,
    required: row.querySelector('[data-component-required]').checked,
  }));
  if (components.some(item => !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99999)) throw new Error('모든 구성품의 이름과 양의 정수 수량을 입력해주세요.');
  if (new Set(components.map(item => item.name)).size !== components.length) throw new Error('구성품 이름은 서로 다르게 입력해주세요.');
  if (components.filter(item => item.body).length !== 1 || components.some(item => item.body && (!item.required || item.quantity !== 1))) throw new Error('본체를 한 개 지정하고 수량 1개·필수 반환으로 확인해주세요.');
  return components;
}

function openEquipmentEditor(container, equipment) {
  const existing = Boolean(equipment);
  const item = equipment || {modelId: '', code: '', name: '', location: '', department: '', status: 'NORMAL', lendAllowed: true, isDemo: true, components: [{name: '본체', quantity: 1, body: true, required: true}]};
  const {models, types} = management.data;
  showEditor(existing ? '장비 수정' : '장비 등록', `<form data-equipment-form>
    <div class="field-grid"><label class="field">장비명<input class="input" name="name" maxlength="100" value="${e(item.name)}" required></label><label class="field">개별 관리번호<input class="input" name="code" maxlength="30" value="${e(item.code)}" ${existing ? 'readonly' : ''} required><span class="form-help">신청·검수 이력에 사용하는 고유 관리번호입니다.</span></label></div>
    <label class="field">장비 모델<select class="input" name="modelId" required><option value="">모델 선택</option>${models.map(model => { const type = types.find(entry => entry.id === model.typeId); return `<option value="${e(model.id)}" ${model.id === item.modelId ? 'selected' : ''}>${e(type?.name || '')} · ${e(model.name)} (${e(model.code)})</option>`; }).join('')}</select><span class="form-help">새 모델은 장비 관리 상단의 모델 등록에서 준비하세요.</span></label><div class="equipment-model-preview small" data-model-preview></div>
    <div class="field-grid"><label class="field">보관 장소<input class="input" name="location" maxlength="200" value="${e(item.location)}" required></label><label class="field">담당 부서<input class="input" name="department" maxlength="100" value="${e(item.department || '')}"></label></div>
    <div class="field-grid"><label class="field">운영 상태<select class="input" name="status">${Object.entries(statusLabels).map(([code, label]) => `<option value="${code}" ${code === item.status ? 'selected' : ''}>${label}</option>`).join('')}</select></label><div><label class="check-row"><input name="lendAllowed" type="checkbox" ${item.lendAllowed ? 'checked' : ''}> 대여 허용</label><label class="check-row"><input name="isDemo" type="checkbox" ${item.isDemo ? 'checked' : ''}> 가상 자원</label><p class="small muted">실물·운영 정보 확인 전에는 가상 자원으로 등록하세요.</p></div></div>
    <section class="equipment-editor-section"><h3>기본 구성품</h3><p class="small muted">본체와 함께 전달할 구성품의 기준 수량을 입력하세요.</p>${existing && item.activeRequests > 0 ? '<p class="notice small">모델·기본 구성품을 수정하려면 진행 중인 신청의 처리를 먼저 완료해주세요.</p>' : ''}<div data-component-rows>${item.components.map(componentMarkup).join('')}</div><button type="button" class="btn btn-secondary" data-component-add>구성품 추가</button></section>
    <section class="equipment-editor-section"><h3>운영 변경 확인</h3>${existing ? `<p class="small muted">현재 진행 중인 신청 ${e(item.activeRequests || 0)}건 · ${item.hasHistory ? '신청 이력 있음' : '신청 이력 없음'}</p>` : ''}<label class="field">변경 사유<textarea class="input" name="reason" maxlength="500" rows="2" placeholder="운영 상태·대여 허용 여부를 바꿀 때 입력하세요."></textarea></label><label class="check-row"><input type="checkbox" name="confirmed">현재 장비와 진행 중인 신청에 미치는 영향을 확인했습니다.</label></section>
    ${errorsMarkup()}${actionsMarkup(existing ? '변경 저장' : '장비 등록')}
  </form>`, dialog => {
    const form = dialog.querySelector('form');
    const preview = () => {
      const model = models.find(entry => entry.id === form.elements.modelId.value);
      dialog.querySelector('[data-model-preview]').innerHTML = model ? `<p>제조사 ${e(model.manufacturer || '미입력')}</p>${model.specs.length ? `<ul>${model.specs.map(spec => `<li>${e(spec.name)} · ${e(spec.value || '')}${spec.unit ? ' ' + e(spec.unit) : ''} <span class="muted">${spec.verified ? '확인됨' : '미확인'}</span></li>`).join('')}</ul>` : '<p>등록된 사양이 없습니다.</p>'}` : '';
    };
    preview();
    form.elements.modelId.addEventListener('change', preview);
    bindComponents(dialog);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (dialog.dataset.busy === 'true') return;
      try {
        const changedOperation = existing && (form.elements.status.value !== item.status || form.elements.lendAllowed.checked !== item.lendAllowed);
        if (changedOperation && (!form.elements.reason.value.trim() || !form.elements.confirmed.checked)) throw new Error('운영 상태나 대여 허용 여부를 바꿀 때 변경 사유와 영향 확인을 입력해주세요.');
        const body = {modelId: form.elements.modelId.value, code: form.elements.code.value.trim(), name: form.elements.name.value.trim(), location: form.elements.location.value.trim(), department: form.elements.department.value.trim(), status: form.elements.status.value, lendAllowed: form.elements.lendAllowed.checked, isDemo: form.elements.isDemo.checked, components: readComponents(dialog), reason: form.elements.reason.value.trim(), confirmed: form.elements.confirmed.checked, ...(existing ? {expectedVersion: item.version} : {})};
        saveForm(container, dialog, existing ? `/api/admin/equipment/${encodeURIComponent(item.id)}` : '/api/admin/equipment', existing ? 'PUT' : 'POST', body, existing ? '장비 정보를 저장했습니다.' : '장비를 등록했습니다.');
      } catch (error) { setError(dialog, error.message); }
    });
  });
}

function openTypeEditor(container) {
  showEditor('장비 분류 등록', `<form data-equipment-type-form><label class="field">품목명<input class="input" name="name" maxlength="50" placeholder="예: 삼각대" required></label><label class="field">분류명<input class="input" name="category" maxlength="50" placeholder="예: 촬영 보조 장비" required></label>${errorsMarkup()}${actionsMarkup('분류 등록')}</form>`, dialog => {
    const form = dialog.querySelector('form');
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (dialog.dataset.busy === 'true') return;
      saveForm(container, dialog, '/api/admin/equipment/types', 'POST', {name: form.elements.name.value.trim(), category: form.elements.category.value.trim()}, '장비 분류를 등록했습니다.');
    });
  });
}

function specMarkup(spec = {}) {
  return `<fieldset class="equipment-spec-row"><legend>모델 사양</legend><div class="equipment-spec-fields"><label class="field">사양명<input class="input" data-spec-name maxlength="100" value="${e(spec.name || '')}" required></label><label class="field">사양값<input class="input" data-spec-value maxlength="300" value="${e(spec.value || '')}" required></label><label class="field">단위<input class="input" data-spec-unit maxlength="30" value="${e(spec.unit || '')}"></label></div><div class="equipment-component-options"><label><input type="checkbox" data-spec-verified ${spec.verified ? 'checked' : ''}> 실제 사양 확인</label><button class="btn btn-quiet" type="button" data-spec-remove>사양 제거</button></div></fieldset>`;
}

function openModelEditor(container) {
  showEditor('장비 모델 등록', `<form data-equipment-model-form><label class="field">장비 분류<select class="input" name="typeId" required><option value="">분류 선택</option>${management.data.types.filter(type => type.enabled).map(type => `<option value="${e(type.id)}">${e(type.name)} · ${e(type.category)}</option>`).join('')}</select></label><div class="field-grid"><label class="field">모델 코드<input class="input" name="code" maxlength="30" required></label><label class="field">모델명<input class="input" name="name" maxlength="100" required></label></div><label class="field">제조사<input class="input" name="manufacturer" maxlength="100"></label><label class="check-row"><input name="isDemo" type="checkbox" checked> 가상 모델</label><p class="small muted">확인한 실물 정보가 준비되면 실제 모델로 등록하세요.</p><section class="equipment-editor-section"><h3>모델 사양</h3><div data-spec-rows></div><button class="btn btn-secondary" type="button" data-spec-add>사양 추가</button></section>${errorsMarkup()}${actionsMarkup('모델 등록')}</form>`, dialog => {
    const form = dialog.querySelector('form');
    const rows = dialog.querySelector('[data-spec-rows]');
    dialog.querySelector('[data-spec-add]').addEventListener('click', () => {
      rows.insertAdjacentHTML('beforeend', specMarkup());
      rows.lastElementChild.querySelector('input').focus();
    });
    rows.addEventListener('click', event => { if (event.target.closest('[data-spec-remove]')) event.target.closest('.equipment-spec-row').remove(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (dialog.dataset.busy === 'true') return;
      const specs = [...rows.querySelectorAll('.equipment-spec-row')].map(row => ({name: row.querySelector('[data-spec-name]').value.trim(), value: row.querySelector('[data-spec-value]').value.trim(), unit: row.querySelector('[data-spec-unit]').value.trim(), verified: row.querySelector('[data-spec-verified]').checked}));
      if (new Set(specs.map(spec => spec.name)).size !== specs.length) return setError(dialog, '모델 사양 이름은 서로 다르게 입력해주세요.');
      saveForm(container, dialog, '/api/admin/equipment/models', 'POST', {typeId: form.elements.typeId.value, code: form.elements.code.value.trim(), name: form.elements.name.value.trim(), manufacturer: form.elements.manufacturer.value.trim(), isDemo: form.elements.isDemo.checked, specs}, '장비 모델을 등록했습니다.');
    });
  });
}
