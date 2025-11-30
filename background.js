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

// Track notified tasks to avoid duplicate notifications
const notifiedTasks = new Set();

// Track if a timer is currently recording
let isTimerRecording = false;

// Idle detection threshold (seconds of inactivity before considered idle)
const IDLE_THRESHOLD_SECONDS = 60;

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  // Set up alarm for periodic updates
  chrome.alarms.create('updateBadge', { periodInMinutes: 5 });
  chrome.alarms.create('checkNotifications', { periodInMinutes: 1 });

  // Set idle detection threshold
  chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);

  // Initial update
  checkPersistedTimers();
});

// Also check on startup (for when browser restarts)
chrome.runtime.onStartup.addListener(() => {
  chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);
  checkPersistedTimers();
});

// Listen for idle state changes
chrome.idle.onStateChanged.addListener(async (newState) => {
  try {
    const result = await chrome.storage.local.get(['activeTimers']);
    const activeTimers = result.activeTimers || {};

    // No active timers, nothing to do
    if (Object.keys(activeTimers).length === 0) {
      return;
    }

    const now = Date.now();

    if (newState === 'idle' || newState === 'locked') {
      // User went idle/locked - pause all timers
      for (const taskId of Object.keys(activeTimers)) {
        if (!activeTimers[taskId].pausedAt) {
          activeTimers[taskId].pausedAt = now;
        }
      }
      await chrome.storage.local.set({ activeTimers });

      // Update badge to show paused state
      chrome.action.setBadgeText({ text: '⏸' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff9800' }); // Orange for paused

    } else if (newState === 'active') {
      // User became active - resume all timers
      for (const taskId of Object.keys(activeTimers)) {
        if (activeTimers[taskId].pausedAt) {
          // Calculate how long the timer was paused
          const pausedDuration = now - activeTimers[taskId].pausedAt;
          activeTimers[taskId].pausedDuration = (activeTimers[taskId].pausedDuration || 0) + pausedDuration;
          activeTimers[taskId].pausedAt = null;
        }
      }
      await chrome.storage.local.set({ activeTimers });

      // Restore recording badge
      if (isTimerRecording) {
        showRecordingBadge();
      }
    }
  } catch (err) {
    console.error('Error handling idle state change:', err);
  }
});

// Check if there are persisted timers and update badge accordingly
async function checkPersistedTimers() {
  try {
    const result = await chrome.storage.local.get(['activeTimers']);
    const persistedTimers = result.activeTimers || {};
    const hasActiveTimers = Object.keys(persistedTimers).length > 0;

    if (hasActiveTimers) {
      isTimerRecording = true;
      showRecordingBadge();
    } else {
      isTimerRecording = false;
      updateBadgeCount();
    }
  } catch (err) {
    console.error('Error checking persisted timers:', err);
    updateBadgeCount();
  }
}

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'updateBadge') {
    updateBadgeCount();
  } else if (alarm.name === 'checkNotifications') {
    checkDueNotifications();
  }
});

// Listen for messages from popup/options
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SETTINGS_UPDATED') {
    updateBadgeCount();
  } else if (message.type === 'UPDATE_BADGE') {
    updateBadgeCount();
  } else if (message.type === 'GET_TASKS') {
    fetchTasks().then(tasks => sendResponse({ tasks }));
    return true; // Keep channel open for async response
  } else if (message.type === 'TIMER_STARTED') {
    isTimerRecording = true;
    showRecordingBadge();
  } else if (message.type === 'TIMER_STOPPED') {
    isTimerRecording = false;
    updateBadgeCount();
  }
});

// Show recording indicator on badge
function showRecordingBadge() {
  chrome.action.setBadgeText({ text: '●' });
  chrome.action.setBadgeBackgroundColor({ color: '#f44336' }); // Red background
}

// Update badge count
async function updateBadgeCount() {
  // If timer is recording, show recording badge instead of count
  if (isTimerRecording) {
    showRecordingBadge();
    return;
  }

  try {
    const { clickupApiKey, settings } = await chrome.storage.sync.get(['clickupApiKey', 'settings']);
    const currentSettings = settings || defaultSettings;

    if (!clickupApiKey || !currentSettings.features.badge) {
      chrome.action.setBadgeText({ text: '' });
      return;
    }

    const tasks = await fetchTasksWithKey(clickupApiKey, currentSettings.features.overdue);

    if (tasks.length > 0) {
      chrome.action.setBadgeText({ text: tasks.length.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#7b68ee' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (err) {
    console.error('Error updating badge:', err);
    chrome.action.setBadgeText({ text: '' });
  }
}

// Check for tasks approaching due time and send notifications
async function checkDueNotifications() {
  try {
    const { clickupApiKey, settings } = await chrome.storage.sync.get(['clickupApiKey', 'settings']);
    const currentSettings = settings || defaultSettings;

    if (!clickupApiKey || !currentSettings.features.notifications) {
      return;
    }

    const tasks = await fetchTasksWithKey(clickupApiKey, false);
    const now = Date.now();
    const notifyBeforeMs = (currentSettings.notificationMinutes || 15) * 60 * 1000;

    for (const task of tasks) {
      if (!task.due_date) continue;

      const dueDate = parseInt(task.due_date, 10);
      const timeUntilDue = dueDate - now;

      // Check if task is due within notification window and hasn't been notified
      if (timeUntilDue > 0 && timeUntilDue <= notifyBeforeMs && !notifiedTasks.has(task.id)) {
        // Send notification
        chrome.notifications.create(task.id, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'Task Due Soon',
          message: `"${task.name}" is due in ${Math.round(timeUntilDue / 60000)} minutes`,
          priority: 2
        });

        notifiedTasks.add(task.id);
      }
    }

    // Clean up old notifications (tasks that are now past due)
    for (const taskId of notifiedTasks) {
      const task = tasks.find(t => t.id === taskId);
      if (!task || (task.due_date && parseInt(task.due_date, 10) < now)) {
        notifiedTasks.delete(taskId);
      }
    }
  } catch (err) {
    console.error('Error checking notifications:', err);
  }
}

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  // notificationId is the task ID
  chrome.storage.sync.get(['clickupApiKey'], async (result) => {
    if (result.clickupApiKey) {
      try {
        const response = await fetch(`${API_BASE}/task/${notificationId}`, {
          headers: {
            'Authorization': result.clickupApiKey,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const task = await response.json();
          if (task.url) {
            chrome.tabs.create({ url: task.url });
          }
        }
      } catch (err) {
        console.error('Error opening task:', err);
      }
    }
  });

  chrome.notifications.clear(notificationId);
});

// Fetch tasks with provided API key
async function fetchTasksWithKey(apiKey, includeOverdue = false) {
  // Check if we have a valid API key
  if (!apiKey) {
    return [];
  }

  try {
    // Get current user
    const userResponse = await fetch(`${API_BASE}/user`, {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!userResponse.ok) {
      console.warn('Failed to get user, status:', userResponse.status);
      return [];
    }
    const userData = await userResponse.json();
    const currentUserId = userData.user.id;

    // Get teams
    const teamsResponse = await fetch(`${API_BASE}/team`, {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!teamsResponse.ok) {
      console.warn('Failed to get teams, status:', teamsResponse.status);
      return [];
    }
    const teamsData = await teamsResponse.json();

    if (!teamsData.teams || teamsData.teams.length === 0) {
      return [];
    }

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();

    const todayEnd = new Date(today);
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndMs = todayEnd.getTime();

    const allTasks = [];

    for (const team of teamsData.teams) {
      try {
        let url;
        if (includeOverdue) {
          // Include overdue: due_date less than end of today
          url = `${API_BASE}/team/${team.id}/task?assignees[]=${currentUserId}&due_date_lt=${todayEndMs + 1}&include_closed=false&subtasks=true`;
        } else {
          // Only today
          url = `${API_BASE}/team/${team.id}/task?assignees[]=${currentUserId}&due_date_gt=${todayStart - 1}&due_date_lt=${todayEndMs + 1}&include_closed=false&subtasks=true`;
        }

        const response = await fetch(url, {
          headers: {
            'Authorization': apiKey,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const data = await response.json();
          if (data.tasks) {
            // Filter tasks
            const filteredTasks = data.tasks.filter(task => {
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
              allTasks.push(task);
            });
          }
        }
      } catch (err) {
        // Suppress network errors which are expected when offline
        if (err.message !== 'Failed to fetch') {
          console.error(`Error fetching tasks for team ${team.name}:`, err);
        }
      }
    }

    return allTasks;
  } catch (err) {
    // Only log if it's not a network error (which is expected when offline)
    if (err.message !== 'Failed to fetch') {
      console.error('Error fetching tasks:', err);
    }
    return [];
  }
}

// Fetch tasks (called from popup)
async function fetchTasks() {
  const { clickupApiKey, settings } = await chrome.storage.sync.get(['clickupApiKey', 'settings']);
  const currentSettings = settings || defaultSettings;

  if (!clickupApiKey) {
    return [];
  }

  return fetchTasksWithKey(clickupApiKey, currentSettings.features.overdue);
}
