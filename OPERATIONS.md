# EuroLoot staging operations

## Start a private local test

From the retail branch, install Node.js 24 and run the following commands in the repository root. The retail runtime uses Node built-ins. Playwright is a development dependency for browser tests.

```sh
npm ci
npm run check
npm run build
npm test
npm run dev
```

Open http://127.0.0.1:4173/retail/ and choose Account. Paste the one-use invitation printed by the server. The invitation expires after 15 minutes. On a second terminal in the same directory, generate another invitation with `node scripts/local-db.mjs fixture-customer customer`. Generate a separate staff fixture with `node scripts/local-db.mjs fixture-review admin`. Use a different browser profile when testing staff and customer sessions together. Use fictional information.

From Store, add Delivery check to the basket. Enter TEST25 at checkout. The €4.00 fixture becomes a €3.00 simulated order. Open Library and save the verified 119-byte file. A local administrator can refund the order by ID in Administration. A refunded order loses its entitlement immediately. The fixture, test account and simulated Irish location exist only in this development mode. A second device has its own local database.

For browser tests, run `npx --no-install playwright install chromium` followed by `npm run test:browser`. On a minimal Linux system use `npx --no-install playwright install --with-deps chromium`. Tests create independent SQLite databases and exercise the HTTP server at desktop, tablet and mobile widths.

## Application boundaries

External game discovery on the existing home page uses CheapShark and its original USD currency. The direct store at /retail/ owns its EUR basket, test orders, grant records and authorised release metadata. An external store link never creates an entitlement. All current direct checkout paths are test-only. Quantities of digital licences are one.

The Worker evaluates request.cf.country before serving assets, APIs and downloads. Only the limited database health response and signed Stripe webhook are reachable independently of country. The 27 member-state country codes are in server/policy.mjs. Separate territory codes default to denial pending a reviewed territory/rights matrix. IP classification is approximate. The system checks the account country separately and checks the declared billing country on checkout and the provider-supplied billing country on settlement. Card issuer and VPN risk checks are future work. The legacy GitHub Pages site has its own origin and configuration. It cannot enforce the Worker gate and must never act as a retail backend.

The database schema, order validation, entitlement issuance and refund revocation are in db/0001_retail.sql. Product, cart and identity records are private behind Worker bindings. The client never gets a database service key. The operator's support/admin role is stored in accounts; hosted privileged routes also require a session established from a provider-verified AAL2 token. There is no role-setting endpoint. Administrators can review submissions and tickets; approving a submission does not distribute or publish software.

## Provision a separate hosted staging environment

An authorised Cloudflare account, a staging identity project and test-mode payment account are required for the respective integrations. Keep production and staging in separate databases, buckets and Worker bindings. The placeholder database ID deliberately prevents deployment onto an unrelated project.

1. Install the current compatible Wrangler 4 CLI on a development machine and authenticate to the intended account. Confirm plan, quotas and R2 billing exposure before enabling a chargeable product. Run `npx wrangler@4 whoami` to inspect the selected account.
2. Run `npx wrangler@4 d1 create euroloot-staging --jurisdiction eu` and place the returned database ID in a local staging copy of wrangler.jsonc. Create a private R2 bucket named euroloot-private-staging. Keep its public URL and custom-domain download access disabled. If a jurisdiction-specific bucket is used, configure the corresponding jurisdiction on both its binding and upload commands.
3. From the repository root, run the commands below against the new staging resources. Use the same config file on every command if you use a separate copy.
   
   ```sh
   npm ci
   npm run build
   npx wrangler@4 d1 migrations apply euroloot-staging --remote
   npx wrangler@4 r2 object put euroloot-private-staging/test/receipt-1.txt --file fixtures/receipt.txt --remote
   npx wrangler@4 d1 execute euroloot-staging --remote --file fixtures/sandbox.sql
   ```

4. Set AUTH_ORIGIN to the intended Supabase HTTPS project origin, AUTH_PUBLISHABLE_KEY to its publishable key, and SANDBOX to 1. Keep test payment secrets in Worker secrets with `npx wrangler@4 secret put STRIPE_TEST_KEY` and `npx wrangler@4 secret put STRIPE_WEBHOOK_SECRET`. Never insert live keys. Use the email OTP template containing `{{ .Token }}` in Supabase, an authorised sender and staging test accounts. End-to-end provider onboarding must be run with those accounts. The API supports exchanging an already verified Supabase session for a retail cookie. The hosted sign-in form is email-code based.
5. Deploy with `npx wrangler@4 deploy`. Record the actual workers.dev hostname Wrangler returns. Set the Stripe **test** webhook to https://YOUR-STAGING-HOST/webhooks/stripe. Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.expired and charge.refunded. The browser return URL only shows order history. Signed events perform reconciliation. Provider-assisted card, SCA and refund testing are release checks.
6. Test /healthz, an allowed EU request, and an out-of-region request to a static asset and to /api/catalog using genuine network location. Inspect Worker logs and Stripe webhook deliveries for 4xx/5xx. Resolve mismatched paid orders with the payment provider before granting anything. Add alerts for repeated errors, pending paid orders and quota exhaustion. Private audit data must stay out of third-party analytics.
7. After ownership of a domain is confirmed, add its active zone to the intended Cloudflare account and configure Workers & Pages → Worker → Settings → Domains & Routes → Add → Custom Domain. Cloudflare creates the DNS record and certificate. Use the exact nameservers assigned to the zone if DNS delegation is needed. Set the canonical origin at build time with PUBLIC_ORIGIN. Update auth, receipts and webhook URLs before promoting a custom domain. No ownership or DNS delegation is assumed.

[Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [Supabase OTP](https://supabase.com/docs/guides/auth/auth-email-passwordless) · [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment)

## Backup, incident and rollback

For a closed local server, use SQLite's backup facility or VACUUM INTO to produce a consistent copy. Protect backup files as customer data. The automated test restores a snapshot into a separate database and checks integrity and a retained account. For D1, take an export before migrations, record the Time Travel bookmark, restore to an isolated environment first and reconcile orders, grants and provider events. Keep independently verified copies of original authorised releases. A D1 backup does not contain R2 objects.

Roll back a faulty Worker to a previously verified deployment via the Cloudflare deployment history. Never assume application rollback undoes a migration. Use forward migrations, restore rehearsal and provider reconciliation. The staging build excludes database, executable, secret and internal development files from dist/. Private releases have expiring account-bound download tickets and a browser SHA-256 check. The database audit table blocks application UPDATE and DELETE; a database administrator remains trusted.

[Cloudflare D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/)

## Desktop release

Desktop clients run the real retail application with a local staging database and a bundled authorised fixture. The browser renderer has no Node access or privileged preload. There is no arbitrary installer, game launcher or unattended updater. All three clients depend on their embedded runtime and share desktop/main.cjs. A desktop session can be renewed from the EuroLoot menu. These packages do not synchronise with other customers or the hosted site.

On a supported native runner with Python 3.12, Node 24 and access to the official Electron release archives, run `npm run build` and `python desktop/package.py`. Packaging verifies the official runtime asset digest, attempts a real application launch, checks the session and renderer isolation, then writes the package and checksum to artifacts/packages. Linux requires Debian packaging tools, GTK/Chromium runtime libraries and Xvfb for headless CI. Windows produces a portable ZIP. macOS produces an application ZIP with ad hoc signing for testing. Public distribution needs publisher signing and macOS notarisation. Rotate to maintained runtime versions and repeat platform tests before shipping.

## Commercial launch decisions

Live Stripe keys are rejected. A local fixture order is a simulation and a signed webhook test does not demonstrate processor onboarding. Before enabling sales, verify the legal seller and authorised account representative, contracts and rights for each territory, tax and VAT handling, pre-contract information, cancellation rights and evidence of digital supply consent, dispute and refund responsibilities, customer-data retention and deletion, accessibility, and support staffing. Physical stock and shipping need their own fulfilment path. For Ireland, confirm eligible company officers and a separate secretary if the company has a single director. Obtain appropriate legal review of EU geographic restrictions and temporary travel before switching on commercial access. Review the DSA and marketplace obligations before admitting third-party traders. The legal pages are drafts. No incorporation, verified trader or commercial partnership is represented.

[Irish CRO](https://cro.ie/registration/company/incidental-obligations/company-officers/) · [EU distance selling](https://europa.eu/youreurope/business/selling-in-eu/selling-goods-services/ecommerce-distance-selling/index_en.htm) · [European Commission geographic restrictions](https://digital-strategy.ec.europa.eu/en/policies/geoblocking) · [GDPR](https://europa.eu/youreurope/business/dealing-with-customers/data-protection/data-protection-gdpr/index_en.htm)

## Operating cost and remaining work

Cloudflare's published Workers Free limit is 100,000 requests per day. Passing every static request through the Worker consumes that quota. D1's free allowance includes 5 million rows read and 100,000 rows written per day, with 5 GB total storage. R2 Standard includes 10 GB-month, one million class A operations and ten million class B operations per month; usage beyond those amounts can be billable. These are provider allowances, not an operating budget. Large commercial downloads, email delivery, monitoring, signing and merchant processing need separate estimates. GitHub Pages can serve the legacy public site; it cannot run this API. Vercel and Replit were checked as alternatives. No EuroLoot-specific backend or persistent storage was confirmed in those accounts.

[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

Next engineering priorities are hosted identity and test-card acceptance, EU-territory policy review, automatic account closure and retention, quarantined build uploads and signed release manifests, controlled publisher grants, and full order reconciliation. Friends, messaging, achievements, developer payouts, tax invoices, general game installation and patch updates remain unimplemented. There is no live inventory of licensed games.

## Identity provider activation and consent

The account page requires four separate, initially unchecked acceptances before it enables an authentication action. Each new session stores the policy version, document identifiers, method and timestamp. The backend verifies the version and all four selections before sending an email code, starting OAuth, accepting an invitation or exchanging an identity. Existing sessions issued under an earlier policy version require sign-in. Cookie policy acknowledgement is separate from consent to optional trackers; this branch does not enable optional tracking.

Email sign-in and registration share one Supabase passwordless flow. Enable email in the intended project, set the OTP email template, configure an authorised sender and set the Worker identity bindings. Supabase sends the code and verifies ownership of the email address. For Google, GitHub or Discord, configure each provider in Supabase Authentication → Sign In / Providers with the authorised client credentials. Register the Supabase auth callback URL shown there in the provider console. Add the exact EuroLoot HTTPS /auth/callback URL to Supabase's redirect allowlist. Set OAUTH_PROVIDERS to a comma-separated list of the providers that passed a real sign-in check (for example google,github). Disabled providers are omitted. OAuth uses a browser-bound, short-lived, single-use PKCE flow. Provider secrets stay in Supabase. Changing the provider list does not register applications or create credentials.

On desktop, open the EuroLoot menu and choose **Copy local test invitation**. Paste that invitation on the Account screen after reading and accepting each policy. Closing and reopening the app no longer signs a tester in automatically.
