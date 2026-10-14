export declare function base32Decode(text: string): Uint8Array;
export declare function hotp(key: Uint8Array, counter: number, digits?: number, algorithm?: string): string;
export declare function totp(secret: string, at?: number, o?: { digits?: number; step?: number; algorithm?: string }): string;
export declare function freshTotp(secret: string, used?: Set<string>): Promise<string>;
