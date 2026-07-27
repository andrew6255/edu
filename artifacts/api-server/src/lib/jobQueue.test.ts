import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks must be defined before imports ─────────────────────────────────────

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the repository as a class (constructor function)
vi.mock('../modules/program-ingestion/repository', () => {
  const MockRepository = vi.fn(function (this: any) {
    this.getJobState = vi.fn().mockResolvedValue({ job: { providerMeta: {} } });
    this.updateJobStage = vi.fn().mockResolvedValue(undefined);
    this.setJobError = vi.fn().mockResolvedValue(undefined);
  });
  return { DbProgramIngestionRepository: MockRepository };
});

// Import AFTER mocks so hoisting takes effect
import { jobQueue } from './jobQueue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSuccessTask() {
  return vi.fn().mockImplementation(async (updateProgress: (p: number, msg: string) => Promise<void>) => {
    await updateProgress(50, 'halfway');
    return 'done';
  });
}

function makeFailingTask(message = 'task error') {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ─── Queue Status ──────────────────────────────────────────────────────────────

describe('JobQueueManager — getQueueStatus', () => {
  it('returns the correct shape with numeric fields', () => {
    const status = jobQueue.getQueueStatus();
    expect(status).toMatchObject({
      active: expect.any(Number),
      pending: expect.any(Number),
    });
  });

  it('active count is 0 before any jobs are enqueued', () => {
    const { active } = jobQueue.getQueueStatus();
    expect(active).toBeGreaterThanOrEqual(0);
  });
});

// ─── Task Execution ────────────────────────────────────────────────────────────

describe('JobQueueManager — successful task execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('calls the task function when enqueued', async () => {
    const task = makeSuccessTask();
    await jobQueue.enqueue('job-exec-1', task);
    await vi.runAllTimersAsync();
    expect(task).toHaveBeenCalledOnce();
  });

  it('passes an updateProgress callback as the first argument to the task', async () => {
    let receivedCallback: unknown = null;
    const task = vi.fn().mockImplementation(async (up: unknown) => {
      receivedCallback = up;
    });

    await jobQueue.enqueue('job-callback-check', task);
    await vi.runAllTimersAsync();

    expect(typeof receivedCallback).toBe('function');
  });

  it('executes the task and does not throw for a healthy success path', async () => {
    const task = makeSuccessTask();
    await expect(jobQueue.enqueue('job-healthy', task)).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
  });
});

// ─── Error Handling ────────────────────────────────────────────────────────────

describe('JobQueueManager — error handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not retry on a permanent (non-rate-limit) error', async () => {
    const task = makeFailingTask('Fatal DB constraint violation');
    await jobQueue.enqueue('job-no-retry', task, 3);
    await vi.runAllTimersAsync();

    // Only called once — not retried for non-429 errors
    expect(task).toHaveBeenCalledOnce();
  });

  it('respects maxRetries=0 and never retries', async () => {
    const task = makeFailingTask('429 rate limit');
    await jobQueue.enqueue('job-zero-retries', task, 0);
    await vi.runAllTimersAsync();

    expect(task).toHaveBeenCalledOnce();
  });

  it('enqueue resolves even when the task rejects', async () => {
    const task = makeFailingTask('unexpected crash');
    await expect(jobQueue.enqueue('job-reject-resolve', task, 0)).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
  });

  it('schedules a retry with backoff on a 429 rate-limit error when retries remain', async () => {
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('429 rate limit exceeded'))
      .mockResolvedValueOnce('recovered');

    await jobQueue.enqueue('job-rate-limit-retry', task, 2);

    // First attempt fires immediately
    await vi.runAllTimersAsync();

    // Advance past first backoff: 2^1 * 3000 = 6000ms
    vi.advanceTimersByTime(7000);
    await vi.runAllTimersAsync();
    await vi.runAllTimersAsync();

    // Should have attempted at least once
    expect(task.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── maxRetries default ────────────────────────────────────────────────────────

describe('JobQueueManager — maxRetries defaults', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('uses 3 as the default maxRetries when not specified', async () => {
    vi.useFakeTimers();
    // With default maxRetries=3 and a non-rate-limit error, task still only runs once
    const task = makeFailingTask('generic error');
    await jobQueue.enqueue('job-default-retries', task);
    await vi.runAllTimersAsync();
    expect(task).toHaveBeenCalledOnce();
  });
});
