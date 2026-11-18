import {analyzeInput, serverMode} from './data.js';
import * as store from './store.js';
import {escapeHTML as e} from './ui.js';

const needLabels = {space: '공간', video: '영상 촬영', audio: '음성 녹음', presentation: '자료 투사'};
const reasonLabels = {
  disabled: 'AI 문장 분석이 꺼져 있어 기본 규칙으로 정리했습니다.',
  unconfigured: 'AI 연결 설정이 없어 기본 규칙으로 정리했습니다.',
  unavailable: 'AI 문장 분석을 이용할 수 없어 기본 규칙으로 정리했습니다.',
  'invalid-response': 'AI 분석 응답을 확인하지 못해 기본 규칙으로 정리했습니다.',
  busy: 'AI 문장 분석 요청이 많아 기본 규칙으로 정리했습니다.',
  'rate-limited': 'AI 문장 분석 요청 한도에 도달해 기본 규칙으로 정리했습니다.',
  timeout: 'AI 문장 분석 시간이 지나 기본 규칙으로 정리했습니다.',
};
const sessions = new Map();
const capabilities = {loaded: false, loading: false, available: false, externalProcessing: false};
let capabilityPromise = null;
const ownerKey = () => { const user = store.getState().user; return user ? `${user.role}:${user.id}` : 'guest'; };

export function createSentenceAnalysisState() {
  return {sequence: 0, busy: false, proposal: null, message: '', error: ''};
}

function normalizedNeeds(needs) {
  return Object.fromEntries(Object.keys(needLabels).map(key => [key, needs?.[key] === true]));
}

export function sentenceSnapshot(value) {
  return {activity: String(value.activity || ''), people: value.people,
    peopleEdited: value.peopleEdited === true, needs: normalizedNeeds(value.needs),
    needsEdited: value.needsEdited === true, revision: String(value.revision || '')};
}

function signature(snapshot) { return JSON.stringify(sentenceSnapshot(snapshot)); }

export function ruleSentenceAnalysis(activity) {
  const result = analyzeInput(activity);
  const explicit = result.peopleStatus === 'valid' && Number.isInteger(result.people) && result.people >= 1 && result.people <= 999;
  const ambiguous = ['ambiguous', 'invalid'].includes(result.peopleStatus) || (result.peopleStatus === 'valid' && !explicit);
  const needs = normalizedNeeds(result.proposedNeeds);
  return {activity: [...String(activity).trim()].slice(0, 80).join(''), people: explicit ? result.people : null,
    peopleStatus: explicit ? 'explicit' : ambiguous ? 'ambiguous' : 'unspecified', needs,
    needsClarification: ambiguous || !Object.values(needs).some(Boolean)};
}

function validAnalysis(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.activity !== 'string' ||
      !value.activity.trim() || [...value.activity].length > 80 ||
      !['explicit', 'unspecified', 'ambiguous'].includes(value.peopleStatus) ||
      typeof value.needsClarification !== 'boolean' || !value.needs || typeof value.needs !== 'object' ||
      !Object.keys(needLabels).every(key => typeof value.needs[key] === 'boolean')) return false;
  return value.peopleStatus === 'explicit'
    ? Number.isInteger(value.people) && value.people >= 1 && value.people <= 999
    : value.people === null;
}

export function normalizeSentenceResponse(response, activity, fallbackReason = 'unavailable') {
  if (['ai', 'rules'].includes(response?.source) && validAnalysis(response.analysis)) {
    const analysis = response.analysis;
    return {source: response.source, reason: response.source === 'rules' ? response.reason || fallbackReason : '',
      analysis: {activity: analysis.activity.trim(), people: analysis.people, peopleStatus: analysis.peopleStatus,
        needs: normalizedNeeds(analysis.needs), needsClarification: analysis.needsClarification}};
  }
  return {source: 'rules', reason: response?.source === 'rules' ? response.reason || fallbackReason
    : response ? 'invalid-response' : fallbackReason, analysis: ruleSentenceAnalysis(activity)};
}

export function selectedAnalysisChanges(proposal, selection = {}) {
  const analysis = proposal.analysis;
  const changes = {needs: {}, peopleAmbiguous: analysis.peopleStatus === 'ambiguous'};
  if (selection.activity === true) changes.activity = analysis.activity;
  if (selection.people === true && analysis.peopleStatus === 'explicit') changes.people = analysis.people;
  for (const key of Object.keys(needLabels)) if (selection[key] === true) changes.needs[key] = analysis.needs[key];
  return changes;
}

export function sentenceAnalysisHtml(state, capability = {}) {
  const warning = capability.available && capability.externalProcessing;
  const proposal = state.proposal;
  let result = '';
  if (proposal) {
    const {analysis, baseline} = proposal;
    const peopleText = analysis.peopleStatus === 'explicit' ? `${analysis.people}명`
      : analysis.peopleStatus === 'ambiguous' ? '인원 확인 필요 · 임의로 정하지 않음' : '문장에 인원 없음';
    const reason = proposal.source === 'ai' ? 'AI가 정리한 제안입니다. 실제 필요한 항목을 확인해주세요.'
      : reasonLabels[proposal.reason] || '현재 기본 규칙으로 정리했습니다. 직접 설정과 함께 확인해주세요.';
    const choose = (key, checked, disabled = false) => `<label class="sentence-apply-choice"><input type="checkbox" data-sentence-choose="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}> 이 제안 적용</label>`;
    result = `<section class="sentence-analysis-review" aria-label="문장 분석 결과 확인"><div class="sentence-result-heading"><h3 tabindex="-1" data-sentence-result-title>분석 결과를 확인하세요</h3><span class="status ${proposal.source === 'ai' ? '' : 'status-muted'}">${proposal.source === 'ai' ? 'AI 분석' : '기본 규칙'}</span></div><p class="small muted">${e(reason)}</p>${analysis.needsClarification ? '<p class="sentence-clarification">추가 확인이 필요합니다. 인원이 모호하면 시설 이용 인원을 직접 확인하고, 필요한 준비를 선택해주세요.</p>' : ''}<div class="sentence-comparison"><article><h4>활동 설명</h4><dl><div><dt>현재 입력</dt><dd>${e(baseline.activity)}</dd></div><div><dt>분석 제안</dt><dd>${e(analysis.activity)}</dd></div></dl>${choose('activity', false)}<p class="small muted">원래 입력한 문장을 유지하는 것이 기본입니다.</p></article><article><h4>참여 인원</h4><dl><div><dt>현재 값${baseline.peopleEdited ? ' · 직접 입력' : ''}</dt><dd>${e(Number.isInteger(baseline.people) && baseline.people > 0 ? `${baseline.people}명` : '입력 확인 필요')}</dd></div><div><dt>분석 제안</dt><dd>${e(peopleText)}</dd></div></dl>${choose('people', analysis.peopleStatus === 'explicit' && !baseline.peopleEdited, analysis.peopleStatus !== 'explicit')}<p class="small muted">${baseline.peopleEdited ? '직접 입력한 인원을 유지하는 것이 기본입니다.' : '문장에 명시된 인원만 제안합니다.'}</p></article><fieldset class="sentence-needs-comparison"><legend>필요한 준비${baseline.needsEdited ? ' · 직접 설정한 값 유지가 기본' : ''}</legend>${Object.entries(needLabels).map(([key, label]) => `<div class="sentence-need-row"><div><strong>${label}</strong><p class="small">현재 ${baseline.needs[key] ? '필요' : '필요 없음'} → 제안 ${analysis.needs[key] ? '필요' : '필요 없음'}</p></div>${choose(key, !baseline.needsEdited)}</div>`).join('')}</fieldset></div><p class="small muted">활동·인원·준비 항목만 적용합니다. 시설의 실제 허용 목적과 날짜, 선택 목록은 별도로 확인하세요.</p><div class="button-row"><button class="btn btn-primary" type="button" data-sentence-apply>확인 후 추천에 적용</button><button class="btn btn-secondary" type="button" data-sentence-dismiss>직접 설정 유지</button></div></section>`;
  }
  const processingNote = warning ? '<p class="sentence-external-note">입력한 활동 문장을 외부 AI로 분석합니다. 개인정보는 입력하지 마세요.</p>'
    : capability.loading ? '<p class="small muted">문장 분석 기능을 확인하고 있습니다.</p>'
    : capability.available ? `<p class="small muted">${capability.provider === 'ollama' ? '이 기기의 로컬 AI로 문장을 분석합니다.' : '연결된 AI로 문장을 분석하고 결과를 확인합니다.'}</p>`
    : '<p class="small muted">현재 문장 분석은 기본 규칙과 직접 설정을 사용합니다.</p>';
  return `<div class="sentence-analysis-actions"><button class="btn btn-secondary" type="button" data-sentence-analyze ${state.busy || capability.loading ? 'disabled' : ''}>${state.busy ? '문장 분석 중…' : '문장 분석'}</button><p class="small muted">필요하면 문장의 활동·인원·준비 항목을 정리하고, 확인한 내용만 추천에 적용할 수 있습니다.</p></div>${processingNote}${state.busy ? '<p class="sentence-analysis-status" data-sentence-status tabindex="-1" role="status">문장을 분석하고 있습니다. 결과를 확인한 뒤 적용해주세요.</p>' : ''}${state.error ? `<p class="error-text" role="alert" tabindex="-1" data-sentence-error>${e(state.error)}</p>` : ''}${state.message ? `<p class="sentence-analysis-status" role="status" tabindex="-1" data-sentence-status>${e(state.message)}</p>` : ''}${result}`;
}

export function createSentenceAnalysisController({state = createSentenceAnalysisState(), getSnapshot, onApply,
  request = store.requestApi, getCapabilities = () => capabilities, getOwner = ownerKey,
  isActive = () => true, onChange = () => {}, timeoutMs = 15000}) {
  let pending = null;
  const current = (sequence, snapshot, owner) => state.sequence === sequence && isActive() &&
    getOwner() === owner && signature(getSnapshot()) === signature(snapshot);
  function invalidate(message = '') {
    state.sequence += 1;
    pending?.abort(); pending = null;
    state.busy = false; state.proposal = null; state.error = ''; state.message = message;
    onChange('invalidated');
  }
  async function analyze() {
    if (state.busy) return;
    const snapshot = sentenceSnapshot(getSnapshot());
    if (!snapshot.activity.trim() || [...snapshot.activity].length > 500) {
      state.error = snapshot.activity.trim() ? '활동 문장은 500자 이내로 입력해주세요.' : '분석할 활동 문장을 입력해주세요.';
      state.proposal = null; onChange('error'); return;
    }
    const owner = getOwner(), sequence = ++state.sequence;
    state.busy = true; state.proposal = null; state.error = ''; state.message = '';
    onChange('loading');
    let timer, response, reason = 'disabled';
    try {
      const capability = getCapabilities();
      if (capability.available) {
        const requestController = new AbortController();
        pending = requestController;
        const signal = requestController.signal;
        reason = 'unavailable';
        response = await Promise.race([
          request('/api/recommendations/analyze', {method: 'POST', body: {activity: snapshot.activity}, signal, notifyChanges: false}),
          new Promise((resolve, reject) => { timer = setTimeout(() => { reason = 'timeout'; requestController.abort(); reject(new Error('timeout')); }, timeoutMs); }),
        ]);
      }
    } catch {
      // Provider failures never become a claimed AI result or replace current inputs.
    } finally {
      clearTimeout(timer);
      if (!current(sequence, snapshot, owner)) {
        if (state.sequence === sequence) invalidate();
        return;
      }
      pending = null; state.busy = false;
      state.proposal = {...normalizeSentenceResponse(response, snapshot.activity, reason), baseline: snapshot, owner, signature: signature(snapshot)};
      onChange('result');
    }
  }
  function apply(selection) {
    const proposal = state.proposal;
    if (!proposal || proposal.owner !== getOwner() || proposal.signature !== signature(getSnapshot()) || !isActive()) { invalidate(); return false; }
    const changes = selectedAnalysisChanges(proposal, selection);
    onApply(changes);
    invalidate('확인한 분석 내용을 적용했습니다. 아래 추천 구성 보기로 기존 자원 후보를 확인하세요.');
    return true;
  }
  return {state, analyze, apply, invalidate};
}

async function loadCapabilities() {
  if (capabilities.loaded) return;
  if (capabilityPromise) return capabilityPromise;
  if (!serverMode) { capabilities.loaded = true; return; }
  capabilities.loading = true;
  capabilityPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await store.requestApi('/api/recommendations/analysis-capabilities', {signal: controller.signal});
      capabilities.available = response?.available === true;
      capabilities.externalProcessing = capabilities.available && response?.externalProcessing === true;
      capabilities.provider = typeof response?.provider === 'string' ? response.provider : '';
    } catch { capabilities.available = false; capabilities.externalProcessing = false; }
    finally {
      clearTimeout(timer); capabilities.loaded = true; capabilities.loading = false;
      for (const binding of sessions.values()) binding.render();
    }
  })();
  return capabilityPromise;
}

export function invalidateSentenceAnalysis(state) { sessions.get(state)?.controller.invalidate(); }

export function bindSentenceAnalysis(host, {state, getSnapshot, onApply}) {
  if (!host) return;
  let binding = sessions.get(state);
  if (!binding) {
    binding = {host, getSnapshot, onApply, initialSignature: signature(getSnapshot()), render: () => {}};
    binding.controller = createSentenceAnalysisController({state,
      getSnapshot: () => binding.getSnapshot(), onApply: changes => binding.onApply(changes),
      isActive: () => binding.host?.isConnected && location.pathname.replace(/\/$/, '') === '/purpose',
      onChange: phase => binding.render(phase)});
    sessions.set(state, binding);
  }
  binding.host = host; binding.getSnapshot = getSnapshot; binding.onApply = onApply;
  binding.render = phase => {
    if (!binding.host?.isConnected) return;
    const focused = binding.host.contains(document.activeElement);
    binding.host.innerHTML = sentenceAnalysisHtml(state, capabilities);
    binding.host.querySelector('[data-sentence-analyze]')?.addEventListener('click', () => binding.controller.analyze());
    binding.host.querySelector('[data-sentence-dismiss]')?.addEventListener('click', () => binding.controller.invalidate('직접 입력한 활동과 설정을 유지했습니다.'));
    binding.host.querySelector('[data-sentence-apply]')?.addEventListener('click', () => {
      const selection = Object.fromEntries([...binding.host.querySelectorAll('[data-sentence-choose]')].map(node => [node.dataset.sentenceChoose, node.checked && !node.disabled]));
      binding.controller.apply(selection);
    });
    if (phase === 'error') binding.host.querySelector('[data-sentence-error]')?.focus();
    else if (phase === 'loading') binding.host.querySelector('[data-sentence-status]')?.focus({preventScroll: true});
    else if (focused && phase === 'result') binding.host.querySelector('[data-sentence-result-title]')?.focus({preventScroll: true});
    else if (focused && phase === 'invalidated') (binding.host.querySelector('[data-sentence-status]') || binding.host.querySelector('[data-sentence-analyze]'))?.focus({preventScroll: true});
  };
  const nextSignature = signature(getSnapshot());
  if (binding.initialSignature !== nextSignature) {
    binding.initialSignature = nextSignature;
    binding.controller.invalidate();
  } else binding.render();
  if (!capabilities.loaded) { loadCapabilities(); binding.render(); }
  return binding.controller;
}

if (typeof window !== 'undefined') {
  let lastOwner = ownerKey();
  store.subscribe(() => {
    const nextOwner = ownerKey();
    if (lastOwner !== nextOwner) { for (const binding of sessions.values()) binding.controller.invalidate(); lastOwner = nextOwner; }
  });
  for (const event of ['campus:navigate', 'popstate']) window.addEventListener(event, () => {
    for (const binding of sessions.values()) binding.controller.invalidate();
  });
}
