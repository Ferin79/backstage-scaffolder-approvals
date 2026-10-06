import { useApiHolder } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import useAsync from 'react-use/esm/useAsync';

/**
 * The titles a template's form gave its parameters, by path: `oncall` and
 * `oncall.primaryContact` for an object's fields, `environments[].url` for
 * the fields of an array's items.
 *
 * @internal
 */
export type ParameterTitles = ReadonlyMap<string, string>;

/**
 * Where each submitted parameter stands against the form that collected it.
 *
 * - `shown`: the form showed it for the answers given.
 * - `hidden`: the template declares it, but only under a condition these
 *   answers do not meet. The form keeps a value when the answer that showed
 *   it changes, so switching Language from TypeScript to Go still submits the
 *   Node.js version, and the defaults of the branch shown first are always
 *   there.
 * - `undeclared`: no page of the template mentions it; it came through the
 *   API, which accepts properties the schema does not forbid.
 *
 * @internal
 */
export type ParameterStanding = 'shown' | 'hidden' | 'undeclared';

/**
 * Judges submitted parameters against a template's form: given the answers,
 * where each key stands.
 *
 * @internal
 */
export type ParameterJudge = (
  values: Record<string, unknown>,
) => (key: string) => ParameterStanding;

/** @internal */
export interface TemplateParameters {
  titles: ParameterTitles;
  /** Undefined when the template could not be read: then nothing is judged. */
  standing?: ParameterJudge;
}

type Schema = Record<string, unknown>;

const isSchema = (value: unknown): value is Schema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function pagesOf(parameters: unknown): Schema[] {
  return (Array.isArray(parameters) ? parameters : [parameters]).filter(
    isSchema,
  );
}

function propertiesOf(schema: unknown): Schema {
  return isSchema(schema) && isSchema(schema.properties)
    ? schema.properties
    : {};
}

function collectTitles(
  schema: unknown,
  path: string,
  titles: Map<string, string>,
): void {
  if (!isSchema(schema)) {
    return;
  }
  for (const [name, child] of Object.entries(propertiesOf(schema))) {
    const childPath = path ? `${path}.${name}` : name;
    const title = isSchema(child) ? child.title : undefined;
    // The first title wins: a field a `oneOf` branch repeats only to pin its
    // value (`language: { const: go }`) carries none.
    if (typeof title === 'string' && title && !titles.has(childPath)) {
      titles.set(childPath, title);
    }
    collectTitles(child, childPath, titles);
  }
  collectTitles(schema.items, `${path}[]`, titles);
  for (const key of ['if', 'then', 'else']) {
    collectTitles(schema[key], path, titles);
  }
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    const branches = schema[key];
    if (Array.isArray(branches)) {
      branches.forEach(branch => collectTitles(branch, path, titles));
    }
  }
  if (isSchema(schema.dependencies)) {
    Object.values(schema.dependencies).forEach(dependency =>
      collectTitles(dependency, path, titles),
    );
  }
}

/**
 * Titles from a template's parameter pages.
 *
 * @internal
 */
export function parameterTitles(parameters: unknown): ParameterTitles {
  const titles = new Map<string, string>();
  for (const page of pagesOf(parameters)) {
    collectTitles(page, '', titles);
  }
  return titles;
}

/**
 * Whether one property's `const` or `enum` admits the answer. `undefined`
 * when it pins nothing, since then nothing here can say.
 */
function pinMatches(property: unknown, value: unknown): boolean | undefined {
  if (!isSchema(property)) {
    return undefined;
  }
  if ('const' in property) {
    return value === property.const;
  }
  if (Array.isArray(property.enum)) {
    return property.enum.includes(value);
  }
  return undefined;
}

/**
 * Whether an `if` schema holds for the answers: every property it pins has
 * that value. `undefined` when it pins nothing.
 */
function conditionHolds(
  condition: Schema,
  values: Record<string, unknown>,
): boolean | undefined {
  let pinned = false;
  for (const [name, property] of Object.entries(propertiesOf(condition))) {
    const matches = pinMatches(property, values[name]);
    if (matches === false) {
      return false;
    }
    pinned ||= matches === true;
  }
  return pinned ? true : undefined;
}

/**
 * The properties a page shows for these answers, and every property it could
 * show for some answers. Understands the two ways Backstage templates make a
 * field conditional: `dependencies` whose `oneOf` branches pin the deciding
 * field, and `if`/`then`/`else` on the page. Anything subtler is counted as
 * shown, so a value is never called hidden on a guess.
 */
function walkPage(
  page: Schema,
  values: Record<string, unknown>,
  shown: Set<string>,
  declared: Set<string>,
): void {
  const showAll = (schema: unknown) => {
    for (const name of Object.keys(propertiesOf(schema))) {
      shown.add(name);
      declared.add(name);
    }
  };
  const declareAll = (schema: unknown) => {
    for (const name of Object.keys(propertiesOf(schema))) {
      declared.add(name);
    }
  };

  showAll(page);

  if (isSchema(page.dependencies)) {
    for (const [field, dependency] of Object.entries(page.dependencies)) {
      if (!isSchema(dependency)) {
        continue; // a list of property names, not a schema
      }
      const branches = [dependency.oneOf, dependency.anyOf]
        .filter(Array.isArray)
        .flat()
        .filter(isSchema);
      if (branches.length === 0) {
        // Plain `dependencies: { a: { properties: ... } }`: shown once the
        // deciding field has any value.
        if (values[field] !== undefined) showAll(dependency);
        else declareAll(dependency);
        continue;
      }
      // The form picks the branch by the deciding field alone; the branch's
      // other fields may carry an `enum` of their own, which decides nothing.
      for (const branch of branches) {
        const selected = pinMatches(propertiesOf(branch)[field], values[field]);
        if (selected === false) declareAll(branch);
        else showAll(branch);
      }
    }
  }

  for (const conditional of [
    page,
    ...(Array.isArray(page.allOf) ? page.allOf.filter(isSchema) : []),
  ]) {
    if (!isSchema(conditional.if)) {
      continue;
    }
    const matches = conditionHolds(conditional.if, values);
    if (matches === undefined) {
      showAll(conditional.then);
      showAll(conditional.else);
    } else {
      (matches ? showAll : declareAll)(conditional.then);
      (matches ? declareAll : showAll)(conditional.else);
    }
  }
}

/**
 * Judges each submitted parameter against a template's parameter pages. The
 * pages are walked once per set of answers, not once per key.
 *
 * @internal
 */
export function parameterStanding(parameters: unknown): ParameterJudge {
  const pages = pagesOf(parameters);
  return values => {
    const shown = new Set<string>();
    const declared = new Set<string>();
    pages.forEach(page => walkPage(page, values, shown, declared));
    return key => {
      if (shown.has(key)) return 'shown';
      return declared.has(key) ? 'hidden' : 'undeclared';
    };
  };
}

const NOTHING_KNOWN: TemplateParameters = { titles: new Map() };

/**
 * The request's template's titles, and a judge of each value against its
 * form, read live from the catalog.
 *
 * Live rather than frozen with the request, so a template that has since been
 * edited may have renamed or moved a field; the page shows the drift warning
 * when that is so. A label is a reading aid, and the value beside it is what
 * was approved. While the catalog answers, when it cannot, and in an app
 * without one, the page shows keys and judges nothing.
 *
 * @internal
 */
export function useTemplateParameters(templateRef: string): TemplateParameters {
  const catalogApi = useApiHolder().get(catalogApiRef);
  const { value } = useAsync(async () => {
    if (!catalogApi) {
      return undefined;
    }
    const template = await catalogApi.getEntityByRef(templateRef);
    const parameters = (template?.spec as { parameters?: unknown } | undefined)
      ?.parameters;
    if (parameters === undefined) {
      return undefined;
    }
    return {
      titles: parameterTitles(parameters),
      standing: parameterStanding(parameters),
    };
  }, [catalogApi, templateRef]);
  return value ?? NOTHING_KNOWN;
}
