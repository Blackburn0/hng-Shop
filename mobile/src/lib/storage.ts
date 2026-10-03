// Web build: browsers already have localStorage. (storage.native.ts is used on
// Android/iOS.)
export const sessionStorage = typeof window === "undefined" ? undefined : window.localStorage;
