# Ally Ahead

An AI reception POC for the PayPal AI Hackathon. Ally Ahead helps a business turn an initial idea into a requirements specification that people can discuss, revise and explicitly approve before taking the next step.

- [Try the POC](https://ally-poc.aixagent.cloud/)
- [Watch the demo video](https://youtu.be/s--7eNOinEk)

The demo follows a fictional business from its first conversation through requirements clarification to a **USD 500 PayPal Sandbox payment**, simulated publication and a user-requested full refund. Sandbox payments use test funds. Payment does not select an expert, create a contract or start work.

## Preview

The bilingual homepage introduces the journey from a business idea to a clear next step.

![Ally Ahead English homepage with an entrance illustration and a call to discuss your needs](docs/images/homepage.png)

Reception brings the conversation, recorded achievements, documents and Sandbox payment tools together.

![Ally Ahead reception in a fresh session, with its AI receptionist and conversation input](docs/images/reception.png)

## The experience

1. Start from the Chinese/English homepage and enter reception without a platform account.
2. Explain a business problem to the AI Agent. It can consult relevant public case summaries, compare approaches and record useful conversation outcomes.
3. Upload non-confidential TXT, Markdown, DOCX or text-based PDF reference material. Review summaries and extraction coverage; the Agent can search and read the original extracted passages.
4. Explicitly ask for a requirements document. Preview and download the full Markdown, request changes, then independently confirm the current document. A revision requires a new confirmation.
5. Separately choose simulated publication and accept the Sandbox checkout terms. The server records the payment against the confirmed document and uses PayPal's Sandbox API to verify its status.
6. Check the receipt or explicitly request a full test refund before contracting. Refunds do not run automatically. An uncertain response remains uncertain until reconciled.

The POC covers anonymous reception, requirements preparation and the Sandbox demonstration. Accounts, workspaces, expert recruitment, proposal evaluation, contracting and project delivery are outside its scope.

## Technology

- React, TypeScript and Vite for the bilingual homepage, reception UI, Loading states, document preview and checkout.
- Native **Pi SDK 1.4.0** for the Agent tool loop, six progressively disclosed skills and validated `communicate` deliveries. Approved intermediate results are saved while the Agent continues; unfinished text remains a draft. Browser speech reads final replies.
- Express and PostgreSQL for temporary sessions, ordered native Agent history, document metadata, payment snapshots and consultation traces.
- Local UUID-based file storage; Mammoth and PDF.js for document extraction. Scanned PDFs require an external OCR step.
- PayPal Sandbox Orders and Payments APIs, with stable request IDs, explicit consent, server-side status checks and user-initiated refunds.

## Run locally

Prerequisites: **Node 24.22.2**, **pnpm 10.32.1**, and **PostgreSQL 17+** or Docker Compose. The frontend and API are served from the same origin.

Use `.node-version` or `.nvmrc` with your Node version manager. Check `node --version` and `pnpm --version` before installation; `.npmrc` enables strict engine checks so an incompatible toolchain fails instead of continuing with a warning.

```sh
corepack enable
corepack prepare pnpm@10.32.1 --activate
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d --wait db
pnpm db:init
pnpm build
pnpm start
```

Open [Ally Ahead locally](http://127.0.0.1:3210). `/` is the homepage and `/reception` is the temporary reception session.

For an existing PostgreSQL installation, create a **new empty database** and set `DATABASE_URL` in `.env` before `pnpm db:init`. The initializer creates the POC schema atomically, checks its SQL hash on repeat runs and refuses an unrecognized nonempty database. Use a dedicated database/role. The app runs one process per POC database.

Original files are stored in `FILE_STORAGE_DIR`, default `.data/files`. Keep that directory with the database when preserving a demo session. The default temporary cookie lifetime is 24 hours. `.env`, local storage, dependencies and build artifacts are ignored by Git. Use synthetic or non-confidential material.

## Configure the AI Agent

```sh
cp config/model.sample.json config/model.json
```

Fill in the provider, model ID, HTTPS API endpoint, supported protocol, actual context/output limits and pricing metadata. Set these local `.env` values:

```dotenv
AGENT_MODE=live
AGENT_MODEL_CONFIG=config/model.json
AGENT_API_KEY=YOUR_PROVIDER_KEY
```

Restart the app after configuration. The default `AGENT_MODE=disabled` sends no model requests. Pi uses only explicitly configured model credentials and application-owned skills; it does not discover personal Pi configuration or expose shell/arbitrary filesystem tools. The same model configuration supports document summaries.

## Configure PayPal Sandbox

Set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in local `.env` to the credentials of a **PayPal Sandbox app**. The secret stays on the server; the client ID is public when checkout is enabled. REST traffic is pinned to `https://api-m.sandbox.paypal.com`.

The checkout API, payment state machine, PayPal client and PostgreSQL payment adapter are grouped under `apps/api/src/modules/reception-payments/`. The reception application supplies session authorization and the confirmed-document reader. Frontend payment state, SDK callbacks and presentation are separated.

The PayPal JS SDK loads after the user separately agrees to test checkout. A Sandbox buyer account may be needed in the PayPal window. The amount is **USD 500.00**, with test funds only. The page distinguishes a confirmed document, payment consent, verified receipt and simulated publication. Keep the temporary session cookie during the demonstration. Re-entering reception can recover that session's receipt even without a `paymentId` URL; later document revisions do not hide it. If a refund response is lost, check its status and explicitly choose recovery of the previous refund. Recovery reuses the original request within its idempotency window; loading the page and checking status do not issue refunds.

## Consultation trace viewer

Set a 43–128 character base64url `TRACE_VIEWER_TOKEN` in local `.env`; an empty value disables its API. A token can be generated locally with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Open `/ops/consultations` and enter the token. It stays in memory, outside URLs and browser storage. The viewer reads this POC's reception runs and sanitized events. Loopback HTTP is supported for local use; other origins require HTTPS. Keep the token and consultation data private.

## Synthetic tests

```sh
pnpm test
# Initialize another empty database whose name ends in _test:
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/ally_poc_test pnpm db:init
POC_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/ally_poc_test pnpm test:e2e
# Uses an installed Google Chrome:
POC_TEST_DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/ally_poc_test pnpm test:browser
```

The E2E test uses real HTTP, PostgreSQL and the native Pi SDK with an explicitly injected scripted provider, synthetic summaries and mocked PayPal responses. The browser test intercepts the PayPal SDK with a mock button. These fixtures do not create real payments or model requests; they are available only through the test scripts.

## License and credits

Ally Ahead's original code and documentation are licensed under the [MIT License](LICENSE), copyright 2026 peikuo. Third-party dependencies retain their respective licenses. See the [artwork and media inventory](third_party/ASSETS.md) for artwork provenance and licensing scope. No trademark rights or endorsement are granted by the project license.

See [public case sources](docs/CASE_SOURCES.md) and [third-party notices](third_party/README.md). Case summaries are external references with source limitations, not this product's clients or promised outcomes. Pi's MIT copyright notice is preserved in [PI_LICENSE.txt](third_party/PI_LICENSE.txt).
