import pino from 'pino';
import { config, isProduction } from '../config/index';

/**
 * Redaction is the important part here: no password, token, secret, MFA seed,
 * database URL or gateway key may ever reach a log line.
 */
const redact = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["x-internal-key"]',
    'res.headers["set-cookie"]',
    'password',
    '*.password',
    'currentPassword',
    '*.currentPassword',
    'newPassword',
    '*.newPassword',
    'confirmPassword',
    '*.confirmPassword',
    'passwordHash',
    '*.passwordHash',
    'token',
    '*.token',
    'tokenHash',
    '*.tokenHash',
    'accessToken',
    '*.accessToken',
    'refreshToken',
    '*.refreshToken',
    'mfaSecret',
    '*.mfaSecret',
    'mfaSecretEncrypted',
    '*.mfaSecretEncrypted',
    'recoveryCode',
    '*.recoveryCode',
    'recoveryCodes',
    '*.recoveryCodes',
    'code',
    'secret',
    '*.secret',
    'apiKey',
    '*.apiKey',
    'webhookSecret',
    '*.webhookSecret',
    'connectionString',
    '*.connectionString',
    'databaseUrl',
    '*.databaseUrl',
  ],
  censor: '[redacted]',
};

export const logger = pino({
  level: config.logLevel,
  redact,
  base: { service: 'client-api', env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service,env' },
        },
      }),
});

export type Logger = typeof logger;
