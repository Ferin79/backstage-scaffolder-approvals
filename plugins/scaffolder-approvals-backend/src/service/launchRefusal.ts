/*
 * Copyright 2026 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { STATUS_CODES } from 'node:http';

/**
 * Statuses the scaffolder answers with before it has created a task, and which
 * the same request would get again: the values do not fit the template's
 * parameters (400, 422), the template is not there (404), or the caller may
 * not use it (403).
 *
 * Deliberately narrow. A 401 can be a key rotating, a 5xx or a dropped
 * connection says nothing about whether a task exists, and both are worth
 * retrying (Q9). Only an answer that proves no task was created, and that no
 * retry could change, ends the request here.
 */
const DEFINITE_REFUSALS = new Set([400, 403, 404, 422]);

/** Longer than this and a reason is a log, not a sentence. */
const MAX_REASON_LENGTH = 500;

/**
 * `ScaffolderClient.scaffold` throws a plain `Error` for any answer but 201,
 * formatted `Backend request failed, <status> <statusText> <body>`. The status
 * text can be several words and the body need not be JSON, so only the status
 * is read from the line, and the body only from its first brace.
 */
const CLIENT_FAILURE = /^Backend request failed, (\d{3})\b/;

interface Refusal {
  status: number;
  body: string;
}

function readRefusal(error: unknown): Refusal | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  // A client that throws a `ResponseError` instead carries the status itself.
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number') {
    const body = (error as { body?: unknown }).body;
    return {
      status: statusCode,
      body: body === undefined ? '' : JSON.stringify(body),
    };
  }

  const match = CLIENT_FAILURE.exec(error.message);
  if (!match) {
    return undefined;
  }
  const start = error.message.search(/[{[]/);
  return {
    status: Number(match[1]),
    body: start === -1 ? '' : error.message.slice(start),
  };
}

/**
 * What the scaffolder said, as a sentence: the parameter validation messages,
 * or a Backstage error's message. Never the raw body, which echoes the
 * submitted values and the whole parameter schema.
 */
function readDetail(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }

  // The scaffolder's own parameter validation: `{ errors: [{ property,
  // message }] }`, where `property` is `instance` or `instance.some.field`.
  const errors = (parsed as { errors?: unknown }).errors;
  if (Array.isArray(errors)) {
    const messages = errors
      .map(entry => {
        const { property, message } = (entry ?? {}) as {
          property?: unknown;
          message?: unknown;
        };
        if (typeof message !== 'string') {
          return undefined;
        }
        const field =
          typeof property === 'string'
            ? property.replace(/^instance\.?/, '')
            : '';
        return field ? `${field} ${message}` : message;
      })
      .filter((message): message is string => Boolean(message));
    if (messages.length) {
      return messages.join('; ');
    }
  }

  // Any other Backstage error: `{ error: { name, message } }`.
  const message = (parsed as { error?: { message?: unknown } }).error?.message;
  return typeof message === 'string' && message ? message : undefined;
}

/**
 * Whether a failed `scaffold()` was the scaffolder refusing the request
 * outright, and if so, why, in a sentence for the requester.
 *
 * Undefined means the outcome is unknown — a timeout, a 5xx, a connection
 * reset — and a task may yet exist, so the launch is retried as before.
 */
export function describeLaunchRefusal(error: unknown): string | undefined {
  const refusal = readRefusal(error);
  if (!refusal || !DEFINITE_REFUSALS.has(refusal.status)) {
    return undefined;
  }

  const answer = [String(refusal.status), STATUS_CODES[refusal.status]]
    .filter(Boolean)
    .join(' ');
  const detail = readDetail(refusal.body);
  const reason = `the scaffolder refused to start the template (${answer})${
    detail ? `: ${detail}` : ''
  }`;

  return reason.length > MAX_REASON_LENGTH
    ? `${reason.slice(0, MAX_REASON_LENGTH - 1)}…`
    : reason;
}
