import {
  jest,
  beforeAll,
  test,
  expect,
} from '@jest/globals';

jest.useFakeTimers();

let enqueue: (typeof import('./queue.js'))['enqueue'];

beforeAll(async () => {
  const mod = await import('./queue.js');
  enqueue = mod.enqueue;
});

test('sequential execution — tasks run one at a time', async () => {
  const timeline: string[] = [];

  const taskA = enqueue(async () => {
    timeline.push('a-start');
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    jest.advanceTimersByTime(10);
    timeline.push('a-end');
    return 'a';
  });

  const taskB = enqueue(async () => {
    timeline.push('b-start');
    await new Promise((r) => {
      setTimeout(r, 10);
    });
    jest.advanceTimersByTime(10);
    timeline.push('b-end');
    return 'b';
  });

  // Drain the queue by advancing timers (inter-request delay)
  await jest.advanceTimersByTimeAsync(1000);

  await expect(taskA).resolves.toBe('a');
  await expect(taskB).resolves.toBe('b');

  // b-start must come after a-end (sequential)
  const aEnd = timeline.indexOf('a-end');
  const bStart = timeline.indexOf('b-start');
  expect(bStart).toBeGreaterThan(aEnd);
});

test('inter-request delay — 334ms gap between tasks', async () => {
  let secondStartedAt = 0;
  let firstFinishedAt = 0;

  const taskA = enqueue(async () => {
    firstFinishedAt = Date.now();
    return 'a';
  });

  const taskB = enqueue(async () => {
    secondStartedAt = Date.now();
    return 'b';
  });

  await jest.advanceTimersByTimeAsync(1000);

  await taskA;
  await taskB;

  const gap = secondStartedAt - firstFinishedAt;
  expect(gap).toBeGreaterThanOrEqual(334);
});

test('FIFO order — tasks complete in submission order', async () => {
  const results: number[] = [];

  const t1 = enqueue(async () => {
    results.push(1);
    return 1;
  });
  const t2 = enqueue(async () => {
    results.push(2);
    return 2;
  });
  const t3 = enqueue(async () => {
    results.push(3);
    return 3;
  });

  await jest.advanceTimersByTimeAsync(2000);

  await t1;
  await t2;
  await t3;

  expect(results).toEqual([1, 2, 3]);
});

test('error propagation — rejected task does not block queue', async () => {
  const failing = enqueue(async () => {
    throw new Error('boom');
  });
  // Catch early to prevent unhandled rejection
  const failResult = failing.catch((err: unknown) => err);

  const passing = enqueue(async () => 'ok');

  await jest.advanceTimersByTimeAsync(1000);

  const err = await failResult;
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toBe('boom');
  await expect(passing).resolves.toBe('ok');
});

test('concurrent enqueue — each caller gets correct result', async () => {
  const promises = [
    enqueue(async () => 'alpha'),
    enqueue(async () => 'beta'),
    enqueue(async () => 'gamma'),
  ];

  await jest.advanceTimersByTimeAsync(2000);

  const results = await Promise.all(promises);
  expect(results).toEqual(['alpha', 'beta', 'gamma']);
});
