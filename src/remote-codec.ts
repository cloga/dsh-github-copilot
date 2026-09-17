/** Client-safe bridge between legacy schema codecs and alpha.2 create factories. */
export function strictRemoteCodec<Schema extends { parse(value: unknown): unknown }>(typeSymbol: string, schema: Schema) {
  // Older supported gateways read schema directly. Alpha.2 calls create when
  // decoding a boundary value. Both paths use the exact same strict parser;
  // never fall back to src-json or choose a parser based on untrusted payloads.
  return { mode: 'strict' as const, typeSymbol, schema, create: (): Schema => schema }
}
