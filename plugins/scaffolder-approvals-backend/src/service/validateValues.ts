import { InputError } from '@backstage/errors';
import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import type { JsonObject } from '@backstage/types';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

/**
 * Validation is deliberately lenient about the *schema* and strict about the
 * *values*.
 *
 * Scaffolder parameter schemas are also react-jsonschema-form UI descriptions:
 * they carry `ui:widget`, `ui:options`, `ui:field`, `enumNames` and similar
 * keys that are not JSON Schema keywords. Ajv's strict mode rejects a schema
 * containing those outright, which would fail every realistic template — so
 * strict mode is off, and unknown keywords are ignored rather than fatal.
 */
function buildAjv(): Ajv {
  const ajv = new Ajv({
    allErrors: true,
    // Ignore the react-jsonschema-form vocabulary instead of rejecting it.
    strict: false,
    // Do not mutate the caller's values. Coercion or default-filling would
    // change what gets hashed, so the values an approver saw would stop
    // matching the values that run.
    coerceTypes: false,
    useDefaults: false,
  });
  addFormats(ajv);
  return ajv;
}

/** `spec.parameters` is one schema, an array of them, or absent. */
function parameterSchemas(template: TemplateEntityV1beta3): JsonObject[] {
  const parameters = template.spec?.parameters;
  if (!parameters) {
    return [];
  }
  return (Array.isArray(parameters) ? parameters : [parameters]).filter(
    (schema): schema is JsonObject =>
      typeof schema === 'object' && schema !== null,
  );
}

/**
 * Each entry of a `parameters` array describes one wizard page, so it only
 * knows about its own properties. Validating the whole value object against one
 * page with `additionalProperties: false` would reject the other pages'
 * properties, so that keyword is dropped at the top level of each page — and
 * only there, since nested objects are described completely by whichever page
 * owns them.
 */
function relaxPageSchema(schema: JsonObject, isPage: boolean): JsonObject {
  if (!isPage || schema.additionalProperties === undefined) {
    return schema;
  }
  const { additionalProperties: _dropped, ...rest } = schema;
  return rest;
}

function describe(errors: ErrorObject[]): string {
  return errors
    .map(error => {
      const where = error.instancePath || '(root)';
      return `${where} ${error.message ?? 'is invalid'}`;
    })
    .join('; ');
}

/**
 * Check submitted values against a template's parameter schema.
 *
 * Done at submit time rather than at launch, so that an approval is never
 * spent on a request that cannot run. An approver's time is the scarce
 * resource: finding out days later that a required field was missing means
 * starting the whole approval over.
 *
 * Throws `InputError` if the values do not fit, or if the template's own schema
 * cannot be compiled — the latter is a template bug, and saying so is more
 * useful than a 500.
 *
 * Extra properties the schema does not mention are *not* rejected, matching how
 * the scaffolder itself treats values. They are still bound by the values hash
 * and shown to approvers, so what an approver sees is what runs.
 */
export function validateValues(
  template: TemplateEntityV1beta3,
  values: JsonObject,
): void {
  const schemas = parameterSchemas(template);
  if (schemas.length === 0) {
    return;
  }

  const ajv = buildAjv();
  const isMultiPage = Array.isArray(template.spec?.parameters);
  const failures: string[] = [];

  for (const [index, schema] of schemas.entries()) {
    let validate: ValidateFunction;
    try {
      validate = ajv.compile(relaxPageSchema(schema, isMultiPage));
    } catch (error) {
      const where = isMultiPage ? ` (parameters[${index}])` : '';
      throw new InputError(
        `Template parameter schema${where} is not valid JSON Schema: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    if (!validate(values) && validate.errors) {
      failures.push(describe(validate.errors));
    }
  }

  if (failures.length > 0) {
    throw new InputError(
      `Submitted values do not match the template's parameters: ${failures.join(
        '; ',
      )}`,
    );
  }
}
