import { Stream } from 'stream';

export function streamToString(stream: Stream): Promise<string> {
    const chunks: Buffer[] = [];
    return new Promise((res, rej) => {
        if (!stream?.on) return res(stream as any);
        stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
        stream.on('error', err => rej(err));
        stream.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    });
}

export function promiseParallel<T, TRej = Error>(tasks: (() => Promise<T>)[], concurrencyLimit: number): Promise<(T | TRej)[]> {
    return new Promise<(T | TRej)[]>((res, rej) => {
        if (tasks.length === 0) res([]);

        const results: (T | TRej)[] = [];
        const pool: Promise<T>[] = [];
        let canceled: boolean = false;

        tasks.slice(0, concurrencyLimit).map(e => runPromise(e));

        function runPromise(task: () => Promise<T>): Promise<T> {
            const promise = task();

            pool.push(promise);

            promise.catch((e: TRej) => e)
            .then(r => {
                if (canceled) return;

                results.push(r);

                const poolIndex = pool.indexOf(promise);
                pool.splice(poolIndex, 1);

                if (tasks.length === results.length)
                    res(results);

                const nextIndex = concurrencyLimit + results.length - 1;
                const nextTask = tasks[nextIndex];

                if (!nextTask) return;

                runPromise(nextTask);
            });

            return promise;
        }
    });
}

export function getOrCall<T>(obj: T | ((...args: any[]) => T), ...args: any[]): T;
export function getOrCall<T>(obj?: T | ((...args: any[]) => T), ...args: any[]): T | undefined {
    return typeof obj === 'function' ? (obj as (...args: any[]) => T)?.(...args) : obj;
}