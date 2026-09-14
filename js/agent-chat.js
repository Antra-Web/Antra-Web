/* ANTRA-WEB — live agent chat engine
   Powers the interactive chat panel on ava.html and flow.html.

   HOW IT CONNECTS
   ----------------
   Each `[data-agent-chat]` panel carries the agent's real, live n8n
   webhook URL in `data-webhook`. On send, this file POSTs directly to
   that URL using the standard n8n Chat Trigger payload shape:
     { action: "sendMessage", sessionId, chatInput }
   and renders whatever the live agent actually returns. Nothing here
   fabricates or simulates a reply.

   If the direct call fails for any reason (network/CORS/timeout/
   unexpected shape), the panel never invents a response. It shows a
   plain system notice and offers a one-tap way to continue the same
   conversation with the real agent in its own tab — the same webhook
   URL, opened as a normal page, serves n8n's hosted chat UI directly.
*/
(function () {
  'use strict';

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'sess-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Turn plain text into safe HTML: escape everything, then restore
  // line breaks and light **bold** emphasis so agent replies stay readable.
  function renderText(str) {
    var safe = escapeHtml(str).trim();
    safe = safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/\n/g, '<br>');
    return safe;
  }

  // Defensively pull a reply string out of whatever shape the workflow
  // returns. Common n8n / LLM response keys are checked first; if none
  // match, the first string value found anywhere in the object is used.
  function extractReply(data) {
    var d = data;
    if (Array.isArray(d)) d = d[0];
    if (d == null) return null;
    if (typeof d === 'string') return d;
    if (typeof d !== 'object') return null;

    var keys = ['output', 'text', 'reply', 'answer', 'response', 'message', 'content'];
    for (var i = 0; i < keys.length; i++) {
      var v = d[keys[i]];
      if (typeof v === 'string' && v.trim()) return v;
      if (v && typeof v === 'object' && typeof v.content === 'string' && v.content.trim()) return v.content;
    }
    for (var k in d) {
      if (Object.prototype.hasOwnProperty.call(d, k) && typeof d[k] === 'string' && d[k].trim()) {
        return d[k];
      }
    }
    return null;
  }

  function initPanel(panel) {
    var webhook = panel.getAttribute('data-webhook');
    var agentName = panel.getAttribute('data-agent-name') || 'Agent';
    var storageKey = 'antra-chat-session-' + agentName.toLowerCase();

    var body = panel.querySelector('[data-chat-body]');
    var form = panel.querySelector('[data-chat-form]');
    var textarea = panel.querySelector('[data-chat-input]');
    var sendBtn = panel.querySelector('[data-chat-send]');
    var emptyState = panel.querySelector('[data-chat-empty]');
    var openLiveBtns = panel.querySelectorAll('[data-chat-open-live]');
    var chips = panel.querySelectorAll('[data-chat-chip]');

    if (!webhook || !body || !form || !textarea) return;

    var sessionId;
    try {
      sessionId = window.sessionStorage.getItem(storageKey);
      if (!sessionId) {
        sessionId = uid();
        window.sessionStorage.setItem(storageKey, sessionId);
      }
    } catch (e) {
      sessionId = uid();
    }

    var busy = false;

    function openLive() {
      window.open(webhook, '_blank', 'noopener');
    }
    for (var i = 0; i < openLiveBtns.length; i++) {
      openLiveBtns[i].addEventListener('click', openLive);
    }

    function scrollToEnd() {
      body.scrollTop = body.scrollHeight;
    }

    function hideEmpty() {
      if (emptyState) emptyState.style.display = 'none';
    }

    function addMessage(role, html) {
      var row = document.createElement('div');
      row.className = 'msg msg-' + role;
      row.setAttribute('data-reveal', '');

      if (role === 'agent') {
        var avatar = document.createElement('div');
        avatar.className = 'msg-avatar-mini';
        avatar.textContent = agentName.charAt(0).toUpperCase();
        row.appendChild(avatar);
      }

      var bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.innerHTML = html;
      row.appendChild(bubble);

      body.appendChild(row);
      scrollToEnd();
      return row;
    }

    function addTyping() {
      var row = document.createElement('div');
      row.className = 'msg msg-agent msg-typing';
      row.setAttribute('data-typing', '');
      var avatar = document.createElement('div');
      avatar.className = 'msg-avatar-mini';
      avatar.textContent = agentName.charAt(0).toUpperCase();
      row.appendChild(avatar);
      var bubble = document.createElement('div');
      bubble.className = 'msg-bubble typing-indicator';
      bubble.innerHTML = '<span></span><span></span><span></span>';
      row.appendChild(bubble);
      body.appendChild(row);
      scrollToEnd();
      return row;
    }

    function setBusy(state) {
      busy = state;
      textarea.disabled = state;
      if (sendBtn) sendBtn.disabled = state;
      panel.classList.toggle('is-busy', state);
    }

    function autoGrow() {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 140) + 'px';
    }
    textarea.addEventListener('input', autoGrow);

    // Diagnostic classification only — never shown to the visitor as a
    // technical string, only logged, so the site owner can tell CORS,
    // a dead/inactive webhook, and a slow backend apart from the console
    // without exposing anything sensitive.
    function logFailure(stage, err, res) {
      var label = '[' + agentName + ' chat] ' + stage;
      if (res) {
        console.error(label + ' — server responded with HTTP ' + res.status + '. ' +
          'If this is 404, the n8n webhook path is wrong or the workflow is not Active. ' +
          'If this is 401/403, the webhook requires auth this client does not send.');
      } else if (err && err.name === 'AbortError') {
        console.error(label + ' — request timed out after 20s. The n8n workflow may be slow, ' +
          'stuck, or unreachable.');
      } else {
        console.error(label + ' — fetch failed before a response was received (' + (err && err.message) +
          '). In a browser this almost always means CORS: open Network tab and check the OPTIONS ' +
          'preflight to this webhook. Fix in n8n: Chat Trigger node → Allowed Origin (CORS) must ' +
          'include this site\'s origin (or "*"), "Make Chat Publicly Available" must be on, and the ' +
          'workflow must be Active — not just saved.', err);
      }
    }

    function sendMessage(rawText) {
      var text = (rawText || '').trim();
      if (!text || busy) return;

      hideEmpty();
      addMessage('user', renderText(text));
      textarea.value = '';
      autoGrow();
      setBusy(true);
      var typingRow = addTyping();

      var controller = ('AbortController' in window) ? new AbortController() : null;
      var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 20000) : null;

      fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sendMessage', sessionId: sessionId, chatInput: text }),
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          if (timeoutId) clearTimeout(timeoutId);
          if (!res.ok) {
            logFailure('HTTP error', null, res);
            throw new Error('HTTP ' + res.status);
          }
          var ct = res.headers.get('content-type') || '';
          return ct.indexOf('application/json') !== -1 ? res.json() : res.text();
        })
        .then(function (data) {
          typingRow.remove();
          var reply = extractReply(data);
          if (reply) {
            addMessage('agent', renderText(reply));
          } else {
            console.error('[' + agentName + ' chat] response shape not recognized:', data);
            addMessage(
              'system',
              escapeHtml(agentName) + '\u2019s reply came back in a shape this preview didn\u2019t recognize. ' +
                'Nothing was simulated \u2014 your message hasn\u2019t been lost, ' +
                'you can continue the same conversation with the real, live agent below.' +
                '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">' +
                '<button type="button" class="chip-link" data-chat-retry>Try again</button>' +
                '<button type="button" class="chip-link" data-chat-open-live>Continue with ' +
                escapeHtml(agentName) + ' \u2192</button></div>'
            );
            wireLastOpenLive();
            wireLastRetry(text);
          }
        })
        .catch(function (err) {
          if (timeoutId) clearTimeout(timeoutId);
          if (typingRow.parentNode) typingRow.remove();
          if (!(err instanceof Error) || err.message.indexOf('HTTP ') !== 0) {
            logFailure('request failed', err, null);
          }
          addMessage(
            'system',
            'This tab couldn\u2019t reach ' + escapeHtml(agentName) + ' directly from the browser preview. ' +
              'Nothing was simulated \u2014 your message hasn\u2019t been lost, ' +
              'you can continue the same conversation with the real, live agent below.' +
              '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">' +
              '<button type="button" class="chip-link" data-chat-retry>Try again</button>' +
              '<button type="button" class="chip-link" data-chat-open-live>Continue with ' +
              escapeHtml(agentName) + ' \u2192</button></div>'
          );
          wireLastOpenLive();
          wireLastRetry(text);
        })
        .finally(function () {
          setBusy(false);
          textarea.focus();
        });
    }

    function wireLastRetry(originalText) {
      var btns = body.querySelectorAll('[data-chat-retry]');
      var last = btns[btns.length - 1];
      if (last) {
        last.addEventListener('click', function () {
          sendMessage(originalText);
        });
      }
    }

    function wireLastOpenLive() {
      var btns = body.querySelectorAll('[data-chat-open-live]');
      var last = btns[btns.length - 1];
      if (last) last.addEventListener('click', openLive);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      sendMessage(textarea.value);
    });

    textarea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(textarea.value);
      }
    });

    for (var c = 0; c < chips.length; c++) {
      chips[c].addEventListener('click', function () {
        sendMessage(this.getAttribute('data-chat-chip'));
      });
    }
  }

  function initAll() {
    var panels = document.querySelectorAll('[data-agent-chat]');
    panels.forEach(initPanel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  // ---- Lightweight scroll-reveal for these two pages only ----
  // Sections/cards get a starting "hidden" state via the .reveal-up class
  // (see css/agent.css) and this observer promotes them to .is-visible
  // as they enter the viewport. Falls back to always-visible if
  // IntersectionObserver is unavailable, and is skipped for anyone with
  // prefers-reduced-motion via the CSS rule that removes the transition.
  function initScrollReveal() {
    var els = document.querySelectorAll('.reveal-up');
    if (!els.length) return;
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    els.forEach(function (el) { observer.observe(el); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollReveal);
  } else {
    initScrollReveal();
  }
})();
