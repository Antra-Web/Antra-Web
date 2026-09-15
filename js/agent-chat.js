/* ANTRA-WEB — LIVE AGENT CHAT ENGINE */

(function () {
  'use strict';

  function uid() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID === 'function'
    ) {
      return window.crypto.randomUUID();
    }

    return 'sess-' +
      Date.now() +
      '-' +
      Math.random().toString(16).slice(2);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderText(str) {
    var safe = escapeHtml(str).trim();

    safe = safe.replace(
      /\*\*(.+?)\*\*/g,
      '<strong>$1</strong>'
    );

    safe = safe.replace(/\n/g, '<br>');

    return safe;
  }

  function extractReply(data) {
    var d = data;

    if (Array.isArray(d)) {
      d = d[0];
    }

    if (d == null) {
      return null;
    }

    if (typeof d === 'string') {
      return d;
    }

    if (typeof d !== 'object') {
      return null;
    }

    var keys = [
      'output',
      'text',
      'reply',
      'answer',
      'response',
      'message',
      'content'
    ];

    for (var i = 0; i < keys.length; i++) {
      var value = d[keys[i]];

      if (
        typeof value === 'string' &&
        value.trim()
      ) {
        return value;
      }

      if (
        value &&
        typeof value === 'object' &&
        typeof value.content === 'string' &&
        value.content.trim()
      ) {
        return value.content;
      }
    }

    for (var key in d) {
      if (
        Object.prototype.hasOwnProperty.call(d, key) &&
        typeof d[key] === 'string' &&
        d[key].trim()
      ) {
        return d[key];
      }
    }

    return null;
  }

  function initPanel(panel) {
    var webhook =
      panel.getAttribute('data-webhook');

    var fetchTarget =
      panel.getAttribute('data-proxy');

    var agentName =
      panel.getAttribute('data-agent-name') ||
      'Agent';

    var storageKey =
      'antra-chat-session-' +
      agentName.toLowerCase();

    var body =
      panel.querySelector('[data-chat-body]');

    var form =
      panel.querySelector('[data-chat-form]');

    var textarea =
      panel.querySelector('[data-chat-input]');

    var sendBtn =
      panel.querySelector('[data-chat-send]');

    var emptyState =
      panel.querySelector('[data-chat-empty]');

    var openLiveBtns =
      panel.querySelectorAll(
        '[data-chat-open-live]'
      );

    var chips =
      panel.querySelectorAll(
        '[data-chat-chip]'
      );

    if (
      !webhook ||
      !fetchTarget ||
      !body ||
      !form ||
      !textarea
    ) {
      console.error(
        '[' + agentName + ' chat] Missing required configuration.'
      );
      return;
    }

    var sessionId;

    try {
      sessionId =
        window.sessionStorage.getItem(
          storageKey
        );

      if (!sessionId) {
        sessionId = uid();

        window.sessionStorage.setItem(
          storageKey,
          sessionId
        );
      }
    } catch (e) {
      sessionId = uid();
    }

    var busy = false;

    function openLive() {
      window.open(
        webhook,
        '_blank',
        'noopener'
      );
    }

    for (
      var i = 0;
      i < openLiveBtns.length;
      i++
    ) {
      openLiveBtns[i].addEventListener(
        'click',
        openLive
      );
    }

    function scrollToEnd() {
      body.scrollTop =
        body.scrollHeight;
    }

    function hideEmpty() {
      if (emptyState) {
        emptyState.style.display =
          'none';
      }
    }

    function addMessage(role, html) {
      var row =
        document.createElement('div');

      row.className =
        'msg msg-' + role;

      if (role === 'agent') {
        var avatar =
          document.createElement('div');

        avatar.className =
          'msg-avatar-mini';

        avatar.textContent =
          agentName
            .charAt(0)
            .toUpperCase();

        row.appendChild(avatar);
      }

      var bubble =
        document.createElement('div');

      bubble.className =
        'msg-bubble';

      bubble.innerHTML = html;

      row.appendChild(bubble);

      body.appendChild(row);

      scrollToEnd();

      return row;
    }

    function addTyping() {
      var row =
        document.createElement('div');

      row.className =
        'msg msg-agent msg-typing';

      var avatar =
        document.createElement('div');

      avatar.className =
        'msg-avatar-mini';

      avatar.textContent =
        agentName
          .charAt(0)
          .toUpperCase();

      row.appendChild(avatar);

      var bubble =
        document.createElement('div');

      bubble.className =
        'msg-bubble typing-indicator';

      bubble.innerHTML =
        '<span></span><span></span><span></span>';

      row.appendChild(bubble);

      body.appendChild(row);

      scrollToEnd();

      return row;
    }

    function setBusy(state) {
      busy = state;

      textarea.disabled = state;

      if (sendBtn) {
        sendBtn.disabled = state;
      }

      panel.classList.toggle(
        'is-busy',
        state
      );
    }

    function autoGrow() {
      textarea.style.height = 'auto';

      textarea.style.height =
        Math.min(
          textarea.scrollHeight,
          140
        ) + 'px';
    }

    textarea.addEventListener(
      'input',
      autoGrow
    );

    function showFailure(originalText) {
      addMessage(
        'system',
        'Couldn\u2019t reach the live ' +
        escapeHtml(agentName) +
        ' connection.' +

        '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">' +

        '<button type="button" class="chip-link" data-chat-retry>' +
        'Try again' +
        '</button>' +

        '<button type="button" class="chip-link" data-chat-open-live>' +
        'Continue with ' +
        escapeHtml(agentName) +
        ' \u2192' +
        '</button>' +

        '</div>'
      );

      var retryButtons =
        body.querySelectorAll(
          '[data-chat-retry]'
        );

      var retry =
        retryButtons[
          retryButtons.length - 1
        ];

      if (retry) {
        retry.addEventListener(
          'click',
          function () {
            sendMessage(originalText);
          }
        );
      }

      var openButtons =
        body.querySelectorAll(
          '[data-chat-open-live]'
        );

      var openButton =
        openButtons[
          openButtons.length - 1
        ];

      if (openButton) {
        openButton.addEventListener(
          'click',
          openLive
        );
      }
    }

    async function sendMessage(rawText) {
      var text =
        (rawText || '').trim();

      if (!text || busy) {
        return;
      }

      hideEmpty();

      addMessage(
        'user',
        renderText(text)
      );

      textarea.value = '';

      autoGrow();

      setBusy(true);

      var typingRow =
        addTyping();

      var payload =
        JSON.stringify({
          action: 'sendMessage',
          sessionId: sessionId,
          chatInput: text
        });

      try {
        /*
         * IMPORTANT:
         *
         * We intentionally send text/plain from the browser.
         * This avoids the browser's CORS preflight.
         *
         * The Cloudflare Worker receives this exact JSON text
         * and forwards it to n8n as application/json.
         */
        var response =
          await fetch(fetchTarget, {
            method: 'POST',

            headers: {
              'Content-Type':
                'text/plain;charset=UTF-8',
              'Accept':
                'application/json, text/plain, */*'
            },

            body: payload,

            credentials: 'omit'
          });

        if (!response.ok) {
          throw new Error(
            'HTTP ' +
            response.status
          );
        }

        var contentType =
          response.headers.get(
            'content-type'
          ) || '';

        var data;

        if (
          contentType.indexOf(
            'application/json'
          ) !== -1
        ) {
          data =
            await response.json();
        } else {
          data =
            await response.text();
        }

        if (typingRow.parentNode) {
          typingRow.remove();
        }

        var reply =
          extractReply(data);

        if (reply) {
          addMessage(
            'agent',
            renderText(reply)
          );
        } else {
          console.error(
            '[' +
            agentName +
            ' chat] Unrecognized response:',
            data
          );

          showFailure(text);
        }

      } catch (error) {

        console.error(
          '[' +
          agentName +
          ' chat] Request failed:',
          error
        );

        if (
          typingRow.parentNode
        ) {
          typingRow.remove();
        }

        showFailure(text);

      } finally {

        setBusy(false);

        textarea.focus();
      }
    }

    form.addEventListener(
      'submit',
      function (event) {
        event.preventDefault();

        sendMessage(
          textarea.value
        );
      }
    );

    textarea.addEventListener(
      'keydown',
      function (event) {
        if (
          event.key === 'Enter' &&
          !event.shiftKey
        ) {
          event.preventDefault();

          sendMessage(
            textarea.value
          );
        }
      }
    );

    for (
      var c = 0;
      c < chips.length;
      c++
    ) {
      chips[c].addEventListener(
        'click',
        function () {
          sendMessage(
            this.getAttribute(
              'data-chat-chip'
            )
          );
        }
      );
    }
  }

  function initAll() {
    var panels =
      document.querySelectorAll(
        '[data-agent-chat]'
      );

    panels.forEach(
      initPanel
    );
  }

  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      initAll
    );
  } else {
    initAll();
  }

})();
