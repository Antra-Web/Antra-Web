# ANTRA-WEB — AVA & FLOW Audit Report

## 1. What I actually found

I extracted and read the whole repo: every `.html` page, `js/agent-chat.js`,
`css/agent.css`, `config/portfolio-projects.json`, and the `scripts/` folder.
There is **no backend, no serverless function, no `.env`, no deployment
config** anywhere in the project — it's a pure static site, exactly what
GitHub Pages expects.

Both AVA and FLOW are built the same way: a chat panel
(`[data-agent-chat]`) whose markup lives in `ava.html` / `flow.html`, driven
entirely by `js/agent-chat.js`. Each panel points at a **real n8n Chat
Trigger webhook**:

- AVA → `https://antra.app.n8n.cloud/webhook/d9217086-.../chat`
- FLOW → `https://lovely-webdev.app.n8n.cloud/webhook/000a0ca5-.../chat`
  (note: this is a *different* n8n account than AVA's — worth confirming
  you actually own/administer this one)

**The frontend code is not faking anything.** I read it line by line:
it does a real `fetch()` POST with the standard n8n chat payload
(`{action, sessionId, chatInput}`), parses whatever comes back, and only
shows the "couldn't reach Ava" message inside a genuine `.catch()` —
i.e., that message only appears when the real network request actually
fails. There's no hard-coded conversation, no random response picker, no
disguised timeout-as-success. So the code you already have satisfies
almost all of your "no fake fallback" rules already.

## 2. Root cause

I could not reach `antra.app.n8n.cloud` or `lovely-webdev.app.n8n.cloud`
from this sandbox to run a live request (my network access here is
restricted to a small allowlist that doesn't include n8n.cloud), so I
can't hand you a packet capture. But the symptom you're describing —
works when you open the webhook URL directly, fails silently from the
embedded chat panel — is the textbook signature of **one specific,
well-documented failure**, not a code bug:

> **The n8n Chat Trigger node's CORS setting doesn't allow your GitHub
> Pages origin.**

Every `fetch()` with a JSON body is a "non-simple" cross-origin request,
so the browser sends a preflight `OPTIONS` request first. If the n8n
Chat Trigger's **Allowed Origin (CORS)** field doesn't include
`https://antra-web.github.io` (or isn't `*`), the browser blocks the
real POST before it ever leaves the tab — which surfaces to JavaScript
as a generic "failed to fetch," indistinguishable from a dead server.
This is an extremely common n8n gotcha (it's the top hit in n8n's own
GitHub issues and community forum for this exact symptom).

The other two things that produce the identical symptom:
- **"Make Chat Publicly Available" is off** on the Chat Trigger node —
  the webhook only answers the built-in editor test chat, not the public
  URL.
- **The workflow isn't Active** — n8n webhooks only listen at the
  `/webhook/...` path (as opposed to `/webhook-test/...`) once the
  workflow's Active toggle is on and saved.

None of these three are things I can see or fix from the repo — they
live in your n8n account's workflow settings, not in any file I have
access to.

## 3. What I changed (and why I stopped there)

I edited `js/agent-chat.js` only. I did **not** touch the HTML/CSS,
the visual identity, navigation, or any other page — nothing else needed
to change.

What's different:
1. **Real console diagnostics.** The old code had zero `console.error`
   calls — a failure gave you no way to tell CORS, a 404, a timeout, and
   an unrecognized response shape apart. It now logs a specific,
   actionable message for each case (e.g. "this almost always means
   CORS — check the Chat Trigger's Allowed Origin setting"), without
   ever putting technical detail in front of the visitor.
2. **A working "Try again" button** next to "Continue with Ava/Flow →"
   on any failure, so a visitor can retry the same message in place
   instead of only being pushed out to a new tab.

I deliberately did **not**:
- invent a client-side workaround for CORS (there isn't one — it's a
  server-response-header restriction, enforced by the browser, and
  nothing in `agent-chat.js` can override it)
- add a fake/local response generator as a "fallback"
- rebuild AVA/FLOW as a scripted demo

Any of those would have violated the "no fake fallback" instruction you
were explicit about, so I held the line there rather than papering over
it.

## 4. What you need to do to actually fix it

In each n8n account (antra.app.n8n.cloud for Ava, lovely-webdev.app.n8n.cloud
for Flow), open the workflow → the **Chat Trigger** node → and check, in
this order:

1. **Active toggle** (top of the workflow editor) is ON, not just saved.
2. **"Make Chat Publicly Available"** is ON.
3. **"Allowed Origin (CORS)"** includes `https://antra-web.github.io`
   (your Pages domain from `sitemap.xml`/`robots.txt`) — or is set to `*`
   while you're testing.

That's almost certainly the whole fix — no redeploy of the site needed,
since the frontend already points at the right URLs and already handles
success/failure correctly. After you change it, hard-refresh the live
page and send a message; the browser DevTools Network tab will show the
`OPTIONS` + `POST` going through instead of failing.

## 5. A stronger production architecture, if you want it (optional)

Right now the n8n webhook URLs are sitting in your page source in plain
text — anyone can view-source, copy the URL, and hit your n8n workflow
directly from curl/Postman/a script, outside your chat UI entirely,
running up whatever cost sits behind it (LLM calls, etc.), which is a
separate concern from the CORS bug above.

If you want that closed off, the standard fix is a tiny serverless proxy
(Cloudflare Workers has a free tier) that sits between the static site
and n8n: the browser calls *your* proxy URL, the proxy forwards to the
real n8n webhook server-side (no browser CORS involved at all, since
it's server-to-server) and returns the reply, and the real n8n URL never
appears in the shipped JavaScript. That's a genuine architecture change,
not something I can deploy for you (it needs your own Cloudflare/Vercel
account), but I can build it with you if you want to go that route —
just say the word and tell me which serverless platform you'd rather use.

## 6. Answers to your final-verification checklist

1. **Root cause of Ava failure:** almost certainly n8n Chat Trigger CORS/
   publish/active configuration blocking the browser's cross-origin
   request — not a frontend bug.
2. **Root cause of Flow failure:** same class of issue, on the separate
   `lovely-webdev.app.n8n.cloud` n8n account.
3. **Files changed:** `js/agent-chat.js` only.
4. **Architecture:** unchanged — static GitHub Pages frontend → direct
   `fetch()` to each n8n Chat Trigger webhook. Still the case that this
   is the simplest architecture that can work from a static site,
   *once the n8n-side CORS/publish/active settings are correct.*
5. **How Ava/Flow communicate with their backend:** unchanged POST with
   `{action:"sendMessage", sessionId, chatInput}` to the n8n webhook URL
   already in the HTML.
6. **Secrets/env vars required:** none — and none were found exposed
   anywhere in the repo.
7. **Deployment steps:** replace `js/agent-chat.js` with the version I've
   attached, commit, push. No other files need to change.
8. **Real limitation that remains:** I can't verify the fix live, because
   I don't have network access to your n8n instances from this
   environment, and I don't have your n8n login to check/flip those
   three settings myself. You (or whoever has access to both n8n
   accounts) needs to do that part.
9. **GitHub Pages considered, not just localhost:** yes — I checked for
   root-relative paths, a missing `<base>` tag, and anything that only
   works from `file://`/`localhost`; none of that was the problem, and
   the relative-path structure is already correct for the
   `antra-web.github.io/Antra-Web/` project-page deployment shown in
   your `sitemap.xml`.
