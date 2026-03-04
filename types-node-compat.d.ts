declare const process: {
  env: Record<string, string | undefined>;
};

declare class Buffer {
  static concat(chunks: Buffer[]): Buffer;
  static from(input: string, encoding?: string): Buffer;
  readonly length: number;
  toString(encoding?: string): string;
}

declare module 'node:http' {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    on(event: 'data' | 'end' | 'error', listener: (...args: unknown[]) => void): void;
  }

  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string>): this;
    end(chunk?: string): void;
  }

  export interface Server {
    listen(port: number, host: string, listeningListener?: () => void): void;
  }

  export function createServer(
    requestListener: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  ): Server;
}

declare module 'node:crypto' {
  export type JsonWebKey = { [key: string]: unknown };
  export function randomUUID(): string;
  export function timingSafeEqual(a: Buffer, b: Buffer): boolean;
  export function createPublicKey(input: { key: JsonWebKey; format: 'jwk' }): unknown;
  export function randomBytes(size: number): Buffer;
  export function createCipheriv(algorithm: string, key: Buffer, iv: Buffer): {
    update(data: Buffer): Buffer;
    final(): Buffer;
    getAuthTag(): Buffer;
  };
  export function createDecipheriv(algorithm: string, key: Buffer, iv: Buffer): {
    update(data: Buffer): Buffer;
    final(): Buffer;
    setAuthTag(tag: Buffer): void;
  };
  export function createVerify(algorithm: string): {
    update(data: string | Buffer): void;
    end(): void;
    verify(key: unknown, signature: Buffer): boolean;
  };
  export function createHash(algorithm: string): {
    update(data: string | Buffer): { digest(encoding: 'hex' | 'base64'): string };
    digest(encoding: 'hex' | 'base64'): string;
  };
  export function createHmac(algorithm: string, key: string): {
    update(data: string | Buffer): { digest(encoding: 'hex' | 'base64'): string };
    digest(encoding: 'hex' | 'base64'): string;
  };
}

declare module 'node:child_process' {
  export function spawnSync(
    command: string,
    args: string[],
    options?: {
      input?: string;
      encoding?: string;
      stdio?: [string, string, string];
    }
  ): { status: number | null; stdout: string; stderr: string };
}

declare module 'bullmq' {
  export class Worker {
    constructor(
      queueName: string,
      processor: (job: { data: unknown }) => Promise<void>,
      options?: {
        connection?: { host?: string; port?: number; password?: string };
        concurrency?: number;
      }
    );
    on(event: 'failed' | 'error', listener: (...args: unknown[]) => void): void;
  }
}
