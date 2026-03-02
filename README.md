# walkai-client

Frontend client for the `walk:ai` platform, built with React, TypeScript, Vite, and React Query.

## Stack

- React 19 + TypeScript (strict mode)
- Vite 7
- React Router 7
- TanStack Query 5
- ESLint 9 + `typescript-eslint`

## Requirements

- Node.js 20+ (recommended)
- npm 10+ (recommended)

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure environment variables:

   ```bash
   cp .env.development .env.local
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

4. Open `http://localhost:5173`.

## Environment Variables

Only one environment variable is required:

| Variable | Description | Example |
| --- | --- | --- |
| `VITE_API_BASE` | Base URL used by client API calls | `/api` (dev, through Vite proxy) or `https://api.walkaiorg.app` (prod) |

Current defaults in this repository:

- `.env.development`: `VITE_API_BASE=/api`
- `.env.production`: `VITE_API_BASE=https://api.walkaiorg.app`

## API Proxy (Development)

When running `npm run dev`, Vite proxies `/api/*` to `http://127.0.0.1:8000/*` and removes the `/api` prefix.

Example:

- Client request: `/api/login`
- Proxied backend request: `http://127.0.0.1:8000/login`

## Available Scripts

- `npm run dev` - start Vite dev server with HMR
- `npm run build` - create production build in `dist/`
- `npm run preview` - preview the production build locally
- `npm run lint` - run ESLint checks

## Project Structure

```text
src/
  api/                # API clients and request helpers
  components/         # Reusable UI pieces (cards, sidebar, icons, guards)
  layouts/            # Auth and admin layouts
  pages/              # Route-level pages
  constants/          # Shared constants
public/               # Static assets
```

## Quality Checks

Run these before opening a PR:

```bash
npm run lint
npm run build
```

Note: there is currently no `npm test` script configured.
