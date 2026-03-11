import { spawnSync } from 'node:child_process';

export interface RedisConnection {
  host: string;
  port: number;
  db?: number;
  password?: string;
}

function redisArgs(connection: RedisConnection): string[] {
  const args = ['-h', connection.host, '-p', String(connection.port), '-n', String(connection.db ?? 0), '--raw'];
  if (connection.password) args.push('--pass', connection.password);
  args.push('--no-auth-warning');
  return args;
}

export class Queue {
  constructor(private readonly queueName: string, private readonly opts: { connection: RedisConnection }) {}

  async add(_name: string, data: Record<string, unknown>, _opts?: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify(data);
    // Use dash instead of colon to avoid Redis bug with colon keys + password auth + RPUSH
    // Use spawnSync (array args) instead of execSync (shell string) to avoid shell mangling JSON quotes
    const args = [...redisArgs(this.opts.connection), 'RPUSH', `bull-${this.queueName}-wait`, payload];
    const result = spawnSync('redis-cli', args, { encoding: 'utf8', stdio: 'pipe' });
    // Check both exit code AND stdout/stderr for errors — redis-cli may return
    // exit code 0 even on auth failures, putting the error message in stdout.
    const combinedOutput = `${result.stderr || ''} ${result.stdout || ''}`.toUpperCase();
    if (combinedOutput.includes('NOAUTH') || combinedOutput.includes('WRONGPASS')) {
      throw new Error('queue_auth_error');
    }
    if (result.status !== 0) {
      if (combinedOutput.includes('AUTH')) {
        throw new Error('queue_auth_error');
      }
      throw new Error('queue_error');
    }
  }
}

export class Worker {
  private handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  private stopped = false;

  constructor(
    private readonly queueName: string,
    private readonly processor: (job: { data: unknown; attemptsMade?: number; opts?: { attempts?: number } }) => Promise<void>,
    private readonly opts: { connection: RedisConnection; concurrency?: number }
  ) {
    void this.loop();
  }

  on(event: 'failed' | 'error', handler: (...args: unknown[]) => void) {
    this.handlers[event] = this.handlers[event] ?? [];
    this.handlers[event]?.push(handler);
  }

  async waitUntilReady(): Promise<void> {
    const ping = spawnSync('redis-cli', [...redisArgs(this.opts.connection), 'PING'], { encoding: 'utf8' });
    const combinedOutput = `${ping.stderr || ''} ${ping.stdout || ''}`.toUpperCase();
    if (combinedOutput.includes('NOAUTH') || combinedOutput.includes('WRONGPASS')) {
      throw new Error('redis_auth_error');
    }
    if (ping.status !== 0) throw new Error('redis_unavailable');
  }

  private emit(event: 'failed' | 'error', ...args: unknown[]) {
    for (const handler of this.handlers[event] ?? []) {
      handler(...args);
    }
  }

  private async loop() {
    while (!this.stopped) {
      try {
        // Use dash instead of colon to avoid Redis bug with colon keys + password auth + RPUSH
        const result = spawnSync('redis-cli', [...redisArgs(this.opts.connection), 'BRPOP', `bull-${this.queueName}-wait`, '1'], { encoding: 'utf8' });
        const loopOutput = `${result.stderr || ''} ${result.stdout || ''}`.toUpperCase();
        if (loopOutput.includes('NOAUTH') || loopOutput.includes('WRONGPASS')) {
          this.emit('error', new Error('worker_queue_auth_error'));
          continue;
        }
        if (result.status !== 0) {
          this.emit('error', new Error('worker_queue_error'));
          continue;
        }
        const lines = result.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
        const payload = lines.at(-1);
        if (!payload || payload === `bull-${this.queueName}-wait`) {
          continue;
        }
        try {
          const parsed = JSON.parse(payload);
          await this.processor({ data: parsed, attemptsMade: 0, opts: { attempts: 1 } });
        } catch (error) {
          this.emit('failed', { data: payload }, error);
        }
      } catch (error) {
        this.emit('error', error instanceof Error ? error : new Error('unknown'));
      }
    }
  }
}
