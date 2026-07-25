# Panoramax Image Review — Build Specification

This folder is the **complete specification** for rebuilding the Panoramax Image Review app from scratch. It is self-contained: an implementer who has never seen the original codebase should be able to produce a working, deployable app using only these documents.

The app is a **single-user, self-hosted Progressive Web App** for reviewing Panoramax street-level imagery. It runs on a small VPS behind [YunoHost](https://yunohost.org/), which handles TLS, nginx, and single-sign-on. The backend is a single Node/Express process using SQLite for storage — no Firebase, no Google AI, no external quotas.

## Audience

Hand this folder to an LLM or developer tasked with implementing the app. They should read every file in order:

1. `01-overview.md` — what the app is, who uses it, high-level architecture
2. `02-data-model.md` — SQLite schema, TypeScript types, enums
3. `03-api.md` — every REST endpoint, request/response shapes, auth model
4. `04-backend.md` — server implementation requirements, helpers, env vars
5. `05-frontend.md` — React app structure, routing, state, services
6. `06-ui-spec.md` — every screen, layout, color, spacing, interaction
7. `07-pwa.md` — manifest, service worker, offline queue, image cache, install
8. `08-yunohost-package.md` — the separate YunoHost package repo: manifest, scripts, nginx conf
9. `09-build-and-run.md` — dev, build, deploy commands; environment variables
10. `10-acceptance-checklist.md` — verifiable criteria for "done"

## Context for the implementer

- The previous version of this app was built in Google's "AI app maker" and depended on Firebase Auth, Firestore, and the Gemini API. All of that is being removed. There is no migration of existing data — the new install starts empty.
- One user only. No multi-tenancy, no scaling concerns. Simplicity over abstraction.
- Auth is delegated to YunoHost's SSO. The app trusts a header that nginx injects; the app itself never sees a password.
- Mobile and desktop share the same server, so review state syncs automatically without any "sync logic" code.

## Implementer notes

- **The spec is the source of truth.** If you have access to the original repo as a visual reference, use it for layout/colors only — the architecture described here supersedes whatever the old code did.
- Stack is fixed: React 19 + Vite + Tailwind CSS v4 on the frontend; Node 20 + Express + better-sqlite3 on the backend; TypeScript everywhere.
- Write production-quality TypeScript, strict mode. No `any` in new code except where the spec explicitly says so (Panoramax STAC responses).
- Don't add features not in the spec. Don't add Gemini. Don't add multi-user. Don't add OAuth. Don't add a database other than SQLite.
- Test by running locally (see `09-build-and-run.md`), then by installing the YunoHost package on a real or test YunoHost instance.
