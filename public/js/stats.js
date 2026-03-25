/* stats.js – statistics page logic */
'use strict';

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

(async () => {
  const me = await App.requireAuth();
  if (!me) return;
  App.initNavbar(me);

  const showAllLabel = document.getElementById('show-all-label');
  const showAllCb = document.getElementById('show-all');
  const daysSelect = document.getElementById('days-select');
  const colUser = document.getElementById('col-user');
  let timelineChart = null;

  if (me.isAdmin) {
    showAllLabel.style.display = 'flex';
    showAllCb.addEventListener('change', () => {
      colUser.style.display = showAllCb.checked ? '' : 'none';
      load();
    });
  }
  daysSelect.addEventListener('change', load);

  async function load() {
    const all = me.isAdmin && showAllCb.checked ? '&all=1' : '';
    const days = daysSelect.value;

    const [stats, timeline] = await Promise.all([
      App.api(`/api/stats?${all}`).catch(() => []),
      App.api(`/api/stats/timeline?days=${days}${all}`).catch(() => []),
    ]);

    renderStatCards(stats);
    renderTable(stats);
    renderTimeline(timeline, days);
  }

  function renderStatCards(stats) {
    const total = stats.reduce((s, r) => s + (r.view_count || 0), 0);
    const top = stats.length ? stats[0] : null;
    document.getElementById('stat-grid').innerHTML = `
      <div class="stat-card"><div class="stat-label">Total images</div><div class="stat-value">${stats.length}</div></div>
      <div class="stat-card"><div class="stat-label">Total views</div><div class="stat-value">${total}</div></div>
      <div class="stat-card"><div class="stat-label">Most viewed</div>
        <div class="stat-value" style="font-size:1rem;word-break:break-all">${top ? escHtml(top.slug) : '\u2014'}</div></div>
    `;
  }

  function renderTable(stats) {
    const tbody = document.getElementById('stats-tbody');
    const showUser = me.isAdmin && showAllCb.checked;
    if (!stats.length) {
      tbody.innerHTML =
        `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">\uD83D\uDCCA</div><p>No data yet.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = stats
      .map(
        (r) => `
      <tr>
        <td><a href="/i/${escHtml(r.slug)}" target="_blank" rel="noopener noreferrer">${escHtml(r.slug)}</a></td>
        <td ${showUser ? '' : 'style="display:none"'}>${escHtml(r.username || '')}</td>
        <td><strong>${r.view_count}</strong></td>
        <td style="font-size:.82rem">${App.formatDate(r.last_viewed)}</td>
        <td style="font-size:.82rem">${App.formatDate(r.created_at)}</td>
      </tr>`
      )
      .join('');
  }

  function renderTimeline(rows, days) {
    const ctx = document.getElementById('timeline-chart').getContext('2d');
    if (timelineChart) timelineChart.destroy();

    const map = Object.fromEntries(rows.map((r) => [r.day, r.views]));
    const labels = [];
    const data = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(key.slice(5));
      data.push(map[key] || 0);
    }

    timelineChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Views',
            data,
            borderColor: '#4f6ef7',
            backgroundColor: 'rgba(79,110,247,.12)',
            fill: true,
            tension: 0.35,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  load();
})();
