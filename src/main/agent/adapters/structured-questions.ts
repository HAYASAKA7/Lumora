import { z } from 'zod';

import {
  STRUCTURED_QUESTION_OPTIONS,
  STRUCTURED_QUESTIONS_PER_REQUEST,
  type StructuredQuestion
} from '../../../shared/agent/contracts';

/**
 * Where an answer goes back to in the form the MCP server asked for: the
 * property it fills, the type to write it as, and, for a choice, the value
 * behind each label the user saw.
 */
interface McpFormField {
  questionId: string;
  property: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'choice' | 'choices';
  required: boolean;
  /** For a choice: the value sent for each option, in the order shown. */
  values: readonly string[];
  labels: readonly string[];
}

export interface McpQuestionForm {
  questions: StructuredQuestion[];
  fields: readonly McpFormField[];
}

const TextSchema = z.string().trim().min(1);
const Described = {
  title: TextSchema.max(512).optional(),
  description: TextSchema.max(4_096).optional()
};

const ConstOptionSchema = z.object({ const: z.string().min(1), title: TextSchema.max(512) });

const StringChoiceSchema = z.object({
  type: z.literal('string'),
  ...Described,
  enum: z.array(z.string().min(1)).min(1).max(STRUCTURED_QUESTION_OPTIONS),
  enumNames: z.array(TextSchema.max(512)).optional()
});
const TitledChoiceSchema = z.object({
  type: z.literal('string'),
  ...Described,
  oneOf: z.array(ConstOptionSchema).min(1).max(STRUCTURED_QUESTION_OPTIONS)
});
const MultiChoiceSchema = z.object({
  type: z.literal('array'),
  ...Described,
  items: z.union([
    z.object({ type: z.literal('string').optional(), enum: z.array(z.string().min(1)).min(1).max(STRUCTURED_QUESTION_OPTIONS) }),
    z.object({ anyOf: z.array(ConstOptionSchema).min(1).max(STRUCTURED_QUESTION_OPTIONS) })
  ])
});
const PlainSchema = z.object({
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  ...Described
});

const FormSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string().min(1).max(256), z.unknown()),
  required: z.array(z.string()).optional()
});

function choice(
  property: string,
  described: { title?: string | undefined; description?: string | undefined },
  labels: readonly string[],
  values: readonly string[],
  multiSelect: boolean
): Omit<McpFormField, 'questionId' | 'required'> & { question: Omit<StructuredQuestion, 'id' | 'required'> } {
  return {
    property,
    type: multiSelect ? 'choices' : 'choice',
    values,
    labels,
    question: {
      header: described.title ?? property,
      prompt: described.description ?? described.title ?? property,
      answer: 'choice',
      options: labels.map((label) => ({ label, description: null })),
      multiSelect,
      allowOther: false,
      secret: false
    }
  };
}

/**
 * Turns the form an MCP server asked for into questions the composer can show.
 * Returns null for a form Lumora cannot represent faithfully — a nested object,
 * say — so the caller declines it rather than sending back half an answer.
 */
export function mcpFormQuestions(requestedSchema: unknown): McpQuestionForm | null {
  const form = FormSchema.safeParse(requestedSchema);
  if (!form.success) return null;
  const entries = Object.entries(form.data.properties);
  if (entries.length === 0 || entries.length > STRUCTURED_QUESTIONS_PER_REQUEST) return null;
  const required = new Set(form.data.required ?? []);
  const questions: StructuredQuestion[] = [];
  const fields: McpFormField[] = [];

  for (const [index, [property, schema]] of entries.entries()) {
    const questionId = `field-${index}`;
    const isRequired = required.has(property);
    let mapped: ReturnType<typeof choice> | null = null;

    const titled = TitledChoiceSchema.safeParse(schema);
    const plainChoice = StringChoiceSchema.safeParse(schema);
    const multi = MultiChoiceSchema.safeParse(schema);
    if (titled.success) {
      mapped = choice(
        property,
        titled.data,
        titled.data.oneOf.map((option) => option.title),
        titled.data.oneOf.map((option) => option.const),
        false
      );
    } else if (plainChoice.success) {
      const names = plainChoice.data.enumNames;
      const labels = names !== undefined && names.length === plainChoice.data.enum.length
        ? names
        : plainChoice.data.enum;
      mapped = choice(property, plainChoice.data, labels, plainChoice.data.enum, false);
    } else if (multi.success) {
      const items = multi.data.items;
      const labels = 'anyOf' in items ? items.anyOf.map((option) => option.title) : items.enum;
      const values = 'anyOf' in items ? items.anyOf.map((option) => option.const) : items.enum;
      mapped = choice(property, multi.data, labels, values, true);
    }

    if (mapped !== null) {
      questions.push({ id: questionId, required: isRequired, ...mapped.question });
      fields.push({
        questionId,
        property,
        type: mapped.type,
        required: isRequired,
        values: mapped.values,
        labels: mapped.labels
      });
      continue;
    }

    const plain = PlainSchema.safeParse(schema);
    if (!plain.success) return null;
    const answer = plain.data.type === 'boolean'
      ? 'boolean'
      : plain.data.type === 'string' ? 'text' : 'number';
    questions.push({
      id: questionId,
      header: plain.data.title ?? property,
      prompt: plain.data.description ?? plain.data.title ?? property,
      answer,
      options: [],
      multiSelect: false,
      allowOther: false,
      secret: false,
      required: isRequired
    });
    fields.push({
      questionId,
      property,
      type: plain.data.type,
      required: isRequired,
      values: [],
      labels: []
    });
  }
  return { questions, fields };
}

export class QuestionAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuestionAnswerError';
  }
}

/**
 * Writes the user's answers back as the content the MCP server asked for,
 * typed the way its form declared. A missing required answer or a value of the
 * wrong type is refused here, before anything reaches the server.
 */
export function mcpFormContent(
  form: McpQuestionForm,
  answers: Readonly<Record<string, readonly string[]>>
): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const field of form.fields) {
    const given = (answers[field.questionId] ?? []).map((value) => value.trim()).filter((value) => value !== '');
    if (given.length === 0) {
      if (field.required) throw new QuestionAnswerError(`${field.property} needs an answer.`);
      continue;
    }
    if (field.type === 'string') {
      content[field.property] = given[0];
    } else if (field.type === 'number' || field.type === 'integer') {
      const value = Number(given[0]);
      if (!Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) {
        throw new QuestionAnswerError(`${field.property} needs a number.`);
      }
      content[field.property] = value;
    } else if (field.type === 'boolean') {
      if (given[0] !== 'true' && given[0] !== 'false') {
        throw new QuestionAnswerError(`${field.property} needs yes or no.`);
      }
      content[field.property] = given[0] === 'true';
    } else {
      const values = given.map((label) => {
        const index = field.labels.indexOf(label);
        if (index === -1) throw new QuestionAnswerError(`${field.property} has no such choice.`);
        return field.values[index]!;
      });
      content[field.property] = field.type === 'choices' ? values : values[0];
    }
  }
  return content;
}
