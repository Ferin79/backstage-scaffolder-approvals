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

import { Text } from '@backstage/ui';

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3_600_000],
  ['month', 30 * 24 * 3_600_000],
  ['week', 7 * 24 * 3_600_000],
  ['day', 24 * 3_600_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** The full date and time, in the viewer's locale. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
}

/**
 * "3 hours ago", or "in 2 days" for a deadline.
 *
 * How long somebody has been waiting, and how long is left, are what a reader
 * wants from a timestamp here; the exact time is one hover away.
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const elapsed = date.getTime() - now.getTime();
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(elapsed) >= size) {
      return format.format(Math.round(elapsed / size), unit);
    }
  }
  return elapsed < 0 ? 'just now' : 'in under a minute';
}

/**
 * A timestamp that reads relatively, with the exact time in its tooltip and
 * in the `datetime` attribute for anything that parses the page.
 */
export function Timestamp(props: {
  iso: string;
  variant?: 'body-small' | 'body-medium';
  color?: 'primary' | 'secondary';
}) {
  const { iso, variant = 'body-medium', color } = props;
  return (
    <Text variant={variant} color={color}>
      <time dateTime={iso} title={formatDateTime(iso)}>
        {formatRelative(iso)}
      </time>
    </Text>
  );
}
