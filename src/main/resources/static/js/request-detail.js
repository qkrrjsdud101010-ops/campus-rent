import {escapeHTML as e, openDialog} from './ui.js';

const statusCodes = {
  '승인 대기': 'PENDING', '승인·수령 대기': 'APPROVED', '예약 승인': 'APPROVED',
  '대여 중': 'CHECKED_OUT', '반납 신청': 'RETURN_REQUESTED', '반납 보류': 'RETURN_HELD',
  '반납 완료': 'RETURNED', '이용 중': 'IN_USE', '이용 완료': 'COMPLETED',
  '거절': 'REJECTED', '신청 취소 완료': 'CANCELLED',
};
const finished = new Set(['RETURNED', 'COMPLETED', 'REJECTED', 'CANCELLED']);
const listPaths = new Set(['/records', '/requests', '/history']);
let active = null;

function code(status) { return statusCodes[status] || status; }
export function isCompletedRequest(item) { return finished.has(code(item.status)); }

export function requestStatus(item) {
  const facility = item.kind === '시설';
  const value = {
    PENDING: ['승인 대기', 'waiting', '관리자 승인 결과를 기다려주세요. 아직 자원이 확보되지 않았습니다.', 'cancel'],
    APPROVED: facility
      ? ['예약 승인', 'progress', '이용 예정 일정과 시설 위치를 확인하세요. 실제 이용 시작은 관리자가 확인합니다.']
      : ['승인·수령 대기', 'progress', '수령 예정 일정을 확인하세요. 수령·반환 장소는 관리자 안내를 확인하세요.'],
    CHECKED_OUT: ['대여 중', 'progress', '반납 예정 일정과 출고 구성품을 확인한 뒤 반납을 신청하세요.', 'return'],
    RETURN_REQUESTED: ['반납 신청', 'waiting', '실제 장비를 반환하고 관리자의 반환 확인을 기다려주세요. 반납 신청만으로 반환이 완료되지는 않습니다.'],
    RETURN_HELD: ['반납 보류', 'warning', '부족 구성품과 수량, 최근 보류 사유를 확인하고 같은 대여 건에 추가 반환하세요.'],
    RETURNED: ['반납 완료', 'success', '반납이 완료되었습니다. 실제 검수 회차와 반환 결과를 확인할 수 있습니다.'],
    IN_USE: ['이용 중', 'progress', '시설 이용·종료 안내를 확인하세요. 실제 이용 종료는 관리자가 확인합니다.'],
    COMPLETED: ['이용 완료', 'success', '시설 이용이 완료되었습니다. 기록된 실제 시작·종료 시각을 확인할 수 있습니다.'],
    REJECTED: ['거절', 'danger', '거절 사유와 기록된 처리 시각을 확인하세요.'],
    CANCELLED: ['신청 취소 완료', 'muted', '이 항목의 신청이 취소되었습니다. 취소 결과와 처리 시각을 확인할 수 있습니다.'],
  }[code(item.status)] || [String(item.status || '상태 확인 필요'), 'muted', '현재 처리 상태를 관리자에게 확인해주세요.'];
  return {code: code(item.status), label: value[0], tone: value[1], next: value[2], action: value[3] || '', className: `status request-status request-status-${value[1]}`};
}

// Server timestamps without an offset are local Korean campus time.
function timestamp(value) {
  if (!value) return NaN;
  const text = String(value);
  return Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(text) ? `${text}+09:00` : text);
}
function dateLabel(value) {
  const at = timestamp(value);
  return Number.isFinite(at) ? new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(at) : '기록 없음';
}
function timeHtml(value) { return Number.isFinite(timestamp(value)) ? `<time datetime="${e(value)}">${e(dateLabel(value))}</time>` : '<span class="muted">기록 없음</span>'; }
function quantity(value) { return value !== null && value !== '' && value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null; }
function rowsOf(round) { return Array.isArray(round.components) ? round.components : []; }
function roundsOf(item) { return Array.isArray(item.inspections) ? item.inspections : []; }

// Each inspection stores a delta. Sum it once per component, never join it to status logs.
export function componentBalances(item) {
  const definitions = Array.isArray(item.checkoutComponents) ? item.checkoutComponents : [];
  const rounds = roundsOf(item);
  const identifiers = new Set();
  return definitions.map(definition => {
    const id = String(definition.componentId);
    const delivered = quantity(definition.quantity);
    let invalid = delivered === null || identifiers.has(id);
    identifiers.add(id);
    let returned = 0;
    for (const round of rounds) {
      const matching = rowsOf(round).filter(row => String(row.componentId) === id);
      if (matching.length > 1) invalid = true;
      for (const row of matching) {
        const count = quantity(row.quantity);
        if (count === null) invalid = true;
        else returned += count;
      }
    }
    if (Object.hasOwn(item.returnedComponents || {}, id)) {
      const stored = quantity(item.returnedComponents[id]);
      if (stored === null || (rounds.length && stored !== returned)) invalid = true;
      if (!rounds.length && stored !== null) returned = stored;
    }
    const missing = delivered === null ? null : delivered - returned;
    if (missing !== null && missing < 0) invalid = true;
    return {...definition, delivered, returned, missing, invalid};
  });
}

function stepsHtml(record, item) {
  const logged = new Set((item.history || []).map(entry => code(entry.to || entry.action)));
  const facility = item.kind === '시설';
  const steps = facility ? [
    ['신청', Boolean(record.createdAt) || logged.has('PENDING')], ['승인', logged.has('APPROVED')],
    ['이용 시작', Boolean(item.startedAt) || logged.has('IN_USE')], ['이용 종료', Boolean(item.endedAt) || logged.has('COMPLETED')],
  ] : [
    ['신청', Boolean(record.createdAt) || logged.has('PENDING')], ['승인', logged.has('APPROVED')],
    ['출고', Boolean(item.checkoutAt) || logged.has('CHECKED_OUT')],
    ['반환 확인', roundsOf(item).length > 0 || logged.has('RETURN_HELD') || logged.has('RETURNED')],
    ['완료', logged.has('RETURNED') || roundsOf(item).some(round => code(round.status) === 'RETURNED')],
  ];
  return `<ol class="request-steps" aria-label="저장된 기록으로 확인한 진행 단계">${steps.map(([label, verified]) => `<li class="${verified ? 'has-record' : ''}"><strong>${label}</strong><span>${verified ? '기록 있음' : '단계 기록 없음'}</span></li>`).join('')}</ol><p class="small muted">저장된 이력으로 확인한 단계입니다. 현재 상태만으로 이전 단계를 완료했다고 추정하지 않습니다.</p>`;
}

function eventsHtml(record, item) {
  const events = [];
  const add = (at, title, type, text = '') => events.push({at, title, type, text, order: events.length});
  if (record.createdAt) add(record.createdAt, '신청 접수', '접수 기록');
  for (const entry of item.history || []) {
    const status = requestStatus({...item, status: entry.to || entry.action});
    const from = entry.from ? requestStatus({...item, status: entry.from}).label : '';
    add(entry.at, status.label, '상태 변경 기록', [from ? `${from} → ${status.label}` : '', entry.reason].filter(Boolean).join(' · '));
  }
  if (item.checkoutAt) add(item.checkoutAt, '실제 출고', '실제 출고 시각');
  if (item.checkoutSource === 'LATE_REGISTERED' && item.checkoutRegisteredAt) add(item.checkoutRegisteredAt, '출고 기준 사후 등록', '등록 시각');
  if (item.startedAt) add(item.startedAt, '시설 이용 시작', '실제 시작 시각');
  if (item.endedAt) add(item.endedAt, '시설 이용 종료', '실제 종료 시각');
  for (const round of roundsOf(item)) add(round.at, `${round.round}차 반환 검수 · ${requestStatus({...item, status: round.status}).label}`, '실제 검수 기록', round.reason || '');
  events.sort((a, b) => {
    const aTime = timestamp(a.at), bTime = timestamp(b.at);
    return (Number.isFinite(aTime) ? aTime : Infinity) - (Number.isFinite(bTime) ? bTime : Infinity) || a.order - b.order;
  });
  return `${!(item.history || []).length ? '<p class="request-empty-note">저장된 상태 변경 이력이 없습니다. 현재 상태와 확인 가능한 기록만 표시합니다.</p>' : ''}${events.length ? `<ol class="request-timeline">${events.map(event => `<li><div class="request-event-heading"><strong>${e(event.title)}</strong><span class="small muted">${e(event.type)}</span></div>${timeHtml(event.at)}${event.text ? `<p>${e(event.text)}</p>` : ''}</li>`).join('')}</ol>` : '<p class="small muted">확인 가능한 처리 기록이 없습니다.</p>'}`;
}

function componentsHtml(item, balances) {
  if (item.kind !== '장비') return '';
  const rounds = roundsOf(item);
  if (!balances.length) return '<section class="request-section"><h3>출고·반환 구성품</h3><p class="request-empty-note">출고 구성품 기록 없음</p><p class="small muted">현재 기본 구성품으로 이 신청의 과거 출고 기준을 대신하지 않습니다.</p></section>';
  const latest = rounds.at(-1);
  const unknownComponent = rounds.some(round => rowsOf(round).some(row => !balances.some(balance => String(balance.componentId) === String(row.componentId))));
  const running = new Map();
  return `<section class="request-section"><h3>출고·반환 구성품</h3>${item.checkoutSource === 'LATE_REGISTERED' ? `<p class="request-empty-note">사후 등록 · 등록 시각 ${timeHtml(item.checkoutRegisteredAt)}<br>등록 시각은 실제 출고 시각이 아닙니다.</p>` : ''}<p class="small muted">이 대여 건에 보존된 출고 기준입니다. 누적 반환은 각 검수 회차의 이번 반환 수량을 합산합니다.</p>${unknownComponent ? '<p class="notice error-text">기록 확인 필요 · 출고 기준에 없는 반환 구성품 기록이 있습니다.</p>' : ''}<div class="request-components">${balances.map(component => `<article class="request-component ${component.invalid ? 'needs-review' : component.missing > 0 ? 'has-missing' : ''}"><header><strong>${e(component.name)}${component.body ? ' · 본체' : ''}</strong><span class="small muted">${component.required ? '필수' : '선택'} · 출고 시 ${e(component.condition || '상태 기록 없음')}</span></header><dl><div><dt>실제 출고</dt><dd>${component.delivered === null ? '기록 확인 필요' : `${component.delivered}개`}</dd></div><div><dt>누적 반환</dt><dd>${component.returned}개</dd></div><div><dt>부족</dt><dd class="${component.missing > 0 || component.invalid ? 'error-text' : ''}">${component.missing === null ? '기록 확인 필요' : `${component.missing}개`}</dd></div></dl>${component.invalid ? '<p class="small error-text">기록 확인 필요 · 출고 수량과 반환 기록을 관리자에게 확인해주세요.</p>' : component.missing > 0 ? `<p class="small ${code(item.status) === 'RETURN_HELD' ? 'error-text' : 'muted'}">${code(item.status) === 'RETURN_HELD' ? `${component.missing}개 추가 반환 필요` : '아직 반환 확인되지 않은 수량입니다.'}</p>` : '<p class="small muted">출고 수량 반환 확인</p>'}</article>`).join('')}</div>${latest ? `<div class="request-latest-inspection"><strong>최근 ${e(latest.round)}차 검수 · ${e(requestStatus({...item, status: latest.status}).label)}</strong><p class="small">검수 시각 ${timeHtml(latest.at)}</p>${latest.reason ? `<p>${code(latest.status) === 'RETURN_HELD' ? '보류 사유' : '처리 사유'}: ${e(latest.reason)}</p>` : ''}</div>` : '<p class="small muted">저장된 반환 검수 회차가 없습니다.</p>'}${rounds.length ? `<div class="request-inspection-rounds">${rounds.map(round => {
    const rows = rowsOf(round).map(row => {
      const id = String(row.componentId), count = quantity(row.quantity);
      const previous = running.has(id) ? running.get(id) : 0;
      const cumulative = previous === null || count === null ? null : previous + count;
      running.set(id, cumulative);
      const balance = balances.find(component => String(component.componentId) === id);
      const missing = balance?.delivered !== null && balance?.delivered !== undefined && cumulative !== null ? balance.delivered - cumulative : null;
      return `<li><strong>${e(balance?.name || row.name || '구성품 기록 확인 필요')}</strong><p>이번 반환 ${count === null ? '기록 확인 필요' : `${count}개`} · 당시 누적 ${cumulative === null ? '기록 확인 필요' : `${cumulative}개`} · 당시 부족 ${missing === null ? '기록 확인 필요' : `${missing}개`}</p><span class="small muted">반환 시 ${e(row.condition || '상태 기록 없음')}</span>${missing !== null && missing < 0 ? '<p class="error-text">기록 확인 필요 · 누적 반환이 출고 수량보다 많습니다.</p>' : ''}</li>`;
    }).join('');
    return `<details class="request-inspection-round"><summary>${e(round.round)}차 검수 · ${e(requestStatus({...item, status: round.status}).label)} · ${e(dateLabel(round.at))}</summary>${round.reason ? `<p>처리 사유: ${e(round.reason)}</p>` : ''}<ul>${rows || '<li>구성품별 반환 기록 없음</li>'}</ul></details>`;
  }).join('')}</div>` : ''}</section>`;
}

export function requestDetailHtml(record, item, {resource = null, equipmentState = null} = {}) {
  const status = requestStatus(item), facility = item.kind === '시설';
  const balances = componentBalances(item);
  const missing = balances.filter(component => !component.invalid && component.missing > 0).sort((a, b) => Number(b.required) - Number(a.required));
  const due = status.code === 'APPROVED' ? item.condition?.start : ['CHECKED_OUT', 'IN_USE'].includes(status.code) ? item.condition?.end : null;
  const overdue = Number.isFinite(timestamp(due)) && timestamp(due) < Date.now();
  const location = resource?.location;
  const operationalStatus = equipmentState?.status || resource?.status;
  const currentResource = resource ? `<dl class="request-facts"><div><dt>자원 식별 정보</dt><dd>${e(resource.code || '')}${resource.model ? ` · ${e(resource.model)}` : ''}</dd></div><div><dt>${facility ? '시설 위치 (현재 정보)' : '보관 장소 (현재 정보)'}</dt><dd>${e(location || '정보 없음')}</dd></div>${!facility ? `<div><dt>장비 운영 상태 (현재)</dt><dd>${e(operationalStatus || '정보 없음')}</dd></div>` : ''}</dl><button class="btn btn-secondary" type="button" data-request-resource>자원 정보</button>` : '<p class="small muted">현재 자원 정보를 찾을 수 없습니다. 보존된 신청·처리 기록을 확인하세요.</p>';
  return `<div class="request-detail-content"><header class="request-detail-summary"><p class="small muted">접수번호 ${e(record.number)} · 항목 ${e(item.originalIndex || item.order || item.sequence || record.items?.findIndex(entry => entry.id === item.id) + 1 || '기록 없음')} · ${e(item.kind)}</p><h3>${e(item.name)}</h3><span class="${status.className}">${e(status.label)}</span></header><section class="request-next request-next-${status.tone}" aria-labelledby="request-next-title"><h3 id="request-next-title">다음 할 일</h3><p>${e(status.next)}</p>${status.code === 'RETURN_HELD' && missing.length ? `<ul>${missing.map(component => `<li>${e(component.name)} ${component.missing}개 추가 반환${component.required ? ' · 필수' : ''}</li>`).join('')}</ul>` : ''}${status.code === 'RETURN_HELD' && balances.some(component => component.invalid) ? '<p class="error-text">구성품 기록 확인 필요 · 관리자에게 출고·반환 수량을 확인해주세요.</p>' : ''}${item.reason && ['RETURN_HELD', 'REJECTED'].includes(status.code) ? `<p><strong>${status.code === 'REJECTED' ? '거절 사유' : '최근 보류 사유'}</strong> ${e(item.reason)}</p>` : ''}${overdue ? '<p class="request-overdue">예정 시각 지남 · 현재 처리 상태 확인</p>' : ''}${status.action ? `<button class="btn ${status.action === 'return' ? 'btn-primary' : 'btn-secondary'}" type="button" data-request-action="${status.action}">${status.action === 'cancel' ? '신청 취소' : '반납 신청'}</button>` : ''}</section><section class="request-section"><h3>예정 일정</h3><dl class="request-facts"><div><dt>${facility ? '이용 시작 예정' : '수령 예정'}</dt><dd>${timeHtml(item.condition?.start)}</dd></div><div><dt>${facility ? '이용 종료 예정' : '반납 예정'}</dt><dd>${timeHtml(item.condition?.end)}</dd></div>${facility ? `<div><dt>이용 인원·목적</dt><dd>${e(item.condition?.people ?? '기록 없음')}명 · ${e(item.condition?.use || item.condition?.purpose || '목적 기록 없음')}</dd></div>` : ''}</dl><p class="small muted">예정 일정은 실제 처리 시각과 다릅니다. 모든 시각은 한국 시간 기준입니다.</p></section><section class="request-section"><h3>진행 단계</h3>${stepsHtml(record, item)}</section><section class="request-section"><h3>실제 처리 내역</h3><dl class="request-facts">${facility ? `<div><dt>실제 이용 시작</dt><dd>${timeHtml(item.startedAt)}</dd></div><div><dt>실제 이용 종료</dt><dd>${timeHtml(item.endedAt)}</dd></div>` : `<div><dt>실제 출고 시각</dt><dd>${timeHtml(item.checkoutAt)}</dd></div>`}</dl>${eventsHtml(record, item)}</section>${componentsHtml(item, balances)}<section class="request-section"><h3>자원 정보</h3>${currentResource}${!facility ? '<p class="small muted">수령·반환 장소는 관리자 안내를 확인하세요. 현재 보관 장소는 확정 수령·반환 장소가 아닙니다.</p>' : '<p class="small muted">시설 위치와 기본 정보는 현재 등록된 정보입니다.</p>'}</section><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-dialog>목록으로 돌아가기</button></div></div>`;
}

export function dismissRequestDetail({silent = false} = {}) {
  if (!active) return;
  const session = active;
  active = null;
  session.silent = silent;
  session.dialog.close();
}

export function synchronizeRequestDetailOwner(user) {
  if (active && (user?.role !== 'student' || String(user.id) !== active.ownerId)) dismissRequestDetail({silent: true});
}

export function openRequestDetail(record, item, options = {}) {
  const ownerId = String(record.userId);
  const key = `${ownerId}/${record.number}/${item.id}`;
  if (active && active.key !== key) dismissRequestDetail({silent: true});
  const signature = JSON.stringify([record.createdAt, item, options.resource, options.equipmentState]);
  if (!active) {
    const dialog = openDialog('신청 상세', '');
    dialog.classList.add('request-detail-dialog');
    active = {key, ownerId, itemId: String(item.id), dialog, options, signature: ''};
    const session = active;
    dialog.addEventListener('close', () => {
      if (active === session) active = null;
      if (!session.silent) session.options.onClose?.();
    }, {once: true});
  }
  active.options = options;
  if (active.signature !== signature) {
    const body = active.dialog.querySelector('.dialog-body');
    const scrollTop = active.dialog.scrollTop;
    const opened = new Set([...body.querySelectorAll('details[open]')].map(node => node.querySelector('summary')?.textContent));
    body.innerHTML = requestDetailHtml(record, item, options);
    body.querySelectorAll('details').forEach(node => { node.open = opened.has(node.querySelector('summary')?.textContent); });
    body.querySelectorAll('[data-request-action]').forEach(node => node.addEventListener('click', () => active?.options.onAction?.(node.dataset.requestAction)));
    body.querySelector('[data-request-resource]')?.addEventListener('click', () => active?.options.onResource?.());
    active.dialog.scrollTop = scrollTop;
    active.signature = signature;
  }
  return active.dialog;
}

if (typeof window !== 'undefined') {
  const onNavigation = () => {
    if (!active) return;
    const path = location.pathname.replace(/\/$/, '') || '/';
    if (!listPaths.has(path) || new URLSearchParams(location.search).get('item') !== active.itemId) dismissRequestDetail({silent: true});
  };
  window.addEventListener('campus:navigate', onNavigation);
  window.addEventListener('popstate', onNavigation);
}
