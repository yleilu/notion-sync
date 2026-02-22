import { sleep } from './sleep.js';

type Task = {
  fn: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

const queue: Task[] = [];
let processing = false;

const drain = async (): Promise<void> => {
  if (processing) return;
  processing = true;

  let isFirst = true;
  while (queue.length > 0) {
    if (!isFirst) await sleep(334);
    isFirst = false;

    const task = queue.shift()!;
    try {
      const result = await task.fn();
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    }
  }

  processing = false;
};

export const enqueue = <T>(
  fn: () => Promise<T>,
): Promise<T> => new Promise<T>((resolve, reject) => {
  queue.push({
    fn: fn as () => Promise<unknown>,
    resolve: resolve as (value: unknown) => void,
    reject,
  });
  drain();
});
