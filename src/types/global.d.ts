declare type SafeAny = any

declare type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue }
