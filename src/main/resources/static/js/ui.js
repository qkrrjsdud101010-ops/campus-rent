export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}
export function formatDate(value) {
  if (!value) return '일정 미입력';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(date);
}
export function formatSchedule(condition, kind = '장비') {
  if (!condition?.start || !condition?.end) return '일정 미입력 · 이용 가능 여부 확인 필요';
  const range = `${formatDate(condition.start)} ~ ${formatDate(condition.end)}`;
  return kind === '시설' ? `${range} · ${condition.people}명 · ${condition.use || '목적 미입력'}` : range;
}
export function navigate(path) {
  const target = new URL(path, location.origin);
  if (target.origin !== location.origin) return;
  if (target.pathname + target.search !== location.pathname + location.search) history.pushState({}, '', target.pathname + target.search + target.hash);
  window.dispatchEvent(new CustomEvent('campus:navigate'));
}
let toastTimer;
export function notify(message) {
  const toast = document.getElementById('toast');
  toast.textContent = String(message);
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 6500);
}
export function openDialog(title, html, onMount) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'campus-dialog';
  dialog.setAttribute('aria-labelledby', 'dialog-title-' + Date.now());
  dialog.innerHTML = `<div class="dialog-header"><h2 id="${dialog.getAttribute('aria-labelledby')}">${escapeHTML(title)}</h2><button type="button" class="dialog-close" data-close-dialog aria-label="닫기">×</button></div><div class="dialog-body">${html}</div>`;
  dialog.addEventListener('click', event => {
    if (dialog.dataset.busy === 'true') return;
    if (event.target.closest('[data-close-dialog]')) dialog.close();
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    }
  });
  dialog.addEventListener('cancel', event => { if (dialog.dataset.busy === 'true') event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus({preventScroll: true}); }, {once: true});
  document.body.append(dialog);
  dialog.showModal();
  onMount?.(dialog);
  return dialog;
}
