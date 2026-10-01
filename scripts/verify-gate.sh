#!/usr/bin/env bash
#
# Copyright 2026 The Backstage Authors
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Walks the parts of the gated flow that only a running backend can show.
#
# The security claim this plugin makes is that a gated template cannot be run by
# calling the scaffolder directly. That is checked here, against a real
# scaffolder, with a real catalog and the real gate action — the one check that
# no unit test can stand in for.
#
# Usage:
#   yarn start                    # in another terminal, from the repo root
#   ./scripts/verify-gate.sh

set -euo pipefail

BASE=${BASE:-http://localhost:7007}
TEMPLATE=${TEMPLATE:-template:default/request-github-admin}
API="$BASE/api/scaffolder-approvals"

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; exit 1; }

echo "Waiting for $BASE ..."
until curl -sf -o /dev/null "$BASE/api/scaffolder-approvals/requests" \
  -H "authorization: Bearer $(
    curl -s -X POST "$BASE/api/auth/guest/refresh" -H 'content-type: application/json' |
      node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).backstageIdentity.token))"
  )" 2>/dev/null; do
  sleep 2
done

TOKEN=$(curl -s -X POST "$BASE/api/auth/guest/refresh" -H 'content-type: application/json' |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).backstageIdentity.token))")
AUTH="authorization: Bearer $TOKEN"
JSON='content-type: application/json'

echo
echo "1. The gated annotation is derived, not authored"
# Looked up by name: the catalog holds ungated templates too, so "the first
# template" is not necessarily the one under test.
ANNOTATION=$(curl -s -H "$AUTH" "$BASE/api/catalog/entities?filter=kind=template,metadata.name=${TEMPLATE##*/}" |
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
    const t=JSON.parse(s)[0]||{};
    console.log(((t.metadata||{}).annotations||{})['scaffolder-approvals.backstage.io/gated']||'');
  })")
[ "$ANNOTATION" = "true" ] || fail "template is not marked gated (got '$ANNOTATION')"
pass "gated = true, derived from the approval:gate step"

echo
echo "2. Values are validated before anything is stored"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/requests" -H "$AUTH" -H "$JSON" \
  -d "{\"templateRef\":\"$TEMPLATE\",\"values\":{\"repository\":\"backstage\"}}")
[ "$CODE" = "400" ] || fail "incomplete values were not rejected (got $CODE)"
pass "incomplete values rejected with 400"

echo
echo "3. A valid request is stored as pending, with the policy snapshotted"
REQUEST=$(curl -s -X POST "$API/requests" -H "$AUTH" -H "$JSON" \
  -d "{\"templateRef\":\"$TEMPLATE\",\"values\":{\"repository\":\"backstage\",\"justification\":\"verification run\"}}")
ID=$(echo "$REQUEST" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
[ -n "$ID" ] || fail "no request id returned"
DETAIL=$(curl -s -H "$AUTH" "$API/requests/$ID")
echo "$DETAIL" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const r=JSON.parse(s);
  if (r.status!=='pending') { console.error('status is '+r.status); process.exit(1); }
  if (/\\\$\{\{/.test(r.summary||'')) { console.error('summary was not rendered: '+r.summary); process.exit(1); }
  if (!r.policySnapshot || !r.policySnapshot.approvers.length) { console.error('no policy snapshot'); process.exit(1); }
})" || fail "the stored request is wrong"
pass "pending, summary rendered, policy snapshotted"

echo
echo "4. THE ONE THAT MATTERS: the scaffolder cannot be used to skip the gate"
TASK=$(curl -s -X POST "$BASE/api/scaffolder/v2/tasks" -H "$AUTH" -H "$JSON" \
  -d "{\"templateRef\":\"$TEMPLATE\",\"values\":{\"repository\":\"backstage\",\"justification\":\"bypassing the gate\"}}")
TASK_ID=$(echo "$TASK" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
[ -n "$TASK_ID" ] || fail "the scaffolder refused the task outright, which is not the case under test"

for _ in $(seq 1 30); do
  STATUS=$(curl -s -H "$AUTH" "$BASE/api/scaffolder/v2/tasks/$TASK_ID" |
    node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).status))")
  [ "$STATUS" = "open" ] || [ "$STATUS" = "processing" ] || break
  sleep 1
done

[ "$STATUS" = "failed" ] || fail "the task did not fail (status: $STATUS)"
pass "task failed"

EVENTS=$(curl -s -H "$AUTH" "$BASE/api/scaffolder/v2/tasks/$TASK_ID/events")
echo "$EVENTS" | grep -q 'requires approval before it can run' ||
  fail "the task failed, but not at the gate"
pass "it failed at the gate, with the message a person should see"

# Asserting on the step and not just the task: a task that failed for some other
# reason would prove nothing about the gate.
echo "$EVENTS" | grep -q 'Skipping step grant because a previous step failed' ||
  fail "a later step was not skipped"
pass "every later step was skipped — nothing executed"

echo
printf '\033[32mThe gate holds.\033[0m\n'
