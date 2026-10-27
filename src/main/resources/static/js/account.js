import { resources } from './data.js';
import { getState, login, signup, logout, processItem, refreshRecords } from './store.js';
import { escapeHTML, formatDate, formatSchedule, openDialog, notify, navigate } from './ui.js';

const e = escapeHTML;
const adminFilters = { kind: '전체', status: '전체', query: '' };
const authDraft = { name: '', email: '' };
const statuses = ['승인 대기', '승인·수령 대기', '예약 승인', '대여 중', '이용 중', '반납 신청', '반납 보류', '반납 완료', '이용 완료', '거절', '신청 취소 완료'];
let authDialog = null;

export function renderAccountMenu(container) {
  const { user } = getState();
  if (!user) {
    container.innerHTML = '<button type="button" class="btn btn-primary" data-login>로그인</button>';
    container.querySelector('[data-login]').addEventListener('click', () => openAuthDialog());
    return;
  }
  const admin = user.role === 'admin';
  container.innerHTML = `<div class="account-menu">
    <a class="btn btn-secondary" href="${admin ? '/admin' : '/records'}" data-account-route>${admin ? '신청 관리' : '내 신청'}</a>
    <details class="account-dropdown"><summary class="btn btn-secondary profile-summary">${e(user.name)} · ${admin ? '관리자' : '학생'} <span aria-hidden="true">⌄</span></summary>
      <div class="account-dropdown-content panel"><p class="small muted">${e(user.email)}</p>
        ${!admin ? '<a href="/history" class="btn btn-quiet" data-account-route>과거 신청 내역</a>' : ''}
        <button type="button" class="btn btn-quiet" data-logout>로그아웃</button>
      </div>
    </details></div>`;
  container.querySelectorAll('[data-account-route]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    navigate(link.getAttribute('href'));
  }));
  container.querySelector('[data-logout]').addEventListener('click', async () => {
    try {
      await logout();
      if (authDialog?.open) authDialog.close();
      notify('로그아웃했습니다.');
    } catch (error) { notify(error.message); }
  });
}

export function openAuthDialog(reason = 'header') {
  reason = typeof reason === 'object' ? reason?.reason || 'header' : reason;
  if (authDialog?.open) { authDialog.querySelector('input')?.focus(); return authDialog; }
  let registering = false;
  let busy = false;
  const description = reason === 'request'
    ? '선택한 항목을 그대로 이어서 신청하세요.'
    : reason === 'records' ? '로그인하고 내 시연 신청을 확인하세요.' : '로그인하고 CampusRent를 이용하세요.';
  const dialog = openDialog('CampusRent에 로그인', '<div data-auth-content></div>', () => {});
  authDialog = dialog;
  dialog.classList.add('auth-dialog');
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  const host = dialog.querySelector('[data-auth-content]');
  const render = (message = '') => {
    host.innerHTML = `<p class="muted">${description}</p>
      <p class="info-banner small">시연용 계정입니다. 실제 학교 계정으로 로그인할 수 없습니다. 새로고침하면 로그인과 새로 만든 시연 계정이 초기화됩니다.</p>
      <form data-auth-form novalidate>
        ${registering ? `<label class="field" for="auth-name">이름<input class="input" id="auth-name" name="name" autocomplete="name" value="${e(authDraft.name)}" required><span class="form-error small" data-error="name"></span></label>` : ''}
        <label class="field" for="auth-email">이메일<input class="input" id="auth-email" name="email" type="email" inputmode="email" autocomplete="email" value="${e(authDraft.email)}" required><span class="form-error small" data-error="email"></span></label>
        <label class="field" for="auth-password">비밀번호<span class="password-wrap"><input class="input" id="auth-password" name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" required><button class="btn btn-quiet password-toggle" type="button" aria-label="비밀번호 보기" data-password-toggle>보기</button></span>
          ${registering ? '<span class="small muted">8자 이상, 영문과 숫자를 포함해주세요.</span>' : ''}<span class="form-error small" data-error="password"></span></label>
        <p class="form-error small" role="alert" data-auth-error></p>
        <button class="btn btn-primary btn-block" type="submit">${registering ? '시연 프로필 만들기' : '로그인'}</button>
      </form>
      <button class="btn btn-quiet auth-switch" type="button" data-auth-switch>${registering ? '이미 계정이 있나요? 로그인' : '계정이 없나요? 회원가입'}</button>
      <p class="small muted" role="status">${e(message)}</p>
      ${!registering ? `<details class="demo-accounts"><summary>시연 계정 안내</summary><p class="small muted">학생: demo@campusrent.example<br>다른 학생: other@campusrent.example<br>학생 비밀번호: Campus123!<br>관리자: admin@campusrent.example<br>관리자 비밀번호: CampusAdmin123!<br>관리자 역할은 준비된 가상 계정에만 부여됩니다.</p></details>` : ''}`;
    const form = host.querySelector('form');
    form.querySelectorAll('input').forEach(input => input.addEventListener('input', () => {
      if (input.name !== 'password') authDraft[input.name] = input.value;
      input.removeAttribute('aria-invalid');
      const messageNode = form.querySelector(`[data-error="${input.name}"]`);
      if (messageNode) messageNode.textContent = '';
    }));
    host.querySelector('[data-password-toggle]').addEventListener('click', event => {
      const password = form.elements.password;
      const visible = password.type === 'password';
      password.type = visible ? 'text' : 'password';
      event.currentTarget.textContent = visible ? '숨기기' : '보기';
      event.currentTarget.setAttribute('aria-label', visible ? '비밀번호 숨기기' : '비밀번호 보기');
    });
    host.querySelector('[data-auth-switch]').addEventListener('click', () => {
      if (busy) return;
      authDraft.email = form.elements.email.value;
      if (form.elements.name) authDraft.name = form.elements.name.value;
      registering = !registering;
      const heading = dialog.querySelector('h2');
      if (heading) heading.textContent = registering ? 'CampusRent에 회원가입' : 'CampusRent에 로그인';
      render(`${registering ? '회원가입' : '로그인'}으로 전환했습니다. 이메일은 유지됩니다.`);
      host.querySelector(registering ? '#auth-name' : '#auth-email')?.focus();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const fields = { name: String(form.elements.name?.value || '').trim(), email: form.elements.email.value.trim(), password: form.elements.password.value };
      authDraft.name = fields.name || authDraft.name;
      authDraft.email = fields.email;
      const errors = {};
      if (registering && !fields.name) errors.name = '이름을 입력해주세요.';
      if (!fields.email) errors.email = '이메일을 입력해주세요.';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) errors.email = '올바른 이메일 형식으로 입력해주세요.';
      if (!fields.password) errors.password = '비밀번호를 입력해주세요.';
      else if (registering && (fields.password.length < 8 || !/[a-z]/i.test(fields.password) || !/\d/.test(fields.password))) errors.password = '8자 이상, 영문과 숫자를 포함해주세요.';
      for (const name of ['name', 'email', 'password']) {
        const node = form.querySelector(`[data-error="${name}"]`);
        if (node) node.textContent = errors[name] || '';
        if (form.elements[name]) {
          form.elements[name].setAttribute('aria-invalid', errors[name] ? 'true' : 'false');
          form.elements[name].setAttribute('aria-describedby', `auth-${name}-error`);
          if (node) node.id = `auth-${name}-error`;
        }
      }
      const first = Object.keys(errors)[0];
      if (first) { form.elements[first]?.focus(); return; }
      busy = true;
      dialog.dataset.busy = 'true';
      dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = true; });
      const button = form.querySelector('[type="submit"]');
      button.textContent = '처리 중…';
      host.querySelectorAll('input, button').forEach(input => { input.disabled = true; });
      try {
        const user = registering ? await signup(fields) : await login(fields.email, fields.password);
        form.elements.password.value = '';
        if (dialog.open) dialog.close();
        notify(`${user?.name || getState().user?.name || '사용자'}님, 로그인했습니다.`);
        window.dispatchEvent(new CustomEvent('campus:authenticated', { detail: { reason, user: user || getState().user } }));
      } catch (error) {
        if (dialog.open) {
          form.querySelector('[data-auth-error]').textContent = error.message || '인증을 완료하지 못했습니다. 다시 시도해주세요.';
          form.elements.password.value = '';
          host.querySelectorAll('input, button').forEach(input => { input.disabled = false; });
          button.textContent = registering ? '시연 프로필 만들기' : '로그인';
          form.elements.password.focus();
        }
      } finally {
        busy = false;
        dialog.dataset.busy = 'false';
        dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = false; });
      }
    });
  };
  dialog.addEventListener('close', () => { authDialog = null; host.querySelectorAll('[name="password"]').forEach(input => { input.value = ''; }); }, { once: true });
  render();
  host.querySelector('#auth-email')?.focus();
  return dialog;
}

function badgeClass(status) {
  if (['거절', '반납 보류'].includes(status)) return 'status status-warning';
  if (['반납 완료', '이용 완료'].includes(status)) return 'status status-success';
  if (status === '신청 취소 완료') return 'status status-muted';
  return 'status';
}

function entryActions(item) {
  if (item.status === '승인 대기') return [['approve', '승인'], ['reject', '거절']];
  if (item.status === '승인·수령 대기') return [['checkout', '수령 확인']];
  if (item.status === '예약 승인') return [['start', '이용 시작 확인']];
  if (item.status === '반납 신청') return [['return', '반납 검수']];
  if (item.status === '반납 보류') return [['return-extra', '추가 반환 재확인']];
  if (item.status === '이용 중' && item.kind === '시설') return [['finish', '이용 종료 확인']];
  return [];
}

function entries() {
  return getState().records.flatMap(record => record.items.map((item, index) => ({ record, item, index })))
    .sort((a, b) => new Date(b.record.createdAt) - new Date(a.record.createdAt));
}

export function renderAdminPage(container, params = new URLSearchParams()) {
  const { user } = getState();
  if (!user || user.role !== 'admin') {
    container.innerHTML = `<section class="page-shell"><section class="panel empty-state"><h1>${!user ? '관리자 로그인이 필요합니다.' : '접근할 수 없습니다.'}</h1>
      <p class="muted">${!user ? '관리자 내용은 인증된 시연 관리자 계정에만 표시됩니다.' : '학생 계정에는 관리자 처리 권한이 없습니다.'}</p>
      <div class="admin-actions">${!user ? '<button type="button" class="btn btn-primary" data-admin-login>로그인</button>' : ''}<a class="btn btn-secondary" href="/" data-home>학생 홈으로 돌아가기</a></div></section></section>`;
    container.querySelector('[data-admin-login]')?.addEventListener('click', () => openAuthDialog());
    container.querySelector('[data-home]').addEventListener('click', event => { event.preventDefault(); navigate('/'); });
    return;
  }
  const all = entries();
  const pending = all.filter(entry => entry.item.status === '승인 대기').length;
  const returning = all.filter(entry => entry.item.status === '반납 신청').length;
  container.innerHTML = `<section class="page-shell admin-page">
    <div class="admin-heading"><div class="page-heading"><p class="eyebrow">CampusRent · 관리자</p><h1>시설·장비 신청 관리</h1><p class="muted">개별 신청의 승인부터 실제 수령·반납 및 시설 이용 확인까지, 한 화면에서 처리하세요.</p></div>
      <button class="btn btn-secondary" type="button" data-admin-refresh>최신 내역 새로고침</button></div>
    <p class="info-banner small">가상 시설·장비로 구성한 화면 시연입니다. 실제 학교의 신청·재고와 연결되지 않습니다. 학생 화면에서 접수한 항목의 처리 흐름을 확인할 수 있습니다.</p>
    <section class="admin-stats"><div class="panel stat-card"><p class="muted">처리할 승인 대기</p><strong>${pending}<span class="small muted"> 건</span></strong></div><div class="panel stat-card"><p class="muted">장비 반납 신청</p><strong>${returning}<span class="small muted"> 건</span></strong></div></section>
    <section class="panel admin-filter-panel"><div class="tabs" aria-label="자원 종류">${['전체', '장비', '시설'].map(kind => `<button type="button" class="chip ${adminFilters.kind === kind ? 'chip-active' : ''}" aria-pressed="${adminFilters.kind === kind}" data-admin-kind="${kind}">${kind}</button>`).join('')}</div>
      <div class="field-grid"><label class="field">신청 검색<input class="input" data-admin-search aria-label="관리자 신청 검색" placeholder="신청 번호, 자원명, 관리번호 또는 신청자 ID" value="${e(adminFilters.query)}"></label>
        <label class="field">상태 필터<select class="input" data-admin-status aria-label="관리자 상태 필터"><option value="전체">전체</option>${statuses.map(status => `<option value="${e(status)}" ${adminFilters.status === status ? 'selected' : ''}>${e(status)}</option>`).join('')}</select></label></div></section>
    <section data-admin-results aria-label="관리자 신청 목록"></section>
  </section>`;
  const renderList = () => {
    const visible = entries().filter(({ record, item, index }) =>
      (adminFilters.kind === '전체' || item.kind === adminFilters.kind) &&
      (adminFilters.status === '전체' || item.status === adminFilters.status) &&
      `${record.number}-${index + 1} ${item.name} ${item.code || ''} ${record.userId} ${record.userName || ''}`.toLowerCase().includes(adminFilters.query.trim().toLowerCase()));
    const list = container.querySelector('[data-admin-results]');
    list.innerHTML = `<p class="small muted result-count">개별 신청 ${visible.length}건 · 최신 신청 순</p>${visible.length ? `<div class="admin-records">${visible.map(({ record, item, index }, position) => `<article class="panel record-card"><div class="admin-record-top"><div><p class="small muted">${e(item.kind)} · 항목 ${e(record.number)}-${e(item.originalIndex || index + 1)}</p><h2>${e(item.name)}</h2><p class="small muted">${e(item.code || resources.find(resource => resource.id === item.resourceId)?.code || '')} · 신청자 ${e(record.userName || record.userId)}</p></div><span class="${badgeClass(item.status)}">${e(item.status)}</span></div>
      <p>${e(formatSchedule(item.condition, item.kind))}</p><p class="small muted">신청 ${e(formatDate(record.createdAt))}</p>${item.reason ? `<p class="notice small">${e(item.reason)}</p>` : ''}
      <div class="admin-actions">${entryActions(item).map(([action, label]) => `<button type="button" class="btn ${action === 'reject' ? 'btn-secondary' : 'btn-primary'}" data-admin-action="${action}" data-entry="${position}">${label}</button>`).join('')}
      <button type="button" class="btn btn-secondary" data-admin-action="detail" data-entry="${position}">상세 확인</button></div></article>`).join('')}</div>` : `<div class="panel empty-state"><h2>${all.length ? '검색 조건에 맞는 신청이 없습니다.' : '접수된 신청이 없습니다.'}</h2><p class="muted">${all.length ? '검색어 또는 상태 필터를 변경해주세요.' : '학생 화면에서 장비·시설을 선택하고 신청하면 이곳에서 확인할 수 있습니다.'}</p><a href="/equipment" class="btn btn-secondary" data-student-equipment>장비 대여 화면으로</a></div>`}`;
    list.querySelector('[data-student-equipment]')?.addEventListener('click', event => { event.preventDefault(); navigate('/equipment'); });
    list.querySelectorAll('[data-admin-action]').forEach(button => button.addEventListener('click', () => {
      const entry = visible[Number(button.dataset.entry)];
      openAdminAction(entry.record.number, entry.item.id, button.dataset.adminAction);
    }));
  };
  container.querySelectorAll('[data-admin-kind]').forEach(button => button.addEventListener('click', () => {
    adminFilters.kind = button.dataset.adminKind;
    renderAdminPage(container, params);
  }));
  container.querySelector('[data-admin-search]').addEventListener('input', event => { adminFilters.query = event.target.value; renderList(); });
  container.querySelector('[data-admin-status]').addEventListener('change', event => { adminFilters.status = event.target.value; renderList(); });
  container.querySelector('[data-admin-refresh]').addEventListener('click', async event => {
    const trigger = event.currentTarget;
    trigger.disabled = true;
    try { await refreshRecords(); renderAdminPage(container, params); notify('현재 브라우저의 최신 신청 내역을 표시했습니다.'); }
    catch (error) { notify(error.message || '최신 내역을 읽지 못했습니다. 다시 시도해주세요.'); trigger.disabled = false; }
  });
  renderList();
}

function resourceDetails(item) {
  const resource = resources.find(entry => entry.id === item.resourceId) || item;
  return `<dl class="detail-list"><div><dt>관리번호</dt><dd>${e(resource.code || '')}</dd></div><div><dt>${item.kind === '시설' ? '위치' : '모델'}</dt><dd>${e(item.kind === '시설' ? resource.location || '' : resource.model || '')}</dd></div>
    ${item.kind === '시설' ? `<div><dt>수용 인원</dt><dd>${e(resource.capacity || '')}명</dd></div>` : ''}<div><dt>${item.kind === '시설' ? '비치 설비' : '기본 구성품'}</dt><dd>${e((resource.contents || []).join(' · '))}</dd></div></dl>`;
}

function inspectionSummary(item) {
  if (item.kind !== '장비') return '';
  const components = item.checkoutComponents || [];
  const rounds = item.inspections || [];
  if (!components.length) return '<p class="small muted">출고 검수 전입니다.</p>';
  return `<details class="modal-section inspection-summary"><summary>실제 출고 구성품·출고 기준 반환 확인</summary>
    <p class="small muted">출고 당시 보존한 기준입니다. 기본 구성품이 변경되어도 이 기록은 유지됩니다.</p>
    ${components.map(component => {
      const returned = Number(item.returnedComponents?.[component.componentId] || 0);
      const quantity = Number(component.quantity || component.requiredQuantity || 0);
      return `<div class="inspection-summary-row"><strong>${e(component.name)}${component.body ? ' · 본체' : ''}</strong><p class="small">등록 기준 ${e(component.requiredQuantity)}개 · 실제 전달 ${quantity}개 · ${component.required ? '필수' : '선택'} · 전달 시 ${e(component.condition)}</p>${rounds.length ? `<p class="small">확인된 반환 ${returned}개 · 부족 ${Math.max(0, quantity - returned)}개</p>` : ''}</div>`;
    }).join('')}
    ${rounds.map(round => `<details class="modal-section small"><summary>${e(round.round)}차 검수 · ${e(round.status)} · ${e(formatDate(round.at))}</summary><p>확인자 ${e(round.actor?.name || round.actor?.id || round.actor || '')} · ${e(round.reason || '전체 구성품 정상 반환 확인')}</p>${(round.components || []).map(row => `<p>${e(components.find(component => component.componentId === row.componentId)?.name || row.componentId)}: 이번 ${e(row.quantity)}개 · 누적 ${e(row.cumulativeQuantity)}개 · 부족 ${e(row.missingQuantity)}개 · ${e(row.condition)}</p>`).join('')}</details>`).join('')}
  </details>`;
}

function openAdminAction(number, id, action) {
  const entry = entries().find(entry => entry.record.number === number && entry.item.id === id);
  if (!entry || getState().user?.role !== 'admin') { notify('최신 신청과 관리자 로그인 상태를 확인해주세요.'); return; }
  const { record, item, index } = entry;
  const actionLabel = { approve: '승인', reject: '거절', checkout: '출고 검수 · 출고 구성품 정보 보존', return: '출고 기준 반환 확인 · 반납 검수', 'return-extra': '추가 반환 재확인', start: '이용 시작 확인', finish: '이용 종료 확인', 'maintenance-required': '점검 필요 등록', 'maintenance-done': '점검 완료 확인', detail: '선택 신청 확인' }[action];
  const maintenanceAction = ['maintenance-required', 'maintenance-done'].includes(action);
  const inspection = ['checkout', 'return', 'return-extra'].includes(action);
  const resource = resources.find(resource => resource.id === item.resourceId);
  const baseComponents = action === 'checkout' ? resource?.components || [] : item.checkoutComponents || [];
  const components = action === 'return-extra' ? baseComponents.filter(component => Number(item.returnedComponents?.[component.componentId] || 0) < Number(component.quantity || component.requiredQuantity)) : baseComponents;
  const equipmentState = getState().equipmentStates[item.resourceId];
  const maintenance = equipmentState === '점검' || equipmentState?.status === '점검';
  const explanation = action === 'approve' ? '이 항목의 최신 운영 조건과 예약 중복을 다시 확인하고 해당 기간을 확보합니다.'
    : action === 'reject' ? '필수 사유를 입력해 이 개별 신청만 거절합니다.'
    : action === 'checkout' ? '관리자가 실제 본체·구성품의 수량과 상태를 확인한 뒤 확정하세요.'
    : ['return', 'return-extra'].includes(action) ? '보존된 출고 기준을 사용합니다. 이번 반환 수량을 이전 확인 수량에 더해 계산하며 부족하면 반납 보류로 저장합니다.'
    : action === 'maintenance-done' ? '필수 구성품이 모두 반환되고 실제 점검을 마친 경우에만 장비 이용 제한을 해제합니다.'
    : action === 'maintenance-required' ? '실제 장비 상태를 확인하고 점검 사유를 기록하세요. 대여 건의 진행 상태와 장비 점검 상태는 별도로 관리합니다.'
    : '해당 시설의 실제 이용 시작·종료를 확인한 경우에만 처리하세요.';
  const dialog = openDialog(actionLabel, `<p class="eyebrow">${e(item.kind)} · 항목 ${e(record.number)}-${e(item.originalIndex || index + 1)}</p><h3>${e(item.name)}</h3><p class="small muted">신청자 ${e(record.userName || record.userId)}</p><p>${e(formatSchedule(item.condition, item.kind))}</p><span class="${badgeClass(item.status)}">${e(item.status)}</span>${item.reason ? `<p class="notice">${e(item.reason)}</p>` : ''}
    ${resourceDetails(item)}${inspectionSummary(item)}
    ${action === 'detail' ? `<div class="admin-actions">${entryActions(item).map(([next, label]) => `<button type="button" class="btn btn-primary" data-next-action="${next}">${label}</button>`).join('')}${item.kind === '장비' && !maintenance ? '<button type="button" class="btn btn-secondary" data-next-action="maintenance-required">점검 필요 등록</button>' : ''}${item.kind === '장비' && item.status === '반납 완료' && maintenance ? '<button type="button" class="btn btn-secondary" data-next-action="maintenance-done">점검 완료 확인</button>' : ''}</div>`
      : `<form data-process-form novalidate><p class="info-banner small">${explanation}</p>
      ${inspection ? `<div class="modal-section"><div class="admin-actions"><h4>구성품 실제 확인</h4><button class="btn btn-secondary" type="button" data-fill-inspection>${action === 'checkout' ? '전체 구성품 정상 전달 확인' : '전체 구성품 정상 반환 확인'}</button></div>${!components.length ? '<p class="form-error">보존된 구성품 정보를 확인할 수 없습니다. 이 항목은 처리할 수 없습니다.</p>' : components.map((component, position) => {
        const delivered = Number(component.quantity || component.requiredQuantity);
        const returned = Number(item.returnedComponents?.[component.componentId] || 0);
        return `<fieldset class="inspection-row" data-inspection-row="${position}"><legend>${e(component.name)}${component.body ? ' · 본체' : ''}</legend><p class="small muted">${action === 'checkout' ? `필수 기준 ${e(component.requiredQuantity)}개` : `실제 출고 ${delivered}개 · 이전 반환 ${returned}개 · 부족 ${Math.max(0, delivered - returned)}개`}</p><div class="inspection-grid"><label class="field">${action === 'checkout' ? '실제 전달 수량' : '이번 반환 수량'}<input class="input" type="number" name="quantity-${position}" min="0" max="${action === 'checkout' ? component.requiredQuantity : Math.max(0, delivered - returned)}" step="1" value="" inputmode="numeric" required></label><label class="field">상태<select class="input" name="condition-${position}" required><option value="">선택해주세요</option><option value="정상">정상</option><option value="손상">손상</option></select></label></div><label class="inspection-confirm"><input type="checkbox" name="confirmed-${position}"> 실제 수량과 상태를 확인했습니다.</label><label class="field small">손상·특이사항<input class="input" name="note-${position}" placeholder="손상이 있으면 사유를 입력해주세요."></label></fieldset>`;
      }).join('')}</div>` : ''}
      ${['reject', 'return', 'return-extra', 'maintenance-required', 'maintenance-done'].includes(action) ? `<label class="field">${action === 'reject' ? '관리자 거절 사유 (필수)' : maintenanceAction ? '점검 확인 메모 (필수)' : '검수 메모·보류 사유'}<textarea class="input" name="reason" rows="3" ${action === 'reject' || maintenanceAction ? 'required' : ''} placeholder="${action === 'reject' ? '학생에게 안내할 거절 사유를 입력해주세요.' : '실제 확인 내용과 필요한 후속 처리를 기록해주세요.'}"></textarea></label>` : ''}
      ${maintenanceAction ? `<label class="inspection-confirm"><input type="checkbox" name="maintenanceConfirmed"> ${action === 'maintenance-done' ? '실제 장비 점검 완료를 확인했습니다.' : '실제 장비 점검 필요 상태를 확인했습니다.'}</label>` : ''}
      <p class="form-error small" role="alert" data-process-error></p><button type="button" class="btn btn-secondary" data-reload-inspection hidden>최신 상태로 다시 확인</button>
      <div class="admin-actions"><button class="btn btn-primary" type="submit" ${inspection && !components.length ? 'disabled' : ''}>${inspection ? '검수 결과 저장' : `${e(actionLabel)} 확정`}</button><button class="btn btn-secondary" type="button" data-close-dialog>취소</button></div></form>`}`);
  dialog.classList.add('admin-dialog');
  dialog.querySelectorAll('[data-next-action]').forEach(button => button.addEventListener('click', () => { dialog.close(); openAdminAction(number, id, button.dataset.nextAction); }));
  if (action === 'detail') return;
  const form = dialog.querySelector('[data-process-form]');
  const errorNode = form.querySelector('[data-process-error]');
  form.querySelector('[data-fill-inspection]')?.addEventListener('click', () => {
    components.forEach((component, position) => {
      const delivered = Number(component.quantity || component.requiredQuantity);
      form.elements[`quantity-${position}`].value = action === 'checkout' ? component.requiredQuantity : Math.max(0, delivered - Number(item.returnedComponents?.[component.componentId] || 0));
      form.elements[`condition-${position}`].value = '정상';
      form.elements[`confirmed-${position}`].checked = true;
    });
    errorNode.textContent = '';
  });
  form.querySelector('[data-reload-inspection]').addEventListener('click', async event => {
    const trigger = event.currentTarget;
    trigger.disabled = true;
    try {
      await refreshRecords();
      dialog.close();
      const current = entries().find(entry => entry.record.number === number && entry.item.id === id);
      if (!current || (!maintenanceAction && !entryActions(current.item).some(([next]) => next === action))) {
        notify('이 신청의 처리 상태가 바뀌었습니다. 최신 항목을 선택해주세요.');
        return;
      }
      openAdminAction(number, id, action);
    } catch (error) { errorNode.textContent = error.message || '최신 내역을 읽지 못했습니다. 기존 입력은 유지됩니다.'; trigger.disabled = false; }
  });
  let busy = false;
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    errorNode.textContent = '';
    const details = { expectedVersion: item.version, reason: String(form.elements.reason?.value || '').trim() };
    if (item.kind === '장비') details.expectedEquipmentVersion = equipmentState?.version || 0;
    if ((action === 'reject' || maintenanceAction) && !details.reason) {
      errorNode.textContent = action === 'reject' ? '관리자 거절 사유를 입력해주세요.' : '점검 확인 메모를 입력해주세요.';
      form.elements.reason.focus(); return;
    }
    if (maintenanceAction && !form.elements.maintenanceConfirmed.checked) { errorNode.textContent = '실제 장비 점검 내용을 확인해주세요.'; return; }
    if (maintenanceAction) details.confirmed = form.elements.maintenanceConfirmed.checked;
    if (inspection) {
      details.components = components.map((component, position) => ({
        componentId: component.componentId, name: component.name, requiredQuantity: component.requiredQuantity, required: component.required, body: component.body,
        quantity: form.elements[`quantity-${position}`].value === '' ? NaN : Number(form.elements[`quantity-${position}`].value),
        condition: form.elements[`condition-${position}`].value, confirmed: form.elements[`confirmed-${position}`].checked,
        note: form.elements[`note-${position}`].value.trim(),
      }));
      const invalid = details.components.find(component => !Number.isSafeInteger(component.quantity) || component.quantity < 0 || !component.condition || !component.confirmed || (component.condition === '손상' && !component.note));
      if (invalid) { errorNode.textContent = `${invalid.name}: 수량·상태·실제 확인을 입력해주세요. 손상은 설명이 필요합니다.`; return; }
      const missing = action !== 'checkout' && details.components.some(component => {
        const baseline = components.find(row => row.componentId === component.componentId);
        return Number(item.returnedComponents?.[component.componentId] || 0) + component.quantity < Number(baseline.quantity || baseline.requiredQuantity);
      });
      if (missing && !details.reason) { errorNode.textContent = '부족한 구성품이 있습니다. 반납 보류 사유를 입력해주세요.'; form.elements.reason?.focus(); return; }
    }
    busy = true;
    dialog.dataset.busy = 'true';
    dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = true; });
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = '저장 중…';
    try {
      await processItem(number, id, action, details);
      dialog.close();
      notify(`${item.name} · ${inspection ? '검수 결과를' : actionLabel + ' 처리를'} 저장했습니다.`);
    } catch (error) {
      if (dialog.open) {
        errorNode.textContent = error.message || '저장에 실패했습니다. 입력을 확인하고 다시 시도해주세요.';
        submit.disabled = false;
        submit.textContent = inspection ? '검수 결과 저장' : `${actionLabel} 확정`;
        if (/최신|변경|충돌|다른 창/.test(errorNode.textContent)) { form.querySelector('[data-reload-inspection]').hidden = false; submit.disabled = true; }
      }
    } finally {
      busy = false;
      dialog.dataset.busy = 'false';
      dialog.querySelectorAll('[data-close-dialog]').forEach(button => { button.disabled = false; });
    }
  });
}
