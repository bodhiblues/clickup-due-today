const API_BASE = 'https://api.clickup.com/api/v2';

// Default settings
const defaultSettings = {
  features: {
    overdue: false,
    dueTime: true,
    timeTracked: true,
    completedCount: true,
    grouping: false,
    badge: true,
    timeTracking: true,
    snooze: true,
    filters: true,
    notifications: false
  },
  notificationMinutes: 15
};

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const errorMessageEl = document.getElementById('error-message');
const tasksContainerEl = document.getElementById('tasks-container');
const tasksListEl = document.getElementById('tasks-list');
const noTasksEl = document.getElementById('no-tasks');
const taskCountEl = document.getElementById('task-count');
const totalTimeEl = document.getElementById('total-time');
const completedCountEl = document.getElementById('completed-count');
const refreshBtn = document.getElementById('refresh-btn');
const settingsBtn = document.getElementById('settings-btn');
const openSettingsLink = document.getElementById('open-settings');

// Filter elements
const filtersBar = document.getElementById('filters-bar');
const workspaceFilter = document.getElementById('workspace-filter');
const sortSelect = document.getElementById('sort-select');
const overdueToggle = document.getElementById('overdue-toggle');
const overdueToggleContainer = document.getElementById('overdue-toggle-container');
const completedToggle = document.getElementById('completed-toggle');

// Snooze modal elements
const snoozeModal = document.getElementById('snooze-modal');
const snoozeTaskName = document.getElementById('snooze-task-name');
const snoozeCancel = document.getElementById('snooze-cancel');
const snoozeOptions = document.querySelectorAll('.snooze-option');

// State
let apiKey = '';
let settings = defaultSettings;
let allTasks = [];
let teams = [];
let spaces = {}; // spaceId -> spaceName lookup
let activeTimers = {}; // taskId -> { startTime, intervalId }
let currentSnoozeTaskId = null;

// Initialize
document.addEventListener('DOMContentLoaded', init);

async function init() {
  const result = await chrome.storage.sync.get(['clickupApiKey', 'settings']);
  apiKey = result.clickupApiKey;
  settings = result.settings || defaultSettings;

  if (!apiKey) {
    showError('Please configure your ClickUp API key in settings.');
    return;
  }

  // Load persisted timer state
  await loadPersistedTimers();

  // Setup UI based on settings
  setupUI();

  // Load tasks
  loadTasks();
}

// Load timer state from storage and resume timers
async function loadPersistedTimers() {
  try {
    const result = await chrome.storage.local.get(['activeTimers']);
    const persistedTimers = result.activeTimers || {};

    // Restore active timers (we'll update the UI after tasks load)
    for (const [taskId, timerData] of Object.entries(persistedTimers)) {
      activeTimers[taskId] = {
        startTime: timerData.startTime,
        pausedDuration: timerData.pausedDuration || 0,
        pausedAt: timerData.pausedAt || null,
        intervalId: null // Will be set up when task element is rendered
      };
    }
  } catch (err) {
    console.error('Error loading persisted timers:', err);
  }
}

// Save timer state to storage
async function persistTimerState() {
  try {
    const timersToSave = {};
    for (const [taskId, timerData] of Object.entries(activeTimers)) {
      timersToSave[taskId] = {
        startTime: timerData.startTime,
        pausedDuration: timerData.pausedDuration || 0,
        pausedAt: timerData.pausedAt || null
      };
    }
    await chrome.storage.local.set({ activeTimers: timersToSave });
  } catch (err) {
    console.error('Error persisting timer state:', err);
  }
}

// Calculate effective elapsed time (excluding paused duration)
function getEffectiveElapsed(timerData) {
  const now = Date.now();
  let elapsed = now - timerData.startTime;

  // Subtract total paused duration
  elapsed -= (timerData.pausedDuration || 0);

  // If currently paused, also subtract time since pause started
  if (timerData.pausedAt) {
    elapsed -= (now - timerData.pausedAt);
  }

  return Math.max(0, elapsed);
}

function setupUI() {
  // Show/hide filters bar
  if (settings.features.filters) {
    filtersBar.classList.remove('hidden');
  } else {
    filtersBar.classList.add('hidden');
  }

  // Show/hide overdue toggle (only in filters if overdue feature is enabled via settings page)
  if (settings.features.overdue) {
    overdueToggle.checked = true;
  }

  // Show/hide completed count
  if (!settings.features.completedCount) {
    completedCountEl.classList.add('hidden');
  }
}

// Event listeners
refreshBtn.addEventListener('click', loadTasks);
settingsBtn.addEventListener('click', openSettings);
openSettingsLink.addEventListener('click', (e) => {
  e.preventDefault();
  openSettings();
});

// Filter event listeners
workspaceFilter.addEventListener('change', () => renderTasks(allTasks));
sortSelect.addEventListener('change', () => renderTasks(allTasks));
overdueToggle.addEventListener('change', loadTasks);
completedToggle.addEventListener('change', loadTasks);

// Snooze modal event listeners
snoozeCancel.addEventListener('click', closeSnoozeModal);
snoozeOptions.forEach(btn => {
  btn.addEventListener('click', () => {
    const days = parseInt(btn.dataset.days, 10);
    snoozeTask(currentSnoozeTaskId, days);
  });
});

function openSettings() {
  chrome.runtime.openOptionsPage();
}

function showLoading() {
  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  tasksContainerEl.classList.add('hidden');
}

function showError(message) {
  loadingEl.classList.add('hidden');
  errorEl.classList.remove('hidden');
  tasksContainerEl.classList.add('hidden');
  errorMessageEl.textContent = message;
}

function showTasks() {
  loadingEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  tasksContainerEl.classList.remove('hidden');
}

async function loadTasks() {
  showLoading();

  try {
    // Get the current user
    const userResponse = await fetchAPI('/user');
    const currentUserId = userResponse.user.id;

    // Get the user's teams (workspaces)
    const teamsResponse = await fetchAPI('/team');
    teams = teamsResponse.teams || [];

    if (teams.length === 0) {
      showError('No workspaces found.');
      return;
    }

    // Fetch spaces for each team to build space name lookup
    spaces = {};
    for (const team of teams) {
      try {
        const spacesResponse = await fetchAPI(`/team/${team.id}/space`);
        if (spacesResponse.spaces) {
          spacesResponse.spaces.forEach(space => {
            spaces[space.id] = space.name;
          });
        }
      } catch (err) {
        console.error(`Error fetching spaces for team ${team.name}:`, err);
      }
    }

    // Populate workspace filter
    populateWorkspaceFilter();

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();

    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndMs = todayEnd.getTime();

    // Check if we should include overdue tasks
    const includeOverdue = settings.features.overdue || overdueToggle.checked;

    // Check if we should include completed tasks
    const includeCompleted = completedToggle.checked;

    // Fetch tasks
    allTasks = [];

    for (const team of teams) {
      try {
        let url;
        const includeClosed = includeCompleted ? 'true' : 'false';
        if (includeOverdue) {
          url = `/team/${team.id}/task?assignees[]=${currentUserId}&due_date_lt=${todayEndMs + 1}&include_closed=${includeClosed}&subtasks=true`;
        } else {
          url = `/team/${team.id}/task?assignees[]=${currentUserId}&due_date_gt=${todayStart - 1}&due_date_lt=${todayEndMs + 1}&include_closed=${includeClosed}&subtasks=true`;
        }

        const tasksResponse = await fetchAPI(url);

        if (tasksResponse.tasks) {
          const filteredTasks = tasksResponse.tasks.filter(task => {
            if (!task.due_date) return false;
            const dueDate = parseInt(task.due_date, 10);
            if (includeOverdue) {
              return dueDate <= todayEndMs;
            } else {
              return dueDate >= todayStart && dueDate <= todayEndMs;
            }
          });

          filteredTasks.forEach(task => {
            task.teamName = team.name;
            task.teamId = team.id;
            task.isOverdue = parseInt(task.due_date, 10) < todayStart;
            task.isCompleted = task.status?.type === 'closed';
            allTasks.push(task);
          });
        }
      } catch (err) {
        console.error(`Error fetching tasks for team ${team.name}:`, err);
      }
    }

    // Load completed today count if enabled
    if (settings.features.completedCount) {
      loadCompletedCount(currentUserId, todayStart, todayEndMs);
    }

    renderTasks(allTasks);

    // Update badge
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' });

  } catch (err) {
    console.error('Error loading tasks:', err);
    if (err.message.includes('401')) {
      showError('Invalid API key. Please check your settings.');
    } else {
      showError(`Failed to load tasks: ${err.message}`);
    }
  }
}

async function loadCompletedCount(userId, todayStart, todayEnd) {
  try {
    let completedCount = 0;

    for (const team of teams) {
      try {
        const response = await fetchAPI(
          `/team/${team.id}/task?assignees[]=${userId}&date_done_gt=${todayStart}&date_done_lt=${todayEnd + 1}&include_closed=true&subtasks=true`
        );

        if (response.tasks) {
          completedCount += response.tasks.filter(t => t.status?.type === 'closed').length;
        }
      } catch (err) {
        console.error(`Error fetching completed tasks for team ${team.name}:`, err);
      }
    }

    if (completedCount > 0) {
      completedCountEl.textContent = `${completedCount} completed`;
      completedCountEl.classList.remove('hidden');
    } else {
      completedCountEl.classList.add('hidden');
    }
  } catch (err) {
    console.error('Error loading completed count:', err);
  }
}

function populateWorkspaceFilter() {
  workspaceFilter.innerHTML = '<option value="all">All Workspaces</option>';
  teams.forEach(team => {
    const option = document.createElement('option');
    option.value = team.id;
    option.textContent = team.name;
    workspaceFilter.appendChild(option);
  });
}

async function fetchAPI(endpoint) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

function renderTasks(tasks) {
  showTasks();
  tasksListEl.innerHTML = '';

  // Apply workspace filter
  const selectedWorkspace = workspaceFilter.value;
  let filteredTasks = tasks;
  if (selectedWorkspace !== 'all') {
    filteredTasks = tasks.filter(t => t.teamId === selectedWorkspace);
  }

  // Apply sorting
  const sortBy = sortSelect.value;
  filteredTasks = sortTasks(filteredTasks, sortBy);

  if (filteredTasks.length === 0) {
    noTasksEl.classList.remove('hidden');
    taskCountEl.textContent = '0 tasks';
    totalTimeEl.textContent = '';
    return;
  }

  noTasksEl.classList.add('hidden');
  taskCountEl.textContent = `${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''}`;

  // Calculate total time estimate
  const totalMs = filteredTasks.reduce((sum, task) => sum + (task.time_estimate || 0), 0);
  const totalFormatted = formatTimeEstimate(totalMs);
  totalTimeEl.textContent = totalFormatted ? `Total: ${totalFormatted}` : '';

  // Render tasks (grouped or flat)
  if (settings.features.grouping) {
    renderGroupedTasks(filteredTasks);
  } else {
    filteredTasks.forEach(task => {
      const taskEl = createTaskElement(task);
      tasksListEl.appendChild(taskEl);
    });
  }
}

function sortTasks(tasks, sortBy) {
  const sorted = [...tasks];

  switch (sortBy) {
    case 'priority':
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3, null: 4 };
      sorted.sort((a, b) => {
        const aPriority = a.priority ? a.priority.priority : 'null';
        const bPriority = b.priority ? b.priority.priority : 'null';
        return (priorityOrder[aPriority] || 4) - (priorityOrder[bPriority] || 4);
      });
      break;

    case 'due-time':
      sorted.sort((a, b) => {
        const aTime = a.due_date ? parseInt(a.due_date, 10) : Infinity;
        const bTime = b.due_date ? parseInt(b.due_date, 10) : Infinity;
        return aTime - bTime;
      });
      break;

    case 'estimate':
      sorted.sort((a, b) => {
        const aEst = a.time_estimate || 0;
        const bEst = b.time_estimate || 0;
        return bEst - aEst; // Higher estimates first
      });
      break;

    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  return sorted;
}

function renderGroupedTasks(tasks) {
  // Group by list
  const groups = {};
  tasks.forEach(task => {
    const listName = task.list?.name || 'No List';
    if (!groups[listName]) {
      groups[listName] = [];
    }
    groups[listName].push(task);
  });

  // Render each group
  Object.keys(groups).sort().forEach(listName => {
    const groupEl = document.createElement('div');
    groupEl.className = 'task-group';

    const headerEl = document.createElement('div');
    headerEl.className = 'task-group-header';
    headerEl.innerHTML = `
      <span>${escapeHtml(listName)}</span>
      <span class="group-count">${groups[listName].length}</span>
    `;
    groupEl.appendChild(headerEl);

    const tasksEl = document.createElement('div');
    tasksEl.className = 'tasks-list';
    groups[listName].forEach(task => {
      const taskEl = createTaskElement(task);
      tasksEl.appendChild(taskEl);
    });
    groupEl.appendChild(tasksEl);

    tasksListEl.appendChild(groupEl);
  });
}

function createTaskElement(task) {
  const div = document.createElement('div');
  div.className = 'task-item';
  div.dataset.taskId = task.id;

  if (task.isOverdue) {
    div.classList.add('overdue');
  }

  if (task.isCompleted) {
    div.classList.add('completed');
  }

  // Priority info
  const priority = task.priority ? task.priority.priority : null;
  const priorityClass = priority ? `priority-${priority}` : 'priority-normal';
  const priorityLabel = priority ? priority.charAt(0).toUpperCase() + priority.slice(1) : 'Normal';

  // Status info
  const statusColor = task.status?.color || '#808080';
  const statusName = task.status?.status || 'Unknown';

  // List/folder info
  const listName = task.list?.name || '';

  // Time estimate
  const timeEstimate = formatTimeEstimate(task.time_estimate);

  // Due time display
  let dueTimeHtml = '';
  if (settings.features.dueTime && task.due_date) {
    const dueDate = new Date(parseInt(task.due_date, 10));
    const now = new Date();
    // Use ClickUp's due_date_time flag to check if a time was explicitly set
    const hasTime = task.due_date_time === true;

    if (hasTime) {
      const timeStr = dueDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      let dueClass = '';

      if (task.isOverdue) {
        dueClass = 'overdue';
      } else if (dueDate - now < 3600000) { // Less than 1 hour
        dueClass = 'soon';
      }

      dueTimeHtml = `<span class="task-due-time ${dueClass}">${task.isOverdue ? 'Overdue' : `Due ${timeStr}`}</span>`;
    } else if (task.isOverdue) {
      dueTimeHtml = `<span class="task-due-time overdue">Overdue</span>`;
    }
  }

  // Time tracked vs estimated
  let timeTrackedHtml = '';
  if (settings.features.timeTracked && task.time_spent && task.time_estimate) {
    const tracked = task.time_spent;
    const estimated = task.time_estimate;
    const trackedStr = formatTimeEstimate(tracked);
    const estimatedStr = formatTimeEstimate(estimated);
    const overEstimate = tracked > estimated;

    timeTrackedHtml = `<span class="task-time-info ${overEstimate ? 'over-estimate' : ''}">${trackedStr} / ${estimatedStr}</span>`;
  } else if (settings.features.timeTracked && task.time_spent) {
    const trackedStr = formatTimeEstimate(task.time_spent);
    timeTrackedHtml = `<span class="task-time-info">${trackedStr} tracked</span>`;
  }

  // Build breadcrumb trail (Space > Folder > List)
  let breadcrumbHtml = '';
  const spaceName = task.space?.id ? spaces[task.space.id] : null;
  const folderName = task.folder?.name && task.folder.name !== 'hidden' ? task.folder.name : null;
  const breadcrumbListName = task.list?.name;

  if (spaceName || folderName || breadcrumbListName) {
    breadcrumbHtml = '<div class="task-breadcrumb">';
    const parts = [];

    if (spaceName) {
      parts.push(`<span class="breadcrumb-item breadcrumb-space">${escapeHtml(spaceName)}</span>`);
    }
    if (folderName) {
      parts.push(`<span class="breadcrumb-item breadcrumb-folder">${escapeHtml(folderName)}</span>`);
    }
    if (breadcrumbListName) {
      parts.push(`<span class="breadcrumb-item breadcrumb-list">${escapeHtml(breadcrumbListName)}</span>`);
    }

    breadcrumbHtml += parts.join('<span class="breadcrumb-separator">›</span>');
    breadcrumbHtml += '</div>';
  }

  // Build task actions
  let actionsHtml = '';
  if (settings.features.timeTracking || settings.features.snooze) {
    actionsHtml = '<div class="task-actions">';

    if (settings.features.timeTracking) {
      const isTimerActive = activeTimers[task.id];
      actionsHtml += `
        <button class="task-action-btn timer-btn ${isTimerActive ? 'timer-active' : ''}" data-task-id="${task.id}">
          ${isTimerActive ? '<span class="timer-dot"></span>' : ''}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${isTimerActive
              ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
              : '<polygon points="5 3 19 12 5 21 5 3"/>'
            }
          </svg>
          <span class="timer-text">${isTimerActive ? formatTimer(Date.now() - isTimerActive.startTime) : 'Start'}</span>
        </button>
      `;
    }

    if (settings.features.snooze) {
      actionsHtml += `
        <button class="task-action-btn snooze-btn" data-task-id="${task.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10"/>
            <polyline points="12 6 12 12 16 14"/>
            <path d="M17 3l4 4"/>
            <path d="M21 3l-4 4"/>
          </svg>
          Snooze
        </button>
      `;
    }

    actionsHtml += '</div>';
  }

  div.innerHTML = `
    <div class="task-main">
      <div class="task-checkbox" title="Mark as complete"></div>
      <div class="task-content">
        <div class="task-name">${escapeHtml(task.name)}</div>
        ${breadcrumbHtml}
        <div class="task-meta">
          <span class="task-status" style="background: ${statusColor}20; color: ${statusColor}">
            ${escapeHtml(statusName)}
          </span>
          ${priority ? `
            <span class="task-priority">
              <span class="priority-dot ${priorityClass}"></span>
              ${priorityLabel}
            </span>
          ` : ''}
          ${dueTimeHtml}
          ${timeEstimate ? `<span class="task-time-estimate">${timeEstimate}</span>` : ''}
          ${timeTrackedHtml}
        </div>
      </div>
    </div>
    ${actionsHtml}
  `;

  // Click on content to open task
  const contentEl = div.querySelector('.task-content');
  contentEl.addEventListener('click', () => {
    chrome.tabs.create({ url: task.url });
  });

  // Click on checkbox to complete task
  const checkboxEl = div.querySelector('.task-checkbox');
  checkboxEl.addEventListener('click', (e) => {
    e.stopPropagation();
    completeTask(task.id, div);
  });

  // Timer button
  const timerBtn = div.querySelector('.timer-btn');
  if (timerBtn) {
    timerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTimer(task.id, timerBtn);
    });

    // Resume interval for persisted timers
    if (activeTimers[task.id] && !activeTimers[task.id].intervalId) {
      activeTimers[task.id].intervalId = setInterval(() => {
        const elapsed = getEffectiveElapsed(activeTimers[task.id]);
        const timerText = timerBtn.querySelector('.timer-text');
        if (timerText) {
          timerText.textContent = formatTimer(elapsed);
        }
      }, 1000);

      // Update display immediately
      const timerText = timerBtn.querySelector('.timer-text');
      if (timerText) {
        timerText.textContent = formatTimer(getEffectiveElapsed(activeTimers[task.id]));
      }
    }
  }

  // Snooze button
  const snoozeBtn = div.querySelector('.snooze-btn');
  if (snoozeBtn) {
    snoozeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSnoozeModal(task.id, task.name);
    });
  }

  return div;
}

async function completeTask(taskId, taskElement) {
  const checkboxEl = taskElement.querySelector('.task-checkbox');
  checkboxEl.classList.add('completing');
  taskElement.classList.add('completed');

  try {
    await fetch(`${API_BASE}/task/${taskId}`, {
      method: 'PUT',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'closed'
      })
    });

    // Stop timer if running
    if (activeTimers[taskId]) {
      if (activeTimers[taskId].intervalId) {
        clearInterval(activeTimers[taskId].intervalId);
      }
      delete activeTimers[taskId];
      persistTimerState();

      // Notify background about timer state change
      const hasActiveTimers = Object.keys(activeTimers).length > 0;
      chrome.runtime.sendMessage({
        type: hasActiveTimers ? 'TIMER_STARTED' : 'TIMER_STOPPED'
      });
    }

    setTimeout(() => {
      taskElement.style.opacity = '0';
      taskElement.style.transform = 'translateX(20px)';
      taskElement.style.transition = 'all 0.3s ease';

      setTimeout(() => {
        taskElement.remove();
        allTasks = allTasks.filter(t => t.id !== taskId);
        updateTaskCount();
        chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' });
      }, 300);
    }, 500);

  } catch (err) {
    console.error('Error completing task:', err);
    checkboxEl.classList.remove('completing');
    taskElement.classList.remove('completed');
    alert('Failed to complete task. Please try again.');
  }
}

function toggleTimer(taskId, button) {
  if (activeTimers[taskId]) {
    // Stop timer and log time
    stopTimer(taskId, button);
  } else {
    // Start timer
    startTimer(taskId, button);
  }
}

function startTimer(taskId, button) {
  const startTime = Date.now();

  activeTimers[taskId] = {
    startTime,
    pausedDuration: 0,
    pausedAt: null,
    intervalId: setInterval(() => {
      const elapsed = getEffectiveElapsed(activeTimers[taskId]);
      const timerText = button.querySelector('.timer-text');
      if (timerText) {
        timerText.textContent = formatTimer(elapsed);
      }
    }, 1000)
  };

  button.classList.add('timer-active');
  button.innerHTML = `
    <span class="timer-dot"></span>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>
    </svg>
    <span class="timer-text">0:00</span>
  `;

  // Persist timer state and notify background
  persistTimerState();
  chrome.runtime.sendMessage({ type: 'TIMER_STARTED', taskId });
}

async function stopTimer(taskId, button) {
  const timer = activeTimers[taskId];
  if (!timer) return;

  if (timer.intervalId) {
    clearInterval(timer.intervalId);
  }

  // Calculate effective elapsed time (excluding paused time)
  const effectiveElapsed = getEffectiveElapsed(timer);

  // Log time to ClickUp
  try {
    await fetch(`${API_BASE}/task/${taskId}/time`, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        duration: effectiveElapsed,
        start: timer.startTime,
        end: Date.now()
      })
    });
  } catch (err) {
    console.error('Error logging time:', err);
  }

  delete activeTimers[taskId];

  button.classList.remove('timer-active');
  button.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    <span class="timer-text">Start</span>
  `;

  // Persist timer state and notify background
  persistTimerState();
  const hasActiveTimers = Object.keys(activeTimers).length > 0;
  chrome.runtime.sendMessage({
    type: hasActiveTimers ? 'TIMER_STARTED' : 'TIMER_STOPPED'
  });

  // Refresh to show updated time
  loadTasks();
}

function formatTimer(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function openSnoozeModal(taskId, taskName) {
  currentSnoozeTaskId = taskId;
  snoozeTaskName.textContent = taskName;
  snoozeModal.classList.remove('hidden');
}

function closeSnoozeModal() {
  currentSnoozeTaskId = null;
  snoozeModal.classList.add('hidden');
}

async function snoozeTask(taskId, days) {
  if (!taskId) return;

  const newDueDate = new Date();
  newDueDate.setDate(newDueDate.getDate() + days);
  newDueDate.setHours(9, 0, 0, 0); // Set to 9 AM

  try {
    await fetch(`${API_BASE}/task/${taskId}`, {
      method: 'PUT',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        due_date: newDueDate.getTime()
      })
    });

    closeSnoozeModal();

    // Remove task from list
    const taskEl = document.querySelector(`[data-task-id="${taskId}"]`);
    if (taskEl) {
      taskEl.style.opacity = '0';
      taskEl.style.transform = 'translateX(20px)';
      taskEl.style.transition = 'all 0.3s ease';

      setTimeout(() => {
        taskEl.remove();
        allTasks = allTasks.filter(t => t.id !== taskId);
        updateTaskCount();
        chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' });
      }, 300);
    }

  } catch (err) {
    console.error('Error snoozing task:', err);
    alert('Failed to snooze task. Please try again.');
  }
}

function updateTaskCount() {
  const remainingTasks = tasksListEl.querySelectorAll('.task-item').length;
  taskCountEl.textContent = `${remainingTasks} task${remainingTasks !== 1 ? 's' : ''}`;

  // Recalculate total time
  const totalMs = allTasks.reduce((sum, task) => sum + (task.time_estimate || 0), 0);
  const totalFormatted = formatTimeEstimate(totalMs);
  totalTimeEl.textContent = totalFormatted ? `Total: ${totalFormatted}` : '';

  if (remainingTasks === 0) {
    noTasksEl.classList.remove('hidden');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTimeEstimate(ms) {
  if (!ms) return null;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  }
  return null;
}
