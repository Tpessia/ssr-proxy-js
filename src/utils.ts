import { Stream } from 'stream';

export function getOrCall<T>(obj: T | ((...args: any[]) => T), ...args: any[]): T;
export function getOrCall<T>(obj?: T | ((...args: any[]) => T), ...args: any[]): T | undefined {
    return typeof obj === 'function' ? (obj as (...args: any[]) => T)?.(...args) : obj;
}

export function streamToString(stream: Stream): Promise<string> {
    const chunks: Buffer[] = [];
    return new Promise((res, rej) => {
        if (!stream?.on) return res(stream as any);
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('error', err => rej(err));
        stream.on('end', () => res(Buffer.concat(chunks as any).toString('utf8')));
    });
}

export function promiseParallel<T, TRej = T>(tasks: (() => Promise<T>)[], concurrencyLimit: number, noReject: boolean = false): Promise<(T | TRej)[]> {
    return new Promise<(T | TRej)[]>((res, rej) => {
        if (tasks.length === 0) res([]);

        const results: (T | TRej)[] = [];
        const pool: Promise<T | TRej>[] = [];
        let canceled: boolean = false;

        tasks.slice(0, concurrencyLimit).map(async (e) => await runPromise(e));

        function runPromise(task: () => Promise<T>): Promise<T | TRej> {
            let promise: Promise<T | TRej> = task();

            pool.push(promise);

            if (noReject) promise = promise.catch((e: TRej) => e);

            promise = promise.then(async r => {
                if (canceled) return r;

                results.push(r);

                const poolIndex = pool.indexOf(promise);
                pool.splice(poolIndex, 1);

                if (tasks.length === results.length)
                    res(results);

                const nextIndex = concurrencyLimit + results.length - 1;
                const nextTask = tasks[nextIndex];

                if (!nextTask) return r;

                return await runPromise(nextTask);
            });

            if (!noReject) promise = promise.catch(err => { canceled = true; rej(err); return err; });

            return promise;
        }
    });
}

export async function promiseRetry<T>(func: () => Promise<T>, maxRetries: number, onError?: (err: any) => void): Promise<T> {
    try {
        return await func();
    } catch (err) {
        onError?.(err);
        const funcAny = (func as any);
        funcAny._retries = (funcAny._retries as number ?? 0) + 1;
        if (funcAny._retries >= maxRetries) throw err;
        else return await promiseRetry(func, maxRetries, onError);
    }
}

export function promiseDeferred<T>(): { promise: Promise<T>, resolve: (value: T) => void, reject: (reason?: any) => void } {
    let resolve: (value: T) => void;
    let reject: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve: resolve!, reject: reject! };
}

export const createLock = () => {
    const queue: (() => Promise<void>)[] = [];

    let active = false;

    return (fn: () => Promise<any>) => {
        const { promise, resolve, reject } = promiseDeferred();

        // call function then next on queue
        const exec = async () => {
            await fn().then(resolve, reject);
            if (queue.length > 0) {
                queue.shift()!(); // call next function
            } else {
                active = false;
            }
        };

        // call current or add to queue
        if (active) {
            queue.push(exec);
        } else {
            active = true;
            exec();
        }

        return promise;
    };
};

export function timeoutAsync(callback: () => void | Promise<void>, timeout: number) {
    return new Promise<void>((res, rej) => {
        setTimeout(async () => {
            await callback();
            res();
        }, timeout);
    });
}

export function intervalAsync(callback: () => boolean | Promise<boolean>, timeout: number, eager: boolean = false) {
    return new Promise<void>(async (res, rej) => {
        if (eager && await callback()) return res();
        const interval = setInterval(async () => {
            if (await callback()) {
                clearInterval(interval);
                return res();
            }
        }, timeout);
    });
}

export function sleep(timeout: number) {
    return timeoutAsync(async () => {}, timeout);
}