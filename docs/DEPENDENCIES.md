# Dependency checks — 29 October 2026

The clean source installation initially failed on Windows because the Ganache nested
`fsevents` lock entry was marked extraneous rather than optional. Regenerating the
lock using `npm install --package-lock-only --ignore-scripts` removed that stale
entry. A clean `npm ci --ignore-scripts`, production build and unit suite then passed
in a separate extracted-source directory. No platform check was disabled.

The production dependency audit identified `ws` transitively through viem. An explicit
`ws: 8.21.0` override pins the patched release while retaining the application SDK
versions. Sources: [memory exhaustion advisory](https://github.com/advisories/GHSA-96hv-2xvq-fx4p),
[memory disclosure advisory](https://github.com/advisories/GHSA-58qx-3vcg-4xpx).
The October audit snapshot reported no production findings for the versions checked at that time.

The full development/toolchain tree still has upstream audit findings, including
archived Ganache dependencies. Do not treat the production audit as a clean full
dependency audit. Ganache/Hardhat fixtures stay local and are excluded from the
static hosted bundle. Do not expose unlocked local RPC accounts to a public interface.
Unreviewed `npm audit fix --force` was not used to replace toolchains or SDKs.

A fresh frontend audit on 6 November 2026 reported 55 production dependency findings, including findings under the Privy SDK. The separate API installation reported zero audit findings. Run `npm audit --omit=dev` in each package for current results. The earlier snapshot is in [the October audit report](../evidence/dependency-audit-production.json).
