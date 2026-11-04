# Third-party and artwork notices

These notices cover third-party dependencies and do not grant a license to the original application code or trademarks.

Pi is pinned to `@earendil-works/pi-agent-core`, `pi-ai`, and `pi-coding-agent` **1.4.0**. They are used via their public SDK APIs without copying/modifying Pi core. [Upstream v1.4.0 MIT license](https://github.com/earendil-works/pi/blob/v1.4.0/LICENSE), copyright Mario Zechner, is retained in `PI_LICENSE.txt`; this covers the related Pi monorepo packages whose npm tarballs omit a standalone license file. No personal Pi configuration, models or credentials are included.

`DEPENDENCIES.json` records the 266 installed packages, exact versions, declared SPDX expression and source repository. `DEPENDENCY_NOTICES.txt` preserves available package license/copyright/NOTICE files. Regenerate with `node scripts/dependency-notices.mjs` after an independent frozen install. The lockfile pins tarball integrities. This initial inventory includes macOS optional build/parser binaries; other platforms may add their respective optional packages.

Key licenses: React, Express, Zod, marked, Turndown, pg and TypeScript are permissively licensed; PDF.js is Apache-2.0, Mammoth is BSD-2-Clause, and Pi is MIT. JSZip offers `MIT OR GPL-3.0-or-later`; this POC uses the MIT option. Lightning CSS and its unmodified optional build binary declare MPL-2.0; preserve their notices and upstream source link/version if redistributing those tools. They are build dependencies, not modified application sources. No GPL-only project license is inferred.

PayPal's JavaScript SDK is fetched from PayPal only after explicit checkout consent; it is not vendored or relicensed here. REST traffic is pinned to Sandbox. PayPal trademarks remain their owners'. Public case company names are factual citations, without company logos or source images. The catalog contains original project summaries, not republished articles; see `docs/CASE_SOURCES.md`.

The Ally Ahead illustrations, wordmark and reception animation fragments are application artwork used for the homepage and AI reception interface. The favicon SVG and its PNG/ICO variants identify the application in browser tabs and shortcuts. These materials do not grant rights to third-party trademarks.
