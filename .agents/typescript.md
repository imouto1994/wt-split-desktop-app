# TypeScript Conventions

## Avoid Type Casting

Never cast types unless absolutely necessary. This includes:

- Manual generic type parameters (e.g., `<Type>`)
- Type assertions using `as`
- Type assertions using `satisfies`

## Prefer Type Inference

Infer types by going up the logical chain:

1. **Schema validation** as source of truth (Zod schemas in `src/ipc/webtoon/schemas.ts`)
2. **Type inference** from function return types and oRPC handler signatures
3. **Fix at source** (schema, function signature) rather than casting at point of use

```typescript
// Bad
const result = await ipc.client.webtoon.processWebtoon(input) as ProcessResult;

// Good — type is inferred from the oRPC router definition
const result = await ipc.client.webtoon.processWebtoon(input);
```

## Generic Type Parameter Naming

All generic type parameters must be prefixed with `T`.

Common names: `T`, `TArgs`, `TReturn`, `TData`, `TError`, `TKey`, `TValue`

## Interface vs Type

- Use `interface` for object shapes that may be extended.
- Use `type` for unions, intersections, and utility types.
- Shared types live in `src/components/webtoon/types.ts` for the webtoon domain.
