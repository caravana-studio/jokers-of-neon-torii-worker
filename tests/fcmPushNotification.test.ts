import assert from 'node:assert/strict';
import test from 'node:test';
import { sendPushNotification } from '../src/platform/notifications/fcm.js';

type TestDependencies = {
  sendMessage: (message: unknown) => Promise<void>;
  disableToken: (token: string) => Promise<void>;
  logger: {
    error: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
  };
};

const sendWithDependencies = sendPushNotification as unknown as (
  token: string,
  title: string,
  body: string,
  dependencies: TestDependencies
) => Promise<'sent' | 'invalid_token' | 'temporary_failure'>;

test('reports a successful push notification as sent', async () => {
  const result = await sendWithDependencies('valid-fcm-token', 'Title', 'Body', {
    sendMessage: async () => undefined,
    disableToken: async () => undefined,
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
  });

  assert.equal(result, 'sent');
});

test('disables a registration token that Firebase no longer recognizes', async () => {
  const disabledTokens: string[] = [];
  const invalidToken = 'unregistered-fcm-token';

  const result = await sendWithDependencies(invalidToken, 'Title', 'Body', {
    sendMessage: async () => {
      throw {
        code: 'messaging/registration-token-not-registered',
        message: 'NotRegistered',
      };
    },
    disableToken: async token => {
      disabledTokens.push(token);
    },
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
  });

  assert.deepEqual(
    { result, disabledTokens },
    { result: 'invalid_token', disabledTokens: [invalidToken] }
  );
});

test('disables a malformed Firebase registration token', async () => {
  const disabledTokens: string[] = [];
  const invalidToken = 'malformed-fcm-token';

  const result = await sendWithDependencies(invalidToken, 'Title', 'Body', {
    sendMessage: async () => {
      throw {
        errorInfo: {
          code: 'messaging/invalid-registration-token',
        },
      };
    },
    disableToken: async token => {
      disabledTokens.push(token);
    },
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
  });

  assert.deepEqual(
    { result, disabledTokens },
    { result: 'invalid_token', disabledTokens: [invalidToken] }
  );
});

test('keeps a registration token enabled after a temporary Firebase failure', async () => {
  const disabledTokens: string[] = [];

  const result = await sendWithDependencies('retryable-fcm-token', 'Title', 'Body', {
    sendMessage: async () => {
      throw {
        code: 'messaging/internal-error',
        message: 'Firebase temporarily unavailable',
      };
    },
    disableToken: async token => {
      disabledTokens.push(token);
    },
    logger: {
      error: () => undefined,
      info: () => undefined,
    },
  });

  assert.deepEqual(
    { result, disabledTokens },
    { result: 'temporary_failure', disabledTokens: [] }
  );
});

test('does not include the complete registration token in logs', async () => {
  const token = 'very-sensitive-registration-token-value';
  const logEntries: string[] = [];
  const logger = {
    error: (...args: unknown[]) => {
      logEntries.push(
        args
          .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join(' ')
      );
    },
    info: (...args: unknown[]) => {
      logEntries.push(
        args
          .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
          .join(' ')
      );
    },
  };

  await sendWithDependencies(token, 'Title', 'Body', {
    sendMessage: async () => {
      throw {
        code: 'messaging/internal-error',
        message: `Temporary failure for token ${token}`,
      };
    },
    disableToken: async () => undefined,
    logger,
  });

  assert.equal(logEntries.some(entry => entry.includes(token)), false);
});
