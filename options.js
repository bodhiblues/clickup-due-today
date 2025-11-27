// DOM Elements - API
const apiForm = document.getElementById('api-form');
const apiKeyInput = document.getElementById('api-key');
const saveApiBtn = document.getElementById('save-api-btn');
const apiStatusEl = document.getElementById('api-status');

// DOM Elements - Features
const saveFeaturesBtn = document.getElementById('save-features-btn');
const featuresStatusEl = document.getElementById('features-status');
const notificationSettingsEl = document.getElementById('notification-settings');

// Feature toggles
const featureToggles = {
  overdue: document.getElementById('feature-overdue'),
  dueTime: document.getElementById('feature-due-time'),
  timeTracked: document.getElementById('feature-time-tracked'),
  completedCount: document.getElementById('feature-completed-count'),
  grouping: document.getElementById('feature-grouping'),
  badge: document.getElementById('feature-badge'),
  timeTracking: document.getElementById('feature-time-tracking'),
  snooze: document.getElementById('feature-snooze'),
  filters: document.getElementById('feature-filters'),
  notifications: document.getElementById('feature-notifications')
};

const notificationMinutesInput = document.getElementById('notification-minutes');

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

// Load saved settings
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.sync.get(['clickupApiKey', 'settings']);

  if (result.clickupApiKey) {
    apiKeyInput.value = result.clickupApiKey;
  }

  const settings = result.settings || defaultSettings;

  // Load feature toggles
  Object.keys(featureToggles).forEach(key => {
    if (settings.features && settings.features[key] !== undefined) {
      featureToggles[key].checked = settings.features[key];
    }
  });

  // Load notification minutes
  if (settings.notificationMinutes) {
    notificationMinutesInput.value = settings.notificationMinutes;
  }

  // Show/hide notification settings based on toggle
  updateNotificationSettings();
});

// Toggle notification settings visibility
featureToggles.notifications.addEventListener('change', updateNotificationSettings);

function updateNotificationSettings() {
  if (featureToggles.notifications.checked) {
    notificationSettingsEl.classList.remove('hidden');
  } else {
    notificationSettingsEl.classList.add('hidden');
  }
}

// Save API Key
apiForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showStatus(apiStatusEl, 'Please enter an API key.', 'error');
    return;
  }

  saveApiBtn.disabled = true;
  saveApiBtn.textContent = 'Validating...';

  try {
    const response = await fetch('https://api.clickup.com/api/v2/user', {
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('Invalid API key');
    }

    const userData = await response.json();

    // Save the API key
    await chrome.storage.sync.set({ clickupApiKey: apiKey });

    // Notify background script to update
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });

    showStatus(apiStatusEl, `Connected as ${userData.user.username || userData.user.email}`, 'success');
  } catch (err) {
    showStatus(apiStatusEl, 'Invalid API key. Please check and try again.', 'error');
  } finally {
    saveApiBtn.disabled = false;
    saveApiBtn.textContent = 'Save API Key';
  }
});

// Save all feature settings
saveFeaturesBtn.addEventListener('click', async () => {
  saveFeaturesBtn.disabled = true;
  saveFeaturesBtn.textContent = 'Saving...';

  try {
    const settings = {
      features: {},
      notificationMinutes: parseInt(notificationMinutesInput.value, 10) || 15
    };

    // Gather all feature toggle states
    Object.keys(featureToggles).forEach(key => {
      settings.features[key] = featureToggles[key].checked;
    });

    // Save settings
    await chrome.storage.sync.set({ settings });

    // Notify background script to update
    chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });

    showStatus(featuresStatusEl, 'Settings saved successfully!', 'success');
  } catch (err) {
    showStatus(featuresStatusEl, 'Failed to save settings. Please try again.', 'error');
  } finally {
    saveFeaturesBtn.disabled = false;
    saveFeaturesBtn.textContent = 'Save All Settings';
  }
});

function showStatus(element, message, type) {
  element.textContent = message;
  element.className = `status ${type}`;

  // Auto-hide success messages
  if (type === 'success') {
    setTimeout(() => {
      element.classList.add('hidden');
    }, 3000);
  }
}
