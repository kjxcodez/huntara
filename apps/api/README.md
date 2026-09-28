# HUNTARA Backend Foundation

Production-ready backend API foundation built with **Node.js 22**, **Hono**, **MongoDB/Mongoose**, and **TypeScript**.

## Architecture & Layout

This backend applies strict **Clean Architecture** patterns:

```
Routes  ──>  Services  ──>  Repositories  ──>  MongoDB / Mongoose
```

- No routes directly query database models.
- Core services contain zero HTTP context.
- Centralized errors sanitise database errors to prevent exposure of system tables or structures.

```
src/
├── app.ts                 # App middleware & general routing configuration
├── index.ts               # Node-Server listener & graceful shutdown setup
├── config/                # Environment variables validation, logger & database configurations
├── db/                    # Mongoose database instance configurations & pooling singleton
├── middleware/            # Custom validation, error handlers & authentication middlewares
├── routes/                # Modular route modules
├── services/              # Domain Services (Clean Architecture)
├── repositories/          # Data Access Layers (Clean Architecture)
├── utils/                 # Response standardizer, date, pagination, and ObjectId utilities
└── openapi/               # Shared OpenAPI schemas
```

## Running the API

### Environment Variables Setup

Copy or configure standard variables in your `.env` file:

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/huntara
BETTER_AUTH_SECRET=a_very_secure_better_auth_secret_minimum_32_characters_long
BETTER_AUTH_URL=http://localhost:3000
LOG_LEVEL=debug
CORS_ORIGIN=*
```

### Scripts

- Run local server in dev watch mode: `pnpm --filter api run dev`
- Run linting: `pnpm --filter api run lint`
- Type-check checks: `pnpm --filter api run check-types`
- Compile production bundle: `pnpm --filter api run build`
