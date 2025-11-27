# Privacy Policy for ClickUp Due Today

**Last updated:** November 2024

## Overview

ClickUp Due Today is a browser extension that helps you view and manage your ClickUp tasks that are due today. This privacy policy explains how the extension handles your data.

## Data Collection

### What we collect
**Nothing.** This extension does not collect, store, or transmit any personal data to us or any third parties.

### What is stored locally
The extension stores the following data locally in your browser using Chrome's sync storage:
- Your ClickUp API key (encrypted by Chrome)
- Your feature preferences and settings

This data is stored only on your device and synced across your Chrome browsers if you're signed into Chrome. We never have access to this data.

## Data Transmission

### ClickUp API
The extension communicates directly with ClickUp's official API (api.clickup.com) to:
- Fetch your tasks due today
- Mark tasks as complete
- Update task due dates (snooze feature)
- Log time entries (time tracking feature)

Your API key is sent directly to ClickUp's servers and is never transmitted anywhere else.

### No Third-Party Services
This extension does not use any analytics, tracking, or third-party services. All functionality is between your browser and ClickUp's API.

## Permissions

The extension requires the following permissions:

| Permission | Purpose |
|------------|---------|
| `storage` | Save your API key and settings locally |
| `notifications` | Send desktop notifications for upcoming tasks |
| `alarms` | Schedule periodic checks for notifications and badge updates |
| `host_permissions` (api.clickup.com) | Communicate with ClickUp's API |

## Data Security

- Your API key is stored using Chrome's built-in secure storage
- All communication with ClickUp uses HTTPS encryption
- No data is ever sent to any server other than ClickUp's official API

## Your Control

You can at any time:
- View your stored settings in the extension options
- Delete your API key from the extension
- Uninstall the extension to remove all stored data
- Revoke the API key from your ClickUp account settings

## Open Source

This extension is open source. You can review the code at:
https://github.com/bodhiblues/clickup-due-today

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date above.

## Contact

If you have questions about this privacy policy, please open an issue on our GitHub repository:
https://github.com/bodhiblues/clickup-due-today/issues

---

This extension is not affiliated with, endorsed by, or sponsored by ClickUp.
