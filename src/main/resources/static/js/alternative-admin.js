import {serverMode} from './data.js';
import {getState, requestApi, refreshRecords, subscribe} from './store.js';
import {openAuthDialog} from './account.js';
import {escapeHTML as e, openDialog, notify} from './ui.js';

const apiPath = '/api/admin/equipment-alternatives';
const statusLabels = {NORMAL: '정상', CHECKING: '점검', DISABLED: '사용 중지'};
const management = {ownerId: null, data: null, loading: false, error: '', request: 0};
const filters = {query: '', typeId: '', status: 'ALL'};
const disabledControls = new WeakMap();
let editor = null;

subscribe(({user}) => {
  if (management.ownerId && (user?.role !== 'admin' || user.id !== management.ownerId)) resetManagement(null);
});

function leaveManagement() {
  if (location.pathname.replace(/\/$/, '') !== '/admin/alternatives') resetManagement(management.ownerId);
}

window.addEventListener('popstate', leaveManagement);
window.addEventListener('campus:navigate', leaveManagement);

function authorizedOwner(ownerId) {
  const user = getState().user;
  return user?.role === 'admin' && user.id === ownerId;
}

function visiblePage(container, ownerId = management.ownerId) {
  return container.isConnected && location.pathname.replace(/\/$/, '') === '/admin/alternatives' && authorizedOwner(ownerId);
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

export function renderAlternativeAdmin(container) {
  const user = getState().user;
  if (!serverMode || user?.role !== 'admin') {
    resetManagement(null);
    const title = !serverMode ? '개발 서버에서 대체 장비를 관리하세요.' : user ? '관리자 권한이 필요합니다.' : '관리자 로그인이 필요합니다.';
    container.innerHTML = `<section class="page-shell"><div class="panel empty-state"><h1>${title}</h1><p>대체 장비 관계의 등록과 수정은 관리자 계정으로 이용할 수 있습니다.</p><div class="button-row">${serverMode && !user ? '<button class="btn btn-primary" data-alternative-login>로그인</button>' : ''}<a class="btn btn-secondary" href="/" data-link>홈으로</a></div></div></section>`;
    container.querySelector('[data-alternative-login]')?.addEventListener('click', () => openAuthDialog());
    return;
  }
  if (management.ownerId !== user.id) resetManagement(user.id);
  container.innerHTML = `<section class="page-shell alternative-management">
    <nav class="tabs" aria-label="관리자 메뉴"><a href="/admin" data-link>신청 관리</a><a href="/admin/equipment" data-link>장비 관리</a><a href="/admin/facilities" data-link>시설 관리</a><a href="/admin/alternatives" data-link aria-current="page">대체 장비 관리</a></nav>
    <header class="alternative-management-heading"><div class="page-heading"><p class="eyebrow">CampusRent · 관리자</p><h1>대체 장비 관계 관리</h1><p class="muted">원본 장비를 선택하고 대체 대상과 지정 이유, 주요 차이를 관리하세요.</p></div><button class="btn btn-secondary" data-alternative-refresh ${management.loading ? 'disabled' : ''}>새로고침</button></header>
    <p class="notice">관계는 원본 → 대상 방향으로 적용됩니다. 반대 방향은 별도로 지정하며, 실제 신청의 이용 가능 여부는 운영 상태와 대여 기간을 함께 확인합니다.</p>
    <section data-alternative-content aria-live="polite" aria-busy="${management.loading}"></section>
  </section>`;
  container.querySelector('[data-alternative-refresh]').addEventListener('click', () => loadManagement(container));
  const content = container.querySelector('[data-alternative-content]');
  if (management.loading) {
    content.innerHTML = '<p class="panel" role="status">장비와 대체 관계를 불러오고 있습니다…</p>';
  } else if (management.error) {
    content.innerHTML = `<div class="panel empty-state"><h2>대체 장비 관계를 불러오지 못했습니다.</h2><p>${e(management.error)}</p><button class="btn btn-primary" data-alternative-retry>다시 시도</button></div>`;
    content.querySelector('[data-alternative-retry]').addEventListener('click', () => loadManagement(container));
  } else if (management.data) {
    renderFilters(container);
  } else {
    loadManagement(container);
  }
}

function validSnapshot(result) {
  return Array.isArray(result?.equipment) && Array.isArray(result?.alternatives);
}

async function loadManagement(container) {
  const ownerId = management.ownerId;
  if (!authorizedOwner(ownerId)) return;
  const request = ++management.request;
  management.loading = true;
  management.error = '';
  if (visiblePage(container, ownerId)) renderAlternativeAdmin(container);
  try {
    const result = await requestApi(apiPath);
    if (!validSnapshot(result)) throw new Error('장비와 대체 관계 응답을 확인해주세요.');
    if (request !== management.request || !authorizedOwner(ownerId)) return;
    management.data = result;
    if (filters.typeId && !result.equipment.some(item => item.typeId === filters.typeId)) filters.typeId = '';
  } catch (error) {
    if (request !== management.request || !authorizedOwner(ownerId)) return;
    management.error = error.message || '잠시 후 다시 조회해주세요.';
  } finally {
    if (request === management.request && authorizedOwner(ownerId)) {
      management.loading = false;
      if (visiblePage(container, ownerId)) renderAlternativeAdmin(container);
    }
  }
}

function renderFilters(container) {
  const types = new Map(management.data.equipment.map(item => [item.typeId, item.typeName]));
  const content = container.querySelector('[data-alternative-content]');
  content.innerHTML = `<section class="panel alternative-management-filters"><label class="field">원본 장비 검색<input type="search" class="input" name="alternative-query" placeholder="장비명, 관리번호, 모델" value="${e(filters.query)}"></label><label class="field">분류<select class="input" name="alternative-type-filter"><option value="">전체 분류</option>${[...types].map(([id, name]) => `<option value="${e(id)}" ${filters.typeId === id ? 'selected' : ''}>${e(name)}</option>`).join('')}</select></label><label class="field">원본 운영 상태<select class="input" name="alternative-status-filter"><option value="ALL">전체 상태</option>${Object.entries(statusLabels).map(([code, label]) => `<option value="${code}" ${filters.status === code ? 'selected' : ''}>${label}</option>`).join('')}<option value="NOT_ALLOWED" ${filters.status === 'NOT_ALLOWED' ? 'selected' : ''}>대여 불허</option></select></label></section><div data-alternative-list></div>`;
  content.querySelector('[name=alternative-query]').addEventListener('input', event => { filters.query = event.target.value; renderList(container); });
  content.querySelector('[name=alternative-type-filter]').addEventListener('change', event => { filters.typeId = event.target.value; renderList(container); });
  content.querySelector('[name=alternative-status-filter]').addEventListener('change', event => { filters.status = event.target.value; renderList(container); });
  renderList(container);
}

function searchText(item) {
  return `${item.name} ${item.code} ${item.modelName} ${item.typeName}`.toLocaleLowerCase('ko-KR');
}

function statusMarkup(item) {
  const statusClass = item.status === 'NORMAL' ? 'status-success' : item.status === 'CHECKING' ? 'status-warning' : 'status-muted';
  return `<span class="status ${statusClass}">${e(statusLabels[item.status] || item.status)}</span>`;
}

function renderList(container) {
  const {equipment, alternatives} = management.data;
  const query = filters.query.trim().toLocaleLowerCase('ko-KR');
  const visible = equipment.filter(item => (!query || searchText(item).includes(query)) && (!filters.typeId || item.typeId === filters.typeId) && (filters.status === 'ALL' || (filters.status === 'NOT_ALLOWED' ? !item.lendAllowed : item.status === filters.status)));
  const list = container.querySelector('[data-alternative-list]');
  list.innerHTML = `<p class="alternative-management-count small muted">원본 장비 ${visible.length}개 · 전체 ${equipment.length}개</p>${visible.length ? `<div class="alternative-management-grid">${visible.map(item => {
    const relations = alternatives.filter(relation => relation.sourceId === item.id);
    const enabled = relations.filter(relation => relation.enabled);
    const targets = enabled.map(relation => equipment.find(target => target.id === relation.targetId));
    return `<article class="panel alternative-management-card" data-alternative-source="${e(item.id)}"><div class="alternative-management-card-heading"><div><p class="small muted">${e(item.typeName)} · ${e(item.code)}</p><h2>${e(item.name)}</h2></div>${statusMarkup(item)}</div><dl class="alternative-management-details"><div><dt>모델</dt><dd>${e(item.modelName)}</dd></div><div><dt>대여</dt><dd>${item.lendAllowed ? '허용' : '불허'}</dd></div><div><dt>대체 관계</dt><dd>사용 ${enabled.length}개 · 비활성 ${relations.length - enabled.length}개</dd></div><div><dt>대체 대상</dt><dd>${targets.length ? e(targets.map(target => target ? `${target.name} (${target.code})` : '장비 확인 필요').join(' · ')) : '지정된 사용 관계 없음'}</dd></div></dl><p class="small muted">${item.isDemo ? '가상 장비' : '실제 장비'} · 원본에서 대상으로 적용</p><button class="btn btn-secondary" data-edit-alternatives="${e(item.id)}">대체 관계 편집</button></article>`;
  }).join('')}</div>` : `<section class="panel empty-state"><h2>${equipment.length ? '검색 조건에 맞는 원본 장비가 없습니다.' : '등록된 장비가 없습니다.'}</h2><p>${equipment.length ? '검색어와 필터를 확인해주세요.' : '장비 관리에서 원본과 대체 대상 장비를 먼저 등록하세요.'}</p>${equipment.length ? '' : '<a href="/admin/equipment" data-link class="btn btn-secondary">장비 관리</a>'}</section>`}`;
  list.querySelectorAll('[data-edit-alternatives]').forEach(button => button.addEventListener('click', () => {
    const source = equipment.find(item => item.id === button.dataset.editAlternatives);
    if (source) openRelationEditor(container, source);
  }));
}

function showEditor(container, title, html, onMount) {
  if (!visiblePage(container)) return;
  const opener = document.activeElement;
  editor?.close();
  const dialog = openDialog(title, html);
  editor = dialog;
  dialog.classList.add('alternative-editor');
  dialog.addEventListener('close', () => {
    if (editor === dialog) editor = null;
    if (!opener?.isConnected && visiblePage(container)) container.querySelector('[data-alternative-refresh]')?.focus({preventScroll: true});
  }, {once: true});
  onMount(dialog);
}

function errorsMarkup() {
  return '<p class="error-text" role="alert" tabindex="-1" data-alternative-error></p><p class="small muted" role="status" data-alternative-save-status></p><div data-alternative-conflict hidden><p class="form-help">입력 내용은 유지되어 있습니다. 최신 정보를 다시 불러오면 작성 중인 내용이 초기화됩니다.</p><button type="button" class="btn btn-secondary" data-alternative-reload>최신 정보 다시 불러오기</button></div>';
}

function setError(dialog, message) {
  const node = dialog.querySelector('[data-alternative-error]');
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

function relationMarkup(source, relation, existing = true) {
  const target = management.data.equipment.find(item => item.id === relation.targetId);
  return `<fieldset class="alternative-relation-row" data-alternative-target-id="${e(relation.targetId)}"><legend>대체 대상</legend><div class="alternative-relation-heading"><div><p class="small muted">${e(source.code)} → ${e(target?.code || relation.targetId)}</p><h3>${e(target?.name || '장비 확인 필요')}</h3></div>${target ? statusMarkup(target) : '<span class="status status-warning">확인 필요</span>'}</div><p class="small muted alternative-target-summary">${e(target?.typeName || '')} · ${e(target?.modelName || '')} · 대여 ${target?.lendAllowed ? '허용' : '불허'}</p><label class="check-row"><input type="checkbox" data-alternative-enabled ${relation.enabled ? 'checked' : ''}> 이 원본의 대체 관계로 사용</label><label class="field">지정 이유 (필수)<textarea class="input" data-alternative-reason maxlength="500" rows="2" required>${e(relation.reason || '')}</textarea></label><label class="field">주요 차이 (선택)<textarea class="input" data-alternative-difference maxlength="1000" rows="2">${e(relation.difference || '')}</textarea></label>${existing ? '<p class="form-help">사용을 해제하면 지정 이유와 차이를 보존한 채 관계를 비활성화합니다.</p>' : '<button type="button" class="btn btn-quiet" data-alternative-remove-draft>추가 취소</button>'}</fieldset>`;
}

function openRelationEditor(container, source) {
  const relations = management.data.alternatives.filter(relation => relation.sourceId === source.id);
  showEditor(container, '대체 장비 관계 편집', `<form data-alternative-form><div class="alternative-source-summary"><div><p class="small muted">원본 장비 · ${e(source.code)}</p><h3>${e(source.name)}</h3><p class="small muted">${e(source.typeName)} · ${e(source.modelName)} · 대여 ${source.lendAllowed ? '허용' : '불허'}</p></div>${statusMarkup(source)}</div><p class="notice small">이 원본 → 아래 대상 방향의 관계를 저장합니다. 반대 방향은 대상 장비를 원본으로 선택해 별도로 설정하세요. 점검·사용 중지 장비도 관계를 편집할 수 있으며, 실제 신청 시 이용 가능 여부를 다시 확인합니다.</p><section class="alternative-add-section"><h3>대체 대상 추가</h3><label class="field">대상 장비 검색<input type="search" class="input" data-alternative-target-query placeholder="장비명, 관리번호, 모델"></label><div class="alternative-add-controls"><label class="field">대상 장비<select class="input" data-alternative-target><option value="">대상 장비 선택</option></select></label><button type="button" class="btn btn-secondary" data-alternative-add disabled>대상 추가</button></div><p class="form-help" data-alternative-target-count></p></section><section class="alternative-relation-section"><h3>지정된 대체 대상</h3><p class="muted alternative-relation-empty" data-alternative-empty ${relations.length ? 'hidden' : ''}>지정된 관계가 없습니다. 위에서 대체 대상을 추가하세요.</p><div data-alternative-rows>${relations.map(relation => relationMarkup(source, relation)).join('')}</div></section>${errorsMarkup()}<div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-dialog>돌아가기</button><button type="submit" class="btn btn-primary" data-alternative-save>관계 저장</button></div></form>`, dialog => {
    const form = dialog.querySelector('form');
    const rows = dialog.querySelector('[data-alternative-rows]');
    const queryInput = dialog.querySelector('[data-alternative-target-query]');
    const targetSelect = dialog.querySelector('[data-alternative-target]');
    const addButton = dialog.querySelector('[data-alternative-add]');
    const renderTargets = () => {
      const selected = targetSelect.value;
      const assigned = new Set([...rows.querySelectorAll('[data-alternative-target-id]')].map(row => row.dataset.alternativeTargetId));
      const query = queryInput.value.trim().toLocaleLowerCase('ko-KR');
      const available = management.data.equipment.filter(item => item.id !== source.id && !assigned.has(item.id) && (!query || searchText(item).includes(query)));
      targetSelect.innerHTML = `<option value="">${available.length ? '대상 장비 선택' : '추가할 수 있는 장비가 없습니다'}</option>${available.map(item => `<option value="${e(item.id)}">${e(item.name)} (${e(item.code)}) · ${e(statusLabels[item.status] || item.status)}${item.lendAllowed ? '' : ' · 대여 불허'}</option>`).join('')}`;
      if (available.some(item => item.id === selected)) targetSelect.value = selected;
      targetSelect.disabled = !available.length;
      addButton.disabled = !targetSelect.value;
      dialog.querySelector('[data-alternative-target-count]').textContent = `추가 가능한 대상 ${available.length}개 · 원본 자신과 이미 지정된 대상은 제외됩니다.`;
      dialog.querySelector('[data-alternative-empty]').hidden = rows.children.length > 0;
    };
    queryInput.addEventListener('input', renderTargets);
    queryInput.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!targetSelect.disabled) targetSelect.focus();
    });
    targetSelect.addEventListener('change', () => { addButton.disabled = !targetSelect.value; });
    addButton.addEventListener('click', () => {
      const targetId = targetSelect.value;
      if (!targetId || targetId === source.id || [...rows.children].some(row => row.dataset.alternativeTargetId === targetId)) return;
      if (rows.children.length >= 999) return setError(dialog, '대체 대상은 999개까지 지정할 수 있습니다.');
      rows.insertAdjacentHTML('beforeend', relationMarkup(source, {targetId, reason: '', difference: '', enabled: true}, false));
      renderTargets();
      rows.lastElementChild.querySelector('[data-alternative-reason]').focus();
    });
    rows.addEventListener('click', event => {
      const remove = event.target.closest('[data-alternative-remove-draft]');
      if (!remove) return;
      remove.closest('[data-alternative-target-id]').remove();
      renderTargets();
      (targetSelect.disabled ? queryInput : targetSelect).focus();
    });
    renderTargets();
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (dialog.dataset.busy === 'true') return;
      try {
        const alternatives = [...rows.querySelectorAll('[data-alternative-target-id]')].map(row => ({targetId: row.dataset.alternativeTargetId, reason: row.querySelector('[data-alternative-reason]').value.trim(), difference: row.querySelector('[data-alternative-difference]').value.trim(), enabled: row.querySelector('[data-alternative-enabled]').checked}));
        if (alternatives.length > 999) throw new Error('대체 대상은 999개까지 지정할 수 있습니다.');
        if (alternatives.some(relation => !relation.reason)) throw new Error('각 대체 관계의 지정 이유를 입력해주세요.');
        if (alternatives.some(relation => relation.targetId === source.id) || new Set(alternatives.map(relation => relation.targetId)).size !== alternatives.length) throw new Error('자기 자신 또는 중복된 대체 대상은 지정할 수 없습니다.');
        saveRelations(container, dialog, source.id, {expectedVersion: source.version, alternatives});
      } catch (error) { setError(dialog, error.message); }
    });
  });
}

async function saveRelations(container, dialog, sourceId, body) {
  const ownerId = management.ownerId;
  if (!visiblePage(container, ownerId)) { dialog.close(); return; }
  setError(dialog, '');
  dialog.querySelector('[data-alternative-conflict]').hidden = true;
  dialog.querySelector('[data-alternative-save-status]').textContent = '대체 관계를 저장하고 있습니다…';
  setBusy(dialog, true);
  let saved = false;
  try {
    const result = await requestApi(`${apiPath}/${encodeURIComponent(sourceId)}`, {method: 'PUT', body});
    saved = true;
    if (!authorizedOwner(ownerId)) return;
    if (validSnapshot(result)) management.data = result;
    if (!visiblePage(container, ownerId)) return;
    dialog.querySelector('[data-alternative-save-status]').textContent = '저장했습니다. 최신 목록을 확인하고 있습니다.';
    await loadManagement(container);
    await refreshRecords();
    if (!visiblePage(container, ownerId)) return;
    dialog.close();
    notify(management.error ? '대체 관계를 저장했습니다. 목록은 새로고침으로 다시 확인해주세요.' : '대체 장비 관계를 저장했습니다.');
  } catch (error) {
    if (!visiblePage(container, ownerId) || !dialog.isConnected) return;
    if (saved) {
      dialog.close();
      notify('대체 관계를 저장했습니다. 최신 조회를 완료하지 못했으니 새로고침해 확인해주세요.');
      return;
    }
    setBusy(dialog, false);
    dialog.querySelector('[data-alternative-save-status]').textContent = '';
    setError(dialog, error.message || '대체 관계를 저장하지 못했습니다. 입력 내용을 확인해주세요.');
    if (error.status === 409) {
      dialog.querySelector('[data-alternative-conflict]').hidden = false;
      dialog.querySelector('[data-alternative-reload]').onclick = async () => { dialog.close(); await loadManagement(container); };
    }
  }
}
