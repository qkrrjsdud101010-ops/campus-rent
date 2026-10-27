import {renderHome} from './home.js';
import {renderRentalPage, renderRecords} from './rental.js';
import {renderAccountMenu, openAuthDialog, renderAdminPage} from './account.js';
import {ready, subscribe} from './store.js';
import {navigate, escapeHTML} from './ui.js';
const page = document.getElementById('page');
function render({moveFocus = false} = {}) {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const params = new URLSearchParams(location.search);
  renderAccountMenu(document.getElementById('account-menu'));
  document.querySelectorAll('.main-nav a').forEach(link => { if (link.getAttribute('href') === path) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  page.className = '';
  const names = {'/': '교내 시설·장비 대여', '/equipment': '장비 대여', '/facilities': '시설 대여', '/purpose': '목적별 대여', '/records': '내 신청 현황', '/requests': '내 신청 현황', '/history': '과거 신청 내역', '/admin': '관리자 신청 처리'};
  document.title = `${names[path] || '페이지를 찾을 수 없습니다'} · CampusRent`;
  try {
    if (path === '/') renderHome(page, params);
    else if (['/equipment', '/facilities', '/purpose'].includes(path)) renderRentalPage(page, path, params);
    else if (['/records','/requests','/history'].includes(path)) renderRecords(page, path === '/history');
    else if (path === '/admin') renderAdminPage(page, params);
    else page.innerHTML = '<div class="page-shell empty-state"><h1>페이지를 찾을 수 없습니다.</h1><p>주소를 확인하거나 메인으로 이동해 주세요.</p><a class="btn btn-primary" href="/" data-link>메인으로 돌아가기</a></div>';
  } catch (error) {
    page.innerHTML = `<div class="page-shell empty-state"><h1>화면을 불러오지 못했습니다.</h1><p>${escapeHTML(error.message)}</p><button class="btn btn-primary" id="retry-page">다시 시도</button></div>`;
    document.getElementById('retry-page').addEventListener('click', () => render()); console.error(error);
  }
  if (moveFocus) { window.scrollTo({top: 0, behavior: 'instant'}); page.focus({preventScroll: true}); }
}
document.addEventListener('click', event => {
  const link = event.target.closest('a[data-link]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target) return;
  event.preventDefault(); navigate(link.getAttribute('href'));
});
window.addEventListener('campus:navigate', () => render({moveFocus: true}));
window.addEventListener('popstate', () => render({moveFocus: true}));
window.addEventListener('campus:auth', openAuthDialog);
page.innerHTML = '<div class="page-shell empty-state" role="status">CampusRent 화면을 준비하고 있습니다…</div>';
try { await ready; subscribe(() => render()); render(); }
catch (error) { page.innerHTML = `<div class="page-shell empty-state"><h1>시연 저장소를 열지 못했습니다.</h1><p>${escapeHTML(error.message)}</p><p>브라우저의 사이트 저장 허용 여부를 확인한 후 새로고침해 주세요.</p></div>`; }
