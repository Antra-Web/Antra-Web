/* =========================================================
   ANTRA-WEB — LIVE AGENT CHAT ENGINE
   ---------------------------------------------------------
   REAL LIVE CONNECTION:
   Browser → Cloudflare Worker → n8n → AI Agent → Browser

   IMPORTANT:
   - data-webhook = real n8n Chat Trigger
   - data-proxy   = Cloudflare CORS-safe proxy
   - No simulated/fake replies
   - Browser sends text/plain to avoid CORS preflight
   - Worker forwards the JSON to n8n as application/json
   ========================================================= */

(function () {
  'use strict';

  /* =========================================================
     SESSION ID
     ========================================================= */

  function uid() {
    if (
      window.crypto &&
      typeof window.crypto.randomUUID === 'function'
    ) {
      return window.crypto.randomUUID();
    }

    return (
      'sess-' +
      Date.now() +
      '-' +
      Math.random().toString(16).slice(2)
    );
  }


  /* =========================================================
     HTML SAFETY
     ========================================================= */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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


  /* =========================================================
     RESPONSE EXTRACTION
     ========================================================= */

  function extractReply(data) {
    var d = data;

    if (Array.isArray(d)) {
      d = d[0];
    }

    if (d == null) {
      return null;
    }

    if (typeof d === 'string') {
      var plain = d.trim();

      return plain ? d : null;
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


  /* =========================================================
     INITIALIZE ONE CHAT PANEL
     ========================================================= */

  function initPanel(panel) {

    /*
     * Real n8n webhook.
     * Used only for "OPEN IN NEW TAB".
     */
    var webhook =
      panel.getAttribute('data-webhook');

    /*
     * Real Cloudflare Worker endpoint.
     * Used by embedded browser chat.
     */
    var fetchTarget =
      panel.getAttribute('data-proxy');

    var agentName =
      panel.getAttribute('data-agent-name') ||
      'Agent';


    /* =======================================================
       DOM REFERENCES
       ======================================================= */

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


    /* =======================================================
       CONFIGURATION CHECK
       ======================================================= */

    if (
      !webhook ||
      !fetchTarget ||
      !body ||
      !form ||
      !textarea
    ) {
      console.error(
        '[' +
        agentName +
        ' chat] Missing required configuration.',
        {
          webhook: webhook,
          proxy: fetchTarget,
          body: !!body,
          form: !!form,
          textarea: !!textarea
        }
      );

      return;
    }


    /* =======================================================
       SESSION
       ======================================================= */

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

      console.warn(
        '[' +
        agentName +
        ' chat] sessionStorage unavailable; using temporary session.'
      );
    }


    /* =======================================================
       STATE
       ======================================================= */

    var busy = false;


    /* =======================================================
       OPEN REAL n8n CHAT
       ======================================================= */

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


    /* =======================================================
       SCROLL CHAT TO BOTTOM
       ======================================================= */

    function scrollToEnd() {
      body.scrollTop =
        body.scrollHeight;
    }


    /* =======================================================
       HIDE EMPTY CHAT STATE
       ======================================================= */

    function hideEmpty() {
      if (emptyState) {
        emptyState.style.display =
          'none';
      }
    }


    /* =======================================================
       ADD MESSAGE
       ======================================================= */

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

      bubble.innerHTML =
        html;

      row.appendChild(bubble);

      body.appendChild(row);

      scrollToEnd();

      return row;
    }


    /* =======================================================
       TYPING INDICATOR
       ======================================================= */

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
        '<span></span>' +
        '<span></span>' +
        '<span></span>';

      row.appendChild(bubble);

      body.appendChild(row);

      scrollToEnd();

      return row;
    }


    /* =======================================================
       BUSY STATE
       ======================================================= */

    function setBusy(state) {

      busy = state;

      textarea.disabled =
        state;

      if (sendBtn) {
        sendBtn.disabled =
          state;
      }

      panel.classList.toggle(
        'is-busy',
        state
      );
    }


    /* =======================================================
       TEXTAREA AUTO-GROW
       ======================================================= */

    function autoGrow() {

      textarea.style.height =
        'auto';

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


    /* =======================================================
       FAILURE MESSAGE
       ======================================================= */

    function showFailure(
      originalText,
      errorDetails
    ) {

      addMessage(
        'system',

        'Couldn’t reach the live ' +
        escapeHtml(agentName) +
        ' connection.' +

        '<div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">' +

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

      console.error(
        '[' +
        agentName +
        ' chat] Live connection failed.',
        {
          proxy: fetchTarget,
          error: errorDetails || null
        }
      );


      /* =====================================================
         RETRY BUTTON
         ===================================================== */

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
            sendMessage(
              originalText
            );
          }
        );
      }


      /* =====================================================
         OPEN LIVE BUTTON
         ===================================================== */

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


    /* =======================================================
       SEND MESSAGE
       ======================================================= */

    async function sendMessage(rawText) {

      var text =
        (rawText || '').trim();

      if (
        !text ||
        busy
      ) {
        return;
      }


      /* =====================================================
         SHOW USER MESSAGE
         ===================================================== */

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


      /* =====================================================
         REAL n8n CHAT TRIGGER PAYLOAD
         ===================================================== */

      var payload =
        JSON.stringify({
          action: 'sendMessage',
          sessionId: sessionId,
          chatInput: text
        });


      try {

        /* ===================================================
           IMPORTANT CORS DESIGN

           Browser
             ↓
           Cloudflare Worker
             ↓
           n8n

           Browser sends text/plain intentionally.
           This avoids a CORS preflight request.

           Worker receives the raw JSON text and forwards
           it to n8n as application/json.
           =================================================== */

        var response =
          await fetch(
            fetchTarget,
            {
              method: 'POST',

              headers: {
                'Content-Type':
                  'text/plain;charset=UTF-8',

                'Accept':
                  'application/json, text/plain, */*'
              },

              body:
                payload,

              credentials:
                'omit',

              redirect:
                'follow'
            }
          );


        /* ===================================================
           HTTP ERROR
           =================================================== */

        if (!response.ok) {

          var errorBody = '';

          try {
            errorBody =
              await response.text();
          } catch (readError) {
            errorBody =
              '';
          }

          throw new Error(
            'HTTP ' +
            response.status +
            (
              errorBody
                ? ' — ' +
                  errorBody.slice(0, 500)
                : ''
            )
          );
        }


        /* ===================================================
           READ RESPONSE — FIXED
           =================================================== */

        var contentType =
          response.headers.get(
            'content-type'
          ) || '';

        /*
         * IMPORTANT:
         * Do NOT use response.json() here.
         *
         * The browser console showed:
         *
         * SyntaxError:
         * Unexpected whitespace character
         * after JSON
         *
         * So we read the response as text first.
         */
        var responseText =
          await response.text();

        var data =
          responseText;


        /* ===================================================
           PARSE JSON SAFELY
           =================================================== */

        if (
          contentType
            .toLowerCase()
            .indexOf(
              'application/json'
            ) !== -1
        ) {

          try {

            /*
             * Normal JSON response.
             */
            data =
              JSON.parse(
                responseText
              );

          } catch (jsonError) {

            /*
             * Some n8n configurations can return
             * multiple JSON objects separated by
             * whitespace/newlines.
             */
            var lines =
              responseText
                .split(/\r?\n/)
                .map(
                  function (line) {
                    return line.trim();
                  }
                )
                .filter(Boolean);

            var parsedItems = [];


            /* ===============================================
               PARSE EACH JSON LINE
               =============================================== */

            for (
              var li = 0;
              li < lines.length;
              li++
            ) {

              var candidate =
                lines[li];


              /*
               * Support SSE-style:
               *
               * data: {...}
               */
              if (
                candidate.indexOf(
                  'data:'
                ) === 0
              ) {

                candidate =
                  candidate
                    .slice(5)
                    .trim();
              }


              try {

                parsedItems.push(
                  JSON.parse(
                    candidate
                  )
                );

              } catch (lineError) {

                /*
                 * Ignore non-JSON lines.
                 */
              }
            }


            /* ===============================================
               ONE VALID JSON OBJECT
               =============================================== */

            if (
              parsedItems.length === 1
            ) {

              data =
                parsedItems[0];

            }


            /* ===============================================
               MULTIPLE VALID JSON OBJECTS
               =============================================== */

            else if (
              parsedItems.length > 1
            ) {

              var foundReply =
                false;


              /*
               * Look for the object that actually
               * contains the agent response.
               */
              for (
                var pi = 0;
                pi < parsedItems.length;
                pi++
              ) {

                if (
                  extractReply(
                    parsedItems[pi]
                  )
                ) {

                  data =
                    parsedItems[pi];

                  foundReply =
                    true;

                  break;
                }
              }


              /*
               * If none contains a recognized reply,
               * use the final parsed object.
               */
              if (!foundReply) {

                data =
                  parsedItems[
                    parsedItems.length - 1
                  ];
              }
            }
          }
        }


        /* ===================================================
           REMOVE TYPING INDICATOR
           =================================================== */

        if (
          typingRow &&
          typingRow.parentNode
        ) {
          typingRow.remove();
        }


        /* ===================================================
           EXTRACT REAL AGENT RESPONSE
           =================================================== */

        var reply =
          extractReply(data);


        if (reply) {

          /*
           * REAL response from n8n / AI agent.
           */
          addMessage(
            'agent',
            renderText(reply)
          );

        } else {

          /*
           * Server responded, but format was
           * not recognized.
           */
          console.error(
            '[' +
            agentName +
            ' chat] Unrecognized live response:',
            data
          );

          showFailure(
            text,
            'Unrecognized response format'
          );
        }


      } catch (error) {

        /* ===================================================
           REQUEST FAILURE
           =================================================== */

        console.error(
          '[' +
          agentName +
          ' chat] Request failed:',
          error
        );


        /*
         * Remove typing indicator.
         */
        if (
          typingRow &&
          typingRow.parentNode
        ) {
          typingRow.remove();
        }


        /*
         * Show real connection failure.
         * No simulated response.
         */
        showFailure(
          text,
          error
        );


      } finally {

        /*
         * Always unlock UI.
         */
        setBusy(false);

        textarea.focus();
      }
    }


    /* =======================================================
       FORM SUBMIT
       ======================================================= */

    form.addEventListener(
      'submit',
      function (event) {

        event.preventDefault();

        sendMessage(
          textarea.value
        );
      }
    );


    /* =======================================================
       ENTER TO SEND
       SHIFT + ENTER = NEW LINE
       ======================================================= */

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


    /* =======================================================
       SUGGESTION CHIPS
       ======================================================= */

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


    /* =======================================================
       INITIAL TEXTAREA SIZE
       ======================================================= */

    autoGrow();
  }


  /* =========================================================
     INITIALIZE ALL AGENT PANELS
     ========================================================= */

  function initAll() {

    var panels =
      document.querySelectorAll(
        '[data-agent-chat]'
      );

    if (!panels.length) {

      console.warn(
        '[ANTRA-WEB chat] No agent chat panels found.'
      );

      return;
    }


    panels.forEach(
      function (panel) {

        try {

          initPanel(panel);

        } catch (error) {

          console.error(
            '[ANTRA-WEB chat] Failed to initialize panel:',
            error
          );
        }
      }
    );
  }


  /* =========================================================
     SCROLL REVEAL
     ---------------------------------------------------------
     IMPORTANT:
     .reveal-up elements start hidden in CSS.
     This adds .is-visible when they enter the viewport.
     ========================================================= */

  function initScrollReveal() {

    var els =
      document.querySelectorAll(
        '.reveal-up'
      );


    if (!els.length) {
      return;
    }


    /*
     * Fallback for browsers without IntersectionObserver.
     */
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

        observer.observe(
          el
        );
      }
    );
  }


  /* =========================================================
     START EVERYTHING
     ========================================================= */

  function start() {

    initAll();

    initScrollReveal();
  }


  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      start
    );

  } else {

    start();
  }

})();
