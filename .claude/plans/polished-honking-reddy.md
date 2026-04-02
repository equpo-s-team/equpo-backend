# TypeScript Request Type Fix Plan

## Context

The Express app uses Firebase Auth middleware (`requireUser`) that attaches a `user` property to the request object. However, TypeScript's default Express `Request` type doesn't include this property, causing errors like:

```
Property 'user' does not exist on type 'Request<ParamsDictionary, any, any, ParsedQs>'
```

## Solution: Global Type Augmentation

Create a type declaration file that extends Express's `Request` type globally using TypeScript's module augmentation feature.

## Implementation Steps

### 1. Create `src/types/express.d.ts` (NEW FILE)

```typescript
import type { AuthenticatedRequest } from './AuthenticatedRequest.js';
import type { Request } from 'express';

declare module 'express' {
  interface Request extends AuthenticatedRequest {}
}
```

## Files to Modify

| Action | File |
|--------|------|
| CREATE | `src/types/express.d.ts` |

## Verification Steps

1. Run `npx tsc --noEmit` - should pass without errors
2. Run the app with `npm run dev` - should start without type errors
