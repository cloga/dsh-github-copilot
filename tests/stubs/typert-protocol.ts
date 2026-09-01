import { Service } from '@deepseek-ai/cordis'

export class RemoteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: object,
  ) {
    super(message)
  }
}

export class TypertRemoteService extends Service {
  constructor(ctx: ConstructorParameters<typeof Service>[0], serviceKey: string) {
    super(ctx, serviceKey)
  }
}

export function Remote(): void {}
