## STATUS (updated 2026-11-14)
- First React/Vite/TypeScript web preview implemented on feature branch; not deployed.
- Read README.md and PROVIDERS.md for current architecture, commands, limits and production blockers.
- routecast-build-plan.md is the preserved historical roadmap, not the current provider contract.
- npm ci; copy .env.example to .env only for private noncommercial evaluation; npm run dev.
- Checks: npm run typecheck; npm run lint; npm test; npm run build; npm run test:ui.
- Do not enable the development provider gateway on a public host. No accounts, payments, email capture, saved routes or sharing implemented.
