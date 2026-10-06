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

/** The HTTP status of a backend refusal, when the error carries one. */
export function httpStatusOf(error: unknown): number | undefined {
  const statusCode = (error as { statusCode?: unknown } | undefined)
    ?.statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/**
 * What an error says, for a sentence shown to a person. The approvals client
 * puts the backend's own wording in `message`, which is written to be read.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
