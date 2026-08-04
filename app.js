const authView = document.querySelector('#auth-view');
const waitingView = document.querySelector('#waiting-view');
const chatView = document.querySelector('#chat-view');
const authForm = document.querySelector('#auth-form');
const authMessage = document.querySelector('#auth-message');
const authSubmit = document.querySelector('#auth-submit');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const loginTab = document.querySelector('#login-tab');
const signupTab = document.querySelector('#signup-tab');
const waitingUser = document.querySelector('#waiting-user');
const partnerName = document.querySelector('#partner-name');
const partnerAvatar = document.querySelector('#partner-avatar');
const presenceText = document.querySelector('#presence-text');
const messagesElement = document.querySelector('#messages');
const messageForm = document.querySelector('#message-form');
const messageInput = document.querySelector('#message-input');
const chatError = document.querySelector('#chat-error');

let authMode = 'login';
let currentUser = null;
let partner = null;
let pollTimer = null;
let pollInProgress = false;
let renderedMessageIds = new Set();

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }

  if (!response.ok) {
    throw new Error(body.error || 'Unable to complete the request.');
  }

  return body;
}

function showView(view) {
  authView.classList.add('hidden');
  waitingView.classList.add('hidden');
  chatView.classList.add('hidden');
  view.classList.remove('hidden');
}

function setAuthMode(mode) {
  authMode = mode;
  const signingUp = mode === 'signup';
  loginTab.classList.toggle('active', !signingUp);
  signupTab.classList.toggle('active', signingUp);
  authSubmit.textContent = signingUp ? 'Create account' : 'Sign in';
  passwordInput.autocomplete = signingUp ? 'new-password' : 'current-password';
  authMessage.textContent = '';
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(callback, delay) {
  stopPolling();
  pollTimer = setInterval(callback, delay);
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function renderMessage(message) {
  if (!currentUser || renderedMessageIds.has(message.id)) return;

  const empty = messagesElement.querySelector('.empty-message');
  if (empty) empty.remove();

  renderedMessageIds.add(message.id);
  const row = document.createElement('div');
  row.className = `message-row${message.senderId === currentUser.id ? ' mine' : ''}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const text = document.createElement('p');
  text.className = 'message-text';
  text.textContent = message.text;

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = formatTime(message.createdAt);

  bubble.append(text, time);
  row.append(bubble);
  messagesElement.append(row);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

async function loadMessages(reset = false) {
  try {
    const { messages } = await api('/api/messages');

    if (reset) {
      renderedMessageIds = new Set();
      messagesElement.replaceChildren();
    }

    if (messages.length === 0 && messagesElement.childElementCount === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty-message';
      empty.textContent = 'No messages yet';
      messagesElement.append(empty);
      return;
    }

    messages.forEach(renderMessage);
    chatError.textContent = '';
  } catch (error) {
    chatError.textContent = error.message;
  }
}

async function pollMessages() {
  if (pollInProgress || !currentUser || !partner) return;
  pollInProgress = true;
  try {
    await loadMessages(false);
  } finally {
    pollInProgress = false;
  }
}

async function pollWaitingRoom() {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    const session = await api('/api/session');
    if (!session.authenticated || session.ready) {
      await loadSession();
    }
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    pollInProgress = false;
  }
}

async function loadSession() {
  stopPolling();

  try {
    const session = await api('/api/session');

    if (!session.authenticated) {
      currentUser = null;
      partner = null;
      signupTab.disabled = !session.signupAvailable;
      if (!session.signupAvailable && authMode === 'signup') setAuthMode('login');
      showView(authView);
      usernameInput.focus();
      return;
    }

    currentUser = session.user;
    partner = session.partner;

    if (!session.ready) {
      waitingUser.textContent = `Signed in as ${currentUser.username}`;
      showView(waitingView);
      startPolling(pollWaitingRoom, 3000);
      return;
    }

    partnerName.textContent = partner.username;
    partnerAvatar.textContent = partner.username.slice(0, 1).toUpperCase();
    presenceText.textContent = 'Private conversation';
    showView(chatView);
    await loadMessages(true);
    startPolling(pollMessages, 3000);
    messageInput.focus();
  } catch (error) {
    authMessage.textContent = error.message;
    showView(authView);
  }
}

loginTab.addEventListener('click', () => setAuthMode('login'));
signupTab.addEventListener('click', () => setAuthMode('signup'));

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  authMessage.textContent = '';
  authSubmit.disabled = true;

  try {
    await api(`/api/${authMode}`, {
      method: 'POST',
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value
      })
    });

    authForm.reset();
    await loadSession();
  } catch (error) {
    authMessage.textContent = error.message;
  } finally {
    authSubmit.disabled = false;
  }
});

messageForm.addEventListener('submit', async event => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  const button = messageForm.querySelector('button');
  button.disabled = true;
  messageInput.value = '';
  chatError.textContent = '';

  try {
    const { message } = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ text })
    });
    renderMessage(message);
  } catch (error) {
    messageInput.value = text;
    chatError.textContent = error.message;
  } finally {
    button.disabled = false;
    messageInput.focus();
  }
});

document.querySelectorAll('.logout-button').forEach(button => {
  button.addEventListener('click', async () => {
    stopPolling();
    try {
      await api('/api/logout', { method: 'POST', body: '{}' });
    } finally {
      setAuthMode('login');
      await loadSession();
    }
  });
});

window.addEventListener('beforeunload', stopPolling);
loadSession();
