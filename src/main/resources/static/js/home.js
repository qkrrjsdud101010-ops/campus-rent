import {escapeHTML, navigate} from './ui.js';
const image = name => `<img src="/assets/${name}" alt="">`;
const activities = [
  {title: '인터뷰 촬영 시작하기', activity: '인터뷰 촬영', icon: '054e2.svg', summary: '카메라 세트 + 마이크 세트', description: '영상과 음성을 함께 기록할 때 필요한 구성입니다.'},
  {title: '발표 연습 준비하기', activity: '발표 연습', icon: '1eae3.svg', summary: '회의실 + 필요 시 빔프로젝터', description: '발표 공간을 확인하고, 비치 설비에 따라 필요한 장비를 선택하세요.'},
  {title: '팀 회의 시작하기', activity: '팀 회의', icon: 'b46a5.svg', summary: '스터디룸·회의실', description: '참여 인원과 이용 목적에 맞는 공간을 찾으세요.'}
];
export function renderHome(container, params) {
  const activity = params.get('activity') || '';
  container.className = 'home-page';
  container.innerHTML = `
    <section class="hero-section" aria-labelledby="hero-title"><div class="hero-heading">
      <p class="eyebrow">교내 시설·장비 이용을 한곳에서</p>
      <h1 id="hero-title">하고 싶은 활동에 맞춰,<br>공간과 장비를 찾아보세요.</h1>
      <p>필요한 것이 정해져 있다면 직접 찾고, 처음이라면 목적에 맞는 추천으로 시작하세요.</p>
    </div><form class="hero-search" id="activity-search"><label for="activity">어떤 활동을 준비하고 계신가요?</label>
      <div class="hero-input-row">${image('8adc4.svg')}<input id="activity" name="activity" value="${escapeHTML(activity)}" placeholder="예: 팀 과제 인터뷰 영상을 촬영하고 싶어요" autocomplete="off"><button class="btn btn-primary" type="submit">목적에 맞게 추천받기</button></div>
      <div class="keyword-row"><span>추천 키워드</span><div class="keyword-buttons">${['인터뷰 촬영', '발표 연습', '팀 회의', '과제 영상 촬영', '기타'].map(keyword => `<button type="button" class="chip" data-keyword="${keyword}" aria-pressed="${activity === keyword}">${keyword}</button>`).join('')}</div></div>
    </form></section>
    <section class="quick-section section-inner" aria-labelledby="quick-title"><h2 id="quick-title">필요한 것이 정해져 있나요?</h2><div class="quick-grid">
      <a class="quick-card" href="/equipment" data-link><span class="quick-content"><span class="quick-icon">${image('ff97a.svg')}</span><span><strong>장비 대여</strong><span>카메라 · 빔프로젝터 · 무선 마이크 등</span></span></span>${image('0272b.svg')}</a>
      <a class="quick-card" href="/facilities" data-link><span class="quick-content"><span class="quick-icon">${image('8f64d.svg')}</span><span><strong>시설 대여</strong><span>스터디룸·회의실</span></span></span>${image('0272b.svg')}</a>
    </div></section>
    <section class="purpose-shortcut section-inner"><a href="/purpose${activity ? '?activity=' + encodeURIComponent(activity) : ''}" data-link><span><h2>목적별 대여</h2><p>무엇을 준비할지 모르겠다면 활동을 설명하고 추천받으세요.</p></span><span class="shortcut-arrow" aria-hidden="true">→</span></a></section>
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
    field.value = button.dataset.keyword === '기타' ? (field.value.trim() || '기타') : button.dataset.keyword;
    container.querySelectorAll('[data-keyword]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    history.replaceState({}, '', '/?activity=' + encodeURIComponent(field.value)); field.focus();
  }));
  field.addEventListener('input', () => {
    const url = new URL(location.href);
    if (field.value) url.searchParams.set('activity', field.value); else url.searchParams.delete('activity');
    history.replaceState({}, '', url.pathname + url.search);
    container.querySelectorAll('[data-keyword]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.keyword === field.value)));
  });
}
