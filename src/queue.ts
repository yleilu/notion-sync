type Task = {
  fn: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
};

const queue: Task[] = [];
let processing = false;

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

const process = async (): Promise<void> => {
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

export const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      fn: fn as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    void process();
  });
};
