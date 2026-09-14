(function () {
  'use strict';

  /*
   * ANTRA-WEB — LIVE AGENT CHAT ENGINE
   *
   * Browser flow:
   * Portfolio → Cloudflare Worker → real n8n Chat Trigger → real agent
   *
   * data-webhook = REAL n8n URL
   * data-proxy   = Cloudflare Worker URL used by embedded chat
   *
   * IMPORTANT:
   * Embedded chat NEVER calls n8n directly.
   * It ALWAYS uses data-proxy.
   */

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }

    return 'sess-' + Date.now() + '-' +
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

  /*
   * Extract a usable reply from common n8n response formats.
   */
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
      var v = d[keys[i]];

      if (typeof v === 'string' && v.trim()) {
        return v;
      }

      if (v && typeof v === 'object') {
        if (
          typeof v.content === 'string' &&
          v.content.trim()
        ) {
          return v.content;
        }

        if (
          typeof v.text === 'string' &&
          v.text.trim()
        ) {
          return v.text;
        }

        if (
          typeof v.output === 'string' &&
          v.output.trim()
        ) {
          return v.output;
        }
      }
    }

    /*
     * Support nested response objects.
     */
    for (var k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k)) {
        continue;
      }

      var value = d[k];

      if (
        typeof value === 'string' &&
        value.trim()
      ) {
        return value;
      }

      if (
        value &&
        typeof value === 'object'
      ) {
        var nested = extractReply(value);

        if (nested) {
          return nested;
        }
      }
    }

    return null;
  }

  function initPanel(panel) {

    /*
     * REAL n8n webhook.
     * Used ONLY for the "Continue with Ava/Flow" button.
     */
    var webhook = panel.getAttribute('data-webhook');

    /*
     * Cloudflare Worker.
     * THIS is the endpoint used by the embedded chat.
     */
    var proxy = panel.getAttribute('data-proxy');

    var agentName =
      panel.getAttribute('data-agent-name') || 'Agent';

    /*
     * DO NOT FALL BACK TO THE N8N WEBHOOK.
     *
     * Browser → Worker is the intended architecture.
     */
    var fetchTarget = proxy;

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

    if (!webhook || !body || !form || !textarea) {
      console.error(
        '[' + agentName +
        ' chat] Required chat elements are missing.'
      );

      return;
    }

    /*
     * Make missing proxy configuration obvious.
     */
    if (!fetchTarget) {
      console.error(
        '[' + agentName +
        ' chat] ERROR: data-proxy is missing.'
      );
    }

    /*
     * Persistent conversation session.
     */
    var sessionId;

    try {
      sessionId =
        window.sessionStorage.getItem(storageKey);

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

    /*
     * Open the REAL n8n hosted chat.
     */
    function openLive() {

      if (!webhook) {
        return;
      }

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
      body.scrollTop = body.scrollHeight;
    }

    function hideEmpty() {
      if (emptyState) {
        emptyState.style.display = 'none';
      }
    }

    function addMessage(role, html) {

      var row =
        document.createElement('div');

      row.className =
        'msg msg-' + role;

      row.setAttribute(
        'data-reveal',
        ''
      );

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

      row.setAttribute(
        'data-typing',
        ''
      );

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
        '<span></span>' +
        '<span></span>' +
        '<span></span>';

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

    /*
     * Detailed browser diagnostics.
     */
    function logFailure(
      stage,
      err,
      res
    ) {

      var label =
        '[' +
        agentName +
        ' chat] ' +
        stage;

      if (res) {

        console.error(
          label +
          ' — HTTP ' +
          res.status +
          ' from ' +
          fetchTarget
        );

      } else if (
        err &&
        err.name === 'AbortError'
      ) {

        console.error(
          label +
          ' — request timed out after 20 seconds.'
        );

      } else {

        console.error(
          label +
          ' — browser could not complete request.' +
          ' Target: ' +
          fetchTarget +
          ' Error: ' +
          (
            err &&
            err.message
              ? err.message
              : err
          ),
          err
        );
      }
    }

    function wireLastRetry(
      originalText
    ) {

      var btns =
        body.querySelectorAll(
          '[data-chat-retry]'
        );

      var last =
        btns[btns.length - 1];

      if (last) {

        last.addEventListener(
          'click',
          function () {
            sendMessage(originalText);
          }
        );
      }
    }

    function wireLastOpenLive() {

      var btns =
        body.querySelectorAll(
          '[data-chat-open-live]'
        );

      var last =
        btns[btns.length - 1];

      if (last) {
        last.addEventListener(
          'click',
          openLive
        );
      }
    }

    function showFailure(
      originalText,
      title,
      detail
    ) {

      addMessage(
        'system',

        '<strong>' +
        escapeHtml(title) +
        '</strong>' +

        '<div style="margin-top:6px;">' +
        escapeHtml(detail) +
        '</div>' +

        '<div style="' +
        'margin-top:12px;' +
        'display:flex;' +
        'gap:10px;' +
        'flex-wrap:wrap;' +
        '">' +

        '<button ' +
        'type="button" ' +
        'class="chip-link" ' +
        'data-chat-retry>' +
        'Try again' +
        '</button>' +

        '<button ' +
        'type="button" ' +
        'class="chip-link" ' +
        'data-chat-open-live>' +
        'Continue with ' +
        escapeHtml(agentName) +
        ' →' +
        '</button>' +

        '</div>'
      );

      wireLastOpenLive();

      wireLastRetry(
        originalText
      );
    }

    function sendMessage(rawText) {

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

      /*
       * NEVER send directly to n8n.
       */
      if (!fetchTarget) {

        if (typingRow.parentNode) {
          typingRow.remove();
        }

        showFailure(
          text,
          'Embedded chat is not connected yet.',
          'The Cloudflare proxy address is missing from this agent panel.'
        );

        setBusy(false);

        textarea.focus();

        return;
      }

      var controller =
        ('AbortController' in window)
          ? new AbortController()
          : null;

      var timeoutId =
        controller
          ? setTimeout(
              function () {
                controller.abort();
              },
              20000
            )
          : null;

      /*
       * REAL request:
       *
       * Portfolio
       *     ↓
       * Cloudflare Worker
       *     ↓
       * n8n Chat Trigger
       *     ↓
       * AI Agent
       */
      fetch(
        fetchTarget,
        {
          method: 'POST',

          mode: 'cors',

          cache: 'no-store',

          headers: {
            'Content-Type':
              'application/json',

            'Accept':
              'application/json, text/plain, */*'
          },

          body: JSON.stringify({
            action: 'sendMessage',
            sessionId: sessionId,
            chatInput: text
          }),

          signal:
            controller
              ? controller.signal
              : undefined
        }
      )

      .then(function (res) {

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (!res.ok) {

          logFailure(
            'HTTP error',
            null,
            res
          );

          return res
            .text()
            .catch(function () {
              return '';
            })
            .then(function (bodyText) {

              var err =
                new Error(
                  'HTTP ' +
                  res.status
                );

              err.serverBody =
                bodyText;

              err.httpStatus =
                res.status;

              throw err;
            });
        }

        var contentType =
          res.headers.get(
            'content-type'
          ) || '';

        if (
          contentType
            .toLowerCase()
            .indexOf(
              'application/json'
            ) !== -1
        ) {

          return res.json();

        } else {

          return res.text();
        }
      })

      .then(function (data) {

        if (typingRow.parentNode) {
          typingRow.remove();
        }

        console.log(
          '[' +
          agentName +
          ' chat] live response:',
          data
        );

        var reply =
          extractReply(data);

        if (reply) {

          addMessage(
            'agent',
            renderText(reply)
          );

          return;
        }

        /*
         * Server responded successfully,
         * but reply format was unexpected.
         */
        console.error(
          '[' +
          agentName +
          ' chat] response shape not recognized:',
          data
        );

        showFailure(
          text,

          'The live agent responded, but the reply format was unexpected.',

          'Nothing was simulated. Check the browser console for the exact live response.'
        );
      })

      .catch(function (err) {

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (typingRow.parentNode) {
          typingRow.remove();
        }

        var status =
          err &&
          err.httpStatus;

        if (!status) {

          logFailure(
            'request failed',
            err,
            null
          );
        }

        var detail;

        if (
          err &&
          err.name === 'AbortError'
        ) {

          detail =
            'The live connection took longer than 20 seconds. Check the Cloudflare Worker and n8n execution.';

        } else if (
          status === 404
        ) {

          detail =
            'The Cloudflare proxy route was not found. Ava must use /ava and Flow must use /flow.';

        } else if (
          status === 405
        ) {

          detail =
            'The Cloudflare Worker rejected the request method. The Worker must allow POST and OPTIONS.';

        } else if (
          status === 401 ||
          status === 403
        ) {

          detail =
            'The live connection was rejected with HTTP ' +
            status +
            '. Check the Worker configuration.';

        } else if (
          status === 500 ||
          status === 502 ||
          status === 503
        ) {

          detail =
            'The proxy or real n8n agent returned a server error. Check Cloudflare Worker logs and the n8n execution.';

        } else if (status) {

          detail =
            'The live proxy returned HTTP ' +
            status +
            '. Check the browser console for the exact response.';

        } else {

          detail =
            'The browser could not complete the request to the Cloudflare proxy. Check the Network tab for the request to ' +
            fetchTarget +
            '.';
        }

        showFailure(
          text,

          'Couldn’t reach the live ' +
          agentName +
          ' connection.',

          detail
        );
      })

      .finally(function () {

        setBusy(false);

        textarea.focus();
      });
    }

    /*
     * Form submit.
     */
    form.addEventListener(
      'submit',
      function (e) {

        e.preventDefault();

        sendMessage(
          textarea.value
        );
      }
    );

    /*
     * Enter sends.
     * Shift + Enter creates a new line.
     */
    textarea.addEventListener(
      'keydown',
      function (e) {

        if (
          e.key === 'Enter' &&
          !e.shiftKey
        ) {

          e.preventDefault();

          sendMessage(
            textarea.value
          );
        }
      }
    );

    /*
     * Suggested prompt chips.
     */
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

  /*
   * Lightweight scroll reveal.
   */
  function initScrollReveal() {

    var els =
      document.querySelectorAll(
        '.reveal-up'
      );

    if (!els.length) {
      return;
    }

    if (
      typeof IntersectionObserver ===
      'undefined'
    ) {

      els.forEach(
        function (el) {
          el.classList.add(
            'is-visible'
          );
        }
      );

      return;
    }

    var observer =
      new IntersectionObserver(

        function (entries) {

          entries.forEach(
            function (entry) {

              if (
                entry.isIntersecting
              ) {

                entry.target.classList.add(
                  'is-visible'
                );

                observer.unobserve(
                  entry.target
                );
              }
            }
          );
        },

        {
          threshold: 0.12,
          rootMargin:
            '0px 0px -8% 0px'
        }
      );

    els.forEach(
      function (el) {
        observer.observe(el);
      }
    );
  }

  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      initScrollReveal
    );

  } else {

    initScrollReveal();
  }

})();
