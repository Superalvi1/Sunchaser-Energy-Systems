import { Type, type Schema } from "@google/genai";
import type { AIJsonSchema } from "../core/AIProvider.ts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonSchemaPropertyToGeminiSchema(value: unknown): Schema | undefined {
  if (!isPlainObject(value)) return undefined;

  const schema: Schema = {};
  const typeRaw = String(value.type || "").toLowerCase();

  switch (typeRaw) {
    case "string":
      schema.type = Type.STRING;
      break;
    case "number":
      schema.type = Type.NUMBER;
      break;
    case "integer":
      schema.type = Type.INTEGER;
      break;
    case "boolean":
      schema.type = Type.BOOLEAN;
      break;
    case "array":
      schema.type = Type.ARRAY;
      break;
    case "object":
      schema.type = Type.OBJECT;
      break;
    default:
      break;
  }

  if (typeof value.description === "string") schema.description = value.description;
  if (Array.isArray(value.enum)) schema.enum = value.enum.map((entry) => String(entry));
  if (isPlainObject(value.properties)) {
    const properties: Record<string, Schema> = {};
    for (const [key, prop] of Object.entries(value.properties)) {
      const converted = jsonSchemaPropertyToGeminiSchema(prop);
      if (converted) properties[key] = converted;
    }
    if (Object.keys(properties).length > 0) schema.properties = properties;
  }
  if (Array.isArray(value.required)) schema.required = value.required.map((entry) => String(entry));
  if (value.items !== undefined) {
    const items = jsonSchemaPropertyToGeminiSchema(value.items);
    if (items) schema.items = items;
  }

  return schema;
}

/** Map engine JSON Schema tool inputs to Gemini FunctionDeclaration.parameters. */
export function aiJsonSchemaToGeminiParameters(schema: AIJsonSchema): Schema {
  const properties: Record<string, Schema> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    properties[key] = jsonSchemaPropertyToGeminiSchema(value) ?? { type: Type.STRING };
  }

  const parameters: Schema = {
    type: Type.OBJECT,
    properties,
  };
  if (schema.required && schema.required.length > 0) {
    parameters.required = [...schema.required];
  }
  return parameters;
}

/** Map engine JSON Schema tool inputs to OpenAI function.parameters object. */
export function aiJsonSchemaToOpenAiParameters(schema: AIJsonSchema): Record<string, unknown> {
  const parameters: Record<string, unknown> = {
    type: schema.type,
    properties: schema.properties,
  };
  if (schema.required !== undefined) parameters.required = schema.required;
  if (schema.additionalProperties !== undefined) {
    parameters.additionalProperties = schema.additionalProperties;
  }
  return parameters;
}
