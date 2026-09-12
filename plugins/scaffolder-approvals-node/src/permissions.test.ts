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

import {
  type ApprovalRequest,
  RESOURCE_TYPE_APPROVAL_REQUEST,
} from '@backstage-community/plugin-scaffolder-approvals-common';
import {
  approvalRequestResourceRef,
  hasTemplateRef,
  isDesignatedApprover,
  isNotRequester,
} from './permissions';

const REQUEST: ApprovalRequest = {
  id: '3f1e4c8a-0000-4000-8000-000000000001',
  templateRef: 'template:default/request-github-admin',
  values: { repository: 'backstage' },
  valuesHash: 'a'.repeat(64),
  requesterRef: 'user:default/requester',
  status: 'pending',
  summary: 'Admin on backstage',
  policySnapshot: {
    approvers: ['group:default/devx-team', 'user:default/platform-lead'],
    quorum: 1,
    selfApprove: false,
  },
  createdAt: '2026-09-12T10:00:00.000Z',
  updatedAt: '2026-09-12T10:00:00.000Z',
};

describe('approvalRequestResourceRef', () => {
  it('is bound to this plugin and resource type', () => {
    // These two strings are the contract an RBAC policy is written against, so
    // changing either breaks every deployment's policy file.
    expect(approvalRequestResourceRef.pluginId).toBe('scaffolder-approvals');
    expect(approvalRequestResourceRef.resourceType).toBe(
      RESOURCE_TYPE_APPROVAL_REQUEST,
    );
  });
});

describe('isDesignatedApprover', () => {
  it('matches a caller through a listed group', () => {
    expect(
      isDesignatedApprover.apply(REQUEST, {
        userRefs: ['user:default/alice', 'group:default/devx-team'],
      }),
    ).toBe(true);
  });

  it('matches a directly listed user', () => {
    expect(
      isDesignatedApprover.apply(REQUEST, {
        userRefs: ['user:default/platform-lead'],
      }),
    ).toBe(true);
  });

  it('ignores how either side was spelled', () => {
    expect(
      isDesignatedApprover.apply(REQUEST, {
        userRefs: ['Group:DevX-Team'],
      }),
    ).toBe(true);
  });

  it('does not match someone outside the policy', () => {
    expect(
      isDesignatedApprover.apply(REQUEST, {
        userRefs: ['user:default/bob', 'group:default/other-team'],
      }),
    ).toBe(false);
    expect(isDesignatedApprover.apply(REQUEST, { userRefs: [] })).toBe(false);
  });

  it('translates to an approverRef filter', () => {
    expect(
      isDesignatedApprover.toQuery({
        userRefs: ['User:Alice', 'group:default/devx-team'],
      }),
    ).toEqual({
      key: 'approverRef',
      values: ['user:default/alice', 'group:default/devx-team'],
    });
  });
});

describe('isNotRequester', () => {
  it('allows anyone but the requester', () => {
    expect(
      isNotRequester.apply(REQUEST, { userRef: 'user:default/alice' }),
    ).toBe(true);
    expect(
      isNotRequester.apply(REQUEST, { userRef: 'user:default/requester' }),
    ).toBe(false);
    // Spelling must not be a way around a four-eyes control.
    expect(isNotRequester.apply(REQUEST, { userRef: 'User:Requester' })).toBe(
      false,
    );
  });

  it('fails closed on a ref it cannot parse', () => {
    // "Is not the requester" must not be satisfied by accident.
    expect(isNotRequester.apply(REQUEST, { userRef: '!!broken!!' })).toBe(
      false,
    );
  });
});

describe('hasTemplateRef', () => {
  it('matches only the named templates', () => {
    expect(
      hasTemplateRef.apply(REQUEST, {
        templateRefs: ['template:default/request-github-admin'],
      }),
    ).toBe(true);
    expect(
      hasTemplateRef.apply(REQUEST, {
        templateRefs: ['Template:Default/Request-GitHub-Admin'],
      }),
    ).toBe(true);
    expect(
      hasTemplateRef.apply(REQUEST, {
        templateRefs: ['template:default/something-else'],
      }),
    ).toBe(false);
    expect(hasTemplateRef.apply(REQUEST, { templateRefs: [] })).toBe(false);
  });

  it('translates to a templateRef filter', () => {
    expect(
      hasTemplateRef.toQuery({ templateRefs: ['Template:Default/X'] }),
    ).toEqual({ key: 'templateRef', values: ['template:default/x'] });
  });
});

describe('rule metadata', () => {
  it('names each rule and its resource type for policy authors', () => {
    for (const rule of [isDesignatedApprover, isNotRequester, hasTemplateRef]) {
      expect(rule.resourceType).toBe(RESOURCE_TYPE_APPROVAL_REQUEST);
      // Policy files reference rules by name, so these are part of the API.
      expect(rule.name).toMatch(/^[A-Z_]+$/);
      expect(rule.description.length).toBeGreaterThan(0);
    }

    expect([
      isDesignatedApprover.name,
      isNotRequester.name,
      hasTemplateRef.name,
    ]).toEqual([
      'IS_DESIGNATED_APPROVER',
      'IS_NOT_REQUESTER',
      'HAS_TEMPLATE_REF',
    ]);
  });
});
