/*
 * script.js for the Team Score Tracker
 *
 * This file handles authentication for multiple admins, score management,
 * history logging, real-time scoreboard updates and exporting data to CSV
 * (which Excel can open). It uses localStorage to persist state between
 * sessions.
 */
(function () {
  const DATA_KEY = 'scoreTrackerData';
  // Define team colours and names
  const TEAMS = [
    { name: 'BLUE', color: '#3498db' },
    { name: 'GREEN', color: '#2ecc71' },
    { name: 'ORANGE', color: '#ff5300' },
    { name: 'PINK', color: '#e91e63' },
    { name: 'RED', color: '#e74c3c' },
    { name: 'YELLOW', color: '#f1c40f' },
  ];
  // Define admins with a simple shared password
  const ADMINS = [
    { user: 'Pailin', pass: 'pass123' },
    { user: 'Paulyne', pass: 'pass123' },
    { user: 'Praw', pass: 'pass123' },
  ];
  let currentAdmin = null;
  let flashMessage = null;
  // Holds a pending score change before confirmation
  let pendingChange = null;

  // Reference to the Chart.js instance for the live bar chart
  let scoreChart = null;

  /**
   * Load persisted state from localStorage or initialise a new structure.
   * State structure:
   * {
   *   scores: { BLUE: number, GREEN: number, ... },
   *   history: Array<{ time: string, admin: string, team: string, delta: number, note: string }>,
   *   lastUpdate: string (ISO timestamp)
   * }
   */
  function loadState() {
    const stored = localStorage.getItem(DATA_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {
        console.warn('Failed to parse stored score data, reinitialising.', e);
      }
    }
    // initialise with zero scores and empty history
    const scores = {};
    TEAMS.forEach((team) => {
      scores[team.name] = 0;
    });
    const state = { scores, history: [], lastUpdate: null };
    saveState(state);
    return state;
  }

  /**
   * Persist current state to localStorage
   * @param {Object} state
   */
  function saveState(state) {
    localStorage.setItem(DATA_KEY, JSON.stringify(state));
  }

  /**
   * Render the entire application based on login status and state.
   */
  function renderApp() {
    const state = loadState();
    const container = document.getElementById('app');
    let html = '';

    // Show flash message if exists
    if (flashMessage) {
      html += `<div class="message ${flashMessage.type}">${flashMessage.text}</div>`;
      flashMessage = null;
    }

    if (!currentAdmin) {
      // Not logged in: render login form
      html += `<div class="card">
                <h2>Admin Login</h2>
                <p>Please select your name and enter the password.</p>
                <form id="loginForm">
                  <select id="adminSelect">
                    ${ADMINS.map((a) => `<option value="${a.user}">${a.user}</option>`).join('')}
                  </select>
                  <input type="password" id="adminPass" placeholder="Password">
                  <button type="submit">Login</button>
                </form>
              </div>`;
      container.innerHTML = html;
      // Attach login handler
      document.getElementById('loginForm').addEventListener('submit', function (e) {
        e.preventDefault();
        const user = document.getElementById('adminSelect').value;
        const pass = document.getElementById('adminPass').value;
        const admin = ADMINS.find((a) => a.user === user);
        if (admin && admin.pass === pass) {
          currentAdmin = user;
          flashMessage = { type: 'success', text: `Welcome, ${user}!` };
          renderApp();
        } else {
          flashMessage = { type: 'error', text: 'Invalid credentials.' };
          renderApp();
        }
      });
      return;
    }

    // Logged in: show admin interface
    html += `<div class="card">
              <h2>Scoreboard</h2>
              <div class="scoreboard">
                ${TEAMS.map((team) => {
                  const score = state.scores[team.name];
                  return `<div class="score-item" style="background-color: ${team.color};">
                              <span>${team.name}</span>
                              <span class="score">${score}</span>
                          </div>`;
                }).join('')}
              </div>
              <p style="margin-top:10px; font-size:0.9em; color:#666;">Last updated: ${state.lastUpdate ? new Date(state.lastUpdate).toLocaleString() : 'Never'}</p>
            </div>`;

    // Insert a live bar chart showing scores proportionally for each team
    html += `<div class="card">
              <h2>Score Chart</h2>
              <canvas id="scoreChartCanvas" style="width:100%;max-width:100%;"></canvas>
            </div>`;

    // Add/Remove score controls. Note input is placed above the score buttons for clarity.
    html += `<div class="card">
              <h2>Update Score</h2>
              <form id="scoreForm">
                <label style="display:block;margin-bottom:5px;">Select Team:</label>
                <select id="teamSelect">
                  ${TEAMS.map((t) => `<option value="${t.name}">${t.name}</option>`).join('')}
                </select>
                <div style="margin-top:10px;">
                  <input type="text" id="noteInput" placeholder="Note (optional)" style="width:70%;">
                </div>
                <div style="margin-top:10px;">
                  ${[1,5,10].map((n) => {
                    return `<button type="button" class="score-btn" data-delta="${n}">+${n}</button>`;
                  }).join('')}
                  ${[1,5,10].map((n) => {
                    return `<button type="button" class="score-btn" data-delta="-${n}" style="margin-left:5px;">-${n}</button>`;
                  }).join('')}
                </div>
              </form>
            </div>`;

    // If there is a pending change, show a confirmation preview
    if (pendingChange) {
      const sign = pendingChange.delta > 0 ? '+' + pendingChange.delta : pendingChange.delta;
      html += `<div class="card" id="confirmCard">
                <h3>Pending Update</h3>
                <p>You are about to change <strong>${pendingChange.team}</strong> by <strong>${sign}</strong> points.</p>
                ${pendingChange.note ? `<p>Note: ${pendingChange.note}</p>` : ''}
                <div style="margin-top:10px;">
                  <button id="confirmBtn">Confirm</button>
                  <button id="cancelBtn" style="margin-left:10px; background-color:#ccc; color:#333;">Cancel</button>
                </div>
              </div>`;
    }

    // History section
    html += `<div class="card">
              <h2>History</h2>`;
    if (state.history.length === 0) {
      html += `<p>No history yet.</p>`;
    } else {
      html += `<table>
                <thead><tr><th>Time</th><th>Team</th><th>Change</th><th>Admin</th><th>Note</th></tr></thead>
                <tbody>
                  ${state.history.map((entry) => {
                    return `<tr>
                              <td>${new Date(entry.time).toLocaleString()}</td>
                              <td>${entry.team}</td>
                              <td>${entry.delta > 0 ? '+' + entry.delta : entry.delta}</td>
                              <td>${entry.admin}</td>
                              <td>${entry.note || ''}</td>
                            </tr>`;
                  }).join('')}
                </tbody>
              </table>`;
    }
    html += `</div>`;

    // Export and Reset buttons
    html += `<div class="card" style="display:flex; gap:10px; flex-wrap:wrap;">
              <button id="exportBtn">Export to Excel</button>
              <button id="resetScoresBtn">Reset Scores</button>
              <button id="logoutBtn">Log out</button>
            </div>`;

    container.innerHTML = html;

    // Attach event handlers
    // Score buttons
    document.querySelectorAll('.score-btn').forEach((btn) => {
      btn.addEventListener('click', function () {
        const delta = parseInt(this.getAttribute('data-delta'), 10);
        const team = document.getElementById('teamSelect').value;
        const note = document.getElementById('noteInput').value.trim();
        // Set pending change and re-render for confirmation
        pendingChange = { team, delta, note };
        renderApp();
      });
    });
    // Export history to CSV
    document.getElementById('exportBtn').addEventListener('click', function () {
      exportHistoryToCSV(state.history);
    });
    // Reset scores
    document.getElementById('resetScoresBtn').addEventListener('click', function () {
      if (!confirm('Are you sure you want to reset all scores and clear history?')) return;
      // Reset scores and history
      TEAMS.forEach((t) => {
        state.scores[t.name] = 0;
      });
      state.history = [];
      state.lastUpdate = null;
      saveState(state);
      flashMessage = { type: 'success', text: 'All scores have been reset.' };
      renderApp();
    });
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', function () {
      currentAdmin = null;
      flashMessage = { type: 'success', text: 'Logged out.' };
      renderApp();
    });

    // Attach confirm / cancel handlers if pending change exists
    if (pendingChange) {
      const confirmBtn = document.getElementById('confirmBtn');
      const cancelBtn = document.getElementById('cancelBtn');
      confirmBtn.addEventListener('click', function () {
        // Clear pending change first so render does not show preview
        const change = pendingChange;
        pendingChange = null;
        applyScoreChange(change.team, change.delta, change.note);
      });
      cancelBtn.addEventListener('click', function () {
        pendingChange = null;
        flashMessage = { type: 'error', text: 'Update cancelled.' };
        renderApp();
      });
    }

    // Update live bar chart after rendering
    updateChart(state);
  }

  /**
   * Apply a score change to a team, record history and update last update time.
   * @param {string} team
   * @param {number} delta
   * @param {string} note
   */
  function applyScoreChange(team, delta, note) {
    const state = loadState();
    if (!state.scores.hasOwnProperty(team)) return;
    state.scores[team] += delta;
    state.history.push({ time: new Date().toISOString(), admin: currentAdmin, team, delta, note });
    state.lastUpdate = new Date().toISOString();
    saveState(state);
    flashMessage = { type: 'success', text: `Updated ${team} by ${delta > 0 ? '+' + delta : delta} points.` };
    renderApp();
  }

  /**
   * Export history to CSV and trigger download. Excel can open CSV files.
   * @param {Array} history
   */
  function exportHistoryToCSV(history) {
    if (!history || history.length === 0) {
      flashMessage = { type: 'error', text: 'No history to export.' };
      renderApp();
      return;
    }
    const header = ['Time', 'Team', 'Change', 'Admin', 'Note'];
    const rows = history.map((entry) => [
      new Date(entry.time).toLocaleString(),
      entry.team,
      (entry.delta > 0 ? '+' + entry.delta : entry.delta),
      entry.admin,
      entry.note || ''
    ]);
    // Convert each item to a string before replacing quotes. Numbers do not have a replace method,
    // so calling String(item) ensures safe replacement and avoids runtime errors during export.
    const csvContent = [header, ...rows]
      .map((r) =>
        r
          .map((item) => {
            const s = String(item);
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(',')
      )
      .join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'score_history.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // Initial render on page load
  document.addEventListener('DOMContentLoaded', function () {
    renderApp();
  });

  /**
   * Update or create the live bar chart representing team scores. Uses Chart.js.
   * If an existing chart is present, it will update the data; otherwise it
   * creates a new bar chart. Each bar corresponds to a team and is coloured
   * according to the team's colour. The y-axis begins at zero.
   * @param {Object} state
   */
  function updateChart(state) {
    // Ensure the canvas exists in the DOM
    const canvas = document.getElementById('scoreChartCanvas');
    if (!canvas || typeof Chart === 'undefined') {
      return;
    }
    const ctx = canvas.getContext('2d');
    const labels = TEAMS.map((t) => t.name);
    const data = labels.map((name) => state.scores[name]);
    const colours = TEAMS.map((t) => t.color);
    // Chart.js expects values not all equal; when all values are zero, we still want a chart.
    if (scoreChart) {
      scoreChart.data.labels = labels;
      scoreChart.data.datasets[0].data = data;
      scoreChart.data.datasets[0].backgroundColor = colours;
      scoreChart.update();
    } else {
      scoreChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Score',
              data: data,
              backgroundColor: colours,
            },
          ],
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              display: false,
            },
            tooltip: {
              callbacks: {
                // Format tooltip to display team name and score with sign if needed
                label: function (context) {
                  const value = context.parsed.y;
                  return `${context.label}: ${value}`;
                },
              },
            },
          },
          scales: {
            y: {
              beginAtZero: true,
            },
          },
        },
      });
    }
  }
})();